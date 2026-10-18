# Features and limitations

**English** · [Русский](FEATURES.ru.md)

## Tracks and stages

Tracks are dynamically allocated without a fixed maximum; practical capacity depends on memory and CPU. Each track has 16 stages, independent pitch faders, Pulse Count 1–8, Rest/Single/Multi/Hold gate type, settings and transport position. Add, duplicate and remove preserve other tracks' positions. Removal supports Undo.

Pitch/gate override, ratchet, probability, accumulation, CV, slide and skip are editable per stage. Pulse and gate switch positions stay visible on the panel. Copy/paste, rotation, randomize and morph operate on stages, layers and tracks.

## Timing and pitch

21 traversal orders, both directions, length 1–16, offset 0–15, pulse length, Pulse Count Div, clock ÷1…÷64 and accelerations ÷0.5 / ÷0.25. Swing is independent per track. Gate length/stretching, ratchets, stage/pulse probability, slide and Hold are available.

Global Reset after repeats after 1–1024 sixteenth notes; 0 turns it off. It resets tracks and MOD lanes independently of their length or Pulse Count. AU/VST3 follow DAW tempo and transport.

The quantizer has 49 factory scales and 100 editable user scales. Tracks include transpose, root, pitch-fader range, inversion and per-stage pitch override.

## Accumulators

Per-stage/whole-track accumulation, Stage/Pulse/Ratchet triggers, separate positive and negative limits, Wrap/Pendulum/Random/Hold, uni/bipolar, reverse/invert/freeze. In addition to Manual/Auto/AUX reset, **Accum → Reset → After stages** gives each track its own 1–1024-stage reset period.

One entry is entering a stage with Pitch/Gate controls. Pulse Count and ratchet do not increment this counter. Reset occurs before stage N+1 and repeats after every N entries. Skipped stages do not count; rests, mute and probability do not stop advancement. Manual Reset accumulator restarts the counter.

## Modulation and performance

Eight 16-stage MOD lanes with order, length, offset, division, step/ramp, bipolar/unipolar/gates, mute and MIDI CC. CTRL 1/2, AUX X/Y/Z, Loopy, Stage Player, virtual Outputs A/B and MX are available.

Virtual CV/Gate belongs to the computer model; the plugin does not provide physical analog outputs. Browser monitor voices are for auditioning. In the DAW, the downstream instrument generates sound. MX sends the selected MIDI notes or CC.

## Memory, MIDI and automation

64 presets, selective recall and pickup, deferred loading, 32-link chains with repeat/mute, and eight chain memories. Native queues/chains keep running with the editor closed and during offline bounce.

Assign MIDI channels per track. Multiple tracks can share one channel; Auto cycles through 16 channels. The MIDI port's channel count does not limit internal track count. Plugin MIDI input passes through.

DAW automation provides Reset after, Preset, Chain and 32 assignable Learn lanes. Live edit, Undo/Redo, JSON pattern and full-backup import/export and eight-bar `.mid` export are supported. Each plugin instance saves state in the DAW project; browser storage is separate.

## Boundaries

- This is an extended computer sequencer. Recovered primitives are compared against stored ARM traces; bit-for-bit equivalence of the whole firmware or all hardware timing is not claimed.
- Original hardware SysEx and binary presets are not supported. Neuropolis uses its own JSON format.
- Original ADC/DAC, USB stack, voltage calibration and Flash update are not emulated.
- AU MIDI FX is macOS-only. VST3 requires a host with VST3 MIDI output routing. Silent integration checks verify the plugin API; DAW-specific routing varies by host.
- Release binaries target macOS Apple Silicon and Windows x64. Installers are unsigned; the macOS package is not notarized.

[Installation and automation guide](../plugin/README.md).
