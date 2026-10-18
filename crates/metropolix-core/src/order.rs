//! The 21 play-order IDs and state transitions used by the original firmware.

use crate::STAGES;
use crate::random::{FirmwareRandom, ShuffleRandom};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum OrderMode {
    Linear,
    PingPong,
    Pendulum,
    OddEven,
    JumpBy2,
    JumpBy3,
    JumpBy4,
    JumpBy5,
    Hopscotch,
    Arp3Minus1,
    Arp4Minus2,
    Arp4Minus1,
    Converge,
    Diverge,
    Growing,
    Shrinking,
    PedalPoint,
    Brownian,
    Shuffle,
    QuasiRandom,
    Random,
}

impl OrderMode {
    pub const ALL: [Self; 21] = [
        Self::Linear,
        Self::PingPong,
        Self::Pendulum,
        Self::OddEven,
        Self::JumpBy2,
        Self::JumpBy3,
        Self::JumpBy4,
        Self::JumpBy5,
        Self::Hopscotch,
        Self::Arp3Minus1,
        Self::Arp4Minus2,
        Self::Arp4Minus1,
        Self::Converge,
        Self::Diverge,
        Self::Growing,
        Self::Shrinking,
        Self::PedalPoint,
        Self::Brownian,
        Self::Shuffle,
        Self::QuasiRandom,
        Self::Random,
    ];

    pub fn from_id(id: u8) -> Option<Self> {
        Self::ALL.get(usize::from(id)).copied()
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[repr(u8)]
pub enum Direction {
    Forward,
    Reverse,
}

impl Direction {
    fn sign(self) -> i32 {
        match self {
            Self::Forward => 1,
            Self::Reverse => -1,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InvalidStageCount;

/// A generator primitive, not a complete track. Stages are zero based.
///
/// Share one `FirmwareRandom` across generators to retain the original random
/// stream ordering. Selecting a different generator in a complete track must
/// preserve that generator's state; this type does not implement track switching.
#[derive(Clone, Debug)]
pub struct PlayOrder {
    mode: OrderMode,
    length: u8,
    direction: Direction,
    position: i32,
    counter: i32,
    phase: bool,
    pedal_position: i32,
    permutation: [u8; STAGES],
    shuffle_random: ShuffleRandom,
}

impl PlayOrder {
    pub fn new(
        mode: OrderMode,
        length: u8,
        direction: Direction,
        random: &mut FirmwareRandom,
    ) -> Result<Self, InvalidStageCount> {
        Self::validate_length(length)?;
        let mut result = Self {
            mode,
            length: 8,
            direction: Direction::Forward,
            position: 0,
            counter: 0,
            phase: false,
            pedal_position: 0,
            permutation: [0; STAGES],
            shuffle_random: ShuffleRandom::new(1),
        };
        if mode == OrderMode::Shuffle {
            // 0x08024da0 seeds and shuffles the eight-stage object before the
            // caller configures its length/direction and explicitly resets it.
            result.shuffle_random = ShuffleRandom::new(random.next_u32());
            result.reshuffle();
        }
        result.length = length;
        result.direction = direction;
        result.reset(random);
        Ok(result)
    }

    fn validate_length(length: u8) -> Result<(), InvalidStageCount> {
        if (1..=STAGES as u8).contains(&length) {
            Ok(())
        } else {
            Err(InvalidStageCount)
        }
    }

    pub fn current(&self) -> u8 {
        self.position as u8
    }

    pub fn mode(&self) -> OrderMode {
        self.mode
    }

    /// Match the original direction setter: changing direction preserves state.
    pub fn set_direction(&mut self, direction: Direction) {
        self.direction = direction;
    }

    /// Length changes reset Shuffle; the other generators keep their state.
    pub fn set_length(&mut self, length: u8) -> Result<(), InvalidStageCount> {
        Self::validate_length(length)?;
        if self.length != length {
            self.length = length;
            if self.mode == OrderMode::Shuffle {
                self.reshuffle();
            }
        }
        Ok(())
    }

    pub fn shuffle_state(&self) -> Option<u32> {
        (self.mode == OrderMode::Shuffle).then_some(self.shuffle_random.state())
    }

    fn endpoint(&self) -> i32 {
        if self.direction == Direction::Forward {
            0
        } else {
            i32::from(self.length) - 1
        }
    }

    fn wrap(&self, value: i32) -> i32 {
        value.rem_euclid(i32::from(self.length))
    }

    pub fn reset(&mut self, random: &mut FirmwareRandom) {
        use OrderMode::*;
        self.position = match self.mode {
            Shuffle => {
                self.reshuffle();
                return;
            }
            Random | QuasiRandom => {
                self.advance(random);
                return;
            }
            Diverge => {
                self.counter = i32::from(self.length) - 1;
                self.phase = self.direction == Direction::Reverse;
                (self.counter + i32::from(self.phase)) / 2
            }
            _ => self.endpoint(),
        };
        match self.mode {
            PingPong | Pendulum => self.phase = false,
            Hopscotch => self.phase = true,
            Converge => {
                self.counter = i32::from(self.length) - 1;
                self.phase = self.direction == Direction::Forward;
            }
            Growing | Shrinking => self.counter = 0,
            PedalPoint => {
                self.phase = true;
                self.pedal_position = self.position;
            }
            Arp3Minus1 => self.counter = 3,
            Arp4Minus1 | Arp4Minus2 => self.counter = 4,
            _ => {}
        }
    }

    pub fn advance(&mut self, random: &mut FirmwareRandom) -> u8 {
        use OrderMode::*;
        let n = i32::from(self.length);
        let sign = self.direction.sign();
        match self.mode {
            Linear | JumpBy2 | JumpBy3 | JumpBy4 | JumpBy5 => {
                let step = match self.mode {
                    JumpBy2 => 2,
                    JumpBy3 => 3,
                    JumpBy4 => 4,
                    JumpBy5 => 5,
                    _ => 1,
                };
                self.position = self.wrap(self.position + sign * step);
            }
            PingPong | Pendulum => {
                let far = if sign > 0 { n - 1 } else { 0 };
                let near = if sign > 0 { 0 } else { n - 1 };
                let at_turn = if !self.phase && self.position == far {
                    self.phase = true;
                    true
                } else if self.phase && self.position == near {
                    self.phase = false;
                    true
                } else {
                    false
                };
                if self.mode == Pendulum || !at_turn {
                    self.position =
                        self.wrap(self.position + sign * if self.phase { -1 } else { 1 });
                }
            }
            OddEven => {
                self.position = self.wrap(self.position + sign * 2);
                if n % 2 == 0 {
                    if sign > 0 {
                        if self.position == 0 {
                            self.position = 1;
                        } else if self.position == 1 {
                            self.position = 0;
                        }
                    } else if self.position == n - 1 {
                        self.position -= 1;
                    } else if self.position == n - 2 {
                        self.position += 1;
                    }
                }
            }
            Hopscotch => {
                let step = if self.phase { 2 } else { -1 };
                self.phase = !self.phase;
                self.position = self.wrap(self.position + sign * step);
            }
            Arp3Minus1 | Arp4Minus2 | Arp4Minus1 => {
                self.counter -= 1;
                let step = if self.counter > 0 {
                    1
                } else {
                    self.counter = if self.mode == Arp3Minus1 { 3 } else { 4 };
                    if self.mode == Arp4Minus2 { -2 } else { -1 }
                };
                self.position = self.wrap(self.position + sign * step);
            }
            Converge | Diverge => {
                let step = if self.phase {
                    self.counter
                } else {
                    -self.counter
                };
                self.phase = !self.phase;
                self.counter -= 1;
                if self.counter < 0 {
                    self.reset(random);
                }
                self.position = self.wrap(self.position + step);
            }
            Growing | Shrinking => {
                let k = self.counter.clamp(0, n - 1);
                let (lower, upper) = match (self.mode, self.direction) {
                    (Growing, Direction::Forward) => (0, k),
                    (Growing, Direction::Reverse) => (n - 1 - k, n - 1),
                    (Shrinking, Direction::Forward) => (0, n - 1 - k),
                    _ => (k, n - 1),
                };
                let boundary = if sign > 0 { upper } else { lower };
                if self.position == boundary {
                    self.counter = (self.counter + 1) % n;
                }
                self.position =
                    lower + (self.position + sign - lower).rem_euclid(upper - lower + 1);
            }
            PedalPoint => {
                self.phase = !self.phase;
                if self.phase {
                    self.position = self.endpoint();
                } else {
                    let (lower, upper) = if sign > 0 {
                        (i32::from(n > 1), n - 1)
                    } else {
                        (0, (n - 2).max(0))
                    };
                    self.pedal_position =
                        lower + (self.pedal_position + sign - lower).rem_euclid(upper - lower + 1);
                    self.position = self.pedal_position;
                }
            }
            Brownian => {
                let outcome = random.next_u32() & 3;
                if outcome != 0 {
                    let step = if outcome == 1 { -sign } else { sign };
                    self.position = self.wrap(self.position + step);
                }
            }
            Random | QuasiRandom => {
                self.position = (random.next_u32() % u32::from(self.length)) as i32;
                if self.mode == QuasiRandom {
                    if n > 2 && self.position == self.counter {
                        self.position = (self.position + 1) % n;
                    }
                    self.counter = self.position;
                }
            }
            Shuffle => {
                self.counter = self.wrap(self.counter + sign);
                self.position = i32::from(self.permutation[self.counter as usize]);
            }
        }
        self.current()
    }

    fn reshuffle(&mut self) {
        self.permutation = core::array::from_fn(|index| index as u8);
        self.counter = 0;
        // The actual call at 0x08024d68 passes length-1 as the exclusive end.
        // Preserve that observed behavior: the last stage remains fixed.
        let end = usize::from(self.length) - 1;
        if end != 0 {
            let mut cursor = 1;
            if end % 2 == 0 {
                let index = self.shuffle_random.inclusive(1);
                self.permutation.swap(1, index);
                cursor = 2;
            }
            while cursor != end {
                let second_range = cursor + 2;
                let sample = self
                    .shuffle_random
                    .inclusive(((cursor + 1) * second_range - 1) as u32);
                self.permutation.swap(cursor, sample / second_range);
                self.permutation.swap(cursor + 1, sample % second_range);
                cursor += 2;
            }
        }
        self.position = i32::from(self.permutation[0]);
    }
}
