# Changelog

## 0.2.1

- Independent accumulator reset period per track: **Accum → Reset → After stages**, 1–1024 stages. Pulse Count and ratchet do not advance this counter.
- Per-track clock speeds **÷0.5** and **÷0.25**, equivalent to 2× and 4× speed. Presets, DAW state, MIDI export and automation retain these values.
- Compatibility with existing presets and DAW projects.

First public release: native AU MIDI FX and VST3 in one macOS Apple Silicon installer, source code and build instructions. The installer has no Developer ID signature or Apple notarization; plugin bundles use ad-hoc signatures.

## 0.2.0

- Native Rust playback in AU MIDI FX / VST3 with host tempo and transport.
- Dynamic tracks with independent 16-stage controls, modulation, scales, presets and chains.
- DAW automation, state round-trip, deferred recall and playback with the editor closed.
- Per-user macOS installer with selectable AU/VST3 components.
