import { readFile, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { Platform, Settings } from '../shared/model.ts'

/** Map the selected native features to one owned media process. */
export async function nativeEnvironment(
  executable: string,
  settings: Settings,
  hostPlatform: Platform,
  platform: NodeJS.Platform = process.platform
): Promise<Record<string, string>> {
  // The native host cursor protocol is currently implemented only on macOS.
  const localCursor = settings.localCursor && hostPlatform === 'macos'
  const environment: Record<string, string> = {
    LANTO_LOCAL_CURSOR: localCursor ? '1' : '0'
  }
  if (platform === 'win32' && settings.windowsPipeline === 'shared-bind') {
    environment.D3D11VA_FORCE_SEPARATE_DEVICES = '0'
    environment.D3D11VA_FORCE_BIND = '1'
  }
  if (localCursor) {
    const supported = await hasMediaFeature(executable, 'localCursorProtocol')
    if (!supported)
      throw new Error(
        'The local cursor requires the Lanto native Moonlight build; select the bundled program or disable the local cursor in settings'
      )
  }
  return environment
}

export async function hasMediaFeature(
  executable: string,
  feature: 'localCursorProtocol' | 'audioVolumeProtocol' | 'automatedPairProtocol'
): Promise<boolean> {
  try {
    const path = join(dirname(executable), 'lanto-media.json')
    const info = await stat(path)
    if (!info.isFile() || info.size > 4096) return false
    const value: unknown = JSON.parse(await readFile(path, 'utf8'))
    return (
      typeof value === 'object' &&
      value !== null &&
      feature in value &&
      (value as Record<string, unknown>)[feature] === 1
    )
  } catch {
    return false
  }
}
