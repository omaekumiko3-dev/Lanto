param(
  [Parameter(Mandatory)][string]$Media,
  [Parameter(Mandatory)][string]$QtBin
)
$ErrorActionPreference = 'Stop'
$lantoMedia = (Resolve-Path -LiteralPath $Media).Path
$lantoQtBin = (Resolve-Path -LiteralPath $QtBin).Path
$lantoVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$lantoVs = $env:VSINSTALLDIR
if (-not $lantoVs -or -not (Test-Path -LiteralPath (Join-Path $lantoVs 'VC/Tools/MSVC'))) {
  $lantoVs = & $lantoVswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
}
if (-not $lantoVs) { throw 'Visual Studio C++ tools are required to verify runtime dependencies' }
$lantoDumpbin = Get-ChildItem (Join-Path $lantoVs 'VC/Tools/MSVC/*/bin/Hostx64/x64/dumpbin.exe') | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
$lantoRedist = Get-ChildItem (Join-Path $lantoVs 'VC/Redist/MSVC/*/x64/Microsoft.VC143.CRT') | Where-Object PSIsContainer | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $lantoDumpbin -or -not $lantoRedist) { throw 'MSVC dependency reader and x64 redistributable are required' }
$lantoQueue = [Collections.Generic.Queue[string]]::new()
Get-ChildItem -LiteralPath $lantoMedia -Recurse -File | Where-Object Extension -in '.dll', '.exe' | ForEach-Object { $lantoQueue.Enqueue($_.FullName) }
$lantoSeen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
$lantoCopied = [Collections.Generic.List[string]]::new()
while ($lantoQueue.Count) {
  $lantoFile = $lantoQueue.Dequeue()
  if (-not $lantoSeen.Add($lantoFile)) { continue }
  $lantoImports = & $lantoDumpbin /DEPENDENTS $lantoFile
  if ($LASTEXITCODE -ne 0) { throw "Cannot inspect native dependency: $lantoFile" }
  foreach ($lantoLine in $lantoImports) {
    if ($lantoLine -notmatch '^\s+([\w.-]+\.dll)\s*$') { continue }
    $lantoName = $Matches[1]
    if ($lantoName -match '^(api-ms-|ext-ms-)') { continue }
    $lantoDestination = Join-Path $lantoMedia $lantoName
    if (Test-Path -LiteralPath $lantoDestination) { continue }
    if (Test-Path -LiteralPath (Join-Path (Split-Path $lantoFile) $lantoName)) { continue }
    $lantoSource = $null
    foreach ($lantoSearch in @($lantoRedist, $lantoQtBin)) {
      $lantoCandidate = Join-Path $lantoSearch $lantoName
      if (Test-Path -LiteralPath $lantoCandidate) { $lantoSource = $lantoCandidate; break }
    }
    if ($lantoSource) {
      Copy-Item -LiteralPath $lantoSource -Destination $lantoDestination
      $lantoCopied.Add($lantoName)
      $lantoQueue.Enqueue($lantoDestination)
    } elseif (-not (Test-Path -LiteralPath (Join-Path "$env:SystemRoot/System32" $lantoName))) {
      throw "Unresolved native dependency $lantoName required by $(Split-Path -Leaf $lantoFile)"
    }
  }
}
Write-Output ('Native runtime verified; added: ' + ($lantoCopied -join ', '))
