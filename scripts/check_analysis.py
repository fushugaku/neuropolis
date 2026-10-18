#!/usr/bin/env python3
"""Check artifact integrity. This does not certify recovered program semantics."""
from __future__ import annotations

import collections
import csv
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="") as source:
        result = list(csv.DictReader(source, delimiter="\t", strict=True))
    assert all(None not in row and all(value is not None for value in row.values()) for row in result), path
    return result


def main() -> None:
    manifest = json.loads((ROOT / "firmware/metadata/manifest.json").read_text())
    image = ROOT / "firmware/original/Metropolix.1.6.5.0.bin"
    assert hashlib.sha256(image.read_bytes()).hexdigest() == manifest["sha256"]
    for item in json.loads((ROOT / "firmware/metadata/acquisition.json").read_text()):
        assert hashlib.sha256((ROOT / item["path"]).read_bytes()).hexdigest() == item["sha256"], item["path"]

    output = ROOT / "analysis/ghidra"
    summary = json.loads((output / "summary.json").read_text())
    functions = rows(output / "functions.tsv")
    assert len(functions) == summary["functions"]
    assert len({function["address"] for function in functions}) == len(functions)
    assert sum(function["decompiled"] == "true" for function in functions) == summary["decompiled"]
    assert len(rows(output / "decompile-failures.tsv")) == summary["failed"]
    assert len(list((output / "functions").glob("*.c"))) == len(functions)
    addresses = {function["address"] for function in functions}
    warnings: collections.Counter[str] = collections.Counter()
    warning_functions = 0
    for function in functions:
        content = (output / function["file"]).read_text()
        assert content.startswith(f"/* {function['address']} : {function['name']} */")
        warning_functions += "WARNING:" in content
        for line in content.splitlines():
            if "WARNING:" in line:
                warnings[line.strip()] += 1
    callgraph = rows(output / "callgraph.tsv")
    assert all(edge["caller_address"] in addresses and edge["callee_address"] in addresses for edge in callgraph)
    strings = rows(ROOT / "analysis/ascii-strings.tsv")
    references = rows(output / "string-xrefs.tsv")
    source_strings = {f"{0x08000000 + int(row['file_offset'], 16):08x}": row["text"] for row in strings}
    assert all(source_strings[row["string_address"]] == row["text"] for row in references)
    mmio = rows(output / "mmio-xrefs.tsv")
    assert all(row["register_name"] for row in mmio)
    assert len(rows(ROOT / "analysis/vectors.tsv")) == manifest["vector_count"]
    assert sum(1 for _ in (output / "disassembly.txt").open()) == summary["instruction_count"]
    reset = (output / "functions/080653a0_Reset_Handler.c").read_text()
    assert "SystemInit();" in reset and "libc_init_array();" in reset and "main();" in reset
    report = {
        "integrity_checks": "passed", "functions": len(functions),
        "decompiled": summary["decompiled"], "failed": summary["failed"],
        "instructions": summary["instruction_count"], "call_edges": len(callgraph),
        "ascii_candidates": len(strings), "string_xrefs": len(references),
        "referenced_ascii_candidates": len({row["string_address"] for row in references}),
        "mmio_xrefs": len(mmio), "functions_with_decompiler_warnings": warning_functions,
        "warning_counts": dict(warnings.most_common()),
        "semantic_equivalence": "full firmware not established; this script checks static artifacts only; primitive execution comparisons are documented in RUST_PORT.md",
    }
    (ROOT / "analysis/verification.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({key: value for key, value in report.items() if key != "warning_counts"}, indent=2))


if __name__ == "__main__":
    main()
