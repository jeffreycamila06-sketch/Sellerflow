// NiimbotTransport.swift — the app side of Niimbot printing (printer setup v2, Part 8).
//
// The Niimbot vendor SDK lives in the SEPARATE embedded NiimbotKit.framework (min iOS 17.2,
// see ../NiimbotKit). This app binary NEVER links it, so the app stays at iOS 15.0 with zero
// Niimbot/Skia symbols. On iOS 17.2+ the loader dlopen()s the embedded framework once, looks
// up the "NiimbotKitDriver" class by name and talks to it through the SFLNiimbotDriving
// Objective-C protocol (App-Bridging-Header.h). On older iOS, or when loading fails, every
// print answers a seller-level code (NIIMBOT_OS_TOO_OLD / NIIMBOT_UNAVAILABLE) — never a crash.
//
// The web sends the 1-bit sticker image (rows packed MSB first, bit 1 = ink); NiimbotImage turns
// it into a plain RGBA PNG (black ink on white) — the form the SDK's DrawLableImage decodes —
// BEFORE the framework is involved, so the conversion is unit-tested in AppTests.
import Foundation
import UIKit

struct NiimbotResult {
    let ok: Bool
    let code: String
    let message: String
}

enum NiimbotImage {
    /// Packed 1-bit rows → RGBA PNG bytes (opaque, black = ink, white = paper). nil = bad geometry.
    static func png(packed: Data, w: Int, h: Int, rowBytes: Int) -> Data? {
        guard w > 0, h > 0, rowBytes > 0, packed.count >= rowBytes * h else { return nil }
        var rgba = [UInt8](repeating: 255, count: w * h * 4) // white, alpha 255
        packed.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
            for y in 0..<h {
                for x in 0..<w where (raw[y * rowBytes + (x >> 3)] & UInt8(0x80 >> (x & 7))) != 0 {
                    let i = (y * w + x) * 4
                    rgba[i] = 0; rgba[i + 1] = 0; rgba[i + 2] = 0 // ink: black
                }
            }
        }
        guard let provider = CGDataProvider(data: Data(rgba) as CFData),
              let cg = CGImage(width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4,
                               space: CGColorSpaceCreateDeviceRGB(),
                               bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.noneSkipLast.rawValue),
                               provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent) else { return nil }
        return UIImage(cgImage: cg).pngData()
    }

    /// Dark pixels (gray < 128) in a decoded image. -1 = could not read the image.
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

enum NiimbotLoader {
    /// iOS 17.2+ = the embedded framework may be loaded (its SDK is built for 17.2).
    static var osSupported: Bool {
        if #available(iOS 17.2, *) { return true }
        return false
    }
    private static var attempted = false
    private static var cached: SFLNiimbotDriving?

    /// dlopen the embedded NiimbotKit.framework (once) and instantiate its driver. nil = not
    /// loadable (old iOS, framework missing, dlopen failure, class missing) — the caller
    /// turns that into a seller-level message.
    static func driver() -> SFLNiimbotDriving? {
        guard #available(iOS 17.2, *) else { return nil }
        if attempted { return cached }
        attempted = true
        guard let dir = Bundle.main.privateFrameworksPath else { return nil }
        let path = dir + "/NiimbotKit.framework/NiimbotKit"
        guard FileManager.default.fileExists(atPath: path) else {
            NSLog("[Niimbot] loader: framework not embedded at %@", path)
            return nil
        }
        guard dlopen(path, RTLD_NOW) != nil else {
            let err = dlerror().map { String(cString: $0) } ?? "unknown dlopen error"
            NSLog("[Niimbot] loader: dlopen failed: %@", err)
            return nil
        }
        guard let cls = NSClassFromString("NiimbotKitDriver") as? NSObject.Type else {
            NSLog("[Niimbot] loader: NiimbotKitDriver class not found after dlopen")
            return nil
        }
        cached = cls.init() as? SFLNiimbotDriving
        NSLog("[Niimbot] loader: driver %@", cached == nil ? "does not conform to SFLNiimbotDriving" : "ready")
        return cached
    }
}

final class NiimbotTransport {
    /// The plugin's OS gate: false = iOS < 17.2 (NIIMBOT_OS_TOO_OLD before any load attempt).
    static var isAvailable: Bool { NiimbotLoader.osSupported }

    func printImage(name: String, packed: Data, w: Int, h: Int, rowBytes: Int, wMm: Float, hMm: Float, completion: @escaping (NiimbotResult) -> Void) {
        guard NiimbotLoader.osSupported else {
            completion(NiimbotResult(ok: false, code: "NIIMBOT_OS_TOO_OLD", message: "This printer needs iOS 17.2 or newer")); return
        }
        guard let driver = NiimbotLoader.driver() else {
            completion(NiimbotResult(ok: false, code: "NIIMBOT_UNAVAILABLE", message: "The Niimbot driver could not be loaded")); return
        }
        guard let png = NiimbotImage.png(packed: packed, w: w, h: h, rowBytes: rowBytes) else {
            NSLog("[Niimbot] app: bad image geometry w=%d h=%d rowBytes=%d bytes=%d", w, h, rowBytes, packed.count)
            completion(NiimbotResult(ok: false, code: "BT_PRINT_FAILED", message: "Bad image data")); return
        }
        NSLog("[Niimbot] app: %dx%d 1-bit → RGBA png %d bytes, label %.0fx%.0f mm", w, h, png.count, wMm, hMm)
        driver.printLabel(withName: name, png: png, labelWidthMm: wMm, labelHeightMm: hMm) { ok, code, message in
            completion(NiimbotResult(ok: ok, code: code, message: message))
        }
    }
}
