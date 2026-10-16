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
              <small>The local cursor requires a companion native component and is currently a fixed arrow.</small>
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
            Shortcut to return to this machine
            <input
              autoFocus
              required
              maxLength={80}
              value={draft.returnShortcut}
              onChange={(event) => setDraft({ ...draft, returnShortcut: event.target.value })}
              spellCheck={false}
            />
            <small>Disconnect the remote screen and return. The connection stays active when switching with Alt + Tab.</small>
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
                <label>
                  Performance Statistics
                  <select
                    value={String(draft.showPerformanceOverlay)}
                    onChange={(event) =>
                      setDraft({ ...draft, showPerformanceOverlay: event.target.value === 'true' })
                    }
                  >
                    <option value="false">Hide</option>
                    <option value="true">Show</option>
                  </select>
                </label>
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
