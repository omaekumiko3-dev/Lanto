import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import electronExecutable from 'electron'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const testData = await mkdtemp(join(tmpdir(), 'lanto-ui-'))
const artifacts = join(root, 'test-results')
const environment = { ...process.env, LANTO_TEST_DATA_DIR: testData }
delete environment.ELECTRON_RUN_AS_NODE
await mkdir(artifacts, { recursive: true })
let application
const errors = []

async function launch() {
  application = await electron.launch({
    executablePath: electronExecutable,
    args: [root, '--lanto-smoke-test'],
    env: environment,
    timeout: 30000
  })
  const page = await application.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Switch devices; keep working.' }).waitFor()
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
    await page.getByRole('button', { name: 'Open Remote Desktop', exact: true }).isDisabled(),
    true
  )
  await page.screenshot({ path: join(artifacts, 'workbench.png'), fullPage: true })

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
  await page.getByLabel('Bitrate (Mbps)').fill('35')
  await page.getByRole('button', { name: 'Save Settings', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal((await page.evaluate(() => window.lanto.getState())).config.settings.bitrateMbps, 35)
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
  assert.deepEqual(errors, [])
  console.log(
    'Electron smoke passed: isolated preload, device CRUD, validation, settings, restart persistence; screenshot: test-results/workbench.png'
  )
} finally {
  await application?.close()
  assert.equal(dirname(resolve(testData)), resolve(tmpdir()))
  assert.ok(basename(testData).startsWith('lanto-ui-'))
  await rm(testData, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
