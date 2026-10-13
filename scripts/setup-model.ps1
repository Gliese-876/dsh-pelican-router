[CmdletBinding()]
param([ValidateSet('auto','cuda','vulkan','cpu')][string]$Backend='auto',[string]$RuntimeDir)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
if (-not $RuntimeDir) { $RuntimeDir=Join-Path (Split-Path $PSScriptRoot -Parent) '.runtime' }
$RuntimeDir=[IO.Path]::GetFullPath($RuntimeDir)
$downloadDir=Join-Path $RuntimeDir 'downloads'
New-Item -ItemType Directory -Path $RuntimeDir,$downloadDir,(Join-Path $RuntimeDir 'models') -Force | Out-Null
function Get-VerifiedFile([string]$Uri,[string]$Destination,[string]$Sha256) {
    if (-not (Test-Path -LiteralPath $Destination)) {
        Write-Host "Downloading $(Split-Path $Destination -Leaf)"
        $partial="$Destination.partial"
        Invoke-WebRequest -UseBasicParsing -TimeoutSec 180 -Uri $Uri -OutFile $partial
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256) { throw "SHA-256 mismatch: $partial" }
        Move-Item -LiteralPath $partial -Destination $Destination
    }
    if ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $Sha256) { throw "SHA-256 mismatch: $Destination" }
}
$revision='6981d554c08a3727d960c9dbbd345af887f643e9'
$modelName='0u0-pelican-pro-v2-Q4_K_M.gguf'
$modelHash='5d449b74def5447d236471e365c0db1e05396d7df2fd658cdff62116b9bee00a'
$modelPath=Join-Path $RuntimeDir "models\$modelName"
Get-VerifiedFile "https://huggingface.co/0v0ai/0u0-pelican-pro-0.2B-GGUF/resolve/$revision/${modelName}?download=true" $modelPath $modelHash
$assets=@(
    @{backend='cpu';name='llama-b11429-bin-win-cpu-x64.zip';sha='1283323272b04cd07905816a597a0da810918102de958f4ff6f7bbaa70ed2efe';directory='llama-b11429'},
    @{backend='vulkan';name='llama-b11429-bin-win-vulkan-x64.zip';sha='1bfe78ad9168b79fa02bf67f6af9f5e17a966d824d77238517f7bef12ac73b36';directory='llama-b11429-vulkan'}
)
$cudaLibraries=@()
$hasNvidia=$false
$nvidia=Get-Command nvidia-smi -ErrorAction SilentlyContinue
if ($nvidia) { $null=& $nvidia.Source --query-gpu=name --format=csv,noheader 2>$null; $hasNvidia=($LASTEXITCODE -eq 0) }
if ($Backend -eq 'cuda' -or ($Backend -eq 'auto' -and $hasNvidia)) {
    $cudaRoot=Join-Path $env:ProgramFiles 'NVIDIA GPU Computing Toolkit\CUDA'
    $cudaLibraries=@(Get-ChildItem -LiteralPath $cudaRoot -Directory -ErrorAction SilentlyContinue | Where-Object Name -Like 'v13.*' | Sort-Object Name -Descending | ForEach-Object { (Join-Path $_.FullName 'bin\x64'); (Join-Path $_.FullName 'bin') } | Where-Object { (Test-Path -LiteralPath (Join-Path $_ 'cudart64_13.dll')) -and (Test-Path -LiteralPath (Join-Path $_ 'cublas64_13.dll')) -and (Test-Path -LiteralPath (Join-Path $_ 'cublasLt64_13.dll')) })
    if (-not $cudaLibraries.Count) {
        $dllArchive=Join-Path $downloadDir 'cudart-llama-bin-win-cuda-13.4-x64.zip'
        Get-VerifiedFile 'https://github.com/ggml-org/llama.cpp/releases/download/b11429/cudart-llama-bin-win-cuda-13.4-x64.zip' $dllArchive '738f8c251ac22b70c3ae6f83a10cf222725df0395246a2cf58f32bdb85fbe668'
        $dllDir=Join-Path $RuntimeDir 'cuda-libraries'
        Expand-Archive -LiteralPath $dllArchive -DestinationPath $dllDir -Force
        $cudaLibraries=@(Get-ChildItem -LiteralPath $dllDir -Filter 'cudart64_13.dll' -Recurse -File | ForEach-Object DirectoryName)
    }
    $assets+=@{backend='cuda';name='llama-b11429-bin-win-cuda-13.4-x64.zip';sha='76ddc6eff2389570789ed608881efc6977751a722015d8e8c94f302224ff1a3a';directory='llama-b11429-cuda'}
}
$runtimes=[ordered]@{}
$serverHash='7e236243c9b670c6a49410c03186fd575c57a0efe3fd8a21d8727503d571d5b6'
foreach ($asset in $assets) {
    $archive=Join-Path $downloadDir $asset.name
    Get-VerifiedFile "https://github.com/ggml-org/llama.cpp/releases/download/b11429/$($asset.name)" $archive $asset.sha
    $directory=Join-Path $RuntimeDir $asset.directory
    $serverPath=Join-Path $directory 'llama-server.exe'
    if (-not (Test-Path -LiteralPath $serverPath) -or (Get-FileHash -LiteralPath $serverPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $serverHash) {
        Expand-Archive -LiteralPath $archive -DestinationPath $directory -Force
    }
    if ((Get-FileHash -LiteralPath $serverPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $serverHash) { throw "Server SHA-256 mismatch: $serverPath" }
    $runtimes[$asset.backend]=[ordered]@{repository='ggml-org/llama.cpp';version='v0.6.0';build='b11429';backend=$asset.backend;archive=$asset.name;archiveSha256=$asset.sha;serverPath=$serverPath;serverSha256=$serverHash;libraryDirectories=@($(if ($asset.backend -eq 'cuda') {$cudaLibraries}))}
}
$manifest=[ordered]@{schemaVersion=2;model=[ordered]@{repository='0v0ai/0u0-pelican-pro-0.2B-GGUF';revision=$revision;filename=$modelName;path=$modelPath;sha256=$modelHash};runtime=$runtimes.cpu;runtimes=$runtimes}
[IO.File]::WriteAllText((Join-Path $RuntimeDir 'manifest.json'),($manifest | ConvertTo-Json -Depth 7),[Text.UTF8Encoding]::new($false))
Write-Host "Installed backends: $($runtimes.Keys -join ', '). Start with scripts/start-model.ps1 -Backend $Backend"
