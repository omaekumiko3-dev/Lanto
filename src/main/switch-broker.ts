import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { switchBinding } from './input-control.ts'

/** A native message loop preserves physical modifier/key edges across SDL process handoffs. */
export class SwitchBroker {
  readonly map = `Local\\LantoSwitch-${randomUUID()}`
  private child: ChildProcessWithoutNullStreams | undefined
  private response: ((line: string) => void) | undefined
  private ready = false
  private readonly executable: string
  private readonly callback: () => void
  private readonly failed: () => void
  constructor(executable: string, callback: () => void, failed: () => void) {
    this.executable = executable
    this.callback = callback
    this.failed = failed
  }
  get registered(): boolean {
    return this.ready
  }

  private expect(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.response = undefined
        reject(new Error('The keyboard switch helper did not respond'))
      }, 5000)
      this.response = (line) => {
        clearTimeout(timer)
        this.response = undefined
        resolve(line)
      }
    })
  }
  async start(value: string): Promise<void> {
    const binding = switchBinding(value)
    const response = this.expect()
    const child = spawn(
      this.executable,
      [String(process.pid), this.map, String(binding.key), String(binding.modifiers)],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }
    )
    this.child = child
    let buffer = ''
    child.stdout.on('data', (data: Buffer) => {
      buffer += data.toString('ascii')
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).trim()
        buffer = buffer.slice(newline + 1)
        if (line === 'SWITCH') {
          if (this.ready) this.callback()
        } else this.response?.(line)
      }
      if (buffer.length > 4096) buffer = ''
    })
    const exited = () => {
      if (this.child !== child) return
      this.child = undefined
      const wasReady = this.ready
      this.ready = false
      this.response?.('EXITED')
      if (wasReady) this.failed()
    }
    child.once('error', exited)
    child.once('exit', exited)
    child.stdin.on('error', () => {})
    if ((await response) !== 'READY') {
      this.close()
      throw new Error('The switch shortcut is unavailable or the keyboard helper could not start')
    }
    this.ready = true
  }
  async bind(value: string): Promise<void> {
    if (!this.child || !this.ready)
      throw new Error('The keyboard switch helper is unavailable; restart Lanto')
    const binding = switchBinding(value)
    const response = this.expect()
    this.child.stdin.write(`${binding.key} ${binding.modifiers}\n`)
    if ((await response) !== 'BOUND')
      throw new Error('The switch shortcut is already in use; the previous shortcut was preserved')
  }
  close(): void {
    this.ready = false
    const child = this.child
    this.child = undefined
    this.response?.('EXITED')
    child?.stdin.end()
    if (child) {
      const timer = setTimeout(() => child.kill(), 1000)
      timer.unref()
      child.once('exit', () => clearTimeout(timer))
    }
  }
}
