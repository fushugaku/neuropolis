#!/usr/bin/env python3
"""Acquire the pinned official image and the reference files used for analysis."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
INTELLIJEL_REF = "cf1754695cc291dbf35ee4bff118deb8ad69e7dd"
CMSIS_REF = "9192c7b9df75a142f2027ab266601fe061fc00b3"
FIRMWARE_SHA256 = "742b22522255f8367b94d686d92acedb891edde682b8922c1000f0ab3db29304"


def acquire(url: str, destination: str, checksum: str | None = None) -> dict:
    path = ROOT / destination
    request = urllib.request.Request(url, headers={"User-Agent": "Metropolix-static-analysis"})
    with urllib.request.urlopen(request, timeout=60) as response:
        blob = response.read()
    digest = hashlib.sha256(blob).hexdigest()
    if checksum is not None and digest != checksum:
        raise RuntimeError(f"Checksum mismatch for {destination}: {digest}")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(blob)
    print(f"{destination}: {len(blob)} bytes")
    return {"path": destination, "url": url, "bytes": len(blob), "sha256": digest}


def main() -> None:
    firmware_root = f"https://raw.githubusercontent.com/intellijel/firmware/{INTELLIJEL_REF}"
    cmsis_root = f"https://raw.githubusercontent.com/STMicroelectronics/cmsis-device-f4/{CMSIS_REF}"
    files = [
        (f"{firmware_root}/bin/Metropolix.1.6.5.0.bin", "firmware/original/Metropolix.1.6.5.0.bin", FIRMWARE_SHA256),
        (f"{firmware_root}/modules.json", "firmware/metadata/modules.json", None),
        (f"{firmware_root}/docs/Metropolix.html", "firmware/metadata/Metropolix-changelog.html", None),
        (f"{firmware_root}/js/app.js", "tools/upstream/app.js", None),
        (f"{firmware_root}/js/dfu-util.js", "tools/upstream/dfu-util.js", None),
        (f"{firmware_root}/LICENSE", "tools/upstream/LICENSE", None),
        (f"{cmsis_root}/Source/Templates/gcc/startup_stm32f411xe.s", "tools/upstream/startup_stm32f411xe.s", None),
        (f"{cmsis_root}/Include/stm32f411xe.h", "tools/upstream/stm32f411xe.h", None),
        (f"{cmsis_root}/LICENSE.md", "tools/upstream/ST-LICENSE.md", None),
        (f"https://api.github.com/repos/intellijel/firmware/commits/{INTELLIJEL_REF}", "firmware/metadata/upstream-commit.json", None),
        (f"https://api.github.com/repos/intellijel/firmware/contents/bin?ref={INTELLIJEL_REF}", "firmware/metadata/bin-index.json", None),
        (f"https://api.github.com/repos/STMicroelectronics/cmsis-device-f4/commits/{CMSIS_REF}", "firmware/metadata/cmsis-commit.json", None),
    ]
    provenance = [acquire(url, path, checksum) for url, path, checksum in files]
    (ROOT / "firmware/metadata/acquisition.json").write_text(json.dumps(provenance, indent=2) + "\n")


if __name__ == "__main__":
    main()
