# Flash Label Y41BT on Android — "Test sent", no paper (Samsung A52)

Branch `claude/compassionate-pasteur-at5au5` · Nov 25 2026 · **not merged, not on any phone, no SQL, no deploy.**
The fix is Android printer code, so it only exists in a NEW Android build.

## 0. What is known and what is not

| | |
|---|---|
| Reported | Samsung A52, app 1.9 and 1.10: Test print says "Test sent", no paper. Same printer prints from a Samsung A51 5G and from iPhone. Unpairing in Android settings did not help. |
| **Not done** | **No logcat was captured.** This was built in a cloud session with no Mac and no phone. The cause is therefore **not confirmed**. Part 2 below is how to capture it. |
| Two possible causes | **A — the Bluetooth LE send** (the audit's guess; this branch changes it). **B — the A52 saved the PAIRED row** ("Y41BT-xxxx" **without `_LE`**), which prints through another writer that this branch does not touch. Part 1 tells them apart in 10 seconds, without a cable. |

## 1. The 10-second check (no cable)

On the A52: **Settings → Printer → Bluetooth**. Read the printer's name on the saved card.

- Ends with **`_LE`** (e.g. `Y41BT-0FC4_LE`) → the phone uses Bluetooth LE → cause A is possible → this branch is for it.
- **No `_LE`** (e.g. `Y41BT-0FC4`) → the phone saved the paired (classic) device. Tap **Scan**, pick the row that
  ends with `_LE`, Test print. If paper comes out, no new build is needed for this phone — tell Claude, the
  paired row can then be handled on its own.

Do the same on the A51 5G (the one that works) and note its name too.

Why B can happen only on Android: the scan list also shows devices the phone has PAIRED in Android's own
Bluetooth settings. The Y41BT shows up twice then — the paired one and the `_LE` one — and both are listed
as Flash Y41BT. iPhone has no paired row.

## 2. Capture the log (Mac + cable) — BEFORE removing the app that is on the A52

Phone: Developer options → USB debugging on. Then, one command at a time:

```bash
adb devices
```

```bash
adb shell getprop ro.build.version.release
```

```bash
adb logcat -c
```

```bash
adb logcat -v time SellerFlowPrinter:V SellerFlowPrinterGen:V SellerFlowPrinterBLE:V BluetoothGatt:V BluetoothSocket:V '*:S' | tee ~/Desktop/a52-y41-before.txt
```

Now tap **Test print** on the phone once, wait 10 seconds, then stop the log with Ctrl+C.

What the file tells:

| In the log | Means |
|---|---|
| `SellerFlowPrinterGen: generic print name=… chunks=… mtu=… confirmed=…` | Bluetooth LE path (cause A possible). `mtu` and `chunks` are the numbers to compare with the A51 5G. |
| no `SellerFlowPrinterGen` line, the app said "Test sent" | the PAIRED row (cause B) |
| `generic print failed … code=…` | a real error — send the line |
| `BluetoothGatt: onConfigureMTU() … mtu=…`, `onConnectionUpdated() … interval=…` | the piece size and the link speed the phone got |

If you can, do the same on the A51 5G (`a51-y41.txt`) — the working phone's numbers are the comparison.

## 3. Build the test app and try it

```bash
git -C ~/Sellerflow fetch origin
```

```bash
git -C ~/Sellerflow worktree add ~/sfl-wt/y41 origin/claude/compassionate-pasteur-at5au5
```

```bash
bash ~/sfl-wt/y41/docs/design/y41bt-android-paced/build-test-apk.sh
```

The script runs the Android unit tests, builds a debug app that loads the live website, checks inside the
built file, and puts `SellerFlowLive-Y41-test.apk` on the Desktop. It never touches `~/Sellerflow` itself.

On the A52 (the test app has another signature than the store app, so the store app must go first — this
logs the phone out and forgets the saved printer):

```bash
adb uninstall com.sellerflow.live
```

```bash
adb install ~/Desktop/SellerFlowLive-Y41-test.apk
```

```bash
adb logcat -c
```

```bash
adb logcat -v time SellerFlowPrinter:V SellerFlowPrinterGen:V SellerFlowPrinterBLE:V BluetoothGatt:V BluetoothSocket:V '*:S' | tee ~/Desktop/a52-y41-after.txt
```

Log in → Settings → Printer → Scan → pick the row that ends with **`_LE`** (a test sticker may print right
after the pick) → tap Test print three times → print one real order.

| Result | Log line | Next |
|---|---|---|
| Paper comes out | `paced send done … printerAnswered=yes answerMs=…` | Send both log files. `answerMs` over 1500 = today's send closed the link before the last pieces had arrived. |
| "Test sticker failed", no paper | `paced send failed … taken=…/… printerAnswered=no` | Honest failure. Send the log — the line says where it stopped. |
| "Test sent", still no paper | `paced send done … printerAnswered=yes` | The printer's Bluetooth took every byte and still did not print → not a sending problem. Send the log. |
| No `paced send` line at all | | The saved printer is not the `_LE` row, or the app is not the test app. |

To go back to the store app afterwards: `adb uninstall com.sellerflow.live`, then install from Google Play.

Also try on the **A51 5G** with the test app if you can (it must still print — it is the same Y41BT code).
Nothing else needs a re-test: see part 5.

## 4. What the branch changes (Y41BT on Android only)

Today, every generic Bluetooth LE printer on Android: pieces as big as the phone and the printer agree on
(up to 509 bytes), handed to the phone one right after the other (Android 13+: no pause), and "sent" 1.5 s
after the LAST piece was handed to the phone — whether or not those pieces had reached the printer yet.

For a printer whose name starts with `Y41BT`:

1. pieces of at most **180 bytes**;
2. the next piece only after the phone answered that it took the previous one, **plus 8 ms**;
3. after the last piece the phone asks the printer's Bluetooth one small question (it reads the device
   name). The answer can only come back after every piece before it arrived. Answer → the usual 1.5 s →
   "sent". No answer in 8–20 s, or the link closes first → **failed** ("Test sticker failed" on the screen).
   If the printer offers nothing to read, the job ends as today.

Same bytes, same order. The printer still never says "printed" — so "sent" now means "the printer's
Bluetooth took every byte", not "paper came out".

Files: `PacedBleSend.java` (new — the rules, no Android code in it), `GenericBleTransport.java` (+ the Y41BT
branch), `SellerFlowPrinterPlugin.java` (passes the printer's name), `PacedBleSendTest.java` (new).
Nothing in the website, the iPhone app, the server or the database.

Two things in the request that the code does not confirm:
- **"iPhone sends ~180-byte chunks"** — the iPhone app's limit is also 509; it sends pieces as big as iOS and
  the printer agree on. What it does differently: it waits until iOS is ready for the next piece and pauses
  8 ms after every piece.
- **The iPhone also says "sent" 1.5 s after the last piece.** It has no real confirmation either.

## 5. Other printers — why they need no re-test

- `proof/same-as-main.txt` — remove the marked Y41BT lines from the two edited Java files → **byte-identical
  to main** (sha256 shown). AIMO D520BT (`BleStickerTransport.java`), Niimbot, `TsplBuilder.java`,
  `BleStickerLogic.java`, the iPhone app, `printing.ts`, `printerModels.ts`: identical files.
- `proof/sim/` — the REAL `GenericBleTransport` class of main and of the branch, run against a pretend phone
  and printer: 39 cases for printers that are not a Y41BT (XP-420B, another generic, no name × Android 14 /
  12, sizes, busy phone, failures, link drops) → **the two traces are identical** (`others-main.txt` =
  `others-branch.txt`, 1,383 lines). The Y41BT cases: `y41-main.txt` (before) / `y41-branch.txt` (after, 38
  checks — also "a Y41BT job, then an XP-420B job in the same app"). ⚠ The pretend phone is a model, not a Samsung and not a real Y41BT.
- `proof/breaks.txt` — 33 on-purpose breaks of the new code, each one caught by a test.
- `PacedBleSendTest.java` — 28 tests on the plain JVM (a fake phone with its own clock).
- The two edited files + the new one compile against the real Android 14 framework classes (done in the
  cloud session; the whole app was NOT built there — the build script above is the first real build).

## 6. Not done / open

- No logcat, no real phone, no real printer, no real app build (see above).
- The paired (classic) Y41BT row is not changed. If part 1 shows the A52 uses it, that is a separate, small job.
- 180 bytes and 8 ms are the request ("like the iPhone"), not measured on this printer. They are two
  constants in `PacedBleSend.java`.
- A Y41BT sticker on Android may be slower than today on a fast link: a 60×40 sticker (about 19,000 bytes =
  107 pieces) now needs at least 0.85 s of sending (106 pauses of 8 ms). Today's real time was never measured.
- `versionCode` is still 12 / 1.10 (the scanner build). A store release of this needs 13 or more.
- The QR-scanner release gate (`mobile/android/qr-scanner-gate.sh`) compares the printer code with main and
  will list these changes — expected.
