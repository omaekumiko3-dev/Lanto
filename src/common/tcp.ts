import { createConnection } from 'node:net'

export function canConnect(host: string, port: number, timeout = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: host.replace(/^\[|\]$/g, ''), port })
    let settled = false
    const finish = (reachable: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      socket.destroy()
      resolve(reachable)
    }
    const deadline = setTimeout(() => finish(false), timeout)
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
  })
}
