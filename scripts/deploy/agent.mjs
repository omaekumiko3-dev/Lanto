// Receives a single JSON request over the authenticated SSH channel. Never prints
// process output, credentials, or configuration files. Only allowlisted results.
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import {
  access,
  chmod,
  copyFile,
  cp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile
} from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import https from 'node:https'
import { setTimeout as delay } from 'node:timers/promises'
import { createTunnelAgent } from './tunnel.mjs'

const exists = (path) =>
  access(path).then(
    () => true,
    () => false
  )
const psQuote = (text) => "'" + text.replaceAll("'", "''") + "'"
const xml = (text) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
const win = process.platform === 'win32'
let input = ''
for await (const chunk of process.stdin) {
  input += chunk
  if (input.length > 100_000) throw new Error('request-too-large')
}
const request = JSON.parse(input)
input = ''
const system = request.system
const stage = await realpath(dirname(import.meta.filename))
const home = homedir()
const stageParent = await realpath(resolve(home, '.lanto', 'deploy'))
if (
  !stage.startsWith(stageParent + sep) ||
  !/^run-[a-f0-9-]{36}$/.test(stage.slice(stageParent.length + 1))
)
  throw new Error('invalid-stage')

async function run(file, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(file, args, {
      shell: false,
      windowsHide: true,
      cwd: options.cwd || stage,
      env: { ...process.env, ...options.env },
      stdio: ['pipe', 'pipe', 'pipe']
    })
    let stdout = '',
      stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('command-timeout'))
    }, options.timeout || 120_000)
    child.stdout.on('data', (data) => {
      stdout = (stdout + data.toString()).slice(-1_000_000)
    })
    child.stderr.on('data', (data) => {
      stderr = (stderr + data.toString()).slice(-1_000_000)
    })
    child.once('error', () => {
      clearTimeout(timer)
      reject(new Error('command-unavailable'))
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolvePromise({ code, stdout, stderr })
    })
    child.stdin.on('error', () => {})
    child.stdin.end(options.stdin || '')
  })
}
async function must(file, args, options) {
  const result = await run(file, args, options)
  if (result.code !== 0) throw new Error('command-failed')
  return result.stdout
}
const ps = (script) =>
  must('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from("$ErrorActionPreference='Stop';" + script, 'utf16le').toString('base64')
  ])
const userEnvironment =
  process.platform === 'linux'
    ? {
        XDG_RUNTIME_DIR: `/run/user/${process.getuid()}`,
        DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid()}/bus`
      }
    : {}
async function sudo(args) {
  if (process.getuid?.() === 0) return must(args[0], args.slice(1), { timeout: 600_000 })
  const password = request.administratorPassword || ''
  const result = await run(
    'sudo',
    password ? ['-S', '-p', '', '--', ...args] : ['-n', '--', ...args],
    { stdin: password ? password + '\n' : '', timeout: 600_000 }
  )
  if (result.code !== 0) throw new Error('administrator-required')
  return result.stdout
}
async function verify(name, expected) {
  if (!/^[a-zA-Z0-9._+-]+$/.test(name) || !/^[a-f0-9]{64}$/.test(expected))
    throw new Error('invalid-asset')
  const path = join(stage, name)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  if (hash.digest('hex') !== expected) throw new Error('asset-checksum')
  return path
}
async function launchAgent(label, args, directory) {
  const folder = join(home, 'Library', 'LaunchAgents')
  await mkdir(folder, { recursive: true, mode: 0o700 })
  const plist = join(folder, label + '.plist')
  if (await exists(plist)) await copyFile(plist, plist + `.backup-${Date.now()}`)
  const logs = join(home, '.lanto', 'logs')
  await mkdir(logs, { recursive: true, mode: 0o700 })
  await writeFile(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map((arg) => '<string>' + xml(arg) + '</string>').join('')}</array><key>WorkingDirectory</key><string>${xml(directory)}</string><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>StandardOutPath</key><string>${xml(join(logs, label + '.log'))}</string><key>StandardErrorPath</key><string>${xml(join(logs, label + '.log'))}</string></dict></plist>`,
    { mode: 0o600 }
  )
  const domain = `gui/${process.getuid()}`
  await run('launchctl', ['bootout', domain + '/' + label])
  let result = await run('launchctl', ['bootstrap', domain, plist])
  if (result.code !== 0) {
    await delay(1000)
    result = await run('launchctl', ['bootstrap', domain, plist])
  }
  if (result.code !== 0) throw new Error('desktop-session-required')
  await must('launchctl', ['kickstart', domain + '/' + label])
}
async function runtimePath() {
  if (system.hostRuntime && (await exists(join(system.hostRuntime, 'app', 'host', 'cli.js'))))
    return system.hostRuntime
  if (process.platform === 'linux') {
    const unit = await readFile(
      join(home, '.config/systemd/user/lanto-host.service'),
      'utf8'
    ).catch(() => '')
    const match = unit.match(/^ExecStart=(?:"[^"]+"|\S+)\s+"([^"]+)\/app\/host\/cli.js"/m)
    if (match) return match[1]
  }
  throw new Error('host-runtime-not-found')
}
async function hostCommand(command) {
  const runtime = await runtimePath()
  return must(process.execPath, [
    join(runtime, 'app/host/cli.js'),
    command,
    '--data-dir',
    system.hostData
  ])
}
async function ensureHost() {
  if (system.hostInstalled) {
    try {
      await hostCommand('status')
      return { reused: true }
    } catch {
      /* Restart an existing registered service, preserving its runtime and identity. */
    }
    if (win) await ps("Start-ScheduledTask -TaskName 'Lanto Host'")
    else if (process.platform === 'darwin')
      await must('launchctl', ['kickstart', `gui/${process.getuid()}/dev.lanto.host`])
    else
      await must('systemctl', ['--user', 'restart', 'lanto-host.service'], { env: userEnvironment })
    await delay(2000)
    await hostCommand('status')
    return { reused: true }
  }
  if (process.platform === 'linux') {
    const gtk = await run('/usr/bin/python3', [
      '-c',
      'import ctypes.util,sys;sys.exit(0 if ctypes.util.find_library("gtk-3") else 1)'
    ]).catch(() => ({ code: 1 }))
    if (gtk.code !== 0) {
      if (system.distribution !== 'ubuntu') throw new Error('linux-clipboard-dependencies')
      await sudo([
        'env',
        'DEBIAN_FRONTEND=noninteractive',
        'apt-get',
        'install',
        '-y',
        'python3',
        Number(system.version?.split('.')[0]) >= 24 ? 'libgtk-3-0t64' : 'libgtk-3-0'
      ])
    }
  }
  const archive = await verify('host-runtime.tar.gz', request.hostHash)
  const bundle = join(stage, 'bundle')
  await mkdir(bundle, { mode: 0o700 })
  await must('tar', ['-xzf', archive, '-C', bundle])
  const runtime = win
    ? join(process.env.ProgramFiles, 'Lanto Host', 'host-' + request.hostHash.slice(0, 12))
    : join(home, '.lanto/runtime', 'host-' + request.hostHash.slice(0, 12))
  await mkdir(dirname(runtime), { recursive: true, mode: 0o700 })
  if (!(await exists(runtime)))
    await cp(bundle, runtime, { recursive: true, errorOnExist: true, force: false })
  if (win) {
    await mkdir(join(runtime, 'node'), { recursive: true })
    await copyFile(process.execPath, join(runtime, 'node/node.exe'))
    await ps(
      `& ${psQuote(join(runtime, 'install-windows-host.ps1'))} -Name ${psQuote(request.name)} -Address ${psQuote(request.address)} -DataDirectory ${psQuote(system.hostData)}; & ${psQuote(join(runtime, 'install-windows-clipboard.ps1'))} -DataDirectory ${psQuote(system.hostData)}`
    )
  } else if (process.platform === 'linux') {
    await must(
      'bash',
      [
        join(runtime, 'install-linux-host.sh'),
        '--name',
        request.name,
        '--address',
        request.address
      ],
      {
        env: {
          ...userEnvironment,
          LANTO_NODE: process.execPath,
          LANTO_HOST_DATA_DIR: system.hostData
        }
      }
    )
  } else {
    await must(process.execPath, [
      join(runtime, 'app/host/cli.js'),
      'init',
      '--data-dir',
      system.hostData,
      '--name',
      request.name,
      '--address',
      request.address
    ])
    const helperDirectory = join(runtime, 'native/macos')
    if (await exists(join(helperDirectory, 'manifest.json'))) {
      const helper = JSON.parse(await readFile(join(helperDirectory, 'manifest.json'), 'utf8'))
      if (!/^clipboard-[a-f0-9]{12}$/.test(helper.name)) throw new Error('asset-checksum')
      const binary = await readFile(join(helperDirectory, helper.name))
      if (createHash('sha256').update(binary).digest('hex') !== helper.sha256)
        throw new Error('asset-checksum')
      const destination = join(system.hostData, 'clipboard/native')
      await mkdir(destination, { recursive: true, mode: 0o700 })
      await writeFile(join(destination, helper.name), binary, { mode: 0o700 })
      await chmod(join(destination, helper.name), 0o700)
    }
    await launchAgent(
      'dev.lanto.host',
      [process.execPath, join(runtime, 'app/host/cli.js'), 'start', '--data-dir', system.hostData],
      runtime
    )
  }
  system.hostRuntime = runtime
  for (let i = 0; i < 20; i++) {
    try {
      await hostCommand('status')
      return { reused: false, runtime }
    } catch {
      await delay(1000)
    }
  }
  throw new Error('host-not-ready')
}
async function configureNewSunshine(executable, config) {
  await mkdir(config, { recursive: true, mode: 0o700 })
  const conf = join(config, 'sunshine.conf')
  // Existing state and administrator accounts are never reset by this installer.
  const state = join(config, 'sunshine_state.json')
  if (!(await exists(conf)))
    await writeFile(conf, 'sunshine_name = ' + request.name.replace(/[\r\n]/g, '') + '\n', {
      mode: 0o600
    })
  const stateData = await readFile(state, 'utf8')
    .then(JSON.parse)
    .catch(() => ({}))
  if (!stateData.username && !stateData.password && !stateData.salt) {
    const auth = { username: 'lanto', password: randomBytes(32).toString('base64url') }
    await must(executable, [conf, '--creds', auth.username, auth.password], { cwd: config })
    await mkdir(dirname(system.mediaAdminPath), { recursive: true, mode: 0o700 })
    if (await exists(system.mediaAdminPath))
      await copyFile(system.mediaAdminPath, system.mediaAdminPath + '.backup-' + Date.now())
    await writeFile(system.mediaAdminPath, JSON.stringify(auth), { mode: 0o600 })
    if (win)
      await ps(
        `$p=${psQuote(system.mediaAdminPath)}; $acl=New-Object Security.AccessControl.FileSecurity; $acl.SetAccessRuleProtection($true,$false); foreach($sid in @('S-1-5-18','S-1-5-32-544')){$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.SecurityIdentifier]::new($sid),'FullControl','Allow'))}; Set-Acl -LiteralPath $p -AclObject $acl`
      )
    else await chmod(system.mediaAdminPath, 0o600)
  }
  return conf
}
async function ensureSunshine() {
  let newlyInstalled = false
  if (!system.sunshineInstalled) {
    const installer = await verify(request.asset.name, request.asset.sha256)
    if (win) {
      const result = await run('msiexec.exe', ['/i', installer, '/qn', '/norestart'], {
        timeout: 600_000
      })
      if (![0, 3010].includes(result.code)) throw new Error('sunshine-install-failed')
      if (result.code === 3010) return { attention: 'restart-required' }
    } else if (process.platform === 'linux') {
      await sudo(['env', 'DEBIAN_FRONTEND=noninteractive', 'apt-get', 'install', '-y', installer])
    } else {
      const mount = join(stage, 'sunshine-mount')
      await mkdir(mount)
      await must('hdiutil', ['attach', installer, '-nobrowse', '-readonly', '-mountpoint', mount])
      try {
        const apps = (await readdir(mount)).filter((name) => name.toLowerCase() === 'sunshine.app')
        if (apps.length !== 1) throw new Error('sunshine-install-failed')
        const destination = join(home, 'Applications/Sunshine.app')
        await mkdir(dirname(destination), { recursive: true })
        if (await exists(destination)) throw new Error('sunshine-already-exists')
        await must('ditto', [join(mount, apps[0]), destination])
        system.sunshinePath = destination
      } finally {
        await run('hdiutil', ['detach', mount])
      }
    }
    newlyInstalled = true
  }
  if (system.sunshineRunning && !newlyInstalled) return { reused: true }
  if (win) {
    if (newlyInstalled) {
      await ps('Stop-Service SunshineService -ErrorAction SilentlyContinue')
      await configureNewSunshine(system.sunshinePath, system.sunshineConfig)
    }
    await ps('Start-Service SunshineService')
  } else if (process.platform === 'linux') {
    if (newlyInstalled)
      await configureNewSunshine(
        system.sunshinePath || '/usr/bin/sunshine',
        join(home, '.config/sunshine')
      )
    await must('systemctl', ['--user', 'enable', '--now', 'sunshine.service'], {
      env: userEnvironment
    })
    if (newlyInstalled)
      await must('systemctl', ['--user', 'restart', 'sunshine.service'], { env: userEnvironment })
  } else {
    const executable = join(system.sunshinePath, 'Contents/MacOS/sunshine')
    const config = join(home, '.config/sunshine')
    const conf = newlyInstalled
      ? await configureNewSunshine(executable, config)
      : join(config, 'sunshine.conf')
    if (!newlyInstalled) {
      // A custom existing launch agent may carry capture/audio settings. Keep it.
      const labels = ['dev.lanto.sunshine.native', 'dev.lanto.sunshine', 'com.lizardbyte.sunshine']
      let started = false
      for (const label of labels) {
        if (
          (await run('launchctl', ['kickstart', `gui/${process.getuid()}/${label}`])).code === 0
        ) {
          started = true
          break
        }
      }
      if (!started) throw new Error('existing-sunshine-start-required')
    } else await launchAgent('dev.lanto.sunshine', [executable, conf], config)
  }
  return {
    reused: !newlyInstalled,
    ...(process.platform === 'darwin' && newlyInstalled ? { attention: 'mac-permissions' } : {})
  }
}
async function configureNetwork() {
  const address = (process.env.SSH_CONNECTION || '').split(' ')[0]
  if (!address || !/^[a-fA-F0-9.:]+$/.test(address)) throw new Error('ssh-address-missing')
  if (process.platform === 'linux') {
    const ufw = await run('sh', ['-c', 'command -v ufw'])
    if (ufw.code === 0) {
      const status = await sudo(['ufw', 'status'])
      if (/Status: active/.test(status)) {
        for (const port of ['48199', '47984', '47989', '48010'])
          await sudo([
            'ufw',
            'allow',
            'from',
            address,
            'to',
            'any',
            'port',
            port,
            'proto',
            'tcp',
            'comment',
            'Lanto'
          ])
        for (const port of ['47998:48000', '48002', '48010'])
          await sudo([
            'ufw',
            'allow',
            'from',
            address,
            'to',
            'any',
            'port',
            port,
            'proto',
            'udp',
            'comment',
            'Lanto'
          ])
      }
    }
  } else if (win) {
    await ps(
      `foreach($r in @(@{Name='Lanto-Deploy-TCP';Protocol='TCP';Ports=@('48199','47984','47989','48010')},@{Name='Lanto-Deploy-UDP';Protocol='UDP';Ports=@('47998-48000','48002','48010')})){if(!(Get-NetFirewallRule -Name $r.Name -ErrorAction SilentlyContinue)){New-NetFirewallRule -Name $r.Name -DisplayName $r.Name -Direction Inbound -Action Allow -Protocol $r.Protocol -LocalPort $r.Ports -RemoteAddress LocalSubnet -Profile Any | Out-Null}}`
    )
  }
  return { configured: true }
}
async function api(path, auth, csrf = '', body) {
  return new Promise((resolvePromise, reject) => {
    // The request stays on authenticated SSH's remote loopback. Sunshine uses a
    // self-signed local certificate; no remote TLS endpoint is accepted here.
    const req = https.request(
      {
        hostname: '127.0.0.1',
        port: 47990,
        path,
        method: body ? 'POST' : 'GET',
        rejectUnauthorized: false,
        auth: auth.username + ':' + auth.password,
        headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
        timeout: 4000
      },
      (res) => {
        let text = ''
        res.on('data', (chunk) => {
          text += chunk
          if (text.length > 100000) req.destroy()
        })
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error('sunshine-admin-required'))
          try {
            resolvePromise(JSON.parse(text))
          } catch {
            reject(new Error('sunshine-api-invalid'))
          }
        })
      }
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => reject(new Error('sunshine-api-unreachable')))
    req.end(body ? JSON.stringify(body) : undefined)
  })
}
async function mediaPin() {
  if (!/^\d{4}$/.test(request.pin)) throw new Error('invalid-pin')
  let auth
  try {
    auth = request.mediaAuth || JSON.parse(await readFile(system.mediaAdminPath, 'utf8'))
  } catch {
    throw new Error('sunshine-admin-required')
  }
  const csrf = (await api('/api/csrf-token', auth)).csrf_token
  const normalize = (value) => value?.replace(/^::ffff:/, '')
  const address = request.tunnelControllerId
    ? await tunnelAgent().peerAddress()
    : normalize((process.env.SSH_CONNECTION || '').split(' ')[0])
  for (let i = 0; i < 35; i++) {
    const response = await api('/api/pin', auth, csrf)
    const pending = (response.pairings || []).filter(
      (entry) => normalize(entry.address) === address
    )
    if (pending.length > 1) throw new Error('ambiguous-media-pairing')
    if (pending.length === 1) {
      const result = await api('/api/pin', auth, csrf, {
        pairing_id: pending[0].id,
        pin: request.pin,
        name: 'Lanto'
      })
      if (!result.status) throw new Error('media-pairing-rejected')
      return { paired: true }
    }
    await delay(750)
  }
  throw new Error('media-pairing-timeout')
}
async function main() {
  if (request.action === 'cleanup') {
    // stage was canonicalized and checked against this user's private deploy root.
    await rm(stage, { recursive: true })
    return { removed: true }
  }
  if (request.action === 'host') return ensureHost()
  if (request.action === 'sunshine') return ensureSunshine()
  if (request.action === 'network') return configureNetwork()
  if (request.action === 'tunnel') return tunnelAgent().ensure()
  if (request.action === 'ticket') {
    const output = await hostCommand('pair')
    const ticket = output.match(/LANTO1\.[A-Za-z0-9_-]+/)
    if (!ticket) throw new Error('host-ticket-unavailable')
    return { ticket: ticket[0] }
  }
  if (request.action === 'status') return { host: JSON.parse(await hostCommand('status')) }
  if (request.action === 'media-pin') return mediaPin()
  throw new Error('invalid-action')
}
function tunnelAgent() {
  return createTunnelAgent({
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
  })
}
try {
  console.log(
    'LANTO_DEPLOY_JSON:' +
      Buffer.from(JSON.stringify({ ok: true, value: await main() })).toString('base64')
  )
} catch (error) {
  console.log(
    'LANTO_DEPLOY_JSON:' +
      Buffer.from(JSON.stringify({ ok: false, error: error.message })).toString('base64')
  )
  process.exitCode = 1
} finally {
  request.administratorPassword = ''
  request.pin = ''
  request.mediaAuth = undefined
}
