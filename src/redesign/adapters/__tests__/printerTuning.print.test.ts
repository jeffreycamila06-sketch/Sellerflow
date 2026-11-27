// PRINTER TUNING on the print path (sql/230 → printerTuning.ts → printing.ts generic picture path).
//  · no tuning / a failed read / a built-in printer / AIMO D520 / Niimbot / the native text sticker → the
//    bytes main printed (the golden list of printerTuning.golden.test.ts);
//  · a tuned Admin-approved TSPL printer → ONLY the expected header lines change (the picture bands are
//    byte-identical when the tuning has no shift / flip), and every tuned job passes the job guard;
//  · ESC/POS / CPCL: density / media mean nothing there → bytes unchanged; shift / flip move the picture.
// TUNING_DIFF=<file> writes the header diffs (for the report).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { FAMS, BUYERS, GOLDEN_FILE, SAVED, sizesFor, handed, todayPrint, newPrint, sha, beforeGolden, afterGolden, type Fam } from "./printerTuning.harness";
import { setMyPrinterTuning, parseTuning, parseMyTuning, tunedTsplJob, tunedLayout, tuningFor, loadMyPrinterTuning, __resetPrinterTuning, NO_TUNING, type PrinterTuning } from "../printerTuning";
import { tsplMediaLine } from "../stickerRaster";
import { shiftRasterLeft, shiftRasterRight, applyApprovedLayout, NO_LAYOUT } from "../rasterShift";
import { tsplCommands, checkTsplJob, checkEscposJob, checkCpclJob } from "../stickerJobGuard";
import { decodeEscpos, decodeTsplBands } from "./oneSticker.decode";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc } }));

const MAIN: Record<string, string> = JSON.parse(readFileSync(GOLDEN_FILE, "utf8")).hashes;
const OUT = process.env.TUNING_DIFF || "";
const diffs: string[] = [];
// a tuning is made for ONE printer (sql/230 printer_name): `forName` = the saved printer it was made for
const tune = (t: PrinterTuning | null, forName = "") => setMyPrinterTuning(t ? { enabled: true, tester: true, tuning: t, version: 3, printerName: forName } : null);
const bytesOf = (arg: string) => Uint8Array.from(Buffer.from((JSON.parse(arg) as { data: string }).data, "base64"));
const head = (b: Uint8Array) => tsplCommands(b).cmds.filter((c) => !c.startsWith("BITMAP") && c !== "PRINT 1");
const bandsOf = (b: Uint8Array) => { const s = Buffer.from(b).toString("latin1"); return s.slice(s.indexOf("BITMAP")); };

beforeAll(beforeGolden);
afterEach(() => { __resetPrinterTuning(); rpc.mockReset(); });
afterAll(() => { afterGolden(); if (OUT) writeFileSync(OUT, diffs.join("\n") + "\n"); });

describe("pure parts", () => {
  it("parseTuning clamps + rounds like the database; junk is dropped; nothing usable = null", () => {
    expect(parseTuning({ gap_mm: 9.3, shift_mm: -7, density: 22, speed: 0, flip: true, sensor: "bline", send_speed: "slow" }))
      .toEqual({ gapMm: 6, shiftMm: -5, density: 15, speed: 1, flip: true, sensor: "bline", sendSpeed: "slow" });
    expect(parseTuning({ gap_mm: 2.74, shift_mm: 1.26, density: 7.6 })).toEqual({ gapMm: 2.5, shiftMm: 1.5, density: 8 });
    for (const bad of [null, [], "x", {}, { color: "red" }, { gap_mm: "3" }, { flip: "yes" }, { sensor: "laser" }]) expect(parseTuning(bad)).toBeNull();
  });
  it("parseMyTuning: the version only with settings; anything odd = no tuning", () => {
    expect(parseMyTuning({ enabled: false, tester: true, settings: { density: 12 }, version: 4, printer_name: " AE241-BT_C11D-LE " })).toEqual({ enabled: false, tester: true, tuning: { density: 12 }, version: 4, printerName: "AE241-BT_C11D-LE" });
    expect(parseMyTuning({ enabled: false, tester: true, settings: { density: 12 }, version: 4 })).toEqual({ enabled: false, tester: true, tuning: { density: 12 }, version: 4, printerName: null });
    expect(parseMyTuning({ enabled: true, tester: false, settings: null, version: null, printer_name: "X" })).toEqual({ enabled: true, tester: false, tuning: null, version: null, printerName: null });
    expect(parseMyTuning(null)).toEqual(NO_TUNING);
  });
  it("no tuning → the SAME job / layout objects (that is what keeps today's bytes)", () => {
    const job = { density: 15 }, layout = { flip: true, shiftDots: 16 };
    expect(tunedTsplJob(job, null)).toBe(job);
    expect(tunedLayout(layout, null)).toBe(layout);
    expect(tunedTsplJob(job, { flip: true })).toBe(job);                 // nothing for TSPL's header in it
    expect(tunedLayout(layout, { density: 3 })).toBe(layout);           // nothing for the layout in it
    expect(tunedTsplJob({ density: 15, bold: true }, { density: 6, sensor: "bline" })).toEqual({ density: 6, bold: true, media: { sensor: "bline", mm: 2 } });
    expect(tunedLayout({ flip: true, shiftDots: 16 }, { shiftMm: -2.5 })).toEqual({ flip: true, shiftDots: -20 });
    expect(tunedLayout(NO_LAYOUT, { flip: true })).toEqual({ flip: true, shiftDots: 0 });
  });
  it("the media line", () => {
    expect(tsplMediaLine(undefined)).toBe("GAP 2 mm, 0");
    expect(tsplMediaLine({ sensor: "gap", mm: 3 })).toBe("GAP 3 mm, 0");
    expect(tsplMediaLine({ sensor: "gap", mm: 2.5 })).toBe("GAP 2.5 mm, 0");
    expect(tsplMediaLine({ sensor: "bline", mm: 4 })).toBe("BLINE 4 mm, 0");
    expect(tsplMediaLine({ sensor: "continuous", mm: 3 })).toBe("GAP 0 mm, 0");
    expect(tsplMediaLine({ sensor: "gap", mm: 99 })).toBe("GAP 6 mm, 0");
  });
  it("shift right is the mirror of shift left; a negative layout shift moves right", () => {
    const r = { w: 16, h: 1, rowBytes: 2, buf: new Uint8Array([0b00110000, 0b00000001]) };
    expect(Array.from(shiftRasterRight(r, 2).buf)).toEqual([0b00001100, 0b00000000]);
    expect(Array.from(shiftRasterLeft(shiftRasterRight(r, 2), 2).buf)).toEqual([0b00110000, 0b00000000]);
    expect(Array.from(applyApprovedLayout(r, { flip: false, shiftDots: -2 }).buf)).toEqual(Array.from(shiftRasterRight(r, 2).buf));
    expect(applyApprovedLayout(r, NO_LAYOUT)).toBe(r);
  });
  it("built-in names are never tuned (D520BT, Y41BT, XP-420B, Niimbot B1 / B1 Pro…)", () => {
    for (const n of ["D520BT-Z", "Y41BT-0FC4_LE", "XP-420B", "B1-I603042141", "B1 Pro-I616030055", "B21-C123", ""]) { tune({ density: 3 }, n); expect(tuningFor(n)).toBeNull(); }
    tune({ density: 3 }, "AE241-BT_C11D-LE");
    expect(tuningFor("AE241-BT_C11D-LE")).toEqual({ density: 3 });
    expect(tuningFor(" ae241-bt_c11d-le ")).toEqual({ density: 3 });       // the same printer name, any case
  });
  it("a tuning applies ONLY to the printer it was made for", () => {
    tune({ density: 3 }, "AE241-BT_C11D-LE");
    for (const n of ["AE241-BT_B57A-LE", "CT221B-D4F8", "AE241-BT", "GEN-1"]) expect(tuningFor(n)).toBeNull();
    tune({ density: 3 }, "");                                                 // made for no printer → nowhere
    expect(tuningFor("AE241-BT_C11D-LE")).toBeNull();
  });
});

describe("the session read fails safe", () => {
  it("an error answer / a throw / odd data → no tuning, and the printer gets main's bytes", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "boom" } });
    expect(await loadMyPrinterTuning("u1")).toEqual(NO_TUNING);
    __resetPrinterTuning();
    rpc.mockRejectedValueOnce(new Error("offline"));
    expect(await loadMyPrinterTuning("u2")).toEqual(NO_TUNING);
    __resetPrinterTuning();
    rpc.mockResolvedValueOnce({ data: "nonsense", error: null });
    const v = await loadMyPrinterTuning("u3");
    expect(v).toEqual(NO_TUNING); setMyPrinterTuning(v);
    const r = await handed("ae241", todayPrint("ae241", 60, 40, BUYERS.latin()));
    expect(`${r.fn}:${sha(r.arg)}`).toBe(MAIN["today|ae241|60x40|latin"]);
  });
  it("one read per user; a second user reads again", async () => {
    rpc.mockResolvedValue({ data: { enabled: false, tester: true, settings: { density: 9 }, version: 2 }, error: null });
    await loadMyPrinterTuning("u1"); await loadMyPrinterTuning("u1");
    expect(rpc).toHaveBeenCalledTimes(1);
    await loadMyPrinterTuning("u2");
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenCalledWith("my_printer_tuning");
  });
});

// A tuning with every TSPL knob — on a printer it must NOT touch, the bytes stay main's.
const EVERYTHING: PrinterTuning = { gapMm: 3, sensor: "bline", density: 4, speed: 2, shiftMm: -2, flip: true, sendSpeed: "slow" };
const UNTOUCHED: Fam[] = ["d520", "d520text", "xp420b", "niimbot"];
describe("printers the tuning never touches: main's bytes even with a tuning loaded", () => {
  for (const f of UNTOUCHED) for (const [w, h] of sizesFor(f)) for (const kind of ["today", "new"] as const) {
    it(`${kind} · ${f} · ${w}×${h}`, async () => {
      tune(EVERYTHING, SAVED[f].name);                                       // even made for this very name
      const r = await handed(f, (kind === "today" ? todayPrint : newPrint)(f, w, h, BUYERS.latin()));
      expect(`${r.fn}:${sha(r.arg)}`).toBe(MAIN[`${kind}|${f}|${w}x${h}|latin`]);
    }, 60000);
  }
});

describe("a tuned approved TSPL printer: only the header lines change", () => {
  const CASES: [string, PrinterTuning, string[]][] = [
    ["gap 3 mm", { gapMm: 3 }, ["GAP 3 mm, 0"]],
    ["black mark 4 mm", { sensor: "bline", gapMm: 4 }, ["BLINE 4 mm, 0"]],
    ["continuous", { sensor: "continuous" }, ["GAP 0 mm, 0"]],
    ["density 12 + speed 2", { density: 12, speed: 2 }, ["SPEED 2", "DENSITY 12"]],
  ];
  for (const f of ["ae241", "ct221b"] as Fam[]) for (const [w, h] of sizesFor(f)) for (const kind of ["today", "new"] as const) for (const [label, t, want] of CASES) {
    it(`${kind} · ${f} · ${w}×${h} · ${label}`, async () => {
      const go = (kind === "today" ? todayPrint : newPrint)(f, w, h, BUYERS.latin());
      tune(null);
      const before = bytesOf((await handed(f, go)).arg);
      tune(t, SAVED[f].name);
      const after = bytesOf((await handed(f, go)).arg);
      expect(bandsOf(after)).toBe(bandsOf(before));                              // the picture: byte for byte
      const a = head(before), b = head(after);
      const gone = a.filter((x) => !b.includes(x)), added = b.filter((x) => !a.includes(x));
      expect(added).toEqual(want);
      expect(gone.every((x) => /^(GAP|BLINE|SPEED|DENSITY) /.test(x))).toBe(true);
      expect(checkTsplJob(after, w, h)).toEqual([]);
      diffs.push(`${kind} · ${f} · ${w}x${h} · ${label}\n  main : ${a.join(" | ")}\n  tuned: ${b.join(" | ")}`);
    }, 60000);
  }
});

describe("shift / flip on TSPL and ESC/POS: the picture moves, the job stays valid", () => {
  for (const f of ["ae241", "pt210l", "escpos", "cpcl"] as Fam[]) {
    it(`${f} · 60×40 · shift right 2 mm + flip`, async () => {
      const go = todayPrint(f, 60, 40, BUYERS.latin());
      tune(null); const before = bytesOf((await handed(f, go)).arg);
      tune({ shiftMm: -2, flip: true }, SAVED[f].name); const after = bytesOf((await handed(f, go)).arg);
      expect(Buffer.from(after).equals(Buffer.from(before))).toBe(false);
      if (f === "ae241") {
        expect(checkTsplJob(after, 60, 40)).toEqual([]);
        const r0 = decodeTsplBands(before, 480, 320), r1 = decodeTsplBands(after, 480, 320);
        // tuned = flip, then move right 16 dots. Turning it back gives today's picture moved LEFT 16 dots.
        const back = applyApprovedLayout(r1, { flip: true, shiftDots: 0 });
        const want = shiftRasterLeft(r0, 16);
        expect(Buffer.from(back.buf).equals(Buffer.from(want.buf))).toBe(true);
      } else if (f === "cpcl") expect(checkCpclJob(after, 60, 40)).toEqual([]);
      else { expect(checkEscposJob(after, 60, 40)).toEqual([]); expect(decodeEscpos(after).w).toBe(decodeEscpos(before).w); }
    }, 60000);
  }
  for (const f of ["pt210l", "escpos", "cpcl"] as Fam[]) {
    it(`${f}: density / speed / media mean nothing there → main's bytes`, async () => {
      tune({ density: 3, speed: 1, sensor: "bline", gapMm: 5 }, SAVED[f].name);
      const r = await handed(f, todayPrint(f, 60, 40, BUYERS.latin()));
      expect(`${r.fn}:${sha(r.arg)}`).toBe(MAIN[`today|${f}|60x40|latin`]);
    }, 60000);
  }
});

describe("the seller saves ANOTHER printer later → it prints as today (the tuning stays with its printer)", () => {
  for (const f of ["ae241", "ct221b", "pt210l", "escpos", "cpcl"] as Fam[]) it(f, async () => {
    tune(EVERYTHING, "SOME-OTHER-PRINTER_01");
    const r = await handed(f, todayPrint(f, 60, 40, BUYERS.latin()));
    expect(`${r.fn}:${sha(r.arg)}`).toBe(MAIN[`today|${f}|60x40|latin`]);
  }, 60000);
});

it("every family still has a golden (the list did not shrink)", () => { expect(FAMS).toHaveLength(9); });
