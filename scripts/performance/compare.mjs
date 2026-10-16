import { _electron } from 'playwright'
import electronExecutable from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import { launchMedia, streamArguments } from '../../src/main/moonlight.ts'

const root = resolve(import.meta.dirname, '../..')
const { values } = parseArgs({
  options: {
    device: { type: 'string' },
    seconds: { type: 'string', default: '28' },
    'repeat-shared': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h' }
  }
})
if (values.help) {
  console.log(
    'Close Lanto first. Run: node scripts/performance/compare.mjs --device <name-or-UUID> [--seconds 28] [--repeat-shared]\nUses real paired device credentials already saved in Lanto. Raw logs stay in test-results/performance. Restores the saved Lanto connection afterward. Start the Mac pattern separately for comparable motion.'
  )
  process.exit(0)
}
const seconds = Number(values.seconds)
if (!values.device || !Number.isInteger(seconds) || seconds < 10 || seconds > 60)
  throw new Error('Specify --device and an integer --seconds between 10 and 60; use --help')
if (process.platform !== 'win32') throw new Error('This D3D11 comparison requires Windows')
const directory = resolve(root, 'test-results/performance', 'trials-' + Date.now())
await mkdir(directory, { recursive: true })
const environment = { ...process.env }
delete environment.ELECTRON_RUN_AS_NODE
const app = await _electron.launch({
  executablePath: electronExecutable,
  args: [root],
  env: environment
})
const page = await app.firstWindow()
await page.getByRole('heading', { name: /^device/ }).waitFor()
const state = await page.evaluate(() => window.lanto.getState())
const matches = state.config.devices.filter(
  (value) => value.name === values.device || value.id === values.device
)
if (matches.length !== 1 || !state.runtime.moonlightPath) {
  await app.close()
  throw new Error('Select exactly one configured device and install Moonlight')
}
const device = matches[0]
const settings = {
  ...state.config.settings,
  resolution: '2560x1440',
  fps: 60,
  bitrateMbps: 20,
  lowLatency: true,
  showPerformanceOverlay: false
}
const initialTrials = [
  { name: 'hevc-default', codec: 'HEVC', env: {} },
  {
    name: 'hevc-shared-bind',
    codec: 'HEVC',
    env: { D3D11VA_FORCE_SEPARATE_DEVICES: '0', D3D11VA_FORCE_BIND: '1' }
  },
  { name: 'h264-default', codec: 'H.264', env: {} },
  { name: 'hevc-default-repeat', codec: 'HEVC', env: {} }
]
const trials = values['repeat-shared']
  ? [
      initialTrials[1],
      initialTrials[0],
      { ...initialTrials[1], name: 'hevc-shared-bind-repeat' },
      initialTrials[3]
    ]
  : initialTrials
const results = []
let handle
try {
  for (const trial of trials) {
    console.log('Starting ' + trial.name)
    const file = resolve(directory, trial.name + '.log')
    handle = await launchMedia(
      state.runtime.moonlightPath,
      [
        ...streamArguments(device, settings),
        '--video-codec',
        trial.codec,
        '--video-decoder',
        'hardware'
      ],
      file,
      trial.env
    )
    await new Promise((resolve) => setTimeout(resolve, seconds * 1000))
    await handle.stop()
    await handle.closed
    handle = undefined
    const text = await readFile(file, 'utf8')
    const marker = text.lastIndexOf('Global video stats')
    const stats = marker >= 0 ? text.slice(marker) : ''
    const number = (pattern) => {
      const match = stats.match(pattern)
      return match ? Number(match[1]) : null
    }
    const result = {
      name: trial.name,
      requestedCodec: trial.codec,
      actualStream: [...text.matchAll(/Video stream is ([^\r\n]+)/g)].at(-1)?.[1] || null,
      deviceMode:
        [...text.matchAll(/Using (separate|shared) device for decoding and rendering/g)].at(
          -1
        )?.[1] || null,
      textureMode: [...text.matchAll(/Decoder texture access: ([^\r\n]+)/g)].at(-1)?.[1] || null,
      decodedFps: number(/Decoding frame rate: ([\d.]+)/),
      renderedFps: number(/Rendering frame rate: ([\d.]+)/),
      decodeMs: number(/Average decoding time: ([\d.]+)/),
      queueMs: number(/Average frame queue delay: ([\d.]+)/),
      renderMs: number(/Average rendering time[^:]*: ([\d.]+)/),
      networkDropPercent: number(/Frames dropped by your network connection: ([\d.]+)/),
      jitterDropPercent: number(/Frames dropped due to network jitter: ([\d.]+)/),
      completeStatistics: marker >= 0
    }
    results.push(result)
    await writeFile(resolve(directory, 'summary.json'), JSON.stringify(results, null, 2) + '\n')
    console.log(JSON.stringify(result))
  }
} finally {
  await handle?.stop()
  await page.getByRole('button', { name: device.name, exact: true }).click()
  await page.evaluate((id) => window.lanto.connect(id), device.id)
  console.log('Restored saved Lanto connection; results: ' + directory)
}
const input = createInterface({ input: process.stdin })
input.on('line', (line) => {
  if (line.trim() === 'state')
    page
      .evaluate(() => window.lanto.getState())
      .then((value) => console.log(JSON.stringify(value.session)))
})
app.on('close', () => process.exit(0))
