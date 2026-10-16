param(
  [Parameter(Mandatory)][string]$Source,
  [Parameter(Mandatory)][string]$QtBin,
  [Parameter(Mandatory)][string]$Output
)
$ErrorActionPreference = 'Stop'
$lantoSource = (Resolve-Path -LiteralPath $Source).Path
$lantoQtBin = (Resolve-Path -LiteralPath $QtBin).Path
$lantoOutput = [IO.Path]::GetFullPath($Output)
foreach ($lantoPath in @($lantoSource, $lantoQtBin, $lantoOutput)) {
  if ($lantoPath -match '[%!\r\n]') { throw 'Build paths must not contain %, ! or newlines' }
}
if (Test-Path -LiteralPath $lantoOutput) { throw 'Choose a new output directory' }
$lantoInputSource = Get-Content -LiteralPath (Join-Path $lantoSource 'app/streaming/input/input.cpp') -Raw
$lantoHttpSource = Get-Content -LiteralPath (Join-Path $lantoSource 'app/backend/nvhttp.cpp') -Raw
if (-not $lantoInputSource.Contains('LANTO_LOCAL_CURSOR') -or -not $lantoHttpSource.Contains('LantoLocalCursor')) {
  throw 'Apply moonlight-local-cursor.patch before building'
}
$lantoDecoderSource = Get-Content -LiteralPath (Join-Path $lantoSource 'app/streaming/video/ffmpeg.cpp') -Raw
if (-not $lantoHttpSource.Contains('LantoPreserveH264Sps') -or -not $lantoDecoderSource.Contains('LANTO_PRESERVE_H264_SPS')) {
  throw 'Apply moonlight-h264-sps.patch before building'
}
$lantoVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$lantoVs = & $lantoVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $lantoVs) { throw 'Visual Studio C++ build tools are required' }
$lantoBuild = Join-Path $lantoSource 'build-lanto'
if (-not $lantoHttpSource.Contains('lantocursor')) { throw 'Apply moonlight-cursor-shape.patch before building' }
$lantoAudioSource = Get-Content -LiteralPath (Join-Path $lantoSource 'app/streaming/audio/audio.cpp') -Raw
if (-not $lantoAudioSource.Contains('m_LantoAudioVolume.apply')) { throw 'Apply moonlight-audio-volume.patch before building' }
$lantoCursorSource = Join-Path $lantoSource 'app/streaming/lanto'
New-Item -ItemType Directory -Path $lantoCursorSource -Force | Out-Null
Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot 'moonlight') -File | Copy-Item -Destination $lantoCursorSource
$lantoAssets = Join-Path $PSScriptRoot '../assets'
Copy-Item -LiteralPath (Join-Path $lantoAssets 'lanto-stream.svg') -Destination (Join-Path $lantoSource 'app/res/moonlight.svg')
Copy-Item -LiteralPath (Join-Path $lantoAssets 'lanto-stream.ico') -Destination (Join-Path $lantoSource 'app/moonlight.ico')
New-Item -ItemType Directory -Path $lantoBuild -Force | Out-Null
$lantoCommand = Join-Path $lantoBuild 'build-lanto.cmd'
@"
@echo off
call "$lantoVs\VC\Auxiliary\Build\vcvarsall.bat" x64
if errorlevel 1 exit /b 1
set "PATH=$lantoQtBin;%PATH%"
cd /d "$lantoBuild"
"$lantoQtBin\qmake.exe" "$lantoSource\moonlight-qt.pro" "CONFIG+=release" "CONFIG-=debug" "CONFIG-=debug_and_release"
if errorlevel 1 exit /b 1
nmake /nologo
exit /b %errorlevel%
"@ | Set-Content -LiteralPath $lantoCommand -Encoding ascii
& cmd.exe /d /c $lantoCommand
if ($LASTEXITCODE -ne 0) { throw 'Native client build failed' }
New-Item -ItemType Directory -Path $lantoOutput | Out-Null
Copy-Item -LiteralPath (Join-Path $lantoBuild 'app/release/Moonlight.exe') -Destination $lantoOutput
Copy-Item -LiteralPath (Join-Path $lantoBuild 'AntiHooking/release/AntiHooking.dll') -Destination $lantoOutput
Copy-Item -LiteralPath (Join-Path $lantoSource 'LICENSE') -Destination $lantoOutput
Get-ChildItem -LiteralPath (Join-Path $lantoSource 'libs/windows/lib/x64') -Filter '*.dll' | Copy-Item -Destination $lantoOutput
& (Join-Path $lantoQtBin 'windeployqt.exe') --release --qmldir (Join-Path $lantoSource 'app') (Join-Path $lantoOutput 'Moonlight.exe')
if ($LASTEXITCODE -ne 0) { throw 'Qt deployment failed' }
$lantoQtVersion = & (Join-Path $lantoQtBin 'qmake.exe') -query QT_VERSION
@{
  localCursorProtocol = 1
  cursorShapeProtocol = 1
  h264SpsPreservationProtocol = 1
  audioVolumeProtocol = 1
  brand = 'lanto'
  moonlightCommit = 'de2467e433821664cdd2224aad8c89a625be1ad9'
  qtVersion = $lantoQtVersion.Trim()
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $lantoOutput 'lanto-media.json') -Encoding utf8NoBOM
Write-Output "Native client ready: $lantoOutput"
