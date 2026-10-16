import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const output = process.argv[2] && resolve(process.argv[2])
if (!output) throw new Error('Usage: node scripts/package-host.mjs <new output directory>')
const project = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
const packages = Object.entries(lock.packages).filter(([path, info]) => path && !info.dev)
for (const [path, info] of packages) {
  if (!path.startsWith('node_modules/') || path.includes('..') || info.link)
    throw new Error(`Unsupported package path: ${path}`)
  if (info.hasInstallScript || info.os || info.cpu)
    throw new Error(`Cross-platform Host packaging requires reviewing native dependency: ${path}`)
}
// Refuse to overwrite a runtime or accidentally include local identity/credentials.
await mkdir(output)
await cp(join(root, 'out/host'), join(output, 'app'), { recursive: true })
for (const [path] of packages) {
  const destination = join(output, path)
  await mkdir(dirname(destination), { recursive: true })
  await cp(join(root, path), destination, { recursive: true })
}
await writeFile(
  join(output, 'package.json'),
  JSON.stringify(
    { name: 'lanto-host-runtime', private: true, type: 'module', version: project.version },
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
console.log(`Host runtime: ${output} (${packages.length} production packages, no Electron)`)
