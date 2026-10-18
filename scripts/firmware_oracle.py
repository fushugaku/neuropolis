"""Execute selected functions from the unmodified official ARM firmware.

Only Flash, SRAM and a return sentinel are mapped by default. Unexpected MMIO
access fails instead of silently inventing hardware behavior. Tests may install
explicit function hooks (for example, to observe task registration).
"""
from __future__ import annotations

import hashlib
from pathlib import Path
import struct
from typing import Callable

from unicorn import Uc, UcError, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS, UC_HOOK_CODE
from unicorn.arm_const import (
    UC_CPU_ARM_CORTEX_M4, UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3,
    UC_ARM_REG_SP, UC_ARM_REG_LR, UC_ARM_REG_PC, UC_ARM_REG_XPSR,
)

ROOT = Path(__file__).resolve().parents[1]
FLASH = 0x08000000
RAM = 0x20000000
SCRATCH = 0x2001F200
RETURN = 0x0FFF0000
SHA256 = "742b22522255f8367b94d686d92acedb891edde682b8922c1000f0ab3db29304"
ARG_REGS = (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3)


class FirmwareOracle:
    def __init__(self) -> None:
        self.image = (ROOT / "firmware/original/Metropolix.1.6.5.0.bin").read_bytes()
        if hashlib.sha256(self.image).hexdigest() != SHA256:
            raise ValueError("Unexpected firmware image")
        self.uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
        self.uc.ctl_set_cpu_model(UC_CPU_ARM_CORTEX_M4)
        self.uc.mem_map(FLASH, 0x100000)
        self.uc.mem_write(FLASH, self.image)
        self.uc.mem_map(RAM, 0x20000)
        self.uc.mem_map(RETURN, 0x1000)
        self.uc.reg_write(UC_ARM_REG_SP, RAM + 0x1FFF0)
        self.uc.reg_write(UC_ARM_REG_XPSR, 0x01000000)
        self.initial_context = self.uc.context_save()
        self.hooks: dict[int, Callable[[FirmwareOracle], int | None]] = {}
        self.uc.hook_add(UC_HOOK_CODE, self._hook)
        self.reset_ram()

    def reset_ram(self) -> None:
        data = bytearray(0x20000)
        data[:0x1E0C] = self.image[0x79C4C:0x7BA58]
        self.uc.mem_write(RAM, bytes(data))

    def _hook(self, uc: Uc, address: int, size: int, user_data: object) -> None:
        hook = self.hooks.get(address)
        if hook is not None:
            result = hook(self)
            if result is not None:
                uc.reg_write(UC_ARM_REG_R0, result & 0xFFFFFFFF)
            uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR))

    def read(self, address: int, length: int) -> bytes:
        return bytes(self.uc.mem_read(address, length))

    def write(self, address: int, value: bytes) -> None:
        self.uc.mem_write(address, value)

    def u32(self, address: int) -> int:
        return struct.unpack("<I", self.read(address, 4))[0]

    def cstring(self, address: int) -> str:
        value = bytearray()
        for i in range(1024):
            char = self.read(address + i, 1)
            if char == b"\0":
                return value.decode("utf-8", errors="replace")
            value += char
        raise ValueError(f"Unterminated string at {address:#x}")

    def arg(self, index: int) -> int:
        if index < 4:
            return self.uc.reg_read(ARG_REGS[index])
        return self.u32(self.uc.reg_read(UC_ARM_REG_SP) + (index - 4) * 4)

    def call(self, address: int, *args: int, limit: int = 100000) -> int:
        self.uc.context_restore(self.initial_context)
        sp = self.uc.reg_read(UC_ARM_REG_SP)
        for index, value in enumerate(args):
            if index < 4:
                self.uc.reg_write(ARG_REGS[index], value & 0xFFFFFFFF)
            else:
                self.write(sp + (index - 4) * 4, struct.pack("<I", value & 0xFFFFFFFF))
        self.uc.reg_write(UC_ARM_REG_LR, RETURN | 1)
        try:
            self.uc.emu_start(address | 1, RETURN, timeout=2_000_000, count=limit)
        except UcError as error:
            pc = self.uc.reg_read(UC_ARM_REG_PC)
            raise RuntimeError(f"ARM function {address:#010x} failed at {pc:#010x}: {error}") from error
        pc = self.uc.reg_read(UC_ARM_REG_PC)
        if pc != RETURN:
            raise RuntimeError(f"ARM function {address:#010x} exceeded its execution limit at {pc:#010x}")
        return self.uc.reg_read(UC_ARM_REG_R0)
