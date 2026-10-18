#!/bin/sh
set -eu
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"
# Homebrew's rustc can shadow rustup shims even inside `rustup run`.
RUSTC=$(rustup which --toolchain stable rustc)
RUSTDOC=$(rustup which --toolchain stable rustdoc)
export RUSTC RUSTDOC
rustup run stable cargo fmt --all -- --check
rustup run stable cargo test --workspace
rustup run stable cargo clippy --workspace --all-targets -- -D warnings
rustup run stable cargo check -p metropolix-core --target thumbv7em-none-eabihf
