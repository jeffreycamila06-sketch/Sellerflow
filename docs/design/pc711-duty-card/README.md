# "Who is checking" card — PICTURES ONLY (not built)

Admin → Controls → 7-11 Login. A proposed card that says who is doing the 7-11 checks right now:
the Lenovo (the Chrome extension) or the server (the backup checker). **Nothing is built.** These
pictures wait for Jeff's approval (2026-11-18).

How the pictures were made: the REAL panel in the real Admin sheet on a fake server, with a drawing
of the card put where it would sit (`harness/`, not part of the app build).

## The four states

| Picture | State | What the card says |
|---|---|---|
| `1-normal_*.png` | Normal — green | **The Lenovo is checking** · Server: standby — Last call from the Lenovo: 4 s ago |
| `2-server-on-duty_*.png` | Server on duty — orange | **The server is checking now** — Since 11/18 13:46 (22 min) · Why: The Lenovo is silent · Answered in this duty: 37 parcels |
| `3-server-on-duty-logged-out_*.png` | Server on duty, logged out of 7-11 — red | the same (here with the other reason: The Lenovo's 7-11 tabs are dead), plus **The server is logged out. Log in above.** |
| `4-backup-off_*.png` | Backup switch off, or sql/179 not applied yet — grey | **Backup: off** — Last call from the Lenovo: 4 s ago |

Widths: `iphone-390` (390 px), `android-360` (360 px), `laptop-1280` (1280 px).

History line (under the card, small grey text): `Last take-over: 11/17 03:12 → 03:58 (46 min). Why: the Lenovo was silent.`
Shown in pictures 1 and 2. Pictures 3 and 4 show the card with no take-over yet: no line at all.

Other pictures (390 px only):

| Picture | What it shows |
|---|---|
| `panel-logged-out_normal_iphone-390.png` | the panel logged out, the Lenovo still checking (green card under the Log in button) |
| `panel-not-connected_backup-off_iphone-390.png` | the panel never connected (card under the Connect button) |
| `panel-key-missing_backup-off_iphone-390.png` | the panel with no session key on the server |
| `2-server-on-duty_dark_iphone-390.png`, `3-server-on-duty-logged-out_dark_iphone-390.png` | dark theme |

## Where it sits

Under the panel's top card and its button(s), above "Telegram alerts":
- connected: Connected card → Test now / Disconnect → **Who is checking** → Telegram alerts → …
- logged out: red card → Log in to 7-11 → **Who is checking** → Telegram alerts (so "Log in above" is true)
- not connected: Not connected card → Connect → **Who is checking** → Telegram alerts
- no session key: the key sentence → **Who is checking**
- not shown inside the two login steps (phone / password / SMS form).

## Measured (printed by `harness/shoot.cjs` for all 17 pictures)

- sideways scroll: 0 px on the page and 0 px in the sheet, at 360, 390 and 1280 px;
- no text is cut; long text wraps (360 px: "The Lenovo's 7-11 tabs are dead" goes on two lines);
- the card has no button. The panel's own buttons next to it: Test now 44 px, Disconnect 44 px,
  Log in to 7-11 46 px, Send test alert 44 px.

## Colours and styles reused (nothing new)

- the card: the panel's own card (`--surface-2` background, 1 px `--border`, 14 px corners) — the same
  as "Connected", "Telegram alerts", "Shadow";
- the title "Who is checking": the card title style of "Telegram alerts" (13 px, bold);
- the state line: the "Connected" line (9 px dot + 15 px bold words in the state colour);
- the details: the "Connected" card's two-column list (grey label, bold value);
- green = `--ok` (as "Connected") · orange = `--warn` text on `--warn-soft` with a 1.5 px `--warn` border
  (the amber of the Buyer Alert row) · red = `--danger` on `--danger-soft` with a 1.5 px `--danger`
  border (exactly the panel's "Logged out of 7-11" card) · grey = `--text-muted` dot, `--text-dim` words;
- the history line: the small grey text used under "Test now" results (12 px, `--text-dim`).

## What the card would read (not built)

- One new route: `GET /admin/pc711/duty` — Admin only (the same two checks as every other route of this
  panel), read only. It reads the lease the extension already writes (`parcel_check_worker_lease`), the
  switch `pc711_backup_enabled`, `pc711_backup_state` and `pc711_backup_log`. It writes nothing and never
  calls the function that decides who is on duty.
- It answers counts and times only: on duty or not, since when, why (one of two words), how many parcels
  were answered in this duty, when the Lenovo last called, and the last take-over (start, end, why).
  Never a phone, name, store number or tracking number.
- Refresh: once when the panel opens, then every 30 seconds while the panel is open and the page is in
  front. Not when the panel is closed or the page is hidden. Between two reads the "… ago" number counts
  up by itself on the screen.
- Tables missing (sql/179 not applied) or switch not 'true' → the grey "Backup: off" card.

## To take the pictures again

```bash
npx vite --port 5199
```

```bash
node docs/design/pc711-duty-card/harness/shoot.cjs
```
