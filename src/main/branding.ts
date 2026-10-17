import { app, shell } from 'electron'
import type { BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises'
import { join, normalize } from 'node:path'

export const appUserModelId = 'dev.lanto.controller'

export async function updateWindowBranding(
  window: BrowserWindow,
  shortcuts: boolean
): Promise<void> {
  if (process.platform !== 'win32') return
  const artwork = await readFile(join(app.getAppPath(), 'assets/lanto.ico'))
  const revision = createHash('sha256').update(artwork).digest('hex').slice(0, 16)
  const directory = join(app.getPath('userData'), 'branding')
  await mkdir(directory, { recursive: true })
  // Explorer needs the physical path when the launcher virtualizes AppData.
  // A content-specific filename avoids stale Shell icon-cache entries.
  const icon = join(await realpath(directory), `lanto-${revision}.ico`)
  await writeFile(icon, artwork)
  const args = app.isPackaged ? '' : `"${app.getAppPath()}"`
  window.setAppDetails({
    appId: appUserModelId,
    appIconPath: icon,
    appIconIndex: 0,
    relaunchCommand: `"${process.execPath}"${args ? ` ${args}` : ''}`,
    relaunchDisplayName: 'Lanto'
  })
  if (!shortcuts) return
  const pinned = join(
    app.getPath('appData'),
    'Microsoft/Internet Explorer/Quick Launch/User Pinned/TaskBar'
  )
  const links = [
    join(app.getPath('desktop'), 'Lanto.lnk'),
    ...(await readdir(pinned).catch(() => []))
      .filter((name) => name.toLowerCase().endsWith('.lnk'))
      .map((name) => join(pinned, name))
  ]
  for (const link of links) {
    let current
    try {
      current = shell.readShortcutLink(link)
    } catch {
      continue
    }
    if (
      normalize(current.target).toLowerCase() !== normalize(process.execPath).toLowerCase() ||
      (current.args || '').trim() !== args
    )
      continue
    if (current.icon === icon && current.appUserModelId === appUserModelId) continue
    if (
      !shell.writeShortcutLink(link, 'update', { ...current, icon, iconIndex: 0, appUserModelId })
    )
      throw new Error('Unable to update the Lanto shortcut icon')
  }
}
