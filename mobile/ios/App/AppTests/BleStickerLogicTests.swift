// BleStickerLogicTests.swift (AppTests target — runs in the xcodebuild gate)
//
// The D520BT cases are copied verbatim from
// mobile/ios/tspl-parity/swift/BleStickerLogicTests.swift; the generic-printer
// cases mirror BleStickerLogicTest.java (Android, commit 12ced25) one-for-one:
// isLikelyPrinter, pickWriteTarget (Y41BT layout, 18F0 only, heart rate only,
// never 1800/1801, preferred char must be writable) and toHexCapped.

import XCTest
@testable import App

final class BleStickerLogicTests: XCTestCase {

    // MARK: clampChunkSize

    // maxChunk = 509 (Phase 2, Android v1.6 parity): the supplier SDK's own
    // chunk (MTU 512 − 3), hardware-proven on both board generations — the SDK
    // gates its Android connect on the 512 grant.
    func testClampUsesNegotiatedValueWithinBounds() {
        XCTAssertEqual(BleStickerLogic.clampChunkSize(150), 150)
        XCTAssertEqual(BleStickerLogic.clampChunkSize(20), 20)
        XCTAssertEqual(BleStickerLogic.clampChunkSize(180), 180)  // an older negotiation passes through unchanged
        XCTAssertEqual(BleStickerLogic.clampChunkSize(509), 509)  // MTU-512 negotiation → full SDK-parity chunk
    }

    func testClampCeilingAndFloor() {
        XCTAssertEqual(BleStickerLogic.clampChunkSize(600), 509)  // above the printer's proven packet size → ceiling
        XCTAssertEqual(BleStickerLogic.clampChunkSize(5), 20)     // below BLE minimum → floor
    }

    func testClampUnknownReportsDefault() {
        XCTAssertEqual(BleStickerLogic.clampChunkSize(0), 509)
        XCTAssertEqual(BleStickerLogic.clampChunkSize(-1), 509)
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

    // MARK: Generic BLE printers (Phase 1) — mirror of BleStickerLogicTest.java

    private let W = BleStickerLogic.propWrite
    private let WNR = BleStickerLogic.propWriteNoResponse
    private let N = BleStickerLogic.propNotify
    private func u16(_ s: String) -> String { return "0000" + s.lowercased() + "-0000-1000-8000-00805f9b34fb" }
    private func chr(_ uuid: String, _ props: Int) -> BleStickerLogic.Chr { return BleStickerLogic.Chr(uuid: uuid, props: props) }
    private func svc(_ uuid: String, _ cs: BleStickerLogic.Chr...) -> BleStickerLogic.Svc { return BleStickerLogic.Svc(uuid: uuid, chars: cs) }

    func testIsLikelyPrinterByServiceOnly() {
        XCTAssertTrue(BleStickerLogic.isLikelyPrinter(["FEE7", "18F0"]))              // Y41BT
        XCTAssertTrue(BleStickerLogic.isLikelyPrinter([u16("FEE7"), u16("18F0")]))    // full-128 form
        XCTAssertTrue(BleStickerLogic.isLikelyPrinter(["AF30"]))                      // D520BT
        XCTAssertTrue(BleStickerLogic.isLikelyPrinter(["49535343-fe7d-4ae5-8fa9-9fafd205e455"]))
        XCTAssertFalse(BleStickerLogic.isLikelyPrinter([]))
        XCTAssertFalse(BleStickerLogic.isLikelyPrinter(["180D"]))                     // heart rate
        XCTAssertFalse(BleStickerLogic.isLikelyPrinter(nil))
    }

    func testPickWriteTargetY41btLayoutFf00Ff02WithBothNotifies() {
        let y41 = [
            svc(u16("1800"), chr(u16("2A00"), W)),
            svc(u16("FF00"), chr(u16("FF02"), W | WNR), chr(u16("FF01"), N), chr(u16("FF03"), N)),
            svc(u16("FF10"), chr(u16("FF11"), W)),
            svc(u16("FF80"), chr(u16("FF82"), WNR)),
            svc(u16("FFF0"), chr(u16("FFF2"), W)),
            svc("49535343-fe7d-4ae5-8fa9-9fafd205e455", chr("49535343-8841-43f4-a8d4-ecbe34729bb3", W)),
        ]
        let t = BleStickerLogic.pickWriteTarget(y41)!
        XCTAssertEqual(t.service, "FF00")
        XCTAssertEqual(t.writeChar, "FF02")
        XCTAssertEqual(t.notifyChars, ["FF01", "FF03"])
        XCTAssertTrue(t.writeNoResponse)
    }

    func testPickWriteTargetOnly18f0() {
        let t = BleStickerLogic.pickWriteTarget([svc(u16("18F0"), chr(u16("2AF0"), N), chr(u16("2AF1"), W))])!
        XCTAssertEqual(t.service, "18F0")
        XCTAssertEqual(t.writeChar, "2AF1")
        XCTAssertEqual(t.notifyChars, ["2AF0"])
        XCTAssertFalse(t.writeNoResponse)
    }

    func testPickWriteTargetHeartRateOnlyNil() {
        XCTAssertNil(BleStickerLogic.pickWriteTarget([svc(u16("180D"), chr(u16("2A37"), N), chr(u16("2A38"), 0x02))]))
        XCTAssertNil(BleStickerLogic.pickWriteTarget([]))
        XCTAssertNil(BleStickerLogic.pickWriteTarget(nil))
    }

    func testPickWriteTargetNever1800or1801() {
        // Only Generic Access / Generic Attribute are writable → nothing to pick.
        XCTAssertNil(BleStickerLogic.pickWriteTarget([
            svc(u16("1800"), chr(u16("2A00"), W)),
            svc(u16("1801"), chr(u16("2A05"), W | N)),
        ]))
        // With another writable service, that one wins even though 1800 comes first.
        let t = BleStickerLogic.pickWriteTarget([
            svc(u16("1800"), chr(u16("2A00"), W)),
            svc("12345678-1234-1234-1234-1234567890ab", chr("aaaaaaaa-1234-1234-1234-1234567890ab", WNR)),
        ])!
        XCTAssertEqual(t.service, "12345678-1234-1234-1234-1234567890AB")
        XCTAssertEqual(t.writeChar, "AAAAAAAA-1234-1234-1234-1234567890AB")
    }

    func testPickWriteTargetPreferredCharMustBeWritable() {
        // FF00 present but FF02 not writable → next preference (FFF0/FFF2).
        let t = BleStickerLogic.pickWriteTarget([
            svc(u16("FF00"), chr(u16("FF02"), N)),
            svc(u16("FFF0"), chr(u16("FFF2"), W)),
        ])!
        XCTAssertEqual(t.service, "FFF0")
        XCTAssertEqual(t.writeChar, "FFF2")
    }

    func testToHexCappedCapsLength() {
        XCTAssertEqual(BleStickerLogic.toHexCapped(Data([0x53, 0x53, 0x2F]), maxChars: 256), "53532F")
        XCTAssertEqual(BleStickerLogic.toHexCapped(Data(count: 400), maxChars: 256).count, 256)
        XCTAssertEqual(BleStickerLogic.toHexCapped(nil, maxChars: 256), "")
    }

    // MARK: Printer-name list (printer setup v2)

    func testIsPrinterNameMatchesListCaseInsensitive() {
        for n in ["B1-I603042141", "b21-ABC", "B203-77", "XP-P323B", "Xprinter_58", "Printer_8A2F",
                  "PRT-200", "PT-210", "MPT-II", "GP-1324D", "M110-C9", "M02S", "Q30_01", "T02-xx",
                  "HPRT N41", "Munbyn ITPP941", "Gprinter GP-3120", "Zjiang ZJ-5802"] {
            XCTAssertTrue(BleStickerLogic.isPrinterName(n), n)
        }
    }

    func testIsPrinterNameExcludesHeartRateHeadphonesWatchLaptop() {
        for n in ["Polar H10 1234", "WH-1000XM4", "Galaxy Watch4", "Jeff MacBook Pro", "Pixel 8", "AirPods Pro", "Mi Band 7", "", "   "] {
            XCTAssertFalse(BleStickerLogic.isPrinterName(n), n)
        }
        XCTAssertFalse(BleStickerLogic.isPrinterName(nil))
    }

    func testIsNiimbotNameOnlyNiimbotModels() {
        XCTAssertTrue(BleStickerLogic.isNiimbotName("B1-I603042141"))
        XCTAssertTrue(BleStickerLogic.isNiimbotName("d11-0001"))
        XCTAssertFalse(BleStickerLogic.isNiimbotName("XP-P323B"))
        XCTAssertFalse(BleStickerLogic.isNiimbotName("Y41BT-0FC4_LE"))
        XCTAssertFalse(BleStickerLogic.isNiimbotName(nil))
        for p in BleStickerLogic.niimbotNamePrefixes { XCTAssertTrue(BleStickerLogic.printerNamePrefixes.contains(p), p) }
    }
}
