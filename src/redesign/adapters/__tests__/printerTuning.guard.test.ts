// A TUNED job that fails the final job check is never sent: the printer gets the untuned job (= main's
// bytes) instead — on today's sticker and on the new sticker. The guard is made to refuse every BLINE job.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { BUYERS, GOLDEN_FILE, handed, todayPrint, newPrint, sha, beforeGolden, afterGolden } from "./printerTuning.harness";
import { setMyPrinterTuning, __resetPrinterTuning } from "../printerTuning";
import { checkTsplJob } from "../stickerJobGuard";

vi.mock("../stickerJobGuard", async (orig) => {
  const real = await orig<typeof import("../stickerJobGuard")>();
  const refuse = (b: Uint8Array) => Buffer.from(b).toString("latin1").includes("BLINE ");
  return { ...real, checkStickerJob: (k: Parameters<typeof real.checkStickerJob>[0], b: Uint8Array, w: number, h: number) => (refuse(b) ? ["test: refused"] : real.checkStickerJob(k, b, w, h)) };
});
const MAIN: Record<string, string> = JSON.parse(readFileSync(GOLDEN_FILE, "utf8")).hashes;
beforeAll(beforeGolden);
afterEach(() => __resetPrinterTuning());
afterAll(afterGolden);

describe("a tuned job the guard refuses → today's job is sent", () => {
  for (const kind of ["today", "new"] as const) it(kind, async () => {
    setMyPrinterTuning({ enabled: true, tester: true, tuning: { sensor: "bline", gapMm: 3 }, version: 2, printerName: "AE241-BT_C11D-LE" });
    const r = await handed("ae241", (kind === "today" ? todayPrint : newPrint)("ae241", 60, 40, BUYERS.latin()));
    expect(`${r.fn}:${sha(r.arg)}`).toBe(MAIN[`${kind}|ae241|60x40|latin`]);
  }, 60000);
  it("the real guard: one GAP / BLINE line only", () => {
    const job = (lines: string[]) => Uint8Array.from(Buffer.from(["SIZE 60 mm, 40 mm", ...lines, "CLS", "PRINT 1", ""].join("\r\n"), "latin1"));
    expect(checkTsplJob(job(["GAP 2 mm, 0"]), 60, 40)).toEqual([]);
    expect(checkTsplJob(job(["BLINE 3 mm, 0"]), 60, 40)).toEqual([]);
    expect(checkTsplJob(job(["GAP 2 mm, 0", "BLINE 3 mm, 0"]), 60, 40)).toContain("not exactly one GAP / BLINE line");
    expect(checkTsplJob(job([]), 60, 40)).toContain("not exactly one GAP / BLINE line");
  });
});
