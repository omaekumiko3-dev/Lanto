import { chromium } from 'playwright'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

// SVGs are the source of truth. PNG and multi-resolution ICO files are generated.
const root = resolve(import.meta.dirname, '..')
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.LANTO_ICON_BROWSER
})
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  for (const name of ['lanto', 'lanto-stream']) {
    const svg = await readFile(resolve(root, 'assets', `${name}.svg`))
    const frames = []
    for (const size of [16, 24, 32, 48, 64, 128, 256]) {
      await page.setViewportSize({ width: size, height: size })
      await page.setContent(
        `<html><body style="margin:0;background:transparent"><img width="${size}" height="${size}" src="data:image/svg+xml;base64,${svg.toString('base64')}" /></body></html>`
      )
      await page.locator('img').evaluate((img) => img.decode())
      const png = await page.screenshot({ omitBackground: true })
      frames.push({ size, png })
      if (size === 256) await writeFile(resolve(root, 'assets', `${name}.png`), png)
    }
    const header = Buffer.alloc(6 + frames.length * 16)
    header.writeUInt16LE(1, 2)
    header.writeUInt16LE(frames.length, 4)
    let offset = header.length
    frames.forEach(({ size, png }, index) => {
      const start = 6 + index * 16
      header[start] = header[start + 1] = size === 256 ? 0 : size
      header.writeUInt16LE(1, start + 4)
      header.writeUInt16LE(32, start + 6)
      header.writeUInt32LE(png.length, start + 8)
      header.writeUInt32LE(offset, start + 12)
      offset += png.length
    })
    await writeFile(
      resolve(root, 'assets', `${name}.ico`),
      Buffer.concat([header, ...frames.map(({ png }) => png)])
    )
  }
} finally {
  await browser.close()
}
console.log('Generated Lanto controller and stream icons')
