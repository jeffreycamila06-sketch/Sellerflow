// NiimbotKitDriver.swift — Niimbot label printers (B1 / B21 / B203 / B3S) through the vendor
// iOS SDK, inside the SEPARATE embedded NiimbotKit.framework (min iOS 17.2).
//
// The app never links this framework: on iOS 17.2+ it dlopen()s it, finds this class by its
// Objective-C name ("NiimbotKitDriver") and calls it through SFLNiimbotDriving. The SDK's
// static libraries are built for iOS 17.2, so keeping them in here (and never loading the
// framework on older iOS) keeps the app itself at iOS 15.0 with zero Niimbot symbols.
//
// Job = ONE label from a ready PNG (the app's sticker image, RGBA, black on white), the same
// call sequence as the zh4dev/niimbot-printer reference (MIT) and NIIMBOT's SDKDemoOC:
//   openPrinter(name) → initImageProcessing(this bundle's FONT.json + fonts) →
//   setPrintWithCache → initDrawingBoard(w,h mm, rotate 0) → DrawLableImage(PNG base64, type 1,
//   threshold 127) → GenerateLableJson → [preview ink check] → getPrintingErrorInfo /
//   getPrintingCountInfo → setTotalQuantityOfPrints(1) → startJob(density, paper 1 = gap) →
//   commit(json, 1) → count callback totalCount ≥ 1 → endPrint → done.
// DIAGNOSTIC BUILD (B1 field test: DrawLableImage → 0): one tap tries a text sanity draw
// then image variants b–f (RGB-no-alpha PNG / JPEG / data-URL / main thread / 400-dot canvas),
// logs "[Niimbot] try <name> → 0/1 (json= ink=)" for each and prints with the first accepted.
// Every step logs "[Niimbot] …" (codes and sizes only, never buyer data). The printer is
// CLOSED on every exit (success, error, timeout). Single-flight. The SDK libraries have no
// simulator slice → the simulator build of this framework is a stub (NIIMBOT_UNAVAILABLE).
// ⚠️ UNVERIFIED ON HARDWARE until NIIMBOT's SDK usage permission arrives.
import Foundation
import UIKit
import ImageIO

enum NiimbotKitLogic {
    /// Print density: only B-series 50 mm models are listed (SDK docs: B-series 1–5, default 3).
    static func density(forName name: String?) -> Int {
        return 3
    }

    /// SDK print error code → the app's seller-level code.
    static func code(forSdkError code: Int) -> String {
        switch code {
        case 1: return "NIIMBOT_COVER_OPEN"
        case 2: return "NIIMBOT_NO_PAPER"
        case 3, 4: return "NIIMBOT_LOW_BATTERY"
        case 16, 28: return "NIIMBOT_PAPER_TYPE"
        case 23: return "BT_NOT_FOUND"
        case 9: return "BT_BUSY"
        default: return "NIIMBOT_ERROR"
        }
    }

    /// Dark pixels (gray < 128) in an image — the SDK's own preview of the drawing board is
    /// checked with this BEFORE a label is fed: 0 ink = the image never reached the board.
    static func inkPixels(in image: UIImage) -> Int {
        guard let cg = image.cgImage, cg.width > 0, cg.height > 0 else { return -1 }
        let w = cg.width, h = cg.height
        var gray = [UInt8](repeating: 255, count: w * h)
        let drawn: Bool = gray.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                      space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return false }
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        if !drawn { return -1 }
        var n = 0
        for v in gray where v < 128 { n += 1 }
        return n
    }

    /// Re-encode an image as a plain 8-bit RGB PNG — NO alpha channel (kCGImageAlphaNoneSkipLast
    /// context, sRGB, scale 1), written through ImageIO so the file really has no alpha
    /// (UIImage.pngData() re-adds one). `width` = place the image centred on a wider white
    /// canvas of that many dots (diagnostic (f): the B1's real 203 dpi dots, 400 for 50 mm).
    static func rgbPng(_ image: UIImage, width: Int?) -> Data? {
        guard let cg = image.cgImage, cg.width > 0, cg.height > 0 else { return nil }
        let w = width ?? cg.width, h = cg.height
        guard w >= cg.width,
              let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB(),
                                  bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { return nil }
        ctx.setFillColor(red: 1, green: 1, blue: 1, alpha: 1)
        ctx.fill(CGRect(x: 0, y: 0, width: w, height: h))
        ctx.interpolationQuality = .none
        ctx.draw(cg, in: CGRect(x: (w - cg.width) / 2, y: 0, width: cg.width, height: cg.height))
        guard let out = ctx.makeImage() else { return nil }
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, out, nil)
        return CGImageDestinationFinalize(dest) ? data as Data : nil
    }

}

#if targetEnvironment(simulator)

/// Simulator stub: the vendor libraries have no simulator slice. Same class name + protocol so
/// the app's loader behaves identically; every print answers NIIMBOT_UNAVAILABLE.
@objc(NiimbotKitDriver) public final class NiimbotKitDriver: NSObject, SFLNiimbotDriving {
    public override init() { super.init() }
    public func printLabel(withName name: String, png: Data, labelWidthMm: Float, labelHeightMm: Float, completion: @escaping SFLNiimbotCompletion) {
        NSLog("[Niimbot] simulator stub: no SDK slice (png=%d bytes)", png.count)
        completion(false, "NIIMBOT_UNAVAILABLE", "Niimbot driver is not available in the simulator")
    }
}

#else

@objc(NiimbotKitDriver) public final class NiimbotKitDriver: NSObject, SFLNiimbotDriving {
    private static let printTimeout: TimeInterval = 30
    private static let openTimeout: TimeInterval = 15
    private let queue = DispatchQueue(label: "com.sellerflow.niimbotkit")
    private var busy = false

    public override init() { super.init() }

    public func printLabel(withName name: String, png: Data, labelWidthMm wMm: Float, labelHeightMm hMm: Float, completion: @escaping SFLNiimbotCompletion) {
        queue.async {
            if self.busy {
                NSLog("[Niimbot] busy: another job is running")
                DispatchQueue.main.async { completion(false, "BT_BUSY", "Another printer task is still in progress.") }
                return
            }
            self.busy = true
            var finished = false
            let t0 = Date()
            // ONE exit for every outcome: log it, close the printer, release the single-flight.
            let finish: (Bool, String, String) -> Void = { ok, code, message in
                self.queue.async {
                    if finished { return }
                    finished = true
                    NSLog("[Niimbot] finish ok=%d code=%@ after %.1fs — closing printer", ok ? 1 : 0, code, Date().timeIntervalSince(t0))
                    DispatchQueue.main.async {
                        JCAPI.closePrinter()
                        self.queue.async { self.busy = false }
                        completion(ok, code, message)
                    }
                }
            }
            NSLog("[Niimbot] job start: label %.0fx%.0f mm, png=%d bytes, density=%d", wMm, hMm, png.count, NiimbotKitLogic.density(forName: name))
            guard png.count > 0 else { finish(false, "BT_PRINT_FAILED", "Bad image data"); return }
            DispatchQueue.main.async {
                self.open(name: name) { ok in
                    NSLog("[Niimbot] openPrinter → %d (state=%d)", ok ? 1 : 0, JCAPI.isConnectingState())
                    if !ok { finish(false, "BT_NOT_FOUND", "Could not connect to the printer"); return }
                    self.printLabel(png: png, name: name, wMm: wMm, hMm: hMm, finish: finish)
                }
            }
            self.queue.asyncAfter(deadline: .now() + NiimbotKitDriver.printTimeout + NiimbotKitDriver.openTimeout) {
                if !finished {
                    NSLog("[Niimbot] TIMEOUT after %.0fs — cancelJob", NiimbotKitDriver.printTimeout + NiimbotKitDriver.openTimeout)
                    DispatchQueue.main.async { JCAPI.cancelJob { ok in NSLog("[Niimbot] cancelJob → %d", ok ? 1 : 0) } }
                    finish(false, "BT_PRINT_FAILED", "Print timed out")
                }
            }
        }
    }

    // The SDK connects by printer NAME (its own scan lists names). Reuse a live connection to
    // the same printer; otherwise close and open.
    private func open(name: String, completion: @escaping (Bool) -> Void) {
        let current = JCAPI.connectingPrinterName() ?? ""
        if JCAPI.isConnectingState() != 0, current == name { NSLog("[Niimbot] already connected"); completion(true); return }
        if !current.isEmpty { NSLog("[Niimbot] closing other printer first"); JCAPI.closePrinter() }
        var answered = false
        JCAPI.openPrinter(name) { ok in
            if answered { return }
            answered = true
            completion(ok)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + NiimbotKitDriver.openTimeout) {
            if !answered { answered = true; NSLog("[Niimbot] openPrinter: no answer in %.0fs", NiimbotKitDriver.openTimeout); completion(false) }
        }
    }

    // ── DIAGNOSTIC LADDER (B1 field test: DrawLableImage → 0 on the RGBA PNG) ──────────
    // One tap tries, in order, (a) a text sanity draw, then image variants (b)–(f); each
    // try logs "[Niimbot] try <name> → 0/1 (json=N ink=M)". The job prints with the FIRST
    // image variant the board accepts (drawn BOOL, or — the reference's rule: "some JCAPI
    // versions report NO even when the drawing command was accepted" — a non-empty JSON whose
    // preview carries ink) and remembers it for the next taps. No image variant accepted but
    // the text was → the TEST text label is printed (paper proof that the board works).
    private struct ImageTry { let name: String; let base64: String?; let onMain: Bool }
    private static var workingVariant: String?

    private func printLabel(png: Data, name: String, wMm: Float, hMm: Float, finish: @escaping (Bool, String, String) -> Void) {
        NSLog("[Niimbot] drawing thread: main=%d", Thread.isMainThread ? 1 : 0)
        // Font resources (FONT.json + ZT001.ttf/ZT002.otf) live in THIS framework's bundle.
        // Like the reference, initImageProcessing runs on EVERY job (the second tap of the
        // field test skipped it — removed the once-flag so each job logs its error object).
        let bundle = Bundle(for: NiimbotKitDriver.self)
        guard let path = bundle.resourcePath, bundle.path(forResource: "FONT", ofType: "json") != nil, bundle.path(forResource: "ZT001", ofType: "ttf") != nil else {
            NSLog("[Niimbot] font resources missing in the framework bundle (resourcePath=%@)", bundle.resourcePath ?? "nil")
            finish(false, "NIIMBOT_ERROR", "Resources missing"); return
        }
        var initErr: NSError?
        JCAPI.initImageProcessing(path, error: &initErr) // void + NSError** in JCAPI.h (not a throwing import)
        NSLog("[Niimbot] initImageProcessing resourcePath=%@ error=%@", path, initErr.map { "\($0.domain)#\($0.code) \($0.localizedDescription) \($0.userInfo)" } ?? "nil")
        if let e = initErr { finish(false, "NIIMBOT_ERROR", "Label renderer failed: \(e.localizedDescription)"); return }
        JCAPI.setPrintWithCache(true)

        let b64 = png.base64EncodedString()
        NSLog("[Niimbot] base64 length=%d first30=%@", b64.count, String(b64.prefix(30)))

        // (a) sanity: text on a fresh board
        let textOk = drawTextTry(wMm: wMm, hMm: hMm)

        let decoded = UIImage(data: png)
        let tries: [ImageTry] = [
            ImageTry(name: "b-rgb-png-noalpha-srgb", base64: decoded.flatMap { NiimbotKitLogic.rgbPng($0, width: nil) }?.base64EncodedString(), onMain: false),
            ImageTry(name: "c-jpeg-0.9", base64: decoded?.jpegData(compressionQuality: 0.9)?.base64EncodedString(), onMain: false),
            ImageTry(name: "d-data-url-png", base64: "data:image/png;base64," + b64, onMain: false),
            ImageTry(name: "e-main-thread-png", base64: b64, onMain: true),
            ImageTry(name: "f-400x240-rgb-png", base64: decoded.flatMap { NiimbotKitLogic.rgbPng($0, width: 400) }?.base64EncodedString(), onMain: true),
        ]
        var ordered = tries
        if let known = NiimbotKitDriver.workingVariant, let i = tries.firstIndex(where: { $0.name == known }) {
            ordered = [tries[i]] + tries.enumerated().filter { $0.offset != i }.map { $0.element } // remembered winner first
        }
        var json: String?
        var winner: String?
        for t in ordered {
            guard let data = t.base64 else { NSLog("[Niimbot] try %@ → skipped (could not encode)", t.name); continue }
            let run = { self.drawImageTry(t.name, base64: data, wMm: wMm, hMm: hMm) }
            let result: String? = (t.onMain && !Thread.isMainThread) ? DispatchQueue.main.sync(execute: run) : run()
            if let j = result { json = j; winner = t.name; break }
        }
        if let w = winner {
            NiimbotKitDriver.workingVariant = w
            NSLog("[Niimbot] printing with variant %@ (remembered)", w)
        } else if textOk {
            NSLog("[Niimbot] no image variant accepted — printing the TEST text label instead")
            _ = drawTextTry(wMm: wMm, hMm: hMm)
            json = JCAPI.generateLableJson()
        }
        guard let labelJson = json, !labelJson.isEmpty else {
            finish(false, "NIIMBOT_ERROR", "The label image was not accepted (text sanity=\(textOk ? 1 : 0))"); return
        }
        startPrint(json: labelJson, name: name, finish: finish)
    }

    /// Fresh board + "TEST" text. Logged as "try a-text".
    private func drawTextTry(wMm: Float, hMm: Float) -> Bool {
        JCAPI.initDrawingBoard(wMm, withHeight: hMm, withHorizontalShift: 0, withVerticalShift: 0, rotate: 0, fontArray: ["ZT001.ttf"])
        let drawn = JCAPI.drawLableText(0, withY: 0, withWidth: 50, withHeight: 10, with: "TEST", withFontFamily: "ZT001.ttf", withFontSize: 4, withRotate: 0,
                                        withTextAlignHorizonral: 0, withTextAlignVertical: 1, withLineMode: 6, withLetterSpacing: 0, withLineSpacing: 1, withFontStyle: [0, 0, 0, 0])
        let (jsonLen, ink) = boardState()
        NSLog("[Niimbot] try a-text → %d (json=%d ink=%d)", drawn ? 1 : 0, jsonLen, ink)
        return drawn || (jsonLen > 0 && ink > 0)
    }

    /// Fresh board + the image variant. Returns the label JSON when the board accepted it.
    private func drawImageTry(_ name: String, base64: String, wMm: Float, hMm: Float) -> String? {
        JCAPI.initDrawingBoard(wMm, withHeight: hMm, withHorizontalShift: 0, withVerticalShift: 0, rotate: 0, fontArray: ["ZT001.ttf"])
        let drawn = JCAPI.drawLableImage(0, withY: 0, withWidth: wMm, withHeight: hMm, withImageData: base64, withRotate: 0, withImageProcessingType: 1, withImageProcessingValue: 127)
        let (jsonLen, ink) = boardState()
        NSLog("[Niimbot] try %@ → %d (json=%d ink=%d main=%d b64=%d)", name, drawn ? 1 : 0, jsonLen, ink, Thread.isMainThread ? 1 : 0, base64.count)
        guard drawn || (jsonLen > 0 && ink > 0) else { return nil }
        guard let json = JCAPI.generateLableJson(), !json.isEmpty else { return nil }
        return json
    }

    /// (label JSON length, preview ink pixels) of the current board; -1 ink = no preview.
    private func boardState() -> (Int, Int) {
        let jsonLen = JCAPI.generateLableJson()?.count ?? 0
        var ink = -1
        do {
            let preview = try JCAPI.generateImagePreviewImage(1.0) // UIImage* + NSError** → a throwing import
            ink = NiimbotKitLogic.inkPixels(in: preview)
        } catch {
            NSLog("[Niimbot] preview unavailable: %@", error.localizedDescription)
        }
        return (jsonLen, ink)
    }

    private func startPrint(json: String, name: String, finish: @escaping (Bool, String, String) -> Void) {
        JCAPI.getPrintingErrorInfo { info in
            let code = Int((info ?? "").trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
            NSLog("[Niimbot] printing error callback: %d", code)
            finish(false, NiimbotKitLogic.code(forSdkError: code), "Printer error \(code)")
        }
        JCAPI.getPrintingCountInfo { info in
            let total = (info?["totalCount"] as? NSNumber)?.intValue ?? 0
            NSLog("[Niimbot] printing count callback: totalCount=%d", total)
            if total >= 1 {
                JCAPI.endPrint { ok in
                    NSLog("[Niimbot] endPrint → %d", ok ? 1 : 0)
                    if ok { finish(true, "", "Sent to printer") } else { finish(false, "NIIMBOT_ERROR", "End of print not confirmed") }
                }
            }
        }
        JCAPI.setTotalQuantityOfPrints(1)
        let density = Int32(NiimbotKitLogic.density(forName: name))
        NSLog("[Niimbot] startJob density=%d paperStyle=1 (gap)", density)
        JCAPI.startJob(density, withPaperStyle: 1) { started in
            NSLog("[Niimbot] startJob → %d", started ? 1 : 0)
            if !started { finish(false, "NIIMBOT_ERROR", "Could not start the print job"); return }
            JCAPI.commit(json, withOnePageNumbers: 1) { committed in
                NSLog("[Niimbot] commit → %d (waiting for the count callback)", committed ? 1 : 0)
                if !committed { finish(false, "NIIMBOT_ERROR", "Could not send the label") }
            }
        }
    }
}

#endif
