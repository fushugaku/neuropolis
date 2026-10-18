#![no_std]
#![forbid(unsafe_code)]

//! Portable musical primitives recovered from the official 1.6.5.0 image.
//!
//! Musical primitives have no peripheral access or OS dependencies. The host
//! sequencer uses alloc-backed tracks and integer ticks. Equivalence fixtures execute the original ARM
//! primitives; see `analysis/RUST_PORT.md` for the scope of those comparisons.

extern crate alloc;

pub mod accumulator;
pub mod modulation;
pub mod order;
pub mod random;
pub mod scale;
pub mod sequencer;
mod timeline;

/// Extended capacity of the computer emulator. Stock firmware has eight stages.
pub const STAGES: usize = 16;
