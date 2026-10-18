use metropolix_core::{
    modulation::destination as d,
    sequencer::{Sequencer, field as f},
};

#[test]
fn hundreds_of_tracks_have_independent_events_and_notes() {
    let mut e = Sequencer::default();
    assert!(e.resize_tracks(300));
    for index in 0..300 {
        assert!(e.set_track(index, f::SCALE as u32, 49));
        assert!(e.set_step(index, 0, 0, 36 + (index % 60) as i32));
    }
    e.set_scale(49, 4095, 0);
    e.tick();
    for index in 0..300 {
        assert_eq!(e.note(index), Some(36 + (index % 60) as i32));
        assert_ne!(e.track_events(index) & 1, 0);
    }
    assert!(e.set_track(299, f::MUTE as u32, 1));
    e.tick();
    assert_ne!(e.track_events(299) & 2, 0);
    assert!(e.gate(298));
    assert!(!e.gate(299));
}

#[test]
fn routes_outputs_and_mx_address_tracks_beyond_eight_bits() {
    let mut e = Sequencer::default();
    e.resize_tracks(300);
    e.aux[0].set(0, d::PITCH_OFFSET as i32);
    e.aux[0].set(1, 300); // track index 299; target 2 remains All.
    e.aux[0].set(2, 1000);
    e.set_step(299, 0, 12, 4444);
    assert!(e.set_output(0, 4, 299));
    e.tick();
    assert_eq!(e.cents(299), 7200);
    assert_eq!(e.cents(0), 6000);
    assert_eq!(e.output_value(0), 4444);
    e.set_global(4, 5); // MX track stage
    e.set_global(5, 299);
    e.set_global(6, 1);
    e.set_track(299, f::OFFSET as u32, 15);
    e.restart();
    e.tick();
    assert_eq!(e.mx_value(), 128);
    assert!(e.remove_track(0));
    assert_eq!(e.aux[0].target, 299);
    assert_eq!(e.output_config[0][1], 298);
    assert_eq!(e.mx_config[1], 298);
}

#[test]
fn growing_and_removing_tracks_keeps_existing_playheads() {
    let mut e = Sequencer::default();
    for _ in 0..75 {
        e.tick();
    }
    let stage = e.stage(1);
    let ticks = e.ticks;
    assert!(e.resize_tracks(33));
    assert_eq!(e.stage(1), stage);
    assert_eq!(e.ticks, ticks);
    assert!(e.remove_track(0));
    assert_eq!(e.stage(0), stage);
    assert_eq!(e.tracks.len(), 32);
    assert!(e.resize_tracks(1));
    assert!(!e.resize_tracks(0));
    assert!(!e.remove_track(0));
    e.set_global(5, 0);
    e.tick();
    assert!(e.gate(0));
}

#[test]
fn loopy_can_target_only_a_new_track() {
    let mut e = Sequencer::default();
    e.resize_tracks(4);
    e.set_global(10, 3); // Track 3, not All.
    e.aux[0].set(0, d::LOOPY as i32);
    e.aux[0].set(2, 5000);
    e.tick();
    assert!(e.loopy_active(2));
    for index in [0, 1, 3] {
        assert!(!e.loopy_active(index));
    }
    e.set_global(10, 2);
    for _ in 0..24 {
        e.tick();
    }
    for index in 0..4 {
        assert!(e.loopy_active(index));
    }
}
