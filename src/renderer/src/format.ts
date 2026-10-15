export const platformNames = { linux: 'Linux', macos: 'macOS', windows: 'Windows' }
export const phaseNames = {
  idle: 'Waiting to connect',
  launching: 'Starting',
  running: 'Client started',
  stopping: 'Returning to this machine',
  failed: 'Needs attention'
}
export function shortcutLabel(value: string): string {
  return value.replace(/CommandOrControl|Control/g, 'Ctrl').replace(/\+/g, ' + ')
}
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Operation incomplete. Try again'
}
