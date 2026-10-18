#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"
sh scripts/build_web.sh
for instrument_source in web/*.js; do node --check "$instrument_source"; done
node --test web/tests/*.test.mjs
