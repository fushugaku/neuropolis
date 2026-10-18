import { writeFile, mkdir, readFile } from "node:fs/promises";
import {
  TRACK_KEYS,
  STEP_KEYS,
  MOD_KEYS,
  TRACK_RANGES,
  STEP_RANGES,
  MOD_RANGES,
  freshSession,
} from "../web/model.js";
await mkdir("plugin/generated", { recursive: true });
const session = freshSession();
const header =
  "#pragma once\n#include <array>\n" +
  Object.entries({
    trackKeys: TRACK_KEYS,
    stepKeys: STEP_KEYS,
    modKeys: MOD_KEYS,
  })
    .map(
      ([name, keys]) =>
        `inline constexpr std::array<const char*, ${keys.length}> ${name} = {${keys.map((k) => JSON.stringify(k)).join(",")}};`,
    )
    .join("\n") +
  "\n" +
  Object.entries({
    trackRanges: TRACK_RANGES.map((range, i) => (i === 3 ? [1, 66] : range)),
    stepRanges: STEP_RANGES,
    modRanges: MOD_RANGES,
  })
    .map(
      ([name, values]) =>
        `inline constexpr std::array<std::array<int,2>,${values.length}> ${name} = {{${values.map((v) => `{${v.join(",")}}`).join(",")}}};`,
    )
    .join("\n") +
  "\n";
await writeFile("plugin/generated/Model.h", header);

await writeFile("plugin/generated/initial.json", JSON.stringify(session));
