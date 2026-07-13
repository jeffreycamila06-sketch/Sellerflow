// CjkEncodingTests.swift
//
// Tests for the 3-tier never-fail CJK printer encoders (CjkEncoding in
// SellerFlowPrinterPlugin.swift) — the fix for the 2026-07-13 device finding
// that CFStringEncodings.GBK_95's converter is MISSING on real iOS, which made
// every Chinese buyer name print as literal '?' (0x3F) over BLE.
//
// ⚠️ RUN THESE AGAINST THE iOS RUNTIME, NOT macOS. The original Mac-run logic
// tests passed because macOS ships the GBK_95 converter — exactly the gap that
// let the bug ship. Two ways to run:
//   1. PRE-ARCHIVE GATE (no Xcode target needed):
//        mobile/ios/tspl-parity/run-encoders-sim.sh
//      (compiles the CjkEncoding block standalone for the iOS Simulator and
//      runs the same fixtures inside it — MUST be green before any Archive).
//   2. Xcode Unit Testing Bundle (same convention as BleStickerLogicTests):
//      add this file, `@testable import App`, and pick an iOS SIMULATOR
//      destination (Product ▸ Destination), NOT "My Mac".
//
// Fixture derivation (committed expectations, cross-checked 3 ways):
//   python3 -c "print('北部還有嗎'.encode('gbk').hex(' '))"
//   — gbk == gb18030 for every fixture char (2-byte range is byte-identical);
//   — big5 == cp950 for every fixture char (standard Big5 range);
//   — per-scalar joins == whole-string encodes (both charsets are stateless).

import XCTest
@testable import App

final class CjkEncodingTests: XCTestCase {

    // MARK: gbkBytes — sticker path (Java getBytes("GBK") parity)

    func testGbkProductionStringThatExposedTheBug() {
        // 北部還有嗎 — printed as ????? on the iPhone (Build 6, real seller).
        XCTAssertEqual(CjkEncoding.gbkBytes("\u{5317}\u{90E8}\u{9084}\u{6709}\u{55CE}"),
                       [0xB1, 0xB1, 0xB2, 0xBF, 0xDF, 0x80, 0xD3, 0xD0, 0x86, 0xE1])
    }

    func testGbkTestPageProbe() {
        // 陳小美 — the D:/E: test-page probe name.
        XCTAssertEqual(CjkEncoding.gbkBytes("\u{9673}\u{5C0F}\u{7F8E}"),
                       [0xEA, 0x90, 0xD0, 0xA1, 0xC3, 0xC0])
    }

    func testGbkMixedAsciiAndCjk() {
        // "A陳b" — ASCII passes through untouched around the CJK bytes.
        XCTAssertEqual(CjkEncoding.gbkBytes("A\u{9673}b"), [0x41, 0xEA, 0x90, 0x62])
    }

    func testGbkPureAsciiIsIdentity() {
        XCTAssertEqual(CjkEncoding.gbkBytes("Buyer #12"), Array("Buyer #12".utf8))
    }

    func testGbkUnmappableScalarBecomesSingleQuestionMark() {
        // U+07C0 (NKo digit zero) is in GB18030 ONLY as a 4-byte sequence
        // (81 31 ac 38) — NOT in GBK. Java getBytes("GBK") replaces it with
        // one '?'; the 4-byte output must be REJECTED, never sent to the
        // GBK-ROM printer.
        XCTAssertEqual(CjkEncoding.gbkBytes("\u{07C0}"), [0x3F])
        XCTAssertEqual(CjkEncoding.gbkBytes("\u{9673}\u{07C0}\u{7F8E}"),
                       [0xEA, 0x90, 0x3F, 0xC3, 0xC0])
    }

    func testGbkNeverReturnsEmptyForCjkInput() {
        // The bug's signature: CJK in, ASCII-fallback '?' out. The encoder must
        // now return real GBK bytes (or per-char '?') — NEVER lose the string.
        XCTAssertFalse(CjkEncoding.gbkBytes("\u{5317}\u{90E8}").isEmpty)
    }

    // MARK: big5Bytes — receipt path (Android PRINTER_CHARSET=Big5 +
    // stripUnencodable parity: unmappable chars DROP, never garbage)

    func testBig5ProductionString() {
        XCTAssertEqual(CjkEncoding.big5Bytes("\u{5317}\u{90E8}\u{9084}\u{6709}\u{55CE}"),
                       [0xA5, 0x5F, 0xB3, 0xA1, 0xC1, 0xD9, 0xA6, 0xB3, 0xB6, 0xDC])
    }

    func testBig5ProbeName() {
        XCTAssertEqual(CjkEncoding.big5Bytes("\u{9673}\u{5C0F}\u{7F8E}"),
                       [0xB3, 0xAF, 0xA4, 0x70, 0xAC, 0xFC])
    }

    func testBig5MixedAsciiAndCjk() {
        XCTAssertEqual(CjkEncoding.big5Bytes("A\u{9673}b"), [0x41, 0xB3, 0xAF, 0x62])
    }

    func testBig5UnmappableCharIsDroppedNotSubstituted() {
        // 简 (simplified-only, U+7B80) has no Big5 mapping. Android drops it
        // via stripUnencodable — so must we: 陳简美 → bytes of 陳美, no '?',
        // and absolutely no UTF-8 garbage.
        XCTAssertEqual(CjkEncoding.big5Bytes("\u{9673}\u{7B80}\u{7F8E}"),
                       [0xB3, 0xAF, 0xAC, 0xFC])
    }

    func testBig5PureAsciiIsIdentity() {
        XCTAssertEqual(CjkEncoding.big5Bytes("Total: 150"), Array("Total: 150".utf8))
    }

    // MARK: converter availability — the environment report + Contingency-C gate

    func testConverterAvailabilityGate() {
        let gbk = CjkEncoding.nsEncoding(.GBK_95) != nil
        let gb18030 = CjkEncoding.nsEncoding(.GB_18030_2000) != nil
        let big5 = CjkEncoding.nsEncoding(.big5) != nil
        let cp950 = CjkEncoding.nsEncoding(.dosChineseTrad) != nil
        print("[CJK-ENV] GBK_95=\(gbk) GB18030=\(gb18030) big5=\(big5) CP950=\(cp950)")
        // PRE-ARCHIVE GATE: at least one converter per family must exist on
        // this runtime, else the encoders degrade to '?'/drop for everything —
        // STOP the release and fall back to the Contingency C plan (embedded
        // Unicode→GBK lookup table, separate plan + audit).
        XCTAssertTrue(gbk || gb18030, "No GBK-family converter on this runtime — Contingency C")
        XCTAssertTrue(big5 || cp950, "No Big5-family converter on this runtime — Contingency C")
    }

    // MARK: buildNumberLiteral — the getBuildNumber shim's number source

    func testBuildNumberParsesPlainIntegers() {
        XCTAssertEqual(CjkEncoding.buildNumberLiteral(from: "7"), 7)
        XCTAssertEqual(CjkEncoding.buildNumberLiteral(from: "6"), 6)
        XCTAssertEqual(CjkEncoding.buildNumberLiteral(from: "42"), 42)
    }

    func testBuildNumberRejectsEverythingElse() {
        // 0 = "omit the shim line" — the web treats any finite number as the
        // real build, so emitting 0 would read as "stale" and nag forever.
        XCTAssertEqual(CjkEncoding.buildNumberLiteral(from: nil), 0)
        XCTAssertEqual(CjkEncoding.buildNumberLiteral(from: ""), 0)
        XCTAssertEqual(CjkEncoding.buildNumberLiteral(from: "7.0"), 0)
        XCTAssertEqual(CjkEncoding.buildNumberLiteral(from: "abc"), 0)
        XCTAssertEqual(CjkEncoding.buildNumberLiteral(from: "0"), 0)
        XCTAssertEqual(CjkEncoding.buildNumberLiteral(from: "-3"), 0)
    }
}
