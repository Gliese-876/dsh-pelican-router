import type { TokenUsage } from '@deepseek-ai/dsh-llm'
import { request, type IncomingMessage } from 'node:http'

/** Verified, complete output from one real local inference. */
export interface GeneratedPage {
  html: string
  usage?: TokenUsage
}

/** Raw model text arrives before the final complete HTML document is validated. */
export type PageStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'complete'; page: GeneratedPage; rawText: string }

/** Keep prompts short so the complete 28k-token page fits in the model context. */
export const MODEL_PROMPT_PREFIX = '<|user|>\n'
export const MODEL_PROMPT_SUFFIX = '\n<|assistant|>\n'
/** V2 recognizes this Chinese task; equivalent English inputs can return a refusal. */
export const MODEL_TASK_PROMPT = '生成鹈鹕骑自行车的html'

/** Validate the endpoint at configuration time; this plugin sends data only to loopback. */
export function localEndpoint(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new Error('endpoint 必须是本机 HTTP 根地址，例如 http://127.0.0.1:19140。')
  }
  return url.origin
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function count(value: unknown): value is number {
  return Number.isInteger(value) && typeof value === 'number' && value >= 0
}

/** Reject truncation and non-HTML before publishing a completed document or preview. */
export function parsePage(value: unknown): GeneratedPage {
  if (!record(value) || typeof value.content !== 'string' || value.truncated === true
    || value.stopped_limit === true || !(value.stopped_eos === true || value.stop_type === 'eos')
  ) {
    throw new Error('生成未完整结束，请检查本地推理上下文和输出长度后重试。')
  }
  // V2 encloses its actual HTML in Markdown. Remove only a complete outer wrapper.
  const fenced = /^\s*```html[ \t]*\r?\n([\s\S]*?)\r?\n```\s*$/i.exec(value.content)
  const html = fenced?.[1] ?? value.content
  if (!/^\s*(?:<!doctype html[^>]*>\s*)?<html\b/i.test(html) || !/<\/html>\s*$/i.test(html)) {
    throw new Error('生成未完整结束，请检查本地推理上下文和输出长度后重试。')
  }
  const usage = count(value.tokens_evaluated) && count(value.tokens_predicted)
    ? { inputTokens: value.tokens_evaluated, outputTokens: value.tokens_predicted,
      totalTokens: value.tokens_evaluated + value.tokens_predicted }
    : undefined
  return { html, ...(usage === undefined ? {} : { usage }) }
}

function completionPayload(maxTokens: number, stream: boolean): string {
  // Normalize an already classified intent, not the HTML output: inference remains real and uncached.
  const prompt = MODEL_PROMPT_PREFIX + MODEL_TASK_PROMPT + MODEL_PROMPT_SUFFIX
  return JSON.stringify({
      prompt, temperature: 0, n_predict: maxTokens, stream,
      repeat_penalty: 1, repeat_last_n: 0, cache_prompt: false,
      seed: 0, stop: [], ignore_eos: false,
  })
}

/** Execute a new inference every time; neither an HTML fixture nor a response cache is used. */
export async function generatePage(endpoint: string, maxTokens: number, signal: AbortSignal): Promise<GeneratedPage> {
  const payload = completionPayload(maxTokens, false)
  // Native HTTP has no Undici 5-minute header deadline: CPU inference can take longer.
  const result = await new Promise<unknown>((resolve, reject) => {
    const req = request(`${endpoint}/completion`, {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    }, response => {
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`生成服务暂不可用（HTTP ${response.statusCode}），请检查本地服务后重试。`))
        return
      }
      void (async () => {
        response.setEncoding('utf8')
        let body = ''
        let size = 0
        for await (const chunk of response) {
          size += Buffer.byteLength(chunk)
          if (size > 2 * 1024 * 1024) {
            response.destroy()
            throw new Error('生成服务响应过大，请检查本地服务。')
          }
          body += chunk
        }
        try { resolve(JSON.parse(body)) }
        catch { reject(new Error('生成服务返回了无效数据，请检查本地服务。')) }
      })().catch(reject)
    })
    req.on('error', () => reject(signal.aborted ? signal.reason : new Error('生成服务暂不可用，请检查本地服务后重试。')))
    req.end(payload)
  })
  signal.throwIfAborted()
  return parsePage(result)
}

/** Stream a fresh local inference, then validate its complete, uncached HTML output. */
export async function* streamPage(
  endpoint: string,
  maxTokens: number,
  signal: AbortSignal,
): AsyncGenerator<PageStreamEvent> {
  signal.throwIfAborted()
  const payload = completionPayload(maxTokens, true)
  const req = request(`${endpoint}/completion`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  })
  let response: IncomingMessage | undefined
  try {
    response = await new Promise<IncomingMessage>((resolve, reject) => {
      req.once('response', resolve)
      req.on('error', () => reject(signal.aborted ? signal.reason : new Error('生成服务暂不可用，请检查本地服务后重试。')))
      req.end(payload)
    })
    if (response.statusCode !== 200) {
      throw new Error(`生成服务暂不可用（HTTP ${response.statusCode}），请检查本地服务后重试。`)
    }
    response.setEncoding('utf8')
    let pending = ''
    let rawText = ''
    let size = 0
    for await (const chunk of response) {
      signal.throwIfAborted()
      pending += chunk
      if (Buffer.byteLength(pending) > 2 * 1024 * 1024) throw new Error('生成服务响应过大，请检查本地服务。')
      let boundary: RegExpExecArray | null
      while ((boundary = /\r?\n\r?\n/.exec(pending)) !== null) {
        const frame = pending.slice(0, boundary.index)
        pending = pending.slice(boundary.index + boundary[0].length)
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).trimStart()).join('\n')
        if (data === '' || data === '[DONE]') continue
        let event: unknown
        try { event = JSON.parse(data) }
        catch { throw new Error('生成服务返回了无效数据，请检查本地服务。') }
        if (!record(event) || typeof event.content !== 'string' || typeof event.stop !== 'boolean') {
          throw new Error('生成服务返回了无效数据，请检查本地服务。')
        }
        if (event.content !== '') {
          size += Buffer.byteLength(event.content)
          if (size > 2 * 1024 * 1024) throw new Error('生成服务响应过大，请检查本地服务。')
          rawText += event.content
          yield { type: 'delta', text: event.content }
        }
        if (event.stop) {
          signal.throwIfAborted()
          yield { type: 'complete', page: parsePage({ ...event, content: rawText }), rawText }
          return
        }
      }
    }
    throw new Error('生成未完整结束，请检查本地推理上下文和输出长度后重试。')
  } catch (error) {
    if (signal.aborted) throw signal.reason
    if (error instanceof Error && error.message.startsWith('生成')) throw error
    throw new Error('生成服务暂不可用，请检查本地服务后重试。')
  } finally {
    response?.destroy()
    req.destroy()
  }
}

/** A literal HTML code block rendered by both Harness clients, without executing model scripts. */
export function pageMarkdown(html: string, previewPath?: string): string {
  const longestFence = Math.max(2, ...Array.from(html.matchAll(/`+/g), match => match[0].length))
  const fence = '`'.repeat(longestFence + 1)
  const destination = previewPath === undefined ? undefined
    : encodeURI(previewPath.replaceAll('\\', '/')).replaceAll('#', '%23').replaceAll('?', '%3F')
  const link = destination === undefined ? '' : `[预览网页](<${destination}>)\n\n`
  return `${link}${fence}html\n${html}\n${fence}`
}
