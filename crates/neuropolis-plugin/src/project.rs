//! Preallocated preset memory, arrangement and atomic configuration snapshots.
//! Indices are shared with Native.h; none of these operations allocate in render.
use super::*;

pub const HEADER: usize = 24;
pub const TRACK_BASE: usize = 768;
pub const TRACK_STRIDE: usize = f::COUNT + 16 * 15;
const MOD_BASE: usize = 64;
const ROUTE_BASE: usize = 544;
const OUTPUT_BASE: usize = 564;
const SCALE_BASE: usize = 568;
const SETTINGS_BASE: usize = 16;

pub fn config_index(kind: u32, index: u32, stage: u32, field: u32) -> Option<usize> {
    let (i, n, f) = (index as usize, stage as usize, field as usize);
    match kind {
        0 if f < f::COUNT => Some(TRACK_BASE + i * TRACK_STRIDE + f),
        1 if n < 16 && f < 15 => Some(TRACK_BASE + i * TRACK_STRIDE + f::COUNT + n * 15 + f),
        2 if i < 8 && f < 12 => Some(MOD_BASE + i * 60 + f),
        3 if i < 8 && n < 16 && f < 3 => Some(MOD_BASE + i * 60 + 12 + n * 3 + f),
        4 if n < 2 && i < [2, 3][n] && f < 4 => Some(ROUTE_BASE + (i + n * 2) * 4 + f),
        5 if (49..149).contains(&i) => Some(SCALE_BASE + (i - 49) * 2),
        6 if f < 12 => Some(f),
        7 if i < 2 => Some(OUTPUT_BASE + i * 2),
        18 if i < 100 => Some(SCALE_BASE + i * 2),
        19 if i < 100 => Some(SCALE_BASE + i * 2 + 1),
        20 if i < 2 => Some(OUTPUT_BASE + i * 2),
        21 if i < 2 => Some(OUTPUT_BASE + i * 2 + 1),
        13 if f < 6 => Some(SETTINGS_BASE + f),
        _ => None,
    }
}
pub struct Pattern {
    pub tracks: usize,
    pub values: Vec<i32>,
}
pub struct Link {
    pub preset: usize,
    pub repeat: u32,
    pub mute_mask: u32,
    pub muted_tracks: Vec<usize>,
}
pub struct Project {
    pub values: Vec<i32>,
    pub snapshot: Vec<AtomicI32>,
    pub presets: [Option<Pattern>; 64],
    pub links: Vec<Link>,
    pub current_preset: i32,
    pub queued: i32,
    pub chain: bool,
    pub link: usize,
    pub repeat: u32,
    pub elapsed: u32,
    pub music_tick: u64,
    pub recall: u32,
    pub dirty: bool,
    pub solo: i32,
    revision: i32,
}
impl Project {
    pub fn new(tracks: usize) -> Self {
        let count = TRACK_BASE + tracks * TRACK_STRIDE;
        let mut values = vec![0; count];
        values[SETTINGS_BASE + 1] = 64;
        values[SETTINGS_BASE + 2] = 2;
        values[SETTINGS_BASE + 3] = 1;
        values[SETTINGS_BASE + 4] = 3;
        values[SETTINGS_BASE + 5] = 1;
        Self {
            values,
            snapshot: (0..count + 4).map(|_| AtomicI32::new(0)).collect(),
            presets: std::array::from_fn(|_| None),
            links: Vec::new(),
            current_preset: -1,
            queued: -1,
            chain: false,
            link: 0,
            repeat: 0,
            elapsed: 0,
            music_tick: 0,
            recall: 0,
            dirty: true,
            solo: -1,
            revision: 0,
        }
    }
    pub fn publish(&mut self, tracks: usize) {
        if !self.dirty {
            return;
        }
        self.revision = self.revision.wrapping_add(2) & !1;
        self.snapshot[0].store(self.revision | 1, Ordering::SeqCst);
        self.snapshot[1].store(tracks as i32, Ordering::Relaxed);
        self.snapshot[2].store(self.current_preset, Ordering::Relaxed);
        self.snapshot[3].store(self.recall as i32, Ordering::Relaxed);
        for (out, &value) in self.snapshot[4..].iter().zip(&self.values) {
            out.store(value, Ordering::Relaxed);
        }
        self.snapshot[0].store(self.revision, Ordering::SeqCst);
        self.dirty = false;
    }
}
impl NativeEngine {
    pub fn capture_defaults(&mut self) {
        self.project.values[0] = self.seq.bpm_milli;
        self.project.values[1] = self.seq.total_pulses as i32;
        self.project.values[2] = 1;
        for i in 0..self.seq.tracks.len() {
            let base = TRACK_BASE + i * TRACK_STRIDE;
            self.project.values[base..base + f::COUNT].copy_from_slice(&self.seq.tracks[i].config);
            for (n, s) in self.seq.tracks[i].steps.iter().enumerate() {
                let values = [
                    s.pitch as i32,
                    s.pulses as i32,
                    s.gate as i32,
                    s.ratchet as i32,
                    s.probability as i32,
                    i32::from(s.slide),
                    i32::from(s.skip),
                    s.accumulate as i32,
                    s.pitch_override as i32,
                    s.gate_override as i32,
                    s.probability_target as i32,
                    s.accumulate_trigger as i32,
                    s.cv,
                    s.cv_ramp as i32,
                    i32::from(s.cv_gate),
                ];
                self.project.values[base + f::COUNT + n * 15..base + f::COUNT + (n + 1) * 15]
                    .copy_from_slice(&values);
            }
        }
        for (i, lane) in self.seq.mods.iter().enumerate() {
            let base = MOD_BASE + i * 60;
            self.project.values[base..base + 12].copy_from_slice(&lane.config);
            for (n, s) in lane.steps.iter().enumerate() {
                self.project.values[base + 12 + n * 3..base + 15 + n * 3].copy_from_slice(&[
                    s.value,
                    i32::from(s.ramp),
                    i32::from(s.gate),
                ]);
            }
        }
        for (i, r) in self
            .seq
            .controls
            .iter()
            .chain(self.seq.aux.iter())
            .enumerate()
        {
            self.project.values[ROUTE_BASE + i * 4..ROUTE_BASE + (i + 1) * 4].copy_from_slice(&[
                r.destination as i32,
                r.target as i32,
                r.value,
                r.amount,
            ]);
        }
        for (i, o) in self.seq.output_config.iter().enumerate() {
            self.project.values[OUTPUT_BASE + i * 2..OUTPUT_BASE + (i + 1) * 2].copy_from_slice(o);
        }
        for i in 0..100 {
            self.project.values[SCALE_BASE + i * 2] = 4095;
        }
    }
    pub fn seal_project(&mut self) {
        let count = self.seq.tracks.len();
        let capacity = self
            .project
            .presets
            .iter()
            .flatten()
            .map(|p| p.tracks)
            .max()
            .unwrap_or(count)
            .max(count);
        self.seq.tracks.reserve(capacity - count);
        self.notes.resize(capacity, None);
        self.cc.resize(capacity + MOD_LANES + 1, [-1; 128]);
        self.mutes.resize(capacity, 0);
        self.project
            .values
            .resize(TRACK_BASE + capacity * TRACK_STRIDE, 0);
        self.project.snapshot = (0..self.project.values.len() + 4)
            .map(|_| AtomicI32::new(0))
            .collect();
        self.readouts = (0..HEADER + capacity * 10 + MOD_LANES * 2)
            .map(|_| AtomicI32::new(0))
            .collect();
        self.project.dirty = true;
        self.project.publish(count);
    }
    fn apply_configuration(&mut self) {
        for field in 0..12 {
            self.set_config(6, 0, 0, field, self.project.values[field as usize]);
        }
        for i in 0..self.seq.tracks.len() {
            for f in 0..f::COUNT {
                self.set_from_memory(0, i, 0, f);
            }
            for n in 0..16 {
                for f in 0..15 {
                    self.set_from_memory(1, i, n, f);
                }
            }
        }
        for i in 0..8 {
            for f in 0..12 {
                self.set_from_memory(2, i, 0, f);
            }
            for n in 0..16 {
                for f in 0..3 {
                    self.set_from_memory(3, i, n, f);
                }
            }
        }
        for n in 0..2 {
            for i in 0..[2, 3][n] {
                for f in 0..4 {
                    self.set_from_memory(4, i, n, f);
                }
            }
        }
        for i in 0..2 {
            let at = OUTPUT_BASE + i * 2;
            self.seq
                .set_output(i, self.project.values[at], self.project.values[at + 1]);
        }
        for i in 0..100 {
            self.seq.set_scale(
                i + 49,
                self.project.values[SCALE_BASE + i * 2],
                self.project.values[SCALE_BASE + i * 2 + 1],
            );
        }
    }
    fn set_from_memory(&mut self, kind: u32, index: usize, stage: usize, field: usize) {
        let at = config_index(kind, index as u32, stage as u32, field as u32).unwrap();
        self.set_config(
            kind,
            index as u32,
            stage as u32,
            field as u32,
            self.project.values[at],
        );
    }
    pub fn recall(&mut self, slot: usize, offset: u32, ctx: *mut c_void, emit: Emit) -> bool {
        let Some(pattern) = self.project.presets.get(slot).and_then(Option::as_ref) else {
            return false;
        };
        let count = pattern.tracks;
        let previous_count = self.seq.tracks.len();
        let settings: [i32; 6] = std::array::from_fn(|i| self.project.values[SETTINGS_BASE + i]);
        self.silence_at(offset, ctx, emit);
        let pattern = self.project.presets[slot].as_ref().unwrap();
        for (at, &value) in pattern.values.iter().enumerate() {
            // Global settings, scales and AUX voltages persist across recall.
            let mut keep = matches!(at, 0 | 2 | 3 | 8 | SETTINGS_BASE..=21 | SCALE_BASE..=767);
            if (ROUTE_BASE..OUTPUT_BASE).contains(&at) {
                let route = (at - ROUTE_BASE) / 4;
                let field = (at - ROUTE_BASE) % 4;
                keep |= if route < 2 {
                    settings[4] == 0 || (settings[4] == 1 && field == 2)
                } else {
                    field >= 2 || settings[5] == 0
                };
            }
            if at >= TRACK_BASE {
                let track = (at - TRACK_BASE) / TRACK_STRIDE;
                let field = (at - TRACK_BASE) % TRACK_STRIDE;
                if track < previous_count && field >= f::COUNT {
                    let field = (field - f::COUNT) % 15;
                    keep |= (field == 0 && settings[2] == 0)
                        || ((field == 1 || field == 2) && settings[3] == 0);
                }
            }
            if !keep {
                self.project.values[at] = value;
            }
        }
        self.seq.resize_tracks(count);
        // Normalize references kept from the previous, possibly larger pattern.
        for i in 0..5 {
            let at = ROUTE_BASE + i * 4 + 1;
            if self.project.values[at] > count as i32 {
                self.project.values[at] = 2;
            }
        }
        self.apply_configuration();
        self.seq.restart();
        self.cc.iter_mut().for_each(|c| c.fill(-1));
        self.project.current_preset = slot as i32;
        self.project.recall = self.project.recall.wrapping_add(1);
        self.project.dirty = true;
        true
    }
    pub fn request_preset(&mut self, slot: i32, ctx: *mut c_void, emit: Emit) {
        if self.project.chain {
            return;
        }
        if !(0..64).contains(&slot)
            || self.project.presets[slot as usize].is_none()
            || self.project.queued == slot
        {
            self.project.queued = -1;
        } else if self.was_playing && self.project.values[SETTINGS_BASE] != 0 {
            self.project.queued = slot;
        } else {
            self.recall(slot as usize, 0, ctx, emit);
        }
    }
    pub fn enable_chain(&mut self, enabled: bool, ctx: *mut c_void, emit: Emit) {
        self.project.chain = enabled && !self.project.links.is_empty();
        self.project.queued = -1;
        self.project.link = 0;
        self.project.repeat = 0;
        self.project.elapsed = 0;
        self.project.music_tick = 0;
        if self.project.chain {
            self.recall_link(0, ctx, emit);
        }
    }
    fn recall_link(&mut self, offset: u32, ctx: *mut c_void, emit: Emit) {
        if let Some(link) = self.project.links.get(self.project.link) {
            self.recall(link.preset, offset, ctx, emit);
        }
    }
    pub fn before_tick(&mut self, offset: u32, ctx: *mut c_void, emit: Emit) {
        if self.project.music_tick == 0 || self.project.music_tick % 24 != 0 {
            return;
        }
        if self.project.queued >= 0 {
            let quant = if self.project.values[SETTINGS_BASE] == 2 && self.seq.total_pulses != 0 {
                self.seq.total_pulses as i32
            } else {
                let length = self.seq.tracks[0].config[f::PULSES_LENGTH];
                if length != 0 {
                    length
                } else {
                    self.project.values[SETTINGS_BASE + 1]
                }
            };
            if quant > 0 && (self.project.music_tick / 24) % quant as u64 == 0 {
                let slot = self.project.queued;
                self.project.queued = -1;
                self.recall(slot as usize, offset, ctx, emit);
            }
        }
        if self.project.chain {
            self.project.elapsed += 1;
            let length = if self.seq.total_pulses > 0 {
                self.seq.total_pulses
            } else {
                if self.project.values[SETTINGS_BASE + 1] > 0 {
                    self.project.values[SETTINGS_BASE + 1] as u32
                } else {
                    64
                }
            };
            if self.project.elapsed >= length {
                self.project.elapsed = 0;
                self.project.repeat += 1;
                if self.project.repeat >= self.project.links[self.project.link].repeat {
                    self.project.repeat = 0;
                    self.project.link = (self.project.link + 1) % self.project.links.len();
                }
                self.recall_link(offset, ctx, emit);
            }
        }
    }
    pub fn apply_mutes(&mut self) {
        let link = if self.project.chain {
            self.project.links.get(self.project.link)
        } else {
            None
        };
        for (i, track) in self.seq.tracks.iter_mut().enumerate() {
            self.mutes[i] = track.config[f::MUTE];
            if (self.project.solo >= 0 && self.project.solo != i as i32)
                || link.is_some_and(|l| {
                    (i < 2 && l.mute_mask & (1 << i) != 0) || l.muted_tracks.contains(&i)
                })
            {
                track.config[f::MUTE] = 1;
            }
        }
        if link.is_some_and(|l| l.mute_mask & 4 != 0) {
            for (i, lane) in self.seq.mods.iter_mut().enumerate() {
                self.mod_mutes[i] = lane.config[9];
                lane.config[9] = 1;
            }
        }
    }
    pub fn restore_mutes(&mut self) {
        for (i, track) in self.seq.tracks.iter_mut().enumerate() {
            track.config[f::MUTE] = self.mutes[i];
        }
        if self.project.chain
            && self
                .project
                .links
                .get(self.project.link)
                .is_some_and(|l| l.mute_mask & 4 != 0)
        {
            for (i, lane) in self.seq.mods.iter_mut().enumerate() {
                lane.config[9] = self.mod_mutes[i];
            }
        }
    }
}

/// # Safety
/// Both handles are unpublished builder-owned allocations. The preset is consumed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn np_preset(
    engine: *mut NativeEngine,
    slot: u32,
    preset: *mut NativeEngine,
) {
    if preset.is_null() {
        return;
    }
    let preset = unsafe { Box::from_raw(preset) };
    if let Some(e) = unsafe { engine.as_mut() } {
        if let Some(out) = e.project.presets.get_mut(slot as usize) {
            *out = Some(Pattern {
                tracks: preset.seq.tracks.len(),
                values: preset.project.values,
            });
        }
    }
}
/// # Safety
/// The handle is unpublished and builder-owned.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn np_link(
    engine: *mut NativeEngine,
    preset: u32,
    repeat: u32,
    mute_mask: u32,
) {
    if let Some(e) = unsafe { engine.as_mut() } {
        if preset < 64 {
            e.project.links.push(Link {
                preset: preset as usize,
                repeat: repeat.clamp(1, 64),
                mute_mask,
                muted_tracks: Vec::new(),
            });
        }
    }
}
/// # Safety
/// The handle is unpublished and builder-owned.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn np_link_mute(engine: *mut NativeEngine, link: u32, track: u32) {
    if let Some(e) = unsafe { engine.as_mut() } {
        if let Some(l) = e.project.links.get_mut(link as usize) {
            l.muted_tracks.push(track as usize);
        }
    }
}
/// # Safety
/// The handle is unpublished and builder-owned.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn np_project(engine: *mut NativeEngine, preset: i32, chain: bool) {
    if let Some(e) = unsafe { engine.as_mut() } {
        e.project.current_preset = preset;
        e.project.chain = chain && !e.project.links.is_empty();
    }
}
/// # Safety
/// The handle is live and unpublished. The allocation remains valid until destruction.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn np_config_buffer(engine: *const NativeEngine) -> *const AtomicI32 {
    unsafe { engine.as_ref() }.map_or(core::ptr::null(), |e| e.project.snapshot.as_ptr())
}
