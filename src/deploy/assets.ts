import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { RemoteSystem } from '../protocol/deployment.ts'

export interface Asset {
  name: string
  url: string
  sha256: string
}
export interface Catalog {
  sunshineVersion: string
  nodeVersion: string
  assets: Asset[]
}
export async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export async function loadCatalog(root: string): Promise<Catalog> {
  return JSON.parse(
    (await readFile(join(root, 'catalog.json'), 'utf8')).replace(/^\uFEFF/, '')
  ) as Catalog
}
export function selectAssets(
  catalog: Catalog,
  system: RemoteSystem
): { node?: Asset; sunshine?: Asset } {
  const nodePlatform = { windows: 'win', macos: 'darwin', linux: 'linux' }[system.platform]
  const nodeName = `node-v${catalog.nodeVersion}-${nodePlatform}-${system.architecture}.${system.platform === 'windows' ? 'zip' : 'tar.gz'}`
  let sunshineName: string
  if (system.platform === 'windows')
    sunshineName = `Sunshine-Windows-${system.architecture === 'x64' ? 'AMD64' : 'ARM64'}-installer.msi`
  else if (system.platform === 'macos')
    sunshineName = `Sunshine-macOS-${system.architecture === 'x64' ? 'x86_64' : 'arm64'}.dmg`
  else
    sunshineName = `sunshine_${catalog.sunshineVersion}-1+${system.distribution}${system.version}_${system.architecture === 'x64' ? 'amd64' : 'arm64'}.deb`
  const node = system.nodePath ? undefined : catalog.assets.find((asset) => asset.name === nodeName)
  const sunshine = system.sunshineInstalled
    ? undefined
    : catalog.assets.find((asset) => asset.name === sunshineName)
  if (!system.nodePath && !node)
    throw new Error('The Node.js installation package for this system is missing')
  if (!system.sunshineInstalled && !sunshine)
    throw new Error(
      'This Linux distribution requires Sunshine to be installed first; automatic installation supports Ubuntu 22.04, 24.04, and 26.04'
    )
  return { node, sunshine }
}
export async function downloadAsset(
  asset: Asset,
  directory: string,
  signal: AbortSignal,
  progress: (bytes: number, total: number) => void
): Promise<string> {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const destination = join(directory, `${asset.sha256}-${asset.name}`)
  if (
    await sha256(destination)
      .then((hash) => hash === asset.sha256)
      .catch(() => false)
  )
    return destination
  const temporary = destination + '.' + randomUUID() + '.part'
  try {
    const response = await fetch(asset.url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(600_000)])
    })
    if (!response.ok || !response.body)
      throw new Error('Component download failed; check the network and retry')
    const total = Number(response.headers.get('content-length') || 0)
    let bytes = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length
        progress(bytes, total)
        callback(null, chunk)
      }
    })
    await pipeline(
      Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
      meter,
      createWriteStream(temporary, { flags: 'wx', mode: 0o600 }),
      { signal }
    )
    if ((await sha256(temporary)) !== asset.sha256)
      throw new Error(
        'Package verification failed and deployment stopped; download the package again'
      )
    await rename(temporary, destination)
    return destination
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}
