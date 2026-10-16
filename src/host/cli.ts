import { parseArgs } from 'node:util'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { hostRequest } from '../protocol/request.ts'
import { initializeHost, loadHostConfig } from './config.ts'
import { startHost } from './service.ts'
import { systemdUnit } from './systemd.ts'
import { startDesktopBridge } from '../clipboard/desktop-bridge.ts'

const help = `Lanto Host · Headless LAN-controlled endpoint

npm run host -- init --name Linux1 --address 192.168.1.20
npm run host -- start
npm run host -- pair
npm run host -- status
npm run host -- controllers
npm run host -- revoke <Controller UUID>
npm run host -- service-file
npm run host -- clipboard-agent

All commands can specify --data-dir <Local directory>。
init supports --listen <Bind address>、--port <Port>; existing identity will not be overwritten.
start supports --no-discovery. pair generates a one-time credential valid for five minutes; give it only to your controller.
service-file outputs a systemd user service file on Linux; it does not install it or modify the system by itself.`

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'data-dir': { type: 'string' },
      name: { type: 'string' },
      address: { type: 'string' },
      listen: { type: 'string' },
      port: { type: 'string' },
      'no-discovery': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h' }
    }
  })
  const command = positionals[0]
  if (!command || values.help) {
    console.log(help)
    return
  }
  const directory = resolve(values['data-dir'] || join(homedir(), '.lanto', 'host'))
  if (command === 'clipboard-agent') {
    const bridge = await startDesktopBridge(join(directory, 'clipboard', 'desktop'))
    const stop = () => {
      void bridge.close().catch(() => {
        process.exitCode = 1
      })
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    console.log('Lanto desktop clipboard component has started')
    return
  }
  if (command === 'service-file') {
    if (process.platform !== 'linux') throw new Error('systemd user service is for Linux only')
    console.log(systemdUnit(process.execPath, fileURLToPath(import.meta.url), directory))
    return
  }
  if (command === 'init') {
    const port =
      values.port === undefined
        ? undefined
        : z.coerce.number().int().min(1).max(65535).parse(values.port)
    const config = await initializeHost(directory, {
      name: values.name,
      address: values.address,
      listen: values.listen,
      port
    })
    console.log(
      `Host initialized: ${config.identity.name} (${config.identity.id})\nLocal directory: ${directory}\nPlease run npm run host -- start`
    )
    return
  }
  const config = await loadHostConfig(directory)
  if (command === 'start') {
    const service = await startHost(config, directory, {
      discovery: !values['no-discovery'],
      onDiscoveryError: () => console.error('LAN announcements are unavailable; you can still connect using pairing credentials')
    })
    console.log(
      `Lanto Host has started: ${config.identity.name} · ${config.listen}:${service.port}\nRun npm run host -- pair in another terminal to generate pairing credentials.`
    )
    let stopping = false
    const stop = () => {
      if (stopping) return
      stopping = true
      void service.close().catch(() => {
        process.exitCode = 1
      })
    }
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    return
  }
  const endpoint = {
    address: config.listen === '::' || config.listen === '::1' ? '::1' : '127.0.0.1',
    port: config.port,
    certificate: config.certificate
  }
  const token = config.adminToken
  if (command === 'pair') {
    const result = z
      .object({ ticket: z.string() })
      .parse(await hostRequest(endpoint, '/admin/pair', { method: 'POST', token }))
    console.log(`One-time pairing credentials (valid for five minutes; paste into the Lanto controller):\n${result.ticket}`)
  } else if (command === 'status')
    console.log(JSON.stringify(await hostRequest(endpoint, '/admin/status', { token }), null, 2))
  else if (command === 'controllers')
    console.log(
      JSON.stringify(await hostRequest(endpoint, '/admin/controllers', { token }), null, 2)
    )
  else if (command === 'revoke') {
    const id = z.uuid().parse(positionals[1])
    await hostRequest(endpoint, '/admin/revoke', { method: 'POST', token, body: { id } })
    console.log('Controller authorization revoked')
  } else throw new Error('Unknown command. Use --help to view usage')
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : 'Host operation failed')
  process.exitCode = 1
})
