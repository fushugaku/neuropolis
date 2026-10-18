import { clamp, syncEngine, swappedTrack } from "./model.js";
export class MidiPort {
  constructor() {
    this.access = null;
    this.input = null;
    this.output = null;
    this.notes = [];
    this.ccValues = new Map();
    this.mx = 0;
    this.mxSettings = { channel: 0, message: 0 };
    this.message = "Not connected";
  }
  async connect(onMessage, onPorts) {
    if (!navigator.requestMIDIAccess)
      throw Error(
        "Этот браузер не поддерживает Web MIDI. Используй Chrome/Edge или экспорт .mid.",
      );
    this.access = await navigator.requestMIDIAccess({ sysex: false });
    this.onMessage = onMessage;
    this.onPorts = onPorts;
    this.access.onstatechange = () => {
      this.message =
        this.output?.state === "disconnected"
          ? "MIDI output disconnected"
          : this.message;
      onPorts?.();
    };
    return this.ports();
  }
  ports() {
    return {
      inputs: [...(this.access?.inputs.values() || [])].map((p) => ({
        id: p.id,
        name: p.name || "MIDI input",
      })),
      outputs: [...(this.access?.outputs.values() || [])].map((p) => ({
        id: p.id,
        name: p.name || "MIDI output",
      })),
    };
  }
  setInput(id) {
    if (this.input) this.input.onmidimessage = null;
    this.input = this.access?.inputs.get(id) || null;
    if (this.input)
      this.input.onmidimessage = (e) =>
        this.onMessage?.(e.data, e.receivedTime);
  }
  setOutput(id) {
    this.panic();
    this.output = this.access?.outputs.get(id) || null;
    this.ccValues.clear();
    this.message = this.output?.name || "No MIDI output";
  }
  send(data, time) {
    if (this.output?.state === "connected")
      try {
        this.output.send(data, time);
      } catch {
        this.message = "MIDI send failed";
      }
  }
  stamp(audio, time) {
    return performance.now() + (time - (audio?.currentTime || time)) * 1000;
  }
  cc(channel, number, value, time) {
    if (!channel || number < 0) return;
    value = clamp(Math.round(value), 0, 127);
    const key = `${this.exporting ? this.stream + ":" : ""}${channel}:${number}`;
    if (this.ccValues.get(key) === value) return;
    this.ccValues.set(key, value);
    this.send([0xb0 + channel - 1, number, value], time);
  }
  off(track, time) {
    this.stream = track + 1;
    const old = this.notes[track];
    if (old) {
      this.send([0x80 + old.channel - 1, old.note, 0], time);
      this.notes[track] = null;
    }
  }
  note(track, note, velocity, channel, time, legato = false) {
    this.stream = track + 1;
    note = clamp(Math.round(note), 0, 127);
    if (!channel || velocity <= 0) {
      this.off(track, time);
      return;
    }
    const old = this.notes[track];
    if (!legato) this.off(track, time);
    this.send([0x90 + channel - 1, note, clamp(velocity, 1, 127)], time);
    if (legato && old && old.note !== note)
      this.send([0x80 + old.channel - 1, old.note, 0], time);
    this.notes[track] = { note, channel };
  }
  releaseMx(time) {
    this.stream = (this.trackCount || 2) + 9;
    if (this.mxSettings.channel)
      for (let i = 0; i < 8; i++)
        if (this.mx & (1 << i)) {
          if (this.mxSettings.message === 0)
            this.cc(this.mxSettings.channel, 102 + i, 0, time);
          else this.send([0x80 + this.mxSettings.channel - 1, 35 + i, 0], time);
        }
    this.mx = 0;
  }
  panic(time) {
    if (time === undefined) this.output?.clear?.();
    this.releaseMx(time);
    this.notes.forEach((_, i) => this.off(i, time));
    if (this.output) {
      for (let channel = 0; channel < 16; channel++)
        this.send([0xb0 + channel, 123, 0], time);
    }
    this.ccValues.clear();
    this.mx = 0;
  }
  frame(e, p, events, time) {
    const swapped = !!e.engine_global_value(5);
    this.trackCount = p.tracks.length;
    for (let source = 0; source < p.tracks.length; source++) {
      const t = p.tracks[source],
        track = swappedTrack(source, swapped, p.tracks.length),
        flags = Array.isArray(events)
          ? events[source]
          : e.engine_track_events(source),
        on = !!(flags & 1),
        off = !!(flags & 2),
        pitch = !!(flags & 0x100);
      this.stream = track + 1;
      const channelChanged =
        this.notes[track] && this.notes[track].channel !== t.midiChannel;
      if (channelChanged || !t.midiChannel) this.off(track, time);
      if (
        channelChanged &&
        t.midiChannel &&
        e.engine_value(source, 3) &&
        !on &&
        !off
      )
        this.note(
          track,
          e.engine_note(source),
          e.engine_value(source, 2),
          t.midiChannel,
          time,
        );
      if (off) this.off(track, time);
      if (on)
        this.note(
          track,
          e.engine_note(source),
          e.engine_value(source, 2),
          t.midiChannel,
          time,
        );
      else if (pitch && e.engine_value(source, 3) && this.notes[track])
        this.note(
          track,
          e.engine_note(source),
          e.engine_value(source, 2),
          t.midiChannel,
          time,
          true,
        );
      const cv = e.engine_value(source, 1);
      this.cc(
        t.midiChannel,
        t.cvCC,
        t.cvType === 0 ? ((cv + 5000) * 127) / 10000 : (cv * 127) / 5000,
        time,
      );
      this.cc(t.midiChannel, t.slideCC, e.engine_slide(source) ? 127 : 0, time);
      this.cc(
        t.midiChannel,
        t.slideAmountCC,
        !t.slideCCMode && !e.engine_slide(source)
          ? 0
          : (e.engine_value(source, 5) * 127) / 100,
        time,
      );
    }
    p.mods.forEach((m, i) => {
      this.stream = p.tracks.length + 1 + i;
      this.cc(
        m.midiChannel,
        m.midiCC,
        m.cvType === 0
          ? ((e.engine_mod_value(i, 0) + 5000) * 127) / 10000
          : (e.engine_mod_value(i, 0) * 127) / 5000,
        time,
      );
    });
    this.stream = p.tracks.length + 9;
    if (
      this.mxSettings.channel !== p.mx.channel ||
      this.mxSettings.message !== p.mx.message
    ) {
      this.releaseMx(time);
      this.mxSettings = { channel: p.mx.channel, message: p.mx.message };
    }
    const mask = e.engine_global_value(3);
    if (p.mx.channel)
      for (let i = 0; i < 8; i++) {
        const bit = 1 << i;
        if ((mask & bit) !== (this.mx & bit)) {
          if (p.mx.message === 0)
            this.cc(p.mx.channel, 102 + i, mask & bit ? 127 : 0, time);
          else
            this.send(
              [
                (mask & bit ? 0x90 : 0x80) + p.mx.channel - 1,
                35 + i,
                mask & bit ? 100 : 0,
              ],
              time,
            );
        }
      }
    this.mx = mask;
  }
}
function variable(value) {
  const bytes = [value & 127];
  while ((value >>= 7)) bytes.unshift((value & 127) | 128);
  return bytes;
}
function word(n) {
  return [(n >> 8) & 255, n & 255];
}
function long(n) {
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
}
function chunk(name, bytes) {
  return [...name]
    .map((c) => c.charCodeAt(0))
    .concat(long(bytes.length), bytes);
}
export function makeMidiFile(tracks, ppqn = 96) {
  const encoded = tracks.map((events) => {
    events.sort((a, b) => a.tick - b.tick);
    let previous = 0;
    const bytes = [];
    for (const event of events) {
      bytes.push(
        ...variable(Math.max(0, event.tick - previous)),
        ...event.bytes,
      );
      previous = event.tick;
    }
    bytes.push(0, 255, 47, 0);
    return chunk("MTrk", bytes);
  });
  return new Uint8Array([
    ...chunk("MThd", [0, 1, ...word(tracks.length), ...word(ppqn)]),
    ...encoded.flat(),
  ]);
}
export async function renderMidi(module, patch, bars = 8) {
  patch = structuredClone(patch);
  patch.tracks.forEach((t, i) => {
    if (!t.midiChannel) t.midiChannel = (i % 16) + 1;
  });
  const e = (await WebAssembly.instantiate(module)).exports;
  syncEngine(e, patch);
  const tracks = Array.from({ length: patch.tracks.length + 10 }, () => []);
  let tick = 0;
  const port = new MidiPort();
  port.exporting = true;
  port.send = (bytes) => {
    tracks[port.stream || 0].push({ tick, bytes });
  };
  const names = [
    "Tempo",
    ...patch.tracks.map((t, i) => t.name || `Track ${i + 1}`),
    ...patch.mods.map((_, i) => `MOD ${i + 1}`),
    "MX",
  ];
  names.forEach((name, i) => {
    const bytes = [...new TextEncoder().encode(name)];
    tracks[i].push({
      tick: 0,
      bytes: [255, 3, ...variable(bytes.length), ...bytes],
    });
  });
  let lastTempo = 0;
  for (tick = 0; tick < bars * 16 * 24; tick++) {
    const events = e.engine_tick(),
      bpm = e.engine_global_value(0);
    if (bpm !== lastTempo) {
      const micros = Math.round(60000000000 / bpm);
      tracks[0].push({
        tick,
        bytes: [
          255,
          81,
          3,
          (micros >> 16) & 255,
          (micros >> 8) & 255,
          micros & 255,
        ],
      });
      lastTempo = bpm;
    }
    port.frame(e, patch, events, undefined);
  }
  port.notes.forEach((_, i) => port.off(i));
  return makeMidiFile(tracks);
}
