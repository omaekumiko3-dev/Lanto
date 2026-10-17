import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { runtimeDependencies } from './runtime-dependencies.mjs'
import { createHash } from 'node:crypto'
import { macClipboard } from '../src/clipboard/native-sources.ts'
import { packageNotices } from './package-notices.mjs'

const root = resolve(import.meta.dirname, '..')
const output = process.argv[2] && resolve(process.argv[2])
if (!output) throw new Error('Usage: node scripts/package-host.mjs <new output directory>')
const project = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
const packages = runtimeDependencies(lock, ['bonjour-service', 'selfsigned', 'zod'])
for (const [path, info] of packages) {
  if (!path.startsWith('node_modules/') || path.includes('..') || info.link)
    throw new Error(`Unsupported package path: ${path}`)
  if (info.hasInstallScript || info.os || info.cpu)
    throw new Error(`Cross-platform Host packaging requires reviewing native dependency: ${path}`)
}
// Refuse to overwrite a runtime or accidentally include local identity/credentials.
await mkdir(output)
await packageNotices(output, ['bonjour-service', 'selfsigned', 'zod'])
await cp(join(root, 'out/host'), join(output, 'app'), { recursive: true })
for (const [path] of packages) {
  const destination = join(output, path)
  await mkdir(dirname(destination), { recursive: true })
  await cp(join(root, path), destination, { recursive: true })
}
await writeFile(
  join(output, 'package.json'),
  JSON.stringify(
    {
      name: 'lanto-host-runtime',
      private: true,
      type: 'module',
      version: project.version,
      license: project.license
    },
    null,
    2
  ) + '\n'
)
await cp(join(root, 'scripts/install-linux-host.sh'), join(output, 'install-linux-host.sh'))
await cp(join(root, 'scripts/install-windows-host.ps1'), join(output, 'install-windows-host.ps1'))
await cp(
  join(root, 'scripts/install-windows-clipboard.ps1'),
  join(output, 'install-windows-clipboard.ps1')
)
const native = join(root, 'out/native-clipboard')
const manifest = await readFile(join(native, 'manifest.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => null)
if (manifest) {
  const sourceHash = createHash('sha256').update(macClipboard).digest('hex').slice(0, 12)
  if (manifest.name !== 'clipboard-' + sourceHash || manifest.sourceHash !== sourceHash)
    throw new Error('Rebuild the Mac clipboard helper after its source changes')
  if (
    createHash('sha256')
      .update(await readFile(join(native, manifest.name)))
      .digest('hex') !== manifest.sha256
  )
    throw new Error('Mac clipboard helper checksum failed')
  await mkdir(join(output, 'native/macos'), { recursive: true })
  await cp(join(native, manifest.name), join(output, 'native/macos', manifest.name))
  await cp(join(native, 'manifest.json'), join(output, 'native/macos/manifest.json'))
}
console.log(`Host runtime: ${output} (${packages.length} production packages, no Electron)`)
