// Export reviewable pseudocode, instructions, call edges and string references.
// @category Metropolix
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileOptions;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.InstructionIterator;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Reference;
import java.io.BufferedWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.HashSet;
import java.util.Set;

public class ExportMetropolix extends GhidraScript {
    private BufferedWriter writer(Path path) throws Exception {
        return Files.newBufferedWriter(path, StandardCharsets.UTF_8);
    }
    private String clean(String s) {
        if (s == null) return "";
        s = s.replace('\t', ' ').replace('\n', ' ').replace('\r', ' ');
        return s.contains("\"") ? "\"" + s.replace("\"", "\"\"") + "\"" : s;
    }
    private String readCell(String s) {
        if (s.startsWith("\"") && s.endsWith("\""))
            return s.substring(1, s.length() - 1).replace("\"\"", "\"");
        return s;
    }
    private void xref(BufferedWriter out, String text, Address target, Reference ref, String via) throws Exception {
        Address source = ref.getFromAddress();
        Function f = getFunctionContaining(source);
        out.write(target + "\t" + source + "\t" + (f == null ? "" : f.getEntryPoint()) +
            "\t" + (f == null ? "" : f.getName()) + "\t" + ref.getReferenceType() +
            "\t" + via + "\t" + clean(text) + "\n");
    }

    @Override
    public void run() throws Exception {
        String[] args = getScriptArgs();
        if (args.length != 3) throw new IllegalArgumentException("output-dir ascii-strings.tsv mmio-registers.tsv");
        Path root = Path.of(args[0]);
        Files.createDirectories(root.resolve("functions"));
        DecompInterface dec = new DecompInterface();
        Set<String> emittedFiles = new HashSet<>();
        DecompileOptions options = new DecompileOptions();
        options.grabFromProgram(currentProgram);
        dec.setOptions(options);
        dec.openProgram(currentProgram);
        int count = 0, success = 0;
        long functionBytes = 0;
        try (BufferedWriter all = writer(root.resolve("pseudocode.c"));
             BufferedWriter funcs = writer(root.resolve("functions.tsv"));
             BufferedWriter edges = writer(root.resolve("callgraph.tsv"));
             BufferedWriter failed = writer(root.resolve("decompile-failures.tsv"));
             BufferedWriter asm = writer(root.resolve("disassembly.txt"))) {
            all.write("/* Ghidra-generated pseudocode; NOT original source or buildable C. */\n\n");
            funcs.write("address\tname\tbody_bytes\tdecompiled\tfile\n");
            edges.write("caller_address\tcaller_name\tcallee_address\tcallee_name\n");
            failed.write("address\tname\terror\n");
            FunctionIterator iterator = currentProgram.getFunctionManager().getFunctions(true);
            while (iterator.hasNext() && !monitor.isCancelled()) {
                Function f = iterator.next();
                if (f.isExternal()) continue;
                count++;
                functionBytes += f.getBody().getNumAddresses();
                String filename = f.getEntryPoint() + "_" + f.getName().replaceAll("[^a-zA-Z0-9_.-]", "_") + ".c";
                emittedFiles.add(filename);
                DecompileResults result = dec.decompileFunction(f, 45, monitor);
                boolean ok = result.decompileCompleted() && result.getDecompiledFunction() != null;
                String code;
                if (ok) {
                    success++;
                    code = result.getDecompiledFunction().getC();
                } else {
                    String error = clean(result.getErrorMessage());
                    failed.write(f.getEntryPoint() + "\t" + f.getName() + "\t" + error + "\n");
                    code = "/* Decompilation failed: " + error.replace("*/", "* /") + " */\n";
                }
                String heading = "/* " + f.getEntryPoint() + " : " + f.getName() + " */\n";
                Files.writeString(root.resolve("functions").resolve(filename), heading + code, StandardCharsets.UTF_8);
                all.write(heading + code + "\n\n");
                funcs.write(f.getEntryPoint() + "\t" + f.getName() + "\t" + f.getBody().getNumAddresses() +
                    "\t" + ok + "\tfunctions/" + filename + "\n");
                for (Function callee : f.getCalledFunctions(monitor)) {
                    edges.write(f.getEntryPoint() + "\t" + f.getName() + "\t" +
                        callee.getEntryPoint() + "\t" + callee.getName() + "\n");
                }
                if (count % 250 == 0) println("Exported " + count + " functions");
            }
            InstructionIterator instructions = currentProgram.getListing().getInstructions(true);
            while (instructions.hasNext() && !monitor.isCancelled()) {
                Instruction ins = instructions.next();
                StringBuilder bytes = new StringBuilder();
                for (byte b : ins.getBytes()) bytes.append(String.format("%02x ", b & 0xff));
                asm.write(ins.getAddress() + "  " + String.format("%-12s", bytes) + "  " + ins + "\n");
            }
        } finally {
            dec.dispose();
        }
        // Remove only stale files in this exporter's generated naming scheme.
        try (var files = Files.list(root.resolve("functions"))) {
            for (Path old : files.toList()) {
                String name = old.getFileName().toString();
                if (name.matches("[0-9a-f]{8}_.+\\.c") && !emittedFiles.contains(name))
                    Files.delete(old);
            }
        }
        try (BufferedWriter refs = writer(root.resolve("string-xrefs.tsv"))) {
            refs.write("string_address\treference_address\tfunction_address\tfunction_name\ttype\tvia\ttext\n");
            for (String line : Files.readAllLines(Path.of(args[1]))) {
                if (line.startsWith("file_offset\t") || line.isBlank()) continue;
                String[] fields = line.split("\t", 2);
                Address a = toAddr(0x08000000L + Long.decode(fields[0]));
                for (Reference ref : getReferencesTo(a)) {
                    xref(refs, readCell(fields[1]), a, ref, "direct");
                    if (getInstructionContaining(ref.getFromAddress()) == null) {
                        for (Reference second : getReferencesTo(ref.getFromAddress()))
                            xref(refs, readCell(fields[1]), a, second, "pointer@" + ref.getFromAddress());
                    }
                }
            }
        }
        try (BufferedWriter blocks = writer(root.resolve("memory-map.tsv"))) {
            blocks.write("name\tstart\tend\tinitialized\texecutable\tvolatile\n");
            for (MemoryBlock b : currentProgram.getMemory().getBlocks())
                blocks.write(b.getName() + "\t" + b.getStart() + "\t" + b.getEnd() + "\t" +
                    b.isInitialized() + "\t" + b.isExecute() + "\t" + b.isVolatile() + "\n");
        }
        try (BufferedWriter refs = writer(root.resolve("mmio-xrefs.tsv"))) {
            refs.write("register_address\treference_address\tfunction_address\tfunction_name\ttype\tvia\tregister_name\n");
            Set<Address> seen = new HashSet<>();
            for (String line : Files.readAllLines(Path.of(args[2]))) {
                if (line.startsWith("address\t") || line.isBlank()) continue;
                String[] fields = line.split("\t");
                Address a = toAddr(Long.decode(fields[0]));
                if (!seen.add(a)) continue;
                for (Reference ref : getReferencesTo(a)) {
                    xref(refs, fields[1], a, ref, "direct");
                    if (getInstructionContaining(ref.getFromAddress()) == null) {
                        for (Reference second : getReferencesTo(ref.getFromAddress()))
                            xref(refs, fields[1], a, second, "pointer@" + ref.getFromAddress());
                    }
                }
            }
        }
        String json = "{\n  \"functions\": " + count + ",\n  \"decompiled\": " + success +
            ",\n  \"failed\": " + (count - success) + ",\n  \"function_body_bytes_sum\": " + functionBytes +
            ",\n  \"instruction_count\": " + currentProgram.getListing().getNumInstructions() +
            ",\n  \"language\": \"" + currentProgram.getLanguageID() + "\"\n}\n";
        Files.writeString(root.resolve("summary.json"), json, StandardCharsets.UTF_8);
        println("Metropolix export complete: " + success + "/" + count + " functions decompiled.");
    }
}
