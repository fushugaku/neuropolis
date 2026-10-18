#!/bin/sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
if [ -z "${GHIDRA_HOME:-}" ]; then
    GHIDRA_HOME="$(brew --prefix ghidra)/libexec"
fi
if [ -z "${JAVA_HOME:-}" ]; then
    JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
fi
export JAVA_HOME

python3 "$project_root/scripts/inspect_firmware.py"
mkdir -p "$project_root/ghidra-project" "$project_root/analysis/ghidra"
exec "$GHIDRA_HOME/support/analyzeHeadless" \
    "$project_root/ghidra-project" Metropolix \
    -import "$project_root/firmware/original/Metropolix.1.6.5.0.bin" \
    -overwrite -loader BinaryLoader -loader-baseAddr 0x08000000 \
    -processor ARM:LE:32:Cortex -cspec default \
    -scriptPath "$project_root/scripts/ghidra" \
    -preScript SetupMetropolix.java "$project_root/analysis/vectors.tsv" "$project_root/analysis/mmio-registers.tsv" \
    -postScript ExportMetropolix.java "$project_root/analysis/ghidra" "$project_root/analysis/ascii-strings.tsv" "$project_root/analysis/mmio-registers.tsv" \
    -analysisTimeoutPerFile 600 -max-cpu 4 \
    -log "$project_root/analysis/ghidra/headless.log" \
    -scriptlog "$project_root/analysis/ghidra/scripts.log"
