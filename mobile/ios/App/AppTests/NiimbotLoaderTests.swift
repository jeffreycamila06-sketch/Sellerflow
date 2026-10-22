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

    // The image the SDK gets: a plain RGBA PNG with black ink on white, same pixel geometry as
    // the 1-bit sticker image. A blank label is exactly what a wrong polarity / unreadable
    // format would produce, so the conversion is pinned here.
    func testPackedBitsBecomeBlackOnWhiteRgbaPng() {
        let w = 384, h = 240, rowBytes = 48
        var packed = Data(count: rowBytes * h)
        packed[0] = 0x80            // (0,0) ink
        packed[10 * rowBytes + 3] = 0x01 // (31,10) ink
        guard let png = NiimbotImage.png(packed: packed, w: w, h: h, rowBytes: rowBytes), let img = UIImage(data: png), let cg = img.cgImage else {
            return XCTFail("png conversion failed")
        }
        XCTAssertEqual(cg.width, w); XCTAssertEqual(cg.height, h)
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
    }

    func testAllWhiteImageHasZeroInk() {
        let png = NiimbotImage.png(packed: Data(count: 48 * 240), w: 384, h: 240, rowBytes: 48)!
        XCTAssertEqual(NiimbotImage.inkPixels(in: UIImage(data: png)!), 0)
    }

    private static var loaded = false
}
