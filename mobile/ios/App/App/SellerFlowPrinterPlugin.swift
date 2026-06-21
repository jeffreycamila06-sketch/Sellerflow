// SellerFlowPrinterPlugin.swift
//
// iOS counterpart to mobile/android/.../SellerFlowPrinterPlugin.java.
// WiFi-only (BLE printing on iOS is gated by MFi). Targets ESC/POS thermal
// printers reachable over raw TCP, default port 9100.
//
// Mirrors the Android Capacitor plugin contract exactly so the existing web
// code in src/App.tsx (window.SellerFlowPrinter / window.Capacitor.Plugins.
// SellerFlowPrinter) works without any platform branching.

import Capacitor
import Foundation
import Network
import WebKit

@objc(SellerFlowPrinterPlugin)
public class SellerFlowPrinterPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SellerFlowPrinterPlugin"
    public let jsName = "SellerFlowPrinter"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setPrinter", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getPrinter", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "testConnection", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printSlip", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printStickerLan", returnType: CAPPluginReturnPromise),
    ]

    /// Default AIMO-class sticker stock: 100x60mm @ 203 DPI (800x480 dots).
    /// Mirrors the Android constants `LABEL_WIDTH_MM` / `LABEL_HEIGHT_MM` in
    /// `mobile/android/.../SellerFlowPrinterPlugin.java`. Overridable per call
    /// via `labelWidthMm` / `labelHeightMm` so other label sizes can be tested
    /// without a code change; defaults keep byte-parity with Android.
    private let defaultLabelWidthMm = 100
    private let defaultLabelHeightMm = 60

    private let defaults = UserDefaults.standard
    private let hostKey = "sellerflow_lan_host"
    private let portKey = "sellerflow_lan_port"
    private let defaultPort = 9100
    private let connectTimeoutMs = 5000

    /// ESC/POS character-size mode (GS ! n) applied to prominent slip fields:
    /// buyer #, name, handle, order details, grand total.
    ///
    /// Byte format: upper nibble = vertical scale - 1, lower nibble = horizontal scale - 1.
    ///   0x11 -> 2W x 2H  (current: matches Android after physical test confirmed 2x on 80mm)
    ///   0x22 -> 3W x 3H  (alternative: also tested on Android, too large for 80mm)
    ///   0x00 -> normal   (off)
    ///
    /// SINGLE SOURCE OF TRUTH. Edit this one byte to change every prominent line.
    /// Mirrors the Android constant `SellerFlowPrinterPlugin.ESC_POS_IMPORTANT_SIZE`
    /// in `mobile/android/.../SellerFlowPrinterPlugin.java` -- keep both in sync.
    public static let ESC_POS_IMPORTANT_SIZE: UInt8 = 0x11

    /// Order item/comment size on the receipt: 0x11 = 2W x 2H -- same prominence
    /// as the buyer name, so the item is the most readable line on the slip. Only
    /// the item uses this; Qty/Price/Total stay normal. Mirrors the Android
    /// constant `ESC_POS_ORDER_SIZE`.
    public static let ESC_POS_ORDER_SIZE: UInt8 = 0x11

    // MARK: - load(): inject window.SellerFlowPrinter JS shim
    //
    // Mirrors mobile/android/.../MainActivity.injectPrinterBridge. The web
    // checks `window.SellerFlowPrinter?.printSlip` before routing to native;
    // this shim makes that check pass on iOS by wiring the global to the
    // Capacitor plugin.
    override public func load() {
        super.load()
        guard let webView = self.bridge?.webView else { return }
        let userScript = WKUserScript(
            source: SellerFlowPrinterPlugin.bridgeShimJS,
            injectionTime: .atDocumentEnd,
            forMainFrameOnly: false
        )
        webView.configuration.userContentController.addUserScript(userScript)
        // Also evaluate once now in case the page is already loaded
        DispatchQueue.main.async {
            webView.evaluateJavaScript(SellerFlowPrinterPlugin.bridgeShimJS, completionHandler: nil)
        }
    }

    private static let bridgeShimJS = """
    (function(){
      var cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SellerFlowPrinter;
      if (!cap) return;
      window.SellerFlowPrinter = window.SellerFlowPrinter || {};
      window.SellerFlowPrinter.setPrinter = function(c){ return cap.setPrinter(c || {}); };
      window.SellerFlowPrinter.getPrinter = function(){ return cap.getPrinter(); };
      window.SellerFlowPrinter.testConnection = function(c){ return cap.testConnection(c || {}); };
      window.SellerFlowPrinter.printSlip = function(p){ return cap.printSlip(p); };
      // iOS WiFi/LAN sticker (TSPL over TCP 9100). EXCLUSIVE to iOS -- Android's
      // sticker method is named printStickerNative and rides Bluetooth, so the
      // web's printerType==="lan" sticker branch (which gates on this method)
      // can never fire on Android and never disturbs the BT path.
      window.SellerFlowPrinter.printStickerLan = function(p){ return cap.printStickerLan(p); };
      window.SellerFlowPrinter.status = function(){ return cap.getPrinter(); };
      window.SellerFlowPrinter.printerStatus = function(){ return cap.getPrinter(); };
      window.SellerFlowPrinter.scanPrinters = function(){ return cap.getPrinter(); };
      window.SellerFlowPrinter.connectPrinter = function(printer){
        var p = printer;
        if (typeof printer === 'string') { try { p = JSON.parse(printer); } catch(e) { p = { host: printer }; } }
        return cap.setPrinter({ host: (p && p.host) || p || '', port: (p && p.port) || 9100 });
      };
      window.SellerFlowPrinter.testPrint = function(){
        return cap.printSlip({
          type: 'sellerflow.printSlip',
          storeName: 'SellerFlowLive',
          currency: 'PHP',
          sessionDate: new Date().toISOString().slice(0,10),
          createdAt: new Date().toISOString(),
          buyer: {
            num: 0, name: 'Test Print', handle: 'sellerflow', platform: 'iOS',
            orders: [{ orderNum: 1, item: 'SellerFlowLive test print', qty: 1, price: 0, total: 0, time: new Date().toLocaleString() }],
            totalSpent: 0, totalOrders: 1
          }
        });
      };
    })();
    """

    // MARK: - Plugin methods

    @objc func setPrinter(_ call: CAPPluginCall) {
        let host = cleanHost(call.getString("host", ""))
        let port = call.getInt("port", defaultPort)
        if host.isEmpty {
            call.reject("Printer IP address is required", "HOST_REQUIRED")
            return
        }
        if port <= 0 || port > 65535 {
            call.reject("Printer port must be between 1 and 65535", "PORT_INVALID")
            return
        }
        defaults.set(host, forKey: hostKey)
        defaults.set(port, forKey: portKey)
        var ret = printerConfig(host: host, port: port)
        ret["ok"] = true
        ret["message"] = "Saved WiFi printer \(host):\(port)"
        call.resolve(ret)
    }

    @objc func getPrinter(_ call: CAPPluginCall) {
        let host = savedHost()
        let port = savedPort()
        var ret = printerConfig(host: host, port: port)
        ret["ok"] = !host.isEmpty
        ret["message"] = host.isEmpty ? "No WiFi printer saved" : "Saved WiFi printer \(host):\(port)"
        call.resolve(ret)
    }

    @objc func testConnection(_ call: CAPPluginCall) {
        let host = cleanHost(call.getString("host", savedHost()))
        let port = call.getInt("port", savedPort())
        if host.isEmpty {
            call.reject("Printer IP address is required", "HOST_REQUIRED")
            return
        }
        if port <= 0 || port > 65535 {
            call.reject("Printer port must be between 1 and 65535", "PORT_INVALID")
            return
        }
        openTCP(host: host, port: port, data: nil) { [weak self] error in
            guard let self = self else { return }
            if let error = error {
                call.reject("Printer unreachable at \(host):\(port) - \(error)", "CONNECTION_FAILED")
            } else {
                var ret = self.printerConfig(host: host, port: port)
                ret["ok"] = true
                ret["online"] = true
                ret["message"] = "Printer reachable at \(host):\(port)"
                call.resolve(ret)
            }
        }
    }

    @objc func printSlip(_ call: CAPPluginCall) {
        let host = savedHost()
        let port = savedPort()
        if host.isEmpty {
            call.reject("No WiFi printer saved. Enter printer IP and tap Test Connection first.", "PRINTER_NOT_SET")
            return
        }
        let buyer = call.getObject("buyer") ?? [:]
        let storeName = call.getString("storeName") ?? "SellerFlowLive"
        let currency = call.getString("currency") ?? "PHP"
        let sessionDate = call.getString("sessionDate") ?? ""
        let createdAt = call.getString("createdAt") ?? ""

        let settings = call.getObject("settings")
        let data = buildEscPosSlip(
            buyer: buyer,
            settings: settings,
            storeName: storeName,
            currency: currency,
            sessionDate: sessionDate,
            createdAt: createdAt
        )

        openTCP(host: host, port: port, data: data) { [weak self] error in
            guard let self = self else { return }
            if let error = error {
                call.reject("Print failed at \(host):\(port) - \(error)", "PRINT_FAILED")
            } else {
                var ret = self.printerConfig(host: host, port: port)
                ret["ok"] = true
                ret["online"] = true
                ret["bytes"] = data.count
                ret["message"] = "Printed to WiFi printer \(host):\(port)"
                call.resolve(ret)
            }
        }
    }

    // MARK: - printStickerLan: TSPL sticker over WiFi/LAN (TCP 9100)
    //
    // iOS counterpart to Android's printStickerNative, but over WiFi instead of
    // Bluetooth (iOS BLE printing is MFi-gated). Reads the same saved LAN
    // host/port the ESC/POS printSlip uses, builds a TSPL TEXT+BAR command
    // stream via buildTsplSticker (a byte-for-byte port of Android's
    // TsplBuilder.forStickerNative), and ships it through the shared openTCP
    // transport. Return shape mirrors Android printStickerNative so the web's
    // printStickerNative/printStickerLan result handling is identical.
    @objc func printStickerLan(_ call: CAPPluginCall) {
        let host = savedHost()
        let port = savedPort()
        if host.isEmpty {
            call.reject("No WiFi printer saved. Enter printer IP and tap Test Connection first.", "PRINTER_NOT_SET")
            return
        }
        let buyer = call.getObject("buyer") ?? [:]
        let settings = call.getObject("settings")
        let storeName = call.getString("storeName") ?? "SellerFlowLive"
        let currency = call.getString("currency") ?? ""
        let sessionDate = call.getString("sessionDate") ?? ""
        let labelWidthMm = call.getInt("labelWidthMm", defaultLabelWidthMm)
        let labelHeightMm = call.getInt("labelHeightMm", defaultLabelHeightMm)

        let data = buildTsplSticker(
            buyer: buyer,
            settings: settings,
            storeName: storeName,
            currency: currency,
            sessionDate: sessionDate,
            labelWidthMm: labelWidthMm,
            labelHeightMm: labelHeightMm
        )

        openTCP(host: host, port: port, data: data) { [weak self] error in
            guard let self = self else { return }
            if let error = error {
                call.reject("Sticker print failed at \(host):\(port) - \(error)", "PRINT_FAILED")
            } else {
                var ret = self.printerConfig(host: host, port: port)
                ret["ok"] = true
                ret["online"] = true
                ret["bytes"] = data.count
                ret["message"] = "Printed sticker (TEXT+BAR, \(data.count) bytes) to WiFi printer \(host):\(port)"
                call.resolve(ret)
            }
        }
    }

    // MARK: - Helpers: persistence + config dict

    private func cleanHost(_ host: String) -> String {
        return host.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func savedHost() -> String {
        return cleanHost(defaults.string(forKey: hostKey) ?? "")
    }

    private func savedPort() -> Int {
        let p = defaults.integer(forKey: portKey)
        return p > 0 ? p : defaultPort
    }

    private func printerConfig(host: String, port: Int) -> [String: Any] {
        var ret: [String: Any] = ["host": host, "port": port]
        ret["savedPrinter"] = savedPrinterDict(host: host, port: port)
        return ret
    }

    private func savedPrinterDict(host: String, port: Int) -> [String: Any] {
        guard !host.isEmpty else { return [:] }
        return [
            "id": "lan:\(host):\(port)",
            "type": "lan",
            "name": "WiFi/LAN ESC-POS \(host)",
            "host": host,
            "port": port,
            "online": true,
            "hint": "Raw TCP port \(port)"
        ]
    }

    // MARK: - TCP open (test or send)

    private func openTCP(host: String, port: Int, data: Data?, completion: @escaping (String?) -> Void) {
        guard port > 0 && port <= 65535, let nwPort = NWEndpoint.Port(rawValue: UInt16(port)) else {
            completion("Invalid port")
            return
        }
        let nwHost = NWEndpoint.Host(host)
        let conn = NWConnection(host: nwHost, port: nwPort, using: .tcp)
        let lock = NSLock()
        var finished = false

        func finish(_ err: String?) {
            lock.lock()
            defer { lock.unlock() }
            if finished { return }
            finished = true
            conn.cancel()
            DispatchQueue.main.async {
                completion(err)
            }
        }

        conn.stateUpdateHandler = { state in
            switch state {
            case .ready:
                if let data = data, !data.isEmpty {
                    conn.send(content: data, completion: .contentProcessed({ err in
                        if let err = err {
                            finish("send failed: \(err.localizedDescription)")
                        } else {
                            finish(nil)
                        }
                    }))
                } else {
                    finish(nil) // test-only path: connect, then close
                }
            case .failed(let err):
                finish(err.localizedDescription)
            case .waiting(let err):
                // Common cause: NSLocalNetworkUsageDescription missing / user denied permission
                finish("waiting: \(err.localizedDescription)")
            default:
                break
            }
        }

        DispatchQueue.global().asyncAfter(deadline: .now() + .milliseconds(connectTimeoutMs)) {
            finish("connect timeout (\(self.connectTimeoutMs)ms)")
        }

        conn.start(queue: DispatchQueue.global(qos: .userInitiated))
    }

    // MARK: - ESC/POS builder (mirrors Android EscPos opcodes byte-for-byte)

    private func buildEscPosSlip(
        buyer: [String: Any],
        settings: [String: Any]?,
        storeName: String,
        currency: String,
        sessionDate: String,
        createdAt: String
    ) -> Data {
        var out = Data()
        func raw(_ bs: [UInt8]) { out.append(contentsOf: bs) }
        func text(_ s: String) {
            // Strip emoji / flags / ZWJ / variation-selectors BEFORE encoding so
            // they never reach the Big5 encoder (no Big5 mapping -> garbage).
            // Range-based stripEmoji is charset-agnostic and never touches ASCII or
            // Chinese, so the receipt always keeps its real text.
            let cleaned = stripEmoji(s)
            // Big5 (Traditional Chinese) -- the XP-N160II receipt printer's resident
            // character set (confirmed on its self-test page). This DIFFERS from the
            // AIMO TSPL sticker path, which is GBK (a different printer); only the
            // receipt encoder changes here -- gbkBytes() for the sticker stays GBK_95.
            let cfEnc = CFStringEncoding(CFStringEncodings.big5.rawValue)
            let nsEnc = CFStringConvertEncodingToNSStringEncoding(cfEnc)
            if let d = (cleaned as NSString).data(using: nsEnc) {
                out.append(d)
            } else if let d = cleaned.data(using: .utf8) {
                out.append(d) // fallback
            }
            out.append(0x0A)
        }
        func line() { text("--------------------------------") }
        func bold(_ on: Bool) { raw([0x1B, 0x45, on ? 0x01 : 0x00]) }
        func alignLeft() { raw([0x1B, 0x61, 0x00]) }
        func alignCenter() { raw([0x1B, 0x61, 0x01]) }
        func feed(_ n: Int) { raw([0x1B, 0x64, UInt8(max(1, min(n, 8)))]) }
        func cut() { raw([0x1D, 0x56, 0x42, 0x00]) }
        // GS ! n -- character size. Use Self.ESC_POS_IMPORTANT_SIZE for prominent
        // fields, 0x00 to return to normal. Mirrors Android's EscPos.setCharSize.
        func setCharSize(_ size: UInt8) { raw([0x1D, 0x21, size]) }
        // Defensive integer parse for JSON values arriving from JS. NSNumber bridges
        // to either Int or Double depending on encoding; "as? Int" alone fails
        // silently on Double-encoded integers (e.g. 1.0). Tries Int, then Double,
        // then falls back to NSNumber.intValue for safety.
        func asInt(_ v: Any?) -> Int? {
            if let i = v as? Int { return i }
            if let d = v as? Double { return Int(d) }
            return (v as? NSNumber)?.intValue
        }
        func money(_ v: Double) -> String {
            return floor(v) == v ? String(Int(v)) : String(format: "%.2f", v)
        }
        // "Printer output" on/off toggles. Mirror of the Android buildEscPosSlip
        // and the TSPL sticker builders, and of the web iframe in App.tsx printSlip.
        // Canonical contract: src/lib/slipFields.ts (slipFieldVisibility). Default
        // true so a payload without settings prints everything (backwards-compat).
        // NOTE: buyer Name has no toggle and always prints (matches every path).
        func boolSetting(_ key: String) -> Bool {
            guard let settings = settings else { return true }
            if let b = settings[key] as? Bool { return b }
            if let n = settings[key] as? NSNumber { return n.boolValue }
            return true
        }
        let printStoreName = boolSetting("printStoreName")
        let printBuyerNumber = boolSetting("printBuyerNumber")
        let printBuyerUsername = boolSetting("printBuyerUsername")
        let printOrderItems = boolSetting("printOrderItems")
        let printTotal = boolSetting("printTotal")

        // init
        raw([0x1B, 0x40])   // ESC @ -- reset to power-on defaults
        // FS & -- enter Kanji/Chinese double-byte mode so the printer renders the
        // GBK bytes with its internal Chinese font ROM. Without it the XP-N160II
        // reads each GBK byte as single-byte PC437 and prints garbage. Byte-
        // identical to Android EscPos.init() for parity.
        raw([0x1C, 0x26])   // FS &
        alignCenter()
        bold(true); if printStoreName { text(storeName) }; bold(false)  // normal -- header (gated)
        text("SellerFlowLive")                                   // normal -- subtitle
        line()                                                   // normal -- divider
        alignLeft()

        setCharSize(Self.ESC_POS_IMPORTANT_SIZE)                 // === 2x BLOCK ===
        let buyerNum = asInt(buyer["num"]) ?? asInt(buyer["bNum"]) ?? 0
        if printBuyerNumber { text("Buyer #\(buyerNum)") }
        text("Name: \((buyer["name"] as? String) ?? "")")       // buyer name -- no toggle, always
        if printBuyerUsername { text("Handle: \((buyer["handle"] as? String) ?? "")") }
        setCharSize(0x00)                                        // === END 2x ===

        text("Platform: \((buyer["platform"] as? String) ?? "")") // normal -- header info
        text("Session: \(sessionDate)")                           // normal -- header info
        line()                                                    // normal -- divider

        let orders = (buyer["orders"] as? [[String: Any]]) ?? []
        if printOrderItems {
            if !orders.isEmpty {
                for order in orders {
                    setCharSize(Self.ESC_POS_ORDER_SIZE)                 // === 2x (2Wx2H) -- item only ===
                    text((order["item"] as? String) ?? "")
                    setCharSize(0x00)                                    // === normal -- order details ===
                    text("Qty: \(asInt(order["qty"]) ?? 1)")
                    let price = (order["price"] as? Double) ?? Double((order["price"] as? Int) ?? 0)
                    let total = (order["total"] as? Double) ?? Double((order["total"] as? Int) ?? 0)
                    if price > 0 { text("Price: \(currency) \(money(price))") }
                    if total > 0 { text("Total: \(currency) \(money(total))") }

                    if let t = order["time"] as? String, !t.isEmpty { text(t) }  // normal -- timestamp
                    line()                                                        // normal -- divider
                }
            } else {
                text("Order:")                                           // normal -- label
                setCharSize(Self.ESC_POS_ORDER_SIZE)                     // === 2x (2Wx2H) -- comment ===
                text((buyer["lastComment"] as? String) ?? (buyer["comment"] as? String) ?? "")
                setCharSize(0x00)                                        // === normal ===
                line()
            }
        }

        let totalSpent = (buyer["totalSpent"] as? Double) ?? Double((buyer["totalSpent"] as? Int) ?? 0)
        if printTotal && totalSpent > 0 {
            setCharSize(Self.ESC_POS_IMPORTANT_SIZE)                 // === 2x BLOCK ===
            bold(true); text("TOTAL: \(currency) \(money(totalSpent))"); bold(false)
            setCharSize(0x00)                                        // === END 2x ===
        }
        text("Created: \(createdAt)")                                // normal -- timestamp
        feed(4)
        cut()
        return out
    }

    // MARK: - TSPL sticker builder (byte-for-byte port of TsplBuilder.java)
    //
    // Mirrors Android `TsplBuilder.forStickerNative` exactly: TEXT + BAR
    // primitives only (the AIMO-class firmware ignores BITMAP), ASCII commands
    // terminated with \r\n, CJK fields emitted as TSS24.BF2 + GBK bytes. The
    // byte output is pinned to the Android golden fixtures under
    // mobile/ios/tspl-parity/golden/ and asserted by both the iOS XCTest
    // (MobileTsplBuilderTests.swift) and the web suite (src/lib/__tests__).
    //
    // PARITY NOTES (Java semantics this port must preserve):
    //   - truncate() slices by UTF-16 code units (Java String.substring), NOT
    //     by Character/grapheme -- see truncate16().
    //   - writeAscii encodes US-ASCII with '?' (0x3F) for unmappable units,
    //     matching Java getBytes(US_ASCII) -- see tsplAsciiBytes().
    //   - GBK uses CFStringEncodings.GBK_95, the same encoding the ESC/POS path
    //     uses and which matches Android's Charset.forName("GBK") byte-for-byte
    //     on the BMP (CJK ideographs live here).
    // Internal (not private) so the Phase-3 XCTest (mobile/ios/tspl-parity/
    // swift/MobileTsplBuilderTests.swift) can assert it byte-for-byte against
    // the Android golden fixtures via @testable import.
    func buildTsplSticker(
        buyer: [String: Any],
        settings: [String: Any]?,
        storeName: String,
        currency: String,
        sessionDate: String,
        labelWidthMm: Int,
        labelHeightMm: Int
    ) -> Data {
        var out = Data()
        func writeAscii(_ s: String) {
            out.append(contentsOf: tsplAsciiBytes(s))
            out.append(contentsOf: [0x0D, 0x0A])
        }
        func asInt(_ v: Any?) -> Int? {
            if let i = v as? Int { return i }
            if let d = v as? Double { return Int(d) }
            return (v as? NSNumber)?.intValue
        }
        func asDouble(_ v: Any?) -> Double {
            if let d = v as? Double { return d }
            if let i = v as? Int { return Double(i) }
            return (v as? NSNumber)?.doubleValue ?? 0
        }
        func boolSetting(_ key: String) -> Bool {
            guard let settings = settings else { return true }
            if let b = settings[key] as? Bool { return b }
            if let n = settings[key] as? NSNumber { return n.boolValue }
            return true
        }

        let buyerNum = asInt(buyer["num"]) ?? asInt(buyer["bNum"]) ?? 0
        let buyerName = (buyer["name"] as? String) ?? ""
        let buyerHandle = (buyer["handle"] as? String) ?? ""
        let totalSpent = asDouble(buyer["totalSpent"])
        let orders = (buyer["orders"] as? [[String: Any]]) ?? []

        let printStoreName = boolSetting("printStoreName")
        let printBuyerNumber = boolSetting("printBuyerNumber")
        let printBuyerUsername = boolSetting("printBuyerUsername")
        let printOrderItems = boolSetting("printOrderItems")
        let printTotal = boolSetting("printTotal")

        writeAscii("SIZE \(labelWidthMm) mm, \(labelHeightMm) mm")
        writeAscii("GAP 2 mm, 0")
        writeAscii("DIRECTION 1")
        writeAscii("REFERENCE 0,0")
        writeAscii("DENSITY 8")
        writeAscii("CLS")

        // 8 dots/mm @ 203 DPI. PHASE 1 scales only the WIDTH-dependent layout
        // (full-width rules, right-anchored session date + total amount, the
        // separator, and the CJK clamp); the 60mm height tier keeps every y.
        // 100x60 reproduces the original bytes exactly (wDots-340==460, etc).
        let wDots = labelWidthMm * 8
        let rightEdge = wDots - 16
        // PHASE 2 height tier: footer anchored to the bottom, order caps derived
        // from it, so a shorter label reflows without touching the top-down body.
        // At 60mm (480) these reduce to the original 380/395/350/360 -> byte-identical.
        let hDots = labelHeightMm * 8
        let footerBarY = hDots - 100
        let totalY = hDots - 85
        let orderEntryGuard = footerBarY - 30
        let orderLoopGuard = footerBarY - 20
        // PHASE 3 / 320-dot (40mm) tier: compact mode tightens gaps, shrinks
        // buyer# to 2x1, and drops @username. Gated to hDots<=320 so 480/400
        // stay byte-identical (compact=false reproduces the original layout).
        let compact = hDots <= 320

        // Header row: brand at left (font 3 so it can't reach the date), the
        // compact MM/DD/YYYY date right-aligned in the corner. No "Session:" prefix.
        writeAscii("TEXT 16,10,\"3\",0,1,1,\"SellerFlowLive\"")
        if !sessionDate.isEmpty {
            writeAscii("TEXT \(wDots - 130),18,\"2\",0,1,1,\"\(tsplSafe(truncate16(sessionDate, 12)))\"")
        }
        writeAscii("BAR 0,48,\(wDots),3")

        // Strip unrenderable codepoints per field BEFORE the encoding decision.
        let cleanStoreName = stripEmoji(storeName)
        let cleanBuyerName = stripEmoji(buyerName)
        let cleanBuyerHandle = stripEmoji(buyerHandle)
        var buyerNameToPrint = cleanBuyerName
        if !buyerName.isEmpty && cleanBuyerName.isEmpty {
            buyerNameToPrint = !cleanBuyerHandle.isEmpty ? cleanBuyerHandle : "Buyer #\(buyerNum)"
        }

        var y = 60
        if printStoreName && !cleanStoreName.isEmpty {
            writeTextSmart(&out, 16, y, "3", tsplSafe(truncate16(cleanStoreName, 36)), 1, 1, rightEdge)
            y += compact ? 30 : 35
        }

        // Buyer # is the dominant element -- the whole point of the sticker. On
        // the 320 tier it drops to 2x1 (half height, still 2x wide) to fit.
        if printBuyerNumber {
            writeAscii("TEXT 16,\(y),\"4\",0,2,\(compact ? 1 : 2),\"Buyer #\(buyerNum)\"")
            y += compact ? 46 : 95
        }

        if !buyerNameToPrint.isEmpty {
            writeTextSmart(&out, 16, y, "4", tsplSafe(truncate16(buyerNameToPrint, 30)), 1, 1, rightEdge)
            y += compact ? 34 : 40
        }

        // @username is dropped on the 320 tier — no vertical room once store +
        // buyer# + name + price code + total are kept.
        if printBuyerUsername && !cleanBuyerHandle.isEmpty && !compact {
            writeTextSmart(&out, 16, y, "3", "@" + tsplSafe(truncate16(cleanBuyerHandle, 30)), 1, 1, rightEdge)
            y += 35
        }

        // Thin separator + order lines (capped at 2 so a 60mm label can't overflow).
        if printOrderItems && !orders.isEmpty && y < orderEntryGuard {
            writeAscii("BAR 16,\(y),\(wDots - 280),2")
            y += compact ? 6 : 10
            let maxOrders = 2
            var i = 0
            while i < min(orders.count, maxOrders) && y < orderLoopGuard {
                let order = orders[i]
                let time = (order["time"] as? String) ?? ""
                let item = (order["item"] as? String) ?? ""
                let cleanItem = stripEmoji(item)
                if !time.isEmpty {
                    writeAscii("TEXT 16,\(y),\"2\",0,1,1,\"\(tsplSafe(truncate16(time, 10)))\"")
                }
                if !cleanItem.isEmpty {
                    // Buyer's short price code (e.g. 150/250/600) -> SAME size as
                    // the grand Total amount: font "4", 2x width, 1x height
                    // (2x height would overlap the y=380 footer bar). truncate(12)
                    // guards the column width at font 4 2x.
                    writeTextSmart(&out, 180, y, "4", tsplSafe(truncate16(cleanItem, 12)), 2, 1, rightEdge)
                }
                y += 38
                i += 1
            }
        }

        // Footer total, anchored to the bottom. Divider line removed (price code
        // grazed it); footerBarY stays as the invisible clearance boundary.
        if printTotal && totalSpent > 0 {
            writeAscii("TEXT 16,\(totalY),\"3\",0,1,1,\"Total:\"")
            let totalStr = tsplSafe(currency) + tsplMoney(totalSpent)
            writeAscii("TEXT \(wDots - 390),\(totalY),\"4\",0,2,1,\"\(tsplSafe(truncate16(totalStr, 18)))\"")
        }

        writeAscii("PRINT 1")
        return out
    }

    // MARK: - TSPL helpers (mirror the private statics in TsplBuilder.java)

    /// Production content-line writer. ASCII content -> the exact legacy
    /// command string (byte-identical to the inline writeAscii calls).
    /// Non-ASCII (Chinese) -> TSS24.BF2 + GBK bytes, re-truncated to the
    /// printable width from its x origin (CJK glyphs are ~24 dots wide). If GBK
    /// is unavailable, falls back to the ASCII path. Mirrors TsplBuilder.writeTextSmart.
    /// Content-line writer with explicit TSPL multipliers (xMul, yMul) and a
    /// width-dependent rightEdge for the CJK clamp. Multipliers apply to BOTH the
    /// ASCII and TSS24.BF2 (CJK) paths so an enlarged field renders the same for
    /// English and Chinese. rightEdge = wDots-16 so the clamp tracks the label
    /// width (784 on 100mm, 624 on 80mm). Mirrors TsplBuilder.writeTextSmart.
    private func writeTextSmart(_ out: inout Data, _ x: Int, _ y: Int, _ asciiFont: String, _ content: String, _ xMul: Int, _ yMul: Int, _ rightEdge: Int) {
        if !hasNonAscii(content) {
            out.append(contentsOf: tsplAsciiBytes("TEXT \(x),\(y),\"\(asciiFont)\",0,\(xMul),\(yMul),\"\(content)\""))
            out.append(contentsOf: [0x0D, 0x0A])
            return
        }
        let maxChars = max(1, (rightEdge - x) / (24 * xMul))
        let fitted = truncate16(content, maxChars)
        if let gbk = gbkBytes(fitted) {
            out.append(contentsOf: tsplAsciiBytes("TEXT \(x),\(y),\"TSS24.BF2\",0,\(xMul),\(yMul),\""))
            out.append(contentsOf: gbk)
            out.append(contentsOf: tsplAsciiBytes("\""))
            out.append(contentsOf: [0x0D, 0x0A])
        } else {
            out.append(contentsOf: tsplAsciiBytes("TEXT \(x),\(y),\"\(asciiFont)\",0,\(xMul),\(yMul),\"\(content)\""))
            out.append(contentsOf: [0x0D, 0x0A])
        }
    }

    /// US-ASCII bytes with '?' (0x3F) for any UTF-16 unit > 127 -- matches
    /// Java String.getBytes(US_ASCII). Iterates UTF-16 units (not scalars) so a
    /// surrogate-pair char yields two '?' exactly as Java does.
    private func tsplAsciiBytes(_ s: String) -> [UInt8] {
        return s.utf16.map { $0 <= 127 ? UInt8($0) : 0x3F }
    }

    /// GBK_95 bytes, the same encoding the ESC/POS path uses; matches Android
    /// Charset.forName("GBK") byte-for-byte on the BMP. nil if unavailable.
    private func gbkBytes(_ s: String) -> [UInt8]? {
        let cfEnc = CFStringEncoding(CFStringEncodings.GBK_95.rawValue)
        let nsEnc = CFStringConvertEncodingToNSStringEncoding(cfEnc)
        guard let d = (s as NSString).data(using: nsEnc) else { return nil }
        return [UInt8](d)
    }

    /// Truncate by UTF-16 code units to match Java String.substring(0, maxLen).
    private func truncate16(_ s: String, _ maxLen: Int) -> String {
        let units = Array(s.utf16)
        if units.count <= maxLen { return s }
        return String(decoding: Array(units.prefix(maxLen)), as: UTF16.self)
    }

    /// TSPL TEXT uses " as the value delimiter; escape internal quotes to '.
    private func tsplSafe(_ s: String) -> String {
        return s.replacingOccurrences(of: "\"", with: "'")
    }

    /// True if any UTF-16 unit > 127 (matches Java char > 127 scan).
    private func hasNonAscii(_ s: String) -> Bool {
        return s.utf16.contains { $0 > 127 }
    }

    /// Whole number -> integer string, else 2 decimals (C/US locale). Mirrors
    /// TsplBuilder.money.
    private func tsplMoney(_ v: Double) -> String {
        return v.rounded() == v ? String(Int64(v)) : String(format: "%.2f", v)
    }

    /// Drop emoji/pictographs/flags/ZWJ/variation-selectors/keycap, then trim
    /// (Java semantics: strip leading/trailing units <= U+0020). Walks Unicode
    /// scalars so surrogate-pair emoji are dropped whole. Mirrors
    /// TsplBuilder.stripEmoji + isStrippable.
    private func stripEmoji(_ s: String) -> String {
        if s.isEmpty { return "" }
        var kept = String.UnicodeScalarView()
        for scalar in s.unicodeScalars where !isStrippable(scalar.value) {
            kept.append(scalar)
        }
        return javaTrim(String(kept))
    }

    private func isStrippable(_ cp: UInt32) -> Bool {
        return cp >= 0x1F000
            || (cp >= 0x2600 && cp <= 0x27BF)
            || (cp >= 0xFE00 && cp <= 0xFE0F)
            || cp == 0x200D
            || cp == 0x20E3
    }

    /// Java String.trim(): remove leading/trailing chars with value <= U+0020.
    private func javaTrim(_ s: String) -> String {
        let scalars = Array(s.unicodeScalars)
        var start = 0
        var end = scalars.count
        while start < end && scalars[start].value <= 0x20 { start += 1 }
        while end > start && scalars[end - 1].value <= 0x20 { end -= 1 }
        return String(String.UnicodeScalarView(scalars[start..<end]))
    }
}
