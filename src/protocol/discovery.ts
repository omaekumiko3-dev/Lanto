import Bonjour from 'bonjour-service'
import { isIP } from 'node:net'
import { discoveredHostSchema, SERVICE_TYPE } from './host.ts'
import type { DiscoveredHost, HostIdentity } from './host.ts'

export function parseAnnouncement(service: {
  txt?: Record<string, unknown>
  addresses?: string[]
  port: number
}): DiscoveredHost | null {
  const address =
    service.addresses?.find((value) => isIP(value) === 4 && !value.startsWith('127.')) ||
    service.addresses?.find((value) => isIP(value) > 0)
  const parsed = discoveredHostSchema.safeParse({
    protocolVersion: Number(service.txt?.v),
    id: service.txt?.id,
    name: service.txt?.name,
    platform: service.txt?.platform,
    address,
    port: service.port
  })
  return parsed.success ? parsed.data : null
}

export function advertiseHost(
  identity: HostIdentity,
  port: number,
  onError: () => void
): () => void {
  const bonjour = new Bonjour(undefined, onError)
  const announcement = bonjour.publish({
    name: `Lanto-${identity.id}`,
    type: SERVICE_TYPE,
    port,
    txt: { v: '1', id: identity.id, name: identity.name, platform: identity.platform }
  })
  announcement.on('error', onError)
  return () => {
    bonjour.unpublishAll()
    bonjour.destroy()
  }
}

export function discoverHosts(duration = 2000): Promise<DiscoveredHost[]> {
  return new Promise((resolve, reject) => {
    const found = new Map<string, DiscoveredHost>()
    let bonjour: Bonjour
    let timer: ReturnType<typeof setTimeout>
    let finished = false
    const finish = (error?: Error) => {
      if (finished) return
      finished = true
      clearTimeout(timer)
      bonjour?.destroy()
      if (error) reject(new Error('LAN discovery is unavailable. You can paste Host pairing credentials directly'))
      else resolve([...found.values()])
    }
    try {
      bonjour = new Bonjour(undefined, (error: Error) => finish(error))
      const browser = bonjour.find({ type: SERVICE_TYPE }, (service) => {
        const host = parseAnnouncement(service)
        if (host && found.size < 100) found.set(host.id, host)
      })
      timer = setTimeout(() => {
        browser.stop()
        finish()
      }, duration)
    } catch {
      finish(new Error('discovery unavailable'))
    }
  })
}
