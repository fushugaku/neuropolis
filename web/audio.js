import { clamp, sinkBinding, sinkForTrack } from "./model.js";
export class InstrumentAudio {
  constructor() {
    this.context = null;
    this.channels = [];
    this.pans = [];
    this.voices = [];
    this.active = new Set();
    this.last = [];
    this.tuner = false;
    this.levels = [];
    this.busLevels = [];
  }
  async init(patch) {
    if (!this.context) {
      this.context = new (window.AudioContext || window.webkitAudioContext)({
        latencyHint: "interactive",
      });
      const limiter = this.context.createDynamicsCompressor();
      this.master = limiter;
      limiter.threshold.value = -10;
      limiter.knee.value = 8;
      limiter.ratio.value = 8;
      limiter.attack.value = 0.003;
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      limiter.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    this.ensureTracks(patch);
    await this.context.resume();
    this.update(patch);
    return this.context;
  }
  ensureTracks(patch) {
    if (!this.context) return;
    while (this.channels.length > patch.tracks.length) {
      const i = this.channels.length - 1;
      this.off(i, this.context.currentTime);
      this.channels.pop().disconnect();
      this.pans.pop().disconnect();
    }
    while (this.channels.length < patch.tracks.length) {
      const i = this.channels.length,
        level = this.context.createGain(),
        pan = this.context.createStereoPanner();
      level.gain.value = (patch.tracks[i].volume / 100) * 0.2;
      pan.pan.value = i % 2 ? 0.18 : -0.18;
      level.connect(pan);
      pan.connect(this.master);
      this.channels.push(level);
      this.pans.push(pan);
      this.voices[i] = null;
      this.last[i] = 0;
      this.busLevels[i] = 1;
    }
    for (const entries of [this.voices, this.last, this.levels, this.busLevels])
      entries.length = patch.tracks.length;
  }
  removeTrack(index) {
    this.channels[index]?.disconnect();
    this.pans[index]?.disconnect();
    for (const entries of [
      this.channels,
      this.pans,
      this.voices,
      this.last,
      this.levels,
      this.busLevels,
    ])
      entries.splice(index, 1);
  }
  update(patch, change = null) {
    if (!this.context) return;
    this.ensureTracks(patch);
    const now = this.context.currentTime;
    this.channels.forEach((c, i) => {
      this.levels[i] = patch.tracks[i].volume / 100;
      if (!patch.outputs.some((o) => o.sink === sinkForTrack(i, 1)))
        this.busLevels[i] = 1;
      c.gain.setTargetAtTime(
        this.levels[i] * this.busLevels[i] * 0.2,
        now,
        0.01,
      );
      const voice = this.voices[i];
      if (!voice || voice.released) return;
      const params = patch.tracks[i].voice;
      if (!patch.outputs.some((o) => o.sink === sinkForTrack(i, 0)))
        voice.filter.detune.setTargetAtTime(0, now, 0.01);
      if (!patch.outputs.some((o) => o.sink === sinkForTrack(i, 2)))
        voice.filter.Q.setTargetAtTime(params.resonance, now, 0.01);
      if (change?.track === i) {
        if (change.field === "wave")
          voice.oscs[0].type = ["sawtooth", "triangle", "square", "sine"][
            params.wave
          ];
        if (change.field === "cutoff") {
          voice.filter.frequency.cancelScheduledValues(now);
          voice.filter.frequency.setTargetAtTime(params.cutoff, now, 0.01);
        }
        if (change.field === "sustain")
          voice.env.gain.setTargetAtTime(params.sustain / 100, now, 0.02);
        if (change.field === "release") voice.release = params.release;
      }
    });
  }
  release(voice, time) {
    if (!voice || voice.released) return;
    voice.released = true;
    voice.env.gain.cancelScheduledValues(time);
    voice.env.gain.setTargetAtTime(0.00001, time, voice.release / 1000 / 4);
    voice.oscs.forEach((o) => {
      try {
        o.stop(time + voice.release / 1000 + 0.05);
      } catch {}
    });
  }
  off(track, time) {
    this.release(this.voices[track], time);
  }
  stop(time = this.context?.currentTime || 0) {
    for (const voice of this.active) this.release(voice, time);
  }
  glideTime(track, cents, slide, amount, type, bpm) {
    if (!slide || amount === 0 || !this.last[track]) return 0;
    const x = amount / 100;
    if (type === 1) return (60 / bpm / 4) * x * 2;
    if (type === 2) return 0.003 + x * x * 0.5;
    return (
      0.003 +
      x * x * 0.6 * Math.max(Math.abs(cents - this.last[track]) / 1200, 0.08)
    );
  }
  pitch(track, cents, time, slide = false, amount = 0, type = 0, bpm = 120) {
    const voice = this.voices[track];
    if (!voice || voice.released) return;
    const duration = this.glideTime(track, cents, slide, amount, type, bpm),
      hz = 440 * 2 ** ((cents / 100 - 69) / 12);
    voice.oscs.forEach((o, i) => {
      o.frequency.cancelScheduledValues(time);
      if (duration) {
        o.frequency.setValueAtTime(
          440 * 2 ** ((this.last[track] / 100 - 69) / 12) * (i === 1 ? 0.5 : 1),
          time,
        );
        o.frequency.exponentialRampToValueAtTime(
          hz * (i === 1 ? 0.5 : 1),
          time + duration,
        );
      } else o.frequency.setValueAtTime(hz * (i === 1 ? 0.5 : 1), time);
    });
    this.last[track] = cents;
  }
  on(
    track,
    cents,
    velocity,
    time,
    patch,
    slide = false,
    amount = 0,
    type = 0,
    bpm = 120,
  ) {
    this.off(track, time);
    const ctx = this.context,
      v = patch.tracks[track].voice;
    const env = ctx.createGain(),
      filter = ctx.createBiquadFilter(),
      mix = ctx.createGain();
    mix.gain.value = 0.5;
    filter.type = "lowpass";
    filter.Q.value = v.resonance;
    filter.frequency.setValueAtTime(v.cutoff, time);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(80, v.cutoff * 0.24),
      time + v.decay / 1000,
    );
    const oscs = [ctx.createOscillator(), ctx.createOscillator()];
    oscs[0].type = ["sawtooth", "triangle", "square", "sine"][v.wave];
    oscs[1].type = "sine";
    const glide = this.glideTime(track, cents, slide, amount, type, bpm),
      hz = 440 * 2 ** ((cents / 100 - 69) / 12),
      from = 440 * 2 ** ((this.last[track] / 100 - 69) / 12);
    oscs.forEach((o, i) => {
      const factor = i === 1 ? 0.5 : 1;
      o.frequency.setValueAtTime((glide ? from : hz) * factor, time);
      if (glide)
        o.frequency.exponentialRampToValueAtTime(hz * factor, time + glide);
      o.connect(mix);
      o.start(time);
    });
    mix.connect(filter);
    filter.connect(env);
    env.connect(this.channels[track]);
    const level = clamp(velocity / 127, 0, 1);
    env.gain.setValueAtTime(0.00001, time);
    env.gain.linearRampToValueAtTime(level, time + v.attack / 1000);
    env.gain.setTargetAtTime(
      Math.max(0.00001, (level * v.sustain) / 100),
      time + v.attack / 1000,
      v.decay / 1000 / 4,
    );
    const voice = { env, filter, oscs, released: false, release: v.release };
    this.active.add(voice);
    this.voices[track] = voice;
    this.last[track] = cents;
    oscs[0].onended = () => {
      this.active.delete(voice);
      mix.disconnect();
      filter.disconnect();
      env.disconnect();
    };
  }
  patchBus(sink, mv, time) {
    if (!sink || !this.context) return;
    const { track, parameter } = sinkBinding(sink),
      voice = this.voices[track];
    if (!voice || voice.released) return;
    if (parameter === 0)
      voice.filter.detune.setTargetAtTime(
        clamp(mv * 0.5, -5000, 5000),
        time,
        0.02,
      );
    else if (parameter === 1) {
      this.busLevels[track] = clamp((mv + 5000) / 10000, 0, 1);
      this.channels[track].gain.setTargetAtTime(
        this.busLevels[track] * this.levels[track] * 0.2,
        time,
        0.01,
      );
    } else
      voice.filter.Q.setTargetAtTime(
        clamp((mv + 5000) / 500, 0, 20),
        time,
        0.01,
      );
  }
}
