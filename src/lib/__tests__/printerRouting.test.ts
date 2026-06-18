// Routing predicates for the two native sticker transports. These guard that
// the iOS WiFi sticker path is strictly additive: it fires only for
// printerType "lan" + the iOS-exclusive printStickerLan method, and never
// disturbs the Android Bluetooth path or any other printerType.
import { describe, it, expect } from "vitest";
import {
  shouldUseBluetoothSticker,
  shouldUseLanSticker,
  type PrinterType,
  type LanFormat,
} from "../printerRouting";

const TYPES: PrinterType[] = ["auto", "usb", "bluetooth", "lan"];

describe("shouldUseBluetoothSticker", () => {
  it("is true only for printerType 'bluetooth' with the BT method present", () => {
    expect(shouldUseBluetoothSticker("bluetooth", true)).toBe(true);
  });

  it("is false when the Bluetooth method is missing", () => {
    expect(shouldUseBluetoothSticker("bluetooth", false)).toBe(false);
  });

  it("is false for every non-bluetooth printerType", () => {
    for (const t of TYPES.filter((t) => t !== "bluetooth")) {
      expect(shouldUseBluetoothSticker(t, true)).toBe(false);
    }
  });
});

describe("shouldUseLanSticker", () => {
  it("is true only for 'lan' + lanFormat 'sticker' + the LAN method present", () => {
    expect(shouldUseLanSticker("lan", "sticker", true)).toBe(true);
  });

  it("is false when the LAN method is missing (e.g. Android, no printStickerLan)", () => {
    expect(shouldUseLanSticker("lan", "sticker", false)).toBe(false);
  });

  it("is false for every non-lan printerType (even with sticker format)", () => {
    for (const t of TYPES.filter((t) => t !== "lan")) {
      expect(shouldUseLanSticker(t, "sticker", true)).toBe(false);
    }
  });
});

describe("shouldUseLanSticker — receipt vs sticker format gate", () => {
  it("routes to the sticker path ONLY when lanFormat is explicitly 'sticker'", () => {
    expect(shouldUseLanSticker("lan", "sticker", true)).toBe(true);
  });

  it("stays on the ESC/POS receipt path when lanFormat is 'receipt'", () => {
    // The whole point of the toggle: lan + method present, but receipt chosen
    // => predicate false => caller falls through to buildEscPosSlip.
    expect(shouldUseLanSticker("lan", "receipt", true)).toBe(false);
  });

  it("defaults to receipt when lanFormat is undefined (older persisted settings)", () => {
    expect(shouldUseLanSticker("lan", undefined, true)).toBe(false);
  });

  it("never routes to sticker for any format unless it is exactly 'sticker'", () => {
    const formats: (LanFormat | undefined)[] = ["receipt", undefined];
    for (const f of formats) {
      expect(shouldUseLanSticker("lan", f, true)).toBe(false);
    }
  });
});

describe("mutual exclusivity", () => {
  it("BT and LAN sticker predicates are never both true for one printerType", () => {
    for (const t of TYPES) {
      const both =
        shouldUseBluetoothSticker(t, true) && shouldUseLanSticker(t, "sticker", true);
      expect(both).toBe(false);
    }
  });
});
