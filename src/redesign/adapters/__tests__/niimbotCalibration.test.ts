import { describe, it, expect } from "vitest";
import { calibrationBits, calibrationInk as ink, niimbotCalibrationImage, CAL_TICK_SHORT, CAL_TICK_LONG, CAL_TICK_XL, CAL_MARKER } from "../niimbotCalibration";
import { NIIMBOT_FRAME_DOTS } from "../printing";
import { savedTestBuyer, buildTestBuyerV2, buildTestBuyer, TEST_NAME_V2 } from "../printerBridge";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";

describe("Niimbot calibration label (Android position investigation)", () => {
  const b = calibrationBits();
  it("is exactly the SDK frame: 384×224, 48 bytes per row", () => {
    expect([b.w, b.h, b.rowBytes]).toEqual([NIIMBOT_FRAME_DOTS.w, NIIMBOT_FRAME_DOTS.h, 48]);
    const img = niimbotCalibrationImage();
    expect([img.w, img.h, img.rowBytes, img.labelWidthMm, img.labelHeightMm]).toEqual([384, 224, 48, 50, 30]);
    expect(Buffer.from(img.data, "base64")).toHaveLength(48 * 224);
  });
  it("1-dot border on all four sides + centre cross", () => {
    for (let x = 0; x < b.w; x++) { expect(ink(b, x, 0)).toBe(true); expect(ink(b, x, b.h - 1)).toBe(true); expect(ink(b, x, b.h >> 1)).toBe(true); }
    for (let y = 0; y < b.h; y++) { expect(ink(b, 0, y)).toBe(true); expect(ink(b, b.w - 1, y)).toBe(true); expect(ink(b, b.w >> 1, y)).toBe(true); }
  });
  it("ticks every 8 dots (1 mm) on all edges — short 4 dots, long 10 dots every 5 mm", () => {
    // top/bottom at x = 16 (short; x = 8 sits inside the corner marker) and x = 40 (long); the dot just past each tick is white
    expect(ink(b, 16, CAL_TICK_SHORT)).toBe(true); expect(ink(b, 16, CAL_TICK_SHORT + 1)).toBe(false);
    expect(ink(b, 16, b.h - 1 - CAL_TICK_SHORT)).toBe(true); expect(ink(b, 16, b.h - 2 - CAL_TICK_SHORT)).toBe(false);
    expect(ink(b, 40, CAL_TICK_LONG)).toBe(true); expect(ink(b, 40, CAL_TICK_LONG + 1)).toBe(false);
    expect(ink(b, 80, CAL_TICK_XL)).toBe(true); expect(ink(b, 80, CAL_TICK_XL + 1)).toBe(false);   // 10 mm = longest
    expect(ink(b, 120, CAL_TICK_LONG)).toBe(true); expect(ink(b, 120, CAL_TICK_LONG + 1)).toBe(false); // 15 mm = long, not longest
    // left/right at y = 16 (short) and y = 40 (long)
    expect(ink(b, CAL_TICK_SHORT, 16)).toBe(true); expect(ink(b, CAL_TICK_SHORT + 1, 16)).toBe(false);
    expect(ink(b, b.w - 1 - CAL_TICK_SHORT, 16)).toBe(true); expect(ink(b, b.w - 2 - CAL_TICK_SHORT, 16)).toBe(false);
    expect(ink(b, CAL_TICK_LONG, 40)).toBe(true); expect(ink(b, CAL_TICK_LONG + 1, 40)).toBe(false);
    // no tick between the marks (x = 12 is plain white below the border)
    expect(ink(b, 12, 2)).toBe(false);
    // the last tick on the right edge is 8 dots before the border (x = 376), the border itself at 383
    expect(ink(b, 376, 3)).toBe(true); expect(ink(b, 383, 100)).toBe(true); expect(ink(b, 382, 100)).toBe(false);
  });
  it("solid 8×8 marker inside the top-left corner only", () => {
    for (let y = 2; y < 2 + CAL_MARKER; y++) for (let x = 2; x < 2 + CAL_MARKER; x++) expect(ink(b, x, y)).toBe(true);
    expect(ink(b, b.w - 4, 4)).toBe(false);      // top-right stays white
    expect(ink(b, 4, b.h - 4)).toBe(false);      // bottom-left stays white
  });
});

describe("saved-printer test sticker (issue B: the old 'Test Print / PRICE' on Android Niimbot)", () => {
  it("a saved Niimbot or generic printer gets the Chinese v2 sticker; a saved D520BT keeps the golden-pinned old one", () => {
    __resetSavedPrinter();
    rememberSavedPrinter({ address: "04:03:06:74:F2:C2", name: "B1-I603042141", transport: "niimbot", model: "generic" });
    expect(savedTestBuyer().name).toBe(TEST_NAME_V2);
    expect(savedTestBuyer()).toEqual(buildTestBuyerV2());
    rememberSavedPrinter({ address: "E8:D4:1E:FF:0F:C4", name: "Y41BT-0FC4_LE", transport: "ble", model: "generic", lang: "tspl" });
    expect(savedTestBuyer().name).toBe(TEST_NAME_V2);
    rememberSavedPrinter({ address: "8C:C6:A4:D7:35:A1", name: "D520BT-Z", transport: "ble", model: "D520BT" });
    expect(savedTestBuyer().name).toBe("Test Print");
    expect(savedTestBuyer().orders[0].item).toBe(buildTestBuyer().orders[0].item);
    __resetSavedPrinter();
    expect(savedTestBuyer().name).toBe("Test Print"); // nothing saved → the D520BT default
  });
});
