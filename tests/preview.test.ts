import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Context } from '@deepseek-ai/cordis';
import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { createPreview } from '../src/preview.ts';

const request = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  sessionId: 'session-1',
  messages: [{
    id: 'human-1', role: 'user', source: { kind: 'user' },
    content: [{ type: 'text', text: '绘制鹈鹕骑车网页' }],
  }],
} as GenerateOptions;

function fixture({ writeError = undefined as Error | undefined } = {}) {
  const calls: { path: string; cwd: string; html: string; intent: object; policy: object; signal: AbortSignal | undefined }[] = [];
  const target = { targetKey: 'opaque-file', displayPath: 'pelican.html' };
  const session = { header: { cwd: 'C:/original' } };
  const policy = { mode: 'workspace-write', workspaceRoot: 'C:/original', sessionId: 'session-1' };
  let resolved: { path: string; cwd: string; signal: AbortSignal | undefined };
  const services = {
    fs: {
      async resolve(path: string, options: { cwd: string; signal?: AbortSignal }) {
        resolved = { path, cwd: options.cwd, signal: options.signal };
        return target;
      },
      async writeText(_target: object, html: string, intent: object, signal: AbortSignal | undefined, effectivePolicy: object) {
        if (writeError !== undefined) throw writeError;
        calls.push({ ...resolved, html, intent, policy: effectivePolicy, signal });
      },
      processPath() { return `C:\\current project #1?\\${resolved.path}`; },
    },
    workingDirectory: { get() { return 'C:/current project #1?'; } },
    sandboxPolicy: { resolve(input: { session: object }) { assert.equal(input.session, session); return policy; } },
  };
  const agent = {
    session,
    ctx: { get(name: keyof typeof services) { return services[name]; } },
  };
  const ctx = { get() { return { get() { return agent; } }; } } as Context;
  return { ctx, calls, policy, services };
}

test('writes this real model response and links its native HTML preview', async () => {
  const { ctx, calls, policy } = fixture();
  const signal = new AbortController().signal;
  const html = '<!doctype html><html><body>model output</body></html>';
  const link = await createPreview(ctx, { ...request, signal }, html);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].html, html);
  assert.equal(calls[0].cwd, 'C:/current project #1?');
  assert.match(calls[0].path, /^pelican-[a-f0-9-]{36}\.html$/);
  assert.deepEqual(calls[0].intent, { kind: 'createIfAbsent' });
  assert.equal(calls[0].policy, policy);
  assert.equal(calls[0].signal, signal);
  assert.equal(link, `C:\\current project #1?\\${calls[0].path}`);
});

test('saves each inference in a fresh document without overwriting an earlier file', async () => {
  const { ctx, calls } = fixture();
  await createPreview(ctx, request, '<html>first inference</html>');
  await createPreview(ctx, request, '<html>second inference</html>');
  assert.notEqual(calls[0].path, calls[1].path);
  assert.equal(calls[1].html, '<html>second inference</html>');
  assert.deepEqual(calls[1].intent, { kind: 'createIfAbsent' });
});

test('uses the original session directory when the working-directory service is absent', async () => {
  const { ctx, calls, services } = fixture();
  Reflect.deleteProperty(services, 'workingDirectory');
  await createPreview(ctx, request, '<html>model output</html>');
  assert.equal(calls[0].cwd, 'C:/original');
});

test('does not need an agent registry for fenced HTML delivery', async () => {
  const ctx = { get() { return undefined; } } as Context;
  assert.equal(await createPreview(ctx, request, '<html>model output</html>'), undefined);
  assert.equal(await createPreview(ctx, { ...request, sessionId: undefined }, '<html>model output</html>'), undefined);
});

test('keeps sandbox and filesystem failures visible', async () => {
  const error = new Error('FS_SANDBOX_DENIED');
  const { ctx } = fixture({ writeError: error });
  await assert.rejects(createPreview(ctx, request, '<html>model output</html>'), value => value === error);
});

test('cancellation prevents preview writes', async () => {
  const { ctx, calls } = fixture();
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(createPreview(ctx, { ...request, signal: controller.signal }, '<html>model output</html>'), { name: 'AbortError' });
  assert.equal(calls.length, 0);
});

test('passes the combined generation signal to preview filesystem operations', async () => {
  const { ctx, calls } = fixture();
  const requestSignal = new AbortController().signal;
  const generationSignal = new AbortController().signal;
  await createPreview(ctx, { ...request, signal: requestSignal }, '<html>model output</html>', generationSignal);
  assert.equal(calls[0].signal, generationSignal);
});

test('plugin shutdown can cancel preview creation while the request signal stays active', async () => {
  const { ctx, calls } = fixture();
  const requestSignal = new AbortController().signal;
  const generation = new AbortController();
  generation.abort(new Error('plugin stopped'));
  await assert.rejects(
    createPreview(ctx, { ...request, signal: requestSignal }, '<html>model output</html>', generation.signal),
    /plugin stopped/,
  );
  assert.equal(requestSignal.aborted, false);
  assert.equal(calls.length, 0);
});
