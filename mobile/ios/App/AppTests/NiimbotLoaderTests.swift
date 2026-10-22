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

    // The image the SDK gets: an OPAQUE 8-bit RGB PNG (IHDR colour type 2, no alpha), black
    // ink on white, with the rasterizer's polarity (stickerRaster.ts renderStickerBitmap: rows
    // MSB-first, bit 1 = INK) — the convention the web sends for Niimbot. A blank label is
    // exactly what a wrong polarity / an alpha-only image would produce, so this is pinned.
    func testPackedBitsBecomeBlackOnWhiteOpaqueRgbPng() {
        let w = 384, h = 240, rowBytes = 48
        var packed = Data(count: rowBytes * h)
        packed[0] = 0x80            // (0,0) ink  — MSB of the first byte = leftmost dot
        packed[10 * rowBytes + 3] = 0x01 // (31,10) ink — LSB of byte 3 = dot 31
        guard let png = NiimbotImage.png(packed: packed, w: w, h: h, rowBytes: rowBytes), let img = UIImage(data: png), let cg = img.cgImage else {
            return XCTFail("png conversion failed")
        }
        XCTAssertEqual(cg.width, w); XCTAssertEqual(cg.height, h)
        XCTAssertEqual(png[25], 2, "PNG IHDR colour type must be 2 = RGB (no alpha); got \(png[25])")
        XCTAssertEqual(NiimbotImage.inkPixels(in: img), 2)
        // pixel probe through a gray context: ink = 0, paper = 255
        var gray = [UInt8](repeating: 9, count: w * h)
        gray.withUnsafeMutableBytes { buf in
            let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        }
        XCTAssertEqual(gray[0], 0)                       // (0,0) black
        XCTAssertEqual(gray[10 * w + 31], 0)             // (31,10) black
        XCTAssertEqual(gray[1], 255); XCTAssertEqual(gray[w * h - 1], 255) // paper white
        XCTAssertNil(NiimbotImage.png(packed: Data(count: 10), w: w, h: h, rowBytes: rowBytes)) // short data → nil, never a blank label
        let stats = NiimbotImage.stats(png: png)
        XCTAssertTrue(stats.contains("alpha=none"), stats)
        XCTAssertTrue(stats.contains("dark=2/92160"), stats)
    }

    // The B1 field fix: the 384×240 sticker is centred on the label's 400×240 dot canvas
    // (50×30 mm × 8 dots/mm) — same ink, shifted 8 dots right, white padding, never cropped.
    func testStickerIsCentredOnTheLabelDotCanvas() {
        let w = 384, h = 240, rowBytes = 48
        var packed = Data(count: rowBytes * h)
        packed[0] = 0x80 // (0,0) ink
        guard let png = NiimbotImage.png(packed: packed, w: w, h: h, rowBytes: rowBytes, canvasW: 400, canvasH: 240),
              let img = UIImage(data: png), let cg = img.cgImage else { return XCTFail("png conversion failed") }
        XCTAssertEqual(cg.width, 400); XCTAssertEqual(cg.height, 240)
        XCTAssertEqual(png[25], 2, "still RGB, no alpha")
        XCTAssertEqual(NiimbotImage.inkPixels(in: img), 1)
        var gray = [UInt8](repeating: 9, count: 400 * 240)
        gray.withUnsafeMutableBytes { buf in
            let ctx = CGContext(data: buf.baseAddress, width: 400, height: 240, bitsPerComponent: 8, bytesPerRow: 400, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: 400, height: 240))
        }
        XCTAssertEqual(gray[8], 0, "dot (0,0) lands at x=8 — centred in the 16 dots of padding")
        XCTAssertEqual(gray[0], 255); XCTAssertEqual(gray[7], 255); XCTAssertEqual(gray[399], 255)
        // a canvas smaller than the image never crops
        XCTAssertEqual(UIImage(data: NiimbotImage.png(packed: packed, w: w, h: h, rowBytes: rowBytes, canvasW: 100, canvasH: 100)!)!.cgImage!.width, 384)
        XCTAssertEqual(NiimbotImage.dotsPerMm * 50, 400); XCTAssertEqual(NiimbotImage.dotsPerMm * 30, 240)
    }

    func testAllWhiteImageHasZeroInk() {
        let png = NiimbotImage.png(packed: Data(count: 48 * 240), w: 384, h: 240, rowBytes: 48)!
        XCTAssertEqual(NiimbotImage.inkPixels(in: UIImage(data: png)!), 0)
        XCTAssertTrue(NiimbotImage.stats(png: png).contains("dark=0/92160"))
    }

    // Calibration pattern: 400×240, 20-dot border + 160×96 centre box, opaque RGB.
    func testCalibrationPatternIsOpaqueRgbWithBorderAndBox() {
        guard let png = NiimbotImage.calibrationPattern(), let img = UIImage(data: png) else { return XCTFail("no pattern") }
        XCTAssertEqual(png[25], 2, "colour type 2 = RGB, no alpha")
        let border = 2 * 20 * 400 + 2 * 20 * (240 - 40), box = 160 * 96
        XCTAssertEqual(NiimbotImage.inkPixels(in: img), border + box)
        XCTAssertTrue(NiimbotImage.stats(png: png).contains("alpha=none"))
        XCTAssertFalse(NiimbotImage.calibrationOn, "off by default (no -sfl_niimbot_calibration launch argument)")
    }

    private static var loaded = false
}
