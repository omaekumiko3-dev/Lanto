import { createConnection } from 'node:net'
import type { ProbeResult } from '../shared/model.ts'

export function probeSunshine(host: string, port = 47989): Promise<ProbeResult> {
  if (!host) throw new Error('Enter the device address first')
  return new Promise((resolve) => {
    const socket = createConnection({ host: host.replace(/^\[|\]$/g, ''), port })
    let settled = false
    const finish = (reachable: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      socket.destroy()
      resolve({
        reachable,
        message: reachable
          ? `${port} Port is reachable; pairing and streaming still need to be confirmed in Moonlight`
          : `${port} Port is temporarily unreachable. Check the device address, Sunshine, and firewall`
      })
    }
    const deadline = setTimeout(() => finish(false), 2000)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}
