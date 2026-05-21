# SellerFlowLive Local Helper App

Windows desktop helper for direct thermal printing without WordPad.

## Features

- GUI window titled `SELLERFLOW LIVE SERVER`
- Local WebSocket server: `ws://127.0.0.1:8588`
- Message type: `print_order`
- Raw ESC-POS printing through Windows spooler API
- Queue worker so orders are printed one by one
- Ping/pong heartbeat support
- Clear logs for printer errors, disconnected WebSocket, TikTok listener stopped, and print failures

## Run From Source

```powershell
python sellerflow_live_helper.py
```

Set a printer explicitly if Windows default printer is not your thermal printer:

```powershell
$env:SELLERFLOW_PRINTER="Your Printer Name"
python sellerflow_live_helper.py
```

## WebSocket Test Message

```json
{
  "type": "print_order",
  "payload": {
    "storeName": "SellerFlowLive",
    "currency": "PHP",
    "sessionDate": "May 22, 2026",
    "buyer": {
      "num": 1,
      "name": "Test Buyer",
      "handle": "sellerflow_test",
      "orders": [
        { "orderNum": 1001, "item": "Sample item", "qty": 1, "price": 150, "total": 150 }
      ],
      "totalSpent": 150
    },
    "settings": {
      "printStoreName": true,
      "printBuyerUsername": true,
      "printOrderItems": true,
      "printTotal": true
    }
  }
}
```

## Build EXE

Run:

```powershell
.\build_exe.ps1
```

The output is created in `dist\SellerFlowLiveHelper.exe`.

## Build Installer

Bundled Windows installer:

```powershell
.\build_iexpress_installer.ps1
```

The installer is created in `installer-output\SellerFlowLiveHelperSetup.exe`. It copies the helper app to `%LOCALAPPDATA%\SellerFlowLiveHelper`, creates a Desktop shortcut, and launches the helper.

Optional Inno Setup installer:

```powershell
.\build_installer.ps1
```

The Inno installer is created in `installer-output`.
