// SellerFlowAuthPlugin.swift
//
// In-app sign-in sheet for the Facebook Page authorization (app builds 1.8+).
// JS: window.Capacitor.Plugins.SellerFlowAuth.openAuthSession({ url })
//   → { status: "connected" | "error" | "cancelled" | "busy", code? }
//
// Opens the Facebook dialog URL (from GET /fb/oauth/start?client=app) in an
// ASWebAuthenticationSession. Our server's confirm page ends the flow with a 303 to
// com.sellerflow.live://fb-auth?fb=connected|error&code=…; the session catches that scheme
// itself and closes — the URL carries only a status word, never a code, state or token.
// No CFBundleURLTypes entry is needed (the session intercepts the scheme), so no other app
// can open SellerFlow with it.
//
// prefersEphemeralWebBrowserSession = false: the sheet shares Safari's cookies, so a seller
// already logged in to Facebook in Safari goes straight to the permission dialog. iOS shows
// its "SellerFlow wants to use facebook.com to sign in" alert first.
//
// Separate from SellerFlowPrinterPlugin (not touched). Registered with one line in
// SellerFlowBridgeViewController.

import AuthenticationServices
import Capacitor
import UIKit

// MARK: - Pure logic (testable without a session)
enum AuthCallback {
    static let scheme = "com.sellerflow.live"
    static let host = "fb-auth"

    // Only Facebook's own https pages may be opened in the sheet.
    static func isAllowedStartURL(_ url: URL?) -> Bool {
        guard let url = url, url.scheme?.lowercased() == "https", let host = url.host?.lowercased() else { return false }
        return host == "facebook.com" || host.hasSuffix(".facebook.com")
    }

    // com.sellerflow.live://fb-auth?fb=connected → ["status": "connected"]
    // com.sellerflow.live://fb-auth?fb=error&code=cap → ["status": "error", "code": "cap"]
    static func result(from url: URL?) -> [String: String] {
        guard let url = url, url.scheme?.lowercased() == scheme, url.host?.lowercased() == host,
              let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems else {
            return ["status": "error", "code": "bad_callback"]
        }
        let fb = items.first(where: { $0.name == "fb" })?.value ?? ""
        if fb == "connected" { return ["status": "connected"] }
        let code = items.first(where: { $0.name == "code" })?.value ?? "unknown"
        if code == "cancelled" { return ["status": "cancelled"] }
        // Only a short safe word is passed on (the server sends fixed reason codes).
        let safe = String(code.prefix(40).filter { $0.isLetter || $0.isNumber || $0 == "_" })
        return ["status": "error", "code": safe.isEmpty ? "unknown" : safe]
    }
}

@objc(SellerFlowAuthPlugin)
public class SellerFlowAuthPlugin: CAPPlugin, CAPBridgedPlugin, ASWebAuthenticationPresentationContextProviding {
    public let identifier = "SellerFlowAuthPlugin"
    public let jsName = "SellerFlowAuth"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "openAuthSession", returnType: CAPPluginReturnPromise),
    ]

    private var session: ASWebAuthenticationSession?

    @objc func openAuthSession(_ call: CAPPluginCall) {
        let url = URL(string: call.getString("url") ?? "")
        guard AuthCallback.isAllowedStartURL(url), let startURL = url else {
            call.resolve(["status": "error", "code": "bad_url"])
            return
        }
        DispatchQueue.main.async {
            if self.session != nil {
                call.resolve(["status": "busy"])
                return
            }
            let s = ASWebAuthenticationSession(url: startURL, callbackURLScheme: AuthCallback.scheme) { [weak self] callbackURL, error in
                DispatchQueue.main.async {
                    self?.session = nil
                    if let error = error {
                        let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                        call.resolve(cancelled ? ["status": "cancelled"] : ["status": "error", "code": "session_failed"])
                        return
                    }
                    call.resolve(AuthCallback.result(from: callbackURL))
                }
            }
            s.presentationContextProvider = self
            s.prefersEphemeralWebBrowserSession = false
            self.session = s
            if !s.start() {
                self.session = nil
                call.resolve(["status": "error", "code": "session_failed"])
            }
        }
    }

    public func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        return bridge?.viewController?.view.window ?? ASPresentationAnchor()
    }
}
