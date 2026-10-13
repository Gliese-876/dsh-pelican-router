// Harness client factory. Its state lives in the UI and never becomes model context.
window.__ModuleLoader__.load({
  id: 'dsh-pelican-router',
  factory(require) {
    const { createElement: h, useEffect, useState } = require('react')
    const { createPortal } = require('react-dom')
    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        function WorkflowWindow({ sessionId }) {
          const [snapshot, setSnapshot] = useState(null)
          const [minimized, setMinimized] = useState(false)
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
            setMinimized(false)
            refresh()
            return () => { abort.abort(); clearTimeout(timer) }
          }, [sessionId])
          if (!snapshot) return null
          const current = snapshot.stages.at(-1)
          const route = snapshot.stages.find(stage => stage.startsWith('已路由至'))
            ?? snapshot.stages.find(stage => stage.includes('继续由原模型'))
          const status = { running: '进行中', complete: '已完成', error: '异常' }[snapshot.status]
          return createPortal(h('aside', {
            'aria-label': 'Pelican Router 模型状态',
            style: {
              position: 'fixed', right: 16, bottom: 16, zIndex: 40,
              width: minimized ? 220 : 280, maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box',
              padding: '10px 12px', borderRadius: 12, border: '1px solid var(--dsw-alias-border-l2-darkmode-thin, #8885)',
              background: 'var(--dsw-specific-input-major, Canvas)', color: 'var(--dsw-alias-label-primary, CanvasText)',
              boxShadow: '0 4px 20px #0002', fontSize: 12, lineHeight: 1.6, overflowWrap: 'anywhere',
            },
          }, h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
            h('strong', { style: { flex: 1 } }, 'Pelican Router'),
            h('span', { style: { fontSize: 11, color: snapshot.status === 'error' ? '#d74444' : 'inherit' } }, status),
            h('button', {
              type: 'button', 'aria-label': minimized ? '展开模型状态' : '收起模型状态', 'aria-expanded': !minimized,
              onClick: () => setMinimized(value => !value),
              style: { padding: '2px 4px', border: 0, background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' },
            }, minimized ? '展开' : '收起')),
          !minimized && h('div', null,
            h('div', { role: 'status', 'aria-live': 'polite', style: { marginTop: 6 } }, current),
            route && route !== current && h('div', { style: { marginTop: 4, opacity: 0.75 } }, route),
            h('details', { style: { marginTop: 6 } },
              h('summary', { style: { cursor: 'pointer', opacity: 0.75 } }, '流程详情'),
              h('ol', { style: { paddingLeft: 18, margin: '6px 0 0', maxHeight: 'min(160px, 35vh)', overflowY: 'auto' } },
                snapshot.stages.map((stage, index) => h('li', { key: index }, stage)))))), document.body)
        }
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register({ name: 'conversation.input.dock', id: 'pelican-router-workflow', order: -20 }, WorkflowWindow))
      },
    }
  },
})
