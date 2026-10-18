use metropolix_core::{
    order::{Direction, OrderMode, PlayOrder},
    random::FirmwareRandom,
    scale::{FACTORY_SCALES, Quantizer, ScaleMask},
};

#[test]
fn quantizer_matches_original_arm_instructions() {
    let mut cases = 0;
    for (index, line) in include_str!("fixtures/quantizer.tsv")
        .lines()
        .enumerate()
        .skip(1)
    {
        let values: Vec<i32> = line.split('\t').map(|s| s.parse().unwrap()).collect();
        assert_eq!(values.len(), 9);
        let quantizer = Quantizer::new(
            ScaleMask::new(values[0] as u16),
            values[1] as i16,
            values[2] as i16,
            values[3] as i16,
        )
        .unwrap();
        let actual = quantizer.quantize(
            values[4] as i16,
            values[5] as i16,
            values[6] as i16,
            values[7] as i16,
        );
        assert_eq!(
            actual,
            values[8],
            "original ARM fixture line {}: {values:?}",
            index + 1
        );
        cases += 1;
    }
    assert_eq!(cases, 62_636, "reference corpus must be complete");
}

#[test]
fn all_play_orders_match_original_arm_traces() {
    let mut cases = 0;
    for (index, line) in include_str!("fixtures/orders.tsv")
        .lines()
        .enumerate()
        .skip(1)
    {
        let fields: Vec<&str> = line.split('\t').collect();
        assert_eq!(fields.len(), 9);
        let mode = OrderMode::from_id(fields[0].parse().unwrap()).unwrap();
        let length: u8 = fields[1].parse().unwrap();
        let reverse: bool = fields[2] == "1";
        let direction = if reverse {
            Direction::Reverse
        } else {
            Direction::Forward
        };
        let mut random =
            FirmwareRandom::new(fields[3].parse().unwrap(), fields[4].parse().unwrap());
        let mut order = PlayOrder::new(mode, length, direction, &mut random).unwrap();
        let expected: Vec<u8> = fields[5].split(',').map(|s| s.parse().unwrap()).collect();
        assert_eq!(expected.len(), 129);
        assert_eq!(
            order.current(),
            expected[0],
            "reset, fixture line {}: {mode:?}, length {length}, {direction:?}",
            index + 1
        );
        for tick in 0..128 {
            if tick == 16 {
                order.set_length(length).unwrap();
            }
            if tick == 32 {
                order.reset(&mut random);
            }
            if tick == 64 {
                order.set_direction(if reverse {
                    Direction::Forward
                } else {
                    Direction::Reverse
                });
            }
            if tick == 80 {
                order.set_direction(if reverse {
                    Direction::Forward
                } else {
                    Direction::Reverse
                });
            }
            if tick == 96 {
                order.set_length(9 - length).unwrap();
            }
            assert_eq!(
                order.advance(&mut random),
                expected[tick + 1],
                "fixture line {}, tick {tick}: {mode:?}, length {length}, {direction:?}",
                index + 1
            );
        }
        assert_eq!(
            random.state(),
            (fields[6].parse().unwrap(), fields[7].parse().unwrap()),
            "shared random state at fixture line {}",
            index + 1
        );
        assert_eq!(
            order.shuffle_state().unwrap_or(0),
            fields[8].parse::<u32>().unwrap(),
            "local shuffle state at fixture line {}",
            index + 1
        );
        cases += 1;
    }
    assert_eq!(
        cases, 1_344,
        "21 orders × 8 lengths × 2 directions × 4 random states"
    );
}

#[test]
fn quantizer_preserves_ties_and_original_offset_range_rules() {
    let major = Quantizer::new(FACTORY_SCALES[0].mask, 0, 0, 12).unwrap();
    assert_eq!(major.quantize(1, 0, 0, 0), 2);
    assert_eq!(major.quantize(0, 0, -1, 0), -1);
    assert_eq!(major.quantize(12, 0, 1, 12), 24);
    let chromatic = Quantizer::new(ScaleMask::CHROMATIC, 0, 0, 12).unwrap();
    assert_eq!(chromatic.quantize(12, 0, 1, 12), 12);
}

#[test]
fn invalid_configuration_is_rejected_without_changing_random_state() {
    assert!(Quantizer::new(ScaleMask::CHROMATIC, 0, 1, 0).is_err());
    let mut random = FirmwareRandom::new(1, 2);
    assert!(PlayOrder::new(OrderMode::Shuffle, 0, Direction::Forward, &mut random).is_err());
    assert!(PlayOrder::new(OrderMode::Shuffle, 17, Direction::Forward, &mut random).is_err());
    assert_eq!(random.state(), (1, 2));
    assert!(OrderMode::from_id(21).is_none());
}
