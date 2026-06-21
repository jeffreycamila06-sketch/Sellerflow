// Canonical contract for which slip/receipt fields are printed given the
// "Printer output" on/off toggles. This is the single written source of truth
// that the THREE renderers must mirror:
//   - web iframe   : src/App.tsx  printSlip()  (browser/desktop print)
//   - Android slip : SellerFlowPrinterPlugin.buildEscPosSlip (native ESC/POS)
//   - iOS slip     : SellerFlowPrinterPlugin.swift buildEscPosSlip (native ESC/POS)
// (The TSPL sticker builders follow the same flag set and already honor it.)
//
// Rules captured here, learned the hard way:
//   - buyer NAME has no toggle and ALWAYS prints.
//   - TOTAL is INDEPENDENT of order items — turning items off must NOT hide the
//     total (the old web iframe nested total inside the items block; native
//     never did). slipFieldVisibility encodes the independent behavior.
//   - A missing/undefined flag defaults to true (a payload without settings
//     prints everything — backwards compatible with older clients).

export interface SlipPrintFlags {
  printStoreName?: boolean;
  printBuyerNumber?: boolean;
  printBuyerUsername?: boolean;
  printOrderItems?: boolean;
  printTotal?: boolean;
}

export interface SlipFieldVisibility {
  storeName: boolean;
  buyerNumber: boolean;
  buyerName: boolean;      // no toggle — always printed
  buyerUsername: boolean;
  orderItems: boolean;
  total: boolean;          // independent of orderItems
}

// Default a flag to true when it is missing (older payloads carry no settings).
function on(v: boolean | undefined): boolean {
  return v !== false;
}

export function slipFieldVisibility(flags: SlipPrintFlags): SlipFieldVisibility {
  return {
    storeName: on(flags.printStoreName),
    buyerNumber: on(flags.printBuyerNumber),
    buyerName: true,
    buyerUsername: on(flags.printBuyerUsername),
    orderItems: on(flags.printOrderItems),
    total: on(flags.printTotal),
  };
}
