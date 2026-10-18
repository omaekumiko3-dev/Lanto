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
                autoFocus
                aria-label="Resolution"
                aria-describedby="resolution-hint"
                value={draft.resolution}
                onChange={(event) =>
                  setDraft({ ...draft, resolution: event.target.value as Settings['resolution'] })
                }
              >
                <option value="3840x2160">4K · 3840 × 2160</option>
                <option value="2560x1440">2K · 2560 × 1440</option>
                <option value="1920x1080">1080p · 1920 × 1080</option>
              </select>
              <small id="resolution-hint">
                Default stream size. Override it in Edit device to match each remote desktop.
              </small>
            </label>
            <label>
              Frame rate
              <select
                aria-label="Frame rate"
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
                aria-label="Bitrate (Mbps)"
                aria-describedby="bitrate-hint"
                required
                min={5}
                max={150}
                value={draft.bitrateMbps}
                onChange={(event) =>
                  setDraft({ ...draft, bitrateMbps: Number(event.target.value) })
                }
              />
              <small id="bitrate-hint">
                Higher values preserve more detail and use more bandwidth.
              </small>
            </label>
            <label>
              Window mode
              <select
                aria-label="Window mode"
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
              Cursor display
              <select
                aria-label="Cursor display"
                value={String(draft.localCursor)}
                onChange={(event) =>
                  setDraft({ ...draft, localCursor: event.target.value === 'true' })
                }
              >
                <option value="false">Remote cursor</option>
                <option value="true">Local cursor</option>
              </select>
              <small>
                The local cursor is supported on the configured Mac; Linux and Windows use the
                remote cursor automatically.
              </small>
            </label>
            <label>
              Latency policy
              <select
                aria-label="Latency policy"
                value={String(draft.lowLatency)}
                onChange={(event) =>
                  setDraft({ ...draft, lowLatency: event.target.value === 'true' })
                }
              >
                <option value="false">Default</option>
                <option value="true">Prioritize response</option>
              </select>
              <small>Prioritize response disables VSync and may cause tearing.</small>
            </label>
          </div>
          <label>
            Switch shortcut
            <input
              required
              aria-label="Switch shortcut"
              maxLength={80}
              value={draft.returnShortcut}
              onChange={(event) => setDraft({ ...draft, returnShortcut: event.target.value })}
              spellCheck={false}
            />
            <small>
              Ctrl + ` uses the key above Tab. Press again to return to the connected desktop. The
              connection stays active. Display settings apply on the next connection.
            </small>
          </label>
          <label>
            Switch only with shortcut
            <select
              aria-label="Switch only with shortcut"
              value={String(draft.lockInput)}
              onChange={(event) => setDraft({ ...draft, lockInput: event.target.value === 'true' })}
            >
              <option value="true">On (recommended)</option>
              <option value="false">Off</option>
            </select>
            <small>
              On Windows, hides the remote window in local mode and locks the mouse in remote mode.
              Other shortcuts go to the active system. The connection stays active.
            </small>
          </label>
          <details className="advanced-settings">
            <summary>Advanced settings</summary>
            <div className="advanced-body">
              <label>
                Moonlight executable
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
                    aria-label="Windows graphics pipeline"
                    value={draft.windowsPipeline}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        windowsPipeline: event.target.value as Settings['windowsPipeline']
                      })
                    }
                  >
                    <option value="auto">Auto</option>
                    <option value="shared-bind">Shared device and textures (experimental)</option>
                  </select>
                </label>
                <p className="settings-footnote">
                  Audio plays on both the target and this computer. Device card volume and mute
                  affect only local playback.
                </p>
              </div>
              <p className="settings-footnote">
                Shared textures may affect compatibility with some GPUs or VRR. Changes apply on the
                next connection.
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
                  Configure host
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
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}
