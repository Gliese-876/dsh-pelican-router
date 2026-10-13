import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'

/** UI-only progress: never written to Session, messages, or model requests. */
export interface WorkflowSnapshot {
  stages: string[]
  status: 'running' | 'complete' | 'error'
}

/** Publish transient status through Harness's authenticated Connection channel. */
export function installWorkflow(ctx: Context, limit: number) {
  const states = new Map<string, WorkflowSnapshot>()
  ctx.inject(['connection'], child => {
    child.effect(() => child.connection.fetch.register({
      path: '/api/pelican-router/workflow', methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        const envelope: unknown = await request.json()
        if (!envelope || typeof envelope !== 'object' || !('rpcId' in envelope) || typeof envelope.rpcId !== 'string'
          || !('payload' in envelope)) return new Response('Invalid request', { status: 400 })
        const payload = envelope.payload
        const respond = (result: object) => Response.json({ type: 'server-response', rpcId: envelope.rpcId, result })
        if (!payload || typeof payload !== 'object' || !('sessionId' in payload) || typeof payload.sessionId !== 'string') {
          return respond({ ok: false, error: { code: 'INVALID_INPUT', message: 'Missing sessionId', details: {} } })
        }
        return respond({ ok: true, value: states.get(payload.sessionId) ?? null })
      },
    }))
  })
  ctx.effect(() => () => { states.clear() })
  return {
    start(sessionId: string | undefined, message: string) {
      if (!sessionId) return
      states.delete(sessionId)
      states.set(sessionId, { stages: [message], status: 'running' })
      if (states.size > limit) states.delete(states.keys().next().value!)
    },
    report(sessionId: string | undefined, message: string, status: WorkflowSnapshot['status'] = 'running') {
      if (!sessionId) return
      const previous = states.get(sessionId)
      states.set(sessionId, { stages: [...previous?.stages ?? [], message].slice(-6), status })
    },
  }
}
