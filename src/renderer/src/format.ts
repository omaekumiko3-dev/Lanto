export const platformNames = { linux: 'Linux', macos: 'macOS', windows: 'Windows' }
export const phaseNames = {
  idle: 'Disconnected',
  launching: 'Starting',
  running: 'Client started',
  stopping: 'Disconnecting',
  failed: 'Needs attention'
}
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Operation incomplete; retry'
}
