# Buyer QR ID — plano (Hakbang 1: pag-aaral + plano + preview lang)

Branch `claude/buyer-qr-id` mula sa `origin/main` `119257aa`. **Walang binago sa app code, server, SQL o printing.**
Ang mga file sa branch na ito: ang planong ito, `docs/plans/buyer-qr-id-proof/` (proof script + output) at
`docs/design/buyer-qr-id/` (mga mockup). Lahat ng query sa database ay **read-only**.

Paano basahin: bawat pahayag ay may tatak —
**[PATUNAY]** = may file:line / query result / script output sa dokumentong ito ·
**[HINDI PA NAPAPATUNAYAN]** = hinala o disenyo pa lang; nakasulat kung paano ito mapapatunayan.
Walang "pasado" o "ligtas" dito na walang patunay.

---

## 0. Buod (isang pahina)

1. **Ngayon**, ang QR sa sticker ay ang link na `https://tiktok.com/@<username>` — nagbabago kapag nagpalit ng
   username ang buyer. Ang Scan QR sa Parcel Scan ay @username lang ang pinupunan.
2. **Walang stable na TikTok buyer ID sa app ngayon.** Ang TikTok library ay may `userId` (numeric, hindi
   nagbabago) pero **hindi ito ipinapasa ng server** sa app at **hindi naka-save** kahit saan. Kailangan ng maliit
   na dagdag sa server (isang field sa comment) — iyon ang pundasyon ng buong feature.
3. **Iminumungkahing QR:** isang code na 27 character, hal. `SFB1-EE246-6S371M557HNBR1GA`. Walang pangalan,
   phone, store, username o TikTok ID sa loob — hindi ito mababasa pabalik. Iba ang code ng parehong buyer sa
   bawat seller. **Kasya sa parehong laki ng QR ngayon** (29 modules, katulad ng 98% ng sticker ngayon) —
   may patunay sa §3.
4. **Details:** hindi gagawa ng pangalawang kopya ng pangalan/phone/store. Ang QR code ay ikakabit lang (link)
   sa row ng buyer sa **Customers** (7-11) at sa **Customers ng FamilyMart** — hiwalay ang dalawa, kaya hiwalay
   ang store. Ang huling na-save ang lalabas sa susunod na scan.
5. **Lumang sticker** (username/URL): gagana pa rin — hahanapin ang buyer sa username, pero ipapakita bilang
   "pakisuri" (hindi kasing-tiyak ng QR ID).
6. **Dating buyers:** hindi kayang bigyan ng ID nang maramihan ngayon (walang TikTok ID sa lumang data). Kusang
   magkaka-ID sila sa **susunod nilang order**; sa unang scan, hahanapin sila sa username at ikakabit.
7. **Pinakamalaking conflict na kailangan ng desisyon ni Jeff:** ang QR ngayon ay nabubuksan ng camera ng phone
   papunta sa TikTok profile ng buyer. Kapag ID code na lang ang laman, **mawawala iyon** (Tanong 1).
8. **Bagong app build:** [HINDI PA NAPAPATUNAYAN — hinihintay ang printer-guardian, §8] inaasahang HINDI
   kailangan (web lang ang gumuguhit ng QR), pero kailangan ng **manual Render deploy** (server) at **SQL**.

---

## 1. Ano ang meron ngayon (may patunay)

### 1.1 Laman ng sticker QR
| Pahayag | Patunay |
|---|---|
| QR text = `https://tiktok.com/@<handle>` (walang www; isang `@` lang ang tinatanggal) | `src/lib/tiktokHandle.ts:17-20` |
| ECC "M", byte mode, pinakamaliit na version na kasya | `src/lib/qr.ts:13-17`; tawag: `oneSticker.ts:295-298`, `stickerRaster.ts:1099-1101`, `stickerRaster.ts:1373-1375`, `printing.ts:1263-1265` |
| TikTok lang (walang QR sa Facebook / Instagram / Shopee) | `printing.ts:139-142` |
| Per-device toggle `sfl_rd_sticker_qr`, default OFF; kailangan din ng entitlement (market TW) | `printing.ts:116-129`; `parcelScan.ts:67-69` |
| Sumusunod sa @username toggle (walang QR kapag naka-off ang @username) | `stickerRaster.ts:1096`; `printing.ts:1330` |
| QR ≥ 2 mm mula sa kanang gilid; walang QR sa ilalim ng 50×30 | `oneSticker.ts:44-45`; `docs/printing/PRINTING_MAP.md:156` |
| Laki ng QR ngayon ayon sa haba ng username: 1–6 char → v2 (25 modules); 7–22 → v3 (29); 23–24 → v4 (33) | `docs/plans/buyer-qr-id-proof/qrcheck.output.txt` (script output) |
| Gaano kadalas ang bawat isa (TikTok order rows sa live DB): 7–22 char = **172,885** (98.0%); 1–6 = 3,008 (1.7%); 23+ = 458 (0.3%) | Query Q5 (§12) |

### 1.2 Scan QR sa Parcel Scan
| Pahayag | Patunay |
|---|---|
| 7-11: kuha/upload ng litrato → decode → `handleFromQrPayload` → pinupunan ang **@username lang** (`notes`), pinipili ang TikTok | `screens/ParcelScan.tsx:1072-1089` |
| FamilyMart: pareho, `username` field | `screens/FmParcelScan.tsx:201-212` |
| Decode: `BarcodeDetector` (Android/Chrome) → `jsQR` (iPhone); litrato lang, pinapaliit sa ~1000 px | `adapters/qrDecode.ts:7-63` |
| Tinatanggap: TikTok URL **o** hubad na username `^@?[A-Za-z0-9._]{1,30}$`; iba pa → "No QR found", walang napupunan | `src/lib/tiktokHandle.ts:28-36` |
| Dalawang pindutan ng Scan QR sa 7-11 (manual entry header + confirm card) | `ParcelScan.tsx:1330`, `:1401` |

### 1.3 Customers (phonebook)
| Pahayag | Patunay |
|---|---|
| 7-11 = `parcel_customers` (name, phone, store_id, **notes = buyer contact/username**, contact_platform) | Query Q1 |
| FamilyMart = `fm_parcel_customers` (name, phone, store_id, **buyer_username**, contact_platform) — hiwalay na table | Query Q1 |
| Isang row bawat (seller, phone, pangalan) — unique index | Query Q2 (`parcel_customers_uniq`, `fm_parcel_customers_uniq`) |
| Awtomatikong napupunan ng DB trigger tuwing may save/edit ng parcel | Query Q3 (`upsert_parcel_customer`, `upsert_fm_parcel_customer`) |
| 7-11 trigger: phone na "restricted" → **binubura** ang buyer sa Customers; store na hindi valid → hindi idinadagdag | Query Q3 (function body) |
| Sariling data lang ang nakikita (RLS `user_id = auth.uid()`) | Query Q2 (policies) |
| Laman ngayon: 7-11 = 56,011 rows / 73 sellers (44,790 may contact; 39,332 hugis-username); FamilyMart = 665 rows / 26 sellers | Query Q4 |
| **1,572** (seller, username) ang may **higit sa isang** row sa Customers (hanggang 26 rows sa iisang username); 791 dito ay magkakaibang phone | Query Q4, Q5 |
| 54 buyer ang nasa parehong Customers (7-11 at FamilyMart) ng iisang seller; sa 44, pareho ang pangalan at phone; sa 10, magkaiba | Query Q6 |

### 1.4 Stable na TikTok buyer ID
| Pahayag | Patunay |
|---|---|
| Ang TikTok library (2.1.1-beta1) ay naglalabas ng `userId` at `secUid` sa bawat comment | `node_modules/tiktok-live-connector/dist/lib/_legacy/data-converter.js:123-128` |
| Ang server ay `handle` (uniqueId), `name`, `comment`, `avatar`, `msgId` lang ang ipinapasa — **walang `userId`** | `server.js:1782-1818`; `server/initialComments.js:63-87` |
| Ang app ay hindi nagbabasa ng `userId` kahit saan | `grep userId\|secUid` sa `useLiveFeed.ts`, `data.ts`, `orderLogic.ts` = 0 tugma |
| Walang column para dito: `live_session_orders` (may `platform_meta` jsonb — Facebook/Shopee lang ang gumagamit), `customers`, mga parcel table | Query Q1, Q5 (`platform_meta` keys = `commenter_id, live_video_id, page_id`) |
| Ang `sellerId` sa server = auth UUID ng seller (kapareho ng `auth.uid()` sa database) | `server.js:186`, `:502-503` |
| **[HINDI PA NAPAPATUNAYAN]** na sa totoong production comments ay laging may laman ang `data.userId`, at na hindi ito nagbabago kapag nagpalit ng username. Ang una: library code lang ang nabasa (aral ng "F1": minsan iba ang totoong hugis ng data). Ang pangalawa: kilalang ugali ng TikTok pero wala pa sa sarili nating data. | Patunay sa **Phase 0** (§9): bilangin sa server log kung ilan ang may/walang `userId`; pagkatapos ng ilang araw, i-query ang mga buyer na parehong code pero dalawang username |

### 1.5 Iba pang nakita na mahalaga sa plano
| Pahayag | Patunay |
|---|---|
| `platform_meta` ay naipapasa na ng `db.ts` nang walang pagbabago (kahit anong key) | `src/db.ts:170`, `:212`; `adapters/useOrders.ts:94` |
| Ang order rows ay **hindi** binubura pagkalipas ng 10 araw nang basta-basta: natitira ang huling 7 natapos na session ng seller (pinakaluma ngayon: 2026-10-03; 178,656 rows) | Query Q7 (`purge_live_session_orders`) |
| Ang session load ay hindi nagbabasa ng `platform_meta` (kailangang idagdag sa listahan ng column para sa Reprint) | `adapters/useSessionWindow.ts:132`, `:183` |
| May built-in na `sha256()` ang database (walang kailangang extension); pareho ang sagot nito sa Node: tag ng test seller = `EE246` sa pareho | Query Q8 + `qrcheck.output.txt` |
| Lahat ng parcel table ay `ON DELETE CASCADE` sa account | Query Q8 |
| Preview/allowlist system: `feature_access_emails` + `my_feature_access()` + `app_settings` switch | `adapters/featureAccess.ts:11-23`; `adapters/featureSwitches.ts:21-28` |

---

## 2. Ang disenyo sa isang tingin

```
TikTok comment ──► SERVER (bago: kinukuwenta ang code mula sa TikTok userId + seller) ──► app (field `buyerQr`)
        order (1-Click / Enterprise / Auto) ──► naka-save sa order row: platform_meta.bq = code
        sticker ──► QR = code (kung may code at naka-ON ang switch) · kung wala = QR ngayon (username link)

Parcel Scan ► Scan QR ► basahin ang text:
   SFB1-…  (bagong code)  ► tag ng ibang shop?  ► "Sticker ng ibang shop" — walang pupunan
                          ► akin ► database: may kabit na buyer?  ► OO: punan pangalan/phone/store/contact (BERDE)
                                                                   ► WALA: hanapin sa username ng order ► may nakita: punan (DILAW, pakisuri)
                                                                                                        ► wala: "Bagong buyer — i-type isang beses"
   username / TikTok URL (lumang sticker) ► hanapin sa username ► may nakita: punan (DILAW) · wala: @username lang (gaya ngayon)
Save ► ang parcel ay may `buyer_qr_id` ► trigger: ikabit ang code sa row ng buyer sa Customers (7-11 o FamilyMart)
```

---

## 3. Ano ang ilalagay sa QR

**Format (27 ASCII character, laging pareho ang haba):** `SFB1-<TAG>-<ID>`

| Bahagi | Laman | Para saan |
|---|---|---|
| `SFB1` | "SellerFlow Buyer", bersyon 1 | makilala na QR natin ito; puwedeng palitan ang paraan sa hinaharap (SFB2) nang hindi nasisira ang luma |
| `TAG` (5) | unang 5 hex ng `sha256("sfb-tag:" + seller UUID)` | malaman kung sticker ng **ibang shop** nang hindi nagtatanong sa database |
| `ID` (16) | 16 character (Crockford base32, 80 bits) ng `HMAC-SHA256(key = seller UUID, "sfb1:" + TikTok userId)` | ang permanenteng ID ng buyer **sa seller na ito** |

Mga katangian:
- **Permanente:** galing sa TikTok `userId` (hindi sa username) at sa seller UUID — parehong hindi nagbabago.
  Parehong code sa lahat ng phone ng seller, kahit offline, kahit bagong session/live, dahil kuwenta ito, hindi
  bagong numerong iniimbak. [PATUNAY na deterministic: `qrcheck.output.txt` huling linya. HINDI PA NAPAPATUNAYAN
  na stable ang `userId` sa production — §1.4]
- **Privacy:** walang pangalan, phone, store, username o TikTok ID sa QR. Hindi maibabalik ang code sa TikTok
  account (HMAC). **Ang parehong buyer ay may ibang code sa bawat seller** [PATUNAY: seller A vs seller B sa
  `qrcheck.output.txt`], kaya hindi masusundan ang buyer mula shop papunta sa ibang shop.
- **Hindi iniimbak ang TikTok `userId`** kahit saan (server memory lang habang dumadaan ang comment). Ang
  naka-save ay ang code lang.
- **Kasya sa QR ngayon:** 27 bytes → **version 3 = 29 modules**, eksaktong kapareho ng QR ngayon para sa
  username na 7–22 character (98% ng sticker). [PATUNAY: `qrcheck.output.txt`]. Ibig sabihin walang bagong
  laki ng QR na hindi pa nasusubok ng layout; para sa 1.7% (maikling username) lalaki nang kaunti ang QR
  (25 → 29 modules) at para sa 0.3% (23–24 char) liliit (33 → 29). **[HINDI PA NAPAPATUNAYAN: ang epekto nito
  sa bawat laki ng papel — hinihintay ang printer-guardian, §8.]**
- **Hindi mababasa nang mali ng lumang app:** ang lumang parser ay tumatanggi rito (may `-`), kaya ang device
  na may lumang bundle ay magsasabi lang ng "No QR found" at walang pupunan na maling username.
  [PATUNAY: `legacyParserAccepts=false` sa `qrcheck.output.txt`]
- **Posibilidad na magkapareho ang code ng dalawang buyer ng iisang seller:** sa 100,000 buyers ≈ 1 sa
  240 trilyon (80 bits). [Kuwenta, hindi sukat.]

Saan kinukuwenta: **sa server** (bagong maliit na purong module, hal. `server/buyerQr.js`, may vitest), dahil
doon lang dumadaan ang TikTok `userId` at para hindi na ito umabot sa phone. Ipinapasa bilang bagong optional
na field `buyerQr` sa comment (live, "earlier comments", at reuse re-emit — iisang payload shape).
Walang `userId` sa comment (o walang seller UUID) → walang `buyerQr` → QR ngayon (username link).

---

## 4. Paano iuugnay ang code sa details (bawat seller; hiwalay ang 7-11 at FamilyMart)

**Prinsipyo: iisang pinagmumulan ng details = Customers.** Hindi kokopyahin ang pangalan/phone/store sa ibang
table. Ang code ay "ikakabit" lang sa row ng buyer sa Customers.

Bagong SQL (Hakbang 2; susunod na libreng numero ay sql/149 — kumpirmahin sa oras ng paggawa):
1. `parcel_scans.buyer_qr_id text null` at `fm_parcel_scans.buyer_qr_id text null` — additive, nullable, walang
   default (walang rewrite ng table). Ang app ay nagpapasa nito **lang** kapag may na-scan na code.
2. Dalawang maliit na link table (walang personal na data, mga ID lang):
   - `parcel_buyer_qr (user_id, qr_id, customer_id → parcel_customers(id) ON DELETE CASCADE, updated_at, PK (user_id, qr_id))`
   - `fm_parcel_buyer_qr (user_id, qr_id, customer_id → fm_parcel_customers(id) ON DELETE CASCADE, updated_at, PK (user_id, qr_id))`
   - RLS: `SELECT` at `DELETE` ng sariling row lang; **walang** `INSERT`/`UPDATE` policy (trigger lang ang
     nagsusulat, kaya hindi makakagawa ang browser ng pekeng kabit). `user_id → auth.users ON DELETE CASCADE`.
3. Dalawang **bagong, hiwalay** na trigger (hindi ginagalaw ang `upsert_parcel_customer` /
   `upsert_fm_parcel_customer`): `AFTER INSERT OR UPDATE` sa scans table, tumatakbo **pagkatapos** ng phonebook
   trigger (pangalan ng trigger na mas huli sa alpabeto), kapag `NEW.buyer_qr_id IS NOT NULL`:
   hanapin ang row sa Customers sa parehong susi ng phonebook (seller + phone + pangalan) → `upsert` ng kabit
   `(user_id, qr_id) → customer_id`. Walang nakitang row (hal. hindi idinagdag dahil sa store/phone rule) →
   walang kabit. **Lahat ng laman ay nasa `BEGIN … EXCEPTION WHEN OTHERS` — ang error sa trigger ay hindi
   kailanman makakapigil sa pag-save ng parcel.**
4. Isang lookup RPC `buyer_qr_lookup(p_code text, p_handle text, p_carrier text) → jsonb`, `SECURITY INVOKER`,
   bawat query ay may tahasang `user_id = auth.uid()` (aral ng Miners bug). Isang tawag bawat scan.

Bakit link at hindi hiwalay na "details" table (pinag-isipang alternatibo):
- Kapag in-edit ng encoder ang buyer sa **📇 Customers**, ang susunod na scan ay kusa nang tama (iisa ang
  pinagmumulan). Sa hiwalay na kopya, magkakaroon ng dalawang magkaibang phone para sa iisang buyer.
- Ang umiiral na rule na "restricted na phone → burahin sa Customers" ay kusang sumasakop sa QR: nabura ang
  row → nabura ang kabit (CASCADE) → sa susunod na scan, "bagong buyer". Walang dobleng rule na isusulat.
- Dalawang TikTok account na iisang tumatanggap (parehong pangalan + phone): puwedeng maraming code ang
  nakakabit sa iisang row — walang agawan.
- Walang bagong kopya ng personal na data → mas kaunti ang babantayan sa privacy at sa account delete.

**"Ang huling na-save ang lalabas":** ang kabit ay laging tumuturo sa row ng Customers na tumugma sa
**huling na-save na parcel** na may code na iyon. Kung binago ng encoder ang pangalan o phone bago mag-Save,
gagawa ang umiiral na phonebook trigger ng bagong row (ganyan na ngayon) at doon lilipat ang kabit.

**Hiwalay ang 7-11 at FamilyMart:** magkahiwalay ang Customers at ang link table, kaya magkahiwalay ang store.
Kung ang buyer ay may kabit sa 7-11 pero wala pa sa FamilyMart (o baliktad): pupunan ang **pangalan at phone**
mula sa kabilang carrier, **blangko ang store**, may tatak na "galing sa 7-11 — pakisuri". (Datos: sa 54 na
buyer na nasa pareho, 44 ang magkapareho ang pangalan/phone — Q6. Tanong 4.)

**Ang username sa "Buyer contact":** kapag QR code ang na-scan, ang ipupuno ay ang **pinakabagong username**
ng buyer mula sa sarili niyang order rows (`platform_meta->>'bq' = code`, pinakabago), para kapag nagpalit ng
username ang buyer ay tama ang Pickup Status at ang 賣貨便 col J. Kung wala nang order row (lampas na sa
natitirang 7 session), ang naka-save sa Customers ang gagamitin.

---

## 5. Ang gagawin ng Scan QR (bawat sitwasyon)

Ang lookup ay sumasagot ng isa sa mga ito (parehong sagot sa 7-11 at FamilyMart; iba lang ang table):

| # | Na-scan | Kalagayan | Ano ang lalabas | Kulay |
|---|---|---|---|---|
| A | Bagong code, akin | may kabit sa carrier na ito | pangalan, phone, store, buyer contact — napunan; cursor sa **Amount** | berde "Nakilala sa QR" |
| B | Bagong code, akin | walang kabit dito, may kabit sa kabilang carrier | pangalan + phone napunan, **store blangko**, contact napunan | dilaw "Galing sa 7-11/FamilyMart — pakisuri, i-type ang store" |
| C | Bagong code, akin | walang kabit; may order row → username; **isa** ang tugmang row sa Customers | lahat napunan mula sa Customers | dilaw "Nahanap sa username @x — pakisuri bago i-Save" |
| D | (pareho ng C) | **higit sa isa** ang tugma (1,572 ganitong kaso ngayon) | listahan ng hanggang 5 pagpipilian (pangalan · phone · store · petsa) + "Wala rito — ita-type ko" | dilaw |
| E | Bagong code, akin | walang kabit, walang tugma | contact = username (kung alam); iba pa blangko | asul "Bagong buyer — i-type isang beses" |
| F | Bagong code, **TAG ng ibang shop** | — | **walang napunan** | pula "Sticker ito ng ibang shop" |
| G | Lumang sticker (username / TikTok URL) | may tugma sa Customers | gaya ng C/D | dilaw "Lumang sticker — nahanap sa username, pakisuri" |
| H | Lumang sticker | walang tugma | @username lang ang napunan (**eksaktong gaya ngayon**) | toast gaya ngayon |
| I | Hindi QR natin / hindi nabasa | — | walang napunan (**gaya ngayon**) | toast gaya ngayon |

Mga tuntunin:
- **Laging puwedeng i-edit** ang lahat ng napunan bago mag-Save (rule 4 ni Jeff). Walang field na naka-lock.
- **Dalawang antas ng tiwala:** berde = tugma sa QR ID (ang buyer mismo). Dilaw = tugma sa username lang —
  puwedeng mali (tingnan ang butas B3) kaya laging "pakisuri".
- May maliit na chip sa form habang may nakakabit na code: **"QR: @username ✕"**. Ang ✕ ay nag-aalis ng kabit
  sa entry na ito (ang mga field ay hindi buburahin). Ang Cancel, Clear at matagumpay na Save ay nagre-reset.
- Kung may naka-type na sa form bago mag-scan at iba ang lalabas: tatanungin muna ("Palitan ang naka-type?").
- Sa Save, ang code ay isasama sa parcel (`buyer_qr_id`) → trigger → kabit. **Sa C/D/G, ang Save ang
  nagkakabit ng code sa buyer** — kaya sa susunod, berde na (A). Sa G (lumang sticker) walang code na
  maikakabit; magiging A lang kapag may bagong sticker na ang buyer.
- Presyo (Amount) ang natitirang ita-type. Dry/Frozen, mga check ng store/phone, batch cap, export —
  **walang pagbabago**; dumadaan pa rin ang parcel sa parehong validation.
- Ang **📇 Customers** ay mananatili gaya ngayon (para sa Facebook buyers at kapag walang sticker).

---

## 6. Mga partikular na tanong ng Hakbang 1

**Paano babasahin ang lumang username QR?** Hindi gagalawin ang `handleFromQrPayload`. Bagong hakbang lang
bago nito: kung `^SFB1-[0-9A-F]{5}-[0-9A-HJKMNP-TV-Z]{16}$` → bagong code; kung hindi → lumang parser, tapos
hanapin ang username sa Customers (G/H).

**Paano magkakaroon ng ID ang mga dating buyer?** Walang bulk na paraan — walang TikTok `userId` sa lumang
data [PATUNAY §1.4]. Kusang mangyayari: (1) susunod na order ng buyer → may `buyerQr` ang comment → code ang
QR ng sticker; (2) unang scan → C/D (username) → Save → nakakabit. Walang migration, walang backfill job.

**Nagpalit ng username ang buyer?** Parehong `userId` → parehong code → parehong kabit → napupunan pa rin (A).
Ang contact ay ang bagong username (galing sa bagong order row). Ang lumang sticker niya na may lumang
username ay hahanapin pa rin sa lumang username (G) hangga't iyon ang naka-save sa Customers; kapag na-save
na ang bagong username, ang lumang sticker ay H na lang (username lang ang mapupunan).

**Dalawang seller, iisang buyer?** Magkaibang code (magkaibang key), magkaibang TAG. Ang sticker ni Seller A
na na-scan ni Seller B → F (walang napunan). Kahit pilitin, ang lookup ay sariling rows lang ang binabasa
(RLS + `auth.uid()`), at ang link tables ay walang paraan para mabasa ng iba.

**Kailangan ba ng bagong app build?** [HINDI PA NAPAPATUNAYAN — §8.] Inaasahan: hindi. Ang QR ay iginuguhit
ng web code sa picture ng sticker; ang decode ay web din.

---

## 7. Mga file na gagalawin sa Hakbang 2 (listahan, hindi pa ginagawa)

Server (manual Render deploy; sacred zone ang comment relay → sariling audit):
- BAGO `server/buyerQr.js` (puro: `buyerQrText(sellerUuid, tiktokUserId)`), + vitest.
- `server.js` chat relay (`:1785-1818`): +1 optional field `buyerQr`. `server/initialComments.js:63-87`: pareho.
- Phase 0 log: isang linya bawat koneksyon kada ilang minuto: ilan ang comment na may/walang `userId` (walang personal na data).

Database: `sql/149_buyer_qr_id.sql` + rollback + `scripts/sql149-behaviour.mjs` (PGlite): mga column, 2 link
table, 2 trigger, lookup RPC, `buyer_qr_id_enabled` (seed `'false'`), `my_feature_access()` na may bagong key
(buuin mula sa LIVE na definition sa oras ng apply — aral ng sql/140).

App (redesign adapters/screens lang; `App.tsx`, `db.ts` hindi gagalawin):
- BAGO `src/lib/buyerQr.ts`: `parseBuyerQr(text)`, `stickerQrText(handle, buyerQr)` — **iisang helper** para sa
  lahat ng lugar na gumagawa ng QR (para walang makalimutang print path).
- `data.ts` (Comment + buyer type: optional `buyerQr`), `useLiveFeed.ts` (`toRedesignComment`: kopyahin ang field),
  `useOrders.ts:94` (`platform_meta` para sa TikTok: `{ bq }` kapag naka-ON), `useSessionWindow.ts:132/:183`
  (+`platform_meta` sa select), `lib/orderLogic.ts` (`rebuildSessionFromRows`: optional na field papunta sa buyer —
  additive lang), `reprint.ts`.
- Printing (mga lugar na ililista ng printer-guardian, §8): palitan ang `tiktokProfileUrl(handle)` ng
  `stickerQrText(handle, buyerQr)`.
- `adapters/parcelScan.ts`, `fmScan.ts`: optional `buyerQrId` sa save (isinasama lang kapag may laman →
  parehong payload gaya ngayon kapag wala). BAGO `adapters/buyerQrLookup.ts`.
- `screens/ParcelScan.tsx`, `FmParcelScan.tsx`: bagong `onScanQr`, banner, chip, chooser. i18n ×8 wika.
- `featureAccess.ts` (+`buyer_qr_id`), `featureSwitches.ts` (+`buyerQrId`).
- Docs: `docs/printing/PRINTING_MAP.md`, `docs/support/sfl-guide.md` + `sql/116b` (rule ng help-bot guide).

---

## 8. Epekto sa printing (sinuri ng printer-guardian — hiwalay na reviewer)

Hatol ng guardian: **"GAPS FOUND (12)"** — tama ang bahagi ng laki ng QR; ang mga kulang ay kung paano umaabot
ang code sa **bawat** paraan ng pag-print. Lahat ng 12 ay nasa §13 kasama ang ayos. Ang mga sukat niya ay
naka-save sa `docs/plans/buyer-qr-id-proof/guardian-layout-*.txt` (at ang dalawang test na gumawa nito).

### 8.1 Lahat ng lugar na gumagawa/gumuguhit ng QR [PATUNAY: file:line mula sa guardian; 3 file lang ang nag-i-import ng `qrMatrix`]
| # | Lugar | Mga path na pinapakain |
|---|---|---|
| a | `stickerRaster.ts:1092-1118` `stickerQrPlacement` | sticker ngayon: D520 70×50…100×60, 50×30, generic ≥ 70×50 |
| b | `stickerRaster.ts:1368-1383` `propQrPlacement` | font C: generic 50×30/60×40, Niimbot, D520 compact v2 |
| c | `oneSticker.ts:295-298` `layoutSticker` | bagong sticker (lahat ng printer + laptop picture + preview nito) |
| d | `printing.ts:1260-1272` `webStickerQrSvg` (gamit sa `:1330`) | laptop/web HTML |

Mga gate na dapat ding makakita ng bagong field: `imageStickerPayload` (`printing.ts:514-516`, tinatawag sa
`:527`, `:611`, `:671`), `oneStickerInputFrom` (`oneStickerPrint.ts:281-298`, tinatawag sa `printing.ts:741`, `:1412`).
Walang QR code sa native Java/Swift o sa `server/` (grep = 0).

Mga lugar na **wala sa unang draft ko** at idinagdag dahil sa guardian:
- **Preview at sample:** `stickerPreview.ts:11-30`, `ExactStickerPreview.tsx:31`, `PrintPattern.tsx:149/162/166`,
  `OneStickerPattern.tsx:47/221`, `oneStickerPrint.ts:303` (`ONE_STICKER_SAMPLE`), `adminLangSamples.ts` (11 sample),
  `printerBridge.ts:172` (test buyer), `oneSticker.ts:523-532` (worst-case list).
- **Mga nagpi-print na gumagawa ng sariling buyer:** Pin to print (`pinToPrint.ts:61-76` + `server/pinRelay.js:42-54`),
  raffle (`raffle.ts:99-110`), Print stickers screen (`Print.tsx:29/32`), at **tatlong ruta ng Reprint**
  (`reprint.ts:36-47`, `ordersSearch.ts:44-66`, at ang mga raw-row na ruta na umaasa sa select ng `useSessionWindow.ts:132/:183`).

### 8.2 Ano ang magbabago sa papel [PATUNAY: sukat ng guardian — `guardian-layout-new-sticker.txt` 384 kaso, `guardian-layout-todays-sticker.txt` 185 kaso]
- **Username na 7–22 character (98% ng order rows):** ang layout na may lumang URL at may bagong code ay
  **magkapareho** — 96 sa 96 na kaso sa bagong sticker (9 laki × 4 path × Buyer # 1×/1.5×/2×, username na 10 char),
  at "QR-only" (tuldok lang ng QR ang naiba) sa sticker ngayon. Sukat ito ng layout, **hindi pa papel**.
- **Username na 1–6 character (1.7%)** — lalaki ang QR mula 25 → 29 modules:
  sticker ngayon 70×50…100×60: QR block 132 → 148 dots (2 mm mas kaliwa/taas; 2 mm mas makitid ang comment);
  50×30 at font C 60×40: 165 → 185 dots, may nakitang paglipat/pagliit ng text; laptop: 16.5 → 18.5 mm.
  Bagong sticker: sa karamihan parehong 6-dot module pero mas malaki ang QR (18.8 → 21.8 mm); **liliit ang tuldok ng
  QR** sa 50×40 (5 → 4 dots), Niimbot 50×30 (6 → 5), 80×50 at 110×80 kapag Buyer # 1.5× (6 → 5); at Buyer # na
  1.5×/2× ay 4–5 dots na mas maliit sa karamihan ng laki (bagong dilaw na "made smaller" sa 50×30).
- **Username na 23–24 character (0.3%)** — liliit ang QR (33 → 29 modules): kabaligtaran ng nasa itaas (mas maraming lugar sa text).
- D520 60×40 na walang compact v2: walang QR ngayon, wala pa rin.
- **Ibig sabihin:** para sa 1.7%, ang sticker ay magiging kapareho ng nakukuha na ng 98% ngayon — pero **iba sa
  sticker nila ngayon**. Hindi ito "walang nagbago". [HINDI PA NAPAPATUNAYAN: paglipat ng text para sa lahat ng
  klase ng comment (dalawang comment lang ang sinukat); itsura at scan sa totoong papel.]
- **Opsyon na mas maliit na QR (25 modules) sa hinaharap:** ang parehong 27 character ay kasya sa v2 kung
  "Alphanumeric mode" ang QR (sukat ng guardian). Mas malaki ang tuldok sa masisikip na laki, pero babaguhin
  nito ang sticker ng 98% ng buyers at halos walang karanasan sa papel. **Rekomendasyon ng guardian at ng plano:
  v3 muna; ang v2 ay hiwalay na pagbabago na may sariling larawan at paper test** (hindi magbabago ang text ng code).

### 8.3 Bagong app build? [PATUNAY sa code; HINDI PA sa device]
Hindi kailangan para sa printing: lahat ng QR ay iginuguhit sa TypeScript at ipinapadala bilang picture
(`printStickerBitmap`, `printRawTspl`, `printStickerImage`, o browser page). Walang Java/Swift na gagalawin →
walang goldens, walang Mac XCTest gate, walang store release. (Hiwalay: Render deploy at SQL.)
Hindi nagpi-print ng QR ngayon at **hindi apektado**: text sticker (lumang app / Classic / offline na font / SPP
fallback), iOS WiFi sticker, slip/resibo, D520 60×40 na walang compact v2, bagong sticker na mas maliit sa 50×30,
Facebook/Instagram/Shopee buyers.

### 8.4 Mga kondisyon ng guardian na isinama sa plano
1. **Iisang helper** `stickerQrMatrix(handle, buyerQr)` (text + ECC "M" + mode sa iisang lugar); tumatanggap lang ng
   eksaktong 27-character na pattern — anumang iba (sirang value mula sa DB/relay) → URL ngayon; test na laging 29 modules.
   Source test: `qrMatrix(` at `tiktokProfileUrl(` ay hindi lumalabas saanman sa `src/redesign` maliban sa helper.
2. **Ang code ay HINDI pumapasok sa JSON na ipinapadala sa native** (text sticker, WiFi sticker, slip): ihihiwalay
   sa itaas ng `printSlip` (`printing.ts:1281`) at dadalhin bilang hiwalay na field ng job, at ipapasok sa
   `imageStickerPayload` kung saan pumapasok ngayon ang `printStickerQr`. Ang umiiral na test
   (`printing.test.ts:38-55`) ay `settings` lang ang binabantayan — kaya **bagong test**: may code + switch ON → ang
   argument ng `printStickerNative`, `printStickerLan`, `printSlip` ay byte-identical sa walang code.
   [HINDI PA NAPAPATUNAYAN kung binabalewala ng lumang naka-install na app ang dagdag na key — kaya nga hindi natin ito ipapadala.]
3. **Walang lookup o `crypto` sa loob ng print job** — ang code ay dumarating kasama ng order/row, kaya hindi
   nagagalaw ang 35 s watchdog at ang 8 s na paghihintay ng font.
4. **Isang desisyon sa oras ng paggawa ng order** (`useOrders.ts:225`, katabi ng `autoCode`): doon itatatak ang code
   kung naka-ON; ang row at ang print ay sumusunod sa order. Reprint sa device na naka-OFF ang switch → sumusunod
   pa rin sa order (ang switch ay para sa **bagong** order lang).
5. Preview = print: ang mga sample (preview, test print, 11 admin language sample — 5 dito ay ≤ 6 char) ay
   gagamit ng **sample code** na 27 character kapag naka-ON. Hindi gagalawin ang `buildTestBuyer()` (golden-pinned,
   `printerBridge.ts:152`). Ang Parcel Scan ay kikilala sa sample code bilang "test sticker", hindi "bagong buyer".
6. `scripts/printing-paths.mjs:3-15` ay hindi naglilista ng `src/lib/qr.ts`, `src/lib/tiktokHandle.ts` at ng
   bagong `src/lib/buyerQr.ts` → idadagdag (kasama ang `server/pinRelay.js`) para dumaan sa printing gate.
7. `PRINTING_MAP.md` ia-update sa parehong branch (row 16, bagong switch + field, mga test, at ang mga lumang
   line number na napansin ng guardian: `webStickerQrSvg` ay nasa 1260-1272, hindi 989-1001; atbp.).
8. Mga larawang TODAY-vs-NEW at ang paper test na hinihingi ng guardian: nasa §11.4 at §11.5.

---

## 9. Paunti-unting release, at rollback

| Phase | Ano | Sino ang apektado | Patunay bago umusad |
|---|---|---|---|
| 0 | Server: ipasa ang `buyerQr` + bilang sa log. (Render deploy sa tahimik na oras, may Business Pulse check.) | Wala (binabalewala ng app ang di-kilalang field) | Log: ≥ 99% ng TikTok comment ay may `userId`; walang error; parehong code sa parehong buyer sa dalawang magkaibang araw |
| 1 | SQL (additive) | Wala (walang nagsusulat pa) | `sql149-behaviour.mjs` berde; `get_advisors` malinis; trigger error ay hindi nakakapigil ng save (PGlite) |
| 2 | Web deploy, switch **OFF**: lahat ng Parcel Scan ay **nakakabasa** na ng bagong code; walang nagpi-print nito | Wala pang nakikitang pagbabago; lumang sticker = gaya ngayon | Test na "switch off = gaya ngayon" (payload ng save, DOM, print hashes) |
| 3 | Feature key para kay Jeff + googletest: nagpi-print ng code | 2 account | Totoong papel: bawat laki × printer; scan sa iPhone at Android; checklist §11.4 |
| 4 | Ilang piling seller (feature key) — ilang araw | piling seller | Walang maling napunan; bilang ng A/C/E/F sa PostHog |
| 5 | `buyer_qr_id_enabled = 'true'` (lahat ng may sticker QR na naka-ON) | lahat | — |

Bakit Phase 2 muna bago Phase 3: para kapag may unang code sticker na lumabas, **lahat** ng device na na-refresh
ay marunong nang bumasa nito. Ang device na may lumang bundle ay "No QR found" lang (hindi maling punô).

**Rollback** (bawat isa ay hiwalay):
- Switch OFF → balik agad sa username QR ang mga bagong sticker. Ang mga code sticker na nasa parcel na ay
  **nababasa pa rin** (hindi naka-gate ang pagbasa).
- Web: Vercel rollback → ang mga code sticker ay "No QR found" (encoder: Customers o type). Walang nasisirang data.
- Server: Render rollback → wala nang `buyerQr` → username QR ulit.
- SQL: rollback file (drop ng 2 trigger, RPC, 2 link table, 2 column). Ang Customers ay hindi nagalaw kailanman.

---

## 10. MGA BUTAS AT CONFLICT

Ayos = ang gagawin sa Hakbang 2. Walang "ligtas" dito hangga't walang test (§11).

### A. Conflict sa umiiral na feature
| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| A1 | **Mawawala ang "camera ng phone → TikTok profile ng buyer"** | Ang QR ngayon ay sadyang dalawa ang gamit (`tiktokHandle.ts:1-4`). ID code = hindi na link | **Desisyon ni Jeff (Tanong 1).** Mga opsyon doon. Hindi puwedeng pareho sa iisang QR nang hindi nilalabag ang "ID code lang" |
| A2 | Lumang bundle sa isang phone (hindi nag-full close) | Phone A (bago) nagpi-print ng code; Phone B (luma) nag-scan | Lumang parser ay tumatanggi [PATUNAY §3] → "No QR found", walang maling punô. Phase 2 bago Phase 3. Nakasulat sa seller note: full close-open |
| A3 | Magkaibang QR para sa iisang buyer sa iisang araw | Isang phone ay naka-ON ang feature, ang isa hindi (o hindi pa nag-load ang feature map → fail-closed) | Parehong nababasa (code → A/C; username → G). Ang order row ay nagtatala kung alin ang ginamit, kaya ang Reprint ay kapareho ng orihinal |
| A4 | QR toggle na naka-tali sa @username toggle | `stickerRaster.ts:1096`, `printing.ts:1330`: naka-off ang @username → walang QR, kahit wala nang username sa bagong QR | **Hindi babaguhin** sa feature na ito (para walang gumagalaw na layout). Tanong 7 kung gusto ni Jeff na ihiwalay |
| A5 | 賣貨便 col J / Pickup Status / Buyer Alert / Chrome extension | Lahat ay gumagamit ng username sa `notes` / `buyer_username` | Hindi ginagalaw: ang napupunong contact ay username pa rin; ang code ay nasa hiwalay na column na walang ibang bumabasa |
| A6 | Facebook receipt / Shopee na gumagamit ng `platform_meta` | Baka akalain ng ibang code na "may `platform_meta` = Facebook" | [PATUNAY na dalawa lang ang bumabasa sa app: `useOrders.ts:94`, `db.ts:212`; sa server: `fbReceipt.js:62-95`, `shopeeComment.js`, `shopeeLive.js` — **HINDI PA NAPAPATUNAYAN** na lahat ng iyon ay naka-filter sa platform; susuriin isa-isa sa Hakbang 2 + test na ang TikTok row na may `{bq}` ay hindi napupulot ng FB/Shopee code] |

### B. Maling tao / maling address (pinakamabigat)
| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| B1 | **Code ni Buyer A + details ni Buyer B ang na-save** → sa susunod, ang sticker ni A ay pupunuin ng address ni B | Nag-scan ng sticker ni A, tapos nag-type ng details ni B nang hindi nag-clear | Chip na "QR: @username ✕" laging kita habang may kabit; confirm kapag pinalitan ang naka-type; Clear/Cancel/Save ay nagre-reset; sa A/C laging nakasulat kung kaninong @username ang QR. **Hindi ito lubusang maaalis** — umaasa sa double-check ng encoder (rule 4). Dagdag: kapag ang na-save na phone **at** pangalan ay parehong iba sa dating kabit, magtatanong ("Bagong details para kay @x?") bago mag-Save |
| B2 | Na-reuse ang username ng ibang tao (binitawan ng una, kinuha ng iba) | Bagong tao, lumang username → C: napunan ang details ng **dating** may-ari | Dilaw + "pakisuri" (hindi berde) sa lahat ng tugmang username lang; ipinapakita ang petsa ng huling gamit ng details. Ganito na rin ang panganib ngayon kapag naghanap sa Customers gamit ang username |
| B3 | Iisang username, maraming row sa Customers (1,572 kaso; hanggang 26) | Bumibili para sa kapamilya, nagpalit ng phone, typo sa pangalan | D: chooser, hindi kusang pumipili. Pagkatapos ng unang Save, tiyak na (A) |
| B4 | Iisang TikTok account na bumibili para sa dalawang tao | Parehong code, magkaibang tumatanggap | "Huling na-save" ang lalabas (rule 4); in-edit ng encoder → lilipat ang kabit. **Limitasyon:** isang code = isang "huling tumatanggap" bawat carrier. Tanong 5 kung kailangan ng listahan ng mga tumatanggap |
| B5 | In-edit ang **lumang** naka-save na parcel ng buyer pagkatapos ng mas bagong parcel | Ang trigger ay tumatakbo rin sa UPDATE → babalik ang kabit sa lumang details | Ang trigger ay magkakabit sa UPDATE **lang** kapag ang in-edit na parcel ang pinakabagong parcel ng code na iyon (o kapag binago mismo ang `buyer_qr_id`); kung hindi, walang galaw. Test sa PGlite |
| B6 | Store na sarado/nagbago na mula noong huling gamit | Kusang napupunan ang lumang store | Ang bawat bagong parcel ay dumadaan pa rin sa store check (para sa mga may checker). Para sa lahat: banner na may "huling gamit: petsa"; kapag lampas 90 araw → dilaw. [HINDI PA NAPAPATUNAYAN kung ilang seller ang walang store check — bibilangin sa Hakbang 2] |
| B7 | Phone na "restricted" sa 7-11 | Binubura ng umiiral na trigger ang buyer sa Customers | Nabubura rin ang kabit (CASCADE) → susunod na scan = E. Test sa PGlite |
| B8 | Dalawang encoder na sabay nag-save ng parehong buyer na magkaibang details | Dalawang phone | Huling Save ang panalo (isang `upsert`). Walang sira; ganyan din ang Customers ngayon |

### C. Printing at QR
| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| C1 | May print path na nakalimutan (aral ng Nov 6) | ~15 path, kanya-kanyang code | Iisang helper `stickerQrText`; listahan ng lahat ng lugar mula sa printer-guardian (§8); test na walang ibang tumatawag sa `tiktokProfileUrl` para sa QR |
| C2 | Iba ang QR sa Reprint kaysa orihinal | Reprint galing sa order row na walang code | Code ay naka-save sa order row (`platform_meta.bq`); Reprint = row. Lumang row (walang code) = username QR, gaya ng orihinal nito |
| C3 | Hindi ma-scan sa papel ang bagong QR | Ibang laki para sa maikli/mahabang username; thermal na malabo | Parehong 29 modules gaya ng karamihan ngayon [PATUNAY]. **[HINDI PA NAPAPATUNAYAN sa papel]** — checklist §11.4 bawat laki × printer × phone |
| C4 | Preview ≠ print | Preview ay gumagamit ng sample username; print ay code | Kapag naka-ON, sample code ang gagamitin ng preview (parehong 29 modules). Test na pixel-equal |
| C5 | Nasira ang QR (punit/basa) | — | ECC "M" gaya ngayon; fallback: username na naka-print sa sticker + 📇 Customers. Walang dagdag na text sa label (hindi ginagalaw ang layout) |

### D. Data, server, database
| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| D1 | Walang `userId` sa ilang/lahat ng production comment | Iba ang totoong hugis ng data kaysa sa library | Phase 0 muna (bilang sa log). Walang `userId` → username QR (gaya ngayon). Kung mababa ang porsyento → **hinto**, balik kay Jeff |
| D2 | Nagbago ang code ng buyer balang-araw | Nagbago ang seller UUID (account na binura at ginawa ulit) o binago natin ang formula | UUID ay hindi nagbabago sa buhay ng account. Bagong formula = bagong prefix (`SFB2`), ang `SFB1` ay binabasa pa rin dahil naka-save ang code mismo (hindi kinukuwenta ulit sa scan) |
| D3 | Error sa bagong trigger → hindi makapag-save ng parcel | Bug sa trigger | Buong laman sa `EXCEPTION WHEN OTHERS`; PGlite test na sinasadyang magka-error ang trigger at naka-save pa rin ang parcel; `lock_timeout` sa migration |
| D4 | Na-save ang parcel pero hindi nakabit | Trigger error, o ang Customers row ay hindi nagawa (store/phone rule) | Walang sira: susunod na scan = C o E. Makikita sa bilang ng A vs C/E |
| D5 | Pekeng kabit mula sa browser | May nag-`INSERT` nang diretso | Walang `INSERT`/`UPDATE` policy sa link tables; trigger lang (SECURITY DEFINER). Ang `buyer_qr_id` sa sariling parcel ay sariling data lang ang naaapektuhan. Test: diretsong insert bilang user = tinanggihan |
| D6 | Admin na nakakakita ng data ng iba | RLS na "own OR admin" sa ibang table | Lookup RPC ay may tahasang `user_id = auth.uid()` sa **bawat** query; SQL contract test |
| D7 | Bagal ng lookup sa order rows | Walang index sa `platform_meta->>'bq'`; pinakamabigat na seller = 9,290 rows [Q5] | Naka-filter sa `user_id` (may index). **[HINDI PA NAPAPATUNAYAN ang bilis]** — `EXPLAIN ANALYZE` sa Hakbang 2; kung > 50 ms, partial index na ginawa `CONCURRENTLY` |
| D8 | Dagdag na bigat sa server/egress | +~40 bytes bawat comment; isang HMAC bawat comment | Maliit kumpara sa avatar URL na nasa payload na. Zero bagong poll; isang RPC bawat scan (kilos ng user) |
| D9 | Sacred zone: comment relay | Dagdag na field sa `server.js` chat handler | Additive lang, sa loob ng `try` na hindi nakakaapekto sa relay kapag pumalya (`buyerQr` = wala); sariling audit bago merge; Render deploy sa tahimik na oras |
| D10 | Account delete | Bagong table | `ON DELETE CASCADE` sa `auth.users` at sa Customers row. Idadagdag sa bilang ng ulat ng `admin-delete-user` kung gusto (opsyonal — ang mga parcel table ay wala rin doon ngayon, `index.ts:60-64`) |
| D11 | Privacy policy | Bagong klase ng data? | Code lang ang iniimbak (hindi TikTok ID). Tanong 8 kung kailangang banggitin sa Privacy Policy |

### E. Paggamit
| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| E1 | Encoder ay nasanay na "berde = tama" at hindi na nagsusuri | — | Presyo ay laging blangko (kailangang tumingin); dilaw para sa lahat ng hindi tiyak; help guide |
| E2 | Draft ng manual entry (lumilipat sa 7-11 ⇄ 全家) | Ang naka-type ay naiiwan; ang kabit ng QR? | Ang kabit ay kasama sa draft ng **parehong** carrier lang; hindi tumatawid sa kabila (iba ang store) |
| E3 | Scan QR habang nag-e-edit ng naka-save na parcel | — | Pinapayagan: ikinakabit ang code sa parcel na iyon (UPDATE). Sakop ng B5 |
| E4 | Seller na walang Parcel Scan (Basic/Free) | Nagpi-print ng code pero walang gagamit | Walang problema; kung mag-upgrade balang-araw, gumagana na ang mga sticker |
| E5 | Sa labas ng Taiwan | Sticker QR at Parcel Scan ay TW lang | Walang pagbabago sa market gate |

---

## 11. Listahan ng test (bawat rule ni Jeff ay may patunay)

### 11.1 Rule → test
| Rule ni Jeff | Test na magpapatunay |
|---|---|
| 1. Iisang permanenteng QR; TikTok lang | `buyerQr.server.test`: parehong (seller, userId) → parehong text sa 1,000 ulit; ibang username/pangalan/oras → pareho pa rin. `stickerQrText.test`: Facebook/Shopee/Instagram → walang code. Print test: dalawang order ng parehong buyer na magkaibang username → **parehong QR matrix** |
| 2. Unang beses: i-type isang beses | Screen test (7-11 + FM): scan ng di-kilalang code → E; i-type; Save → payload ay may `buyer_qr_id`. PGlite: may kabit pagkatapos |
| 3. Susunod: kusang napupunan; hiwalay ang store | Screen test: scan → A, apat na field napunan, Amount blangko at naka-focus. PGlite: 7-11 kabit ay hindi nakikita sa FM lookup at baliktad; B kapag sa kabila lang |
| 4. Puwedeng i-edit; huling na-save ang lalabas | Screen: i-edit ang napunan → Save → lookup = bagong details. PGlite: B5 (lumang parcel na in-edit ay hindi umaagaw) |
| 5. Lumang sticker gumagana; dating buyers magkaka-QR | `parseBuyerQr.test`: URL at hubad na username → lumang landas (table ng 30+ halimbawa, kasama ang kasalukuyang mga test ng `handleFromQrPayload` na **hindi binabago**). Screen: G, H. PGlite: C → Save → A |
| 6. Privacy | `buyerQr.server.test`: ang text ay walang bahagi ng username/pangalan/userId; magkaibang seller → magkaibang ID at TAG. Screen: F walang napunan at **walang tawag sa database**. PGlite/RLS: user B ay hindi makabasa/makasulat ng link ni user A; lookup bilang admin ay sariling rows lang |

### 11.2 "Walang nagbago kapag OFF" (permanenteng test)
- Switch OFF + walang `buyerQr`: print hashes ng lahat ng path × laki = kapareho ng main (ang umiiral na capture script).
- Save payload ng 7-11 at FM ay **walang** `buyer_qr_id` key kapag walang na-scan na code.
- Order row `platform_meta` para sa TikTok = `null` kapag OFF (gaya ngayon).
- `handleFromQrPayload` tests: hindi ginalaw, berde.
- Lumang parser ay tumatanggi sa bagong code (naka-pin: `qrcheck` → vitest).

### 11.3 Iba pa
- Server: `node --check server.js`; `initialComments` tests (payload shape + bagong field); test na ang error sa pagkuwenta ay hindi pumipigil sa relay.
- Tangled zones: `commentKey`, dedup, order fan-out, reprint zero-write suites — **hindi binabago, berde**.
- SQL: trigger order (phonebook muna), B5, B7, D3, D5, D6, rollback, at "switch seed = false".
- i18n: 8 wika, walang blangko; 360/390/430 px walang putol o dagdag na linya sa header.
- `npm run typecheck`, `npm test`, `npm run build`, lint = parehong bilang sa main.

### 11.4 Sa totoong device (si Jeff; hindi kayang patunayan mula rito)
- Papel: 50×30, 50×40, 60×40, 70×50, 80×50, 80×60, 100×60 × AIMO D520 / XP-420B / Y41BT / Niimbot / laptop: lumalabas ang QR, ≥ 2 mm sa kanan, walang putol.
- Scan ng bawat isa sa iPhone (jsQR) at Android (BarcodeDetector): unang subok, malabong ilaw, bahagyang gusot.
- Camera ng phone sa bagong QR: ano ang ipinapakita (inaasahan: text lang, walang link). [HINDI PA NAPAPATUNAYAN]
- Reprint ng order = parehong QR. Dalawang phone ng iisang account = parehong QR sa parehong buyer.
- Buyer na nagpalit ng username (test account) → parehong QR.

---

## 12. Mga query na ginamit (read-only, project `sqeuyuktdpidmlfpqgoc`, 2026-11-11)

- **Q1** `information_schema.columns` ng `parcel_customers`, `fm_parcel_customers`, `customers`, `live_session_orders`, `parcel_scans`, `fm_parcel_scans`.
- **Q2** `pg_indexes` + `pg_policies` ng tatlong customers table; `information_schema.triggers` ng mga parcel table.
- **Q3** `pg_get_functiondef` ng `upsert_parcel_customer`, `upsert_fm_parcel_customer`, `fm_scan_allowed`.
- **Q4** Bilang: `parcel_customers` 56,011 rows / 73 sellers / 44,790 may notes / 39,332 hugis-username / 1,572 (seller, username) na > 1 row / pinakamalaki sa isang seller 7,643; `contact_platform`: NULL 55,691, facebook 311, other 8, whatsapp 1. `fm_parcel_customers` 665 rows / 26 sellers / 660 may username. `customers` 162,030 (TikTok 161,075).
- **Q5** `live_session_orders`: triggers = `trg_session_date_taipei` lang; 178,656 rows, pinakaluma 2026-10-03; pinakamarami sa isang seller 9,290; haba ng TikTok handle 1–6: 3,008 · 7–22: 172,885 · 23+: 458; walang blangko/"unknown" na handle; `platform_meta` keys = `commenter_id, live_video_id, page_id`. Laki ng mga grupo ng parehong username: 26, 18, 15, 10, 10, 9, 8, 8; 791 grupo ang magkakaibang phone.
- **Q6** Sellers na may parehong Customers: 26; buyers (parehong username) sa pareho: 54; magkaiba ang pangalan o phone: 10.
- **Q7** `cron.job` (job 1 = `purge_live_session_orders()`), at ang function body nito (10 araw **at** lampas sa huling 7 natapos na session).
- **Q8** `sha256(convert_to('sfb-tag:1111…','utf8'))` → `EE246` (= Node); FK delete rule ng apat na parcel table = CASCADE.

---

## 13. Self-audit: ano ang nakita ng mga hiwalay na reviewer at paano inayos

> Pupunan pagkatapos ng review (printer-guardian para sa printing; hiwalay na reviewer para sa buong plano).

---

## 14. MGA TANONG PARA KAY JEFF

1. **Camera ng phone → TikTok profile.** Ngayon, kapag itinutok ng staff ang camera sa QR, bumubukas ang TikTok
   profile ng buyer. Sa ID code, mawawala ito. Alin ang gusto mo?
   (a) Tanggapin: ang pagbukas ng profile ay sa loob na ng app (Parcel Scan pagka-scan, at Pickup Status).
   (b) Gawing link ang QR papunta sa sarili nating site (hal. `sellerflowlive.com/b/CODE`): ang naka-login na
   seller ay makikita ang buyer at ang "Open TikTok"; ang iba ay blangkong pahina lang. Mas mahaba ang text →
   mas malaking QR (33 modules) → kailangang subukan ulit sa lahat ng laki.
   (c) Manatili sa TikTok link (walang permanenteng ID sa QR) — salungat sa layunin.
2. Ginagamit pa ba talaga ng mga staff ang camera → TikTok profile ngayon? (Para malaman kung gaano kabigat ang Tanong 1.)
3. Sino ang unang susubok pagkatapos mo at ng googletest (Phase 4)?
4. Buyer na kilala sa 7-11 pero unang beses sa FamilyMart (o baliktad): pupunan ba ang pangalan at phone mula sa
   kabila (blangko ang store, "pakisuri")? O blangko lahat?
5. Iisang TikTok account na bumibili para sa dalawang tao: sapat na ba ang "huling na-save ang lalabas, i-edit kung
   iba"? O kailangan ng listahan ng mga tumatanggap ng buyer na iyon na mapagpipilian?
6. Kapag username lang ang tugma (hindi QR ID) at iisa lang ang nakita: kusang pupunan (dilaw, "pakisuri") gaya ng
   nasa plano — o ipakita muna bilang mungkahi na kailangang pindutin?
7. Ngayon, walang QR kapag naka-off ang "@username" sa sticker. Sa bagong QR (walang username sa loob), gusto mo
   bang manatili iyon, o ihiwalay?
8. Kailangan bang banggitin sa Privacy Policy na may "buyer code" na sa sticker? (Walang pangalan/phone/store sa QR.)
9. Kailangan mo ba ng paraan para mag-print ng QR ng dating buyer **nang walang bagong order** (hal. mula sa
   Customers)? Sa plano: hindi — kusa silang magkaka-QR sa susunod na order.
10. Ano ang gusto mong tawag sa mga salita sa screen (hal. "Nakilala sa QR", "Bagong buyer", "Sticker ng ibang
    shop")? Ang nasa mockup ay mungkahi lang.

---

## 15. Ano ang may patunay at ano ang HINDI PA

**May patunay (file:line / query / script):** laman ng QR ngayon; ginagawa ng Scan QR ngayon; istruktura at dami ng
Customers; walang TikTok `userId` sa app/database ngayon; may `userId` sa library; kasya ang 27-byte na code sa
29-module na QR at tinatanggihan ito ng lumang parser; deterministic at magkaiba bawat seller ang code; pareho ang
`sha256` ng database at Node; natitira ang order rows ng huling 7 session.

**HINDI PA NAPAPATUNAYAN (at paano):**
| Ano | Paano mapapatunayan |
|---|---|
| May `userId` ang totoong production comments, at stable ito | Phase 0 log + query pagkalipas ng ilang araw |
| Lahat ng print path ay nasakop; walang layout na nagbabago | Ulat ng printer-guardian (§8) + print-hash capture sa Hakbang 2 |
| Nababasa ang bagong QR sa totoong papel sa bawat laki/printer/phone | Checklist §11.4 (si Jeff) |
| Hindi kailangan ng bagong app build | Ulat ng printer-guardian + test sa device na may kasalukuyang build |
| Bilis ng lookup | `EXPLAIN ANALYZE` sa Hakbang 2 |
| Ang trigger ay hindi kailanman pumipigil sa save | PGlite script sa Hakbang 2 |
| Walang FB/Shopee code na naaapektuhan ng `platform_meta` sa TikTok rows | Pagbasa isa-isa + test sa Hakbang 2 |
| Ano ang ipinapakita ng camera ng iPhone/Android sa text na `SFB1-…` | Totoong device |
| Kung gumagana pa ang TikTok link gamit ang numeric ID (para sa opsyon na panatilihin ang camera → profile) | Hindi naabot mula rito (blocked ang network); totoong phone |
