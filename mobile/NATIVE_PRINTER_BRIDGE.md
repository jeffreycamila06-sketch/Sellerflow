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

1. Save the WiFi/LAN printer IP address and raw TCP port.
2. Test the printer connection with a native TCP socket.
3. Receive the `sellerflow.printSlip` payload.
4. Print the label using ESC/POS over raw TCP, usually port `9100`.

## Android Methods

```text
window.SellerFlowPrinter.setPrinter({ host, port })
window.SellerFlowPrinter.getPrinter()
window.SellerFlowPrinter.testConnection({ host, port })
window.SellerFlowPrinter.printSlip(payload)
```

The plugin is also exposed as:

```text
window.Capacitor.Plugins.SellerFlowPrinter
```

## iPhone Note

iPhone Bluetooth printing usually needs the printer's official iOS SDK, AirPrint, or a supported BLE protocol. This depends on the exact printer model.
