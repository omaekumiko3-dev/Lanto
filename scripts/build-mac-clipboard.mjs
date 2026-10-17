import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { macClipboard } from '../src/clipboard/native-sources.ts'
if (process.platform !== 'darwin')
  throw new Error('Build this universal helper on macOS with Xcode command line tools')
const output = resolve(process.argv[2] || 'out/native-clipboard')
await mkdir(output, { recursive: true })
const source = join(output, 'clipboard.swift')
await writeFile(source, macClipboard)
const run = (file, args) => {
  if (spawnSync(file, args, { stdio: 'inherit' }).status !== 0)
    throw new Error('Native clipboard build failed')
}
for (const arch of ['arm64', 'x86_64'])
  run('/usr/bin/xcrun', [
    'swiftc',
    '-O',
    '-target',
    arch + '-apple-macos13.0',
    source,
    '-o',
    join(output, 'clipboard-' + arch)
  ])
const sourceHash = createHash('sha256').update(macClipboard).digest('hex').slice(0, 12)
const name = 'clipboard-' + sourceHash
run('/usr/bin/lipo', [
  '-create',
  join(output, 'clipboard-arm64'),
  join(output, 'clipboard-x86_64'),
  '-output',
  join(output, name)
])
run('/usr/bin/codesign', ['--force', '--sign', '-', join(output, name)])
run('/usr/bin/codesign', ['--verify', '--strict', join(output, name)])
const sha256 = createHash('sha256')
  .update(await readFile(join(output, name)))
  .digest('hex')
await writeFile(
  join(output, 'manifest.json'),
  JSON.stringify({ name, sourceHash, sha256, architectures: ['arm64', 'x86_64'] }, null, 2) + '\n'
)
console.log(JSON.stringify({ name, sha256 }))
