import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../Icon.tsx'

export function Modal({
  title,
  eyebrow,
  close,
  children,
  busy
}: {
  title: string
  eyebrow: string
  close: () => void
  children: ReactNode
  busy: boolean
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) close()
      if (event.key !== 'Tab') return
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
      const items = dialog?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]'
      )
      if (!items?.length) return
      const first = items[0]!
      const last = items[items.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, close])
  return (
    <div className="modal-backdrop">
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <header className="modal-header">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h2 id="dialog-title">{title}</h2>
          </div>
          <button className="icon-button" disabled={busy} aria-label="Close Dialog" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}
