// MobileTsplBuilderTests.swift
//
// PHASE-3 ARTIFACT (requires a Mac + Xcode unit-test target — NOT wired into
// the App.xcodeproj yet, so it does not affect the app build). Asserts the iOS
// `SellerFlowPrinterPlugin.buildTsplSticker` output byte-for-byte against the
// SAME Android golden fixtures the web (vitest) suite uses
// (mobile/ios/tspl-parity/golden/*.bin), closing the loop:
//
//     TsplBuilder.java (golden)  ==  TS reference (vitest, green)  ==  Swift
//
// To run in Phase 3:
//   1. In Xcode, add a Unit Testing Bundle target to App.xcodeproj.
//   2. Add this file to that target; set `@testable import App`.
//   3. The golden .bin + payload .json are read from this file's sibling
//      directories via #filePath, so no bundle-resource wiring is needed.
//
// Regenerate golden after any TsplBuilder.java change:
//   bash mobile/ios/tspl-parity/run.sh

import XCTest
@testable import App

final class MobileTsplBuilderTests: XCTestCase {

    // PHASE 1: per-fixture label dimensions (100x60 + 80x60, the 60mm tier).
    private struct Fixture: Decodable {
        let name: String
        let labelWidthMm: Int
        let labelHeightMm: Int
    }
    private struct Manifest: Decodable {
        let fixtures: [Fixture]
    }

    /// mobile/ios/tspl-parity/ (this file lives in .../tspl-parity/swift/).
    private var parityDir: URL {
        URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    }

    private func loadManifest() throws -> Manifest {
        let data = try Data(contentsOf: parityDir.appendingPathComponent("manifest.json"))
        return try JSONDecoder().decode(Manifest.self, from: data)
    }

    func testBuildTsplStickerMatchesAndroidGolden() throws {
        let manifest = try loadManifest()
        let plugin = SellerFlowPrinterPlugin()

        for fx in manifest.fixtures {
            let payloadURL = parityDir.appendingPathComponent("payloads/\(fx.name).json")
            let goldenURL = parityDir.appendingPathComponent("golden/\(fx.name).bin")
            let golden = try Data(contentsOf: goldenURL)

            let raw = try JSONSerialization.jsonObject(
                with: try Data(contentsOf: payloadURL)) as? [String: Any] ?? [:]
            let buyer = raw["buyer"] as? [String: Any] ?? [:]
            let settings = raw["settings"] as? [String: Any]

            let built = plugin.buildTsplSticker(
                buyer: buyer,
                settings: settings,
                storeName: raw["storeName"] as? String ?? "SellerFlowLive",
                currency: raw["currency"] as? String ?? "",
                sessionDate: raw["sessionDate"] as? String ?? "",
                labelWidthMm: fx.labelWidthMm,
                labelHeightMm: fx.labelHeightMm
            )

            XCTAssertEqual(
                [UInt8](built), [UInt8](golden),
                "TSPL byte mismatch for fixture \"\(fx.name)\" "
                    + "(built \(built.count)B vs golden \(golden.count)B)"
            )
        }
    }
}
