import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { RemoteSystem } from '../protocol/deployment.ts'
import type { Asset } from './assets.ts'
import { powershell, psQuote, shellQuote, SshTransport } from './ssh.ts'

export async function createStage(ssh: SshTransport, system: RemoteSystem): Promise<string> {
  const stage =
    system.home.replaceAll('\\', '/').replace(/\/$/, '') + '/.lanto/deploy/run-' + randomUUID()
  const command =
    system.platform === 'windows'
      ? powershell(
          `$ErrorActionPreference='Stop'; New-Item -ItemType Directory -Path ${psQuote(stage)} | Out-Null; $p=${psQuote(stage)}; $acl=New-Object Security.AccessControl.DirectorySecurity; $acl.SetAccessRuleProtection($true,$false); foreach($sid in @([Security.Principal.WindowsIdentity]::GetCurrent().User.Value,'S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))}; Set-Acl -LiteralPath $p -AclObject $acl`
        )
      : `umask 077; mkdir -p ${shellQuote(stage)}`
  if ((await ssh.exec(command)).code !== 0)
    throw new Error('Cannot create a private deployment directory')
  return stage
}

export async function bootstrapNode(
  ssh: SshTransport,
  system: RemoteSystem,
  stage: string,
  asset?: Asset
): Promise<string> {
  if (system.nodePath) return system.nodePath
  if (!asset) throw new Error('The Node.js installation package is missing')
  const archive = stage + '/' + asset.name
  const folderName = asset.name.replace(/\.(zip|tar\.gz)$/, '')
  const runtime = system.home.replaceAll('\\', '/') + '/.lanto/runtime'
  const node =
    runtime + '/' + folderName + (system.platform === 'windows' ? '/node.exe' : '/bin/node')
  const command =
    system.platform === 'windows'
      ? powershell(
          `$ErrorActionPreference='Stop'; if((Get-FileHash -LiteralPath ${psQuote(archive)} -Algorithm SHA256).Hash.ToLower() -ne '${asset.sha256}'){throw 'checksum'}; New-Item -ItemType Directory -Force -Path ${psQuote(runtime)} | Out-Null; if(!(Test-Path -LiteralPath ${psQuote(node)})){Expand-Archive -LiteralPath ${psQuote(archive)} -DestinationPath ${psQuote(runtime)}}; & ${psQuote(node)} --version; if($LASTEXITCODE -ne 0){throw 'node'}`
        )
      : `set -eu; expected=${shellQuote(asset.sha256)}; actual=$(${system.platform === 'macos' ? 'shasum -a 256' : 'sha256sum'} ${shellQuote(archive)} | cut -d ' ' -f 1); [ "$actual" = "$expected" ]; mkdir -p ${shellQuote(runtime)}; if [ ! -x ${shellQuote(node)} ]; then tar -xzf ${shellQuote(archive)} -C ${shellQuote(runtime)}; fi; ${shellQuote(node)} --version`
  if ((await ssh.exec(command, '', 180_000)).code !== 0)
    throw new Error('Node.js installation or integrity verification failed')
  system.nodePath = node
  return node
}

const messages: Record<string, string> = {
  'tunnel-configuration-invalid':
    'The target tunnel configuration belongs to another installation or is invalid; its keys were preserved',
  'tunnel-peer-invalid': 'The tunnel peer identity does not match the target Host',
  'tunnel-peer-limit': 'This target has reached its limit of 64 tunnel peers',
  'tunnel-service-conflict':
    'An existing service uses the tunnel service name; its configuration was preserved',
  'linux-clipboard-dependencies':
    'Install Python 3 and GTK 3 on Linux, then continue deploying the desktop component',
  'administrator-required':
    'Administrator privileges required: reconnect and enter the sudo password; on Windows use an administrator SSH account',
  'desktop-session-required': 'Sign in to the target desktop before continuing deployment',
  'host-runtime-not-found':
    'Host configuration was found but its installation directory is missing; restore the original Host service and inspect again',
  'host-not-ready': 'Host has not started successfully; check the service on the target device',
  'sunshine-install-failed':
    'Sunshine installation failed; check administrator privileges and the system version',
  'sunshine-admin-required':
    'The existing Sunshine administrator credentials are unavailable. Reconnect and enter its current administrator username and password under Advanced authentication; the original password and pairings are preserved',
  'sunshine-api-unreachable':
    'Sunshine is not ready; start it on the target desktop and complete the system permission prompts',
  'existing-sunshine-start-required':
    'Start the existing Sunshine installation on the target desktop; its custom launch configuration is preserved',
  'ambiguous-media-pairing':
    'Multiple display pairing requests were detected from this computer; close other pairing windows and retry',
  'media-pairing-rejected': 'Display pairing was rejected; inspect again and retry',
  'media-pairing-timeout': 'Display pairing timed out; check the target firewall and Sunshine',
  'asset-checksum': 'Package verification failed on the target; installation stopped',
  'command-timeout': 'The target installation step timed out; reconnect to continue',
  'command-failed':
    'The target step failed; check its desktop, services, and administrator privileges'
}

export async function runAgent(
  ssh: SshTransport,
  system: RemoteSystem,
  stage: string,
  payload: Record<string, unknown>,
  timeout = 180_000
): Promise<Record<string, unknown>> {
  const node = system.nodePath!
  const file = stage + '/agent.mjs'
  const command =
    system.platform === 'windows'
      ? powershell(`& ${psQuote(node)} ${psQuote(file)}; exit $LASTEXITCODE`)
      : `${shellQuote(node)} ${shellQuote(file)}`
  const response = await ssh.exec(command, JSON.stringify({ ...payload, system }), timeout)
  const match = response.stdout.match(/LANTO_DEPLOY_JSON:([A-Za-z0-9+/=]+)/)
  if (!match) throw new Error('The deployment program returned no result; check the remote runtime')
  let result: { ok: boolean; value: Record<string, unknown>; error?: string }
  try {
    result = JSON.parse(Buffer.from(match[1], 'base64').toString('utf8')) as typeof result
  } catch {
    throw new Error('Unrecognized deployment result')
  }
  if (!result.ok)
    throw new Error(
      messages[result.error || ''] || 'The target step failed; inspect again to continue'
    )
  return result.value
}

export const deploymentFiles = (root: string) => ({
  agent: join(root, 'agent.mjs'),
  tunnel: join(root, 'tunnel.mjs'),
  bundle: join(root, 'host-runtime.tar.gz'),
  manifest: join(root, 'manifest.json')
})
