import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
if (process.platform === 'win32') {
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      resolve(import.meta.dirname, '../native/build-switch.ps1')
    ],
    { stdio: 'inherit', windowsHide: true }
  )
  if (result.status !== 0) throw new Error('Switch helper build failed')
}
