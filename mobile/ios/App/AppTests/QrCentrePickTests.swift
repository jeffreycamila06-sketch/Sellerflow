// QrCentrePickTests.swift (AppTests target — runs in the xcodebuild gate)
//
// The native scanner's centre pick (QrCentrePick in SellerFlowScannerPlugin.swift) against the SAME
// examples as the web rule (src/lib/qrCentrePick.ts). The cases are generated into
// QrCentrePickCases.swift by scripts/gen-qr-pick-cases.mjs — a CI test fails when they are stale.

import XCTest
@testable import App

final class QrCentrePickTests: XCTestCase {

    private func word(_ v: QrCentrePick.Verdict) -> String {
        switch v {
        case .none: return "none"
        case .tie: return "tie"
        case .one(let t): return "one:" + t
        }
    }

    private func verdict(_ s: String) -> QrCentrePick.Verdict {
        if s.hasPrefix("one:") { return .one(String(s.dropFirst(4))) }
        return s == "tie" ? .tie : .none
    }

    func testConstantsMatchTheWebRule() {
        XCTAssertEqual(QrCentrePick.margin, QrCentrePickCases.margin)
        XCTAssertEqual(QrCentrePick.frames, QrCentrePickCases.frames)
    }

    func testEveryPickExample() {
        XCTAssertFalse(QrCentrePickCases.pick.isEmpty)
        for c in QrCentrePickCases.pick {
            let got = QrCentrePick.pick(c.hits, frameCx: c.frameCx, frameCy: c.frameCy, side: c.side)
            XCTAssertEqual(word(got), c.expect, c.id)
        }
    }

    func testEveryStreakExample() {
        XCTAssertFalse(QrCentrePickCases.streak.isEmpty)
        for c in QrCentrePickCases.streak {
            var streak: QrCentrePick.Streak?
            var got: [String] = []
            for s in c.steps {
                let step = QrCentrePick.step(streak, verdict(s))
                streak = step.streak
                got.append(step.read ?? (step.tie ? "tie" : "-"))
            }
            XCTAssertEqual(got, c.expect, c.id)
        }
    }

    func testTextsFallBackToEnglish() {
        let t = ScannerTexts(nil)
        XCTAssertEqual(t.title, "Scan sticker QR")
        XCTAssertEqual(t.photo, "Take a photo instead")
        let fil = ScannerTexts(["title": "I-scan ang QR ng sticker", "hint": ""])
        XCTAssertEqual(fil.title, "I-scan ang QR ng sticker")
        XCTAssertEqual(fil.hint, "Point at the QR on the sticker")
    }

    func testPhotoIsShrunkToTheLongSideLimit() {
        let big = UIGraphicsImageRenderer(size: CGSize(width: 5000, height: 2500), format: {
            let f = UIGraphicsImageRendererFormat(); f.scale = 1; return f
        }()).image { ctx in UIColor.white.setFill(); ctx.fill(CGRect(x: 0, y: 0, width: 5000, height: 2500)) }
        guard let b64 = StickerPhotoFlow.jpegBase64(big), let data = Data(base64Encoded: b64), let back = UIImage(data: data) else {
            return XCTFail("no jpeg")
        }
        XCTAssertEqual(max(back.size.width * back.scale, back.size.height * back.scale), 4032, accuracy: 1)
    }
}
