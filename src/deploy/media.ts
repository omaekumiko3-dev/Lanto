import { spawn } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { hasMediaFeature } from '../main/native-profile.ts'

export async function pairMedia(
  executable: string,
  host: string,
  signal: AbortSignal,
  accept: (pin: string) => Promise<void>,
  workingDirectory?: string
): Promise<void> {
  signal.throwIfAborted()
  if (!(await hasMediaFeature(executable, 'automatedPairProtocol')))
    throw new Error(
      'Automatic pairing requires the latest bundled Lanto display client; select it in settings'
    )
  const pin = randomInt(0, 10_000).toString().padStart(4, '0')
  const child = spawn(executable, ['pair', host, '--pin', pin], {
    shell: false,
    cwd: workingDirectory,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      QT_QPA_PLATFORM: 'offscreen',
      QT_QUICK_BACKEND: 'software',
      LANTO_AUTOMATED_PAIR: '1'
    }
  })
  let output = ''
  child.stdout.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-32_000)
  })
  child.stderr.on('data', (chunk: Buffer) => {
    output = (output + chunk.toString()).slice(-32_000)
  })
  let finished = false
  const done = new Promise<number>((resolve) => {
    child.once('error', () => {
      finished = true
      resolve(-1)
    })
    child.once('close', (code) => {
      finished = true
      resolve(code ?? -1)
    })
  })
  const abort = () => child.kill()
  signal.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 70_000)
  try {
    // An already trusted client exits immediately; no administrator credentials needed.
    await Promise.race([done, delay(12_000, undefined, { signal })])
    if (!finished) {
      await Promise.race([accept(pin), done])
    }
    const code = await done
    signal.throwIfAborted()
    if (code !== 0 || !output.includes('LANTO_PAIR_RESULT:success'))
      throw new Error(
        'Display pairing failed; check that Sunshine is ready and LAN ports are reachable'
      )
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
    if (!finished) child.kill()
    output = ''
  }
}
