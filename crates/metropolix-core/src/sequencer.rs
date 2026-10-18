//! Extended computer transport. Musical primitives are recovered from ARM;
//! transport/modulation routing follows the official 1.6.5 user manual.
use crate::{
    STAGES,
    accumulator::{Accumulator, AccumulatorConfig, AccumulatorMode, Polarity},
    modulation::{DESTINATIONS, MOD_LANES, ModLane, Route, destination as d},
    random::FirmwareRandom,
    scale::{FACTORY_SCALES, Quantizer, ScaleMask},
    timeline::{Position, Timeline, pulse_duration},
};
use alloc::vec::Vec;
pub const PPQN: u32 = 96;
pub const DEFAULT_TRACKS: usize = 2;

// Extend the integer ABI without changing any existing divisor's value.
pub const CLOCK_DIVISION_HALF: i32 = 65;
pub const CLOCK_DIVISION_QUARTER: i32 = 66;
pub(crate) fn clock_division_ticks(division: i32) -> u32 {
    match division {
        CLOCK_DIVISION_HALF => 12,
        CLOCK_DIVISION_QUARTER => 6,
        _ => 24 * division as u32,
    }
}
fn clock_division_index(division: i32) -> i32 {
    match division {
        CLOCK_DIVISION_QUARTER => 0,
        CLOCK_DIVISION_HALF => 1,
        _ => division + 1,
    }
}
fn clock_division_from_index(index: i32) -> i32 {
    match index.clamp(0, 65) {
        0 => CLOCK_DIVISION_QUARTER,
        1 => CLOCK_DIVISION_HALF,
        index => index - 1,
    }
}

/// Stable WASM configuration field IDs. The original eleven IDs are retained.
pub mod field {
    pub const ORDER: usize = 0;
    pub const LENGTH: usize = 1;
    pub const REVERSE: usize = 2;
    pub const DIVISION: usize = 3;
    pub const SCALE: usize = 4;
    pub const ROOT: usize = 5;
    pub const TRANSPOSE: usize = 6;
    pub const GATE: usize = 7;
    pub const MUTE: usize = 8;
    pub const ACCUM_ORDER: usize = 9;
    pub const ACCUM_POSITIVE: usize = 10;
    pub const SWING: usize = 11;
    pub const SLIDE_AMOUNT: usize = 12;
    pub const SLIDE_TYPE: usize = 13;
    pub const OFFSET: usize = 14;
    pub const PULSES_LENGTH: usize = 15;
    pub const PULSE_DIV: usize = 16;
    pub const GATE_SCALE: usize = 17;
    pub const ACCUM_NEGATIVE: usize = 18;
    pub const ACCUM_SCOPE: usize = 19;
    pub const ACCUM_POLARITY: usize = 20;
    pub const ACCUM_RESET: usize = 21;
    pub const SLIDER_OCTAVES: usize = 22;
    pub const SLIDER_INVERT: usize = 23;
    pub const PULSE_OVERRIDE: usize = 24;
    pub const GATE_OVERRIDE: usize = 25;
    pub const STRETCH: usize = 26;
    pub const RATCHET_MODE: usize = 27;
    pub const REST_PITCH: usize = 28;
    pub const GLOBAL_RESET: usize = 29;
    pub const VELOCITY: usize = 30;
    pub const VELOCITY_SOURCE: usize = 31;
    pub const CV_TYPE: usize = 32;
    pub const MIDI_CHANNEL: usize = 33;
    pub const CV_CC: usize = 34;
    pub const SLIDE_CC: usize = 35;
    pub const SLIDE_AMOUNT_CC: usize = 36;
    pub const SLIDE_CC_MODE: usize = 37;
    pub const BOTTOM_PITCH: usize = 38;
    pub const FADER_MODE: usize = 39;
    pub const MIN_NOTE: usize = 40;
    pub const MAX_NOTE: usize = 41;
    pub const ACCUM_STAGES: usize = 42;
    pub const COUNT: usize = 43;
}
use field as f;
pub const TRACK_RANGES: [(i32, i32); f::COUNT] = [
    (0, 20),
    (1, 16),
    (0, 1),
    (1, 66),
    (0, 148),
    (0, 11),
    (-60, 60),
    (0, 100),
    (0, 1),
    (0, 3),
    (1, 28),
    (50, 78),
    (0, 100),
    (0, 2),
    (0, 15),
    (0, 64),
    (1, 8),
    (0, 100),
    (1, 28),
    (0, 1),
    (0, 1),
    (0, 3),
    (1, 4),
    (0, 1),
    (0, 8),
    (0, 6),
    (0, 1),
    (0, 2),
    (0, 1),
    (0, 1),
    (0, 100),
    (0, 1),
    (0, 2),
    (0, 16),
    (-1, 127),
    (-1, 127),
    (-1, 127),
    (0, 1),
    (0, 108),
    (0, 1),
    (0, 127),
    (0, 127),
    (1, 1024),
];
fn default_config() -> [i32; f::COUNT] {
    [
        0, 16, 0, 1, 0, 0, 0, 55, 0, 0, 12, 50, 30, 0, 0, 0, 1, 100, 12, 1, 1, 0, 4, 0, 0, 0, 0, 0,
        1, 1, 75, 0, 0, 0, -1, -1, -1, 0, 36, 0, 0, 127, 16,
    ]
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum GateMode {
    Rest,
    Single,
    Multiple,
    Hold,
}
#[derive(Clone, Copy, Debug)]
pub struct Step {
    pub pitch: i16,
    pub pulses: u8,
    pub gate: GateMode,
    pub ratchet: u8,
    pub probability: u8,
    pub slide: bool,
    pub skip: bool,
    pub accumulate: i16,
    pub pitch_override: i16,
    pub gate_override: i16,
    pub probability_target: u8,
    pub accumulate_trigger: u8,
    pub cv: i32,
    pub cv_ramp: u8,
    pub cv_gate: bool,
}
impl Default for Step {
    fn default() -> Self {
        Self {
            pitch: 60,
            pulses: 1,
            gate: GateMode::Multiple,
            ratchet: 1,
            probability: 100,
            slide: false,
            skip: false,
            accumulate: 0,
            pitch_override: -1,
            gate_override: -1,
            probability_target: 0,
            accumulate_trigger: 0,
            cv: 0,
            cv_ramp: 0,
            cv_gate: false,
        }
    }
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub struct LoopRegion {
    pub start: u8,
    pub end: u8,
    pub pulses: u8,
}
struct ModFrame {
    values: [i32; DESTINATIONS],
    present: [bool; DESTINATIONS],
}
impl Default for ModFrame {
    fn default() -> Self {
        Self {
            values: [0; DESTINATIONS],
            present: [false; DESTINATIONS],
        }
    }
}
impl ModFrame {
    fn add(&mut self, route: Route, aux: bool, track: usize) {
        if route.destination != 0
            && (route.targets(track) || matches!(route.destination, d::BPM | d::OUT_SWAP))
        {
            self.values[route.destination] += route.voltage(aux);
            self.present[route.destination] = true;
        }
    }
    fn for_track(mods: &[ModLane; MOD_LANES], aux: &[Route; 3], track: usize) -> Self {
        let mut frame = Self::default();
        for lane in mods {
            frame.add(lane.route(), false, track);
        }
        for &route in aux {
            frame.add(route, true, track);
        }
        frame
    }
}
struct Effective {
    cfg: [i32; f::COUNT],
    modulation: [i32; DESTINATIONS],
    present: [bool; DESTINATIONS],
}
impl Effective {
    fn gate(&self, dest: usize) -> bool {
        self.modulation[dest] >= 1500
    }
    fn scaled(&self, dest: usize, range: i32) -> i32 {
        self.modulation[dest] * range / 5000
    }
}

#[derive(Clone, Copy)]
struct Audition {
    stage: usize,
    cents: i32,
    cv: i32,
    velocity: i32,
    slide: bool,
    gate: bool,
}

pub struct Track {
    pub steps: [Step; STAGES],
    pub config: [i32; f::COUNT],
    audition: Option<Audition>,
    normal: Timeline,
    loopy: Timeline,
    region: Option<LoopRegion>,
    requested: Option<LoopRegion>,
    loopy_pulses: u8,
    loopy_targeted: bool,
    accumulator: Accumulator,
    accumulator_stages: u32,
    accumulator_period: u32,
    stage: u8,
    note: i32,
    cents: i32,
    cv: i32,
    cv_from: i32,
    velocity: i32,
    position: Position,
    gate_remaining: u32,
    gate_high: bool,
    hold: bool,
    pending_off: bool,
    enabled: bool,
    group_start: u32,
    group_span: u32,
    group_window: u32,
    group_elapsed: u32,
    group_count: u32,
    group_ratchet: u32,
    group_gate: u32,
    stage_draw: bool,
    pulse_draw: bool,
    prior_slide: bool,
    slide_active: bool,
    slide_amount: i32,
    slide_type: i32,
    previous_flags: [bool; DESTINATIONS],
    pub events: u32,
    pub changed: bool,
    pub reset_pulse: bool,
    pub last_pulse: bool,
    pub pulse: bool,
}
impl Track {
    fn new(random: &mut FirmwareRandom) -> Self {
        Self {
            steps: [Step::default(); STAGES],
            config: default_config(),
            audition: None,
            normal: Timeline::new(random),
            loopy: Timeline::new(random),
            region: None,
            requested: None,
            loopy_pulses: 0,
            loopy_targeted: true,
            accumulator: Accumulator::default(),
            accumulator_stages: 0,
            accumulator_period: 0,
            stage: 0,
            note: 60,
            cents: 6000,
            cv: 0,
            cv_from: 0,
            velocity: 95,
            position: Position::default(),
            gate_remaining: 0,
            gate_high: false,
            hold: false,
            pending_off: false,
            enabled: true,
            group_start: 0,
            group_span: 0,
            group_window: 0,
            group_elapsed: 0,
            group_count: 1,
            group_ratchet: 0,
            group_gate: 55,
            stage_draw: true,
            pulse_draw: true,
            prior_slide: false,
            slide_active: false,
            slide_amount: 30,
            slide_type: 0,
            previous_flags: [false; DESTINATIONS],
            events: 0,
            changed: false,
            reset_pulse: false,
            last_pulse: false,
            pulse: false,
        }
    }
    fn reset(&mut self, random: &mut FirmwareRandom, manual: bool) {
        self.audition = None;
        self.region = None;
        self.pending_off |= self.gate_high;
        self.gate_remaining = 0;
        self.gate_high = false;
        self.hold = false;
        self.normal.reset(&self.config, random);
        let mut lc = self.config;
        lc[f::ORDER] = 0;
        self.loopy.reset(&lc, random);
        if self.config[f::ACCUM_RESET] != 2 && (manual || self.config[f::ACCUM_RESET] == 1) {
            self.reset_accumulator();
        }
        self.position = Position::default();
        self.prior_slide = false;
        self.group_window = 0;
        self.cv = 0;
    }
    fn reset_accumulator(&mut self) {
        self.accumulator.reset();
        self.accumulator_stages = 0;
    }
    fn effective(&self, frame: &ModFrame, index: usize, controls: &[Route; 2]) -> Effective {
        let mut e = Effective {
            cfg: self.config,
            modulation: frame.values,
            present: frame.present,
        };
        for &control in controls {
            if control.destination != 0 && control.targets(index) {
                apply_control(&mut e, control);
            }
        }
        const MAP: [(usize, usize, i32); 22] = [
            (d::CLOCK_DIV, f::DIVISION, 63),
            (d::GATE_LENGTH, f::GATE, 100),
            (d::GATE_SCALE, f::GATE_SCALE, 100),
            (d::PULSE_COUNT, f::PULSE_OVERRIDE, 8),
            (d::PULSE_DIV, f::PULSE_DIV, 7),
            (d::PULSES_LENGTH, f::PULSES_LENGTH, 64),
            (d::ROOT, f::ROOT, 60),
            (d::ORDER, f::ORDER, 20),
            (d::SLIDE_AMOUNT, f::SLIDE_AMOUNT, 100),
            (d::SLIDER_RANGE, f::SLIDER_OCTAVES, 3),
            (d::STAGES_LENGTH, f::LENGTH, 15),
            (d::STAGES_OFFSET, f::OFFSET, 15),
            (d::SWING, f::SWING, 28),
            (d::VELOCITY, f::VELOCITY, 100),
            (d::DIRECTION, f::REVERSE, 0),
            (d::MUTE, f::MUTE, 0),
            (d::SLIDER_INVERT, f::SLIDER_INVERT, 0),
            (d::ACCUM_SCOPE, f::ACCUM_SCOPE, 0),
            (d::ACCUM_POLARITY, f::ACCUM_POLARITY, 0),
            (d::NONE, f::TRANSPOSE, 0),
            (d::NONE, f::ACCUM_ORDER, 0),
            (d::NONE, f::SLIDE_TYPE, 0),
        ];
        for (dest, field, range) in MAP {
            if dest == 0 {
                continue;
            }
            if range == 0 {
                if e.gate(dest) {
                    e.cfg[field] = 1 - e.cfg[field];
                }
            } else if dest != d::PULSE_COUNT {
                let (a, b) = TRACK_RANGES[field];
                let value = e.cfg[field] + e.scaled(dest, range);
                e.cfg[field] = if dest == d::CLOCK_DIV {
                    if e.cfg[field] >= CLOCK_DIVISION_HALF {
                        clock_division_from_index(
                            clock_division_index(e.cfg[field]) + e.scaled(dest, range),
                        )
                    } else {
                        value.clamp(1, 64)
                    }
                } else if dest == d::ROOT {
                    value.rem_euclid(12)
                } else {
                    value.clamp(a, b)
                };
            }
        }
        if e.cfg[f::SCALE] >= 49 && e.present[d::USER_SCALE] {
            let i = e.cfg[f::SCALE] - 49;
            e.cfg[f::SCALE] =
                49 + (i / 10) * 10 + (i % 10 + e.modulation[d::USER_SCALE] / 1000).rem_euclid(10);
        }
        e
    }
    fn gate_mode(&self, step: Step, e: &Effective) -> GateMode {
        let forced = e.cfg[f::GATE_OVERRIDE];
        if forced == 0 || (forced % 2 == 0 && step.gate == GateMode::Rest) {
            step.gate
        } else {
            match forced {
                1 | 2 => GateMode::Single,
                3 | 4 => GateMode::Multiple,
                _ => GateMode::Hold,
            }
        }
    }
    fn pitch(
        &self,
        step: Step,
        e: &Effective,
        scales: &[ScaleMask; 149],
        roots: &[i16; 100],
        stage: u8,
    ) -> i32 {
        let mut pitch = if step.pitch_override >= 0 {
            i32::from(step.pitch_override)
        } else if e.cfg[f::FADER_MODE] == 1 {
            let height = if e.cfg[f::SLIDER_INVERT] != 0 {
                127 - i32::from(step.pitch)
            } else {
                i32::from(step.pitch)
            };
            e.cfg[f::BOTTOM_PITCH] + (height * 12 * e.cfg[f::SLIDER_OCTAVES] + 63) / 127
        } else if e.cfg[f::SLIDER_INVERT] != 0 {
            2 * e.cfg[f::BOTTOM_PITCH] + 12 * e.cfg[f::SLIDER_OCTAVES] - i32::from(step.pitch)
        } else {
            i32::from(step.pitch)
        };
        pitch += e.scaled(d::PITCH_PRE, 60);
        let index = e.cfg[f::SCALE] as usize;
        let root = if index >= 49 {
            i32::from(roots[index - 49])
        } else {
            e.cfg[f::ROOT]
        };
        let acc = if e.cfg[f::ACCUM_SCOPE] == 0 {
            self.accumulator.stage(stage).unwrap().offset
        } else {
            self.accumulator.track().offset
        };
        let minimum = e.cfg[f::MIN_NOTE].min(e.cfg[f::MAX_NOTE]) as i16;
        let maximum = e.cfg[f::MIN_NOTE].max(e.cfg[f::MAX_NOTE]) as i16;
        let q = Quantizer::new(scales[index], root as i16, minimum, maximum).unwrap();
        q.quantize(
            pitch.clamp(-1000, 1000) as i16,
            0,
            acc as i16,
            (e.cfg[f::TRANSPOSE]
                + e.scaled(d::PITCH_POST, 60)
                + e.modulation[d::OCTAVE] / 1000 * 12)
                .clamp(-500, 500) as i16,
        )
        .clamp(0, 127)
    }
    fn accumulate(&mut self, step: Step, e: &Effective, random: &mut FirmwareRandom) {
        if e.present[d::ACCUMULATE] && !e.gate(d::ACCUMULATE) {
            return;
        }
        let mut config = AccumulatorConfig::new(
            [
                AccumulatorMode::Wrap,
                AccumulatorMode::Pendulum,
                AccumulatorMode::Brownian,
                AccumulatorMode::Clamp,
            ][e.cfg[f::ACCUM_ORDER] as usize],
            if e.cfg[f::ACCUM_POLARITY] == 0 {
                Polarity::Unipolar
            } else {
                Polarity::Bipolar
            },
            -e.cfg[f::ACCUM_NEGATIVE] as i16,
            e.cfg[f::ACCUM_POSITIVE] as i16,
        )
        .unwrap();
        config.reverse = e.gate(d::ACCUM_REVERSE);
        config.invert = e.gate(d::ACCUM_INVERT);
        self.accumulator
            .trigger(self.stage, step.accumulate, config, random)
            .unwrap();
    }
    fn loop_config(e: &Effective, region: LoopRegion) -> [i32; f::COUNT] {
        let mut cfg = e.cfg;
        cfg[f::ORDER] = 0;
        let pulses = (i32::from(region.pulses) + e.scaled(d::LOOPY_PULSES, 64)).clamp(0, 64);
        let single = region.start == region.end && pulses > 0;
        cfg[f::LENGTH] = if single {
            STAGES as i32
        } else {
            i32::from(region.end - region.start + 1)
        };
        cfg[f::OFFSET] = (i32::from(region.start)
            + e.scaled(d::LOOPY_OFFSET, 15)
            + i32::from(single && cfg[f::REVERSE] != 0))
        .rem_euclid(STAGES as i32);
        cfg[f::PULSES_LENGTH] = pulses;
        cfg
    }
    fn tick(
        &mut self,
        mut e: Effective,
        scales: &[ScaleMask; 149],
        roots: &[i16; 100],
        random: &mut FirmwareRandom,
    ) -> u32 {
        let old_cents = self.cents;
        for dest in [d::RESET, d::ACCUM_RESET, d::SKIP_INVERT] {
            let high = e.gate(dest);
            if high != self.previous_flags[dest] && (high || dest == d::SKIP_INVERT) {
                if dest == d::ACCUM_RESET {
                    self.reset_accumulator();
                } else {
                    self.reset(random, dest == d::RESET);
                }
            }
            self.previous_flags[dest] = high;
        }
        let mod_loop = e.gate(d::LOOPY) && self.loopy_targeted;
        if mod_loop {
            self.requested = Some(LoopRegion {
                start: 0,
                end: 0,
                pulses: self.loopy_pulses,
            });
        } else if self.previous_flags[d::LOOPY] {
            self.requested = None;
        }
        self.previous_flags[d::LOOPY] = mod_loop;
        if self.normal.at_pulse() && self.region != self.requested {
            self.region = self.requested;
            let cfg = self
                .region
                .map_or(e.cfg, |region| Self::loop_config(&e, region));
            self.loopy.reset(&cfg, random);
            self.group_window = 0;
        }
        let mut timeline_steps = self.steps;
        if e.present[d::PULSE_COUNT] {
            let offset = e.scaled(d::PULSE_COUNT, 7);
            for s in &mut timeline_steps {
                s.pulses = (i32::from(s.pulses) + offset).clamp(1, 8) as u8;
            }
            if e.cfg[f::PULSE_OVERRIDE] > 0 {
                e.cfg[f::PULSE_OVERRIDE] = (e.cfg[f::PULSE_OVERRIDE] + offset).clamp(1, 8);
            }
        }
        let normal = self.normal.prepare(
            &e.cfg,
            &timeline_steps,
            e.gate(d::SKIP_INVERT),
            false,
            random,
        );
        let mut position = normal;
        let active_limit = if let Some(region) = self.region {
            let cfg = Self::loop_config(&e, region);
            position = self
                .loopy
                .prepare(&cfg, &timeline_steps, false, true, random);
            cfg[f::PULSES_LENGTH]
        } else {
            e.cfg[f::PULSES_LENGTH]
        };
        self.stage = position.stage;
        self.position = position;
        self.changed = position.stage_start;
        self.pulse = position.pulse_start;
        self.reset_pulse = position.reset;
        self.last_pulse = active_limit > 0
            && position.pulse_start
            && position.pulse_serial % active_limit as u32 == active_limit as u32 - 1;
        if normal.reset && e.cfg[f::ACCUM_RESET] == 1 {
            self.reset_accumulator();
        }
        if position.stage_start && position.valid {
            let period = if e.cfg[f::ACCUM_RESET] == 3 {
                e.cfg[f::ACCUM_STAGES] as u32
            } else {
                0
            };
            if period != self.accumulator_period {
                self.accumulator_period = period;
                if period > 0 {
                    self.reset_accumulator();
                }
            }
            if period > 0 {
                if self.accumulator_stages >= period {
                    self.reset_accumulator();
                }
                self.accumulator_stages += 1;
            }
        }
        let mut step = self.steps[self.stage as usize];
        step.ratchet = (i32::from(step.ratchet) + e.scaled(d::RATCHET, 7)).clamp(1, 8) as u8;

        let mode = self.gate_mode(step, &e);
        let chance =
            (i32::from(step.probability) + e.scaled(d::PROBABILITY, 100)).clamp(0, 100) as u32;
        if position.stage_start {
            self.stage_draw = chance == 100 || random.next_u32() % 100 < chance;
            self.cv_from = self.cv;
        }
        if position.pulse_start {
            self.pulse_draw = if step.probability_target == 0 {
                self.stage_draw
            } else {
                chance == 100 || random.next_u32() % 100 < chance
            };
        }
        self.enabled = position.valid && self.pulse_draw && e.cfg[f::MUTE] == 0;
        if position.stage_start {
            self.slide_active = if e.cfg[f::SLIDE_TYPE] == 2 {
                self.prior_slide
            } else {
                step.slide || e.gate(d::SLIDE)
            };
            self.prior_slide = step.slide || e.gate(d::SLIDE);
        }
        self.slide_amount = e.cfg[f::SLIDE_AMOUNT];
        self.slide_type = e.cfg[f::SLIDE_TYPE];
        let cv_target = match e.cfg[f::CV_TYPE] {
            2 => {
                if step.cv_gate {
                    5000
                } else {
                    0
                }
            }
            1 => step.cv.max(0),
            _ => step.cv,
        };
        let cv_duration = if step.cv_ramp == 2 {
            position.duration
        } else {
            position.stage_duration
        };
        self.cv = if step.cv_ramp == 0 || e.cfg[f::CV_TYPE] == 2 {
            cv_target
        } else {
            self.cv_from
                + (cv_target - self.cv_from) * (position.stage_elapsed + 1).min(cv_duration) as i32
                    / cv_duration.max(1) as i32
        };
        self.velocity = if e.cfg[f::VELOCITY_SOURCE] == 1 {
            (self.cv.clamp(0, 5000) * 127 / 5000 + e.scaled(d::VELOCITY, 127)).clamp(0, 127)
        } else {
            e.cfg[f::VELOCITY] * 127 / 100
        };
        let mut events = if self.pending_off { 2 } else { 0 };
        self.pending_off = false;
        if self.gate_remaining > 0 {
            self.gate_remaining -= 1;
            if self.gate_remaining == 0 && !self.hold {
                self.gate_high = false;
                events |= 2;
            }
        }
        let gate_percent = if step.gate_override >= 0 {
            i32::from(step.gate_override)
        } else {
            e.cfg[f::GATE]
        };
        let gate_percent = (gate_percent * e.cfg[f::GATE_SCALE] / 100).clamp(0, 100) as u32;
        let acid_hold = e.cfg[f::SLIDE_TYPE] == 2 && (step.slide || e.gate(d::SLIDE));
        let is_hold = mode == GateMode::Hold || gate_percent == 100 || acid_hold;
        let group_start = position.pulse_start
            && match mode {
                GateMode::Rest => false,
                GateMode::Single | GateMode::Hold => position.pulse == 0,
                GateMode::Multiple => i32::from(position.pulse) % e.cfg[f::PULSE_DIV] == 0,
            };
        if group_start {
            let group_pulses = if mode == GateMode::Single || mode == GateMode::Hold {
                u32::from(position.pulses)
            } else {
                e.cfg[f::PULSE_DIV].min(i32::from(position.pulses - position.pulse)) as u32
            };
            self.group_span = if e.cfg[f::STRETCH] != 0 || is_hold {
                (0..group_pulses)
                    .map(|i| pulse_duration(&e.cfg, position.pulse_serial + i))
                    .sum()
            } else {
                position.duration
            };
            self.group_elapsed = 0;
            self.group_ratchet = 0;
            self.group_start = position.stage_elapsed;
            self.group_count = if is_hold { 1 } else { u32::from(step.ratchet) };
            self.group_window = if e.cfg[f::STRETCH] != 0 && e.cfg[f::RATCHET_MODE] == 1 && !is_hold
            {
                position.duration
            } else {
                self.group_span
            };
            if e.cfg[f::STRETCH] != 0 && e.cfg[f::RATCHET_MODE] == 2 && !is_hold {
                self.group_window = self.group_span * gate_percent / 100;
                self.group_count = (self.group_window * u32::from(step.ratchet))
                    .div_ceil(position.duration)
                    .max(1);
            }
            self.group_gate = gate_percent;
        }
        let ratchet_at = (self.group_ratchet * self.group_window)
            .checked_div(self.group_count)
            .unwrap_or(u32::MAX);
        let ratchet = self.group_window > 0
            && self.group_ratchet < self.group_count
            && self.group_elapsed >= ratchet_at;
        let can_accumulate = self.enabled && mode != GateMode::Rest;
        if position.stage_start && (mode != GateMode::Rest || e.cfg[f::REST_PITCH] != 0) {
            self.note = self.pitch(step, &e, scales, roots, self.stage);
        }
        if ratchet {
            self.group_ratchet += 1;
            if can_accumulate {
                self.note = self.pitch(step, &e, scales, roots, self.stage);
                let trigger = match step.accumulate_trigger {
                    0 => position.stage_start,
                    1 => self.group_ratchet == 1,
                    _ => true,
                };
                if trigger {
                    self.accumulate(step, &e, random);
                }
            }
            if self.enabled && gate_percent > 0 && mode != GateMode::Rest {
                let tied = self.hold && self.gate_high;
                if !tied {
                    if self.gate_high {
                        events |= 2;
                    }
                    events |= 1;
                } else {
                    events |= 0x100;
                }
                self.gate_high = true;
                self.hold = is_hold;
                self.gate_remaining = if is_hold {
                    0
                } else {
                    (self.group_window / self.group_count * self.group_gate / 100).max(1)
                };
            }
        }
        if position.stage_start
            && self.hold
            && (!self.enabled || mode == GateMode::Rest || gate_percent == 0)
        {
            self.hold = false;
            self.gate_high = false;
            self.gate_remaining = 0;
            events |= 2;
        }
        if e.cfg[f::MUTE] != 0 && self.gate_high {
            self.hold = false;
            self.gate_high = false;
            self.gate_remaining = 0;
            events |= 2;
        }
        self.cents = (self.note * 100 + e.scaled(d::PITCH_OFFSET, 6000)).clamp(0, 12700);
        if self.cents != old_cents {
            events |= 0x100;
        }
        self.group_elapsed = self.group_elapsed.saturating_add(1);
        self.normal.finish(normal);
        if self.region.is_some() {
            self.loopy.finish(position);
        }
        events
    }
}

fn apply_control(e: &mut Effective, route: Route) {
    let signed = route.value;
    let positive = (signed + 5000).clamp(0, 10000);
    let direct = match route.destination {
        d::CLOCK_DIV => Some(f::DIVISION),
        d::GATE_LENGTH => Some(f::GATE),
        d::GATE_SCALE => Some(f::GATE_SCALE),
        d::ORDER => Some(f::ORDER),
        d::PULSE_DIV => Some(f::PULSE_DIV),
        d::PULSES_LENGTH => Some(f::PULSES_LENGTH),
        d::SLIDE_AMOUNT => Some(f::SLIDE_AMOUNT),
        d::SLIDER_RANGE => Some(f::SLIDER_OCTAVES),
        d::STAGES_LENGTH => Some(f::LENGTH),
        d::STAGES_OFFSET => Some(f::OFFSET),
        d::SWING => Some(f::SWING),
        _ => None,
    };
    if let Some(field) = direct {
        let (a, b) = TRACK_RANGES[field];
        e.cfg[field] = if field == f::DIVISION {
            1 + positive * 63 / 10000
        } else {
            a + positive * (b - a) / 10000
        };
    } else if route.destination == d::ACCUM_DIR {
        e.present[d::ACCUMULATE] = true;
        e.modulation[d::ACCUMULATE] = if signed.abs() > 100 { 5000 } else { 0 };
        e.modulation[d::ACCUM_REVERSE] = if signed < -100 { 5000 } else { 0 };
    } else if route.destination == d::ACCUM_SCOPE {
        e.cfg[f::ACCUM_SCOPE] = i32::from(signed > 0);
    } else if route.destination == d::ACCUM_POLARITY {
        e.cfg[f::ACCUM_POLARITY] = i32::from(signed.abs() < 100);
        e.modulation[d::ACCUM_INVERT] = if signed < -100 { 5000 } else { 0 };
    } else if matches!(
        route.destination,
        d::SKIP_INVERT | d::SLIDER_INVERT | d::OUT_SWAP
    ) {
        e.modulation[route.destination] = if signed > 0 { 5000 } else { 0 };
        e.present[route.destination] = true;
    } else if route.destination == d::DIRECTION {
        e.cfg[f::REVERSE] = i32::from(signed < 0);
    } else {
        e.modulation[route.destination] += signed;
        e.present[route.destination] = true;
    }
}

pub struct Sequencer {
    pub tracks: Vec<Track>,
    pub mods: [ModLane; MOD_LANES],
    pub controls: [Route; 2],
    pub aux: [Route; 3],
    pub scales: [ScaleMask; 149],
    pub user_roots: [i16; 100],
    random: FirmwareRandom,
    pub ticks: u64,
    cycle_ticks: u32,
    pub total_pulses: u32,
    pub bpm_milli: i32,
    external_clock: bool,
    effective_bpm: i32,
    pub output_config: [[i32; 2]; 2],
    pub outputs: [i32; 2],
    pub mx_config: [i32; 4],
    pub mx: u32,
    pub clock_division: u32,
    pub clock_offset: u32,
    pub clock: bool,
    pub swapped: bool,
    pub reset_event: bool,
}
impl Default for Sequencer {
    fn default() -> Self {
        let mut random = FirmwareRandom::new(0x1234_5678, 0x9abc_def0);
        Self {
            tracks: (0..DEFAULT_TRACKS)
                .map(|_| Track::new(&mut random))
                .collect(),
            mods: core::array::from_fn(|_| ModLane::new(&mut random)),
            controls: [Route::default(); 2],
            aux: [Route::default(); 3],
            scales: core::array::from_fn(|i| {
                if i < 49 {
                    FACTORY_SCALES[i].mask
                } else {
                    ScaleMask::CHROMATIC
                }
            }),
            user_roots: [0; 100],
            random,
            ticks: 0,
            cycle_ticks: 0,
            total_pulses: 0,
            bpm_milli: 120000,
            external_clock: false,
            effective_bpm: 120000,
            output_config: [[4, 0], [5, 0]],
            outputs: [0; 2],
            mx_config: [0, 0, 0, 0],
            mx: 0,
            clock_division: 1,
            clock_offset: 0,
            clock: false,
            swapped: false,
            reset_event: false,
        }
    }
}
impl Sequencer {
    /// Adopt live playheads into a prepared configuration without allocating.
    /// The caller prepares track capacity off the audio thread and retires the
    /// previous sequencer off that thread after this transfer.
    pub fn inherit_playback(&mut self, previous: &mut Self) {
        for (next, old) in self.tracks.iter_mut().zip(&mut previous.tracks) {
            let config = next.config;
            let steps = next.steps;
            let loopy_pulses = next.loopy_pulses;
            let loopy_targeted = next.loopy_targeted;
            core::mem::swap(next, old);
            next.config = config;
            next.steps = steps;
            next.loopy_pulses = loopy_pulses;
            next.loopy_targeted = loopy_targeted;
        }
        for (next, old) in self.mods.iter_mut().zip(&mut previous.mods) {
            let config = next.config;
            let steps = next.steps;
            core::mem::swap(next, old);
            next.config = config;
            next.steps = steps;
        }
        self.random = previous.random;
        self.ticks = previous.ticks;
        self.cycle_ticks = previous.cycle_ticks;
        self.clock = previous.clock;
        self.reset_event = previous.reset_event;
    }
    /// Change capacity without resetting existing track playheads.
    pub fn resize_tracks(&mut self, count: usize) -> bool {
        if count == 0 {
            return false;
        }
        self.tracks.truncate(count);
        while self.tracks.len() < count {
            self.tracks.push(Track::new(&mut self.random));
        }
        true
    }
    pub fn remove_track(&mut self, index: usize) -> bool {
        if self.tracks.len() <= 1 || index >= self.tracks.len() {
            return false;
        }
        self.tracks.remove(index);
        let remap = |source: usize| {
            if source == index {
                0
            } else if source > index {
                source - 1
            } else {
                source
            }
        };
        let target = |encoded: usize| {
            if encoded == 2 {
                return 2;
            }
            let source = if encoded < 2 { encoded } else { encoded - 1 };
            crate::modulation::route_target(remap(source))
        };
        for route in self.controls.iter_mut().chain(self.aux.iter_mut()) {
            route.target = target(route.target);
        }
        for lane in &mut self.mods {
            lane.config[8] = target(lane.config[8] as usize) as i32;
        }
        for output in &mut self.output_config {
            if !matches!(output[0], 7 | 8 | 18) {
                output[1] = remap(output[1] as usize) as i32;
            }
        }
        if self.mx_config[0] == 5 {
            self.mx_config[1] = remap(self.mx_config[1] as usize) as i32;
        }
        true
    }
    pub fn track_events(&self, index: usize) -> u32 {
        self.tracks.get(index).map_or(0, |t| t.events)
    }
    pub fn reset(&mut self) {
        self.random = FirmwareRandom::new(0x1234_5678, 0x9abc_def0);
        for t in &mut self.tracks {
            if t.config[f::GLOBAL_RESET] != 0 {
                t.reset(&mut self.random, true);
            }
        }
        for l in &mut self.mods {
            l.reset(&mut self.random);
        }
        self.ticks = 0;
        self.cycle_ticks = 0;
        self.reset_event = true;
    }
    pub fn restart(&mut self) {
        for t in &mut self.tracks {
            t.reset(&mut self.random, true);
        }
        for l in &mut self.mods {
            l.reset(&mut self.random);
        }
        self.ticks = 0;
        self.cycle_ticks = 0;
        self.reset_event = true;
    }
    pub fn tick(&mut self) -> u32 {
        for t in &mut self.tracks {
            t.audition = None;
        }
        self.reset_event = self.cycle_ticks == 0;
        if self.total_pulses > 0 && self.cycle_ticks >= self.total_pulses * 24 {
            for t in &mut self.tracks {
                t.reset(&mut self.random, false);
            }
            for l in &mut self.mods {
                l.reset(&mut self.random);
            }
            self.cycle_ticks = 0;
            self.reset_event = true;
        }
        for lane in &mut self.mods {
            lane.tick(&mut self.random);
        }
        let mut events = 0;
        for (i, track) in self.tracks.iter_mut().enumerate() {
            let frame = ModFrame::for_track(&self.mods, &self.aux, i);
            let effective = track.effective(&frame, i, &self.controls);
            let flags = track.tick(effective, &self.scales, &self.user_roots, &mut self.random);
            track.events = flags;
            // Preserve the original ABI for existing two-track consumers.
            // Dynamic consumers read track_events(), avoiding packed-bit limits.
            if i < 2 {
                events |= (flags & 3) << (i * 2);
                if flags & 0x100 != 0 {
                    events |= 1 << (8 + i);
                }
            }
        }
        let frame = ModFrame::for_track(&self.mods, &self.aux, 0);
        let pulse = self.cycle_ticks / 24;
        self.clock = (pulse + self.clock_division - self.clock_offset % self.clock_division)
            % self.clock_division
            == 0
            && self.cycle_ticks % 24 < 12;
        let tempo_control = self
            .controls
            .iter()
            .find(|r| r.destination == d::BPM)
            .map(|r| 100 + ((i64::from(r.value) + 5000) * 399900 / 10000) as i32)
            .unwrap_or(self.bpm_milli);
        self.effective_bpm = (i64::from(tempo_control)
            + i64::from(frame.values[d::BPM]) * 280000 / 5000)
            .clamp(100, 400000) as i32;
        if self.external_clock {
            self.effective_bpm = self.bpm_milli;
        }
        self.swapped = frame.values[d::OUT_SWAP] >= 1500
            || self
                .controls
                .iter()
                .any(|r| r.destination == d::OUT_SWAP && r.value > 0);
        for i in 0..2 {
            self.outputs[i] = self.output(self.output_config[i][0], self.output_config[i][1]);
        }
        self.mx = self.expander(pulse);
        self.ticks += 1;
        self.cycle_ticks = self.cycle_ticks.wrapping_add(1);
        events
    }
    /// Position of the current global cycle tick, before the next tick advances.
    pub fn cycle_position(&self) -> u32 {
        self.cycle_ticks.saturating_sub(1)
    }
    pub fn stage(&self, track: usize) -> Option<u8> {
        self.tracks.get(track).map(|t| t.stage)
    }
    pub fn note(&self, track: usize) -> Option<i32> {
        self.tracks
            .get(track)
            .map(|t| t.audition.map_or(t.note, |a| a.cents / 100))
    }
    pub fn cents(&self, track: usize) -> i32 {
        self.tracks
            .get(track)
            .map_or(-1, |t| t.audition.map_or(t.cents, |a| a.cents))
    }
    pub fn cv(&self, track: usize) -> i32 {
        self.tracks
            .get(track)
            .map_or(0, |t| t.audition.map_or(t.cv, |a| a.cv))
    }
    pub fn velocity(&self, track: usize) -> i32 {
        self.tracks
            .get(track)
            .map_or(0, |t| t.audition.map_or(t.velocity, |a| a.velocity))
    }
    pub fn slide(&self, track: usize) -> bool {
        self.tracks
            .get(track)
            .is_some_and(|t| t.audition.map_or(t.slide_active, |a| a.slide))
    }
    pub fn loopy_active(&self, track: usize) -> bool {
        self.tracks.get(track).is_some_and(|t| t.region.is_some())
    }
    pub fn slide_amount(&self, track: usize) -> i32 {
        self.tracks.get(track).map_or(0, |t| t.slide_amount)
    }
    pub fn slide_type(&self, track: usize) -> i32 {
        self.tracks.get(track).map_or(0, |t| t.slide_type)
    }
    pub fn gate(&self, track: usize) -> bool {
        self.tracks
            .get(track)
            .is_some_and(|t| t.audition.map_or(t.gate_high, |a| a.gate))
    }
    pub fn bpm(&self) -> i32 {
        self.effective_bpm
    }
    pub fn pulse_phase(&self, track: usize) -> i32 {
        self.tracks.get(track).map_or(0, |t| {
            (t.position.elapsed * 1000 / t.position.duration.max(1)) as i32
        })
    }
    pub fn accumulator(&self, track: usize) -> i32 {
        self.tracks.get(track).map_or(0, |t| {
            if t.config[f::ACCUM_SCOPE] == 0 {
                t.accumulator.stage(t.stage).unwrap().offset
            } else {
                t.accumulator.track().offset
            }
        })
    }
    pub fn preview(&self, track: usize, stage: usize, value: u32) -> i32 {
        let Some(t) = self.tracks.get(track) else {
            return -1;
        };
        let Some(&step) = t.steps.get(stage) else {
            return -1;
        };
        let frame = ModFrame::for_track(&self.mods, &self.aux, track);
        let e = t.effective(&frame, track, &self.controls);
        match value {
            0 => (t.pitch(step, &e, &self.scales, &self.user_roots, stage as u8) * 100
                + e.scaled(d::PITCH_OFFSET, 6000))
            .clamp(0, 12700),
            1 => {
                if e.cfg[f::CV_TYPE] == 2 {
                    if step.cv_gate { 5000 } else { 0 }
                } else if e.cfg[f::CV_TYPE] == 1 {
                    step.cv.max(0)
                } else {
                    step.cv
                }
            }
            2 => {
                if e.cfg[f::VELOCITY_SOURCE] == 1 {
                    (self.preview(track, stage, 1).clamp(0, 5000) * 127 / 5000
                        + e.scaled(d::VELOCITY, 127))
                    .clamp(0, 127)
                } else {
                    e.cfg[f::VELOCITY] * 127 / 100
                }
            }
            3 => i32::from(step.slide),
            4 => {
                (if e.cfg[f::SCALE] >= 49 {
                    i32::from(self.user_roots[e.cfg[f::SCALE] as usize - 49])
                } else {
                    e.cfg[f::ROOT]
                }) * 1000
                    / 12
            }
            5 => {
                (if e.cfg[f::SLIDER_INVERT] != 0 {
                    127 - i32::from(step.pitch)
                } else {
                    i32::from(step.pitch)
                }) * 1000
                    * e.cfg[f::SLIDER_OCTAVES]
                    / 127
            }
            _ => -1,
        }
    }
    pub fn tune(&mut self, note: i32, gate: bool) -> bool {
        if note == -1 {
            for t in &mut self.tracks {
                t.audition = None;
            }
            return true;
        }
        if !(0..128).contains(&note) {
            return false;
        }
        for t in &mut self.tracks {
            t.audition = Some(Audition {
                stage: t.stage as usize,
                cents: note * 100,
                cv: t.cv,
                velocity: 95,
                slide: false,
                gate,
            });
        }
        true
    }
    pub fn audition(&mut self, track: usize, stage: usize, on: bool) -> bool {
        if track >= self.tracks.len() || stage >= STAGES {
            return false;
        }
        if !on {
            if let Some(a) = &mut self.tracks[track].audition {
                a.gate = false;
            }
            return true;
        }
        let value = Audition {
            stage,
            cents: self.preview(track, stage, 0),
            cv: self.preview(track, stage, 1),
            velocity: self.preview(track, stage, 2),
            slide: self.preview(track, stage, 3) != 0,
            gate: true,
        };
        self.tracks[track].audition = Some(value);
        true
    }
    pub fn output_value(&self, index: usize) -> i32 {
        self.output_config
            .get(index)
            .map_or(0, |c| self.output(c[0], c[1]))
    }
    pub fn mx_value(&self) -> u32 {
        if self.mx_config[0] == 5 {
            let t = &self.tracks[self.mx_config[1] as usize % self.tracks.len()];
            if let Some(a) = t.audition {
                let start = self.mx_config[2] as usize * 8;
                return if a.gate && (start..start + 8).contains(&a.stage) {
                    1 << (a.stage - start)
                } else {
                    0
                };
            }
        }
        self.mx
    }
    pub fn set_loopy(&mut self, track: usize, start: i32, end: i32, pulses: i32) -> bool {
        let Some(t) = self.tracks.get_mut(track) else {
            return false;
        };
        if start == -1 {
            t.requested = None;
            return true;
        }
        if !(0..16).contains(&start) || !(start..16).contains(&end) || !(0..=64).contains(&pulses) {
            return false;
        }
        t.requested = Some(LoopRegion {
            start: start as u8,
            end: end as u8,
            pulses: pulses as u8,
        });
        true
    }
    pub fn reset_track(&mut self, index: usize, accum_only: bool) -> bool {
        let Some(t) = self.tracks.get_mut(index) else {
            return false;
        };
        if accum_only {
            t.reset_accumulator();
        } else {
            t.reset(&mut self.random, true);
        }
        true
    }
    pub fn set_step(&mut self, track: usize, stage: usize, field: u32, value: i32) -> bool {
        let Some(s) = self
            .tracks
            .get_mut(track)
            .and_then(|t| t.steps.get_mut(stage))
        else {
            return false;
        };
        match field {
            0 if (0..=127).contains(&value) => s.pitch = value as i16,
            1 if (1..=8).contains(&value) => s.pulses = value as u8,
            2 if (0..=3).contains(&value) => {
                s.gate = [
                    GateMode::Rest,
                    GateMode::Single,
                    GateMode::Multiple,
                    GateMode::Hold,
                ][value as usize]
            }
            3 if (1..=8).contains(&value) => s.ratchet = value as u8,
            4 if (0..=100).contains(&value) => s.probability = value as u8,
            5 if (0..=1).contains(&value) => s.slide = value != 0,
            6 if (0..=1).contains(&value) => s.skip = value != 0,
            7 if (-28..=28).contains(&value) => s.accumulate = value as i16,
            8 if (-1..=127).contains(&value) => s.pitch_override = value as i16,
            9 if (-1..=100).contains(&value) => s.gate_override = value as i16,
            10 if (0..=1).contains(&value) => s.probability_target = value as u8,
            11 if (0..=2).contains(&value) => s.accumulate_trigger = value as u8,
            12 if (-5000..=5000).contains(&value) => s.cv = value,
            13 if (0..=2).contains(&value) => s.cv_ramp = value as u8,
            14 if (0..=1).contains(&value) => s.cv_gate = value != 0,
            _ => return false,
        }
        true
    }
    pub fn set_track(&mut self, index: usize, field: u32, value: i32) -> bool {
        let Some(t) = self.tracks.get_mut(index) else {
            return false;
        };
        let Some(&(a, b)) = TRACK_RANGES.get(field as usize) else {
            return false;
        };
        if !(a..=b).contains(&value) {
            return false;
        }
        t.config[field as usize] = value;
        if field == f::MUTE as u32 && value != 0 {
            t.pending_off |= t.gate_high;
            t.gate_high = false;
            t.hold = false;
            t.gate_remaining = 0;
        }
        true
    }
    pub fn set_scale(&mut self, index: usize, mask: i32, root: i32) -> bool {
        if !(49..149).contains(&index) || !(0..=4095).contains(&mask) || !(0..12).contains(&root) {
            return false;
        }
        self.scales[index] = ScaleMask::new(mask as u16);
        self.user_roots[index - 49] = root as i16;
        true
    }
    pub fn set_global(&mut self, field: u32, value: i32) -> bool {
        match field {
            0 if (100..=400000).contains(&value) => self.bpm_milli = value,
            1 if (0..=1024).contains(&value) => self.total_pulses = value as u32,
            2 if (1..=256).contains(&value) => self.clock_division = value as u32,
            3 if (0..256).contains(&value) => self.clock_offset = value as u32,
            4 if (0..=8).contains(&value) => self.mx_config[0] = value,
            5 if value >= 0 && (value as usize) < self.tracks.len().max(MOD_LANES) => {
                self.mx_config[1] = value
            }
            6 if (0..=1).contains(&value) => self.mx_config[2] = value,
            7 if (0..=16).contains(&value) => self.mx_config[3] = value,
            8 if (0..=1).contains(&value) => self.external_clock = value != 0,
            9 if (0..=64).contains(&value) => {
                for t in &mut self.tracks {
                    t.loopy_pulses = value as u8;
                }
            }
            10 if value >= 0 && (value as usize) <= self.tracks.len().max(2) => {
                for (i, t) in self.tracks.iter_mut().enumerate() {
                    t.loopy_targeted =
                        value == 2 || crate::modulation::route_target(i) == value as usize;
                }
            }
            _ => return false,
        }
        true
    }
    pub fn set_output(&mut self, index: usize, kind: i32, source: i32) -> bool {
        if index >= 2
            || !(0..=18).contains(&kind)
            || source < 0
            || source as usize >= self.tracks.len().max(MOD_LANES)
        {
            return false;
        }
        self.output_config[index] = [kind, source];
        true
    }
    fn output(&self, kind: i32, source: i32) -> i32 {
        let raw = source as usize % self.tracks.len();
        let index = if self.swapped && self.tracks.len() > 1 && raw < 2 {
            raw ^ 1
        } else {
            raw
        };
        let t = &self.tracks[index];
        let p = self.cycle_ticks / 24;
        match kind {
            0 => self.controls[0].value,
            1 => (self.controls[0].value + 5000) / 2,
            2 => self.controls[1].value,
            3 => (self.controls[1].value + 5000) / 2,
            4 => self.cv(index),
            5 => {
                if t.reset_pulse {
                    5000
                } else {
                    0
                }
            }
            6 => {
                if t.last_pulse {
                    5000
                } else {
                    0
                }
            }
            7 => {
                if self.mods[source as usize % MOD_LANES].clock {
                    5000
                } else {
                    0
                }
            }
            8 => self.mods[source as usize % MOD_LANES].value(),
            9 => {
                if t.changed {
                    5000
                } else {
                    0
                }
            }
            10 => {
                if self.reset_event {
                    5000
                } else {
                    0
                }
            }
            11 => self.preview(index, t.stage as usize, 4),
            12 => 5000,
            13 => {
                i32::from(t.steps[t.audition.map_or(t.stage as usize, |a| a.stage)].pitch) * 5000
                    / 127
            }
            14 => self.preview(index, t.audition.map_or(t.stage as usize, |a| a.stage), 5),
            15 => self.velocity(index) * 5000 / 127,
            16 => {
                if t.changed && t.cv >= 1500 {
                    5000
                } else {
                    0
                }
            }
            17 => {
                if self.clock {
                    5000
                } else {
                    0
                }
            }
            18 => (self.mods[source as usize % MOD_LANES].stage() as i32 + 1) * 5000 / 16,
            _ => {
                let _ = p;
                0
            }
        }
    }
    fn expander(&mut self, pulse: u32) -> u32 {
        let mode = self.mx_config[0];
        let source = self.mx_config[1] as usize;
        let high = self.cycle_ticks % 24 < 12;
        let mut bits = 0;
        for i in 0..8 {
            let on = match mode {
                0..=2 => {
                    if i == 0 {
                        true
                    } else if i == 1 {
                        self.reset_event
                    } else if mode == 2 {
                        let period = [24, 24, 6, 12, 24, 48, 96, 192][i];
                        self.cycle_ticks % period < period / 2
                    } else {
                        let div = if mode == 0 {
                            [1, 1, 1, 2, 4, 4, 8, 16][i]
                        } else {
                            [1, 1, 1, 3, 4, 5, 8, 16][i]
                        };
                        high && if mode == 0 && i == 5 {
                            (pulse + 2) % div == 0
                        } else {
                            pulse % div == 0
                        }
                    }
                }
                3 => {
                    let div = if i < 4 { 1 } else { 2 };
                    if self.cycle_ticks % 24 == 0 && pulse % div == 0 {
                        self.random.next_u32() % 100 < [100, 75, 50, 25][i % 4]
                    } else {
                        false
                    }
                }
                4 => self.mods[i].clock && self.mods[i].config[9] == 0,
                5 => {
                    self.tracks[source % self.tracks.len()].stage as usize
                        == i + self.mx_config[2] as usize * 8
                        && self.tracks[source % self.tracks.len()].config[f::MUTE] == 0
                }
                6 => {
                    self.mods[source % MOD_LANES].stage() as usize
                        == i + self.mx_config[2] as usize * 8
                        && self.mods[source % MOD_LANES].config[9] == 0
                }
                7 => self.mods[i].value() >= 1500,
                8 => self.mods[i].trigger,
                _ => false,
            };
            if on {
                bits |= 1 << i;
            }
        }
        bits
    }
}
