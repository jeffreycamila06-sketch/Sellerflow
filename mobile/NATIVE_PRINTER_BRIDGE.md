# Native Printer Bridge

SellerFlow web sends slip print data to the mobile wrapper when a native bridge exists.

## Web Call Order

The app checks these in order:

```text
window.SellerFlowPrinter.printSlip(payload)
window.Capacitor.Plugins.SellerFlowPrinter.printSlip(payload)
window.ReactNativeWebView.postMessage(JSON.stringify(payload))
```

If none exists, the app falls back to browser printing.

## Payload Shape

```ts
type NativePrinterPayload = {
  type: "sellerflow.printSlip";
  buyer: {
    handle: string;
    name: string;
    platform: string;
    num: number;
    orders: Array<{
      orderNum: number;
      item: string;
      qty: number;
      price: number;
      total: number;
      time: string;
      handle: string;
      name: string;
      bNum: number;
      platform: string;
      status: string;
      date: string;
    }>;
    totalSpent: number;
    totalOrders: number;
  };
  currency: string;
  storeName: string;
  settings: Record<string, unknown>;
  sessionDate: string;
  createdAt: string;
};
```

## Android Plugin Goal

The Android native plugin should:

1. Ask for Bluetooth permission.
2. List paired Bluetooth printers.
3. Save the selected printer.
4. Receive the `sellerflow.printSlip` payload.
5. Print the label using ESC/POS or the printer manufacturer's SDK.

## iPhone Note

iPhone Bluetooth printing usually needs the printer's official iOS SDK, AirPrint, or a supported BLE protocol. This depends on the exact printer model.
