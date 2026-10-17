function quote(value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value))
    throw new Error('Service paths cannot contain control characters')
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, '$$$$')}"`
}

export function systemdUnit(node: string, entry: string, directory: string): string {
  return `[Unit]
Description=Lanto Host

[Service]
Type=simple
ExecStart=${[node, entry, 'start', '--data-dir', directory].map(quote).join(' ')}
Restart=on-failure
RestartSec=3
UMask=0077

[Install]
WantedBy=default.target
`
}
