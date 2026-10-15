import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, shell } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { channels } from '../shared/model.ts'
import type { Activity, AppState, Config, Result } from '../shared/model.ts'
import {
  deviceIdSchema,
  deviceInputSchema,
  readableError,
  settingsSchema
} from '../shared/validation.ts'
import { ConfigStore } from './config-store.ts'
import { findMoonlight, MoonlightAdapter } from './moonlight.ts'
import { probeSunshine } from './probe.ts'
import { SessionManager } from './session-manager.ts'

const smoke = !app.isPackaged && process.argv.includes('--lanto-smoke-test')
app.setName('Lanto')
if (smoke && process.env.LANTO_TEST_DATA_DIR)
  app.setPath('userData', process.env.LANTO_TEST_DATA_DIR)

let mainWindow: BrowserWindow | null = null
let config: Config
let store: ConfigStore
let quitting = false
let shutdownComplete = false
let registeredShortcut = ''
let resolvedMoonlight: string | null = null
let localReturnEpoch = 0
let session: SessionManager
let queue: Promise<unknown> = Promise.resolve()
const activity: Activity[] = []
const adapter = new MoonlightAdapter()

function snapshot(): AppState {
  return {
    config,
    session: session.state,
    runtime: {
      version: app.getVersion(),
      platform: process.platform,
      moonlightPath: resolvedMoonlight,
      shortcutRegistered: Boolean(registeredShortcut),
      configDirectory: app.getPath('userData')
    },
    activity: [...activity]
  }
}

function publish(): void {
  if (mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send(channels.state, snapshot())
}

function log(message: string, error = false): void {
  activity.unshift({
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    level: error ? 'error' : 'info',
    message
  })
  activity.splice(60)
  publish()
}

function serial<T>(action: () => Promise<T>): Promise<T> {
  const result = queue.then(action)
  queue = result.catch(() => {})
  return result
}

function focusLocal(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

async function returnLocal(): Promise<void> {
  localReturnEpoch++
  // Bring the local control surface forward even when a media process fails to stop.
  focusLocal()
  await session.disconnect()
  focusLocal()
}

function registerShortcut(accelerator: string): boolean {
  try {
    return globalShortcut.register(accelerator, () => {
      void returnLocal().catch((error: unknown) => log(readableError(error), true))
    })
  } catch {
    return false
  }
}

async function persist(next: Config): Promise<void> {
  await store.save(next)
  config = next
  resolvedMoonlight = await findMoonlight(config.settings.moonlightPath)
  publish()
}

async function updateSettings(input: unknown): Promise<AppState> {
  const settings = settingsSchema.parse(input)
  if (settings.moonlightPath && !isAbsolute(settings.moonlightPath))
    throw new Error('Moonlight path must be an absolute path')
  if (settings.moonlightPath && !(await findMoonlight(settings.moonlightPath)))
    throw new Error('The selected Moonlight file does not exist or is not executable')
  const previous = registeredShortcut
  const changed = settings.returnShortcut !== previous
  if (changed && !registerShortcut(settings.returnShortcut)) {
    throw new Error('Return shortcut is invalid or already in use. Choose another key combination; the original shortcut has been kept')
  }
  try {
    await persist({ ...config, settings })
  } catch (error) {
    if (changed) globalShortcut.unregister(settings.returnShortcut)
    throw error
  }
  if (changed) {
    if (previous) globalShortcut.unregister(previous)
    registeredShortcut = settings.returnShortcut
  }
  log('Client settings saved')
  return snapshot()
}

function trusted(event: IpcMainInvokeEvent): boolean {
  return Boolean(
    mainWindow &&
    event.sender === mainWindow.webContents &&
    event.senderFrame === mainWindow.webContents.mainFrame
  )
}

function handle<T>(channel: string, callback: (input: unknown) => Promise<T> | T): void {
  ipcMain.handle(channel, async (event, input: unknown): Promise<Result<T>> => {
    if (!trusted(event)) return { ok: false, error: 'Disallowed call origin' }
    try {
      return { ok: true, value: await callback(input) }
    } catch (error) {
      return { ok: false, error: readableError(error) }
    }
  })
}

function findDevice(input: unknown) {
  const id = deviceIdSchema.parse(input)
  const device = config.devices.find((entry) => entry.id === id)
  if (!device) throw new Error('Device does not exist. Refresh and try again')
  return device
}

function registerIPC(): void {
  handle(channels.getState, () => snapshot())
  handle(channels.saveDevice, (input) =>
    serial(async () => {
      const value = deviceInputSchema.parse(input)
      if (value.id && !config.devices.some((device) => device.id === value.id))
        throw new Error('Device does not exist')
      if (value.id && session.state.deviceId === value.id && session.state.pid !== null)
        throw new Error('Return to this machine before editing the current session’s device')
      const device = { ...value, id: value.id || randomUUID() }
      const devices = value.id
        ? config.devices.map((existing) => (existing.id === device.id ? device : existing))
        : [...config.devices, device]
      await persist({ ...config, devices })
      log(`${device.name} configuration saved`)
      return snapshot()
    })
  )
  handle(channels.removeDevice, (input) =>
    serial(async () => {
      const device = findDevice(input)
      if (session.state.deviceId === device.id && session.state.pid !== null)
        throw new Error('Return to this machine before removing this device')
      await persist({
        ...config,
        devices: config.devices.filter((entry) => entry.id !== device.id)
      })
      log(`Removed ${device.name}`)
      return snapshot()
    })
  )
  handle(channels.saveSettings, (input) => serial(() => updateSettings(input)))
  handle(channels.chooseMoonlight, async () => {
    if (!mainWindow) return null
    const selection = await dialog.showOpenDialog(mainWindow, {
      title: 'Select the Moonlight executable',
      properties: ['openFile'],
      ...(process.platform === 'win32'
        ? { filters: [{ name: 'Moonlight', extensions: ['exe'] }] }
        : {})
    })
    return selection.canceled ? null : selection.filePaths[0] || null
  })
  handle(channels.openMoonlight, () =>
    serial(async () => {
      if (session.state.pid !== null) throw new Error('Return to this machine before opening the Moonlight pairing window')
      await adapter.open(config.settings)
      log('Moonlight has been opened; complete host pairing in it')
    })
  )
  handle(channels.connect, (input) => {
    const epoch = localReturnEpoch
    return serial(async () => {
      if (quitting || epoch !== localReturnEpoch) return
      if (!registeredShortcut) throw new Error('Register an available return shortcut in Settings first')
      await session.connect(findDevice(input), config.settings)
    })
  })
  handle(channels.returnLocal, () => returnLocal())
  handle(channels.probe, (input) => probeSunshine(findDevice(input).host))
  handle(channels.openHelp, async (input) => {
    const topic = z.enum(['moonlight', 'sunshine']).parse(input)
    await shell.openExternal(
      topic === 'moonlight'
        ? 'https://moonlight-stream.org/'
        : 'https://docs.lizardbyte.dev/projects/sunshine/latest/'
    )
  })
}

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    title: 'Lanto',
    width: 1420,
    height: 940,
    minWidth: 1100,
    minHeight: 740,
    show: false,
    backgroundColor: '#101214',
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
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault())
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  )
  mainWindow.webContents.session.setPermissionCheckHandler(() => false)
  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    log(`Interface process has exited: ${details.reason}`, true)
    void returnLocal().catch((error: unknown) => log(readableError(error), true))
  })
  mainWindow.on('closed', () => {
    mainWindow = null
  })
  mainWindow.once('ready-to-show', () => {
    if (!smoke) mainWindow?.show()
  })
  if (process.env.ELECTRON_RENDERER_URL && !app.isPackaged) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    await mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function boot(): Promise<void> {
  await app.whenReady()
  Menu.setApplicationMenu(null)
  store = new ConfigStore(app.getPath('userData'))
  config = await store.load()
  session = new SessionManager(
    adapter,
    () => publish(),
    (message, error) => log(message, error)
  )
  resolvedMoonlight = await findMoonlight(config.settings.moonlightPath)
  if (registerShortcut(config.settings.returnShortcut))
    registeredShortcut = config.settings.returnShortcut
  log('Local workbench is ready')
  if (!registeredShortcut) log('Failed to register the return shortcut. Change the key combination in Settings', true)
  registerIPC()
  await createWindow()
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', focusLocal)
  app.on('window-all-closed', () => {
    app.quit()
  })
  app.on('before-quit', (event) => {
    if (shutdownComplete || !session) return
    event.preventDefault()
    if (quitting) return
    quitting = true
    localReturnEpoch++
    globalShortcut.unregisterAll()
    void queue
      .catch(() => {})
      .then(() => session.disconnect())
      .catch(() => {})
      .finally(() => {
        shutdownComplete = true
        app.quit()
      })
  })
  void boot().catch((error: unknown) => {
    dialog.showErrorBox('Lanto failed to start', readableError(error))
    shutdownComplete = true
    app.quit()
  })
}
