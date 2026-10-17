import { Client } from 'ssh2'
import type { ClientChannel, SFTPWrapper } from 'ssh2'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, rename, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SshConnection } from '../protocol/deployment.ts'
import { z } from 'zod'

export const shellQuote = (value: string): string => "'" + value.replaceAll("'", "'\\''") + "'"
export const powershell = (script: string): string =>
  'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' +
  Buffer.from(script, 'utf16le').toString('base64')
export const psQuote = (value: string): string => "'" + value.replaceAll("'", "''") + "'"

export class SshTransport {
  private readonly client = new Client()
  private closed = false
  private channels = new Set<ClientChannel>()
  private readonly signal: AbortSignal
  constructor(signal: AbortSignal) {
    this.signal = signal
    signal.addEventListener('abort', () => this.close(), { once: true })
    // Keep late socket errors from becoming unhandled after a request was cancelled.
    this.client.on('error', () => {})
  }

  async connect(
    input: SshConnection,
    directory: string,
    verify: (fingerprint: string, previous?: string) => Promise<boolean>
  ): Promise<void> {
    this.signal.throwIfAborted()
    await mkdir(directory, { recursive: true, mode: 0o700 })
    const file = join(directory, 'ssh-known-hosts.json')
    let known: Record<string, string> = {}
    try {
      known = z
        .record(z.string(), z.string().regex(/^SHA256:[A-Za-z0-9+/]{43}$/))
        .parse(JSON.parse(await readFile(file, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
        throw new Error('Cannot read SSH host records')
    }
    const authority = `${input.host.toLowerCase()}:${input.port}`
    let accepted = ''
    let rejected = false
    if (input.auth === 'key' && (await stat(input.privateKeyPath)).size > 1024 * 1024)
      throw new Error('The SSH private key file is too large; select the correct key')
    const privateKey = input.auth === 'key' ? await readFile(input.privateKeyPath) : undefined
    await new Promise<void>((resolve, reject) => {
      const abort = () => reject(new Error('SSH connection cancelled'))
      this.signal.addEventListener('abort', abort, { once: true })
      this.client.once('ready', () => {
        this.signal.removeEventListener('abort', abort)
        resolve()
      })
      this.client.once('error', (error: Error & { level?: string }) => {
        this.signal.removeEventListener('abort', abort)
        reject(
          new Error(
            rejected
              ? 'SSH host identity was not accepted'
              : error.level === 'client-authentication'
                ? 'SSH authentication failed; check the username, password, or private key'
                : 'SSH connection failed; check the address, port, and target SSH service'
          )
        )
      })
      this.client.once('close', () => reject(new Error('SSH connection closed')))
      this.client.on('keyboard-interactive', (_name, _instructions, _language, prompts, finish) => {
        // Only a password prompt is supported; do not send a password to arbitrary MFA prompts.
        if (
          input.auth === 'password' &&
          prompts.length === 1 &&
          /password/i.test(prompts[0].prompt)
        )
          finish([input.password])
        else finish([])
      })
      this.client.connect({
        host: input.host,
        port: input.port,
        username: input.username,
        ...(input.auth === 'password' ? { password: input.password, tryKeyboard: true } : {}),
        ...(privateKey ? { privateKey, passphrase: input.passphrase || undefined } : {}),
        ...(input.auth === 'agent'
          ? {
              agent:
                process.env.SSH_AUTH_SOCK ||
                (process.platform === 'win32' ? '\\\\.\\pipe\\openssh-ssh-agent' : '')
            }
          : {}),
        readyTimeout: 180_000,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 3,
        hostVerifier: (key: Buffer, callback: (valid: boolean) => void) => {
          const fingerprint =
            'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
          void (async () => {
            const okay =
              known[authority] === fingerprint || (await verify(fingerprint, known[authority]))
            if (this.signal.aborted) return callback(false)
            if (okay) accepted = fingerprint
            else rejected = true
            callback(okay)
          })().catch(() => {
            rejected = true
            callback(false)
          })
        }
      })
    }).finally(() => privateKey?.fill(0))
    this.signal.throwIfAborted()
    if (accepted && known[authority] !== accepted) {
      known[authority] = accepted
      const temporary = file + '.tmp'
      await writeFile(temporary, JSON.stringify(known, null, 2) + '\n', { mode: 0o600 })
      await rename(temporary, file)
    }
  }

  exec(
    command: string,
    stdin = '',
    timeout = 120_000
  ): Promise<{ stdout: string; stderr: string; code: number }> {
    this.signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      let stream: ClientChannel | undefined
      let stdout = '',
        stderr = '',
        settled = false
      const finish = (error?: Error, code = -1) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        this.signal.removeEventListener('abort', abort)
        if (stream) {
          this.channels.delete(stream)
          stream.close()
        }
        if (error) reject(error)
        else resolve({ stdout, stderr, code })
      }
      const abort = () =>
        finish(
          new Error(
            'Deployment cancelled; completed installations are preserved; reconnect to continue'
          )
        )
      const timer = setTimeout(
        () => finish(new Error('Target device response timed out; inspect again to continue')),
        timeout
      )
      this.signal.addEventListener('abort', abort, { once: true })
      this.client.exec(command, (error, channel) => {
        if (error)
          return finish(new Error('Cannot execute the deployment step on the target device'))
        stream = channel
        if (settled) return channel.close()
        this.channels.add(channel)
        channel.on('data', (data: Buffer) => {
          stdout += data.toString('utf8')
          if (stdout.length + stderr.length > 4_000_000)
            finish(new Error('Target output exceeds the limit'))
        })
        channel.stderr.on('data', (data: Buffer) => {
          stderr += data.toString('utf8')
          if (stdout.length + stderr.length > 4_000_000)
            finish(new Error('Target output exceeds the limit'))
        })
        channel.once('error', () =>
          finish(new Error('Deployment channel interrupted; inspect again'))
        )
        channel.once('close', (code: number) => finish(undefined, code ?? -1))
        channel.end(stdin)
      })
    })
  }

  async upload(
    local: string,
    remote: string,
    progress: (bytes: number, total: number) => void
  ): Promise<void> {
    this.signal.throwIfAborted()
    const size = (await stat(local)).size
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) =>
      this.client.sftp((error, result) =>
        error
          ? reject(new Error('SFTP file transfer is not enabled on the target device'))
          : resolve(result)
      )
    )
    if (this.signal.aborted) {
      sftp.end()
      this.signal.throwIfAborted()
    }
    await new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout>
      const resetTimeout = () => {
        clearTimeout(timer)
        timer = setTimeout(() => {
          sftp.end()
          reject(new Error('Upload connection timed out; reconnect to continue'))
        }, 30_000)
      }
      const abort = () => {
        clearTimeout(timer)
        sftp.end()
        reject(new Error('Upload cancelled'))
      }
      this.signal.addEventListener('abort', abort, { once: true })
      resetTimeout()
      sftp.fastPut(
        local,
        remote,
        {
          mode: 0o600,
          concurrency: 4,
          step: (bytes) => {
            resetTimeout()
            progress(bytes, size)
          }
        },
        (error) => {
          this.signal.removeEventListener('abort', abort)
          clearTimeout(timer)
          sftp.end()
          if (error)
            reject(new Error('File upload failed; check target disk space and SFTP permissions'))
          else resolve()
        }
      )
    })
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    for (const channel of this.channels) channel.close()
    this.channels.clear()
    this.client.destroy()
  }
}
