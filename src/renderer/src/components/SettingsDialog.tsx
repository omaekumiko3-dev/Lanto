import { useState } from 'react'
import type { Settings } from '../../../shared/model.ts'
import { Icon } from '../Icon.tsx'
import { errorText } from '../format.ts'
import { Modal } from './Modal.tsx'

export function SettingsDialog({
  settings,
  busy,
  configDirectory,
  close,
  choose,
  save
}: {
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
    <Modal title="Client Settings" eyebrow="MAKE IT YOURS" close={close} busy={busy || choosing}>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void save(draft)
        }}
      >
        <div className="form-body">
          <label>
            Moonlight Executable
            <div className="file-input">
              <input
                value={draft.moonlightPath}
                onChange={(event) => setDraft({ ...draft, moonlightPath: event.target.value })}
                placeholder="Leave blank to find the install location automatically"
                spellCheck={false}
              />
              <button
                type="button"
                className="button secondary"
                disabled={busy || choosing}
                onClick={() => void pick()}
              >
                <Icon name="folder" size={17} />
                Select
              </button>
            </div>
            <small>On Windows, select Moonlight.exe; on macOS, select the executable inside the .app.</small>
          </label>
          {pickerError && (
            <p className="form-error" role="alert">
              {pickerError}
            </p>
          )}
          <label>
            Shortcut to return to this machine
            <input
              autoFocus
              required
              value={draft.returnShortcut}
              onChange={(event) => setDraft({ ...draft, returnShortcut: event.target.value })}
              placeholder="Control+Alt+F12"
              maxLength={80}
              spellCheck={false}
            />
            <small>For example, Control+Alt+F12. The shortcut is checked for registration when saved.</small>
          </label>
          <div className="form-divider" />
          <h3>Remote Screen</h3>
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
                <option value={30}>30 FPS</option>
                <option value={60}>60 FPS</option>
                <option value={15}>15 FPS</option>
              </select>
            </label>
          </div>
          <div className="form-columns">
            <label>
              Bitrate (Mbps)
              <input
                required
                type="number"
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
          <p className="settings-footnote">
            Prioritize Responsiveness disables vertical sync and frame pacing, which may cause screen tearing; frame rate can be adjusted independently.
          </p>
          <div className="form-columns">
            <label>
              Latency strategy
              <select
                value={String(draft.lowLatency)}
                onChange={(event) =>
                  setDraft({ ...draft, lowLatency: event.target.value === 'true' })
                }
              >
                <option value="false">Follow Moonlight settings</option>
                <option value="true">Prioritize responsiveness</option>
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
            Screen settings take effect on the next connection. Configuration is saved locally:<span>{configDirectory}</span>
          </p>
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
