import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { unlink } from 'node:fs/promises'
import { writeJSON } from '../common/json-file.ts'
import type { Settings } from '../shared/model.ts'

export type InputSettings = Pick<Settings, 'lockInput' | 'returnShortcut'>

/** Windows virtual keys, matching Moonlight's physical QWERTY scan-code mapping. */
export function switchBinding(accelerator: string): { key: number; modifiers: number } {
  const parts = accelerator.toLowerCase().split('+')
  const name = parts.pop()!
  const aliases: Record<string, number> = {
    '`': 0xc0,
    '~': 0xc0,
    space: 0x20,
    tab: 9,
    enter: 13,
    return: 13,
    escape: 27,
    esc: 27,
    backspace: 8,
    delete: 46,
    insert: 45,
    home: 36,
    end: 35,
    pageup: 33,
    pagedown: 34,
    left: 37,
    up: 38,
    right: 39,
    down: 40,
    ';': 0xba,
    '=': 0xbb,
    ',': 0xbc,
    '-': 0xbd,
    '.': 0xbe,
    '/': 0xbf,
    '[': 0xdb,
    '\\': 0xdc,
    ']': 0xdd,
    "'": 0xde
  }
  let key = aliases[name]
  if (/^[a-z0-9]$/.test(name)) key = name.toUpperCase().charCodeAt(0)
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(name)) key = 111 + Number(name.slice(1))
  let modifiers = 0
  for (const part of parts) {
    const flag = {
      control: 2,
      ctrl: 2,
      alt: 4,
      shift: 1,
      super: 8,
      meta: 8,
      commandorcontrol: 2,
      cmdorctrl: 2
    }[part]
    if (!flag || modifiers & flag)
      throw new Error('Use Ctrl, Alt, Shift or Super with one keyboard key for switching')
    modifiers |= flag
  }
  if (!key || !modifiers)
    throw new Error(
      'Choose a switch shortcut with a modifier and one letter, number, function or navigation key'
    )
  return { key, modifiers }
}

export async function createInputControl(directory: string, settings: InputSettings) {
  const file = join(directory, `${randomUUID()}.input`)
  let closed = false
  let value = {
    ...switchBinding(settings.returnShortcut),
    locked: settings.lockInput,
    remote: true
  }
  async function update(next: typeof value) {
    if (closed) throw new Error('The stream ended; reconnect before switching')
    await writeJSON(file, next)
    if (closed) {
      await unlink(file).catch(() => {})
      throw new Error('The stream ended; reconnect before switching')
    }
    value = next
  }
  await update(value)
  return {
    environment: { LANTO_INPUT_FILE: file, LANTO_CONTROLLER_PID: String(process.pid) },
    setRemote: (remote: boolean) => update({ ...value, remote }),
    configure: (settings: InputSettings) =>
      update({ ...value, ...switchBinding(settings.returnShortcut), locked: settings.lockInput }),
    async close() {
      closed = true
      await unlink(file).catch(() => {})
    }
  }
}
