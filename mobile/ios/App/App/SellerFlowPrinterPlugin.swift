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
import CoreBluetooth
import Foundation
import Network
import UIKit
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
        // BLE sticker (AIMO D520BT dual-mode) — mirrors the Android Bluetooth
        // method names/shapes so the existing web BT UI + routing light up on
        // iOS with zero web changes (hasBtBridge / btCall / shouldUseBluetoothSticker).
        CAPPluginMethod(name: "scanBluetoothLabelPrinters", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getBluetoothLabelPrinter", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setBluetoothLabelPrinter", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clearBluetoothLabelPrinter", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "testStickerPrint", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printStickerNative", returnType: CAPPluginReturnPromise),
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

    // ── Per-size sticker layout config (ISOLATION) ──────────────────────────
    // Each size is a self-contained entry: editing one row cannot affect another
    // (no shared geometry formula for any tunable value). buildTsplSticker just
    // executes the config. Values are the resolved equivalents of the old
    // parametric formulas, so every golden stays byte-identical. Mirrors the
    // Java LAYOUTS + TS STICKER_LAYOUTS — keep all three in sync (goldens enforce).
    private struct SizeConfig {
        let wDots, rightEdge, storeGap, buyerNumYMul, buyerNumGap, nameGap,
            usernameGap, sepGap, sepWidth, orderEntryGuard, orderLoopGuard,
            totalY, totalAmountX: Int
        let showTotal: Bool
        // CJK buyer-name enlargement (Chinese/kanji render via 24-dot TSS24.BF2
        // vs the 32-dot ASCII name font). nameCjk{X,Y}Mul scale ONLY the CJK name;
        // nameCjkGap is the y advance under the taller name. The layout below the
        // name shifts by (nameCjkGap - nameGap) only when the name is CJK, so
        // English fixtures stay byte-identical. Mirrors Java SizeConfig.
        let nameCjkXMul, nameCjkYMul, nameCjkGap: Int
    }
    private static let stickerLayouts: [String: SizeConfig] = [
        // 480-dot height tier (60mm): full 2x2 buyer#, 2 order rows, Total kept.
        "100x60": SizeConfig(wDots: 800, rightEdge: 784, storeGap: 55, buyerNumYMul: 2, buyerNumGap: 110, nameGap: 58, usernameGap: 58, sepGap: 10, sepWidth: 520, orderEntryGuard: 390, orderLoopGuard: 400, totalY: 445, totalAmountX: 410, showTotal: true, nameCjkXMul: 2, nameCjkYMul: 2, nameCjkGap: 58),
        "80x60":  SizeConfig(wDots: 640, rightEdge: 624, storeGap: 35, buyerNumYMul: 2, buyerNumGap: 95, nameGap: 40, usernameGap: 35, sepGap: 10, sepWidth: 360, orderEntryGuard: 350, orderLoopGuard: 360, totalY: 395, totalAmountX: 250, showTotal: true, nameCjkXMul: 2, nameCjkYMul: 2, nameCjkGap: 58),
        // 400-dot height tier (50mm): Total moves up, ~1 order row fits.
        "80x50":  SizeConfig(wDots: 640, rightEdge: 624, storeGap: 35, buyerNumYMul: 2, buyerNumGap: 95, nameGap: 40, usernameGap: 35, sepGap: 10, sepWidth: 360, orderEntryGuard: 270, orderLoopGuard: 280, totalY: 315, totalAmountX: 250, showTotal: true, nameCjkXMul: 2, nameCjkYMul: 2, nameCjkGap: 58),
        "70x50":  SizeConfig(wDots: 560, rightEdge: 544, storeGap: 35, buyerNumYMul: 2, buyerNumGap: 95, nameGap: 40, usernameGap: 35, sepGap: 10, sepWidth: 280, orderEntryGuard: 270, orderLoopGuard: 280, totalY: 315, totalAmountX: 170, showTotal: true, nameCjkXMul: 2, nameCjkYMul: 2, nameCjkGap: 58),
        // 320-dot height tier (40mm): compact — buyer# 2x1, tighter gaps, NO Total
        // (swapped for @username); order row uses the freed bottom space.
        "60x40":  SizeConfig(wDots: 480, rightEdge: 464, storeGap: 30, buyerNumYMul: 1, buyerNumGap: 46, nameGap: 34, usernameGap: 30, sepGap: 6, sepWidth: 200, orderEntryGuard: 240, orderLoopGuard: 264, totalY: 0, totalAmountX: 0, showTotal: false, nameCjkXMul: 2, nameCjkYMul: 2, nameCjkGap: 58),
    ]
    private func stickerConfig(_ wMm: Int, _ hMm: Int) -> SizeConfig {
        return SellerFlowPrinterPlugin.stickerLayouts["\(wMm)x\(hMm)"]
            ?? SellerFlowPrinterPlugin.stickerLayouts["100x60"]!
    }

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

    // Running binary's CFBundleVersion as a JS NUMBER literal. 0 = unparseable
    // → the getBuildNumber line below is OMITTED entirely (see
    // CjkEncoding.buildNumberLiteral for why emitting 0 would be harmful).
    private static let iosBuildNumber = CjkEncoding.buildNumberLiteral(
        from: Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String)
    // Exact-build bridge for the web update modal (adapters/nativeVersion.ts
    // bridgeBuildNumber): SYNCHRONOUS and returns a NUMBER (not a string, not a
    // Promise — the web does Number(fn()) on the direct return). Without this,
    // capability synthesis caps every BLE-bearing binary at IOS_BLE_BUILD=6,
    // so a native-version.json ios.latest bump past 6 would nag Build 7+
    // users forever.
    private static let buildNumberShimLine = iosBuildNumber > 0
        ? "window.SellerFlowPrinter.getBuildNumber = function(){ return \(iosBuildNumber); };"
        : ""

    private static let bridgeShimJS = """
    (function(){
      var cap = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SellerFlowPrinter;
      if (!cap) return;
      window.SellerFlowPrinter = window.SellerFlowPrinter || {};
      \(buildNumberShimLine)
      window.SellerFlowPrinter.setPrinter = function(c){ return cap.setPrinter(c || {}); };
      window.SellerFlowPrinter.getPrinter = function(){ return cap.getPrinter(); };
      window.SellerFlowPrinter.testConnection = function(c){ return cap.testConnection(c || {}); };
      window.SellerFlowPrinter.printSlip = function(p){ return cap.printSlip(p); };
      // iOS WiFi/LAN sticker (TSPL over TCP 9100). EXCLUSIVE to iOS -- Android's
      // sticker method is named printStickerNative and rides Bluetooth, so the
      // web's printerType==="lan" sticker branch (which gates on this method)
      // can never fire on Android and never disturbs the BT path.
      window.SellerFlowPrinter.printStickerLan = function(p){ return cap.printStickerLan(p); };
      // iOS BLE sticker (AIMO D520BT dual-mode: iPhone talks BLE, Android talks
      // Classic SPP). SAME method names as Android's MainActivity shim, so the
      // web's BT UI (hasBtBridge) + routing (shouldUseBluetoothSticker) activate
      // on iOS automatically. Android is untouched — this shim only ever runs
      // inside the iOS WKWebView.
      window.SellerFlowPrinter.scanBluetoothLabelPrinters = function(){ return cap.scanBluetoothLabelPrinters(); };
      window.SellerFlowPrinter.getBluetoothLabelPrinter = function(){ return cap.getBluetoothLabelPrinter(); };
      window.SellerFlowPrinter.setBluetoothLabelPrinter = function(p){ return cap.setBluetoothLabelPrinter(p || {}); };
      window.SellerFlowPrinter.clearBluetoothLabelPrinter = function(){ return cap.clearBluetoothLabelPrinter(); };
      window.SellerFlowPrinter.testStickerPrint = function(p){ return cap.testStickerPrint(p || {}); };
      window.SellerFlowPrinter.printStickerNative = function(payload){ return cap.printStickerNative(payload || {}); };
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
            // AIMO TSPL sticker path, which is GBK (a different printer).
            // ⚠️ DELIBERATELY left on the legacy whole-string encoder in the
            // Build 7 release (2026-07-13 audit rule: one binary = one
            // CONFIRMED fix; only GBK_95 has device evidence). Known latent
            // risk: if the big5 converter is ALSO missing on-device (unproven
            // — watch the [CJK-ENV] gate line and blank A/B test-print lines),
            // this returns nil and the UTF-8 fallback prints garbage in FS&
            // Kanji mode. The staged never-fail twin (CjkEncoding.big5Bytes,
            // Android stripUnencodable parity) lives at git b44f5b5 — restore
            // it in its own audited branch once a device probe confirms.
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
        // (slip TOTAL removed below — printTotal no longer read for the slip)

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
                    // Per-order "Price:" + per-row "Total:" permanently removed (redundant
                    // with the item/price-code line above; slip de-cluttered, all slips).

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

        // Grand "TOTAL:" permanently removed (fixed; no setting can re-enable it).
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
    //   - GBK rides CjkEncoding.gbkBytes (GBK_95 → GB18030 ≤2-byte → '?'),
    //     which matches Android's Charset.forName("GBK") byte-for-byte on the
    //     BMP (CJK ideographs live here). The ESC/POS receipt path is Big5
    //     (a different printer, legacy whole-string encoder — see the
    //     deliberate-deferral note in the receipt text() func).
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

        // ── Per-element size scaling (mirrors tsplReference.ts / TsplBuilder.java)
        // Each element has an integer LEVEL 1-8 = the seller's size adjuster. The
        // level multiplies the element's BASE TSPL multiplier (clamped to the TSPL
        // 8x ceiling). Level 1 => base => byte-identical to the goldens. The
        // already-2x-wide elements (buyer#, price code, total amount) scale HEIGHT
        // only. F2/F3/F4 are the 1x font heights (dots) used only to reflow the
        // layout down so a grown element never overlaps the next.
        let F2 = 24, F3 = 24, F4 = 32
        func cmul(_ m: Int) -> Int { return max(1, min(8, m)) }
        func lvlSetting(_ key: String) -> Int {
            guard let settings = settings else { return 1 }
            let v: Int
            if let n = settings[key] as? NSNumber { v = n.intValue }
            else if let i = settings[key] as? Int { v = i }
            else if let d = settings[key] as? Double { v = Int(d) }
            else { v = 1 }
            return max(1, min(8, v == 0 ? 1 : v))
        }
        let lvlStore = lvlSetting("printStoreScale")
        let lvlBuyerNum = lvlSetting("printBuyerNumberScale")
        let lvlName = lvlSetting("printBuyerNameScale")
        let lvlUser = lvlSetting("printUsernameScale")
        let lvlOrder = lvlSetting("printOrderScale")
        let lvlComment = lvlSetting("printCommentScale")
        let lvlTotal = lvlSetting("printTotalScale")

        writeAscii("SIZE \(labelWidthMm) mm, \(labelHeightMm) mm")
        writeAscii("GAP 2 mm, 0")
        writeAscii("DIRECTION 1")
        writeAscii("REFERENCE 0,0")
        writeAscii("DENSITY 8")
        writeAscii("CLS")

        // ISOLATION: all per-size geometry comes from this size's config entry —
        // no shared formula, so editing one size can't affect another.
        let c = stickerConfig(labelWidthMm, labelHeightMm)

        // Header row: brand at left (font 3 so it can't reach the date), the
        // compact MM/DD/YYYY date grouped right after it. No "Session:" prefix.
        writeAscii("TEXT 16,10,\"3\",0,1,1,\"SellerFlowLive\"")
        if !sessionDate.isEmpty {
            writeAscii("TEXT 290,18,\"2\",0,1,1,\"\(tsplSafe(truncate16(sessionDate, 12)))\"")
        }
        writeAscii("BAR 0,48,\(c.wDots),3")

        // Strip unrenderable codepoints per field BEFORE the encoding decision.
        let cleanStoreName = stripEmoji(storeName)
        let cleanBuyerName = stripEmoji(buyerName)
        let cleanBuyerHandle = stripEmoji(buyerHandle)

        // Buyer name — language-agnostic resolution (works for ANY buyer):
        //  1. pure-emoji name -> handle / "Buyer #N".
        //  2. transliterate Latin diacritics -> ASCII (big font "4").
        //  3. classify: ASCII | CJK ideograph | UNSUPPORTED.
        //  4. UNSUPPORTED (Arabic/Korean/Thai/...) -> romanized @handle if ASCII,
        //     else omit the name line — never prints as '?'. Mirrors TsplBuilder.
        var nameSource = cleanBuyerName
        if !buyerName.isEmpty && cleanBuyerName.isEmpty {
            nameSource = !cleanBuyerHandle.isEmpty ? cleanBuyerHandle : "Buyer #\(buyerNum)"
        }
        var nameOut = transliterateLatin(nameSource)
        var nameTier = classifyScript(nameOut)
        if nameTier == SellerFlowPrinterPlugin.scriptUnsupported {
            let handleOut = transliterateLatin(cleanBuyerHandle)
            if !handleOut.isEmpty && classifyScript(handleOut) == SellerFlowPrinterPlugin.scriptAscii {
                nameOut = handleOut
                nameTier = SellerFlowPrinterPlugin.scriptAscii
            } else {
                nameOut = ""
            }
        }

        // `extra` accumulates the cumulative downward shift from BOTH the CJK-name
        // enlargement (legacy) and per-element size scaling, so the guards + the
        // bottom-anchored Total track everything above them. At all levels = 1 it
        // stays 0 (or the legacy CJK delta), keeping fixtures byte-identical.
        var extra = 0
        var y = 60
        if printStoreName && !cleanStoreName.isEmpty {
            let m = cmul(lvlStore)
            writeTextSmart(&out, 16, y, "3", tsplSafe(truncate16(cleanStoreName, 36)), m, m, m, m, c.rightEdge)
            let d = (m - 1) * F3
            y += c.storeGap + d
            extra += d
        }

        // Buyer # is the dominant element -- the whole point of the sticker.
        // Height multiplier per size (2x2 on tall labels, 2x1 on 60x40).
        // Height-priority scaling: width stays 2x, height = buyerNumYMul * level.
        if printBuyerNumber {
            let ym = cmul(c.buyerNumYMul * lvlBuyerNum)
            writeAscii("TEXT 16,\(y),\"4\",0,2,\(ym),\"Buyer #\(buyerNum)\"")
            let d = (ym - c.buyerNumYMul) * F4
            y += c.buyerNumGap + d
            extra += d
        }

        // Buyer name — scaled on both axes (left-aligned, has width budget). When
        // the name is CJK it renders taller (base 2x = 48 vs ASCII 32) so the
        // layout below shifts down by `extra`. ASCII at level 1 -> byte-identical.
        if !nameOut.isEmpty {
            let cjkName = nameTier == SellerFlowPrinterPlugin.scriptCjk
            let asciiX = cmul(lvlName), asciiY = cmul(lvlName)
            let cjkX = cmul(c.nameCjkXMul * lvlName), cjkY = cmul(c.nameCjkYMul * lvlName)
            writeTextSmart(&out, 16, y, "4", tsplSafe(truncate16(nameOut, 30)), asciiX, asciiY, cjkX, cjkY, c.rightEdge)
            let usedY = cjkName ? cjkY : asciiY
            let refBaseY = cjkName ? c.nameCjkYMul : 1
            let d = (usedY - refBaseY) * F4
            y += (cjkName ? c.nameCjkGap : c.nameGap) + d
            extra += (cjkName ? (c.nameCjkGap - c.nameGap) : 0) + d
        }

        // @username — kept on every size, incl. 60x40 (it replaced the Total
        // line there; buyer identity is essential on a shipping sticker).
        if printBuyerUsername && !cleanBuyerHandle.isEmpty {
            let m = cmul(lvlUser)
            writeTextSmart(&out, 16, y, "3", "@" + tsplSafe(truncate16(cleanBuyerHandle, 30)), m, m, m, m, c.rightEdge)
            let d = (m - 1) * F3
            y += c.usernameGap + d
            extra += d
        }

        // Thin separator + order lines (capped at 2 so a 60mm label can't overflow).
        if printOrderItems && !orders.isEmpty && y < c.orderEntryGuard + extra {
            writeAscii("BAR 16,\(y),\(c.sepWidth),2")
            y += c.sepGap
            let maxOrders = 2
            var i = 0
            while i < min(orders.count, maxOrders) && y < c.orderLoopGuard + extra {
                let order = orders[i]
                let time = (order["time"] as? String) ?? ""
                let item = (order["item"] as? String) ?? ""
                let cleanItem = stripEmoji(item)
                let tm = cmul(lvlOrder)
                let pm = cmul(lvlComment) // price code: height-priority (width stays 2x)
                if !time.isEmpty {
                    writeAscii("TEXT 16,\(y),\"2\",0,\(tm),\(tm),\"\(tsplSafe(truncate16(time, 10)))\"")
                }
                if !cleanItem.isEmpty {
                    // Buyer's short price code (e.g. 150/250/600) -> SAME base as
                    // the grand Total amount: font "4", 2x width, 1x height.
                    // truncate(12) guards the column width at font 4 2x.
                    writeTextSmart(&out, 180, y, "4", tsplSafe(truncate16(cleanItem, 12)), 2, pm, 2, pm, c.rightEdge)
                }
                let d = max((tm - 1) * F2, (pm - 1) * F4)
                y += 38 + d
                i += 1
            }
        }

        // Footer total, anchored to the bottom (no divider line). The order rows
        // stay clear of it via the guards. Dropped on 60x40 (config showTotal=
        // false) — swapped for the @username row; the price still prints above.
        if printTotal && totalSpent > 0 && c.showTotal {
            let totalY = c.totalY + extra
            let lm = cmul(lvlTotal)
            writeAscii("TEXT 16,\(totalY),\"3\",0,\(lm),\(lm),\"Total:\"")
            let am = cmul(lvlTotal) // amount: height-priority (width stays 2x)
            let totalStr = tsplSafe(currency) + tsplMoney(totalSpent)
            writeAscii("TEXT \(c.totalAmountX),\(totalY),\"4\",0,2,\(am),\"\(tsplSafe(truncate16(totalStr, 18)))\"")
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
    private func writeTextSmart(_ out: inout Data, _ x: Int, _ y: Int, _ asciiFont: String, _ rawContent: String, _ xMul: Int, _ yMul: Int, _ cjkXMul: Int, _ cjkYMul: Int, _ rightEdge: Int) {
        // Romanize Latin diacritics, then drop anything the AIMO has no font for
        // (non-ASCII, non-CJK-ideograph) so nothing prints as '?'.
        let content = stripUnrenderable(transliterateLatin(rawContent))
        if content.isEmpty { return }
        if !hasNonAscii(content) {
            out.append(contentsOf: tsplAsciiBytes("TEXT \(x),\(y),\"\(asciiFont)\",0,\(xMul),\(yMul),\"\(content)\""))
            out.append(contentsOf: [0x0D, 0x0A])
            return
        }
        let maxChars = max(1, (rightEdge - x) / (24 * cjkXMul))
        let fitted = truncate16(content, maxChars)
        if let gbk = gbkBytes(fitted) {
            out.append(contentsOf: tsplAsciiBytes("TEXT \(x),\(y),\"TSS24.BF2\",0,\(cjkXMul),\(cjkYMul),\""))
            out.append(contentsOf: gbk)
            out.append(contentsOf: tsplAsciiBytes("\""))
            out.append(contentsOf: [0x0D, 0x0A])
        } else {
            out.append(contentsOf: tsplAsciiBytes("TEXT \(x),\(y),\"\(asciiFont)\",0,\(xMul),\(yMul),\"\(content)\""))
            out.append(contentsOf: [0x0D, 0x0A])
        }
    }

    // ── Script handling (language-agnostic; mirrors TsplBuilder.java) ──────────
    static let scriptAscii = 1, scriptCjk = 2, scriptUnsupported = 3

    /// Latin letters NFD does NOT decompose to base+combining-mark.
    private func atomicLatin(_ ch: Character) -> String? {
        switch ch {
        case "đ": return "d";  case "Đ": return "D"
        case "ł": return "l";  case "Ł": return "L"
        case "ø": return "o";  case "Ø": return "O"
        case "æ": return "ae"; case "Æ": return "AE"
        case "œ": return "oe"; case "Œ": return "OE"
        case "ß": return "ss"
        case "þ": return "th"; case "Þ": return "Th"
        case "ð": return "d";  case "Ð": return "D"
        case "ı": return "i"
        default: return nil
        }
    }

    /// NFD-decompose, drop combining marks (U+0300-U+036F), map atomic Latin
    /// letters. CJK ideographs and plain ASCII pass through unchanged.
    private func transliterateLatin(_ s: String) -> String {
        if s.isEmpty { return "" }
        let d = s.decomposedStringWithCanonicalMapping
        var out = String.UnicodeScalarView()
        for scalar in d.unicodeScalars {
            if scalar.value >= 0x300 && scalar.value <= 0x36F { continue }
            if let mapped = atomicLatin(Character(scalar)) {
                out.append(contentsOf: mapped.unicodeScalars)
            } else {
                out.append(scalar)
            }
        }
        return String(out)
    }

    private func isCjkIdeograph(_ cp: UInt32) -> Bool {
        return (cp >= 0x4E00 && cp <= 0x9FFF)
            || (cp >= 0x3400 && cp <= 0x4DBF)
            || (cp >= 0xF900 && cp <= 0xFAFF)
    }

    /// Classify already-transliterated text: ASCII | CJK ideograph | UNSUPPORTED.
    private func classifyScript(_ s: String) -> Int {
        var hasCjk = false
        for scalar in s.unicodeScalars {
            let cp = scalar.value
            if cp <= 127 { continue }
            if isCjkIdeograph(cp) { hasCjk = true; continue }
            return SellerFlowPrinterPlugin.scriptUnsupported
        }
        return hasCjk ? SellerFlowPrinterPlugin.scriptCjk : SellerFlowPrinterPlugin.scriptAscii
    }

    /// Keep only what the printer can render: ASCII + CJK ideographs.
    private func stripUnrenderable(_ s: String) -> String {
        var out = String.UnicodeScalarView()
        for scalar in s.unicodeScalars {
            if scalar.value <= 127 || isCjkIdeograph(scalar.value) { out.append(scalar) }
        }
        return String(out)
    }

    /// US-ASCII bytes with '?' (0x3F) for any UTF-16 unit > 127 -- matches
    /// Java String.getBytes(US_ASCII). Iterates UTF-16 units (not scalars) so a
    /// surrogate-pair char yields two '?' exactly as Java does.
    private func tsplAsciiBytes(_ s: String) -> [UInt8] {
        return s.utf16.map { $0 <= 127 ? UInt8($0) : 0x3F }
    }

    /// GBK bytes for the sticker path; matches Android Charset.forName("GBK")
    /// byte-for-byte on the BMP. Delegates to the never-fail 3-tier encoder
    /// (CjkEncoding.gbkBytes) — the old single-tier GBK_95 body returned nil on
    /// real iOS devices (converter missing) and every Chinese name fell to the
    /// writeTextSmart ASCII path = literal '?' (found 2026-07-13). The Optional
    /// signature is kept so writeTextSmart stays byte-untouched; its else
    /// branch is now an unreachable safety net.
    private func gbkBytes(_ s: String) -> [UInt8]? {
        return CjkEncoding.gbkBytes(s)
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

    // ════════════════════════════════════════════════════════════════════════
    // MARK: - BLE sticker printing (AIMO D520BT dual-mode)
    //
    // The D520BT is dual-mode Bluetooth: Android talks Classic SPP (the Java
    // plugin), iPhone talks BLE (verified on real hardware: Labelife iOS test
    // print + nRF Connect GATT dump). GATT layout (verified):
    //   • Advertisement: services AF30 + HID(1812) only — FF00 is NOT advertised
    //   • After connect: PRIMARY SERVICE FF00
    //       FF02: Write, Write Without Response   ← TSPL bytes go here
    //       FF03: Notify                          ← ASCII status, e.g.
    //                                               "SSGETPRINTING:DONE"
    //
    // TSPL bytes come from the SAME buildTsplSticker used by printStickerLan —
    // the golden-parity port of Android's TsplBuilder — so iOS BLE stickers are
    // byte-identical to Android SPP stickers (all 5 sizes, per-size isolation,
    // 3-tier buyer names/GBK, price code, Taipei time). Transport lives in
    // BleStickerTransport (bottom of this file); pure decisions (chunking, DONE
    // parsing, scan filter) live in BleStickerLogic — unit-tested by
    // mobile/ios/tspl-parity/swift/BleStickerLogicTests.swift (Mac-run).
    //
    // Method names + return/reject shapes mirror the Android plugin exactly so
    // the web's existing BT UI + routing activate with ZERO web changes.
    // ════════════════════════════════════════════════════════════════════════

    private static let bleIdKey = "sellerflow_ble_label_id"
    private static let bleNameKey = "sellerflow_ble_label_name"
    private let bleTransport = BleStickerTransport()

    private func savedBleId() -> String {
        return (defaults.string(forKey: SellerFlowPrinterPlugin.bleIdKey) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// The PERSISTED printer name (captured at scan/save time — the live
    /// peripheral is nil on retrievePeripherals). This is what the printer
    /// PROFILE is resolved from, so a PM-241 gets its own diagnostic/builder
    /// path while a D520BT stays on the AIMO path. Empty when unset or when the
    /// scan advertised no name (→ resolveProfile falls back to .aimo).
    private func savedBleName() -> String {
        return (defaults.string(forKey: SellerFlowPrinterPlugin.bleNameKey) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Mirrors Android savedBluetoothPrinter(): nil (→ JS null) when unset.
    private func savedBlePrinterDict() -> [String: Any]? {
        let id = savedBleId()
        if id.isEmpty { return nil }
        let name = (defaults.string(forKey: SellerFlowPrinterPlugin.bleNameKey) ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return [
            "id": "bluetooth:\(id)",
            "address": id, // iOS has no MAC access; the BLE identifier UUID plays the address role
            "name": name.isEmpty ? "Bluetooth printer" : name,
            "paired": true,
        ]
    }

    private func savedBlePrinterOrNull() -> Any {
        return savedBlePrinterDict() ?? NSNull()
    }

    @objc func scanBluetoothLabelPrinters(_ call: CAPPluginCall) {
        bleTransport.scan(timeoutSeconds: 4.5) { [weak self] printers, error in
            guard let self = self else { return }
            if let error = error {
                // Resolve (not reject) so PrinterSettings can show the reason inline.
                call.resolve(["ok": false, "printers": [], "savedPrinter": self.savedBlePrinterOrNull(), "message": error.message])
                return
            }
            let found = printers ?? []
            let list: [[String: Any]] = found.map {
                ["id": "bluetooth:\($0.id)", "address": $0.id, "name": $0.name, "paired": false, "signal": $0.rssi]
            }
            let message = found.isEmpty
                ? "No label printer found. Make sure it is ON and not connected to another phone or app (e.g. Labelife)."
                : "Found \(found.count) label printer\(found.count == 1 ? "" : "s")."
            call.resolve(["ok": true, "printers": list, "savedPrinter": self.savedBlePrinterOrNull(), "message": message])
        }
    }

    @objc func getBluetoothLabelPrinter(_ call: CAPPluginCall) {
        call.resolve(["ok": true, "savedPrinter": savedBlePrinterOrNull()])
    }

    @objc func setBluetoothLabelPrinter(_ call: CAPPluginCall) {
        let address = (call.getString("address") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let name = (call.getString("name") ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if address.isEmpty {
            call.reject("No printer selected. Tap Scan and pick a printer first.", "BT_NOT_SET")
            return
        }
        defaults.set(address, forKey: SellerFlowPrinterPlugin.bleIdKey)
        defaults.set(name, forKey: SellerFlowPrinterPlugin.bleNameKey)
        call.resolve(["ok": true, "savedPrinter": savedBlePrinterOrNull(), "message": "Saved Bluetooth printer: \(name.isEmpty ? address : name)"])
    }

    @objc func clearBluetoothLabelPrinter(_ call: CAPPluginCall) {
        defaults.removeObject(forKey: SellerFlowPrinterPlugin.bleIdKey)
        defaults.removeObject(forKey: SellerFlowPrinterPlugin.bleNameKey)
        call.resolve(["ok": true, "savedPrinter": NSNull(), "message": "Bluetooth printer cleared"])
    }

    @objc func testStickerPrint(_ call: CAPPluginCall) {
        let savedId = savedBleId()
        if savedId.isEmpty {
            call.reject("No Bluetooth printer saved. Tap Scan in Settings and pick a printer first.", "BT_NOT_SET")
            return
        }
        // Phomemo 241: print the SAME sticker any real print produces
        // (buildTsplSticker241, DIRECTION 0 + in-layout 180°) from a fixed ASCII
        // test buyer + this call's real settings/size — so even this legacy entry
        // reflects the pattern settings and never garbles (buildTsplTestPage below
        // is DIRECTION 1 + GBK CJK, which the 241 can't render). The old hardcoded
        // verification sticker (run241VerificationPrint) stays in-tree, UNCALLED,
        // for CJK re-diagnosis. NOTE: the redesign's Test button uses
        // printStickerNative+isTest, not this method — this path is legacy/unused.
        if BleStickerLogic.resolveProfile(name: savedBleName()) == .phomemo241 {
            let testBuyer: [String: Any] = [
                "num": 88, "name": "Test Print", "handle": "sellerflow", "totalSpent": 350,
                "orders": [["item": "PRICE", "time": ""]] as [[String: Any]],
            ]
            let data241 = buildTsplSticker241(
                buyer: testBuyer, settings: call.getObject("settings"),
                storeName: call.getString("storeName") ?? "SellerFlowLive",
                currency: call.getString("currency") ?? "NT$", sessionDate: "",
                labelWidthMm: call.getInt("labelWidthMm", defaultLabelWidthMm),
                labelHeightMm: call.getInt("labelHeightMm", defaultLabelHeightMm),
                scalesRaw: call.getObject("scalesRaw")
            )
            bleTransport.printJob(data: data241, preferredId: savedId) { error in
                if let error = error {
                    call.reject("Test sticker failed: \(error.message)", error.code)
                } else {
                    call.resolve(["ok": true, "bytes": data241.count, "message": "Test sticker sent (\(data241.count) bytes)"])
                }
            }
            return
        }
        let storeName = call.getString("storeName") ?? "SellerFlowLive"
        let data = buildTsplTestPage(storeName: storeName)
        bleTransport.printJob(data: data, preferredId: savedId) { error in
            if let error = error {
                call.reject("Test sticker failed: \(error.message)", error.code)
            } else {
                call.resolve(["ok": true, "bytes": data.count, "message": "Test sticker sent (\(data.count) bytes)"])
            }
        }
    }

    /// iOS BLE counterpart of Android's printStickerNative: SAME payload, SAME
    /// TSPL builder (buildTsplSticker — golden parity), SAME return shape.
    @objc func printStickerNative(_ call: CAPPluginCall) {
        let savedId = savedBleId()
        if savedId.isEmpty {
            call.reject("No Bluetooth printer saved. Tap Scan in Settings and pick a printer first.", "BT_NOT_SET")
            return
        }
        // Phomemo 241 = a DELIBERATE PARITY with AIMO. This method is the single
        // native choke-point for EVERY sticker in the redesign — 1-Click order,
        // reprint, raffle winner, batch, desktop test, AND the Test Print button
        // (which calls THIS method with isTest:true, not testStickerPrint). The
        // 241 must consume the exact same payload — buyer + all pattern settings
        // (5 toggles + 7 scale adjusters) + label size — as the AIMO path, so a
        // seller who just swapped printers changes nothing else. So below: ONE
        // flow, the profile only picks the builder (buildTsplSticker241 vs
        // buildTsplSticker); no hardcoded content on any path.
        let is241 = BleStickerLogic.resolveProfile(name: savedBleName()) == .phomemo241
        // ORDER PATH LIVE (2026-07-17): the temporary 241 order guard (PROFILE_NOT_READY
        // no-op for isTest=false) is REMOVED — the sticker was hardware-verified on paper
        // (60×40, four edges clean at scale 1/0.9/1.1/1.5, decimal scales, PRICE). REAL
        // prints (1-Click order, reprint, raffle, batch) now run the IDENTICAL flow the
        // Test Print validated: this one choke-point, same payload/settings/size/scalesRaw,
        // the profile only picks the builder (buildTsplSticker241 vs buildTsplSticker). The
        // `isTest` flag is now inert here (both real + test take the same path); it stays
        // on the test payload harmlessly. AIMO path unchanged.
        let buyer = call.getObject("buyer") ?? [:]
        let settings = call.getObject("settings")
        let storeName = call.getString("storeName") ?? "SellerFlowLive"
        let currency = call.getString("currency") ?? ""
        let sessionDate = call.getString("sessionDate") ?? ""
        let labelWidthMm = call.getInt("labelWidthMm", defaultLabelWidthMm)
        let labelHeightMm = call.getInt("labelHeightMm", defaultLabelHeightMm)
        // 241-only raw decimal scales (absent on AIMO/legacy payloads → nil → the fork
        // falls back to the rounded integer scale). AIMO's buildTsplSticker never reads it.
        let scalesRaw = call.getObject("scalesRaw")

        // SAME payload in — the profile picks the builder. buildTsplSticker241
        // reads the identical settings/scales/size/buyer that buildTsplSticker does
        // (grep-audited parity), so every Printer & Display setting flows equally.
        let data = is241
            ? buildTsplSticker241(buyer: buyer, settings: settings, storeName: storeName, currency: currency, sessionDate: sessionDate, labelWidthMm: labelWidthMm, labelHeightMm: labelHeightMm, scalesRaw: scalesRaw)
            : buildTsplSticker(buyer: buyer, settings: settings, storeName: storeName, currency: currency, sessionDate: sessionDate, labelWidthMm: labelWidthMm, labelHeightMm: labelHeightMm)

        // NOTE (2026-07-17): the font-stepping PROBE that briefly rode the test print
        // is REMOVED — its verdict is in. The 241 renders internal fonts "1".."5"
        // (no "6".."8") and "5" is UPPERCASE-ONLY, so internal-font stepping can give
        // neither the full scale range nor a case-clean typeface. The raster band
        // (with the (xMul,yMul) glyph stretch) is the FINAL scaling architecture.
        bleTransport.printJob(data: data, preferredId: savedId) { [weak self] error in
            guard let self = self else { return }
            if let error = error {
                call.reject("Bluetooth print failed: \(error.message)", error.code)
            } else {
                call.resolve([
                    "ok": true,
                    "bytes": data.count,
                    "savedPrinter": self.savedBlePrinterOrNull(),
                    "message": "Printed sticker via Bluetooth (\(data.count) bytes)",
                ])
            }
        }
    }

    /// Byte-faithful port of TsplBuilder.textTestPage (Java) — the diagnostic
    /// page the Android BT test print uses, including the CJK encoding probes.
    func buildTsplTestPage(storeName: String) -> Data {
        var out = Data()
        func writeAscii(_ s: String) {
            out.append(contentsOf: tsplAsciiBytes(s))
            out.append(contentsOf: [0x0D, 0x0A])
        }
        func writeEncodedLine(_ prefix: String, _ text: String, _ bytes: [UInt8]?) {
            guard let bytes = bytes else { return } // encoding unavailable → skip probe (diagnostic only)
            out.append(contentsOf: tsplAsciiBytes(prefix))
            out.append(contentsOf: bytes)
            out.append(contentsOf: tsplAsciiBytes("\""))
            out.append(contentsOf: [0x0D, 0x0A])
        }
        // (If lines A/B come out BLANK on a device test print, the big5
        // converter is missing on that runtime — that blank IS the device
        // probe for the deferred Big5 slip fix; see the deferral note in the
        // receipt text() encoder.)
        func big5Bytes(_ s: String) -> [UInt8]? {
            let cfEnc = CFStringEncoding(CFStringEncodings.big5.rawValue)
            let nsEnc = CFStringConvertEncodingToNSStringEncoding(cfEnc)
            guard let data = s.data(using: String.Encoding(rawValue: nsEnc), allowLossyConversion: true) else { return nil }
            return [UInt8](data)
        }
        let safeStore = storeName.replacingOccurrences(of: "\"", with: "'")
        let fmt = DateFormatter()
        fmt.locale = Locale(identifier: "en_US_POSIX")
        fmt.dateFormat = "yyyy-MM-dd HH:mm:ss"
        let stamp = fmt.string(from: Date())

        writeAscii("SIZE \(defaultLabelWidthMm) mm, \(defaultLabelHeightMm) mm")
        writeAscii("GAP 2 mm, 0")
        writeAscii("DIRECTION 1")
        writeAscii("REFERENCE 0,0")
        writeAscii("DENSITY 8")
        writeAscii("CLS")
        writeAscii("TEXT 20,20,\"4\",0,1,1,\"SellerFlowLive\"")
        writeAscii("TEXT 20,80,\"3\",0,1,1,\"Bluetooth printer OK\"")
        writeAscii("TEXT 20,140,\"3\",0,1,1,\"\(safeStore)\"")
        writeAscii("TEXT 20,200,\"2\",0,1,1,\"\(stamp)\"")
        let cjk = "\u{9673}\u{5C0F}\u{7F8E}" // 陳小美 — same probes as the Java test page
        writeAscii("TEXT 20,250,\"2\",0,1,1,\"A:\"")
        writeEncodedLine("TEXT 70,244,\"TST24.BF2\",0,1,1,\"", cjk, big5Bytes(cjk))
        writeAscii("TEXT 20,300,\"2\",0,1,1,\"B:\"")
        writeEncodedLine("TEXT 70,294,\"3\",0,1,1,\"", cjk, big5Bytes(cjk))
        writeAscii("TEXT 20,350,\"2\",0,1,1,\"D:\"")
        writeEncodedLine("TEXT 70,344,\"TSS24.BF2\",0,1,1,\"", cjk, gbkBytes(cjk))
        writeAscii("CODEPAGE UTF-8")
        writeAscii("TEXT 20,400,\"2\",0,1,1,\"C:\"")
        writeEncodedLine("TEXT 70,394,\"TST24.BF2\",0,1,1,\"", cjk, [UInt8](cjk.utf8))
        writeAscii("CODEPAGE 437")
        // E: iOS-only EXTRA probe — a deliberate deviation from the otherwise
        // byte-faithful Java test page (lines A–D above stay byte-identical).
        // 北部還有嗎 is the real production string that exposed the missing
        // GBK_95 converter (2026-07-13, printed as ?????); this line verifies
        // the 3-tier gbkBytes encoder on hardware, in the same TSS24.BF2 +
        // CODEPAGE 437 regime as line D. Diagnostic page only — not golden-
        // guarded, Android's textTestPage is untouched.
        let cjkE = "\u{5317}\u{90E8}\u{9084}\u{6709}\u{55CE}" // 北部還有嗎
        writeAscii("TEXT 20,450,\"2\",0,1,1,\"E:\"")
        writeEncodedLine("TEXT 70,444,\"TSS24.BF2\",0,1,1,\"", cjkE, gbkBytes(cjkE))
        writeAscii("PRINT 1")
        return out
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MARK: - PHASE 0 diagnostic probes (Phomemo 241 ONLY — never the AIMO path)
    //
    // Goal: decide the Phase-1 241 builder from PHOTOS, not guesses. Three
    // SEPARATE labels (each its own PRINT 1, sent as its own DONE-gated job — a
    // 241 that emits one DONE per PRINT would truncate a single multi-PRINT
    // stream, so we NEVER do that). All probes DIRECTION 0 (the AIMO DIRECTION 1
    // printed baliktad here) with content in a central band so a DIR0 origin
    // shift can't clip it into looking "durog". Every CJK line carries an ASCII
    // encode-RECEIPT (byte count + hex) so a blank glyph is diagnosable as an
    // APP encode failure (enc=NIL) vs a PRINTER render failure — the Big5
    // converter is known-missing on some iOS runtimes (the GBK_95 saga).
    // buildTsplSticker / buildTsplTestPage (AIMO) are NOT touched.
    // ═══════════════════════════════════════════════════════════════════════

    private func probeHeader(_ w: (String) -> Void) {
        w("SIZE \(defaultLabelWidthMm) mm, \(defaultLabelHeightMm) mm")
        w("GAP 2 mm, 0")
        w("DIRECTION 0")        // AIMO uses DIRECTION 1; 241 printed baliktad → test 0
        w("REFERENCE 0,0")
        w("DENSITY 8")
        w("CLS")
    }

    /// P1 (label 1/3) — Latin internal fonts 4/3/2. Reads: does the 241 render
    /// TSPL internal-font TEXT clean AND right-side-up (not mirrored) at DIR0?
    func buildPhomemoProbeLatin() -> Data {
        var out = Data()
        func w(_ s: String) { out.append(contentsOf: tsplAsciiBytes(s)); out.append(contentsOf: [0x0D, 0x0A]) }
        probeHeader(w)
        w("TEXT 24,110,\"4\",0,1,1,\"P1 LATIN 1/3 DIR0\"")
        w("TEXT 24,165,\"3\",0,1,1,\"SellerFlowLive\"")
        w("TEXT 24,215,\"4\",0,2,2,\"Buyer #12\"")
        w("TEXT 24,315,\"2\",0,1,1,\"abc XYZ 0123456789\"")
        w("TEXT 24,355,\"2\",0,1,1,\"clipped != font-broken\"")
        w("PRINT 1")
        return out
    }

    /// P2 (label 2/3) — CJK font/codepage matrix for 陳小美, each line preceded by
    /// its ENCODE RECEIPT. A=TSS24.BF2+GBK (trusted 3-tier encoder, never nil),
    /// B=TST24.BF2+Big5, C=font3+Big5, D=CODEPAGE UTF-8+TST24.BF2+UTF-8. A blank
    /// A = printer can't render GBK; a blank B/C with "enc=NIL" = the APP couldn't
    /// Big5-encode (not the printer). Cross-check the hex vs known Big5/GBK bytes.
    func buildPhomemoProbeCjk() -> Data {
        var out = Data()
        func w(_ s: String) { out.append(contentsOf: tsplAsciiBytes(s)); out.append(contentsOf: [0x0D, 0x0A]) }
        func receipt(_ label: String, _ bytes: [UInt8]?) -> String {
            guard let b = bytes else { return "\(label) enc=NIL(app)" }
            let hex = b.prefix(8).map { String(format: "%02X", Int($0)) }.joined(separator: " ")
            return "\(label) n=\(b.count) \(hex)"
        }
        func encoded(_ prefix: String, _ bytes: [UInt8]?) {
            guard let b = bytes else { return }   // app couldn't encode → skip (receipt already said enc=NIL)
            out.append(contentsOf: tsplAsciiBytes(prefix))
            out.append(contentsOf: b)
            out.append(contentsOf: tsplAsciiBytes("\""))
            out.append(contentsOf: [0x0D, 0x0A])
        }
        let cjk = "\u{9673}\u{5C0F}\u{7F8E}"                 // 陳小美 (Traditional)
        let gbk = CjkEncoding.gbkBytes(cjk)                  // trusted, never nil
        let big5 = CjkEncoding.losslessBytes(cjk, .big5)     // nil if the iOS runtime lacks the Big5 converter
        let utf8 = [UInt8](cjk.utf8)
        probeHeader(w)
        w("TEXT 20,14,\"4\",0,1,1,\"P2 CJK 2/3 DIR0\"")
        w("TEXT 20,56,\"2\",0,1,1,\"\(receipt("A TSS/GBK", gbk))\"")
        encoded("TEXT 20,84,\"TSS24.BF2\",0,1,1,\"", gbk)
        w("TEXT 20,138,\"2\",0,1,1,\"\(receipt("B TST/BIG5", big5))\"")
        encoded("TEXT 20,166,\"TST24.BF2\",0,1,1,\"", big5)
        w("TEXT 20,220,\"2\",0,1,1,\"\(receipt("C F3/BIG5", big5))\"")
        encoded("TEXT 20,248,\"3\",0,1,1,\"", big5)
        w("CODEPAGE UTF-8")
        w("TEXT 20,302,\"2\",0,1,1,\"\(receipt("D UTF8", utf8))\"")
        encoded("TEXT 20,330,\"TST24.BF2\",0,1,1,\"", utf8)
        w("CODEPAGE 437")
        w("PRINT 1")
        return out
    }

    /// P3 (label 3/3) — a standalone hardcoded TSPL BITMAP (NOT the dormant
    /// printSticker path). 160x80-dot asymmetric block (solid top-left quadrant +
    /// top/bottom rules) so orientation is readable regardless of bit polarity.
    /// Reads: if P1 garbles but this raster prints clean → the 241 is raster-first.
    /// NOTE the uncovered case: if BOTH P1 and this blank, the real path may be a
    /// vendor "SS" raster (per SSGETPRINTING:DONE), which this does NOT test.
    func buildPhomemoProbeRaster() -> Data {
        var out = Data()
        func w(_ s: String) { out.append(contentsOf: tsplAsciiBytes(s)); out.append(contentsOf: [0x0D, 0x0A]) }
        let widthBytes = 20, height = 80   // 160 dots wide x 80 tall
        var bmp = [UInt8](repeating: 0xFF, count: widthBytes * height) // 0xFF background
        for row in 0..<40 { for col in 0..<10 { bmp[row * widthBytes + col] = 0x00 } } // solid top-left quadrant
        for col in 0..<widthBytes { bmp[col] = 0x00; bmp[(height - 1) * widthBytes + col] = 0x00 } // top+bottom rules
        probeHeader(w)
        w("TEXT 24,20,\"4\",0,1,1,\"P3 RASTER 3/3 DIR0\"")
        out.append(contentsOf: tsplAsciiBytes("BITMAP 24,70,\(widthBytes),\(height),0,"))
        out.append(contentsOf: bmp)            // raw bitmap data (unquoted, per TSPL BITMAP syntax)
        out.append(contentsOf: [0x0D, 0x0A])
        w("PRINT 1")
        return out
    }

    /// Phase 0 probe sequence — RETAINED FOR RE-DIAGNOSIS (no UI entry since
    /// Phase 1; the 241 Test Print now prints the verification sticker). The 3
    /// probes ride ONE connection as a DONE-gated SEQUENCE (label N+1 only after
    /// label N's PRINTING:DONE — no truncation; no per-label reconnect race).
    private func runPhase0Probes(savedId: String, call: CAPPluginCall) {
        let payloads = [buildPhomemoProbeLatin(), buildPhomemoProbeCjk(), buildPhomemoProbeRaster()]
        bleTransport.printJobSequence(payloads: payloads, preferredId: savedId) { error in
            if let error = error {
                call.reject("Phase 0 probe sequence failed (count the printed labels — numbered 1/3..3/3 — to locate the stage): \(error.message)", error.code)
            } else {
                call.resolve([
                    "ok": true,
                    "phase0": true,
                    "labels": 3,
                    "message": "Phase 0 probes sent: 3 labels (P1 Latin, P2 CJK+receipts, P3 raster).",
                ])
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // MARK: - PHASE 1: Phomemo 241 sticker builder (hybrid TEXT + raster)
    //
    // ⚠️ FORK-OF buildTsplSticker — deliberate deltas, COMPLETE list (the drift
    // rule lives in CLAUDE.md: any AIMO layout edit must be mirrored here or
    // consciously declined, in writing):
    //   D1. DIRECTION 0 + IN-LAYOUT 180° ROTATION (2026-07-17). The 241's
    //       DIRECTION 1 rasterizer is BROKEN — garbled/durog font on BOTH 100x60
    //       and 60x40 (hardware-confirmed, 2 sizes; DIR1 was the original "durog"
    //       too). Only DIRECTION 0 renders clean. So we keep DIRECTION 0 (verified)
    //       and rotate the WHOLE layout 180° at emit time so the header still ejects
    //       FIRST + upright: a rot-0 element at (x,y) → rot-180 at (W−x, H−y); BAR →
    //       (W−x−w, H−y−h); a raster band pre-rotates its pixels 180° (flip180) and
    //       re-anchors its box. The layout MATH is still the verbatim AIMO layout —
    //       only the emit primitives (emitText / emitBar / the BITMAP anchor) carry
    //       the rotation. ⚠️ rotation-180 TEXT rendering on the 241 is NOT yet
    //       device-verified (it uses the clean DIR0 output path, so it SHOULD be
    //       fine — different engine from the broken DIR1 transform). The CJK bands
    //       are guaranteed-clean (BITMAP-at-DIR0, pixels we control). If a photo
    //       shows rotated TEXT garbled like DIR1, the last resort is ALL-RASTER
    //       (render every element to a band). Anti-drift pin: fork == rotate180(AIMO).
    //   D2. Non-ASCII renders as a BITMAP raster band (the 241 font ROM has NO
    //       working CJK font — all 5 Phase-0 P2 probes failed with verified-good
    //       app-side encoding). Band height = 24 × cjkYMul — the SAME multiplied
    //       value the AIMO TSS24.BF2 path uses, so the seller size-adjuster and
    //       the d/extra reflow math stay identical (audit F1 hard requirement).
    //   D3. NO UNSUPPORTED-script downgrade-to-handle (audit F3 decision): the
    //       band renders ANY script (Thai/Korean/Vietnamese full glyphs...), so
    //       the AIMO name fallback block is dropped and the gap math keys on
    //       hasNonAscii (band) instead of nameTier==CJK. stripEmoji STAYS (v1);
    //       emoji rendering = v2.
    //   D4. writeTextSmart241 does NOT stripUnrenderable (the band can render
    //       what the AIMO ROM cannot). Latin/ASCII path byte-identical.
    // Everything else (header, SizeConfig table, gaps, guards, settings gates,
    // truncations, Total anchor) is a verbatim copy — only the emit primitives
    // apply the 180° map. Drift guard: the Mac-run ASCII-parity test pins all-ASCII
    // output == rotate180(AIMO output). AIMO's buildTsplSticker is UNTOUCHED and
    // golden-locked.
    // ═══════════════════════════════════════════════════════════════════════

    func buildTsplSticker241(
        buyer: [String: Any],
        settings: [String: Any]?,
        storeName: String,
        currency: String,
        sessionDate: String,
        labelWidthMm: Int,
        labelHeightMm: Int,
        scalesRaw: [String: Any]? = nil,
        bandRenderer: ((String, Double, Double, Int) -> Phomemo241Raster.Band?)? = nil
    ) -> Data {
        let renderBand = bandRenderer ?? { [weak self] text, xMul, yMul, w in self?.render241TextBand(text, xMul: xMul, yMul: yMul, maxWidthDots: w) }
        var out = Data()
        func writeAscii(_ s: String) {
            out.append(contentsOf: tsplAsciiBytes(s))
            out.append(contentsOf: [0x0D, 0x0A])
        }
        // ── DIRECTION 0 + in-layout 180° rotation (D1) ──────────────────────
        // The 241's DIRECTION 1 rasterizer is BROKEN (garbled font on BOTH 100x60
        // and 60x40 — hardware-confirmed); only DIRECTION 0 renders clean. To still
        // eject HEADER-first + upright, every element is rotated 180° IN THE LAYOUT
        // at DIRECTION 0: a rotation-0 element at (x,y) becomes a rotation-180
        // element whose anchor is the 180°-about-centre image of its top-left,
        // (W−x, H−y). A BAR (a rectangle) just re-anchors to (W−x−w, H−y−h). A
        // raster band pre-rotates its pixels 180° (flip180) and re-anchors its box
        // to (W−x−boxW, H−y−h). The layout math below (top-down y, gaps, guards,
        // Total) is the VERBATIM AIMO layout — only these emit primitives carry the
        // rotation. W/H = label in dots (203 DPI = 8 dot/mm), matching c.wDots.
        //   EDGE_GUARD: the AIMO's 16-dot LEFT margin maps to a 16-dot RIGHT margin
        //   under the 180° flip, but the 241's DIRECTION-0 printable window is
        //   narrower/offset on that side (60×40 device: the FIRST letter of every
        //   line — the right-hugging one after the flip — clipped). So pull the whole
        //   layout LEFT by EDGE_GUARD: the flipped layout is right-heavy (its left
        //   side has ~200 dots of slack), so this clears the right edge without
        //   clipping the left. Applied to text + bands (BAR clamps at 0).
        //   48 (was 32): the 32-dot pull left the FIRST letter of the x=16 lines
        //   (SellerFlowLive / shop / name / @handle / time) still half-clipped on the
        //   241's DIRECTION-0 right edge at 60×40. +16 clears it; the right-side date
        //   (x=290) keeps ample slack (≈200-dot right-heavy layout), so nothing else
        //   clips. All sizes share it — larger labels have even more room.
        let W = labelWidthMm * 8
        let H = labelHeightMm * 8
        let edgeGuard = 48
        func emitText(_ x: Int, _ y: Int, _ font: String, _ xMul: Int, _ yMul: Int, _ content: String) {
            writeAscii("TEXT \(W - x - edgeGuard),\(H - y),\"\(font)\",180,\(xMul),\(yMul),\"\(content)\"")
        }
        func emitBar(_ x: Int, _ y: Int, _ w: Int, _ h: Int) {
            writeAscii("BAR \(max(0, W - x - w - edgeGuard)),\(H - y - h),\(w),\(h)")
        }
        // Clamp a raster multiplier to the usable range. Ceiling 8 mirrors AIMO's cmul
        // (the TSPL font 8× ceiling) so INTEGER scales stay height-parity with the
        // goldens; floor 0.5 lets sub-1 decimals genuinely SHRINK on the band path
        // (AIMO's cmul floors at 1 = can't shrink; the 241 raster can — BUG 3).
        func clampF(_ v: Double) -> Double { return min(8.0, max(0.5, v)) }
        // Emit `content` as a pre-rotated raster band, box re-anchored under the 180°
        // map: top-left → (W−x−boxW, H−y−h). boxW = widthBytes*8 (left-aligned content
        // shifts ≤7 dots, sub-mm). Pixels are pre-rotated (render flips). Empty/blank or
        // a failed render → emit NOTHING (a 0-width BITMAP is malformed). Muls are
        // DECIMAL (Double): the seller size adjuster is a fine 0.1 step and the band
        // renderer sizes in PIXELS (24 × yMul), so it honors every step (BUG 3), unlike
        // rotation-180 TEXT which the 241 firmware won't scale.
        func emitBand(_ x: Int, _ y: Int, _ content: String, _ xMulRaw: Double, _ yMulRaw: Double, _ rightEdge: Int) {
            if content.isEmpty { return }
            let xMul = clampF(xMulRaw), yMul = clampF(yMulRaw)
            // Usable width RESERVES the EDGE_GUARD on the far side too. The placed box is
            // bx = W−x−bandW−edgeGuard; capping bandW ≤ rightEdge−x−edgeGuard keeps bx ≥
            // W−rightEdge (= the 16-dot margin, always ≥0) so it NEVER hits the max(0,…)
            // clamp that shifted a too-wide band and sliced its leading letter. The band
            // then reads [x+edgeGuard, ≤rightEdge] — the same left margin as the TEXT
            // elements, both edges clear at every scale.
            let avail = max(8, rightEdge - x - edgeGuard)
            // CJK is drawn at NATURAL width and CLIPPED to the canvas, so truncate to the
            // cells that fit (≈24×xMul dots each) — from the ACTUAL decimal, NOT rounded
            // up (1.1 rounded to 2 halved the budget → "@sellerfl"). ASCII is monospace and
            // the renderer COMPRESSES it to `avail` (AIMO-like), so pass it WHOLE (only the
            // caller's source truncate applies) → a long name shrinks to fit, never right-clips.
            let fitted: String
            if hasNonAscii(content) {
                let cell = max(1, Int((24 * xMul).rounded()))
                fitted = truncate16(content, max(1, avail / cell))
            } else {
                fitted = content
            }
            guard let band = renderBand(fitted, xMul, yMul, avail),
                  band.height > 0, band.widthBytes > 0, !band.bytes.isEmpty else { return }
            let bx = max(0, W - x - band.widthBytes * 8 - edgeGuard)
            let by = H - y - band.height
            out.append(contentsOf: tsplAsciiBytes("BITMAP \(bx),\(by),\(band.widthBytes),\(band.height),0,"))
            out.append(contentsOf: band.bytes)
            out.append(contentsOf: [0x0D, 0x0A])
        }
        // SYMMETRIC scalable element (store / ASCII name / @username): AIMO scales BOTH
        // axes by the level, so the band scales both by the decimal. scale EXACTLY 1.0
        // (ASCII) → the verified TEXT command (byte-identical default). CJK or scale≠1
        // → a (scale, scale)-stretched band. base TEXT muls are (1,1).
        func emitSym(_ x: Int, _ y: Int, _ font: String, _ scale: Double, _ rawContent: String, _ rightEdge: Int) {
            let content = transliterateLatin(rawContent)
            if content.isEmpty { return }   // same emptiness rule as writeTextSmart (parity)
            let isCjk = hasNonAscii(content)
            if !isCjk && scale == 1.0 { emitText(x, y, font, 1, 1, content); return }
            emitBand(x, y, content, scale, scale, rightEdge)
        }
        // HEIGHT-PRIORITY scalable element (Buyer# / price code): AIMO keeps the width
        // multiplier FIXED (baseX) and scales only HEIGHT with the level; mirror that —
        // band width = baseX (glyph stays baseX× wide), band height = baseY × scale.
        // scale EXACTLY 1.0 (ASCII) → TEXT at (baseX, baseY) [byte-identical]. CJK or
        // scale≠1 → band.
        func emitHeightScaled(_ x: Int, _ y: Int, _ font: String, _ baseX: Int, _ baseY: Int, _ scale: Double, _ rawContent: String, _ rightEdge: Int) {
            let content = transliterateLatin(rawContent)
            if content.isEmpty { return }
            let isCjk = hasNonAscii(content)
            if !isCjk && scale == 1.0 { emitText(x, y, font, baseX, baseY, content); return }
            emitBand(x, y, content, Double(baseX), Double(baseY) * scale, rightEdge)
        }
        // Decimal scale for `key`: the 241 raster path reads the exact seller adjuster
        // from scalesRaw (BUG 3 — the redesign rounds it to an int for the AIMO TSPL
        // path, losing 0.1 steps). Falls back to the rounded integer (Double) when
        // scalesRaw is absent (App.tsx / legacy / native test payloads), so those stay
        // byte-identical. 0 → 1 (never a zero-size element).
        func sclD(_ key: String) -> Double {
            if let raw = scalesRaw, let n = raw[key] as? NSNumber {
                let d = n.doubleValue
                return clampF(d == 0 ? 1 : d)
            }
            return Double(lvlSetting(key))
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

        // F3/F4 = the 1× TSPL font heights (dots) used only to reflow the layout down
        // so a grown element never overlaps the next. (No F2: the order-line time is
        // fixed at base size — see the order loop — so it never shifts the layout.)
        let F3 = 24, F4 = 32
        func lvlSetting(_ key: String) -> Int {
            guard let settings = settings else { return 1 }
            let v: Int
            if let n = settings[key] as? NSNumber { v = n.intValue }
            else if let i = settings[key] as? Int { v = i }
            else if let d = settings[key] as? Double { v = Int(d) }
            else { v = 1 }
            return max(1, min(8, v == 0 ? 1 : v))
        }
        // DECIMAL seller scales for the raster path (BUG 3). sclD reads the exact 0.1
        // step from scalesRaw, falling back to the rounded integer when absent. Note:
        // NO order/time scale — the 241 order-line TIME is FIXED at base size (BUG 1/2:
        // the redesign's single "comment" control drove BOTH price + time, so a scaled
        // time band collided with the price column → "7:07PRICE"). AIMO is untouched.
        let sStore = sclD("printStoreScale")
        let sBuyerNum = sclD("printBuyerNumberScale")
        let sName = sclD("printBuyerNameScale")
        let sUser = sclD("printUsernameScale")
        let sComment = sclD("printCommentScale")
        let sTotal = sclD("printTotalScale")

        writeAscii("SIZE \(labelWidthMm) mm, \(labelHeightMm) mm")
        writeAscii("GAP 2 mm, 0")
        writeAscii("DIRECTION 0")   // 241 DIR1 rasterizer is broken; rotate in-layout (D1)
        writeAscii("REFERENCE 0,0")
        writeAscii("DENSITY 8")
        writeAscii("CLS")

        let c = stickerConfig(labelWidthMm, labelHeightMm)

        emitText(16, 10, "3", 1, 1, "SellerFlowLive")
        if !sessionDate.isEmpty {
            emitText(290, 18, "2", 1, 1, tsplSafe(truncate16(sessionDate, 12)))
        }
        emitBar(0, 48, c.wDots, 3)

        let cleanStoreName = stripEmoji(storeName)
        let cleanBuyerName = stripEmoji(buyerName)
        let cleanBuyerHandle = stripEmoji(buyerHandle)

        // D3: name resolution WITHOUT the UNSUPPORTED downgrade — the band
        // renders any script. Emoji-only names still fall back (stripEmoji, v1).
        var nameSource = cleanBuyerName
        if !buyerName.isEmpty && cleanBuyerName.isEmpty {
            nameSource = !cleanBuyerHandle.isEmpty ? cleanBuyerHandle : "Buyer #\(buyerNum)"
        }
        let nameOut = transliterateLatin(nameSource)
        let bandName = hasNonAscii(nameOut)   // D3: replaces nameTier==CJK for the gap math

        var extra = 0
        var y = 60
        if printStoreName && !cleanStoreName.isEmpty {
            emitSym(16, y, "3", sStore, tsplSafe(truncate16(cleanStoreName, 36)), c.rightEdge)
            let d = Int(((clampF(sStore) - 1) * Double(F3)).rounded())
            y += c.storeGap + d
            extra += d
        }

        if printBuyerNumber {
            let effY = clampF(Double(c.buyerNumYMul) * sBuyerNum)   // height mul (width stays 2×)
            emitHeightScaled(16, y, "4", 2, c.buyerNumYMul, sBuyerNum, "Buyer #\(buyerNum)", c.rightEdge)
            let d = Int(((effY - Double(c.buyerNumYMul)) * Double(F4)).rounded())
            y += c.buyerNumGap + d
            extra += d
        }

        if !nameOut.isEmpty {
            if bandName {
                // CJK / UNSUPPORTED name → band on both axes (base nameCjk*Mul), scaled.
                emitBand(16, y, tsplSafe(truncate16(nameOut, 30)), Double(c.nameCjkXMul) * sName, Double(c.nameCjkYMul) * sName, c.rightEdge)
                let effY = clampF(Double(c.nameCjkYMul) * sName)
                let d = Int(((effY - Double(c.nameCjkYMul)) * Double(F4)).rounded())
                y += c.nameCjkGap + d
                extra += (c.nameCjkGap - c.nameGap) + d
            } else {
                emitSym(16, y, "4", sName, tsplSafe(truncate16(nameOut, 30)), c.rightEdge)
                let d = Int(((clampF(sName) - 1) * Double(F4)).rounded())
                y += c.nameGap + d
                extra += d
            }
        }

        if printBuyerUsername && !cleanBuyerHandle.isEmpty {
            emitSym(16, y, "3", sUser, "@" + tsplSafe(truncate16(cleanBuyerHandle, 30)), c.rightEdge)
            let d = Int(((clampF(sUser) - 1) * Double(F3)).rounded())
            y += c.usernameGap + d
            extra += d
        }

        if printOrderItems && !orders.isEmpty && y < c.orderEntryGuard + extra {
            emitBar(16, y, c.sepWidth, 2)
            y += c.sepGap
            let maxOrders = 2
            var i = 0
            while i < min(orders.count, maxOrders) && y < c.orderLoopGuard + extra {
                let order = orders[i]
                let time = (order["time"] as? String) ?? ""
                let item = (order["item"] as? String) ?? ""
                let cleanItem = stripEmoji(item)
                // TIME — FIXED at base size (BUG 1/2). It has no dedicated size control,
                // the shared "comment" scale drove it, and a scaled time BAND grew wide
                // enough to overrun the price column at x=180 ("7:07PRICE"). A timestamp
                // stays small: plain TEXT font "2" 1×1 (byte-identical to the scale-1 default).
                if !time.isEmpty {
                    emitText(16, y, "2", 1, 1, tsplSafe(truncate16(time, 10)))
                }
                // PRICE CODE — height-priority (base 2× width, 1× height); height honors
                // the comment decimal (BUG 3). ASCII scale 1.0 → TEXT (byte-identical).
                if !cleanItem.isEmpty {
                    emitHeightScaled(180, y, "4", 2, 1, sComment, tsplSafe(truncate16(cleanItem, 12)), c.rightEdge)
                }
                let d = max(0, Int(((clampF(sComment) - 1) * Double(F4)).rounded()))
                y += 38 + d
                i += 1
            }
        }

        if printTotal && totalSpent > 0 && c.showTotal {
            let totalY = c.totalY + extra
            emitSym(16, totalY, "3", sTotal, "Total:", c.rightEdge)
            let totalStr = tsplSafe(currency) + tsplMoney(totalSpent)
            emitHeightScaled(c.totalAmountX, totalY, "4", 2, 1, sTotal, tsplSafe(truncate16(totalStr, 18)), W - 16)
        }

        writeAscii("PRINT 1")
        return out
    }

    /// Render a text band for the 241 raster path — UIGraphicsImageRenderer
    /// ONLY (documented thread-safe; UIGraphicsBeginImageContext is NOT and is
    /// BANNED here — Capacitor invokes plugin calls off-main). 1 point = 1 pixel
    /// = 1 printer dot (203dpi). System font cascade resolves CJK to PingFang TC
    /// (Traditional-correct) and other scripts to their system fonts.
    /// The band's TARGET size is a base glyph cell STRETCHED by (xMul, yMul) — the
    /// same thing the AIMO `TEXT …,"4",0,xMul,yMul` does (a stretched bitmap). So
    /// the LETTER grows tall/narrow with the scale (not just the whitespace), and a
    /// wide string doesn't clip the way a uniform blow-up would. ASCII → a MONOSPACE
    /// BOLD face (closest to the TSPL ROM look), cap sized to the base cell so caps/
    /// digits fill top-to-bottom. CJK → unchanged (systemFont, em ≈ fills — the
    /// device-verified 陳小美/紅色洋裝 path). base cell = 24 dots (~ TSPL font "4").
    private func render241TextBand(_ text: String, xMul: Double, yMul: Double, maxWidthDots: Int) -> Phomemo241Raster.Band? {
        if text.isEmpty || xMul <= 0 || yMul <= 0 || maxWidthDots <= 0 { return nil }
        let baseCell = 24
        // Height in PIXELS from the EXACT decimal (24 × yMul), so every 0.1 step of the
        // seller size adjuster changes the rendered glyph (BUG 3) — a rotation-180 TEXT
        // multiplier the 241 ignores, a pixel dimension it can't. min 1 dot.
        let outH = max(1, Int((Double(baseCell) * yMul).rounded()))
        let isCjk = text.unicodeScalars.contains {
            ($0.value >= 0x2E80 && $0.value <= 0x9FFF) || ($0.value >= 0x3400 && $0.value <= 0x4DBF) || ($0.value >= 0xF900 && $0.value <= 0xFAFF)
        }
        let img: UIImage
        let outW: Int
        let fmt = UIGraphicsImageRendererFormat()
        fmt.scale = 1
        if isCjk {
            // CJK — verified path, unchanged: system font at outH×0.82, width natural.
            let font = UIFont.systemFont(ofSize: CGFloat(outH) * 0.82, weight: .medium)
            let str = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: UIColor.black])
            let m = str.size()
            let w = min(Int(ceil(m.width)), maxWidthDots)
            if w <= 0 { return nil }
            outW = w
            img = UIGraphicsImageRenderer(size: CGSize(width: outW, height: outH), format: fmt).image { ctx in
                UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: outW, height: outH))
                str.draw(at: CGPoint(x: 0, y: max(0, (CGFloat(outH) - m.height) / 2)))
            }
        } else {
            // ASCII/Latin — monospace bold, then STRETCH by (xMul, yMul) so the letter
            // itself grows (AIMO-like). Size so the FULL glyph — cap-top DOWN TO the
            // descender-bottom — fits the base cell (cap + |descender| == baseCell). The
            // old sizing pinned CAP == baseCell and put descenders BELOW the canvas, so
            // the "y" in "Buyer" (and g/p/q/j) clipped at the bottom at every band scale.
            // Now cap-top → 0 and descender-bottom → baseCell, so the whole glyph lands
            // in [0, baseCell] → [0, outH] after the yMul scale — no top/bottom clip.
            let ref = UIFont.monospacedSystemFont(ofSize: 100, weight: .bold)
            let capRatio = ref.capHeight > 0 ? ref.capHeight / 100 : 0.70
            let descRatio = ref.descender < 0 ? -ref.descender / 100 : 0.21   // |descender| / size
            let glyphExtent = max(0.5, capRatio + descRatio)                  // cap-top → descender-bottom
            let font = UIFont.monospacedSystemFont(ofSize: CGFloat(baseCell) / glyphExtent, weight: .bold)
            let str = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: UIColor.black])
            let m = str.size()
            if m.width < 1 { return nil }
            outW = min(Int(ceil(m.width * CGFloat(xMul))), maxWidthDots)
            if outW <= 0 { return nil }
            let hStretch = CGFloat(outW) / CGFloat(m.width)   // = xMul unless width-clamped
            img = UIGraphicsImageRenderer(size: CGSize(width: outW, height: outH), format: fmt).image { ctx in
                UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: outW, height: outH))
                ctx.cgContext.scaleBy(x: hStretch, y: CGFloat(yMul))
                str.draw(at: CGPoint(x: 0, y: font.capHeight - font.ascender)) // cap-top → 0; descender-bottom → baseCell
            }
        }
        guard let cg = img.cgImage else { return nil }
        let w = cg.width, h = cg.height
        var gray = [UInt8](repeating: 255, count: w * h)
        guard let gctx = CGContext(data: &gray, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w,
                                   space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGImageAlphaInfo.none.rawValue) else { return nil }
        gctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
        // flip180: TRUE always — the 241 builder runs DIRECTION 0 + in-layout 180°
        // (the DIR1 rasterizer is broken), so every band is pre-rotated 180° so it
        // reads upright once the whole label is rotated. Unit-pinned in packBits.
        return Phomemo241Raster.packBits(gray: gray, width: w, height: h, flip180: true)
    }

    /// Phase-1 verification sticker (the 241 Test Print, single entry point for
    /// BOTH testStickerPrint and printStickerNative+isTest). FIXED payload so the
    /// photo review is deterministic; exercises every proving case: CJK name
    /// band (陳小美), CJK product band (紅色洋裝 x2) = MULTIPLE BITMAPs per label,
    /// Latin TEXT lines (Blue jeans M), buyer#, date, Total. Order path stays
    /// PROFILE_NOT_READY until this print passes photo review (Phase 2 flips it).
    private func run241VerificationPrint(savedId: String, storeName: String, call: CAPPluginCall) {
        let buyer: [String: Any] = [
            "num": 88,
            "name": "\u{9673}\u{5C0F}\u{7F8E}",          // 陳小美
            "handle": "sellerflow",
            "totalSpent": 1200,
            "orders": [
                ["item": "\u{7D05}\u{8272}\u{6D0B}\u{88DD} x2", "time": "20:15"],  // 紅色洋裝 x2
                ["item": "Blue jeans M", "time": "20:18"],
            ] as [[String: Any]],
        ]
        // Use the SELLER's configured label size (the web Test payload carries it) so
        // the verification matches the actual paper — Jeff's production stock is 60×40
        // now, not 100×60. Falls back to the 100×60 default if the call omits it.
        let labelWidthMm = call.getInt("labelWidthMm", defaultLabelWidthMm)
        let labelHeightMm = call.getInt("labelHeightMm", defaultLabelHeightMm)
        let data = buildTsplSticker241(
            buyer: buyer, settings: nil, storeName: storeName, currency: "NT$",
            sessionDate: "07/17/2026", labelWidthMm: labelWidthMm, labelHeightMm: labelHeightMm
        )
        bleTransport.printJob(data: data, preferredId: savedId) { error in
            if let error = error {
                call.reject("241 verification sticker failed: \(error.message)", error.code)
            } else {
                call.resolve([
                    "ok": true,
                    "phase1": true,
                    "bytes": data.count,
                    "message": "241 verification sticker sent (\(data.count) bytes) — check: HEADER exits first + everything upright, Latin sharp, 陳小美 + 紅色洋裝 legible. If the Latin/Buyer# TEXT is garbled but the CJK bands are clean, the 241 can't render rotated TEXT → all-raster is the next step.",
                ])
            }
        }
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// MARK: - CJK printer encoders (pure, hardware-free — same convention as
// BleStickerLogic below; tests: tspl-parity/swift/CjkEncodingTests.swift AND
// the pre-Archive simulator gate tspl-parity/run-encoders-sim.sh)
//
// WHY THIS EXISTS (2026-07-13 device finding): CFStringEncodings.GBK_95's
// converter is MISSING on real iOS devices — (s as NSString).data(using:)
// returned nil for every CJK string, writeTextSmart fell to its ASCII path,
// and buyers' Chinese names printed as literal '?' (0x3F) on the AIMO
// D520BT-Z (production evidence: 北部還有嗎 → ?????). The Mac-run logic tests
// never caught it because macOS ships the converter, so these encoders are
// covered by tests that run against the iOS runtime (Simulator).
// ═════════════════════════════════════════════════════════════════════════════

// CJK-ENCODING-BEGIN (extracted VERBATIM by tspl-parity/run-encoders-sim.sh —
// keep this block Foundation-only: no Capacitor/UIKit/CoreBluetooth.)
enum CjkEncoding {

    /// NSStringEncoding for a CF encoding, or nil when this OS runtime does
    /// not ship the converter (the iOS-device gap that broke GBK_95).
    static func nsEncoding(_ enc: CFStringEncodings) -> UInt? {
        let cf = CFStringEncoding(enc.rawValue)
        guard CFStringIsEncodingAvailable(cf) else { return nil }
        return CFStringConvertEncodingToNSStringEncoding(cf)
    }

    /// Lossless whole-string bytes, nil if the converter is unavailable OR any
    /// character has no mapping (NSString.data(using:) is all-or-nothing).
    static func losslessBytes(_ s: String, _ enc: CFStringEncodings) -> [UInt8]? {
        guard let ns = nsEncoding(enc) else { return nil }
        guard let d = (s as NSString).data(using: ns) else { return nil }
        return [UInt8](d)
    }

    /// GBK bytes for the AIMO sticker ROM — Java String.getBytes("GBK")
    /// semantics ('?' per unmappable code point) and NEVER fails the string.
    ///  Tier 1: whole-string GBK_95 — byte-identical to the pre-fix path
    ///          wherever that converter exists, so working environments are
    ///          unchanged.
    ///  Tier 2: per-scalar GBK_95, else GB_18030_2000 accepting only 1–2 byte
    ///          output. GB18030's 1–2 byte range is byte-identical to GBK; a
    ///          4-byte sequence means the char is NOT in GBK — the AIMO's GBK
    ///          ROM can't render it, so it becomes '?' exactly like Java's
    ///          replacement (TsplBuilder.writeTextSmart's getBytes("GBK")).
    ///  Tier 3: '?' (0x3F) for anything still unmapped.
    /// Per-scalar == whole-string for GBK/GB18030 (stateless, no shift
    /// states; fixture-verified in CjkEncodingTests).
    static func gbkBytes(_ s: String) -> [UInt8] {
        if let whole = losslessBytes(s, .GBK_95) { return whole }
        var out: [UInt8] = []
        out.reserveCapacity(s.unicodeScalars.count * 2)
        for scalar in s.unicodeScalars {
            if scalar.value <= 127 { out.append(UInt8(scalar.value)); continue }
            let ch = String(scalar)
            if let b = losslessBytes(ch, .GBK_95), b.count <= 2 {
                out.append(contentsOf: b)
            } else if let b = losslessBytes(ch, .GB_18030_2000), b.count <= 2 {
                out.append(contentsOf: b)
            } else {
                out.append(0x3F)
            }
        }
        return out
    }

    // NOTE (2026-07-13 audit): a never-fail big5Bytes twin for the receipt
    // path (big5 → per-scalar big5/CP950 → DROP, Android stripUnencodable
    // parity) was built and fixture-verified, then REMOVED from this release
    // — only GBK_95 has device evidence; one binary = one confirmed fix. It
    // lives at git b44f5b5; restore in its own audited branch once the
    // [CJK-ENV] gate or a blank-A/B test print proves the big5 converter is
    // also missing on the iOS runtime.

    /// Strict integer parse of CFBundleVersion for the JS shim's
    /// getBuildNumber. Returns 0 for anything unparseable/non-positive, and 0
    /// means "do NOT emit the shim line": the web's bridgeBuildNumber()
    /// (adapters/nativeVersion.ts) treats ANY finite number as the real build,
    /// so a parse-failure 0 would read as "build 0 = stale" and nag forever —
    /// omitting the function instead falls back to capability synthesis.
    static func buildNumberLiteral(from raw: String?) -> Int {
        guard let raw = raw, let n = Int(raw), n > 0 else { return 0 }
        return n
    }
}
// CJK-ENCODING-END

// ═════════════════════════════════════════════════════════════════════════════
// MARK: - Phomemo 241 raster pure logic (no UIKit — unit-testable standalone)
//
// The DECISIONS of the 241 band pipeline: 1-bit packing (polarity/padding/
// threshold) + the AIMO-mirror char budget. The UIKit glyph render stays
// isolated in render241TextBand (device-verified only — the Mac/sim runtime
// cannot prove printer glyph output; the GBK_95 lesson).
// Tests: mobile/ios/tspl-parity/swift/Phomemo241BuilderTests.swift (Mac-run).
// ═════════════════════════════════════════════════════════════════════════════

enum Phomemo241Raster {
    struct Band {
        let widthBytes: Int
        let height: Int
        let bytes: [UInt8]
    }

    /// Pack row-major 8-bit grayscale (0=black…255=white) into TSPL BITMAP
    /// mode-0 bytes. Bit 0 = BLACK dot (hardware-proven by the Phase-0 P3 probe:
    /// 0x00 printed black, 0xFF background). Width pads UP to a whole byte —
    /// TSPL's width field is in BYTES — with pad bits = 1 (white). Invalid
    /// dimensions / short pixel buffer → nil (caller emits nothing; a 0-width
    /// BITMAP is a malformed command).
    /// flip180 (default false): rotate the band 180° while packing — output
    /// (row,col) reads from source (height-1-row, width-1-col). The 241 builder runs
    /// DIRECTION 0 + in-layout 180°, so it packs bands with flip180=true (they read
    /// upright once the whole label is rotated). false is byte-identical to the
    /// un-flipped pack (kept for the unit pins).
    static func packBits(gray: [UInt8], width: Int, height: Int, threshold: UInt8 = 128, flip180: Bool = false) -> Band? {
        guard width > 0, height > 0, gray.count >= width * height else { return nil }
        let widthBytes = (width + 7) / 8
        var out = [UInt8](repeating: 0xFF, count: widthBytes * height)
        for row in 0..<height {
            for col in 0..<width {
                let srcRow = flip180 ? (height - 1 - row) : row
                let srcCol = flip180 ? (width - 1 - col) : col
                if gray[srcRow * width + srcCol] < threshold {
                    out[row * widthBytes + (col >> 3)] &= ~(UInt8(0x80) >> (col & 7))
                }
            }
        }
        return Band(widthBytes: widthBytes, height: height, bytes: out)
    }

    /// AIMO-mirror character budget for a band from its x origin (full-width
    /// cells of 24×cjkXMul dots) — same formula as writeTextSmart's CJK clamp,
    /// so truncation behavior matches the AIMO path.
    static func maxChars(x: Int, rightEdge: Int, cjkXMul: Int) -> Int {
        return max(1, (rightEdge - x) / (24 * max(1, cjkXMul)))
    }
}

// ═════════════════════════════════════════════════════════════════════════════
// MARK: - BLE pure logic (no CoreBluetooth types — unit-testable standalone)
//
// Every DECISION the transport makes lives here so it can be tested without
// hardware: chunk sizing/splitting, DONE detection, and the scan filter.
// Tests: mobile/ios/tspl-parity/swift/BleStickerLogicTests.swift (Mac-run,
// same convention as MobileTsplBuilderTests — CI cannot compile Swift).
// ═════════════════════════════════════════════════════════════════════════════

enum BleStickerLogic {
    /// Advertised service on the D520BT (FF00 is NOT advertised — verified).
    static let advertisedService = "AF30"
    /// Device-name prefix; the suffix varies per unit ("D520BT-Z", …).
    static let namePrefix = "D520BT"
    /// Phomemo 241 device-name prefix (scanned as "PM-241Z-BT-…"). Additive: it
    /// makes the 241 discoverable AND routes it to its own profile. It can NEVER
    /// match a D520BT, so the AIMO path is unaffected. (Fix: PM-241 only, not
    /// "PM-2" — a broader prefix could grab a different printer that already
    /// works via the AIMO/AF30 path.)
    static let phomemoNamePrefix = "PM-241"
    /// Proven-safe ceiling for write-without-response payloads on this printer
    /// class, and the BLE minimum (ATT default MTU 23 − 3 header).
    static let maxChunk = 180
    static let minChunk = 20

    /// Usable chunk size: the iOS-negotiated maximumWriteValueLength clamped to
    /// [minChunk, maxChunk]; non-positive (unknown) → maxChunk default.
    static func clampChunkSize(_ reported: Int) -> Int {
        if reported <= 0 { return maxChunk }
        return max(minChunk, min(reported, maxChunk))
    }

    /// Split the TSPL buffer into write-without-response chunks. The final
    /// chunk carries the remainder; empty data → empty array.
    static func chunks(_ data: Data, chunkSize: Int) -> [Data] {
        let size = max(1, chunkSize)
        var out: [Data] = []
        var index = data.startIndex
        while index < data.endIndex {
            let end = data.index(index, offsetBy: size, limitedBy: data.endIndex) ?? data.endIndex
            out.append(data.subdata(in: index..<end))
            index = end
        }
        return out
    }

    /// Success signal: the ACCUMULATED FF03 ASCII stream contains
    /// "PRINTING:DONE". Suffix-tolerant (the printer sends e.g.
    /// "SSGETPRINTING:DONE") and split-tolerant (a status line can arrive
    /// across several notifications — callers accumulate, we just match).
    static func containsPrintDone(_ buffer: String) -> Bool {
        return buffer.uppercased().contains("PRINTING:DONE")
    }

    /// Scan filter: advertised service AF30 (16-bit or full-128 form) OR name
    /// prefix "D520BT" (case-insensitive). NEVER FF00 — it is not advertised.
    static func isTargetPrinter(name: String?, advertisedServices: [String]) -> Bool {
        for raw in advertisedServices {
            let s = raw.uppercased()
            if s == advertisedService || s.hasPrefix("0000\(advertisedService)-") { return true }
        }
        if let n = name?.uppercased(), n.hasPrefix(namePrefix) || n.hasPrefix(phomemoNamePrefix) { return true }
        return false
    }

    /// Which printer PROFILE a saved device name maps to — the SINGLE SOURCE for
    /// the routing decision (scan discovery uses isTargetPrinter above; print
    /// paths use this). Case-normalized like isTargetPrinter. Only a name that
    /// starts "PM-241" is .phomemo241; everything else (incl. D520BT, empty, nil)
    /// is .aimo, so the live AIMO path is the provable default and a PM-241 can
    /// never be misrouted onto it (nor a D520BT onto the 241 diagnostics).
    static func resolveProfile(name: String?) -> PrinterProfile {
        if let n = name?.uppercased(), n.hasPrefix(phomemoNamePrefix) { return .phomemo241 }
        return .aimo
    }
}

/// Printer command/behavior profile. .aimo = the live, golden-locked TSPL stream
/// (AIMO D520BT and any non-PM-241 device). .phomemo241 = the new isolated path
/// (Phase 0 = diagnostics only; Phase 1 = its own builder). NEVER a mutation of
/// the AIMO builder.
enum PrinterProfile {
    case aimo
    case phomemo241
}

/// Honest, code-tagged BLE failure — codes mirror the Android plugin's reject
/// codes so the web result handling stays uniform.
struct BleError {
    let message: String
    let code: String
}

// ═════════════════════════════════════════════════════════════════════════════
// MARK: - BLE transport (CoreBluetooth) — one job at a time
//
// Job pipeline: ensure poweredOn → resolve peripheral (saved identifier →
// system-connected FF00 → scan w/ BleStickerLogic filter) → connect →
// discover FF00 → FF02/FF03 → subscribe FF03 FIRST → chunked
// write-without-response to FF02 (negotiated MTU clamped, canSend
// backpressure + 8ms pacing) → success only on "PRINTING:DONE" notify →
// ALWAYS disconnect (single-connection etiquette — never hold the printer).
// Timeouts fail honestly; there is no fake success path.
// ═════════════════════════════════════════════════════════════════════════════

final class BleStickerTransport: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {

    struct DiscoveredPrinter {
        let id: String   // CBPeripheral.identifier UUID string (iOS's stable handle)
        let name: String
        let rssi: Int
    }

    private let queue = DispatchQueue(label: "com.sellerflow.ble")
    private var central: CBCentralManager?

    // manager-state waiters (first call also triggers the permission prompt)
    private var stateWaiters: [(BleError?) -> Void] = []
    private var stateTimer: DispatchWorkItem?

    // scan-only (Settings → Scan)
    private var scanFound: [String: DiscoveredPrinter] = [:]
    private var scanDone: (([DiscoveredPrinter]) -> Void)?
    private var scanTimer: DispatchWorkItem?

    // print job (single-flight)
    private var jobActive = false
    private var jobDone: ((BleError?) -> Void)?
    private var overallTimer: DispatchWorkItem?
    private var phaseTimer: DispatchWorkItem?
    private var pacingTimer: DispatchWorkItem?
    private var preferredId: String?
    private var fallbackTarget: CBPeripheral?
    private var peripheral: CBPeripheral?
    private var writeChar: CBCharacteristic?
    private var notifyChar: CBCharacteristic?
    private var pendingChunks: [Data] = []
    private var nextChunk = 0
    private var allChunksSent = false
    private var notifyBuffer = ""
    private var payload = Data()
    // Multi-label queue (printJobSequence ONLY — always [] for printJob, so the
    // single-payload AIMO path is provably byte-identical). Each queued payload
    // is its own PRINT 1 label, DONE-gated before the next is sent, all inside
    // ONE connection (sequential printJob calls raced: job N+1's connect vs job
    // N's in-flight cancelPeripheralConnection → stale didDisconnectPeripheral
    // killed job N+1).
    private var remainingPayloads: [Data] = []

    private let uuidService = CBUUID(string: "FF00")
    private let uuidWrite = CBUUID(string: "FF02")
    private let uuidNotify = CBUUID(string: "FF03")

    // MARK: public API (callable from any thread; completions hop to main)

    func scan(timeoutSeconds: TimeInterval, completion: @escaping ([DiscoveredPrinter]?, BleError?) -> Void) {
        ensurePoweredOn { [weak self] error in
            guard let self = self else { return }
            if let error = error { DispatchQueue.main.async { completion(nil, error) }; return }
            self.queue.async {
                if self.jobActive || self.scanDone != nil {
                    DispatchQueue.main.async { completion(nil, BleError(message: "Bluetooth is busy with another printer task.", code: "BT_BUSY")) }
                    return
                }
                self.scanFound = [:]
                self.scanDone = { found in DispatchQueue.main.async { completion(found, nil) } }
                self.central?.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
                let t = DispatchWorkItem { [weak self] in self?.finishScan() }
                self.scanTimer = t
                self.queue.asyncAfter(deadline: .now() + timeoutSeconds, execute: t)
            }
        }
    }

    func printJob(data: Data, preferredId: String?, completion: @escaping (BleError?) -> Void) {
        ensurePoweredOn { [weak self] error in
            guard let self = self else { return }
            if let error = error { DispatchQueue.main.async { completion(error) }; return }
            self.queue.async {
                if self.jobActive || self.scanDone != nil {
                    DispatchQueue.main.async { completion(BleError(message: "Another printer task is still in progress.", code: "BT_BUSY")) }
                    return
                }
                self.jobActive = true
                self.jobDone = { err in DispatchQueue.main.async { completion(err) } }
                self.payload = data
                self.remainingPayloads = []   // single-payload job (AIMO path) — queue always empty
                self.preferredId = (preferredId?.isEmpty == false) ? preferredId : nil
                self.fallbackTarget = nil
                self.notifyBuffer = ""
                self.pendingChunks = []
                self.nextChunk = 0
                self.allChunksSent = false
                self.writeChar = nil
                self.notifyChar = nil

                // hard cap: a stuck job can never hang the seller's print flow
                self.overallTimer = self.schedule(seconds: 30) { [weak self] in
                    self?.finishJob(BleError(message: "Print timed out.", code: "BT_PRINT_FAILED"))
                }

                // fast paths: known identifier, or already system-connected (FF00)
                var target: CBPeripheral?
                if let id = self.preferredId, let uuid = UUID(uuidString: id) {
                    target = self.central?.retrievePeripherals(withIdentifiers: [uuid]).first
                }
                if target == nil {
                    target = self.central?.retrieveConnectedPeripherals(withServices: [self.uuidService]).first
                }
                if let p = target { self.connect(p) } else { self.scanForJob() }
            }
        }
    }

    /// Multi-label job: ONE connection, each payload its own PRINT 1 label,
    /// DONE-gated per label (label N+1 is sent only after label N's
    /// PRINTING:DONE — the F1 no-truncation guarantee), disconnect only after
    /// the LAST label. Used by the Phomemo Phase 0 probes; printJob (the AIMO
    /// path) is untouched and keeps its exact single-payload behavior.
    func printJobSequence(payloads: [Data], preferredId: String?, completion: @escaping (BleError?) -> Void) {
        guard let first = payloads.first else {
            DispatchQueue.main.async { completion(nil) }
            return
        }
        ensurePoweredOn { [weak self] error in
            guard let self = self else { return }
            if let error = error { DispatchQueue.main.async { completion(error) }; return }
            self.queue.async {
                if self.jobActive || self.scanDone != nil {
                    DispatchQueue.main.async { completion(BleError(message: "Another printer task is still in progress.", code: "BT_BUSY")) }
                    return
                }
                self.jobActive = true
                self.jobDone = { err in DispatchQueue.main.async { completion(err) } }
                self.payload = first
                self.remainingPayloads = Array(payloads.dropFirst())
                self.preferredId = (preferredId?.isEmpty == false) ? preferredId : nil
                self.fallbackTarget = nil
                self.notifyBuffer = ""
                self.pendingChunks = []
                self.nextChunk = 0
                self.allChunksSent = false
                self.writeChar = nil
                self.notifyChar = nil

                // wider cap than the single-label 30s: N labels ride one job
                self.overallTimer = self.schedule(seconds: 75) { [weak self] in
                    self?.finishJob(BleError(message: "Print sequence timed out.", code: "BT_PRINT_FAILED"))
                }

                var target: CBPeripheral?
                if let id = self.preferredId, let uuid = UUID(uuidString: id) {
                    target = self.central?.retrievePeripherals(withIdentifiers: [uuid]).first
                }
                if target == nil {
                    target = self.central?.retrieveConnectedPeripherals(withServices: [self.uuidService]).first
                }
                if let p = target { self.connect(p) } else { self.scanForJob() }
            }
        }
    }

    // MARK: manager state

    private func ensurePoweredOn(_ completion: @escaping (BleError?) -> Void) {
        queue.async {
            if CBCentralManager.authorization == .denied || CBCentralManager.authorization == .restricted {
                completion(BleError(message: "Bluetooth permission denied. Allow Bluetooth for SellerFlowLive in iPhone Settings.", code: "BT_PERMISSION"))
                return
            }
            if self.central == nil {
                // First creation triggers the iOS Bluetooth permission prompt.
                self.central = CBCentralManager(delegate: self, queue: self.queue)
            }
            guard let central = self.central else {
                completion(BleError(message: "Bluetooth unavailable on this device.", code: "BT_UNAVAILABLE"))
                return
            }
            switch central.state {
            case .poweredOn:
                completion(nil)
            case .unknown, .resetting:
                self.stateWaiters.append(completion)
                if self.stateTimer == nil {
                    self.stateTimer = self.schedule(seconds: 6) { [weak self] in
                        self?.flushStateWaiters(BleError(message: "Bluetooth did not become ready.", code: "BT_UNAVAILABLE"))
                    }
                }
            default:
                completion(self.stateError(central.state))
            }
        }
    }

    private func stateError(_ state: CBManagerState) -> BleError {
        switch state {
        case .unauthorized:
            return BleError(message: "Bluetooth permission denied. Allow Bluetooth for SellerFlowLive in iPhone Settings.", code: "BT_PERMISSION")
        case .poweredOff:
            return BleError(message: "Bluetooth is off. Turn it on in Control Center and try again.", code: "BT_OFF")
        case .unsupported:
            return BleError(message: "Bluetooth LE is not supported on this device.", code: "BT_UNAVAILABLE")
        default:
            return BleError(message: "Bluetooth is not ready.", code: "BT_UNAVAILABLE")
        }
    }

    private func flushStateWaiters(_ error: BleError?) {
        stateTimer?.cancel()
        stateTimer = nil
        let waiters = stateWaiters
        stateWaiters = []
        waiters.forEach { $0(error) }
    }

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        switch central.state {
        case .poweredOn:
            flushStateWaiters(nil)
        case .unknown, .resetting:
            break // still settling — keep waiting
        default:
            let err = stateError(central.state)
            flushStateWaiters(err)
            if jobActive { finishJob(err) }
            if scanDone != nil { finishScan() }
        }
    }

    // MARK: scanning

    private func finishScan() {
        scanTimer?.cancel()
        scanTimer = nil
        if !jobActive { central?.stopScan() }
        let done = scanDone
        scanDone = nil
        done?(Array(scanFound.values).sorted { $0.rssi > $1.rssi })
    }

    private func scanForJob() {
        central?.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
        phaseTimer = schedule(seconds: 8) { [weak self] in
            guard let self = self else { return }
            // saved printer not seen — but if exactly one target printer showed
            // up, use it (single-printer reality; identifier may have rotated).
            if let fallback = self.fallbackTarget {
                self.connect(fallback)
                return
            }
            self.finishJob(BleError(message: "Printer not found. Make sure it is ON and not connected to another phone or app (e.g. Labelife).", code: "BT_NOT_FOUND"))
        }
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let advName = advertisementData[CBAdvertisementDataLocalNameKey] as? String
        let name = advName ?? peripheral.name
        let services = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID])?.map { $0.uuidString } ?? []
        let isTarget = BleStickerLogic.isTargetPrinter(name: name, advertisedServices: services)

        if scanDone != nil && isTarget {
            let id = peripheral.identifier.uuidString
            scanFound[id] = DiscoveredPrinter(id: id, name: name ?? id, rssi: RSSI.intValue)
        }
        guard jobActive, self.peripheral == nil else { return }
        if let wanted = preferredId {
            if peripheral.identifier.uuidString.caseInsensitiveCompare(wanted) == .orderedSame {
                connect(peripheral)
            } else if isTarget && fallbackTarget == nil {
                fallbackTarget = peripheral // remembered for the scan-timeout fallback
            }
        } else if isTarget {
            connect(peripheral)
        }
    }

    // MARK: connect + discover

    private func connect(_ p: CBPeripheral) {
        phaseTimer?.cancel()
        if !jobActive { return }
        if scanDone == nil { central?.stopScan() }
        peripheral = p
        p.delegate = self
        phaseTimer = schedule(seconds: 8) { [weak self] in
            self?.finishJob(BleError(message: "Could not connect to the printer.", code: "BT_PRINT_FAILED"))
        }
        central?.connect(p, options: nil)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        guard jobActive, peripheral === self.peripheral else { return }
        phaseTimer?.cancel()
        phaseTimer = schedule(seconds: 6) { [weak self] in
            self?.finishJob(BleError(message: "Printer services did not respond.", code: "BT_PRINT_FAILED"))
        }
        peripheral.discoverServices([uuidService])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        guard jobActive, peripheral === self.peripheral else { return }
        finishJob(BleError(message: "Could not connect: \(error?.localizedDescription ?? "unknown error")", code: "BT_PRINT_FAILED"))
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        guard jobActive, peripheral === self.peripheral else { return }
        finishJob(BleError(message: "Printer disconnected during printing.", code: "BT_PRINT_FAILED"))
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard jobActive, peripheral === self.peripheral else { return }
        if let error = error {
            finishJob(BleError(message: "Service discovery failed: \(error.localizedDescription)", code: "BT_PRINT_FAILED"))
            return
        }
        guard let service = peripheral.services?.first(where: { $0.uuid == uuidService }) else {
            finishJob(BleError(message: "This device is not a supported label printer (service FF00 missing).", code: "BT_PRINT_FAILED"))
            return
        }
        peripheral.discoverCharacteristics([uuidWrite, uuidNotify], for: service)
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard jobActive, peripheral === self.peripheral, service.uuid == uuidService else { return }
        if let error = error {
            finishJob(BleError(message: "Characteristic discovery failed: \(error.localizedDescription)", code: "BT_PRINT_FAILED"))
            return
        }
        writeChar = service.characteristics?.first(where: { $0.uuid == uuidWrite })
        notifyChar = service.characteristics?.first(where: { $0.uuid == uuidNotify })
        guard let notify = notifyChar, writeChar != nil else {
            finishJob(BleError(message: "Printer write/status channels (FF02/FF03) not found.", code: "BT_PRINT_FAILED"))
            return
        }
        // Subscribe to status FIRST — never write before notifications are live.
        peripheral.setNotifyValue(true, for: notify)
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
        guard jobActive, peripheral === self.peripheral, characteristic.uuid == uuidNotify else { return }
        if let error = error {
            finishJob(BleError(message: "Could not subscribe to printer status: \(error.localizedDescription)", code: "BT_PRINT_FAILED"))
            return
        }
        phaseTimer?.cancel()
        let chunkSize = BleStickerLogic.clampChunkSize(peripheral.maximumWriteValueLength(for: .withoutResponse))
        pendingChunks = BleStickerLogic.chunks(payload, chunkSize: chunkSize)
        nextChunk = 0
        pump()
    }

    // MARK: chunk pump (backpressure via canSend + peripheralIsReady; 8ms pacing)

    private func pump() {
        guard jobActive, let p = peripheral, let w = writeChar else { return }
        if nextChunk < pendingChunks.count {
            if !p.canSendWriteWithoutResponse { return } // resumes on peripheralIsReady
            let chunk = pendingChunks[nextChunk]
            nextChunk += 1
            p.writeValue(chunk, for: w, type: .withoutResponse)
            if nextChunk < pendingChunks.count {
                let t = DispatchWorkItem { [weak self] in self?.pump() }
                pacingTimer = t
                queue.asyncAfter(deadline: .now() + .milliseconds(8), execute: t)
                return
            }
        }
        if nextChunk >= pendingChunks.count && !allChunksSent {
            allChunksSent = true
            // All TSPL bytes are out — success requires the printer's own DONE.
            phaseTimer = schedule(seconds: 10) { [weak self] in
                self?.finishJob(BleError(message: "Printer did not confirm within 10s — check the printer.", code: "BT_PRINT_FAILED"))
            }
        }
    }

    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        pump()
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard jobActive, peripheral === self.peripheral, characteristic.uuid == uuidNotify else { return }
        guard let value = characteristic.value, !value.isEmpty else { return }
        notifyBuffer += String(data: value, encoding: .utf8)
            ?? String(decoding: value, as: UTF8.self)
        if BleStickerLogic.containsPrintDone(notifyBuffer) {
            // Single-payload job (AIMO): queue is always empty → finish, exactly
            // as before. Sequence job: this label is CONFIRMED printed → send the
            // next one on the SAME connection.
            if remainingPayloads.isEmpty {
                finishJob(nil)
            } else {
                advancePayload()
            }
        }
    }

    /// Sequence jobs only: label N confirmed (DONE) → reset the per-label state
    /// and pump label N+1 over the live connection. Never reached by printJob
    /// (its queue is always empty).
    private func advancePayload() {
        guard jobActive, let p = peripheral else { return }
        phaseTimer?.cancel(); phaseTimer = nil
        notifyBuffer = ""
        payload = remainingPayloads.removeFirst()
        let chunkSize = BleStickerLogic.clampChunkSize(p.maximumWriteValueLength(for: .withoutResponse))
        pendingChunks = BleStickerLogic.chunks(payload, chunkSize: chunkSize)
        nextChunk = 0
        allChunksSent = false
        pump()
    }

    // MARK: finish (idempotent; ALWAYS releases the printer)

    private func schedule(seconds: TimeInterval, _ block: @escaping () -> Void) -> DispatchWorkItem {
        let t = DispatchWorkItem(block: block)
        queue.asyncAfter(deadline: .now() + seconds, execute: t)
        return t
    }

    private func finishJob(_ error: BleError?) {
        guard jobActive else { return }
        jobActive = false
        overallTimer?.cancel(); overallTimer = nil
        phaseTimer?.cancel(); phaseTimer = nil
        pacingTimer?.cancel(); pacingTimer = nil
        if scanDone == nil { central?.stopScan() }
        if let p = peripheral {
            if let notify = notifyChar, p.state == .connected { p.setNotifyValue(false, for: notify) }
            central?.cancelPeripheralConnection(p)
        }
        peripheral = nil
        writeChar = nil
        notifyChar = nil
        fallbackTarget = nil
        pendingChunks = []
        remainingPayloads = []
        payload = Data()
        notifyBuffer = ""
        let done = jobDone
        jobDone = nil
        done?(error)
    }
}
