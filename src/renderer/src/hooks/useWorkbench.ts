import { useEffect, useState } from 'react'
import { defaultConfig } from '../../../shared/model.ts'
import type { AppState, DeviceInput, ProbeResult } from '../../../shared/model.ts'
import { errorText } from '../format.ts'

export function useWorkbench() {
  const api = window.lanto
  const [state, setState] = useState<AppState | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [pairOpen, setPairOpen] = useState(false)
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
  }, [api])

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

  const selected =
    state?.config.devices.find((device) => device.id === selectedId) || state?.config.devices[0]
  const settings = state?.config.settings || defaultConfig().settings
  const active = Boolean(
    state && (state.session.pid !== null || state.session.phase === 'launching')
  )
  const selectedActive = selected?.id === state?.session.deviceId
  const phase = selectedActive && state ? state.session.phase : 'idle'
  const configured = state?.config.devices.filter((device) => device.host).length || 0
  function newDevice() {
    setEditing({ name: '', host: '', platform: 'linux', appName: 'Desktop' })
  }

  return {
    api,
    state,
    setState,
    selected,
    selectedId,
    setSelectedId,
    settings,
    active,
    selectedActive,
    phase,
    busy,
    notice,
    setNotice,
    settingsOpen,
    setSettingsOpen,
    pairOpen,
    setPairOpen,
    editing,
    setEditing,
    probes,
    setProbes,
    configured,
    newDevice,
    run
  }
}

export type WorkbenchView = ReturnType<typeof useWorkbench> & { state: AppState }
