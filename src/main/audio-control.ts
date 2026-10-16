import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { unlink } from 'node:fs/promises'
import { writeJSON } from '../common/json-file.ts'
import type { DeviceAudio } from '../shared/model.ts'

export async function createAudioControl(directory: string, audio: DeviceAudio) {
  const file = join(directory, `${randomUUID()}.volume`)
  let closed = false
  const effectiveVolume = (value: DeviceAudio) => (value.muted ? 0 : value.volume)
  await writeJSON(file, effectiveVolume(audio))
  return {
    environment: {
      LANTO_VOLUME_FILE: file,
      LANTO_VOLUME: String(effectiveVolume(audio))
    },
    async setAudio(value: DeviceAudio): Promise<void> {
      if (closed) throw new Error('Stream ended. Reconnect to adjust the volume')
      await writeJSON(file, effectiveVolume(value))
      // The process can exit while an atomic write is in progress.
      if (closed) await unlink(file).catch(() => {})
    },
    async close(): Promise<void> {
      closed = true
      await unlink(file).catch(() => {})
    }
  }
}
