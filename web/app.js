import {
  NOTES,
  TRACK_KEYS,
  TRACK_RANGES,
  TRACK_CLOCK_DIVISIONS,
  encodeTrackDivision,
  STEP_KEYS,
  STEP_RANGES,
  MOD_KEYS,
  MOD_RANGES,
  DESTINATIONS,
  GATE_DESTINATIONS,
  OUTPUTS,
  MX_MODES,
  LANES,
  clamp,
  noteName,
  signed,
  voltage,
  bankSlot,
  demoPatch,
  emptyStep,
  emptyTrack,
  routeTarget,
  targetTrack,
  targetsTrack,
  sinkForTrack,
  normalizeTrackReferences,
  chainTrackMuted,
  emptyMod,
  emptyPatch,
  validatePatch,
  migratePatch,
  pitchAt,
} from "./model.js";
import {
  AUTOMATION_LANES,
  pluginState,
  automationLabel,
} from "./automation.js";
import { InstrumentStore } from "./store.js";
import { Runtime } from "./runtime.js";
import { PluginRuntime, connectPlugin } from "./plugin.js";
const pluginBridge = connectPlugin();
const store = new InstrumentStore(pluginBridge?.storage || localStorage);
const view = {
  tab: "sequence",
  lanes: ["", ""],
  selectedStage: [0, 0],
  mod: 0,
  bank: 0,
  scaleBank: 0,
  scale: 0,
  setup: "global",
  drawer: null,
  drawerTab: "timing",
  clipboard: null,
  chainPreset: 0,
  chainSlot: 0,
  auditionTrack: 0,
  loopPointers: new Map(),
  randomBackup: null,
  randomSnapshots: new Map(),
  patchReference: null,
  solo: -1,
};
let catalog,
  runtime,
  toastTimer,
  peak = 0,
  frameCount = 0,
  lastStatus = "Ready";
const $ = (q) => document.querySelector(q);
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function icon(name) {
  const paths = {
    play: '<path d="m8 5 11 7-11 7z"/>',
    pause: '<path d="M8 5v14M16 5v14"/>',
    reset: '<path d="M4 10a8 8 0 1 1 1 8M4 4v6h6"/>',
    save: '<path d="M5 3h12l4 4v14H3V3zM7 3v6h10V3M7 21v-8h10v8"/>',
    folder: '<path d="M3 7V4h6l2 3h10v14H3z"/>',
    down: '<path d="m7 10 5 5 5-5"/>',
    more: '<path d="M5 12h.01M12 12h.01M19 12h.01"/>',
    undo: '<path d="M4 9h9a7 7 0 0 1 0 14M4 9l5-5M4 9l5 5"/>',
    redo: '<path d="M20 9h-9a7 7 0 0 0 0 14M20 9l-5-5M20 9l-5 5"/>',
    settings: '<path d="M4 7h16M4 17h16M8 4v6M16 14v6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    random: '<path d="m3 5 18 14M3 19 18 5M16 5h5v5M16 19h5v-5"/>',
    morph: '<path d="M3 12c4-12 5 12 9 0s5 12 9 0"/>',
    left: '<path d="m14 6-6 6 6 6"/>',
    right: '<path d="m10 6 6 6-6 6"/>',
    copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
    paste: '<path d="M9 5H5v16h14V5h-4M9 3h6v4H9z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M4 7h16M9 7V3h6v4M7 7l1 14h8l1-14M10 11v6M14 11v6"/>',
    loop: '<path d="M8 7a5 5 0 1 0 0 10c4 0 4-10 8-10a5 5 0 1 1 0 10c-4 0-4-10-8-10z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
    piano:
      '<rect x="3" y="4" width="18" height="16" rx="1"/><path d="M9 4v16M15 4v16M6 4v8M12 4v8M18 4v8"/>',
    link: '<path d="m8 13 8-8M7 9l-3 3a5 5 0 0 0 8 8l3-3M9 7l3-3a5 5 0 1 1 8 8l-3 3"/>',
  };
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.settings}</svg>`;
}
const button = (action, text, attrs = "", className = "") =>
  `<button type="button" data-action="${action}" ${attrs} class="${className}">${text}</button>`;
const iconButton = (action, name, title, attrs = "", className = "") =>
  button(
    action,
    icon(name),
    `aria-label="${title}" title="${title}" ${attrs}`,
    `icon-button ghost ${className}`,
  );
const options = (names, start = 0) => names.map((name, i) => [start + i, name]);
const range = (a, b, format = (n) => String(n)) =>
  Array.from({ length: b - a + 1 }, (_, i) => [a + i, format(a + i)]);
const scaleOptions = () => [
  ...catalog.scales.map((s) => [s.id, s.name]),
  ...store.patch.userScales.map((s, i) => [i + 49, s.name]),
];
const labelPath = (path) => path.replaceAll(".", "-");
const CTRL_FIELDS = {
  8: 3,
  10: 7,
  11: 17,
  20: 0,
  23: 16,
  24: 15,
  31: 12,
  33: 22,
  34: 1,
  35: 14,
  36: 11,
  4: 19,
};
function controlOwner(path) {
  const match = path.match(/^tracks\.(\d+)\.(\w+)$/);
  if (!match) return -1;
  const track = +match[1],
    field = TRACK_KEYS.indexOf(match[2]);
  let owner = -1;
  store.patch.controls.forEach((c, i) => {
    if (CTRL_FIELDS[c.destination] === field && targetsTrack(c.target, track))
      owner = i;
  });
  return owner;
}
function applyControlDefaults() {
  const p = store.patch;
  p.controls.forEach((c) => {
    if (c.destination === 7) {
      if (p.settings.clockSource === 0) {
        p.tempo =
          Math.round((0.1 + ((c.value + 5000) * 399.9) / 10000) * 10) / 10;
        runtime.engine.engine_set_global(0, Math.round(p.tempo * 1000));
      }
      return;
    }
    const field = CTRL_FIELDS[c.destination];
    if (field === undefined) return;
    const [a, b] = field === 3 ? [1, 64] : TRACK_RANGES[field];
    const value =
      c.destination === 4
        ? Number(c.value > 0)
        : a + Math.floor(((c.value + 5000) * (b - a)) / 10000);
    p.tracks.forEach((t, i) => {
      if (targetsTrack(c.target, i)) {
        t[TRACK_KEYS[field]] = value;
        runtime.engine.engine_set_track(i, field, value);
      }
    });
  });
}

function read(path) {
  return path.split(".").reduce((o, k) => o[k], store.patch);
}
function select(path, value, items, label, compact = false, extra = "") {
  const selected =
    items.find(([id]) => String(id) === String(value))?.[1] ?? String(value);
  return `<details class="select ${compact ? "compact" : ""} ${extra}"><summary aria-label="${escape(label)}">${escape(selected)}${icon("down")}</summary><div class="options" role="listbox" aria-label="${escape(label)}">${items.map(([id, name]) => `<button type="button" role="option" data-select="${escape(path)}" data-value="${escape(id)}" aria-selected="${String(id) === String(value)}">${escape(name)}${String(id) === String(value) ? icon("check") : ""}</button>`).join("")}</div></details>`;
}
function control(label, path, items = null, settings = {}) {
  if (runtime?.hosted && /^tracks\.\d+\.midiChannel$/.test(path) && items)
    items = items.map(([id, label]) => [id, id === 0 ? "Auto" : label]);
  let value = read(path);
  const owner = controlOwner(path);
  const compact = settings.compact || false,
    customLabel =
      settings.aria ||
      `${label} ${path.startsWith("tracks.") ? "· Track " + (+path.split(".")[1] + 1) : path.startsWith("mods.") ? "· MOD " + (+path.split(".")[1] + 1) : ""}`;
  if (
    path.match(/^tracks\.\d+\.root$/) &&
    store.patch.tracks[+path.split(".")[1]].scale >= 49
  )
    value =
      store.patch.userScales[store.patch.tracks[+path.split(".")[1]].scale - 49]
        .root;
  return `<label data-binding="${path}" class="control ${compact ? "compact" : ""} ${settings.class || ""} ${owner >= 0 ? "ctrl-owned" : ""}"><span>${label}${owner >= 0 ? `<i class="ctrl-owner" title="CTRL ${owner + 1}">${owner + 1}</i>` : ""}</span>${items ? select(path, value, items, customLabel, compact) : `<input class="field-number" type="number" value="${value}" min="${settings.min ?? -9999}" max="${settings.max ?? 9999}" step="${settings.step ?? 1}" data-path="${path}" aria-label="${escape(customLabel)}" ${owner >= 0 ? "disabled" : ""}>`}</label>`;
}
function toggle(label, path) {
  return `<label class="control"><span>${label}</span><button class="toggle" data-toggle="${path}" aria-pressed="${!!read(path)}" aria-label="${label}"><span>${read(path) ? "On" : "Off"}</span><i class="toggle-switch"></i></button></label>`;
}
function menu(items, label = "Actions") {
  return `<details class="select menu align-right"><summary aria-label="${label}">${icon("more")}${icon("down")}</summary><div class="options">${items.map(([action, text, attrs]) => button(action, text, attrs || "")).join("")}</div></details>`;
}
function notify(text) {
  lastStatus = text;
  const toast = $("#toast");
  toast.textContent = text;
  toast.classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("visible"), 2400);
  const status = $("#status-text");
  if (status) status.textContent = text;
}
function render() {
  if (!catalog || !runtime?.engine) return;
  if (view.patchReference !== store.patch) {
    view.randomSnapshots.clear();
    view.patchReference = store.patch;
  }
  const scroll = [...document.querySelectorAll("[data-scroll]")].map((el) => [
    el.dataset.scroll,
    el.scrollLeft,
  ]);
  const p = store.patch,
    s = store.session;
  view.lanes = p.tracks.map((_, i) => view.lanes[i] || "");
  view.selectedStage = p.tracks.map((_, i) => view.selectedStage[i] || 0);
  view.auditionTrack = Math.min(view.auditionTrack, p.tracks.length - 1);
  view.scaleTrack = Math.min(view.scaleTrack || 0, p.tracks.length - 1);
  if (view.drawer >= p.tracks.length) view.drawer = null;
  applySolo();

  $("#app").innerHTML =
    `<div class="shell"><header class="topbar"><div class="brand-block"><div class="brand">neuropolis</div></div><div class="transport"><button class="run primary" data-action="play" id="play" ${runtime.hosted ? 'disabled title="DAW transport"' : ""} aria-pressed="${runtime.playing}" aria-label="${runtime.playing ? "Pause" : "Play"}">${icon(runtime.playing ? "pause" : "play")}<span>${runtime.hosted ? "DAW" : runtime.playing ? "PAUSE" : "RUN"}</span></button>${iconButton("reset", "reset", "Reset sequencer")}<label class="tempo"><span>BPM</span><input type="number" min="0.1" max="400" step="0.1" data-path="tempo" value="${p.tempo}" aria-label="Tempo BPM" ${runtime.hosted || p.settings.clockSource || p.controls.some((c) => c.destination === 7) ? "disabled" : ""}><span class="tempo-source">${runtime.hosted ? "HOST" : ["INT", "EXT", "MIDI"][p.settings.clockSource]}</span></label><label class="cycle-length" title="Reset all tracks after this many sixteenth notes. 0 disables the reset."><span class="cycle-label">RESET AFTER</span><input type="number" min="0" max="1024" step="1" data-path="totalPulses" value="${p.totalPulses}" aria-label="Steps before global reset"><span class="cycle-unit">${p.totalPulses ? "STEPS" : "OFF"}</span><i class="cycle-progress" aria-hidden="true"></i></label><div class="clock-display"><span class="timecode mono" id="position" aria-label="Global cycle step">01 / ${p.totalPulses || "∞"}</span><i class="clock-led" id="clock-led"></i><canvas class="scope" id="scope" width="240" height="60" aria-label="Audio output"></canvas></div></div><div class="top-right"><input class="patch-title" data-path="name" value="${escape(p.name)}" maxlength="80" aria-label="Pattern name"><i class="dirty-dot" title="Unsaved changes" ${store.dirty ? "" : "hidden"}></i>${iconButton("undo", "undo", "Undo", store.undoStack.length ? "" : "disabled", "hide-mobile")}${iconButton("redo", "redo", "Redo", store.redoStack.length ? "" : "disabled", "hide-mobile")}<i class="separator"></i>${button("quick-save", icon("save") + "Save", `aria-label="Save preset" ${runtime.chainEnabled || runtime.queued !== null ? "disabled" : ""}`, "save-top")}${menu([["undo", "Undo", `data-mobile-only ${store.undoStack.length ? "" : "disabled"}`], ["redo", "Redo", `data-mobile-only ${store.redoStack.length ? "" : "disabled"}`], ["export-patch", "Export pattern .json"], ["export-backup", "Export full backup .json"], ["import", "Import pattern / backup"], ["export-midi", "Export MIDI · 8 bars"], ["init-patch", "Initialize pattern"], ["load-demo", "Load demo"], ...(localStorage.getItem("metropolix-16-independent-v1") ? [["import-legacy", "Import previous pattern"]] : [])], "File menu")}</div></header><nav class="navigation" aria-label="Editors">${[
      ["sequence", "Sequence"],
      ["modulation", "Modulation"],
      ["performance", "Performance"],
      ["presets", "Presets"],
      ["scales", "Scales"],
      ["setup", "Setup"],
    ]
      .map(([id, name]) =>
        button(
          "tab",
          name,
          `data-tab="${id}" aria-current="${view.tab === id ? "page" : "false"}"`,
          view.tab === id ? "active" : "",
        ),
      )
      .join(
        "",
      )}<div class="nav-right"><span class="status-light"></span><span>${runtime.chainEnabled ? `CHAIN ${runtime.chainIndex + 1}/${s.chain.length}` : runtime.queued !== null ? `${bankSlot(runtime.queued)} QUEUED` : s.currentPreset >= 0 ? `PRESET ${bankSlot(s.currentPreset)}` : "LIVE"}</span></div></nav>${runtime.hosted && runtime.automationLearn >= 0 ? `<div class="automation-learning" role="status"><span>Automation ${String(runtime.automationLearn + 1).padStart(2, "0")} · Move a control to assign</span>${button("automation-cancel", "Cancel", "", "ghost")}</div>` : ""}<main class="workspace" id="workspace">${{ sequence: sequenceView, modulation: modulationView, performance: performanceView, presets: presetsView, scales: scalesView, setup: setupView }[view.tab]()}</main><footer class="footer"><div class="footer-status"><i class="status-light"></i><span id="status-text">${escape(lastStatus)}</span></div><div class="footer-hints"><span><kbd class="footer-key">SPACE</kbd> Run / Pause</span><span><kbd class="footer-key">R</kbd> Reset</span><span><kbd class="footer-key">L</kbd> Loopy</span></div></footer></div><input type="file" id="import-file" accept=".json,application/json" hidden>`;
  scroll.forEach(([id, x]) => {
    const el = document.querySelector(`[data-scroll="${id}"]`);
    if (el) el.scrollLeft = x;
  });
  renderDrawer();
  paintFrame(runtime.lastFrame || runtime.frame());
}
const TRACK_COLORS = [
  ["#c6de92", "#71834f"],
  ["#b9adf0", "#776d9d"],
  ["#e1ad79", "#93704b"],
  ["#8bc9d4", "#527d85"],
  ["#df9eb8", "#94657b"],
  ["#a8c2eb", "#657b9b"],
];
const trackOptions = () =>
  store.patch.tracks.map((_, i) => [i, `Track ${i + 1}`]);
const targetOptions = () => [
  ...store.patch.tracks.map((_, i) => [routeTarget(i), `Track ${i + 1}`]),
  [2, "All tracks"],
];
const targetLabel = (target) =>
  target === 2 ? "All tracks" : `Track ${targetTrack(target) + 1}`;
const sinkOptions = () => [
  [0, "Monitor only"],
  ...store.patch.tracks.flatMap((_, i) =>
    ["cutoff", "level", "resonance"].map((name, parameter) => [
      sinkForTrack(i, parameter),
      `Voice ${i + 1} · ${name}`,
    ]),
  ),
];
function sequenceView() {
  return (
    `<div class="sequence-heading"><span>${store.patch.tracks.length} TRACKS</span>${button("add-track", icon("plus") + "Add track", 'aria-label="Add track"', "ghost")}</div>` +
    store.patch.tracks.map((track, i) => trackView(track, i)).join("")
  );
}
function chainMuteMenu(link, index) {
  const tracks =
    store.session.presets[link.preset]?.tracks || store.patch.tracks;
  const disabled = runtime.chainEnabled ? "disabled" : "";
  return `<details class="select chain-mutes align-right"><summary aria-label="Mute link ${index + 1}">MUTE${icon("down")}</summary><div class="options">${tracks.map((_, i) => button(i < 2 ? "chain-mute" : "chain-mute-track", `Track ${i + 1}`, `data-index="${index}" data-track="${i}" data-bit="${i}" aria-pressed="${chainTrackMuted(link, i)}" aria-label="Mute track ${i + 1}, link ${index + 1}" ${disabled}`)).join("")}${button("chain-mute", "MOD", `data-index="${index}" data-bit="2" aria-pressed="${!!(link.mute & 4)}" ${disabled}`)}</div></details>`;
}
function trackView(t, i) {
  const q = { compact: true },
    pre = `tracks.${i}`,
    frame = runtime.lastFrame?.tracks[i];
  return `<section class="track" data-track="${i}" aria-label="Track ${i + 1}" style="--accent:${TRACK_COLORS[i % TRACK_COLORS.length][0]};--accent-dim:${TRACK_COLORS[i % TRACK_COLORS.length][1]}"><header class="track-header"><div class="track-identity"><span class="track-index">${String(i + 1).padStart(2, "0")}</span><div class="track-title"><strong>${escape(t.name)}</strong><small>TRACK ${i + 1} · ${runtime.hosted || t.midiChannel ? "CH " + (t.midiChannel || (i % 16) + 1) : "CV"}</small></div></div><div class="track-quick">${control(
    "ORDER",
    `${pre}.order`,
    catalog.orders.map((o) => [o.id, o.name]),
    { ...q, class: "quick-order" },
  )}${control("LENGTH", `${pre}.length`, range(1, 16), q)}${control(
    "DIR",
    `${pre}.reverse`,
    [
      [0, "→"],
      [1, "←"],
    ],
    { ...q, class: "quick-direction" },
  )}${control(
    "CLOCK",
    `${pre}.division`,
    [0.25, 0.5, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64].map((n) => [
      n,
      `÷${n}`,
    ]),
    q,
  )}${control("SWING", `${pre}.swing`, null, { ...q, min: 50, max: 78, class: "quick-swing" })}</div><div class="track-live"><i class="gate-led" data-gate="${i}"></i><output data-note="${i}">${frame ? noteName(frame.note) : "—"}</output><small data-cv="${i}">${frame ? voltage(frame.cv) : "+0.00"}V</small></div><div class="track-controls"><input class="small-range" type="range" min="0" max="100" value="${t.volume}" data-path="${pre}.volume" aria-label="Track volume ${i + 1}"><button class="solo-button" data-action="solo" data-track="${i}" aria-pressed="${view.solo === i}" aria-label="Solo track ${i + 1}">S</button><button class="mute-button" data-toggle="${pre}.mute" aria-pressed="${!!t.mute}" aria-label="Mute track ${i + 1}">M</button>${iconButton("track-settings", "settings", `Track settings ${i + 1}`, `data-track="${i}"`)}</div></header><div class="bank-scroll" data-scroll="track-${i}"><div class="bank"><div class="row-labels"><span>STAGE</span><span>NOTE</span><span>PITCH</span><div class="row-group pulse-label"><span class="row-heading">PULSE<br>COUNT</span></div><div class="row-group gate-label"><span class="row-heading">GATE<br>TYPE</span><div class="gate-legend" aria-hidden="true"><span>HOLD</span><span>MULTI</span><span>SINGLE</span><span>REST</span></div></div></div>${t.steps.map((s, n) => stageView(t, s, i, n)).join("")}</div></div><div class="lane-toolbar"><div class="lane-tabs" role="tablist" aria-label="Track layer ${i + 1}">${LANES.map(([key, name]) => button("lane", name, `role="tab" data-track="${i}" data-lane="${key}" aria-selected="${view.lanes[i] === key}"`, view.lanes[i] === key ? "active" : "")).join("")}</div><div class="lane-actions">${iconButton("lane-random", "random", "Randomize layer", `data-track="${i}"`)}${iconButton("lane-morph", "morph", "Morph layer", `data-track="${i}"`, "desktop-only")}${menu(
    [
      ["duplicate-track", "Duplicate track", `data-track="${i}"`],
      [
        "remove-track",
        "Remove track",
        `data-track="${i}" ${store.patch.tracks.length <= 1 ? "disabled" : ""}`,
      ],
      ["copy-track", "Copy track", `data-track="${i}"`],
      ["paste-track", "Paste track", `data-track="${i}"`],
      ["copy-lane", "Copy layer", `data-track="${i}"`],
      ["paste-lane", "Paste layer", `data-track="${i}"`],
      ["lane-rotate-left", "Rotate layer ←", `data-track="${i}"`],
      ["lane-rotate-right", "Rotate layer →", `data-track="${i}"`],
      ["lane-reset", "Reset layer", `data-track="${i}"`],
      [
        "lane-revert",
        "Restore before randomize",
        `data-track="${i}" ${view.randomSnapshots.has(randomGroup("track", i).id) ? "" : "disabled"}`,
      ],
    ],
    `Track ${i + 1} actions`,
  )}</div></div>${view.lanes[i] ? laneEditor(t, i, view.lanes[i]) : ""}</section>`;
}
const GATE_NAMES = ["Rest", "Single", "Multiple", "Hold"];
function gateSymbol(mode) {
  const bars = [
    '<rect class="gate-outline" x="3" y="5" width="22" height="8" rx=".5"/>',
    '<rect class="gate-outline" x="3" y="5" width="22" height="8" rx=".5"/><rect x="3" y="5" width="6" height="8"/>',
    '<rect x="3" y="5" width="5" height="8"/><rect x="11.5" y="5" width="5" height="8"/><rect x="20" y="5" width="5" height="8"/>',
    '<rect x="3" y="5" width="22" height="8" rx=".5"/>',
  ];
  return `<svg class="gate-symbol" viewBox="0 0 28 18" aria-hidden="true">${bars[mode]}</svg>`;
}
function stageSwitch(kind, value, track, stage) {
  const pulse = kind === "pulses",
    min = pulse ? 1 : 0,
    max = pulse ? 8 : 3,
    path = `tracks.${track}.steps.${stage}.${kind}`,
    label = `${pulse ? "Pulses" : "Gate"}, track ${track + 1}, stage ${stage + 1}`,
    text = pulse ? `${value} / 8` : GATE_NAMES[value];
  return `<div class="stage-switch ${pulse ? "pulse-count" : "gate-type"}" data-step-switch="${path}"><span class="switch-heading-space" aria-hidden="true"></span><div class="switch-body" data-value="${value}"><span class="switch-rail" aria-hidden="true"></span><div class="switch-scale" aria-hidden="true">${Array.from(
    { length: max - min + 1 },
    (_, i) => max - i,
  )
    .map(
      (mode) =>
        `<span data-switch-option="${mode}" class="switch-detent ${mode === value ? "is-selected" : ""}">${pulse ? mode : gateSymbol(mode)}</span>`,
    )
    .join(
      "",
    )}</div><input class="detent-slider" type="range" min="${min}" max="${max}" step="1" value="${value}" data-path="${path}" aria-label="${label}" aria-orientation="vertical" aria-valuetext="${text}" title="${pulse ? "Pulse count" : "Gate type"} · ${text}"></div></div>`;
}
function refreshStageSwitch(path, value) {
  const root = document.querySelector(`[data-step-switch="${path}"]`);
  if (!root) return;
  const input = root.querySelector("input"),
    pulse = path.endsWith(".pulses"),
    text = pulse ? `${value} / 8` : GATE_NAMES[value];
  input.value = value;
  input.setAttribute("aria-valuetext", text);
  input.title = `${pulse ? "Pulse count" : "Gate type"} · ${text}`;
  root.querySelector(".switch-body").dataset.value = value;
  root
    .querySelectorAll("[data-switch-option]")
    .forEach((option) =>
      option.classList.toggle(
        "is-selected",
        Number(option.dataset.switchOption) === value,
      ),
    );
}
function stageView(t, s, i, n) {
  const path = `tracks.${i}.steps.${n}`,
    pickup = store.pickup.get(`pitch:${i}:${n}`),
    pitch = runtime.engine.engine_preview(i, n, 0) / 100;
  return `<div class="stage ${n >= t.length ? "outside" : ""} ${s.skip ? "skipped" : ""}" data-stage="${n}" data-track="${i}"><button class="stage-head" data-action="stage" data-track="${i}" data-stage="${n}" aria-label="Stage ${n + 1}, track ${i + 1}" title="${store.patch.loopy.enabled ? "Loopy / Stage player" : "Audition · Shift: select stage"}">${String(n + 1).padStart(2, "0")}</button><output class="stage-note ${s.pitchOverride >= 0 ? "overridden" : ""}" title="${s.pitchOverride >= 0 ? "Pitch override · PITCH layer" : ""}" data-stage-note="${i}-${n}">${noteName(pitch)}</output><div class="fader" ${pickup ? `data-pickup style="--pickup-top:${(1 - pickup.target / 127) * 116}px"` : ""}><input type="range" min="0" max="127" step="1" value="${pickup?.physical ?? s.pitch}" data-path="${path}.pitch" aria-label="Pitch, track ${i + 1}, stage ${n + 1}" aria-valuetext="${noteName(pitch)}"></div>${stageSwitch("pulses", s.pulses, i, n)}${stageSwitch("gate", s.gate, i, n)}</div>`;
}
function laneEditor(t, i, key) {
  const f = STEP_KEYS.indexOf(key),
    [min, max] = STEP_RANGES[f],
    special = ["slide", "skip"].includes(key),
    label = LANES.find((l) => l[0] === key)?.[1] || key;
  return `<div class="lane-editor bank-scroll" data-scroll="lane-${i}"><div class="lane-grid"><div class="lane-caption">${label}</div>${t.steps.map((s, n) => `<div class="lane-cell" data-stage="${n}">${special ? `<button class="flag-button" data-toggle="tracks.${i}.steps.${n}.${key}" aria-label="${label}, track ${i + 1}, stage ${n + 1}" aria-pressed="${!!s[key]}">${key === "slide" ? "↗" : "×"}</button>` : `<input class="lane-number" type="number" min="${key === "cv" ? (t.cvType === 1 ? 0 : -5) : min}" max="${key === "cv" ? 5 : max}" step="${key === "cv" ? ".01" : "1"}" value="${key === "cv" ? (s.cv / 1000).toFixed(2) : s[key]}" ${key === "cv" ? 'data-factor="1000"' : ""} data-path="tracks.${i}.steps.${n}.${key}" aria-label="${label}, track ${i + 1}, stage ${n + 1}">`}${key === "probability" ? button("cycle-sub", s.probabilityTarget ? "PULSE" : "STAGE", `data-track="${i}" data-stage="${n}" data-key="probabilityTarget" data-max="1"`, "lane-mode") : key === "accumulate" ? button("cycle-sub", ["STAGE", "PULSE", "RATCH"][s.accumulateTrigger], `data-track="${i}" data-stage="${n}" data-key="accumulateTrigger" data-max="2"`, "lane-mode") : key === "cv" ? (t.cvType === 2 ? button("cv-gate", s.cvGate ? "GATE ●" : "GATE ○", `data-track="${i}" data-stage="${n}"`, "lane-mode") : button("cycle-sub", ["STEP", "sRAMP", "pRAMP"][s.cvRamp], `data-track="${i}" data-stage="${n}" data-key="cvRamp" data-max="2"`, "lane-mode")) : key === "pitchOverride" ? button("sync-pitch", "SYNC", `data-track="${i}" data-stage="${n}"`, "lane-mode") : key === "gateOverride" ? `<small class="subtle mono" style="font-size:8px">${s.gateOverride < 0 ? "TRACK" : s.gateOverride === 0 ? "REST" : s.gateOverride === 100 ? "HOLD" : s.gateOverride + "%"}</small>` : ""}</div>`).join("")}</div></div>`;
}
function miniGraph(lane) {
  const values = lane.steps.map((s) =>
    GATE_DESTINATIONS.has(lane.destination) || lane.cvType === 2
      ? s.gate
        ? 5000
        : 0
      : s.value,
  );
  return `<svg class="mod-mini" viewBox="0 0 160 28" preserveAspectRatio="none" aria-hidden="true"><line x1="0" y1="14" x2="160" y2="14"/><polyline points="${values.map((v, i) => `${(i * 160) / 15},${14 - (v / 5000) * 12}`).join(" ")}"/></svg>`;
}
function modulationView() {
  const p = store.patch,
    m = p.mods[view.mod],
    pre = `mods.${view.mod}`,
    gated = GATE_DESTINATIONS.has(m.destination) || m.cvType === 2;
  return `<div class="section-heading"><div><h1>Modulation</h1></div><div class="actions">${iconButton("mod-copy", "copy", "Copy MOD lane")}${iconButton("mod-paste", "paste", "Paste MOD lane")}${iconButton("mod-random", "random", "Randomize MOD lane")}${iconButton("mod-morph", "morph", "Morph MOD lane")}${iconButton("mod-revert", "undo", "Restore MOD lane before randomize", view.randomSnapshots.has(randomGroup("mod", 0).id) ? "" : "disabled")}</div></div><div class="mod-workspace"><div class="mod-list">${p.mods.map((lane, i) => `<div class="mod-row ${i === view.mod ? "active" : ""}" data-action="select-mod" data-mod="${i}" role="button" tabindex="0" aria-label="MOD ${i + 1}: ${DESTINATIONS[lane.destination]}"><span class="mod-id">${String(i + 1).padStart(2, "0")}</span><div><strong>${DESTINATIONS[lane.destination]}</strong><small>${targetLabel(lane.target)} · ÷${lane.division}<span data-mod-value="${i}" style="float:right">${voltage(runtime.engine.engine_mod_value(i, 0))}</span></small>${miniGraph(lane)}</div><button class="mute-button" data-toggle="mods.${i}.mute" aria-label="Mute MOD ${i + 1}" aria-pressed="${!!lane.mute}">M</button></div>`).join("")}</div><section class="mod-editor"><header class="mod-editor-header"><div><h2>MOD ${String(view.mod + 1).padStart(2, "0")}</h2><p>${DESTINATIONS[m.destination]} → ${targetLabel(m.target)}</p></div>${button("mod-reset", "Reset lane", "", "ghost")}</header><div class="mod-settings">${control("DESTINATION", `${pre}.destination`, options(DESTINATIONS.slice(0, 39)), { class: "wide" })}${control(
    "TARGET",
    `${pre}.target`,
    targetOptions(),
  )}${control(
    "ORDER",
    `${pre}.order`,
    catalog.orders.map((o) => [o.id, o.name]),
    { class: "wide" },
  )}${control("STAGES", `${pre}.length`, range(1, 16))}${control(
    "DIRECTION",
    `${pre}.reverse`,
    [
      [0, "→"],
      [1, "←"],
    ],
  )}${control(
    "CLOCK",
    `${pre}.division`,
    range(1, 64, (n) => `÷${n}`),
  )}</div><div class="bank-scroll" data-scroll="mod-bank"><div class="mod-bank">${m.steps.map((s, n) => `<div class="mod-stage" data-mod-stage="${view.mod}-${n}"><span>${String(n + 1).padStart(2, "0")}</span>${gated ? `<button class="gate-pad" data-toggle="${pre}.steps.${n}.gate" aria-label="Gate MOD ${view.mod + 1}, stage ${n + 1}" aria-pressed="${!!s.gate}">${s.gate ? "●" : "○"}</button>` : `<input type="range" min="${m.cvType === 1 ? 0 : -5000}" max="5000" step="10" value="${s.value}" data-path="${pre}.steps.${n}.value" aria-label="MOD ${view.mod + 1}, stage ${n + 1}">`}<input class="mod-value" type="number" min="${m.cvType === 1 ? 0 : -5}" max="5" step=".01" value="${(s.value / 1000).toFixed(2)}" data-factor="1000" data-path="${pre}.steps.${n}.value" aria-label="MOD voltage ${view.mod + 1}, stage ${n + 1}"><button class="ramp-button" data-toggle="${pre}.steps.${n}.ramp" aria-pressed="${!!s.ramp}" aria-label="Ramp MOD ${view.mod + 1}, stage ${n + 1}">${s.ramp ? "RAMP ↗" : "STEP —"}</button></div>`).join("")}</div></div><div class="mod-bottom">${control(
    "OFFSET",
    `${pre}.offset`,
    range(0, 15, (n) => `+${n}`),
  )}${control("PULSE LENGTH", `${pre}.pulseLength`, [[0, "Auto"], ...range(1, 64)])}${control("CV TYPE", `${pre}.cvType`, options(["Bipolar ±5V", "Unipolar 0–5V", "Gate toggle"]))}${control("MIDI CHANNEL", `${pre}.midiChannel`, [[0, "Off"], ...range(1, 16)])}${control("MIDI CC", `${pre}.midiCC`, [[-1, "Off"], ...range(0, 127)])}</div></section></div>`;
}
function performanceView() {
  const p = store.patch;
  return `<div class="section-heading"><div><h1>Performance</h1></div><div class="actions">${button("panic", "All notes off", "", "ghost")}</div></div><div class="performance-grid"><section class="tool-panel"><div class="tool-heading"><h2>Loopy / Stage player</h2>${button("loopy", icon("loop") + "Loopy", `aria-pressed="${p.loopy.enabled}"`)}</div><div class="tool-body"><div class="loopy-config">${select(
    "@audition",
    view.auditionTrack,
    trackOptions(),
    "Stage player track",
  )}${control("TARGET", "loopy.target", targetOptions())}${control("PULSES", "loopy.pulses", [[0, "Auto"], ...range(1, 64)])}${toggle("LATCH", "loopy.latch")}</div><div class="loopy-pads">${Array.from({ length: 16 }, (_, i) => button("pad", String(i + 1).padStart(2, "0"), `data-track="${view.auditionTrack}" data-stage="${i}" aria-label="Play stage ${i + 1}, track ${view.auditionTrack + 1}"`)).join("")}</div></div></section><section class="tool-panel"><div class="tool-heading"><h2>CTRL</h2><small>PERFORMANCE CONTROLS</small></div><div class="tool-body controller-grid">${p.controls
    .map(
      (r, i) =>
        `<div class="controller"><label class="knob-wrap"><span class="knob" data-knob="${i}" style="--rotation:${(r.value / 5000) * 135}deg"></span><input type="range" min="-5000" max="5000" step="10" data-path="controls.${i}.value" value="${store.pickup.get("control:" + i)?.physical ?? r.value}" aria-label="CTRL ${i + 1}"><output data-readout="controls.${i}.value">${voltage(r.value)}</output></label><div class="controller-routing">${control(
          `CTRL ${i + 1}`,
          `controls.${i}.destination`,
          options(
            DESTINATIONS.filter(
              (_, id) => ![1, 6, 12, 13, 14, 15, 26, 30].includes(id),
            ),
          ).map(([_, name]) => [DESTINATIONS.indexOf(name), name]),
        )}${control("TARGET", `controls.${i}.target`, targetOptions())}</div></div>`,
    )
    .join(
      "",
    )}</div></section><section class="tool-panel full"><div class="tool-heading"><h2>AUX inputs</h2><small>X / Y / Z</small></div><div class="tool-body aux-grid">${p.aux
    .map(
      (a, i) =>
        `<div class="aux-channel"><h3>AUX ${"XYZ"[i]}</h3>${control("DESTINATION", `aux.${i}.destination`, options(DESTINATIONS.slice(0, 39)))}${control(
          "TARGET",
          `aux.${i}.target`,
          targetOptions(),
        )}<label class="aux-voltage"><div class="value-line"><span>INPUT</span><output data-readout="aux.${i}.value">${voltage(a.value)}V</output></div><input class="aux-slider" type="range" min="-5000" max="5000" step="10" value="${a.value}" data-path="aux.${i}.value" aria-label="AUX ${"XYZ"[i]} voltage"></label><label><div class="value-line"><span>ATTENUVERTER</span><output data-readout="aux.${i}.amount">${signed(a.amount)}%</output></div><input class="aux-slider" type="range" min="-100" max="100" value="${a.amount}" data-path="aux.${i}.amount" aria-label="AUX ${"XYZ"[i]} attenuverter"></label></div>`,
    )
    .join(
      "",
    )}</div></section><section class="tool-panel"><div class="tool-heading"><h2>Outputs</h2><small>A / B</small></div><div class="tool-body output-grid">${p.outputs
    .map(
      (o, i) =>
        `<div class="output-channel"><h3>OUT ${"AB"[i]}<output data-output="${i}">+0.00V</output></h3><div class="voltage-meter"><span data-meter="${i}"></span></div>${control("SOURCE", `outputs.${i}.kind`, options(OUTPUTS))}${control(
          "ASSIGN",
          `outputs.${i}.source`,
          range(
            0,
            [7, 8, 18].includes(o.kind) ? 7 : p.tracks.length - 1,
            (n) =>
              [7, 8, 18].includes(o.kind)
                ? "MOD " + (n + 1)
                : "Track " + (n + 1),
          ),
        )}${control("MONITOR PATCH", `outputs.${i}.sink`, sinkOptions())}</div>`,
    )
    .join(
      "",
    )}</div></section><section class="tool-panel"><div class="tool-heading"><h2>MX / Gate expander</h2><small>8 OUTPUTS</small></div><div class="tool-body"><div class="control-grid two">${control("MODE", "mx.mode", options(MX_MODES))}${control(
    "ASSIGN",
    "mx.source",
    range(0, p.mx.mode === 6 ? 7 : p.tracks.length - 1, (n) =>
      p.mx.mode === 6 ? "MOD " + (n + 1) : "Track " + (n + 1),
    ),
  )}${control("STAGES", "mx.bank", [
    [0, "01–08"],
    [1, "09–16"],
  ])}${control("MIDI CHANNEL", "mx.channel", [[0, "Off"], ...range(1, 16)])}${control("MIDI MESSAGE", "mx.message", options(["CC 102–109", "Notes 35–42"]))}</div><div class="mx-dots">${Array.from({ length: 8 }, (_, i) => `<span class="mx-dot" data-mx="${i}">${i + 1}</span>`).join("")}</div></div></section><section class="tool-panel full"><div class="tool-heading"><h2>Clock & tuning</h2></div><div class="tool-body"><div class="control-grid">${control("CLOCK SOURCE", "settings.clockSource", options(["Internal", "External CLK", "MIDI"]))}${control(
    "EXT CLOCK DIV",
    "settings.externalDivision",
    range(1, 256, (n) => `÷${n}`),
  )}${control("RESET INPUT", "settings.resetInput", options(["Reset", "Run + reset", "Run / continue"]))}</div><div class="action-row" style="margin-top:20px">${button("clock-in", "CLK IN", 'aria-label="External clock pulse"')}${button("reset-in", "RESET IN", 'aria-label="External reset / run"')}${select(
    "@tuneNote",
    view.tuneNote ?? 48,
    range(0, 10, (n) => noteName(n * 12)).map(([id, name]) => [id * 12, name]),
    "Tuner pitch",
  )}${select("@tuneGate", view.tuneClock ? 1 : 0, options(["Gate high", "Clocked gate"]), "Tuner gate")}${button("tuner", icon("piano") + (runtime.tuner ? "Stop tuner" : "Tuner " + noteName(view.tuneNote ?? 48)), `aria-pressed="${runtime.tuner}"`)}</div></div></section></div>`;
}
function presetsView() {
  const s = store.session,
    p = store.patch;
  return `<div class="section-heading"><div><h1>Presets & chains</h1><p>64 presets · 8 banks · up to 32 links per chain.</p></div><div class="actions">${button("export-backup", icon("download") + "Backup")}${button("import", icon("folder") + "Import")}</div></div><div class="presets-layout"><section><div class="preset-toolbar">${control("LOAD DELAY", "settings.loadMode", options(["Instant", "Queue pulses", "Global cycle"]))}${control("QUEUE PULSES", "settings.queuePulses", null, { min: 0, max: 4096 })}</div><div class="bank-tabs" aria-label="Preset banks">${range(
    0,
    7,
  )
    .map(([i]) =>
      button(
        "preset-bank",
        String(i + 1),
        `data-bank="${i}" aria-label="Bank ${i + 1}"`,
        view.bank === i ? "active" : "",
      ),
    )
    .join("")}</div><div class="preset-slots">${range(
    view.bank * 8,
    view.bank * 8 + 7,
  )
    .map(
      ([i]) =>
        `<div class="preset-slot ${!s.presets[i] ? "empty" : ""} ${s.currentPreset === i ? "loaded" : ""} ${runtime.queued === i ? "queued" : ""}" role="button" tabindex="0" data-action="preset-load" data-slot="${i}" aria-label="Load preset ${bankSlot(i)}${s.presets[i] ? ": " + escape(s.presets[i].name) : ", empty"}"><span class="slot-index">${bankSlot(i)} ${runtime.queued === i ? "QUEUED" : ""}</span><span class="slot-name">${s.presets[i] ? escape(s.presets[i].name) : "Empty"}</span><div class="slot-actions">${iconButton("preset-save", "save", `Save to ${bankSlot(i)}`, `data-slot="${i}" ${runtime.chainEnabled || runtime.queued !== null ? "disabled" : ""}`)}${s.presets[i] ? iconButton("preset-clear", "trash", `Clear ${bankSlot(i)}`, `data-slot="${i}" ${runtime.chainEnabled || runtime.queued !== null ? "disabled" : ""}`) : ""}</div></div>`,
    )
    .join(
      "",
    )}</div><div class="parameter-group" style="margin-top:20px"><h3>PRESET RECALL</h3><div class="control-grid two">${control("PITCH LOAD", "settings.pitchLoad", options(["Off · keep faders", "Thru · pickup", "Jump · full recall"]))}${control("SWITCH LOAD", "settings.switchLoad", options(["Off · keep switches", "Jump · recall"]))}${control("CTRL LOAD", "settings.ctrlLoad", options(["Off", "Assignments", "Thru · pickup", "Jump"]))}${control("AUX LOAD", "settings.auxLoad", options(["Off", "Assignments"]))}</div></div></section><section><div class="section-heading" style="margin-bottom:16px"><div><h1 style="font-size:15px">Preset chain</h1></div>${button("chain-toggle", icon("link") + (runtime.chainEnabled ? "Disable chain" : "Enable chain"), `aria-pressed="${runtime.chainEnabled}" ${!s.chain.length ? "disabled" : ""}`, runtime.chainEnabled ? "active" : "")}</div><div class="chain-add">${select("@chainPreset", view.chainPreset, s.presets.map((preset, i) => (preset ? [i, `${bankSlot(i)} · ${preset.name}`] : null)).filter(Boolean), "Preset for chain")}${button("chain-add", icon("plus") + "Add link", s.chain.length >= 32 || runtime.chainEnabled ? "disabled" : "")}</div><div class="chain-list">${s.chain.length ? s.chain.map((link, i) => `<div class="chain-link ${runtime.chainEnabled && runtime.chainIndex === i ? "playing" : ""}" data-chain-link="${i}"><span class="link-index">${String(i + 1).padStart(2, "0")}</span><span class="link-name">${bankSlot(link.preset)} · ${escape(s.presets[link.preset]?.name || "Current pattern")}</span><input class="field-number" type="number" min="1" max="64" value="${link.repeat}" data-chain-repeat="${i}" aria-label="Link repeats ${i + 1}" ${runtime.chainEnabled ? "disabled" : ""}>${chainMuteMenu(link, i)}${iconButton("chain-delete", "close", `Remove link ${i + 1}`, `data-index="${i}" ${runtime.chainEnabled ? "disabled" : ""}`)}</div>`).join("") : '<div class="chain-empty">Add a preset to build the arrangement.<br>Each link has its own repeats and mute states.</div>'}</div><div class="chain-saved"><span>CHAIN MEMORY</span>${Array.from({ length: 8 }, (_, i) => button("chain-load", String(i + 1), `data-index="${i}" aria-label="Load chain ${i + 1}" ${!s.chains[i] || runtime.chainEnabled ? "disabled" : ""}`, s.chains[i] ? "active" : "")).join("")}${select(
    "@chainSlot",
    view.chainSlot,
    range(0, 7, (n) => "Slot " + (n + 1)),
    "Chain slot",
  )}${button("chain-save", "Save", runtime.chainEnabled ? "disabled" : "")}</div></section></div>`;
}
function scalesView() {
  const p = store.patch,
    index = view.scaleBank * 10 + view.scale,
    s = p.userScales[index],
    notes = Array.from({ length: 12 }, (_, i) => i).filter(
      (i) => s.mask & (1 << i),
    );
  return `<div class="section-heading"><div><h1>Scale library</h1><p>49 factory scales. 100 user scales with their own root.</p></div><div class="actions">${button("scale-copy", icon("copy") + "Copy")}${button("scale-paste", icon("paste") + "Paste")}</div></div><div class="scale-layout"><aside><div class="bank-tabs">${range(
    0,
    9,
  )
    .map(([i]) =>
      button(
        "scale-bank",
        String(i + 1),
        `data-bank="${i}" aria-label="Scale bank ${i + 1}"`,
        view.scaleBank === i ? "active" : "",
      ),
    )
    .join("")}</div><div class="scale-list">${range(0, 9)
    .map(([i]) =>
      button(
        "scale-slot",
        `<span>${view.scaleBank + 1}.${i + 1}</span><span>${escape(p.userScales[view.scaleBank * 10 + i].name)}</span>`,
        `data-slot="${i}"`,
        view.scale === i ? "scale-item active" : "scale-item",
      ),
    )
    .join(
      "",
    )}</div></aside><section class="scale-editor"><div class="scale-heading"><input class="scale-name" maxlength="60" data-path="userScales.${index}.name" aria-label="User scale name" value="${escape(s.name)}">${control("ROOT", `userScales.${index}.root`, options(NOTES))}</div><div class="piano" aria-label="User scale notes">${NOTES.map((note, n) => button("scale-note", note, `data-scale-note="${n}" aria-label="${note}" aria-pressed="${!!(s.mask & (1 << n))}"`, [1, 3, 6, 8, 10].includes(n) ? "black" : "")).join("")}</div><div class="scale-metadata"><span>${notes.length} NOTES</span><span>${notes.map((n) => NOTES[(n + s.root) % 12]).join(" · ") || "CHROMATIC FALLBACK"}</span></div><div class="action-row">${select("@scaleTrack", view.scaleTrack || 0, trackOptions(), "Track for scale")}${button("scale-assign-selected", "Use on track")}${button("scale-assign-all", "Use on all")}${button("scale-from-factory", "Copy current factory scale", "", "ghost")}</div></section></div>`;
}
function setupView() {
  const p = store.patch;
  const pages = [
    ["global", "Clock & transport"],
    ["midi", "MIDI"],
    ...(!runtime.hosted ? [["sound", "Monitor voices"]] : []),
    ["memory", "Memory & recall"],
    ...(runtime.hosted ? [["automation", "Automation"]] : []),
  ];
  return `<div class="section-heading"><div><h1>Setup</h1></div></div><div class="setup-layout"><aside class="setup-menu">${pages.map(([id, label]) => button("setup-page", label, `data-page="${id}"`, view.setup === id ? "active" : "")).join("")}</aside><section class="setup-content">${setupContent()}</section></div>`;
}
function setupContent() {
  const p = store.patch;
  if (view.setup === "automation" && runtime.hosted) {
    const lanes = pluginState(store.session).automation;
    return `<div class="parameter-group"><h2>DAW automation</h2><p class="drawer-note">Reset after, Preset and Chain are available directly in your DAW. For other parameters, press Learn and adjust a control.</p><div class="automation-list">${Array.from({ length: AUTOMATION_LANES }, (_, i) => `<div class="automation-row"><span class="automation-index">${String(i + 1).padStart(2, "0")}</span><span class="automation-target" title="${escape(lanes[i])}">${escape(automationLabel(lanes[i]))}</span>${button("automation-learn", runtime.automationLearn === i ? "Learning…" : "Learn", `data-index="${i}" aria-pressed="${runtime.automationLearn === i}" aria-label="Assign Automation ${i + 1}"`, runtime.automationLearn === i ? "active" : "ghost")}${iconButton("automation-clear", "close", `Clear Automation ${i + 1}`, `data-index="${i}" ${lanes[i] ? "" : "disabled"}`)}</div>`).join("")}</div></div>`;
  }
  if (view.setup === "global")
    return `<div class="parameter-group"><h2>Clock</h2><div class="control-grid">${control("SOURCE", "settings.clockSource", options(["Internal", "External CLK", "MIDI"]))}${control("EXT CLOCK DIV", "settings.externalDivision", null, { min: 1, max: 256 })}${control("CLOCK / RESET OUT", "settings.clockMode", options(["Always", "While running"]))}${control("RESET INPUT", "settings.resetInput", options(["Reset", "Run + reset", "Run / continue"]))}${control("CLOCK OUT DIV", "settings.outputDivision", null, { min: 1, max: 256 })}${control("CLOCK OUT OFFSET", "settings.outputOffset", null, { min: 0, max: p.settings.outputDivision - 1 })}${control("RUN BUTTON", "settings.runMode", options(["Run / Pause", "Run / Stop"]))}</div></div><div class="parameter-group"><h2>Outputs & display</h2><div class="control-grid">${control("CV / GATE DELAY · MS", "settings.cvDelay", null, { min: 0, max: 21 })}${control("LED LEVEL", "settings.ledLevel", range(1, 4))}${control("DISPLAY LEVEL", "settings.screenLevel", range(1, 4))}</div></div><div class="action-row">${button("reset", "Reset all tracks")}${button("panic", "All notes off")}</div>`;
  if (view.setup === "midi" && runtime.hosted)
    return `<div class="parameter-group"><h2>MIDI output</h2><div class="control-grid">${p.tracks.map((_, i) => control(`TRACK ${i + 1} CHANNEL`, `tracks.${i}.midiChannel`, [[0, "Auto"], ...range(1, 16)]) + control(`TRACK ${i + 1} CV → CC`, `tracks.${i}.cvCC`, [[-1, "Off"], ...range(0, 127)])).join("")}</div><div class="action-row">${p.tracks.map((_, i) => button("track-settings", `Track ${i + 1} MIDI`, `data-track="${i}" data-page="midi"`)).join("")}</div></div>`;
  if (view.setup === "midi") {
    const ports = runtime.midi.ports();
    return `<div class="parameter-group"><h2>MIDI ports</h2><div class="action-row">${button("midi-connect", runtime.midi.access ? "Refresh ports" : "Connect MIDI", "", "primary")}${button("export-midi", icon("download") + "Export .mid · 8 bars")}${button("panic", "All notes off", "", "ghost")}</div><div class="midi-ports"><label class="control"><span>INPUT</span>${select("@midiInput", runtime.midi.input?.id || "", [["", "None"], ...ports.inputs.map((p) => [p.id, p.name])], "MIDI input")}</label><label class="control"><span>OUTPUT</span>${select("@midiOutput", runtime.midi.output?.id || "", [["", "None"], ...ports.outputs.map((p) => [p.id, p.name])], "MIDI output")}</label></div><div class="status-banner" id="midi-status">${escape(runtime.midi.message)}${runtime.midi.access && !ports.inputs.length && !ports.outputs.length ? " · No MIDI devices found" : ""}</div></div><div class="parameter-group"><h2>Sync & remote control</h2><div class="control-grid">${control("CLOCK SOURCE", "settings.clockSource", options(["Internal", "External CLK", "MIDI"]))}${toggle("MIDI CLOCK OUT", "settings.midiClock")}${toggle("MIDI TRANSPORT", "settings.midiTransport")}${control("ROOT INPUT CH", "settings.midiRootChannel", [[0, "Off"], ...range(1, 16)])}${control("PROGRAM CHANGE CH", "settings.midiPCChannel", [[0, "Off"], ...range(1, 16)])}</div></div><div class="parameter-group"><h2>Track channels & CC</h2><div class="control-grid two">${p.tracks.map((_, i) => `<div>${control(`TRACK ${i + 1} CHANNEL`, `tracks.${i}.midiChannel`, [[0, "Off"], ...range(1, 16)])}<div style="height:16px"></div>${control("CV → CC", `tracks.${i}.cvCC`, [[-1, "Off"], ...range(0, 127)])}</div>`).join("")}</div><div class="action-row" style="margin-top:20px">${p.tracks.map((_, i) => button("track-settings", `Track ${i + 1} MIDI`, `data-track="${i}" data-page="midi"`)).join("")}</div></div>`;
  }
  if (view.setup === "sound")
    return p.tracks
      .map(
        (t, i) =>
          `<div class="sound-track" data-track="${i}"><h2>Voice ${i + 1}</h2><div class="control-grid">${control("WAVE", `tracks.${i}.voice.wave`, options(["Saw + sub", "Triangle + sub", "Square + sub", "Sine + sub"]))}${control("CUTOFF · HZ", `tracks.${i}.voice.cutoff`, null, { min: 60, max: 16000 })}${control("RESONANCE", `tracks.${i}.voice.resonance`, null, { min: 0, max: 20 })}${control("LEVEL", `tracks.${i}.volume`, null, { min: 0, max: 100 })}${control("ATTACK · MS", `tracks.${i}.voice.attack`, null, { min: 1, max: 500 })}${control("DECAY · MS", `tracks.${i}.voice.decay`, null, { min: 10, max: 3000 })}${control("SUSTAIN · %", `tracks.${i}.voice.sustain`, null, { min: 0, max: 100 })}${control("RELEASE · MS", `tracks.${i}.voice.release`, null, { min: 5, max: 4000 })}</div></div>`,
      )
      .join("");
  return `<div class="parameter-group"><h2>Preset recall</h2><div class="control-grid">${control("PITCH LOAD", "settings.pitchLoad", options(["Off", "Thru · pickup", "Jump"]))}${control("SWITCH LOAD", "settings.switchLoad", options(["Off", "Jump"]))}${control("CTRL LOAD", "settings.ctrlLoad", options(["Off", "Assignments", "Thru · pickup", "Jump"]))}${control("AUX LOAD", "settings.auxLoad", options(["Off", "Assignments"]))}${control("LOAD DELAY", "settings.loadMode", options(["Instant", "Queue pulses", "Global cycle"]))}${control("QUEUE PULSES", "settings.queuePulses", null, { min: 0, max: 4096 })}${control("INIT PRESET", "settings.initPreset", [[-1, "Factory init"], ...store.session.presets.map((p, i) => (p ? [i, bankSlot(i) + " · " + p.name] : null)).filter(Boolean)])}</div></div><div class="parameter-group"><h2>Files</h2><div class="action-row">${button("export-patch", "Export current pattern")}${button("export-backup", "Export full backup")}${button("import", "Import pattern / backup")}</div><p class="drawer-note">Backup stores the current pattern, all 64 presets, eight chain memories and 100 user scales.</p></div><div class="parameter-group"><h2>Initialize</h2><div class="action-row">${button("init-patch", "Initialize current pattern")}${button("load-demo", "Load demo", "", "ghost")}</div></div>`;
}
function renderDrawer() {
  const el = $("#overlay");
  if (view.drawer === null) {
    el.innerHTML = "";
    return;
  }
  const i = view.drawer,
    t = store.patch.tracks[i],
    pre = `tracks.${i}`,
    tabs = [
      ["timing", "Timing"],
      ["pitch", "Pitch"],
      ["gate", "Gate"],
      ["accum", "Accum"],
      ["midi", "MIDI"],
      ["stage", "Stage"],
    ];
  let content = "";
  const group = (name, body) =>
    `<div class="parameter-group"><h3>${name}</h3><div class="control-grid two">${body}</div></div>`;
  if (view.drawerTab === "timing")
    content =
      `<label class="control track-name"><span>NAME</span><input class="field-number" maxlength="60" data-path="${pre}.name" value="${escape(t.name)}" aria-label="Track name ${i + 1}"></label>` +
      group(
        "PLAYBACK",
        control(
          "ORDER",
          `${pre}.order`,
          catalog.orders.map((o) => [o.id, o.name]),
        ) +
          control(
            "DIRECTION",
            `${pre}.reverse`,
            options(["Forward", "Reverse"]),
          ) +
          control("STAGES", `${pre}.length`, range(1, 16)) +
          control(
            "OFFSET",
            `${pre}.offset`,
            range(0, 15, (n) => "+" + n),
          ) +
          control("PULSE LENGTH", `${pre}.pulseLength`, [
            [0, "Auto"],
            ...range(1, 64),
          ]) +
          control(
            "CLOCK DIVISION",
            `${pre}.division`,
            TRACK_CLOCK_DIVISIONS.map((n) => [n, "÷" + n]),
          ) +
          control(
            "PULSE COUNT DIV",
            `${pre}.pulseDivision`,
            range(1, 8, (n) => "÷" + n),
          ) +
          control("SWING · %", `${pre}.swing`, null, { min: 50, max: 78 }),
      ) +
      group(
        "SLIDE",
        control("SLIDE AMOUNT", `${pre}.slideAmount`, null, {
          min: 0,
          max: 100,
        }) +
          control(
            "SLIDE TYPE",
            `${pre}.slideType`,
            options(["Analog", "Tempo", "Acid"]),
          ),
      ) +
      group("RESET", toggle("GLOBAL RESET", `${pre}.globalReset`));
  if (view.drawerTab === "pitch")
    content =
      group(
        "QUANTIZER",
        control("SCALE", `${pre}.scale`, scaleOptions()) +
          control("ROOT", `${pre}.root`, options(NOTES)) +
          control("TRANSPOSE · ST", `${pre}.transpose`, null, {
            min: -60,
            max: 60,
          }) +
          control(
            "REST PITCH",
            `${pre}.restPitch`,
            options(["Hold previous", "Update"]),
          ) +
          control("LOWEST MIDI NOTE", `${pre}.minNote`, null, {
            min: 0,
            max: 127,
          }) +
          control("HIGHEST MIDI NOTE", `${pre}.maxNote`, null, {
            min: 0,
            max: 127,
          }),
      ) +
      group(
        "FADERS",
        control("RANGE · OCTAVES", `${pre}.sliderOctaves`, range(1, 4)) +
          control(
            "DIRECTION",
            `${pre}.sliderInvert`,
            options(["Normal", "Inverted"]),
          ) +
          control("BOTTOM MIDI NOTE", `${pre}.bottomPitch`, null, {
            min: 0,
            max: 108,
          }),
      );
  if (view.drawerTab === "gate")
    content =
      group(
        "GATE LENGTH",
        control("GATE · % / HOLD", `${pre}.gateLength`, null, {
          min: 0,
          max: 100,
        }) +
          control("GATE SCALE · %", `${pre}.gateScale`, null, {
            min: 0,
            max: 100,
          }) +
          toggle("GATE STRETCHING", `${pre}.stretch`) +
          control(
            "STRETCHED RATCHETS",
            `${pre}.ratchetMode`,
            options(["Multiply", "Pulse", "Gated"]),
          ),
      ) +
      group(
        "PANEL OVERRIDES",
        control("PULSE COUNT", `${pre}.pulseOverride`, [
          [0, "Panel switches"],
          ...range(1, 8),
        ]) +
          control(
            "GATE TYPE",
            `${pre}.gateOverride`,
            options([
              "Panel switches",
              "Single",
              "Single + rests",
              "Multi",
              "Multi + rests",
              "Hold",
              "Hold + rests",
            ]),
          ),
      ) +
      group(
        "CV LANE",
        control(
          "CV TYPE",
          `${pre}.cvType`,
          options(["Bipolar ±5V", "Unipolar 0–5V", "Gate toggle"]),
        ),
      );
  if (view.drawerTab === "accum")
    content =
      group(
        "ACCUMULATOR",
        control(
          "MODE",
          `${pre}.accumulatorScope`,
          options(["Per stage", "Whole track"]),
        ) +
          control(
            "ORDER",
            `${pre}.accumulatorMode`,
            options(["Wrap", "Pendulum", "Random walk", "Hold"]),
          ) +
          control("POSITIVE LIMIT · °", `${pre}.accumulatorLimit`, null, {
            min: 1,
            max: 28,
          }) +
          control("NEGATIVE LIMIT · °", `${pre}.accumulatorNegative`, null, {
            min: 1,
            max: 28,
          }) +
          control(
            "POLARITY",
            `${pre}.accumulatorPolarity`,
            options(["Unipolar", "Bipolar"]),
          ) +
          control(
            "RESET",
            `${pre}.accumulatorReset`,
            options(["Manual", "Auto", "AUX / MOD only", "After stages"]),
          ) +
          (t.accumulatorReset === 3
            ? control(
                "RESET AFTER · STAGES",
                `${pre}.accumulatorStages`,
                null,
                {
                  min: 1,
                  max: 1024,
                },
              )
            : ""),
      ) +
      `<div class="action-row">${button("reset-accumulator", "Reset accumulator", `data-track="${i}"`)}${button("reset-track", "Reset track", `data-track="${i}"`)}</div>`;
  if (view.drawerTab === "midi")
    content =
      group(
        "MIDI OUTPUT",
        control("CHANNEL", `${pre}.midiChannel`, [
          [0, "Off"],
          ...range(1, 16),
        ]) +
          control(
            "VELOCITY SOURCE",
            `${pre}.velocitySource`,
            options(["Static", "Track CV"]),
          ) +
          control("VELOCITY · %", `${pre}.velocity`, null, {
            min: 0,
            max: 100,
          }) +
          control("CV → CC", `${pre}.cvCC`, [[-1, "Off"], ...range(0, 127)]),
      ) +
      group(
        "PORTAMENTO CC",
        control("SLIDE TOGGLE CC", `${pre}.slideCC`, [
          [-1, "Off"],
          ...range(0, 127),
        ]) +
          control("SLIDE AMOUNT CC", `${pre}.slideAmountCC`, [
            [-1, "Off"],
            ...range(0, 127),
          ]) +
          control(
            "AMOUNT TRANSMISSION",
            `${pre}.slideCCMode`,
            options(["Toggle with stage", "Always"]),
          ),
      );
  if (view.drawerTab === "stage") {
    const n = view.selectedStage[i],
      s = t.steps[n],
      sp = `${pre}.steps.${n}`;
    content =
      `<div style="margin-bottom:20px">${select(
        "@stage",
        n,
        range(0, 15, (n) => "Stage " + String(n + 1).padStart(2, "0")),
        "Selected stage",
      )}</div>` +
      group(
        "STAGE " + String(n + 1).padStart(2, "0"),
        control("PITCH OVERRIDE", `${sp}.pitchOverride`, [
          [-1, "Panel fader"],
          ...range(0, 127, (n) => noteName(n)),
        ]) +
          control("GATE OVERRIDE", `${sp}.gateOverride`, [
            [-1, "Track gate"],
            [0, "Rest"],
            ...range(1, 99, (n) => n + "%"),
            [100, "Hold"],
          ]) +
          control(
            "RATCHETS",
            `${sp}.ratchet`,
            range(1, 8, (n) => "×" + n),
          ) +
          control("PROBABILITY · %", `${sp}.probability`, null, {
            min: 0,
            max: 100,
          }) +
          control(
            "PROBABILITY TARGET",
            `${sp}.probabilityTarget`,
            options(["Stage", "Pulse"]),
          ) +
          control("ACCUMULATE · °", `${sp}.accumulate`, null, {
            min: -28,
            max: 28,
          }) +
          control(
            "ACCUM TRIGGER",
            `${sp}.accumulateTrigger`,
            options(["Stage", "Pulse", "Ratchet"]),
          ) +
          control("CV · MV", `${sp}.cv`, null, { min: -5000, max: 5000 }) +
          control(
            "CV RAMP",
            `${sp}.cvRamp`,
            options(["Step", "Stage ramp", "Pulse ramp"]),
          ) +
          toggle("CV GATE", `${sp}.cvGate`) +
          toggle("SLIDE", `${sp}.slide`) +
          toggle("SKIP", `${sp}.skip`),
      ) +
      `<div class="action-row">${button("copy-stage", icon("copy") + "Copy stage", `data-track="${i}" data-stage="${n}"`)}${button("paste-stage", icon("paste") + "Paste stage", `data-track="${i}" data-stage="${n}"`)}${button("sync-pitch", "Sync pitch to fader", `data-track="${i}" data-stage="${n}"`)}</div>`;
  }
  el.innerHTML = `<div class="drawer-backdrop" data-dismiss="true"><aside class="drawer" role="dialog" aria-modal="true" aria-label="Track settings ${i + 1}" data-track="${i}"><header class="drawer-heading"><h2>Track ${i + 1} / ${escape(t.name)}</h2>${iconButton("drawer-close", "close", "Close settings")}</header><div class="drawer-tabs">${tabs.map(([id, label]) => button("drawer-tab", label, `data-page="${id}"`, view.drawerTab === id ? "active" : "")).join("")}</div>${view.drawerTab !== "midi" ? `<div class="action-row drawer-random">${button("settings-random", icon("random") + "Randomize")}${button("settings-morph", icon("morph") + "Morph")}${button("settings-revert", "Restore", view.randomSnapshots.has(randomGroup("settings", i).id) ? "" : "disabled")}</div>` : ""}${content}</aside></div>`;
}
function refreshOwnedDisplays() {
  const tempo = document.querySelector('[data-path="tempo"]');
  if (tempo && document.activeElement !== tempo)
    tempo.value = store.patch.tempo;
  document.querySelectorAll(".ctrl-owned[data-binding]").forEach((label) => {
    const value = read(label.dataset.binding),
      input = label.querySelector("input");
    if (input) input.value = value;
    const selected = label.querySelector(
        `[data-select][data-value="${value}"]`,
      ),
      summary = label.querySelector("summary");
    if (selected && summary?.firstChild)
      summary.firstChild.textContent = selected.textContent.trim();
  });
}
function updateReadouts(path) {
  for (const action of ["undo", "redo"]) {
    const available =
      action === "undo" ? store.undoStack.length : store.redoStack.length;
    document.querySelectorAll(`[data-action="${action}"]`).forEach((button) => {
      button.disabled = !available;
    });
  }
  const dirty = document.querySelector(".dirty-dot");
  if (dirty) dirty.hidden = !store.dirty;
  const value = read(path);
  if (runtime?.hosted && view.solo >= 0) applySolo();
  if (path === "totalPulses") {
    const unit = document.querySelector(".cycle-unit");
    if (unit) unit.textContent = value ? "STEPS" : "OFF";
    paintFrame(runtime.lastFrame || runtime.frame());
  }
  document.querySelectorAll(`[data-readout="${path}"]`).forEach((el) => {
    el.textContent = path.endsWith(".amount")
      ? signed(value) + "%"
      : voltage(value) + (path.startsWith("aux.") ? "V" : "");
  });
  if (path.startsWith("controls.")) {
    refreshOwnedDisplays();
    const i = path.split(".")[1],
      knob = document.querySelector(`[data-knob="${i}"]`);
    if (knob)
      knob.style.setProperty("--rotation", (value / 5000) * 135 + "deg");
  }
  const step = path.match(/^tracks\.(\d+)\.steps\.(\d+)\.(\w+)$/);
  if (step) {
    const [, i, n, key] = step;
    if (key === "pitch") {
      const output = document.querySelector(`[data-stage-note="${i}-${n}"]`);
      if (output)
        output.textContent = noteName(
          runtime.engine.engine_preview(+i, +n, 0) / 100,
        );
    }
    if (key === "pulses" || key === "gate") refreshStageSwitch(path, value);
  }

  if (path === "settings.ledLevel")
    document.documentElement.style.setProperty(
      "--led-level",
      0.4 + value * 0.15,
    );
  if (path === "settings.screenLevel")
    document.documentElement.style.setProperty(
      "--display-level",
      0.55 + value * 0.15,
    );
}
function setPath(path, value, remember = false) {
  if (remember) store.remember();
  const parts = path.split("."),
    old = read(path),
    parent = parts.slice(0, -1).reduce((o, k) => o[k], store.patch),
    key = parts.at(-1);
  if (typeof old === "number") {
    if (!Number.isFinite(+value)) return;
    value = +value;
    if (path !== "tempo" && !/^tracks\.\d+\.division$/.test(path))
      value = Math.round(value);
  }
  if (typeof old === "string")
    value = String(value).slice(0, path.endsWith(".name") ? 60 : 80);
  if (typeof old === "boolean") value = !!value;
  if (
    parts[0] === "tracks" &&
    parts[2] === "root" &&
    store.patch.tracks[+parts[1]].scale >= 49
  ) {
    const idx = store.patch.tracks[+parts[1]].scale - 49;
    store.patch.userScales[idx].root = value;
    runtime.engine.engine_set_scale(
      idx + 49,
      store.patch.userScales[idx].mask,
      value,
    );
  } else {
    if (
      parts[0] === "tracks" &&
      parts[2] === "steps" &&
      key === "pitch" &&
      !store.acceptPickup(`pitch:${parts[1]}:${parts[3]}`, value)
    ) {
      updateReadouts(path);
      return;
    }
    if (
      parts[0] === "controls" &&
      key === "value" &&
      !store.acceptPickup(`control:${parts[1]}`, value)
    ) {
      updateReadouts(path);
      return;
    }
    parent[key] = value;
    if (parts[0] === "outputs" && key === "kind")
      parent.source %= [7, 8, 18].includes(value)
        ? 8
        : store.patch.tracks.length;
    if (parts[0] === "outputs" && key === "sink" && value > 0) {
      store.patch.outputs.forEach((o, i) => {
        if (i !== +parts[1] && o.sink === value) o.sink = 0;
      });
    }
    if (path === "mx.mode") normalizeTrackReferences(store.patch);
    if (parts[0] === "tracks") {
      const t = +parts[1];
      if (parts[2] === "steps")
        runtime.engine.engine_set_step(
          t,
          +parts[3],
          STEP_KEYS.indexOf(key),
          value,
        );
      else if (TRACK_KEYS.includes(key))
        runtime.engine.engine_set_track(
          t,
          TRACK_KEYS.indexOf(key),
          key === "division" ? encodeTrackDivision(value) : value,
        );
      else if (key === "volume") runtime.audio.update(store.patch);
      else if (parts[2] === "voice")
        runtime.audio.update(store.patch, { track: t, field: key });
    } else if (parts[0] === "mods") {
      const m = +parts[1];
      if (parts[2] === "steps")
        runtime.engine.engine_set_mod_step(
          m,
          +parts[3],
          ["value", "ramp", "gate"].indexOf(key),
          value,
        );
      else runtime.engine.engine_set_mod(m, MOD_KEYS.indexOf(key), value);
    } else if (parts[0] === "controls" || parts[0] === "aux") {
      runtime.engine.engine_set_route(
        parts[0] === "controls" ? 0 : 1,
        +parts[1],
        ["destination", "target", "value", "amount"].indexOf(key),
        value,
      );
      if (parts[0] === "controls") applyControlDefaults();
    } else if (parts[0] === "userScales") {
      const i = +parts[1],
        s = store.patch.userScales[i];
      runtime.engine.engine_set_scale(i + 49, s.mask, s.root);
    } else if (parts[0] === "outputs") {
      const i = +parts[1],
        o = store.patch.outputs[i];
      runtime.engine.engine_set_output(i, o.kind, o.source);
      runtime.audio.update(store.patch);
    } else if (path === "tempo")
      runtime.engine.engine_set_global(0, Math.round(value * 1000));
    else if (path === "totalPulses") runtime.engine.engine_set_global(1, value);
    else if (path === "settings.clockSource") {
      runtime.engine.engine_set_global(8, value ? 1 : 0);
      runtime.engine.engine_set_global(0, Math.round(store.patch.tempo * 1000));
    } else if (path === "settings.outputDivision") {
      runtime.engine.engine_set_global(2, value);
      store.patch.settings.outputOffset = Math.min(
        store.patch.settings.outputOffset,
        value - 1,
      );
      runtime.engine.engine_set_global(3, store.patch.settings.outputOffset);
    } else if (path === "settings.outputOffset")
      runtime.engine.engine_set_global(3, value);
    else if (parts[0] === "mx") {
      ["mode", "source", "bank", "channel"].forEach((k, i) =>
        runtime.engine.engine_set_global(i + 4, store.patch.mx[k]),
      );
    } else if (parts[0] === "loopy") {
      runtime.engine.engine_set_global(9, store.patch.loopy.pulses);
      runtime.engine.engine_set_global(10, store.patch.loopy.target);
      if (!store.patch.loopy.enabled || !store.patch.loopy.latch)
        runtime.clearLoop();
    }
  }
  runtime.automate?.(path, value);
  store.changed();
  updateReadouts(path);
  if (view.solo >= 0) applySolo();
}
function applySolo() {
  if (runtime?.hosted) {
    runtime.setSolo(view.solo);
    return;
  }
  if (view.solo >= store.patch.tracks.length) view.solo = -1;
  store.patch.tracks.forEach((t, i) =>
    runtime.engine.engine_set_track(
      i,
      8,
      Number(
        t.mute ||
          (runtime.chainEnabled &&
            chainTrackMuted(store.session.chain[runtime.chainIndex], i)) ||
          (view.solo >= 0 && i !== view.solo),
      ),
    ),
  );
}
function syncAfterEdit(reset = false) {
  runtime.sync(reset);
  if (view.solo >= 0) applySolo();
  render();
}
function download(bytes, name, type) {
  if (pluginBridge) {
    pluginBridge.file(bytes, name, type);
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function layerKeys(track) {
  const key = view.lanes[track] || "pitch";
  if (key === "probability") return ["probability", "probabilityTarget"];
  if (key === "accumulate") return ["accumulate", "accumulateTrigger"];
  if (key === "cv")
    return store.patch.tracks[track].cvType === 2
      ? ["cvGate"]
      : ["cv", "cvRamp"];
  return [key];
}
function randomGroup(target, track) {
  if (target === "mod") {
    const m = store.patch.mods[view.mod],
      keys =
        GATE_DESTINATIONS.has(m.destination) || m.cvType === 2
          ? ["gate"]
          : ["value", "ramp"];
    return {
      id: `mod:${view.mod}:${keys[0]}`,
      objects: m.steps,
      keys,
      ranges: keys.map((k) =>
        k === "value" ? (m.cvType === 1 ? [0, 5000] : [-5000, 5000]) : [0, 1],
      ),
      defaults: emptyMod().steps[0],
    };
  }
  if (target === "settings") {
    const categories = {
      timing: [
        "order",
        "length",
        "reverse",
        "division",
        "offset",
        "pulseDivision",
        "swing",
        "slideAmount",
        "slideType",
      ],
      pitch: [
        "scale",
        "root",
        "transpose",
        "restPitch",
        "sliderOctaves",
        "sliderInvert",
        "bottomPitch",
      ],
      gate: [
        "gateLength",
        "gateScale",
        "stretch",
        "ratchetMode",
        "pulseOverride",
        "gateOverride",
        "cvType",
      ],
      accum: [
        "accumulatorScope",
        "accumulatorMode",
        "accumulatorLimit",
        "accumulatorNegative",
        "accumulatorPolarity",
        "accumulatorReset",
        "accumulatorStages",
      ],
      stage: STEP_KEYS,
    };
    const keys = (categories[view.drawerTab] || []).filter(
        (k) =>
          view.drawerTab === "stage" ||
          controlOwner(`tracks.${track}.${k}`) < 0,
      ),
      stage = view.drawerTab === "stage";
    return {
      id: `settings:${track}:${view.drawerTab}:${stage ? view.selectedStage[track] : ""}`,
      objects: [
        stage
          ? store.patch.tracks[track].steps[view.selectedStage[track]]
          : store.patch.tracks[track],
      ],
      keys,
      ranges: keys.map((k) =>
        stage
          ? STEP_RANGES[STEP_KEYS.indexOf(k)]
          : TRACK_RANGES[TRACK_KEYS.indexOf(k)],
      ),
      defaults: stage ? emptyStep() : emptyTrack(track),
    };
  }
  const keys = layerKeys(track);
  return {
    id: `track:${track}:${keys.join(",")}`,
    objects: store.patch.tracks[track].steps,
    keys,
    ranges: keys.map((k) => STEP_RANGES[STEP_KEYS.indexOf(k)]),
    defaults: emptyStep(),
  };
}
function randomize(target, track, mode) {
  const group = randomGroup(target, track);
  if (!group.keys.length) return;
  store.remember();
  if (mode === "revert") {
    const before = view.randomSnapshots.get(group.id);
    if (!before) return;
    group.objects.forEach((o, i) =>
      group.keys.forEach((k) => (o[k] = before[i][k])),
    );
    view.randomSnapshots.delete(group.id);
  } else {
    if (!view.randomSnapshots.has(group.id))
      view.randomSnapshots.set(
        group.id,
        group.objects.map((o) =>
          Object.fromEntries(group.keys.map((k) => [k, o[k]])),
        ),
      );
    group.objects.forEach((o) =>
      group.keys.forEach((key, i) => {
        const [min, max] = group.ranges[i];
        if (mode === "reset") {
          o[key] = group.defaults[key];
          return;
        }
        if (key === "division") {
          const index = TRACK_CLOCK_DIVISIONS.indexOf(o[key]);
          const next =
            mode === "morph"
              ? clamp(
                  index + Math.round((Math.random() * 2 - 1) * 6),
                  0,
                  TRACK_CLOCK_DIVISIONS.length - 1,
                )
              : Math.floor(Math.random() * TRACK_CLOCK_DIVISIONS.length);
          o[key] = TRACK_CLOCK_DIVISIONS[next];
          return;
        }
        if (mode === "morph") {
          if (max - min < 10) {
            if (Math.random() < 0.2)
              o[key] = clamp(o[key] + (Math.random() < 0.5 ? -1 : 1), min, max);
          } else
            o[key] = clamp(
              Math.round(o[key] + (Math.random() * 2 - 1) * (max - min) * 0.1),
              min,
              max,
            );
        } else o[key] = Math.round(min + Math.random() * (max - min));
      }),
    );
  }
  store.changed();
  syncAfterEdit();
}
async function action(el, event) {
  const a = el.dataset.action,
    t = Number(el.dataset.track),
    n = Number(el.dataset.stage),
    slot = Number(el.dataset.slot),
    index = Number(el.dataset.index),
    p = store.patch;
  if (a === "automation-learn" || a === "automation-cancel") {
    runtime.automationLearn =
      a === "automation-cancel" || runtime.automationLearn === index
        ? -1
        : index;
    render();
    return;
  }
  if (a === "automation-clear") {
    store.remember();
    pluginState(store.session).automation[index] = "";
    store.changed();
    render();
    return;
  }
  if (a === "add-track" || a === "duplicate-track") {
    const added = store.addTrack(a === "duplicate-track" ? t : null);
    view.lanes[added] = "";
    view.selectedStage[added] = 0;
    runtime.sync(false);
    applySolo();
    render();
    document
      .querySelector(`.track[data-track="${added}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return;
  }
  if (a === "remove-track") {
    if (store.removeTrack(t)) {
      view.lanes.splice(t, 1);
      view.selectedStage.splice(t, 1);
      view.drawer = null;
      view.solo =
        view.solo === t ? -1 : view.solo > t ? view.solo - 1 : view.solo;
      runtime.removeTrack(t);
      applySolo();
      render();
      notify("Track removed · Undo available");
    }
    return;
  }
  if (a === "play") {
    await runtime.toggle();
    return;
  }
  if (a === "reset") {
    runtime.reset();
    return;
  }
  if (a === "tab") {
    view.tab = el.dataset.tab;
    render();
    return;
  }
  if (a === "drawer-close") {
    view.drawer = null;
    renderDrawer();
    return;
  }
  if (a === "drawer-tab") {
    view.drawerTab = el.dataset.page;
    renderDrawer();
    return;
  }
  if (a === "track-settings") {
    view.drawer = t;
    if (el.dataset.page) view.drawerTab = el.dataset.page;
    renderDrawer();
    return;
  }
  if (a === "lane") {
    view.lanes[t] = view.lanes[t] === el.dataset.lane ? "" : el.dataset.lane;
    render();
    return;
  }
  if (a === "stage") {
    if (p.loopy.enabled) return;
    if (event.shiftKey) {
      view.selectedStage[t] = n;
      view.drawer = t;
      view.drawerTab = "stage";
      renderDrawer();
    } else await runtime.audition(t, n);
    return;
  }
  if (a === "pad") return;
  if (a === "solo") {
    view.solo = view.solo === t ? -1 : t;
    applySolo();
    render();
    return;
  }
  if (a === "cycle-sub") {
    const key = el.dataset.key;
    setPath(
      `tracks.${t}.steps.${n}.${key}`,
      (p.tracks[t].steps[n][key] + 1) % (+el.dataset.max + 1),
      true,
    );
    render();
    return;
  }
  if (a === "cv-gate") {
    setPath(
      `tracks.${t}.steps.${n}.cvGate`,
      1 - p.tracks[t].steps[n].cvGate,
      true,
    );
    render();
    return;
  }
  if (a === "sync-pitch") {
    setPath(
      `tracks.${t}.steps.${n}.pitchOverride`,
      clamp(
        Math.round(
          pitchAt(p.tracks[t], { ...p.tracks[t].steps[n], pitchOverride: -1 }),
        ),
        0,
        127,
      ),
      true,
    );
    render();
    return;
  }
  if (a === "undo" || a === "redo") {
    if (store[a]()) {
      runtime.clearLoop();
      syncAfterEdit(true);
    }
    return;
  }
  if (a === "loopy") {
    setPath("loopy.enabled", !p.loopy.enabled, true);
    if (!p.loopy.enabled) runtime.clearLoop();
    render();
    return;
  }
  if (a === "copy-track") {
    view.clipboard = { type: "track", value: structuredClone(p.tracks[t]) };
    notify("Track copied");
    return;
  }
  if (a === "paste-track") {
    if (view.clipboard?.type === "track") {
      store.remember();
      p.tracks[t] = structuredClone(view.clipboard.value);
      store.changed();
      syncAfterEdit();
    }
    return;
  }
  if (a === "copy-stage") {
    view.clipboard = {
      type: "stage",
      value: structuredClone(p.tracks[t].steps[n]),
    };
    notify("Stage copied");
    return;
  }
  if (a === "paste-stage") {
    if (view.clipboard?.type === "stage") {
      store.remember();
      p.tracks[t].steps[n] = structuredClone(view.clipboard.value);
      store.changed();
      syncAfterEdit();
    }
    return;
  }
  if (a === "copy-lane") {
    const keys = layerKeys(t);
    view.clipboard = {
      type: "lane",
      keys,
      value: p.tracks[t].steps.map((s) =>
        Object.fromEntries(keys.map((k) => [k, s[k]])),
      ),
    };
    notify("Layer copied");
    return;
  }
  if (a === "paste-lane") {
    if (view.clipboard?.type === "lane") {
      const keys = layerKeys(t);
      if (keys.join(",") !== view.clipboard.keys.join(",")) {
        notify("Copy the same layer type first");
        return;
      }
      store.remember();
      p.tracks[t].steps.forEach((s, i) =>
        keys.forEach((k) => (s[k] = view.clipboard.value[i][k])),
      );
      store.changed();
      syncAfterEdit();
    }
    return;
  }
  if (a.startsWith("lane-rotate")) {
    store.remember();
    const keys = layerKeys(t),
      values = p.tracks[t].steps.map((s) =>
        Object.fromEntries(keys.map((k) => [k, s[k]])),
      );
    if (a.endsWith("left")) values.push(values.shift());
    else values.unshift(values.pop());
    p.tracks[t].steps.forEach((s, i) =>
      keys.forEach((k) => (s[k] = values[i][k])),
    );
    store.changed();
    syncAfterEdit();
    return;
  }
  if (a === "lane-random" || a === "lane-morph" || a === "lane-reset") {
    randomize("track", t, a.split("-")[1]);
    return;
  }
  if (a === "lane-revert") {
    randomize("track", t, "revert");
    return;
  }
  if (a.startsWith("settings-")) {
    randomize("settings", view.drawer, a.slice(9));
    return;
  }
  if (a === "select-mod") {
    view.mod = +el.dataset.mod;
    render();
    return;
  }
  if (a === "mod-copy") {
    view.clipboard = { type: "mod", value: structuredClone(p.mods[view.mod]) };
    notify("MOD lane copied");
    return;
  }
  if (a === "mod-paste") {
    if (view.clipboard?.type === "mod") {
      store.remember();
      p.mods[view.mod] = structuredClone(view.clipboard.value);
      store.changed();
      syncAfterEdit();
    }
    return;
  }
  if (a === "mod-reset") {
    store.remember();
    p.mods[view.mod] = emptyMod();
    store.changed();
    syncAfterEdit();
    return;
  }
  if (a === "mod-random" || a === "mod-morph" || a === "mod-revert") {
    randomize("mod", 0, a.split("-")[1]);
    return;
  }
  if (a === "preset-bank") {
    view.bank = +el.dataset.bank;
    render();
    return;
  }
  if (a === "preset-load") {
    runtime.requestPreset(slot);
    return;
  }
  if (a === "preset-save") {
    if (runtime.chainEnabled || runtime.queued !== null) return;
    store.savePreset(slot);
    notify("Saved " + bankSlot(slot));
    render();
    return;
  }
  if (a === "preset-clear") {
    if (runtime.chainEnabled || runtime.queued !== null) return;
    store.clearPreset(slot);
    notify("Cleared " + bankSlot(slot) + " · Undo available");
    render();
    return;
  }
  if (a === "quick-save") {
    if (runtime.chainEnabled || runtime.queued !== null) {
      view.tab = "presets";
      render();
      return;
    }
    let target = store.session.currentPreset;
    if (target < 0) target = store.session.presets.findIndex((p) => p === null);
    if (target < 0) {
      view.tab = "presets";
      render();
      return;
    }
    store.savePreset(target);
    notify("Saved " + bankSlot(target));
    render();
    return;
  }
  if (a === "chain-add") {
    if (runtime.chainEnabled || store.session.chain.length >= 32) return;
    store.remember();
    store.session.chain.push({ preset: view.chainPreset, repeat: 1, mute: 0 });
    store.changed();
    render();
    return;
  }
  if (a === "chain-delete") {
    if (runtime.chainEnabled) return;
    store.remember();
    store.session.chain.splice(index, 1);
    store.changed();
    render();
    return;
  }
  if (a === "chain-mute-track") {
    if (runtime.chainEnabled) return;
    store.remember();
    const link = store.session.chain[index],
      muted = new Set(link.mutedTracks || []);
    if (muted.has(t)) muted.delete(t);
    else muted.add(t);
    link.mutedTracks = [...muted];
    store.changed();
    render();
    return;
  }
  if (a === "chain-mute") {
    if (runtime.chainEnabled) return;
    store.remember();
    store.session.chain[index].mute ^= 1 << +el.dataset.bit;
    store.changed();
    render();
    return;
  }
  if (a === "chain-toggle") {
    runtime.enableChain(!runtime.chainEnabled);
    return;
  }
  if (a === "chain-save") {
    store.remember();
    store.session.chains[view.chainSlot] = structuredClone(store.session.chain);
    store.changed();
    notify("Chain saved to " + (view.chainSlot + 1));
    render();
    return;
  }
  if (a === "chain-load") {
    if (store.session.chains[index]) {
      store.setChain(store.session.chains[index]);
      notify("Chain " + (index + 1) + " loaded");
      render();
    }
    return;
  }
  if (a === "scale-bank") {
    view.scaleBank = +el.dataset.bank;
    render();
    return;
  }
  if (a === "scale-slot") {
    view.scale = slot;
    render();
    return;
  }
  if (a === "scale-note") {
    const idx = view.scaleBank * 10 + view.scale;
    setPath(
      `userScales.${idx}.mask`,
      p.userScales[idx].mask ^ (1 << +el.dataset.scaleNote),
      true,
    );
    render();
    return;
  }
  if (a === "scale-copy") {
    view.clipboard = {
      type: "scale",
      value: structuredClone(p.userScales[view.scaleBank * 10 + view.scale]),
    };
    notify("Scale copied");
    return;
  }
  if (a === "scale-paste") {
    if (view.clipboard?.type === "scale") {
      store.remember();
      const i = view.scaleBank * 10 + view.scale;
      p.userScales[i] = structuredClone(view.clipboard.value);
      runtime.engine.engine_set_scale(
        i + 49,
        p.userScales[i].mask,
        p.userScales[i].root,
      );
      store.changed();
      render();
    }
    return;
  }
  if (a === "scale-from-factory") {
    const source = p.tracks[view.auditionTrack],
      factory = catalog.scales[Math.min(48, source.scale)],
      idx = view.scaleBank * 10 + view.scale;
    store.remember();
    p.userScales[idx] = {
      name: factory.name,
      mask: factory.mask,
      root: source.root,
    };
    runtime.engine.engine_set_scale(idx + 49, factory.mask, source.root);
    store.changed();
    render();
    return;
  }
  if (a.startsWith("scale-assign-")) {
    store.remember();
    const scale = 49 + view.scaleBank * 10 + view.scale;
    if (a.endsWith("all"))
      p.tracks.forEach((_, i) => setPath(`tracks.${i}.scale`, scale));
    else setPath(`tracks.${view.scaleTrack || 0}.scale`, scale);
    render();
    return;
  }
  if (a === "setup-page") {
    view.setup = el.dataset.page;
    render();
    return;
  }
  if (a === "midi-connect") {
    await runtime.connectMidi();
    return;
  }
  if (a === "panic") {
    runtime.audio.stop();
    runtime.midi.panic();
    notify("All notes off");
    return;
  }
  if (a === "clock-in") {
    await runtime.ready();
    await runtime.inputClock();
    return;
  }
  if (a === "reset-in") {
    await runtime.ready();
    if (p.settings.resetInput === 0) runtime.reset();
    else if (runtime.playing) runtime.stop();
    else {
      if (p.settings.resetInput === 1) runtime.reset();
      await runtime.start();
    }
    return;
  }
  if (a === "tuner") {
    await runtime.tune(!runtime.tuner, view.tuneNote ?? 48, !!view.tuneClock);
    return;
  }
  if (a === "reset-accumulator") {
    runtime.engine.engine_reset_track(t, 1);
    notify("Accumulator reset");
    return;
  }
  if (a === "reset-track") {
    runtime.engine.engine_reset_track(t, 0);
    notify("Track " + (t + 1) + " reset");
    return;
  }
  if (a === "export-patch") {
    download(
      JSON.stringify(p, null, 2),
      "neuropolis-pattern.json",
      "application/json",
    );
    notify("Pattern exported");
    return;
  }
  if (a === "export-backup") {
    store.flush();
    download(
      JSON.stringify(store.backup()),
      "neuropolis-backup.json",
      "application/json",
    );
    notify("Full backup exported");
    return;
  }
  if (a === "export-midi") {
    notify("Rendering MIDI…");
    const data = await runtime.exportMidi(8);
    download(data, "neuropolis.mid", "audio/midi");
    notify("MIDI exported · 8 bars");
    return;
  }
  if (a === "import") {
    $("#import-file").click();
    return;
  }
  if (a === "init-patch") {
    runtime.stop();
    runtime.chainEnabled = false;
    store.init();
    runtime.clearLoop();
    syncAfterEdit(true);
    notify("Pattern initialized · Undo available");
    return;
  }
  if (a === "import-legacy") {
    const old = JSON.parse(
      localStorage.getItem("metropolix-16-independent-v1"),
    );
    const patch = migratePatch(old);
    if (!validatePatch(patch)) throw Error("The previous pattern is invalid");
    runtime.stop();
    runtime.chainEnabled = false;
    store.replace(patch);
    runtime.clearLoop();
    syncAfterEdit(true);
    notify("Previous pattern imported");
    return;
  }
  if (a === "load-demo") {
    runtime.stop();
    runtime.chainEnabled = false;
    store.replace(demoPatch());
    runtime.clearLoop();
    syncAfterEdit(true);
    notify("Demo loaded");
    return;
  }
}
let altHeld = false;
document.addEventListener("click", async (event) => {
  try {
    if (event.target.matches(".drawer-backdrop")) {
      view.drawer = null;
      renderDrawer();
      return;
    }
    const selectEl = event.target.closest("[data-select]");
    if (selectEl) {
      const path = selectEl.dataset.select,
        raw = selectEl.dataset.value;
      if (path.startsWith("@")) {
        if (path === "@audition") view.auditionTrack = +raw;
        if (path === "@scaleTrack") view.scaleTrack = +raw;
        if (path === "@chainPreset") view.chainPreset = +raw;
        if (path === "@chainSlot") view.chainSlot = +raw;
        if (path === "@stage") view.selectedStage[view.drawer] = +raw;
        if (path === "@midiInput") runtime.midi.setInput(raw);
        if (path === "@midiOutput") runtime.midi.setOutput(raw);
        if (path === "@tuneNote") {
          view.tuneNote = +raw;
          if (runtime.tuner)
            await runtime.tune(true, view.tuneNote, !!view.tuneClock);
        }
        if (path === "@tuneGate") {
          view.tuneClock = !!+raw;
          if (runtime.tuner)
            await runtime.tune(true, view.tuneNote ?? 48, view.tuneClock);
        }
      } else setPath(path, +raw, true);
      render();
      return;
    }
    const toggleEl = event.target.closest("[data-toggle]");
    if (toggleEl) {
      const path = toggleEl.dataset.toggle;
      setPath(
        path,
        typeof read(path) === "boolean" ? !read(path) : 1 - read(path),
        true,
      );
      render();
      return;
    }
    const el = event.target.closest("[data-action]");
    if (el) {
      event.preventDefault();
      event.stopPropagation();
      el.closest("details")?.removeAttribute("open");
      await action(el, event);
    }
    document.querySelectorAll("details[open]").forEach((d) => {
      if (!d.contains(event.target)) d.open = false;
    });
  } catch (error) {
    console.error(error);
    notify(error.message || "Operation failed");
  }
});
document.addEventListener(
  "toggle",
  (event) => {
    const d = event.target;
    if (!(d instanceof HTMLDetailsElement) || !d.open) return;
    document.querySelectorAll("details[open]").forEach((other) => {
      if (other !== d) other.open = false;
    });
    d.classList.remove("align-right");
    const box = d.querySelector(".options")?.getBoundingClientRect();
    if (box && box.right > innerWidth - 12) d.classList.add("align-right");
    d.classList.toggle(
      "flip-up",
      !!box &&
        box.bottom > innerHeight - 12 &&
        d.getBoundingClientRect().top > innerHeight / 2,
    );
  },
  true,
);
document.addEventListener("pointerdown", (event) => {
  const input = event.target.closest("input[data-path]");
  if (input) {
    store.remember();
    runtime.automationPhase?.(input.dataset.path, "begin");
  }
  const el = event.target.closest('[data-action="pad"],[data-action="stage"]');
  if (!el) return;
  if (el.dataset.action === "stage" && !store.patch.loopy.enabled) return;
  const t = +el.dataset.track,
    n = +el.dataset.stage,
    held = {
      track: t,
      stage: n,
      loop: runtime.playing && store.patch.loopy.enabled,
      released: false,
    };
  event.preventDefault();
  el.setPointerCapture(event.pointerId);
  el.classList.add("pressed");
  view.loopPointers.set(event.pointerId, held);
  view.selectedStage[t] = n;
  if (held.loop) runtime.loopPress(t, n);
  else
    runtime
      .audition(t, n, true)
      .then(() => {
        if (held.released) runtime.releaseAudition(t);
      })
      .catch((e) => notify(e.message));
});
function releasePointer(event) {
  runtime.endGestures?.();
  const held = view.loopPointers.get(event.pointerId);
  if (!held) return;
  held.released = true;
  view.loopPointers.delete(event.pointerId);
  document
    .querySelectorAll(
      `[data-stage="${held.stage}"][data-track="${held.track}"].pressed`,
    )
    .forEach((el) => el.classList.remove("pressed"));
  if (held.loop) runtime.loopRelease(held.track, held.stage);
  else runtime.releaseAudition(held.track);
}
document.addEventListener("pointerup", releasePointer);
document.addEventListener("pointercancel", releasePointer);
document.addEventListener("focusin", (event) => {
  if (event.target.matches("input[data-path]")) {
    store.remember();
    runtime.automationPhase?.(event.target.dataset.path, "begin");
  }
});
document.addEventListener("focusout", (event) => {
  if (event.target.matches("input[data-path]"))
    runtime.automationPhase?.(event.target.dataset.path, "end");
});
document.addEventListener("input", (event) => {
  const el = event.target;
  if (
    el.matches("input[data-path]") &&
    typeof read(el.dataset.path) === "string"
  ) {
    setPath(el.dataset.path, el.value);
    return;
  }
  if (el.matches("input[type=number][data-path]")) {
    const value = Number(el.value),
      min = Number(el.min),
      max = Number(el.max);
    if (
      el.value.trim() &&
      Number.isFinite(value) &&
      value >= min &&
      value <= max
    )
      setPath(el.dataset.path, value * (Number(el.dataset.factor) || 1));
    return;
  }
  if (!el.matches("input[type=range][data-path]")) return;
  const path = el.dataset.path,
    value = Number(el.value),
    before = Number(read(path));
  setPath(path, value);
  if (altHeld && path.includes(".steps.")) {
    const parts = path.split("."),
      index = +parts[3],
      key = parts[4],
      steps = store.patch[parts[0]][+parts[1]].steps;
    const bounds =
      parts[0] === "tracks"
        ? STEP_RANGES[STEP_KEYS.indexOf(key)]
        : [-5000, 5000];
    steps.forEach((s, n) => {
      if (n !== index)
        setPath(
          `${parts[0]}.${parts[1]}.steps.${n}.${key}`,
          clamp(s[key] + value - before, ...bounds),
        );
    });
  }
});
document.addEventListener("change", async (event) => {
  const el = event.target;
  try {
    if (el.id === "import-file") {
      const file = el.files?.[0];
      if (!file) return;
      const data = JSON.parse(await file.text());
      runtime.stop();
      runtime.chainEnabled = false;
      store.import(data);
      runtime.clearLoop();
      syncAfterEdit(true);
      notify("Imported");
      return;
    }
    if (el.dataset.chainRepeat !== undefined) {
      store.remember();
      store.session.chain[+el.dataset.chainRepeat].repeat = clamp(
        Math.round(+el.value) || 1,
        1,
        64,
      );
      store.changed();
      render();
      return;
    }
    if (!el.dataset.path) return;
    const path = el.dataset.path;
    if (el.type === "range") {
      if (
        path.includes("mods.") ||
        path.startsWith("aux.") ||
        path.startsWith("controls.")
      ) {
        updateReadouts(path);
        return;
      }
      return;
    }
    let value = el.value;
    if (el.type === "number") {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return;
      value =
        clamp(numeric, Number(el.min), Number(el.max)) *
        (Number(el.dataset.factor) || 1);
    }
    setPath(path, value, read(path) !== value);
    if (altHeld && path.includes(".steps.")) {
      const parts = path.split("."),
        key = parts[4];
      store.patch[parts[0]][+parts[1]].steps.forEach((_, n) =>
        setPath(`${parts[0]}.${parts[1]}.steps.${n}.${key}`, value),
      );
    }
    render();
  } catch (error) {
    console.error(error);
    notify(error.message || "Invalid file");
  }
});
document.addEventListener("contextmenu", (event) => {
  const gate = event.target.closest('[data-action="cycle-gate"]');
  if (gate) {
    event.preventDefault();
    const t = +gate.dataset.track,
      n = +gate.dataset.stage;
    setPath(
      `tracks.${t}.steps.${n}.gate`,
      (store.patch.tracks[t].steps[n].gate + 3) % 4,
      true,
    );
    render();
  }
});
document.addEventListener("keydown", async (event) => {
  altHeld = event.altKey;
  const detail = event.target.closest("details.select");
  if (detail && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
    event.preventDefault();
    detail.open = true;
    const options = [
      ...detail.querySelectorAll("[role=option],.options button"),
    ];
    const unique = [...new Set(options)];
    let index = unique.indexOf(event.target);
    if (event.key === "Home") index = 0;
    else if (event.key === "End") index = unique.length - 1;
    else {
      if (index < 0) {
        index = unique.findIndex(
          (el) => el.getAttribute("aria-selected") === "true",
        );
        if (index < 0 && event.key === "ArrowUp") index = 0;
      }
      index =
        (index + (event.key === "ArrowDown" ? 1 : -1) + unique.length) %
        unique.length;
    }
    unique[index]?.focus();
    return;
  }
  if (event.key === "Escape") {
    const opened = [...document.querySelectorAll("details[open]")];
    if (opened.length) {
      opened.forEach((d) => (d.open = false));
      opened.at(-1)?.querySelector("summary")?.focus();
      return;
    }
    view.drawer = null;
    renderDrawer();
    runtime.clearLoop();
    return;
  }
  if (
    (event.key === "Enter" || event.key === " ") &&
    event.target.matches("[role=button][data-action]")
  ) {
    event.preventDefault();
    await action(event.target, event);
    return;
  }
  if (event.target.matches("input[data-path]") && event.key === "Enter") {
    event.preventDefault();
    event.target.blur();
    render();
    return;
  }
  if (event.target.closest("input,button,summary,[role=option]")) {
    if (
      event.target.matches("input[type=range][data-path]") &&
      event.key.startsWith("Arrow")
    )
      store.remember();
    if (
      (event.key === "Enter" || event.key === " ") &&
      event.target.matches("[role=button][data-action]")
    ) {
      event.preventDefault();
      await action(event.target, event);
    }
    return;
  }
  try {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      const mode = event.shiftKey ? "redo" : "undo";
      if (store[mode]()) syncAfterEdit(true);
      return;
    }
    if (event.code === "Space") {
      event.preventDefault();
      await runtime.toggle();
    }
    if (event.key.toLowerCase() === "r") runtime.reset();
    if (event.key.toLowerCase() === "l") {
      setPath("loopy.enabled", !store.patch.loopy.enabled, true);
      render();
    }
  } catch (error) {
    notify(error.message);
  }
});
document.addEventListener("keyup", (event) => (altHeld = event.altKey));
function paintFrame(frame) {
  if (!frame) return;
  const p = store.patch;
  if (runtime.hosted || p.settings.clockSource) {
    const tempo = document.querySelector("[data-path=tempo]");
    if (tempo) tempo.value = Number(frame.bpm.toFixed(1));
  }
  const position = $("#position");
  if (position) {
    const pulse = Math.floor(frame.cycleTicks / 24) + 1;
    position.textContent = `${String(pulse).padStart(2, "0")} / ${p.totalPulses || "∞"}`;
    position.title = p.totalPulses
      ? `Global step ${pulse} of ${p.totalPulses}`
      : `Global step ${pulse} · automatic reset off`;
    document
      .querySelector(".cycle-length")
      ?.style.setProperty(
        "--cycle-progress",
        p.totalPulses
          ? Math.min(1, (frame.cycleTicks + 1) / (p.totalPulses * 24))
          : 0,
      );
  }
  $("#clock-led")?.classList.toggle("on", !!frame.clock);
  const loopButton = document.querySelector("[data-action=loopy]");
  if (loopButton)
    loopButton.setAttribute(
      "aria-pressed",
      store.patch.loopy.enabled || frame.tracks.some((t) => t.loopy),
    );
  frame.tracks.forEach((t, i) => {
    document
      .querySelectorAll(`.stage[data-track="${i}"]`)
      .forEach((el) =>
        el.classList.toggle(
          "current",
          runtime.playing && +el.dataset.stage === t.stage,
        ),
      );
    const note = document.querySelector(`[data-note="${i}"]`);
    if (note)
      note.textContent =
        frame.ticks || runtime.auditioning[i] ? noteName(t.note) : "—";
    const cv = document.querySelector(`[data-cv="${i}"]`);
    if (cv) cv.textContent = voltage(t.cv) + "V";
    document
      .querySelector(`[data-gate="${i}"]`)
      ?.classList.toggle(
        "on",
        (runtime.playing || runtime.auditioning[i]) && t.gate,
      );
  });
  frame.mods.forEach((m, i) => {
    const value = document.querySelector(`[data-mod-value="${i}"]`);
    if (value) value.textContent = voltage(m.value);
    document
      .querySelectorAll(`[data-mod-stage^="${i}-"]`)
      .forEach((el) =>
        el.classList.toggle(
          "current",
          runtime.playing && +el.dataset.modStage.split("-")[1] === m.stage,
        ),
      );
  });
  frame.outputs.forEach((v, i) => {
    if (!runtime.playing && p.outputs[i].kind === 12) v = 0;
    const output = document.querySelector(`[data-output="${i}"]`);
    if (output) output.textContent = voltage(v) + "V";
    const meter = document.querySelector(`[data-meter="${i}"]`);
    if (meter) {
      meter.style.width = Math.min(50, Math.abs(v) / 100) + "%";
      meter.style.left =
        v < 0 ? `${50 - Math.min(50, Math.abs(v) / 100)}%` : "50%";
    }
  });
  document
    .querySelectorAll("[data-mx]")
    .forEach((el) =>
      el.classList.toggle("on", !!(frame.mx & (1 << +el.dataset.mx))),
    );
  document
    .querySelectorAll("[data-chain-link]")
    .forEach((el) =>
      el.classList.toggle(
        "playing",
        runtime.chainEnabled && +el.dataset.chainLink === frame.chainIndex,
      ),
    );
}
const scopeData = new Uint8Array(1024);
function draw() {
  if (runtime) {
    if (runtime.audio.context) {
      const frame = runtime.pullFrame();
      if (frame) paintFrame(frame);
    }
    const canvas = $("#scope");
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (runtime.audio.analyser)
        runtime.audio.analyser.getByteTimeDomainData(scopeData);
      else scopeData.fill(128);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.beginPath();
      ctx.strokeStyle = "#a3bb7d";
      ctx.lineWidth = 1.4;
      let currentPeak = 0;
      for (let i = 0; i < 240; i++) {
        const signal = scopeData[i * 4] - 128;
        currentPeak = Math.max(currentPeak, Math.abs(signal));
        const y = 30 + signal * 0.7;
        if (i === 0) ctx.moveTo(i, y);
        else ctx.lineTo(i, y);
      }
      ctx.stroke();
      peak = Math.max(currentPeak, peak * 0.98);
      canvas.dataset.signalPeak = peak.toFixed(2);
      canvas.dataset.audioState = runtime.audio.context?.state || "closed";
    }
    if (++frameCount % 60 === 0 && store.error) notify(store.error);
  }
  requestAnimationFrame(draw);
}
window.addEventListener("pagehide", () => {
  store.flush();
  runtime?.dispose();
});
async function boot() {
  try {
    const [wasm, res] = await Promise.all([
      fetch("engine.wasm"),
      fetch("catalog.json"),
    ]);
    if (!wasm.ok || !res.ok) throw Error("Engine files could not be loaded");
    catalog = await res.json();
    const module = await WebAssembly.compile(await wasm.arrayBuffer());
    runtime = pluginBridge
      ? new PluginRuntime(store, notify, render, pluginBridge)
      : new Runtime(store, notify, render);
    document.documentElement.classList.toggle("hosted", !!pluginBridge);
    await runtime.init(module);
    runtime.learned = () =>
      document.querySelector(".automation-learning")?.remove();
    runtime.valuesChanged = (edits) => {
      const affected = new Set();
      for (const { path, value } of edits) {
        document.querySelectorAll(`[data-path="${path}"]`).forEach((input) => {
          if (document.activeElement !== input)
            input.value = value / (Number(input.dataset.factor) || 1);
        });
        document
          .querySelectorAll(`[data-binding="${path}"]`)
          .forEach((label) => {
            const selected = label.querySelector(
                `[data-select][data-value="${value}"]`,
              ),
              summary = label.querySelector("summary");
            if (selected && summary?.firstChild)
              summary.firstChild.textContent = selected.textContent.trim();
          });
        document
          .querySelectorAll(`[data-toggle="${path}"]`)
          .forEach((button) => button.setAttribute("aria-pressed", !!value));
        updateReadouts(path);
        const track = path.match(/^tracks\.(\d+)\./);
        if (track) affected.add(+track[1]);
        if (path.startsWith("controls."))
          store.patch.tracks.forEach((_, i) => affected.add(i));
      }
      for (const i of affected) {
        const t = store.patch.tracks[i];
        if (!t) continue;
        document
          .querySelectorAll(`.stage[data-track="${i}"]`)
          .forEach((stage) => {
            const n = +stage.dataset.stage,
              s = t.steps[n];
            stage.classList.toggle("outside", n >= t.length);
            stage.classList.toggle("skipped", !!s.skip);
            const label = stage.querySelector(".stage-note"),
              note = noteName(runtime.engine.engine_preview(i, n, 0) / 100);
            if (label) {
              label.textContent = note;
              label.classList.toggle("overridden", s.pitchOverride >= 0);
            }
            stage
              .querySelector(`input[data-path$=".pitch"]`)
              ?.setAttribute("aria-valuetext", note);
          });
      }
    };
    render();
    updateReadouts("settings.ledLevel");
    updateReadouts("settings.screenLevel");
    draw();
    window.neuropolis = {
      get patch() {
        return structuredClone(store.patch);
      },
      get session() {
        return structuredClone(store.session);
      },
      get playing() {
        return runtime.playing;
      },
      get engine() {
        return runtime.engine;
      },
    };
  } catch (error) {
    console.error(error);
    $("#app").innerHTML =
      `<main class="loading"><span class="brand">neuropolis</span><p>${escape(error.message)}</p></main>`;
  }
}
boot();
