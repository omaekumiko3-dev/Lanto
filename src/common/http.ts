import type { IncomingMessage, ServerResponse } from 'node:http'

export class HTTPError extends Error {
  readonly status: number
  constructor(status: number, message = 'request rejected') {
    super(message)
    this.status = status
  }
}
export function send(response: ServerResponse, value: unknown, status = 200) {
  response.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  })
  response.end(JSON.stringify(value))
}
export async function readBody(request: IncomingMessage, limit = 16384): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json')
    throw new HTTPError(415)
  let bytes = 0
  const chunks: Buffer[] = []
  for await (const chunk of request) {
    bytes += chunk.length
    if (bytes > limit) throw new HTTPError(413)
    chunks.push(Buffer.from(chunk))
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
  } catch {
    throw new HTTPError(400)
  }
}
