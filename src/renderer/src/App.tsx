import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { AppState, Device, DeviceInput, ProbeResult, Settings } from '../../shared/model.ts'
import { Icon } from './Icon.tsx'

const platformNames = { linux: 'Linux', macos: 'macOS', windows: 'Windows' }
const phaseNames = {
  idle: 'Waiting to connect',
  launching: 'Starting',
  running: 'Client started',
  stopping: 'Returning to this machine',
  failed: 'Needs attention'
}
const api = window.lanto

function shortcutLabel(value: string) {
  return value.replace(/CommandOrControl|Control/g, 'Ctrl').replace(/\+/g, ' + ')
}
function errorText(error: unknown) {
  return error instanceof Error ? error.message : 'Operation incomplete. Try again'
}

export function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [editing, setEditing] = useState<DeviceInput | null>(null)
  const [probes, setProbes] = useState<Record<string, ProbeResult>>({})

  useEffect(() => {
    if (!api) {
      setNotice('Start Lanto through Electron: npm run dev')
      return
    }
    const unsubscribe = api.onState(setState)
    void api
      .getState()
      .then(setState)
      .catch((error: unknown) => setNotice(errorText(error)))
    return unsubscribe
  }, [])

  async function run(action: string, work: () => Promise<unknown>): Promise<boolean> {
    setBusy(action)
    setNotice('')
    try {
      await work()
      return true
    } catch (error) {
      setNotice(errorText(error))
      return false
    } finally {
      setBusy('')
    }
  }

  if (!state)
    return (
      <div className="loading">
        <div className="brand-mark">L</div>
        <h1>Lanto</h1>
        <p>{notice || 'Opening the local workspace…'}</p>
      </div>
    )

  const selected =
    state.config.devices.find((device) => device.id === selectedId) || state.config.devices[0]
  const { settings } = state.config
  const active = state.session.pid !== null || state.session.phase === 'launching'
  const selectedActive = selected?.id === state.session.deviceId
  const phase = selectedActive ? state.session.phase : 'idle'
  const configured = state.config.devices.filter((device) => device.host).length

  function newDevice() {
    setEditing({ name: '', host: '', platform: 'linux', appName: 'Desktop' })
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">L</div>
          <div>
            Lanto<span>LOCAL. CONNECTED.</span>
          </div>
        </div>
        <div className="nav-label">Workspace</div>
        <nav aria-label="Main navigation">
          <button className="nav-button active" onClick={() => setSettingsOpen(false)}>
            <Icon name="grid" />
            Workbench
            <span className="nav-dot" />
          </button>
          <button className="nav-button" onClick={() => setSettingsOpen(true)}>
            <Icon name="settings" />
            Settings
          </button>
        </nav>
        <div className="device-nav-title">
          <span className="nav-label">My Devices</span>
          <button className="icon-button" title="Add Device" onClick={newDevice}>
            <Icon name="plus" size={16} />
          </button>
        </div>
        <div className="device-nav">
          {state.config.devices.map((device) => (
            <button
              key={device.id}
              className={`device-nav-item ${selected?.id === device.id ? 'selected' : ''}`}
              onClick={() => setSelectedId(device.id)}
            >
              <span className={`device-nav-icon ${device.platform}`}>
                <Icon name={device.platform} size={18} />
              </span>
              <span>
                <strong>{device.name}</strong>
                <small>{device.host || 'Waiting for setup'}</small>
              </span>
              {state.session.deviceId === device.id && active && (
                <span className="status-dot cyan" />
              )}
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="local-machine">
            <Icon name="windows" size={20} />
            <div>
              <strong>Local machine</strong>
              <small>
                {state.runtime.platform === 'win32' ? 'Windows · Actions' : 'Current Device · Actions'}
              </small>
            </div>
            <span className="status-dot cyan" />
          </div>
          <div className="version">
            Personal Local Network Workspace <span>v{state.runtime.version}</span>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <span>
            Workspace <span className="slash">/</span> <strong>Workbench</strong>
          </span>
          <span className="local-pill">
            <Icon name="shield" size={14} />
            Direct LAN connection
          </span>
        </header>
        <section className="page-heading">
          <div>
            <div className="eyebrow">YOUR LOCAL WORKSPACE</div>
            <h1>Switch devices; keep working.</h1>
            <p>Pick up your work from another computer here.</p>
          </div>
          <button className="button secondary" onClick={newDevice}>
            <Icon name="plus" size={17} />
            Add Device
          </button>
        </section>

        {notice && (
          <div className={`notice ${settingsOpen || editing ? 'modal-notice' : ''}`} role="alert">
            <span>{notice}</span>
            <button className="icon-button" aria-label="Close Tip" onClick={() => setNotice('')}>
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        {!state.runtime.shortcutRegistered && (
          <div className="notice" role="alert">
            <span>The return shortcut is unavailable. Change the key combination first.</span>
            <button className="text-button" onClick={() => setSettingsOpen(true)}>
              Go to Settings
            </button>
          </div>
        )}

        <div className="section-heading">
          <h2>
            Current desktop{' '}
            <span>
              {configured} / {state.config.devices.length} desktops configured
            </span>
          </h2>
          <span className="subtle">Configure an address, then complete Moonlight pairing</span>
        </div>
        <section className="connection-grid">
          <div className="desktop-stage">
            <div className="stage-top">
              <div className="stage-target">
                <Icon name={selected?.platform || 'monitor'} size={17} />
                <span>{selected?.name || 'Waiting to add a device'}</span>
                {selected && <small>{platformNames[selected.platform]}</small>}
              </div>
              <span className={`status-badge ${phase === 'running' ? 'connected' : ''}`}>
                <span className="status-dot" />
                {selected?.host ? phaseNames[phase] : 'Waiting for setup'}
              </span>
            </div>
            <div className="stage-center">
              <div className={`desktop-art ${phase === 'running' ? 'is-running' : ''}`}>
                <div className="art-orbit orbit-one" />
                <div className="art-orbit orbit-two" />
                <div className="art-screen">
                  <Icon name={selected?.platform || 'monitor'} size={45} />
                  <span className="screen-line" />
                  <span className="screen-line short" />
                </div>
                <span className="art-node node-one" />
                <span className="art-node node-two" />
                <span className="art-node node-three" />
              </div>
              <h2>
                {phase === 'running'
                  ? 'Continue in Moonlight'
                  : selected
                    ? `Connect your ${selected.name}`
                    : 'Add your first device'}
              </h2>
              <p>
                {phase === 'running'
                  ? 'The desktop has been handed off to a separate client. Use the return shortcut any time to come back to this machine.'
                  : 'The remote desktop opens in a separate window, while the development environment and tasks stay on the remote machine.'}
              </p>
              <div className="stage-actions">
                {selected ? (
                  <>
                    <button
                      className="button primary"
                      disabled={
                        Boolean(busy) ||
                        !selected.host ||
                        !state.runtime.moonlightPath ||
                        !state.runtime.shortcutRegistered ||
                        phase === 'running' ||
                        phase === 'launching' ||
                        phase === 'stopping'
                      }
                      onClick={() => void run('connect', () => api.connect(selected.id))}
                    >
                      <Icon name="arrow" size={18} />
                      {busy === 'connect'
                        ? 'Starting…'
                        : selectedActive && active
                          ? 'Client started'
                          : active
                            ? 'Switch to this device'
                            : 'Open Remote Desktop'}
                    </button>
                    <button
                      className="button quiet"
                      disabled={Boolean(busy) || (selectedActive && active)}
                      onClick={() => setEditing(selected)}
                    >
                      <Icon name="edit" size={16} />
                      Edit device
                    </button>
                  </>
                ) : (
                  <button className="button primary" onClick={newDevice}>
                    <Icon name="plus" size={18} />
                    Add Device
                  </button>
                )}
              </div>
              {selectedActive && state.session.error && (
                <p className="stage-error">{state.session.error}</p>
              )}
            </div>
            <div className="stream-profile">
              <span>
                <Icon name="monitor" size={16} />
                <strong>{settings.resolution === '2560x1440' ? '2K' : '1080p'}</strong> /{' '}
                {settings.fps} FPS
              </span>
              <span>
                <Icon name="signal" size={15} />
                {settings.bitrateMbps} Mbps
              </span>
              <button className="text-button" onClick={() => setSettingsOpen(true)}>
                Adjust screen <Icon name="settings" size={14} />
              </button>
            </div>
          </div>
          <aside className="preparation-card">
            <div className="card-eyebrow">READY TO CONNECT</div>
            <h2>Connection setup</h2>
            <p className="preparation-intro">First connection? Complete these three steps.</p>
            <div className="checklist-item">
              <span className={`step-icon ${state.runtime.moonlightPath ? 'done' : ''}`}>
                {state.runtime.moonlightPath ? <Icon name="check" size={14} /> : '1'}
              </span>
              <div>
                <strong>Install Moonlight on this machine</strong>
                <small>{state.runtime.moonlightPath ? 'Client found' : 'Client not found'}</small>
                <button className="text-button" onClick={() => setSettingsOpen(true)}>
                  {state.runtime.moonlightPath ? 'View client settings' : 'Choose install location'}{' '}
                  <Icon name="arrow" size={13} />
                </button>
              </div>
            </div>
            <div className="checklist-item">
              <span className={`step-icon ${selected?.host ? 'done' : ''}`}>
                {selected?.host ? <Icon name="check" size={14} /> : '2'}
              </span>
              <div>
                <strong>Enter the target device address</strong>
                <small>{selected?.host || 'Use an IP address or LAN hostname'}</small>
                <button
                  className="text-button"
                  onClick={() => (selected ? setEditing(selected) : newDevice())}
                >
                  Edit device <Icon name="arrow" size={13} />
                </button>
              </div>
            </div>
            <div className="checklist-item">
              <span className="step-icon">3</span>
              <div>
                <strong>Pair in Moonlight</strong>
                <small>Sunshine must be started on the target device first</small>
                <button
                  className="text-button"
                  disabled={Boolean(busy) || !state.runtime.moonlightPath || active}
                  onClick={() => void run('pair', () => api.openMoonlight())}
                >
                  Open Pairing Window <Icon name="external" size={12} />
                </button>
              </div>
            </div>
            <div className="return-card">
              <div>
                <Icon name="key" size={16} />
                <strong>Return to This Machine</strong>
              </div>
              <kbd>{shortcutLabel(settings.returnShortcut)}</kbd>
              <small>The initial release will close the local streaming window and return to Lanto.</small>
              <button
                className="button secondary small"
                disabled={Boolean(busy) || (!active && state.session.phase !== 'failed')}
                onClick={() => void run('return', () => api.returnLocal())}
              >
                <Icon name="back" size={15} />
                {busy === 'return' ? 'Returning…' : 'Return to This Machine'}
              </button>
            </div>
          </aside>
        </section>

        <div className="section-heading device-section-heading">
          <h2>
            Device <span>{state.config.devices.length.toString().padStart(2, '0')}</span>
          </h2>
          <span className="subtle">Check the default Sunshine port before connecting</span>
        </div>
        <section className="device-cards" aria-label="Device list">
          {state.config.devices.map((device, index) => (
            <article
              className={`device-card ${selected?.id === device.id ? 'selected-card' : ''}`}
              key={device.id}
            >
              <div className="device-card-top">
                <span className={`platform-icon ${device.platform}`}>
                  <Icon name={device.platform} size={24} />
                </span>
                <span className="device-number">{String(index + 1).padStart(2, '0')}</span>
                <button
                  className="icon-button"
                  aria-label={`Edit ${device.name}`}
                  disabled={Boolean(busy) || (state.session.deviceId === device.id && active)}
                  onClick={() => setEditing(device)}
                >
                  <Icon name="edit" size={16} />
                </button>
              </div>
              <button className="device-name" onClick={() => setSelectedId(device.id)}>
                {device.name}
                <Icon name="arrow" size={16} />
              </button>
              <div className="device-address">
                {device.host || 'Address not set'} <span>{platformNames[device.platform]}</span>
              </div>
              <div className="device-card-footer">
                <span className={`probe-label ${probes[device.id]?.reachable ? 'reachable' : ''}`}>
                  <span className="status-dot" />
                  {!device.host
                    ? 'Waiting for setup'
                    : probes[device.id]
                      ? probes[device.id].reachable
                        ? 'Port reachable'
                        : 'Port unreachable'
                      : 'Not checked'}
                </span>
                <button
                  className="text-button"
                  disabled={Boolean(busy) || !device.host}
                  onClick={() =>
                    void run(`probe:${device.id}`, async () => {
                      const result = await api.probe(device.id)
                      setProbes((previous) => ({ ...previous, [device.id]: result }))
                    })
                  }
                >
                  {busy === `probe:${device.id}` ? 'Checking…' : 'Check port'}
                </button>
              </div>
              {probes[device.id] && <p className="probe-detail">{probes[device.id].message}</p>}
            </article>
          ))}
          {state.config.devices.length === 0 && (
            <button className="empty-device button secondary" onClick={newDevice}>
              <Icon name="plus" />
              Add a Linux, Mac, or Windows device
            </button>
          )}
        </section>

        <section className="activity-panel">
          <div className="section-heading">
            <h2>Recent activity</h2>
            <Icon name="clock" size={16} />
          </div>
          <div className="activity-list">
            {state.activity.slice(0, 4).map((entry) => (
              <div className="activity-row" key={entry.id}>
                <span className={`status-dot ${entry.level === 'error' ? 'error-dot' : ''}`} />
                <p>{entry.message}</p>
                <time>
                  {new Date(entry.timestamp).toLocaleTimeString('zh-CN', { hour12: false })}
                </time>
              </div>
            ))}
          </div>
        </section>
        <footer className="workspace-footer">
          <span>Local gaming · remote development · one keyboard and mouse</span>
          <div>
            <button
              className="text-button"
              onClick={() => void run('help', () => api.openHelp('moonlight'))}
            >
              Download Moonlight <Icon name="external" size={12} />
            </button>
            <span>·</span>
            <button
              className="text-button"
              onClick={() => void run('help', () => api.openHelp('sunshine'))}
            >
              Sunshine documentation <Icon name="external" size={12} />
            </button>
          </div>
        </footer>
      </main>

      {settingsOpen && (
        <SettingsDialog
          settings={settings}
          busy={Boolean(busy)}
          configDirectory={state.runtime.configDirectory}
          close={() => setSettingsOpen(false)}
          choose={() => api.chooseMoonlight()}
          save={async (input) => {
            if (
              await run('settings', async () => {
                setState(await api.saveSettings(input))
              })
            )
              setSettingsOpen(false)
          }}
        />
      )}
      {editing && (
        <DeviceDialog
          device={editing}
          busy={Boolean(busy)}
          close={() => setEditing(null)}
          save={async (input) => {
            if (
              await run('device', async () => {
                const next = await api.saveDevice(input)
                setState(next)
                setSelectedId(input.id || next.config.devices.at(-1)!.id)
                setProbes((previous) => {
                  const copy = { ...previous }
                  if (input.id) delete copy[input.id]
                  return copy
                })
              })
            )
              setEditing(null)
          }}
          remove={
            editing.id
              ? async () => {
                  if (
                    await run('remove', async () => {
                      setState(await api.removeDevice(editing.id!))
                    })
                  )
                    setEditing(null)
                }
              : undefined
          }
        />
      )}
    </div>
  )
}

function Modal({
  title,
  eyebrow,
  close,
  children,
  busy
}: {
  title: string
  eyebrow: string
  close: () => void
  children: ReactNode
  busy: boolean
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) close()
      if (event.key !== 'Tab') return
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]')
      const items = dialog?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]'
      )
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
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <header className="modal-header">
          <div>
            <div className="eyebrow">{eyebrow}</div>
            <h2 id="dialog-title">{title}</h2>
          </div>
          <button className="icon-button" disabled={busy} aria-label="Close Dialog" onClick={close}>
            <Icon name="close" />
          </button>
        </header>
        {children}
      </section>
    </div>
  )
}

function DeviceDialog({
  device,
  busy,
  close,
  save,
  remove
}: {
  device: DeviceInput
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
      title={device.id ? 'Edit device' : 'Add Device'}
      eyebrow="DEVICE DETAILS"
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
              placeholder="For example, Linux1"
            />
          </label>
          <div className="form-columns">
            <label>
              Operating System
              <select
                value={draft.platform}
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
              IP or Hostname
              <input
                value={draft.host}
                onChange={(event) => setDraft({ ...draft, host: event.target.value })}
                placeholder="For example, 192.168.1.20"
                maxLength={253}
                spellCheck={false}
              />
            </label>
          </div>
          <label>
            Sunshine Application Name
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
            <span>You can enter the address later. Before connecting for the first time, add this host in Moonlight and complete pairing.</span>
          </div>
        </div>
        <footer className="modal-footer">
          {remove && (
            <button
              className={`text-button danger ${confirmRemove ? 'confirm' : ''}`}
              type="button"
              disabled={busy}
              onClick={() => (confirmRemove ? void remove() : setConfirmRemove(true))}
            >
              {confirmRemove ? 'Confirm Device Removal' : 'Remove Device'}
            </button>
          )}
          <div className="footer-spacer" />
          <button className="button secondary" type="button" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button className="button primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Save Device'}
          </button>
        </footer>
      </form>
    </Modal>
  )
}

function SettingsDialog({
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
