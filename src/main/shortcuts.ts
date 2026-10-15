import { globalShortcut } from 'electron'

export class ReturnShortcut {
  private current = ''
  private readonly callback: () => void
  constructor(callback: () => void) {
    this.callback = callback
  }
  get registered(): boolean {
    return Boolean(this.current)
  }

  private register(value: string): boolean {
    try {
      return globalShortcut.register(value, this.callback)
    } catch {
      return false
    }
  }

  start(value: string): void {
    if (this.register(value)) this.current = value
  }

  async update(value: string, save: () => Promise<void>): Promise<void> {
    const previous = this.current
    const changed = previous !== value
    if (changed && !this.register(value))
      throw new Error('Return shortcut is invalid or already in use. Choose another key combination; the original shortcut has been kept')
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
    if (this.current) globalShortcut.unregister(this.current)
    this.current = ''
  }
}
