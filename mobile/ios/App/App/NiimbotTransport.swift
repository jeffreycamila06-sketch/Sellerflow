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
// it into an OPAQUE 8-bit RGB PNG with no alpha (black ink on white) BEFORE the framework is
// involved, so the conversion is unit-tested in AppTests. A calibration pattern can replace the
// sticker (see NiimbotImage.calibrationKey) to prove on paper whether any image prints.
import Foundation
import UIKit
import ImageIO

struct NiimbotResult {
    let ok: Bool
    let code: String
    let message: String
}

enum NiimbotImage {
    /// Calibration switch (B1 field test): launch with the Xcode scheme argument
    /// `-sfl_niimbot_calibration YES` (Edit Scheme → Run → Arguments Passed On Launch) and
    /// every Niimbot print sends the thick-border + centre-box pattern instead of the sticker,
    /// so the paper proves whether ANY image prints. Remove the argument to switch it off.
    static let calibrationKey = "sfl_niimbot_calibration"
    static var calibrationOn: Bool { UserDefaults.standard.bool(forKey: calibrationKey) }

    /// Packed 1-bit rows → an OPAQUE 8-bit RGB PNG, no alpha channel, black ink (0,0,0) on
    /// white (255,255,255). Polarity = the rasterizer's full buffer (stickerRaster.ts
    /// renderStickerBitmap: MSB-first, bit 1 = INK) — exactly what the web sends for Niimbot.
    /// `canvasW`/`canvasH` = the label's dot size (B1 field test: 50×30 mm at 8 dots/mm =
    /// 400×240, while the sticker raster is 384×240 = the 48 mm printable width of the D520
    /// layout); a smaller image is CENTRED on white so the PNG has the label's exact size and
    /// aspect. A canvas smaller than the image never crops it. nil = bad geometry.
    static func png(packed: Data, w: Int, h: Int, rowBytes: Int, canvasW: Int = 0, canvasH: Int = 0) -> Data? {
        guard w > 0, h > 0, rowBytes > 0, packed.count >= rowBytes * h else { return nil }
        let cw = max(canvasW, w), ch = max(canvasH, h)
        let ox = (cw - w) / 2, oy = (ch - h) / 2
        return rgbPng(w: cw, h: ch) { x, y in
            let sx = x - ox, sy = y - oy
            guard sx >= 0, sy >= 0, sx < w, sy < h else { return false }
            return packed.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in (raw[sy * rowBytes + (sx >> 3)] & UInt8(0x80 >> (sx & 7))) != 0 }
        }
    }

    /// Dots per mm of the B-series 203 dpi head (the reference's printMultiple for a B1 = 8.0).
    static let dotsPerMm = 8

    /// The calibration pattern for a 50×30 label at 8 dots/mm (400×240): a 20-dot black
    /// border and a 160×96 black box in the centre. Opaque RGB, no alpha.
    static func calibrationPattern(w: Int = 400, h: Int = 240) -> Data? {
        let border = 20, boxW = 160, boxH = 96
        let bx0 = (w - boxW) / 2, by0 = (h - boxH) / 2
        return rgbPng(w: w, h: h) { x, y in
            x < border || y < border || x >= w - border || y >= h - border
                || (x >= bx0 && x < bx0 + boxW && y >= by0 && y < by0 + boxH)
        }
    }

    /// Opaque RGB PNG writer: an `ink(x,y)` predicate → black on white, 8 bits/channel, no
    /// alpha (kCGImageAlphaNoneSkipLast context, written through ImageIO so the file's IHDR
    /// colour type is 2 = RGB, not 6 = RGBA).
    static func rgbPng(w: Int, h: Int, ink: (Int, Int) -> Bool) -> Data? {
        guard w > 0, h > 0,
              let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                  space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue),
              let px = ctx.data?.assumingMemoryBound(to: UInt8.self) else { return nil }
        let stride = ctx.bytesPerRow
        for y in 0..<h {
            for x in 0..<w {
                let i = y * stride + x * 4
                let v: UInt8 = ink(x, y) ? 0 : 255
                px[i] = v; px[i + 1] = v; px[i + 2] = v; px[i + 3] = 255
            }
        }
        guard let cg = ctx.makeImage() else { return nil }
        let data = NSMutableData()
        guard let dest = CGImageDestinationCreateWithData(data, "public.png" as CFString, 1, nil) else { return nil }
        CGImageDestinationAddImage(dest, cg, nil)
        return CGImageDestinationFinalize(dest) ? data as Data : nil
    }

    /// Log-safe statistics of a PNG (never the pixels): size, colour space, alpha, alpha
    /// range and how many pixels are dark (luminance < 128).
    static func stats(png: Data) -> String {
        guard let img = UIImage(data: png), let cg = img.cgImage, cg.width > 0, cg.height > 0 else { return "undecodable png (\(png.count) bytes)" }
        let w = cg.width, h = cg.height
        let alphaInfo = cg.alphaInfo
        let hasAlpha = !(alphaInfo == .none || alphaInfo == .noneSkipLast || alphaInfo == .noneSkipFirst)
        var rgba = [UInt8](repeating: 0, count: w * h * 4)
        let drawn: Bool = rgba.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { return "png \(w)x\(h) (could not read pixels)" }
        var aMin = 255, aMax = 0, dark = 0
        for i in stride(from: 0, to: rgba.count, by: 4) {
            let a = Int(rgba[i + 3]); aMin = min(aMin, a); aMax = max(aMax, a)
            let lum = (299 * Int(rgba[i]) + 587 * Int(rgba[i + 1]) + 114 * Int(rgba[i + 2])) / 1000
            if lum < 128 { dark += 1 }
        }
        let model = cg.colorSpace?.model
        let space = model == .rgb ? "rgb" : model == .monochrome ? "gray" : model == .indexed ? "indexed" : "other"
        return "png \(w)x\(h) \(png.count) bytes, space=\(space), bpp=\(cg.bitsPerPixel), alpha=\(hasAlpha ? "yes" : "none") (info \(alphaInfo.rawValue)), alphaMin=\(aMin) alphaMax=\(aMax), dark=\(dark)/\(w * h) (\(String(format: "%.1f", Double(dark) * 100 / Double(w * h)))%)"
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
        let png: Data?
        if NiimbotImage.calibrationOn {
            NSLog("[Niimbot] app: CALIBRATION pattern instead of the sticker (-%@ YES)", NiimbotImage.calibrationKey)
            png = NiimbotImage.calibrationPattern()
        } else {
            png = NiimbotImage.png(packed: packed, w: w, h: h, rowBytes: rowBytes,
                                   canvasW: Int((wMm * Float(NiimbotImage.dotsPerMm)).rounded()), canvasH: Int((hMm * Float(NiimbotImage.dotsPerMm)).rounded()))
        }
        guard let png = png else {
            NSLog("[Niimbot] app: bad image geometry w=%d h=%d rowBytes=%d bytes=%d", w, h, rowBytes, packed.count)
            completion(NiimbotResult(ok: false, code: "BT_PRINT_FAILED", message: "Bad image data")); return
        }
        NSLog("[Niimbot] app: %dx%d 1-bit (bit 1 = ink) → opaque RGB png on the label's %dx%d-dot canvas, label %.0fx%.0f mm",
              w, h, Int((wMm * Float(NiimbotImage.dotsPerMm)).rounded()), Int((hMm * Float(NiimbotImage.dotsPerMm)).rounded()), wMm, hMm)
        NSLog("[Niimbot] app: image stats: %@", NiimbotImage.stats(png: png))
        driver.printLabel(withName: name, png: png, labelWidthMm: wMm, labelHeightMm: hMm) { ok, code, message in
            completion(NiimbotResult(ok: ok, code: code, message: message))
        }
    }
}
