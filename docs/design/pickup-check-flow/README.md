# Pickup Status check flow — TODAY vs NEW (branch `claude/pickup-check-flow`)

Real Pickup Status screen + adapters on a fake Supabase client (`harness/`). TODAY = `main` 229d4670,
NEW = this branch. iPhone 390 · Android 360 · laptop 1280; 0 px horizontal overflow on every shot.

| # | Scene | TODAY | NEW |
|---|---|---|---|
| 1 | 7 parcels at store/in transit + 4 synced today/yesterday, never checked — Waiting | Waiting **7**, In transit 2 | Waiting **3**, In transit **6** |
| 2 | Same, In transit tab | 2 moving parcels | + the 4 "Not checked yet" parcels (no Chase) |
| 3 | A press that found nothing checkable (only just-synced parcels) | "Nothing to check yet — all parcels were checked recently" | "No parcels can be checked yet." |
| 4 | Sync of 4 new parcels | toast + "New parcels are being checked now." + Checking… | toast only, Check now stays ready |
| 5 | "How to sync?" opened | step 4: "Usernames appear right away under Waiting pickup; new parcels are checked automatically within a few minutes." | "Usernames appear right away under In transit." |
| 6 | No parcels yet | step 3: "Your parcels appear here and new ones are checked automatically." | "Your parcels appear here." |

On every shot the line under "Last checked" is now only "You can check again 12 hours after your last check."
(TODAY adds "New parcels from Sync are checked automatically."). Shots 1–4 NEW were re-taken after that fix.

Files: `<n>-<scene>_<device>_<today|new>.png`. Proof outputs (tests + deliberate breaks): `proof/`.

Not changed here (waits for Jeff's preview approval): the "⚠ Returning" wording for an old check.

Re-shoot: start `npx vite --config docs/design/pickup-check-flow/harness/vite.config.mjs --port 5310`
here and the same on port 5311 in a `main` worktree with `harness/` copied in, then
`node docs/design/pickup-check-flow/harness/shoot.cjs [today|new] [scenes, e.g. 5,6]`.
