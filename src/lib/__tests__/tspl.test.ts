// Byte-for-byte parity: the TS reference TSPL builder vs the Android golden
// fixtures generated from the UNMODIFIED production TsplBuilder.java
// (mobile/ios/tspl-parity/run.sh). Because the iOS Swift buildTsplSticker is a
// line-for-line port of the same algorithm, locking TS == Java here pins the
// exact byte contract the iOS XCTest (MobileTsplBuilderTests.swift) also
// asserts against the same golden/<name>.bin files.
//
// Regenerate golden after any TsplBuilder.java change: bash
// mobile/ios/tspl-parity/run.sh
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTsplStickerReference, type RefPayload } from "./tsplReference";
import { buildGbkEncoder } from "./gbk";

// vitest runs from the repo root; golden fixtures live under mobile/ios/.
const PARITY_DIR = join(process.cwd(), "mobile/ios/tspl-parity") + "/";

interface Manifest {
  labelWidthMm: number;
  labelHeightMm: number;
  fixtures: string[];
}

const manifest: Manifest = JSON.parse(readFileSync(`${PARITY_DIR}manifest.json`, "utf8"));
const readPayload = (name: string): RefPayload =>
  JSON.parse(readFileSync(`${PARITY_DIR}payloads/${name}.json`, "utf8"));
const readGolden = (name: string): Uint8Array =>
  new Uint8Array(readFileSync(`${PARITY_DIR}golden/${name}.bin`));
const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

let gbk: (s: string) => number[];
beforeAll(() => {
  gbk = buildGbkEncoder();
});

describe("TSPL sticker builder — byte parity with Android golden", () => {
  it("covers every fixture in the manifest", () => {
    expect(manifest.fixtures.length).toBeGreaterThanOrEqual(8);
  });

  for (const name of manifest.fixtures) {
    it(`reproduces golden bytes for "${name}"`, () => {
      const payload = readPayload(name);
      const golden = readGolden(name);
      const built = buildTsplStickerReference(
        payload,
        manifest.labelWidthMm,
        manifest.labelHeightMm,
        gbk,
      );
      // Hex compare gives a readable diff (and pins length) on mismatch.
      expect(toHex(built)).toBe(toHex(golden));
    });
  }
});

describe("TSPL golden integrity (independent of the reference builder)", () => {
  it("every golden is a well-formed TSPL stream", () => {
    const ascii = new TextDecoder("latin1");
    for (const name of manifest.fixtures) {
      const text = ascii.decode(readGolden(name));
      expect(text.startsWith("SIZE 100 mm, 60 mm\r\n")).toBe(true);
      expect(text.endsWith("PRINT 1\r\n")).toBe(true);
      expect(text).toContain("CLS\r\n");
    }
  });

  it("encodes Chinese fields as decodable GBK (TSS24.BF2)", () => {
    const gbkDecoded = new TextDecoder("gbk").decode(readGolden("chinese"));
    // Store 小店, buyer 陳小美, item 紅色洋裝 — all must round-trip through GBK.
    expect(gbkDecoded).toContain("小店");
    expect(gbkDecoded).toContain("陳小美");
    expect(gbkDecoded).toContain("紅色洋裝");
    expect(gbkDecoded).toContain('"TSS24.BF2"');
  });

  it("strips emoji before encoding (no stray bytes for flags/pictographs)", () => {
    const text = new TextDecoder("latin1").decode(readGolden("emoji_strip"));
    expect(text).toContain('"Maria"'); // "Maria 🇵🇭🔥" -> "Maria"
    expect(text).toContain('"Shop"'); // "Shop 🛍️" -> "Shop"
    expect(text).not.toContain("TSS24.BF2"); // fully ASCII after stripping
  });
});
