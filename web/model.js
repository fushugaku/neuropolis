export const STAGES = 16;
export const TRACK_CLOCK_DIVISIONS = [
  0.25,
  0.5,
  ...Array.from({ length: 64 }, (_, i) => i + 1),
];
// Rust/WASM uses integer values; existing ÷1…÷64 encodings stay unchanged.
export const encodeTrackDivision = (division) =>
  division === 0.5 ? 65 : division === 0.25 ? 66 : division;
export const NOTES = [
  "C",
  "C♯",
  "D",
  "D♯",
  "E",
  "F",
  "F♯",
  "G",
  "G♯",
  "A",
  "A♯",
  "B",
];
export const TRACK_KEYS = [
  "order",
  "length",
  "reverse",
  "division",
  "scale",
  "root",
  "transpose",
  "gateLength",
  "mute",
  "accumulatorMode",
  "accumulatorLimit",
  "swing",
  "slideAmount",
  "slideType",
  "offset",
  "pulseLength",
  "pulseDivision",
  "gateScale",
  "accumulatorNegative",
  "accumulatorScope",
  "accumulatorPolarity",
  "accumulatorReset",
  "sliderOctaves",
  "sliderInvert",
  "pulseOverride",
  "gateOverride",
  "stretch",
  "ratchetMode",
  "restPitch",
  "globalReset",
  "velocity",
  "velocitySource",
  "cvType",
  "midiChannel",
  "cvCC",
  "slideCC",
  "slideAmountCC",
  "slideCCMode",
  "bottomPitch",
  "faderMode",
  "minNote",
  "maxNote",
  "accumulatorStages",
];
export const TRACK_RANGES = [
  [0, 20],
  [1, 16],
  [0, 1],
  [0.25, 64],
  [0, 148],
  [0, 11],
  [-60, 60],
  [0, 100],
  [0, 1],
  [0, 3],
  [1, 28],
  [50, 78],
  [0, 100],
  [0, 2],
  [0, 15],
  [0, 64],
  [1, 8],
  [0, 100],
  [1, 28],
  [0, 1],
  [0, 1],
  [0, 3],
  [1, 4],
  [0, 1],
  [0, 8],
  [0, 6],
  [0, 1],
  [0, 2],
  [0, 1],
  [0, 1],
  [0, 100],
  [0, 1],
  [0, 2],
  [0, 16],
  [-1, 127],
  [-1, 127],
  [-1, 127],
  [0, 1],
  [0, 108],
  [0, 1],
  [0, 127],
  [0, 127],
  [1, 1024],
];
export const STEP_KEYS = [
  "pitch",
  "pulses",
  "gate",
  "ratchet",
  "probability",
  "slide",
  "skip",
  "accumulate",
  "pitchOverride",
  "gateOverride",
  "probabilityTarget",
  "accumulateTrigger",
  "cv",
  "cvRamp",
  "cvGate",
];
export const STEP_RANGES = [
  [0, 127],
  [1, 8],
  [0, 3],
  [1, 8],
  [0, 100],
  [0, 1],
  [0, 1],
  [-28, 28],
  [-1, 127],
  [-1, 100],
  [0, 1],
  [0, 2],
  [-5000, 5000],
  [0, 2],
  [0, 1],
];
export const MOD_KEYS = [
  "order",
  "length",
  "reverse",
  "division",
  "offset",
  "pulseLength",
  "cvType",
  "destination",
  "target",
  "mute",
  "midiChannel",
  "midiCC",
];
export const MOD_RANGES = [
  [0, 20],
  [1, 16],
  [0, 1],
  [1, 64],
  [0, 15],
  [0, 64],
  [0, 2],
  [0, 39],
  [0, 2147483647],
  [0, 1],
  [0, 16],
  [-1, 127],
];
export const DESTINATIONS = [
  "None",
  "Accumulate",
  "Accum reverse",
  "Accum invert",
  "Accum mode",
  "Accum polarity",
  "Accum reset",
  "BPM",
  "Clock division",
  "Direction",
  "Gate length",
  "Gate scale",
  "Loopy",
  "Loopy pulses",
  "Loopy offset",
  "Mute",
  "Octave",
  "Pitch offset",
  "Pitch post",
  "Pitch pre",
  "Play order",
  "Probability",
  "Pulse count",
  "Pulse division",
  "Pulses length",
  "Ratchet",
  "Reset",
  "Root",
  "Scale (User)",
  "Skip invert",
  "Slide",
  "Slide amount",
  "Slider invert",
  "Slider range",
  "Stages length",
  "Stages offset",
  "Swing",
  "Track out swap",
  "Velocity",
  "Accum direction",
];
export const GATE_DESTINATIONS = new Set([
  1, 2, 3, 4, 5, 6, 9, 12, 15, 26, 29, 30, 32, 37,
]);
export const OUTPUTS = [
  "CTRL 1 ±",
  "CTRL 1 +",
  "CTRL 2 ±",
  "CTRL 2 +",
  "Track CV",
  "First pulse",
  "Last pulse",
  "MOD clock",
  "MOD value",
  "New stage",
  "Reset",
  "Root",
  "Run",
  "Slider 0–5V",
  "Slider range",
  "Velocity",
  "CV trigger",
  "Clock",
  "MOD stage",
];
export const MX_MODES = [
  "Transport A",
  "Transport B",
  "Transport C",
  "Probability clocks",
  "MOD clocks",
  "Track stage",
  "MOD stage",
  "MOD gates",
  "MOD triggers",
];
export const LANES = [
  ["pitchOverride", "PITCH"],
  ["gateOverride", "GATE"],
  ["ratchet", "RATCH"],
  ["probability", "PROB"],
  ["accumulate", "ACCUM"],
  ["cv", "CV"],
  ["slide", "SLIDE"],
  ["skip", "SKIP"],
];
export const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
export const noteName = (midi) =>
  `${NOTES[((Math.round(midi) % 12) + 12) % 12]}${Math.floor(Math.round(midi) / 12) - 1}`;
export const signed = (v) => (v > 0 ? `+${v}` : String(v));
export const voltage = (mv) => `${mv >= 0 ? "+" : ""}${(mv / 1000).toFixed(2)}`;
export const bankSlot = (i) => `${Math.floor(i / 8) + 1}.${(i % 8) + 1}`;
const defaults = [
  0, 16, 0, 1, 0, 0, 0, 55, 0, 0, 7, 50, 32, 0, 0, 0, 1, 100, 7, 0, 0, 0, 4, 0,
  0, 0, 0, 0, 0, 1, 75, 0, 0, 0, -1, -1, -1, 0, 36, 1, 0, 127, 16,
];
export function emptyStep() {
  return Object.fromEntries(
    STEP_KEYS.map((k, i) => [
      k,
      [32, 1, 2, 1, 100, 0, 0, 0, -1, -1, 0, 0, 0, 0, 0][i],
    ]),
  );
}
export function emptyMod() {
  return {
    ...Object.fromEntries(
      MOD_KEYS.map((k, i) => [k, [0, 16, 0, 4, 0, 0, 0, 0, 2, 0, 0, -1][i]]),
    ),
    steps: Array.from({ length: 16 }, () => ({ value: 0, ramp: 0, gate: 0 })),
  };
}
export function emptyTrack(index = 0) {
  const alternate = index % 2;
  return {
    ...Object.fromEntries(
      TRACK_KEYS.map((key, field) => [key, defaults[field]]),
    ),
    name:
      index === 0
        ? "Sequence"
        : index === 1
          ? "Counterpoint"
          : `Track ${index + 1}`,
    volume: index === 0 ? 76 : 64,
    voice: {
      wave: alternate,
      cutoff: alternate ? 2800 : 1800,
      resonance: alternate ? 1 : 4,
      attack: 4,
      decay: 180,
      sustain: 45,
      release: 95,
    },
    steps: Array.from({ length: STAGES }, emptyStep),
  };
}
// Keep target 2 = all for compatibility with existing patches.
export const routeTarget = (index) => (index < 2 ? index : index + 1);
export const targetTrack = (target) => (target < 2 ? target : target - 1);
export const targetsTrack = (target, index) =>
  target === 2 || routeTarget(index) === target;
export const validTarget = (target, count) =>
  Number.isInteger(target) &&
  target >= 0 &&
  (target === 2 || targetTrack(target) < count);
export const swappedTrack = (index, swapped, count) =>
  swapped && count > 1 && index < 2 ? index ^ 1 : index;
export function sinkForTrack(track, parameter) {
  return track < 2
    ? 1 + parameter * 2 + track
    : 7 + (track - 2) * 3 + parameter;
}
export function sinkBinding(sink) {
  if (!Number.isInteger(sink) || sink < 1) return null;
  return sink <= 6
    ? { track: (sink - 1) % 2, parameter: Math.floor((sink - 1) / 2) }
    : { track: 2 + Math.floor((sink - 7) / 3), parameter: (sink - 7) % 3 };
}
export const isModOutput = (kind) => [7, 8, 18].includes(kind);
export const chainTrackMuted = (link, index) =>
  index < 2
    ? !!(link?.mute & (1 << index))
    : !!link?.mutedTracks?.includes(index);
export function normalizeTrackReferences(patch) {
  const count = patch.tracks.length;
  [...patch.mods, ...patch.controls, ...patch.aux, patch.loopy].forEach(
    (route) => {
      if (!validTarget(route.target, count)) route.target = 0;
    },
  );
  patch.outputs.forEach((output) => {
    if (output.source >= (isModOutput(output.kind) ? 8 : count))
      output.source = 0;
    if (sinkBinding(output.sink)?.track >= count) output.sink = 0;
  });
  if (patch.mx.source >= (patch.mx.mode === 5 ? count : 8)) patch.mx.source = 0;
}
export function removeTrackReferences(patch, removed) {
  const remap = (index) =>
    index === removed ? 0 : index > removed ? index - 1 : index;
  [...patch.mods, ...patch.controls, ...patch.aux, patch.loopy].forEach(
    (route) => {
      if (route.target !== 2)
        route.target = routeTarget(remap(targetTrack(route.target)));
    },
  );
  patch.outputs.forEach((output) => {
    if (!isModOutput(output.kind)) output.source = remap(output.source);
    const binding = sinkBinding(output.sink);
    if (binding)
      output.sink =
        binding.track === removed
          ? 0
          : sinkForTrack(remap(binding.track), binding.parameter);
  });
  if (patch.mx.mode === 5) patch.mx.source = remap(patch.mx.source);
  normalizeTrackReferences(patch);
}
export function emptyPatch() {
  return {
    version: 2,
    name: "Untitled",
    tempo: 124,
    totalPulses: 64,
    tracks: [0, 1].map(emptyTrack),
    mods: Array.from({ length: 8 }, emptyMod),
    controls: [
      { destination: 0, target: 0, value: 0, amount: 100 },
      { destination: 0, target: 2, value: 0, amount: 100 },
    ],
    aux: Array.from({ length: 3 }, () => ({
      destination: 0,
      target: 2,
      value: 0,
      amount: 100,
    })),
    outputs: [
      { kind: 4, source: 0, sink: 0 },
      { kind: 8, source: 0, sink: 0 },
    ],
    mx: { mode: 0, source: 0, bank: 0, channel: 0, message: 0 },
    userScales: Array.from({ length: 100 }, (_, i) => ({
      name: `User ${Math.floor(i / 10) + 1}.${(i % 10) + 1}`,
      mask: 2741,
      root: 0,
    })),
    loopy: { enabled: false, latch: false, target: 2, pulses: 0 },
    settings: {
      clockSource: 0,
      externalDivision: 6,
      outputDivision: 1,
      outputOffset: 0,
      clockMode: 0,
      resetInput: 0,
      runMode: 0,
      midiClock: 1,
      midiTransport: 1,
      midiRootChannel: 0,
      midiPCChannel: 0,
      loadMode: 0,
      queuePulses: 64,
      pitchLoad: 2,
      switchLoad: 1,
      ctrlLoad: 3,
      auxLoad: 1,
      cvDelay: 0,
      ledLevel: 3,
      screenLevel: 3,
      initPreset: -1,
    },
  };
}
export function demoPatch(variant = 0) {
  const p = emptyPatch();
  p.name = [
    "Glass / counterpoint",
    "Phase memory",
    "Acid suspension",
    "Chords in motion",
  ][variant % 4];
  const notes = [
    [36, 36, 43, 46, 36, 41, 43, 48, 36, 39, 43, 46, 41, 43, 34, 36],
    [60, 67, 64, 62, 60, 55, 59, 64, 67, 62, 60, 55, 57, 64, 62, 59],
  ];
  p.tracks.forEach((t, k) => {
    t.bottomPitch = k ? 48 : 24;
    t.division = k ? 2 : 1;
    t.order = k ? 2 : 0;
    t.midiChannel = k + 1;
    t.gateLength = k ? 72 : 48;
    t.steps.forEach((s, i) => {
      s.pitch = Math.round(((notes[k][i] - t.bottomPitch) / 48) * 127);
      s.pulses = !k && [3, 7, 11, 15].includes(i) ? 2 : 1;
      s.ratchet = !k && i === 14 ? 2 : 1;
      s.slide = k && i % 4 === 3 ? 1 : 0;
      s.cv = [3500, 1000, 2200, 4800][i % 4];
    });
  });
  p.mods[0].destination = 38;
  p.mods[0].target = 1;
  p.mods[0].division = 4;
  p.mods[0].steps.forEach((s, i) => {
    s.value = [0, -1800, 800, -800][i % 4];
    s.ramp = i % 2;
  });
  p.mods[1].division = 8;
  p.mods[1].steps.forEach(
    (s, i) => (s.value = Math.round(Math.sin((i / 16) * Math.PI * 2) * 2400)),
  );
  p.mods[1].steps.forEach((s) => (s.ramp = 1));
  p.outputs[1] = { kind: 8, source: 1, sink: 1 };
  if (variant === 1) {
    p.tracks[0].length = 13;
    p.tracks[1].length = 11;
    p.tracks[0].swing = 58;
    p.tracks[1].swing = 62;
    p.tracks[1].division = 3;
    p.totalPulses = 0;
    p.tracks[0].steps[4].accumulate = 1;
  }
  if (variant === 2) {
    p.tracks[0].slideType = 2;
    p.tracks[0].slideAmount = 52;
    p.tracks[0].steps.forEach((s, i) => {
      s.slide = i % 3 === 2 ? 1 : 0;
      s.gate = i % 5 === 1 ? 0 : 2;
    });
    p.tracks[1].mute = 1;
  }
  if (variant === 3) {
    p.mods[2].destination = 28;
    p.mods[2].target = 2;
    p.mods[2].division = 16;
    p.tracks.forEach((t) => (t.scale = 49));
    [145, 137, 545, 2185].forEach((mask, i) => (p.userScales[i].mask = mask));
    p.mods[2].steps.forEach((s, i) => (s.value = (i % 4) * 1000));
  }
  return p;
}
export function migratePatch(input) {
  if (
    input?.version === 2 &&
    Array.isArray(input.tracks) &&
    input.tracks.some((t) => t && t.accumulatorStages === undefined)
  ) {
    return {
      ...input,
      tracks: input.tracks.map((t) =>
        t && t.accumulatorStages === undefined
          ? { ...t, accumulatorStages: 16 }
          : t,
      ),
    };
  }
  if (input?.version !== 1) return input;
  const p = emptyPatch();
  p.name = input.name;
  p.tempo = input.tempo;
  if (!Array.isArray(input.tracks) || input.tracks.length !== 2)
    throw Error("Нужны два трека");
  input.tracks.forEach((old, i) => {
    const t = p.tracks[i];
    Object.assign(t, old);
    t.steps = old.steps.map((s) => ({
      ...emptyStep(),
      ...s,
      pitch: clamp(Math.round(((s.pitch - 36) / 48) * 127), 0, 127),
      pitchOverride: s.pitch < 36 || s.pitch > 84 ? s.pitch : -1,
    }));
  });
  return p;
}
const integer = (v, a, b) => Number.isInteger(v) && v >= a && v <= b;
function fields(o, keys, ranges) {
  return (
    !!o &&
    keys.every((k, i) =>
      k === "division" && ranges[i][0] === 0.25
        ? TRACK_CLOCK_DIVISIONS.includes(o[k])
        : integer(o[k], ...ranges[i]),
    )
  );
}
export function validatePatch(input) {
  if (input?.version === 2) input = migratePatch(input);
  if (
    input?.version !== 2 ||
    !Number.isFinite(input.tempo) ||
    input.tempo < 0.1 ||
    input.tempo > 400 ||
    !integer(input.totalPulses, 0, 1024) ||
    typeof input.name !== "string" ||
    input.name.length > 80
  )
    return false;
  if (
    !Array.isArray(input.tracks) ||
    input.tracks.length < 1 ||
    !Array.isArray(input.mods) ||
    input.mods.length !== 8
  )
    return false;
  if (
    !input.tracks.every(
      (t) =>
        fields(t, TRACK_KEYS, TRACK_RANGES) &&
        integer(t.volume, 0, 100) &&
        Array.isArray(t.steps) &&
        t.steps.length === 16 &&
        t.steps.every((s) => fields(s, STEP_KEYS, STEP_RANGES)),
    )
  )
    return false;
  if (
    !input.mods.every(
      (m) =>
        fields(m, MOD_KEYS, MOD_RANGES) &&
        validTarget(m.target, input.tracks.length) &&
        Array.isArray(m.steps) &&
        m.steps.length === 16 &&
        m.steps.every(
          (s) =>
            integer(s.value, -5000, 5000) &&
            integer(s.ramp, 0, 1) &&
            integer(s.gate, 0, 1),
        ),
    )
  )
    return false;
  if (
    ![input.controls, input.aux].every(
      (rs, i) =>
        Array.isArray(rs) &&
        rs.length === [2, 3][i] &&
        rs.every(
          (r) =>
            integer(r.destination, 0, 39) &&
            validTarget(r.target, input.tracks.length) &&
            integer(r.value, -5000, 5000) &&
            integer(r.amount, -100, 100),
        ),
    )
  )
    return false;
  if (
    !Array.isArray(input.userScales) ||
    input.userScales.length !== 100 ||
    !input.userScales.every(
      (s) =>
        typeof s.name === "string" &&
        s.name.length <= 60 &&
        integer(s.mask, 0, 4095) &&
        integer(s.root, 0, 11),
    )
  )
    return false;
  if (
    !Array.isArray(input.outputs) ||
    input.outputs.length !== 2 ||
    !input.outputs.every(
      (o) =>
        integer(o.kind, 0, 18) &&
        integer(
          o.source,
          0,
          (isModOutput(o.kind) ? 8 : input.tracks.length) - 1,
        ) &&
        (o.sink === 0 || sinkBinding(o.sink)?.track < input.tracks.length),
    )
  )
    return false;
  const settingRanges = {
    clockSource: [0, 2],
    externalDivision: [1, 256],
    outputDivision: [1, 256],
    outputOffset: [0, 255],
    clockMode: [0, 1],
    resetInput: [0, 2],
    runMode: [0, 1],
    midiClock: [0, 1],
    midiTransport: [0, 1],
    midiRootChannel: [0, 16],
    midiPCChannel: [0, 16],
    loadMode: [0, 2],
    queuePulses: [0, 4096],
    pitchLoad: [0, 2],
    switchLoad: [0, 1],
    ctrlLoad: [0, 3],
    auxLoad: [0, 1],
    cvDelay: [0, 21],
    ledLevel: [1, 4],
    screenLevel: [1, 4],
    initPreset: [-1, 63],
  };
  if (
    !input.settings ||
    !Object.entries(settingRanges).every(([k, [a, b]]) =>
      integer(input.settings[k], a, b),
    )
  )
    return false;
  if (
    !input.mx ||
    !integer(input.mx.mode, 0, 8) ||
    !integer(
      input.mx.source,
      0,
      (input.mx.mode === 5 ? input.tracks.length : 8) - 1,
    ) ||
    !integer(input.mx.bank, 0, 1) ||
    !integer(input.mx.channel, 0, 16) ||
    !integer(input.mx.message, 0, 1)
  )
    return false;
  if (
    !input.loopy ||
    typeof input.loopy.enabled !== "boolean" ||
    typeof input.loopy.latch !== "boolean" ||
    !validTarget(input.loopy.target, input.tracks.length) ||
    !integer(input.loopy.pulses, 0, 64)
  )
    return false;
  const voices = {
    wave: [0, 3],
    cutoff: [60, 16000],
    resonance: [0, 20],
    attack: [1, 500],
    decay: [10, 3000],
    sustain: [0, 100],
    release: [5, 4000],
  };
  return input.tracks.every(
    (t) =>
      t.voice &&
      Object.entries(voices).every(([k, [a, b]]) => integer(t.voice[k], a, b)),
  );
}
export const STORAGE = "metropolix-instrument-v2";
export function freshSession() {
  return {
    patch: demoPatch(),
    presets: Array.from({ length: 64 }, (_, i) =>
      i < 4 ? demoPatch(i) : null,
    ),
    chains: Array(8).fill(null),
    chain: [],
    currentPreset: 0,
  };
}
export function validateChain(chain) {
  return (
    Array.isArray(chain) &&
    chain.length <= 32 &&
    chain.every(
      (l) =>
        integer(l.preset, 0, 63) &&
        integer(l.repeat, 1, 64) &&
        integer(l.mute, 0, 7) &&
        (l.mutedTracks === undefined ||
          (Array.isArray(l.mutedTracks) &&
            l.mutedTracks.every((i) => Number.isInteger(i) && i >= 2))),
    )
  );
}
export function validateSession(s) {
  return (
    !!s &&
    validatePatch(s.patch) &&
    Array.isArray(s.presets) &&
    s.presets.length === 64 &&
    s.presets.every((p) => p === null || validatePatch(p)) &&
    Array.isArray(s.chains) &&
    s.chains.length === 8 &&
    s.chains.every((c) => c === null || validateChain(c)) &&
    validateChain(s.chain) &&
    integer(s.currentPreset, -1, 63)
  );
}
export function migrateSession(s) {
  if (!s || typeof s !== "object") return s;
  return {
    ...s,
    patch: migratePatch(s.patch),
    presets: Array.isArray(s.presets)
      ? s.presets.map((p) => (p === null ? null : migratePatch(p)))
      : s.presets,
  };
}
export function loadSession(storage) {
  try {
    const s = migrateSession(JSON.parse(storage.getItem(STORAGE)));
    if (validateSession(s)) return s;
  } catch {}
  const session = freshSession();
  try {
    const old = JSON.parse(storage.getItem("metropolix-16-independent-v1"));
    if (old) {
      const migrated = migratePatch(old);
      if (validatePatch(migrated)) {
        session.patch = migrated;
        session.currentPreset = -1;
      }
    }
  } catch {}
  return session;
}
export function syncEngine(e, p, reset = true) {
  e.engine_resize_tracks(p.tracks.length);
  p.tracks.forEach((t, i) => {
    TRACK_KEYS.forEach((k, f) =>
      e.engine_set_track(
        i,
        f,
        k === "division" ? encodeTrackDivision(t[k]) : t[k],
      ),
    );
    t.steps.forEach((s, n) =>
      STEP_KEYS.forEach((k, f) => e.engine_set_step(i, n, f, s[k])),
    );
  });
  p.mods.forEach((m, i) => {
    MOD_KEYS.forEach((k, f) => e.engine_set_mod(i, f, m[k]));
    m.steps.forEach((s, n) =>
      ["value", "ramp", "gate"].forEach((k, f) =>
        e.engine_set_mod_step(i, n, f, s[k]),
      ),
    );
  });
  p.userScales.forEach((s, i) => e.engine_set_scale(i + 49, s.mask, s.root));
  [p.controls, p.aux].forEach((rs, kind) =>
    rs.forEach((r, i) =>
      ["destination", "target", "value", "amount"].forEach((k, f) =>
        e.engine_set_route(kind, i, f, r[k]),
      ),
    ),
  );
  e.engine_set_global(0, Math.round(p.tempo * 1000));
  e.engine_set_global(1, p.totalPulses);
  e.engine_set_global(2, p.settings.outputDivision || 1);
  e.engine_set_global(3, p.settings.outputOffset || 0);
  e.engine_set_global(9, p.loopy.pulses);
  e.engine_set_global(10, p.loopy.target);
  e.engine_set_global(8, p.settings.clockSource ? 1 : 0);
  e.engine_set_global(4, p.mx.mode);
  e.engine_set_global(5, p.mx.source);
  e.engine_set_global(6, p.mx.bank);
  e.engine_set_global(7, p.mx.channel);
  p.outputs.forEach((o, i) => e.engine_set_output(i, o.kind, o.source));
  if (reset) (e.engine_restart || e.engine_reset)();
}
export function pitchAt(t, s) {
  const raw =
    s.pitchOverride >= 0
      ? s.pitchOverride
      : t.faderMode
        ? t.bottomPitch +
          ((t.sliderInvert ? 127 - s.pitch : s.pitch) * 12 * t.sliderOctaves) /
            127
        : s.pitch;
  return raw;
}
