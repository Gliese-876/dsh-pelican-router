import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { isAgentLoopRequest, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { classifierRequest, humanText, pendingHuman, readClassifier } from './classifier.ts'
import { localEndpoint, streamPage } from './local-model.ts'
import { createPreview } from './preview.ts'
import { installWorkflow } from './workflow.ts'

/** Visible plugin identity in Harness' normal plugin list. */
export const name = 'pelican-router'
/** Host services shared by WebUI and Desktop. */
export const inject = ['llm']

/** Deployment controls exposed through the bundle's Cordis config. */
export interface Config {
  endpoint: string
  classifierMaxTokens: number
  classifierTimeoutMs: number
  classifierAttempts: number
  generationMaxTokens: number
  generationTimeoutMs: number
  decisionCacheSize: number
  preview: boolean
}

/** Editable settings, including enough generation budget for the complete model output. */
export const Config: Schema<Config> = Schema.object({
  endpoint: Schema.string().default('http://127.0.0.1:19140').description('本地 llama-server 地址'),
  classifierMaxTokens: Schema.natural().min(16).default(4096),
  classifierTimeoutMs: Schema.natural().min(1000).default(120000),
  classifierAttempts: Schema.natural().min(1).max(5).default(2),
  generationMaxTokens: Schema.natural().min(29000).max(32000).default(32000),
  generationTimeoutMs: Schema.natural().min(1000).default(1800000),
  decisionCacheSize: Schema.natural().min(1).max(4096).default(256),
  preview: Schema.boolean().default(true),
})

/** Install a host waterfall; unrelated requests delegate unchanged through next(). */
export function apply(ctx: Context, config: Config): void {
  const endpoint = localEndpoint(config.endpoint)
  const shutdown = new AbortController()
  const decisions = new Map<string, Promise<boolean>>()
  const active = new Set<Promise<void>>()
  const llm = ctx.llm
  const workflow = installWorkflow(ctx, config.decisionCacheSize)

  ctx.on('llm/stream', async function* (options, next): AsyncIterable<StreamChunk> {
    const human = isAgentLoopRequest(options) && options.purpose === undefined ? pendingHuman(options) : undefined
    if (human === undefined || shutdown.signal.aborted) {
      yield* next()
      return
    }
    const lifecycle = new AbortController()
    const signal = AbortSignal.any([lifecycle.signal, shutdown.signal, ...(options.signal ? [options.signal] : [])])
    let relevant: boolean
    try {
        signal.throwIfAborted()
        const text = humanText(human)
        const key = JSON.stringify([options.sessionId, human.id, options.provider, options.model, options.reasoningEffort])
        let decision = decisions.get(key)
        workflow.start(options.sessionId, decision
          ? '正在读取本条消息已有的分类结果……'
          : `正在判断请求意图，分类模型：${options.provider}/${options.model}……`)
        if (!decision) {
          decision = classify(options, text, signal)
          decisions.set(key, decision)
          // Cache labels for retry deduplication only; never cache a generated webpage.
          if (decisions.size > config.decisionCacheSize) decisions.delete(decisions.keys().next().value!)
          void decision.catch(() => { if (decisions.get(key) === decision) decisions.delete(key) })
        }
        const drained = decision.then(() => {}, () => {})
        active.add(drained)
        void drained.then(() => { active.delete(drained) })
        relevant = await decision
        signal.throwIfAborted()
    } catch (error) {
      workflow.report(options.sessionId, signal.aborted ? '请求已取消。' : '分类失败，未进行模型路由。', 'error')
      yield failure(error, signal)
      lifecycle.abort()
      return
    }
    if (!relevant) {
      workflow.report(options.sessionId, `判定为其他请求，继续由原模型 ${options.provider}/${options.model} 回答……`)
      try {
        for await (const chunk of next()) {
          if (chunk.type === 'finish') workflow.report(options.sessionId,
            chunk.reason.kind === 'stop' ? '原模型已完成回答。' : '原模型本次调用已结束。',
            chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted' ? 'error' : 'complete')
          yield chunk
        }
      } catch (error) {
        workflow.report(options.sessionId, '原模型调用失败。', 'error')
        throw error
      }
      return
    }
    workflow.report(options.sessionId, `已路由至本地 0u0ai Pelican PRO（${endpoint}）。`)
    workflow.report(options.sessionId, '正在进行真实 AI 推理，并流式输出网页……')
    const generationSignal = AbortSignal.any([signal, AbortSignal.timeout(config.generationTimeoutMs)])
    let started = false
    try {
      for await (const event of streamPage(endpoint, config.generationMaxTokens, generationSignal)) {
        if (event.type === 'delta') {
          if (!started) {
            started = true
            yield { type: 'block-start', index: 0, blockType: 'text' }
          }
          yield { type: 'text-delta', index: 0, text: event.text }
          continue
        }
        const path = config.preview ? await createPreview(ctx, options, event.page.html, generationSignal) : undefined
        const link = path === undefined ? '' : `\n\n[预览网页](<${encodeURI(path.replaceAll('\\', '/')).replaceAll('#', '%23').replaceAll('?', '%3F')}>)`
        if (link) yield { type: 'text-delta', index: 0, text: link }
        yield { type: 'block-end', index: 0, block: { type: 'text', text: event.rawText + link } }
        if (event.page.usage) yield { type: 'usage', usage: event.page.usage }
        workflow.report(options.sessionId, path ? '本地推理已完成，网页预览已保存。' : '本地推理已完成。', 'complete')
        yield { type: 'finish', reason: { kind: 'stop' } }
      }
    } catch (error) {
      workflow.report(options.sessionId, generationSignal.aborted ? '本地推理已取消。' : '本地推理失败。', 'error')
      yield failure(error, generationSignal)
    } finally {
      lifecycle.abort()
    }
  })

  ctx.effect(() => async () => {
    shutdown.abort()
    decisions.clear()
    await Promise.allSettled([...active])
  })

  function failure(error: unknown, signal: AbortSignal): StreamChunk {
    return { type: 'finish', reason: {
      kind: signal.aborted ? 'aborted' : 'error',
      failure: {
        code: signal.aborted ? 'ABORTED' : 'PELICAN_GENERATION_FAILED',
        message: signal.aborted ? '请求已取消。' : error instanceof Error ? error.message : '生成失败，请重试。',
      },
    } }
  }

  async function classify(original: GenerateOptions, text: string, parentSignal: AbortSignal): Promise<boolean> {
    const signal = AbortSignal.any([parentSignal, AbortSignal.timeout(config.classifierTimeoutMs)])
    let lastError: unknown
    for (let attempt = 0; attempt < config.classifierAttempts; attempt++) {
      signal.throwIfAborted()
      try {
        return await readClassifier(llm.stream(classifierRequest(original, text, config.classifierMaxTokens, signal)), signal)
      } catch (error) {
        signal.throwIfAborted()
        lastError = error
      }
    }
    throw lastError
  }
}
