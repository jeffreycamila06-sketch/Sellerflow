// Animated UI system — Slice 1 CONTRACT tests. The redesign.css text is the
// canonical source; these pin the load-bearing invariants so a future edit can't
// silently (a) make a loop un-killable, (b) reintroduce a GPU-expensive property
// on the app-shell loop path, or (c) accidentally gate the one-shot entrances.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildT } from "../i18n";

// The 7 canonical language codes (VALID_LANGS is module-private).
const LANGS_ALL = ["en", "fil", "zh", "zh-TW", "vi", "th", "id"] as const;

// Strip /* … */ comments so assertions test the actual CSS rules, not the
// explanatory prose in the banner (which names properties like background-position).
const css = readFileSync(resolve(__dirname, "..", "redesign.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

// The looping animation classes that MUST be disableable.
const LOOP_CLASSES = ["sfl-anim-beat", "sfl-anim-float", "sfl-anim-dot", "sfl-anim-glow", "sfl-anim-live", "sfl-anim-sheen"];
// One-shot entrances that must STAY (never gated by the kill switch).
const ONESHOT_CLASSES = ["sfl-anim-screen", "sfl-anim-stagger", "sfl-anim-sheet"];

describe("anim system — kill switch [data-motion=off]", () => {
  const killBlock = css.slice(css.indexOf('[data-motion="off"]'));
  it("every loop class is disabled by [data-motion=off]", () => {
    for (const c of LOOP_CLASSES) expect(killBlock).toContain(`[data-motion="off"] .${c}`);
  });
  it("the kill switch uses animation:none !important (inline styles can't be overridden otherwise)", () => {
    expect(killBlock.slice(0, killBlock.indexOf("}") + 1)).toMatch(/animation:\s*none\s*!important/);
  });
  it("does NOT gate the one-shot entrances (they are not motion-sickness loops)", () => {
    const killSelectorArea = css.slice(css.indexOf('[data-motion="off"]'), css.indexOf('@media (prefers-reduced-motion'));
    for (const c of ONESHOT_CLASSES) expect(killSelectorArea).not.toContain(`[data-motion="off"] .${c}`);
  });
});

describe("anim system — prefers-reduced-motion", () => {
  const rm = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  it("has a reduced-motion block covering the loop classes", () => {
    for (const c of LOOP_CLASSES) expect(rm).toContain(`.${c}`);
  });
  it("keeps content visible under reduced motion (stagger children forced opacity/transform reset)", () => {
    expect(rm).toMatch(/\.sfl-anim-stagger\s*>\s*\*\s*\{[^}]*opacity:\s*1/);
  });
});

describe("anim system — GPU-friendly by construction", () => {
  // Isolate the Slice-1 section (first new keyframe → the [data-redesign] base block).
  const start = css.indexOf("@keyframes sflScreenIn");
  const section = css.slice(start, css.indexOf("[data-redesign] {", start));

  it("no LOOP animates background-position or filter:blur on the app-shell path", () => {
    // sflSheen must be transform-based, not background-position; no blur keyframes here.
    expect(section).not.toMatch(/background-position/);
    expect(section).not.toMatch(/filter:\s*blur/);
  });
  it("the LIVE ring is a scaling ::after (transform/opacity), NOT an animated box-shadow", () => {
    // The ring keyframe animates transform+opacity only...
    const ring = section.slice(section.indexOf("@keyframes sflRingPulse"), section.indexOf("}", section.indexOf("@keyframes sflRingPulse")) + 1);
    expect(ring).toMatch(/transform:\s*scale/);
    expect(ring).not.toMatch(/box-shadow/); // box-shadow, if present, is STATIC on ::after — never inside the keyframe
    // ...and the ::after carries a STATIC box-shadow (defined once, not animated).
    expect(section).toMatch(/\.sfl-anim-live::after\s*\{[^}]*box-shadow[^}]*animation:\s*sflRingPulse/);
  });
  it("the sheen is a translating transform, not background-position", () => {
    const sheen = section.slice(section.indexOf("@keyframes sflSheen"), section.indexOf("}", section.indexOf("@keyframes sflSheen")) + 1);
    expect(sheen).toMatch(/transform:\s*translateX/);
  });
});

describe("anim system — i18n motion toggle keys ×7", () => {
  it("rd_set_motion + rd_set_motion_desc exist in all languages, non-empty", () => {
    for (const key of ["rd_set_motion", "rd_set_motion_desc"]) {
      for (const lang of LANGS_ALL) {
        const t = buildT(lang) as Record<string, string>;
        expect(typeof t[key]).toBe("string");
        expect(t[key].trim().length).toBeGreaterThan(0);
      }
    }
  });
});
