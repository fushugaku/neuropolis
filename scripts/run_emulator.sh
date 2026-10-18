#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"
if [ ! -f web/dist/engine.wasm ]; then sh scripts/build_web.sh; fi
python3 scripts/serve_emulator.py
