# neuropolis AU / VST3

**English** · [Русский](README.ru.md)

A native Rust MIDI sequencer with a JUCE wrapper and local editor. The DAW provides tempo and transport; the instrument after neuropolis generates sound. No local server is required, and native playback does not use WASM.

## Install

Get the latest packages from [GitHub Releases](https://github.com/fushugaku/neuropolis/releases/latest).

- **macOS 11+ / Apple Silicon:** open the `.pkg`, select AU MIDI FX, VST3, or both. Installation is per user in `~/Library/Audio/Plug-Ins/{Components,VST3}`.
- **Windows 10/11 x64:** run the `-windows-x64-setup.exe` installer. It installs `neuropolis.vst3` in `C:\Program Files\Common Files\VST3` and provides an uninstaller. If WebView2 Runtime is absent, setup downloads and installs it from Microsoft. Internet access is needed for that step.
- **Windows manual installation:** extract the VST3 ZIP and copy the entire `neuropolis.vst3` directory to the host's VST3 folder. Install [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) separately if needed.

Restart the DAW after installation. Packages currently have no Developer ID/notarization or Windows Authenticode signature. macOS plugin bundles are signed ad-hoc; system download protection may ask you to approve the installer. Use the SHA-256 files to verify downloads.

The sequencer is native on both systems. Only the editor uses WebKit on macOS or WebView2 on Windows. Do not delete or replace the browser runtime while the DAW is running.

## Host setup and MIDI routing

In Logic, choose **MIDI FX → Audio Units → Neuropolis → neuropolis** on a Software Instrument track, then load an instrument after it. Use **Record MIDI to Track Here** after neuropolis to record its MIDI output.

In VST3 hosts, route neuropolis MIDI output to an instrument using the host's MIDI routing controls. The host must support MIDI output from VST3 effects. The plugin has no audio input/output; sound comes from the receiving instrument. AU is available only on macOS.

In **Setup → MIDI**, Auto assigns channels 1–16 in a repeating cycle. Explicit channels 1–16 can be assigned independently. Give two tracks the same channel to combine them into one timbre of a multitimbral instrument such as Rustias. Give the receiving timbre the same channel; use Poly voice mode for overlapping notes.

DAW start and timeline seek reset the sequencer; stopping releases generated notes. Incoming MIDI is passed through with sample offsets. Root control from incoming notes has not been added to the plugin.

## Timing, accumulators and memory

Every track has its own sequence, length, direction, clock, swing, ratchets and accumulator. Clock includes **÷0.5** and **÷0.25**, equivalent to 2× and 4× speed. These values survive preset recall, DAW project state, MIDI export and automation.

**Accum → Reset → After stages** resets accumulation after 1–1024 stage entries. A stage is the position with Pitch/Gate controls. Pulse Count and ratchet do not add entries. Reset happens before the next stage after N entries, then repeats. Skipped stages do not count; rest, mute and probability do not stop progression. Manual Reset accumulator restarts the count. Existing patterns retain their previous reset mode, with a default period of 16 for the new mode.

Global **Reset after** is a separate cycle measured in sixteenth notes and resets tracks and MOD lanes. A value of 0 turns periodic global reset off.

Preset queues and chains run in Rust with the editor closed and during offline bounce. **Load delay → Queue pulses** waits for the chosen pulse count; **Global cycle** waits for Reset after. A pulse is one sixteenth note. Each chain link has its own repeats and mute state. DAW start, seek and transport looping restart the chain from its first link.

Pattern, presets, scales and automation assignments are saved in each plugin instance's DAW state. File menu exports JSON patterns/backups and eight bars of MIDI; drag the exported `.mid` from your file manager into the DAW. Browser session storage remains separate.

## Automation

The DAW sees 35 stable parameters:

- **Reset after:** 0–1024; 0 disables global reset.
- **Preset:** 0 means no recall request; 1–64 select slots 1.1–8.8 and respect Load delay.
- **Chain:** starts or disables the preset chain.
- **Automation 01–32:** assignable lanes for numeric track, stage, MOD, CTRL/AUX, output, MX and user-scale controls.

Open **Setup → Automation**, press Learn, then adjust the desired control. Choose the matching Automation NN in the DAW. Each lane spans 0–100% of its assigned range; discrete values are rounded. Fader gestures reach the host for Touch/Latch/Write. Removing a track updates assignments to the surviving tracks.

## Build and test

Requirements are listed in the [main README](../README.md). Build with `sh scripts/build_plugin.sh` on macOS or `./scripts/build_plugin.ps1` in Windows PowerShell. The JUCE commit is pinned to `a74b024c188339fdfe07b73088e6f6961ff66709`; Windows uses WebView2 SDK `1.0.3485.44`. Windows C/C++ runtime and WebView2 loader linking is static.

Package with `sh scripts/package_plugin.sh --skip-build` or `./scripts/package_plugin.ps1 -SkipBuild`. Outputs and SHA-256 files appear in `dist/`. macOS packaging accepts `NEUROPOLIS_APPLICATION_SIGN_IDENTITY` and `NEUROPOLIS_INSTALLER_SIGN_IDENTITY`. Apple notarization is a separate release step. Windows installers are currently unsigned.

`NeuropolisVST3Check` loads the real VST3 without an audio device and checks generated channels, incoming MIDI sample offsets, transport stop and host-parameter state restoration. Run it through CTest after building. `NeuropolisCheck` is the separate macOS AU validation host. Run `auval -v aumi Nplx Npol` for an installed AU.

Hardware analog inputs/outputs, original firmware SysEx and board peripherals are not implemented by the plugin. Virtual musical controls and the browser monitor voices are described in [Features](../docs/FEATURES.md).

## License

Neuropolis and the JUCE wrapper use AGPL-3.0. See [LICENSE](../LICENSE), [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) and `licenses/`. Microsoft WebView2 components retain their Microsoft license terms.
