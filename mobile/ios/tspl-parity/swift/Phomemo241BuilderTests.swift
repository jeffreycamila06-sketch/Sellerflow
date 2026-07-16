// Phomemo241BuilderTests.swift
//
// Mac-run test artifact (same convention as MobileTsplBuilderTests /
// BleStickerLogicTests — requires a Mac + Xcode unit-test target; NOT wired
// into App.xcodeproj; CI cannot compile Swift). Covers the Phase-1 Phomemo 241
// builder (buildTsplSticker241) + the pure raster logic (Phomemo241Raster):
//
//   • THE ANTI-DRIFT PIN: an all-ASCII buyer through buildTsplSticker241 must
//     produce EXACTLY buildTsplSticker's bytes with "DIRECTION 1" → "DIRECTION 0"
//     — any future AIMO layout edit that isn't mirrored in the fork turns this
//     test red (the Q2 guardrail; rule in CLAUDE.md).
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

    /// Deterministic fake band so tests never depend on UIKit glyph rendering.
    private func fakeBand(_ text: String, _ h: Int, _ maxW: Int) -> Phomemo241Raster.Band? {
        let widthBytes = 4
        return Phomemo241Raster.Band(widthBytes: widthBytes, height: h, bytes: [UInt8](repeating: 0xAA, count: widthBytes * h))
    }

    // MARK: THE ANTI-DRIFT PIN (Q2 guardrail)

    func testAsciiParityWithAimoModuloDirection() {
        let p = plugin()
        let buyer = asciiBuyer()
        let aimo = p.buildTsplSticker(buyer: buyer, settings: nil, storeName: "My Shop", currency: "NT$", sessionDate: "07/17/2026", labelWidthMm: 100, labelHeightMm: 60)
        let fork = p.buildTsplSticker241(buyer: buyer, settings: nil, storeName: "My Shop", currency: "NT$", sessionDate: "07/17/2026", labelWidthMm: 100, labelHeightMm: 60, bandRenderer: { _, _, _ in XCTFail("all-ASCII input must never render a band"); return nil })
        let aimoStr = String(decoding: aimo, as: UTF8.self)
        let forkStr = String(decoding: fork, as: UTF8.self)
        XCTAssertEqual(forkStr, aimoStr.replacingOccurrences(of: "DIRECTION 1", with: "DIRECTION 0"),
                       "FORK DRIFT: buildTsplSticker241 no longer matches buildTsplSticker (modulo DIRECTION) for ASCII input — mirror the AIMO layout change into the fork or consciously decline it (see the FORK-OF header + CLAUDE.md rule)")
    }

    func testAsciiParityHoldsOnEverySizeConfig() {
        let p = plugin()
        let buyer = asciiBuyer()
        for (w, h) in [(100, 60), (80, 60), (80, 50), (70, 50), (60, 40)] {
            let aimo = p.buildTsplSticker(buyer: buyer, settings: nil, storeName: "My Shop", currency: "NT$", sessionDate: "07/17/2026", labelWidthMm: w, labelHeightMm: h)
            let fork = p.buildTsplSticker241(buyer: buyer, settings: nil, storeName: "My Shop", currency: "NT$", sessionDate: "07/17/2026", labelWidthMm: w, labelHeightMm: h, bandRenderer: { _, _, _ in nil })
            XCTAssertEqual(String(decoding: fork, as: UTF8.self),
                           String(decoding: aimo, as: UTF8.self).replacingOccurrences(of: "DIRECTION 1", with: "DIRECTION 0"),
                           "fork drift at \(w)x\(h)")
        }
    }

    // MARK: F1 — band height respects the seller size-adjuster

    func testBandHeightIsScaleCoupledNotFixed48() {
        let p = plugin()
        let buyer: [String: Any] = ["num": 88, "name": "\u{9673}\u{5C0F}\u{7F8E}", "handle": "sellerflow", "orders": []]
        var requestedHeights: [Int] = []
        let capture: (String, Int, Int) -> Phomemo241Raster.Band? = { text, h, maxW in
            requestedHeights.append(h)
            return self.fakeBand(text, h, maxW)
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

    // MARK: F3 — UNSUPPORTED script renders as a band (no downgrade)

    func testThaiNameRendersAsBandNotHandle() {
        let p = plugin()
        let buyer: [String: Any] = ["num": 5, "name": "\u{0E2A}\u{0E27}\u{0E31}\u{0E2A}\u{0E14}\u{0E35}", "handle": "thaiseller", "orders": []] // สวัสดี
        var bandTexts: [String] = []
        let capture: (String, Int, Int) -> Phomemo241Raster.Band? = { text, h, maxW in
            bandTexts.append(text)
            return self.fakeBand(text, h, maxW)
        }
        let out = p.buildTsplSticker241(buyer: buyer, settings: ["printStoreName": false, "printBuyerUsername": false, "printOrderItems": false, "printTotal": false], storeName: "S", currency: "NT$", sessionDate: "", labelWidthMm: 100, labelHeightMm: 60, bandRenderer: capture)
        XCTAssertEqual(bandTexts.count, 1, "the Thai name must reach the band renderer — the AIMO downgrade-to-handle is deliberately absent (D3)")
        XCTAssertTrue(bandTexts[0].contains("\u{0E2A}"), "band text keeps the Thai glyphs (no stripUnrenderable — D4)")
        let s = String(decoding: out, as: UTF8.self)
        XCTAssertTrue(s.contains("BITMAP 16,"), "band emits a BITMAP command at the name x origin")
        XCTAssertFalse(s.contains("@thaiseller"), "the name line must not silently become the handle")
    }

    // MARK: BITMAP command shape + failed-render safety

    func testBitmapCommandSyntaxMatchesP3ProvenShape() {
        let p = plugin()
        let buyer: [String: Any] = ["num": 88, "name": "\u{9673}\u{5C0F}\u{7F8E}", "handle": "s", "orders": []]
        let out = p.buildTsplSticker241(buyer: buyer, settings: ["printStoreName": false, "printBuyerUsername": false, "printOrderItems": false, "printTotal": false], storeName: "S", currency: "NT$", sessionDate: "", labelWidthMm: 100, labelHeightMm: 60, bandRenderer: fakeBand)
        let s = String(decoding: out, as: UTF8.self)
        // BITMAP x,y,widthBytes,height,0, — the exact mode/order the P3 probe printed
        XCTAssertNotNil(s.range(of: #"BITMAP 16,\d+,4,48,0,"#, options: .regularExpression),
                        "BITMAP header must be x,y,widthBytes,height,mode0 (P3-proven syntax)")
    }

    func testFailedRenderEmitsNothingNeverMalformed() {
        let p = plugin()
        let buyer: [String: Any] = ["num": 88, "name": "\u{9673}\u{5C0F}\u{7F8E}", "handle": "s", "orders": []]
        let out = p.buildTsplSticker241(buyer: buyer, settings: nil, storeName: "S", currency: "NT$", sessionDate: "", labelWidthMm: 100, labelHeightMm: 60, bandRenderer: { _, _, _ in nil })
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
