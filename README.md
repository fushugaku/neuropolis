# neuropolis

**English** · [Русский](README.ru.md)

A native MIDI sequencer for your DAW, inspired by Intellijel Metropolix. Add independent 16-stage tracks, each with its own pitch faders, pulse counts, gate types, accumulator and timing.

**[Download installers](https://github.com/fushugaku/neuropolis/releases/latest)** · [Plugin guide](plugin/README.md) · [Features](docs/FEATURES.md)

## Downloads

| Platform | Download | Formats |
| --- | --- | --- |
| macOS 11+ · Apple Silicon | `neuropolis-0.2.2-macos-arm64.pkg` | AU MIDI FX and VST3 |
| Windows 10/11 · x64 | `neuropolis-0.2.2-windows-x64-setup.exe` | VST3 |
| Windows 10/11 · x64 · manual install | `neuropolis-0.2.2-windows-x64-vst3.zip` | VST3 bundle |

Download from [GitHub Releases](https://github.com/fushugaku/neuropolis/releases). The macOS installer lets you choose AU, VST3, or both, and installs them in your user `~/Library/Audio/Plug-Ins` directory. The Windows installer places VST3 in `C:\Program Files\Common Files\VST3` and installs Microsoft Edge WebView2 Runtime if it is missing. That dependency download requires internet access. Restart your DAW after installation.

Installers are currently **unsigned and not notarized**. macOS plugins use ad-hoc signatures. macOS Gatekeeper or Windows SmartScreen may ask you to approve opening the installer. SHA-256 checksums are included in each release. Native Windows ARM64 and macOS Intel binaries are not supplied in this release.

## In your DAW

### Logic Pro

1. Create a Software Instrument track.
2. Insert **MIDI FX → Audio Units → Neuropolis → neuropolis**.
3. Load an instrument after neuropolis. Logic supplies the tempo and transport.

To record the generated notes, use **Record MIDI to Track Here** in the MIDI FX menu after neuropolis. Each instance saves its pattern, presets, scales and automation assignments in the DAW project.

### VST3 hosts on Windows or macOS

Load neuropolis as a VST3 MIDI effect and route its MIDI output to an instrument. Your host must support VST3 event output; the exact routing controls depend on the DAW. AU is a macOS format and is not included in the Windows build.

### Route multiple tracks to one sound

Open **Setup → MIDI** and assign the same **Channel** to the tracks you want to combine. For example, tracks 1 and 2 on channel 1 can both play a Rustias timbre that receives channel 1. Their sequences, lengths and speeds remain independent. Enable polyphony in the receiving instrument if you want simultaneous notes.

**Auto** assigns channels 1–16 in a repeating cycle. A MIDI port has 16 channels; this does not limit the number of internal sequencer tracks.

## Features

- Add, duplicate and remove tracks with no fixed track-count limit; 16 stages per track with independent Pitch, Pulse Count 1–8 and Rest/Single/Multi/Hold gates.
- 21 playback orders, direction, length, offset, swing, ratchet, probability, slide and CV layers.
- Per-track clock divisions ÷1…÷64, plus **÷0.5** and **÷0.25** for 2× and 4× speed.
- Per-stage or whole-track accumulators with limits, traversal modes and independent reset after 1–1024 stage entries. Pulse Count and ratchet do not advance this reset counter.
- Global **Reset after** from 1–1024 sixteenth notes; 0 disables periodic reset.
- Eight MOD lanes, CTRL/AUX, Loopy, Stage Player, virtual CV/gate outputs and MX MIDI.
- 64 presets, deferred recall, 32-link preset chains and eight chain memories. Native playback continues with the editor closed.
- 49 factory scales, 100 user scales, Undo/Redo, copy/paste, rotation, randomize and morph.
- 32 assignable DAW automation slots; JSON pattern/backup import and export; MIDI file export.

See [Features](docs/FEATURES.md) and the [plugin guide](plugin/README.md) for details and limitations.

## Native architecture

**AU and VST3 run the sequencer natively in Rust.** JUCE/C++ connects it to the DAW transport and MIDI. The editor uses local WebKit on macOS and WebView2 on Windows. Plugin playback does not use WebAssembly and does not need a local web server. WASM is used by the separate browser version and editor helpers such as MIDI export.

| Directory | Purpose |
| --- | --- |
| `crates/metropolix-core` | Shared Rust musical engine, `no_std` + `alloc` |
| `crates/neuropolis-plugin` | Native MIDI renderer and project state |
| `crates/metropolix-web` | Browser/WASM ABI |
| `plugin` | JUCE AU/VST3 wrapper, integration checks and installers |
| `web` | Editor, browser host, state model and JavaScript tests |
| `scripts` | Build, packaging and optional research tools |

## Build from source

Requirements: Rust stable/rustup, Python 3, Node.js and CMake. macOS also needs Xcode Command Line Tools. Windows needs Visual Studio 2022 with the Desktop development with C++ workload; packaging needs Inno Setup 6. JUCE and the Windows WebView2 SDK are downloaded at pinned versions by the build scripts.

```sh
git clone https://github.com/fushugaku/neuropolis.git
cd neuropolis
rustup target add --toolchain stable wasm32-unknown-unknown
```

macOS:

```sh
sh scripts/build_plugin.sh
sh scripts/package_plugin.sh --skip-build
```

Windows, in PowerShell:

```powershell
./scripts/build_plugin.ps1
./scripts/package_plugin.ps1 -SkipBuild
```

Packages appear in `dist/`. macOS builds use the architecture of the build machine; the Windows script targets x64. Windows builds statically link the C/C++ runtime and WebView2 loader. Microsoft WebView2 Runtime remains a separate system dependency. See the [plugin guide](plugin/README.md) for signing and installation details.

For the standalone browser version:

```sh
sh scripts/build_web.sh
sh scripts/run_emulator.sh
```

Open `http://127.0.0.1:8765`. This server only listens locally. The browser host provides monitor voices and optional Web MIDI; its session is separate from DAW plugin instances. Generated browser assets live in `web/dist/`.

## Validation

```sh
rustup target add --toolchain stable thumbv7em-none-eabihf
sh scripts/check_rust_port.sh
sh scripts/check_web.sh
```

The Windows [GitHub Actions workflow](.github/workflows/windows.yml) runs Rust/JavaScript checks, builds the native VST3, loads it in a silent integration host, verifies MIDI offsets and project state, then tests installer installation and uninstallation. You can dispatch it from the Actions tab.

On macOS, validate an installed AU with `auval -v aumi Nplx Npol`. The native VST3 integration check can also be built as `NeuropolisVST3Check` and run with `ctest --test-dir plugin/build -C Release --output-on-failure`. Integration tests do not open an audio device. DAW-specific routing still depends on the host's MIDI effect support.

## License and provenance

Neuropolis source code is licensed under **[AGPL-3.0](LICENSE)** and uses JUCE under its open-source AGPLv3 option. Dependency notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Release source archives include Neuropolis and the pinned JUCE source.

This is an independent project, not an official Intellijel product. [Porting notes](docs/PORTING.md) explain the recovered musical primitives and behavioral test fixtures. Original firmware, decompiled listings, Ghidra projects and local logs are not distributed and are not needed to build or run Neuropolis. Hardware SysEx/binary preset compatibility and full board emulation are not claimed.
