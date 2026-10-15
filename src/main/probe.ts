import { canConnect } from '../common/tcp.ts'
import type { ProbeResult } from '../shared/model.ts'

export async function probeSunshine(host: string, port = 47989): Promise<ProbeResult> {
  if (!host) throw new Error('Enter the device address first')
  const reachable = await canConnect(host, port)
  return {
    reachable,
    message: reachable
      ? `${port} Port is reachable; pairing and streaming still need to be confirmed in Moonlight`
      : `${port} Port is temporarily unreachable. Check the device address, Sunshine, and firewall`
  }
}
