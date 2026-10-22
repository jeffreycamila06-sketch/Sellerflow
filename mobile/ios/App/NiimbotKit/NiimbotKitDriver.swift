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
//   threshold 127) → GenerateLableJson → getPrintingErrorInfo / getPrintingCountInfo →
//   setTotalQuantityOfPrints(1) → startJob(density, paper 1 = gap) → commit(json, 1) →
//   count callback totalCount ≥ 1 → endPrint → done.
//
// FIELD-TEST RULES (B1, Oct 2026):
// • JCAPI.h declares selectors this libJCAPI.a does NOT have (generateImagePreviewImage:error:
//   → "unrecognized selector" crash). Every SDK selector is checked with responds(to:) before
//   the job, and every SDK call runs inside SFLSdkCall (ObjC @try/@catch) — an SDK exception
//   becomes a logged NIIMBOT_ERROR, never a crash.
// • The draw BOOL is only LOGGED. Like the reference ("some JCAPI versions report NO even when
//   the drawing command was accepted"), acceptance = GenerateLableJson non-empty AND it
//   contains the image element (see NiimbotKitLogic.describeLabelJson).
// • NO TEXT CALLS. drawLableText with a font FILE name ("ZT001.ttf") aborts inside the SDK
//   (C++ rapidjson assert — SIGABRT, not catchable by @try); the reference passes the font
//   NAME ("宋体") and @[bold,italic,underline,strikethrough]. We only draw the image, so the
//   text sanity try was removed. Never call an SDK API with values the reference never uses.
// • DIAGNOSTIC LADDER: one tap tries image variants b–f (RGB-no-alpha PNG / JPEG / data-URL /
//   main thread / 400-dot canvas), logs "[Niimbot] try <name> …" for each and prints with the
//   first whose JSON carries the image (remembered for later taps).
// Every step logs "[Niimbot] …" (codes, sizes, keys — never the image data or buyer data).
// The printer is CLOSED on every exit (success, error, timeout). Single-flight. The SDK
// libraries have no simulator slice → the simulator build of this framework is a stub.
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

    /// What the SDK's label JSON holds. `hasImage` = an element carries non-empty image data
    /// (a string ≥ 200 chars, or a key named like "image…" with content), or the JSON grew by
    /// ≥ 1000 chars over the empty board (an embedded picture is never smaller). `summary` is
    /// log-safe: lengths, keys and type values only — never a long string's content.
    static func describeLabelJson(_ json: String, emptyLength: Int) -> (hasImage: Bool, summary: String) {
        var types: [String] = [], elements: [String] = [], imageData = "none"
        func walk(_ node: Any) {
            if let dict = node as? [String: Any] {
                let keys = dict.keys.sorted()
                if let t = (dict["type"] ?? dict["elementType"] ?? dict["elemType"]).map({ "\($0)" }) {
                    types.append(t); elements.append("\(t){\(keys.joined(separator: ","))}")
                }
                for (k, v) in dict {
                    if let s = v as? String, s.count >= 200 || (k.lowercased().contains("image") && !s.isEmpty) {
                        if imageData == "none" || s.count >= 200 { imageData = "\(k):\(s.count)" }
                    }
                    walk(v)
                }
            } else if let arr = node as? [Any] { arr.forEach(walk) }
        }
        var topKeys = "unparsed"
        if let data = json.data(using: .utf8), let root = try? JSONSerialization.jsonObject(with: data) {
            walk(root)
            if let d = root as? [String: Any] { topKeys = d.keys.sorted().joined(separator: ",") } else { topKeys = "array" }
        }
        let grew = json.count - emptyLength
        let hasImage = imageData != "none" || grew >= 1000
        let summary = "json=\(json.count) (empty board=\(emptyLength), +\(grew)) top=[\(topKeys)] types=[\(Set(types).sorted().joined(separator: ","))] elements=[\(elements.prefix(6).joined(separator: " "))] imageData=\(imageData)"
        return (hasImage, summary)
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

    /// Every JCAPI selector this driver calls, by its Objective-C name. JCAPI.h declares more
    /// than this libJCAPI.a implements; a missing one here fails the job instead of crashing.
    private static let requiredSelectors = [
        "openPrinter:completion:", "closePrinter", "connectingPrinterName", "isConnectingState", "cancelJob:",
        "initImageProcessing:error:", "setPrintWithCache:",
        "initDrawingBoard:withHeight:withHorizontalShift:withVerticalShift:rotate:fontArray:",
        "DrawLableImage:withY:withWidth:withHeight:withImageData:withRotate:withImageProcessingType:withImageProcessingValue:",
        "GenerateLableJson", "getPrintingErrorInfo:", "getPrintingCountInfo:", "setTotalQuantityOfPrints:",
        "startJob:withPaperStyle:withCompletion:", "commit:withOnePageNumbers:withComplete:", "endPrint:",
    ]
    private static func missingSelectors() -> [String] {
        return requiredSelectors.filter { !JCAPI.responds(to: NSSelectorFromString($0)) }
    }

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
                        if let ex = SFLSdkCall({ JCAPI.closePrinter() }) { NSLog("[Niimbot] closePrinter threw: %@", ex) }
                        self.queue.async { self.busy = false }
                        completion(ok, code, message)
                    }
                }
            }
            NSLog("[Niimbot] job start: label %.0fx%.0f mm, png=%d bytes, density=%d", wMm, hMm, png.count, NiimbotKitLogic.density(forName: name))
            guard png.count > 0 else { finish(false, "BT_PRINT_FAILED", "Bad image data"); return }
            let missing = NiimbotKitDriver.missingSelectors()
            if !missing.isEmpty {
                NSLog("[Niimbot] SDK selectors MISSING in this libJCAPI.a: %@", missing.joined(separator: " | "))
                finish(false, "NIIMBOT_ERROR", "Printer SDK is missing: \(missing.first ?? "")"); return
            }
            DispatchQueue.main.async {
                self.open(name: name) { ok in
                    var state: Int32 = -1
                    _ = SFLSdkCall { state = JCAPI.isConnectingState() }
                    NSLog("[Niimbot] openPrinter → %d (state=%d)", ok ? 1 : 0, state)
                    if !ok { finish(false, "BT_NOT_FOUND", "Could not connect to the printer"); return }
                    self.printLabel(png: png, name: name, wMm: wMm, hMm: hMm, finish: finish)
                }
            }
            self.queue.asyncAfter(deadline: .now() + NiimbotKitDriver.printTimeout + NiimbotKitDriver.openTimeout) {
                if !finished {
                    NSLog("[Niimbot] TIMEOUT after %.0fs — cancelJob", NiimbotKitDriver.printTimeout + NiimbotKitDriver.openTimeout)
                    DispatchQueue.main.async {
                        if let ex = SFLSdkCall({ JCAPI.cancelJob { ok in NSLog("[Niimbot] cancelJob → %d", ok ? 1 : 0) } }) { NSLog("[Niimbot] cancelJob threw: %@", ex) }
                    }
                    finish(false, "BT_PRINT_FAILED", "Print timed out")
                }
            }
        }
    }

    // The SDK connects by printer NAME (its own scan lists names). Reuse a live connection to
    // the same printer; otherwise close and open.
    private func open(name: String, completion: @escaping (Bool) -> Void) {
        var current = "", state: Int32 = 0
        if let ex = SFLSdkCall({ current = JCAPI.connectingPrinterName() ?? ""; state = JCAPI.isConnectingState() }) {
            NSLog("[Niimbot] connection state threw: %@", ex); completion(false); return
        }
        if state != 0, current == name { NSLog("[Niimbot] already connected"); completion(true); return }
        if !current.isEmpty { NSLog("[Niimbot] closing other printer first"); _ = SFLSdkCall { JCAPI.closePrinter() } }
        var answered = false
        if let ex = SFLSdkCall({
            JCAPI.openPrinter(name) { ok in
                if answered { return }
                answered = true
                completion(ok)
            }
        }) {
            NSLog("[Niimbot] openPrinter threw: %@", ex)
            if !answered { answered = true; completion(false) }
            return
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + NiimbotKitDriver.openTimeout) {
            if !answered { answered = true; NSLog("[Niimbot] openPrinter: no answer in %.0fs", NiimbotKitDriver.openTimeout); completion(false) }
        }
    }

    // ── DIAGNOSTIC LADDER (B1 field test: DrawLableImage → 0 on the RGBA PNG) ──────────
    // One tap tries image variants (b)–(f) in order; each try logs
    // "[Niimbot] try <name> → drawn=0/1 accepted=0/1 <json summary>". The draw BOOL is only
    // logged; accepted = the label JSON carries the image element. The job prints with the
    // FIRST accepted variant and remembers it for the next taps; none accepted → NIIMBOT_ERROR.
    private struct ImageTry { let name: String; let base64: String?; let onMain: Bool }
    private static var workingVariant: String?

    private func printLabel(png: Data, name: String, wMm: Float, hMm: Float, finish: @escaping (Bool, String, String) -> Void) {
        NSLog("[Niimbot] drawing thread: main=%d", Thread.isMainThread ? 1 : 0)
        // Font resources (FONT.json + ZT001.ttf/ZT002.otf) live in THIS framework's bundle.
        // Like the reference, initImageProcessing runs on EVERY job and logs its error object.
        let bundle = Bundle(for: NiimbotKitDriver.self)
        guard let path = bundle.resourcePath, bundle.path(forResource: "FONT", ofType: "json") != nil, bundle.path(forResource: "ZT001", ofType: "ttf") != nil else {
            NSLog("[Niimbot] font resources missing in the framework bundle (resourcePath=%@)", bundle.resourcePath ?? "nil")
            finish(false, "NIIMBOT_ERROR", "Resources missing"); return
        }
        var initErr: NSError?
        if let ex = SFLSdkCall({ JCAPI.initImageProcessing(path, error: &initErr) }) { // void + NSError** in JCAPI.h (not a throwing import)
            NSLog("[Niimbot] initImageProcessing threw: %@", ex); finish(false, "NIIMBOT_ERROR", "Label renderer failed"); return
        }
        NSLog("[Niimbot] initImageProcessing resourcePath=%@ error=%@", path, initErr.map { "\($0.domain)#\($0.code) \($0.localizedDescription) \($0.userInfo)" } ?? "nil")
        if let e = initErr { finish(false, "NIIMBOT_ERROR", "Label renderer failed: \(e.localizedDescription)"); return }
        if let ex = SFLSdkCall({ JCAPI.setPrintWithCache(true) }) { NSLog("[Niimbot] setPrintWithCache threw: %@", ex); finish(false, "NIIMBOT_ERROR", "Printer SDK error"); return }

        // The empty board's JSON length is the baseline every try is compared against.
        guard let emptyJson = freshBoard(wMm: wMm, hMm: hMm) else { finish(false, "NIIMBOT_ERROR", "Printer SDK error (board)"); return }
        let emptyLen = emptyJson.count
        NSLog("[Niimbot] empty board json=%d", emptyLen)

        let b64 = png.base64EncodedString()
        NSLog("[Niimbot] base64 length=%d first30=%@", b64.count, String(b64.prefix(30)))

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
            let run = { self.drawImageTry(t.name, base64: data, wMm: wMm, hMm: hMm, emptyLen: emptyLen) }
            let result: String? = (t.onMain && !Thread.isMainThread) ? DispatchQueue.main.sync(execute: run) : run()
            if let j = result { json = j; winner = t.name; break }
        }
        guard let w = winner, let labelJson = json, !labelJson.isEmpty else {
            NSLog("[Niimbot] no image variant accepted")
            finish(false, "NIIMBOT_ERROR", "The label image was not accepted"); return
        }
        NiimbotKitDriver.workingVariant = w
        NSLog("[Niimbot] printing with variant %@ (remembered)", w)
        startPrint(json: labelJson, name: name, finish: finish)
    }

    /// initDrawingBoard + GenerateLableJson of the empty board. nil = the SDK threw.
    private func freshBoard(wMm: Float, hMm: Float) -> String? {
        var json: String?
        if let ex = SFLSdkCall({
            JCAPI.initDrawingBoard(wMm, withHeight: hMm, withHorizontalShift: 0, withVerticalShift: 0, rotate: 0, fontArray: ["ZT001.ttf"])
            json = JCAPI.generateLableJson()
        }) { NSLog("[Niimbot] initDrawingBoard/GenerateLableJson threw: %@", ex); return nil }
        return json ?? ""
    }

    /// Fresh board + the image variant. Returns the label JSON when it carries the image.
    private func drawImageTry(_ name: String, base64: String, wMm: Float, hMm: Float, emptyLen: Int) -> String? {
        guard freshBoard(wMm: wMm, hMm: hMm) != nil else { return nil }
        var drawn = false, json: String?
        if let ex = SFLSdkCall({
            drawn = JCAPI.drawLableImage(0, withY: 0, withWidth: wMm, withHeight: hMm, withImageData: base64, withRotate: 0, withImageProcessingType: 1, withImageProcessingValue: 127)
            json = JCAPI.generateLableJson()
        }) { NSLog("[Niimbot] try %@ threw: %@", name, ex); return nil }
        let j = json ?? ""
        let d = NiimbotKitLogic.describeLabelJson(j, emptyLength: emptyLen)
        NSLog("[Niimbot] try %@ → drawn=%d accepted=%d main=%d b64=%d %@", name, drawn ? 1 : 0, d.hasImage ? 1 : 0, Thread.isMainThread ? 1 : 0, base64.count, d.summary)
        return (d.hasImage && !j.isEmpty) ? j : nil
    }

    private func startPrint(json: String, name: String, finish: @escaping (Bool, String, String) -> Void) {
        let density = Int32(NiimbotKitLogic.density(forName: name))
        if let ex = SFLSdkCall({
            JCAPI.getPrintingErrorInfo { info in
                let code = Int((info ?? "").trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
                NSLog("[Niimbot] printing error callback: %d", code)
                finish(false, NiimbotKitLogic.code(forSdkError: code), "Printer error \(code)")
            }
            JCAPI.getPrintingCountInfo { info in
                let total = (info?["totalCount"] as? NSNumber)?.intValue ?? 0
                NSLog("[Niimbot] printing count callback: totalCount=%d", total)
                if total >= 1 {
                    if let ex = SFLSdkCall({
                        JCAPI.endPrint { ok in
                            NSLog("[Niimbot] endPrint → %d", ok ? 1 : 0)
                            if ok { finish(true, "", "Sent to printer") } else { finish(false, "NIIMBOT_ERROR", "End of print not confirmed") }
                        }
                    }) { NSLog("[Niimbot] endPrint threw: %@", ex); finish(false, "NIIMBOT_ERROR", "End of print failed") }
                }
            }
            JCAPI.setTotalQuantityOfPrints(1)
            NSLog("[Niimbot] startJob density=%d paperStyle=1 (gap)", density)
            JCAPI.startJob(density, withPaperStyle: 1) { started in
                NSLog("[Niimbot] startJob → %d", started ? 1 : 0)
                if !started { finish(false, "NIIMBOT_ERROR", "Could not start the print job"); return }
                if let ex = SFLSdkCall({
                    JCAPI.commit(json, withOnePageNumbers: 1) { committed in
                        NSLog("[Niimbot] commit → %d (waiting for the count callback)", committed ? 1 : 0)
                        if !committed { finish(false, "NIIMBOT_ERROR", "Could not send the label") }
                    }
                }) { NSLog("[Niimbot] commit threw: %@", ex); finish(false, "NIIMBOT_ERROR", "Could not send the label") }
            }
        }) {
            NSLog("[Niimbot] print setup threw: %@", ex)
            finish(false, "NIIMBOT_ERROR", "Printer SDK error")
        }
    }
}

#endif
