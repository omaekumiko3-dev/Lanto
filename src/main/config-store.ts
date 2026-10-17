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
      return configSchema.parse(contents)
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
