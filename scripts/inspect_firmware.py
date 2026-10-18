#!/usr/bin/env python3
"""Validate the acquired image and produce inputs for the Ghidra analysis."""
from __future__ import annotations

import ast
import csv
import hashlib
import json
from pathlib import Path
import re
import struct

ROOT = Path(__file__).resolve().parents[1]
IMAGE = ROOT / "firmware/original/Metropolix.1.6.5.0.bin"
EXPECTED_SHA256 = "742b22522255f8367b94d686d92acedb891edde682b8922c1000f0ab3db29304"
FLASH = 0x08000000


def constant(expression: str, names: dict[str, int]) -> int:
    """Evaluate only integer arithmetic in CMSIS address definitions."""
    expression = re.sub(r"\b(0[xX][0-9a-fA-F]+|\d+)[uUlL]+\b", r"\1", expression)

    def visit(node: ast.AST) -> int:
        if isinstance(node, ast.Constant) and type(node.value) is int:
            return node.value
        if isinstance(node, ast.Name):
            return names[node.id]
        if isinstance(node, ast.BinOp):
            left, right = visit(node.left), visit(node.right)
            if isinstance(node.op, ast.Add):
                return left + right
            if isinstance(node.op, ast.Sub):
                return left - right
            if isinstance(node.op, ast.LShift):
                return left << right
        raise ValueError(expression)

    return visit(ast.parse(expression.strip(), mode="eval").body)


def registers(header: str) -> list[tuple[int, str]]:
    header = re.sub(r"/\*.*?\*/", "", header, flags=re.S)
    definitions = dict(re.findall(r"^#define\s+(\w*BASE)\s+([^\n]+)", header, re.M))
    values: dict[str, int] = {}
    for _ in range(len(definitions)):
        before = len(values)
        for name, expression in definitions.items():
            if name in values:
                continue
            try:
                values[name] = constant(expression, values)
            except (KeyError, ValueError, SyntaxError):
                pass
        if len(values) == before:
            break

    types: dict[str, list[tuple[int, str]]] = {}
    field = re.compile(r"(?:(?:__IO|__I|__O)\s+)?uint(8|16|32)_t\s+(\w+)(?:\[(\d+)\])?")
    for body, name in re.findall(r"typedef\s+struct\s*\{([^{}]+)\}\s*(\w+)\s*;", header, re.S):
        offset, fields = 0, []
        for statement in body.split(";"):
            if not statement.strip():
                continue
            match = field.fullmatch(statement.strip())
            if not match:
                break  # Never guess offsets for an unsupported C declaration.
            bits, member, count = match.groups()
            size = int(bits) // 8
            offset = (offset + size - 1) // size * size
            for index in range(int(count or "1")):
                if not member.startswith("RESERVED"):
                    fields.append((offset, member + (f"_{index}" if count else "")))
                offset += size
        else:
            types[name] = fields

    result: set[tuple[int, str]] = set()
    for name, typename, base in re.findall(
        r"^#define\s+(\w+)\s+\(\(\s*(\w+)\s*\*\s*\)\s*(\w+)\s*\)", header, re.M
    ):
        if base not in values or typename not in types:
            continue
        address = values[base]
        if not (0x40000000 <= address < 0x60000000):
            continue
        result.add((address, name + "_BASE"))
        for offset, member in types[typename]:
            result.add((address + offset, name + "_" + member))
    result.update({
        (0xE000E010, "SYSTICK_CTRL"), (0xE000E014, "SYSTICK_LOAD"),
        (0xE000E018, "SYSTICK_VAL"), (0xE000ED00, "SCB_CPUID"),
        (0xE000ED04, "SCB_ICSR"), (0xE000ED08, "SCB_VTOR"),
        (0xE000ED0C, "SCB_AIRCR"), (0xE000ED88, "SCB_CPACR"),
    })
    return sorted(result)


def main() -> None:
    blob = IMAGE.read_bytes()
    digest = hashlib.sha256(blob).hexdigest()
    if digest != EXPECTED_SHA256:
        raise SystemExit(f"Unexpected firmware SHA-256: {digest}")
    git_blob = hashlib.sha1(f"blob {len(blob)}\0".encode() + blob).hexdigest()
    index = json.loads((ROOT / "firmware/metadata/bin-index.json").read_text())
    expected = next(item for item in index if item["name"] == IMAGE.name)
    if git_blob != expected["sha"] or len(blob) != expected["size"]:
        raise SystemExit("Image differs from the official GitHub blob metadata")

    startup = (ROOT / "tools/upstream/startup_stm32f411xe.s").read_text()
    table = startup.split("g_pfnVectors:", 1)[1].split(".size  g_pfnVectors", 1)[0]
    names = re.findall(r"^\s*\.word\s+(\w+)", table, re.M)
    vectors = struct.unpack_from(f"<{len(names)}I", blob)
    assert len(names) == 102
    assert vectors[0] == 0x20020000
    for index, (name, value) in enumerate(zip(names, vectors)):
        if name == "0":
            assert value == 0, (index, name, value)
        elif index:
            assert value & 1 and FLASH <= value - 1 < FLASH + len(blob), (index, name, value)
    # All reset literals used for SRAM setup must still match this image.
    assert struct.unpack_from("<6I", blob, 0x653D8) == (
        0x20020000, 0x20000000, 0x20001E0C, 0x08079C4C, 0x20001E20, 0x2001F1E8
    )

    analysis = ROOT / "analysis"
    analysis.mkdir(exist_ok=True)
    with (analysis / "vectors.tsv").open("w") as output:
        output.write("index\tslot_address\tvalue\tname\tstatus\n")
        for index, (name, value) in enumerate(zip(names, vectors)):
            status = "initial_sp" if not index else "reserved" if not value else (
                "default_handler" if value == 0x080653F1 else "implemented"
            )
            output.write(f"{index}\t0x{FLASH + 4 * index:08x}\t0x{value:08x}\t{name}\t{status}\n")
    with (analysis / "ascii-strings.tsv").open("w") as output:
        strings = csv.writer(output, delimiter="\t", lineterminator="\n")
        strings.writerow(["file_offset", "text"])
        for match in re.finditer(rb"[\x20-\x7e]{6,}", blob):
            strings.writerow([f"0x{match.start():08x}", match.group().decode("ascii")])
    # Recovered from the loop bounds and table pointer in libc_init_array.
    with (analysis / "init-array.tsv").open("w") as output:
        output.write("index\tslot_address\tthumb_pointer\tfunction_address\n")
        for index, value in enumerate(struct.unpack_from("<79I", blob, 0x79B0C)):
            assert value & 1 and FLASH <= value - 1 < FLASH + len(blob)
            output.write(f"{index}\t0x{FLASH + 0x79b0c + 4 * index:08x}\t0x{value:08x}\t{value - 1:08x}\n")
    mmio = registers((ROOT / "tools/upstream/stm32f411xe.h").read_text())
    with (analysis / "mmio-registers.tsv").open("w") as output:
        output.write("address\tname\n")
        for address, name in mmio:
            output.write(f"0x{address:08x}\t{name}\n")

    commit = json.loads((ROOT / "firmware/metadata/upstream-commit.json").read_text())["sha"]
    manifest = {
        "product": "Intellijel Metropolix", "version": "1.6.5.0",
        "retrieved_date": "2026-10-16", "size_bytes": len(blob),
        "sha256": digest, "git_blob_sha1": git_blob, "upstream_commit": commit,
        "source_url": f"https://raw.githubusercontent.com/intellijel/firmware/{commit}/bin/{IMAGE.name}",
        "updater_url": "https://intellijel.github.io/firmware/",
        "format": "raw ARM Thumb little-endian image",
        "architecture": "Cortex-M4 with FPU enabled in SystemInit",
        "mcu_family_inference": "STM32F411xE: exact CMSIS reserved-vector pattern, 102 vectors, 128 KiB initial stack boundary",
        "mcu_package": "unknown; board marking required",
        "flash_base": "0x08000000", "flash_end_exclusive": f"0x{FLASH + len(blob):08x}",
        "reset_handler": "0x080653a0", "initial_sp": "0x20020000",
        "data_load": "0x08079c4c", "data_start": "0x20000000", "data_end": "0x20001e0c",
        "bss_start": "0x20001e20", "bss_end": "0x2001f1e8",
        "vector_count": len(names), "mmio_labels": len(mmio),
        "scope": "static analysis only; no hardware connection or programming",
    }
    (ROOT / "firmware/metadata/manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"sha256": digest, "bytes": len(blob), "vectors": len(names), "mmio_labels": len(mmio)}, indent=2))


if __name__ == "__main__":
    main()
