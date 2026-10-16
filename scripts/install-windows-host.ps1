#Requires -Version 5.1
#Requires -RunAsAdministrator
[CmdletBinding()]
param(
    [string]$Name = $env:COMPUTERNAME,
    [string]$Address,
    [string]$DataDirectory = (Join-Path $env:ProgramData 'Lanto\Host')
)

$ErrorActionPreference = 'Stop'
$runtime = [IO.Path]::GetFullPath($PSScriptRoot)
$entry = Join-Path $runtime 'app\host\cli.js'
$node = Join-Path $runtime 'node\node.exe'
$DataDirectory = [IO.Path]::GetFullPath($DataDirectory).TrimEnd('\')
$taskName = 'Lanto Host'

function Assert-ChildPath([string]$Path, [string]$Parent) {
    $prefix = [IO.Path]::GetFullPath($Parent).TrimEnd('\') + '\'
    if (!$Path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Expected a directory below $Parent"
    }
    # Do not follow junctions/symlinks while applying ownership or permissions.
    $current = $Path
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Reparse points are not supported: $current"
            }
        }
        $current = Split-Path -Parent $current
    }
}

function Set-HostPermissions([string]$Path, [bool]$Writable) {
    $items = @((Get-Item -LiteralPath $Path -Force)) + @(Get-ChildItem -LiteralPath $Path -Force -Recurse)
    if ($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) {
        throw "Reparse points are not supported below $Path"
    }
    foreach ($item in $items) {
        $acl = if ($item.PSIsContainer) { New-Object Security.AccessControl.DirectorySecurity } else { New-Object Security.AccessControl.FileSecurity }
        $acl.SetAccessRuleProtection($true, $false)
        $acl.SetOwner([Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'))
        $inherit = if ($item.PSIsContainer) { 'ContainerInherit, ObjectInherit' } else { 'None' }
        foreach ($sid in @('S-1-5-18', 'S-1-5-32-544')) {
            $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
                [Security.Principal.SecurityIdentifier]::new($sid), 'FullControl', $inherit, 'None', 'Allow'))
        }
        $rights = if ($Writable) { 'Modify' } else { 'ReadAndExecute' }
        $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
            [Security.Principal.SecurityIdentifier]::new('S-1-5-19'), $rights, $inherit, 'None', 'Allow'))
        Set-Acl -LiteralPath $item.FullName -AclObject $acl
    }
}

Assert-ChildPath $runtime $env:ProgramFiles
Assert-ChildPath $DataDirectory (Join-Path $env:ProgramData 'Lanto')
if (!(Test-Path -LiteralPath $entry -PathType Leaf) -or !(Test-Path -LiteralPath $node -PathType Leaf)) {
    throw 'Place this installer in a packaged Host runtime with Node.js at node\node.exe.'
}
$nodeVersion = [Version]((& $node --version).Trim().TrimStart('v'))
if ($LASTEXITCODE -ne 0 -or $nodeVersion -lt [Version]'24.12.0') { throw 'Node.js 24.12 or newer is required.' }

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing) {
    if ($existing.Description -ne 'Lanto headless LAN host (managed by install-windows-host.ps1)') {
        throw 'A task named Lanto Host already exists and is not managed by this installer.'
    }
    Stop-ScheduledTask -InputObject $existing
}

New-Item -ItemType Directory -Path $DataDirectory -Force | Out-Null
Set-HostPermissions $runtime $false
Set-HostPermissions $DataDirectory $true
if ($existing) {
    $backup = Join-Path $DataDirectory ('task-backup-' + (Get-Date -Format 'yyyyMMddHHmmssfff') + '.xml')
    Export-ScheduledTask -TaskName $taskName | Set-Content -LiteralPath $backup -Encoding Unicode
}
$initArgs = @($entry, 'init', '--data-dir', $DataDirectory, '--name', $Name)
if ($Address) { $initArgs += @('--address', $Address) }
& $node @initArgs
if ($LASTEXITCODE -ne 0) { throw 'Host initialization failed.' }

$action = New-ScheduledTaskAction -Execute $node -Argument ('"{0}" start --data-dir "{1}"' -f $entry, $DataDirectory) -WorkingDirectory $runtime
$principal = New-ScheduledTaskPrincipal -UserId 'LOCALSERVICE' -LogonType ServiceAccount
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew
$trigger = New-ScheduledTaskTrigger -AtStartup
Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Trigger $trigger -Description 'Lanto headless LAN host (managed by install-windows-host.ps1)' -Force | Out-Null

$config = Get-Content -LiteralPath (Join-Path $DataDirectory 'host.json') -Raw | ConvertFrom-Json
foreach ($rule in @(
    @{Name='Lanto-Host-HTTPS'; Protocol='TCP'; Port=$config.port},
    @{Name='Lanto-Host-Discovery'; Protocol='UDP'; Port=5353}
)) {
    Get-NetFirewallRule -Name $rule.Name -ErrorAction SilentlyContinue | Remove-NetFirewallRule
    New-NetFirewallRule -Name $rule.Name -DisplayName $rule.Name -Direction Inbound -Action Allow -Program $node -Protocol $rule.Protocol -LocalPort $rule.Port -RemoteAddress LocalSubnet -Profile Any | Out-Null
}
Start-ScheduledTask -TaskName $taskName
for ($attempt = 0; $attempt -lt 30; $attempt++) {
    try {
        $status = & $node $entry status --data-dir $DataDirectory 2>$null
        if ($LASTEXITCODE -eq 0) {
            $status
            Write-Output 'Lanto Host is ready. Startup task: LOCAL SERVICE; firewall: local subnet only.'
            return
        }
    } catch { }
    Start-Sleep -Seconds 1
}
throw 'Host did not become ready. Inspect Get-ScheduledTaskInfo -TaskName "Lanto Host".'
