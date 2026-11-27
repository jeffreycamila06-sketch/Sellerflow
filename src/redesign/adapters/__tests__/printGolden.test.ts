// PRINT GOLDENS — for every printer family the app prints to, what the printer RECEIVES (the bridge
// argument, hashed) must equal what main 5e5689b0 printed (before Printer Tuning, which was added in
// merge f8b90114 and removed again). fixtures/printGoldens.main.json was taken on 5e5689b0 with
//   SFL_PRINT_GOLDENS=<file> npx vitest run printGolden
// and checked again on 5e5689b0 itself. Re-take it ONLY when the sticker changes on purpose (say so in the commit).
// Covered: today's sticker (printSlip) and the new sticker's Printer Test (printOneStickerTest) on
//   AIMO D520 picture · AIMO D520 text (old app) · built-in XP-420B (TSPL, density 15) · approved TSPL
//   (AE241-BT) · approved TSPL with shift + flip (CT221B) · approved ESC/POS (PT210L) · generic
//   ESC/POS · generic CPCL · Niimbot B21 — 60×40 + 100×60 (Niimbot 50×30), a Latin and a Chinese buyer.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { FAMS, BUYERS, GOLDEN_FILE, sizesFor, handed, todayPrint, newPrint, sha, beforeGolden, afterGolden } from "./printGolden.harness";

const DUMP = process.env.SFL_PRINT_GOLDENS || "";
const got: Record<string, string> = {};
const main: Record<string, string> = !DUMP && existsSync(GOLDEN_FILE) ? JSON.parse(readFileSync(GOLDEN_FILE, "utf8")).hashes : {};
beforeAll(beforeGolden);
afterAll(() => {
  afterGolden();
  if (DUMP) writeFileSync(DUMP, JSON.stringify({ _note: "sha256 of what each printer received — taken on main 5e5689b0. printGolden.test.ts", hashes: got }, null, 1) + "\n");
});

describe("the bytes main 5e5689b0 printed (every printer family)", () => {
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
