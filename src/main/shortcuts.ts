import { globalShortcut } from 'electron'
import { SwitchBroker } from './switch-broker.ts'

export class ReturnShortcut {
  private current = ''
  private readonly callback: () => void
  private readonly broker?: SwitchBroker
  constructor(
    callback: () => void,
    executable?: string,
    failed: () => void = () => {},
    emergency: () => void = () => {}
  ) {
    this.callback = callback
    if (process.platform === 'win32' && executable)
      this.broker = new SwitchBroker(executable, callback, failed, emergency)
  }
  get registered(): boolean {
    return this.broker ? this.broker.registered : Boolean(this.current)
  }
  get environment(): Record<string, string> {
    return {
      LANTO_SWITCH_MAP: this.broker?.map ?? '',
      LANTO_EMERGENCY_SEQUENCE: String(this.broker?.emergencySequence ?? 0)
    }
  }
  focus(pid: number, window: number): void {
    this.broker?.focus(pid, window)
  }

  private register(value: string): boolean {
    try {
      return globalShortcut.register(value, this.callback)
    } catch {
      return false
    }
  }

  async start(value: string): Promise<void> {
    if (this.broker) {
      try {
        await this.broker.start(value)
        this.current = value
      } catch {
        this.broker.close()
      }
      return
    }
    if (this.register(value)) this.current = value
  }

  async update(value: string, save: () => Promise<void>): Promise<void> {
    const previous = this.current
    const changed = previous !== value
    if (this.broker) {
      if (!this.registered) await this.broker.start(value)
      else if (changed) await this.broker.bind(value)
      try {
        await save()
      } catch (error) {
        if (changed && previous) await this.broker.bind(previous)
        else if (!previous) this.broker.close()
        throw error
      }
      this.current = value
      return
    }
    if (changed && !this.register(value))
      throw new Error(
        'The switch shortcut is invalid or already in use; choose another combination. The previous shortcut was preserved'
      )
    try {
      await save()
    } catch (error) {
      if (changed) globalShortcut.unregister(value)
      throw error
    }
    if (changed) {
      if (previous) globalShortcut.unregister(previous)
      this.current = value
    }
  }

  close(): void {
    this.broker?.close()
    if (this.current && !this.broker) globalShortcut.unregister(this.current)
    this.current = ''
  }
}
