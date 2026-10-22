// NiimbotKitDriver.swift — Niimbot label printers (B1 / B21 / B203 / B3S) through the vendor
// iOS SDK, inside the SEPARATE embedded NiimbotKit.framework (min iOS 17.2).
//
// The app never links this framework: on iOS 17.2+ it dlopen()s it, finds this class by its
// Objective-C name ("NiimbotKitDriver") and calls it through SFLNiimbotDriving. The SDK's
// static libraries are built for iOS 17.2, so keeping them in here (and never loading the
// framework on older iOS) keeps the app itself at iOS 15.0 with zero Niimbot symbols.
//
// THE PRINT PATH IS THE zh4dev/niimbot-printer REFERENCE, VERBATIM (zh4dev/, MIT): every
// custom call sequence we tried crashed inside the SDK (missing selector, then rapidjson
// asserts in drawLableText / DrawLableImage — state the SDK keeps between calls). So this
// driver makes NO JCAPI call of its own: SFLReferencePrint = the reference's connect
// (openPrinter + setPrinterModel) and its onStartPrint with ONE "image" element on a 50×30
// label, on the MAIN thread like Flutter's method channel. The driver only adds the
// "[Niimbot] …" NSLog lines, a single-flight guard, and closePrinter on EVERY exit
// (success, error, timeout). The SDK libraries have no simulator slice → the simulator build
// of this framework is a stub (NIIMBOT_UNAVAILABLE).
// ⚠️ UNVERIFIED ON HARDWARE until NIIMBOT's SDK usage permission arrives.
import Foundation
import UIKit

enum NiimbotKitLogic {
    /// The reference reports printer errors as English messages (PrintUtility
    /// printErrorMessage:); map the ones the app has seller-level codes for.
    static func code(forReferenceMessage message: String) -> String {
        switch message {
        case "Lid open": return "NIIMBOT_COVER_OPEN"
        case "Out of paper": return "NIIMBOT_NO_PAPER"
        case "Not enough power", "Battery abnormality": return "NIIMBOT_LOW_BATTERY"
        case "Unsupported paper type", "Check paper type": return "NIIMBOT_PAPER_TYPE"
        case "Printer disconnected", "Printer not connected": return "BT_NOT_FOUND"
        case "Printer is busy", "Another print job is in progress": return "BT_BUSY"
        default: return "NIIMBOT_ERROR"
        }
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
    private static let openTimeout: TimeInterval = 15
    /// Backstop only: the reference has its own 30 s print timeout that reports back; this
    /// guarantees closePrinter + a completion even if that never fires.
    private static let backstopTimeout: TimeInterval = 60
    private let queue = DispatchQueue(label: "com.sellerflow.niimbotkit")
    private var busy = false

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
                        JCAPI.closePrinter()
                        self.queue.async { self.busy = false }
                        completion(ok, code, message)
                    }
                }
            }
            NSLog("[Niimbot] job start: label %.0fx%.0f mm, png=%d bytes (reference path)", wMm, hMm, png.count)
            guard png.count > 0 else { finish(false, "BT_PRINT_FAILED", "Bad image data"); return }
            DispatchQueue.main.async {
                var answered = false
                NSLog("[Niimbot] openPrinter (reference connect)")
                SFLReferencePrint.connectPrinterNamed(name) { ok in
                    if answered { return }
                    answered = true
                    NSLog("[Niimbot] openPrinter → %d", ok ? 1 : 0)
                    guard ok else { finish(false, "BT_NOT_FOUND", "Could not connect to the printer"); return }
                    // Flutter's method-channel handler runs on the main thread; so does the print.
                    DispatchQueue.main.async {
                        SFLReferencePrint.printImageBase64(png.base64EncodedString(), widthMm: wMm, heightMm: hMm) { ok, message in
                            NSLog("[Niimbot] reference print → ok=%d message=%@", ok ? 1 : 0, message)
                            finish(ok, ok ? "" : NiimbotKitLogic.code(forReferenceMessage: message), message)
                        }
                    }
                }
                DispatchQueue.main.asyncAfter(deadline: .now() + NiimbotKitDriver.openTimeout) {
                    if !answered {
                        answered = true
                        NSLog("[Niimbot] openPrinter: no answer in %.0fs", NiimbotKitDriver.openTimeout)
                        finish(false, "BT_NOT_FOUND", "Could not connect to the printer")
                    }
                }
            }
            self.queue.asyncAfter(deadline: .now() + NiimbotKitDriver.backstopTimeout) {
                if !finished {
                    NSLog("[Niimbot] BACKSTOP TIMEOUT after %.0fs", NiimbotKitDriver.backstopTimeout)
                    finish(false, "BT_PRINT_FAILED", "Print timed out")
                }
            }
        }
    }
}

#endif
