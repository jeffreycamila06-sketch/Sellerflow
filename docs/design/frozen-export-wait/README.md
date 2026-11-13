# Frozen parcel: the export waits for the frozen answer (Nov 13 2026)

Branch `frozen-export-wait`. Screen: Parcel Scan (7-11), frozen (冷凍) parcels only.

| File | What it shows |
|---|---|
| `wait_*` | Export tapped while the frozen answer is still on its way: "Checking if this store accepts frozen…" — only Cancel, no way around it |
| `ask_*` | No answer (30 s passed, or the checker gave up): Wait / Export anyway, with the "Frozen not checked" note explained |
| `refused_*` | The answer is "can't receive frozen": that parcel is not exported; the other parcels can still go |
| `late_*` | After an export: a parcel whose answer came late and says no (red warning + top bar), and one exported without an answer ("Frozen not checked") |

Widths: iPhone 390, Android 412, laptop 1280 (+ 360 for the waiting message). Measured in the same
run: the dialog fits the screen, buttons 44 px, no sideways scroll.
Sample data only (made-up names and phone numbers).

The two real cases (Nov 13): store 980045 exported 22 s after saving, answer "ok" 0.15 s after the
export; store 217237 exported 20 s after saving, answer "can't receive frozen" 7.8 s after the export.
Both timelines are tests in `ParcelScan.frozenExportWait.test.tsx` and `scripts/sql157-behaviour.mjs`.
