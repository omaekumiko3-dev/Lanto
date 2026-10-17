import { hostname } from 'node:os'
import { decodeTicket } from '../protocol/pair-ticket.ts'
import { hostRequest, HostRequestError } from '../protocol/request.ts'
import { hostStatusSchema, pairResponseSchema } from '../protocol/host.ts'
import type { TrustedHostView } from '../protocol/host.ts'
import { TrustStore } from './trust-store.ts'

export class HostClient {
  private readonly trust: TrustStore
  private readonly states = new Map<string, Pick<TrustedHostView, 'status' | 'error'>>()

  constructor(trust: TrustStore) {
    this.trust = trust
  }

  list(): TrustedHostView[] {
    return this.trust.list().map((entry) => ({ ...entry, ...this.states.get(entry.id) }))
  }

  async pair(input: string): Promise<TrustedHostView> {
    const ticket = decodeTicket(input)
    this.trust.requireEncryption()
    const endpoint = { address: ticket.address, port: ticket.port, certificate: ticket.certificate }
    const response = pairResponseSchema.parse(
      await hostRequest(endpoint, '/v1/pair', {
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
    return this.refresh(response.identity.id)
  }

  async refresh(id: string): Promise<TrustedHostView> {
    const existing = this.trust.list().find((entry) => entry.id === id)
    if (!existing) throw new Error('This Host is not paired')
    let state: Pick<TrustedHostView, 'status' | 'error'>
    try {
      const { endpoint, token } = this.trust.connection(id)
      const status = hostStatusSchema.parse(await hostRequest(endpoint, '/v1/status', { token }))
      if (status.identity.id !== id) throw new Error('Host identity changed; pair it again')
      state = { status }
    } catch {
      state = {
        error: 'Host is unreachable or authorization expired; check the network and Host status'
      }
    }
    if (this.trust.list().some((entry) => entry.id === id && entry.address === existing.address))
      this.states.set(id, state)
    return this.list().find((entry) => entry.id === id)!
  }

  async updateAddress(id: string, address: string): Promise<void> {
    await this.trust.updateAddress(id, address)
    this.states.delete(id)
  }

  async unpair(id: string): Promise<void> {
    if (!this.trust.list().some((entry) => entry.id === id)) return
    const { endpoint, token } = this.trust.connection(id)
    try {
      await hostRequest(endpoint, '/v1/pair', { method: 'DELETE', token })
    } catch (error) {
      if (!(error instanceof HostRequestError) || error.status !== 401) throw error
    }
    await this.trust.remove(id)
    this.states.delete(id)
  }
}
