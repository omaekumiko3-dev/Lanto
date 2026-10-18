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
              {draft.tunnel ? 'Tunnel endpoint' : 'IP address or hostname'}
              <input
                required={Boolean(device.hostId)}
                value={draft.tunnel?.address || draft.host}
                onChange={(event) =>
                  setDraft(
                    draft.tunnel
                      ? { ...draft, tunnel: { ...draft.tunnel, address: event.target.value } }
                      : { ...draft, host: event.target.value }
                  )
                }
                placeholder="e.g. 192.168.1.20"
                maxLength={253}
                spellCheck={false}
              />
            </label>
          </div>
          <label>
            Stream resolution
            <select
              aria-label="Stream resolution"
              aria-describedby="device-resolution-hint"
              value={draft.resolution ?? ''}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  resolution: (event.target.value || undefined) as Device['resolution']
                })
              }
            >
              <option value="">Use global setting</option>
              <option value="3840x2160">4K · 3840 × 2160</option>
              <option value="2560x1440">2K · 2560 × 1440</option>
              <option value="1920x1080">1080p · 1920 × 1080</option>
            </select>
            <small id="device-resolution-hint">
              Match this device's desktop resolution. Applies on the next connection; host display
              changes are managed separately in Sunshine.
            </small>
          </label>
          {draft.tunnel && (
            <label>
              Tunnel UDP port
              <input
                required
                type="number"
                min={1}
                max={65535}
                value={draft.tunnel.port}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    tunnel: { ...draft.tunnel!, port: Number(event.target.value) }
                  })
                }
              />
              <small>
                Encrypted device-to-device connection with no account or relay. The endpoint must be
                directly reachable; a router mapping forwards this UDP port to 48200 on the target.
              </small>
            </label>
          )}
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
