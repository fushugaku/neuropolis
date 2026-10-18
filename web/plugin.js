import {
  STORAGE,
  syncEngine,
  validateSession,
  migrateSession,
} from "./model.js";
import { Runtime } from "./runtime.js";
import { renderMidi } from "./midi.js";
import { canAutomate, pluginState, automationLabel } from "./automation.js";

// Present only inside the bundled Audio Unit/VST3 editor. Browser sessions keep
// their existing storage, clock, audio and MIDI implementations.
export function connectPlugin(
  scope = typeof window === "undefined" ? null : window,
) {
  if (!scope?.__NEUROPOLIS_PLUGIN__ || !scope.__JUCE__?.backend) return null;
  const backend = scope.__JUCE__.backend;
  let state = scope.__JUCE__.initialisationData.neuropolisSession[0];
  let timer = null,
    pending = null,
    resetPending = false,
    removedTracks = [];
  const bridge = {
    storage: {
      getItem(key) {
        return key === STORAGE ? state : null;
      },
      setItem(key, value) {
        if (key === STORAGE) state = value;
      },
    },
    publish(session, reset = false) {
      state = JSON.stringify(session);
      pending = state;
      resetPending ||= reset;
      clearTimeout(timer);
      timer = setTimeout(() => bridge.flush(), 12);
    },
    flush() {
      clearTimeout(timer);
      if (pending !== null)
        backend.emitEvent("neuropolisState", {
          session: pending,
          reset: resetPending,
          removedTracks,
        });
      pending = null;
      resetPending = false;
      removedTracks = [];
    },
    removedTrack(index) {
      removedTracks.push(index);
    },
    command(kind, index = 0, stage = 0, field = 0, value = 0) {
      bridge.flush();
      backend.emitEvent("neuropolisCommand", {
        kind,
        index,
        stage,
        field,
        value,
      });
    },
    gesture(path, phase, value = 0) {
      bridge.flush();
      backend.emitEvent("neuropolisGesture", { path, phase, value });
    },
    file(bytes, name, type) {
      const data =
        typeof bytes === "string"
          ? new TextEncoder().encode(bytes)
          : new Uint8Array(bytes);
      let binary = "";
      for (let i = 0; i < data.length; i += 8192)
        binary += String.fromCharCode(...data.subarray(i, i + 8192));
      backend.emitEvent("neuropolisFile", {
        name,
        type,
        data: scope.btoa(binary),
      });
    },
    listen(name, callback) {
      backend.addEventListener(name, callback);
    },
  };
  return bridge;
}
export class PluginRuntime extends Runtime {
  constructor(store, notify, changed, bridge) {
    super(store, notify, changed);
    this.hosted = true;
    this.bridge = bridge;
    this.restoring = false;
    this.automationLearn = -1;
    this.gestures = new Set();
    this.chainEnabled = pluginState(store.session).chainEnabled;
    this.audio.context = { currentTime: 0, state: "running" };
    for (const name of [
      "update",
      "stop",
      "on",
      "off",
      "pitch",
      "patchBus",
      "removeTrack",
      "ensureTracks",
    ])
      this.audio[name] = () => {};
    this.midi.panic = () => bridge.command(12);
    this.midi.off = () => {};
    this.midi.send = () => {};
    bridge.listen("neuropolisFrame", (frame) => {
      if (!frame?.tracks || frame.tracks.length !== this.patch.tracks.length)
        return;
      const changed =
        this.playing !== frame.playing ||
        this.chainEnabled !== !!frame.chainEnabled ||
        this.chainIndex !== (frame.chainIndex || 0) ||
        this.queued !== (frame.queued >= 0 ? frame.queued : null);
      this.playing = frame.playing;
      this.chainEnabled = !!frame.chainEnabled;
      pluginState(store.session).chainEnabled = this.chainEnabled;
      this.chainIndex = frame.chainIndex || 0;
      this.chainRepeat = frame.chainRepeat || 0;
      this.queued = frame.queued >= 0 ? frame.queued : null;
      const edits = frame.changes || [];
      for (const edit of edits) {
        if (!canAutomate(edit.path)) continue;
        const parts = edit.path.split("."),
          key = parts.pop();
        const parent = parts.reduce((o, k) => o?.[k], this.patch);
        if (parent && key in parent) parent[key] = edit.value;
      }
      if (edits.length) {
        this.localSync = true;
        syncEngine(this.engine, this.patch, false);
        this.localSync = false;
        this.valuesChanged?.(edits);
      }
      this.lastFrame = frame;
      if (changed) this.changed?.();
    });
    bridge.listen("neuropolisRestore", (json) => {
      const session = migrateSession(JSON.parse(json));
      if (!validateSession(session)) return;
      this.restoring = true;
      const previous = this.patch;
      store.pickup.clear();
      if (this.playing && session.currentPreset >= 0) {
        previous.tracks.forEach((t, i) =>
          t.steps.forEach((s, n) => {
            if (previous.settings.pitchLoad === 1 && session.patch.tracks[i])
              store.pickup.set(`pitch:${i}:${n}`, {
                physical: s.pitch,
                target: session.patch.tracks[i].steps[n].pitch,
              });
          }),
        );
        if (previous.settings.ctrlLoad === 2)
          previous.controls.forEach((c, i) =>
            store.pickup.set(`control:${i}`, {
              physical: c.value,
              target: session.patch.controls[i].value,
            }),
          );
      }
      store.session = session;
      this.chainEnabled = pluginState(session).chainEnabled;
      store.undoStack = [];
      store.redoStack = [];
      this.sync(false);
      this.restoring = false;
      this.changed?.();
    });
    store.onChange = () => {
      if (!this.restoring) bridge.publish(store.session);
    };
  }
  async init(module) {
    this.module = module;
    const local = (await WebAssembly.instantiate(module)).exports;
    const commands = {
      engine_set_loopy: (args) =>
        this.bridge.command(8, args[0], args[1], args[2], args[3]),
      engine_reset_track: (args) =>
        this.bridge.command(9, args[0], 0, 0, args[1]),
      engine_audition: (args) =>
        this.bridge.command(10, args[0], args[1], 0, args[2]),
      engine_tune: (args) => this.bridge.command(11, 0, 0, args[0], args[1]),
    };
    this.engine = Object.fromEntries(
      Object.entries(local).map(([name, fn]) => [
        name,
        (...args) => {
          const result = fn(...args);
          if (commands[name] && !this.localSync) commands[name](args);
          return result;
        },
      ]),
    );
    this.localSync = true;
    syncEngine(this.engine, this.patch, true);
    this.localSync = false;
    this.lastFrame = super.frame();
  }
  sync(reset = true) {
    if (!this.engine) return;
    this.localSync = true;
    syncEngine(this.engine, this.patch, reset);
    this.localSync = false;
    this.lastFrame = super.frame();
    if (!this.restoring) this.bridge.publish(this.store.session, reset);
  }
  removeTrack(index) {
    const state = pluginState(this.store.session);
    state.automation = state.automation.map((path) => {
      const match = path.match(/^tracks\.(\d+)\./);
      if (!match) return path;
      const n = +match[1];
      return n === index
        ? ""
        : n > index
          ? path.replace(/^tracks\.\d+\./, `tracks.${n - 1}.`)
          : path;
    });
    this.bridge.removedTrack(index);
    this.sync(false);
  }
  async ready() {
    return this.audio.context;
  }
  async toggle() {
    this.notify("Транспорт управляется DAW");
  }
  async start() {
    this.notify("Запусти воспроизведение в DAW");
  }
  stop() {}
  pump() {}
  pullFrame() {
    return this.lastFrame;
  }
  reset() {
    this.sync(true);
    this.notify("Reset");
    this.changed?.();
  }
  requestPreset(slot) {
    if (this.chainEnabled) return this.notify("Disable chain to load a preset");
    this.bridge.command(15, 0, 0, 0, slot);
  }
  enableChain(enabled) {
    if (enabled && !this.store.session.chain.length)
      return this.notify("Add a preset to the chain first");
    this.chainEnabled = enabled;
    pluginState(this.store.session).chainEnabled = enabled;
    this.bridge.publish(this.store.session);
    this.bridge.command(16, 0, 0, 0, Number(enabled));
    this.changed?.();
  }
  setSolo(track) {
    if (this.solo === track) return;
    this.solo = track;
    this.bridge.command(17, 0, 0, 0, track);
  }
  automationPhase(path, phase) {
    if (!canAutomate(path)) return;
    if (phase === "begin") this.gestures.add(path);
    if (phase === "end") this.gestures.delete(path);
    this.bridge.gesture(path, phase);
  }
  endGestures() {
    for (const path of this.gestures) this.bridge.gesture(path, "end");
    this.gestures.clear();
  }
  automate(path, value) {
    if (!canAutomate(path)) return;
    if (this.automationLearn >= 0) {
      pluginState(this.store.session).automation[this.automationLearn] = path;
      this.notify(
        `Automation ${String(this.automationLearn + 1).padStart(2, "0")} → ${automationLabel(path)}`,
      );
      this.automationLearn = -1;
      this.bridge.publish(this.store.session);
      this.learned?.();
    }
    this.bridge.gesture(path, "value", Number(value));
  }
  exportMidi(bars = 8) {
    const patch = structuredClone(this.patch);
    patch.tempo = this.lastFrame?.bpm || patch.tempo;
    patch.settings.clockSource = 2;
    return renderMidi(this.module, patch, bars);
  }
  dispose() {
    this.endGestures();
    this.bridge.flush();
  }
}
