//! Native, instance-local MIDI renderer. All configuration/allocation happens
//! before publishing an engine; rendering and live state transfer allocate nothing.
use metropolix_core::{
    modulation::MOD_LANES,
    sequencer::{Sequencer, field as f},
};
use std::{
    ffi::c_void,
    sync::atomic::{AtomicI32, Ordering},
};

mod project;
use project::{HEADER, Project, config_index};

type Emit = extern "C" fn(*mut c_void, u32, u8, u8, u8);
#[derive(Clone, Copy)]
struct Note {
    channel: u8,
    key: u8,
}

pub struct NativeEngine {
    seq: Sequencer,
    notes: Vec<Option<Note>>,
    cc: Vec<[i16; 128]>,
    readouts: Vec<AtomicI32>,
    next_tick: f64,
    expected_beat: f64,
    was_playing: bool,
    project: Project,
    mutes: Vec<i32>,
    mod_mutes: [i32; MOD_LANES],
    mx_high: u8,
    mx_channel: u8,
    mx_message: i32,
}
impl NativeEngine {
    pub fn new(tracks: usize) -> Self {
        let mut seq = Sequencer::default();
        seq.resize_tracks(tracks.max(1));
        let count = seq.tracks.len();
        let mut result = Self {
            seq,
            notes: vec![None; count],
            cc: vec![[-1; 128]; count + MOD_LANES + 1],
            readouts: (0..(HEADER + count * 10 + MOD_LANES * 2))
                .map(|_| AtomicI32::new(0))
                .collect(),
            next_tick: 0.0,
            expected_beat: f64::NAN,
            was_playing: false,
            project: Project::new(count),
            mutes: vec![0; count],
            mod_mutes: [0; MOD_LANES],
            mx_high: 0,
            mx_channel: 0,
            mx_message: 0,
        };
        result.capture_defaults();
        result
    }
    fn off(&mut self, track: usize, offset: u32, ctx: *mut c_void, emit: Emit) {
        if let Some(note) = self.notes[track].take() {
            emit(ctx, offset, 0x80 | note.channel, note.key, 0);
        }
    }
    fn silence(&mut self, ctx: *mut c_void, emit: Emit) {
        self.silence_at(0, ctx, emit);
    }
    fn silence_at(&mut self, offset: u32, ctx: *mut c_void, emit: Emit) {
        for i in 0..self.notes.len() {
            self.off(i, offset, ctx, emit);
        }
        self.release_mx(offset, ctx, emit);
    }
    fn release_mx(&mut self, offset: u32, ctx: *mut c_void, emit: Emit) {
        for i in 0..8 {
            if self.mx_high & (1 << i) != 0 && self.mx_channel > 0 {
                let status = if self.mx_message == 0 { 0xb0 } else { 0x80 };
                let number = if self.mx_message == 0 {
                    102 + i
                } else {
                    35 + i
                };
                emit(ctx, offset, status | (self.mx_channel - 1), number, 0);
            }
        }
        self.mx_high = 0;
    }
    fn channel(&self, source: usize) -> u8 {
        let configured = self.seq.tracks[source].config[f::MIDI_CHANNEL];
        if configured == 0 {
            (source % 16) as u8
        } else {
            (configured - 1) as u8
        }
    }
    #[allow(clippy::too_many_arguments)] // Fixed MIDI/host callback ABI.
    fn control(
        &mut self,
        stream: usize,
        channel: i32,
        cc: i32,
        value: i32,
        offset: u32,
        ctx: *mut c_void,
        emit: Emit,
    ) {
        if !(0..16).contains(&channel) || !(0..128).contains(&cc) {
            return;
        }
        let value = value.clamp(0, 127) as i16;
        if self.cc[stream][cc as usize] == value {
            return;
        }
        self.cc[stream][cc as usize] = value;
        emit(ctx, offset, 0xb0 | channel as u8, cc as u8, value as u8);
    }
    fn tick(&mut self, offset: u32, ctx: *mut c_void, emit: Emit) {
        self.before_tick(offset, ctx, emit);
        self.apply_mutes();
        self.seq.tick();
        self.restore_mutes();
        self.project.music_tick += 1;
        for source in 0..self.seq.tracks.len() {
            let track = if self.seq.swapped && source < 2 && self.notes.len() > 1 {
                source ^ 1
            } else {
                source
            };
            let flags = self.seq.track_events(source);
            let channel = self.channel(source);
            let changed_channel = self.notes[track].is_some_and(|n| n.channel != channel);
            if flags & 2 != 0 || changed_channel {
                self.off(track, offset, ctx, emit);
            }
            let pitch = flags & 0x100 != 0 && self.seq.gate(source) && self.notes[track].is_some();
            if flags & 1 != 0 || pitch || (changed_channel && self.seq.gate(source)) {
                let key = self.seq.note(source).unwrap_or(60).clamp(0, 127) as u8;
                let velocity = self.seq.velocity(source).clamp(0, 127) as u8;
                if velocity > 0 {
                    if !pitch {
                        self.off(track, offset, ctx, emit);
                    }
                    let old = self.notes[track];
                    emit(ctx, offset, 0x90 | channel, key, velocity);
                    if pitch
                        && let Some(old) = old
                        && (old.key != key || old.channel != channel)
                    {
                        emit(ctx, offset, 0x80 | old.channel, old.key, 0);
                    }
                    self.notes[track] = Some(Note { channel, key });
                } else {
                    self.off(track, offset, ctx, emit);
                }
            }
            let config = self.seq.tracks[source].config;
            let cv = self.seq.cv(source);
            let value = if config[f::CV_TYPE] == 0 {
                (cv + 5000) * 127 / 10000
            } else {
                cv * 127 / 5000
            };
            self.control(
                track,
                channel as i32,
                config[f::CV_CC],
                value,
                offset,
                ctx,
                emit,
            );
            let slide = self.seq.slide(source);
            self.control(
                track,
                channel as i32,
                config[f::SLIDE_CC],
                if slide { 127 } else { 0 },
                offset,
                ctx,
                emit,
            );
            let value = if config[f::SLIDE_CC_MODE] == 0 && !slide {
                0
            } else {
                self.seq.slide_amount(source) * 127 / 100
            };
            self.control(
                track,
                channel as i32,
                config[f::SLIDE_AMOUNT_CC],
                value,
                offset,
                ctx,
                emit,
            );
        }
        for i in 0..MOD_LANES {
            let config = self.seq.mods[i].config;
            let value = self.seq.mods[i].value();
            let value = if config[6] == 0 {
                (value + 5000) * 127 / 10000
            } else {
                value * 127 / 5000
            };
            self.control(
                self.notes.len() + i,
                config[10] - 1,
                config[11],
                value,
                offset,
                ctx,
                emit,
            );
        }
        self.mx_tick(offset, ctx, emit);
    }
    fn mx_tick(&mut self, offset: u32, ctx: *mut c_void, emit: Emit) {
        let channel = self.seq.mx_config[3] as u8;
        let message = self.project.values[11];
        if channel != self.mx_channel || message != self.mx_message {
            self.release_mx(offset, ctx, emit);
        }
        self.mx_channel = channel;
        self.mx_message = message;
        if channel == 0 {
            return;
        }
        let mask = self.seq.mx_value() as u8;
        for i in 0..8 {
            let bit = 1 << i;
            if (mask ^ self.mx_high) & bit == 0 {
                continue;
            }
            let high = mask & bit != 0;
            let status = if message == 0 {
                0xb0
            } else if high {
                0x90
            } else {
                0x80
            };
            emit(
                ctx,
                offset,
                status | (channel - 1),
                if message == 0 { 102 + i } else { 35 + i },
                if high { 127 } else { 0 },
            );
        }
        self.mx_high = mask;
    }
    fn publish(&mut self, bpm: f64, playing: bool) {
        let values = [
            (bpm * 1000.0).round() as i32,
            self.seq.output_value(0),
            self.seq.output_value(1),
            self.seq.mx_value() as i32,
            i32::from(self.seq.clock),
            i32::from(self.seq.swapped),
            i32::from(playing),
            self.seq.cycle_position() as i32,
            self.seq.tracks.len() as i32,
            self.project.current_preset,
            i32::from(self.project.chain),
            self.project.link as i32,
            self.project.repeat as i32,
            self.project.queued,
            self.project.recall as i32,
            self.project.music_tick.min(i32::MAX as u64) as i32,
        ];
        for (out, value) in self.readouts.iter().zip(values) {
            out.store(value, Ordering::Relaxed);
        }
        for i in 0..self.seq.tracks.len() {
            let values = [
                self.seq.stage(i).unwrap_or(0) as i32,
                self.seq.note(i).unwrap_or(-1),
                self.seq.cents(i),
                self.seq.cv(i),
                self.seq.velocity(i),
                i32::from(self.seq.gate(i)),
                self.seq.accumulator(i),
                i32::from(self.seq.loopy_active(i)),
                self.seq.slide_amount(i),
                self.seq.slide_type(i),
            ];
            for (j, value) in values.into_iter().enumerate() {
                self.readouts[HEADER + i * 10 + j].store(value, Ordering::Relaxed);
            }
        }
        for i in 0..MOD_LANES {
            let base = HEADER + self.notes.len() * 10 + i * 2;
            self.readouts[base].store(self.seq.mods[i].stage() as i32, Ordering::Relaxed);
            self.readouts[base + 1].store(self.seq.mods[i].value(), Ordering::Relaxed);
        }
        self.project.publish(self.seq.tracks.len());
    }
    #[allow(clippy::too_many_arguments)] // Mirrors the host transport block.
    fn render(
        &mut self,
        frames: u32,
        rate: f64,
        bpm: f64,
        beat: f64,
        playing: bool,
        ctx: *mut c_void,
        emit: Emit,
    ) {
        if frames == 0 || !rate.is_finite() || rate <= 0.0 {
            return;
        }
        let bpm = if bpm.is_finite() {
            bpm.clamp(0.1, 999.0)
        } else {
            120.0
        };
        let start = if beat.is_finite() {
            beat
        } else if self.expected_beat.is_finite() {
            self.expected_beat
        } else {
            0.0
        };
        let discontinuity =
            self.expected_beat.is_finite() && (start - self.expected_beat).abs() > 0.002;
        if playing && (!self.was_playing || discontinuity) {
            self.silence(ctx, emit);
            self.seq.restart();
            self.project.music_tick = 0;
            self.project.elapsed = 0;
            self.project.repeat = 0;
            self.project.link = 0;
            if self.project.chain {
                self.recall(self.project.links[0].preset, 0, ctx, emit);
            }
            self.next_tick = (start * 96.0 - 1e-7).ceil();
            for stream in &mut self.cc {
                stream.fill(-1);
            }
        }
        if !playing {
            if self.project.queued >= 0 {
                let slot = self.project.queued;
                self.project.queued = -1;
                self.recall(slot as usize, 0, ctx, emit);
            }
            if self.was_playing {
                self.silence(ctx, emit);
            }
            self.was_playing = false;
            self.expected_beat = f64::NAN;
            self.publish(bpm, false);
            return;
        }
        // Host transport owns tempo; BPM modulation cannot desynchronise the AU.
        self.seq.set_global(8, 1);
        self.seq
            .set_global(0, (bpm.min(400.0) * 1000.0).round() as i32);
        let ticks_per_sample = bpm * 96.0 / (60.0 * rate);
        let start_tick = start * 96.0;
        let end_tick = start_tick + frames as f64 * ticks_per_sample;
        while self.next_tick < end_tick - 1e-8 {
            let offset = ((self.next_tick - start_tick) / ticks_per_sample)
                .round()
                .clamp(0.0, frames.saturating_sub(1) as f64) as u32;
            self.tick(offset, ctx, emit);
            self.next_tick += 1.0;
        }
        self.expected_beat = start + frames as f64 * bpm / (60.0 * rate);
        self.was_playing = true;
        self.publish(bpm, true);
    }
}

// The C++ host owns these opaque handles. Configuration/deletion are non-realtime;
// a published handle is rendered by one audio thread only. Readout atoms are shared.
#[unsafe(no_mangle)]
pub extern "C" fn np_create(tracks: u32) -> *mut NativeEngine {
    Box::into_raw(Box::new(NativeEngine::new(tracks as usize)))
}
/// # Safety
/// The handle must have been created by np_create and retired from rendering; it may be null and must not be freed twice.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn np_destroy(engine: *mut NativeEngine) {
    if !engine.is_null() {
        drop(unsafe { Box::from_raw(engine) });
    }
}
/// # Safety
/// A non-null handle must be exclusively owned by the caller during configuration.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn np_set(
    engine: *mut NativeEngine,
    kind: u32,
    index: u32,
    stage: u32,
    field: u32,
    value: i32,
) -> bool {
    let Some(e) = (unsafe { engine.as_mut() }) else {
        return false;
    };
    e.set_config(kind, index, stage, field, value)
}

impl NativeEngine {
    fn set_config(&mut self, kind: u32, index: u32, stage: u32, field: u32, value: i32) -> bool {
        let target =
            (kind == 4 && field == 1) || (kind == 2 && field == 8) || (kind == 6 && field == 10);
        let valid_target = value == 2
            || (value >= 0
                && if value < 2 {
                    (value as usize) < self.seq.tracks.len()
                } else {
                    value as usize <= self.seq.tracks.len()
                });
        let value = if target && value >= 0 && !valid_target {
            2
        } else {
            value
        };
        let (i, n) = (index as usize, stage as usize);
        let valid = match kind {
            0 => self.seq.set_track(i, field, value),
            1 => self.seq.set_step(i, n, field, value),
            2 => self
                .seq
                .mods
                .get_mut(i)
                .is_some_and(|m| m.set(field, value)),
            3 => self
                .seq
                .mods
                .get_mut(i)
                .is_some_and(|m| m.set_step(n, field, value)),
            4 => {
                let routes = if stage == 0 {
                    &mut self.seq.controls[..]
                } else {
                    &mut self.seq.aux[..]
                };
                routes.get_mut(i).is_some_and(|r| r.set(field, value))
            }
            5 => self.seq.set_scale(i, value, field as i32),
            6 if field == 11 => (0..=1).contains(&value),
            6 => self.seq.set_global(field, value),
            13 => field < 6 && value >= 0 && value <= [2, 4096, 2, 1, 3, 1][field as usize],
            7 => self.seq.set_output(i, field as i32, value),
            18 if i < 100 => self
                .seq
                .set_scale(i + 49, value, self.project.values[569 + i * 2]),
            19 if i < 100 => self
                .seq
                .set_scale(i + 49, self.project.values[568 + i * 2], value),
            20 | 21 if i < 2 => {
                let output = if kind == 20 {
                    value
                } else {
                    self.project.values[564 + i * 2]
                };
                let source = if kind == 21 {
                    value
                } else {
                    self.project.values[565 + i * 2]
                };
                let limit = if [7, 8, 18].contains(&output) {
                    8
                } else {
                    self.seq.tracks.len()
                };
                source >= 0 && self.seq.set_output(i, output, source % limit as i32)
            }
            8 => self.seq.set_loopy(i, stage as i32, field as i32, value),
            9 => self.seq.reset_track(i, value != 0),
            _ => false,
        };
        if valid {
            if let Some(at) = config_index(kind, index, stage, field) {
                if let Some(out) = self.project.values.get_mut(at) {
                    *out = if kind == 7 { field as i32 } else { value };
                }
                if kind == 5 || kind == 7 {
                    self.project.values[at + 1] = if kind == 5 { field as i32 } else { value };
                }
                if kind == 20 || kind == 21 {
                    self.project.values[564 + i * 2..566 + i * 2]
                        .copy_from_slice(&self.seq.output_config[i]);
                }
                self.project.dirty = true;
            }
        }
        valid
    }
}
/// # Safety
/// A non-null handle must be exclusively owned by the builder before publication.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn np_seal(engine: *mut NativeEngine) {
    if let Some(e) = unsafe { engine.as_mut() } {
        e.seal_project();
        e.seq.restart();
        e.publish(120.0, false);
    }
}
/// # Safety
/// The handles must be distinct, live, exclusively owned by the render thread. The callback/context must remain valid throughout the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn np_adopt(
    engine: *mut NativeEngine,
    previous: *mut NativeEngine,
    reset: bool,
    ctx: *mut c_void,
    emit: Emit,
) {
    let (Some(e), Some(old)) = (unsafe { engine.as_mut() }, unsafe { previous.as_mut() }) else {
        return;
    };
    e.project.recall = old.project.recall;
    e.project.dirty = true;
    if reset {
        old.silence(ctx, emit);
    } else {
        e.seq.inherit_playback(&mut old.seq);
        for i in 0..old.notes.len() {
            if i < e.seq.tracks.len()
                && old.notes[i].is_none_or(|note| note.channel == e.channel(i))
            {
                e.notes[i] = old.notes[i].take();
            } else {
                old.off(i, 0, ctx, emit);
            }
        }
        e.next_tick = old.next_tick;
        e.expected_beat = old.expected_beat;
        e.was_playing = old.was_playing;
        e.project.music_tick = old.project.music_tick;
        e.project.elapsed = old.project.elapsed;
        e.project.repeat = old.project.repeat;
        e.project.link = old
            .project
            .link
            .min(e.project.links.len().saturating_sub(1));
        e.project.queued = old.project.queued;
        e.project.recall = old.project.recall;
        e.project.solo = old.project.solo;
        e.mx_high = old.mx_high;
        old.mx_high = 0;
        e.mx_channel = old.mx_channel;
        e.mx_message = old.mx_message;
        e.project.dirty = true;
        // New routing may use a different channel or CC. Re-publish its values.
    }
}
/// Remove the deleted track from old playback before adopting the prepared replacement.
/// # Safety
/// The old handle is exclusively render-owned and will be retired after adoption.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn np_delete_track(
    engine: *mut NativeEngine,
    index: u32,
    ctx: *mut c_void,
    emit: Emit,
) {
    if let Some(e) = unsafe { engine.as_mut() } {
        let i = index as usize;
        if e.seq.tracks.len() > 1 && i < e.seq.tracks.len() {
            e.off(i, 0, ctx, emit);
            e.seq.remove_track(i);
            e.notes.remove(i);
        }
    }
}
/// # Safety
/// A non-null handle must be exclusively owned by one render thread. The callback/context must remain valid throughout the call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn np_process(
    engine: *mut NativeEngine,
    frames: u32,
    rate: f64,
    bpm: f64,
    beat: f64,
    playing: bool,
    ctx: *mut c_void,
    emit: Emit,
) {
    if let Some(e) = unsafe { engine.as_mut() } {
        e.render(frames, rate, bpm, beat, playing, ctx, emit);
    }
}
/// # Safety
/// The handle must be exclusively owned by the render thread; the MIDI callback
/// and its context remain valid throughout this call.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn np_command(
    engine: *mut NativeEngine,
    kind: u32,
    index: u32,
    stage: u32,
    field: u32,
    value: i32,
    ctx: *mut c_void,
    emit: Emit,
) {
    let Some(e) = (unsafe { engine.as_mut() }) else {
        return;
    };
    let i = index as usize;
    match kind {
        10 if i < e.seq.tracks.len() => {
            e.off(i, 0, ctx, emit);
            if value != 0 && e.seq.audition(i, stage as usize, true) {
                let key = e.seq.note(i).unwrap_or(60).clamp(0, 127) as u8;
                let velocity = e.seq.velocity(i).clamp(1, 127) as u8;
                let channel = e.channel(i);
                emit(ctx, 0, 0x90 | channel, key, velocity);
                e.notes[i] = Some(Note { channel, key });
            } else {
                e.seq.audition(i, stage as usize, false);
            }
        }
        11 => {
            e.seq.tune(field as i32, value != 0);
            for i in 0..e.seq.tracks.len() {
                e.off(i, 0, ctx, emit);
                if value != 0 {
                    let channel = e.channel(i);
                    let key = field.min(127) as u8;
                    emit(ctx, 0, 0x90 | channel, key, 90);
                    e.notes[i] = Some(Note { channel, key });
                }
            }
        }
        12 => e.silence(ctx, emit),
        15 => e.request_preset(value, ctx, emit),
        16 => e.enable_chain(value != 0, ctx, emit),
        17 => e.project.solo = value,
        _ => {
            unsafe { np_set(engine, kind, index, stage, field, value) };
        }
    }
}
/// # Safety
/// The handle must be live and exclusively owned by the builder, before it is published. The returned allocation lives until np_destroy.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn np_readout_buffer(engine: *const NativeEngine) -> *const AtomicI32 {
    // Called only by the builder, before the engine is published.
    unsafe { engine.as_ref() }.map_or(core::ptr::null(), |e| e.readouts.as_ptr())
}
/// # Safety
/// The buffer must be live and the index within the builder-recorded readout or snapshot allocation. The host must prevent retirement while reading.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn np_read(readouts: *const AtomicI32, index: u32) -> i32 {
    // The C++ prepared state records the immutable readout count and retains the
    // allocation until after its snapshot finishes. No shared Engine reference.
    unsafe { &*readouts.add(index as usize) }.load(Ordering::SeqCst)
}

#[cfg(test)]
mod tests {
    use super::*;

    use std::alloc::{GlobalAlloc, Layout, System};
    use std::cell::Cell;
    struct CheckedAllocator;
    thread_local! {static REALTIME: Cell<bool> = const {Cell::new(false)};static HEAP_OPS: Cell<usize> = const {Cell::new(0)};}
    fn heap_op() {
        if REALTIME.try_with(Cell::get).unwrap_or(false) {
            HEAP_OPS.with(|n| n.set(n.get() + 1));
        }
    }
    unsafe impl GlobalAlloc for CheckedAllocator {
        unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
            heap_op();
            unsafe { System.alloc(layout) }
        }
        unsafe fn dealloc(&self, p: *mut u8, layout: Layout) {
            heap_op();
            unsafe { System.dealloc(p, layout) }
        }
        unsafe fn realloc(&self, p: *mut u8, layout: Layout, size: usize) -> *mut u8 {
            heap_op();
            unsafe { System.realloc(p, layout, size) }
        }
    }
    #[global_allocator]
    static ALLOCATOR: CheckedAllocator = CheckedAllocator;
    #[test]
    fn rendering_and_configuration_transfer_do_no_heap_work() {
        let mut previous = NativeEngine::new(2);
        let mut next = NativeEngine::new(65);
        let mut out = Vec::with_capacity(16384);
        HEAP_OPS.with(|n| n.set(0));
        REALTIME.with(|v| v.set(true));
        render(&mut previous, 512, 0.0, true, &mut out);
        unsafe {
            np_adopt(
                &mut next,
                &mut previous,
                false,
                &mut out as *mut _ as *mut c_void,
                collect,
            )
        };
        render(&mut next, 512, 512.0 / 24000.0, true, &mut out);
        render(&mut next, 512, 1024.0 / 24000.0, false, &mut out);
        REALTIME.with(|v| v.set(false));
        assert_eq!(HEAP_OPS.with(Cell::get), 0);
    }

    extern "C" fn collect(ctx: *mut c_void, offset: u32, status: u8, a: u8, b: u8) {
        unsafe { &mut *(ctx as *mut Vec<(u32, u8, u8, u8)>) }.push((offset, status, a, b));
    }
    #[allow(clippy::too_many_arguments)] // Mirrors the host transport block.
    fn render(
        e: &mut NativeEngine,
        n: u32,
        beat: f64,
        playing: bool,
        out: &mut Vec<(u32, u8, u8, u8)>,
    ) {
        e.render(
            n,
            48000.0,
            120.0,
            beat,
            playing,
            out as *mut _ as *mut c_void,
            collect,
        );
    }
    #[test]
    fn sample_offsets_and_stop_release_are_exact() {
        let mut e = NativeEngine::new(1);
        let mut out = Vec::new();
        render(&mut e, 7000, 0.0, true, &mut out);
        let ons: Vec<_> = out
            .iter()
            .filter(|x| x.1 & 0xf0 == 0x90)
            .map(|x| x.0)
            .collect();
        assert_eq!(ons, [0, 6000]);
        assert!(out.iter().any(|x| x.1 & 0xf0 == 0x80));
        out.clear();
        render(&mut e, 128, 7000.0 / 24000.0, false, &mut out);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0].1 & 0xf0, 0x80);
        out.clear();
        render(&mut e, 128, 0.0, false, &mut out);
        assert!(out.is_empty());
    }
    #[test]
    fn accumulator_stage_period_controls_native_midi_independently_of_pulses() {
        let mut e = NativeEngine::new(2);
        assert!(e.set_config(5, 49, 0, 0, 4095));
        for i in 0..2 {
            for (field, value) in [
                (f::SCALE, 49),
                (f::ACCUM_SCOPE, 1),
                (f::ACCUM_RESET, 3),
                (f::ACCUM_STAGES, [3, 2][i as usize]),
                (f::ACCUM_POSITIVE, 28),
                (f::SWING, 50),
            ] {
                assert!(e.set_config(0, i, 0, field as u32, value));
            }
            for n in 0..16 {
                assert!(e.set_config(1, i, n, 0, 60));
                assert!(e.set_config(1, i, n, 1, 2 + i as i32));
                assert!(e.set_config(1, i, n, 2, 1));
                assert!(e.set_config(1, i, n, 7, 1));
            }
        }
        e.seal_project();
        let mut out = Vec::new();
        render(&mut e, 72001, 0.0, true, &mut out);
        let starts = |channel: u8| {
            out.iter()
                .filter(|v| v.1 == (0x90u8 | channel))
                .map(|v| (v.0, v.2))
                .collect::<Vec<_>>()
        };
        assert_eq!(
            starts(0),
            [
                (0, 60),
                (12000, 61),
                (24000, 62),
                (36000, 60),
                (48000, 61),
                (60000, 62),
                (72000, 60)
            ]
        );
        assert_eq!(
            starts(1),
            [(0, 60), (18000, 61), (36000, 60), (54000, 61), (72000, 60)]
        );
        let at = config_index(0, 1, 0, f::ACCUM_STAGES as u32).unwrap();
        assert_eq!(e.project.values[at], 2);
        assert_eq!(
            config_index(1, 0, 0, 0),
            Some(project::TRACK_BASE + f::COUNT)
        );
    }
    #[test]
    fn fractional_track_clocks_are_independent_and_sample_accurate() {
        use metropolix_core::sequencer::{CLOCK_DIVISION_HALF, CLOCK_DIVISION_QUARTER};
        let mut e = NativeEngine::new(3);
        let mut out = Vec::new();
        assert!(e.set_config(0, 1, 0, f::DIVISION as u32, CLOCK_DIVISION_HALF));
        assert!(e.set_config(0, 2, 0, f::DIVISION as u32, CLOCK_DIVISION_QUARTER));
        render(&mut e, 6001, 0.0, true, &mut out);
        let starts = |channel: u8| {
            out.iter()
                .filter(|v| v.1 == (0x90u8 | channel))
                .map(|v| v.0)
                .collect::<Vec<_>>()
        };
        assert_eq!(starts(0), [0, 6000]);
        assert_eq!(starts(1), [0, 3000, 6000]);
        assert_eq!(starts(2), [0, 1500, 3000, 4500, 6000]);
    }
    #[test]
    fn quarter_clock_swing_keeps_the_pair_length_and_global_reset_boundary() {
        use metropolix_core::sequencer::CLOCK_DIVISION_QUARTER;
        let mut e = NativeEngine::new(1);
        let mut out = Vec::new();
        e.set_config(0, 0, 0, f::DIVISION as u32, CLOCK_DIVISION_QUARTER);
        e.set_config(0, 0, 0, f::SWING as u32, 75);
        e.set_config(6, 0, 0, 1, 3);
        render(&mut e, 18001, 0.0, true, &mut out);
        let starts: Vec<_> = out.iter().filter(|v| v.1 == 0x90).map(|v| v.0).collect();
        assert_eq!(&starts[..5], [0, 2250, 3000, 5250, 6000]);
        assert!(starts.contains(&18000));
        assert_eq!(e.seq.stage(0), Some(0));
        assert_eq!(e.seq.cycle_position(), 0);
    }
    #[test]
    fn blocks_do_not_change_the_generated_sequence() {
        let run = |sizes: &[u32]| {
            let mut e = NativeEngine::new(3);
            let mut result = Vec::new();
            let mut absolute = 0;
            for &n in sizes {
                let mut out = Vec::new();
                render(&mut e, n, absolute as f64 / 24000.0, true, &mut out);
                result.extend(out.into_iter().map(|(t, s, a, b)| (t + absolute, s, a, b)));
                absolute += n;
            }
            result
        };
        assert_eq!(run(&[24000]), run(&[1, 511, 1024, 128, 8000, 14336]));
    }
    #[test]
    fn instances_are_independent_and_global_cycle_wraps() {
        let mut a = NativeEngine::new(1);
        let b = NativeEngine::new(1);
        let mut out = Vec::new();
        a.seq.set_global(1, 7);
        render(&mut a, 42001, 0.0, true, &mut out);
        assert_eq!(a.seq.cycle_position(), 0);
        assert_eq!(b.seq.ticks, 0);
    }
    #[test]
    fn seek_releases_held_notes_and_restarts() {
        let mut e = NativeEngine::new(1);
        let mut out = Vec::new();
        render(&mut e, 100, 0.0, true, &mut out);
        out.clear();
        render(&mut e, 100, 4.0, true, &mut out);
        assert_eq!(out[0].1 & 0xf0, 0x80);
        assert_eq!(out[1].1 & 0xf0, 0x90);
        assert_eq!(e.seq.cycle_position(), 0);
    }
    #[test]
    fn prepared_growth_keeps_existing_playheads_and_new_configuration() {
        let mut a = NativeEngine::new(2);
        let mut b = NativeEngine::new(30);
        let mut out = Vec::new();
        render(&mut a, 15000, 0.0, true, &mut out);
        b.seq.tracks[0].steps[0].pitch = 90;
        unsafe {
            np_adopt(
                &mut b,
                &mut a,
                false,
                &mut out as *mut _ as *mut c_void,
                collect,
            )
        };
        assert_eq!(b.seq.cycle_position(), a.seq.cycle_position());
        assert_eq!(b.seq.stage(0), Some(2));
        assert_eq!(b.seq.tracks[0].steps[0].pitch, 90);
        assert_eq!(b.notes.len(), 30);
    }

    fn arrangement() -> NativeEngine {
        let mut e = NativeEngine::new(1);
        for (slot, count, note, length) in [(0, 3, 60, 1), (1, 40, 72, 2)] {
            let mut p = NativeEngine::new(count);
            p.set_config(6, 0, 0, 1, length);
            for i in 0..count {
                for n in 0..16 {
                    p.set_config(1, i as u32, n, 8, note + i as i32);
                }
            }
            e.project.presets[slot] = Some(project::Pattern {
                tracks: count,
                values: p.project.values,
            });
        }
        e.project.links.push(project::Link {
            preset: 0,
            repeat: 2,
            mute_mask: 0,
            muted_tracks: vec![2],
        });
        e.project.links.push(project::Link {
            preset: 1,
            repeat: 1,
            mute_mask: 2,
            muted_tracks: vec![37],
        });
        e.seal_project();
        e
    }
    #[test]
    fn queued_recall_happens_on_the_exact_global_step_and_keeps_host_phase() {
        let mut e = arrangement();
        let mut out = Vec::new();
        e.set_config(6, 0, 0, 1, 2);
        e.set_config(13, 0, 0, 0, 2);
        render(&mut e, 100, 0.0, true, &mut out);
        e.request_preset(1, &mut out as *mut _ as *mut c_void, collect);
        assert_eq!(e.project.queued, 1);
        out.clear();
        render(&mut e, 12001, 100.0 / 24000.0, true, &mut out);
        assert_eq!(e.project.current_preset, 1);
        assert_eq!(e.seq.tracks.len(), 40);
        assert_eq!(e.project.queued, -1);
        assert!(
            out.iter()
                .any(|&(t, s, n, _)| t == 11900 && s == 0x90 && n == 72)
        );
        assert_eq!(e.next_tick, 49.0);
    }
    #[test]
    fn native_chain_repeat_mutes_and_varying_track_counts_work_without_heap_operations() {
        let mut e = arrangement();
        let mut out = Vec::with_capacity(50000);
        e.enable_chain(true, &mut out as *mut _ as *mut c_void, collect);
        out.clear();
        HEAP_OPS.with(|n| n.set(0));
        REALTIME.with(|v| v.set(true));
        render(&mut e, 12001, 0.0, true, &mut out);
        REALTIME.with(|v| v.set(false));
        assert_eq!(HEAP_OPS.with(Cell::get), 0);
        assert_eq!(e.project.link, 1);
        assert_eq!(e.project.repeat, 0);
        assert_eq!(e.seq.tracks.len(), 40);
        assert!(!out.iter().any(|&(t, s, _, _)| t < 12000 && s == 0x92));
        assert!(
            !out.iter()
                .any(|&(t, s, n, _)| t == 12000 && s & 0xf0 == 0x90 && (n == 73 || n == 109))
        );
        assert!(
            out.iter()
                .any(|&(t, s, n, _)| t == 12000 && s == 0x90 && n == 72)
        );
        assert_eq!(e.seq.tracks[37].config[f::MUTE], 0); // Arrangement masks never alter the patch.
    }
    #[test]
    fn chain_output_is_independent_of_host_buffer_sizes() {
        let run = |sizes: &[u32]| {
            let mut e = arrangement();
            let mut result = Vec::new();
            e.enable_chain(true, &mut result as *mut _ as *mut c_void, collect);
            result.clear();
            let mut absolute = 0;
            for &n in sizes {
                let mut out = Vec::new();
                render(&mut e, n, absolute as f64 / 24000.0, true, &mut out);
                result.extend(out.into_iter().map(|(t, s, a, b)| (t + absolute, s, a, b)));
                absolute += n;
            }
            result
        };
        assert_eq!(run(&[30001]), run(&[100, 5930, 20, 14000, 9951]));
    }
    #[test]
    fn recall_honors_selective_pitch_switch_control_and_aux_settings() {
        let mut e = arrangement();
        let mut out: Vec<(u32, u8, u8, u8)> = Vec::new();
        e.set_config(13, 0, 0, 2, 0);
        e.set_config(13, 0, 0, 3, 0);
        e.set_config(13, 0, 0, 4, 0);
        e.set_config(13, 0, 0, 5, 0);
        e.set_config(1, 0, 0, 0, 11);
        e.set_config(1, 0, 0, 1, 8);
        e.set_config(1, 0, 0, 2, 3);
        e.set_config(4, 0, 0, 2, 2300);
        e.set_config(4, 1, 1, 2, -2300);
        e.recall(0, 0, &mut out as *mut _ as *mut c_void, collect);
        assert_eq!(e.seq.tracks[0].steps[0].pitch, 11);
        assert_eq!(e.seq.tracks[0].steps[0].pulses, 8);
        assert_eq!(e.seq.tracks[0].steps[0].gate as u8, 3);
        assert_eq!(e.seq.controls[0].value, 2300);
        assert_eq!(e.seq.aux[1].value, -2300);
    }
    #[test]
    fn mx_notes_release_on_routing_change_and_stop() {
        let mut e = NativeEngine::new(1);
        let mut out = Vec::new();
        e.set_config(6, 0, 0, 7, 16);
        e.set_config(6, 0, 0, 11, 1);
        render(&mut e, 10, 0.0, true, &mut out);
        let notes: Vec<_> = out.iter().filter(|v| v.1 == 0x9f).collect();
        assert!(!notes.is_empty());
        out.clear();
        e.set_config(6, 0, 0, 7, 15);
        render(&mut e, 500, 10.0 / 24000.0, true, &mut out);
        assert!(out.iter().any(|v| v.1 == 0x8f));
        assert!(out.iter().any(|v| v.1 == 0x9e));
        out.clear();
        render(&mut e, 10, 510.0 / 24000.0, false, &mut out);
        assert!(out.iter().any(|v| v.1 == 0x8e));
        assert_eq!(e.mx_high, 0);
    }
    #[test]
    fn removing_a_middle_track_keeps_the_surviving_playhead() {
        let mut old = NativeEngine::new(3);
        let mut next = NativeEngine::new(2);
        let mut out = Vec::new();
        old.set_config(0, 2, 0, f::DIVISION as u32, 4);
        next.set_config(0, 1, 0, f::DIVISION as u32, 4);
        render(&mut old, 15000, 0.0, true, &mut out);
        let surviving = old.seq.stage(2);
        assert_ne!(old.seq.stage(1), surviving);
        unsafe {
            np_delete_track(&mut old, 1, &mut out as *mut _ as *mut c_void, collect);
            np_adopt(
                &mut next,
                &mut old,
                false,
                &mut out as *mut _ as *mut c_void,
                collect,
            );
        }
        assert_eq!(next.seq.stage(1), surviving);
    }
}
