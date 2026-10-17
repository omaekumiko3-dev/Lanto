import { z } from 'zod'
import { isIP } from 'node:net'

export const tunnelAddressSchema = z
  .string()
  .trim()
  .min(1)
  .max(253)
  .refine(
    (value) =>
      isIP(value.replace(/^\[|\]$/g, '')) > 0 ||
      /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.?$/.test(
        value
      ),
    'Enter an IP address or hostname without a protocol or port'
  )

export const tunnelEndpointSchema = z
  .object({
    address: tunnelAddressSchema,
    port: z.number().int().min(1).max(65535).default(48200)
  })
  .strict()
export type TunnelEndpoint = z.output<typeof tunnelEndpointSchema>
export const tunnelPublicKeySchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/)
export const tunnelPeerSchema = z
  .object({
    publicKey: tunnelPublicKeySchema,
    address: z
      .string()
      .regex(/^10\.203\.(?:0|[1-9]\d{0,2})\.(?:0|[1-9]\d{0,2})$/)
      .refine(
        (value) => value.split('.').every((part) => Number(part) <= 255) && value !== '10.203.0.1'
      )
  })
  .strict()

export function tunnelEndpointText(endpoint: TunnelEndpoint): string {
  const address = endpoint.address.replace(/^\[|\]$/g, '')
  return `${address.includes(':') ? '[' + address + ']' : address}:${endpoint.port}`
}
