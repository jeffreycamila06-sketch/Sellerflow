// BUYER 4-DIGIT FIT contract (2026-07-22). The sticker Buyer line is TWO
// fixed-position TEXT commands — "Buyer" at x=16 and the BARE number (no "#")
// at x=280 (= 16 + 5 chars × 48 dots + a 24-dot gap) — so a 4-digit buyer
// number ends at 280 + 4×48 = 472 ≤ 480 (the 60x40 wDots) and fits COMPLETELY
// on the smallest label. Pins:
//   (a) behavioral, TS reference: exactly two commands, exact x, shared ym/y,
//       no "#", across sizes / numbers / scale levels;
//   (b) source contracts on the Java and Swift mirrors (CI cannot compile
//       them — same pattern as iosCjkEncoding.contract.test.ts): the split
//       line present, the old single-command ",\"Buyer #" form absent. The
//       pure-emoji NAME fallback string "Buyer #N" is a DIFFERENT element and
//       deliberately stays (it is a name value, not the buyer header).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTsplStickerReference } from "./tsplReference";

const REPO = join(__dirname, "../../..");
const ascii = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);
const build = (num: number, w: number, h: number, scale = 1) =>
  ascii(buildTsplStickerReference({
    storeName: "Shop", sessionDate: "07/22/2026", currency: "NT$",
    buyer: { num, name: "Ann", handle: "annc", totalSpent: 0, orders: [] },
    settings: { printBuyerNumberScale: scale },
  }, w, h));

describe("(a) TS reference — split Buyer line, exact positions, 4-digit fit", () => {
  it("two TEXT commands, same y and ym, bare number at x=280, no '#', across sizes and numbers", () => {
    for (const [w, h] of [[100, 60], [80, 60], [80, 50], [70, 50], [60, 40]] as const) {
      for (const num of [1, 88, 103, 1002]) {
        const out = build(num, w, h);
        const label = out.match(/TEXT 16,(\d+),"4",0,2,(\d+),"Buyer"\r\n/);
        expect(label, `label cmd ${w}x${h} #${num}`).not.toBeNull();
        const numberCmd = out.match(/TEXT 280,(\d+),"4",0,2,(\d+),"(\d+)"\r\n/);
        expect(numberCmd, `number cmd ${w}x${h} #${num}`).not.toBeNull();
        expect(numberCmd![1]).toBe(label![1]); // same y
        expect(numberCmd![2]).toBe(label![2]); // same ym
        expect(numberCmd![3]).toBe(String(num)); // bare number, no '#'
        expect(out).not.toContain('"Buyer #'); // old single-command form gone
      }
    }
  });
  it("both commands share ym at every scale level (height-only scaling intact)", () => {
    for (const scale of [1, 2, 3]) {
      const out = build(1002, 60, 40, scale);
      const ymLabel = out.match(/TEXT 16,\d+,"4",0,2,(\d+),"Buyer"/)![1];
      const ymNum = out.match(/TEXT 280,\d+,"4",0,2,(\d+),"1002"/)![1];
      expect(ymNum).toBe(ymLabel);
      expect(Number(ymLabel)).toBe(Math.min(8, 1 * scale)); // 60x40 buyerNumYMul=1
    }
  });
  it("4-digit geometry: number ends at 472 ≤ 480 (60x40 width)", () => {
    // x=280 + 4 digits × 24 dots/char × 2 (width pin) = 472; label = 480 dots.
    expect(280 + 4 * 24 * 2).toBeLessThanOrEqual(480);
  });
});

describe("(b) source contracts — Java and Swift mirrors carry the same split", () => {
  const java = readFileSync(join(REPO, "mobile/android/app/src/main/java/com/sellerflow/live/TsplBuilder.java"), "utf-8");
  const swift = readFileSync(join(REPO, "mobile/ios/App/App/SellerFlowPrinterPlugin.swift"), "utf-8");
  it("Java: split present, old TSPL single-command form absent, name fallback untouched", () => {
    expect(java).toContain('",\\"Buyer\\"");');
    expect(java).toContain('"TEXT 280," + y + ",\\"4\\",0,2," + ym + ",\\"" + buyerNum + "\\"");');
    expect(java).not.toContain(',\\"Buyer #');            // old TEXT form (comma-quote prefix = inside a TSPL command)
    expect(java).toContain('"Buyer #" + buyerNum;');      // pure-emoji NAME fallback stays (different element)
  });
  it("Swift: split present, old TSPL single-command form absent, ESC/POS slip untouched", () => {
    expect(swift).toContain('writeAscii("TEXT 16,\\(y),\\"4\\",0,2,\\(ym),\\"Buyer\\"")');
    expect(swift).toContain('writeAscii("TEXT 280,\\(y),\\"4\\",0,2,\\(ym),\\"\\(buyerNum)\\"")');
    expect(swift).not.toContain(',\\"Buyer #');           // old TSPL TEXT form gone
    expect(swift).toContain('text("Buyer #\\(buyerNum)")'); // ESC/POS receipt slip line stays (different printer/format)
  });
});
