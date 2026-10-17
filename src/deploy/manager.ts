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

export class DeploymentManager {
  private view: DeploymentView = initialDeployment()
  private abort?: AbortController
  private ssh?: SshTransport
  private input?: SshConnection
  private confirm?: (accepted: boolean) => void
  private idle?: ReturnType<typeof setTimeout>
  private stage?: string
  private macPermissions = false
  private readonly options: {
    directory: string
    resources: string
    changed: () => void
    pair: (ticket: string) => Promise<string>
    media: () => Promise<string | null>
    available: () => boolean
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
    this.view = { phase: 'connecting', name: input.name, host: input.host, steps: [] }
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
          { id: 'network', title: 'Check network access', phase: 'pending' },
          { id: 'pair', title: 'Add device automatically', phase: 'pending' },
          { id: 'media', title: 'Complete display pairing', phase: 'pending' }
        ],
        message:
          system.platform === 'windows' && !system.administrator
            ? 'Windows installation requires an administrator SSH account; switch accounts and reconnect'
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
      this.step('network', { phase: 'running' })
      const reachable = await Promise.all([
        canConnect(input.host, 48199),
        canConnect(input.host, 47989)
      ])
      if (!reachable.every(Boolean))
        await runAgent(ssh, system, stage, { ...payload, action: 'network' })
      this.step('network', { phase: 'complete' })
      this.step('pair', { phase: 'running' })
      const response = await runAgent(ssh, system, stage, { action: 'ticket' })
      const ticket = decodeTicket(z.string().parse(response.ticket))
      // Connect to the exact SSH destination, even if a reused Host advertises an old IP.
      const deviceId = await this.options.pair(encodeTicket({ ...ticket, address: input.host }))
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
    await pairMedia(executable, input.host, signal, async (pin) => {
      await runAgent(
        ssh,
        system,
        this.stage!,
        {
          action: 'media-pin',
          pin,
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
      message: 'Device added and display paired; the remote desktop is ready to connect',
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
