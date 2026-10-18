import { useEffect, useState } from 'react'
import { defaultConfig } from '../../../shared/model.ts'
import type { AppState, DeviceInput, ProbeResult } from '../../../shared/model.ts'
import { errorText } from '../format.ts'
import { hostErrorMessages } from '../../../shared/host-errors.ts'

export function useWorkbench() {
  const api = window.lanto
  const [state, setState] = useState<AppState | null>(null)
  const [busy, setBusy] = useState('')
  const [notice, setNotice] = useState('')
  const [networkNoticeDevice, setNetworkNoticeDevice] = useState<string | null>(null)
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

  useEffect(() => {
    if (!state || !networkNoticeDevice || notice !== hostErrorMessages.network) return
    const device = state.config.devices.find((entry) => entry.id === networkNoticeDevice)
    const host = state.trustedHosts.find((entry) => entry.id === device?.hostId)
    if (host?.status && !host.error) {
      setNotice('')
      setNetworkNoticeDevice(null)
    }
  }, [state, networkNoticeDevice, notice])

  async function run(action: string, work: () => Promise<unknown>): Promise<boolean> {
    setBusy(action)
    setNotice('')
    setNetworkNoticeDevice(null)
    try {
      await work()
      return true
    } catch (error) {
      const message = errorText(error)
      setNotice(message)
      if (message === hostErrorMessages.network && action.startsWith('connection:'))
        setNetworkNoticeDevice(action.slice('connection:'.length))
      return false
    } finally {
      setBusy('')
    }
  }

  const settings = state?.config.settings || defaultConfig().settings
  const active = Boolean(
    state && (state.sessions.length > 0 || state.session.phase === 'launching')
  )
  function newDevice() {
    setEditing({ name: '', host: '', platform: 'linux', appName: 'Desktop' })
  }

  return {
    api,
    state,
    setState,
    settings,
    active,
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
    newDevice,
    run
  }
}

export type WorkbenchView = ReturnType<typeof useWorkbench> & { state: AppState }
