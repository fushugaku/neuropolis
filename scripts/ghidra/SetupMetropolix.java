// Version-specific Cortex-M setup for the official Metropolix 1.6.5.0 image.
// @category Metropolix
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.DWordDataType;
import ghidra.program.model.listing.Function;
import ghidra.program.model.mem.Memory;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.RefType;
import ghidra.program.model.symbol.SourceType;
import java.io.ByteArrayInputStream;
import java.math.BigInteger;
import java.nio.file.Files;
import java.nio.file.Path;

public class SetupMetropolix extends GhidraScript {
    private void map(String name, long start, long length, boolean vol) throws Exception {
        MemoryBlock b = currentProgram.getMemory().createUninitializedBlock(
            name, toAddr(start), length, false);
        b.setRead(true);
        b.setWrite(true);
        b.setExecute(false);
        b.setVolatile(vol);
    }

    private void entry(long address, String name) throws Exception {
        Address a = toAddr(address);
        createLabel(a, name, true);
        currentProgram.getSymbolTable().addExternalEntryPoint(a);
        disassemble(a);
        Function f = getFunctionAt(a);
        if (f == null) f = createFunction(a, name);
        if (f != null) f.setName(name, SourceType.USER_DEFINED);
    }

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 2) throw new IllegalArgumentException("vectors.tsv mmio-registers.tsv");
        Memory mem = currentProgram.getMemory();
        MemoryBlock flash = mem.getBlock(toAddr(0x08000000L));
        flash.setName("FLASH");
        flash.setRead(true);
        flash.setWrite(false);
        flash.setExecute(true);
        currentProgram.getProgramContext().setValue(
            currentProgram.getRegister("TMode"), flash.getStart(), flash.getEnd(), BigInteger.ONE);

        // These boundaries come from the actual Reset_Handler literal pool.
        byte[] data = new byte[0x1e0c];
        mem.getBytes(toAddr(0x08079c4cL), data);
        MemoryBlock ramData = mem.createInitializedBlock("SRAM_DATA", toAddr(0x20000000L),
            new ByteArrayInputStream(data), data.length, monitor, false);
        ramData.setRead(true);
        ramData.setWrite(true);
        ramData.setExecute(false);
        map("SRAM_ALIGNMENT", 0x20001e0cL, 0x14, false);
        map("SRAM_BSS", 0x20001e20L, 0x1d3c8, false);
        map("SRAM_STACK_SPACE", 0x2001f1e8L, 0xe18, false);
        mem.split(flash, toAddr(0x08079c4cL));
        MemoryBlock load = mem.getBlock(toAddr(0x08079c4cL));
        load.setName("FLASH_DATA_LOAD");
        load.setExecute(false);
        createLabel(toAddr(0x20000000L), "_sdata", true);
        createLabel(toAddr(0x20001e0cL), "_edata", true);
        createLabel(toAddr(0x20001e20L), "_sbss", true);
        createLabel(toAddr(0x2001f1e8L), "_ebss", true);
        createLabel(toAddr(0x08079c4cL), "_sidata", true);

        // Address windows are analysis aids; they do not assert all registers are used.
        map("APB1_MMIO", 0x40000000L, 0x8000, true);
        map("APB2_MMIO", 0x40010000L, 0x8000, true);
        map("AHB1_MMIO", 0x40020000L, 0x8000, true);
        map("USB_OTG_FS_MMIO", 0x50000000L, 0x40000, true);
        map("CORTEX_M_SYSTEM", 0xe000e000L, 0x2000, true);

        for (String line : Files.readAllLines(Path.of(args[1]))) {
            if (line.startsWith("address\t") || line.isBlank()) continue;
            String[] fields = line.split("\t");
            Address a = toAddr(Long.decode(fields[0]));
            if (mem.contains(a)) createLabel(a, fields[1], true);
        }

        createLabel(toAddr(0x08000000L), "g_pfnVectors", true);
        for (String line : Files.readAllLines(Path.of(args[0]))) {
            if (line.startsWith("index\t") || line.isBlank()) continue;
            String[] fields = line.split("\t");
            int index = Integer.parseInt(fields[0]);
            Address slot = toAddr(0x08000000L + index * 4L);
            long value = Long.decode(fields[2]);
            createData(slot, DWordDataType.dataType);
            if (index == 0 || value == 0) continue;
            Address target = toAddr(value & ~1L);
            currentProgram.getReferenceManager().addMemoryReference(
                slot, target, RefType.DATA, SourceType.USER_DEFINED, 0);
            createLabel(slot, "vector_" + fields[3], false);
            if (getFunctionAt(target) == null) {
                entry(value & ~1L, value == 0x080653f1L ? "Default_Handler" : fields[3]);
            }
        }
        // Verified by BL destinations in Reset_Handler, not recovered debug symbols.
        entry(0x080653f4L, "SystemInit");
        entry(0x0806ee4cL, "libc_init_array");
        entry(0x08001168L, "main");
        // libc_init_array calls these indirectly; the generic analyzer does not
        // reliably turn their pointers into functions in a raw binary import.
        for (int i = 0; i < 79; i++) {
            long pointer = Integer.toUnsignedLong(mem.getInt(toAddr(0x08079b0cL + i * 4L)));
            entry(pointer & ~1L, String.format("static_init_%02d", i));
        }
        long[] taskEntries = {0x0801f61cL, 0x0802b154L, 0x08001f38L,
            0x0802655cL, 0x08004000L, 0x08033450L};
        String[] taskNames = {"task_main", "task_storage", "task_tick",
            "task_serial", "task_i2c", "task_usb"};
        for (int i = 0; i < taskEntries.length; i++) entry(taskEntries[i], taskNames[i]);
        // 14 C++ vtables, each with two zero header words and four Thumb methods.
        // The first two methods are reset/advance for the play-order generators.
        for (int table = 0; table < 14; table++) {
            long start = 0x08070a9cL + table * 24L;
            if (mem.getInt(toAddr(start)) != 0 || mem.getInt(toAddr(start + 4)) != 0)
                throw new IllegalStateException("Unexpected play-order vtable header");
            for (int slot = 0; slot < 4; slot++) {
                long pointer = Integer.toUnsignedLong(mem.getInt(toAddr(start + 8 + slot * 4L)));
                if ((pointer & 1) == 0) throw new IllegalStateException("Non-Thumb vtable method");
                Address target = toAddr(pointer & ~1L);
                if (getFunctionAt(target) == null)
                    entry(pointer & ~1L, "FUN_" + target);
            }
        }
        println("Metropolix: Thumb entry points, SRAM and STM32F411 register labels installed.");
    }
}
