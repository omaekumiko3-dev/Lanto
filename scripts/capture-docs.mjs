import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import electronExecutable from 'electron'
import { defaultConfig } from '../src/shared/model.ts'

const root = resolve(import.meta.dirname, '..')
const output = join(root, 'docs/images/screenshots')
await mkdir(output, { recursive: true })
await mkdir(join(root, 'work/docs-capture'), { recursive: true })
const data = await mkdtemp(join(root, 'work/docs-capture/session-'))
const config = defaultConfig()
config.settings.returnShortcut = 'Control+Alt+Shift+F10'
config.settings.moonlightPath = process.env.LANTO_DOCS_MOONLIGHT || ''
config.devices = [
  {
    id: 'dc895f4a-ef83-4ba8-8989-458fd44f3ab1',
    name: 'Studio Mac',
    host: '192.0.2.10',
    platform: 'macos',
    appName: 'Desktop',
    volume: 75,
    muted: false
  },
  {
    id: 'dc895f4a-ef83-4ba8-8989-458fd44f3ab2',
    name: 'Linux Workstation',
    host: '192.0.2.20',
    platform: 'linux',
    appName: 'Desktop',
    volume: 50,
    muted: false
  },
  {
    id: 'dc895f4a-ef83-4ba8-8989-458fd44f3ab3',
    name: 'Windows Desktop',
    host: '192.0.2.30',
    platform: 'windows',
    appName: 'Desktop',
    volume: 100,
    muted: true
  }
]
await writeFile(join(data, 'config.json'), JSON.stringify(config))
const env = { ...process.env, LANTO_TEST_DATA_DIR: data }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({
  executablePath: electronExecutable,
  args: [root, '--lanto-smoke-test'],
  env,
  cwd: data
})
try {
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: /^Devices/ }).waitFor()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1120, 700))
  await page.locator('.device-card').first().waitFor()
  await page.screenshot({ animations: 'disabled', path: join(output, 'devices.png') })
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  await page.getByRole('dialog', { name: 'Settings', exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(output, 'settings.png') })
  await page.keyboard.press('Escape')
  await page.getByRole('main').getByRole('button', { name: 'Add device', exact: true }).click()
  await page.getByLabel('Device name', { exact: true }).fill('Studio Mac')
  await page.getByLabel('IP address or hostname', { exact: true }).fill('192.0.2.10')
  await page.getByLabel('SSH username', { exact: true }).fill('desktop')
  await page.screenshot({ animations: 'disabled', path: join(output, 'ssh-setup.png') })
  await page.getByLabel('Connection mode', { exact: true }).selectOption('tunnel')
  await page.getByLabel('Tunnel endpoint', { exact: true }).fill('2001:db8::10')
  await page.screenshot({ animations: 'disabled', path: join(output, 'direct-tunnel.png') })
  await page.keyboard.press('Escape')
  await page.getByRole('switch', { name: 'Shared clipboard', exact: true }).click()
  await page.getByRole('button', { name: 'Clipboard options', exact: true }).click()
  await page.getByRole('dialog', { name: 'Clipboard', exact: true }).waitFor()
  await page.screenshot({ animations: 'disabled', path: join(output, 'clipboard.png') })
  console.log(
    'Documentation screenshots captured from the real Electron UI with example device data.'
  )
} finally {
  await app.close()
}
