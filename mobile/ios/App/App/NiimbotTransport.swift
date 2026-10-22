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
// it into the reference's 24-bit BMP (black ink on white) on the label's dot canvas BEFORE the
// framework is involved, so the conversion is unit-tested in AppTests.
import Foundation
import UIKit

struct NiimbotResult {
    let ok: Bool
    let code: String
    let message: String
}

enum NiimbotImage {
    /// Dots per mm of the B-series 203 dpi head (the reference's printMultiple for a B1 = 8.0).
    static let dotsPerMm = 8

    /// Packed 1-bit rows → the reference's 24-bit BMP (see `bmp`), black ink on white.
    /// Polarity = the rasterizer's full buffer (stickerRaster.ts renderStickerBitmap: rows
    /// MSB-first, bit 1 = INK) — exactly what the web sends for Niimbot. `canvasW`/`canvasH` =
    /// the label's dot size (50×30 mm × 8 = 400×240; the sticker raster is 384×240 = the 48 mm
    /// printable width of the D520 layout): a smaller image is CENTRED on white so the image
    /// has the label's exact size and aspect, never cropped. nil = bad geometry.
    static func image(packed: Data, w: Int, h: Int, rowBytes: Int, canvasW: Int = 0, canvasH: Int = 0) -> Data? {
        guard w > 0, h > 0, rowBytes > 0, packed.count >= rowBytes * h else { return nil }
        let cw = max(canvasW, w), ch = max(canvasH, h)
        let ox = (cw - w) / 2, oy = (ch - h) / 2
        return bmp(w: cw, h: ch) { x, y in
            let sx = x - ox, sy = y - oy
            guard sx >= 0, sy >= 0, sx < w, sy < h else { return false }
            return packed.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in (raw[sy * rowBytes + (sx >> 3)] & UInt8(0x80 >> (sx & 7))) != 0 }
        }
    }

    /// The reference's own pixel format (zh4dev NiimbotImageElement._encodeMonochromeBmp,
    /// ported 1:1): an uncompressed 24-bit BMP, bottom-up rows padded to 4 bytes, black
    /// (0,0,0) for ink and white (255,255,255) for paper, no alpha, 54-byte header. This is
    /// the format the B1 printed from on the field test (an RGB PNG with the same pixels
    /// came out blank).
    static func bmp(w: Int, h: Int, ink: (Int, Int) -> Bool) -> Data? {
        guard w > 0, h > 0 else { return nil }
        let rowSize = ((w * 3 + 3) / 4) * 4
        let pixelDataSize = rowSize * h
        var out = [UInt8](repeating: 0, count: 54 + pixelDataSize)
        func put32(_ at: Int, _ v: Int) { for k in 0..<4 { out[at + k] = UInt8((v >> (8 * k)) & 0xFF) } }
        func put16(_ at: Int, _ v: Int) { for k in 0..<2 { out[at + k] = UInt8((v >> (8 * k)) & 0xFF) } }
        out[0] = 0x42; out[1] = 0x4D            // "BM"
        put32(2, out.count)                     // file size
        put32(10, 54)                           // pixel data offset
        put32(14, 40)                           // BITMAPINFOHEADER size
        put32(18, w); put32(22, h)              // width, height (positive = bottom-up)
        put16(26, 1); put16(28, 24)             // planes, bits per pixel
        put32(34, pixelDataSize)
        for y in 0..<h {
            let sourceY = h - 1 - y
            let rowOffset = 54 + y * rowSize
            for x in 0..<w {
                let v: UInt8 = ink(x, sourceY) ? 0 : 255
                let o = rowOffset + x * 3
                out[o] = v; out[o + 1] = v; out[o + 2] = v
            }
        }
        return Data(out)
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
        let canvasW = Int((wMm * Float(NiimbotImage.dotsPerMm)).rounded()), canvasH = Int((hMm * Float(NiimbotImage.dotsPerMm)).rounded())
        guard let bmp = NiimbotImage.image(packed: packed, w: w, h: h, rowBytes: rowBytes, canvasW: canvasW, canvasH: canvasH) else {
            NSLog("[Niimbot] app: bad image geometry w=%d h=%d rowBytes=%d bytes=%d", w, h, rowBytes, packed.count)
            completion(NiimbotResult(ok: false, code: "BT_PRINT_FAILED", message: "Bad image data")); return
        }
        NSLog("[Niimbot] app: %dx%d 1-bit → 24-bit BMP on the %dx%d-dot canvas, label %.0fx%.0f mm", w, h, canvasW, canvasH, wMm, hMm)
        driver.printLabel(withName: name, png: bmp, labelWidthMm: wMm, labelHeightMm: hMm) { ok, code, message in
            completion(NiimbotResult(ok: ok, code: code, message: message))
        }
    }
}
