import { z } from 'zod'
import { isIP } from 'node:net'

const cleanText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'Must not contain control characters')

export const deviceInputSchema = z
  .object({
    id: z.uuid().optional(),
    name: cleanText(50),
    host: z
      .string()
      .trim()
      .max(253)
      .refine(
        (value) =>
          value === '' ||
          isIP(value.replace(/^\[|\]$/g, '')) > 0 ||
          /^(?=.{1,253}$)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.?$/.test(
            value
          ),
        'Address must be an IP address or hostname; do not include a protocol, port, or command-line arguments'
      ),
    platform: z.enum(['linux', 'macos', 'windows']),
    appName: cleanText(120).refine((value) => !value.startsWith('-'), 'App name must not start with a hyphen'),
    hostId: z.uuid().optional(),
    volume: z.number().int().min(0).max(100).default(100),
    muted: z.boolean().default(false)
  })
  .strict()

export const settingsSchema = z
  .object({
    moonlightPath: z
      .string()
      .trim()
      .max(4096)
      .refine((value) => !/[\u0000-\u001f]/.test(value)),
    returnShortcut: cleanText(80),
    resolution: z.enum(['2560x1440', '1920x1080']),
    fps: z.number().int().min(15).max(60),
    bitrateMbps: z.number().int().min(5).max(100),
    windowMode: z.enum(['borderless', 'windowed']),
    lowLatency: z.boolean().default(false),
    showPerformanceOverlay: z.boolean().default(false),
    windowsPipeline: z.enum(['auto', 'shared-bind']).default('auto'),
    localCursor: z.boolean().default(false),
    shareClipboard: z.boolean().default(false),
    shareFiles: z.boolean().default(false)
  })
  .strict()

export const configSchema = z
  .object({
    schemaVersion: z.literal(1),
    devices: z
      .array(deviceInputSchema.extend({ id: z.uuid() }))
      .max(50)
      .refine(
        (devices) => new Set(devices.map((device) => device.id)).size === devices.length,
        'Duplicate device ID'
      ),
    settings: settingsSchema
  })
  .strict()

export const deviceIdSchema = z.uuid()

export const deviceAudioSchema = z
  .object({
    id: deviceIdSchema,
    volume: z.number().int().min(0).max(100),
    muted: z.boolean()
  })
  .strict()

export function readableError(error: unknown): string {
  if (error instanceof z.ZodError) {
    const issue = error.issues[0]
    return `Invalid configuration: ${issue?.path.join('.') || 'Input'} · ${issue?.message || 'Please check the input'}`
  }
  return error instanceof Error ? error.message : 'Operation incomplete. Try again'
}
