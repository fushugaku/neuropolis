use metropolix_core::sequencer::{Sequencer, field as f};

fn instrument(periods: &[i32]) -> Sequencer {
    let mut seq = Sequencer::default();
    seq.resize_tracks(periods.len());
    seq.total_pulses = 0;
    seq.set_scale(49, 4095, 0);
    for (i, &period) in periods.iter().enumerate() {
        for (field, value) in [
            (f::SCALE, 49),
            (f::ACCUM_SCOPE, 1),
            (f::ACCUM_RESET, 3),
            (f::ACCUM_STAGES, period),
            (f::ACCUM_POSITIVE, 28),
        ] {
            assert!(seq.set_track(i, field as u32, value));
        }
        for stage in &mut seq.tracks[i].steps {
            stage.pitch = 60;
            stage.accumulate = 1;
        }
    }
    seq
}

#[test]
fn each_track_counts_stages_instead_of_pulses_or_ratchets() {
    let mut seq = instrument(&[3, 5]);
    for i in 0..2 {
        seq.set_track(i, f::LENGTH as u32, 4);
        seq.set_track(i, f::DIVISION as u32, i as i32 + 1);
        for (n, stage) in seq.tracks[i].steps.iter_mut().enumerate() {
            stage.pulses = [2, 1, 3, 4][n % 4];
            stage.ratchet = 4;
        }
    }
    let mut notes = [Vec::new(), Vec::new()];
    let mut ticks = [Vec::new(), Vec::new()];
    for tick in 0..2400 {
        seq.tick();
        for i in 0..2 {
            if seq.tracks[i].changed {
                notes[i].push(seq.note(i).unwrap());
                ticks[i].push(tick);
            }
        }
    }
    assert_eq!(&ticks[0][..5], [0, 48, 72, 144, 240]);
    assert_eq!(&ticks[1][..5], [0, 96, 144, 288, 480]);
    for i in 0..2 {
        for (n, &note) in notes[i].iter().enumerate() {
            assert_eq!(note, 60 + n as i32 % [3, 5][i]);
        }
    }
    assert!(!seq.set_track(0, f::ACCUM_STAGES as u32, 0));
    assert!(!seq.set_track(0, f::ACCUM_STAGES as u32, 1025));
}

#[test]
fn period_resets_all_per_stage_accumulators_at_the_next_stage_entry() {
    let mut seq = instrument(&[3]);
    seq.set_track(0, f::LENGTH as u32, 2);
    seq.set_track(0, f::ACCUM_SCOPE as u32, 0);
    let mut notes = Vec::new();
    for _ in 0..24 * 6 {
        seq.tick();
        if seq.tracks[0].changed {
            notes.push(seq.note(0).unwrap());
        }
    }
    assert_eq!(notes, [60, 60, 61, 60, 60, 61]);
}

#[test]
fn global_timeline_resets_and_stage_order_do_not_turn_the_period_into_a_pulse_count() {
    let mut seq = instrument(&[3]);
    seq.total_pulses = 2;
    let mut notes = Vec::new();
    for _ in 0..24 * 7 {
        seq.tick();
        if seq.tracks[0].changed {
            notes.push(seq.note(0).unwrap());
        }
    }
    assert_eq!(notes, [60, 61, 62, 60, 61, 62, 60]);

    seq.total_pulses = 0;
    seq.set_track(0, f::LENGTH as u32, 4);
    seq.set_track(0, f::ORDER as u32, 1);
    seq.set_track(0, f::REVERSE as u32, 1);
    seq.tracks[0].steps[2].skip = true;
    seq.restart();
    let mut notes = Vec::new();
    for _ in 0..24 * 10 {
        seq.tick();
        if seq.tracks[0].changed {
            assert_ne!(seq.stage(0), Some(2));
            notes.push(seq.note(0).unwrap());
        }
    }
    assert_eq!(notes, [60, 61, 62, 60, 61, 62, 60, 61, 62, 60]);
}

#[test]
fn manual_accumulator_reset_restarts_its_stage_count_and_live_adoption_preserves_it() {
    let mut previous = instrument(&[3]);
    for _ in 0..48 {
        previous.tick();
    }
    let mut next = instrument(&[3]);
    next.inherit_playback(&mut previous);
    next.tick();
    assert_eq!(next.note(0), Some(62));
    assert!(next.reset_track(0, true));
    let mut notes = Vec::new();
    for _ in 0..24 * 5 {
        next.tick();
        if next.tracks[0].changed {
            notes.push(next.note(0).unwrap());
        }
    }
    assert_eq!(notes, [60, 61, 62, 60, 61]);
}
