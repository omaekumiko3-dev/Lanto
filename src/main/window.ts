import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'

export function focusWindow(window: BrowserWindow | null): void {
  if (!window || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

export function createWindow(smoke: boolean, onRendererGone: () => void): BrowserWindow {
  const window = new BrowserWindow({
    title: 'Lanto',
    width: 900,
    height: 620,
    minWidth: 680,
    minHeight: 480,
    frame: false,
    icon: join(app.getAppPath(), 'assets/lanto.png'),
    show: false,
    backgroundColor: '#14171c',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      offscreen: smoke,
      backgroundThrottling: !smoke
    }
  })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) =>
    callback(false)
  )
  window.webContents.session.setPermissionCheckHandler(() => false)
  window.webContents.on('render-process-gone', onRendererGone)
  window.once('ready-to-show', () => {
    if (smoke) return
    if (process.argv.includes('--start-minimized')) {
      window.showInactive()
      window.minimize()
    } else window.show()
  })
  return window
}

export async function loadWindow(window: BrowserWindow): Promise<void> {
  if (process.env.ELECTRON_RENDERER_URL) await window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else await window.loadFile(join(__dirname, '../renderer/index.html'))
}
