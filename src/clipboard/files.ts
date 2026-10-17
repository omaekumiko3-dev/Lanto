import { constants } from 'node:fs'
import { lstat, realpath, open, mkdir, mkdtemp, rm, statfs } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { basename, join, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { Transform } from 'node:stream'
import type { Readable, Writable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { readdir } from 'node:fs/promises'
import type { FileEntry, FileEvent } from '../protocol/clipboard.ts'

export interface SharedFile {
  path: string
  size: bigint
  mtimeNs: bigint
  ino: bigint
  dev: bigint
}
export interface FileOffer {
  event: FileEvent
  sources: Map<number, SharedFile>
}

function validComponent(value: string): boolean {
  return Boolean(
    value &&
    value !== '.' &&
    value !== '..' &&
    !/[<>:"\\|?*\u0000-\u001f\u007f]/.test(value) &&
    !/[. ]$/.test(value) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
  )
}
function portableName(value: string): string {
  let clean = value
    .normalize('NFC')
    .replace(/[<>:"\\|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/[. ]+$/, '_')
  if (!validComponent(clean)) clean = '_' + clean
  return clean
}
export function validateEntries(entries: FileEntry[]): string[] {
  const paths = new Map<string, FileEntry>()
  const roots = new Set<string>()
  for (const entry of entries) {
    const parts = entry.path.split('/')
    if (
      parts.some((part) => !validComponent(part)) ||
      entry.path.startsWith('/') ||
      (entry.kind === 'directory' && entry.size !== '0')
    )
      throw new Error('The file manifest contains an invalid path')
    const key = entry.path.normalize('NFC').toLowerCase()
    if (paths.has(key)) throw new Error('The file manifest contains duplicate paths')
    if (parts.length > 1) {
      const parent = parts.slice(0, -1).join('/').normalize('NFC').toLowerCase()
      if (paths.get(parent)?.kind !== 'directory')
        throw new Error('The file manifest is missing a parent directory')
    }
    paths.set(key, entry)
    roots.add(parts[0]!)
  }
  return [...roots]
}
export async function createOffer(id: string, paths: string[]): Promise<FileOffer> {
  const entries: FileEntry[] = []
  const sources = new Map<number, SharedFile>()
  const names = new Set<string>()
  async function add(path: string, destination: string): Promise<void> {
    if (entries.length >= 100000)
      throw new Error('More than 100000 files were selected; copy them in smaller batches')
    const info = await lstat(path, { bigint: true })
    if (info.isSymbolicLink() || (!info.isFile() && !info.isDirectory()))
      throw new Error('File sharing does not support symbolic links or special device files')
    if ((await realpath(path)) !== path)
      throw new Error('The shared path contains a symbolic link; copy the actual file')
    const key = destination.normalize('NFC').toLowerCase()
    if (names.has(key))
      throw new Error('File names collide on the destination system; rename them first')
    names.add(key)
    const index = entries.length
    entries.push({
      path: destination,
      kind: info.isDirectory() ? 'directory' : 'file',
      size: info.isFile() ? info.size.toString() : '0'
    })
    if (info.isFile())
      sources.set(index, {
        path,
        size: info.size,
        mtimeNs: info.mtimeNs,
        ino: info.ino,
        dev: info.dev
      })
    else
      for (const child of await readdir(path))
        await add(join(path, child), `${destination}/${portableName(child)}`)
  }
  for (const path of paths) {
    const selected = resolve(path)
    if ((await lstat(selected)).isSymbolicLink())
      throw new Error('File sharing does not support symbolic links')
    // Windows packaged apps can redirect AppData, and macOS has standard directory aliases.
    // Resolve the selected root once, then pin every traversed entry to that physical path.
    await add(await realpath(selected), portableName(basename(selected)))
  }
  validateEntries(entries)
  return { event: { id, kind: 'files', entries }, sources }
}
export function totalSize(event: FileEvent): bigint {
  return event.entries.reduce((total, entry) => total + BigInt(entry.size), 0n)
}
export class ByteMeter extends Transform {
  bytes = 0n
  private readonly hash = createHash('sha256')
  private readonly expected: bigint
  private readonly progress: (bytes: bigint) => void
  constructor(expected: bigint, progress: (bytes: bigint) => void = () => {}) {
    super()
    this.expected = expected
    this.progress = progress
  }
  override _transform(
    chunk: Buffer,
    _encoding: BufferEncoding,
    callback: (error?: Error | null, data?: Buffer) => void
  ) {
    this.bytes += BigInt(chunk.length)
    if (this.bytes > this.expected) {
      callback(new Error('The file size changed during transfer'))
      return
    }
    this.hash.update(chunk)
    this.progress(this.bytes)
    callback(null, chunk)
  }
  override _flush(callback: (error?: Error | null) => void) {
    callback(
      this.bytes === this.expected ? null : new Error('The file was not transferred completely')
    )
  }
  digest(): string {
    return this.hash.digest('hex')
  }
}
export async function openSharedFile(source: SharedFile): Promise<FileHandle> {
  if ((await realpath(source.path)) !== source.path) throw new Error('The source file path changed')
  const file = await open(source.path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  try {
    await assertSource(file, source)
    return file
  } catch (error) {
    await file.close()
    throw error
  }
}
export async function assertSource(file: FileHandle, source: SharedFile): Promise<void> {
  const now = await file.stat({ bigint: true })
  if (
    !now.isFile() ||
    now.size !== source.size ||
    now.mtimeNs !== source.mtimeNs ||
    now.ino !== source.ino ||
    now.dev !== source.dev
  )
    throw new Error('The source file changed; copy it again')
}
export async function streamSharedFile(
  source: SharedFile,
  output: Writable,
  signal: AbortSignal,
  progress?: (bytes: bigint) => void
): Promise<string> {
  const file = await openSharedFile(source)
  try {
    const meter = new ByteMeter(source.size, progress)
    await pipeline(file.createReadStream({ autoClose: false }), meter, output, {
      signal,
      end: false
    })
    await assertSource(file, source)
    return meter.digest()
  } finally {
    await file.close()
  }
}

export class IncomingFiles {
  readonly event: FileEvent
  readonly expected: string
  readonly directory: string
  readonly controller = new AbortController()
  private readonly completed = new Set<number>()
  private readonly pending = new Set<number>()
  private committed = false
  private constructor(event: FileEvent, expected: string, directory: string) {
    this.event = event
    this.expected = expected
    this.directory = directory
  }
  static async create(base: string, event: FileEvent, expected: string): Promise<IncomingFiles> {
    validateEntries(event.entries)
    await mkdir(base, { recursive: true, mode: 0o700 })
    const disk = await statfs(base, { bigint: true })
    if (totalSize(event) > disk.bavail * disk.bsize)
      throw new Error('The receiving device has insufficient disk space')
    const directory = await realpath(await mkdtemp(join(base, 'copy-')))
    const incoming = new IncomingFiles(event, expected, directory)
    try {
      for (const entry of event.entries)
        if (entry.kind === 'directory') await mkdir(incoming.path(entry), { mode: 0o700 })
      return incoming
    } catch (error) {
      await incoming.cancel()
      throw error
    }
  }
  private path(entry: FileEntry): string {
    const path = resolve(this.directory, ...entry.path.split('/'))
    const child = relative(this.directory, path)
    if (!child || child.startsWith('..' + sep) || child === '..')
      throw new Error('Invalid receiving path')
    return path
  }
  async receive(
    index: number,
    input: Readable,
    signal: AbortSignal,
    progress?: (bytes: bigint) => void
  ): Promise<string> {
    const entry = this.event.entries[index]
    if (!entry || entry.kind !== 'file' || this.completed.has(index) || this.pending.has(index))
      throw new Error('Invalid file transfer')
    const path = this.path(entry)
    this.pending.add(index)
    const meter = new ByteMeter(BigInt(entry.size), progress)
    try {
      const file = await open(path, 'wx', 0o600)
      await pipeline(input, meter, file.createWriteStream(), {
        signal: AbortSignal.any([signal, this.controller.signal])
      })
      this.completed.add(index)
      return meter.digest()
    } catch (error) {
      await rm(path, { force: true })
      throw error
    } finally {
      this.pending.delete(index)
    }
  }
  paths(): string[] {
    if (
      this.pending.size ||
      this.completed.size !== this.event.entries.filter((entry) => entry.kind === 'file').length
    )
      throw new Error('Not all files have finished transferring')
    return validateEntries(this.event.entries).map((root) => join(this.directory, root))
  }
  finish(): void {
    this.committed = true
  }
  async cancel(): Promise<void> {
    this.controller.abort()
    if (!this.committed)
      await rm(this.directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
}
