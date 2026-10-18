# Musical engine provenance and validation

**English** · [Русский](PORTING.ru.md)

Neuropolis began with research into musical primitives from Intellijel Metropolix 1.6.5.0. The quantizer, traversal generators, random generator and accumulator were rewritten in Rust. Computer transport, 16-stage extension, dynamic tracks, UI and plugin wrappers were implemented separately.

Original firmware is not executed by Neuropolis, is not included in installers and is not required for ordinary builds. This is not a complete STM32 board emulator.

## Behavioral fixtures

`crates/metropolix-core/tests/firmware_equivalence.rs` and `accumulator_equivalence.rs` compare against saved input/output from original ARM primitives executed through Unicorn:

- 62,636 quantizer cases;
- 1,344 traversal traces with 128 advances each;
- 1,280 accumulator traces with 64 events each.

Generation parameters and TSV checksums are in [fixtures/provenance.json](../crates/metropolix-core/tests/fixtures/provenance.json). These are musical test data, not firmware code. The tested primitives were not stubbed during trace generation. Comparisons validate the sampled input sets, not the complete firmware or every possible musical scenario.

## Research references

- [Official Intellijel firmware repository, pinned commit](https://github.com/intellijel/firmware/tree/cf1754695cc291dbf35ee4bff118deb8ad69e7dd).
- Researched image SHA-256: `742b22522255f8367b94d686d92acedb891edde682b8922c1000f0ab3db29304`.
- [CMSIS Device F4, pinned commit](https://github.com/STMicroelectronics/cmsis-device-f4/tree/9192c7b9df75a142f2027ab266601fe061fc00b3), used as an STM32 reference.

Optional acquisition/research scripts are retained. Downloaded images, decompilation and local reports are excluded from Git. Third-party reference materials retain their owners' licensing terms. None are needed for normal builds or tests.

To regenerate the ARM fixtures, acquire the pinned reference files first:

```sh
python3 scripts/download_firmware.py
python3 -m venv .venv
.venv/bin/pip install -r scripts/requirements-re.txt
.venv/bin/python scripts/generate_oracle_fixtures.py
```

Ghidra is used only for optional static research through `scripts/decompile.sh`; ordinary Rust builds do not depend on it.
