import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import test, { type TestContext } from 'node:test'
import { generatePage, localEndpoint, pageMarkdown, parsePage, streamPage } from '../src/local-model.ts'

// These transport fixtures exercise the protocol, not the model. Real GGUF inference
// is verified separately by scripts/verify-model.mjs; no fixture ships in the plugin.
const html = '<!DOCTYPE html>\n<html><head><title>Pelican</title></head><body>🚲</body></html>'
const complete = { content: html, stopped_eos: true, stopped_limit: false, truncated: false,
  tokens_evaluated: 17, tokens_predicted: 63 }

async function server(t: TestContext, handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const instance = createServer(handler)
  instance.listen(0, '127.0.0.1')
  await once(instance, 'listening')
  t.after(async () => {
    instance.closeAllConnections()
    await new Promise<void>((resolve, reject) => instance.close(error => error ? reject(error) : resolve()))
  })
  const address = instance.address()
  assert.ok(address && typeof address === 'object')
  return `http://127.0.0.1:${address.port}`
}

test('complete native llama.cpp HTML and token usage are accepted without rewriting', () => {
  assert.deepEqual(parsePage(complete), { html, usage: { inputTokens: 17, outputTokens: 63, totalTokens: 80 } })
  assert.deepEqual(parsePage({ content: '<html lang="zh"><body>骑车</body></html>', stopped_eos: true }),
    { html: '<html lang="zh"><body>骑车</body></html>' })
  assert.deepEqual(parsePage({ content: html, stop_type: 'eos' }), { html })
})

test('complete model HTML fences are unwrapped without changing the document inside', () => {
  assert.deepEqual(parsePage({ ...complete, content: '```html\n' + html + '\n```' }),
    { html, usage: { inputTokens: 17, outputTokens: 63, totalTokens: 80 } })
  const document = ' \n<!DOCTYPE html>\r\n<html><body>鹈鹕🚲\n  </body></html>\n '
  assert.equal(parsePage({ content: '```html\r\n' + document + '\r\n```', stop_type: 'eos' }).html, document)
})

test('truncated, non-HTML, partial, and malformed native completions are rejected', () => {
  for (const invalid of [null, [], {}, { ...complete, content: '' }, { ...complete, truncated: true },
    { ...complete, stopped_limit: true }, { ...complete, stopped_eos: false },
    { ...complete, stopped_eos: undefined }, { ...complete, content: html.slice(0, -7) },
    { ...complete, content: '```html\n' + html },
    { ...complete, content: '```html\n' + html + '\n``' },
    { ...complete, content: '```javascript\n' + html + '\n```' },
    { ...complete, content: '```html\n' + html + '\n``` trailing prose' },
    { ...complete, content: 'Here is the page:\n```html\n' + html + '\n```' },
    { ...complete, content: '```html\nnot an HTML document\n```' },
    { ...complete, content: '```html\n' + html + '\n```', truncated: true },
    { ...complete, content: 'Here is the page:\n' + html }, { ...complete, content: html + ' trailing prose' }]) {
    assert.throws(() => parsePage(invalid), /生成未完整结束/)
  }
})

test('invalid usage metadata is omitted without inventing token counts', () => {
  for (const invalid of [-1, 1.5, '17', null, undefined, Infinity, NaN]) {
    assert.deepEqual(parsePage({ ...complete, tokens_evaluated: invalid }), { html })
    assert.deepEqual(parsePage({ ...complete, tokens_predicted: invalid }), { html })
  }
  assert.deepEqual(parsePage({ ...complete, tokens_evaluated: 0, tokens_predicted: 0 }),
    { html, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 } })
})

test('endpoint allows only unauthenticated local HTTP roots', () => {
  for (const [input, expected] of [
    ['http://127.0.0.1:19140/', 'http://127.0.0.1:19140'],
    ['http://localhost:19140', 'http://localhost:19140'],
    ['http://[::1]:19140/', 'http://[::1]:19140'],
  ]) assert.equal(localEndpoint(input!), expected)
  for (const invalid of ['https://127.0.0.1:19140', 'http://example.com:19140',
    'http://192.168.1.1:19140', 'http://127.0.0.1.example.com:19140', 'file:///tmp/model',
    'http://user:password@localhost:19140', 'http://localhost:19140/completion',
    'http://localhost:19140/?key=secret', 'http://localhost:19140/#fragment', 'not a URL']) {
    assert.throws(() => localEndpoint(invalid))
  }
})

test('HTML markdown fence cannot be closed by backticks in model output', () => {
  const nested = '<html><body><script>const x = `one`; const y = "````";</script></body></html>'
  assert.equal(pageMarkdown(nested), '`````html\n' + nested + '\n`````')
  assert.equal(pageMarkdown(html), '```html\n' + html + '\n```')
  const preview = pageMarkdown(html, 'C:\\sessions\\page <1>.html')
  assert.ok(preview.startsWith('[预览网页](<C:/sessions/page%20%3C1%3E.html>)\n\n```html\n'))
  const special = pageMarkdown('<html></html>', 'C:/project #1?/100%/page.html')
  assert.ok(special.startsWith('[预览网页](<C:/project%20%231%3F/100%25/page.html>)'))
})

test('generatePage issues a fresh native inference with the verified canonical task on every call', async t => {
  const calls: Array<{ method?: string, url?: string, contentType?: string, body: Record<string, unknown> }> = []
  const endpoint = await server(t, async (request, response) => {
    const buffers: Buffer[] = []
    for await (const buffer of request) buffers.push(Buffer.from(buffer))
    calls.push({ method: request.method, url: request.url, contentType: request.headers['content-type'],
      body: JSON.parse(Buffer.concat(buffers).toString()) })
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify(complete))
  })
  assert.deepEqual(await generatePage(endpoint, 32000, AbortSignal.timeout(5000)), parsePage(complete))
  await generatePage(endpoint, 32000, AbortSignal.timeout(5000))
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.equal(call.method, 'POST')
    assert.equal(call.url, '/completion')
    assert.equal(call.contentType, 'application/json')
    assert.deepEqual(call.body, { prompt: '<|user|>\n生成鹈鹕骑自行车的html\n<|assistant|>\n',
      temperature: 0, n_predict: 32000, stream: false, repeat_penalty: 1, repeat_last_n: 0,
      cache_prompt: false, seed: 0, stop: [], ignore_eos: false })
  }
})

test('HTTP failure does not expose server bodies or return fallback HTML', async t => {
  const endpoint = await server(t, (_request, response) => {
    response.statusCode = 503
    response.end('PRIVATE PROMPT and arbitrary server detail')
  })
  await assert.rejects(generatePage(endpoint, 32000, AbortSignal.timeout(5000)), error => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /HTTP 503/)
    assert.doesNotMatch(error.message, /PRIVATE|arbitrary/)
    return true
  })
})

test('redirects cannot escape to a remote generation endpoint', async t => {
  const endpoint = await server(t, (_request, response) => {
    response.writeHead(302, { Location: 'http://example.com/completion' })
    response.end()
  })
  await assert.rejects(generatePage(endpoint, 32000, AbortSignal.timeout(5000)))
})

test('transport abort promptly stops a pending completion', async t => {
  let arrived!: () => void
  const started = new Promise<void>(resolve => { arrived = resolve })
  const endpoint = await server(t, (_request, _response) => { arrived() })
  const abort = new AbortController()
  const pending = generatePage(endpoint, 32000, abort.signal)
  await started
  abort.abort()
  await assert.rejects(pending, { name: 'AbortError' })
})

test('native transport preserves Unicode across arbitrary byte boundaries', async t => {
  const endpoint = await server(t, (_request, response) => {
    response.setHeader('Content-Type', 'application/json')
    const bytes = Buffer.from(JSON.stringify({ ...complete, content: '<html><body>鹈鹕🚲</body></html>' }))
    for (let index = 0; index < bytes.length; index++) response.write(bytes.subarray(index, index + 1))
    response.end()
  })
  const page = await generatePage(endpoint, 32000, AbortSignal.timeout(5000))
  assert.equal(page.html, '<html><body>鹈鹕🚲</body></html>')
})

test('invalid JSON and oversized service responses fail without exposing response text', async t => {
  const malformed = await server(t, (_request, response) => { response.end('PRIVATE invalid JSON') })
  await assert.rejects(generatePage(malformed, 32000, AbortSignal.timeout(5000)), error => {
    assert.ok(error instanceof Error)
    assert.match(error.message, /无效数据/)
    assert.doesNotMatch(error.message, /PRIVATE/)
    return true
  })
  const oversized = await server(t, (_request, response) => {
    response.end(JSON.stringify({ ...complete, content: '<html>' + 'x'.repeat(2 * 1024 * 1024) + '</html>' }))
  })
  await assert.rejects(generatePage(oversized, 32000, AbortSignal.timeout(5000)), /响应过大/)
})

test('streamPage yields model text before completion and validates the accumulated fenced HTML', async t => {
  let finish!: () => void
  const mayFinish = new Promise<void>(resolve => { finish = resolve })
  let requestBody: Record<string, unknown> | undefined
  const rawText = '```html\n' + html + '\n```'
  const endpoint = await server(t, async (request, response) => {
    const buffers: Buffer[] = []
    for await (const buffer of request) buffers.push(Buffer.from(buffer))
    requestBody = JSON.parse(Buffer.concat(buffers).toString())
    response.setHeader('Content-Type', 'text/event-stream')
    const first = Buffer.from('data: ' + JSON.stringify({ content: '```html\n', stop: false }) + '\r\n\r\n')
    for (let index = 0; index < first.length; index++) response.write(first.subarray(index, index + 1))
    await mayFinish
    response.write('data: ' + JSON.stringify({ content: html + '\n```', stop: false }) + '\n\n')
    response.end('data: ' + JSON.stringify({ ...complete, content: '', stop: true, stop_type: 'eos' }) + '\n\n')
  })
  const stream = streamPage(endpoint, 32000, AbortSignal.timeout(5000))
  assert.deepEqual(await stream.next(), { value: { type: 'delta', text: '```html\n' }, done: false })
  assert.equal(requestBody?.stream, true)
  assert.equal(requestBody?.cache_prompt, false)
  finish()
  assert.deepEqual(await stream.next(), { value: { type: 'delta', text: html + '\n```' }, done: false })
  assert.deepEqual(await stream.next(), { value: { type: 'complete', page: parsePage(complete), rawText }, done: false })
  assert.equal((await stream.next()).done, true)
})

test('streamPage cancellation closes an active streaming response', async t => {
  let closed!: () => void
  const disconnected = new Promise<void>(resolve => { closed = resolve })
  const endpoint = await server(t, (_request, response) => {
    response.on('close', closed)
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.write('data: ' + JSON.stringify({ content: '```html\n', stop: false }) + '\n\n')
  })
  const abort = new AbortController()
  const stream = streamPage(endpoint, 32000, abort.signal)
  assert.equal((await stream.next()).value?.type, 'delta')
  const next = stream.next()
  abort.abort()
  await assert.rejects(next, { name: 'AbortError' })
  await disconnected
})
