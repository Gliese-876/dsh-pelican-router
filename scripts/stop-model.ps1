[CmdletBinding()]
param([string]$RuntimeDir)

$ErrorActionPreference = 'Stop'
if ([string]::IsNullOrWhiteSpace($RuntimeDir)) {
    $RuntimeDir = Join-Path (Split-Path $PSScriptRoot -Parent) '.runtime'
}
$RuntimeDir = [IO.Path]::GetFullPath($RuntimeDir)
$pidPath = Join-Path $RuntimeDir 'model-process.json'
if (-not (Test-Path -LiteralPath $pidPath)) { Write-Host 'No local model process is recorded.'; return }
$saved = Get-Content -Raw -Encoding UTF8 -LiteralPath $pidPath | ConvertFrom-Json
$process = Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
if ($process) {
    if ($process.Path -ne $saved.serverPath -or $process.StartTime.ToUniversalTime().Ticks -ne ([DateTime]$saved.startedAt).ToUniversalTime().Ticks) {
        throw "PID $($saved.pid) no longer belongs to the recorded local model. No process was stopped."
    }
    Stop-Process -InputObject $process -Force
    if (-not $process.WaitForExit(10000)) { throw 'The recorded model did not stop within 10 seconds. Its process record was retained.' }
    Write-Host "Stopped the local model (PID $($saved.pid))."
} else {
    Write-Host 'The recorded local model has already stopped.'
}
Remove-Item -LiteralPath $pidPath
