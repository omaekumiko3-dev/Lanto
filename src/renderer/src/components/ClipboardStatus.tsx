import type { ClipboardView } from '../../../protocol/clipboard.ts'

function bytes(value: string): string {
  let amount = Number(value)
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit++
  }
  return `${amount.toFixed(unit ? 1 : 0)} ${units[unit]}`
}
export function ClipboardStatus({
  state,
  settings,
  cancel,
  openFiles
}: {
  state: ClipboardView
  settings: () => void
  cancel: () => void
  openFiles: () => void
}) {
  if (!state.enabled) return null
  const active = state.transfers.some((value) => value.phase === 'transferring')
  const ready = state.peers.filter((peer) => peer.ready).length
  return (
    <section className="clipboard-status" aria-label="Shared clipboard status">
      <div className="clipboard-heading">
        <button className="text-button" onClick={settings}>
          Shared Clipboard · {ready} / {state.peers.length} devices online
        </button>
        <div>
          {state.files && (
            <button className="text-button" onClick={openFiles}>
              Received files
            </button>
          )}
          {active && (
            <button className="text-button" onClick={cancel}>
              Cancel transfer
            </button>
          )}
        </div>
      </div>
      {state.error && (
        <p className="clipboard-error" role="status">
          {state.error}
        </p>
      )}
      {state.peers
        .filter((peer) => peer.error)
        .map((peer) => (
          <p key={peer.id} className="clipboard-error">
            {peer.name}：{peer.error}
          </p>
        ))}
      {state.transfers.slice(-6).map((transfer) => (
        <div className="clipboard-transfer" key={transfer.id}>
          <div>
            <span>{transfer.device}</span>
            <span>
              {transfer.phase === 'complete'
                ? 'Ready to paste'
                : transfer.phase === 'cancelled'
                  ? 'Canceled'
                  : transfer.phase === 'failed'
                    ? transfer.error || 'Transfer failed'
                    : `${bytes(transfer.bytes)} / ${bytes(transfer.total)}`}
            </span>
          </div>
          {transfer.phase === 'transferring' && (
            <progress
              aria-label={`Send to ${transfer.device}`}
              max={Number(transfer.total) || 1}
              value={Number(transfer.bytes)}
            />
          )}
        </div>
      ))}
    </section>
  )
}
