import { useState } from 'react'
import type { Settings } from '../../../shared/model.ts'
import type { ClipboardView } from '../../../protocol/clipboard.ts'
import { Icon } from '../Icon.tsx'
import { ClipboardStatus } from './ClipboardStatus.tsx'

export function WorkspaceControls({
  settings,
  clipboard,
  busy,
  save,
  cancel,
  openFiles
}: {
  settings: Settings
  clipboard: ClipboardView
  busy: boolean
  save: (settings: Settings) => void
  cancel: () => void
  openFiles: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="workspace-controls" aria-label="Quick settings">
      <div className="clipboard-control">
        <button
          type="button"
          role="switch"
          aria-label="Shared clipboard"
          aria-checked={settings.shareClipboard}
          disabled={busy}
          className="quick-switch"
          title="Share newly copied content with all paired online devices"
          onClick={() => save({ ...settings, shareClipboard: !settings.shareClipboard })}
        >
          <Icon name="clipboard" size={15} />
          <span>Shared clipboard</span>
          <span className="quick-switch-track">
            <span />
          </span>
        </button>
        <button
          type="button"
          className="clipboard-menu-trigger"
          popoverTarget="clipboard-options"
          aria-label="Clipboard options"
          aria-expanded={open}
          aria-controls="clipboard-options"
          title="File sharing and transfers"
        >
          <Icon name="chevron" size={13} />
          {clipboard.transfers.some((transfer) => transfer.phase === 'transferring') && (
            <span className="transfer-indicator" />
          )}
        </button>
      </div>
      <button
        type="button"
        role="switch"
        aria-label="Show performance data"
        aria-checked={settings.showPerformanceOverlay}
        disabled={busy}
        className="quick-switch performance-switch"
        title="Applies on the next connection; toggle in the current display with Ctrl + Alt + Shift + S"
        onClick={() =>
          save({ ...settings, showPerformanceOverlay: !settings.showPerformanceOverlay })
        }
      >
        <Icon name="activity" size={15} />
        <span>Performance data</span>
        <span className="quick-switch-track">
          <span />
        </span>
      </button>
      <section
        id="clipboard-options"
        className="clipboard-popover"
        popover="auto"
        role="dialog"
        aria-labelledby="clipboard-options-title"
        onToggle={(event) => setOpen(event.currentTarget.matches(':popover-open'))}
      >
        <header className="popover-heading">
          <h3 id="clipboard-options-title">Clipboard</h3>
          <button
            type="button"
            className="icon-button"
            popoverTarget="clipboard-options"
            popoverTargetAction="hide"
            aria-label="Close clipboard options"
          >
            <Icon name="close" size={15} />
          </button>
        </header>
        <div className="setting-switch-row">
          <div>
            <strong>Share files</strong>
            <small>Files and folders transfer automatically and can be pasted when complete.</small>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Share files"
            aria-checked={settings.shareFiles}
            disabled={busy || !settings.shareClipboard}
            className="connection-switch"
            onClick={() => save({ ...settings, shareFiles: !settings.shareFiles })}
          >
            <span className="switch-thumb" />
          </button>
        </div>
        {!settings.shareClipboard && (
          <p className="settings-footnote">
            Enable the shared clipboard to synchronize text, images, and files.
          </p>
        )}
        <ClipboardStatus state={clipboard} cancel={cancel} openFiles={openFiles} />
        <p className="popover-hint">No fixed file size limit; available disk space is the limit.</p>
      </section>
    </div>
  )
}
