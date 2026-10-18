//! Scale table and integer quantizer, recovered from ARM function 0x08025012.

mod factory;
pub use factory::FACTORY_SCALES;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct FactoryScale {
    pub name: &'static str,
    pub mask: ScaleMask,
}

/// Bit zero is the root, bit eleven the major seventh. High bits are ignored.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ScaleMask(u16);

impl ScaleMask {
    pub const CHROMATIC: Self = Self(0x0fff);

    pub const fn new(bits: u16) -> Self {
        Self(bits & 0x0fff)
    }

    pub const fn bits(self) -> u16 {
        self.0
    }

    pub fn rotated(self, semitones: i32) -> Self {
        let shift = semitones.rem_euclid(12) as u32;
        Self::new((self.0 << shift) | (self.0 >> (12 - shift)))
    }

    fn contains(self, note: i32) -> bool {
        self.0 & (1 << note.rem_euclid(12)) != 0
    }

    fn ceiling(self, note: i32) -> i32 {
        (0..12)
            .map(|distance| note + distance)
            .find(|&n| self.contains(n))
            .unwrap()
    }

    fn floor(self, note: i32) -> i32 {
        (0..12)
            .map(|distance| note - distance)
            .find(|&n| self.contains(n))
            .unwrap()
    }

    fn nearest(self, note: i32) -> i32 {
        for distance in 0..=6 {
            if self.contains(note + distance) {
                return note + distance;
            }
            if self.contains(note - distance) {
                return note - distance;
            }
        }
        unreachable!("a nonempty twelve-note scale has a note within six semitones")
    }

    fn transpose_degrees(self, mut note: i32, degrees: i32) -> i32 {
        let count = self.0.count_ones() as i32;
        let magnitude = degrees.abs();
        let direction = degrees.signum();
        note += direction * (magnitude / count) * 12;
        for _ in 0..magnitude % count {
            note = if direction > 0 {
                self.ceiling(note + 1)
            } else {
                self.floor(note - 1)
            };
        }
        note
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InvalidPitchRange;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Quantizer {
    pub scale: ScaleMask,
    root: u8,
    minimum: i16,
    maximum: i16,
}

impl Quantizer {
    pub fn new(
        scale: ScaleMask,
        root: i16,
        minimum: i16,
        maximum: i16,
    ) -> Result<Self, InvalidPitchRange> {
        if minimum > maximum {
            return Err(InvalidPitchRange);
        }
        Ok(Self {
            scale,
            root: root.rem_euclid(12) as u8,
            minimum,
            maximum,
        })
    }

    /// Quantize a semitone pitch, then apply scale degrees and post-transposition.
    ///
    /// Ties select the higher pitch. The firmware has two different range rules:
    /// empty/chromatic scales clamp after all offsets; other scales apply the
    /// lower bound before negative degree offsets and the upper bound before
    /// post-transposition. Consequently, the result can lie outside the range.
    /// i16 inputs keep all intermediate arithmetic within i32.
    pub fn quantize(self, pitch: i16, root_offset: i16, degrees: i16, post: i16) -> i32 {
        let mask = self
            .scale
            .rotated(i32::from(self.root) + i32::from(root_offset));
        let minimum = i32::from(self.minimum);
        let maximum = i32::from(self.maximum);
        let degrees = i32::from(degrees);
        if mask.0 == 0 || mask == ScaleMask::CHROMATIC {
            return (i32::from(pitch) + degrees + i32::from(post)).clamp(minimum, maximum);
        }
        let mut note = mask.nearest(i32::from(pitch));
        if degrees > 0 {
            note = mask.transpose_degrees(note, degrees);
        }
        if note < minimum {
            note = mask.ceiling(minimum);
        }
        if degrees < 0 {
            note = mask.transpose_degrees(note, degrees);
        }
        if note > maximum {
            note = mask.floor(maximum);
        }
        note + i32::from(post)
    }
}
