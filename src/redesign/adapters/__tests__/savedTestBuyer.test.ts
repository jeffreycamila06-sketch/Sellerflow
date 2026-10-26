import { describe, it, expect } from "vitest";
import { savedTestBuyer, buildTestBuyerV2, buildTestBuyer, TEST_NAME_V2 } from "../printerBridge";
import { rememberSavedPrinter, __resetSavedPrinter } from "../savedPrinter";

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
