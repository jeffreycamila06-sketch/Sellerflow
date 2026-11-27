# Printer tuning (part 2) — proof folder

Branch `claude/printer-tuning`. Admin-only, per-seller printer settings + the seller's "Printer setup" Test Print card.

| File | What |
|---|---|
| `sql230-behaviour.txt` | PGlite run of `scripts/sql230-behaviour.mjs` (104 checks, md5s of every new/changed function) |
| `tuned-header-diff.txt` | main vs tuned TSPL header per case (only GAP / BLINE / SPEED / DENSITY lines differ; bands byte-identical) |
| `breaks.txt` | 19 on-purpose code breaks, each caught by a test |
| `send-speed.md` | where the Bluetooth chunk size / wait lives in native code, and what an app build would need |
| `measured.txt` | real app, 360 / 390 / 430 / 1280, light + dark: nothing wider than the screen, buttons ≥ 44 px, no setting name on the seller card |
| `shots/` | Admin sheet (top, chip change, save question, advanced, history) + seller card (card, clean? question), iPhone 390 + laptop 1280, light + dark |
| `shoot.cjs` | makes `shots/` + `measured.txt` from the real app in preview mode (`?ptu=1`, `?ptu=1&admin=1`) |

No-tuning goldens: `src/redesign/adapters/__tests__/fixtures/printerTuningGoldens.main.json` — 68 prints, run on
`origin/main` 5e5689b0 itself (worktree) = 69/69 passed with the same file.
