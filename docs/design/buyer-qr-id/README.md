# Buyer QR ID — mga mockup (Hakbang 1)

**Mockup lang ito — wala pang binuo sa app.** Plano: `docs/plans/buyer-qr-id-plan.md`.

Paano ginawa: ang TOTOONG Parcel Scan screen (7-11 at FamilyMart) ay binuksan sa preview database
(`vite.preview.config.ts`, walang totoong data), tinype ang mga halimbawang value sa totoong mga field, at
ang **kulay na kahon, ang "QR: @username ✕" chip at ang listahan ng pagpipilian** ay idinrowing sa ibabaw
(`make-mockups.cjs`). Kaya ang header, mga field, mga pindutan at mga error text ay ang totoong app ngayon;
ang kahon lang ang bago. May tatak na "MOCKUP · not built yet" sa kanang ibaba ng bawat larawan.

Mga pangalan ng file: `<711|fm>_<estado>_<device>.jpg` — 2 screen × 7 estado × 4 lapad = 56 larawan.
Mga lapad: iPhone 390, Android 360, Android 430, laptop 1280.

| Estado | Ano ang ipinapakita | Sa plano (§5) |
|---|---|---|
| `1-before-scan` | Bago i-scan — ang screen **ngayon**, walang binago | — |
| `2-known-buyer` | Na-scan ang QR ng buyer na may details: napunan ang pangalan, phone, store, buyer contact; puwedeng i-edit; presyo na lang | A (berde) |
| `3-new-buyer` | Na-scan ang QR ng bagong buyer: username lang ang napunan; i-type isang beses | E (asul) |
| `4-other-shop` | Na-scan ang QR na hindi sa seller na ito: walang napunan | F (pula) |
| `5-old-sticker` | Lumang sticker (username): nahanap sa username, "pakisuri" | G (dilaw) |
| `6-other-carrier` | Kilala sa kabilang carrier lang: pangalan + phone napunan, **store blangko** (hiwalay ang store ng 7-11 at FamilyMart) | B (dilaw) |
| `7-choose` | Iisang username, maraming naka-save na details: pipili ang encoder | D (dilaw) |

Hindi nilarawan (walang bagong itsura): lumang sticker na walang tugma sa Customers = @username lang ang
napupunan, eksaktong gaya ngayon (H); hindi nabasang QR = toast gaya ngayon (I).

Tandaan sa pagtingin:
- **Ang mga larawan sa phone ay mas mataas kaysa totoong screen** para makita ang buong card sa isang tingin;
  sa totoong phone, magso-scroll ang encoder. (Ang lapad ay totoo.)
- Ang mga salita sa kahon ay **mungkahi lang** (Tanong 10 sa plano), English muna; 8 wika sa Hakbang 2.
- "Amount required…" na pula ay ang umiiral na error ng app kapag blangko pa ang presyo.
- Ang Save ay kulay-abo dahil wala pang presyo (umiiral na ugali).
- Light theme lang ang nilarawan. Dark theme: ang kahon ay gumagamit ng parehong design tokens
  (`--ok`, `--warn`, `--accent`, `--danger`), pero **HINDI PA NAPAPATUNAYAN** ang itsura nito sa dark — walang larawan.

Ulitin: `npx vite --config vite.preview.config.ts --port 5199`, tapos
`node docs/design/buyer-qr-id/make-mockups.cjs` (o may filter, hal. `… make-mockups.cjs iphone390`).
