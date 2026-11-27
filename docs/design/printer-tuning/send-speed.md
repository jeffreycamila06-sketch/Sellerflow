# send_speed — research only (Printer Tuning part 2, 2026-11-27)

`send_speed` (normal | slow) is saved with a seller's tuning (sql/230) but **nothing reads it yet**:
how fast the sticker bytes go over Bluetooth is decided in the phone apps' native code, not in the web.

## Where the speed lives today (generic Bluetooth printers — the path tuning applies to)

| | Android | iPhone |
|---|---|---|
| File | `mobile/android/app/src/main/java/com/sellerflow/live/GenericBleTransport.java` | `mobile/ios/App/App/SellerFlowPrinterPlugin.swift`, `final class GenericBleTransport` (~line 2281) |
| Chunk size | `BleStickerLogic.clampChunkSize(mtu − 3)` after `requestMtu(512)` (line ~238–240) → 20–509 bytes | `BleStickerLogic.clampChunkSize(peripheral.maximumWriteValueLength(for: .withoutResponse))` (line ~2574) → 20–509 bytes |
| Wait between chunks | `PACING_MS = 8` (line 51), `handler.postDelayed(pacingTimer, PACING_MS)` (line ~379) | `queue.asyncAfter(deadline: .now() + .milliseconds(8))` (line ~2601) |
| Write type | without response when the characteristic allows it, else with response | the same |
| Called by | `printRawTspl` → `printGeneric` (SellerFlowPrinterPlugin.java ~723) | `printRawTspl` → `genericTransport.printJob(data:identifier:)` (~1105) |

The web only hands `printRawTspl({ data })` the finished bytes; it has no say in chunk size or pacing.

## What an app build would need

1. `printRawTspl` accepts one more optional field, e.g. `{ data, pace: "slow" }` (old apps ignore unknown fields — safe).
2. In both `GenericBleTransport`s: `slow` = a smaller chunk cap (e.g. 100 bytes instead of up to 509) and a longer wait
   (e.g. 30 ms instead of 8 ms). Normal / missing = today's numbers exactly.
3. The web passes `pace` only when the seller's tuning says `send_speed: "slow"` and the app build reports it
   understands it (the existing `getBuildNumber` bridge, like the update modal).
4. Proof on hardware: a 60×40 sticker on a printer that drops data (blank / broken stickers on a fast series).

Rough cost of "slow" for a 60×40 job (~10 KB): ~100 chunks × 30 ms ≈ 3 s more per sticker.
Nothing in this branch changes native code (`mobile/` = 0 lines).
