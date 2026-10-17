import { join } from 'node:path'
import { readJSON, writeJSON } from '../common/json-file.ts'
import { defaultConfig } from '../shared/model.ts'
import type { Config } from '../shared/model.ts'
import { configSchema } from '../shared/validation.ts'

export class ConfigStore {
  readonly file: string

  constructor(directory: string) {
    this.file = join(directory, 'config.json')
  }

  async load(): Promise<Config> {
    const contents = await readJSON(this.file)
    if (contents === undefined) return defaultConfig()
    try {
      const config = configSchema.parse(contents)
      // Upgrade the old default once; preserve user-selected shortcuts and later edits.
      const legacy = contents as { settings?: { minimizeOnBlur?: boolean; lockInput?: boolean } }
      if (
        legacy.settings?.minimizeOnBlur === undefined &&
        legacy.settings?.lockInput === undefined &&
        config.settings.returnShortcut === 'Control+Alt+F12'
      ) {
        config.settings.returnShortcut = defaultConfig().settings.returnShortcut
      }
      return config
    } catch {
      throw new Error(
        `Cannot read the configuration; the original file was preserved. Inspect it or back it up before moving it: ${this.file}`
      )
    }
  }

  async save(config: Config): Promise<void> {
    await writeJSON(this.file, configSchema.parse(config))
  }
}
