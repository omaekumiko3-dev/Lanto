import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { hostname, networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { generate } from 'selfsigned'
import { z } from 'zod'
import { readJSON } from '../common/json-file.ts'
import { HOST_PORT, hostIdentitySchema } from '../protocol/host.ts'
import type { HostIdentity } from '../protocol/host.ts'

const hostConfigSchema = z
  .object({
    identity: hostIdentitySchema,
    listen: z.enum(['0.0.0.0', '127.0.0.1', '::', '::1']),
    address: z.string().min(1).max(253),
    port: z.number().int().min(0).max(65535),
    certificate: z.string(),
    privateKey: z.string(),
    adminToken: z.string().regex(/^[a-zA-Z0-9_-]{43}$/)
  })
  .strict()
export type HostConfig = z.infer<typeof hostConfigSchema>

export function localAddress(): string {
  for (const entries of Object.values(networkInterfaces())) {
    const match = entries?.find((entry) => entry.family === 'IPv4' && !entry.internal)
    if (match) return match.address
  }
  return hostname()
}

export async function loadHostConfig(directory: string): Promise<HostConfig> {
  const input = await readJSON(join(directory, 'host.json'))
  if (input === undefined) throw new Error('Host is not initialized; run host init first')
  return hostConfigSchema.parse(input)
}

export async function initializeHost(
  directory: string,
  options: {
    name?: string
    listen?: string
    address?: string
    port?: number
  } = {}
): Promise<HostConfig> {
  const file = join(directory, 'host.json')
  if ((await readJSON(file)) !== undefined) return loadHostConfig(directory)
  const platform: HostIdentity['platform'] =
    process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux'
  const identity = hostIdentitySchema.parse({
    protocolVersion: 1,
    id: randomUUID(),
    name: options.name || hostname(),
    platform
  })
  const now = new Date()
  const until = new Date(now)
  until.setFullYear(until.getFullYear() + 3)
  const certificate = await generate([{ name: 'commonName', value: `Lanto ${identity.id}` }], {
    keyType: 'ec',
    curve: 'P-256',
    algorithm: 'sha256',
    notBeforeDate: new Date(now.getTime() - 60000),
    notAfterDate: until,
    extensions: [
      { name: 'basicConstraints', cA: true, pathLenConstraint: 0 },
      { name: 'keyUsage', digitalSignature: true, keyCertSign: true },
      { name: 'extKeyUsage', serverAuth: true }
    ]
  })
  const config = hostConfigSchema.parse({
    identity,
    listen: options.listen || '0.0.0.0',
    address: options.address || localAddress(),
    port: options.port ?? HOST_PORT,
    certificate: certificate.cert,
    privateKey: certificate.private,
    adminToken: randomBytes(32).toString('base64url')
  })
  await mkdir(directory, { recursive: true, mode: 0o700 })
  // Exclusive creation prevents two initializers from replacing an existing identity.
  await writeFile(file, `${JSON.stringify(config, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
  return config
}
