import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { initialDeployment, sshConnectionSchema } from '../protocol/deployment.ts'
import type {
  DeploymentStep,
  DeploymentView,
  RemoteSystem,
  SshConnection
} from '../protocol/deployment.ts'
import { decodeTicket, encodeTicket } from '../protocol/pair-ticket.ts'
import { SshTransport } from './ssh.ts'
import { inspectRemote } from './inspect.ts'
import { downloadAsset, loadCatalog, selectAssets, sha256 } from './assets.ts'
import { bootstrapNode, createStage, deploymentFiles, runAgent } from './bootstrap.ts'
import { pairMedia } from './media.ts'
import { canConnect } from '../common/tcp.ts'
import { DirectTunnels } from '../controller/tunnel.ts'
import { tunnelEndpointText } from '../protocol/tunnel.ts'
import type { TunnelEndpoint } from '../protocol/tunnel.ts'

export class DeploymentManager {
  private view: DeploymentView = initialDeployment()
  private abort?: AbortController
  private ssh?: SshTransport
  private input?: SshConnection
  private confirm?: (accepted: boolean) => void
  private idle?: ReturnType<typeof setTimeout>
  private stage?: string
  private macPermissions = false
  private connectionAddress?: string
  private ticket?: string
  private tunnelHostId?: string
  private tunnelPublicKey?: string
  private tunnelConfigured = false
  private readonly options: {
    directory: string
    resources: string
    changed: () => void
    pair: (ticket: string, tunnel?: TunnelEndpoint) => Promise<string>
    media: () => Promise<string | null>
    available: () => boolean
    tunnels?: DirectTunnels
    controllerId?: () => string
  }
  constructor(options: DeploymentManager['options']) {
    this.options = options
  }
  snapshot(): DeploymentView {
    return structuredClone(this.view)
  }
  private update(patch: Partial<DeploymentView>): void {
    this.view = { ...this.view, ...patch }
    this.options.changed()
  }
  private step(id: string, patch: Partial<DeploymentStep>): void {
    this.view.steps = this.view.steps.map((step) => (step.id === id ? { ...step, ...patch } : step))
    this.options.changed()
  }
  private complete(id: string): boolean {
    return this.view.steps.some((step) => step.id === id && step.phase === 'complete')
  }
  private expire(): void {
    clearTimeout(this.idle)
    this.idle = setTimeout(() => {
      this.cancel()
      this.update({
        message: 'The SSH session closed after waiting over 15 minutes; reconnect to continue'
      })
    }, 15 * 60_000)
    this.idle.unref()
  }
  inspect(raw: unknown): void {
    if (!this.options.available())
      throw new Error('Disconnect the remote display before deploying a device')
    if (['connecting', 'host-key', 'inspecting', 'deploying'].includes(this.view.phase))
      throw new Error('This device is being processed; wait or cancel')
    const input = sshConnectionSchema.parse(raw)
    this.release()
    const abort = new AbortController()
    const ssh = new SshTransport(abort.signal)
    this.abort = abort
    this.ssh = ssh
    this.input = input
    this.stage = undefined
    this.macPermissions = false
    this.connectionAddress = input.host
    this.ticket = undefined
    this.tunnelHostId = undefined
    this.tunnelPublicKey = undefined
    this.tunnelConfigured = false
    this.view = {
      phase: 'connecting',
      name: input.name,
      host: input.host,
      network: input.network,
      steps: []
    }
    this.options.changed()
    void (async () => {
      await ssh.connect(input, this.options.directory, async (fingerprint, previousFingerprint) => {
        if (abort.signal.aborted) return false
        this.update({
          phase: 'host-key',
          fingerprint,
          previousFingerprint,
          message: previousFingerprint
            ? 'The SSH identity of this device changed. Verify the new fingerprint before continuing'
            : 'First connection: verify the SSH fingerprint of the target device'
        })
        return new Promise<boolean>((resolve) => {
          this.confirm = resolve
          this.expire()
        })
      })
      abort.signal.throwIfAborted()
      this.update({ phase: 'inspecting', message: 'Inspecting the system and existing services…' })
      const system = await inspectRemote(ssh)
      abort.signal.throwIfAborted()
      selectAssets(await loadCatalog(this.options.resources), system)
      abort.signal.throwIfAborted()
      this.update({
        phase: 'ready',
        system,
        steps: [
          {
            id: 'runtime',
            title: 'Prepare runtime',
            phase: 'pending',
            detail: system.nodePath ? 'Reuse existing Node.js' : 'Install an isolated runtime'
          },
          {
            id: 'sunshine',
            title: 'Configure remote display',
            phase: 'pending',
            detail: system.sunshineInstalled
              ? 'Reuse existing Sunshine and display settings'
              : 'Install Sunshine'
          },
          {
            id: 'host',
            title: 'Configure device services',
            phase: 'pending',
            detail: system.hostInstalled
              ? 'Preserve Host identity, certificates, and configuration'
              : 'Install Host and desktop components'
          },
          {
            id: 'network',
            title:
              input.network === 'tunnel'
                ? 'Create encrypted direct tunnel'
                : 'Check network access',
            phase: 'pending'
          },
          { id: 'pair', title: 'Add device automatically', phase: 'pending' },
          { id: 'media', title: 'Complete display pairing', phase: 'pending' }
        ],
        message:
          system.platform === 'windows' && !system.administrator
            ? 'Windows installation requires an administrator SSH account; switch accounts and reconnect'
            : input.network === 'tunnel'
              ? 'Ready to connect the two devices directly. The target must be reachable through IPv6 or a UDP port mapping; no account or relay is used'
              : 'Inspection complete; ready to deploy'
      })
      this.expire()
    })().catch((error: unknown) => {
      if (!abort.signal.aborted) this.fail(error)
    })
  }
  confirmHostKey(input: unknown): void {
    const accepted = z.boolean().parse(input)
    if (!this.confirm || this.view.phase !== 'host-key')
      throw new Error('No host is waiting for confirmation')
    const confirm = this.confirm
    this.confirm = undefined
    clearTimeout(this.idle)
    this.update({ phase: 'connecting', message: 'Verifying SSH account…' })
    confirm(accepted)
  }
  deploy(): void {
    if (
      !['ready', 'attention'].includes(this.view.phase) ||
      !this.ssh ||
      !this.input ||
      !this.view.system ||
      !this.abort
    )
      throw new Error('Connect over SSH and inspect the device first')
    if (!this.options.available()) throw new Error('Disconnect the remote display first')
    if (this.view.system.platform === 'windows' && !this.view.system.administrator)
      throw new Error('Connect using a Windows administrator SSH account')
    clearTimeout(this.idle)
    const signal = this.abort.signal,
      ssh = this.ssh,
      input = this.input,
      system = this.view.system
    const resumePermissions = this.macPermissions
    this.update({ phase: 'deploying', message: 'Deploying…', progress: undefined })
    void this.execute(ssh, input, system, signal, resumePermissions).catch((error: unknown) => {
      if (!signal.aborted) this.fail(error)
    })
  }
  private async execute(
    ssh: SshTransport,
    input: SshConnection,
    system: RemoteSystem,
    signal: AbortSignal,
    resumePermissions: boolean
  ): Promise<void> {
    const progress = (label: string) => {
      let last = 0
      return (bytes: number, total: number) => {
        if (Date.now() - last < 120 && bytes !== total) return
        last = Date.now()
        if (!signal.aborted) this.update({ progress: { bytes, total, label } })
      }
    }
    const files = deploymentFiles(this.options.resources)
    if (!this.stage) {
      this.step('runtime', { phase: 'running' })
      const assets = selectAssets(await loadCatalog(this.options.resources), system)
      const stage = await createStage(ssh, system)
      this.stage = stage
      for (const asset of [assets.node, assets.sunshine].filter((asset) => asset !== undefined)) {
        const path = await downloadAsset(
          asset,
          join(this.options.directory, 'deploy-cache'),
          signal,
          progress('Download ' + asset.name)
        )
        await ssh.upload(path, stage + '/' + asset.name, progress('Upload ' + asset.name))
      }
      await bootstrapNode(ssh, system, stage, assets.node)
      await ssh.upload(files.agent, stage + '/agent.mjs', progress('Upload deployment program'))
      await ssh.upload(files.tunnel, stage + '/tunnel.mjs', progress('Upload direct tunnel setup'))
      const manifest = JSON.parse(await readFile(files.manifest, 'utf8')) as { sha256: string }
      if ((await sha256(files.bundle)) !== manifest.sha256)
        throw new Error('The local Host package is incomplete; reinstall Lanto')
      if (!system.hostInstalled)
        await ssh.upload(files.bundle, stage + '/host-runtime.tar.gz', progress('Upload Host'))
      this.step('runtime', { phase: 'complete' })
      this.update({ progress: undefined })
      const payload = {
        name: input.name,
        address: input.host,
        administratorPassword: input.administratorPassword || input.password,
        hostHash: manifest.sha256
      }
      this.step('sunshine', { phase: 'running' })
      const sunshine = await runAgent(
        ssh,
        system,
        stage,
        { ...payload, action: 'sunshine', asset: assets.sunshine },
        720_000
      )
      if (sunshine.attention === 'restart-required')
        throw new Error(
          'Sunshine installation is complete; restart the target Windows device and reconnect to continue'
        )
      this.macPermissions = sunshine.attention === 'mac-permissions'
      if (system.platform === 'macos' && !system.sunshineInstalled)
        system.sunshinePath = system.home + '/Applications/Sunshine.app'
      system.sunshineInstalled = true
      this.step('sunshine', { phase: 'complete' })
      this.step('host', { phase: 'running' })
      const host = await runAgent(ssh, system, stage, { ...payload, action: 'host' }, 240_000)
      if (typeof host.runtime === 'string') system.hostRuntime = host.runtime
      system.hostInstalled = true
      this.step('host', { phase: 'complete' })
    }
    const tunnelEndpoint: TunnelEndpoint | undefined =
      input.network === 'tunnel'
        ? { address: input.tunnelAddress || input.host, port: input.tunnelPort }
        : undefined
    if (!this.complete('pair')) {
      const response = await runAgent(ssh, system, this.stage!, { action: 'ticket' })
      this.ticket = z.string().parse(response.ticket)
      if (tunnelEndpoint && decodeTicket(this.ticket).port !== 48199)
        throw new Error(
          'The direct tunnel currently requires Host port 48199; the target configuration was preserved'
        )
    }
    if (!this.complete('network')) {
      this.step('network', { phase: 'running' })
      if (tunnelEndpoint) {
        const tunnels = this.options.tunnels
        if (!tunnels || !this.options.controllerId)
          throw new Error('This controller has no direct tunnel support')
        const hostId = decodeTicket(this.ticket!).hostId
        this.tunnelHostId = hostId
        this.tunnelPublicKey = await tunnels.key(hostId)
        if (!this.tunnelConfigured) {
          const folder = join(this.options.resources, 'tunnel')
          const manifest = JSON.parse(await readFile(join(folder, 'manifest.json'), 'utf8')) as {
            assets: { platform: string; architecture: string; name: string; sha256: string }[]
          }
          const asset = manifest.assets.find(
            (value) =>
              value.platform === system.platform && value.architecture === system.architecture
          )
          if (
            !asset ||
            !/^lanto-tunnel-[a-z0-9.-]+$/.test(asset.name) ||
            (await sha256(join(folder, asset.name))) !== asset.sha256
          )
            throw new Error(
              'The target tunnel component is missing or failed its integrity check; rebuild or reinstall Lanto'
            )
          await ssh.upload(
            join(folder, asset.name),
            this.stage! + '/' + asset.name,
            progress('Upload direct tunnel component')
          )
          const peer = await runAgent(ssh, system, this.stage!, {
            action: 'tunnel',
            hostId,
            asset,
            tunnelControllerId: this.options.controllerId(),
            tunnelPublicKey: this.tunnelPublicKey,
            administratorPassword: input.administratorPassword || input.password
          })
          await tunnels.configure(hostId, { publicKey: peer.publicKey, address: peer.address })
          this.tunnelConfigured = true
        }
        this.update({
          message: 'Checking the encrypted connection between these two devices…',
          tunnelEndpoint: tunnelEndpointText(tunnelEndpoint),
          progress: undefined
        })
        this.connectionAddress = await tunnels.start(hostId, tunnelEndpoint)
        try {
          await tunnels.verify(hostId, signal)
        } catch (error) {
          signal.throwIfAborted()
          this.step('network', { phase: 'attention' })
          this.update({
            phase: 'attention',
            message:
              error instanceof Error ? error.message : 'The direct tunnel could not be verified',
            progress: undefined
          })
          this.expire()
          return
        }
        this.step('network', {
          detail: 'Encrypted device-to-device connection · ' + tunnelEndpointText(tunnelEndpoint)
        })
      } else {
        const reachable = await Promise.all([
          canConnect(input.host, 48199),
          canConnect(input.host, 47989)
        ])
        if (!reachable.every(Boolean))
          await runAgent(ssh, system, this.stage!, {
            action: 'network',
            administratorPassword: input.administratorPassword || input.password
          })
      }
      this.step('network', { phase: 'complete' })
    }
    if (!this.complete('pair')) {
      this.step('pair', { phase: 'running' })
      const ticket = decodeTicket(this.ticket!)
      // SSH authenticates the Host identity; the tunnel has its own pinned peer key.
      const deviceId = await this.options.pair(
        encodeTicket({ ...ticket, address: this.connectionAddress! }),
        tunnelEndpoint
      )
      signal.throwIfAborted()
      this.update({ deviceId })
      this.step('pair', { phase: 'complete' })
    }
    if (this.macPermissions && !resumePermissions) {
      this.step('media', { phase: 'attention' })
      this.update({
        phase: 'attention',
        message:
          'On the target Mac, allow Sunshine screen recording and accessibility in System Settings → Privacy & Security. If prompted to quit and reopen, do so before selecting Continue verification.'
      })
      this.expire()
      return
    }
    this.step('media', { phase: 'running' })
    const executable = await this.options.media()
    if (!executable)
      throw new Error('Select a display client in Lanto settings, then inspect again to continue')
    await pairMedia(executable, this.connectionAddress!, signal, async (pin) => {
      await runAgent(
        ssh,
        system,
        this.stage!,
        {
          action: 'media-pin',
          pin,
          ...(tunnelEndpoint
            ? {
                tunnelControllerId: this.options.controllerId!(),
                tunnelPublicKey: this.tunnelPublicKey
              }
            : {}),
          ...(input.sunshineUsername && input.sunshinePassword
            ? { mediaAuth: { username: input.sunshineUsername, password: input.sunshinePassword } }
            : {})
        },
        60_000
      )
    })
    const status = await runAgent(ssh, system, this.stage!, { action: 'status' })
    const parsed = z.object({ host: z.object({ sunshineReachable: z.boolean() }) }).parse(status)
    if (!parsed.host.sunshineReachable)
      throw new Error('Host is ready but the display service is unreachable; check Sunshine')
    signal.throwIfAborted()
    this.step('media', { phase: 'complete' })
    await runAgent(ssh, system, this.stage!, { action: 'cleanup' }).catch(() => {})
    signal.throwIfAborted()
    this.update({
      phase: 'complete',
      message: tunnelEndpoint
        ? 'Encrypted direct tunnel verified and display paired; this device is ready without an account or relay'
        : 'Device added and display paired; the remote desktop is ready to connect',
      progress: undefined
    })
    this.release()
  }
  private fail(error: unknown): void {
    for (const step of this.view.steps) if (step.phase === 'running') step.phase = 'failed'
    this.update({
      phase: 'failed',
      message: error instanceof Error ? error.message : 'Deployment is incomplete; inspect again',
      progress: undefined
    })
    this.release()
  }
  cancel(): void {
    this.release()
    if (!['idle', 'complete'].includes(this.view.phase))
      this.update({
        phase: 'cancelled',
        message:
          'Remaining steps stopped. Installed components and existing configuration are preserved; reconnect to continue',
        progress: undefined
      })
  }
  private release(): void {
    clearTimeout(this.idle)
    this.confirm?.(false)
    this.confirm = undefined
    this.abort?.abort()
    this.abort = undefined
    this.ssh?.close()
    this.ssh = undefined
    this.ticket = undefined
    if (this.tunnelHostId && !this.view.deviceId)
      void this.options.tunnels?.stop(this.tunnelHostId).catch(() => {})
    if (this.input) {
      this.input.password = ''
      this.input.passphrase = ''
      this.input.administratorPassword = ''
      this.input.sunshinePassword = ''
      this.input.sunshineUsername = ''
      this.input = undefined
    }
  }
}
