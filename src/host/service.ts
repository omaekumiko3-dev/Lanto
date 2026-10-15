import { canConnect } from '../common/tcp.ts'
import { advertiseHost } from '../protocol/discovery.ts'
import type { HostStatus } from '../protocol/host.ts'
import type { HostConfig } from './config.ts'
import { PairingService } from './pairing.ts'
import { createHostServer } from './server.ts'

export async function startHost(
  config: HostConfig,
  directory: string,
  options: {
    discovery?: boolean
    onDiscoveryError?: () => void
  } = {}
) {
  const pairing = new PairingService(directory)
  await pairing.load()
  const startedAt = new Date().toISOString()
  const status = async (): Promise<HostStatus> => ({
    identity: config.identity,
    startedAt,
    sunshineReachable: await canConnect('127.0.0.1', 47989)
  })
  let port = config.port
  const createTicket = () =>
    pairing.createTicket({
      hostId: config.identity.id,
      address: config.address,
      port,
      certificate: config.certificate
    })
  const server = createHostServer({ config, pairing, createTicket, status })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(config.port, config.listen, () => {
      server.removeListener('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Host failed to listen on the network port')
  port = address.port
  let stopDiscovery: (() => void) | undefined
  if (options.discovery !== false && !['127.0.0.1', '::1'].includes(config.listen)) {
    try {
      stopDiscovery = advertiseHost(config.identity, port, options.onDiscoveryError || (() => {}))
    } catch {
      options.onDiscoveryError?.()
    }
  }
  return {
    port,
    createTicket,
    async close() {
      stopDiscovery?.()
      await new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      })
    }
  }
}
