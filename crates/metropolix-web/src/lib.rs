//! Minimal synchronous WASM ABI. No generated JavaScript or external crates.
use metropolix_core::sequencer::Sequencer;
use std::cell::RefCell;

thread_local! { static ENGINE: RefCell<Sequencer> = RefCell::new(Sequencer::default()); }

#[unsafe(no_mangle)]
pub extern "C" fn engine_reset() {
    ENGINE.with(|e| e.borrow_mut().reset());
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_tick() -> u32 {
    ENGINE.with(|e| e.borrow_mut().tick())
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_set_step(track: u32, stage: u32, field: u32, value: i32) -> u32 {
    ENGINE.with(|e| {
        u32::from(
            e.borrow_mut()
                .set_step(track as usize, stage as usize, field, value),
        )
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_set_track(track: u32, field: u32, value: i32) -> u32 {
    ENGINE.with(|e| u32::from(e.borrow_mut().set_track(track as usize, field, value)))
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_stage(track: u32) -> i32 {
    ENGINE.with(|e| e.borrow().stage(track as usize).map_or(-1, i32::from))
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_note(track: u32) -> i32 {
    ENGINE.with(|e| e.borrow().note(track as usize).unwrap_or(-1))
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_slide(track: u32) -> u32 {
    ENGINE.with(|e| u32::from(e.borrow().slide(track as usize)))
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_ticks() -> u32 {
    ENGINE.with(|e| e.borrow().ticks as u32)
}

/// Extended readouts: cents, CV millivolts, velocity, gate, accumulator,
/// slide amount/type, pulse phase, configuration value (100 + field ID).
#[unsafe(no_mangle)]
pub extern "C" fn engine_value(track: u32, value: u32) -> i32 {
    ENGINE.with(|cell| {
        let e = cell.borrow();
        let t = track as usize;
        match value {
            0 => e.cents(t),
            1 => e.cv(t),
            2 => e.velocity(t),
            3 => i32::from(e.gate(t)),
            4 => e.accumulator(t),
            5 => e.slide_amount(t),
            6 => e.slide_type(t),
            7 => e.pulse_phase(t),
            8 => i32::from(e.loopy_active(t)),
            100.. => e
                .tracks
                .get(t)
                .and_then(|t| t.config.get((value - 100) as usize))
                .copied()
                .unwrap_or(-1),
            _ => -1,
        }
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_set_mod(lane: u32, field: u32, value: i32) -> u32 {
    ENGINE.with(|e| {
        u32::from(
            e.borrow_mut()
                .mods
                .get_mut(lane as usize)
                .is_some_and(|l| l.set(field, value)),
        )
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_set_mod_step(lane: u32, stage: u32, field: u32, value: i32) -> u32 {
    ENGINE.with(|e| {
        u32::from(
            e.borrow_mut()
                .mods
                .get_mut(lane as usize)
                .is_some_and(|l| l.set_step(stage as usize, field, value)),
        )
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_mod_value(lane: u32, field: u32) -> i32 {
    ENGINE.with(|e| {
        e.borrow()
            .mods
            .get(lane as usize)
            .map_or(-1, |l| match field {
                0 => l.value(),
                1 => i32::from(l.stage()),
                2 => i32::from(l.clock),
                3 => i32::from(l.trigger),
                _ => -1,
            })
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_set_route(kind: u32, index: u32, field: u32, value: i32) -> u32 {
    ENGINE.with(|e| {
        let mut e = e.borrow_mut();
        let r = if kind == 0 {
            e.controls.get_mut(index as usize)
        } else if kind == 1 {
            e.aux.get_mut(index as usize)
        } else {
            None
        };
        u32::from(r.is_some_and(|r| r.set(field, value)))
    })
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_set_scale(index: u32, mask: i32, root: i32) -> u32 {
    ENGINE.with(|e| u32::from(e.borrow_mut().set_scale(index as usize, mask, root)))
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_set_global(field: u32, value: i32) -> u32 {
    ENGINE.with(|e| u32::from(e.borrow_mut().set_global(field, value)))
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_set_output(index: u32, kind: i32, source: i32) -> u32 {
    ENGINE.with(|e| u32::from(e.borrow_mut().set_output(index as usize, kind, source)))
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_set_loopy(track: u32, start: i32, end: i32, pulses: i32) -> u32 {
    ENGINE.with(|e| u32::from(e.borrow_mut().set_loopy(track as usize, start, end, pulses)))
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_reset_track(track: u32, accum_only: u32) -> u32 {
    ENGINE.with(|e| u32::from(e.borrow_mut().reset_track(track as usize, accum_only != 0)))
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_global_value(field: u32) -> i32 {
    ENGINE.with(|e| {
        let e = e.borrow();
        match field {
            0 => e.bpm(),
            1 => e.output_value(0),
            2 => e.output_value(1),
            3 => e.mx_value() as i32,
            4 => i32::from(e.clock),
            5 => i32::from(e.swapped),
            6 => i32::from(e.reset_event),
            7 => e.cycle_position() as i32,
            _ => -1,
        }
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_preview(track: u32, stage: u32, value: u32) -> i32 {
    ENGINE.with(|e| e.borrow().preview(track as usize, stage as usize, value))
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_restart() {
    ENGINE.with(|e| e.borrow_mut().restart())
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_audition(track: u32, stage: u32, on: u32) -> u32 {
    ENGINE.with(|e| {
        u32::from(
            e.borrow_mut()
                .audition(track as usize, stage as usize, on != 0),
        )
    })
}

#[unsafe(no_mangle)]
pub extern "C" fn engine_tune(note: i32, gate: u32) -> u32 {
    ENGINE.with(|e| u32::from(e.borrow_mut().tune(note, gate != 0)))
}

/// Dynamic track count. Existing two-track exports remain compatible.
#[unsafe(no_mangle)]
pub extern "C" fn engine_resize_tracks(count: u32) -> u32 {
    ENGINE.with(|e| u32::from(e.borrow_mut().resize_tracks(count as usize)))
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_remove_track(index: u32) -> u32 {
    ENGINE.with(|e| u32::from(e.borrow_mut().remove_track(index as usize)))
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_track_count() -> u32 {
    ENGINE.with(|e| e.borrow().tracks.len() as u32)
}
#[unsafe(no_mangle)]
pub extern "C" fn engine_track_events(index: u32) -> u32 {
    ENGINE.with(|e| e.borrow().track_events(index as usize))
}
