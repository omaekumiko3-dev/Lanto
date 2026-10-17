import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const desktopVariables = [
  'DISPLAY',
  'XAUTHORITY',
  'WAYLAND_DISPLAY',
  'XDG_RUNTIME_DIR',
  'XDG_SESSION_TYPE',
  'DBUS_SESSION_BUS_ADDRESS'
] as const

async function readUserSession(): Promise<unknown> {
  try {
    const { stdout } = await run('systemctl', ['--user', 'show-environment', '--output=json'], {
      timeout: 2000,
      maxBuffer: 256 * 1024
    })
    return JSON.parse(stdout)
  } catch {
    // Older systemctl versions cannot render the environment as JSON.
    const { stdout } = await run(
      'busctl',
      [
        '--user',
        '--json=short',
        'get-property',
        'org.freedesktop.systemd1',
        '/org/freedesktop/systemd1',
        'org.freedesktop.systemd1.Manager',
        'Environment'
      ],
      { timeout: 2000, maxBuffer: 256 * 1024 }
    )
    const value = JSON.parse(stdout) as { type?: string; data?: unknown }
    if (value.type !== 'as' || !Array.isArray(value.data)) return {}
    return Object.fromEntries(
      value.data
        .filter((entry): entry is string => typeof entry === 'string' && entry.includes('='))
        .map((entry) => [entry.slice(0, entry.indexOf('=')), entry.slice(entry.indexOf('=') + 1)])
    )
  }
}

// A user service may start before the desktop imports DISPLAY and XAUTHORITY.
// Refresh only the helper's desktop environment on every launch, including after logout/login.
export async function linuxClipboardEnvironment(
  inherited: NodeJS.ProcessEnv,
  readSession: () => Promise<unknown> = readUserSession
): Promise<NodeJS.ProcessEnv> {
  const environment = { ...inherited }
  try {
    const session = await readSession()
    if (!session || typeof session !== 'object' || Array.isArray(session)) return environment
    for (const key of desktopVariables) {
      const value = (session as Record<string, unknown>)[key]
      if (typeof value === 'string' && value.length <= 4096 && !value.includes('\0'))
        environment[key] = value
    }
  } catch {
    // Interactive launches and systems without a user manager retain their own session.
  }
  return environment
}
