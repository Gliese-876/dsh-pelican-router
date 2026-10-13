[CmdletBinding()]
param([ValidateSet('auto','cuda','vulkan','cpu')][string]$Backend='auto',[ValidateRange(1024,65535)][int]$Port=19140,[ValidateRange(1,128)][int]$Threads=8,[string]$RuntimeDir)
$ErrorActionPreference='Stop'
if (-not $RuntimeDir) { $RuntimeDir=Join-Path (Split-Path $PSScriptRoot -Parent) '.runtime' }
$RuntimeDir=[IO.Path]::GetFullPath($RuntimeDir)
$manifest=Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $RuntimeDir 'manifest.json') | ConvertFrom-Json
if (-not $manifest.runtimes.cpu) { throw 'Run setup-model.ps1 to install the independent CPU fallback.' }
# Check integrity before starting or stopping any process.
$files=@(@{path=$manifest.model.path;sha=$manifest.model.sha256})
foreach ($runtime in $manifest.runtimes.PSObject.Properties.Value) { $files+=@{path=$runtime.serverPath;sha=$runtime.serverSha256} }
foreach ($file in $files) { if ((Get-FileHash -LiteralPath $file.path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha) { throw "SHA-256 mismatch: $($file.path)" } }
$logDir=Join-Path $RuntimeDir 'logs'
New-Item -ItemType Directory -Path $logDir -Force | Out-Null
$stamp=[DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfff')
$devicesByBackend=@{}
function Start-LocalModelProcess($Runtime,[string[]]$Arguments,[string]$Stdout,[string]$Stderr) {
    $pelicanPreviousPath=$env:PATH
    try {
        if ($Runtime.libraryDirectories) { $env:PATH=(@($Runtime.libraryDirectories)+@($pelicanPreviousPath)) -join ';' }
        $child=Start-Process -FilePath $Runtime.serverPath -ArgumentList $Arguments -WorkingDirectory (Split-Path $Runtime.serverPath -Parent) -WindowStyle Hidden -RedirectStandardOutput $Stdout -RedirectStandardError $Stderr -PassThru
        $null=$child.Handle
        return $child
    } finally { $env:PATH=$pelicanPreviousPath }
}
$gpuBackends=if ($Backend -eq 'auto') { @('cuda','vulkan') } elseif ($Backend -eq 'cpu') { @() } else { @($Backend) }
foreach ($gpuBackend in $gpuBackends) {
    if (-not $manifest.runtimes.$gpuBackend) { continue }
    $deviceOut=Join-Path $logDir "devices.$gpuBackend.$stamp.stdout.log"
    $deviceErr=Join-Path $logDir "devices.$gpuBackend.$stamp.stderr.log"
    try {
        $probe=Start-LocalModelProcess $manifest.runtimes.$gpuBackend @('--list-devices') $deviceOut $deviceErr
        if (-not $probe.WaitForExit(10000)) { Stop-Process -InputObject $probe -Force; $probe.WaitForExit() }
        $text=(Get-Content -Raw -LiteralPath $deviceOut)+' '+(Get-Content -Raw -LiteralPath $deviceErr)
        $devices=@([regex]::Matches($text,'(?m)^\s*((?:CUDA|Vulkan)\d+):\s*(.+)$'))
        $discrete=@($devices | Where-Object { $_.Groups[2].Value -match 'NVIDIA|GeForce|RTX|AMD Radeon RX|Radeon PRO' })
        if ($discrete.Count) { $devicesByBackend[$gpuBackend]=$discrete[0].Groups[1].Value } elseif ($devices.Count) { $devicesByBackend[$gpuBackend]=$devices[0].Groups[1].Value }
    } catch { Write-Warning "$gpuBackend is unavailable; trying the next backend." }
}
$candidates=@($gpuBackends | Where-Object { $devicesByBackend.ContainsKey($_) })+@('cpu')
$pidPath=Join-Path $RuntimeDir 'model-process.json'
if (Test-Path -LiteralPath $pidPath) {
    $saved=Get-Content -Raw -Encoding UTF8 -LiteralPath $pidPath | ConvertFrom-Json
    $running=Get-Process -Id $saved.pid -ErrorAction SilentlyContinue
    if ($running) {
        if ($running.Path -ne $saved.serverPath -or $running.StartTime.ToUniversalTime().Ticks -ne ([DateTime]$saved.startedAt).ToUniversalTime().Ticks) { throw 'Recorded PID was reused; no process was stopped.' }
        if ($saved.backend -eq $candidates[0] -and $saved.port -eq $Port -and $saved.threads -eq $Threads) { Write-Host "Local model already running: $($saved.backend), $($saved.endpoint), PID $($saved.pid)."; return }
        & (Join-Path $PSScriptRoot 'stop-model.ps1') -RuntimeDir $RuntimeDir
    }
}
$portProbe=[Net.Sockets.TcpClient]::new()
try { $portProbe.Connect('127.0.0.1',$Port); throw "Port $Port is already in use." } catch [Net.Sockets.SocketException] { } finally { $portProbe.Dispose() }
foreach ($candidate in $candidates) {
    $runtime=$manifest.runtimes.$candidate
    $stderr=Join-Path $logDir "model.$candidate.$stamp.stderr.log"
    $stdout=Join-Path $logDir "model.$candidate.$stamp.stdout.log"
    $selectedDevice=if ($candidate -ne 'cpu') { $devicesByBackend[$candidate] } else { 'none' }
    $arguments=@('--model',('"{0}"' -f $manifest.model.path),'--host','127.0.0.1','--port',"$Port",'--threads',"$Threads",'--ctx-size','32768','--parallel','1','--override-kv','llama.context_length=int:32768','--device',$selectedDevice,'--n-gpu-layers',$(if ($candidate -ne 'cpu') {'999'} else {'0'}),'--temp','0','--repeat-penalty','1','--no-cache-prompt','--cache-ram','0','--no-cache-idle-slots','--no-context-shift','--no-ui','--no-slots','--cors-origins','localhost','--no-cors-credentials','--verbosity','4')
    if ($candidate -ne 'cpu') { $arguments+=@('--flash-attn','on') }
    if ($candidate -eq 'cuda') { $arguments+=@('--backend-sampling','--samplers','temperature','--cache-type-k','q8_0','--cache-type-v','q8_0') }
    $process=$null
    try {
        Write-Host "Starting $candidate on $selectedDevice ..."
        $process=Start-LocalModelProcess $runtime $arguments $stdout $stderr
        $startedAt=$process.StartTime.ToUniversalTime().ToString('o')
        $ready=$false
        $deadline=[DateTime]::UtcNow.AddSeconds(60)
        while ([DateTime]::UtcNow -lt $deadline) {
            $process.Refresh()
            if ($process.HasExited) { throw 'Model process exited during initialization.' }
            try { if ((Invoke-RestMethod "http://127.0.0.1:$Port/health" -TimeoutSec 2).status -eq 'ok') { $ready=$true; break } } catch { }
            Start-Sleep -Milliseconds 300
        }
        if (-not $ready) { throw 'Model initialization timed out.' }
        if ((Invoke-RestMethod "http://127.0.0.1:$Port/props" -TimeoutSec 2).default_generation_settings.n_ctx -lt 32768) { throw 'Model context is smaller than 32768.' }
        if ($candidate -ne 'cpu' -and (Get-Content -Raw -LiteralPath $stderr) -notmatch 'offloaded\s+[1-9]\d*/\d+\s+layers to GPU') { throw 'No model layers were offloaded to the GPU.' }
        $record=[ordered]@{pid=$process.Id;startedAt=$startedAt;serverPath=$runtime.serverPath;port=$Port;threads=$Threads;endpoint="http://127.0.0.1:$Port";backend=$candidate;device=$selectedDevice;runtime=$runtime;stderrPath=$stderr;stdoutPath=$stdout}
        [IO.File]::WriteAllText($pidPath,($record | ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))
        Write-Host "Local Pelican model ready: $candidate, $selectedDevice, http://127.0.0.1:$Port (PID $($process.Id))."
        return
    } catch {
        $failure=$_.Exception.Message
        if ($process -and -not $process.HasExited) { Stop-Process -InputObject $process -Force; if (-not $process.WaitForExit(10000)) { throw 'Failed process did not stop; no fallback was started.' } }
        $errorLog=Get-Content -Raw -ErrorAction SilentlyContinue -LiteralPath $stderr
        if ($candidate -eq 'cpu' -or $errorLog -match 'bad GGUF|invalid model|invalid argument|unknown argument|address.*in use|bind.*fail' -or $failure -match 'context is smaller|WriteAllText|Access.*denied') { throw "$failure See $stderr" }
        Write-Warning "GPU initialization failed; falling back to CPU. See $stderr"
    }
}
