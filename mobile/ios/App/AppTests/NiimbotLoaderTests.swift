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
        let w = 384, h = 224, rowBytes = 48
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
        XCTAssertEqual(inkPixels(in: img), 2)
        XCTAssertNil(NiimbotImage.image(packed: Data(count: 10), w: w, h: h, rowBytes: rowBytes)) // short data → nil
    }

    // 1:1 — the BMP measures exactly the SDK frame's dots: a 50×30 label with the 1 mm inset
    // = 48×28 mm × 8 = 384×224, which is what the web renders (printing.ts NIIMBOT_FRAME_DOTS).
    // The image is passed through untouched; the SDK then scales by 1.0 (never re-samples).
    func testBmpIsExactlyTheFrameDots() {
        XCTAssertEqual(NiimbotImage.frameInsetMm, 1)
        let frame = NiimbotImage.frameDots(wMm: 50, hMm: 30)
        XCTAssertEqual(frame.w, 384); XCTAssertEqual(frame.h, 224)
        XCTAssertEqual(frame.w, (50 - 2) * NiimbotImage.dotsPerMm); XCTAssertEqual(frame.h, (30 - 2) * NiimbotImage.dotsPerMm)
        let rowBytes = 48
        var packed = Data(count: rowBytes * frame.h)
        packed[0] = 0x80 // (0,0) ink
        packed[223 * rowBytes + 47] = 0x01 // (383,223) ink — the last dot
        guard let bmp = NiimbotImage.image(packed: packed, w: frame.w, h: frame.h, rowBytes: rowBytes, frameW: frame.w, frameH: frame.h),
              let img = UIImage(data: bmp), let cg = img.cgImage else { return XCTFail("bmp conversion failed") }
        XCTAssertEqual(cg.width, 384); XCTAssertEqual(cg.height, 224)
        XCTAssertEqual(le32(bmp, 18), 384); XCTAssertEqual(le32(bmp, 22), 224)
        XCTAssertEqual(inkPixels(in: img), 2)
        let rowSize = ((384 * 3 + 3) / 4) * 4, row0 = 54 + 223 * rowSize, rowLast = 54
        XCTAssertEqual(Array(bmp[row0..<row0 + 3]), [0, 0, 0], "no offset: dot (0,0) stays at (0,0)")
        XCTAssertEqual(Array(bmp[rowLast + 383 * 3..<rowLast + 383 * 3 + 3]), [0, 0, 0], "the last dot stays the last dot")
    }

    // An image of another size (an older web bundle's 384×240 label-sized raster) is fitted to
    // the frame centred — cropped or white-padded, never scaled — so the SDK still gets 1:1 dots.
    func testOtherSizesAreFittedToTheFrameNeverScaled() {
        let w = 384, h = 240, rowBytes = 48
        var packed = Data(count: rowBytes * h)
        packed[8 * rowBytes] = 0x80 // (0,8) ink — the first row that survives an 8-dot crop
        packed[0] = 0x80            // (0,0) ink — cropped away
        guard let bmp = NiimbotImage.image(packed: packed, w: w, h: h, rowBytes: rowBytes, frameW: 384, frameH: 224),
              let img = UIImage(data: bmp), let cg = img.cgImage else { return XCTFail("bmp conversion failed") }
        XCTAssertEqual(cg.width, 384); XCTAssertEqual(cg.height, 224)
        XCTAssertEqual(inkPixels(in: img), 1)
        let rowSize = ((384 * 3 + 3) / 4) * 4, row0 = 54 + 223 * rowSize
        XCTAssertEqual(Array(bmp[row0..<row0 + 3]), [0, 0, 0], "dot (0,8) lands at (0,0) after the centred 8-dot crop")
        // smaller than the frame → white-padded, centred
        var small = Data(count: 13 * 100); small[0] = 0x80
        let padded = NiimbotImage.image(packed: small, w: 100, h: 100, rowBytes: 13, frameW: 384, frameH: 224)!
        XCTAssertEqual(le32(padded, 18), 384); XCTAssertEqual(le32(padded, 22), 224)
        XCTAssertEqual(inkPixels(in: UIImage(data: padded)!), 1)
        let prow = 54 + (223 - 62) * rowSize // (0,0) of the small image → (142, 62)
        XCTAssertEqual(Array(padded[prow + 142 * 3..<prow + 142 * 3 + 3]), [0, 0, 0])
        // no frame given = the image's own size
        XCTAssertEqual(le32(NiimbotImage.image(packed: packed, w: w, h: h, rowBytes: rowBytes)!, 22), 240)
    }

    func testAllWhiteImageHasZeroInk() {
        let bmp = NiimbotImage.image(packed: Data(count: 48 * 224), w: 384, h: 224, rowBytes: 48)!
        XCTAssertEqual(inkPixels(in: UIImage(data: bmp)!), 0)
    }

    /// Dark pixels (gray < 128) in a decoded image — a test probe through a gray context.
    private func inkPixels(in image: UIImage) -> Int {
        guard let cg = image.cgImage, cg.width > 0, cg.height > 0 else { return -1 }
        let w = cg.width, h = cg.height
        var gray = [UInt8](repeating: 255, count: w * h)
        gray.withUnsafeMutableBytes { buf in
            let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue)!
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        }
        var n = 0
        for v in gray where v < 128 { n += 1 }
        return n
    }

    private func le32(_ d: Data, _ at: Int) -> Int { Int(d[at]) | Int(d[at + 1]) << 8 | Int(d[at + 2]) << 16 | Int(d[at + 3]) << 24 }

    private static var loaded = false
}
