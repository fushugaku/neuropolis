//! Accumulator arithmetic and stage/track state from 0x08031098 / 0x0803069e.
//!
//! The caller decides when an accumulator trigger occurs. Gate/stage/pulse
//! trigger routing is part of the track engine and is not implemented here.

use crate::STAGES;
use crate::random::FirmwareRandom;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum AccumulatorMode {
    Wrap,
    Pendulum,
    Brownian,
    Clamp,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Polarity {
    Unipolar,
    Bipolar,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InvalidAccumulatorRange;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InvalidStage;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct AccumulatorConfig {
    pub mode: AccumulatorMode,
    pub polarity: Polarity,
    pub reverse: bool,
    pub invert: bool,
    pub invert_polarity: bool,
    lower: i16,
    upper: i16,
}

impl AccumulatorConfig {
    pub fn new(
        mode: AccumulatorMode,
        polarity: Polarity,
        lower: i16,
        upper: i16,
    ) -> Result<Self, InvalidAccumulatorRange> {
        if lower > 0 || upper < 0 {
            return Err(InvalidAccumulatorRange);
        }
        Ok(Self {
            mode,
            polarity,
            reverse: false,
            invert: false,
            invert_polarity: false,
            lower,
            upper,
        })
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct AccumulatorValue {
    pub offset: i32,
    pub reflected: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Accumulator {
    track: AccumulatorValue,
    stages: [AccumulatorValue; STAGES],
}

impl Accumulator {
    pub fn track(&self) -> AccumulatorValue {
        self.track
    }

    pub fn stage(&self, stage: u8) -> Option<AccumulatorValue> {
        self.stages.get(usize::from(stage)).copied()
    }

    pub fn reset(&mut self) {
        *self = Self::default();
    }

    /// Return whether the trigger was enabled. Brownian's stationary outcome
    /// still returns true, exactly as the original routine does.
    pub fn trigger(
        &mut self,
        stage: u8,
        increment: i16,
        config: AccumulatorConfig,
        random: &mut FirmwareRandom,
    ) -> Result<bool, InvalidStage> {
        let stage = self
            .stages
            .get_mut(usize::from(stage))
            .ok_or(InvalidStage)?;
        if increment == 0 || (config.lower == 0 && config.upper == 0) {
            return Ok(false);
        }
        let mut step = i32::from(increment);
        if config.invert {
            step = -step;
        }
        // Range polarity depends on the sign before applying reverse.
        let originally_negative = step < 0;
        if config.reverse {
            step = -step;
        }
        let bipolar = (config.polarity == Polarity::Bipolar) ^ config.invert_polarity;
        let lower = if !bipolar && !originally_negative {
            0
        } else {
            i32::from(config.lower)
        };
        let upper = if !bipolar && originally_negative {
            0
        } else {
            i32::from(config.upper)
        };
        let wrap = |value: i32| lower + (value - lower).rem_euclid(upper - lower + 1);

        match config.mode {
            AccumulatorMode::Wrap => {
                stage.offset = wrap(stage.offset + step);
                self.track.offset = wrap(self.track.offset + step);
            }
            AccumulatorMode::Pendulum => {
                let direction = step.signum();
                let far = if direction > 0 { upper } else { lower };
                let near = if direction > 0 { lower } else { upper };
                for _ in 0..step.abs() {
                    for value in [&mut *stage, &mut self.track] {
                        if !value.reflected && value.offset == far {
                            value.reflected = true;
                        } else if value.reflected && value.offset == near {
                            value.reflected = false;
                        }
                        value.offset =
                            wrap(value.offset + direction * if value.reflected { -1 } else { 1 });
                    }
                }
            }
            AccumulatorMode::Brownian => {
                let first = random.next_u32() as f32 * (1.0_f32 / 4_294_967_296.0_f32);
                if first >= 0.2_f32 {
                    let second = random.next_u32() as f32 * (1.0_f32 / 4_294_967_296.0_f32);
                    let magnitude = (second * step.abs() as f32 + 1.0_f32) as i32;
                    let delta = magnitude * if first < 0.5_f32 { -1 } else { 1 } * step.signum();
                    stage.offset = wrap(stage.offset + delta);
                    self.track.offset = wrap(self.track.offset + delta);
                }
            }
            AccumulatorMode::Clamp => {
                stage.offset = (stage.offset + step).clamp(lower, upper);
                self.track.offset = (self.track.offset + step).clamp(lower, upper);
            }
        }
        Ok(true)
    }
}
