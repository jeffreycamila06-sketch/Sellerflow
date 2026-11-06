// Single list of "printing files" — used by the Claude Code hook (.claude/hooks/printing-reminder.mjs)
// and the CI gate (scripts/printing-gate.mjs). Add new printing files here.
export const PRINTING_FILE_RE = new RegExp([
  String.raw`^src/redesign/adapters/(printing|stickerRaster|stickerFit|stickerPreview|printerModels|printerBridge|savedPrinter|escposRaster|cpclRaster|cjkAtlasLoader|propAtlasLoader|pinToPrint|reprint|notPrintedStore|usePrinterStatus|receiptImage|receiptSettings|useReceiptPicture|fbReceipt|fbAutoReceipt)\.tsx?$`,
  String.raw`^src/redesign/adapters/glyphAtlas\.[^/]+\.ts$`,
  String.raw`^src/redesign/screens/(Print|PrintPattern|PrinterSettings|ReceiptFormat)\.tsx$`,
  String.raw`^src/redesign/components/(ExactStickerPreview|PrinterGuideModal|PrinterModal|ReceiptSheet)\.tsx$`,
  String.raw`^src/lib/(printerRouting\.ts|receiptLayout\.(js|d\.ts))$`,
  String.raw`^server/(fbAutoReceipt|fbReceipt|receiptDraw)\.js$`,
  String.raw`^mobile/android/app/src/main/java/com/sellerflow/live/(BleStickerLogic|BleStickerTransport|GenericBleTransport|NiimbotTransport|SellerFlowPrinterPlugin|TsplBuilder)\.java$`,
  String.raw`^mobile/ios/App/App/SellerFlowPrinterPlugin\.swift$`,
  String.raw`^mobile/ios/tspl-parity/`,
].join("|"));
export const PRINTING_MAP = "docs/printing/PRINTING_MAP.md";
export const isPrintingFile = (p) => PRINTING_FILE_RE.test(String(p || "").replace(/^\.\//, ""));
