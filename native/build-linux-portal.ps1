param(
    [Parameter(Mandatory)][string]$Clang,
    [Parameter(Mandatory)][string]$Output
)
$ErrorActionPreference = 'Stop'
$lantoOutput = [IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path $lantoOutput -Force | Out-Null
$lantoSource = Join-Path $PSScriptRoot 'linux/portal-response.c'
foreach ($lantoVariant in @('production', 'test')) {
    $lantoName = if ($lantoVariant -eq 'test') { 'liblanto-portal-response-test.so' } else { 'liblanto-portal-response.so' }
    $lantoArguments = @('--target=x86_64-linux-gnu', '-fuse-ld=lld', '-nostdlib', '-shared', '-fPIC', '-O2', '-Wall', '-Wextra')
    if ($lantoVariant -eq 'test') { $lantoArguments += '-DLANTO_TEST' }
    $lantoArguments += @($lantoSource, "-Wl,-soname,$lantoName", '-o', (Join-Path $lantoOutput $lantoName))
    & $Clang @lantoArguments
    if ($LASTEXITCODE) { throw "Linux Portal adapter $lantoVariant build failed" }
}
