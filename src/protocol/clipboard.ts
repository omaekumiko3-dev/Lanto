import { z } from 'zod'

export const CLIPBOARD_JSON_LIMIT = 36 * 1024 * 1024
export const decimalSize = z.string().regex(/^(0|[1-9][0-9]{0,19})$/)
// These are metadata limits. File bytes are streamed and have no application size limit.
export const fileEntrySchema = z
  .object({
    path: z.string().min(1).max(4096),
    kind: z.enum(['file', 'directory']),
    size: decimalSize
  })
  .strict()
export const clipboardEventSchema = z.discriminatedUnion('kind', [
  z.object({ id: z.uuid(), kind: z.literal('empty') }).strict(),
  z
    .object({ id: z.uuid(), kind: z.literal('text'), text: z.string().max(16 * 1024 * 1024) })
    .strict(),
  z
    .object({
      id: z.uuid(),
      kind: z.literal('image'),
      png: z
        .string()
        .max(24 * 1024 * 1024)
        .regex(/^[A-Za-z0-9+/]*={0,2}$/)
    })
    .strict(),
  z
    .object({
      id: z.uuid(),
      kind: z.literal('files'),
      entries: z.array(fileEntrySchema).min(1).max(100000)
    })
    .strict()
])
export type FileEntry = z.infer<typeof fileEntrySchema>
export type ClipboardEvent = z.infer<typeof clipboardEventSchema>
export type FileEvent = Extract<ClipboardEvent, { kind: 'files' }>
export const clipboardStateSchema = z
  .object({
    revision: z.string(),
    event: clipboardEventSchema.nullable(),
    error: z.string().optional()
  })
  .strict()
export type ClipboardState = z.infer<typeof clipboardStateSchema>
export const clipboardSessionSchema = z
  .object({ enabled: z.boolean(), files: z.boolean() })
  .strict()
export const clipboardApplySchema = z
  .object({ event: clipboardEventSchema, expected: z.string().max(100) })
  .strict()
export type ClipboardSettings = z.infer<typeof clipboardSessionSchema>

export interface ClipboardTransfer {
  id: string
  device: string
  phase: 'transferring' | 'complete' | 'cancelled' | 'failed'
  bytes: string
  total: string
  error?: string
}
export interface ClipboardView {
  enabled: boolean
  files: boolean
  peers: { id: string; name: string; ready: boolean; error?: string }[]
  transfers: ClipboardTransfer[]
  error?: string
}
