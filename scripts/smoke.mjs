import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, rmdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import electronExecutable from 'electron'
import { initializeHost } from '../src/host/config.ts'
import { startHost } from '../src/host/service.ts'
import { defaultConfig } from '../src/shared/model.ts'
import ssh2 from 'ssh2'
import { generateKeyPairSync } from 'node:crypto'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const testData = await mkdtemp(join(tmpdir(), 'lanto-ui-'))
const artifacts = join(root, 'test-results')
const environment = { ...process.env, LANTO_TEST_DATA_DIR: testData }
delete environment.ELECTRON_RUN_AS_NODE
await mkdir(artifacts, { recursive: true })
const initialConfig = defaultConfig()
initialConfig.settings.returnShortcut = 'Control+Alt+Shift+F11'
await writeFile(join(testData, 'config.json'), JSON.stringify(initialConfig))
let application
const errors = []
let hostService
let sshServer

async function launch() {
  application = await electron.launch({
    executablePath: electronExecutable,
    args: [root, '--lanto-smoke-test'],
    cwd: testData,
    env: environment,
    timeout: 30000
  })
  const page = await application.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: /^Devices/ }).waitFor()
  return page
}

try {
  let page = await launch()
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  assert.equal(await page.evaluate(() => typeof window.lanto.connect), 'function')
  const preferences = await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
  )
  assert.equal(preferences.contextIsolation, true)
  assert.equal(preferences.sandbox, true)
  assert.equal(preferences.nodeIntegration, false)
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.lanto.controlWindow('invalid')
        return false
      } catch {
        return true
      }
    }),
    true
  )
  assert.equal(
    await page
      .locator('.titlebar')
      .evaluate((element) => getComputedStyle(element).getPropertyValue('app-region')),
    'drag'
  )
  assert.equal(
    await page
      .getByRole('button', { name: 'Settings', exact: true })
      .evaluate((element) => getComputedStyle(element).getPropertyValue('app-region')),
    'no-drag'
  )
  const windowBounds = await application.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    return { outer: window.getBounds(), inner: window.getContentBounds() }
  })
  assert.equal(windowBounds.outer.height, windowBounds.inner.height)
  assert.deepEqual((await page.evaluate(() => window.lanto.getState())).config.devices, [])
  assert.equal(await page.locator('.device-card').count(), 0)
  await page.getByRole('button', { name: 'Add your first device', exact: true }).waitFor()
  assert.equal(await page.getByRole('switch').count(), 2)
  const sharedClipboard = page.getByRole('switch', { name: 'Shared clipboard', exact: true })
  const performanceOverlay = page.getByRole('switch', {
    name: 'Show performance data',
    exact: true
  })
  assert.equal(await sharedClipboard.isChecked(), false)
  assert.equal(await performanceOverlay.isChecked(), false)
  assert.equal(await page.locator('.workspace > .clipboard-status').count(), 0)
  await page.getByRole('button', { name: 'Clipboard options', exact: true }).click()
  await page.getByRole('dialog', { name: 'Clipboard', exact: true }).waitFor()
  assert.equal(
    await page.getByRole('switch', { name: 'Share files', exact: true }).isDisabled(),
    true
  )
  await page.keyboard.press('Escape')
  await page.getByRole('dialog', { name: 'Clipboard', exact: true }).waitFor({ state: 'hidden' })
  await sharedClipboard.click()
  await page.waitForFunction(
    async () => (await window.lanto.getState()).config.settings.shareClipboard
  )
  await page.getByRole('button', { name: 'Clipboard options', exact: true }).click()
  await page.getByRole('switch', { name: 'Share files', exact: true }).click()
  await page.waitForFunction(async () => (await window.lanto.getState()).config.settings.shareFiles)
  await page.screenshot({ path: join(artifacts, 'clipboard-options.png') })
  await page.keyboard.press('Escape')
  await sharedClipboard.click()
  await page.waitForFunction(
    async () => !(await window.lanto.getState()).config.settings.shareClipboard
  )
  await performanceOverlay.click()
  await page.waitForFunction(
    async () => (await window.lanto.getState()).config.settings.showPerformanceOverlay
  )
  await performanceOverlay.click()
  await page.waitForFunction(
    async () => !(await window.lanto.getState()).config.settings.showPerformanceOverlay
  )
  assert.equal(
    await page.getByRole('button', { name: 'Return to this computer', exact: true }).count(),
    0
  )
  await page.screenshot({ path: join(artifacts, 'workbench.png'), fullPage: true })
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(680, 480)
  )
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  const resolution = page.getByLabel('Resolution', { exact: true })
  assert.equal(await resolution.inputValue(), '3840x2160')
  await resolution.click()
  await page.waitForFunction(() => document.querySelector('select:open'))
  await page.screenshot({ path: join(artifacts, 'select-compact.png') })
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('select:open').count(), 0)
  assert.equal(await page.getByRole('dialog', { name: 'Settings', exact: true }).isVisible(), true)
  await resolution.press('Space')
  await page.keyboard.press('ArrowDown')
  await page.keyboard.press('Enter')
  assert.equal(await resolution.inputValue(), '2560x1440')
  await page.getByRole('button', { name: 'Save settings', exact: true }).focus()
  await page.keyboard.press('Tab')
  assert.equal(
    await page
      .getByRole('button', { name: 'Close dialog', exact: true })
      .evaluate((node) => node === document.activeElement),
    true
  )
  await page.keyboard.press('Shift+Tab')
  assert.equal(
    await page
      .getByRole('button', { name: 'Save settings', exact: true })
      .evaluate((node) => node === document.activeElement),
    true
  )
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    footerBottom: document.querySelector('.modal-footer').getBoundingClientRect().bottom,
    height: window.innerHeight
  }))
  assert.equal(layout.overflow, false)
  assert.ok(layout.footerBottom <= layout.height)
  await page.locator('summary').filter({ hasText: 'Advanced settings' }).click()
  await page.getByLabel('Moonlight executable').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(artifacts, 'settings-compact.png') })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(
    await page
      .getByRole('button', { name: 'Settings', exact: true })
      .evaluate((node) => node === document.activeElement),
    true
  )
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(900, 620)
  )

  let sshAuthenticationAttempts = 0
  const sshKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({
    type: 'pkcs1',
    format: 'pem'
  })
  sshServer = new ssh2.Server({ hostKeys: [sshKey] }, (client) => {
    client.on('error', () => {})
    client.on('authentication', (context) => {
      sshAuthenticationAttempts++
      context.reject()
    })
  })
  await new Promise((resolve) => sshServer.listen(0, '127.0.0.1', resolve))
  await page.getByRole('main').getByRole('button', { name: 'Add device', exact: true }).click()
  await page.getByLabel('Connection mode', { exact: true }).selectOption('tunnel')
  await page.getByLabel('Tunnel endpoint', { exact: true }).fill('2001:db8::20')
  await page.getByLabel('Device name', { exact: true }).fill('SSH test')
  await page.getByLabel('SSH username', { exact: true }).fill('desktop')
  await page.getByLabel('IP address or hostname', { exact: true }).fill('127.0.0.1')
  await page.getByLabel('Port', { exact: true }).fill(String(sshServer.address().port))
  await page.getByLabel('SSH password', { exact: true }).fill('do-not-persist-this-secret')
  await page.getByRole('button', { name: 'Connect and inspect', exact: true }).click()
  await page.getByRole('button', { name: 'Trust this device and continue', exact: true }).waitFor()
  const pendingSsh = await page.evaluate(() => window.lanto.getState())
  assert.equal(pendingSsh.deployment.phase, 'host-key')
  assert.equal(pendingSsh.deployment.network, 'tunnel')
  assert.equal(JSON.stringify(pendingSsh).includes('do-not-persist-this-secret'), false)
  await page.getByRole('button', { name: 'Cancel deployment', exact: true }).click()
  await page.getByRole('button', { name: 'Reconnect', exact: true }).waitFor()
  assert.equal((await page.evaluate(() => window.lanto.getState())).deployment.phase, 'cancelled')
  assert.equal(sshAuthenticationAttempts, 0)
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await new Promise((resolve) => sshServer.close(resolve))
  sshServer = undefined
  await page.getByRole('main').getByRole('button', { name: 'Add device', exact: true }).click()
  await page.getByRole('button', { name: 'Add manually', exact: true }).click()
  await page.getByLabel('Device name').fill('Test Linux')
  await page.getByLabel('IP address or hostname').fill('linux1.local')
  await page.getByRole('button', { name: 'Save device', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(
    (await page.evaluate(() => window.lanto.getState())).config.devices[0].host,
    'linux1.local'
  )

  await page.getByRole('main').getByRole('button', { name: 'Add device', exact: true }).click()
  await page.getByRole('button', { name: 'Add manually', exact: true }).click()
  await page.getByLabel('Device name').fill('Test Windows')
  await page.getByLabel('Operating system').selectOption('windows')
  await page.getByLabel('IP address or hostname').fill('192.0.2.10')
  await page.getByRole('button', { name: 'Save device', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal((await page.evaluate(() => window.lanto.getState())).config.devices.length, 2)

  async function savedAudio(name, volume, muted) {
    await page.waitForFunction(
      async ({ name, volume, muted }) => {
        const state = await window.lanto.getState()
        const device = state.config.devices.find((entry) => entry.name === name)
        return device?.volume === volume && device?.muted === muted
      },
      { name, volume, muted }
    )
  }
  await page.getByRole('slider', { name: 'Test Linux volume', exact: true }).fill('37')
  await savedAudio('Test Linux', 37, false)
  await page.getByRole('button', { name: 'Mute Test Linux', exact: true }).click()
  await savedAudio('Test Linux', 37, true)
  await page.getByRole('slider', { name: 'Test Windows volume', exact: true }).fill('82')
  await savedAudio('Test Windows', 82, false)
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(680, 480)
  )
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await page.screenshot({ path: join(artifacts, 'volume-compact.png') })
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(900, 620)
  )

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Switch shortcut').fill('Control+Alt+Shift+F11')
  assert.equal(
    await page.getByLabel('Switch only with shortcut', { exact: true }).inputValue(),
    'true'
  )
  await page.getByLabel('Switch only with shortcut', { exact: true }).selectOption('false')
  await page.getByLabel('Resolution', { exact: true }).selectOption('3840x2160')
  await page.getByLabel('Frame rate', { exact: true }).selectOption('60')
  await page.getByLabel('Bitrate (Mbps)', { exact: true }).fill('120')
  await page.getByLabel('Cursor display').selectOption('true')
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const savedVideo = (await page.evaluate(() => window.lanto.getState())).config.settings
  assert.equal(savedVideo.resolution, '3840x2160')
  assert.equal(savedVideo.fps, 60)
  assert.equal(savedVideo.bitrateMbps, 120)
  assert.equal(savedVideo.lockInput, false)
  assert.equal(
    (await page.evaluate(() => window.lanto.getState())).config.settings.localCursor,
    true
  )
  const oldShortcut = (await page.evaluate(() => window.lanto.getState())).config.settings
    .returnShortcut
  const invalidShortcut = await page.evaluate(async () => {
    const snapshot = await window.lanto.getState()
    try {
      await window.lanto.saveSettings({
        ...snapshot.config.settings,
        returnShortcut: 'DefinitelyNotAValidKey'
      })
      return false
    } catch {
      return true
    }
  })
  assert.equal(invalidShortcut, true)
  assert.equal(
    (await page.evaluate(() => window.lanto.getState())).config.settings.returnShortcut,
    oldShortcut
  )

  await page.getByRole('button', { name: 'Edit Test Windows', exact: true }).click()
  await page.getByLabel('IP address or hostname').fill('--help')
  await page.getByRole('button', { name: 'Save device', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Address must be' }).waitFor()
  assert.equal(
    (await page.evaluate(() => window.lanto.getState())).config.devices.at(-1).host,
    '192.0.2.10'
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Dismiss notice', exact: true }).click()

  const rejection = await page.evaluate(async () => {
    try {
      await window.lanto.connect('not-a-device')
      return false
    } catch {
      return true
    }
  })
  assert.equal(rejection, true)

  // A real, isolated child process exercises session lifecycle without a remote host.
  // MoonlightAdapter passes "stream" as its first argument; Node runs this fixture.
  await writeFile(
    join(testData, 'stream'),
    `const fs = require('node:fs');
fs.appendFileSync('media-starts.jsonl', JSON.stringify({ pid: process.pid, args: process.argv.slice(2), initialVolume: process.env.LANTO_VOLUME }) + '\\n');
setInterval(() => {
  try { fs.writeFileSync('volume-' + process.pid + '.json', fs.readFileSync(process.env.LANTO_VOLUME_FILE)); } catch {}
}, 30);
setInterval(() => {}, 1000);
`
  )
  const mediaSettings = (await page.evaluate(() => window.lanto.getState())).config.settings
  const mediaDirectory = join(testData, 'media')
  await mkdir(mediaDirectory)
  const fakeMedia = join(mediaDirectory, basename(process.execPath))
  await copyFile(
    process.platform === 'win32' ? join(root, 'out/native/LantoTestMedia.exe') : process.execPath,
    fakeMedia
  )
  await writeFile(
    join(mediaDirectory, 'lanto-media.json'),
    JSON.stringify({ audioVolumeProtocol: 1, lockedInputProtocol: 1, sharedSwitchProtocol: 1 })
  )
  await page.evaluate(
    (moonlightPath) =>
      window.lanto.getState().then(({ config }) =>
        window.lanto.saveSettings({
          ...config.settings,
          moonlightPath,
          localCursor: false,
          windowsPipeline: 'auto'
        })
      ),
    fakeMedia
  )
  async function waitPhase(phase, deviceName) {
    let matched = false
    for (let attempt = 0; attempt < 100; attempt++) {
      const state = await page.evaluate(() => window.lanto.getState())
      if (
        state.session.phase === phase &&
        (!deviceName ||
          state.config.devices.some(
            (device) => device.id === state.session.deviceId && device.name === deviceName
          ))
      ) {
        matched = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    assert.equal(matched, true, `Session did not reach ${phase} for ${deviceName || 'any device'}`)
    if (phase === 'running') {
      const { config, session } = await page.evaluate(() => window.lanto.getState())
      const name = config.devices.find((device) => device.id === session.deviceId).name
      await page
        .getByRole('switch', { name: `${name} connection`, exact: true, checked: true })
        .waitFor()
    } else if (phase === 'idle' || phase === 'failed') {
      await page.waitForFunction(
        () =>
          document.querySelectorAll('.device-cards [role="switch"][aria-checked="true"]').length ===
          0
      )
    }
  }
  async function launches(count) {
    let records = []
    for (let attempt = 0; attempt < 50; attempt++) {
      const content = await readFile(join(testData, 'media-starts.jsonl'), 'utf8').catch(() => '')
      records = content
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
      if (records.length >= count) return records
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    throw new Error(`Expected ${count} media launches, got ${records.length}`)
  }
  async function appliedVolume(pid, expected) {
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = await readFile(join(testData, `volume-${pid}.json`), 'utf8')
        .then((text) => JSON.parse(text))
        .catch(() => null)
      if (value === expected) return
      await new Promise((resolve) => setTimeout(resolve, 30))
    }
    throw new Error(`Audio gain did not reach ${expected}`)
  }
  const linuxSwitch = page.getByRole('switch', { name: 'Test Linux connection', exact: true })
  assert.equal(await linuxSwitch.isChecked(), false)
  await linuxSwitch.click()
  await waitPhase('running', 'Test Linux')
  assert.equal(await linuxSwitch.isChecked(), true)
  const running = (await page.evaluate(() => window.lanto.getState())).session
  await page.evaluate(async () => {
    const { config } = await window.lanto.getState()
    await window.lanto.saveSettings({ ...config.settings, lockInput: true })
  })
  assert.equal(await page.getByRole('button', { name: 'Show Test Linux', exact: true }).count(), 0)
  assert.equal(
    await page.evaluate(async () => {
      try {
        await window.lanto.showRemote()
        return false
      } catch {
        return true
      }
    }),
    true
  )
  assert.equal((await launches(1))[0].initialVolume, '0')
  await appliedVolume(running.pid, 0)
  await page.getByRole('button', { name: 'Unmute Test Linux', exact: true }).click()
  await savedAudio('Test Linux', 37, false)
  await appliedVolume(running.pid, 37)
  const volumeSlider = page.getByRole('slider', { name: 'Test Linux volume', exact: true })
  await volumeSlider.fill('10')
  await volumeSlider.fill('22')
  await volumeSlider.fill('47')
  await volumeSlider.press('ArrowRight')
  await savedAudio('Test Linux', 48, false)
  await appliedVolume(running.pid, 48)
  const audioConfigFile = join(testData, 'config.json')
  await rename(audioConfigFile, `${audioConfigFile}.held`)
  await mkdir(audioConfigFile)
  try {
    assert.equal(
      await page.evaluate(async (id) => {
        try {
          await window.lanto.setDeviceAudio({ id, volume: 66, muted: false })
          return false
        } catch {
          return true
        }
      }, running.deviceId),
      true
    )
    await appliedVolume(running.pid, 48)
  } finally {
    await rmdir(audioConfigFile)
    await rename(`${audioConfigFile}.held`, audioConfigFile)
  }
  await page.getByRole('slider', { name: 'Test Windows volume', exact: true }).fill('81')
  await savedAudio('Test Windows', 81, false)
  await appliedVolume(running.pid, 48)
  await page.getByRole('button', { name: 'Mute Test Linux', exact: true }).click()
  await savedAudio('Test Linux', 48, true)
  await appliedVolume(running.pid, 0)
  await page.getByRole('button', { name: 'Edit Test Linux', exact: true }).click()
  assert.equal(
    await page.getByRole('button', { name: 'Remove device', exact: true }).isDisabled(),
    true
  )
  await page.getByLabel('Device name').fill('Build Linux')
  await page.getByLabel('IP address or hostname').fill('192.0.2.21')
  await page.getByLabel('Sunshine application name').fill('Next Desktop')
  await page.getByRole('button', { name: 'Save device', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(
    await page.getByRole('switch', { name: 'Build Linux connection', exact: true }).isChecked(),
    true
  )
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Bitrate (Mbps)').fill('36')
  await page.getByRole('button', { name: 'Save settings', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal((await page.evaluate(() => window.lanto.getState())).session.pid, running.pid)
  assert.equal(
    await page.evaluate(async (id) => {
      try {
        await window.lanto.removeDevice(id)
        return false
      } catch {
        return true
      }
    }, running.deviceId),
    true
  )
  await page.screenshot({ path: join(artifacts, 'connection-switch.png') })

  const windowsSwitch = page.getByRole('switch', { name: 'Test Windows connection', exact: true })
  await windowsSwitch.click()
  await waitPhase('running', 'Test Windows')
  assert.equal(await windowsSwitch.isChecked(), true)
  assert.equal(
    await page.getByRole('switch', { name: 'Build Linux connection', exact: true }).isChecked(),
    true
  )
  await launches(2)
  assert.equal((await launches(2))[1].initialVolume, '81')
  assert.equal((await page.evaluate(() => window.lanto.getState())).sessions.length, 2)
  const thirdId = await page.evaluate(async () => {
    const state = await window.lanto.saveDevice({
      name: 'Third device',
      host: 'third.local',
      platform: 'linux',
      appName: 'Desktop'
    })
    return state.config.devices.at(-1).id
  })
  assert.equal(
    await page.getByRole('switch', { name: 'Third device connection', exact: true }).isDisabled(),
    true
  )
  assert.equal(
    await page.evaluate(async (id) => {
      try {
        await window.lanto.connect(id)
        return false
      } catch (error) {
        return error.message.includes('Two devices')
      }
    }, thirdId),
    true
  )
  assert.equal((await page.evaluate(() => window.lanto.getState())).sessions.length, 2)
  await page.evaluate((id) => window.lanto.removeDevice(id), thirdId)
  await page.screenshot({ path: join(artifacts, 'two-connections.png') })
  await windowsSwitch.focus()
  await windowsSwitch.press('Space')
  await waitPhase('running', 'Build Linux')
  assert.equal((await page.evaluate(() => window.lanto.getState())).sessions[0].pid, running.pid)
  assert.equal(await windowsSwitch.isChecked(), false)
  await page.getByRole('switch', { name: 'Build Linux connection', exact: true }).click()
  await waitPhase('idle')
  assert.equal(await windowsSwitch.isChecked(), false)

  await page.getByRole('switch', { name: 'Build Linux connection', exact: true }).click()
  await waitPhase('running')
  const records = await launches(3)
  assert.equal(records[0].args[1], 'Desktop')
  assert.equal(records[2].args[1], 'Next Desktop')
  assert.equal(records[0].args[0], 'linux1.local')
  assert.equal(records[0].args[records[0].args.indexOf('--resolution') + 1], '3840x2160')
  assert.equal(records[0].args[records[0].args.indexOf('--fps') + 1], '60')
  assert.equal(records[0].args[records[0].args.indexOf('--bitrate') + 1], '120000')
  assert.equal(records[2].args[0], '192.0.2.21')
  assert.equal(records[2].args[records[2].args.indexOf('--bitrate') + 1], '36000')
  assert.equal(records[2].initialVolume, '0')
  process.kill(records[2].pid)
  await waitPhase('failed')
  assert.equal(
    await page.locator('.device-cards').getByRole('switch', { checked: true }).count(),
    0
  )
  await page.getByRole('alert').filter({ hasText: 'Moonlight exited' }).waitFor()
  await page.getByRole('switch', { name: 'Build Linux connection', exact: true }).click()
  await waitPhase('running')
  await page.getByRole('switch', { name: 'Build Linux connection', exact: true }).click()
  await waitPhase('idle')
  await page.evaluate((settings) => window.lanto.saveSettings(settings), mediaSettings)

  await application.close()
  application = null

  page = await launch()
  const persisted = await page.evaluate(() => window.lanto.getState())
  assert.equal(persisted.config.devices[0].host, '192.0.2.21')
  assert.equal(persisted.config.devices[0].name, 'Build Linux')
  assert.equal(persisted.config.devices[0].volume, 48)
  assert.equal(persisted.config.devices[0].muted, true)
  assert.equal(persisted.config.settings.resolution, '3840x2160')
  assert.equal(persisted.config.settings.fps, 60)
  assert.equal(persisted.config.settings.bitrateMbps, 120)
  assert.equal(persisted.config.settings.shareFiles, true)
  assert.equal(persisted.config.settings.shareClipboard, false)
  assert.equal(persisted.config.settings.showPerformanceOverlay, false)
  assert.equal(persisted.session.phase, 'idle')
  await page.getByRole('button', { name: 'Edit Test Windows', exact: true }).click()
  await page.getByRole('button', { name: 'Remove device', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm device removal', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal((await page.evaluate(() => window.lanto.getState())).config.devices.length, 1)
  const disk = JSON.parse(await readFile(join(testData, 'config.json'), 'utf8'))
  assert.equal(disk.devices.length, 1)

  const hostConfig = await initializeHost(join(testData, 'host'), {
    name: 'Smoke Host',
    listen: '0.0.0.0',
    address: '127.0.0.1',
    port: 0
  })
  hostService = await startHost(hostConfig, join(testData, 'host'), { discovery: false })
  await page.getByRole('button', { name: 'Connect Host', exact: true }).click()
  await page.getByLabel('Host pairing ticket').fill(hostService.createTicket())
  await page.getByRole('button', { name: 'Pair and add', exact: true }).click()
  await Promise.race([
    page.getByRole('dialog').waitFor({ state: 'hidden' }),
    page
      .getByRole('alert')
      .waitFor()
      .then(async () => {
        throw new Error(`Host pairing failed: ${await page.getByRole('alert').innerText()}`)
      })
  ])
  const paired = await page.evaluate(() => window.lanto.getState())
  assert.equal(paired.trustedHosts.length, 1)
  assert.equal(paired.trustedHosts[0].status.identity.name, 'Smoke Host')
  assert.equal('token' in paired.trustedHosts[0], false)
  assert.equal('encryptedToken' in paired.trustedHosts[0], false)
  assert.equal('certificate' in paired.trustedHosts[0], false)
  const trustOnDisk = JSON.parse(await readFile(join(testData, 'trusted-hosts.json'), 'utf8'))
  const encrypted = trustOnDisk.hosts[0].encryptedToken
  assert.ok(typeof encrypted === 'string' && encrypted.length > 0)
  assert.equal(
    await application.evaluate(({ safeStorage }, value) => {
      const plain = safeStorage.decryptString(Buffer.from(value, 'base64'))
      return /^[a-zA-Z0-9_-]{43}$/.test(plain) && plain !== value
    }, encrypted),
    true
  )
  await page.getByRole('button', { name: 'Edit Smoke Host', exact: true }).click()
  assert.equal(await page.getByLabel('IP address or hostname').isEditable(), true)
  assert.equal(await page.getByLabel('Operating system').isDisabled(), true)
  await page.getByLabel('Device name').fill('My Host')
  await page.getByLabel('IP address or hostname').fill('127.0.0.2')
  await page.screenshot({ path: join(artifacts, 'edit-host-address.png') })
  await page.getByRole('button', { name: 'Save device', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const updated = await page.evaluate(() => window.lanto.getState())
  const updatedDevice = updated.config.devices.find(
    (entry) => entry.hostId === hostConfig.identity.id
  )
  assert.equal(updatedDevice.host, '127.0.0.2')
  assert.equal(updated.trustedHosts[0].address, '127.0.0.2')
  assert.equal(updated.trustedHosts[0].status, undefined)
  const updatedTrust = JSON.parse(await readFile(join(testData, 'trusted-hosts.json'), 'utf8'))
  assert.deepEqual(updatedTrust.hosts[0], { ...trustOnDisk.hosts[0], address: '127.0.0.2' })

  // A failed config write must not leave the management endpoint at a different address.
  const configFile = join(testData, 'config.json')
  await rename(configFile, `${configFile}.held`)
  await mkdir(configFile)
  try {
    assert.equal(
      await page.evaluate(async (device) => {
        try {
          await window.lanto.saveDevice({ ...device, host: '127.0.0.3' })
          return false
        } catch {
          return true
        }
      }, updatedDevice),
      true
    )
    const failed = await page.evaluate(() => window.lanto.getState())
    assert.equal(
      failed.config.devices.find((entry) => entry.id === updatedDevice.id).host,
      '127.0.0.2'
    )
    assert.equal(failed.trustedHosts[0].address, '127.0.0.2')
  } finally {
    await rmdir(configFile)
    await rename(`${configFile}.held`, configFile)
  }
  await page.screenshot({ path: join(artifacts, 'host-paired.png'), fullPage: true })
  await application.close()
  application = null
  // Recover an interrupted two-file save using the committed device config.
  await writeFile(join(testData, 'trusted-hosts.json'), JSON.stringify(trustOnDisk))
  page = await launch()
  const pairedAfterRestart = await page.evaluate(() => window.lanto.getState())
  const hostDevice = pairedAfterRestart.config.devices.find(
    (entry) => entry.hostId === hostConfig.identity.id
  )
  assert.equal(hostDevice.name, 'My Host')
  assert.equal(hostDevice.host, '127.0.0.2')
  assert.equal(pairedAfterRestart.trustedHosts[0].address, '127.0.0.2')
  await page.evaluate((id) => window.lanto.probe(id), hostDevice.id)
  assert.equal(
    (await page.evaluate(() => window.lanto.getState())).trustedHosts[0].status.identity.id,
    hostConfig.identity.id
  )
  await page.getByRole('button', { name: 'Edit My Host', exact: true }).click()
  await page.getByRole('button', { name: 'Remove device', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm device removal', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.deepEqual((await page.evaluate(() => window.lanto.getState())).trustedHosts, [])
  assert.deepEqual(errors, [])
  const closed = application.waitForEvent('close')
  await page.getByRole('button', { name: 'Close window', exact: true }).click()
  await closed
  application = null
  console.log(
    'Electron smoke passed: quick settings and persistence, popover and select keyboard behavior, dialog focus, per-device volume/mute, connection switches, Host TLS pairing and unpair; screenshots: test-results/'
  )
} catch (error) {
  const page = application && (await application.firstWindow())
  if (page) {
    await page.screenshot({ path: join(artifacts, 'smoke-failure.png') }).catch(() => {})
    console.error(await page.locator('[role="alert"]').allTextContents())
  }
  throw error
} finally {
  await application?.close()
  await hostService?.close()
  if (sshServer) await new Promise((resolve) => sshServer.close(resolve))
  assert.equal(dirname(resolve(testData)), resolve(tmpdir()))
  assert.ok(basename(testData).startsWith('lanto-ui-'))
  await rm(testData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
