import { dialog, ipcMain, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import { channels } from '../shared/model.ts'
import type { Result } from '../shared/model.ts'
import { readableError } from '../shared/validation.ts'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Workbench } from './workbench.ts'

export function registerIPC(window: () => BrowserWindow | null, workbench: Workbench): void {
  function handle<T>(channel: string, action: (input: unknown) => T | Promise<T>) {
    ipcMain.handle(channel, async (event, input: unknown): Promise<Result<T>> => {
      const current = window()
      if (
        !current ||
        event.sender !== current.webContents ||
        event.senderFrame !== current.webContents.mainFrame
      )
        return { ok: false, error: 'Unauthorized invocation source' }
      try {
        return { ok: true, value: await action(input) }
      } catch (error) {
        return { ok: false, error: readableError(error) }
      }
    })
  }
  handle(channels.getState, () => workbench.snapshot())
  handle(channels.controlWindow, (input) => {
    const action = z.enum(['minimize', 'maximize', 'close']).parse(input)
    const current = window()
    if (!current) return
    if (action === 'minimize') current.minimize()
    else if (action === 'maximize') {
      if (current.isMaximized()) current.unmaximize()
      else current.maximize()
    } else
      setImmediate(() => {
        if (!current.isDestroyed()) current.close()
      })
  })
  handle(channels.saveDevice, (input) => workbench.saveDevice(input))
  handle(channels.setDeviceAudio, (input) => workbench.setDeviceAudio(input))
  handle(channels.removeDevice, (input) => workbench.removeDevice(input))
  handle(channels.saveSettings, (input) => workbench.saveSettings(input))
  handle(channels.cancelClipboardTransfer, () => workbench.cancelClipboardTransfer())
  handle(channels.openClipboardFiles, async () => {
    const path = join(workbench.snapshot().runtime.configDirectory, 'clipboard', 'received')
    await mkdir(path, { recursive: true, mode: 0o700 })
    const error = await shell.openPath(path)
    if (error) throw new Error('Cannot open the received files directory')
  })
  handle(channels.openMoonlight, () => workbench.openMoonlight())
  handle(channels.connect, (input) => workbench.connect(input))
  handle(channels.returnLocal, () => workbench.returnLocal())
  handle(channels.probe, (input) => workbench.probe(input))
  handle(channels.discoverHosts, () => workbench.discoverHosts())
  handle(channels.pairHost, (input) => workbench.pairHost(input))
  handle(channels.inspectDeployment, (input) => workbench.deployment.inspect(input))
  handle(channels.confirmSshHost, (input) => workbench.deployment.confirmHostKey(input))
  handle(channels.startDeployment, () => workbench.deployment.deploy())
  handle(channels.cancelDeployment, () => workbench.deployment.cancel())
  handle(channels.chooseSshKey, async () => {
    const current = window()
    if (!current) return null
    const result = await dialog.showOpenDialog(current, {
      title: 'Select SSH private key',
      properties: ['openFile']
    })
    return result.canceled ? null : result.filePaths[0] || null
  })
  handle(channels.chooseMoonlight, async () => {
    const current = window()
    if (!current) return null
    const result = await dialog.showOpenDialog(current, {
      title: 'Select Moonlight executable',
      properties: ['openFile'],
      ...(process.platform === 'win32'
        ? { filters: [{ name: 'Moonlight', extensions: ['exe'] }] }
        : {})
    })
    return result.canceled ? null : result.filePaths[0] || null
  })
  handle(channels.openHelp, async (input) => {
    const topic = z.enum(['moonlight', 'sunshine']).parse(input)
    await shell.openExternal(
      topic === 'moonlight'
        ? 'https://moonlight-stream.org/'
        : 'https://docs.lizardbyte.dev/projects/sunshine/latest/'
    )
  })
}
