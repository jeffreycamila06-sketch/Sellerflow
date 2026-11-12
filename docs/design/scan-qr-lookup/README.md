# Scan QR → hanapin sa Customers — mga mockup (Hakbang 1)

> **Luma na ang mga mockup dito (Hakbang 1).** Noong 2026-11-12, inalis ni Jeff ang listahan at ang kahon. Ang totoong
> screen ngayon ay nasa `built/`.

**Mockup lang ito — wala pang binuo sa app.** Plano: `docs/plans/scan-qr-lookup-plan.md` (§3).

Paano ginawa: ang TOTOONG Parcel Scan screen (7-11 at FamilyMart) ay binuksan sa preview database
(`vite.preview.config.ts`, walang totoong data). Ang header, mga field, mga pindutan at mga error text ay ang totoong app
ngayon. Ang **kulay na kahon at ang pagpipilian** lang ang idinrowing sa ibabaw (`make-mockups.cjs`), may tatak na
"MOCKUP · not built yet".

Mga file: `<711|fm>_<estado>_<device>.jpg` — 2 screen × 4 estado × 4 lapad = 32 larawan.
Mga lapad: iPhone 390, Android 360, Android 430, laptop 1280.

| Estado | Ano ang ipinapakita | Totoo o drowing? |
|---|---|---|
| `1-before-scan` | Bago i-scan — ang screen ngayon | Totoong screen, walang binago |
| `2-one-match` | Isang tugma sa Customers: napunan ang pangalan, phone, store at buyer contact; presyo na lang; "Found in Customers: @x — please check · last updated ‹petsa›" | Totoong mga field (tinype ang sample); ang kahon ay drowing |
| `3-many-matches` | Tatlong record para sa iisang username, **iba-iba ang store**: pagpipilian, pinakabago sa itaas, + "None of these — I'll type the details". Walang kusang napunan maliban sa username | Ang kahon at pagpipilian ay drowing |
| `4-no-match` | Walang tugma: @username lang, **eksaktong gaya ngayon** | **Totoong screen**: isang totoong QR (`https://tiktok.com/@newbuyer_tw`) ang ipinasa sa totoong Scan QR — ang app mismo ang nagbasa at nagpuno, at ito ang toast nito ngayon. Tatak: "REAL SCREEN · same as today" |

Hindi nilarawan (walang bagong itsura): hindi nabasang QR = toast gaya ngayon; walang signal / error = username + isang
maikling linya ng mensahe; "may naka-type na" = parehong kahon ng `2` na may pindutang "Use" sa halip na kusang punô.

Tandaan sa pagtingin:
- **Ang mga larawan sa phone ay mas mataas kaysa totoong screen** para makita ang buong card; sa totoong phone, magso-scroll
  ang encoder. (Ang lapad ay totoo.)
- Ang mga salita at kulay ay **mungkahi lang** (plano §8), English muna; 8 wika sa Hakbang 2.
- Ang kulay-abong `123456` / `022131` sa store at `09xxxxxxxx` sa phone ay **placeholder ng app** (blangko pa ang field).
- "Amount required…" na pula at ang kulay-abong Save ay umiiral na ugali kapag blangko pa ang presyo.
- Light theme lang. Dark theme at ibang wika: **HINDI PA NAPAPATUNAYAN** — walang larawan.

Ulitin: `npx vite --config vite.preview.config.ts --port 5199`, tapos
`node docs/design/scan-qr-lookup/make-mockups.cjs` (o may filter, hal. `… make-mockups.cjs iphone390`).
