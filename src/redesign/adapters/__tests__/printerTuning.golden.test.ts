// PRINTER TUNING — "no tuning = today's bytes". For every printer family the app prints to, what the
// printer RECEIVES (the bridge argument, hashed) with NO tuning loaded must equal what main printed
// before the tuning code existed. The hashes in fixtures/printerTuningGoldens.main.json were taken on
// the branch's first commit (= main 5e5689b0 + sql files only, no print code changed) with
//   SFL_TUNING_GOLDEN=<file> npx vitest run printerTuning.golden
// Re-take them ONLY when the sticker changes on purpose (and say so in the commit).
// Covered: today's sticker (printSlip) and the new sticker's Printer Test (printOneStickerTest) on
//   AIMO D520 picture · AIMO D520 text (old app) · built-in XP-420B (TSPL, density 15) · approved TSPL
//   (AE241-BT) · approved TSPL with shift + flip (CT221B) · approved ESC/POS (PT210L) · generic
//   ESC/POS · generic CPCL · Niimbot B21 — 60×40 + 100×60 (Niimbot 50×30), a Latin and a Chinese buyer.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { FAMS, BUYERS, GOLDEN_FILE, sizesFor, handed, todayPrint, newPrint, sha, beforeGolden, afterGolden } from "./printerTuning.harness";

const DUMP = process.env.SFL_TUNING_GOLDEN || "";
const got: Record<string, string> = {};
const main: Record<string, string> = !DUMP && existsSync(GOLDEN_FILE) ? JSON.parse(readFileSync(GOLDEN_FILE, "utf8")).hashes : {};
beforeAll(beforeGolden);
afterAll(() => {
  afterGolden();
  if (DUMP) writeFileSync(DUMP, JSON.stringify({ _note: "sha256 of what each printer received, NO tuning — taken on main 5e5689b0 (+ sql only). printerTuning.golden.test.ts", hashes: got }, null, 1) + "\n");
});

describe("no tuning = the bytes main printed (every printer family)", () => {
  it("the golden list covers every case (none missing)", () => {
    if (DUMP) return;
    const want = FAMS.flatMap((f) => sizesFor(f).flatMap(([w, h]) => ["latin", "cjk"].flatMap((b) => ["today", "new"].map((k) => `${k}|${f}|${w}x${h}|${b}`))));
    expect(Object.keys(main).sort()).toEqual(want.sort());
  });
  for (const f of FAMS) for (const [w, h] of sizesFor(f)) for (const b of ["latin", "cjk"] as const) for (const kind of ["today", "new"] as const) {
    const key = `${kind}|${f}|${w}x${h}|${b}`;
    it(key, async () => {
      const r = await handed(f, (kind === "today" ? todayPrint : newPrint)(f, w, h, BUYERS[b]()));
      const hash = `${r.fn}:${sha(r.arg)}`;
      got[key] = hash;
      if (!DUMP) expect(hash).toBe(main[key]);
    }, 60000);
  }
});
