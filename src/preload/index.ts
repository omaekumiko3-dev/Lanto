import { contextBridge, ipcRenderer } from 'electron'
import { channels } from '../shared/model.ts'
import type { AppState, LantoAPI, Result } from '../shared/model.ts'

async function invoke<T>(channel: string, input?: unknown): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, input)) as Result<T>
  if (!result.ok) throw new Error(result.error)
  return result.value
}

const api: LantoAPI = {
  controlWindow: (action) => invoke(channels.controlWindow, action),
  getState: () => invoke(channels.getState),
  saveDevice: (input) => invoke(channels.saveDevice, input),
  setDeviceAudio: (input) => invoke(channels.setDeviceAudio, input),
  removeDevice: (id) => invoke(channels.removeDevice, id),
  saveSettings: (input) => invoke(channels.saveSettings, input),
  chooseMoonlight: () => invoke(channels.chooseMoonlight),
  openMoonlight: () => invoke(channels.openMoonlight),
  connect: (id) => invoke(channels.connect, id),
  returnLocal: () => invoke(channels.returnLocal),
  probe: (id) => invoke(channels.probe, id),
  discoverHosts: () => invoke(channels.discoverHosts),
  pairHost: (ticket) => invoke(channels.pairHost, ticket),
  openHelp: (topic) => invoke(channels.openHelp, topic),
  onState: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: AppState) => callback(state)
    ipcRenderer.on(channels.state, listener)
    return () => {
      ipcRenderer.removeListener(channels.state, listener)
    }
  }
}

contextBridge.exposeInMainWorld('lanto', api)
