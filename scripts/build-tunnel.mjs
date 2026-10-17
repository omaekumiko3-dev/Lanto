import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const source = join(root, 'native/tunnel')
const output = join(root, 'out/tunnel')
await mkdir(output, { recursive: true })
const files = ['go.mod', 'go.sum', 'main.go']
const sourceHash = createHash('sha256')
for (const name of files) sourceHash.update(name).update(await readFile(join(source, name)))
const digest = sourceHash.digest('hex')
const previous = await readFile(join(output, 'manifest.json'), 'utf8')
  .then(JSON.parse)
  .catch(() => null)
const hash = async (file) =>
  createHash('sha256')
    .update(await readFile(file))
    .digest('hex')
const assets = []
for (const [platform, os] of [
  ['windows', 'windows'],
  ['linux', 'linux'],
  ['macos', 'darwin']
]) {
  for (const [architecture, arch] of [
    ['x64', 'amd64'],
    ['arm64', 'arm64']
  ]) {
    const name = `lanto-tunnel-${platform}-${architecture}${os === 'windows' ? '.exe' : ''}`
    const destination = join(output, name)
    const old =
      previous?.sourceHash === digest && previous.assets.find((entry) => entry.name === name)
    if (!old || (await hash(destination).catch(() => '')) !== old.sha256) {
      const result = spawnSync(
        'go',
        ['build', '-trimpath', '-ldflags=-s -w', '-o', destination, '.'],
        {
          cwd: source,
          env: { ...process.env, GOOS: os, GOARCH: arch, CGO_ENABLED: '0' },
          stdio: 'inherit',
          windowsHide: true
        }
      )
      if (result.status !== 0) throw new Error(`Tunnel build failed: ${platform}/${architecture}`)
    }
    assets.push({ platform, architecture, name, sha256: await hash(destination) })
  }
}
await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify({ version: 1, sourceHash: digest, assets }, null, 2) + '\n'
)
await cp(source, join(output, 'source'), {
  recursive: true,
  filter: (path) => !path.endsWith('_test.go')
})
console.log('Direct tunnel helpers built for Windows, macOS, and Linux (x64 and ARM64)')
