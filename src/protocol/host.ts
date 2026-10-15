import { z } from 'zod'

export const HOST_PORT = 48199
export const SERVICE_TYPE = 'lanto'
export const protocolVersion = 1 as const
export const hostPlatformSchema = z.enum(['linux', 'macos', 'windows'])
export const hostIdentitySchema = z
  .object({
    protocolVersion: z.literal(1),
    id: z.uuid(),
    name: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
    platform: hostPlatformSchema
  })
  .strict()
export const endpointSchema = z
  .object({
    address: z
      .string()
      .min(1)
      .max(253)
      .regex(/^[a-zA-Z0-9[\]][a-zA-Z0-9.:[\]%-]*$/),
    port: z.number().int().min(1).max(65535),
    certificate: z.string().min(100).max(8192)
  })
  .strict()
export const pairTicketSchema = endpointSchema
  .extend({
    protocolVersion: z.literal(1),
    hostId: z.uuid(),
    secret: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
    expiresAt: z.iso.datetime()
  })
  .strict()
export const pairRequestSchema = z
  .object({
    secret: z.string().regex(/^[a-zA-Z0-9_-]{43}$/),
    controllerId: z.uuid(),
    controllerName: z.string().trim().min(1).max(64)
  })
  .strict()
export const pairResponseSchema = z
  .object({
    identity: hostIdentitySchema,
    token: z.string().regex(/^[a-zA-Z0-9_-]{43}$/)
  })
  .strict()
export const hostStatusSchema = z
  .object({
    identity: hostIdentitySchema,
    startedAt: z.iso.datetime(),
    sunshineReachable: z.boolean()
  })
  .strict()
export const discoveredHostSchema = hostIdentitySchema
  .extend({
    address: endpointSchema.shape.address,
    port: endpointSchema.shape.port
  })
  .strict()

export type HostIdentity = z.infer<typeof hostIdentitySchema>
export type HostEndpoint = z.infer<typeof endpointSchema>
export type PairTicket = z.infer<typeof pairTicketSchema>
export type PairRequest = z.infer<typeof pairRequestSchema>
export type PairResponse = z.infer<typeof pairResponseSchema>
export type HostStatus = z.infer<typeof hostStatusSchema>
export type DiscoveredHost = z.infer<typeof discoveredHostSchema>
export interface TrustedHostView extends HostIdentity {
  address: string
  port: number
  pairedAt: string
  status?: HostStatus
  error?: string
}
