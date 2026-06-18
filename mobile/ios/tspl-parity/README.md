# TSPL sticker parity (Android ⇄ iOS)

Phase-1 tooling that pins the iOS WiFi/LAN sticker printer output to the proven
Android Bluetooth output, **byte-for-byte**, with no hardware and no Apple fee.

## The parity chain

```
mobile/android/.../TsplBuilder.java   (production Android, UNMODIFIED)
            │  run.sh compiles it + GoldenGen, dumps bytes
            ▼
   golden/<name>.bin                   ← authoritative byte fixtures
        │                    │
        │ vitest             │ XCTest (Phase 3, Mac)
        ▼                    ▼
 TS reference builder   Swift buildTsplSticker
 (src/lib/__tests__/    (mobile/ios/.../SellerFlowPrinterPlugin.swift)
  tsplReference.ts)
```

- **`golden/<name>.bin`** — raw TSPL bytes from the real `TsplBuilder.java`.
- **`golden/<name>.hex`** — same bytes, hex, for human-diffable review.
- **`payloads/<name>.json`** — the exact input each fixture was built from
  (ASCII-safe `\uXXXX`), consumed by both the TS and Swift parity tests.
- **`manifest.json`** — fixture list + label dimensions (100×60 mm).

## Regenerate the golden fixtures

Requires a JDK (`javac`/`java`). From the repo root:

```bash
bash mobile/ios/tspl-parity/run.sh
```

This compiles the **unmodified** production `TsplBuilder.java` against a tiny
`org.json` stub (`src/org/json/`, only the methods TsplBuilder calls) plus
`GoldenGen.java`, then writes `golden/`, `payloads/`, and `manifest.json`.
Re-run it after any change to `TsplBuilder.java`.

## Where the assertions live

| Layer | File | Runs in this repo? |
|---|---|---|
| TS reference == Java golden (incl. Chinese GBK) | `src/lib/__tests__/tspl.test.ts` | ✅ `npm test` |
| Routing predicates (BT vs LAN exclusivity) | `src/lib/__tests__/printerRouting.test.ts` | ✅ `npm test` |
| Swift `buildTsplSticker` == Java golden | `swift/MobileTsplBuilderTests.swift` | ⏳ Phase 3 (Mac + Xcode test target) |

The TS reference is **test-only** (never shipped — the iOS plugin builds TSPL
natively). It exists so the byte contract is re-derived from scratch and proven
green in CI, since Swift cannot be compiled in this Linux environment. Because
the Swift builder is a line-for-line port of the same algorithm and the GBK
encoding (`GBK_95`) matches Android's `Charset.forName("GBK")` on the BMP, a
green TS suite gives high confidence in the Swift output ahead of the Phase-3
hardware/Xcode verification.

## Fixtures

| Name | Exercises |
|---|---|
| `ascii_full` | full slip, two orders, whole-number total |
| `chinese` | TSS24.BF2 + GBK per field (store/name/item) |
| `emoji_strip` | flag/pictograph stripping, empty session, no orders |
| `pure_emoji_fallback` | emoji-only name → handle fallback |
| `settings_off` | every print-setting off (scaffold only) |
| `long_truncation` | every `truncate()` bound + 2-order cap |
| `quote_escape` | `"` → `'` rewrite |
| `minimal` | empty buyer, defaulted settings |
