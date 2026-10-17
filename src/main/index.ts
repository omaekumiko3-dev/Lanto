import { app, dialog, Menu } from 'electron'
import type { BrowserWindow } from 'electron'
import { channels } from '../shared/model.ts'
import { readableError } from '../shared/validation.ts'
import { registerIPC } from './ipc.ts'
import { Workbench } from './workbench.ts'
import { createWindow, focusWindow, loadWindow } from './window.ts'
import { appUserModelId, updateWindowBranding } from './branding.ts'

const smoke = !app.isPackaged && process.argv.includes('--lanto-smoke-test')
app.setName('Lanto')
if (process.platform === 'win32') app.setAppUserModelId(appUserModelId)
if (smoke && process.env.LANTO_TEST_DATA_DIR)
  app.setPath('userData', process.env.LANTO_TEST_DATA_DIR)
let window: BrowserWindow | null = null
let workbench: Workbench | undefined
let closing = false
let closed = false

async function boot() {
  await app.whenReady()
  Menu.setApplicationMenu(null)
  workbench = new Workbench({
    directory: app.getPath('userData'),
    version: app.getVersion(),
    focusLocal: () => focusWindow(window),
    changed: () => {
      if (window && !window.isDestroyed())
        window.webContents.send(channels.state, workbench!.snapshot())
    }
  })
  await workbench.load()
  registerIPC(() => window, workbench)
  window = createWindow(smoke, () => {
    void workbench
      ?.returnLocal()
      .catch((error: unknown) => workbench?.log(readableError(error), true))
  })
  await updateWindowBranding(window, !smoke).catch((error: unknown) =>
    workbench?.log(readableError(error), true)
  )
  window.on('closed', () => {
    window = null
  })
  await loadWindow(window)
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => focusWindow(window))
  app.on('window-all-closed', () => app.quit())
  app.on('before-quit', (event) => {
    if (closed || !workbench) return
    event.preventDefault()
    if (closing) return
    closing = true
    void workbench
      .close()
      .catch(() => {})
      .finally(() => {
        closed = true
        app.quit()
      })
  })
  void boot().catch((error: unknown) => {
    dialog.showErrorBox('Lanto failed to start', readableError(error))
    closed = true
    app.quit()
  })
}
