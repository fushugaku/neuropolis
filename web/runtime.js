import {
  syncEngine,
  bankSlot,
  targetsTrack,
  swappedTrack,
  chainTrackMuted,
} from "./model.js";
import { InstrumentAudio } from "./audio.js";
import { MidiPort, renderMidi } from "./midi.js";
export class Runtime {
  constructor(store, notify, changed) {
    this.store = store;
    this.notify = notify;
    this.changed = changed;
    this.audio = new InstrumentAudio();
    this.midi = new MidiPort();
    this.playing = false;
    this.timer = null;
    this.nextTime = 0;
    this.hostTick = 0;
    this.musicTick = 0;
    this.pending = [];
    this.queued = null;
    this.chainEnabled = false;
    this.chainIndex = 0;
    this.chainRepeat = 0;
    this.chainElapsed = 0;
    this.loopHeld = new Map();
    this.externalRemainder = 0;
    this.externalHostTick = 0;
    this.externalAt = 0;
    this.tuner = false;
    this.tuneNote = 48;
    this.tuneClock = false;
    this.lastSwap = false;
    this.auditioning = this.patch.tracks.map(() => false);
    this.auditionTimers = this.patch.tracks.map(() => null);
    this.lastFrame = null;
  }
  get patch() {
    return this.store.patch;
  }
  async init(module) {
    this.module = module;
    this.engine = (await WebAssembly.instantiate(module)).exports;
    this.sync();
  }
  sync(reset = true, time) {
    if (!this.store.session.chain.length) this.chainEnabled = false;
    else this.chainIndex %= this.store.session.chain.length;
    if (reset && !this.patch.loopy.enabled) this.clearLoop();
    if (reset) {
      this.audio.stop(time);
      this.midi.notes.forEach((_, i) =>
        this.midi.off(
          i,
          this.audio.context
            ? this.midi.stamp(
                this.audio.context,
                time ?? this.audio.context.currentTime,
              )
            : undefined,
        ),
      );
      this.pending = [];
      this.musicTick = 0;
    }
    if (reset) {
      this.auditionTimers.forEach(clearTimeout);
      this.auditionTimers = this.patch.tracks.map(() => null);
      this.auditioning = this.patch.tracks.map(() => false);
    } else {
      this.auditioning.length = this.patch.tracks.length;
      this.auditionTimers.length = this.patch.tracks.length;
    }
    this.midi.notes.length = this.patch.tracks.length;
    syncEngine(this.engine, this.patch, reset);
    this.applyChainMutes();
    this.audio.update(this.patch);
    this.lastFrame = this.frame();
  }
  removeTrack(index) {
    const when = this.audio.context?.currentTime || 0;
    this.audio.stop(when);
    this.midi.panic();
    this.auditionTimers.forEach(clearTimeout);
    this.auditionTimers.splice(index, 1);
    this.auditioning.splice(index, 1);
    this.engine.engine_remove_track(index);
    this.audio.removeTrack(index);
    this.midi.notes.splice(index, 1);
    this.clearLoop();
    this.pending = [];
    this.sync(false);
    if (this.playing)
      this.patch.tracks.forEach((t, i) => {
        if (this.engine.engine_value(i, 3)) {
          this.audio.on(
            i,
            this.engine.engine_value(i, 0),
            this.engine.engine_value(i, 2),
            when + 0.005,
            this.patch,
          );
          this.midi.note(
            i,
            this.engine.engine_note(i),
            this.engine.engine_value(i, 2),
            t.midiChannel,
          );
        }
      });
  }
  applyChainMutes() {
    if (!this.chainEnabled) return;
    const link = this.store.session.chain[this.chainIndex];
    if (!link) return;
    this.patch.tracks.forEach((t, i) =>
      this.engine.engine_set_track(
        i,
        8,
        Number(t.mute || chainTrackMuted(link, i)),
      ),
    );
    this.patch.mods.forEach((m, i) =>
      this.engine.engine_set_mod(i, 9, m.mute || (link.mute >> 2) & 1),
    );
  }
  async ready() {
    const audio = await this.audio.init(this.patch);
    if (!this.timer) {
      this.nextTime = audio.currentTime + 0.035;
      this.timer = setInterval(() => this.pump(), 20);
    }
    return audio;
  }
  async toggle() {
    if (this.playing) {
      this.stop();
      return;
    }
    await this.start();
  }
  async start(fromMidi = false) {
    await this.ready();
    if (this.tuner) await this.tune(false);
    if (this.patch.settings.runMode === 1) {
      this.sync();
      if (this.chainEnabled) {
        this.chainIndex = 0;
        this.chainRepeat = 0;
        this.loadLink();
      }
    }
    this.playing = true;
    this.nextTime = this.audio.context.currentTime + 0.035;
    if (this.musicTick > 0 && this.patch.settings.runMode === 0) {
      for (let i = 0; i < this.patch.tracks.length; i++)
        if (this.engine.engine_value(i, 3)) {
          this.audio.on(
            i,
            this.engine.engine_value(i, 0),
            this.engine.engine_value(i, 2),
            this.nextTime,
            this.patch,
          );
          this.midi.note(
            i,
            this.engine.engine_note(i),
            this.engine.engine_value(i, 2),
            this.patch.tracks[i].midiChannel,
            this.midi.stamp(this.audio.context, this.nextTime),
          );
        }
    }
    if (!fromMidi && this.patch.settings.midiTransport)
      this.midi.send([this.musicTick === 0 ? 0xfa : 0xfb]);
    this.notify(
      this.patch.settings.clockSource ? "Waiting for clock" : "Playing",
    );
    this.changed?.();
    this.pump();
  }
  stop(fromMidi = false) {
    this.playing = false;
    this.tuner = false;
    this.engine.engine_tune(-1, 0);
    this.audio.stop();
    this.midi.panic();
    this.patch.tracks.forEach((_, i) => {
      clearTimeout(this.auditionTimers[i]);
      this.engine.engine_audition(i, 0, 0);
    });
    this.auditioning = this.patch.tracks.map(() => false);
    this.pending = [];
    if (!fromMidi && this.patch.settings.midiTransport) this.midi.send([0xfc]);
    if (this.patch.settings.runMode === 1) {
      this.sync();
      this.chainIndex = 0;
      this.chainRepeat = 0;
      this.chainElapsed = 0;
    }
    if (this.queued !== null) {
      const slot = this.queued;
      this.queued = null;
      this.loadPreset(slot);
    }
    this.notify(this.patch.settings.runMode ? "Stopped" : "Paused");
    this.changed?.();
  }
  reset(fromMidi = false) {
    if (this.queued !== null) {
      const slot = this.queued;
      this.queued = null;
      this.loadPreset(slot);
    }
    for (let i = 0; i < this.patch.tracks.length; i++)
      if (this.patch.tracks[i].globalReset) {
        this.audio.off(i, this.audio.context?.currentTime || 0);
        this.midi.off(i);
      }
    this.engine.engine_reset();
    this.pending = [];
    this.musicTick = 0;
    this.lastFrame = this.frame();
    this.chainElapsed = 0;
    this.nextTime = (this.audio.context?.currentTime || 0) + 0.025;
    if (!fromMidi && this.patch.settings.midiTransport)
      this.midi.send([0xf2, 0, 0]);
    this.notify("Reset");
    this.changed?.();
  }
  pump() {
    const audio = this.audio.context;
    if (!audio) return;
    if (this.nextTime < audio.currentTime - 0.08)
      this.nextTime = audio.currentTime + 0.01;
    let guard = 0;
    while (this.nextTime < audio.currentTime + 0.045 && guard++ < 512) {
      const p = this.patch;
      if (p.settings.clockSource === 0 && this.playing && !this.tuner)
        this.advance(this.nextTime);
      if (this.tuner) {
        this.engine.engine_tune(
          this.tuneNote,
          Number(!this.tuneClock || this.hostTick % 24 < 12),
        );
        if (this.tuneClock && this.hostTick % 24 === 0) {
          for (let i = 0; i < this.patch.tracks.length; i++) {
            this.audio.on(i, this.tuneNote * 100, 90, this.nextTime, p);
            this.audio.off(i, this.nextTime + 60 / p.tempo / 8);
            this.midi.note(
              i,
              this.tuneNote,
              90,
              p.tracks[i].midiChannel,
              this.midi.stamp(audio, this.nextTime),
            );
            this.midi.off(
              i,
              this.midi.stamp(audio, this.nextTime + 60 / p.tempo / 8),
            );
          }
        }
      }
      if (!this.playing && this.hostTick % 4 === 0)
        this.pending.push({ time: this.nextTime, frame: this.pausedFrame() });
      if (
        p.settings.clockSource === 0 &&
        p.settings.midiClock &&
        this.hostTick % 4 === 0
      )
        this.midi.send([0xf8], this.midi.stamp(audio, this.nextTime));
      const tempo = this.playing
        ? this.engine.engine_global_value(0) / 1000
        : p.tempo;
      this.nextTime += 60 / Math.max(0.1, tempo) / 96;
      this.hostTick++;
      if (this.pending.length > 512)
        this.pending.splice(0, this.pending.length - 512);
    }
  }
  beforeTick(time) {
    if (this.musicTick > 0 && this.musicTick % 24 === 0) {
      if (this.queued !== null) {
        const p = this.patch,
          quant =
            p.settings.loadMode === 2 && p.totalPulses
              ? p.totalPulses
              : p.tracks[0].pulseLength || p.settings.queuePulses;
        if (quant && (this.musicTick / 24) % quant === 0) {
          const slot = this.queued;
          this.queued = null;
          this.loadPreset(slot, time);
        }
      }
      if (this.chainEnabled) {
        this.chainElapsed++;
        const length =
          this.patch.totalPulses || this.patch.settings.queuePulses || 64;
        if (this.chainElapsed >= length) {
          this.chainElapsed = 0;
          this.chainRepeat++;
          const link = this.store.session.chain[this.chainIndex];
          if (this.chainRepeat >= link.repeat) {
            this.chainRepeat = 0;
            this.chainIndex =
              (this.chainIndex + 1) % this.store.session.chain.length;
          }
          this.loadLink(time);
        }
      }
    }
  }
  advance(time) {
    this.beforeTick(time);
    this.engine.engine_tick();
    const e = this.engine,
      p = this.patch,
      audio = this.audio.context,
      swapped = !!e.engine_global_value(5),
      bpm = e.engine_global_value(0) / 1000,
      swapChanged = swapped !== this.lastSwap;
    const events = p.tracks.map((_, i) => e.engine_track_events(i));
    if (swapChanged) {
      this.audio.stop(time);
      this.midi.panic(this.midi.stamp(audio, time));
      p.tracks.forEach((_, i) => {
        if (e.engine_value(i, 3)) events[i] |= 1;
      });
      this.lastSwap = swapped;
    }
    for (let source = 0; source < p.tracks.length; source++) {
      const track = swappedTrack(source, swapped, p.tracks.length),
        flags = events[source],
        when = time + p.settings.cvDelay / 1000;
      if (flags & 2) this.audio.off(track, when);
      if (flags & 1)
        this.audio.on(
          track,
          e.engine_value(source, 0),
          e.engine_value(source, 2),
          when,
          p,
          !!e.engine_slide(source),
          e.engine_value(source, 5),
          e.engine_value(source, 6),
          bpm,
        );
      else if (flags & 0x100)
        this.audio.pitch(
          track,
          e.engine_value(source, 0),
          when,
          !!e.engine_slide(source),
          e.engine_value(source, 5),
          e.engine_value(source, 6),
          bpm,
        );
    }
    p.outputs.forEach((o, i) =>
      this.audio.patchBus(
        o.sink,
        e.engine_global_value(i + 1),
        time + p.settings.cvDelay / 1000,
      ),
    );
    this.midi.frame(e, p, events, this.midi.stamp(audio, time));
    if (this.musicTick % 4 === 0)
      this.pending.push({ time, frame: this.frame() });
    this.musicTick++;
  }
  frame() {
    const e = this.engine;
    if (!e) return null;
    return {
      ticks: e.engine_ticks(),
      cycleTicks: e.engine_global_value(7),
      bpm: e.engine_global_value(0) / 1000,
      tracks: this.patch.tracks.map((_, i) => ({
        stage: e.engine_stage(i),
        note: e.engine_note(i),
        cents: e.engine_value(i, 0),
        cv: e.engine_value(i, 1),
        velocity: e.engine_value(i, 2),
        gate: !!e.engine_value(i, 3),
        accumulator: e.engine_value(i, 4),
        loopy: !!e.engine_value(i, 8),
      })),
      mods: Array.from({ length: 8 }, (_, i) => ({
        stage: e.engine_mod_value(i, 1),
        value: e.engine_mod_value(i, 0),
      })),
      outputs: [e.engine_global_value(1), e.engine_global_value(2)],
      mx: e.engine_global_value(3),
      clock: e.engine_global_value(4),
      chainIndex: this.chainIndex,
      chainRepeat: this.chainRepeat,
    };
  }
  pausedFrame() {
    const frame = this.frame();
    if (!frame) return frame;
    const p = this.patch,
      pulse = Math.floor(this.hostTick / 24),
      high = this.hostTick % 24 < 12;
    frame.clock =
      p.settings.clockMode === 0 &&
      (pulse + p.settings.outputDivision - p.settings.outputOffset) %
        p.settings.outputDivision ===
        0 &&
      high;
    let mx = 0;
    if (p.settings.clockMode === 0) {
      for (let i = 0; i < 8; i++) {
        let on = false;
        if (p.mx.mode <= 2 && i >= 2) {
          if (p.mx.mode === 2) {
            const periods = [24, 24, 6, 12, 24, 48, 96, 192];
            on = this.hostTick % periods[i] < periods[i] / 2;
          } else {
            const div =
              p.mx.mode === 0
                ? [1, 1, 1, 2, 4, 4, 8, 16][i]
                : [1, 1, 1, 3, 4, 5, 8, 16][i];
            on =
              high &&
              (pulse + (p.mx.mode === 0 && i === 5 ? 2 : 0)) % div === 0;
          }
        }
        if (p.mx.mode === 4) {
          const period = 24 * p.mods[i].division;
          on = this.hostTick % period < period / 2;
        }
        if (on) mx |= 1 << i;
      }
    }
    if (p.mx.mode === 5 && this.auditioning.some(Boolean))
      mx = this.engine.engine_global_value(3);
    frame.mx = mx;
    p.outputs.forEach((o, i) => {
      if (o.kind === 12) frame.outputs[i] = 0;
      if (o.kind === 17) frame.outputs[i] = frame.clock ? 5000 : 0;
      if ([5, 6, 9, 10].includes(o.kind)) frame.outputs[i] = 0;
    });
    return frame;
  }
  pullFrame() {
    let view;
    while (
      this.pending.length &&
      this.pending[0].time <= this.audio.context.currentTime
    )
      view = this.pending.shift().frame;
    if (view) this.lastFrame = view;
    return view;
  }
  loadPreset(slot, time) {
    if (this.store.loadPreset(slot)) {
      this.sync(true, time);
      this.notify(`Loaded ${bankSlot(slot)} · ${this.patch.name}`);
      this.changed?.();
      return true;
    }
    return false;
  }
  requestPreset(slot) {
    if (this.chainEnabled) {
      this.notify("Disable chain to load a preset");
      return;
    }
    if (!this.store.session.presets[slot]) {
      this.queued = null;
      this.changed?.();
      return;
    }
    if (this.queued === slot) {
      this.queued = null;
      this.changed?.();
      return;
    }
    if (this.playing && this.patch.settings.loadMode) {
      this.queued = slot;
      this.notify(`${bankSlot(slot)} queued`);
      this.changed?.();
    } else this.loadPreset(slot);
  }
  enableChain(enabled) {
    if (enabled && !this.store.session.chain.length) {
      this.notify("Add a preset to the chain first");
      return;
    }
    this.chainEnabled = enabled;
    this.chainIndex = 0;
    this.chainRepeat = 0;
    this.chainElapsed = 0;
    if (enabled) this.loadLink();
    else this.sync(false);
    this.changed?.();
  }
  loadLink(time) {
    const link = this.store.session.chain[this.chainIndex];
    if (!link) return;
    this.store.loadPreset(link.preset);
    this.sync(true, time);
    this.applyChainMutes();
    this.changed?.();
  }
  loopPress(track, stage) {
    if (!this.loopHeld.has(track)) this.loopHeld.set(track, new Set());
    this.loopHeld.get(track).add(stage);
    this.updateLoop(track);
  }
  loopRelease(track, stage) {
    this.loopHeld.get(track)?.delete(stage);
    if (!this.patch.loopy.latch) this.updateLoop(track);
  }
  updateLoop(track) {
    const p = this.patch,
      held = [
        ...new Set(
          p.loopy.target === 2
            ? [...this.loopHeld.values()].flatMap((s) => [...s])
            : [...(this.loopHeld.get(track) || [])],
        ),
      ].sort((a, b) => a - b);
    for (let i = 0; i < this.patch.tracks.length; i++)
      if (p.loopy.target === 2 || targetsTrack(p.loopy.target, i)) {
        if (held.length)
          this.engine.engine_set_loopy(i, held[0], held.at(-1), p.loopy.pulses);
        else this.engine.engine_set_loopy(i, -1, 0, 0);
      }
  }
  clearLoop() {
    this.loopHeld.clear();
    this.patch.tracks.forEach((_, i) =>
      this.engine.engine_set_loopy(i, -1, 0, 0),
    );
  }
  async audition(track, stage, held = false) {
    await this.ready();
    clearTimeout(this.auditionTimers[track]);
    this.engine.engine_audition(track, stage, 1);
    this.auditioning[track] = true;
    this.lastFrame = this.frame();
    const e = this.engine,
      when = this.audio.context.currentTime + 0.005,
      p = this.patch;
    this.audio.on(
      track,
      e.engine_preview(track, stage, 0),
      e.engine_preview(track, stage, 2),
      when,
      p,
      !!e.engine_preview(track, stage, 3),
      p.tracks[track].slideAmount,
      0,
      p.tempo,
    );
    this.midi.note(
      track,
      e.engine_preview(track, stage, 0) / 100,
      e.engine_preview(track, stage, 2),
      p.tracks[track].midiChannel,
      this.midi.stamp(this.audio.context, when),
    );
    if (!held) {
      this.audio.off(track, when + 0.22);
      this.midi.off(track, this.midi.stamp(this.audio.context, when + 0.22));
      this.auditionTimers[track] = setTimeout(
        () => this.releaseAudition(track),
        250,
      );
    }
  }
  releaseAudition(track) {
    clearTimeout(this.auditionTimers[track]);
    this.engine.engine_audition(track, 0, 0);
    this.auditioning[track] = false;
    this.audio.off(track, this.audio.context?.currentTime || 0);
    this.midi.off(track);
    this.lastFrame = this.frame();
  }
  async inputClock(isMidi = false) {
    if (!this.audio.context) return;
    const now = performance.now();
    if (this.externalAt) {
      const delta = now - this.externalAt;
      if (delta > 1 && delta < 10000) {
        const bpm =
          60000 /
          (delta * 4 * (isMidi ? 6 : this.patch.settings.externalDivision));
        if (bpm >= 0.1 && bpm <= 400)
          this.engine.engine_set_global(0, Math.round(bpm * 1000));
      }
    }
    this.externalAt = now;
    this.externalRemainder += isMidi
      ? 4
      : 24 / this.patch.settings.externalDivision;
    let when = this.audio.context.currentTime + 0.008;
    while (this.externalRemainder >= 1) {
      if (this.playing && !this.tuner) this.advance(when);
      if (this.patch.settings.midiClock && this.externalHostTick % 4 === 0)
        this.midi.send([0xf8], this.midi.stamp(this.audio.context, when));
      when += 60 / (this.engine.engine_global_value(0) / 1000) / 96;
      this.externalRemainder--;
      this.externalHostTick++;
    }
    if (this.pending.length > 512)
      this.pending.splice(0, this.pending.length - 512);
  }
  async connectMidi() {
    await this.ready();
    const ports = await this.midi.connect(
      (data) => this.handleMidi(data),
      () => this.changed?.(),
    );
    this.notify(
      ports.inputs.length || ports.outputs.length
        ? "Choose MIDI ports"
        : "No MIDI devices found",
    );
    this.changed?.();
  }
  handleMidi(data) {
    const status = data[0],
      p = this.patch;
    if (status === 0xf8 && p.settings.clockSource === 2) {
      this.inputClock(true);
      return;
    }
    if (p.settings.midiTransport && p.settings.clockSource === 2) {
      if (status === 0xfa) {
        this.reset(true);
        this.start(true);
      }
      if (status === 0xfb) this.start(true);
      if (status === 0xfc) this.stop(true);
      if (status === 0xf2 && data[1] === 0 && data[2] === 0) this.reset(true);
    }
    const channel = (status & 15) + 1;
    if (
      (status & 0xf0) === 0x90 &&
      data[2] > 0 &&
      channel === p.settings.midiRootChannel
    ) {
      p.tracks.forEach((t, i) => {
        if (t.scale < 49) {
          t.root = data[1] % 12;
          this.engine.engine_set_track(i, 5, t.root);
        }
      });
      this.store.changed();
      this.changed?.();
    }
    if (
      (status & 0xf0) === 0xc0 &&
      channel === p.settings.midiPCChannel &&
      data[1] < 64
    )
      this.requestPreset(data[1]);
  }
  async tune(enabled, note = 60, clocked = false) {
    await this.ready();
    this.audio.stop();
    this.midi.panic();
    this.tuner = enabled;
    this.tuneNote = note;
    this.tuneClock = clocked;
    this.engine.engine_tune(enabled ? note : -1, 1);
    this.auditioning = this.patch.tracks.map(() => enabled);
    this.lastFrame = this.frame();
    if (enabled) {
      this.playing = false;
      const when = this.audio.context.currentTime + 0.01;
      this.patch.tracks.forEach((_, i) => {
        this.audio.on(i, note * 100, 90, when, this.patch);
        this.midi.note(
          i,
          note,
          90,
          this.patch.tracks[i].midiChannel,
          this.midi.stamp(this.audio.context, when),
        );
        if (clocked) this.audio.off(i, when + 60 / this.patch.tempo / 8);
      });
    }
    this.changed?.();
  }
  async exportMidi(bars = 8) {
    return renderMidi(this.module, this.patch, bars);
  }
  dispose() {
    clearInterval(this.timer);
    this.audio.stop();
    this.midi.panic();
    this.store.flush();
  }
}
