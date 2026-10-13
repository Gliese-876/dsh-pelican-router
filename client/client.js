// Harness client factory. Its state lives in the UI and never becomes model context.
window.__ModuleLoader__.load({
  id: 'dsh-pelican-router',
  factory(require) {
    const { createElement: h, useEffect, useRef, useState } = require('react')
    const { createPortal } = require('react-dom')
    return {
      inject: ['slots', 'connection'],
      apply(ctx) {
        function WorkflowWindow({ sessionId }) {
          const [snapshot, setSnapshot] = useState(null)
          const [minimized, setMinimized] = useState(false)
          const [position, setPosition] = useState(null)
          const panel = useRef(null)
          const drag = useRef(null)
          function constrain(left, top) {
            const rect = panel.current?.getBoundingClientRect()
            return {
              left: Math.max(8, Math.min(left, window.innerWidth - (rect?.width ?? 280) - 8)),
              top: Math.max(8, Math.min(top, window.innerHeight - (rect?.height ?? 40) - 8)),
            }
          }
          function keepInView() {
            setPosition(value => value ? constrain(value.left, value.top) : value)
          }
          function endDrag(event) {
            if (drag.current?.id === event.pointerId) drag.current = null
          }
          useEffect(() => {
            keepInView()
            window.addEventListener('resize', keepInView)
            return () => window.removeEventListener('resize', keepInView)
          }, [snapshot, minimized])
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
            ref: panel,
            'aria-label': 'Pelican Router 模型状态',
            style: {
              position: 'fixed', ...(position ?? { right: 16, bottom: 16 }), zIndex: 40,
              width: minimized ? 220 : 280, maxWidth: 'calc(100vw - 32px)', boxSizing: 'border-box',
              maxHeight: 'calc(100vh - 32px)', overflowY: 'auto',
              padding: '10px 12px', borderRadius: 12, border: '1px solid var(--dsw-alias-border-l2-darkmode-thin, #8885)',
              background: 'var(--dsw-specific-input-major, Canvas)', color: 'var(--dsw-alias-label-primary, CanvasText)',
              boxShadow: '0 4px 20px #0002', fontSize: 12, lineHeight: 1.6, overflowWrap: 'anywhere',
            },
          }, h('div', {
            title: '拖动标题栏移动窗口',
            style: { display: 'flex', alignItems: 'center', gap: 8, cursor: 'grab', touchAction: 'none', userSelect: 'none' },
            onPointerDown(event) {
              if (event.button !== 0 || event.target.closest('button')) return
              const rect = panel.current.getBoundingClientRect()
              drag.current = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top }
              event.currentTarget.setPointerCapture(event.pointerId)
              setPosition(constrain(rect.left, rect.top))
              event.preventDefault()
            },
            onPointerMove(event) {
              if (drag.current?.id === event.pointerId) {
                setPosition(constrain(event.clientX - drag.current.x, event.clientY - drag.current.y))
              }
            },
            onPointerUp: endDrag, onPointerCancel: endDrag, onLostPointerCapture: endDrag,
          },
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
            h('details', { onToggle: keepInView, style: { marginTop: 6 } },
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
