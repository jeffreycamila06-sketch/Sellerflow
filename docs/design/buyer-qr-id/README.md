# Buyer QR ID — mga mockup (plano v4)

**Mockup lang ito — wala pang binuo sa app.** Plano: `docs/plans/buyer-qr-id-plan.md` (§6).

Paano ginawa: ang TOTOONG Parcel Scan screen (7-11 at FamilyMart) ay binuksan sa preview database
(`vite.preview.config.ts`, walang totoong data), tinype ang mga halimbawang value sa totoong mga field, at ang
**kulay na kahon, ang maikling mensahe, ang "QR: @username ✕" chip at ang pagpipilian** ay idinrowing sa ibabaw
(`make-mockups.cjs`). Ang header, mga field, mga pindutan at mga error text ay ang totoong app ngayon. May tatak na
"MOCKUP · not built yet" sa kanang ibaba ng bawat larawan.

Mga file: `<711|fm>_<estado>_<device>.jpg` — 2 screen × 6 estado × 4 lapad = 48 larawan.
Mga lapad: iPhone 390, Android 360, Android 430, laptop 1280.

Tatlong klase ng resulta (plano §6.1):

| Estado | Klase | Ano ang ipinapakita |
|---|---|---|
| `1-before-scan` | — | Bago i-scan: ang screen **ngayon**, walang binago |
| `2-green-known` | **Berde** | Kilala sa code: napunan ang pangalan, phone, store, contact; "last used" na petsa; presyo na lang |
| `3-yellow-two-stores` | **Dilaw** | Ang buyer ay gumamit ng 2 store: pagpipilian, pinakabago ang naka-pili (H3) |
| `4-yellow-username` | **Dilaw** | Lumang sticker / walang code: nahanap sa Customers sa username — "pakisuri" |
| `5-yellow-username-changed` | **Dilaw** | Tugma ang code pero iba ang username sa sticker: naka-save na contact ang nananatili; mungkahi lang ang bago |
| `6-note-no-details` | **Maikling mensahe** | Wala pang details: @username lang ang napunan (gaya ngayon); i-type isang beses |

Hindi nilarawan (walang bagong itsura): hindi nabasang QR at "hindi na-check ang details ngayon" = mensahe gaya ng
toast ngayon; "mali ang store noong huli" = dilaw na kahon gaya ng `4`, blangko ang store.

Tandaan sa pagtingin:
- **Ang mga larawan sa phone ay mas mataas kaysa totoong screen** para makita ang buong card; sa totoong phone,
  magso-scroll ang encoder. (Ang lapad ay totoo.)
- Ang mga salita ay **mungkahi lang**, English muna; 8 wika sa Hakbang 2.
- Ang kulay-abong `022131` / `123456` sa store at `09xxxxxxxx` sa phone ay **placeholder ng app** (blangko pa ang field).
- "Amount required…" na pula at ang kulay-abong Save ay umiiral na ugali ng app kapag blangko pa ang presyo.
- Sa estado `5`, ang contact field ay ang **naka-save** (`maria_shops`); ang "Use @maria_live" ay mungkahi na isang pindot.
- Light theme lang. Dark theme at ibang wika: **HINDI PA NAPAPATUNAYAN** — walang larawan.

Ulitin: `npx vite --config vite.preview.config.ts --port 5199`, tapos
`node docs/design/buyer-qr-id/make-mockups.cjs` (o may filter, hal. `… make-mockups.cjs iphone390`).
