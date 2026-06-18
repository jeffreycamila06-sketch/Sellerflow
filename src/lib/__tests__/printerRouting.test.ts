// Routing predicates for the two native sticker transports. These guard that
// the iOS WiFi sticker path is strictly additive: it fires only for
// printerType "lan" + the iOS-exclusive printStickerLan method, and never
// disturbs the Android Bluetooth path or any other printerType.
import { describe, it, expect } from "vitest";
import {
  shouldUseBluetoothSticker,
  shouldUseLanSticker,
  type PrinterType,
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
  it("is true only for printerType 'lan' with the LAN method present", () => {
    expect(shouldUseLanSticker("lan", true)).toBe(true);
  });

  it("is false when the LAN method is missing (e.g. Android, no printStickerLan)", () => {
    expect(shouldUseLanSticker("lan", false)).toBe(false);
  });

  it("is false for every non-lan printerType", () => {
    for (const t of TYPES.filter((t) => t !== "lan")) {
      expect(shouldUseLanSticker(t, true)).toBe(false);
    }
  });
});

describe("mutual exclusivity", () => {
  it("BT and LAN sticker predicates are never both true for one printerType", () => {
    for (const t of TYPES) {
      const both = shouldUseBluetoothSticker(t, true) && shouldUseLanSticker(t, true);
      expect(both).toBe(false);
    }
  });
});
