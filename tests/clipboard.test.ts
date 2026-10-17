import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat, open } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { NativeClipboard } from '../src/clipboard/native.ts'
import type { DesktopClipboard, NativeContent } from '../src/clipboard/native.ts'
import { ClipboardNode } from '../src/clipboard/node.ts'
import {
  createOffer,
  IncomingFiles,
  validateEntries,
  totalSize,
  openSharedFile
} from '../src/clipboard/files.ts'
import { initializeHost } from '../src/host/config.ts'
import { startHost } from '../src/host/service.ts'
import { HostClient } from '../src/controller/host-client.ts'
import { TrustStore } from '../src/controller/trust-store.ts'
import { ClipboardPeer } from '../src/controller/clipboard-peer.ts'
import { ClipboardSync } from '../src/main/clipboard-sync.ts'
import { hostRequest } from '../src/protocol/request.ts'
import { removeTestDirectory } from './temp.ts'
import type { FileEvent } from '../src/protocol/clipboard.ts'

class MemoryClipboard implements DesktopClipboard {
  content: NativeContent = { kind: 'empty' }
  revision = 0
  reads = 0
  writes = 0
  copy(content: NativeContent) {
    this.content = content
    this.revision++
  }
  async read(since?: string) {
    this.reads++
    return {
      revision: String(this.revision),
      ...(since === String(this.revision) ? {} : { content: this.content })
    }
  }
  async write(content: NativeContent, expected: string) {
    assert.equal(String(this.revision), expected, 'CLIPBOARD_CHANGED')
    this.copy(content)
    this.writes++
    return String(this.revision)
  }
  close() {}
}
const vault = {
  encrypt: (value: string) => Buffer.from(value).toString('base64'),
  decrypt: (value: string) => Buffer.from(value, 'base64').toString()
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check: () => boolean | Promise<boolean>, message: string) {
  for (let i = 0; i < 80; i++) {
    if (await check()) return
    await delay(100)
  }
  assert.fail(message)
}

test('clipboard starts from new copies, preserves Unicode, prevents echoes and protects a newer local copy', async () => {
  const native = new MemoryClipboard()
  native.copy({ kind: 'text', text: 'private before enabling' })
  const node = new ClipboardNode(native)
  assert.equal((await node.read(true)).event, null)
  native.copy({ kind: 'text', text: '中文 😃\nline two' })
  const state = await node.read(true)
  assert.equal(state.event?.kind, 'text')
  assert.equal((await node.read(true)).event?.id, state.event?.id)
  const event = { id: randomUUID(), kind: 'text' as const, text: 'remote copy' }
  await node.apply(event, state.revision)
  assert.equal((await node.read(true)).event?.id, event.id)
  native.copy({ kind: 'text', text: 'new local copy' })
  await assert.rejects(node.apply(event, state.revision), /CLIPBOARD_CHANGED/)
  assert.deepEqual(native.content, { kind: 'text', text: 'new local copy' })
  node.stop()
  assert.equal((await node.read(true)).event, null)
})

test('file metadata rejects traversal, reserved names, collisions and impossible trees without limiting file bytes', () => {
  const entry = { path: 'folder', kind: 'directory' as const, size: '0' }
  const large = { path: 'folder/large.bin', kind: 'file' as const, size: '10995116277760' }
  assert.deepEqual(validateEntries([entry, large]), ['folder'])
  assert.equal(
    totalSize({ id: randomUUID(), kind: 'files', entries: [entry, large] }),
    10995116277760n
  )
  for (const path of [
    '../escape',
    '/absolute',
    'C:/absolute',
    'folder/../../escape',
    'NUL',
    'aux.txt',
    'folder\\escape',
    'file.'
  ])
    assert.throws(() => validateEntries([{ ...large, path }]))
  assert.throws(() => validateEntries([large]), /parent directory/)
  assert.throws(
    () =>
      validateEntries([
        { ...large, path: 'a' },
        { ...large, path: 'A' }
      ]),
    /duplicate/
  )
})

test('disabling synchronization invalidates queued reads and writes before they touch the desktop', async () => {
  const native = new MemoryClipboard()
  let release!: () => void
  const pending = new Promise<void>((resolve) => {
    release = resolve
  })
  const read = native.read.bind(native)
  native.read = async (since) => {
    await pending
    return read(since)
  }
  const node = new ClipboardNode(native)
  const first = node.read(true)
  const queued = node.apply({ id: randomUUID(), kind: 'text', text: 'must not be copied' }, '0')
  const rejected = Promise.all([
    assert.rejects(first, /stopped/),
    assert.rejects(queued, /stopped/)
  ])
  node.stop()
  release()
  await rejected
  assert.equal(native.writes, 0)
  assert.equal(native.reads, 0)
})

test('streaming preserves empty and nested files, refuses changed sources and cleans partial transfers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-clipboard-files-'))
  try {
    const source = join(directory, 'source')
    await mkdir(source)
    await mkdir(join(source, 'empty'))
    await writeFile(join(source, '中文.txt'), 'hello 🌍')
    await writeFile(join(source, 'zero.bin'), '')
    const offer = await createOffer(randomUUID(), [source])
    const incoming = await IncomingFiles.create(join(directory, 'received'), offer.event, '1')
    for (const [index, file] of offer.sources) {
      const handle = await openSharedFile(file)
      await incoming.receive(index, handle.createReadStream(), new AbortController().signal)
    }
    assert.deepEqual(await readFile(join(incoming.paths()[0]!, '中文.txt'), 'utf8'), 'hello 🌍')
    assert.equal((await stat(join(incoming.paths()[0]!, 'empty'))).isDirectory(), true)
    await incoming.cancel()
    assert.deepEqual(await readdir(join(directory, 'received')), [])
    const file = [...offer.sources.values()].find((source) => source.path.endsWith('中文.txt'))!
    await writeFile(file.path, 'changed')
    await assert.rejects(openSharedFile(file), /changed/)

    const event: FileEvent = {
      id: randomUUID(),
      kind: 'files',
      entries: [{ path: 'partial.bin', kind: 'file', size: '100' }]
    }
    const partial = await IncomingFiles.create(join(directory, 'received'), event, '1')
    await assert.rejects(
      partial.receive(0, Readable.from([Buffer.alloc(20)]), new AbortController().signal),
      /not transferred completely/
    )
    await partial.cancel()
    assert.deepEqual(await readdir(join(directory, 'received')), [])
    const sparse = join(directory, 'over-4GiB.bin')
    const sparseHandle = await open(sparse, 'wx')
    await sparseHandle.truncate(4294967297)
    await sparseHandle.close()
    assert.equal((await createOffer(randomUUID(), [sparse])).event.entries[0]?.size, '4294967297')
  } finally {
    await removeTestDirectory(directory, 'lanto-clipboard-files-')
  }
})

test('real TLS clipboard routes enforce pairing and switches, verify file hashes, and reject a stale commit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-clipboard-tls-'))
  const native = new MemoryClipboard()
  const config = await initializeHost(directory, {
    listen: '127.0.0.1',
    address: '127.0.0.1',
    port: 0
  })
  const service = await startHost(config, directory, { discovery: false, clipboard: native })
  const trust = new TrustStore(join(directory, 'client'), vault)
  await trust.load()
  try {
    const client = new HostClient(trust)
    const paired = await client.pair(service.createTicket())
    const connection = trust.connection(paired.id)
    const peer = new ClipboardPeer(connection)
    const signal = new AbortController().signal
    await assert.rejects(
      hostRequest(connection.endpoint, '/v1/clipboard/state'),
      /authorization is invalid/
    )
    await assert.rejects(peer.state(undefined, signal), /rejected/)
    await peer.session({ enabled: true, files: false }, signal)
    let state = await peer.state(undefined, signal)
    assert.equal(state.event, null)
    native.copy({ kind: 'text', text: 'cross platform 文字' })
    state = await peer.state(undefined, signal)
    assert.equal(state.event?.kind, 'text')
    assert.equal((await peer.state(state.event!.id, signal)).event, null)
    const path = join(directory, 'payload.txt')
    await writeFile(path, 'a'.repeat(2 * 1024 * 1024) + '中文')
    const offer = await createOffer(randomUUID(), [path])
    await assert.rejects(peer.begin(offer.event, state.revision, signal), /rejected/)
    await peer.session({ enabled: true, files: true }, signal)
    await peer.begin(offer.event, state.revision, signal)
    await peer.upload(offer.event.id, 0, offer.sources.get(0)!, signal, () => {})
    await peer.commit(offer.event.id, signal)
    assert.equal(native.content.kind, 'files')
    if (native.content.kind !== 'files') throw new Error('missing files')
    assert.equal(await readFile(native.content.paths[0]!, 'utf8'), await readFile(path, 'utf8'))
    const received = await IncomingFiles.create(join(directory, 'download'), offer.event, '1')
    await peer.download(offer.event.id, 0, received, signal, () => {})
    assert.equal(await readFile(received.paths()[0]!, 'utf8'), await readFile(path, 'utf8'))
    await received.cancel()
    state = await peer.state(undefined, signal)
    const stale = { ...offer.event, id: randomUUID() }
    await peer.begin(stale, state.revision, signal)
    await peer.upload(stale.id, 0, offer.sources.get(0)!, signal, () => {})
    native.copy({ kind: 'text', text: 'keep newer copy' })
    await assert.rejects(peer.commit(stale.id, signal))
    assert.deepEqual(native.content, { kind: 'text', text: 'keep newer copy' })
    await peer.session({ enabled: false, files: false }, signal)
    await assert.rejects(peer.state(undefined, signal), /rejected/)
  } finally {
    await service.close()
    await removeTestDirectory(directory, 'lanto-clipboard-tls-')
  }
})

test('hub relays all directions across three peers, avoids echo loops and stops reading when disabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-clipboard-hub-'))
  const trust = new TrustStore(join(directory, 'controller'), vault)
  await trust.load()
  const natives: MemoryClipboard[] = []
  const services: Awaited<ReturnType<typeof startHost>>[] = []
  const local = new MemoryClipboard()
  const sync = new ClipboardSync(trust, join(directory, 'controller'), () => {}, local)
  try {
    for (let i = 0; i < 3; i++) {
      const hostDirectory = join(directory, `host${i}`)
      const config = await initializeHost(hostDirectory, {
        listen: '127.0.0.1',
        address: '127.0.0.1',
        port: 0
      })
      const native = new MemoryClipboard()
      natives.push(native)
      const service = await startHost(config, hostDirectory, {
        discovery: false,
        clipboard: native
      })
      services.push(service)
      await new HostClient(trust).pair(service.createTicket())
    }
    await sync.configure({ enabled: true, files: true })
    await until(
      () => sync.snapshot().peers.filter((peer) => peer.ready).length === 3,
      'peers not ready'
    )
    for (const source of [local, ...natives]) {
      const text = 'copy-' + randomUUID()
      source.copy({ kind: 'text', text })
      await until(
        () =>
          [local, ...natives].every(
            (native) => native.content.kind === 'text' && native.content.text === text
          ),
        'copy did not reach all endpoints'
      )
    }
    const writes = [local, ...natives].map((native) => native.writes)
    await delay(1600)
    assert.deepEqual(
      [local, ...natives].map((native) => native.writes),
      writes
    )
    const path = join(directory, 'testfile.txt')
    await writeFile(path, 'file ' + randomUUID())
    natives[1]!.copy({ kind: 'files', paths: [path] })
    await until(
      () => [local, natives[0]!, natives[2]!].every((native) => native.content.kind === 'files'),
      'files did not relay through hub'
    )
    for (const native of [local, natives[0]!, natives[2]!]) {
      if (native.content.kind !== 'files') throw new Error('missing file')
      assert.equal(await readFile(native.content.paths[0]!, 'utf8'), await readFile(path, 'utf8'))
    }
    await sync.configure({ enabled: false, files: false })
    const reads = [local, ...natives].map((native) => native.reads)
    local.copy({ kind: 'text', text: 'do not share' })
    await delay(1000)
    assert.deepEqual(
      [local, ...natives].map((native) => native.reads),
      reads
    )
  } finally {
    await sync.stop()
    await Promise.all(services.map((service) => service.close()))
    await removeTestDirectory(directory, 'lanto-clipboard-hub-')
  }
})

test('native clipboard adapter can be constructed without starting a helper or reading clipboard', () => {
  const native = new NativeClipboard(join(tmpdir(), 'unused-lanto-native'))
  native.close()
})
