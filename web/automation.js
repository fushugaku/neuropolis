import { TRACK_KEYS, STEP_KEYS, MOD_KEYS } from "./model.js";

export const AUTOMATION_LANES = 32;
export function pluginState(session) {
  session.plugin ||= {};
  session.plugin.chainEnabled = !!session.plugin.chainEnabled;
  const old = session.plugin.automation || [];
  session.plugin.automation = Array.from(
    { length: AUTOMATION_LANES },
    (_, i) => (typeof old[i] === "string" ? old[i] : ""),
  );
  return session.plugin;
}
export function canAutomate(path) {
  const p = path.split(".");
  if (p[0] === "tracks")
    return p.length === 3
      ? TRACK_KEYS.includes(p[2])
      : p.length === 5 && p[2] === "steps" && STEP_KEYS.includes(p[4]);
  if (p[0] === "mods")
    return p.length === 3
      ? MOD_KEYS.includes(p[2])
      : p.length === 5 &&
          p[2] === "steps" &&
          ["value", "ramp", "gate"].includes(p[4]);
  if (["controls", "aux"].includes(p[0]))
    return (
      p.length === 3 &&
      ["destination", "target", "value", "amount"].includes(p[2])
    );
  if (p[0] === "outputs")
    return p.length === 3 && ["kind", "source"].includes(p[2]);
  if (p[0] === "userScales")
    return p.length === 3 && ["mask", "root"].includes(p[2]);
  return [
    "totalPulses",
    "settings.outputDivision",
    "settings.outputOffset",
    "settings.loadMode",
    "settings.queuePulses",
    "settings.pitchLoad",
    "settings.switchLoad",
    "settings.ctrlLoad",
    "settings.auxLoad",
    "mx.mode",
    "mx.source",
    "mx.bank",
    "mx.channel",
    "mx.message",
    "loopy.pulses",
    "loopy.target",
  ].includes(path);
}
export function automationLabel(path) {
  if (!path) return "Unassigned";
  const p = path.split("."),
    words = (s) => s.replace(/([a-z])([A-Z])/g, "$1 $2");
  const family = {
    tracks: "Track",
    mods: "MOD",
    controls: "CTRL",
    aux: "AUX",
    outputs: "Output",
    userScales: "User scale",
  };
  if (family[p[0]])
    return `${family[p[0]]} ${+p[1] + 1}${p[2] === "steps" ? ` · Stage ${+p[3] + 1}` : ""} · ${words(p.at(-1))}`;
  return path === "totalPulses"
    ? "Reset after"
    : `${p[0] === "mx" ? "MX" : p[0]} · ${words(p.at(-1))}`;
}
