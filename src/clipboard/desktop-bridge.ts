import { createServer, request } from 'node:http'
import type { IncomingMessage, ServerResponse, ClientRequest } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { readFile, unlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { writeJSON } from '../common/json-file.ts'
import { HTTPError, send } from '../common/http.ts'
import { NativeClipboard } from './native.ts'
import { HostClipboard } from '../host/clipboard.ts'

const connectionSchema = z
  .object({ port: z.number().int().min(1).max(65535), token: z.string().length(43) })
  .strict()

// Windows services live in session 0. Keep the LAN listener unprivileged and proxy only
// authenticated clipboard operations to the logged-in desktop user over loopback.
export class DesktopBridge {
  private readonly directory: string
  private readonly requests = new Set<ClientRequest>()
  private readonly owners = new Set<string>()
  constructor(directory: string) {
    this.directory = directory
  }
  private async connection() {
    try {
      return connectionSchema.parse(
        JSON.parse(await readFile(join(this.directory, 'session.json'), 'utf8'))
      )
    } catch {
      throw new HTTPError(503, 'Start the Lanto Clipboard login task')
    }
  }
  async route(owner: string, input: IncomingMessage, output: ServerResponse): Promise<void> {
    const connection = await this.connection()
    this.owners.add(owner)
    await new Promise<void>((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port: connection.port,
          path: input.url,
          method: input.method,
          headers: {
            Authorization: `Bearer ${connection.token}`,
            'X-Lanto-Controller': owner,
            ...(input.headers['content-type']
              ? { 'Content-Type': input.headers['content-type'] }
              : {}),
            ...(input.headers['content-length']
              ? { 'Content-Length': input.headers['content-length'] }
              : {})
          }
        },
        (response) => {
          const headers: Record<string, string> = { 'Cache-Control': 'no-store' }
          for (const name of ['content-type', 'content-length', 'trailer'])
            if (typeof response.headers[name] === 'string') headers[name] = response.headers[name]
          output.writeHead(response.statusCode || 503, headers)
          response.pipe(output, { end: false })
          response.on('end', () => {
            output.addTrailers(response.trailers)
            output.end()
            resolve()
          })
          response.on('error', reject)
          response.on('aborted', () =>
            reject(new Error('The desktop clipboard component disconnected'))
          )
        }
      )
      this.requests.add(req)
      req.setTimeout(30000, () =>
        req.destroy(new Error('The desktop clipboard component connection timed out'))
      )
      req.once('error', reject)
      req.once('close', () => this.requests.delete(req))
      input.once('aborted', () => req.destroy())
      output.once('close', () => {
        if (!output.writableFinished) req.destroy()
      })
      input.pipe(req)
    })
  }
  async revoke(owner: string): Promise<void> {
    this.owners.delete(owner)
    try {
      const connection = await this.connection()
      await new Promise<void>((resolve) => {
        const data = JSON.stringify({ enabled: false, files: false })
        const req = request(
          {
            hostname: '127.0.0.1',
            port: connection.port,
            path: '/v1/clipboard/session',
            method: 'POST',
            signal: AbortSignal.timeout(2000),
            headers: {
              Authorization: `Bearer ${connection.token}`,
              'X-Lanto-Controller': owner,
              'Content-Type': 'application/json',
              'Content-Length': Buffer.byteLength(data)
            }
          },
          (response) => {
            response.resume()
            response.once('end', resolve)
          }
        )
        req.once('error', () => resolve())
        req.end(data)
      })
    } catch {
      /* The agent also expires leases if the service exits. */
    }
  }
  async close(): Promise<void> {
    for (const req of this.requests) req.destroy()
    await Promise.allSettled([...this.owners].map((owner) => this.revoke(owner)))
  }
}

export async function startDesktopBridge(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const clipboard = new HostClipboard(
    new NativeClipboard(join(directory, 'native')),
    join(directory, 'received')
  )
  const token = randomBytes(32).toString('base64url')
  const file = join(directory, 'session.json')
  const server = createServer((request, response) => {
    void (async () => {
      const supplied = request.headers.authorization?.replace(/^Bearer /, '') || ''
      if (
        request.headers.origin ||
        supplied.length !== token.length ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(token))
      )
        throw new HTTPError(403)
      const owner = z.uuid().parse(request.headers['x-lanto-controller'])
      if (!request.url?.startsWith('/v1/clipboard/')) throw new HTTPError(404)
      await clipboard.route(owner, request, response)
    })().catch((error) => {
      if (response.destroyed) return
      if (response.headersSent) {
        response.destroy()
        return
      }
      send(
        response,
        { error: 'clipboard_unavailable' },
        error instanceof HTTPError ? error.status : error instanceof z.ZodError ? 400 : 503
      )
    })
  })
  server.headersTimeout = 5000
  server.requestTimeout = 0
  server.maxConnections = 24
  server.setTimeout(30000, (socket) => socket.destroy())
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string')
    throw new Error('The clipboard component could not start')
  await writeJSON(file, { port: address.port, token })
  return {
    async close() {
      await clipboard.close()
      server.closeAllConnections()
      await new Promise<void>((resolve) => server.close(() => resolve()))
      const current = await readFile(file, 'utf8').catch(() => '')
      if (current && JSON.parse(current).token === token) await unlink(file)
    }
  }
}
