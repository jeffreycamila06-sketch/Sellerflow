// iOS CJK-encoder SOURCE CONTRACT (Build 7 / v1.3 GBK fix, 2026-07-13).
//
// CI cannot compile Swift, so this pins the STRUCTURE of the fix in
// mobile/ios/App/App/SellerFlowPrinterPlugin.swift the same way the SQL
// contract tests pin sql/*.sql. The BEHAVIOR (exact bytes) is pinned by
// fixture tests that run on the iOS runtime:
//   mobile/ios/tspl-parity/run-encoders-sim.sh          (pre-Archive gate)
//   mobile/ios/tspl-parity/swift/CjkEncodingTests.swift (Xcode sim bundle)
//
// Background: GBK_95's converter is MISSING on real iOS devices — the old
// single-tier gbkBytes returned nil, writeTextSmart fell to its ASCII path,
// and Chinese buyer names printed as literal '?' (0x3F). Mac-run Swift tests
// could never catch it (macOS ships the converter). These pins stop the
// 3-tier shape from silently regressing.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const swift = readFileSync(
  resolve(__dirname, "../../../mobile/ios/App/App/SellerFlowPrinterPlugin.swift"),
  "utf8",
);

// The marker-delimited block the simulator harness extracts verbatim.
const block = swift.match(/\/\/ CJK-ENCODING-BEGIN[\s\S]*?\/\/ CJK-ENCODING-END/)?.[0] ?? "";
const fnBody = (name: string): string => {
  const m = block.match(new RegExp(`static func ${name}[\\s\\S]*?\\n    }`));
  return m?.[0] ?? "";
};

describe("CjkEncoding block (extracted by run-encoders-sim.sh)", () => {
  it("exists with its extraction markers and stays Foundation-only", () => {
    expect(block).toContain("enum CjkEncoding");
    // The sim harness compiles this standalone — framework imports would break it.
    expect(block).not.toMatch(/\bimport\s+(Capacitor|UIKit|CoreBluetooth)\b/);
  });

  it("gbkBytes: 3-tier — whole-string GBK_95 fast path, per-scalar GBK_95 → GB18030 (≤2 bytes only), '?' fallback", () => {
    const gbk = fnBody("gbkBytes");
    // Tier 1 first: byte-identical to the pre-fix path where the converter exists.
    expect(gbk).toMatch(/if let whole = losslessBytes\(s, \.GBK_95\) \{ return whole \}/);
    // Tier 2: GB18030, accepting ONLY the 1–2 byte (GBK-identical) range — a
    // 4-byte sequence is not in GBK and must never reach the GBK-ROM printer.
    expect(gbk).toContain(".GB_18030_2000");
    expect(gbk.match(/b\.count <= 2/g)?.length).toBe(2); // both per-scalar tiers gated
    // Tier 3: Java getBytes("GBK") parity — '?' per unmappable code point.
    expect(gbk).toContain("out.append(0x3F)");
    // Never-nil: the enum encoder returns a plain array (the Optional lives
    // only in the untouched member delegate).
    expect(gbk).toContain("static func gbkBytes(_ s: String) -> [UInt8] {");
  });

  it("big5Bytes: 3-tier — big5 → CP950 (dosChineseTrad, ≤2 bytes), unmappable chars DROPPED (Android parity, never '?')", () => {
    const big5 = fnBody("big5Bytes");
    expect(big5).toMatch(/if let whole = losslessBytes\(s, \.big5\) \{ return whole \}/);
    expect(big5).toContain(".dosChineseTrad");
    expect(big5.match(/b\.count <= 2/g)?.length).toBe(2);
    // Android slip parity (PRINTER_CHARSET=Big5 + stripUnencodable): DROP —
    // no '?' substitution in the receipt encoder.
    expect(big5).not.toContain("0x3F");
    expect(big5).toContain("static func big5Bytes(_ s: String) -> [UInt8] {");
  });
});

describe("call sites — the fix must actually be wired in", () => {
  it("the member gbkBytes is a pure delegate and writeTextSmart is byte-untouched", () => {
    expect(swift).toMatch(
      /private func gbkBytes\(_ s: String\) -> \[UInt8\]\? \{\s*\n\s*return CjkEncoding\.gbkBytes\(s\)\s*\n\s*\}/,
    );
    // The sacred sticker layout path keeps its exact pre-fix structure; its
    // ASCII else-branch is now just an unreachable safety net.
    expect(swift).toContain("if let gbk = gbkBytes(fitted) {");
  });

  it("the receipt text() encoder uses CjkEncoding.big5Bytes and the UTF-8 garbage fallback is GONE", () => {
    const textFn = swift.match(/func text\(_ s: String\) \{[\s\S]*?\n {8}\}/)?.[0] ?? "";
    expect(textFn).toContain("CjkEncoding.big5Bytes(cleaned)");
    // The old fallback appended raw UTF-8 bytes, which the XP-N160II renders
    // as garbage in FS& Kanji mode — worse than dropping.
    expect(textFn).not.toContain("utf8");
  });

  it("the test page's E-probe prints the production bug string via gbkBytes (D line stays byte-identical)", () => {
    // 北部還有嗎 as explicit escapes, same style as the 陳小美 probe.
    expect(swift).toContain('"\\u{5317}\\u{90E8}\\u{9084}\\u{6709}\\u{55CE}"');
    expect(swift).toContain('writeAscii("TEXT 20,450,\\"2\\",0,1,1,\\"E:\\"")');
    expect(swift).toContain('writeEncodedLine("TEXT 70,444,\\"TSS24.BF2\\",0,1,1,\\"", cjkE, gbkBytes(cjkE))');
    // The Java-parity D probe is untouched.
    expect(swift).toContain('writeEncodedLine("TEXT 70,344,\\"TSS24.BF2\\",0,1,1,\\"", cjk, gbkBytes(cjk))');
  });
});

describe("3-tier language detection — RANGE-based and identical across all three builders (never encoder-dependent)", () => {
  // Jeff's 2026-07-13 scope question: could the broken gbkBytes have corrupted
  // tier ROUTING (Thai → wrong tier)? No — and this pins WHY, forever: the
  // classifier walks code points against fixed CJK ranges and never consults
  // an encoder, so converter availability can only affect RENDERING of the
  // already-chosen CJK tier. Latin/Vietnamese → font 4 and Thai/Arabic/emoji
  // → @handle were correct even on the broken Build 6.
  const java = readFileSync(
    resolve(__dirname, "../../../mobile/android/app/src/main/java/com/sellerflow/live/TsplBuilder.java"),
    "utf8",
  );
  const tsRef = readFileSync(resolve(__dirname, "./tsplReference.ts"), "utf8");
  const RANGES = [
    [0x4e00, 0x9fff], // CJK Unified Ideographs
    [0x3400, 0x4dbf], // Extension A
    [0xf900, 0xfaff], // Compatibility Ideographs
  ] as const;
  const hasRanges = (src: string): boolean =>
    RANGES.every(([lo, hi]) => {
      const re = new RegExp(
        `0x${lo.toString(16)}\\s*&&\\s*cp\\s*<=\\s*0x${hi.toString(16)}`,
        "i",
      );
      return re.test(src);
    });

  it("Java, Swift, and the TS reference share the exact same three CJK ranges", () => {
    expect(hasRanges(java)).toBe(true);
    expect(hasRanges(swift)).toBe(true);
    expect(hasRanges(tsRef)).toBe(true);
  });

  it("the Swift classifier and unsupported→@handle fallback never touch the encoders", () => {
    const classify = swift.match(/private func classifyScript[\s\S]*?\n {4}}/)?.[0] ?? "";
    expect(classify).toContain("isCjkIdeograph(cp)");
    expect(classify).not.toMatch(/gbkBytes|big5Bytes|losslessBytes|CjkEncoding/);
    // The Android-mirrored tier-3 fallback (Arabic/Korean/Thai → romanized
    // @handle if ASCII, else omit) is intact — the fix never touched it.
    expect(swift).toMatch(
      /if nameTier == SellerFlowPrinterPlugin\.scriptUnsupported \{/,
    );
  });
});

describe("getBuildNumber shim (exact-build bridge for the update modal)", () => {
  const webSrc = readFileSync(
    resolve(__dirname, "../../redesign/adapters/nativeVersion.ts"),
    "utf8",
  );

  it("returns a JS NUMBER literal interpolated from CFBundleVersion — never a quoted string", () => {
    // The number comes from CFBundleVersion through the strict parser.
    expect(swift).toMatch(
      /iosBuildNumber = CjkEncoding\.buildNumberLiteral\(\s*\n?\s*from: Bundle\.main\.object\(forInfoDictionaryKey: "CFBundleVersion"\) as\? String\)/,
    );
    // Unquoted \(iosBuildNumber) ⇒ a number reaches JS.
    expect(swift).toContain(
      'window.SellerFlowPrinter.getBuildNumber = function(){ return \\(iosBuildNumber); };',
    );
    expect(swift).not.toContain('return "\\(iosBuildNumber)"');
  });

  it("the line is emitted only for a parseable positive build (0 would nag Build-7+ users forever)", () => {
    expect(swift).toMatch(/buildNumberShimLine = iosBuildNumber > 0\s*\n\s*\?/);
    // And the shim template actually includes it.
    expect(swift).toContain("\\(buildNumberShimLine)");
  });

  it("cross-file: the web probe reads the same method name and prefers the bridge over capability synthesis", () => {
    expect(webSrc).toContain("SellerFlowPrinter?: { getBuildNumber?:");
    // readBinaryBuild prefers a real finite bridge integer.
    expect(webSrc).toMatch(/if \(typeof b === "number" && Number\.isFinite\(b\)\) return b;/);
  });
});
