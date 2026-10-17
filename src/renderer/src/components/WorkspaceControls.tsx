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
          aria-label="Share Clipboard"
          aria-checked={settings.shareClipboard}
          disabled={busy}
          className="quick-switch"
          title="Share newly copied content across all paired devices that are online"
          onClick={() => save({ ...settings, shareClipboard: !settings.shareClipboard })}
        >
          <Icon name="clipboard" size={15} />
          <span>Share Clipboard</span>
          <span className="quick-switch-track">
            <span />
          </span>
        </button>
        <button
          type="button"
          className="clipboard-menu-trigger"
          popoverTarget="clipboard-options"
          aria-label="Clipboard Options"
          aria-expanded={open}
          aria-controls="clipboard-options"
          title="File sharing and transfer"
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
        aria-label="Show Performance Data"
        aria-checked={settings.showPerformanceOverlay}
        disabled={busy}
        className="quick-switch performance-switch"
        title="Takes effect the next time you connect; toggle it for the current display with Ctrl + Alt + Shift + S"
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
            <strong>Share Files</strong>
            <small>Files and folders are transferred automatically and can be pasted when complete.</small>
          </div>
          <button
            type="button"
            role="switch"
            aria-label="Share Files"
            aria-checked={settings.shareFiles}
            disabled={busy || !settings.shareClipboard}
            className="connection-switch"
            onClick={() => save({ ...settings, shareFiles: !settings.shareFiles })}
          >
            <span className="switch-thumb" />
          </button>
        </div>
        {!settings.shareClipboard && (
          <p className="settings-footnote">With shared clipboard enabled, text, images, and files can be synced.</p>
        )}
        <ClipboardStatus state={clipboard} cancel={cancel} openFiles={openFiles} />
        <p className="popover-hint">No file size limit; limited by available disk space.</p>
      </section>
    </div>
  )
}
