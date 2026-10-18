//! Host modulation lanes and routings, following the 1.6.5 manual.
//! These extend the recovered play-order primitives; they are not ARM-equivalent
//! ports of the original modulation dispatcher.
use crate::{
    STAGES,
    order::{Direction, OrderMode, PlayOrder},
    random::FirmwareRandom,
};

pub const DESTINATIONS: usize = 40;
pub const MOD_LANES: usize = 8;
pub mod destination {
    pub const NONE: usize = 0;
    pub const ACCUMULATE: usize = 1;
    pub const ACCUM_REVERSE: usize = 2;
    pub const ACCUM_INVERT: usize = 3;
    pub const ACCUM_SCOPE: usize = 4;
    pub const ACCUM_POLARITY: usize = 5;
    pub const ACCUM_RESET: usize = 6;
    pub const BPM: usize = 7;
    pub const CLOCK_DIV: usize = 8;
    pub const DIRECTION: usize = 9;
    pub const GATE_LENGTH: usize = 10;
    pub const GATE_SCALE: usize = 11;
    pub const LOOPY: usize = 12;
    pub const LOOPY_PULSES: usize = 13;
    pub const LOOPY_OFFSET: usize = 14;
    pub const MUTE: usize = 15;
    pub const OCTAVE: usize = 16;
    pub const PITCH_OFFSET: usize = 17;
    pub const PITCH_POST: usize = 18;
    pub const PITCH_PRE: usize = 19;
    pub const ORDER: usize = 20;
    pub const PROBABILITY: usize = 21;
    pub const PULSE_COUNT: usize = 22;
    pub const PULSE_DIV: usize = 23;
    pub const PULSES_LENGTH: usize = 24;
    pub const RATCHET: usize = 25;
    pub const RESET: usize = 26;
    pub const ROOT: usize = 27;
    pub const USER_SCALE: usize = 28;
    pub const SKIP_INVERT: usize = 29;
    pub const SLIDE: usize = 30;
    pub const SLIDE_AMOUNT: usize = 31;
    pub const SLIDER_INVERT: usize = 32;
    pub const SLIDER_RANGE: usize = 33;
    pub const STAGES_LENGTH: usize = 34;
    pub const STAGES_OFFSET: usize = 35;
    pub const SWING: usize = 36;
    pub const OUT_SWAP: usize = 37;
    pub const VELOCITY: usize = 38;
    pub const ACCUM_DIR: usize = 39;
}

/// Targets 0/1 are the first two tracks; 2 means all; later tracks use index + 1.
/// Retains compatibility with two-track patches without an index-width limit.
pub fn route_target(track: usize) -> usize {
    if track < 2 { track } else { track + 1 }
}

pub fn is_gate(destination: usize) -> bool {
    matches!(destination, 1..=6 | 9 | 12 | 15 | 26 | 29 | 30 | 32 | 37)
}

#[derive(Clone, Copy, Debug)]
pub struct Route {
    pub destination: usize,
    pub target: usize,
    pub value: i32,
    pub amount: i32,
}
impl Default for Route {
    fn default() -> Self {
        Self {
            destination: 0,
            target: 2,
            value: 0,
            amount: 100,
        }
    }
}
impl Route {
    pub fn targets(self, track: usize) -> bool {
        self.target == 2 || self.target == route_target(track)
    }
    pub fn voltage(self, aux: bool) -> i32 {
        if aux && self.amount < 0 && is_gate(self.destination) {
            if self.value < 1500 { 5000 } else { 0 }
        } else {
            self.value * self.amount / 100
        }
    }
    pub fn set(&mut self, field: u32, value: i32) -> bool {
        match field {
            0 if (0..DESTINATIONS as i32).contains(&value) => self.destination = value as usize,
            1 if value >= 0 => self.target = value as usize,
            2 if (-5000..=5000).contains(&value) => self.value = value,
            3 if (-100..=100).contains(&value) => self.amount = value,
            _ => return false,
        }
        true
    }
}

#[derive(Clone, Copy, Debug, Default)]
pub struct ModStep {
    pub value: i32,
    pub ramp: bool,
    pub gate: bool,
}
pub struct ModLane {
    pub steps: [ModStep; STAGES],
    pub config: [i32; 12],
    orders: [PlayOrder; 21],
    elapsed: u32,
    pulses: u32,
    stage: u8,
    value: i32,
    from: i32,
    entered: bool,
    pub changed: bool,
    pub clock: bool,
    pub trigger: bool,
}
impl ModLane {
    pub fn new(random: &mut FirmwareRandom) -> Self {
        Self {
            steps: [ModStep::default(); STAGES],
            config: [0, 16, 0, 1, 0, 0, 0, 0, 2, 0, 0, -1],
            orders: core::array::from_fn(|i| {
                PlayOrder::new(OrderMode::ALL[i], 16, Direction::Forward, random).unwrap()
            }),
            elapsed: 0,
            pulses: 0,
            stage: 0,
            value: 0,
            from: 0,
            entered: false,
            changed: false,
            clock: false,
            trigger: false,
        }
    }
    pub fn reset(&mut self, random: &mut FirmwareRandom) {
        for o in &mut self.orders {
            o.set_length(self.config[1] as u8).unwrap();
            o.set_direction(if self.config[2] == 0 {
                Direction::Forward
            } else {
                Direction::Reverse
            });
            o.reset(random);
        }
        self.elapsed = 0;
        self.pulses = 0;
        self.entered = false;
        self.stage = ((self.orders[self.config[0] as usize].current() as i32 + self.config[4])
            % STAGES as i32) as u8;
    }
    pub fn set(&mut self, field: u32, value: i32) -> bool {
        const RANGES: [(i32, i32); 12] = [
            (0, 20),
            (1, 16),
            (0, 1),
            (1, 64),
            (0, 15),
            (0, 64),
            (0, 2),
            (0, 39),
            (0, i32::MAX),
            (0, 1),
            (0, 16),
            (-1, 127),
        ];
        let Some(&(a, b)) = RANGES.get(field as usize) else {
            return false;
        };
        if !(a..=b).contains(&value) {
            return false;
        }
        self.config[field as usize] = value;
        true
    }
    pub fn set_step(&mut self, stage: usize, field: u32, value: i32) -> bool {
        let Some(s) = self.steps.get_mut(stage) else {
            return false;
        };
        match field {
            0 if (-5000..=5000).contains(&value) => s.value = value,
            1 if (0..=1).contains(&value) => s.ramp = value != 0,
            2 if (0..=1).contains(&value) => s.gate = value != 0,
            _ => return false,
        }
        true
    }
    pub fn tick(&mut self, random: &mut FirmwareRandom) {
        self.changed = false;
        self.trigger = false;
        let duration = 24 * self.config[3] as u32;
        if self.elapsed >= duration {
            self.elapsed %= duration;
        }
        self.clock = self.elapsed < duration / 2;
        if self.elapsed == 0 {
            let order = &mut self.orders[self.config[0] as usize];
            order.set_length(self.config[1] as u8).unwrap();
            order.set_direction(if self.config[2] == 0 {
                Direction::Forward
            } else {
                Direction::Reverse
            });
            if self.entered {
                order.advance(random);
            }
            if self.config[5] > 0 && self.pulses >= self.config[5] as u32 {
                self.pulses = 0;
                order.reset(random);
            }
            self.from = self.value;
            self.stage = ((i32::from(order.current()) + self.config[4]) % STAGES as i32) as u8;
            self.entered = true;
            self.changed = true;
        }
        let step = self.steps[self.stage as usize];
        let gate = self.config[6] == 2 || is_gate(self.config[7] as usize);
        let target = if gate {
            if step.gate { 5000 } else { 0 }
        } else if self.config[6] == 1 {
            step.value.max(0)
        } else {
            step.value
        };
        let previous = self.value;
        self.value = if self.config[9] != 0 {
            0
        } else if step.ramp && !gate {
            self.from + (target - self.from) * (self.elapsed + 1) as i32 / duration as i32
        } else {
            target
        };
        self.trigger = previous < 1500 && self.value >= 1500;
        self.elapsed += 1;
        if self.elapsed >= duration {
            self.elapsed = 0;
            self.pulses += 1;
        }
    }
    pub fn value(&self) -> i32 {
        self.value
    }
    pub fn stage(&self) -> u8 {
        self.stage
    }
    pub fn route(&self) -> Route {
        Route {
            destination: self.config[7] as usize,
            target: self.config[8] as usize,
            value: self.value,
            amount: 100,
        }
    }
}
