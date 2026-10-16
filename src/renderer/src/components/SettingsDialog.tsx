import type { ReactNode } from 'react'
import { useState } from 'react'
import type { Settings } from '../../../shared/model.ts'
import { Icon } from '../Icon.tsx'
import { errorText } from '../format.ts'
import { Modal } from './Modal.tsx'

export function SettingsDialog({
  notice,
  settings,
  busy,
  configDirectory,
  close,
  choose,
  save
}: {
  notice?: ReactNode
  settings: Settings
  busy: boolean
  configDirectory: string
  close: () => void
  choose: () => Promise<string | null>
  save: (settings: Settings) => Promise<void>
}) {
  const [draft, setDraft] = useState(settings)
  const [pickerError, setPickerError] = useState('')
  const [choosing, setChoosing] = useState(false)
  async function pick() {
    setChoosing(true)
    setPickerError('')
    try {
      const path = await choose()
      if (path) setDraft((previous) => ({ ...previous, moonlightPath: path }))
    } catch (error) {
      setPickerError(errorText(error))
    } finally {
      setChoosing(false)
    }
  }
  return (
    <Modal notice={notice} title="Settings" close={close} busy={busy || choosing}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save(draft)
        }}
      >
        <div className="form-body">
          <div className="setting-switch-row">
            <div>
              <strong>Show Performance Data</strong>
              <small>
                Show data such as frame rate and latency in the upper left corner of the remote screen. Changes take effect on the next connection after saving; during streaming, press Ctrl + Alt +
                Shift + S to toggle temporarily.
              </small>
            </div>
            <button
              type="button"
              role="switch"
              aria-label="Show Performance Data"
              autoFocus
              aria-checked={draft.showPerformanceOverlay}
              className="connection-switch"
              onClick={() =>
                setDraft({ ...draft, showPerformanceOverlay: !draft.showPerformanceOverlay })
              }
            >
              <span className="switch-thumb" />
            </button>
          </div>
          <div className="sharing-settings">
            <div className="setting-switch-row">
              <div>
                <strong>Share Clipboard</strong>
                <small>Sync text and images between this machine and all paired devices that are online.</small>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Share Clipboard"
                aria-checked={draft.shareClipboard}
                className="connection-switch"
                onClick={() => setDraft({ ...draft, shareClipboard: !draft.shareClipboard })}
              >
                <span className="switch-thumb" />
              </button>
            </div>
            <div className="setting-switch-row">
              <div>
                <strong>Share Files</strong>
                <small>
                  Files and folders are transferred automatically after being copied and can be pasted on other devices when complete. There is no file size limit; disk space limits still apply.
                </small>
              </div>
              <button
                type="button"
                role="switch"
                aria-label="Share Files"
                aria-checked={draft.shareFiles}
                disabled={!draft.shareClipboard}
                className="connection-switch"
                onClick={() => setDraft({ ...draft, shareFiles: !draft.shareFiles })}
              >
                <span className="switch-thumb" />
              </button>
            </div>
            <small>Sync content copied after enabling this setting. Lanto only needs to remain running; there is no need to connect to a remote screen.</small>
          </div>
          <div className="form-columns">
            <label>
              Resolution
              <select
                value={draft.resolution}
                onChange={(event) =>
                  setDraft({ ...draft, resolution: event.target.value as Settings['resolution'] })
                }
              >
                <option value="2560x1440">2K · 2560 × 1440</option>
                <option value="1920x1080">1080p · 1920 × 1080</option>
              </select>
            </label>
            <label>
              Frame rate
              <select
                value={draft.fps}
                onChange={(event) => setDraft({ ...draft, fps: Number(event.target.value) })}
              >
                <option value={60}>60 FPS</option>
                <option value={30}>30 FPS</option>
                <option value={15}>15 FPS</option>
              </select>
            </label>
          </div>
          <div className="form-columns">
            <label>
              Bitrate (Mbps)
              <input
                type="number"
                required
                min={5}
                max={100}
                value={draft.bitrateMbps}
                onChange={(event) =>
                  setDraft({ ...draft, bitrateMbps: Number(event.target.value) })
                }
              />
            </label>
            <label>
              Window mode
              <select
                value={draft.windowMode}
                onChange={(event) =>
                  setDraft({ ...draft, windowMode: event.target.value as Settings['windowMode'] })
                }
              >
                <option value="borderless">Borderless fullscreen</option>
                <option value="windowed">Window mode</option>
              </select>
            </label>
          </div>
          <div className="form-columns">
            <label>
              Show Cursor
              <select
                value={String(draft.localCursor)}
                onChange={(event) =>
                  setDraft({ ...draft, localCursor: event.target.value === 'true' })
                }
              >
                <option value="false">Remote cursor</option>
                <option value="true">Local cursor</option>
              </select>
              <small>Local cursor is for the companion Mac; Linux and Windows use the remote cursor automatically.</small>
            </label>
            <label>
              Latency strategy
              <select
                value={String(draft.lowLatency)}
                onChange={(event) =>
                  setDraft({ ...draft, lowLatency: event.target.value === 'true' })
                }
              >
                <option value="false">Default</option>
                <option value="true">Prioritize responsiveness</option>
              </select>
              <small>Prioritizing responsiveness disables vertical sync and may cause tearing.</small>
            </label>
          </div>
          <label>
            Disconnect Hotkey
            <input
              required
              maxLength={80}
              value={draft.returnShortcut}
              onChange={(event) => setDraft({ ...draft, returnShortcut: event.target.value })}
              spellCheck={false}
            />
            <small>Keep the connection when switching windows with Alt + Tab. Display settings take effect the next time you connect.</small>
          </label>
          <details className="advanced-settings">
            <summary>Advanced Settings</summary>
            <div className="advanced-body">
              <label>
                Moonlight Executable
                <div className="file-input">
                  <input
                    value={draft.moonlightPath}
                    onChange={(event) => setDraft({ ...draft, moonlightPath: event.target.value })}
                    placeholder="Find automatically"
                    spellCheck={false}
                  />
                  <button
                    type="button"
                    className="button secondary"
                    disabled={busy || choosing}
                    onClick={() => void pick()}
                  >
                    <Icon name="folder" size={16} />
                    Select
                  </button>
                </div>
              </label>
              {pickerError && (
                <p className="form-error" role="alert">
                  {pickerError}
                </p>
              )}
              <div className="form-columns">
                <label>
                  Windows graphics pipeline
                  <select
                    value={draft.windowsPipeline}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        windowsPipeline: event.target.value as Settings['windowsPipeline']
                      })
                    }
                  >
                    <option value="auto">Automatic</option>
                    <option value="shared-bind">Shared device and textures (experimental)</option>
                  </select>
                </label>
                <p className="settings-footnote">
                  Audio plays on both the target machine and this device. Volume and mute on the device card affect this device only.
                </p>
              </div>
              <p className="settings-footnote">
                Shared textures may affect compatibility with some graphics cards or VRR. Settings take effect the next time you connect.
                <span>{configDirectory}</span>
              </p>
              <div className="settings-help">
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    void window.lanto
                      .openHelp('moonlight')
                      .catch((error: unknown) => setPickerError(errorText(error)))
                  }
                >
                  Download client
                  <Icon name="external" size={12} />
                </button>
                <button
                  type="button"
                  className="text-button"
                  onClick={() =>
                    void window.lanto
                      .openHelp('sunshine')
                      .catch((error: unknown) => setPickerError(errorText(error)))
                  }
                >
                  Configure controlled device
                  <Icon name="external" size={12} />
                </button>
              </div>
            </div>
          </details>
        </div>
        <footer className="modal-footer">
          <div className="footer-spacer" />
          <button
            type="button"
            className="button secondary"
            onClick={close}
            disabled={busy || choosing}
          >
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={busy || choosing}>
            {busy ? 'Saving…' : 'Save Settings'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
