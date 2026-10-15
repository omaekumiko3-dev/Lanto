import { X509Certificate } from 'node:crypto'
import { request } from 'node:https'
import type { HostEndpoint } from './host.ts'

export class HostRequestError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export async function hostRequest(
  endpoint: HostEndpoint,
  path: string,
  options: {
    method?: string
    body?: unknown
    token?: string
  } = {}
): Promise<unknown> {
  const expected = new X509Certificate(endpoint.certificate).fingerprint256
  const body = options.body === undefined ? undefined : JSON.stringify(options.body)
  return new Promise((resolve, reject) => {
    const request_ = request(
      {
        hostname: endpoint.address.replace(/^\[|\]$/g, ''),
        port: endpoint.port,
        path,
        method: options.method || 'GET',
        ca: endpoint.certificate,
        rejectUnauthorized: true,
        minVersion: 'TLSv1.2',
        agent: false,
        checkServerIdentity: (_host, peer) =>
          peer.fingerprint256 === expected
            ? undefined
            : new Error('Host certificate does not match. Confirm the device identity again'),
        headers: {
          ...(body
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            : {}),
          ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
        }
      },
      (response) => {
        const chunks: Buffer[] = []
        let bytes = 0
        response.on('data', (chunk: Buffer) => {
          bytes += chunk.length
          if (bytes > 32768) {
            request_.destroy(new Error('Host response is too large'))
            return
          }
          chunks.push(chunk)
        })
        response.once('error', reject)
        response.once('end', () => {
          if (response.statusCode !== 200) {
            const messages: Record<number, string> = {
              401: 'Host authorization is invalid or has been revoked',
              403: 'Host rejected this operation',
              409: 'Pairing credentials are invalid, expired, or already used',
              429: 'Too many requests. Try again later'
            }
            reject(
              new HostRequestError(
                messages[response.statusCode || 0] || `Host request failed (${response.statusCode}）`,
                response.statusCode || 0
              )
            )
            return
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown)
          } catch {
            reject(new Error('Host returned invalid data'))
          }
        })
      }
    )
    const deadline = setTimeout(
      () => request_.destroy(new Error('Host request timed out. Check the address and network')),
      5000
    )
    request_.once('close', () => clearTimeout(deadline))
    request_.once('error', (error) => reject(error))
    request_.end(body)
  })
}
