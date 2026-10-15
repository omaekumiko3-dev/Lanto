import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { z } from 'zod'
import { readJSON, writeJSON } from '../common/json-file.ts'
import { endpointSchema, hostIdentitySchema } from '../protocol/host.ts'
import type { HostEndpoint, HostIdentity, TrustedHostView } from '../protocol/host.ts'

export interface SecretVault {
  encrypt(value: string): string
  decrypt(value: string): string
}
const recordSchema = hostIdentitySchema
  .extend({
    ...endpointSchema.shape,
    pairedAt: z.iso.datetime(),
    encryptedToken: z.string().min(1)
  })
  .strict()
type TrustedRecord = z.infer<typeof recordSchema>
const fileSchema = z
  .object({
    schemaVersion: z.literal(1),
    controllerId: z.uuid(),
    hosts: z.array(recordSchema).max(100)
  })
  .strict()

export class TrustStore {
  controllerId: string = randomUUID()
  private hosts: TrustedRecord[] = []
  private readonly file: string
  private readonly vault: SecretVault

  constructor(directory: string, vault: SecretVault) {
    this.file = join(directory, 'trusted-hosts.json')
    this.vault = vault
  }

  async load(): Promise<void> {
    const input = await readJSON(this.file)
    if (input === undefined) return
    const stored = fileSchema.parse(input)
    this.controllerId = stored.controllerId
    this.hosts = stored.hosts
  }

  requireEncryption(): void {
    this.vault.encrypt('lanto-encryption-check')
  }

  list(): TrustedHostView[] {
    return this.hosts.map(({ id, name, platform, protocolVersion, address, port, pairedAt }) => ({
      id,
      name,
      platform,
      protocolVersion,
      address,
      port,
      pairedAt
    }))
  }

  connection(id: string): { endpoint: HostEndpoint; token: string } {
    const host = this.hosts.find((entry) => entry.id === id)
    if (!host) throw new Error('This Host has not been paired')
    return {
      endpoint: { address: host.address, port: host.port, certificate: host.certificate },
      token: this.vault.decrypt(host.encryptedToken)
    }
  }

  async put(identity: HostIdentity, endpoint: HostEndpoint, token: string): Promise<void> {
    const record = recordSchema.parse({
      ...identity,
      ...endpoint,
      pairedAt: new Date().toISOString(),
      encryptedToken: this.vault.encrypt(token)
    })
    await this.persist([...this.hosts.filter((entry) => entry.id !== record.id), record])
  }

  async remove(id: string): Promise<void> {
    await this.persist(this.hosts.filter((entry) => entry.id !== id))
  }

  private async persist(hosts: TrustedRecord[]): Promise<void> {
    const contents = fileSchema.parse({ schemaVersion: 1, controllerId: this.controllerId, hosts })
    await writeJSON(this.file, contents)
    this.hosts = hosts
  }
}
