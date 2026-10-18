import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { connectPlugin, PluginRuntime } from "../plugin.js";
import { freshSession, STORAGE } from "../model.js";
import { InstrumentStore } from "../store.js";
const module = await WebAssembly.compile(
  await readFile(new URL("../dist/engine.wasm", import.meta.url)),
);
function bridgeFor(session = freshSession()) {
  const events = [],
    listeners = new Map();
  const bridge = connectPlugin({
    __NEUROPOLIS_PLUGIN__: true,
    __JUCE__: {
      initialisationData: { neuropolisSession: [JSON.stringify(session)] },
      backend: {
        emitEvent: (name, data) => events.push({ name, data }),
        addEventListener: (name, callback) => listeners.set(name, callback),
      },
    },
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
  });
  return { bridge, events, listeners };
}
test("Plugin state is instance-local and coalesced edits retain a requested reset", () => {
  assert.equal(connectPlugin(null), null);
  const a = bridgeFor(),
    b = bridgeFor();
  const first = new InstrumentStore(a.bridge.storage),
    second = new InstrumentStore(b.bridge.storage);
  a.bridge.publish(first.session, true);
  first.patch.totalPulses = 21;
  a.bridge.publish(first.session, false);
  a.bridge.flush();
  assert.equal(second.patch.totalPulses, 64);
  assert.equal(a.events.length, 1);
  assert.equal(a.events[0].data.reset, true);
  assert.equal(JSON.parse(a.events[0].data.session).patch.totalPulses, 21);
  assert.equal(
    JSON.parse(b.bridge.storage.getItem(STORAGE)).patch.totalPulses,
    64,
  );
});
test("Native frames drive the plugin editor without advancing a browser clock", async () => {
  const { bridge, listeners, events } = bridgeFor(),
    store = new InstrumentStore(bridge.storage);
  const runtime = new PluginRuntime(
    store,
    () => {},
    () => {},
    bridge,
  );
  await runtime.init(module);
  const ticks = runtime.engine.engine_ticks();
  const frame = {
    ...runtime.frame(),
    cycleTicks: 120,
    bpm: 143,
    playing: true,
  };
  listeners.get("neuropolisFrame")(frame);
  assert.equal(runtime.pullFrame().bpm, 143);
  assert.equal(runtime.playing, true);
  assert.equal(runtime.engine.engine_ticks(), ticks);
  assert.equal(runtime.timer, null);
  const midi = await runtime.exportMidi(1);
  const marker = midi.findIndex(
    (v, i) => v === 255 && midi[i + 1] === 81 && midi[i + 2] === 3,
  );
  assert(marker >= 0);
  assert.equal(
    (midi[marker + 3] << 16) | (midi[marker + 4] << 8) | midi[marker + 5],
    Math.round(60000000 / 143),
  );
  store.patch.totalPulses = 37;
  store.changed();
  bridge.flush();
  assert.equal(JSON.parse(events.at(-1).data.session).patch.totalPulses, 37);
  const restored = freshSession();
  restored.patch.totalPulses = 9;
  listeners.get("neuropolisRestore")(JSON.stringify(restored));
  assert.equal(store.patch.totalPulses, 9);
  assert.equal(events.length, 1);
  runtime.dispose();
  store.flush();
});
test("Plugin file bridge preserves MIDI bytes for native save", () => {
  const { bridge, events } = bridgeFor();
  const bytes = Uint8Array.from([77, 84, 104, 100, 0, 128, 255]);
  bridge.file(bytes, "neuropolis.mid", "audio/midi");
  assert.deepEqual(
    Buffer.from(events[0].data.data, "base64"),
    Buffer.from(bytes),
  );
});
test("Plugin queues and chains are native commands, independent of editor timers", async () => {
  const { bridge, events } = bridgeFor(),
    store = new InstrumentStore(bridge.storage);
  const runtime = new PluginRuntime(
    store,
    () => {},
    () => {},
    bridge,
  );
  await runtime.init(module);
  runtime.playing = true;
  store.patch.settings.loadMode = 2;
  runtime.requestPreset(1);
  assert.deepEqual(events.at(-1), {
    name: "neuropolisCommand",
    data: { kind: 15, index: 0, stage: 0, field: 0, value: 1 },
  });
  assert.equal(store.session.currentPreset, 0);
  store.session.chain = [
    { preset: 0, repeat: 2, mute: 0 },
    { preset: 1, repeat: 1, mute: 2 },
  ];
  runtime.enableChain(true);
  assert.equal(runtime.chainEnabled, true);
  assert.equal(events.at(-1).data.kind, 16);
  assert.equal(
    JSON.parse(events.at(-2).data.session).plugin.chainEnabled,
    true,
  );
  assert.equal(runtime.timer, null);
  runtime.dispose();
});
test("Automation learn addresses any track and emits host gestures with stable slots", async () => {
  const { bridge, events } = bridgeFor(),
    store = new InstrumentStore(bridge.storage);
  const runtime = new PluginRuntime(
    store,
    () => {},
    () => {},
    bridge,
  );
  await runtime.init(module);
  runtime.automationLearn = 31;
  runtime.automate("tracks.79.steps.15.pitch", 99);
  assert.equal(store.session.plugin.automation[31], "tracks.79.steps.15.pitch");
  assert.equal(runtime.automationLearn, -1);
  assert.deepEqual(events.at(-1), {
    name: "neuropolisGesture",
    data: { path: "tracks.79.steps.15.pitch", phase: "value", value: 99 },
  });
  runtime.automationPhase("tracks.79.steps.15.pitch", "begin");
  runtime.endGestures();
  assert.equal(events.at(-1).data.phase, "end");
  const count = events.length;
  runtime.automate("name", "Untitled");
  assert.equal(events.length, count);
  runtime.dispose();
});
test("DAW automation updates editor values without echoing state to the host", async () => {
  const { bridge, events, listeners } = bridgeFor(),
    store = new InstrumentStore(bridge.storage);
  const runtime = new PluginRuntime(
    store,
    () => {},
    () => {},
    bridge,
  );
  await runtime.init(module);
  const before = events.length,
    beforePitch = runtime.engine.engine_preview(0, 0, 0);
  listeners.get("neuropolisFrame")({
    ...runtime.frame(),
    playing: true,
    chainEnabled: false,
    queued: 1,
    changes: [
      { path: "totalPulses", value: 23 },
      { path: "tracks.0.steps.0.pitch", value: 112 },
    ],
  });
  assert.equal(store.patch.totalPulses, 23);
  assert.equal(store.patch.tracks[0].steps[0].pitch, 112);
  assert.notEqual(runtime.engine.engine_preview(0, 0, 0), beforePitch);
  assert.equal(runtime.queued, 1);
  assert.equal(events.length, before);
  runtime.dispose();
});
test("Track deletion carries playback remapping and follows surviving automation targets", async () => {
  const { bridge, events } = bridgeFor(),
    store = new InstrumentStore(bridge.storage);
  const runtime = new PluginRuntime(
    store,
    () => {},
    () => {},
    bridge,
  );
  await runtime.init(module);
  store.addTrack();
  runtime.sync(false);
  bridge.flush();
  store.session.plugin.automation[0] = "tracks.1.length";
  store.session.plugin.automation[1] = "tracks.2.swing";
  store.removeTrack(1);
  runtime.removeTrack(1);
  bridge.flush();
  const event = events.at(-1);
  assert.deepEqual(event.data.removedTracks, [1]);
  const session = JSON.parse(event.data.session);
  assert.equal(session.plugin.automation[0], "");
  assert.equal(session.plugin.automation[1], "tracks.1.swing");
  runtime.dispose();
  store.flush();
});
