import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'

export async function removeTestDirectory(directory: string, prefix: string): Promise<void> {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()))
  assert.ok(basename(directory).startsWith(prefix))
  await rm(directory, { recursive: true, force: true })
}
