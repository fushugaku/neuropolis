#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_root"
export NEUROPOLIS_OPEN_BROWSER=1
sh scripts/run_emulator.sh
