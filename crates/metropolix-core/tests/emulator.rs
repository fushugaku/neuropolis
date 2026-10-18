use metropolix_core::{
    accumulator::{Accumulator, AccumulatorConfig, AccumulatorMode, Polarity},
    order::{Direction, OrderMode, PlayOrder},
    random::FirmwareRandom,
    sequencer::Sequencer,
};

#[test]
fn sixteen_stage_extension_keeps_all_modes_in_bounds() {
    for mode in OrderMode::ALL {
        for length in 9..=16 {
            for direction in [Direction::Forward, Direction::Reverse] {
                let mut random = FirmwareRandom::new(0x12345678, 0x9abcdef0);
                let mut order = PlayOrder::new(mode, length, direction, &mut random).unwrap();
                for tick in 0..512 {
                    assert!(order.current() < length, "{mode:?}, {length}, {tick}");
                    order.advance(&mut random);
                }
            }
        }
    }
}

#[test]
fn linear_order_visits_every_one_of_sixteen_stages() {
    let mut random = FirmwareRandom::new(1, 2);
    let mut order = PlayOrder::new(OrderMode::Linear, 16, Direction::Forward, &mut random).unwrap();
    for expected in 0..64 {
        assert_eq!(order.current(), expected % 16);
        order.advance(&mut random);
    }
}

#[test]
fn tracks_have_separate_notes_pulse_counts_and_gate_settings() {
    let mut sequencer = Sequencer::default();
    sequencer.set_step(0, 0, 0, 36);
    sequencer.set_step(1, 0, 0, 72);
    sequencer.set_step(0, 0, 1, 3);
    sequencer.set_step(1, 0, 1, 1);
    assert_eq!(sequencer.tick() & 5, 5);
    assert_eq!(sequencer.note(0), Some(36));
    assert_eq!(sequencer.note(1), Some(72));
    for _ in 1..25 {
        sequencer.tick();
    }
    assert_eq!(sequencer.stage(0), Some(0));
    assert_eq!(sequencer.stage(1), Some(1));
    for _ in 25..73 {
        sequencer.tick();
    }
    assert_eq!(sequencer.stage(0), Some(1));
    assert_eq!(sequencer.stage(1), Some(3));
    assert!(sequencer.set_step(1, 15, 0, 84));
    assert_eq!(sequencer.tracks[0].steps[15].pitch, 60);
    assert_eq!(sequencer.tracks[1].steps[15].pitch, 84);
}

#[test]
fn all_skipped_stages_are_silent_and_mute_releases_an_open_gate() {
    let mut sequencer = Sequencer::default();
    for stage in 0..16 {
        sequencer.set_step(0, stage, 6, 1);
    }
    for _ in 0..384 {
        assert_eq!(sequencer.tick() & 1, 0);
    }
    sequencer.reset();
    assert_ne!(sequencer.tick() & 4, 0);
    sequencer.set_track(1, 8, 1);
    assert_ne!(sequencer.tick() & 8, 0);
    for _ in 0..384 {
        assert_eq!(sequencer.tick() & 4, 0);
    }
}

#[test]
fn accumulator_keeps_sixteenth_stage_independent() {
    let mut random = FirmwareRandom::new(1, 2);
    let config = AccumulatorConfig::new(AccumulatorMode::Wrap, Polarity::Bipolar, -12, 12).unwrap();
    let mut accumulator = Accumulator::default();
    accumulator.trigger(15, 3, config, &mut random).unwrap();
    assert_eq!(accumulator.stage(15).unwrap().offset, 3);
    assert_eq!(accumulator.stage(7).unwrap().offset, 0);
    assert_eq!(accumulator.track().offset, 3);
    assert!(accumulator.trigger(16, 3, config, &mut random).is_err());
}
