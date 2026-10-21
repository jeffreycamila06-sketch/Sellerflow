// NiimbotTransport.swift — Niimbot label printers (B1 / B21 / D11 / D110 / …) through the
// vendor iOS SDK (App/Niimbot: libJCAPI.a + libJCLPAPI.a + libSkiaRenderLibrary.a, JCAPI.h).
// Printer setup v2, Part 8 — a SEPARATE transport: the D520BT BleStickerTransport, the
// GenericBleTransport and every TSPL builder are untouched.
//
// Job = the SAME sticker image the app renders (1-bit rows, bit 1 = ink), printed as one
// label, mirroring the zh4dev/niimbot-printer reference (MIT) call sequence:
//   openPrinter(name) → initImageProcessing(bundle fonts) → initDrawingBoard(w,h) →
//   DrawLableImage(PNG) → GenerateLableJson → startJob(density, paper 1 = gap) →
//   commit(json, 1 copy) → printing-count 1 → endPrint → done.
// The SDK's error codes become seller-level codes (NIIMBOT_NO_PAPER, …). Single-flight.
// The libraries are arm64 DEVICE slices only → the simulator gets the stub below
// (BT_UNAVAILABLE), so the XCTest gate keeps compiling and the App module is unchanged.
// ⚠️ UNVERIFIED ON HARDWARE until NIIMBOT's SDK usage permission arrives.
import Foundation
import UIKit

struct NiimbotResult {
    let ok: Bool
    let code: String
    let message: String
}

enum NiimbotLogic {
    /// Print density per model family (SDK docs: B-series 1–5 default 3; D-series / B18 1–3 default 2).
    static func density(forName name: String?) -> Int {
        let n = (name ?? "").trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        if n.hasPrefix("D11") || n.hasPrefix("D110") || n.hasPrefix("D101") || n.hasPrefix("B18") { return 2 }
        return 3
    }

    /// SDK print error code → our seller-level code.
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

/// Simulator stub: the vendor libraries have no simulator slice.
final class NiimbotTransport {
    static let isAvailable = false
    func printImage(name: String, packed: Data, w: Int, h: Int, rowBytes: Int, wMm: Float, hMm: Float, completion: @escaping (NiimbotResult) -> Void) {
        completion(NiimbotResult(ok: false, code: "NIIMBOT_UNAVAILABLE", message: "Niimbot driver is not available in the simulator"))
    }
}

#else

final class NiimbotTransport {
    static let isAvailable = true
    private static let printTimeout: TimeInterval = 30
    private static let openTimeout: TimeInterval = 15
    private static var imageProcessingReady = false
    private let queue = DispatchQueue(label: "com.sellerflow.niimbot")
    private var busy = false

    func printImage(name: String, packed: Data, w: Int, h: Int, rowBytes: Int, wMm: Float, hMm: Float, completion: @escaping (NiimbotResult) -> Void) {
        queue.async {
            if self.busy {
                DispatchQueue.main.async { completion(NiimbotResult(ok: false, code: "BT_BUSY", message: "Another printer task is still in progress.")) }
                return
            }
            self.busy = true
            var finished = false
            let finish: (NiimbotResult) -> Void = { r in
                self.queue.async {
                    if finished { return }
                    finished = true
                    self.busy = false
                    DispatchQueue.main.async { completion(r) }
                }
            }
            guard let png = NiimbotLogic.pngBase64(packed: packed, w: w, h: h, rowBytes: rowBytes) else {
                finish(NiimbotResult(ok: false, code: "BT_PRINT_FAILED", message: "Bad image data")); return
            }
            DispatchQueue.main.async {
                self.open(name: name) { ok in
                    if !ok { finish(NiimbotResult(ok: false, code: "BT_NOT_FOUND", message: "Could not connect to the printer")); return }
                    self.printLabel(png: png, name: name, wMm: wMm, hMm: hMm, finish: finish)
                }
            }
            self.queue.asyncAfter(deadline: .now() + NiimbotTransport.printTimeout + NiimbotTransport.openTimeout) {
                if !finished { JCAPI.cancelJob { _ in }; finish(NiimbotResult(ok: false, code: "BT_PRINT_FAILED", message: "Print timed out")) }
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
        DispatchQueue.main.asyncAfter(deadline: .now() + NiimbotTransport.openTimeout) {
            if !answered { answered = true; completion(false) }
        }
    }

    private func printLabel(png: String, name: String, wMm: Float, hMm: Float, finish: @escaping (NiimbotResult) -> Void) {
        // Font resources (FONT.json + ZT001.ttf/ZT002.otf, bundled) — the SDK's drawing board
        // needs its image/font processor initialised once, even for an image-only label.
        if !NiimbotTransport.imageProcessingReady {
            guard let path = Bundle.main.resourcePath else { finish(NiimbotResult(ok: false, code: "NIIMBOT_ERROR", message: "Resources missing")); return }
            var initErr: NSError?
            JCAPI.initImageProcessing(path, error: &initErr) // void + NSError** in JCAPI.h (not a throwing import)
            if let e = initErr {
                finish(NiimbotResult(ok: false, code: "NIIMBOT_ERROR", message: "Label renderer failed: \(e.localizedDescription)")); return
            }
            NiimbotTransport.imageProcessingReady = true
        }
        JCAPI.setPrintWithCache(true)
        JCAPI.initDrawingBoard(wMm, withHeight: hMm, withHorizontalShift: 0, withVerticalShift: 0, rotate: 0, fontArray: ["ZT001.ttf"])
        _ = JCAPI.drawLableImage(0, withY: 0, withWidth: wMm, withHeight: hMm, withImageData: png, withRotate: 0, withImageProcessingType: 1, withImageProcessingValue: 127)
        guard let json = JCAPI.generateLableJson(), !json.isEmpty else {
            finish(NiimbotResult(ok: false, code: "NIIMBOT_ERROR", message: "Could not prepare the label")); return
        }
        JCAPI.getPrintingErrorInfo { info in
            let code = Int((info ?? "").trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
            finish(NiimbotResult(ok: false, code: NiimbotLogic.code(forSdkError: code), message: "Printer error \(code)"))
        }
        JCAPI.getPrintingCountInfo { info in
            let total = (info?["totalCount"] as? NSNumber)?.intValue ?? 0
            if total >= 1 {
                JCAPI.endPrint { ok in
                    finish(ok ? NiimbotResult(ok: true, code: "", message: "Sent to printer")
                              : NiimbotResult(ok: false, code: "NIIMBOT_ERROR", message: "End of print not confirmed"))
                }
            }
        }
        JCAPI.setTotalQuantityOfPrints(1)
        JCAPI.startJob(Int32(NiimbotLogic.density(forName: name)), withPaperStyle: 1) { started in
            if !started { finish(NiimbotResult(ok: false, code: "NIIMBOT_ERROR", message: "Could not start the print job")); return }
            JCAPI.commit(json, withOnePageNumbers: 1) { committed in
                if !committed { finish(NiimbotResult(ok: false, code: "NIIMBOT_ERROR", message: "Could not send the label")) }
            }
        }
    }
}

#endif
