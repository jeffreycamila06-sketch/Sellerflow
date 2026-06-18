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

export type PrinterType = "auto" | "usb" | "bluetooth" | "lan";

export function shouldUseBluetoothSticker(
  printerType: PrinterType,
  hasBluetoothStickerMethod: boolean,
): boolean {
  return printerType === "bluetooth" && hasBluetoothStickerMethod;
}

export function shouldUseLanSticker(
  printerType: PrinterType,
  hasLanStickerMethod: boolean,
): boolean {
  return printerType === "lan" && hasLanStickerMethod;
}
