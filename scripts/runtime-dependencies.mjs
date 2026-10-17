// Resolve only the requested runtime dependency closure. The Host does not ship
// Electron, React, SSH native addons, development tools, or local configuration.
export function runtimeDependencies(lock, roots) {
  const selected = new Set()
  const visit = (name, parent = '') => {
    let prefix = parent
    let path
    for (;;) {
      const candidate = (prefix ? prefix + '/' : '') + 'node_modules/' + name
      if (lock.packages[candidate]) {
        path = candidate
        break
      }
      if (!prefix) throw new Error('Missing runtime dependency: ' + name)
      const index = prefix.lastIndexOf('/node_modules/')
      prefix = index >= 0 ? prefix.slice(0, index) : ''
    }
    if (selected.has(path)) return
    selected.add(path)
    const info = lock.packages[path]
    if (info.link || path.includes('..')) throw new Error('Unsafe dependency path')
    for (const dependency of Object.keys(info.dependencies || {})) visit(dependency, path)
  }
  for (const name of roots) visit(name)
  return [...selected].map((path) => [path, lock.packages[path]])
}
