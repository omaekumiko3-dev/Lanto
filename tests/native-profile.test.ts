import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultConfig } from '../src/shared/model.ts'
import { nativeEnvironment } from '../src/main/native-profile.ts'
import { removeTestDirectory } from './temp.ts'

test('stock media remains usable and cursor mode cannot silently target an unsupported client', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'lanto-native-profile-'))
  const executable = join(directory, 'Moonlight.exe')
  const settings = defaultConfig().settings
  try {
    const normal = await nativeEnvironment(executable, settings, 'win32')
    assert.equal(normal.LANTO_LOCAL_CURSOR, '0')
    assert.equal(normal.D3D11VA_FORCE_BIND, undefined)
    settings.localCursor = true
    await assert.rejects(nativeEnvironment(executable, settings), /Lanto native version/)
    const manifest = join(directory, 'lanto-media.json')
    await writeFile(manifest, '{"localCursorProtocol":2}')
    await assert.rejects(nativeEnvironment(executable, settings), /Lanto native version/)
    await writeFile(manifest, '{"localCursorProtocol":1}')
    settings.windowsPipeline = 'shared-bind'
    const native = await nativeEnvironment(executable, settings, 'win32')
    assert.equal(native.LANTO_LOCAL_CURSOR, '1')
    assert.equal(native.D3D11VA_FORCE_BIND, '1')
    assert.equal(native.D3D11VA_FORCE_SEPARATE_DEVICES, '0')
    assert.equal(
      (await nativeEnvironment(executable, settings, 'darwin')).D3D11VA_FORCE_BIND,
      undefined
    )
    await writeFile(manifest, 'invalid json')
    await assert.rejects(nativeEnvironment(executable, settings), /Lanto native version/)
  } finally {
    await removeTestDirectory(directory, 'lanto-native-profile-')
  }
})
