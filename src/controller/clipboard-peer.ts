import { request } from 'node:https'
import type { IncomingMessage } from 'node:http'
import { hostRequest, HostRequestError, hostRequestOptions } from '../protocol/request.ts'
import type { HostEndpoint } from '../protocol/host.ts'
import { CLIPBOARD_JSON_LIMIT, clipboardStateSchema } from '../protocol/clipboard.ts'
import type {
  ClipboardEvent,
  ClipboardSettings,
  ClipboardState,
  FileEvent
} from '../protocol/clipboard.ts'
import { streamSharedFile } from '../clipboard/files.ts'
import type { IncomingFiles, SharedFile } from '../clipboard/files.ts'

export class ClipboardPeer {
  private readonly endpoint: HostEndpoint
  private readonly token: string
  constructor(connection: { endpoint: HostEndpoint; token: string }) {
    this.endpoint = connection.endpoint
    this.token = connection.token
  }
  private json(path: string, signal: AbortSignal, method = 'GET', body?: unknown) {
    return hostRequest(this.endpoint, '/v1/clipboard/' + path, {
      token: this.token,
      method,
      body,
      signal,
      maxBytes: CLIPBOARD_JSON_LIMIT,
      timeout: 15000
    })
  }
  async session(settings: ClipboardSettings, signal: AbortSignal): Promise<void> {
    await this.json('session', signal, 'POST', settings)
  }
  async state(after: string | undefined, signal: AbortSignal): Promise<ClipboardState> {
    return clipboardStateSchema.parse(
      await this.json('state' + (after ? '?after=' + encodeURIComponent(after) : ''), signal)
    )
  }
  async apply(event: ClipboardEvent, expected: string, signal: AbortSignal): Promise<void> {
    await this.json('apply', signal, 'POST', { event, expected })
  }
  async begin(event: FileEvent, expected: string, signal: AbortSignal): Promise<void> {
    await this.json('incoming', signal, 'POST', { event, expected })
  }
  async commit(id: string, signal: AbortSignal): Promise<void> {
    await this.json(`incoming/${id}/commit`, signal, 'POST')
  }
  async cancel(id: string): Promise<void> {
    await this.json(`incoming/${id}`, AbortSignal.timeout(2500), 'DELETE').catch(() => {})
  }

  private binary(path: string, method: string, signal: AbortSignal, size?: bigint) {
    const req = request({
      ...hostRequestOptions(this.endpoint),
      path: '/v1/clipboard/' + path,
      method,
      signal,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(size === undefined
          ? {}
          : { 'Content-Type': 'application/octet-stream', 'Content-Length': size.toString() })
      }
    })
    req.setTimeout(30000, () => req.destroy(new Error('File transfer interrupted: network has not responded for more than 30 seconds')))
    const response = new Promise<IncomingMessage>((resolve, reject) => {
      req.once('response', (res) => {
        if (res.statusCode !== 200) {
          res.resume()
          reject(new HostRequestError(`File transfer failed (${res.statusCode}）`, res.statusCode || 0))
          req.destroy()
          return
        }
        resolve(res)
      })
      req.once('error', reject)
    })
    void response.catch(() => {})
    return { req, response }
  }
  async download(
    id: string,
    index: number,
    incoming: IncomingFiles,
    signal: AbortSignal,
    progress: (bytes: bigint) => void
  ): Promise<void> {
    const { req, response } = this.binary(`files/${id}/${index}`, 'GET', signal)
    req.end()
    try {
      const res = await response
      const hash = await incoming.receive(index, res, signal, progress)
      if (res.trailers['x-lanto-sha256'] !== hash) throw new Error('File verification failed; copy it again')
    } catch (error) {
      req.destroy()
      throw error
    }
  }
  async upload(
    id: string,
    index: number,
    source: SharedFile,
    signal: AbortSignal,
    progress: (bytes: bigint) => void
  ): Promise<void> {
    const { req, response } = this.binary(
      `incoming/${id}/files/${index}`,
      'PUT',
      signal,
      source.size
    )
    try {
      const hash = await streamSharedFile(source, req, signal, progress)
      req.end()
      const res = await response
      let body = ''
      for await (const chunk of res) {
        body += String(chunk)
        if (body.length > 1024) throw new Error('Invalid file verification response')
      }
      if ((JSON.parse(body) as { sha256?: string }).sha256 !== hash)
        throw new Error('File verification failed; copy it again')
    } catch (error) {
      req.destroy()
      throw error
    }
  }
}
