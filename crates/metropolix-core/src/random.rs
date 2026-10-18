//! Random state used by the original play-order generators.

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FirmwareRandom {
    first: u32,
    second: u32,
}

impl FirmwareRandom {
    /// Explicit state makes runs reproducible; zero states are retained verbatim.
    pub const fn new(first: u32, second: u32) -> Self {
        Self { first, second }
    }

    pub const fn state(&self) -> (u32, u32) {
        (self.first, self.second)
    }

    pub fn next_u32(&mut self) -> u32 {
        fn step(state: u32, polynomial: u32) -> u32 {
            (state >> 1) ^ if state & 1 != 0 { polynomial } else { 0 }
        }
        self.first = step(step(self.first, 0xb4bc_d35c), 0xb4bc_d35c);
        self.second = step(self.second, 0x7a5b_c2e3);
        self.first ^ self.second
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct ShuffleRandom(u32);

impl ShuffleRandom {
    pub fn new(seed: u32) -> Self {
        let reduced = seed % 0x7fff_ffff;
        Self(if reduced == 0 { 1 } else { reduced })
    }

    fn next(&mut self) -> u32 {
        self.0 = ((u64::from(self.0) * 48_271) % 0x7fff_ffff) as u32;
        self.0
    }

    pub fn inclusive(&mut self, maximum: u32) -> usize {
        // Exact small-range branch of 0x08024be4, including rejection sampling.
        let bucket = 0x7fff_fffd / (maximum + 1);
        let limit = bucket * (maximum + 1);
        loop {
            let sample = self.next() - 1;
            if sample < limit {
                return (sample / bucket) as usize;
            }
        }
    }

    pub fn state(self) -> u32 {
        self.0
    }
}
