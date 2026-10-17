import type { ReactNode } from 'react'
import { useState } from 'react'
import type { FormEvent } from 'react'
import type { Device, DeviceInput } from '../../../shared/model.ts'
import { Icon } from '../Icon.tsx'
import { Modal } from './Modal.tsx'

export function DeviceDialog({
  notice,
  device,
  active,
  busy,
  close,
  save,
  remove
}: {
  notice?: ReactNode
  device: DeviceInput
  active: boolean
  busy: boolean
  close: () => void
  save: (device: DeviceInput) => Promise<void>
  remove?: () => Promise<void>
}) {
  const [draft, setDraft] = useState(device)
  const [confirmRemove, setConfirmRemove] = useState(false)
  function submit(event: FormEvent) {
    event.preventDefault()
    void save(draft)
  }
  return (
    <Modal
      notice={notice}
      title={device.id ? 'Edit device' : 'Add device'}
      close={close}
      busy={busy}
    >
      <form onSubmit={submit}>
        <div className="form-body">
          <label>
            Device name
            <input
              autoFocus
              required
              maxLength={50}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="e.g. Linux1"
            />
          </label>
          <div className="form-columns">
            <label>
              Operating system
              <select
                aria-label="Operating system"
                value={draft.platform}
                disabled={Boolean(device.hostId)}
                onChange={(event) =>
                  setDraft({ ...draft, platform: event.target.value as Device['platform'] })
                }
              >
                <option value="linux">Linux</option>
                <option value="macos">macOS</option>
                <option value="windows">Windows</option>
              </select>
            </label>
            <label>
              IP address or hostname
              <input
                required={Boolean(device.hostId)}
                value={draft.host}
                onChange={(event) => setDraft({ ...draft, host: event.target.value })}
                placeholder="e.g. 192.168.1.20"
                maxLength={253}
                spellCheck={false}
              />
            </label>
          </div>
          <label>
            Sunshine application name
            <input
              required
              maxLength={120}
              value={draft.appName}
              onChange={(event) => setDraft({ ...draft, appName: event.target.value })}
              placeholder="Desktop"
            />
            <small>Must match the name shown in Moonlight, usually Desktop.</small>
          </label>
          <div className="form-note">
            <Icon name="link" size={17} />
            <span>
              {active
                ? 'The name updates immediately; connection settings apply on the next connection.'
                : device.hostId
                  ? 'Address changes preserve pairing and apply on the next connection.'
                  : 'You can enter the address later. Before the first connection, add and pair this host in Moonlight.'}
            </span>
          </div>
        </div>
        <footer className="modal-footer">
          {remove && (
            <button
              className={`text-button danger ${confirmRemove ? 'confirm' : ''}`}
              type="button"
              disabled={busy || active}
              title={active ? 'Turn off the connection before removing the device' : undefined}
              onClick={() => (confirmRemove ? void remove() : setConfirmRemove(true))}
            >
              {confirmRemove ? 'Confirm device removal' : 'Remove device'}
            </button>
          )}
          <div className="footer-spacer" />
          <button className="button secondary" type="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save device'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
