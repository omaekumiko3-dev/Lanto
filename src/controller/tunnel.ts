import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { SerialQueue } from '../common/serial-queue.ts'
import type { SecretVault } from './trust-store.ts'
import {
  tunnelEndpointSchema,
  tunnelEndpointText,
  tunnelPeerSchema,
  tunnelPublicKeySchema
} from '../protocol/tunnel.ts'
import type { TunnelEndpoint } from '../protocol/tunnel.ts'

const profileSchema = z
  .object({
    privateKey: tunnelPublicKeySchema,
    publicKey: tunnelPublicKeySchema,
    peer: tunnelPeerSchema.optional()
  })
  .strict()
type Profile = z.infer<typeof profileSchema>
interface Running {
  child: ChildProcessWithoutNullStreams
  endpoint: string
  handshake: number
}

export class DirectTunnels {
  private readonly profiles = new Map<string, Profile>()
  private readonly running = new Map<string, Running>()
  private readonly queue = new SerialQueue()
  private readonly options: { directory: string; resources: string; vault: SecretVault }
  constructor(options: DirectTunnels['options']) {
    this.options = options
  }
  private get file(): string {
    return join(this.options.directory, 'direct-tunnels.json')
  }
  async load(): Promise<void> {
    const text = await readFile(this.file, 'utf8').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (text === undefined) return
    const value = z
      .object({ version: z.literal(1), profiles: z.record(z.uuid(), z.string().max(16000)) })
      .strict()
      .parse(JSON.parse(text))
    for (const [id, encrypted] of Object.entries(value.profiles))
      this.profiles.set(id, profileSchema.parse(JSON.parse(this.options.vault.decrypt(encrypted))))
  }
  private async save(): Promise<void> {
    const value = {
      version: 1,
      profiles: Object.fromEntries(
        [...this.profiles].map(([id, profile]) => [
          id,
          this.options.vault.encrypt(JSON.stringify(profile))
        ])
      )
    }
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 })
    const temporary = this.file + '.' + randomUUID() + '.tmp'
    await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
    await rename(temporary, this.file)
  }
  address(id: string): string {
    z.uuid().parse(id)
    const hash = createHash('sha256').update(id).digest()
    return `127.${64 + (hash[0] % 128)}.${hash[1]}.${1 + (hash[2] % 254)}`
  }
  async key(id: string): Promise<string> {
    return this.queue.run(async () => {
      z.uuid().parse(id)
      let profile = this.profiles.get(id)
      if (!profile) {
        for (const other of this.profiles.keys())
          if (other !== id && this.address(other) === this.address(id))
            throw new Error(
              'This device conflicts with an existing tunnel address; remove the unused device and retry'
            )
        const pair = generateKeyPairSync('x25519')
        profile = {
          privateKey: pair.privateKey
            .export({ format: 'der', type: 'pkcs8' })
            .subarray(-32)
            .toString('base64'),
          publicKey: pair.publicKey
            .export({ format: 'der', type: 'spki' })
            .subarray(-32)
            .toString('base64')
        }
        this.profiles.set(id, profile)
        try {
          await this.save()
        } catch (error) {
          this.profiles.delete(id)
          throw error
        }
      }
      return profile.publicKey
    })
  }
  async configure(id: string, raw: unknown): Promise<void> {
    return this.queue.run(async () => {
      const peer = tunnelPeerSchema.parse(raw)
      const profile = this.profiles.get(id)
      if (!profile) throw new Error('Create this device’s tunnel key first')
      if (profile.peer?.publicKey === peer.publicKey && profile.peer.address === peer.address)
        return
      await this.stopProcess(id)
      const previous = profile.peer
      profile.peer = peer
      try {
        await this.save()
      } catch (error) {
        profile.peer = previous
        throw error
      }
    })
  }
  async start(id: string, raw: TunnelEndpoint): Promise<string> {
    const endpoint = tunnelEndpointText(tunnelEndpointSchema.parse(raw))
    return this.queue.run(async () => {
      const existing = this.running.get(id)
      if (existing?.endpoint === endpoint && !existing.child.killed) return this.address(id)
      await this.stopProcess(id)
      return this.launch(id, endpoint)
    })
  }
  private async launch(id: string, endpoint: string): Promise<string> {
    const profile = this.profiles.get(id)
    if (!profile?.peer)
      throw new Error('This device’s tunnel keys are missing; add it again through SSH')
    const platforms: Partial<Record<NodeJS.Platform, string>> = {
      win32: 'windows',
      darwin: 'macos',
      linux: 'linux'
    }
    const platform = platforms[process.platform]
    const manifest = JSON.parse(
      await readFile(join(this.options.resources, 'tunnel/manifest.json'), 'utf8')
    ) as { assets: { platform: string; architecture: string; name: string; sha256: string }[] }
    const asset = manifest.assets.find(
      (value) => value.platform === platform && value.architecture === process.arch
    )
    if (!asset || !/^lanto-tunnel-[a-z0-9.-]+$/.test(asset.name))
      throw new Error('This Lanto package has no tunnel component for this computer')
    const executable = join(this.options.resources, 'tunnel', asset.name)
    if (
      createHash('sha256')
        .update(await readFile(executable))
        .digest('hex') !== asset.sha256
    )
      throw new Error('The tunnel component failed its integrity check; reinstall Lanto')
    const child = spawn(executable, [], {
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    })
    const running: Running = { child, endpoint, handshake: 0 }
    this.running.set(id, running)
    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill()
        reject(new Error('The direct tunnel could not start'))
      }, 15_000)
      let buffer = ''
      const fail = () => {
        clearTimeout(timer)
        reject(new Error('The direct tunnel stopped; check for a local port conflict and retry'))
      }
      child.once('error', fail)
      child.once('exit', () => {
        if (this.running.get(id) === running) this.running.delete(id)
        fail()
      })
      child.stdout.on('data', (data: Buffer) => {
        buffer += data.toString('utf8')
        if (buffer.length > 16000) {
          child.kill()
          fail()
          return
        }
        for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
          const line = buffer.slice(0, newline)
          buffer = buffer.slice(newline + 1)
          try {
            const value = JSON.parse(line) as { event?: string; version?: number; at?: number }
            if (value.event === 'ready' && value.version === 1) {
              clearTimeout(timer)
              resolve()
            }
            if (value.event === 'handshake' && Number.isSafeInteger(value.at))
              running.handshake = value.at! * 1000
          } catch {
            child.kill()
            fail()
          }
        }
      })
      child.stderr.on('data', () => {})
      child.stdin.on('error', fail)
    })
    child.stdin.write(
      JSON.stringify({
        version: 1,
        role: 'client',
        privateKey: profile.privateKey,
        address: profile.peer.address,
        listenPort: 0,
        bindAddress: this.address(id),
        peers: [{ publicKey: profile.peer.publicKey, address: '10.203.0.1', endpoint }]
      }) + '\n'
    )
    await ready
    return this.address(id)
  }
  async verify(id: string, signal?: AbortSignal): Promise<void> {
    const deadline = Date.now() + 15_000
    do {
      signal?.throwIfAborted()
      const process = this.running.get(id)
      if (!process) throw new Error('The direct tunnel is not running; reconnect the device')
      if (process.handshake > Date.now() - 180_000 && process.handshake <= Date.now() + 5000) return
      await delay(200, undefined, { signal })
    } while (Date.now() < deadline)
    throw new Error(
      'No direct tunnel handshake. Check the target address, UDP port 48200, IPv6 firewall, or router port mapping. This mode has no relay and cannot connect through every NAT'
    )
  }
  async stop(id: string): Promise<void> {
    return this.queue.run(() => this.stopProcess(id))
  }
  private async stopProcess(id: string): Promise<void> {
    const process = this.running.get(id)
    if (!process) return
    if (process.child.exitCode !== null || process.child.signalCode !== null) {
      this.running.delete(id)
      return
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('The previous direct tunnel did not stop; close Lanto and retry')),
        3000
      )
      process.child.once('exit', () => {
        clearTimeout(timer)
        if (this.running.get(id) === process) this.running.delete(id)
        resolve()
      })
      process.child.stdin.end()
      process.child.kill()
    })
  }
  async remove(id: string): Promise<void> {
    return this.queue.run(async () => {
      await this.stopProcess(id)
      this.profiles.delete(id)
      await this.save()
    })
  }
  async close(): Promise<void> {
    await this.queue.run(async () => {
      await Promise.all([...this.running.keys()].map((id) => this.stopProcess(id)))
    })
  }
}
