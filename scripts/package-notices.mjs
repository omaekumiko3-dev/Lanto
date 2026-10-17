import { cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { runtimeDependencies } from './runtime-dependencies.mjs'

export async function packageNotices(output, roots) {
  const root = resolve(import.meta.dirname, '..')
  const lock = JSON.parse(await readFile(join(root, 'package-lock.json'), 'utf8'))
  const inventory = []
  for (const [path, info] of runtimeDependencies(lock, roots)) {
    const folder = join(root, path)
    const pkg = JSON.parse(await readFile(join(folder, 'package.json'), 'utf8'))
    const names = (await readdir(folder)).filter((name) =>
      /^(license|licence|copying|notice)(\.|$)/i.test(name)
    )
    if (!names.length) throw new Error(`Missing license text for ${pkg.name}`)
    const destination = join(output, 'licenses/npm', pkg.name.replace('/', '__'))
    await mkdir(destination, { recursive: true })
    for (const name of names)
      await cp(join(folder, name), join(destination, name), { recursive: true })
    inventory.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license || info.license,
      files: names
    })
  }
  await writeFile(
    join(output, 'licenses/npm/inventory.json'),
    JSON.stringify(inventory, null, 2) + '\n'
  )
  await cp(join(root, 'LICENSE'), join(output, 'LICENSE.lanto.txt'))
  await cp(join(root, 'THIRD_PARTY_NOTICES.md'), join(output, 'THIRD_PARTY_NOTICES.md'))
  return inventory.length
}
