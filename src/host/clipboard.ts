import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import { HTTPError, readBody, send } from '../common/http.ts'
import { ClipboardNode } from '../clipboard/node.ts'
import type { DesktopClipboard } from '../clipboard/native.ts'
import { IncomingFiles, streamSharedFile } from '../clipboard/files.ts'
import {
  CLIPBOARD_JSON_LIMIT,
  clipboardApplySchema,
  clipboardSessionSchema
} from '../protocol/clipboard.ts'

export class HostClipboard {
  private readonly node: ClipboardNode
  private readonly directory: string
  private readonly leases = new Map<
    string,
    { expires: number; files: boolean; controller: AbortController }
  >()
  private readonly incoming = new Map<
    string,
    { owner: string; files: IncomingFiles; expires: number }
  >()
  private readonly timer: NodeJS.Timeout
  constructor(native: DesktopClipboard, directory: string) {
    this.node = new ClipboardNode(native)
    this.directory = directory
    this.timer = setInterval(() => {
      void this.expire()
    }, 1000)
    this.timer.unref()
  }
  private async expire(): Promise<void> {
    for (const [id, lease] of this.leases) if (lease.expires < Date.now()) await this.revoke(id)
    for (const [id, value] of this.incoming)
      if (value.expires < Date.now()) {
        this.incoming.delete(id)
        await value.files.cancel().catch(() => {})
      }
  }
  async revoke(id: string): Promise<void> {
    this.leases.get(id)?.controller.abort()
    this.leases.delete(id)
    for (const [key, value] of this.incoming)
      if (value.owner === id) {
        this.incoming.delete(key)
        await value.files.cancel().catch(() => {})
      }
    if (!this.leases.size) this.node.stop()
  }
  private requireLease(owner: string, files = false) {
    const lease = this.leases.get(owner)
    if (!lease || lease.expires < Date.now() || (files && !lease.files)) throw new HTTPError(403)
    return lease
  }
  async route(owner: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url!, 'https://lanto.invalid')
    const path = url.pathname.slice('/v1/clipboard/'.length)
    if (path === 'session' && request.method === 'POST') {
      const settings = clipboardSessionSchema.parse(await readBody(request))
      if (!settings.enabled) {
        await this.revoke(owner)
        send(response, { ok: true })
        return
      }
      const previous = this.leases.get(owner)
      if (previous?.files && !settings.files) await this.revoke(owner)
      this.leases.set(owner, {
        expires: Date.now() + 12000,
        files: settings.files,
        controller: this.leases.get(owner)?.controller || new AbortController()
      })
      send(response, { ok: true })
      return
    }
    const lease = this.requireLease(owner)
    if (path === 'state' && request.method === 'GET') {
      try {
        const state = await this.node.read([...this.leases.values()].some((value) => value.files))
        this.requireLease(owner)
        send(response, {
          ...state,
          event:
            state.event?.id === url.searchParams.get('after') ||
            (state.event?.kind === 'files' && !lease.files)
              ? null
              : state.event
        })
      } catch {
        send(response, {
          revision: '',
          event: null,
          error:
            'Desktop clipboard unavailable; sign in to the desktop and make sure the clipboard component is running'
        })
      }
      return
    }
    if (path === 'apply' && request.method === 'POST') {
      const input = clipboardApplySchema.parse(await readBody(request, CLIPBOARD_JSON_LIMIT))
      this.requireLease(owner)
      if (input.event.kind === 'files') throw new HTTPError(400)
      try {
        await this.node.apply(input.event, input.expected, undefined, lease.controller.signal)
      } catch (error) {
        if (error instanceof Error && error.message === 'CLIPBOARD_CHANGED')
          throw new HTTPError(409)
        throw error
      }
      send(response, { ok: true })
      return
    }
    if (path === 'incoming' && request.method === 'POST') {
      const input = clipboardApplySchema.parse(await readBody(request, CLIPBOARD_JSON_LIMIT))
      this.requireLease(owner, true)
      if (input.event.kind !== 'files') throw new HTTPError(400)
      if (this.incoming.has(input.event.id)) throw new HTTPError(409)
      for (const [id, value] of this.incoming)
        if (value.owner === owner) {
          this.incoming.delete(id)
          await value.files.cancel()
        }
      if (this.incoming.size >= 4) throw new HTTPError(429)
      const files = await IncomingFiles.create(this.directory, input.event, input.expected)
      if (lease.controller.signal.aborted) {
        await files.cancel()
        throw new HTTPError(403)
      }
      this.incoming.set(input.event.id, { owner, files, expires: Date.now() + 120000 })
      send(response, { ok: true })
      return
    }
    const download = /^files\/([a-f0-9-]{36})\/(\d+)$/.exec(path)
    if (download && request.method === 'GET') {
      this.requireLease(owner, true)
      const source = this.node.source(z.uuid().parse(download[1]), Number(download[2]))
      const disconnected = new AbortController()
      response.once('close', () => {
        if (!response.writableFinished) disconnected.abort()
      })
      response.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Cache-Control': 'no-store',
        Trailer: 'X-Lanto-SHA256'
      })
      const hash = await streamSharedFile(
        source,
        response,
        AbortSignal.any([lease.controller.signal, disconnected.signal])
      )
      response.addTrailers({ 'X-Lanto-SHA256': hash })
      response.end()
      return
    }
    const transfer = /^incoming\/([a-f0-9-]{36})(?:\/files\/(\d+)|\/(commit))?$/.exec(path)
    if (transfer) {
      this.requireLease(owner, true)
      const id = z.uuid().parse(transfer[1])
      const value = this.incoming.get(id)
      if (!value || value.owner !== owner) throw new HTTPError(404)
      if (request.method === 'DELETE' && !transfer[2] && !transfer[3]) {
        this.incoming.delete(id)
        await value.files.cancel()
        send(response, { ok: true })
        return
      }
      if (request.method === 'PUT' && transfer[2] !== undefined) {
        if (request.headers['content-type'] !== 'application/octet-stream') throw new HTTPError(415)
        value.expires = Infinity
        try {
          const hash = await value.files.receive(
            Number(transfer[2]),
            request,
            lease.controller.signal
          )
          send(response, { sha256: hash })
        } finally {
          value.expires = Date.now() + 120000
        }
        return
      }
      if (request.method === 'POST' && transfer[3]) {
        try {
          await this.node.apply(
            value.files.event,
            value.files.expected,
            value.files.paths(),
            lease.controller.signal
          )
          value.files.finish()
          this.incoming.delete(id)
          send(response, { ok: true })
        } catch (error) {
          this.incoming.delete(id)
          await value.files.cancel()
          if (error instanceof Error && error.message === 'CLIPBOARD_CHANGED')
            throw new HTTPError(409)
          throw error
        }
        return
      }
    }
    throw new HTTPError(404)
  }
  async close(): Promise<void> {
    clearInterval(this.timer)
    for (const owner of this.leases.keys()) await this.revoke(owner)
    this.node.stop()
  }
}
