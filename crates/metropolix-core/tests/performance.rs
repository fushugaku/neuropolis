use metropolix_core::{
    modulation::destination as d,
    sequencer::{Sequencer, field as f},
};
fn run(e: &mut Sequencer, n: usize) {
    for _ in 0..n {
        e.tick();
    }
}
#[test]
fn swing_delays_alternate_pulses_without_changing_pair_duration() {
    let mut e = Sequencer::default();
    e.set_track(0, f::SWING as u32, 60);
    run(&mut e, 28);
    assert_eq!(e.stage(0), Some(0));
    e.tick();
    assert_eq!(e.stage(0), Some(1));
    run(&mut e, 19);
    e.tick();
    assert_eq!(e.stage(0), Some(2));
}
#[test]
fn hold_ties_pitch_to_the_next_stage_without_retriggering() {
    let mut e = Sequencer::default();
    e.set_step(0, 0, 2, 3);
    e.set_step(0, 1, 0, 72);
    assert_ne!(e.tick() & 1, 0);
    run(&mut e, 23);
    let boundary = e.tick();
    assert_eq!(boundary & 3, 0);
    assert_ne!(boundary & (1 << 8), 0);
    assert_eq!(e.note(0), Some(72));
    assert!(e.gate(0));
    run(&mut e, 14);
    assert!(!e.gate(0));
}
#[test]
fn acid_holds_the_marked_stage_and_slides_into_the_following_one() {
    let mut e = Sequencer::default();
    e.set_track(0, f::SLIDE_TYPE as u32, 2);
    e.set_step(0, 0, 5, 1);
    e.tick();
    assert!(!e.slide(0));
    run(&mut e, 23);
    assert!(e.gate(0));
    let boundary = e.tick();
    assert!(e.slide(0));
    assert_eq!(boundary & 3, 0);
    run(&mut e, 24);
    assert!(!e.slide(0));
}
#[test]
fn pulse_division_and_gate_overrides_change_emitted_gates() {
    let mut e = Sequencer::default();
    e.set_step(0, 0, 1, 4);
    e.set_track(0, f::PULSE_DIV as u32, 2);
    let ons = (0..96).filter(|_| e.tick() & 1 != 0).count();
    assert_eq!(ons, 2);
    e.set_step(0, 0, 9, 0);
    e.reset();
    for _ in 0..96 {
        assert_eq!(e.tick() & 1, 0);
    }
}
#[test]
fn accumulator_trigger_respects_gate_probability_and_scope() {
    let mut e = Sequencer::default();
    e.set_step(0, 0, 7, 1);
    e.set_track(0, f::ACCUM_SCOPE as u32, 0);
    e.tick();
    assert_eq!(e.note(0), Some(60));
    assert_eq!(e.accumulator(0), 1);
    run(&mut e, 24);
    assert_eq!(e.note(0), Some(60));
    assert_eq!(e.accumulator(0), 0);
    e.set_track(0, f::ACCUM_SCOPE as u32, 1);
    e.reset();
    run(&mut e, 25);
    assert_eq!(e.note(0), Some(62));
    e.set_step(0, 0, 4, 0);
    e.reset();
    e.tick();
    assert_eq!(e.accumulator(0), 0);
}
#[test]
fn mod_lane_routes_real_pitch_changes_and_keeps_its_own_clock() {
    let mut e = Sequencer::default();
    e.mods[0].set(7, d::PITCH_PRE as i32);
    e.mods[0].set(8, 0);
    e.mods[0].set(3, 2);
    e.mods[0].set_step(0, 0, 1000);
    e.tick();
    assert_eq!(e.note(0), Some(72));
    assert_eq!(e.note(1), Some(60));
    run(&mut e, 24);
    assert_eq!(e.mods[0].stage(), 0);
    run(&mut e, 24);
    assert_eq!(e.mods[0].stage(), 1);
}
#[test]
fn cv_ramp_and_user_scale_root_are_part_of_engine_output() {
    let mut e = Sequencer::default();
    e.set_step(0, 0, 12, 4800);
    e.set_step(0, 0, 13, 2);
    e.tick();
    assert_eq!(e.cv(0), 200);
    run(&mut e, 23);
    assert_eq!(e.cv(0), 4800);
    assert!(e.set_scale(148, 1, 3));
    assert!(!e.set_scale(149, 1, 0));
    e.set_track(0, f::SCALE as u32, 148);
    e.reset();
    e.tick();
    assert_eq!(e.note(0), Some(63));
}
#[test]
fn loopy_ignores_skip_and_releases_to_the_continuing_original_timeline() {
    let mut e = Sequencer::default();
    e.set_step(0, 5, 6, 1);
    run(&mut e, 24);
    e.set_loopy(0, 5, 6, 0);
    e.tick();
    assert_eq!(e.stage(0), Some(5));
    run(&mut e, 47);
    assert_eq!(e.stage(0), Some(6));
    e.set_loopy(0, -1, 0, 0);
    e.tick();
    assert_eq!(e.stage(0), Some(3));
}
#[test]
fn aux_inversion_and_ctrl_direct_mapping_have_different_semantics() {
    let mut e = Sequencer::default();
    e.aux[0].set(0, d::MUTE as i32);
    e.aux[0].set(1, 0);
    e.aux[0].set(2, 0);
    e.aux[0].set(3, -100);
    let events = e.tick();
    assert_eq!(events & 1, 0);
    assert_ne!(events & 4, 0);
    e.aux[0].set(3, 0);
    e.controls[0].set(0, d::GATE_LENGTH as i32);
    e.controls[0].set(1, 0);
    e.controls[0].set(2, -5000);
    e.reset();
    assert_eq!(e.tick() & 1, 0);
}

#[test]
fn summed_tempo_modulation_and_maximum_ctrl_cannot_overflow() {
    let mut e = Sequencer::default();
    for m in &mut e.mods {
        m.set(7, d::BPM as i32);
        m.set_step(0, 0, 5000);
    }
    e.tick();
    assert_eq!(e.bpm(), 400000);
    e.controls[0].set(0, d::BPM as i32);
    e.controls[0].set(2, 5000);
    e.tick();
    assert_eq!(e.bpm(), 400000);
    e.controls[0].set(2, -5000);
    for m in &mut e.mods {
        m.set_step(0, 0, -5000);
    }
    e.tick();
    assert_eq!(e.bpm(), 100);
}
#[test]
fn audition_holds_cv_and_gate_without_moving_the_playback_position() {
    let mut e = Sequencer::default();
    run(&mut e, 25);
    let stage = e.stage(0);
    let ticks = e.ticks;
    e.set_step(0, 15, 8, 84);
    e.set_step(0, 15, 12, 3500);
    assert!(e.audition(0, 15, true));
    assert_eq!(e.note(0), Some(84));
    assert_eq!(e.cv(0), 3500);
    assert!(e.gate(0));
    assert_eq!(e.stage(0), stage);
    assert_eq!(e.ticks, ticks);
    e.audition(0, 15, false);
    assert!(!e.gate(0));
    assert_eq!(e.cv(0), 3500);
    e.tick();
    assert_eq!(e.stage(0), stage);
    assert_ne!(e.note(0), Some(84));
}
#[test]
fn normalized_faders_preserve_midi_notes_through_migration() {
    let mut e = Sequencer::default();
    e.set_track(0, f::FADER_MODE as u32, 1);
    e.set_track(0, f::BOTTOM_PITCH as u32, 36);
    e.set_track(0, f::SCALE as u32, 49);
    e.set_scale(49, 4095, 0);
    for note in 36..=84 {
        let normalized = ((note - 36) * 127 + 24) / 48;
        e.set_step(0, 0, 0, normalized);
        assert_eq!(e.preview(0, 0, 0), note * 100);
    }
}
#[test]
fn shortening_a_live_mod_clock_never_overshoots_its_voltage_range() {
    let mut e = Sequencer::default();
    e.mods[0].set(3, 64);
    e.mods[0].set_step(0, 0, 5000);
    e.mods[0].set_step(0, 1, 1);
    run(&mut e, 1000);
    e.mods[0].set(3, 1);
    e.tick();
    assert!((-5000..=5000).contains(&e.mods[0].value()));
}

#[test]
fn one_finger_loopy_plays_a_fixed_pulse_phrase_in_both_directions() {
    for (reverse, expected) in [(0, [5, 6, 7, 5]), (1, [5, 4, 3, 5])] {
        let mut e = Sequencer::default();
        e.set_track(0, f::REVERSE as u32, reverse);
        e.set_loopy(0, 5, 5, 3);
        for stage in expected {
            e.tick();
            assert_eq!(e.stage(0), Some(stage));
            run(&mut e, 23);
        }
    }
}
#[test]
fn hands_free_loopy_applies_its_offset_and_pulse_modulation_once() {
    let mut e = Sequencer::default();
    e.set_global(9, 3);
    e.set_global(10, 0);
    e.aux[0].set(0, d::LOOPY as i32);
    e.aux[0].set(2, 5000);
    e.aux[1].set(0, d::LOOPY_OFFSET as i32);
    e.aux[1].set(2, 1000);
    for stage in [3, 4, 5, 3] {
        e.tick();
        assert_eq!(e.stage(0), Some(stage));
        assert!(!e.loopy_active(1));
        run(&mut e, 23);
    }
}
#[test]
fn global_mod_destinations_work_from_either_track_assignment() {
    let mut e = Sequencer::default();
    e.aux[0].set(0, d::BPM as i32);
    e.aux[0].set(1, 1);
    e.aux[0].set(2, 1000);
    e.tick();
    assert_eq!(e.bpm(), 176000);
    e.aux[0].set(1, 2);
    e.tick();
    assert_eq!(e.bpm(), 176000);
    e.aux[1].set(0, d::OUT_SWAP as i32);
    e.aux[1].set(1, 1);
    e.aux[1].set(2, 5000);
    e.tick();
    assert!(e.swapped);
}
#[test]
fn cv_driven_velocity_can_be_modulated_further() {
    let mut e = Sequencer::default();
    e.set_track(0, f::VELOCITY_SOURCE as u32, 1);
    e.set_step(0, 0, 12, 2500);
    e.aux[0].set(0, d::VELOCITY as i32);
    e.aux[0].set(1, 0);
    e.aux[0].set(2, 1000);
    e.tick();
    assert_eq!(e.velocity(0), 88);
    assert_eq!(e.preview(0, 0, 2), 88);
}
#[test]
fn root_and_slider_outputs_honor_user_roots_and_slider_inversion() {
    let mut e = Sequencer::default();
    e.set_scale(49, 137, 3);
    e.set_track(0, f::SCALE as u32, 49);
    e.set_output(0, 11, 0);
    assert_eq!(e.output_value(0), 250);
    e.set_step(0, 0, 0, 0);
    e.set_track(0, f::SLIDER_INVERT as u32, 1);
    e.set_output(0, 14, 0);
    assert_eq!(e.output_value(0), 4000);
}

#[test]
fn tuner_outputs_static_notes_and_gates_without_advancing_the_pattern() {
    let mut e = Sequencer::default();
    run(&mut e, 25);
    let position = e.stage(0);
    let ticks = e.ticks;
    assert!(e.tune(48, true));
    assert_eq!(e.note(0), Some(48));
    assert_eq!(e.note(1), Some(48));
    assert!(e.gate(1));
    assert_eq!(e.stage(0), position);
    assert_eq!(e.ticks, ticks);
    e.tune(48, false);
    assert!(!e.gate(0));
    e.tune(-1, false);
    assert_eq!(e.stage(0), position);
    assert_ne!(e.note(0), Some(48));
    assert!(!e.tune(128, true));
}
