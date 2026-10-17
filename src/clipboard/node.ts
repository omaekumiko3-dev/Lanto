import { randomUUID } from 'node:crypto'
import { SerialQueue } from '../common/serial-queue.ts'
import type { ClipboardEvent, ClipboardState } from '../protocol/clipboard.ts'
import type { DesktopClipboard, NativeContent } from './native.ts'
import { createOffer } from './files.ts'
import type { FileOffer, SharedFile } from './files.ts'

export class ClipboardNode {
  private readonly native: DesktopClipboard
  private readonly queue = new SerialQueue()
  private revision?: string
  private generation = 0
  private event: ClipboardEvent | null = null
  private offer?: FileOffer
  constructor(native: DesktopClipboard) {
    this.native = native
  }
  async read(files: boolean): Promise<ClipboardState> {
    const generation = this.generation
    return this.queue.run(async () => {
      if (generation !== this.generation) throw new Error('Clipboard synchronization stopped')
      const snapshot = await this.native.read(this.revision)
      if (generation !== this.generation) throw new Error('Clipboard synchronization stopped')
      const initial = this.revision === undefined
      this.revision = snapshot.revision
      if (snapshot.content) {
        if (!initial) {
          this.event = null
          this.offer = undefined
          if (snapshot.content.kind === 'files') {
            if (files) {
              const offer = await createOffer(randomUUID(), snapshot.content.paths)
              if (generation !== this.generation)
                throw new Error('Clipboard synchronization stopped')
              this.offer = offer
              this.event = this.offer.event
            }
          } else this.event = { id: randomUUID(), ...snapshot.content }
        }
      }
      if (!files && this.event?.kind === 'files') {
        this.event = null
        this.offer = undefined
      }
      return { revision: this.revision, event: this.event }
    })
  }
  async apply(
    event: ClipboardEvent,
    expected: string,
    paths?: string[],
    signal?: AbortSignal
  ): Promise<void> {
    const generation = this.generation
    await this.queue.run(async () => {
      if (generation !== this.generation) throw new Error('Clipboard synchronization stopped')
      signal?.throwIfAborted()
      const content: NativeContent =
        event.kind === 'files'
          ? { kind: 'files', paths: paths! }
          : event.kind === 'text'
            ? { kind: 'text', text: event.text }
            : event.kind === 'image'
              ? { kind: 'image', png: event.png }
              : { kind: 'empty' }
      const generated = event.kind === 'files' ? await createOffer(event.id, paths!) : undefined
      let offer: FileOffer | undefined
      if (generated && event.kind === 'files') {
        const indices = new Map(generated.event.entries.map((entry, index) => [entry.path, index]))
        const sources = new Map<number, SharedFile>()
        for (const [index, entry] of event.entries.entries())
          if (entry.kind === 'file') {
            const source = generated.sources.get(indices.get(entry.path) ?? -1)
            if (!source || source.size.toString() !== entry.size)
              throw new Error('The received file manifest does not match')
            sources.set(index, source)
          }
        offer = { event, sources }
      }
      if (generation !== this.generation) throw new Error('Clipboard synchronization stopped')
      signal?.throwIfAborted()
      const revision = await this.native.write(content, expected)
      if (generation !== this.generation) throw new Error('Clipboard synchronization stopped')
      this.revision = revision
      this.event = event
      this.offer = offer
    })
  }
  source(id: string, index: number): SharedFile {
    const source = this.offer?.event.id === id ? this.offer.sources.get(index) : undefined
    if (!source) throw new Error('The copied content expired; copy it again')
    return source
  }
  stop(): void {
    this.generation++
    this.native.close()
    this.revision = undefined
    this.event = null
    this.offer = undefined
  }
}
