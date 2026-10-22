// NiimbotLoaderTests.swift (AppTests target — runs in the xcodebuild simulator gate)
//
// The app never links NiimbotKit.framework; it dlopen()s the embedded copy at runtime on
// iOS 17.2+ and talks to it through the SFLNiimbotDriving protocol. These tests prove the
// whole runtime path inside the real host app bundle: the framework is embedded, dlopen +
// NSClassFromString + the protocol cast succeed, and the simulator stub answers the
// seller-level NIIMBOT_UNAVAILABLE code (the simulator has no SDK slice) — never a crash.

import XCTest
@testable import App

final class NiimbotLoaderTests: XCTestCase {

    func testFrameworkIsEmbeddedButNotLinkedByTheApp() {
        let dir = Bundle.main.privateFrameworksPath ?? ""
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir + "/NiimbotKit.framework/NiimbotKit"), "NiimbotKit.framework must be embedded in the app bundle")
        // Not linked: before the loader runs, the class is unknown to the runtime.
        // (dlopen in another test may already have loaded it — only assert when nothing has.)
        if !NiimbotLoaderTests.loaded { XCTAssertNil(NSClassFromString("NiimbotKitDriver")) }
    }

    func testLoaderFindsTheDriverThroughTheProtocol() {
        guard NiimbotLoader.osSupported else { return } // iOS < 17.2 runtime: the loader never runs (covered below)
        let driver = NiimbotLoader.driver()
        NiimbotLoaderTests.loaded = true
        XCTAssertNotNil(driver, "dlopen + NSClassFromString(\"NiimbotKitDriver\") + SFLNiimbotDriving cast must succeed on iOS 17.2+")
        XCTAssertNotNil(NSClassFromString("NiimbotKitDriver"))
    }

    func testTransportAnswersSellerLevelCodeInsteadOfCrashing() {
        let exp = expectation(description: "completion")
        var result: NiimbotResult?
        NiimbotTransport().printImage(name: "B1-TEST", packed: Data(count: 48 * 240), w: 384, h: 240, rowBytes: 48, wMm: 50, hMm: 30) { r in
            result = r; exp.fulfill()
        }
        wait(for: [exp], timeout: 10)
        NiimbotLoaderTests.loaded = true
        XCTAssertEqual(result?.ok, false)
        // simulator: the embedded stub driver → NIIMBOT_UNAVAILABLE; an iOS < 17.2 runtime → NIIMBOT_OS_TOO_OLD
        XCTAssertTrue(["NIIMBOT_UNAVAILABLE", "NIIMBOT_OS_TOO_OLD"].contains(result?.code ?? ""), "got \(result?.code ?? "nil")")
    }

    // The web decides what a Niimbot row shows from this shim flag: present on iOS < 17.2 (the
    // row says "needs iOS 17" before any print), absent on 17.2+ (the normal driver flow).
    func testShimFlagsOldIosForNiimbotRows() {
        let shim = SellerFlowPrinterPlugin.bridgeShimJS
        if NiimbotLoader.osSupported {
            XCTAssertFalse(shim.contains("niimbotOsTooOld = true"), "17.2+: no OS flag")
        } else {
            XCTAssertTrue(shim.contains("window.SellerFlowPrinter.niimbotOsTooOld = true;"), "iOS < 17.2 must flag the web")
            XCTAssertFalse(NiimbotLoader.osSupported)
            XCTAssertNil(NiimbotLoader.driver(), "the framework is never loaded on iOS < 17.2")
        }
    }

    // The image the SDK gets: the reference's 24-bit BMP (zh4dev _encodeMonochromeBmp, ported
    // 1:1 — "BM", 54-byte header, bottom-up rows padded to 4 bytes, no alpha), black ink on
    // white, with the rasterizer's polarity (stickerRaster.ts renderStickerBitmap: rows
    // MSB-first, bit 1 = INK) — the convention the web sends for Niimbot.
    func testPackedBitsBecomeTheReferenceBmp() {
        let w = 384, h = 240, rowBytes = 48
        var packed = Data(count: rowBytes * h)
        packed[0] = 0x80            // (0,0) ink  — MSB of the first byte = leftmost dot
        packed[10 * rowBytes + 3] = 0x01 // (31,10) ink — LSB of byte 3 = dot 31
        guard let bmp = NiimbotImage.image(packed: packed, w: w, h: h, rowBytes: rowBytes), let img = UIImage(data: bmp), let cg = img.cgImage else {
            return XCTFail("bmp conversion failed")
        }
        // header exactly as the reference writes it
        XCTAssertEqual(Array(bmp[0..<2]), [0x42, 0x4D])
        let rowSize = ((w * 3 + 3) / 4) * 4
        XCTAssertEqual(bmp.count, 54 + rowSize * h)
        XCTAssertEqual(le32(bmp, 2), bmp.count); XCTAssertEqual(le32(bmp, 10), 54); XCTAssertEqual(le32(bmp, 14), 40)
        XCTAssertEqual(le32(bmp, 18), w); XCTAssertEqual(le32(bmp, 22), h)
        XCTAssertEqual(Int(bmp[26]) | Int(bmp[27]) << 8, 1); XCTAssertEqual(Int(bmp[28]) | Int(bmp[29]) << 8, 24)
        XCTAssertEqual(le32(bmp, 34), rowSize * h)
        // raw bytes: bottom-up → image row 0 is the LAST stored row; (0,0) ink = 0,0,0; neighbour white
        let row0 = 54 + (h - 1) * rowSize
        XCTAssertEqual(Array(bmp[row0..<row0 + 6]), [0, 0, 0, 255, 255, 255])
        let row10 = 54 + (h - 1 - 10) * rowSize
        XCTAssertEqual(Array(bmp[row10 + 31 * 3..<row10 + 31 * 3 + 3]), [0, 0, 0])
        // decoded by ImageIO the same way
        XCTAssertEqual(cg.width, w); XCTAssertEqual(cg.height, h)
        XCTAssertEqual(NiimbotImage.inkPixels(in: img), 2)
        XCTAssertNil(NiimbotImage.image(packed: Data(count: 10), w: w, h: h, rowBytes: rowBytes)) // short data → nil
        let stats = NiimbotImage.stats(image: bmp)
        XCTAssertTrue(stats.hasPrefix("bmp 384x240"), stats)
        XCTAssertTrue(stats.contains("alpha=none"), stats)
        XCTAssertTrue(stats.contains("dark=2/92160"), stats)
    }

    // The B1 field fix: the 384×240 sticker is centred on the label's 400×240 dot canvas
    // (50×30 mm × 8 dots/mm) — same ink, shifted 8 dots right, white padding, never cropped.
    func testStickerIsCentredOnTheLabelDotCanvas() {
        let w = 384, h = 240, rowBytes = 48
        var packed = Data(count: rowBytes * h)
        packed[0] = 0x80 // (0,0) ink
        guard let bmp = NiimbotImage.image(packed: packed, w: w, h: h, rowBytes: rowBytes, canvasW: 400, canvasH: 240),
              let img = UIImage(data: bmp), let cg = img.cgImage else { return XCTFail("bmp conversion failed") }
        XCTAssertEqual(cg.width, 400); XCTAssertEqual(cg.height, 240)
        XCTAssertEqual(le32(bmp, 18), 400); XCTAssertEqual(le32(bmp, 22), 240)
        XCTAssertEqual(NiimbotImage.inkPixels(in: img), 1)
        let rowSize = ((400 * 3 + 3) / 4) * 4, row0 = 54 + 239 * rowSize
        XCTAssertEqual(Array(bmp[row0 + 8 * 3..<row0 + 8 * 3 + 3]), [0, 0, 0], "dot (0,0) lands at x=8 — centred in the 16 dots of padding")
        XCTAssertEqual(Array(bmp[row0..<row0 + 3]), [255, 255, 255]); XCTAssertEqual(Array(bmp[row0 + 7 * 3..<row0 + 7 * 3 + 3]), [255, 255, 255])
        // a canvas smaller than the image never crops
        XCTAssertEqual(le32(NiimbotImage.image(packed: packed, w: w, h: h, rowBytes: rowBytes, canvasW: 100, canvasH: 100)!, 18), 384)
        XCTAssertEqual(NiimbotImage.dotsPerMm * 50, 400); XCTAssertEqual(NiimbotImage.dotsPerMm * 30, 240)
    }

    func testAllWhiteImageHasZeroInk() {
        let bmp = NiimbotImage.image(packed: Data(count: 48 * 240), w: 384, h: 240, rowBytes: 48)!
        XCTAssertEqual(NiimbotImage.inkPixels(in: UIImage(data: bmp)!), 0)
        XCTAssertTrue(NiimbotImage.stats(image: bmp).contains("dark=0/92160"))
    }

    // Calibration pattern: 400×240, 20-dot border + 160×96 centre box, 24-bit BMP.
    func testCalibrationPatternIsBmpWithBorderAndBox() {
        guard let bmp = NiimbotImage.calibrationPattern(), let img = UIImage(data: bmp) else { return XCTFail("no pattern") }
        XCTAssertEqual(Array(bmp[0..<2]), [0x42, 0x4D]); XCTAssertEqual(Int(bmp[28]) | Int(bmp[29]) << 8, 24)
        let border = 2 * 20 * 400 + 2 * 20 * (240 - 40), box = 160 * 96
        XCTAssertEqual(NiimbotImage.inkPixels(in: img), border + box)
        XCTAssertTrue(NiimbotImage.stats(image: bmp).contains("alpha=none"))
        XCTAssertFalse(NiimbotImage.calibrationOn, "off by default (no -sfl_niimbot_calibration launch argument)")
    }

    private func le32(_ d: Data, _ at: Int) -> Int { Int(d[at]) | Int(d[at + 1]) << 8 | Int(d[at + 2]) << 16 | Int(d[at + 3]) << 24 }

    private static var loaded = false
}
