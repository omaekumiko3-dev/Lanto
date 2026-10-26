import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { switchBinding } from './input-control.ts'

/** A native message loop preserves physical modifier/key edges across SDL process handoffs. */
export class SwitchBroker {
  readonly map = `Local\\LantoSwitch-${randomUUID()}`
  private child: ChildProcessWithoutNullStreams | undefined
  private response: ((line: string) => void) | undefined
  private ready = false
  emergencySequence = 0
  systemWorker: { pid: number; session: number } | undefined
  private sequence = 0
  private readonly executable: string
  private readonly callback: () => void
  private readonly failed: () => void
  private readonly emergency: () => void
  constructor(
    executable: string,
    callback: () => void,
    failed: () => void,
    emergency: () => void = () => {}
  ) {
    this.executable = executable
    this.callback = callback
    this.failed = failed
    this.emergency = emergency
  }
  get registered(): boolean {
    return this.ready
  }

  private expect(): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.response = undefined
        reject(new Error('The keyboard switch helper did not respond'))
      }, 10000)
      this.response = (line) => {
        clearTimeout(timer)
        this.response = undefined
        resolve(line)
      }
    })
  }
  async start(value: string): Promise<void> {
    this.sequence = this.emergencySequence = 0
    this.systemWorker = undefined
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
        if (line.startsWith('SYSTEM_READY ')) {
          const [, pid, session] = line.split(' ').map(Number)
          if (pid && session) this.systemWorker = { pid, session }
        } else if (line.startsWith('EMERGENCY ')) {
          const [, emergency, sequence] = line.split(' ').map(Number)
          if (
            Number.isSafeInteger(emergency) &&
            emergency! > this.emergencySequence &&
            Number.isSafeInteger(sequence)
          ) {
            this.emergencySequence = emergency!
            this.sequence = sequence!
            if (this.ready) this.emergency()
          }
        } else if (line.startsWith('SWITCH ')) {
          const sequence = Number(line.slice(7))
          if (
            Number.isSafeInteger(sequence) &&
            sequence > this.sequence &&
            sequence - this.sequence <= 1024
          ) {
            const count = sequence - this.sequence
            this.sequence = sequence
            if (this.ready) for (let i = 0; i < count; ++i) this.callback()
          }
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
  focus(pid: number, window: number): void {
    if (
      this.ready &&
      this.systemWorker &&
      Number.isSafeInteger(pid) &&
      Number.isSafeInteger(window)
    )
      this.child?.stdin.write(`FOCUS ${pid} ${window}\n`)
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
