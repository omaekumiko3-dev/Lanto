import { useWorkbench } from './hooks/useWorkbench.ts'
import { Icon } from './Icon.tsx'
import { Sidebar } from './components/Sidebar.tsx'
import { ConnectionPanel } from './components/ConnectionPanel.tsx'
import { DeviceCards } from './components/DeviceCards.tsx'
import { ActivityPanel } from './components/ActivityPanel.tsx'
import { DeviceDialog } from './components/DeviceDialog.tsx'
import { SettingsDialog } from './components/SettingsDialog.tsx'
import { PairHostDialog } from './components/PairHostDialog.tsx'

export function App() {
  const model = useWorkbench()
  const {
    state,
    settings,
    busy,
    settingsOpen,
    setSettingsOpen,
    newDevice,
    setSelectedId,
    run,
    api,
    setEditing,
    setProbes,
    notice,
    setNotice,
    editing,
    setState,
    configured,
    pairOpen,
    setPairOpen,
    active
  } = model
  if (!state)
    return (
      <div className="loading">
        <div className="brand-mark">L</div>
        <h1>Lanto</h1>
        <p>{notice || 'Opening the local workspace…'}</p>
      </div>
    )
  const view = { ...model, state }
  return (
    <div className="app-shell">
      <Sidebar model={view} />

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
          <div className="heading-actions">
            <button
              className="button primary"
              disabled={Boolean(busy) || active}
              onClick={() => setPairOpen(true)}
            >
              <Icon name="link" size={17} />
              Connect to Host
            </button>
            <button className="button secondary" onClick={newDevice}>
              <Icon name="plus" size={17} />
              Add Device
            </button>
          </div>
        </section>

        {notice && (
          <div
            className={`notice ${settingsOpen || editing || pairOpen ? 'modal-notice' : ''}`}
            role="alert"
          >
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
        <ConnectionPanel model={view} />

        <div className="section-heading device-section-heading">
          <h2>
            Device <span>{state.config.devices.length.toString().padStart(2, '0')}</span>
          </h2>
          <span className="subtle">Host authorization and remote screen show separate statuses</span>
        </div>
        <DeviceCards model={view} />

        <ActivityPanel model={view} />
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

      {pairOpen && (
        <PairHostDialog
          busy={Boolean(busy)}
          close={() => setPairOpen(false)}
          discover={() => api.discoverHosts()}
          pair={async (ticket) => {
            if (
              await run('pair-host', async () => {
                const next = await api.pairHost(ticket)
                setState(next)
                setSelectedId(next.config.devices.at(-1)!.id)
              })
            )
              setPairOpen(false)
          }}
        />
      )}
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
