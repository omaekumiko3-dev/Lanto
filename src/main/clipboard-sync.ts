import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { ClipboardNode } from '../clipboard/node.ts'
import { NativeClipboard } from '../clipboard/native.ts'
import type { DesktopClipboard } from '../clipboard/native.ts'
import { IncomingFiles, totalSize } from '../clipboard/files.ts'
import { ClipboardPeer } from '../controller/clipboard-peer.ts'
import type { TrustStore } from '../controller/trust-store.ts'
import { HostRequestError } from '../protocol/request.ts'
import type {
  ClipboardEvent,
  ClipboardSettings,
  ClipboardState,
  ClipboardTransfer,
  ClipboardView,
  FileEvent
} from '../protocol/clipboard.ts'

interface PeerState {
  id: string
  name: string
  address: string
  client: ClipboardPeer
  revision: string
  observed?: string
  delivered?: string
  ready: boolean
  error?: string
  leaseAt: number
}

export class ClipboardSync {
  private readonly trust: TrustStore
  private readonly directory: string
  private readonly node: ClipboardNode
  private readonly changed: () => void
  private readonly peers = new Map<string, PeerState>()
  private settings: ClipboardSettings = { enabled: false, files: false }
  private timer?: NodeJS.Timeout
  private cycle?: AbortController
  private job?: AbortController
  private ticking = false
  private generation = 0
  private local?: ClipboardState
  private last?: { event: ClipboardEvent; source?: string; localApplied: boolean }
  private readonly seen = new Set<string>()
  private transfers: ClipboardTransfer[] = []
  private error?: string
  private notifyAt = 0
  constructor(
    trust: TrustStore,
    directory: string,
    changed: () => void,
    native?: DesktopClipboard
  ) {
    this.trust = trust
    this.directory = directory
    this.changed = changed
    this.node = new ClipboardNode(
      native || new NativeClipboard(join(directory, 'clipboard', 'native'))
    )
  }
  snapshot(): ClipboardView {
    return {
      ...this.settings,
      peers: [...this.peers.values()].map(({ id, name, ready, error }) => ({
        id,
        name,
        ready,
        error
      })),
      transfers: this.transfers.map((value) => ({ ...value })),
      ...(this.error ? { error: this.error } : {})
    }
  }
  async configure(settings: ClipboardSettings): Promise<void> {
    if (settings.enabled === this.settings.enabled && settings.files === this.settings.files) return
    await this.stop()
    this.settings = settings
    if (settings.enabled) {
      this.timer = setInterval(() => {
        void this.tick()
      }, 700)
      this.timer.unref()
      void this.tick()
    }
    this.changed()
  }
  cancel(): void {
    this.job?.abort()
    this.job = undefined
    this.last = undefined
    for (const transfer of this.transfers)
      if (transfer.phase === 'transferring') transfer.phase = 'cancelled'
    this.changed()
  }
  private notify(force = false): void {
    if (force || Date.now() - this.notifyAt > 200) {
      this.notifyAt = Date.now()
      this.changed()
    }
  }
  private async tick(): Promise<void> {
    if (this.ticking || !this.settings.enabled) return
    this.ticking = true
    const generation = this.generation
    const cycle = new AbortController()
    this.cycle = cycle
    try {
      const hosts = this.trust.list()
      for (const [id, peer] of this.peers)
        if (
          !hosts.some((host) => host.id === id && `${host.address}:${host.port}` === peer.address)
        ) {
          this.peers.delete(id)
          await peer.client
            .session({ enabled: false, files: false }, AbortSignal.timeout(2000))
            .catch(() => {})
        }
      for (const host of hosts)
        if (!this.peers.has(host.id))
          this.peers.set(host.id, {
            id: host.id,
            name: host.name,
            address: `${host.address}:${host.port}`,
            client: new ClipboardPeer(this.trust.connection(host.id)),
            revision: '',
            ready: false,
            leaseAt: 0
          })
      const changes: { event: ClipboardEvent; source?: string }[] = []
      await Promise.allSettled([
        (async () => {
          try {
            const previous = this.local
            const state = await this.node.read(this.settings.files)
            if (generation !== this.generation) return
            this.local = state
            this.error = undefined
            if (
              previous &&
              state.event &&
              state.event.id !== previous.event?.id &&
              !this.seen.has(state.event.id)
            )
              changes.push({ event: state.event })
          } catch {
            if (generation === this.generation) this.error = 'Local clipboard is temporarily unavailable. Make sure you are logged into the desktop'
          }
        })(),
        ...[...this.peers.values()].map(async (peer) => {
          try {
            const signal = AbortSignal.any([cycle.signal, AbortSignal.timeout(6000)])
            if (Date.now() - peer.leaseAt > 3000) {
              await peer.client.session(this.settings, signal)
              peer.leaseAt = Date.now()
            }
            const state = await peer.client.state(peer.observed, signal)
            if (generation !== this.generation) return
            if (state.error) throw new Error(state.error)
            const initial = !peer.revision
            peer.revision = state.revision
            peer.ready = true
            peer.error = undefined
            if (state.event) {
              peer.observed = state.event.id
              if (!initial && !this.seen.has(state.event.id))
                changes.push({ event: state.event, source: peer.id })
            }
          } catch (error) {
            if (generation !== this.generation) return
            peer.ready = false
            peer.leaseAt = 0
            peer.error =
              error instanceof HostRequestError && error.status === 404
                ? 'Update Lanto Host on this device'
                : 'Device is offline or the desktop clipboard is temporarily unavailable'
          }
        })
      ])
      if (generation !== this.generation) return
      if (changes.length) {
        const latest = changes.at(-1)!
        for (const change of changes) this.remember(change.event.id)
        this.accept(latest.event, latest.source)
      } else if (this.last && !this.job) {
        // A host that was temporarily offline receives the current shared value after reconnect.
        const pending = [...this.peers.values()].some(
          (peer) =>
            peer.ready &&
            peer.id !== this.last!.source &&
            peer.delivered !== this.last!.event.id &&
            peer.observed !== this.last!.event.id
        )
        if (pending) this.deliver(this.last.event, this.last.source)
      }
      this.notify(true)
    } finally {
      this.ticking = false
      if (this.cycle === cycle) this.cycle = undefined
    }
  }
  private remember(id: string): void {
    this.seen.add(id)
    if (this.seen.size > 256) this.seen.delete(this.seen.values().next().value!)
  }
  private accept(event: ClipboardEvent, source?: string): void {
    if (event.kind === 'files' && !this.settings.files) return
    this.job?.abort()
    for (const transfer of this.transfers)
      if (transfer.phase === 'transferring') transfer.phase = 'cancelled'
    this.last = { event, source, localApplied: !source }
    this.deliver(event, source)
  }
  private transfer(device: string, event: FileEvent): ClipboardTransfer {
    const value: ClipboardTransfer = {
      id: randomUUID(),
      device,
      phase: 'transferring',
      bytes: '0',
      total: totalSize(event).toString()
    }
    this.transfers = [
      ...this.transfers.filter((entry) => entry.phase === 'transferring'),
      ...this.transfers.filter((entry) => entry.phase !== 'transferring').slice(-3),
      value
    ]
    this.notify(true)
    return value
  }
  private progress(transfer: ClipboardTransfer, bytes: bigint): void {
    transfer.bytes = bytes.toString()
    this.notify()
  }
  private failed(transfer: ClipboardTransfer, error: unknown, signal: AbortSignal): void {
    transfer.phase = signal.aborted ? 'cancelled' : 'failed'
    if (!signal.aborted) {
      const message = error instanceof Error ? error.message : ''
      transfer.error = /[\u4e00-\u9fff]/.test(message)
        ? message
        : /ENOSPC/.test(message)
          ? 'Receiving device does not have enough disk space'
          : 'Connection interrupted; file transfer incomplete. Copy again to retry'
    }
    this.notify(true)
  }
  private deliver(event: ClipboardEvent, source?: string): void {
    const job = new AbortController()
    this.job = job
    const signal = job.signal
    const localExpected = this.local?.revision
    void (async () => {
      if (source && !this.last?.localApplied) {
        if (!localExpected) throw new Error('Local clipboard is not ready yet')
        if (event.kind === 'files') {
          const peer = this.peers.get(source)
          if (!peer) throw new Error('Source device disconnected')
          const transfer = this.transfer('Local machine', event)
          let incoming: IncomingFiles | undefined
          try {
            incoming = await IncomingFiles.create(
              join(this.directory, 'clipboard', 'received'),
              event,
              localExpected
            )
            let finished = 0n
            for (const [index, entry] of event.entries.entries())
              if (entry.kind === 'file') {
                await peer.client.download(event.id, index, incoming, signal, (bytes) =>
                  this.progress(transfer, finished + bytes)
                )
                finished += BigInt(entry.size)
              }
            signal.throwIfAborted()
            await this.node.apply(event, localExpected, incoming.paths(), signal)
            incoming.finish()
            transfer.phase = 'complete'
            this.notify(true)
          } catch (error) {
            this.failed(transfer, error, signal)
            throw error
          } finally {
            await incoming?.cancel()
          }
        } else {
          signal.throwIfAborted()
          await this.node.apply(event, localExpected, undefined, signal)
        }
        if (this.last?.event.id === event.id) this.last.localApplied = true
      }
      signal.throwIfAborted()
      await Promise.allSettled(
        [...this.peers.values()]
          .filter(
            (peer) =>
              peer.ready &&
              peer.id !== source &&
              peer.delivered !== event.id &&
              peer.observed !== event.id
          )
          .map(async (peer) => {
            const expected = peer.revision
            if (event.kind !== 'files') {
              try {
                await peer.client.apply(event, expected, signal)
                peer.delivered = event.id
              } catch {
                if (!signal.aborted) {
                  peer.error = 'Sync incomplete; there may be new copied content'
                  peer.delivered = event.id
                }
              }
              return
            }
            const transfer = this.transfer(peer.name, event)
            try {
              await peer.client.begin(event, expected, signal)
              let finished = 0n
              for (const [index, entry] of event.entries.entries())
                if (entry.kind === 'file') {
                  await peer.client.upload(
                    event.id,
                    index,
                    this.node.source(event.id, index),
                    signal,
                    (bytes) => this.progress(transfer, finished + bytes)
                  )
                  finished += BigInt(entry.size)
                }
              await peer.client.commit(event.id, signal)
              transfer.phase = 'complete'
              peer.delivered = event.id
              this.notify(true)
            } catch (error) {
              this.failed(transfer, error, signal)
              // Retrying a cancelled/broken large copy automatically could fill a disk. Re-copy to retry.
              peer.delivered = event.id
              await peer.client.cancel(event.id)
            }
          })
      )
    })()
      .catch((error) => {
        if (!signal.aborted && this.last?.event.id === event.id) {
          this.error =
            error instanceof Error && error.message === 'CLIPBOARD_CHANGED'
              ? 'New copied content is already on this device; it has been kept'
              : 'Sync incomplete. Copy again'
          this.last = undefined
        }
      })
      .finally(() => {
        if (this.job === job) this.job = undefined
        this.notify(true)
      })
  }
  async stop(): Promise<void> {
    this.generation++
    this.settings = { enabled: false, files: false }
    clearInterval(this.timer)
    this.timer = undefined
    this.cycle?.abort()
    this.cancel()
    this.node.stop()
    const peers = [...this.peers.values()]
    this.peers.clear()
    this.local = undefined
    this.seen.clear()
    this.error = undefined
    await Promise.allSettled(
      peers.map((peer) =>
        peer.client.session({ enabled: false, files: false }, AbortSignal.timeout(2000))
      )
    )
  }
}
