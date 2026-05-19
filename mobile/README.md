# SellerFlow Mobile App

This folder is the mobile wrapper for SellerFlow. It opens the live SellerFlow website inside a real Android or iPhone app.

The website stays at:

```text
https://sellerflowlive.com
```

## Android APK Test

Install these first on the computer that will build the APK:

- Node.js LTS
- Android Studio
- Android SDK from Android Studio

Then run:

```powershell
cd mobile
npm install
npm run android:init
npm run android:open
```

In Android Studio, use:

```text
Build > Build APK(s)
```

The debug APK is usually created here:

```text
mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

## iPhone TestFlight / App Store

iPhone builds need:

- Mac computer
- Xcode
- Apple Developer account
- App Store Connect / TestFlight

On the Mac:

```bash
cd mobile
npm install
npm run ios:init
npm run ios:open
```

Then use Xcode to archive and upload to TestFlight.

## Bluetooth Printer

The web app already sends 1-click print data to a native printer bridge when the mobile app provides it.

Next native work:

- Android: add a `SellerFlowPrinter.printSlip(payload)` plugin.
- Pair/list Bluetooth printers.
- Save the seller's selected printer.
- Convert the slip payload to the printer command format.
- Print directly from the mobile app.

If the mobile printer bridge is not installed yet, SellerFlow keeps using the normal browser print flow.
