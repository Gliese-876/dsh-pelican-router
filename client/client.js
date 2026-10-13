// Harness client factory. Its state lives in the UI and never becomes model context.
window.__ModuleLoader__.load({
  id: 'dsh-pelican-router',
  factory(require) {
    const { createElement: h, useEffect, useState } = require('react')
    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        function WorkflowCard({ sessionId }) {
          const [snapshot, setSnapshot] = useState(null)
          useEffect(() => {
            const abort = new AbortController()
            let timer
            let last = ''
            async function refresh() {
              try {
                const result = await ctx.connection.rpc.call('/api', 'pelican-router/workflow', { sessionId }, abort.signal)
                if (!result.ok) throw new Error(result.error.message)
                const value = result.value
                if (value !== null && (!Array.isArray(value.stages) || !value.stages.every(stage => typeof stage === 'string'))) {
                  throw new Error('Invalid workflow status')
                }
                const serialized = JSON.stringify(value)
                if (!abort.signal.aborted && serialized !== last) {
                  last = serialized
                  setSnapshot(value)
                }
              } catch (error) {
                if (!abort.signal.aborted) setSnapshot({ stages: ['流程提示暂不可用，正在重新连接……'], status: 'error' })
              } finally {
                if (!abort.signal.aborted) timer = setTimeout(refresh, 500)
              }
            }
            setSnapshot(null)
            refresh()
            return () => { abort.abort(); clearTimeout(timer) }
          }, [sessionId])
          if (!snapshot) return null
          return h('section', {
            role: 'status', 'aria-label': 'Pelican Router 插件流程',
            style: { padding: '10px 14px', marginBottom: 8, border: '1px solid #8885', borderRadius: 10, fontSize: 12, lineHeight: 1.7 },
          }, h('strong', null, 'Pelican Router · 插件流程'),
          h('ol', { style: { paddingLeft: 20, margin: '4px 0 0' } },
            snapshot.stages.map((stage, index) => h('li', { key: index }, stage))))
        }
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register({ name: 'conversation.input.dock', id: 'pelican-router-workflow', order: -20 }, WorkflowCard))
      },
    }
  },
})
