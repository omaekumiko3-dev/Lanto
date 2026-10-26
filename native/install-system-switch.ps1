param([Parameter(Mandatory)][string]$Source)
$ErrorActionPreference = 'Stop'
$lantoIdentity = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $lantoIdentity.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Run this installer as administrator' }
$lantoSource = (Resolve-Path -LiteralPath $Source).Path
if ((Split-Path $lantoSource -Leaf) -ne 'LantoSwitch.exe') { throw 'Expected the built LantoSwitch.exe' }
# Only the installed application binary goes here. Build tools, dependencies,
# caches and intermediate artifacts remain in MYENV_ROOT.
$lantoInstall = Join-Path $env:ProgramFiles 'Lanto Switch'
if (Test-Path -LiteralPath $lantoInstall) {
    if ((Get-Item -LiteralPath $lantoInstall).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Service install directory must not be a link' }
}
New-Item -ItemType Directory -Path $lantoInstall -Force | Out-Null
& icacls.exe $lantoInstall /setowner '*S-1-5-32-544' | Out-Null
if ($LASTEXITCODE) { throw 'Cannot set SYSTEM service directory owner' }
& icacls.exe $lantoInstall /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null
if ($LASTEXITCODE) { throw 'Cannot protect SYSTEM service directory' }
$lantoService = Get-Service -Name LantoSwitchSystem -ErrorAction SilentlyContinue
if ($lantoService) { Stop-Service -Name LantoSwitchSystem; $lantoService.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(15)) }
$lantoTarget = Join-Path $lantoInstall 'LantoSwitch.exe'
Copy-Item -LiteralPath $lantoSource -Destination $lantoTarget -Force
& icacls.exe $lantoTarget /setowner '*S-1-5-32-544' | Out-Null
if ($LASTEXITCODE) { throw 'Cannot set SYSTEM service binary owner' }
& icacls.exe $lantoTarget /reset | Out-Null
if ($LASTEXITCODE) { throw 'Cannot protect SYSTEM service binary' }
$lantoCommand = '"' + $lantoTarget + '" --system-service'
if (-not $lantoService) {
    New-Service -Name LantoSwitchSystem -DisplayName 'Lanto SYSTEM Switch' -BinaryPathName $lantoCommand -StartupType Automatic -Description 'Starts only the Lanto keyboard switch worker in the authenticated administrator desktop session.' | Out-Null
} else {
    & sc.exe config LantoSwitchSystem binPath= $lantoCommand start= auto obj= LocalSystem | Out-Null
    if ($LASTEXITCODE) { throw 'Cannot configure SYSTEM switch service' }
}
Start-Service -Name LantoSwitchSystem
Get-CimInstance Win32_Service -Filter "Name='LantoSwitchSystem'" | Select-Object Name,State,StartName,StartMode,ProcessId,PathName
