import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  demoPatch,
  emptyTrack,
  routeTarget,
  sinkForTrack,
  freshSession,
  validatePatch,
  validateSession,
  migratePatch,
  loadSession,
  STORAGE,
  TRACK_KEYS,
  syncEngine,
} from "../model.js";
import { InstrumentAudio } from "../audio.js";
import { InstrumentStore } from "../store.js";
import { Runtime } from "../runtime.js";
import { renderMidi, MidiPort } from "../midi.js";
const module = await WebAssembly.compile(
  await readFile(new URL("../dist/engine.wasm", import.meta.url)),
);
function makeStore() {
  const memory = new Map();
  const store = new InstrumentStore({
    getItem: (k) => memory.get(k) || null,
    setItem: (k, v) => memory.set(k, v),
  });
  store.session = freshSession();
  return store;
}
async function instrument() {
  const store = makeStore();
  const runtime = new Runtime(
    store,
    () => {},
    () => {},
  );
  await runtime.init(module);
  return { store, runtime };
}
test("All complete demos and backup validate; invalid stage and user scale are rejected", () => {
  for (let n = 0; n < 4; n++) assert(validatePatch(demoPatch(n)));
  assert(validateSession(freshSession()));
  const p = demoPatch();
  p.tracks[1].steps[15].ratchet = 9;
  assert(!validatePatch(p));
  p.tracks[1].steps[15].ratchet = 1;
  p.userScales[99].mask = 4096;
  assert(!validatePatch(p));
});
test("Fractional clocks survive presets and backup and drive each WASM track independently", async () => {
  const s = makeStore();
  s.patch.tracks = [1, 0.5, 0.25].map((division, i) => ({
    ...emptyTrack(i),
    division,
  }));
  s.patch.totalPulses = 0;
  s.patch.mods.forEach((m) => (m.destination = 0));
  assert(validatePatch(s.patch));
  s.savePreset(63);
  const restored = makeStore();
  restored.import(JSON.parse(JSON.stringify(s.backup())));
  assert.deepEqual(
    restored.patch.tracks.map((t) => t.division),
    [1, 0.5, 0.25],
  );
  const e = (await WebAssembly.instantiate(module)).exports;
  syncEngine(e, restored.patch);
  const starts = [[], [], []];
  for (let tick = 0; tick <= 48; tick++) {
    e.engine_tick();
    starts.forEach((events, i) => {
      if (e.engine_track_events(i) & 1) events.push(tick);
    });
  }
  assert.deepEqual(starts[0], [0, 24, 48]);
  assert.deepEqual(starts[1], [0, 12, 24, 36, 48]);
  assert.deepEqual(starts[2], [0, 6, 12, 18, 24, 30, 36, 42, 48]);
  for (const division of [0, 0.75, 1.5, 65]) {
    const invalid = structuredClone(s.patch);
    invalid.tracks[0].division = division;
    assert(!validatePatch(invalid));
  }
  s.flush();
  restored.flush();
});
test("Accumulator reset counts stage entries, with independent track periods and pulse counts", async () => {
  const s = makeStore();
  s.patch.totalPulses = 0;
  s.patch.mods.forEach((m) => (m.destination = 0));
  s.patch.userScales[0].mask = 4095;
  s.patch.tracks = [3, 5].map((period, i) => ({
    ...emptyTrack(i),
    accumulatorReset: 3,
    accumulatorStages: period,
    accumulatorScope: 1,
    accumulatorLimit: 28,
    scale: 49,
    faderMode: 0,
    swing: 50,
    steps: emptyTrack(i).steps.map((step) => ({
      ...step,
      pitch: 60,
      gate: 1,
      accumulate: 1,
      pulses: i + 2,
    })),
  }));
  s.savePreset(63);
  const restored = makeStore();
  restored.import(JSON.parse(JSON.stringify(s.backup())));
  restored.patch.tracks[0].accumulatorStages = 9;
  restored.loadPreset(63, false);
  assert.deepEqual(
    restored.patch.tracks.map((t) => t.accumulatorStages),
    [3, 5],
  );
  const e = (await WebAssembly.instantiate(module)).exports;
  syncEngine(e, restored.patch);
  const notes = [[], []];
  for (let tick = 0; tick <= 24 * 18; tick++) {
    e.engine_tick();
    notes.forEach((events, i) => {
      if (e.engine_track_events(i) & 1) events.push(e.engine_note(i));
    });
  }
  assert.deepEqual(notes[0], [60, 61, 62, 60, 61, 62, 60, 61, 62, 60]);
  assert.deepEqual(notes[1], [60, 61, 62, 63, 64, 60, 61]);
  assert.equal(
    e.engine_value(1, 100 + TRACK_KEYS.indexOf("accumulatorStages")),
    5,
  );
  assert.equal(e.engine_value(1, 100 + TRACK_KEYS.length), -1);
  for (const value of [0, -1, 1025, 1.5, null]) {
    const bad = structuredClone(restored.patch);
    bad.tracks[0].accumulatorStages = value;
    assert(!validatePatch(bad));
  }
  s.flush();
  restored.flush();
});
test("Existing version 2 sessions, presets and backups retain their accumulator reset modes", () => {
  const old = freshSession();
  [old.patch, ...old.presets.filter(Boolean)].forEach((p) => {
    p.tracks.forEach((t, i) => {
      delete t.accumulatorStages;
      t.accumulatorReset = i % 3;
    });
  });
  const before = JSON.stringify(old);
  const loaded = loadSession({
    getItem: (key) => (key === STORAGE ? before : null),
  });
  assert.deepEqual(
    loaded.patch.tracks.map((t) => t.accumulatorReset),
    [0, 1],
  );
  assert(loaded.patch.tracks.every((t) => t.accumulatorStages === 16));
  assert(
    loaded.presets
      .filter(Boolean)
      .every((p) => p.tracks.every((t) => t.accumulatorStages === 16)),
  );
  assert.equal(JSON.stringify(old), before);
  const s = makeStore();
  s.import({ format: "neuropolis-backup", session: old });
  assert(s.patch.tracks.every((t) => t.accumulatorStages === 16));
  assert.deepEqual(
    s.patch.tracks.map((t) => t.accumulatorReset),
    [0, 1],
  );
  s.flush();
});
test("MIDI export preserves the doubled and quadrupled clock speeds", async () => {
  const p = demoPatch();
  p.tracks = [1, 0.5, 0.25].map((division, i) => ({
    ...emptyTrack(i),
    division,
  }));
  p.totalPulses = 0;
  p.mods.forEach((m) => (m.destination = 0));
  const bytes = await renderMidi(module, p, 1),
    view = new DataView(bytes.buffer),
    counts = [];
  let offset = 14;
  while (offset < bytes.length) {
    const end = offset + 8 + view.getUint32(offset + 4);
    let pos = offset + 8,
      count = 0;
    const variable = () => {
      let value = 0,
        byte;
      do {
        byte = bytes[pos++];
        value = (value << 7) | (byte & 127);
      } while (byte & 128);
      return value;
    };
    while (pos < end) {
      variable();
      const status = bytes[pos++];
      if (status === 255) {
        pos++;
        const length = variable();
        pos += length;
      } else if (status === 240 || status === 247) {
        const length = variable();
        pos += length;
      } else {
        const length = [192, 208].includes(status & 240) ? 1 : 2;
        if ((status & 240) === 144 && bytes[pos + 1] > 0) count++;
        pos += length;
      }
    }
    counts.push(count);
    offset = end;
  }
  assert.deepEqual(counts.slice(1, 4), [16, 32, 64]);
});
test("Preset selective recall preserves live faders, switches and global settings", () => {
  const s = makeStore();
  s.patch.tempo = 137;
  s.patch.settings.pitchLoad = 0;
  s.patch.settings.switchLoad = 0;
  s.patch.tracks[0].steps[0].pitch = 91;
  s.patch.tracks[0].steps[0].pulses = 7;
  s.patch.aux[0].value = 2110;
  s.patch.aux[0].amount = -60;
  s.patch.userScales[99].root = 7;
  s.loadPreset(1);
  assert.equal(s.patch.tracks[0].steps[0].pitch, 91);
  assert.equal(s.patch.tracks[0].steps[0].pulses, 7);
  assert.equal(s.patch.tempo, 137);
  assert.equal(s.patch.aux[0].value, 2110);
  assert.equal(s.patch.aux[0].amount, -60);
  assert.equal(s.patch.userScales[99].root, 7);
});
test("Thru recall waits for the physical fader to cross its saved value", () => {
  const s = makeStore();
  s.patch.settings.pitchLoad = 1;
  s.patch.tracks[0].steps[0].pitch = 90;
  s.loadPreset(0);
  assert(s.pickup.has("pitch:0:0"));
  assert(!s.acceptPickup("pitch:0:0", 80));
  assert(s.acceptPickup("pitch:0:0", 0));
  assert(!s.pickup.has("pitch:0:0"));
});
test("Deleting a preset is recoverable; backup restores presets, chains and scales", () => {
  const s = makeStore();
  s.patch.totalPulses = 37;
  s.savePreset(63);
  s.clearPreset(63);
  assert.equal(s.session.presets[63], null);
  s.undo();
  assert(s.session.presets[63]);
  s.setChain([{ preset: 63, repeat: 64, mute: 5 }]);
  s.session.chains[7] = structuredClone(s.session.chain);
  s.patch.userScales[99].mask = 137;
  const backup = JSON.parse(JSON.stringify(s.backup())),
    other = makeStore();
  assert.equal(backup.format, "neuropolis-backup");
  other.import(backup);
  assert.deepEqual(other.session, s.session);
  const legacy = makeStore();
  legacy.import({ ...backup, format: "metropolix-16-backup" });
  assert.deepEqual(legacy.session, s.session);
});
test("Global cycle resets every track and MOD on the exact pulse boundary", async () => {
  const { store: s, runtime: r } = await instrument();
  s.patch.totalPulses = 21;
  s.patch.tracks = [16, 13, 9].map((length, i) => ({
    ...emptyTrack(i),
    length,
    division: i + 1,
    globalReset: i !== 1,
  }));
  s.patch.mods[0].division = 2;
  r.sync();
  const e = r.engine;
  for (let tick = 0; tick < 21 * 24; tick++) {
    e.engine_tick();
    assert.equal(e.engine_global_value(6), Number(tick === 0));
  }
  assert.equal(r.frame().cycleTicks, 21 * 24 - 1);
  assert(r.frame().tracks.every((t) => t.stage > 0));
  assert(r.frame().mods[0].stage > 0);
  e.engine_tick();
  assert.equal(e.engine_global_value(6), 1);
  assert.equal(r.frame().cycleTicks, 0);
  assert.deepEqual(
    r.frame().tracks.map((t) => t.stage),
    [0, 0, 0],
  );
  assert.equal(r.frame().mods[0].stage, 0);
  assert.equal(e.engine_ticks(), 21 * 24 + 1);
  for (let tick = 1; tick <= 21 * 24; tick++) e.engine_tick();
  assert.equal(e.engine_global_value(6), 1);
  assert.equal(r.frame().cycleTicks, 0);
});
test("Global reset can be disabled or changed live without changing stage lengths", async () => {
  const { store: s, runtime: r } = await instrument();
  s.patch.totalPulses = 0;
  r.sync();
  const e = r.engine;
  for (let tick = 0; tick <= 70 * 24; tick++) e.engine_tick();
  assert.equal(e.engine_global_value(6), 0);
  assert.equal(r.frame().cycleTicks, 70 * 24);
  assert.equal(e.engine_set_global(1, 7), 1);
  e.engine_tick();
  assert.equal(r.frame().cycleTicks, 0);
  assert.equal(e.engine_global_value(6), 1);
  assert.equal(e.engine_set_global(1, 0), 1);
  for (let tick = 1; tick <= 20 * 24; tick++) e.engine_tick();
  assert.equal(e.engine_global_value(6), 0);
  assert.equal(r.frame().cycleTicks, 20 * 24);
  assert.deepEqual(
    s.patch.tracks.map((t) => t.length),
    [16, 16],
  );
  r.reset();
  assert.equal(r.frame().cycleTicks, 0);
});
test("Queued recall waits for the configured boundary and can be cancelled", async () => {
  const { store: s, runtime: r } = await instrument();
  s.patch.settings.loadMode = 1;
  s.patch.settings.queuePulses = 4;
  r.playing = true;
  r.requestPreset(1);
  r.musicTick = 3 * 24;
  r.beforeTick(0);
  assert.equal(r.queued, 1);
  assert.notEqual(s.patch.name, "Phase memory");
  r.musicTick = 4 * 24;
  r.beforeTick(0);
  assert.equal(r.queued, null);
  assert.equal(s.patch.name, "Phase memory");
  r.requestPreset(0);
  r.requestPreset(0);
  assert.equal(r.queued, null);
  r.playing = false;
  s.flush();
});
test("Chain repeats, preset lengths and per-link mutes drive playback", async () => {
  const { store: s, runtime: r } = await instrument();
  s.session.presets[0].totalPulses = 4;
  s.session.presets[1].totalPulses = 8;
  s.session.chain = [
    { preset: 0, repeat: 2, mute: 2 },
    { preset: 1, repeat: 1, mute: 0 },
  ];
  r.enableChain(true);
  assert.equal(r.engine.engine_value(1, 108), 1);
  const pulses = (n) => {
    for (let i = 0; i < n; i++) {
      r.musicTick += 24;
      r.beforeTick(0);
    }
  };
  pulses(4);
  assert.equal(r.chainIndex, 0);
  assert.equal(r.chainRepeat, 1);
  pulses(4);
  assert.equal(r.chainIndex, 1);
  assert.equal(s.patch.name, "Phase memory");
  pulses(8);
  assert.equal(r.chainIndex, 0);
  r.enableChain(false);
  assert.equal(r.engine.engine_value(1, 108), 0);
});
test("MIDI clock, transport-independent program change and root channel affect the engine", async () => {
  const { store: s, runtime: r } = await instrument();
  r.audio = {
    context: { currentTime: 0 },
    on() {},
    off() {},
    pitch() {},
    patchBus() {},
    stop() {},
    update() {},
  };
  r.playing = true;
  for (let i = 0; i < 6; i++) await r.inputClock(true);
  assert.equal(r.engine.engine_ticks(), 24);
  s.patch.settings.midiRootChannel = 3;
  r.handleMidi([0x92, 65, 100]);
  assert.equal(s.patch.tracks[0].root, 5);
  s.patch.settings.midiPCChannel = 4;
  r.playing = false;
  r.handleMidi([0xc3, 1]);
  assert.equal(s.patch.name, "Phase memory");
});
test("MIDI export has complete tracks, PPQN, tempo and note events with valid chunk lengths", async () => {
  const bytes = await renderMidi(module, demoPatch(), 2),
    text = (a, b) => new TextDecoder().decode(bytes.slice(a, b)),
    data = new DataView(bytes.buffer);
  assert.equal(text(0, 4), "MThd");
  assert.equal(data.getUint16(12), 96);
  const count = data.getUint16(10);
  assert.equal(count, 12);
  let cursor = 14,
    notes = 0;
  for (let t = 0; t < count; t++) {
    assert.equal(text(cursor, cursor + 4), "MTrk");
    const size = data.getUint32(cursor + 4);
    const chunk = bytes.slice(cursor + 8, cursor + 8 + size);
    assert.deepEqual([...chunk.slice(-3)], [255, 47, 0]);
    notes += chunk.filter((b) => (b & 0xf0) === 0x90).length;
    cursor += 8 + size;
  }
  assert.equal(cursor, bytes.length);
  assert(notes > 8);
});

test("Legacy patches preserve notes outside the new fader range as explicit overrides", async () => {
  const old = {
    version: 1,
    name: "Legacy",
    tempo: 120,
    tracks: [0, 1].map(() => ({
      order: 0,
      length: 16,
      reverse: 0,
      division: 1,
      scale: 0,
      root: 0,
      transpose: 0,
      gateLength: 50,
      mute: 0,
      volume: 75,
      accumulatorMode: 0,
      accumulatorLimit: 12,
      steps: Array.from({ length: 16 }, () => ({
        pitch: 60,
        pulses: 1,
        gate: 2,
        ratchet: 1,
        probability: 100,
        slide: 0,
        skip: 0,
        accumulate: 0,
      })),
    })),
  };
  old.tracks[0].steps[0].pitch = 127;
  old.tracks[0].steps[1].pitch = 0;
  const p = migratePatch(old);
  assert(validatePatch(p));
  assert.equal(p.tracks[0].steps[0].pitchOverride, 127);
  assert.equal(p.tracks[0].steps[1].pitchOverride, 0);
  const e = (await WebAssembly.instantiate(module)).exports;
  syncEngine(e, p);
  assert.equal(e.engine_preview(0, 0, 0), 12700);
  assert.equal(e.engine_preview(0, 1, 0), 0);
});
test("Disabling a live MIDI channel releases its held note", async () => {
  const p = demoPatch(),
    e = (await WebAssembly.instantiate(module)).exports;
  syncEngine(e, p);
  const port = new MidiPort(),
    sent = [];
  port.send = (b) => sent.push(b);
  port.frame(e, p, e.engine_tick());
  assert(sent.some((b) => b[0] === 0x90));
  p.tracks[0].midiChannel = 0;
  sent.length = 0;
  port.frame(e, p, 0);
  assert(sent.some((b) => b[0] === 0x80));
  assert.equal(port.notes[0], null);
});
test("MIDI export includes musical tracks even when live MIDI outputs are off", async () => {
  const p = demoPatch();
  p.tracks.forEach((t) => (t.midiChannel = 0));
  const bytes = await renderMidi(module, p, 1);
  assert(bytes.includes(0x90));
  assert(bytes.includes(0x91));
});

test("A patch with 64 tracks round-trips through presets, backup and Undo", () => {
  const s = makeStore();
  s.patch.tracks = Array.from({ length: 64 }, (_, i) => emptyTrack(i));
  s.patch.tracks[63].steps[15].pitch = 111;
  s.patch.mods[7].target = routeTarget(63);
  assert(validatePatch(s.patch));
  s.savePreset(63);
  const other = makeStore();
  other.import(JSON.parse(JSON.stringify(s.backup())));
  assert.equal(other.patch.tracks.length, 64);
  assert.equal(other.patch.tracks[63].steps[15].pitch, 111);
  const count = other.patch.tracks.length;
  other.addTrack();
  assert.equal(other.patch.tracks.length, count + 1);
  other.undo();
  assert.equal(other.patch.tracks.length, count);
  other.redo();
  assert.equal(other.patch.tracks.length, count + 1);
  s.flush();
  other.flush();
});

test("Track removal remaps routes and monitor patches; existing presets remain independent", () => {
  const s = makeStore();
  s.patch.tracks = Array.from({ length: 12 }, (_, i) => emptyTrack(i));
  s.patch.mods[0].target = routeTarget(11);
  s.patch.controls[0].target = routeTarget(2);
  s.patch.outputs[0] = { kind: 4, source: 11, sink: sinkForTrack(11, 1) };
  s.patch.mx.mode = 5;
  s.patch.mx.source = 11;
  s.savePreset(63);
  assert(s.removeTrack(1));
  assert.equal(s.patch.mods[0].target, routeTarget(10));
  assert.equal(s.patch.controls[0].target, routeTarget(1));
  assert.equal(s.patch.outputs[0].source, 10);
  assert.equal(s.patch.outputs[0].sink, sinkForTrack(10, 1));
  assert.equal(s.patch.mx.source, 10);
  assert(validatePatch(s.patch));
  assert.equal(s.session.presets[63].tracks.length, 12);
  s.undo();
  assert.equal(s.patch.tracks.length, 12);
  s.flush();
});

test("Live runtime, MOD and chain mutes address high-index tracks without packed-bit aliasing", async () => {
  const { store: s, runtime: r } = await instrument();
  s.patch.tracks = Array.from({ length: 65 }, (_, i) => emptyTrack(i));
  s.patch.mods[0].destination = 17;
  s.patch.mods[0].target = routeTarget(64);
  s.patch.mods[0].steps.forEach((step) => (step.value = 1000));
  const heard = [];
  r.audio = {
    context: { currentTime: 0 },
    on(i) {
      heard.push(i);
    },
    off() {},
    pitch() {},
    patchBus() {},
    stop() {},
    update() {},
  };
  r.sync();
  r.advance(0);
  assert.equal(r.engine.engine_track_count(), 65);
  assert.equal(r.frame().tracks.length, 65);
  assert.deepEqual(
    heard,
    Array.from({ length: 65 }, (_, i) => i),
  );
  assert.equal(
    r.engine.engine_value(64, 0) - r.engine.engine_value(0, 0),
    1200,
  );
  s.savePreset(63);
  s.session.chain = [{ preset: 63, repeat: 1, mute: 4, mutedTracks: [64] }];
  r.enableChain(true);
  assert.equal(r.engine.engine_value(64, 108), 1);
  assert.equal(r.engine.engine_value(32, 108), 0);
  assert.equal(r.engine.engine_value(2, 108), 0);
  r.enableChain(false);
  s.flush();
});

test("Selective recall safely loads presets with fewer or more tracks", async () => {
  const { store: s, runtime: r } = await instrument();
  for (let i = 0; i < 10; i++) s.addTrack();
  s.patch.controls[0].target = routeTarget(11);
  s.patch.settings.ctrlLoad = 0;
  s.savePreset(63);
  assert(r.loadPreset(0));
  assert.equal(r.frame().tracks.length, 2);
  assert(validatePatch(s.patch));
  assert(r.loadPreset(63));
  assert.equal(r.frame().tracks.length, 12);
  assert(validatePatch(s.patch));
  s.flush();
});

test("MIDI export keeps separate streams beyond the sixteen MIDI channels", async () => {
  const p = demoPatch();
  p.tracks = Array.from({ length: 33 }, (_, i) => emptyTrack(i));
  p.tracks[0].cvCC = 44;
  p.tracks[32].cvCC = 44;
  const bytes = await renderMidi(module, p, 1),
    view = new DataView(bytes.buffer);
  assert.equal(view.getUint16(10), 43);
  let offset = 14,
    musical = 0;
  for (let i = 0; i < 43; i++) {
    assert.equal(
      new TextDecoder().decode(bytes.slice(offset, offset + 4)),
      "MTrk",
    );
    const size = view.getUint32(offset + 4),
      body = bytes.slice(offset + 8, offset + 8 + size);
    if (i >= 1 && i <= 33) {
      assert(body.some((byte) => (byte & 0xf0) === 0x90));
      if (i === 33)
        assert(
          body.some(
            (value, index) => (value & 0xf0) === 0xb0 && body[index + 1] === 44,
          ),
        );
      musical++;
    }
    offset += 8 + size;
  }
  assert.equal(musical, 33);
  assert.equal(offset, bytes.length);
});

test("Audio channel growth and removal have no fixed voice count", () => {
  const audio = new InstrumentAudio(),
    node = () => ({
      gain: { value: 0 },
      pan: { value: 0 },
      connect() {},
      disconnect() {},
    });
  audio.context = {
    currentTime: 0,
    createGain: node,
    createStereoPanner: node,
  };
  audio.master = node();
  const p = demoPatch();
  p.tracks = Array.from({ length: 40 }, (_, i) => emptyTrack(i));
  audio.ensureTracks(p);
  assert.equal(audio.channels.length, 40);
  const last = audio.channels[39];
  audio.removeTrack(0);
  p.tracks.shift();
  audio.ensureTracks(p);
  assert.equal(audio.channels[38], last);
  p.tracks.length = 1;
  audio.ensureTracks(p);
  assert.equal(audio.channels.length, 1);
});

test("Undoing the final chain link exits chain mode safely", async () => {
  const { store: s, runtime: r } = await instrument();
  s.setChain([{ preset: 0, repeat: 1, mute: 0 }]);
  r.enableChain(true);
  assert(s.undo());
  r.sync();
  assert.equal(r.chainEnabled, false);
  r.musicTick = 24;
  assert.doesNotThrow(() => r.beforeTick(0));
  s.flush();
});
