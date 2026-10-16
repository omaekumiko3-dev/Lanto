#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
  [string]$DesktopUser = (Get-CimInstance Win32_ComputerSystem).UserName,
  [string]$DataDirectory = (Join-Path $env:ProgramData 'Lanto\Host')
)
$ErrorActionPreference = 'Stop'
$runtime = [IO.Path]::GetFullPath($PSScriptRoot)
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory)
if (!$runtime.StartsWith($env:ProgramFiles.TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Install the runtime under Program Files.' }
if (!$DataDirectory.StartsWith((Join-Path $env:ProgramData 'Lanto').TrimEnd('\')+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Use a Host data directory below ProgramData\Lanto.' }
foreach ($path in @($runtime, (Join-Path $DataDirectory 'clipboard\desktop'))) {
  $current = $path
  while ($current) {
    if ((Test-Path -LiteralPath $current) -and ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Reparse points are not supported in agent directory ancestors.' }
    $current = Split-Path -Parent $current
  }
}
if (!$DesktopUser) { throw 'Sign in to the intended desktop user before installing the clipboard agent.' }
$userSid = ([Security.Principal.NTAccount]::new($DesktopUser)).Translate([Security.Principal.SecurityIdentifier])
$taskName = 'Lanto Clipboard'
$description = 'Lanto desktop clipboard agent (managed by install-windows-clipboard.ps1)'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.Description -ne $description) { throw 'An unmanaged Lanto Clipboard task already exists.' }
if ($existing) { Stop-ScheduledTask -InputObject $existing }
$desktop = Join-Path $DataDirectory 'clipboard\desktop'
New-Item -ItemType Directory -Path $desktop -Force | Out-Null
foreach ($root in @($runtime, $desktop)) {
  $items = @((Get-Item -LiteralPath $root -Force)) + @(Get-ChildItem -LiteralPath $root -Recurse -Force)
  if ($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Reparse points are not supported in the agent runtime or data.' }
  foreach ($item in $items) {
    $acl = Get-Acl -LiteralPath $item.FullName
    $inherit = if ($item.PSIsContainer) { 'ContainerInherit, ObjectInherit' } else { 'None' }
    $rights = if ($root -eq $desktop) { 'Modify' } else { 'ReadAndExecute' }
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($userSid,$rights,$inherit,'None','Allow'))
    Set-Acl -LiteralPath $item.FullName -AclObject $acl
  }
}
$node = Join-Path $runtime 'node\node.exe'
$entry = Join-Path $runtime 'app\host\cli.js'
$launcher = Join-Path $runtime 'clipboard-agent-launch.ps1'
if (!(Test-Path -LiteralPath $node -PathType Leaf) -or !(Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'Packaged runtime is incomplete.' }
@'
param([string]$DataDirectory)
$ErrorActionPreference='Stop'
$lantoNode=Join-Path $PSScriptRoot 'node\node.exe'
$lantoEntry=Join-Path $PSScriptRoot 'app\host\cli.js'
$lantoArguments='"{0}" clipboard-agent --data-dir "{1}"' -f $lantoEntry,$DataDirectory
$lantoProcess=Start-Process -FilePath $lantoNode -ArgumentList $lantoArguments -WorkingDirectory $PSScriptRoot -WindowStyle Hidden -PassThru
$lantoProcess.WaitForExit()
exit $lantoProcess.ExitCode
'@ | Set-Content -LiteralPath $launcher -Encoding UTF8
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File "{0}" -DataDirectory "{1}"' -f $launcher,$DataDirectory) -WorkingDirectory $runtime
$principal = New-ScheduledTaskPrincipal -UserId $DesktopUser -LogonType Interactive -RunLevel Limited
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $DesktopUser
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Trigger $trigger -Settings $settings -Description $description -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Lanto Clipboard installed for the signed-in desktop user. The Host identity and pairing files retain their service-only permissions.'
