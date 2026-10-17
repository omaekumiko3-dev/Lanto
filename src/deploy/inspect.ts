import type { RemoteSystem } from '../protocol/deployment.ts'
import type { SshTransport } from './ssh.ts'
import { powershell } from './ssh.ts'

const unixInspect = `
set -eu
emit() { printf '%s=' "$1"; printf '%s' "$2" | base64 | tr -d '\\r\\n'; printf '\\n'; }
system=$(uname -s)
emit platform "$system"
emit architecture "$(uname -m)"
emit name "$(hostname)"
emit user "$(id -un)"
emit home "$HOME"
emit administrator "$(if [ "$(id -u)" = 0 ] || sudo -n true 2>/dev/null; then echo true; else echo false; fi)"
emit hostInstalled "$(if [ -f "$HOME/.lanto/host/host.json" ]; then echo true; else echo false; fi)"
emit hostData "$HOME/.lanto/host"
node_path=$(command -v node || true)
if [ -z "$node_path" ] && [ -d "$HOME/.lanto/runtime" ]; then
 node_path=$(find "$HOME/.lanto/runtime" -type f -path '*/bin/node' 2>/dev/null | sort | tail -1)
fi
if [ -n "$node_path" ] && ! "$node_path" -e 'process.exit(Number(process.versions.node.split(".")[0])>=24?0:1)' >/dev/null 2>&1; then node_path=''; fi
emit nodePath "$node_path"
if [ "$system" = Darwin ]; then
 emit desktopUser "$(stat -f '%Su' /dev/console)"
 app=''
 for candidate in "$HOME/Applications/LantoSunshineNative.app" "$HOME/Applications/Sunshine.app" /Applications/Sunshine.app; do
  if [ -d "$candidate" ]; then app="$candidate"; break; fi
 done
 emit sunshinePath "$app"
 emit sunshineInstalled "$(if [ -n "$app" ]; then echo true; else echo false; fi)"
 emit sunshineRunning "$(if nc -z 127.0.0.1 47989 2>/dev/null; then echo true; else echo false; fi)"
 emit mediaAdminPath "$HOME/.lanto/sunshine-admin.json"
 plist="$HOME/Library/LaunchAgents/dev.lanto.host.plist"
 if [ -f "$plist" ]; then
  entry=$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:1' "$plist" 2>/dev/null || true)
  emit hostRuntime "$(dirname \"$(dirname \"$(dirname \"$entry\")\")\")"
  data_flag=$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:3' "$plist" 2>/dev/null || true)
  if [ "$data_flag" = --data-dir ]; then
   data_path=$(/usr/libexec/PlistBuddy -c 'Print :ProgramArguments:4' "$plist")
   emit hostData "$data_path"
   emit hostInstalled "$(if [ -f "$data_path/host.json" ]; then echo true; else echo false; fi)"
  fi
 fi
else
 emit desktopUser "$(loginctl show-user "$(id -un)" -p Display --value 2>/dev/null || true)"
 if [ -r /etc/os-release ]; then set +u; . /etc/os-release; emit distribution "$ID"; emit version "$VERSION_ID"; set -u; fi
 sunshine_path=$(command -v sunshine || true)
 emit sunshinePath "$sunshine_path"
 emit sunshineInstalled "$(if [ -n "$sunshine_path" ]; then echo true; else echo false; fi)"
 emit sunshineRunning "$(if pgrep -x sunshine >/dev/null; then echo true; else echo false; fi)"
 emit mediaAdminPath "$HOME/.lanto/sunshine-admin.json"
 emit sunshineConfig "$HOME/.config/sunshine"
 unit="$HOME/.config/systemd/user/lanto-host.service"
 if [ -f "$unit" ]; then
  entry=$(sed -n 's#^ExecStart="[^"]*" "\\(.*\\)/app/host/cli.js" .*#\\1#p' "$unit" | head -1)
  emit hostRuntime "$entry"
  data_path=$(sed -n 's/^ExecStart=.*"--data-dir" "\\(.*\\)".*/\\1/p' "$unit" | head -1)
  if [ -n "$data_path" ]; then
   emit hostData "$data_path"
   emit hostInstalled "$(if [ -f "$data_path/host.json" ]; then echo true; else echo false; fi)"
  fi
 fi
fi
`

const windowsInspect = `
$ErrorActionPreference='Stop'
$task=Get-ScheduledTask -TaskName 'Lanto Host' -ErrorAction SilentlyContinue
$node=''; $runtime=''; $data=Join-Path $env:ProgramData 'Lanto\\Host'
if ($task) {
 $node=$task.Actions[0].Execute; $runtime=Split-Path (Split-Path $node -Parent) -Parent
 if($task.Actions[0].Arguments -match '^"([^"]+)"\\s+start\\s+--data-dir\\s+"([^"]+)"') {
  $runtime=Split-Path (Split-Path (Split-Path $Matches[1] -Parent) -Parent) -Parent
  $data=$Matches[2]
 }
}
if (!$node -or !(Test-Path -LiteralPath $node)) { $cmd=Get-Command node -ErrorAction SilentlyContinue; if($cmd){$node=$cmd.Source} }
if ($node) { try { $version=(& $node --version).Trim().TrimStart('v'); if(([Version]$version).Major -lt 24){$node=''} } catch {$node=''} }
$sunshine=Join-Path $env:ProgramFiles 'Sunshine\\sunshine.exe'
$svc=Get-Service SunshineService -ErrorAction SilentlyContinue
$admin=([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
[ordered]@{
 platform='windows'; architecture=if($env:PROCESSOR_ARCHITECTURE -eq 'ARM64'){'arm64'}else{'x64'}
 name=$env:COMPUTERNAME; user=$env:USERNAME; home=$env:USERPROFILE
 administrator=$admin; desktopUser=(Get-CimInstance Win32_ComputerSystem).UserName
 hostInstalled=[bool](Test-Path -LiteralPath (Join-Path $data 'host.json')); hostData=$data
 nodePath=$node; hostRuntime=$runtime; sunshineInstalled=[bool](Test-Path -LiteralPath $sunshine)
 sunshineRunning=[bool]($svc -and $svc.Status -eq 'Running'); sunshinePath=$sunshine
 sunshineConfig=(Join-Path $env:ProgramFiles 'Sunshine\\config')
 mediaAdminPath=(Join-Path $env:ProgramFiles 'Sunshine\\config\\lanto-admin.json')
} | ConvertTo-Json -Compress
`

export async function inspectRemote(ssh: SshTransport): Promise<RemoteSystem> {
  const probe = await ssh.exec('uname -s', '', 15_000)
  let result: RemoteSystem
  if (probe.code === 0 && /Darwin|Linux/.test(probe.stdout)) {
    const response = await ssh.exec('sh -s', unixInspect, 30_000)
    if (response.code !== 0)
      throw new Error(
        'Cannot read remote system information; connect as a regular user signed in to the desktop'
      )
    const fields: Record<string, string> = {}
    for (const line of response.stdout.trim().split(/\r?\n/)) {
      const index = line.indexOf('=')
      if (index > 0)
        fields[line.slice(0, index)] = Buffer.from(line.slice(index + 1), 'base64').toString('utf8')
    }
    if (!['x86_64', 'aarch64', 'arm64'].includes(fields.architecture))
      throw new Error('Currently supports x64 and ARM64 target devices')
    result = {
      ...fields,
      platform: fields.platform === 'Darwin' ? 'macos' : 'linux',
      architecture: fields.architecture === 'x86_64' ? 'x64' : 'arm64',
      administrator: fields.administrator === 'true',
      hostInstalled: fields.hostInstalled === 'true',
      sunshineInstalled: fields.sunshineInstalled === 'true',
      sunshineRunning: fields.sunshineRunning === 'true'
    } as RemoteSystem
  } else {
    const response = await ssh.exec(powershell(windowsInspect), '', 45_000)
    if (response.code !== 0)
      throw new Error(
        'Unrecognized target system; Windows PowerShell, macOS, or a Linux shell is required'
      )
    try {
      result = JSON.parse(response.stdout.trim()) as RemoteSystem
    } catch {
      throw new Error('The target system returned unrecognized information')
    }
  }
  if (!result.home || !result.user || !result.name)
    throw new Error('Target system information is incomplete')
  if (result.platform !== 'windows' && result.user === 'root')
    throw new Error(
      'Connect as the user signed in to the target desktop; system dependency installation elevates privileges separately'
    )
  return result
}
