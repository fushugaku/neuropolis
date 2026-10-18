#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"
RUSTC=$(rustup which --toolchain stable rustc)
export RUSTC
rustup run stable cargo build -p metropolix-web --target wasm32-unknown-unknown --release
mkdir -p web/dist
cp web/index.html web/*.js web/style.css web/dist/
cp target/wasm32-unknown-unknown/release/metropolix_web.wasm web/dist/engine.wasm
python3 scripts/package_web.py
