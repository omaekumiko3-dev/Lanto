import { X509Certificate } from 'node:crypto'
import { request } from 'node:https'
import type { RequestOptions } from 'node:https'
import type { HostEndpoint } from './host.ts'

export class HostRequestError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

export function hostRequestOptions(endpoint: HostEndpoint): RequestOptions {
  const expected = new X509Certificate(endpoint.certificate).fingerprint256
  return {
    hostname: endpoint.address.replace(/^\[|\]$/g, ''),
    port: endpoint.port,
    ca: endpoint.certificate,
    rejectUnauthorized: true,
    minVersion: 'TLSv1.2',
    agent: false,
    checkServerIdentity: (_host, peer) =>
      peer.fingerprint256 === expected
        ? undefined
        : Object.assign(new Error('Host certificate mismatch; verify the device identity again'), {
            code: 'ERR_LANTO_HOST_IDENTITY'
          })
  }
}

export async function hostRequest(
  endpoint: HostEndpoint,
  path: string,
  options: {
    method?: string
    body?: unknown
    token?: string
    signal?: AbortSignal
    maxBytes?: number
    timeout?: number
  } = {}
): Promise<unknown> {
  const body = options.body === undefined ? undefined : JSON.stringify(options.body)
  return new Promise((resolve, reject) => {
    const request_ = request(
      {
        ...hostRequestOptions(endpoint),
        signal: options.signal,
        path,
        method: options.method || 'GET',
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
          if (bytes > (options.maxBytes ?? 32768)) {
            request_.destroy(new Error('Host response is too large'))
            return
          }
          chunks.push(chunk)
        })
        response.once('error', reject)
        response.once('end', () => {
          if (response.statusCode !== 200) {
            const messages: Record<number, string> = {
              401: 'Host authorization is invalid or revoked',
              403: 'Host rejected this operation',
              409: 'Pairing ticket is invalid, expired, or already used',
              429: 'Too many requests; retry later'
            }
            reject(
              new HostRequestError(
                messages[response.statusCode || 0] ||
                  `Host request failed (${response.statusCode}）`,
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
      () =>
        request_.destroy(
          Object.assign(new Error('Host request timed out; check the address and network'), {
            code: 'ETIMEDOUT'
          })
        ),
      options.timeout ?? 5000
    )
    request_.once('close', () => clearTimeout(deadline))
    request_.once('error', (error) => reject(error))
    request_.end(body)
  })
}
