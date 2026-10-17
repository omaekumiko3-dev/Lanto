import { spawnSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, cp, rm, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const destination = join(root, 'out/deploy')
await mkdir(destination, { recursive: true })
const stage = join(destination, '.build-' + randomUUID())
try {
  const result = spawnSync(process.execPath, [join(root, 'scripts/package-host.mjs'), stage], {
    cwd: root,
    stdio: 'inherit',
    windowsHide: true
  })
  if (result.status !== 0) throw new Error('Host packaging failed')
  const archive = join(destination, 'host-runtime.tar.gz')
  const packed = spawnSync('tar', ['-czf', archive, '-C', stage, '.'], {
    stdio: 'inherit',
    windowsHide: true
  })
  if (packed.status !== 0) throw new Error('Host archive failed')
  const sha256 = createHash('sha256')
    .update(await readFile(archive))
    .digest('hex')
  await writeFile(join(destination, 'manifest.json'), JSON.stringify({ sha256 }, null, 2) + '\n')
  for (const name of ['agent.mjs', 'catalog.json'])
    await cp(join(root, 'scripts/deploy', name), join(destination, name))
  console.log('SSH deployment resources built')
} finally {
  if (!resolve(stage).startsWith(resolve(destination) + sep) || !stage.includes('.build-'))
    throw new Error('Invalid build directory')
  await rm(stage, { recursive: true, force: true })
}
