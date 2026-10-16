export const platformNames = { linux: 'Linux', macos: 'macOS', windows: 'Windows' }
export const phaseNames = {
  idle: 'Waiting to connect',
  launching: 'Starting',
  running: 'Client started',
  stopping: 'Disconnecting',
  failed: 'Needs attention'
}
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Operation incomplete. Try again'
}
