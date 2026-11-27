// Admin Printer Tuning — the QUICK-FIX CHIPS. ONE file, one entry per chip: what the seller says is wrong
// → the change it proposes on top of the seller's CURRENT tuning (`cur`). The panel shows the proposal
// field by field and nothing is saved until "Save for this seller". Values are clamped like the database.
// `model` = what today's printing uses when a field is not tuned (the approved row's shift / flip, the
// generic TSPL defaults GAP 2 mm, DENSITY 8, no SPEED line → the printer's own speed, ~4).
import { clampTuningNumber, type PrinterTuning } from "./printerTuning";

export type ChipId = "blank_labels" | "cut_edge" | "upside_down" | "light_dark" | "stops" | "garbled";
export const CHIP_IDS: readonly ChipId[] = ["blank_labels", "cut_edge", "upside_down", "light_dark", "stops", "garbled"];
export interface ModelDefaults { shiftMm: number; flip: boolean; density: number; speed: number; gapMm: number }
export const GENERIC_DEFAULTS: ModelDefaults = { shiftMm: 0, flip: false, density: 8, speed: 4, gapMm: 2 };

export function chipProposal(id: ChipId, cur: PrinterTuning | null, model: ModelDefaults = GENERIC_DEFAULTS, darker = true): PrinterTuning {
  const c: PrinterTuning = { ...(cur ?? {}) };
  switch (id) {
    // Many blank labels: the printer reads the label gap wrong and feeds extra labels. Use the gap sensor
    // and 1 mm more gap than now (2 mm today), and one step slower so it finds the gap reliably.
    case "blank_labels": return { ...c, sensor: "gap", gapMm: clampTuningNumber("gapMm", (c.gapMm ?? model.gapMm) + 1), speed: clampTuningNumber("speed", (c.speed ?? model.speed) - 1) };
    // Cut off at the edge (right side missing): move the sticker 1 mm further LEFT.
    case "cut_edge": return { ...c, shiftMm: clampTuningNumber("shiftMm", (c.shiftMm ?? model.shiftMm) + 1) };
    // Upside down: turn the sticker 180° (the opposite of what it prints now).
    case "upside_down": return { ...c, flip: !(c.flip ?? model.flip) };
    // Too light / too dark: 3 density steps darker (or lighter, the panel's second button).
    case "light_dark": return { ...c, density: clampTuningNumber("density", (c.density ?? model.density) + (darker ? 3 : -3)) };
    // Stops after a few stickers: the printer can't keep up — one speed step slower and slower sending.
    case "stops": return { ...c, speed: clampTuningNumber("speed", (c.speed ?? model.speed) - 1), sendSpeed: "slow" };
    // Garbled print (random dots / broken lines): the data arrives broken — slow sending and speed 2.
    case "garbled": return { ...c, sendSpeed: "slow", speed: Math.min(c.speed ?? model.speed, 2) };
  }
}
