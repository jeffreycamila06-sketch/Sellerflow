// NiimbotKitDriver.swift — Niimbot label printers (B1 / B21 / D11 / D110 / …) through the
// vendor iOS SDK, inside the SEPARATE embedded NiimbotKit.framework (min iOS 17.2).
//
// The app never links this framework: on iOS 17.2+ it dlopen()s it, finds this class by its
// Objective-C name ("NiimbotKitDriver") and calls it through SFLNiimbotDriving. The SDK's
// static libraries are built for iOS 17.2, so keeping them in here (and never loading the
// framework on older iOS) keeps the app itself at iOS 15.0 with zero Niimbot symbols.
//
// Job = the SAME sticker image the app renders (1-bit rows, bit 1 = ink), printed as one
// label, mirroring the zh4dev/niimbot-printer reference (MIT) call sequence:
//   openPrinter(name) → initImageProcessing(bundle fonts) → initDrawingBoard(w,h) →
//   DrawLableImage(PNG) → GenerateLableJson → startJob(density, paper 1 = gap) →
//   commit(json, 1 copy) → printing-count 1 → endPrint → done.
// Single-flight. The SDK libraries have no simulator slice → the simulator build of this
// framework is a stub that answers NIIMBOT_UNAVAILABLE.
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

    /// Packed 1-bit rows (MSB first, bit 1 = ink) → PNG → base64, the form DrawLableImage takes.
    static func pngBase64(packed: Data, w: Int, h: Int, rowBytes: Int) -> String? {
        guard w > 0, h > 0, rowBytes > 0, packed.count >= rowBytes * h else { return nil }
        var gray = [UInt8](repeating: 255, count: w * h)
        packed.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            for y in 0..<h {
                for x in 0..<w where (raw[y * rowBytes + (x >> 3)] & UInt8(0x80 >> (x & 7))) != 0 {
                    gray[y * w + x] = 0
                }
            }
        }
        guard let provider = CGDataProvider(data: Data(gray) as CFData),
              let cg = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: w,
                               space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.none.rawValue),
                               provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent),
              let png = UIImage(cgImage: cg).pngData() else { return nil }
        return png.base64EncodedString()
    }
}

#if targetEnvironment(simulator)

/// Simulator stub: the vendor libraries have no simulator slice. Same class name + protocol so
/// the app's loader behaves identically; every print answers NIIMBOT_UNAVAILABLE.
@objc(NiimbotKitDriver) public final class NiimbotKitDriver: NSObject, SFLNiimbotDriving {
    public override init() { super.init() }
    public func printImage(withName name: String, packed: Data, width: Int, height: Int, rowBytes: Int, labelWidthMm: Float, labelHeightMm: Float, completion: @escaping SFLNiimbotCompletion) {
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

    public func printImage(withName name: String, packed: Data, width w: Int, height h: Int, rowBytes: Int, labelWidthMm wMm: Float, labelHeightMm hMm: Float, completion: @escaping SFLNiimbotCompletion) {
        queue.async {
            if self.busy {
                DispatchQueue.main.async { completion(false, "BT_BUSY", "Another printer task is still in progress.") }
                return
            }
            self.busy = true
            var finished = false
            let finish: (Bool, String, String) -> Void = { ok, code, message in
                self.queue.async {
                    if finished { return }
                    finished = true
                    self.busy = false
                    DispatchQueue.main.async { completion(ok, code, message) }
                }
            }
            guard let png = NiimbotKitLogic.pngBase64(packed: packed, w: w, h: h, rowBytes: rowBytes) else {
                finish(false, "BT_PRINT_FAILED", "Bad image data"); return
            }
            DispatchQueue.main.async {
                self.open(name: name) { ok in
                    if !ok { finish(false, "BT_NOT_FOUND", "Could not connect to the printer"); return }
                    self.printLabel(png: png, name: name, wMm: wMm, hMm: hMm, finish: finish)
                }
            }
            self.queue.asyncAfter(deadline: .now() + NiimbotKitDriver.printTimeout + NiimbotKitDriver.openTimeout) {
                if !finished { JCAPI.cancelJob { _ in }; finish(false, "BT_PRINT_FAILED", "Print timed out") }
            }
        }
    }

    // The SDK connects by printer NAME (its own scan lists names). Reuse a live connection to
    // the same printer; otherwise close and open.
    private func open(name: String, completion: @escaping (Bool) -> Void) {
        let current = JCAPI.connectingPrinterName() ?? ""
        if JCAPI.isConnectingState() != 0, current == name { completion(true); return }
        if !current.isEmpty { JCAPI.closePrinter() }
        var answered = false
        JCAPI.openPrinter(name) { ok in
            if answered { return }
            answered = true
            completion(ok)
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + NiimbotKitDriver.openTimeout) {
            if !answered { answered = true; completion(false) }
        }
    }

    private func printLabel(png: String, name: String, wMm: Float, hMm: Float, finish: @escaping (Bool, String, String) -> Void) {
        // Font resources (FONT.json + ZT001.ttf/ZT002.otf) live in THIS framework's bundle —
        // the SDK's drawing board needs its image/font processor initialised once.
        if !NiimbotKitDriver.imageProcessingReady {
            guard let path = Bundle(for: NiimbotKitDriver.self).resourcePath else { finish(false, "NIIMBOT_ERROR", "Resources missing"); return }
            var initErr: NSError?
            JCAPI.initImageProcessing(path, error: &initErr) // void + NSError** in JCAPI.h (not a throwing import)
            if let e = initErr { finish(false, "NIIMBOT_ERROR", "Label renderer failed: \(e.localizedDescription)"); return }
            NiimbotKitDriver.imageProcessingReady = true
        }
        JCAPI.setPrintWithCache(true)
        JCAPI.initDrawingBoard(wMm, withHeight: hMm, withHorizontalShift: 0, withVerticalShift: 0, rotate: 0, fontArray: ["ZT001.ttf"])
        _ = JCAPI.drawLableImage(0, withY: 0, withWidth: wMm, withHeight: hMm, withImageData: png, withRotate: 0, withImageProcessingType: 1, withImageProcessingValue: 127)
        guard let json = JCAPI.generateLableJson(), !json.isEmpty else {
            finish(false, "NIIMBOT_ERROR", "Could not prepare the label"); return
        }
        JCAPI.getPrintingErrorInfo { info in
            let code = Int((info ?? "").trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
            finish(false, NiimbotKitLogic.code(forSdkError: code), "Printer error \(code)")
        }
        JCAPI.getPrintingCountInfo { info in
            let total = (info?["totalCount"] as? NSNumber)?.intValue ?? 0
            if total >= 1 {
                JCAPI.endPrint { ok in
                    if ok { finish(true, "", "Sent to printer") } else { finish(false, "NIIMBOT_ERROR", "End of print not confirmed") }
                }
            }
        }
        JCAPI.setTotalQuantityOfPrints(1)
        JCAPI.startJob(Int32(NiimbotKitLogic.density(forName: name)), withPaperStyle: 1) { started in
            if !started { finish(false, "NIIMBOT_ERROR", "Could not start the print job"); return }
            JCAPI.commit(json, withOnePageNumbers: 1) { committed in
                if !committed { finish(false, "NIIMBOT_ERROR", "Could not send the label") }
            }
        }
    }
}

#endif
