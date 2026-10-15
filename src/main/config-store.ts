import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { defaultConfig } from '../shared/model.ts'
import type { Config } from '../shared/model.ts'
import { configSchema } from '../shared/validation.ts'

export class ConfigStore {
  readonly file: string

  constructor(directory: string) {
    this.file = join(directory, 'config.json')
  }

  async load(): Promise<Config> {
    let contents: string
    try {
      contents = await readFile(this.file, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaultConfig()
      throw error
    }
    try {
      return configSchema.parse(JSON.parse(contents))
    } catch {
      throw new Error(`Unable to read the configuration file; the original file has been kept. Check or back it up, then move it: ${this.file}`)
    }
  }

  async save(config: Config): Promise<void> {
    const validated = configSchema.parse(config)
    const directory = dirname(this.file)
    await mkdir(directory, { recursive: true })
    const temporary = `${this.file}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, this.file)
    } finally {
      await unlink(temporary).catch(() => {})
    }
  }
}
