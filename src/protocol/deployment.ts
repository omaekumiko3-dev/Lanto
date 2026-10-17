import { z } from 'zod'
import { endpointSchema } from './host.ts'

export const sshConnectionSchema = z
  .object({
    name: z.string().trim().min(1).max(50),
    host: endpointSchema.shape.address,
    port: z.number().int().min(1).max(65535).default(22),
    username: z
      .string()
      .trim()
      .min(1)
      .max(128)
      .regex(/^[^\r\n\0]+$/),
    auth: z.enum(['password', 'key', 'agent']),
    password: z.string().max(4096).default(''),
    privateKeyPath: z.string().max(4096).default(''),
    passphrase: z.string().max(4096).default(''),
    administratorPassword: z.string().max(4096).default(''),
    sunshineUsername: z.string().max(128).default(''),
    sunshinePassword: z.string().max(4096).default('')
  })
  .strict()
  .superRefine((value, context) => {
    if (value.auth === 'password' && !value.password)
      context.addIssue({ code: 'custom', path: ['password'], message: 'Enter an SSH password' })
    if (value.auth === 'key' && !value.privateKeyPath)
      context.addIssue({
        code: 'custom',
        path: ['privateKeyPath'],
        message: 'Select an SSH private key file'
      })
  })

export type SshConnectionInput = z.input<typeof sshConnectionSchema>
export type SshConnection = z.output<typeof sshConnectionSchema>
export type DeploymentPhase =
  | 'idle'
  | 'connecting'
  | 'host-key'
  | 'inspecting'
  | 'ready'
  | 'deploying'
  | 'attention'
  | 'complete'
  | 'failed'
  | 'cancelled'

export interface RemoteSystem {
  platform: 'windows' | 'macos' | 'linux'
  architecture: 'x64' | 'arm64'
  name: string
  user: string
  home: string
  distribution?: string
  version?: string
  desktopUser?: string
  administrator: boolean
  hostInstalled: boolean
  sunshineInstalled: boolean
  sunshineRunning: boolean
  hostRuntime?: string
  nodePath?: string
  hostData?: string
  sunshinePath?: string
  sunshineConfig?: string
  mediaAdminPath?: string
}

export interface DeploymentStep {
  id: string
  title: string
  phase: 'pending' | 'running' | 'complete' | 'attention' | 'failed' | 'skipped'
  detail?: string
}

// This is the only deployment data sent to the renderer. Credentials, scripts,
// pairing tickets and SSH output stay in the main process.
export interface DeploymentView {
  phase: DeploymentPhase
  name?: string
  host?: string
  fingerprint?: string
  previousFingerprint?: string
  system?: RemoteSystem
  steps: DeploymentStep[]
  progress?: { bytes: number; total: number; label: string }
  message?: string
  deviceId?: string
}

export const initialDeployment = (): DeploymentView => ({ phase: 'idle', steps: [] })
