//! Integer-tick stage/pulse timeline for the extended computer instrument.
use crate::{
    STAGES,
    order::{Direction, OrderMode, PlayOrder},
    random::FirmwareRandom,
    sequencer::{Step, clock_division_ticks, field as f},
};

#[derive(Clone, Copy, Default)]
pub(crate) struct Position {
    pub stage: u8,
    pub pulse: u8,
    pub pulses: u8,
    pub elapsed: u32,
    pub duration: u32,
    pub stage_elapsed: u32,
    pub stage_duration: u32,
    pub pulse_serial: u32,
    pub stage_start: bool,
    pub pulse_start: bool,
    pub reset: bool,
    pub valid: bool,
}
pub(crate) struct Timeline {
    orders: [PlayOrder; 21],
    stage: u8,
    pulse: u8,
    elapsed: u32,
    serial: u32,
    cycle_pulses: u32,
    stage_elapsed: u32,
    entered: bool,
    advance: bool,
    pending_reset: bool,
    last_mode: usize,
}
impl Timeline {
    pub fn new(random: &mut FirmwareRandom) -> Self {
        Self {
            orders: core::array::from_fn(|i| {
                PlayOrder::new(OrderMode::ALL[i], 16, Direction::Forward, random).unwrap()
            }),
            stage: 0,
            pulse: 0,
            elapsed: 0,
            serial: 0,
            cycle_pulses: 0,
            stage_elapsed: 0,
            entered: false,
            advance: false,
            pending_reset: true,
            last_mode: 0,
        }
    }
    pub fn reset(&mut self, cfg: &[i32; f::COUNT], random: &mut FirmwareRandom) {
        for o in &mut self.orders {
            o.set_length(cfg[f::LENGTH] as u8).unwrap();
            o.set_direction(direction(cfg[f::REVERSE]));
            o.reset(random);
        }
        self.pulse = 0;
        self.elapsed = 0;
        self.serial = 0;
        self.cycle_pulses = 0;
        self.stage_elapsed = 0;
        self.entered = false;
        self.advance = false;
        self.pending_reset = true;
    }
    pub fn prepare(
        &mut self,
        cfg: &[i32; f::COUNT],
        steps: &[Step; STAGES],
        skip_invert: bool,
        ignore_skip: bool,
        random: &mut FirmwareRandom,
    ) -> Position {
        let mode = cfg[f::ORDER] as usize;
        let pulse_limit = cfg[f::PULSES_LENGTH] as u32;
        let mut reset = self.pending_reset;
        self.pending_reset = false;
        if self.elapsed == 0 && pulse_limit > 0 && self.cycle_pulses >= pulse_limit {
            self.reset(cfg, random);
            self.pending_reset = false;
            reset = true;
        }
        let order = &mut self.orders[mode];
        order.set_length(cfg[f::LENGTH] as u8).unwrap();
        order.set_direction(direction(cfg[f::REVERSE]));
        let mut stage_start = !self.entered;
        if self.elapsed == 0 && mode != self.last_mode {
            stage_start = true;
            self.pulse = 0;
            self.stage_elapsed = 0;
        }
        self.last_mode = mode;
        let mut valid = true;
        if stage_start {
            if self.advance {
                order.advance(random);
            }
            valid = false;
            for _ in 0..cfg[f::LENGTH] {
                self.stage =
                    ((i32::from(order.current()) + cfg[f::OFFSET]).rem_euclid(STAGES as i32)) as u8;
                if ignore_skip || !(steps[self.stage as usize].skip ^ skip_invert) {
                    valid = true;
                    break;
                }
                order.advance(random);
            }
            self.entered = true;
            self.advance = false;
        } else if !ignore_skip {
            valid = !(steps[self.stage as usize].skip ^ skip_invert);
        }
        let pulses = pulses(cfg, steps[self.stage as usize]);
        let duration = pulse_duration(cfg, self.serial);
        let first_serial = self.serial - u32::from(self.pulse);
        let stage_duration = (0..pulses)
            .map(|i| pulse_duration(cfg, first_serial + u32::from(i)))
            .sum();
        Position {
            stage: self.stage,
            pulse: self.pulse,
            pulses,
            elapsed: self.elapsed,
            duration,
            stage_elapsed: self.stage_elapsed,
            stage_duration,
            pulse_serial: self.serial,
            stage_start,
            pulse_start: self.elapsed == 0,
            reset,
            valid,
        }
    }
    pub fn finish(&mut self, position: Position) {
        self.elapsed += 1;
        self.stage_elapsed += 1;
        if self.elapsed >= position.duration {
            self.elapsed = 0;
            self.serial = self.serial.wrapping_add(1);
            self.cycle_pulses += 1;
            self.pulse += 1;
            if self.pulse >= position.pulses {
                self.pulse = 0;
                self.stage_elapsed = 0;
                self.entered = false;
                self.advance = true;
            }
        }
    }
    pub fn at_pulse(&self) -> bool {
        self.elapsed == 0
    }
}
pub(crate) fn pulse_duration(cfg: &[i32; f::COUNT], serial: u32) -> u32 {
    let base = clock_division_ticks(cfg[f::DIVISION]);
    let long = 2 * base * cfg[f::SWING] as u32 / 100;
    if serial % 2 == 0 {
        long
    } else {
        2 * base - long
    }
}
pub(crate) fn pulses(cfg: &[i32; f::COUNT], step: Step) -> u8 {
    if cfg[f::PULSE_OVERRIDE] > 0 {
        cfg[f::PULSE_OVERRIDE] as u8
    } else {
        step.pulses
    }
}
fn direction(reverse: i32) -> Direction {
    if reverse == 0 {
        Direction::Forward
    } else {
        Direction::Reverse
    }
}
