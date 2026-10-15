import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer } from 'node:https'
import { z } from 'zod'
import { pairRequestSchema } from '../protocol/host.ts'
import type { HostStatus } from '../protocol/host.ts'
import type { HostConfig } from './config.ts'
import { PairingService, secretsMatch } from './pairing.ts'

class HTTPError extends Error {
  readonly status: number
  constructor(status: number) {
    super('request rejected')
    this.status = status
  }
}
function send(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(JSON.stringify(value))
}
async function body(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json')
    throw new HTTPError(415)
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > 16384) throw new HTTPError(413)
    chunks.push(Buffer.from(chunk))
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new HTTPError(400)
  }
}

export function createHostServer(options: {
  config: HostConfig
  pairing: PairingService
  createTicket: () => string
  status: () => Promise<HostStatus>
}) {
  const { config, pairing } = options
  const attempts = new Map<string, { count: number; until: number }>()
  async function route(request: IncomingMessage, response: ServerResponse) {
    if (request.headers.origin) throw new HTTPError(403)
    const path = request.url
    const token = request.headers.authorization?.replace(/^Bearer /, '') || ''
    if (request.method === 'GET' && path === '/v1/identity') return send(response, config.identity)
    if (request.method === 'POST' && path === '/v1/pair') {
      const address = request.socket.remoteAddress || ''
      const now = Date.now()
      for (const [key, value] of attempts) if (value.until < now) attempts.delete(key)
      const attempt = attempts.get(address) || { count: 0, until: now + 60000 }
      if ((attempts.size >= 128 && !attempts.has(address)) || attempt.count >= 10)
        throw new HTTPError(429)
      attempt.count++
      attempts.set(address, attempt)
      const input = pairRequestSchema.parse(await body(request))
      let issued: string
      try {
        issued = await pairing.pair(input)
      } catch (error) {
        if (error instanceof Error && error.message === 'PAIR_REJECTED') throw new HTTPError(409)
        throw error
      }
      return send(response, { identity: config.identity, token: issued })
    }
    if (path?.startsWith('/admin/')) {
      const local = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(
        request.socket.remoteAddress || ''
      )
      if (!local || !secretsMatch(token, config.adminToken)) throw new HTTPError(403)
      if (request.method === 'POST' && path === '/admin/pair')
        return send(response, { ticket: options.createTicket() })
      if (request.method === 'GET' && path === '/admin/controllers')
        return send(response, pairing.list())
      if (request.method === 'POST' && path === '/admin/revoke') {
        const input = z
          .object({ id: z.uuid() })
          .strict()
          .parse(await body(request))
        await pairing.revoke(input.id)
        return send(response, { ok: true })
      }
      if (request.method === 'GET' && path === '/admin/status')
        return send(response, await options.status())
      throw new HTTPError(404)
    }
    const controller = pairing.authenticate(token)
    if (!controller) throw new HTTPError(401)
    if (request.method === 'GET' && path === '/v1/status')
      return send(response, await options.status())
    if (request.method === 'DELETE' && path === '/v1/pair') {
      await pairing.revoke(controller.id)
      return send(response, { ok: true })
    }
    throw new HTTPError(404)
  }
  const server = createServer(
    {
      key: config.privateKey,
      cert: config.certificate,
      minVersion: 'TLSv1.2',
      maxHeaderSize: 8192
    },
    (request, response) => {
      void route(request, response).catch((error: unknown) => {
        if (response.destroyed || response.headersSent) return
        const status =
          error instanceof HTTPError ? error.status : error instanceof z.ZodError ? 400 : 500
        send(response, { error: 'request_rejected' }, status)
      })
    }
  )
  server.maxConnections = 32
  server.requestTimeout = 5000
  server.headersTimeout = 5000
  server.on('tlsClientError', () => {})
  return server
}
