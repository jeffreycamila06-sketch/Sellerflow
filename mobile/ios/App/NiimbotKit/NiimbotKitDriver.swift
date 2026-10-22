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
// Every step logs "[Niimbot] …" (codes and sizes only, never buyer data). The printer is
// CLOSED on every exit (success, error, timeout). Single-flight. The SDK libraries have no
// simulator slice → the simulator build of this framework is a stub (NIIMBOT_UNAVAILABLE).
// ⚠️ UNVERIFIED ON HARDWARE until NIIMBOT's SDK usage permission arrives.
import Foundation
import UIKit

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
    private static var imageProcessingReady = false
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
                    self.printLabel(pngBase64: png.base64EncodedString(), name: name, wMm: wMm, hMm: hMm, finish: finish)
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

    private func printLabel(pngBase64: String, name: String, wMm: Float, hMm: Float, finish: @escaping (Bool, String, String) -> Void) {
        // Font resources (FONT.json + ZT001.ttf/ZT002.otf) live in THIS framework's bundle —
        // the SDK's drawing board needs its image/font processor initialised once.
        if !NiimbotKitDriver.imageProcessingReady {
            let bundle = Bundle(for: NiimbotKitDriver.self)
            guard let path = bundle.resourcePath, bundle.path(forResource: "FONT", ofType: "json") != nil, bundle.path(forResource: "ZT001", ofType: "ttf") != nil else {
                NSLog("[Niimbot] font resources missing in the framework bundle")
                finish(false, "NIIMBOT_ERROR", "Resources missing"); return
            }
            var initErr: NSError?
            JCAPI.initImageProcessing(path, error: &initErr) // void + NSError** in JCAPI.h (not a throwing import)
            if let e = initErr {
                NSLog("[Niimbot] initImageProcessing FAILED: %@", e.localizedDescription)
                finish(false, "NIIMBOT_ERROR", "Label renderer failed: \(e.localizedDescription)"); return
            }
            NSLog("[Niimbot] initImageProcessing ok")
            NiimbotKitDriver.imageProcessingReady = true
        }
        JCAPI.setPrintWithCache(true)
        JCAPI.initDrawingBoard(wMm, withHeight: hMm, withHorizontalShift: 0, withVerticalShift: 0, rotate: 0, fontArray: ["ZT001.ttf"])
        NSLog("[Niimbot] initDrawingBoard %.0fx%.0f mm rotate 0", wMm, hMm)
        let drawn = JCAPI.drawLableImage(0, withY: 0, withWidth: wMm, withHeight: hMm, withImageData: pngBase64, withRotate: 0, withImageProcessingType: 1, withImageProcessingValue: 127)
        NSLog("[Niimbot] DrawLableImage → %d", drawn ? 1 : 0)
        guard drawn else { finish(false, "NIIMBOT_ERROR", "The label image was not accepted"); return }
        guard let json = JCAPI.generateLableJson(), !json.isEmpty else {
            NSLog("[Niimbot] GenerateLableJson → empty")
            finish(false, "NIIMBOT_ERROR", "Could not prepare the label"); return
        }
        NSLog("[Niimbot] GenerateLableJson → %d chars", json.count)
        // The SDK's own preview of the board: if it carries no ink, nothing would print — stop
        // here instead of feeding a blank label (this is the exact symptom to diagnose).
        do {
            let preview = try JCAPI.generateImagePreviewImage(1.0) // UIImage* + NSError** → a throwing import
            let ink = NiimbotKitLogic.inkPixels(in: preview)
            NSLog("[Niimbot] preview %dx%d px, ink pixels=%d", Int(preview.size.width * preview.scale), Int(preview.size.height * preview.scale), ink)
            if ink == 0 { finish(false, "NIIMBOT_ERROR", "The label image did not reach the printer board"); return }
        } catch {
            NSLog("[Niimbot] preview unavailable: %@", error.localizedDescription)
        }
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
