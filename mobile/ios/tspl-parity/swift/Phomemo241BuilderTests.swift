// Phomemo241BuilderTests.swift
//
// Mac-run test artifact (same convention as MobileTsplBuilderTests /
// BleStickerLogicTests — requires a Mac + Xcode unit-test target; NOT wired
// into App.xcodeproj; CI cannot compile Swift). Covers the Phase-1 Phomemo 241
// builder (buildTsplSticker241) + the pure raster logic (Phomemo241Raster):
//
//   • THE ANTI-DRIFT PIN: an all-ASCII buyer through buildTsplSticker241 must
//     produce EXACTLY buildTsplSticker's bytes (DIRECTION resolved to 1 = AIMO on
//     2026-07-17, so the fork is now byte-identical for ASCII — a direct equality,
//     no substitution) — any future AIMO layout edit that isn't mirrored in the
//     fork turns this test red (the Q2 guardrail; rule in CLAUDE.md).
//   • F1: the band height requested from the renderer = 24 × cjkYMul where
//     cjkYMul respects the seller size-adjuster (nameCjkYMul × level, clamped
//     1-8) — NEVER a fixed 48.
//   • F3: an UNSUPPORTED-script (Thai) name renders as a band — the AIMO
//     downgrade-to-handle is deliberately absent in the fork.
//   • Phomemo241Raster.packBits: polarity (0 = black, P3 hardware-proven),
//     byte-boundary padding (pad bits = white), threshold, invalid input → nil.
//
// To run: add a Unit Testing Bundle target in Xcode, add this file,
// `@testable import App`.

import XCTest
@testable import App

final class Phomemo241BuilderTests: XCTestCase {

    // MARK: helpers

    private func plugin() -> SellerFlowPrinterPlugin { return SellerFlowPrinterPlugin() }

    private func asciiBuyer() -> [String: Any] {
        return [
            "num": 12, "name": "Maria Santos", "handle": "maria_shops", "totalSpent": 700.0,
            "orders": [["item": "250", "time": "20:15"], ["item": "Blue jeans M", "time": "20:18"]],
        ]
    }

    /// Deterministic fake band so tests never depend on UIKit glyph rendering. The
    /// renderer now takes (text, xMul, yMul, maxW) and the band height = 24×yMul
    /// (base cell × the vertical multiplier), computed inside the real renderer.
    private func fakeBand(_ text: String, _ xMul: Int, _ yMul: Int, _ maxW: Int) -> Phomemo241Raster.Band? {
        let widthBytes = 4, h = 24 * max(1, yMul)
        return Phomemo241Raster.Band(widthBytes: widthBytes, height: h, bytes: [UInt8](repeating: 0xAA, count: widthBytes * h))
    }

    // MARK: THE ANTI-DRIFT PIN (Q2 guardrail)
    // The 241 fork runs DIRECTION 0 + an in-layout 180° rotation (the DIR1
    // rasterizer is broken on hardware). So the ASCII fork is byte-equal to
    // rotate180(AIMO): each `TEXT x,y,"f",0,a,b,c` → `TEXT W-x,H-y,"f",180,a,b,c`,
    // each `BAR x,y,w,h` → `BAR W-x-w,H-y-h,w,h`, and `DIRECTION 1` → `DIRECTION 0`.
    // Any un-mirrored AIMO layout edit still turns this red.

    /// Deterministic 180°-about-centre rewrite of an AIMO TSPL stream on the ASCII
    /// lines the parity fixture produces (fixture content has no quoted commas).
    /// W/H = label dots (mm × 8). EDGE_GUARD (32) mirrors the fork's right-edge inset
    /// (the 60×40 DIR-0 clip fix): text x → W−x−32, BAR x → max(0, W−x−w−32).
    private let edgeGuard = 32
    private func rotate180(_ aimo: String, _ W: Int, _ H: Int) -> String {
        return aimo.components(separatedBy: "\r\n").map { line -> String in
            if line == "DIRECTION 1" { return "DIRECTION 0" }
            if line.hasPrefix("TEXT ") {
                let f = line.dropFirst(5).components(separatedBy: ",")
                guard f.count >= 7, let x = Int(f[0]), let y = Int(f[1]) else { return line }
                let content = f[6...].joined(separator: ",")
                return "TEXT \(W - x - edgeGuard),\(H - y),\(f[2]),180,\(f[4]),\(f[5]),\(content)"
            }
            if line.hasPrefix("BAR ") {
                let f = line.dropFirst(4).components(separatedBy: ",")
                guard f.count == 4, let x = Int(f[0]), let y = Int(f[1]), let w = Int(f[2]), let h = Int(f[3]) else { return line }
                return "BAR \(max(0, W - x - w - edgeGuard)),\(H - y - h),\(w),\(h)"
            }
            return line
        }.joined(separator: "\r\n")
    }

    func testAsciiFullParityWithAimo() {
        let p = plugin()
        let buyer = asciiBuyer()
        let aimo = p.buildTsplSticker(buyer: buyer, settings: nil, storeName: "My Shop", currency: "NT$", sessionDate: "07/17/2026", labelWidthMm: 100, labelHeightMm: 60)
        let fork = p.buildTsplSticker241(buyer: buyer, settings: nil, storeName: "My Shop", currency: "NT$", sessionDate: "07/17/2026", labelWidthMm: 100, labelHeightMm: 60, bandRenderer: { _, _, _, _ in XCTFail("all-ASCII input must never render a band"); return nil })
        XCTAssertEqual(String(decoding: fork, as: UTF8.self), rotate180(String(decoding: aimo, as: UTF8.self), 800, 480),
                       "FORK DRIFT: buildTsplSticker241 no longer matches rotate180(buildTsplSticker) for ASCII input — mirror the AIMO layout change into the fork or consciously decline it (see the FORK-OF header + CLAUDE.md rule)")
    }

    func testAsciiFullParityHoldsOnEverySizeConfig() {
        let p = plugin()
        let buyer = asciiBuyer()
        for (w, h) in [(100, 60), (80, 60), (80, 50), (70, 50), (60, 40)] {
            let aimo = p.buildTsplSticker(buyer: buyer, settings: nil, storeName: "My Shop", currency: "NT$", sessionDate: "07/17/2026", labelWidthMm: w, labelHeightMm: h)
            let fork = p.buildTsplSticker241(buyer: buyer, settings: nil, storeName: "My Shop", currency: "NT$", sessionDate: "07/17/2026", labelWidthMm: w, labelHeightMm: h, bandRenderer: { _, _, _, _ in nil })
            XCTAssertEqual(String(decoding: fork, as: UTF8.self), rotate180(String(decoding: aimo, as: UTF8.self), w * 8, h * 8),
                           "fork drift at \(w)x\(h)")
        }
    }

    // MARK: F1 — band height respects the seller size-adjuster

    func testBandHeightIsScaleCoupledNotFixed48() {
        let p = plugin()
        let buyer: [String: Any] = ["num": 88, "name": "\u{9673}\u{5C0F}\u{7F8E}", "handle": "sellerflow", "orders": []]
        var requestedHeights: [Int] = []
        let capture: (String, Int, Int, Int) -> Phomemo241Raster.Band? = { text, xMul, yMul, maxW in
            requestedHeights.append(24 * max(1, yMul))   // effective band height = 24 × yMul
            return self.fakeBand(text, xMul, yMul, maxW)
        }
        // level 1: cjkYMul = nameCjkYMul(2) × 1 = 2 → band height 48
        _ = p.buildTsplSticker241(buyer: buyer, settings: ["printBuyerNameScale": 1, "printStoreName": false, "printBuyerUsername": false, "printOrderItems": false, "printTotal": false], storeName: "S", currency: "NT$", sessionDate: "", labelWidthMm: 100, labelHeightMm: 60, bandRenderer: capture)
        XCTAssertEqual(requestedHeights, [48], "level 1 name band must be 24 × (2×1) = 48")
        // level 3: cjkYMul = clamp(2 × 3) = 6 → band height 144 (NOT fixed 48)
        requestedHeights = []
        _ = p.buildTsplSticker241(buyer: buyer, settings: ["printBuyerNameScale": 3, "printStoreName": false, "printBuyerUsername": false, "printOrderItems": false, "printTotal": false], storeName: "S", currency: "NT$", sessionDate: "", labelWidthMm: 100, labelHeightMm: 60, bandRenderer: capture)
        XCTAssertEqual(requestedHeights, [144], "level 3 name band must be 24 × clamp(2×3) = 144 — F1 hard requirement")
        // level 8: clamp to TSPL ceiling 8 → 24 × 8 = 192
        requestedHeights = []
        _ = p.buildTsplSticker241(buyer: buyer, settings: ["printBuyerNameScale": 8, "printStoreName": false, "printBuyerUsername": false, "printOrderItems": false, "printTotal": false], storeName: "S", currency: "NT$", sessionDate: "", labelWidthMm: 100, labelHeightMm: 60, bandRenderer: capture)
        XCTAssertEqual(requestedHeights, [192], "multiplier clamps at the TSPL 8x ceiling")
    }

    // MARK: BUG-1 — scale adjusters take effect (ASCII scaled → raster band)
    // The 241 firmware ignores the TSPL font x/y-multiplier on rotation-180 TEXT,
    // so a SCALED ASCII element must be sized in PIXELS (a band) to have any effect.
    // At scale 1 it stays the verified font-multiplier TEXT (byte-identical default).

    func testScaledAsciiBuyerNumberBecomesBand() {
        let p = plugin()
        let buyer: [String: Any] = ["num": 88, "name": "", "handle": "s", "totalSpent": 0, "orders": []]
        var bandHeights: [Int] = []
        let cap: (String, Int, Int, Int) -> Phomemo241Raster.Band? = { _, _, yMul, _ in
            let h = 24 * max(1, yMul); bandHeights.append(h); return Phomemo241Raster.Band(widthBytes: 4, height: h, bytes: [UInt8](repeating: 0xAA, count: 4 * h))
        }
        let off: [String: Any] = ["printStoreName": false, "printBuyerUsername": false, "printOrderItems": false, "printTotal": false]
        // scale 1 → the Buyer# stays a TEXT command; NO band requested.
        let s1 = String(decoding: p.buildTsplSticker241(buyer: buyer, settings: off.merging(["printBuyerNumberScale": 1]) { a, _ in a }, storeName: "S", currency: "NT$", sessionDate: "", labelWidthMm: 60, labelHeightMm: 40, bandRenderer: cap), as: UTF8.self)
        XCTAssertTrue(s1.contains("\"Buyer #88\""), "scale 1 → the Buyer# is a plain TEXT (verified default)")
        XCTAssertTrue(bandHeights.isEmpty, "scale 1 → no band is requested")
        // scale 5 → the Buyer# must become a BITMAP band at 24 × cmul(buyerNumYMul(1)×5) = 120.
        bandHeights = []
        let s5 = String(decoding: p.buildTsplSticker241(buyer: buyer, settings: off.merging(["printBuyerNumberScale": 5]) { a, _ in a }, storeName: "S", currency: "NT$", sessionDate: "", labelWidthMm: 60, labelHeightMm: 40, bandRenderer: cap), as: UTF8.self)
        XCTAssertFalse(s5.contains("\"Buyer #88\""), "scale 5 → the Buyer# must NOT stay a font-multiplier TEXT (the 241 wouldn't scale it)")
        XCTAssertEqual(bandHeights, [120], "scale 5 → a pixel-sized band at 24 × 5 (60x40 buyerNumYMul=1)")
    }

    // MARK: F3 — UNSUPPORTED script renders as a band (no downgrade)

    func testThaiNameRendersAsBandNotHandle() {
        let p = plugin()
        let buyer: [String: Any] = ["num": 5, "name": "\u{0E2A}\u{0E27}\u{0E31}\u{0E2A}\u{0E14}\u{0E35}", "handle": "thaiseller", "orders": []] // สวัสดี
        var bandTexts: [String] = []
        let capture: (String, Int, Int, Int) -> Phomemo241Raster.Band? = { text, xMul, yMul, maxW in
            bandTexts.append(text)
            return self.fakeBand(text, xMul, yMul, maxW)
        }
        let out = p.buildTsplSticker241(buyer: buyer, settings: ["printStoreName": false, "printBuyerUsername": false, "printOrderItems": false, "printTotal": false], storeName: "S", currency: "NT$", sessionDate: "", labelWidthMm: 100, labelHeightMm: 60, bandRenderer: capture)
        XCTAssertEqual(bandTexts.count, 1, "the Thai name must reach the band renderer — the AIMO downgrade-to-handle is deliberately absent (D3)")
        XCTAssertTrue(bandTexts[0].contains("\u{0E2A}"), "band text keeps the Thai glyphs (no stripUnrenderable — D4)")
        let s = String(decoding: out, as: UTF8.self)
        // Band box re-anchored under the 180° map: x = W(800) − 16 − widthBytes*8(32) = 752.
        XCTAssertTrue(s.contains("BITMAP 720,"), "band emits a BITMAP at the 180°-mapped name x origin (800−16−32)")
        XCTAssertFalse(s.contains("@thaiseller"), "the name line must not silently become the handle")
    }

    // MARK: DIRECTION 0 + in-layout 180° rotation (D1)

    func testLayoutIsDirection0WithRotated180Text() {
        let p = plugin()
        let out = p.buildTsplSticker241(buyer: asciiBuyer(), settings: nil, storeName: "My Shop", currency: "NT$", sessionDate: "07/17/2026", labelWidthMm: 100, labelHeightMm: 60, bandRenderer: { _, _, _, _ in nil })
        let s = String(decoding: out, as: UTF8.self)
        XCTAssertTrue(s.contains("DIRECTION 0"), "the 241 fork must run DIRECTION 0 (DIR1 rasterizer is broken)")
        XCTAssertFalse(s.contains("DIRECTION 1"), "DIRECTION 1 must never be emitted by the fork")
        // Header 'SellerFlowLive' was at rot-0 (16,10); 180°-mapped → rot-180 at (800−16, 480−10).
        XCTAssertTrue(s.contains("TEXT 784,470,\"3\",180,1,1,\"SellerFlowLive\""),
                      "header must be rotation-180 at the mapped anchor (W−x, H−y)")
        XCTAssertNil(s.range(of: #"TEXT \d+,\d+,"[^"]*",0,"#, options: .regularExpression),
                     "no element may stay rotation 0 — the whole layout is rotated 180°")
    }

    // MARK: BITMAP command shape + failed-render safety

    func testBitmapCommandSyntaxMatchesP3ProvenShape() {
        let p = plugin()
        let buyer: [String: Any] = ["num": 88, "name": "\u{9673}\u{5C0F}\u{7F8E}", "handle": "s", "orders": []]
        let out = p.buildTsplSticker241(buyer: buyer, settings: ["printStoreName": false, "printBuyerUsername": false, "printOrderItems": false, "printTotal": false], storeName: "S", currency: "NT$", sessionDate: "", labelWidthMm: 100, labelHeightMm: 60, bandRenderer: fakeBand)
        let s = String(decoding: out, as: UTF8.self)
        // BITMAP x,y,widthBytes,height,0, — the exact mode/order the P3 probe printed
        // (x = 800 − 16 − 4*8 = 752 under the 180° map).
        XCTAssertNotNil(s.range(of: #"BITMAP 720,\d+,4,48,0,"#, options: .regularExpression),
                        "BITMAP header must be x,y,widthBytes,height,mode0 (P3-proven syntax) at the mapped anchor")
    }

    func testFailedRenderEmitsNothingNeverMalformed() {
        let p = plugin()
        let buyer: [String: Any] = ["num": 88, "name": "\u{9673}\u{5C0F}\u{7F8E}", "handle": "s", "orders": []]
        let out = p.buildTsplSticker241(buyer: buyer, settings: nil, storeName: "S", currency: "NT$", sessionDate: "", labelWidthMm: 100, labelHeightMm: 60, bandRenderer: { _, _, _, _ in nil })
        let s = String(decoding: out, as: UTF8.self)
        XCTAssertFalse(s.contains("BITMAP"), "a failed band render must emit NOTHING (0-width BITMAP would be malformed)")
        XCTAssertTrue(s.hasSuffix("PRINT 1\r\n"), "the label still terminates normally")
    }

    // MARK: Phomemo241Raster.packBits (pure)

    func testPackBitsPolarityZeroIsBlack() {
        // one row, 8 pixels: first 4 black (gray 0), last 4 white (gray 255)
        let band = Phomemo241Raster.packBits(gray: [0, 0, 0, 0, 255, 255, 255, 255], width: 8, height: 1)!
        XCTAssertEqual(band.bytes, [0b0000_1111], "black pixels clear their bits (0 = black, P3-proven); white keep 1")
    }

    func testPackBitsPadsWidthToByteWithWhite() {
        // width 10 → 2 bytes; all-black row → byte0 = 0x00, byte1 = 0b0011_1111 (6 pad bits stay white=1)
        let band = Phomemo241Raster.packBits(gray: [UInt8](repeating: 0, count: 10), width: 10, height: 1)!
        XCTAssertEqual(band.widthBytes, 2)
        XCTAssertEqual(band.bytes, [0x00, 0b0011_1111], "pad bits beyond the true width must stay white")
    }

    func testPackBitsThresholdBoundary() {
        let band = Phomemo241Raster.packBits(gray: [127, 128], width: 2, height: 1)!
        XCTAssertEqual(band.bytes, [0b0111_1111], "gray < 128 = black; gray >= 128 = white")
    }

    func testPackBitsFlip180RotatesBothAxes() {
        // 2x2: black only at top-left (0,0). 180° → black moves to bottom-right (1,1).
        let gray: [UInt8] = [0, 255,
                             255, 255]
        let normal = Phomemo241Raster.packBits(gray: gray, width: 2, height: 2)!
        // row0 = 0b0111_1111 (col0 black), row1 = 0b1111_1111 (all white)
        XCTAssertEqual(normal.bytes, [0b0111_1111, 0b1111_1111])
        let flipped = Phomemo241Raster.packBits(gray: gray, width: 2, height: 2, flip180: true)!
        // row0 all white, row1 col1 black → 0b1011_1111
        XCTAssertEqual(flipped.bytes, [0b1111_1111, 0b1011_1111], "flip180 rotates 180° (both row and column reversed)")
    }

    func testPackBitsFlip180DefaultFalseIsByteIdentical() {
        let gray: [UInt8] = [0, 128, 200, 10, 255, 60]
        let a = Phomemo241Raster.packBits(gray: gray, width: 3, height: 2)!
        let b = Phomemo241Raster.packBits(gray: gray, width: 3, height: 2, flip180: false)!
        XCTAssertEqual(a.bytes, b.bytes, "the default (false) must be byte-identical to the un-flipped pack")
    }

    func testPackBitsInvalidInputsReturnNil() {
        XCTAssertNil(Phomemo241Raster.packBits(gray: [], width: 0, height: 1))
        XCTAssertNil(Phomemo241Raster.packBits(gray: [0], width: 1, height: 0))
        XCTAssertNil(Phomemo241Raster.packBits(gray: [0, 0], width: 2, height: 2), "short pixel buffer → nil")
    }

    func testMaxCharsMirrorsAimoFormula() {
        XCTAssertEqual(Phomemo241Raster.maxChars(x: 16, rightEdge: 784, cjkXMul: 2), (784 - 16) / 48)
        XCTAssertEqual(Phomemo241Raster.maxChars(x: 780, rightEdge: 784, cjkXMul: 2), 1, "floor of 1 even when the space is tiny")
    }
}
