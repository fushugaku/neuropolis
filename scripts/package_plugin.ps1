param([switch]$SkipBuild)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $ProjectRoot
try {
    if (-not $SkipBuild) { & "$PSScriptRoot/build_plugin.ps1" }
    $ProductVersion = [regex]::Match((Get-Content plugin/CMakeLists.txt -Raw), 'project\(Neuropolis VERSION ([0-9.]+)').Groups[1].Value
    if (-not $ProductVersion) { throw 'Plugin version was not found' }
    $Bundle = 'plugin/build-windows/Neuropolis_artefacts/Release/VST3/neuropolis.vst3'
    if (-not (Test-Path "$Bundle/Contents/x86_64-win/neuropolis.vst3")) { throw 'Build the Windows x64 VST3 first' }
    $Payload = 'dist/windows-payload'
    New-Item -ItemType Directory -Force $Payload | Out-Null
    if (Test-Path "$Payload/neuropolis.vst3") { Remove-Item "$Payload/neuropolis.vst3" -Recurse -Force }
    Copy-Item $Bundle $Payload -Recurse
    $Resources = "$Payload/neuropolis.vst3/Contents/Resources"
    New-Item -ItemType Directory -Force $Resources | Out-Null
    Copy-Item LICENSE, THIRD_PARTY_NOTICES.md $Resources
    Copy-Item licenses "$Resources/licenses" -Recurse
    $Bootstrapper = 'tools/plugin-sdk/MicrosoftEdgeWebview2Setup.exe'
    if (-not (Test-Path $Bootstrapper)) {
        Invoke-WebRequest 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $Bootstrapper
    }
    $Signature = Get-AuthenticodeSignature $Bootstrapper
    if ($Signature.Status -ne 'Valid' -or $Signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') {
        throw 'The WebView2 bootstrapper must have a valid Microsoft signature'
    }
    $Compiler = Join-Path ${env:ProgramFiles(x86)} 'Inno Setup 6/ISCC.exe'
    if (-not (Test-Path $Compiler)) { $Compiler = (Get-Command ISCC.exe -ErrorAction Stop).Source }
    & $Compiler "/DProductVersion=$ProductVersion" "/DProjectRoot=$ProjectRoot" plugin/installer/windows.iss
    if ($LASTEXITCODE -ne 0) { throw "Installer compilation failed with exit code $LASTEXITCODE" }
    $Portable = "dist/neuropolis-$ProductVersion-windows-x64-vst3.zip"
    Compress-Archive -Path "$Payload/neuropolis.vst3" -DestinationPath $Portable -Force
    foreach ($ReleaseFile in @("dist/neuropolis-$ProductVersion-windows-x64-setup.exe", $Portable)) {
        $Digest = (Get-FileHash $ReleaseFile -Algorithm SHA256).Hash.ToLowerInvariant()
        $AssetName = Split-Path -Leaf $ReleaseFile
        [IO.File]::WriteAllText((Join-Path $ProjectRoot "$ReleaseFile.sha256"), "$Digest  $AssetName`n")
        Write-Output "Packaged: $ReleaseFile"
    }
} finally { Pop-Location }
