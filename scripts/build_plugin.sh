#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"
MACOSX_DEPLOYMENT_TARGET=${NEUROPOLIS_MACOS_DEPLOYMENT_TARGET:-11.0}
export MACOSX_DEPLOYMENT_TARGET
sdk_commit=a74b024c188339fdfe07b73088e6f6961ff66709
if [ ! -f tools/plugin-sdk/JUCE/CMakeLists.txt ]; then
    mkdir -p tools/plugin-sdk
    curl -fL --retry 2 "https://codeload.github.com/juce-framework/JUCE/tar.gz/$sdk_commit" -o tools/plugin-sdk/juce.tar.gz
    tar -xzf tools/plugin-sdk/juce.tar.gz -C tools/plugin-sdk
    mv "tools/plugin-sdk/JUCE-$sdk_commit" tools/plugin-sdk/JUCE
fi
sh scripts/build_web.sh
node scripts/prepare_plugin.mjs
RUSTC=$(rustup which --toolchain stable rustc)
export RUSTC
rustup run stable cargo build -p neuropolis-plugin --release
cmake -S plugin -B plugin/build -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES="$(uname -m)" -DCMAKE_OSX_DEPLOYMENT_TARGET="$MACOSX_DEPLOYMENT_TARGET"
cmake --build plugin/build --target Neuropolis_AU Neuropolis_VST3 -j "${NEUROPOLIS_BUILD_JOBS:-6}"
printf 'Built: %s\n' "$project_root/plugin/build/Neuropolis_artefacts/Release/AU/neuropolis.component" "$project_root/plugin/build/Neuropolis_artefacts/Release/VST3/neuropolis.vst3"
