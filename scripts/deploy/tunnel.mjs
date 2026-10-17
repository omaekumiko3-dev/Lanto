import { createHash, generateKeyPairSync } from 'node:crypto'
import { readFile, writeFile, mkdir, copyFile, chmod, lstat, rename } from 'node:fs/promises'
import { join } from 'node:path'

const uuid = (value) =>
  typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
const key = (value) =>
  typeof value === 'string' &&
  /^[A-Za-z0-9+/]{43}=$/.test(value) &&
  Buffer.from(value, 'base64').length === 32 &&
  Buffer.from(value, 'base64').toString('base64') === value
const quote = (value) => {
  if (/[\x00-\x1f\x7f]/.test(value)) throw new Error('invalid-service-path')
  return (
    '"' +
    value
      .replaceAll('\\', '\\\\')
      .replaceAll('"', '\\"')
      .replaceAll('%', '%%')
      .replaceAll('$', '$$$$') +
    '"'
  )
}
export function createTunnelAgent(context) {
  const {
    request,
    system,
    home,
    run,
    must,
    ps,
    psQuote,
    sudo,
    verify,
    exists,
    launchAgent,
    userEnvironment
  } = context
  const platform = context.platform || process.platform
  const win = platform === 'win32'
  const root = win
    ? join(process.env.ProgramData || 'C:/ProgramData', 'Lanto', 'DirectTunnel')
    : join(home, '.lanto', 'direct-tunnel')
  const metadata = join(root, 'identity.json')
  const configuration = join(root, 'tunnel.json')
  const executable = join(root, win ? 'lanto-tunnel.exe' : 'lanto-tunnel')
  async function readIdentity() {
    if (!(await exists(metadata))) return undefined
    if ((await lstat(metadata)).isSymbolicLink()) throw new Error('tunnel-configuration-invalid')
    const value = JSON.parse(await readFile(metadata, 'utf8'))
    if (
      value.version !== 1 ||
      !uuid(value.hostId) ||
      !key(value.privateKey) ||
      !key(value.publicKey) ||
      !Array.isArray(value.peers) ||
      value.peers.length > 64 ||
      value.peers.some(
        (p) =>
          !uuid(p.controllerId) ||
          !key(p.publicKey) ||
          !/^10\.203\.\d{1,3}\.\d{1,3}$/.test(p.address) ||
          p.address.split('.').some((v) => Number(v) > 255) ||
          p.address === '10.203.0.1'
      )
    )
      throw new Error('tunnel-configuration-invalid')
    return value
  }
  async function peerAddress() {
    if (!uuid(request.tunnelControllerId) || !key(request.tunnelPublicKey))
      throw new Error('tunnel-peer-invalid')
    const identity = await readIdentity()
    if (
      !identity?.peers.some(
        (p) =>
          p.controllerId === request.tunnelControllerId && p.publicKey === request.tunnelPublicKey
      )
    )
      throw new Error('tunnel-peer-invalid')
    return '127.0.0.1'
  }
  async function ensure() {
    if (!uuid(request.hostId) || !uuid(request.tunnelControllerId) || !key(request.tunnelPublicKey))
      throw new Error('tunnel-peer-invalid')
    const actual = JSON.parse(await readFile(join(system.hostData, 'host.json'), 'utf8'))
    if (actual.identity.id !== request.hostId) throw new Error('tunnel-peer-invalid')
    if (await exists(root)) {
      if ((await lstat(root)).isSymbolicLink()) throw new Error('tunnel-configuration-invalid')
    }
    await mkdir(root, { recursive: true, mode: 0o700 })
    if (win)
      await ps(
        `$p=${psQuote(root)};if((Get-Item -LiteralPath $p).Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'reparse'};$a=New-Object Security.AccessControl.DirectorySecurity;$a.SetAccessRuleProtection($true,$false);foreach($sid in @('S-1-5-18','S-1-5-32-544')){$a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','ContainerInherit,ObjectInherit','None','Allow'))};$a.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new('S-1-5-19'),'ReadAndExecute','ContainerInherit,ObjectInherit','None','Allow'));Set-Acl -LiteralPath $p -AclObject $a`
      )
    else await chmod(root, 0o700)
    let identity = await readIdentity()
    if (identity && identity.hostId !== request.hostId)
      throw new Error('tunnel-configuration-invalid')
    if (!identity) {
      const keys = generateKeyPairSync('x25519')
      identity = {
        version: 1,
        hostId: request.hostId,
        privateKey: keys.privateKey
          .export({ format: 'der', type: 'pkcs8' })
          .subarray(-32)
          .toString('base64'),
        publicKey: keys.publicKey
          .export({ format: 'der', type: 'spki' })
          .subarray(-32)
          .toString('base64'),
        peers: []
      }
    }
    let peer = identity.peers.find((p) => p.controllerId === request.tunnelControllerId)
    const changedPeer = !peer || peer.publicKey !== request.tunnelPublicKey
    if (!peer) {
      if (identity.peers.length >= 64) throw new Error('tunnel-peer-limit')
      const seed = createHash('sha256').update(request.tunnelControllerId).digest().readUInt16BE(0)
      let address
      for (let i = 0; i < 65534; i++) {
        const number = 2 + ((seed + i) % 65534)
        const candidate = `10.203.${number >> 8}.${number & 255}`
        if (!identity.peers.some((p) => p.address === candidate)) {
          address = candidate
          break
        }
      }
      peer = {
        controllerId: request.tunnelControllerId,
        publicKey: request.tunnelPublicKey,
        address
      }
      identity.peers.push(peer)
    } else peer.publicKey = request.tunnelPublicKey
    const incoming = await verify(request.asset.name, request.asset.sha256)
    const installedHash = await readFile(executable)
      .then((data) => createHash('sha256').update(data).digest('hex'))
      .catch(() => undefined)
    const changedBinary =
      !(
        identity.binary?.source === request.asset.sha256 &&
        identity.binary?.installed === installedHash
      ) && installedHash !== request.asset.sha256
    if (win) {
      await ps(
        `$t=Get-ScheduledTask -TaskName 'Lanto Direct Tunnel' -ErrorAction SilentlyContinue;if($t){if($t.Description -ne 'Lanto direct encrypted tunnel v1'){throw 'unmanaged-task'};${changedPeer || changedBinary ? 'Stop-ScheduledTask -InputObject $t; Start-Sleep -Milliseconds 500' : ''}};exit 0`
      )
    } else if (platform === 'linux') {
      const path = join(home, '.config/systemd/user/lanto-direct-tunnel.service')
      if (await exists(path)) {
        if (!(await readFile(path, 'utf8')).includes('# Lanto direct encrypted tunnel v1'))
          throw new Error('tunnel-service-conflict')
        if (changedPeer || changedBinary)
          await run('systemctl', ['--user', 'stop', 'lanto-direct-tunnel.service'], {
            env: userEnvironment
          })
      }
    }
    if (changedBinary) {
      await copyFile(incoming, executable + '.next')
      if (!win) await chmod(executable + '.next', 0o700)
      await rename(executable + '.next', executable)
    }
    const config = {
      version: 1,
      role: 'host',
      privateKey: identity.privateKey,
      address: '10.203.0.1',
      listenPort: 48200,
      peers: identity.peers.map((p) => ({ publicKey: p.publicKey, address: p.address }))
    }
    for (const [file, value] of [
      [metadata, identity],
      [configuration, config]
    ]) {
      await writeFile(file + '.next', JSON.stringify(value) + '\n', { mode: 0o600 })
      await rename(file + '.next', file)
    }
    if (win) {
      await ps(
        `$a=New-ScheduledTaskAction -Execute ${psQuote(executable)} -Argument ${psQuote('--config "' + configuration + '"')} -WorkingDirectory ${psQuote(root)};$p=New-ScheduledTaskPrincipal -UserId 'LOCALSERVICE' -LogonType ServiceAccount;$s=New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew;$t=New-ScheduledTaskTrigger -AtStartup;Register-ScheduledTask -TaskName 'Lanto Direct Tunnel' -Action $a -Principal $p -Settings $s -Trigger $t -Description 'Lanto direct encrypted tunnel v1' -Force | Out-Null;Get-NetFirewallRule -Name 'Lanto-Direct-Tunnel' -ErrorAction SilentlyContinue | Remove-NetFirewallRule;New-NetFirewallRule -Name 'Lanto-Direct-Tunnel' -DisplayName 'Lanto direct encrypted tunnel' -Direction Inbound -Action Allow -Program ${psQuote(executable)} -Protocol UDP -LocalPort 48200 -Profile Any | Out-Null;Start-ScheduledTask -TaskName 'Lanto Direct Tunnel'`
      )
    } else if (platform === 'darwin') {
      if (changedBinary) await must('/usr/bin/codesign', ['--force', '--sign', '-', executable])
      const firewall = '/usr/libexec/ApplicationFirewall/socketfilterfw'
      await sudo([firewall, '--add', executable])
      await sudo([firewall, '--unblockapp', executable])
      await launchAgent('dev.lanto.direct-tunnel', [executable, '--config', configuration], root)
    } else {
      const folder = join(home, '.config/systemd/user')
      await mkdir(folder, { recursive: true })
      await writeFile(
        join(folder, 'lanto-direct-tunnel.service'),
        `# Lanto direct encrypted tunnel v1\n[Unit]\nDescription=Lanto direct encrypted tunnel\n\n[Service]\nType=simple\nExecStart=${[executable, '--config', configuration].map(quote).join(' ')}\nRestart=on-failure\nRestartSec=3\nUMask=0077\n\n[Install]\nWantedBy=default.target\n`,
        { mode: 0o600 }
      )
      await must('systemctl', ['--user', 'daemon-reload'], { env: userEnvironment })
      await must('systemctl', ['--user', 'enable', '--now', 'lanto-direct-tunnel.service'], {
        env: userEnvironment
      })
      if (
        (await run('sh', ['-c', 'command -v ufw'])).code === 0 &&
        /Status: active/.test(await sudo(['ufw', 'status']))
      )
        await sudo(['ufw', 'allow', '48200/udp', 'comment', 'Lanto direct encrypted tunnel'])
    }
    identity.binary = {
      source: request.asset.sha256,
      installed: createHash('sha256')
        .update(await readFile(executable))
        .digest('hex')
    }
    await writeFile(metadata + '.next', JSON.stringify(identity) + '\n', { mode: 0o600 })
    await rename(metadata + '.next', metadata)
    return { publicKey: identity.publicKey, address: peer.address, port: 48200 }
  }
  return { ensure, peerAddress }
}
