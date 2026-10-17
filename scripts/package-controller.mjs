import { cp, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { runtimeDependencies } from './runtime-dependencies.mjs'
import { packageNotices } from './package-notices.mjs'

if (process.platform !== 'win32')
  throw new Error('This release script packages the Windows controller')
const root = resolve(import.meta.dirname, '..')
const media = process.argv[2] && resolve(process.argv[2])
if (!media)
  throw new Error(
    'Usage: node scripts/package-controller.mjs <built native Moonlight directory> [new output directory]'
  )
const project = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const features = JSON.parse(await readFile(join(media, 'lanto-media.json'), 'utf8'))
if (features.automatedPairProtocol !== 1 || features.lockedInputProtocol !== 1)
  throw new Error('Build the player with automated pairing and locked input support')
const output = process.argv[3]
  ? resolve(process.argv[3])
  : join(root, 'out/release', `Lanto-${project.version}-win-x64`)
await mkdir(dirname(output), { recursive: true })
await mkdir(output)
await cp(join(root, 'node_modules/electron/dist'), output, { recursive: true })
await rename(join(output, 'electron.exe'), join(output, 'Lanto.exe'))
const icon = spawnSync(
  'powershell.exe',
  [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    join(root, 'scripts/set-exe-icon.ps1'),
    '-Executable',
    join(output, 'Lanto.exe'),
    '-Icon',
    join(root, 'assets/lanto.ico')
  ],
  { stdio: 'inherit', windowsHide: true }
)
if (icon.status !== 0) throw new Error('Executable icon embedding failed')
const app = join(output, 'resources/app')
await mkdir(app, { recursive: true })
await writeFile(
  join(app, 'package.json'),
  JSON.stringify(
    {
      name: project.name,
      productName: project.productName,
      version: project.version,
      license: project.license,
      main: project.main
    },
    null,
    2
  ) + '\n'
)
for (const folder of ['main', 'preload', 'renderer', 'deploy'])
  await cp(join(root, 'out', folder), join(app, 'out', folder), { recursive: true })
await cp(join(root, 'assets'), join(app, 'assets'), { recursive: true })
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
const windowRuntime = `@koromix/koffi-win32-${process.arch}`
for (const [path] of runtimeDependencies(lock, [
  'bonjour-service',
  'selfsigned',
  'ssh2',
  'zod',
  'koffi',
  windowRuntime
])) {
  await mkdir(dirname(join(app, path)), { recursive: true })
  await cp(join(root, path), join(app, path), { recursive: true })
}
await cp(media, join(output, 'resources/media'), { recursive: true })
await packageNotices(output, Object.keys(project.dependencies))
// Koffi's optional binary package carries the same MIT license in its parent package.
await cp(
  join(root, 'node_modules/koffi/LICENSE.txt'),
  join(app, 'node_modules', windowRuntime, 'LICENSE.txt')
)
await cp(join(root, 'native/patches'), join(output, 'resources/media/source/patches'), {
  recursive: true
})
await cp(join(root, 'native/moonlight'), join(output, 'resources/media/source/lanto'), {
  recursive: true
})
await cp(
  join(root, 'native/build-moonlight.ps1'),
  join(output, 'resources/media/source/build-moonlight.ps1')
)
await cp(join(root, 'native/README.md'), join(output, 'resources/media/source/README.md'))
await cp(
  join(root, 'native/complete-windows-runtime.ps1'),
  join(output, 'resources/media/source/complete-windows-runtime.ps1')
)
await writeFile(
  join(output, 'resources/media/source/UPSTREAM.txt'),
  'Moonlight Qt source: https://github.com/moonlight-stream/moonlight-qt/tree/' +
    features.moonlightCommit +
    `\nLanto changes and build instructions are included in this source directory. Project: https://github.com/omaekumiko3-dev/Lanto\nCorresponding native and Qt source archives: https://github.com/omaekumiko3-dev/Lanto/releases/tag/v${project.version}\nMoonlight is GPL-3.0; see ../LICENSE.\n`
)
await writeFile(
  join(output, 'Getting Started.txt'),
  'Open Lanto.exe → Add device → Enter the target SSH address and credentials → Confirm the host fingerprint → Deploy.\r\nFor an account-free encrypted tunnel, select Encrypted direct tunnel. Set a reachable endpoint (public IPv6 or public IP/hostname with UDP forwarding). The target listens on UDP 48200. There is no relay; restrictive NAT can prevent direct connections. Initial provisioning still requires reachable SSH.\r\nIncludes the display client, direct tunnel helpers, and Host deployment program; no Go, Node.js, WireGuard client, account, or Moonlight installation is required on this computer. Internet access is required to download missing remote components during initial setup.\r\nThe target must have SSH enabled and be signed in to the desktop. Allow screen recording, accessibility, and applicable local-network prompts on macOS.\r\n'
)
const zip = output + '.zip'
const packed = spawnSync(
  'tar',
  ['-a', '-cf', zip, '-C', dirname(output), output.split(/[\\/]/).at(-1)],
  { stdio: 'inherit', windowsHide: true }
)
if (packed.status !== 0) throw new Error('ZIP creation failed')
console.log(zip)
