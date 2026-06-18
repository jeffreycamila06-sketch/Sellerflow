// Pure routing predicates for the mobile native sticker paths. Extracted from
// App.tsx so the BT-vs-LAN decision is unit-testable without rendering the app.
//
// Two MUTUALLY-EXCLUSIVE native sticker transports exist, keyed off the
// seller's printerType setting AND the presence of a platform-specific bridge
// method:
//   - Android Bluetooth: printerType "bluetooth" + window.SellerFlowPrinter
//     .printStickerNative (Classic Bluetooth SPP, TSPL).
//   - iOS WiFi/LAN: printerType "lan" + window.SellerFlowPrinter.printStickerLan
//     (raw TCP 9100, TSPL). printStickerLan is injected ONLY by the iOS plugin,
//     so Android can never satisfy the LAN-sticker predicate and its Bluetooth
//     path is never disturbed.
//
// Any other printerType (auto/usb), or a missing bridge method, returns false
// from both — the caller then falls through to the existing ESC/POS WiFI/LAN
// receipt + browser-print flow, byte-identical to before this feature.
//
// WiFi/LAN supports BOTH output formats, chosen EXPLICITLY by the seller via
// the lanFormat setting (NOT auto-assumed from printerType):
//   - "receipt" (default): ESC/POS receipt slip — the existing buildEscPosSlip
//     path. Nothing changes for sellers who never touch the new toggle.
//   - "sticker": TSPL label sticker via the iOS-exclusive printStickerLan.
// shouldUseLanSticker only returns true when the seller opted into "sticker",
// so the receipt path stays the default for every existing WiFi/LAN user.

export type PrinterType = "auto" | "usb" | "bluetooth" | "lan";
export type LanFormat = "receipt" | "sticker";

export function shouldUseBluetoothSticker(
  printerType: PrinterType,
  hasBluetoothStickerMethod: boolean,
): boolean {
  return printerType === "bluetooth" && hasBluetoothStickerMethod;
}

export function shouldUseLanSticker(
  printerType: PrinterType,
  lanFormat: LanFormat | undefined,
  hasLanStickerMethod: boolean,
): boolean {
  // Default-receipt: any value other than an explicit "sticker" (including
  // undefined from older persisted settings) falls through to ESC/POS.
  return printerType === "lan" && lanFormat === "sticker" && hasLanStickerMethod;
}
