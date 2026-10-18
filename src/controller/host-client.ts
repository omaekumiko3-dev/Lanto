import { hostname } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { decodeTicket } from '../protocol/pair-ticket.ts'
import { hostRequest, HostRequestError } from '../protocol/request.ts'
import { hostStatusSchema, pairResponseSchema } from '../protocol/host.ts'
import type { HostErrorKind, TrustedHostView } from '../protocol/host.ts'
import { TrustStore } from './trust-store.ts'
import { hostErrorMessages } from '../shared/host-errors.ts'

type HostState = Pick<TrustedHostView, 'status' | 'error' | 'errorKind'>
interface HostClientOptions {
  request?: typeof hostRequest
  retryDelays?: readonly number[]
  pollIntervalMs?: number
  requestTimeoutMs?: number
}

function failure(error: unknown): HostState {
  const code = (error as NodeJS.ErrnoException | undefined)?.code ?? ''
  let errorKind: HostErrorKind = 'service'
  if (error instanceof HostRequestError && [401, 403].includes(error.status))
    errorKind = 'authorization'
  else if (code === 'ERR_LANTO_HOST_IDENTITY' || /CERT|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code))
    errorKind = 'identity'
  else if (
    [
      'ECONNREFUSED',
      'ECONNRESET',
      'ECONNABORTED',
      'ENETUNREACH',
      'EHOSTUNREACH',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
      'EPIPE'
    ].includes(code)
  )
    errorKind = 'network'
  return { errorKind, error: hostErrorMessages[errorKind] }
}

export class HostClient {
  private readonly trust: TrustStore
  private readonly states = new Map<string, HostState>()
  private readonly pending = new Map<
    string,
    { abort: AbortController; promise: Promise<TrustedHostView> }
  >()
  private readonly request: typeof hostRequest
  private readonly retryDelays: readonly number[]
  private readonly pollIntervalMs: number
  private readonly requestTimeoutMs: number
  private timer?: ReturnType<typeof setTimeout>
  private changed?: () => void
  private closed = false

  constructor(trust: TrustStore, options: HostClientOptions = {}) {
    this.trust = trust
    this.request = options.request ?? hostRequest
    this.retryDelays = options.retryDelays ?? [400, 1000]
    this.pollIntervalMs = options.pollIntervalMs ?? 5000
    this.requestTimeoutMs = options.requestTimeoutMs ?? 3500
  }

  list(): TrustedHostView[] {
    return this.trust.list().map((entry) => ({ ...entry, ...this.states.get(entry.id) }))
  }

  async pair(input: string): Promise<TrustedHostView> {
    const ticket = decodeTicket(input)
    this.trust.requireEncryption()
    const endpoint = { address: ticket.address, port: ticket.port, certificate: ticket.certificate }
    const response = pairResponseSchema.parse(
      await this.request(endpoint, '/v1/pair', {
        method: 'POST',
        body: {
          secret: ticket.secret,
          controllerId: this.trust.controllerId,
          controllerName: hostname().slice(0, 64)
        }
      })
    )
    if (response.identity.id !== ticket.hostId)
      throw new Error('Host identity does not match the pairing ticket')
    await this.trust.put(response.identity, endpoint, response.token)
    this.invalidate(response.identity.id)
    return this.refresh(response.identity.id)
  }

  refresh(id: string): Promise<TrustedHostView> {
    if (this.closed) return Promise.reject(new Error('Host client is closed'))
    const running = this.pending.get(id)
    if (running) return running.promise
    const abort = new AbortController()
    const promise = this.readState(id, abort.signal).finally(() => {
      if (this.pending.get(id)?.abort === abort) this.pending.delete(id)
    })
    this.pending.set(id, { abort, promise })
    return promise
  }

  private async readState(id: string, signal: AbortSignal): Promise<TrustedHostView> {
    const existing = this.trust.list().find((entry) => entry.id === id)
    if (!existing) throw new Error('This Host is not paired')
    let state: HostState = {}
    for (let attempt = 0; ; attempt++) {
      try {
        const { endpoint, token } = this.trust.connection(id)
        const status = hostStatusSchema.parse(
          await this.request(endpoint, '/v1/status', {
            token,
            signal,
            timeout: this.requestTimeoutMs
          })
        )
        if (status.identity.id !== id)
          throw Object.assign(new Error('Host identity changed'), {
            code: 'ERR_LANTO_HOST_IDENTITY'
          })
        state = { status }
        break
      } catch (error) {
        signal.throwIfAborted()
        state = failure(error)
        const wait = this.retryDelays[attempt]
        // Never retry authorization or certificate failures as if they were packet loss.
        if (state.errorKind !== 'network' || wait === undefined) break
        await delay(wait, undefined, { signal })
      }
    }
    signal.throwIfAborted()
    if (
      !this.closed &&
      this.trust.list().some((entry) => entry.id === id && entry.address === existing.address)
    ) {
      const changed = JSON.stringify(this.states.get(id)) !== JSON.stringify(state)
      this.states.set(id, state)
      if (changed) this.changed?.()
    }
    const current = this.list().find((entry) => entry.id === id)
    if (!current) throw new Error('This Host is no longer paired')
    return current
  }

  /** Refresh saved devices without waiting for another click after the network recovers. */
  startMonitoring(changed: () => void): void {
    if (this.closed || this.changed) return
    this.changed = changed
    const tick = async () => {
      await Promise.allSettled(this.trust.list().map((entry) => this.refresh(entry.id)))
      if (!this.closed) {
        this.timer = setTimeout(() => void tick(), this.pollIntervalMs)
        this.timer.unref()
      }
    }
    void tick()
  }

  private invalidate(id: string): void {
    this.pending.get(id)?.abort.abort()
    this.pending.delete(id)
    this.states.delete(id)
  }

  close(): void {
    this.closed = true
    clearTimeout(this.timer)
    this.changed = undefined
    for (const pending of this.pending.values()) pending.abort.abort()
    this.pending.clear()
  }

  async updateAddress(id: string, address: string): Promise<void> {
    await this.trust.updateAddress(id, address)
    this.invalidate(id)
  }

  async unpair(id: string): Promise<void> {
    if (!this.trust.list().some((entry) => entry.id === id)) return
    const { endpoint, token } = this.trust.connection(id)
    try {
      await this.request(endpoint, '/v1/pair', { method: 'DELETE', token })
    } catch (error) {
      if (!(error instanceof HostRequestError) || error.status !== 401) throw error
    }
    await this.trust.remove(id)
    this.invalidate(id)
  }
}
