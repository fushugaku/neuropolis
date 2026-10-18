use metropolix_core::{
    accumulator::{Accumulator, AccumulatorConfig, AccumulatorMode, Polarity},
    random::FirmwareRandom,
};

#[test]
fn accumulators_match_original_arm_state_after_every_trigger() {
    let modes = [
        AccumulatorMode::Wrap,
        AccumulatorMode::Pendulum,
        AccumulatorMode::Brownian,
        AccumulatorMode::Clamp,
    ];
    let increments = [-4, -1, 0, 1, 3, 7, -7, 12];
    let mut count = 0;
    for (index, line) in include_str!("fixtures/accumulator.tsv")
        .lines()
        .enumerate()
        .skip(1)
    {
        let fields: Vec<&str> = line.split('\t').collect();
        let polarity = if fields[3] == "1" {
            Polarity::Bipolar
        } else {
            Polarity::Unipolar
        };
        let mut config = AccumulatorConfig::new(
            modes[fields[0].parse::<usize>().unwrap()],
            polarity,
            fields[1].parse().unwrap(),
            fields[2].parse().unwrap(),
        )
        .unwrap();
        config.reverse = fields[4] == "1";
        config.invert = fields[5] == "1";
        config.invert_polarity = fields[6] == "1";
        let mut random =
            FirmwareRandom::new(fields[7].parse().unwrap(), fields[8].parse().unwrap());
        let mut accumulator = Accumulator::default();
        let states: Vec<&str> = fields[9].split(';').collect();
        assert_eq!(states.len(), 64);
        for (tick, expected) in states.iter().enumerate() {
            if tick == 32 {
                accumulator.reset();
            }
            let active = accumulator
                .trigger(
                    ((tick * 5) % 8) as u8,
                    increments[tick % 8],
                    config,
                    &mut random,
                )
                .unwrap();
            let mut actual = vec![
                i32::from(active),
                accumulator.track().offset,
                i32::from(accumulator.track().reflected),
            ];
            for stage in 0..8 {
                let value = accumulator.stage(stage).unwrap();
                actual.extend([value.offset, i32::from(value.reflected)]);
            }
            let expected: Vec<i32> = expected.split(',').map(|s| s.parse().unwrap()).collect();
            assert_eq!(
                actual,
                expected,
                "ARM fixture line {}, trigger {tick}",
                index + 1
            );
        }
        assert_eq!(
            random.state(),
            (fields[10].parse().unwrap(), fields[11].parse().unwrap())
        );
        count += 1;
    }
    assert_eq!(count, 1_280);
}
