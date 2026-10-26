$ErrorActionPreference = 'Stop'
$lantoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$lantoOutput = Join-Path $lantoRoot 'out/native'
New-Item -ItemType Directory -Path $lantoOutput -Force | Out-Null
$lantoVs = $null
if (-not ($env:INCLUDE -and (Get-Command cl.exe -ErrorAction SilentlyContinue))) {
  $lantoVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
  $lantoVs = & $lantoVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
  if (-not $lantoVs) { throw 'Visual Studio C++ build tools are required to build the switch helper' }
}
$lantoCommand = Join-Path $lantoOutput 'build-switch.cmd'
$lantoSetup = if ($env:INCLUDE -and (Get-Command cl.exe -ErrorAction SilentlyContinue)) { 'rem Using initialized native toolchain' } else { "call `"$lantoVs\VC\Auxiliary\Build\vcvarsall.bat`" x64" }
@"
@echo off
$lantoSetup
if not "%errorlevel%"=="0" exit /b %errorlevel%
cd /d "$lantoOutput"
cl /nologo /std:c++17 /EHsc /W4 /O2 /MT "$PSScriptRoot\switch-broker.cpp" /Fe:LantoSwitch.exe /link user32.lib advapi32.lib
if not "%errorlevel%"=="0" exit /b %errorlevel%
LantoSwitch.exe --test
if not "%errorlevel%"=="0" exit /b %errorlevel%
cl /nologo /std:c++17 /EHsc /W4 /O2 /MT "$PSScriptRoot\tests\key-releases-test.cpp" /Fe:LantoKeyReleaseTests.exe
if not "%errorlevel%"=="0" exit /b %errorlevel%
LantoKeyReleaseTests.exe
if not "%errorlevel%"=="0" exit /b %errorlevel%
cl /nologo /std:c++17 /EHsc /W4 /O2 /MT "$PSScriptRoot\tests\fake-media.cpp" /Fe:LantoTestMedia.exe /link user32.lib
exit /b %errorlevel%
"@ | Set-Content -LiteralPath $lantoCommand -Encoding ascii
& cmd.exe /d /c $lantoCommand
if ($LASTEXITCODE -ne 0) { throw 'Switch helper build or tests failed' }
