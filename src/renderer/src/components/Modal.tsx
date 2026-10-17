import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { Icon } from '../Icon.tsx'

export function Modal({
  title,
  notice,
  close,
  children,
  busy
}: {
  title: string
  notice?: ReactNode
  close: () => void
  children: ReactNode
  busy: boolean
}) {
  const returnFocus = useRef(document.activeElement)
  const dialogRef = useRef<HTMLElement>(null)
  useEffect(
    () => () => {
      if (returnFocus.current instanceof HTMLElement && returnFocus.current.isConnected)
        returnFocus.current.focus()
    },
    []
  )
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // The native, styled select owns Escape and navigation while its picker is open.
      if (event.defaultPrevented || document.querySelector('select:open')) return
      if (event.key === 'Escape' && !busy) close()
      if (event.key !== 'Tab') return
      const dialog = dialogRef.current
      const items = Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]'
        ) || []
      ).filter((item) => item.getClientRects().length > 0)
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
      <section
        ref={dialogRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dialog-title"
      >
        <header className="modal-header">
          <div>
            <h2 id="dialog-title">{title}</h2>
          </div>
          <button className="icon-button" disabled={busy} aria-label="Close Dialog" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        {notice && <div className="dialog-notice">{notice}</div>}
        {children}
      </section>
    </div>
  )
}
