#!/usr/bin/env python3
"""Generate Rust's reference outputs by executing the original ARM instructions."""
from __future__ import annotations

import csv
import hashlib
import json
from pathlib import Path
import random
import struct
import subprocess

from firmware_oracle import FirmwareOracle, ROOT, SCRATCH, SHA256

FIXTURES = ROOT / "crates/metropolix-core/tests/fixtures"
VTABLES = [
    0x0806FD38, 0x08070BAC, 0x08070B94, 0x08070B1C,
    0x0806FD50, 0x0806FD68, 0x0806FD80, 0x0806FD98,
    0x08070BC4, 0x0806FDB0, 0x0806FDC8, 0x0806FDE0,
    0x08070B7C, 0x08070B04, 0x08070B34, 0x08070BDC,
    0x08070ABC, 0x08070B64, 0x08070B4C, 0x08070AD4, 0x08070AEC,
]
RANDOM_ADDRESS = 0x2001ED10
SEEDS = [(1, 1), (0x12345678, 0x9ABCDEF0), (0xFFFFFFFF, 0x13579BDF), (0, 0)]


def recover_runtime() -> dict:
    emu = FirmwareOracle()
    tasks = []

    def task_create(e: FirmwareOracle) -> int:
        tasks.append({
            "name": e.cstring(e.arg(1)), "entry": f"0x{e.arg(0) & ~1:08x}",
            "priority": e.arg(4), "stack_words": e.arg(2), "argument": e.arg(3),
            "stack_address": f"0x{e.arg(5):08x}", "tcb_address": f"0x{e.arg(6):08x}",
        })
        return e.arg(6)

    emu.hooks[0x08066C24] = task_create
    emu.hooks[0x0806EB10] = lambda e: 0
    emu.call(0x08001294, limit=1_000_000)
    assert len(tasks) == 6
    emu.hooks.clear()
    emu.call(0x08025C88)
    scales = []
    for index in range(49):
        mask, name = struct.unpack("<II", emu.read(0x20013F94 + index * 8, 8))
        scales.append({"id": index, "mask": mask, "name": emu.cstring(name)})

    # Execute the real object constructor and selection switch. Only intercept
    # the handoff after the switch to observe which generator it selected.
    emu.write(SCRATCH, bytes(0x900))
    emu.call(0x08004EA4, SCRATCH, 0, limit=100000)
    orders = []
    selected = []
    emu.hooks[0x08026E16] = lambda e: selected.append(e.arg(1)) or 0
    for mode, vtable in enumerate(VTABLES):
        emu.call(0x0800515C, SCRATCH, mode)
        actual = emu.u32(selected[-1])
        assert actual == vtable, (mode, hex(actual), hex(vtable))
        emu.write(SCRATCH + 0x800, bytes([mode]))
        name = emu.cstring(emu.call(0x080237C8, SCRATCH + 0x800))
        orders.append({"id": mode, "name": name, "vtable": f"0x{vtable:08x}",
                       "reset": f"0x{emu.u32(vtable) & ~1:08x}",
                       "advance": f"0x{emu.u32(vtable + 4) & ~1:08x}"})
    return {"image_sha256": SHA256, "tasks": tasks, "factory_scales": scales, "orders": orders,
            "task_observation_hooks": {"0x08066c24": "record static task creation and return its supplied TCB",
                                       "0x0806eb10": "skip destructor registration"},
            "order_mapping_hook": {"0x08026e16": "observe selected object after actual selection switch"}}


def write_factory(scales: list[dict]) -> None:
    path = ROOT / "crates/metropolix-core/src/scale/factory.rs"
    path.parent.mkdir(parents=True, exist_ok=True)
    content = ["// Generated from the real constructor at 0x08025c88; do not edit by hand.\n",
               "use super::{FactoryScale, ScaleMask};\n\n",
               "pub const FACTORY_SCALES: [FactoryScale; 49] = [\n"]
    for scale in scales:
        content.append(f'    FactoryScale {{ name: {json.dumps(scale["name"])}, mask: ScaleMask::new(0x{scale["mask"]:03x}) }},\n')
    content.append("];\n")
    path.write_text("".join(content))
    subprocess.run(["rustup", "run", "stable", "rustfmt", "--edition", "2024", str(path)], check=True)


def quantizer_fixtures(scales: list[dict]) -> int:
    emu = FirmwareOracle()
    count = 0
    with (FIXTURES / "quantizer.tsv").open("w", newline="") as file:
        writer = csv.writer(file, delimiter="\t", lineterminator="\n")
        writer.writerow(["mask", "root", "minimum", "maximum", "pitch", "root_offset", "degrees", "post", "expected"])

        def sample(mask: int, root: int, minimum: int, maximum: int, pitch: int,
                   root_offset: int = 0, degrees: int = 0, post: int = 0) -> None:
            nonlocal count
            emu.write(SCRATCH, struct.pack("<HBBii", mask, root, 0, minimum, maximum))
            value = emu.call(0x08025012, SCRATCH, pitch, root_offset, degrees, post)
            signed = struct.unpack("<i", struct.pack("<I", value))[0]
            writer.writerow([mask, root, minimum, maximum, pitch, root_offset, degrees, post, signed])
            count += 1

        # Every twelve-bit scale mask and every pitch class, using original code.
        for mask in range(4096):
            for pitch in range(12):
                sample(mask, 0, -24, 24, pitch)
        print(f"quantizer: {count} exhaustive mask/pitch cases", flush=True)
        for scale in scales:
            for root in range(12):
                for pitch in [-25, -13, -1, 0, 1, 11, 12, 127, 145]:
                    sample(scale["mask"], root, -24, 144, pitch)
        source = random.Random(0x1650)
        ranges = [(-24, 0), (0, 0), (1, 1), (0, 11), (2, 2), (-12, 127), (-100, 100), (60, 72)]
        for _ in range(8192):
            minimum, maximum = source.choice(ranges)
            sample(source.randrange(65536), source.randrange(256), minimum, maximum,
                   source.randrange(-240, 241), source.randrange(-24, 25),
                   source.choice([-24, -12, -7, -1, 0, 1, 7, 12, 24]), source.randrange(-24, 25))
    return count


def order_fixtures() -> int:
    emu = FirmwareOracle()
    count = 0
    with (FIXTURES / "orders.tsv").open("w", newline="") as file:
        writer = csv.writer(file, delimiter="\t", lineterminator="\n")
        writer.writerow(["mode", "length", "reverse", "seed_first", "seed_second", "stages",
                         "final_rng_first", "final_rng_second", "shuffle_state"])
        for mode, vtable in enumerate(VTABLES):
            reset, advance, on_length, on_direction = struct.unpack("<4I", emu.read(vtable, 16))
            for length in range(1, 9):
                for reverse in range(2):
                    for first, second in SEEDS:
                        emu.write(SCRATCH, bytes(0x100))
                        emu.write(RANDOM_ADDRESS, struct.pack("<II", first, second))
                        if mode == 18:
                            emu.call(0x08024DA0, SCRATCH)
                        else:
                            emu.write(SCRATCH, struct.pack("<IIII", vtable, 0, 8, 0))
                        emu.write(SCRATCH + 8, struct.pack("<II", length, reverse))
                        emu.call(reset, SCRATCH)
                        stages = [emu.u32(SCRATCH + 4)]
                        for tick in range(128):
                            if tick == 16:
                                emu.call(0x08024524, SCRATCH, length)
                            if tick == 32:
                                emu.call(reset, SCRATCH)
                            if tick == 64:
                                emu.call(0x08024512, SCRATCH, 1 - reverse)
                            if tick == 80:
                                emu.call(0x08024512, SCRATCH, 1 - reverse)
                            if tick == 96:
                                emu.call(0x08024524, SCRATCH, 9 - length)
                            emu.call(advance, SCRATCH)
                            stages.append(emu.u32(SCRATCH + 4))
                        a, b = struct.unpack("<II", emu.read(RANDOM_ADDRESS, 8))
                        state = emu.u32(SCRATCH + 0x34) if mode == 18 else 0
                        writer.writerow([mode, length, reverse, first, second, ",".join(map(str, stages)), a, b, state])
                        count += 1
            print(f"orders: mode {mode} done", flush=True)
    return count


def accumulator_fixtures() -> int:
    emu = FirmwareOracle()
    count = 0
    increments = [-4, -1, 0, 1, 3, 7, -7, 12]
    with (FIXTURES / "accumulator.tsv").open("w", newline="") as file:
        writer = csv.writer(file, delimiter="\t", lineterminator="\n")
        writer.writerow(["mode", "lower", "upper", "bipolar", "reverse", "invert", "invert_polarity",
                         "seed_first", "seed_second", "states", "final_rng_first", "final_rng_second"])
        for mode in range(4):
            for lower, upper in [(0, 0), (-7, 7), (-12, 0), (0, 12), (-2, 5)]:
                for flags in range(16):
                    bipolar, reverse, invert, invert_polarity = [(flags >> n) & 1 for n in range(4)]
                    for first, second in SEEDS:
                        emu.write(SCRATCH, bytes(0x500))
                        emu.write(SCRATCH + 0x238, struct.pack("<ii", upper, lower))
                        emu.write(SCRATCH + 0x241, bytes([mode]))
                        emu.write(SCRATCH + 0x243, bytes([bipolar]))
                        emu.write(SCRATCH + 0x268, bytes([reverse, invert_polarity, invert]))
                        emu.write(RANDOM_ADDRESS, struct.pack("<II", first, second))
                        states = []
                        for tick in range(64):
                            if tick == 32:
                                emu.call(0x0803069E, SCRATCH)
                            stage = (tick * 5) % 8
                            emu.write(SCRATCH + stage * 0x3C + 0x2EC, struct.pack("<i", increments[tick % 8]))
                            active = emu.call(0x08031098, SCRATCH, stage)
                            track_value = struct.unpack("<i", emu.read(SCRATCH + 0x24C, 4))[0]
                            snapshot = [active, track_value, emu.u32(SCRATCH + 0x244)]
                            for i in range(8):
                                snapshot.extend([struct.unpack("<i", emu.read(SCRATCH + 0x2E8 + i * 0x3C, 4))[0],
                                                 emu.u32(SCRATCH + 0x2F4 + i * 0x3C)])
                            states.append(",".join(map(str, snapshot)))
                        a, b = struct.unpack("<II", emu.read(RANDOM_ADDRESS, 8))
                        writer.writerow([mode, lower, upper, bipolar, reverse, invert, invert_polarity,
                                         first, second, ";".join(states), a, b])
                        count += 1
            print(f"accumulator: mode {mode} done", flush=True)
    return count


def main() -> None:
    FIXTURES.mkdir(parents=True, exist_ok=True)
    runtime = recover_runtime()
    (ROOT / "analysis/runtime-map.json").write_text(json.dumps(runtime, indent=2) + "\n")
    write_factory(runtime["factory_scales"])
    print("runtime: six tasks, 49 factory scales, 21 selected generator vtables verified", flush=True)
    quantizers = quantizer_fixtures(runtime["factory_scales"])
    orders = order_fixtures()
    accumulators = accumulator_fixtures()
    metadata = {
        "firmware_sha256": SHA256, "unicorn_version": "2.1.4",
        "quantizer_cases": quantizers, "order_traces": orders, "order_advances_per_trace": 128,
        "accumulator_traces": accumulators, "accumulator_events_per_trace": 64,
        "order_events": {"16": "set same length", "32": "reset", "64": "reverse direction",
                         "80": "set same direction", "96": "change length to 9-initial_length"},
        "primitive_functions_stubbed": False,
        "checksums": {name: hashlib.sha256((FIXTURES / name).read_bytes()).hexdigest()
                      for name in ["quantizer.tsv", "orders.tsv", "accumulator.tsv"]},
    }
    (FIXTURES / "provenance.json").write_text(json.dumps(metadata, indent=2) + "\n")
    print(json.dumps(metadata, indent=2), flush=True)


if __name__ == "__main__":
    main()
