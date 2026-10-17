import { spawn, execFile } from 'node:child_process'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { promisify } from 'node:util'
import { createHash } from 'node:crypto'
import { mkdir, access, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { SerialQueue } from '../common/serial-queue.ts'
import { linuxClipboard, macClipboard, windowsClipboard } from './native-sources.ts'

export const nativeContentSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('empty') }).strict(),
  z.object({ kind: z.literal('text'), text: z.string().max(16 * 1024 * 1024) }).strict(),
  z.object({ kind: z.literal('image'), png: z.string().max(24 * 1024 * 1024) }).strict(),
  z
    .object({ kind: z.literal('files'), paths: z.array(z.string().min(1)).min(1).max(100000) })
    .strict()
])
export type NativeContent = z.infer<typeof nativeContentSchema>
export interface ClipboardSnapshot {
  revision: string
  content?: NativeContent
}
export interface DesktopClipboard {
  read(since?: string): Promise<ClipboardSnapshot>
  write(content: NativeContent, expected: string): Promise<string>
  close(): void
}

export class NativeClipboard implements DesktopClipboard {
  private child?: ChildProcessWithoutNullStreams
  private buffer = ''
  private sequence = 0
  private generation = 0
  private readonly queue = new SerialQueue()
  private waiter?: {
    id: number
    resolve: (result: ClipboardSnapshot) => void
    reject: (error: Error) => void
  }
  private readonly directory: string
  constructor(directory: string) {
    this.directory = directory
  }

  private async start(): Promise<void> {
    if (this.child) return
    const generation = this.generation
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    let command: string
    let args: string[]
    if (process.platform === 'win32') {
      const path = join(this.directory, 'clipboard.ps1')
      await writeFile(path, '\ufeff' + windowsClipboard, { mode: 0o600 })
      command = 'powershell.exe'
      args = [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-STA',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path
      ]
    } else if (process.platform === 'darwin') {
      const hash = createHash('sha256').update(macClipboard).digest('hex').slice(0, 12)
      const path = join(this.directory, `clipboard-${hash}`)
      try {
        await access(path)
      } catch {
        const source = path + '.swift'
        await writeFile(source, macClipboard, { mode: 0o600 })
        await promisify(execFile)('/usr/bin/xcrun', ['swiftc', '-O', source, '-o', path], {
          timeout: 120000
        })
      }
      command = path
      args = []
    } else {
      const path = join(this.directory, 'clipboard.py')
      await writeFile(path, linuxClipboard, { mode: 0o600 })
      command = '/usr/bin/python3'
      args = ['-u', path]
    }
    if (generation !== this.generation) throw new Error('Clipboard synchronization stopped')
    const child = spawn(command, args, { windowsHide: true, stdio: 'pipe' })
    this.child = child
    this.buffer = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      this.buffer += chunk
      if (this.buffer.length > 40 * 1024 * 1024) {
        this.close()
        return
      }
      for (let newline; (newline = this.buffer.indexOf('\n')) >= 0;) {
        const line = this.buffer.slice(0, newline)
        this.buffer = this.buffer.slice(newline + 1)
        try {
          const message = JSON.parse(line) as {
            id: number
            error?: string
            result?: ClipboardSnapshot
          }
          if (message.id !== this.waiter?.id) continue
          const waiter = this.waiter
          if (message.error) waiter.reject(new Error(message.error))
          else if (message.result && typeof message.result.revision === 'string') {
            if (message.result.content)
              message.result.content = nativeContentSchema.parse(message.result.content)
            waiter.resolve(message.result)
          } else waiter.reject(new Error('The clipboard component returned invalid data'))
          this.waiter = undefined
        } catch (error) {
          this.waiter?.reject(error instanceof Error ? error : new Error('Invalid clipboard data'))
          this.waiter = undefined
        }
      }
    })
    // Do not log clipboard contents or helper input, including on failure.
    child.stderr.resume()
    child.on('error', () => this.failed(child))
    child.on('exit', () => this.failed(child))
  }
  private failed(child: ChildProcessWithoutNullStreams): void {
    if (this.child !== child) return
    this.child = undefined
    this.waiter?.reject(
      new Error('The desktop clipboard component is unavailable; sign in to the desktop')
    )
    this.waiter = undefined
  }
  private request(input: object): Promise<ClipboardSnapshot> {
    const generation = this.generation
    return this.queue.run(async () => {
      if (generation !== this.generation) throw new Error('Clipboard synchronization stopped')
      await this.start()
      return new Promise<ClipboardSnapshot>((resolve, reject) => {
        const id = ++this.sequence
        const timer = setTimeout(() => {
          this.close()
          reject(new Error('Reading the desktop clipboard timed out'))
        }, 10000)
        this.waiter = {
          id,
          resolve: (value) => {
            clearTimeout(timer)
            resolve(value)
          },
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          }
        }
        this.child!.stdin.write(JSON.stringify({ id, ...input }) + '\n', (error) => {
          if (error) this.close()
        })
      })
    })
  }
  read(since?: string): Promise<ClipboardSnapshot> {
    return this.request({ op: 'read', since })
  }
  async write(content: NativeContent, expected: string): Promise<string> {
    return (
      await this.request({ op: 'write', content: nativeContentSchema.parse(content), expected })
    ).revision
  }
  close(): void {
    this.generation++
    const child = this.child
    this.child = undefined
    this.waiter?.reject(new Error('Clipboard synchronization stopped'))
    this.waiter = undefined
    child?.kill()
  }
}
