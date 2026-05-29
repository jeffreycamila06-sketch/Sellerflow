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
    ]

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

        let data = buildEscPosSlip(
            buyer: buyer,
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
        storeName: String,
        currency: String,
        sessionDate: String,
        createdAt: String
    ) -> Data {
        var out = Data()
        func raw(_ bs: [UInt8]) { out.append(contentsOf: bs) }
        func text(_ s: String) {
            // GBK encoding to match Android printer charset (Chinese thermal printers).
            // GBK_95 matches Android's `Charset.forName("GBK")` exactly. (Previously
            // this used GB_18030_2000 which is a superset and emits different bytes
            // for non-BMP characters -- byte-for-byte parity with Android required GBK_95.)
            let cfEnc = CFStringEncoding(CFStringEncodings.GBK_95.rawValue)
            let nsEnc = CFStringConvertEncodingToNSStringEncoding(cfEnc)
            if let d = (s as NSString).data(using: nsEnc) {
                out.append(d)
            } else if let d = s.data(using: .utf8) {
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
        func money(_ v: Double) -> String {
            return floor(v) == v ? String(Int(v)) : String(format: "%.2f", v)
        }

        // init
        raw([0x1B, 0x40])
        alignCenter()
        bold(true); text(storeName); bold(false)                // normal -- header
        text("SellerFlowLive")                                   // normal -- subtitle
        line()                                                   // normal -- divider
        alignLeft()

        setCharSize(Self.ESC_POS_IMPORTANT_SIZE)                 // === 2x BLOCK ===
        let buyerNum = (buyer["num"] as? Int) ?? (buyer["bNum"] as? Int) ?? 0
        text("Buyer #\(buyerNum)")
        text("Name: \((buyer["name"] as? String) ?? "")")
        text("Handle: \((buyer["handle"] as? String) ?? "")")
        setCharSize(0x00)                                        // === END 2x ===

        text("Platform: \((buyer["platform"] as? String) ?? "")") // normal -- header info
        text("Session: \(sessionDate)")                           // normal -- header info
        line()                                                    // normal -- divider

        let orders = (buyer["orders"] as? [[String: Any]]) ?? []
        if !orders.isEmpty {
            for (i, order) in orders.enumerated() {
                setCharSize(Self.ESC_POS_IMPORTANT_SIZE)             // === 2x BLOCK ===
                bold(true); text("Order #\((order["orderNum"] as? Int) ?? (i + 1))"); bold(false)
                text((order["item"] as? String) ?? "")
                text("Qty: \((order["qty"] as? Int) ?? 1)")
                let price = (order["price"] as? Double) ?? Double((order["price"] as? Int) ?? 0)
                let total = (order["total"] as? Double) ?? Double((order["total"] as? Int) ?? 0)
                if price > 0 { text("Price: \(currency) \(money(price))") }
                if total > 0 { text("Total: \(currency) \(money(total))") }
                setCharSize(0x00)                                    // === END 2x ===

                if let t = order["time"] as? String, !t.isEmpty { text(t) }  // normal -- timestamp
                line()                                                        // normal -- divider
            }
        } else {
            setCharSize(Self.ESC_POS_IMPORTANT_SIZE)                 // === 2x BLOCK ===
            text("Order:")
            text((buyer["lastComment"] as? String) ?? (buyer["comment"] as? String) ?? "")
            setCharSize(0x00)                                        // === END 2x ===
            line()
        }

        let totalSpent = (buyer["totalSpent"] as? Double) ?? Double((buyer["totalSpent"] as? Int) ?? 0)
        if totalSpent > 0 {
            setCharSize(Self.ESC_POS_IMPORTANT_SIZE)                 // === 2x BLOCK ===
            bold(true); text("TOTAL: \(currency) \(money(totalSpent))"); bold(false)
            setCharSize(0x00)                                        // === END 2x ===
        }
        text("Created: \(createdAt)")                                // normal -- timestamp
        feed(4)
        cut()
        return out
    }
}
