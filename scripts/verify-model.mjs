import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const runtimeDir = path.resolve(process.env.PELICAN_RUNTIME_DIR ?? path.join(root, '.runtime'));
const endpoint = (process.env.PELICAN_MODEL_URL ?? 'http://127.0.0.1:19140').replace(/\/$/, '');
const outputDir = path.resolve(process.env.PELICAN_VERIFY_DIR ?? path.join(root, 'artifacts', 'model-verification'));
const timeoutMs = Number(process.env.PELICAN_VERIFY_TIMEOUT_MS ?? 1800000);
const manifest = JSON.parse(await readFile(path.join(runtimeDir, 'manifest.json'), 'utf8'));
let processRecord;
try { processRecord = JSON.parse(await readFile(path.join(runtimeDir, 'model-process.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const actualRuntime = processRecord?.runtime ?? manifest.runtime;
let localModelModule;
try {
  await readFile(path.join(root, 'src', 'local-model.ts'));
  localModelModule = await import(pathToFileURL(path.join(root, 'src', 'local-model.ts')).href);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  localModelModule = await import(pathToFileURL(path.join(root, 'dist', 'local-model.js')).href);
}

function request(route, options = {}) {
  // Node fetch has an independent five-minute headers timeout. A complete raw
  // generation can legitimately take longer, so use a directly controlled request.
  const url = new URL(`${endpoint}${route}`);
  const transport = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    let totalBytes = 0;
    const req = transport.request(url, {
      method: options.method ?? 'GET',
      headers: { ...options.headers, ...(options.body ? { 'Content-Length': Buffer.byteLength(options.body) } : {}) },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > 16 * 1024 * 1024) {
          req.destroy(new Error('Local model response exceeded 16 MiB.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('error', reject);
      response.on('end', () => {
        clearTimeout(deadline);
        const body = Buffer.concat(chunks).toString('utf8');
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`${route}: HTTP ${response.statusCode}: ${body}`));
          return;
        }
        try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
      });
    });
    const deadline = setTimeout(() => req.destroy(new Error(`${route}: inference exceeded ${timeoutMs} ms.`)), timeoutMs);
    req.setTimeout(timeoutMs, () => req.destroy(new Error(`${route}: local model connection timed out.`)));
    req.on('error', (error) => { clearTimeout(deadline); reject(error); });
    req.end(options.body);
  });
}

const health = await request('/health');
assert.equal(health.status, 'ok');
const properties = await request('/props');
assert.ok(properties.default_generation_settings?.n_ctx >= 32768, 'Local server must expose the full 32768-token context.');
await mkdir(outputDir, { recursive: true });
console.log(`Requesting real uncached model generation through the plugin's generatePage() from ${endpoint}/completion ...`);
const startedAt = new Date();
let capturedResponse;
// A loopback recording bridge preserves the raw inference evidence while calling
// the exact plugin transport and parsePage() once. It stores no reusable response.
const recorder = http.createServer(async (incoming, outgoing) => {
  try {
    assert.equal(incoming.method, 'POST');
    assert.equal(incoming.url, '/completion');
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString('utf8');
    const payload = JSON.parse(body);
    assert.equal(payload.cache_prompt, false);
    assert.equal(payload.temperature, 0);
    await writeFile(path.join(outputDir, 'request.json'), `${JSON.stringify(payload, null, 2)}\n`);
    capturedResponse = await request('/completion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
    });
    // Preserve evidence before the production parser runs, including rejected output.
    await writeFile(path.join(outputDir, 'response.json'), `${JSON.stringify(capturedResponse, null, 2)}\n`);
    if (typeof capturedResponse.content === 'string') {
      await writeFile(path.join(outputDir, 'raw-response.txt'), capturedResponse.content, 'utf8');
    }
    outgoing.writeHead(200, { 'Content-Type': 'application/json' });
    outgoing.end(JSON.stringify(capturedResponse));
  } catch (error) {
    outgoing.writeHead(502, { 'Content-Type': 'application/json' });
    outgoing.end(JSON.stringify({ error: error.message }));
  }
});
await new Promise((resolve, reject) => {
  recorder.once('error', reject);
  recorder.listen(0, '127.0.0.1', resolve);
});
let generated;
try {
  generated = await localModelModule.generatePage(
    `http://127.0.0.1:${recorder.address().port}`, 32000,
    AbortSignal.timeout(timeoutMs),
  );
} catch (error) {
  await writeFile(path.join(outputDir, 'failure.json'), `${JSON.stringify({
    verifiedAt: new Date().toISOString(), elapsedMs: Date.now() - startedAt.getTime(),
    message: error.message, hasCapturedResponse: capturedResponse !== undefined,
  }, null, 2)}\n`);
  throw error;
} finally {
  recorder.closeAllConnections();
  await new Promise((resolve) => recorder.close(resolve));
}
const response = capturedResponse;
const content = generated.html;
assert.equal(typeof content, 'string', 'Model response must contain generated text.');
const bytes = Buffer.from(content, 'utf8');
const summary = {
  verifiedAt: new Date().toISOString(),
  elapsedMs: Date.now() - startedAt.getTime(),
  endpoint,
  model: manifest.model,
  runtime: actualRuntime,
  actualBackend: processRecord?.backend ?? actualRuntime.backend,
  device: processRecord?.device,
  startupEvidence: processRecord ? { stderrPath: processRecord.stderrPath, stdoutPath: processRecord.stdoutPath, attempts: processRecord.attempts } : undefined,
  output: {
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    startsWithDoctype: /^\s*<!doctype html>/i.test(content),
    endsWithHtml: /<\/html>\s*$/i.test(content),
    containsSvg: /<svg\b/i.test(content),
    stoppedEos: response.stopped_eos === true || response.stop_type === 'eos',
    truncated: response.truncated ?? false,
    tokensPredicted: response.tokens_predicted,
    tokensEvaluated: response.tokens_evaluated,
    stopType: response.stop_type,
  },
  rawOutput: {
    bytes: Buffer.byteLength(response.content, 'utf8'),
    sha256: createHash('sha256').update(response.content, 'utf8').digest('hex'),
    hasHtmlCodeFence: /^```html\r?\n/i.test(response.content),
  },
  timings: response.timings,
  settings: response.generation_settings,
  serverContext: properties.default_generation_settings?.n_ctx,
  pluginTransportVerified: true,
  pluginUsage: generated.usage,
  evidence: 'This HTML was produced by a live GGUF inference. It is a verification artifact, never a runtime fallback or response cache.',
};
await writeFile(path.join(outputDir, 'generated.html'), bytes);
await writeFile(path.join(outputDir, 'response.json'), `${JSON.stringify(response, null, 2)}\n`);
await writeFile(path.join(outputDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
assert.ok(summary.output.startsWithDoctype, 'Generated output must begin with an HTML doctype.');
assert.ok(summary.output.endsWithHtml, 'Generation stopped before a complete HTML document was received.');
assert.ok(summary.output.containsSvg, 'Expected the model-generated SVG scene.');
assert.equal(summary.output.truncated, false, 'llama-server reported a truncated output.');
assert.equal(summary.output.stoppedEos, true, 'The model must finish naturally at its end-of-sequence token.');
console.log(`Live model verification passed. Evidence: ${outputDir}`);
