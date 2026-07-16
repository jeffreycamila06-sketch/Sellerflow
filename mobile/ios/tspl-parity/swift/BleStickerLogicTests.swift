// BleStickerLogicTests.swift
//
// Mac-run test artifact (same convention as MobileTsplBuilderTests.swift —
// requires a Mac + Xcode unit-test target; NOT wired into App.xcodeproj, so it
// never affects the app build; CI cannot compile Swift). Covers the PURE
// decisions of the iOS BLE sticker transport (BleStickerLogic in
// SellerFlowPrinterPlugin.swift):
//   • chunk-size clamping (negotiated MTU → usable write-without-response size)
//   • chunk splitting (boundaries, exact multiples, remainders)
//   • "PRINTING:DONE" detection (prefix variants + split-across-notifies)
//   • scan filter (advertised AF30 in 16-bit/128-bit form OR "D520BT" name
//     prefix; FF00 must NOT be relied on — it is not advertised)
//
// To run: add a Unit Testing Bundle target in Xcode, add this file,
// `@testable import App`.

import XCTest
@testable import App

final class BleStickerLogicTests: XCTestCase {

    // MARK: clampChunkSize

    func testClampUsesNegotiatedValueWithinBounds() {
        XCTAssertEqual(BleStickerLogic.clampChunkSize(150), 150)
        XCTAssertEqual(BleStickerLogic.clampChunkSize(20), 20)
        XCTAssertEqual(BleStickerLogic.clampChunkSize(180), 180)
    }

    func testClampCeilingAndFloor() {
        XCTAssertEqual(BleStickerLogic.clampChunkSize(512), 180)  // iOS often reports large — clamp to proven-safe
        XCTAssertEqual(BleStickerLogic.clampChunkSize(5), 20)     // below BLE minimum → floor
    }

    func testClampUnknownReportsDefault() {
        XCTAssertEqual(BleStickerLogic.clampChunkSize(0), 180)
        XCTAssertEqual(BleStickerLogic.clampChunkSize(-1), 180)
    }

    // MARK: chunks

    func testChunksSplitWithRemainder() {
        let data = Data(repeating: 0x41, count: 450)
        let chunks = BleStickerLogic.chunks(data, chunkSize: 180)
        XCTAssertEqual(chunks.count, 3)
        XCTAssertEqual(chunks[0].count, 180)
        XCTAssertEqual(chunks[1].count, 180)
        XCTAssertEqual(chunks[2].count, 90)
        XCTAssertEqual(chunks.reduce(Data(), +), data) // nothing lost, order kept
    }

    func testChunksExactMultipleHasNoEmptyTail() {
        let data = Data(repeating: 0x42, count: 360)
        let chunks = BleStickerLogic.chunks(data, chunkSize: 180)
        XCTAssertEqual(chunks.count, 2)
        XCTAssertEqual(chunks.last?.count, 180)
    }

    func testChunksSmallerThanOneChunk() {
        let data = Data([0x01, 0x02, 0x03])
        let chunks = BleStickerLogic.chunks(data, chunkSize: 180)
        XCTAssertEqual(chunks.count, 1)
        XCTAssertEqual(chunks[0], data)
    }

    func testChunksEmptyData() {
        XCTAssertTrue(BleStickerLogic.chunks(Data(), chunkSize: 180).isEmpty)
    }

    // MARK: containsPrintDone

    func testDoneMatchesRealPrinterString() {
        XCTAssertTrue(BleStickerLogic.containsPrintDone("SSGETPRINTING:DONE")) // exact string seen on the D520BT-Z
    }

    func testDoneIsPrefixTolerantAndCaseInsensitive() {
        XCTAssertTrue(BleStickerLogic.containsPrintDone("XPRINTING:DONE"))
        XCTAssertTrue(BleStickerLogic.containsPrintDone("ssgetprinting:done"))
    }

    func testDoneMatchesWhenSplitAcrossNotifications() {
        // status can arrive split — the transport ACCUMULATES, so the combined
        // buffer must match even though neither notification alone does.
        let part1 = "SSGETPRINT"
        let part2 = "ING:DONE"
        XCTAssertFalse(BleStickerLogic.containsPrintDone(part1))
        XCTAssertFalse(BleStickerLogic.containsPrintDone(part2))
        XCTAssertTrue(BleStickerLogic.containsPrintDone(part1 + part2))
    }

    func testDoneRejectsOtherStatuses() {
        XCTAssertFalse(BleStickerLogic.containsPrintDone("SSGETPRINTING:BUSY"))
        XCTAssertFalse(BleStickerLogic.containsPrintDone(""))
    }

    // MARK: isTargetPrinter (scan filter)

    func testFilterMatchesAdvertisedAf30ShortForm() {
        XCTAssertTrue(BleStickerLogic.isTargetPrinter(name: nil, advertisedServices: ["AF30", "1812"]))
        XCTAssertTrue(BleStickerLogic.isTargetPrinter(name: "whatever", advertisedServices: ["af30"]))
    }

    func testFilterMatchesAdvertisedAf30FullForm() {
        XCTAssertTrue(BleStickerLogic.isTargetPrinter(name: nil, advertisedServices: ["0000AF30-0000-1000-8000-00805F9B34FB"]))
    }

    func testFilterMatchesNamePrefixAnySuffixAnyCase() {
        XCTAssertTrue(BleStickerLogic.isTargetPrinter(name: "D520BT-Z", advertisedServices: []))
        XCTAssertTrue(BleStickerLogic.isTargetPrinter(name: "d520bt_7", advertisedServices: []))
    }

    func testFilterRejectsNonPrinters() {
        XCTAssertFalse(BleStickerLogic.isTargetPrinter(name: "AirPods Pro", advertisedServices: ["1812"]))
        XCTAssertFalse(BleStickerLogic.isTargetPrinter(name: nil, advertisedServices: []))
        // FF00 alone must NOT match — it is not advertised by the real device,
        // and matching it would pick up unrelated peripherals.
        XCTAssertFalse(BleStickerLogic.isTargetPrinter(name: nil, advertisedServices: ["FF00"]))
    }

    // MARK: isTargetPrinter — Phomemo 241 (additive, must not broaden)

    func testFilterMatchesPhomemo241NamePrefixAnyCase() {
        XCTAssertTrue(BleStickerLogic.isTargetPrinter(name: "PM-241Z-BT-C842", advertisedServices: []))
        XCTAssertTrue(BleStickerLogic.isTargetPrinter(name: "pm-241z-bt", advertisedServices: []))
    }

    func testFilterDoesNotBroadenToOtherPmModels() {
        // Fix: the matcher is PM-241 ONLY, never "PM-2" — a different PM model
        // must not be grabbed by the 241 addition.
        XCTAssertFalse(BleStickerLogic.isTargetPrinter(name: "PM-260", advertisedServices: []))
        XCTAssertFalse(BleStickerLogic.isTargetPrinter(name: "PM-201", advertisedServices: []))
    }

    // MARK: resolveProfile (single-source routing gate)

    func testResolveProfilePhomemo241() {
        XCTAssertEqual(BleStickerLogic.resolveProfile(name: "PM-241Z-BT-C842"), .phomemo241)
        XCTAssertEqual(BleStickerLogic.resolveProfile(name: "pm-241z-bt"), .phomemo241) // case-normalized
    }

    func testResolveProfileDefaultsToAimo() {
        XCTAssertEqual(BleStickerLogic.resolveProfile(name: "D520BT-Z"), .aimo)   // the live printer
        XCTAssertEqual(BleStickerLogic.resolveProfile(name: "d520bt_7"), .aimo)
        XCTAssertEqual(BleStickerLogic.resolveProfile(name: "PM-260"), .aimo)     // other PM model → NOT 241
        XCTAssertEqual(BleStickerLogic.resolveProfile(name: ""), .aimo)           // empty saved name → AIMO default
        XCTAssertEqual(BleStickerLogic.resolveProfile(name: nil), .aimo)          // unset → AIMO default
        XCTAssertEqual(BleStickerLogic.resolveProfile(name: "AirPods Pro"), .aimo)
    }
}
