import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import electronExecutable from 'electron'
import { initializeHost } from '../src/host/config.ts'
import { startHost } from '../src/host/service.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const testData = await mkdtemp(join(tmpdir(), 'lanto-ui-'))
const artifacts = join(root, 'test-results')
const environment = { ...process.env, LANTO_TEST_DATA_DIR: testData }
delete environment.ELECTRON_RUN_AS_NODE
await mkdir(artifacts, { recursive: true })
let application
const errors = []
let hostService

async function launch() {
  application = await electron.launch({
    executablePath: electronExecutable,
    args: [root, '--lanto-smoke-test'],
    env: environment,
    timeout: 30000
  })
  const page = await application.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: /^device/ }).waitFor()
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
  assert.equal(
    await page.getByRole('button', { name: 'Open Remote Desktop', exact: true }).isDisabled(),
    true
  )
  await page.screenshot({ path: join(artifacts, 'workbench.png'), fullPage: true })
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(680, 480)
  )
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > window.innerWidth,
    footerBottom: document.querySelector('.modal-footer').getBoundingClientRect().bottom,
    height: window.innerHeight
  }))
  assert.equal(layout.overflow, false)
  assert.ok(layout.footerBottom <= layout.height)
  await page.locator('summary').filter({ hasText: 'Advanced Settings' }).click()
  await page.getByLabel('Moonlight Executable').scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(artifacts, 'settings-compact.png') })
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(900, 620)
  )

  await page.getByRole('button', { name: 'Edit Linux1', exact: true }).click()
  await page.getByLabel('IP or Hostname').fill('linux1.local')
  await page.getByRole('button', { name: 'Save Device', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(
    (await page.evaluate(() => window.lanto.getState())).config.devices[0].host,
    'linux1.local'
  )

  await page.getByRole('main').getByRole('button', { name: 'Add Device', exact: true }).click()
  await page.getByLabel('Device name').fill('Test Windows')
  await page.getByLabel('Operating System').selectOption('windows')
  await page.getByLabel('IP or Hostname').fill('192.0.2.10')
  await page.getByRole('button', { name: 'Save Device', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal((await page.evaluate(() => window.lanto.getState())).config.devices.length, 3)

  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByLabel('Shortcut to return to this machine').fill('Control+Alt+Shift+F11')
  await page.getByLabel('Bitrate (Mbps)').fill('35')
  await page.getByLabel('Show Cursor').selectOption('true')
  await page.getByRole('button', { name: 'Save Settings', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal((await page.evaluate(() => window.lanto.getState())).config.settings.bitrateMbps, 35)
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
  await page.getByLabel('IP or Hostname').fill('--help')
  await page.getByRole('button', { name: 'Save Device', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: 'Address should be' }).waitFor()
  assert.equal(
    (await page.evaluate(() => window.lanto.getState())).config.devices.at(-1).host,
    '192.0.2.10'
  )
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.getByRole('button', { name: 'Close Tip', exact: true }).click()

  const rejection = await page.evaluate(async () => {
    try {
      await window.lanto.connect('not-a-device')
      return false
    } catch {
      return true
    }
  })
  assert.equal(rejection, true)
  await application.close()
  application = null

  page = await launch()
  const persisted = await page.evaluate(() => window.lanto.getState())
  assert.equal(persisted.config.devices[0].host, 'linux1.local')
  assert.equal(persisted.config.settings.bitrateMbps, 35)
  assert.equal(persisted.session.phase, 'idle')
  await page.getByRole('button', { name: 'Edit Test Windows', exact: true }).click()
  await page.getByRole('button', { name: 'Remove Device', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm Device Removal', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal((await page.evaluate(() => window.lanto.getState())).config.devices.length, 2)
  const disk = JSON.parse(await readFile(join(testData, 'config.json'), 'utf8'))
  assert.equal(disk.devices.length, 2)

  const hostConfig = await initializeHost(join(testData, 'host'), {
    name: 'Smoke Host',
    listen: '127.0.0.1',
    address: '127.0.0.1',
    port: 0
  })
  hostService = await startHost(hostConfig, join(testData, 'host'), { discovery: false })
  await page.getByRole('button', { name: 'Connect to Host', exact: true }).click()
  await page.getByLabel('Host Pairing Credentials').fill(hostService.createTicket())
  await page.getByRole('button', { name: 'Pair and Add', exact: true }).click()
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
  await page.screenshot({ path: join(artifacts, 'host-paired.png'), fullPage: true })
  await application.close()
  application = null
  page = await launch()
  const pairedAfterRestart = await page.evaluate(() => window.lanto.getState())
  const hostDevice = pairedAfterRestart.config.devices.find(
    (entry) => entry.hostId === hostConfig.identity.id
  )
  await page.evaluate((id) => window.lanto.probe(id), hostDevice.id)
  assert.equal(
    (await page.evaluate(() => window.lanto.getState())).trustedHosts[0].status.identity.id,
    hostConfig.identity.id
  )
  await page.getByRole('button', { name: 'Edit Smoke Host', exact: true }).click()
  await page.getByRole('button', { name: 'Remove Device', exact: true }).click()
  await page.getByRole('button', { name: 'Confirm Device Removal', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.deepEqual((await page.evaluate(() => window.lanto.getState())).trustedHosts, [])
  assert.deepEqual(errors, [])
  const closed = application.waitForEvent('close')
  await page.getByRole('button', { name: 'Close Window', exact: true }).click()
  await closed
  application = null
  console.log(
    'Electron smoke passed: frameless layout, compact settings, window IPC validation and close, device CRUD, real Host TLS pairing, encrypted credentials, restart and unpair; screenshots: test-results/'
  )
} finally {
  await application?.close()
  await hostService?.close()
  assert.equal(dirname(resolve(testData)), resolve(tmpdir()))
  assert.ok(basename(testData).startsWith('lanto-ui-'))
  await rm(testData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
