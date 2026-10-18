param([int]$BuildJobs = 4)
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$SdkCommit = 'a74b024c188339fdfe07b73088e6f6961ff66709'
$WebViewVersion = '1.0.3485.44'
$SdkRoot = Join-Path $ProjectRoot 'tools/plugin-sdk'
function Invoke-BuildCommand {
    param([string]$Command, [string[]]$Arguments)
    & $Command @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Command failed with exit code $LASTEXITCODE" }
}
Push-Location $ProjectRoot
$PreviousRustFlags = $env:RUSTFLAGS
try {
    New-Item -ItemType Directory -Force $SdkRoot | Out-Null
    if (-not (Test-Path "$SdkRoot/JUCE/CMakeLists.txt")) {
        Invoke-WebRequest "https://codeload.github.com/juce-framework/JUCE/tar.gz/$SdkCommit" -OutFile "$SdkRoot/juce.tar.gz"
        Invoke-BuildCommand 'tar' @('-xzf', "$SdkRoot/juce.tar.gz", '-C', $SdkRoot)
        Move-Item "$SdkRoot/JUCE-$SdkCommit" "$SdkRoot/JUCE"
    }
    $WebViewRoot = Join-Path $SdkRoot "Microsoft.Web.WebView2.$WebViewVersion"
    if (-not (Test-Path "$WebViewRoot/build/native/include/WebView2.h")) {
        $WebViewArchive = Join-Path $SdkRoot "webview2-$WebViewVersion.zip"
        Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/microsoft.web.webview2/$WebViewVersion/microsoft.web.webview2.$WebViewVersion.nupkg" -OutFile $WebViewArchive
        Expand-Archive $WebViewArchive -DestinationPath $WebViewRoot -Force
    }
    Invoke-BuildCommand 'rustup' @('run', 'stable', 'cargo', 'build', '-p', 'metropolix-web', '--target', 'wasm32-unknown-unknown', '--release')
    New-Item -ItemType Directory -Force web/dist | Out-Null
    Copy-Item web/index.html, web/*.js, web/style.css web/dist/
    Copy-Item target/wasm32-unknown-unknown/release/metropolix_web.wasm web/dist/engine.wasm
    Invoke-BuildCommand 'python' @('scripts/package_web.py')
    Invoke-BuildCommand 'node' @('scripts/prepare_plugin.mjs')
    $env:RUSTFLAGS = "$PreviousRustFlags -C target-feature=+crt-static".Trim()
    Invoke-BuildCommand 'rustup' @('run', 'stable', 'cargo', 'build', '-p', 'neuropolis-plugin', '--release')
    Invoke-BuildCommand 'cmake' @('-S', 'plugin', '-B', 'plugin/build-windows', '-G', 'Visual Studio 17 2022', '-A', 'x64', "-DJUCE_WEBVIEW2_PACKAGE_LOCATION=$SdkRoot")
    Invoke-BuildCommand 'cmake' @('--build', 'plugin/build-windows', '--config', 'Release', '--target', 'Neuropolis_VST3', 'NeuropolisVST3Check', '--parallel', [string]$BuildJobs)
    Write-Output 'Built: plugin/build-windows/Neuropolis_artefacts/Release/VST3/neuropolis.vst3'
} finally {
    $env:RUSTFLAGS = $PreviousRustFlags
    Pop-Location
}
