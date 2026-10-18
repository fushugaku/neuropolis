use metropolix_core::{
    order::{Direction, OrderMode, PlayOrder},
    random::FirmwareRandom,
};

fn main() {
    for mode in OrderMode::ALL {
        let mut random = FirmwareRandom::new(0x1234_5678, 0x9abc_def0);
        let mut order = PlayOrder::new(mode, 8, Direction::Forward, &mut random).unwrap();
        print!("{mode:?}: {}", order.current() + 1);
        for _ in 0..23 {
            print!(" {}", order.advance(&mut random) + 1);
        }
        println!();
    }
}
