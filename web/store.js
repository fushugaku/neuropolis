import {
  STORAGE,
  loadSession,
  validatePatch,
  validateSession,
  validateChain,
  migratePatch,
  migrateSession,
  emptyPatch,
  emptyTrack,
  normalizeTrackReferences,
  removeTrackReferences,
} from "./model.js";
export class InstrumentStore {
  constructor(storage) {
    this.storage = storage;
    this.session = loadSession(storage);
    this.undoStack = [];
    this.redoStack = [];
    this.pickup = new Map();
    this.timer = null;
    this.dirty = false;
  }
  get patch() {
    return this.session.patch;
  }
  remember() {
    const snapshot = JSON.stringify(this.session);
    if (this.undoStack.at(-1) !== snapshot) {
      this.undoStack.push(snapshot);
      if (this.undoStack.length > 24) this.undoStack.shift();
      this.redoStack = [];
    }
  }
  changed() {
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 180);
    this.onChange?.();
  }
  flush() {
    try {
      this.storage.setItem(STORAGE, JSON.stringify(this.session));
      this.error = "";
    } catch {
      this.error =
        "Could not save: browser storage is full. Export a backup.";
    }
  }
  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(JSON.stringify(this.session));
    this.session = JSON.parse(this.undoStack.pop());
    this.pickup.clear();
    this.changed();
    return true;
  }
  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(JSON.stringify(this.session));
    this.session = JSON.parse(this.redoStack.pop());
    this.pickup.clear();
    this.changed();
    return true;
  }
  savePreset(slot) {
    this.remember();
    this.session.presets[slot] = structuredClone(this.patch);
    this.session.currentPreset = slot;
    this.dirty = false;
    this.changed();
    this.dirty = false;
  }
  clearPreset(slot) {
    this.remember();
    this.session.presets[slot] = null;
    this.changed();
  }
  loadPreset(slot, options = true) {
    const saved = this.session.presets[slot];
    if (!saved) return false;
    const old = this.patch,
      p = structuredClone(saved),
      settings = old.settings;
    this.pickup.clear();
    if (options) {
      old.tracks.forEach((t, i) =>
        t.steps.forEach((s, n) => {
          if (!p.tracks[i]) return;
          if (settings.pitchLoad === 0) p.tracks[i].steps[n].pitch = s.pitch;
          else if (settings.pitchLoad === 1)
            this.pickup.set(`pitch:${i}:${n}`, {
              physical: s.pitch,
              target: p.tracks[i].steps[n].pitch,
            });
          if (!settings.switchLoad) {
            p.tracks[i].steps[n].pulses = s.pulses;
            p.tracks[i].steps[n].gate = s.gate;
          }
        }),
      );
      if (settings.ctrlLoad === 0) p.controls = structuredClone(old.controls);
      if (settings.ctrlLoad === 1)
        p.controls.forEach((c, i) => (c.value = old.controls[i].value));
      if (settings.ctrlLoad === 2)
        p.controls.forEach((c, i) =>
          this.pickup.set(`control:${i}`, {
            physical: old.controls[i].value,
            target: c.value,
          }),
        );
      p.aux.forEach((a, i) => {
        if (!settings.auxLoad) {
          a.destination = old.aux[i].destination;
          a.target = old.aux[i].target;
        }
        a.value = old.aux[i].value;
        a.amount = old.aux[i].amount;
      });
    }
    p.tempo = old.tempo;
    p.settings = structuredClone(settings);
    p.userScales = structuredClone(old.userScales);
    normalizeTrackReferences(p);
    this.session.patch = p;
    this.session.currentPreset = slot;
    this.dirty = false;
    this.changed();
    this.dirty = false;
    return true;
  }
  addTrack(source = null) {
    this.remember();
    const index = this.patch.tracks.length;
    const track =
      source === null
        ? emptyTrack(index)
        : structuredClone(this.patch.tracks[source]);
    if (source !== null) track.name = `${track.name} copy`;
    this.patch.tracks.push(track);
    this.changed();
    return index;
  }
  removeTrack(index) {
    if (this.patch.tracks.length <= 1 || !this.patch.tracks[index])
      return false;
    this.remember();
    this.patch.tracks.splice(index, 1);
    removeTrackReferences(this.patch, index);
    this.pickup.clear();
    this.changed();
    return true;
  }
  acceptPickup(key, physical) {
    const pickup = this.pickup.get(key);
    if (!pickup) return true;
    const crossed =
      (pickup.physical - pickup.target) * (physical - pickup.target) <= 0;
    pickup.physical = physical;
    if (crossed) this.pickup.delete(key);
    return crossed;
  }
  replace(patch) {
    patch = migratePatch(patch);
    if (!validatePatch(patch))
      throw Error("The file does not contain a neuropolis pattern");
    this.remember();
    this.session.patch = patch;
    this.session.currentPreset = -1;
    this.pickup.clear();
    this.changed();
  }
  import(data) {
    if (
      ["neuropolis-backup", "metropolix-16-backup"].includes(data?.format) &&
      validateSession(data.session)
    ) {
      this.remember();
      this.session = migrateSession(structuredClone(data.session));
      this.pickup.clear();
      this.changed();
      return "backup";
    }
    this.replace(data);
    return "patch";
  }
  backup() {
    return {
      format: "neuropolis-backup",
      version: 2,
      session: structuredClone(this.session),
    };
  }
  setChain(chain) {
    if (!validateChain(chain))
      throw Error("The chain contains invalid links");
    this.remember();
    this.session.chain = structuredClone(chain);
    this.changed();
  }
  init() {
    const preset = this.patch.settings.initPreset;
    const settings = this.patch.settings,
      scales = this.patch.userScales,
      tempo = this.patch.tempo;
    this.remember();
    this.session.patch =
      preset >= 0 && this.session.presets[preset]
        ? structuredClone(this.session.presets[preset])
        : emptyPatch();
    Object.assign(this.patch, { settings, userScales: scales, tempo });
    this.changed();
  }
}
