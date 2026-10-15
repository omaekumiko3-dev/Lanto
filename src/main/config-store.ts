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
      throw new Error(`Unable to read the configuration file; the original file has been kept. Check or back it up, then move it: ${this.file}`)
    }
  }

  async save(config: Config): Promise<void> {
    await writeJSON(this.file, configSchema.parse(config))
  }
}
