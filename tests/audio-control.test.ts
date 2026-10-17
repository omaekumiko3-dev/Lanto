import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createAudioControl } from '../src/main/audio-control.ts'
import { removeTestDirectory } from './temp.ts'

test('stream audio starts at the saved gain, stays isolated and cleans up on exit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-audio-'))
  try {
    const first = await createAudioControl(directory, { volume: 37, muted: true })
    const second = await createAudioControl(directory, { volume: 82, muted: false })
    assert.equal(first.environment.LANTO_VOLUME, '0')
    assert.equal(await readFile(first.environment.LANTO_VOLUME_FILE, 'utf8'), '0\n')
    await first.setAudio({ volume: 37, muted: false })
    assert.equal(await readFile(first.environment.LANTO_VOLUME_FILE, 'utf8'), '37\n')
    assert.equal(await readFile(second.environment.LANTO_VOLUME_FILE, 'utf8'), '82\n')
    await first.close()
    await assert.rejects(first.setAudio({ volume: 20, muted: false }), /stream ended/)
    await second.close()
    assert.deepEqual(await readdir(directory), [])
  } finally {
    await removeTestDirectory(directory, 'lanto-audio-')
  }
})
