import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { readJSON, writeJSON } from '../common/json-file.ts'
import { SerialQueue } from '../common/serial-queue.ts'
import { encodeTicket } from '../protocol/pair-ticket.ts'
import type { PairRequest, PairTicket } from '../protocol/host.ts'

const controllerSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(64),
    tokenHash: z.string().length(64),
    pairedAt: z.iso.datetime()
  })
  .strict()
const controllersSchema = z.array(controllerSchema).max(100)
type Controller = z.infer<typeof controllerSchema>
const digest = (value: string) => createHash('sha256').update(value).digest()
export function secretsMatch(first: string, second: string): boolean {
  return timingSafeEqual(digest(first), digest(second))
}

export class PairingService {
  private controllers: Controller[] = []
  private pending: { hash: string; expires: number } | null = null
  private readonly queue = new SerialQueue()
  private readonly file: string

  private readonly now: () => number
  constructor(directory: string, now: () => number = Date.now) {
    this.file = join(directory, 'controllers.json')
    this.now = now
  }

  async load(): Promise<void> {
    this.controllers = controllersSchema.parse((await readJSON(this.file)) ?? [])
  }

  createTicket(endpoint: Omit<PairTicket, 'secret' | 'expiresAt' | 'protocolVersion'>): string {
    const secret = randomBytes(32).toString('base64url')
    const expires = this.now() + 5 * 60 * 1000
    this.pending = { hash: digest(secret).toString('hex'), expires }
    return encodeTicket({
      ...endpoint,
      protocolVersion: 1,
      secret,
      expiresAt: new Date(expires).toISOString()
    })
  }

  pair(request: PairRequest): Promise<string> {
    return this.queue.run(async () => {
      const grant = this.pending
      if (
        !grant ||
        grant.expires <= this.now() ||
        !timingSafeEqual(digest(request.secret), Buffer.from(grant.hash, 'hex'))
      )
        throw new Error('PAIR_REJECTED')
      const token = randomBytes(32).toString('base64url')
      const next = [
        ...this.controllers.filter((entry) => entry.id !== request.controllerId),
        {
          id: request.controllerId,
          name: request.controllerName,
          tokenHash: digest(token).toString('hex'),
          pairedAt: new Date(this.now()).toISOString()
        }
      ]
      await writeJSON(this.file, controllersSchema.parse(next))
      this.controllers = next
      if (this.pending === grant) this.pending = null
      return token
    })
  }

  authenticate(token: string): Controller | undefined {
    if (token.length !== 43) return undefined
    const hash = digest(token)
    return this.controllers.find((entry) =>
      timingSafeEqual(hash, Buffer.from(entry.tokenHash, 'hex'))
    )
  }

  list(): Omit<Controller, 'tokenHash'>[] {
    return this.controllers.map(({ id, name, pairedAt }) => ({ id, name, pairedAt }))
  }

  revoke(id: string): Promise<void> {
    return this.queue.run(async () => {
      const next = this.controllers.filter((entry) => entry.id !== id)
      await writeJSON(this.file, next)
      this.controllers = next
    })
  }
}
