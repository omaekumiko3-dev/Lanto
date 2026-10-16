import { useWorkbench } from './hooks/useWorkbench.ts'
import { Icon } from './Icon.tsx'
import { Titlebar } from './components/Titlebar.tsx'
import { SessionBar } from './components/SessionBar.tsx'
import { DeviceCards } from './components/DeviceCards.tsx'
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
    pairOpen,
    setPairOpen,
    active
  } = model
  const titlebar = <Titlebar settings={() => setSettingsOpen(true)} error={setNotice} />
  if (!state)
    return (
      <div className="app-shell">
        {titlebar}
        <div className="loading">{notice || 'Opening…'}</div>
      </div>
    )
  const view = { ...model, state }
  const feedback = notice ? (
    <div className="notice" role="alert">
      <span>{notice}</span>
      <button className="icon-button" aria-label="Close Tip" onClick={() => setNotice('')}>
        <Icon name="close" size={16} />
      </button>
    </div>
  ) : null
  return (
    <div className="app-shell">
      {titlebar}
      <main className="workspace">
        <div className="page-heading">
          <h1>
            Device <span>{state.config.devices.length}</span>
          </h1>
          <div className="heading-actions">
            <button
              className="button quiet"
              disabled={Boolean(busy) || active}
              onClick={() => setPairOpen(true)}
            >
              <Icon name="link" size={16} />
              Connect to Host
            </button>
            <button className="button secondary" onClick={newDevice}>
              <Icon name="plus" size={16} />
              Add Device
            </button>
          </div>
        </div>
        {!settingsOpen && !editing && !pairOpen && feedback}
        {!settingsOpen &&
          !editing &&
          !pairOpen &&
          state.session.error &&
          state.session.error !== notice && (
            <div className="notice" role="alert">
              {state.session.error}
            </div>
          )}
        {!state.runtime.shortcutRegistered && (
          <div className="notice" role="alert">
            <span>Return shortcut is unavailable. Choose another key combination.</span>
            <button className="text-button" onClick={() => setSettingsOpen(true)}>
              Go to Settings
            </button>
          </div>
        )}
        {!state.runtime.moonlightPath && (
          <div className="notice">
            <span>Select a remote display client to connect.</span>
            <button className="text-button" onClick={() => setSettingsOpen(true)}>
              Select client
            </button>
          </div>
        )}
        <DeviceCards model={view} />
        <div className="workspace-tools">
          <button
            className="text-button"
            disabled={Boolean(busy) || !state.runtime.moonlightPath || active}
            onClick={() => void run('pair', () => api.openMoonlight())}
          >
            <Icon name="external" size={13} />
            Pair Screen
          </button>
        </div>
      </main>
      <SessionBar model={view} />

      {pairOpen && (
        <PairHostDialog
          notice={feedback}
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
          notice={feedback}
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
          notice={feedback}
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
