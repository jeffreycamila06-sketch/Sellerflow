# Buyer QR ID — plano v4 (plano lang; walang binubuo)

Branch `claude/buyer-qr-id`. **Docs lang** — walang binago sa app code, server, SQL o printing. Lahat ng query sa database
ay read-only. Mga file: ang planong ito · `docs/plans/buyer-qr-id-proof/` (mga script at output ng sukat) ·
`docs/design/buyer-qr-id/` (mga mockup).

Tatak ng bawat pahayag: **[PATUNAY]** = may file:line / query / script output dito · **[HINDI PA NAPAPATUNAYAN]** =
disenyo o hinala pa lang, may nakasulat kung paano mapapatunayan. Walang "pasado" o "ligtas" na walang patunay.

**Ano ang bago sa v4:** ang mga sagot ni Jeff noong 2026-11-11 (§2), ang paghahambing ng sukat ng QR (§3), ang mga ayos
mula sa pangatlong audit (§13.3), at ang Phase 0 bilang hiwalay na unang release (§9).
**Tapat na paalala:** wala sa akin ang teksto ng pangatlong audit. Ang H1–H4, W2, N1, N2, N4 at S1–S6 ay inayos ayon sa
paglalarawan sa utos. Ang **W3, W4, W5, N3 at N5–N10 ay walang paglalarawan** — hindi ko alam kung ano ang mga iyon,
kaya **hindi ko masasabing naayos** (§13.3).

---

## 0. Buod

1. **QR = TikTok link + code sa dulo.** Hal. `HTTPS://TIKTOK.COM/@maria_live?b=3AHRZ6DMV2`. Ang camera ng phone ay
   inaasahang diretso pa rin sa TikTok profile; ang Scan QR ng app ang babasa ng code.
   [HINDI PA NAPAPATUNAYAN sa totoong phone at sa TikTok — §3.5.]
2. **Kasya sa 29 modules (v3) para sa LAHAT ng haba ng username (1–24)** kapag: malalaking titik ang
   `HTTPS://TIKTOK.COM/`, 10-character na code, at "pinakamalakas na ECC na kasya sa v3" — **ECC M para sa username
   hanggang 15 character (87.3% ng order), ECC L para sa 16–24 (12.7%)**. [PATUNAY: `qrsize.output.txt`.]
   Kapalit ng ECC L: mas mahina sa gasgas/malabong print (may simulation, §3.4) — kailangan ng paper test.
3. **Code lang para sa Taiwan + may Parcel Scan**, at kapag may code ang order. Lahat ng iba: QR **eksaktong gaya
   ngayon** (walang ginagalaw sa daan nila).
4. **Details:** bawat code ay may sariling "huling na-save" bawat carrier. 7-11 at FamilyMart ay **ganap na hiwalay**.
   Nabura ang buyer sa Customers → nabubura rin ang QR details niya.
5. **Tatlong klase ng resulta ng Scan QR:** berde (kilala sa code) · dilaw na may isang dahilan ("pakisuri") · maikling
   mensahe (username lang ang napunan, gaya ngayon).
6. **Phase 0 muna, hiwalay na release:** server lang, naka-OFF, bilang lang — para mapatunayan na may wastong TikTok ID
   ang totoong comments bago ang lahat ng iba (§9).
7. **Hindi pa handang i-build:** may mga tanong pa (§14) at maraming hindi pa napapatunayan (§15).

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
| 7-11 trigger: phone na "restricted" → **binubura** ang buyer sa Customers; hatol ng store na hindi valid → hindi isinusulat (**pero tingnan ang pagtutuwid sa §1.6**) | Query Q3 (function body) |
| Sariling data lang ang nakikita (RLS `user_id = auth.uid()`) | Query Q2 (policies) |
| Laman ngayon: 7-11 = 56,011 rows / 73 sellers (44,790 may contact; 39,332 hugis-username); FamilyMart = 665 rows / 26 sellers | Query Q4 |
| **1,572** (seller, username) ang may **higit sa isang** row sa Customers (hanggang 26 rows sa iisang username); 791 dito ay magkakaibang phone | Query Q4, Q5 |
| 54 buyer ang nasa parehong Customers (7-11 at FamilyMart) ng iisang seller; sa 44, pareho ang pangalan at phone; sa 10, magkaiba | Query Q6 |

### 1.4 Stable na TikTok buyer ID
| Pahayag | Patunay |
|---|---|
| Ang TikTok library (2.1.1-beta1) ay may field na `userId` at `secUid` sa comment (puwedeng `"0"`/blangko — §1.6) | `node_modules/tiktok-live-connector/dist/lib/_legacy/data-converter.js:123-128` |
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
| Ang session load ay hindi nagbabasa ng `platform_meta` (kailangang basahin ang code — `bq` lang — para sa Reprint, §7) | `adapters/useSessionWindow.ts:132`, `:183` |
| May built-in na `sha256()` ang database (walang kailangang extension); pareho ang sagot nito sa Node: tag ng test seller = `EE246` sa pareho | Query Q8 + `qrcheck.output.txt` |
| Lahat ng parcel table ay `ON DELETE CASCADE` sa account | Query Q8 |
| Preview/allowlist system: `feature_access_emails` + `my_feature_access()` + `app_settings` switch | `adapters/featureAccess.ts:11-23`; `adapters/featureSwitches.ts:21-28` |

### 1.6 Idinagdag / itinama matapos ang audit
| Pahayag | Patunay |
|---|---|
| **Itinama:** ang "store na hindi valid → hindi idinadagdag sa Customers" ay hindi buo. Sa unang save, wala pang hatol ang store, kaya **naidadagdag** ang buyer kasama ang store; kapag dumating ang hatol na mali, hindi na ito binabawi | `parcelScan.ts:474-487` (walang `store_check_status` sa insert); function body sa Q3 (Rule 1 ay `return` lang) |
| Ang phonebook trigger ng 7-11 ay tumatakbo rin kapag nagbago ang `store_check_status` / `phone_check_status` — kaya ang **late na hatol o edit sa lumang parcel** ay nagsusulat ulit ng details ng lumang parcel sa Customers (hal. bumabalik ang lumang store). Umiiral na ugali ito ngayon, hindi dala ng feature | Query Q10 (`pg_get_triggerdef`) |
| Ang seller UUID ay **hindi lihim**: nasa public na URL ng product pictures (`<UUID>/<id>.jpg`, public bucket) | `adapters/productImages.ts:15`, `:93`; Query Q11 (`product-images` public = true) |
| May **pangatlong daan** ng comment papunta sa order: Pin to print. Iba ang hugis: `chat.user.userId` (nakapaloob, hindi top-level) | `server/pinRelay.js:20-36`, `:42-61`; `server.js:1616-1622` |
| Ang "earlier comments" (initial batch) ay tumatanggap ng **email id** bilang `sellerId`, hindi UUID | `server.js:1711` |
| Ang `userId` sa library ay `string`; ang nawawalang numero ay puwedeng dumating bilang `"0"` o `""`, hindi `undefined` | `tiktok-schema.d.ts:1180`; `data-converter.js:126` |
| Lahat ng 61 seller na nag-save ng 7-11 parcel sa huling 30 araw ay may store check (`parcel_check_access` enabled); sa 16,126 parcel: valid 13,972 · wala pang hatol 2,117 · unknown 33 · not_found 4 | Query Q9. (Paalala: ang `parcel_check_access` ay para sa phone check ng extension; ang `store_check_status` ay isinusulat ng app para sa lahat) |
| Ang mga switch at feature map ay binabasa **isang beses bawat sign-in** (walang poll) | `adapters/featureSwitches.ts:1-3`; `adapters/featureAccess.ts:27-45` |
| Ang dalawang bumabasa ng `platform_meta` sa server ay parehong naka-filter sa `platform = 'Facebook'` | `server.js:2364-2368`, `:2468-2470` (nakita ng auditor). [HINDI PA NAPAPATUNAYAN: mga live na database function] |

---

## 2. Mga sagot ni Jeff (2026-11-11) at ang epekto sa disenyo

| # | Sagot | Epekto sa plano |
|---|---|---|
| 1 | QR = TikTok link + code sa dulo; camera → TikTok profile gaya ngayon; ang app ang babasa ng code | §3. Pinalitan ang "ID code lang" ng v3. Nasa QR na ang @username (gaya ngayon, at naka-print din sa sticker) |
| 2 | Isang login bawat seller | Tinanggal ang TAG ng shop at ang estado na "sticker ng ibang shop". Ang sticker na walang kilalang code ay gaya ng "walang details pa" |
| 3 | Code: Taiwan + may Parcel Scan lang; iba: QR eksaktong gaya ngayon; walang code ang order → QR gaya ngayon | §4.3 (gate sa server), §8 (byte-identical kapag walang code) |
| 4 | Simpleng key (seller UUID) | §3.3 |
| 5 | Contact: ang huling na-save ng encoder ang masusunod; mungkahi lang ang bago | §6.2 |
| 6 | Binura sa Customers → bura rin ang QR details; edit sa Customers ay hindi kusang dumadaloy | §5.1-4 |
| 7 | Unang susubok: si Jeff at ang team niya | §9.2 |

**Daloy na kinumpirma:** (a) buyer na wala pang details → Scan QR ay pinupunan ang @username (gaya ngayon); ita-type ang
pangalan/phone/store isang beses. (b) Buyer na may details → napupunan lahat, presyo na lang, puwedeng i-edit.
(c) Lumang sticker o walang code → @username gaya ngayon + hanap sa Customers sa username (dilaw "pakisuri").

---

## 3. Ang QR: paghahambing ng sukat at ang napiling format

Lahat ng numero rito ay galing sa `docs/plans/buyer-qr-id-proof/qrsize.cjs` → `qrsize.output.txt` — parehong library ng
app (`qrcode-generator`, pinakamaliit na version na kasya), tinimbang sa **totoong haba ng username** ng 177,581 TikTok
order rows (Query Q12). Standard QR lang ang tiningnan (walang Micro QR / Data Matrix / Aztec / rMQR).

### 3.1 Haba ng username sa live data [PATUNAY: Q12]
| Haba | 4–6 | 7–9 | 10–12 | 13–15 | 16–17 | 18–20 | 21–24 |
|---|---|---|---|---|---|---|---|
| Order rows | 3,029 | 52,154 | 63,740 | 36,080 | 15,327 | 5,565 | 1,686 |
| % | 1.7% | 29.4% | 35.9% | 20.3% | 8.6% | 3.1% | 0.9% |

Pinagsama: hanggang 13 char = 75.4% · hanggang 15 = 87.3% · hanggang 17 = 95.9% · hanggang 22 = 99.7%. Pinakamahaba: 24.
Walang malaking titik sa alinmang username; 1 row lang ang may character na wala sa `a–z 0–9 . _`.

### 3.2 Mga opsyon at sukat [PATUNAY: `qrsize.output.txt` §1–§2]
"v3 hanggang" = pinakamahabang username na 29 modules pa. "% sa v3" = bahagi ng order rows.

| Paraan ng pagsulat | Code | ECC M: v3 hanggang · % sa v3 | ECC L: v3 hanggang · % sa v3 |
|---|---|---|---|
| **Ngayon** (link lang) | — | 22 char · 99.7% | 24 · 100% |
| B. Lahat "byte" (`https://tiktok.com/@x?b=CODE`) | 10 | 9 · 31.1% | 20 · 99.1% |
| | 12 | 7 · 7.1% | 18 · 97.7% |
| C. Link na byte + code na **alphanumeric** (mixed-mode) | 10 | 11 · 56.5% | 22 · 99.7% |
| | 12 | 9 · 31.1% | 20 · 99.1% |
| **D. `HTTPS://TIKTOK.COM/` na alphanumeric + `@x?b=` na byte + code na alphanumeric** | 8 | 16 · 91.0% | 24 · 100% |
| | **10** | **15 · 87.3%** | **24 · 100%** |
| | 12 | 13 · 75.4% | 24 · 100% |
| | 13 | 13 · 75.4% | 24 · 100% |
| E. Gaya ng D, code na puro numero (numeric mode) | 15 digit | 15 · 87.3% | 24 · 100% |
| | 18 digit | 14 · 82.4% | 24 · 100% |
| G. Gaya ng D pero walang pangalan ng param (`?CODE`) | 10 | 17 · 95.9% | 24 · 100% |
| | 12 | 15 · 87.3% | 24 · 100% |

Mga nakita:
- **Ang simpleng pagdagdag ng code (B) ay hindi kasya** sa v3 sa ECC M para sa karamihan (31% lang).
- **Mixed-mode (C) lang ay kulang pa rin** sa ECC M (56.5%).
- **Malalaking titik sa `HTTPS://TIKTOK.COM/` (D)** ang pinakamalaking tipid: ang bahaging iyon ay nasusulat sa mas
  matipid na "alphanumeric" na paraan. Ang scheme at host ng URL ay hindi case-sensitive (pamantayan ng URL; ipinakita
  ng script na `host=tiktok.com` pa rin ang basa ng URL parser) — **pero hindi pa nasusubok sa totoong camera** (§3.5).
  Ang `@username` ay nananatiling maliliit na titik, hindi ginagalaw.
- Code na numero (E) ay **walang lamang** sa base32 (D) sa parehong lakas.
- Pag-alis ng `b=` (G) ay nagdaragdag ng 2 character ng username sa ECC M.

### 3.3 Ang napiling format, at bakit
```
HTTPS://TIKTOK.COM/@<username>?b=<CODE>        CODE = 10 character, Crockford base32 (0-9 A-Z maliban sa I L O U)
```
- **CODE** = unang 50 bits ng `HMAC-SHA256(key = seller UUID, "sfb1:" + TikTok userId)`. Key ayon sa sagot 4.
  Kinukuwenta sa server. Tinatanggap lang ang `userId` na `^[1-9]\d{5,24}$`; iba → walang code.
- **Laging version 3 (29 modules)** para sa sticker na may code, gamit ang **pinakamalakas na ECC na kasya**:
  **ECC M para sa username na 1–15 char (87.3%)**, **ECC L para sa 16–24 (12.7%)**.
  [PATUNAY: `qrsize.output.txt` §2. Kasya rin ang ECC Q sa 1–5 char (0.1%), pero hindi gagamitin — §8.2.] Bunga: **iisa ang laki ng QR sa lahat ng code sticker** — ang layout ay kapareho
  ng nakukuha ngayon ng username na 7–22 char.
- **Bakit 10 character (50 bits):** kasya sa ECC M hanggang 15 char. Posibilidad na magkapareho ang code ng dalawang
  buyer ng iisang seller: 8,000 buyers (pinakamalaking seller ngayon, Q12) → 1 sa 35 milyon; 100,000 → 1 sa 225,000
  [kuwenta: `qrsize.output.txt` §5]. At may **pangalawang bantay**: nasa QR din ang @username, at itinatala ang
  username ng sticker sa bawat save — kapag tumugma ang code pero **iba ang username sa huling na-save**, dilaw
  ("pakisuri") ang lalabas, hindi berde (§6.1). Ang 12 char ay magpapababa ng ECC M sa 75.4%; ang 8 char (40 bits) ay
  1 sa 220 sa 100,000 buyers — masyadong mataas.
- **Bakit may `b=`:** iyon ang hugis na sinabi ni Jeff (`?<param>=<code>`), at karaniwang hugis na tinatanggap ng
  lahat ng bumabasa ng URL. Ang walang pangalan (`?CODE`, opsyon G) ay magtataas ng ECC M sa 95.9% — **puwedeng
  piliin pagkatapos ng camera test kung pareho silang gumagana** (Tanong 2). Kapag napili at lumabas na ang unang
  sticker, **hindi na ito dapat baguhin**.
- **Kung may problema ang malalaking titik sa totoong phone** (fallback): opsyon C, code 10 — ECC M hanggang 11 char
  (56.5%), ECC L hanggang 22 (43.3%), at **v4 (33 modules) para sa 23–24 char (0.3%)**.

Mga kapalit (tapat):
| Pinili | Kapalit |
|---|---|
| ECC L para sa username na 16–24 char (12.7% ng order ng mga saklaw na seller) | Mas kaunting kayang itama: sa simulation (§3.4) pareho sila sa maliit na sira, pero sa mas malaki — hal. itim na mantsa na 8 modules: ECC M 61% nababasa, ECC L 3%. **Mas sensitibo sa gasgas, tupi at malabong thermal print.** Alternatibo para sa mga ito: v4 sa ECC M (mas malaking QR o mas maliit na tuldok) — §8 |
| Malalaking titik sa scheme/host | Hindi pa nasusubok sa camera ng iPhone/Android at sa TikTok app |
| Mixed-mode (3 segment) | Standard ito sa QR at nababasa ng `jsQR` [PATUNAY: `qrsize.output.txt` §3]; **hindi pa nasusubok** sa `BarcodeDetector` ng Android at sa camera ng iPhone |
| 50-bit na code | Hindi "imposible" ang banggaan — may pangalawang bantay (username) |
| Username na 1–6 char | Ngayon 25 modules; sa code sticker 29 — bahagyang mas malaking QR (§8) |
| Kailangang baguhin ang `src/lib/qr.ts` sa Hakbang 2 (segments + ECC + version) | Printing zone — printer-guardian at paper test |

### 3.4 Simulation ng sira: ECC M vs L sa v3 [PATUNAY bilang SIMULATION lang: `qrsize.output.txt` §4]
400 subok bawat hanay, `jsQR`, 4 px bawat module. **Hindi ito papel.** Kasama rito ang sira sa mga "mata" ng QR na hindi
kayang itama ng anumang ECC, kaya ang paghahambing lang ng M at L ang makabuluhan, hindi ang mismong porsyento.
| Sira | ECC M | ECC L |
|---|---|---|
| Puting guhit na 1 module ang lapad (patay na tuldok ng print head) | 81% | 70% |
| Puting guhit na 2 modules | 42% | 18% |
| Puting guhit na 3 modules | 25% | 0% |
| Itim na mantsa 4×4 modules | 76% | 76% |
| Itim na mantsa 6×6 | 71% | 58% |
| Itim na mantsa 8×8 | 61% | 3% |

### 3.5 TikTok at camera ng phone — [HINDI PA NAPAPATUNAYAN]
- Hindi ko naabot ang tiktok.com mula rito (naka-block ang network; `http=000` noong sinubukan). **Walang patunay** na
  hindi naaapektuhan ng dagdag na `?b=…` ang TikTok, sa browser man o sa app. Ang alam lang: karaniwang may sariling
  query param ang mga link ng TikTok, at ang hindi kilalang param ay karaniwang binabalewala ng mga website — **hinala, hindi patunay.**
- Walang patunay na ang camera ng iPhone at Android ay nagbubukas ng TikTok profile mula sa `HTTPS://TIKTOK.COM/@x?b=…`
  (malalaking titik, may query).
- **Paano mapapatunayan (si Jeff, bago ang anumang code na magpi-print nito):** apat na test QR sa papel o screen —
  (1) format D, (2) format G (walang `b=`), (3) format C (maliliit na titik), (4) ngayon — bawat isa: camera ng iPhone
  at Android → dapat TikTok profile, may TikTok app at wala (browser), at mula sa loob ng LINE scanner. Gagawa ako ng
  pahina ng mga test QR sa Hakbang 2 (o mas maaga kung gusto mo — hindi ito app code).

### 3.6 Pagbasa sa app
- Bago: `^https?://(www\.|m\.)?tiktok\.com/@<username>\?b=<10 char>$` (hindi case-sensitive ang scheme/host) → username + code.
- Hindi tumugma → ang lumang parser (`handleFromQrPayload`, hindi gagalawin) → username lang.
- **Lumang app sa phone na hindi pa nare-refresh:** ang lumang parser ay kumukuha ng username mula sa bagong QR
  [PATUNAY: `today'sParser→@maria_live` sa lahat ng format, `qrsize.output.txt` §3] → gumagana **gaya ngayon**
  (username lang). Walang "No QR found", walang maling punô.

---

## 4. Server (S6, W2): saan kinukuwenta ang code

### 4.1 Iisang lugar para sa comment: `emitCommentScoped`
[PATUNAY: lahat ng comment papunta sa app — live, "earlier comments", reuse re-emit — ay dumadaan sa
`emitCommentScoped(sellerId, …)` (`server.js:543-564`, komento sa `:545-546`), at ang `sellerId` doon ay ang **UUID**
(`server.js:553`, `sellerRoom(sellerId)`; `:502-503`).]
- Ang mga gumagawa ng payload (live relay `server.js:1785-1818`; `server/initialComments.js:63-87`) ay magdadala lang
  ng **hilaw na `userId`** sa isang pribadong field. **Hindi sila nagkukuwenta** — kaya walang paraan na magamit ang
  email (`server.js:1711`) bilang key.
- Sa `emitCommentScoped`: (1) kunin at **alisin** ang pribadong field; (2) sa `try/catch`: kuwentahin ang code mula sa
  `sellerId` (UUID) at `userId`; (3) kung pinapayagan ang seller (§4.3) → idagdag ang `buyerQr`; (4) ipadala.
  Ang ring ng reuse ay nag-iimbak ng payload na may hilaw na field (memory ng server lang), kaya ang reuse re-emit ay
  kinukuwenta at sinasala rin sa oras ng padala.
- **Ang hilaw na `userId` ay hindi kailanman lumalabas ng server** at hindi iniimbak. Test: walang pribadong field at
  walang `userId` sa anumang ipinapadala, sa lahat ng daan, kasama ang fallback na `io.to(room).emit` (`server.js:555`).

### 4.2 Pin to print: pangalawang lugar
Hiwalay ang padala ng Pin (`platform_pin`, `server.js:1616-1622`, `server/pinRelay.js:20-61`), at nakapaloob ang ID
(`chat.user.userId`). Parehong function ng kuwenta, parehong UUID `sellerId` (nasa saklaw na sa `:1617`).
[HINDI PA NAPAPATUNAYAN na may `userId` ang pin event — Phase 0.]

### 4.3 Sino ang pinapayagan (sagot 3) — disenyo, HINDI PA NAPAPATUNAYAN
Pinapayagan ang seller kapag **lahat** ng ito: Taiwan (`country` na `TW` o blangko) · may Parcel Scan (plan na
plus/pro/master, active, hindi expired, at naka-ON ang `parcel_manual_enabled`) o admin · **at** (naka-ON ang
`buyer_qr_id_enabled` **o** may feature key `buyer_qr_id` ang account).
- Isang SQL function ang magsasabi nito (kapareho ng hugis ng umiiral na `fm_scan_allowed`, Q3), tinatawag ng server
  gamit ang service role. May ganito nang basa sa server: feature key + email (`server.js:1087-1088`), switch na may
  60 s na cache (`:2559-2566`).
- **Cache bawat seller (~60 s), nire-refresh sa background; hindi hinihintay sa loob ng `emitCommentScoped`.** Habang
  wala pang sagot → walang code. Palya ng basa → walang code. (Tapat: posibleng ilang order sa simula ng live ay
  walang code; QR nila ay gaya ngayon — nababasa pa rin sa username.)
- 93 seller ang saklaw ngayon (TW + plus/pro/master na active) sa 150 na active na may bayad [Q13].
- Pagpatay: ~1 minuto, wala nang code ang **bagong** comment. Ang mga order na may code na ay code pa rin sa Reprint.

---

## 5. Database: ang details ng bawat code

### 5.1 Bagong SQL (Hakbang 2; susunod na libreng numero ay sql/149 — kumpirmahin noon)
1. **Mga column sa parcel** (nullable, walang default, walang `CHECK`): `parcel_scans.buyer_qr_id`,
   `parcel_scans.buyer_qr_handle`, at pareho sa `fm_parcel_scans`. `buyer_qr_id` = ang 10-char na code;
   `buyer_qr_handle` = ang @username na nasa sticker noong na-scan. Index `(user_id, buyer_qr_id)` kung may laman.
2. **Table `buyer_qr_details`** — isang row bawat (seller, code, carrier `'711'`|`'fm'`):
   `name, phone, store_id, contact, contact_platform, qr_handle, source_parcel_id, source_created_at, customer_id,
   cleared_at, updated_at`. `user_id → auth.users ON DELETE CASCADE`.
   **RLS: `SELECT` ng sariling row lang.** Walang `INSERT`, `UPDATE` o `DELETE` policy (H1, S2) — mga trigger lang ang nagsusulat.
3. **Trigger sa parcel** (bago at hiwalay; hindi ginagalaw ang mga phonebook trigger), `AFTER INSERT OR UPDATE OF
   <mga field ng buyer>, buyer_qr_id, buyer_qr_handle` at `AFTER DELETE`. Laging `NEW.user_id`/`OLD.user_id`.
   - **Save / edit:** isinusulat ang tala kapag (a) wala pang tala, o (b) ito mismo ang pinagmulang parcel
     (`source_parcel_id`), o (c) mas bago ang parcel kaysa sa pinagmulan (`created_at`). Sa UPDATE, gumagalaw lang kapag
     **may talagang nagbago** sa mga field na iyon. Kaya ang edit o hatol sa **lumang** parcel ay hindi umaagaw.
   - **H2 — inalis ang code sa pinagmulang parcel** (✕ sa edit) **o binura ang pinagmulang parcel na hindi pa
     na-export** → **nililinis ang tala** (details → blangko, `cleared_at`; nananatili ang `source_created_at` para
     hindi ito maibalik ng mas lumang parcel). **Hindi kasama:** "Clear exported" at ang 90-araw na purge — parehong
     nagbubura lang ng `status = 'exported'` (`parcelScan.ts:906`) — at ang pagbura ng isang na-export na parcel.
   - Maling hugis ng code → binabalewala (walang tala), naka-save pa rin ang parcel. Buong laman sa
     `BEGIN … EXCEPTION WHEN OTHERS`, may maikling `lock_timeout`. Tapat na limitasyon: hindi nasasalo ng `WHEN OTHERS`
     ang pagkansela ng statement (timeout). [HINDI PA NAPAPATUNAYAN — PGlite sa Hakbang 2.]
4. **Trigger sa Customers** (`parcel_customers`, `fm_parcel_customers`) `AFTER DELETE` (S5, sagot 6): nililinis ang
   mga tala ng parehong carrier na tumuturo sa nabura (`customer_id`, o parehong phone + pangalan). Sakop din nito ang
   umiiral na rule na "restricted na phone → burahin sa Customers" (Q3) — iisang mekanismo. **Edit sa Customers ay
   walang epekto** sa tala (sagot 6).
5. **RPC `buyer_qr_lookup(p_code, p_handle, p_carrier) → jsonb`** — `SECURITY INVOKER`, tahasang
   `user_id = auth.uid()` sa bawat query. Isang tawag bawat scan. Ibinabalik:
   - ang tala ng code sa carrier na ito (kung meron at hindi nilinis), ang petsa ng huling gamit, at ang `qr_handle`;
   - **H3:** ang huling 5 parcel ng code sa carrier na ito (pangalan, phone, store, petsa);
   - kung walang tala: mga row sa Customers ng carrier na ito na tugma sa username (hanggang 5, pinakabago muna).
6. Mga switch (seed `'false'`): `buyer_qr_id_enabled` (server) at `buyer_qr_scan_enabled` (app — **switch o feature
   key**). Feature key `buyer_qr_id` sa `my_feature_access()` (mula sa LIVE na definition sa oras ng apply).

### 5.2 Mga tuntunin
- **"Huling na-save ang masusunod"** (sagot 5, rule 4): ang tala ay eksaktong ang huling parcel na na-save na may code
  na iyon — pangalan, phone, store, contact at platform gaya ng inilagay ng encoder.
- **S4 — ganap na hiwalay ang 7-11 at FamilyMart.** Walang kinokopya mula sa kabila. Buyer na kilala sa 7-11 pero
  unang beses sa FamilyMart = "wala pang details" sa FamilyMart (username lang; o dilaw kung may tugma sa Customers ng FamilyMart).
- **Tapat na kapalit:** dalawang lugar ang may details (Customers at ang tala ng QR). Sagot 6 ang nagtatakda ng
  ugnayan nila: bura = bura; edit = hindi dumadaloy.
- **Ang "nililinis" ay hindi literal na pagbura ng row:** inaalis ang pangalan, phone, store at contact; ang natitira
  ay ang code at mga petsa. Kailangan ito para hindi maibalik ng lumang parcel ang binurang details.
- Account delete → CASCADE.

---

## 6. Scan QR: tatlong klase ng resulta (S1)

### 6.1 Ano ang lalabas
| Resulta | Kailan | Ano ang napupunan |
|---|---|---|
| **BERDE** "Kilala sa QR · huling ginamit: ‹petsa›" | May code, may tala, iisa ang phone at store sa huling 5 parcel, at tugma ang username ng sticker sa huling na-save | Pangalan, phone, store, contact + platform (gaya ng huling na-save). Cursor sa **Amount** |
| **DILAW** — isang dahilan lang ang ipinapakita, laging may "huling ginamit: ‹petsa›" | | Napupunan ang meron; **pakisuri** |
| · "Gumamit ng 2 store — pakisuri" (o 2 phone) (H3) | May tala, pero higit sa isang phone o store sa huling 5 parcel | Pagpipilian; **pinakabago ang naka-pili**; ang pindot sa iba ay pumupuno ng iyon |
| · "Iba ang username sa sticker — pakisuri" (N1) | Tugma ang code pero iba ang username ng sticker sa huling na-save (nagpalit ng username, **o ibang tao**) | Details ng tala + mungkahi "Gamitin ang @bago" kung TikTok ang naka-save na contact |
| · "Nahanap sa username — pakisuri" | Walang code (lumang sticker / hindi saklaw) **o** may code pero wala pang tala, at may tugma sa Customers ng carrier na ito | Mula sa Customers. Higit sa isa ang tugma (1,572 ganitong username ngayon, Q4) → pagpipilian, pinakabago ang naka-pili |
| · "Mali ang store noong huli — i-type ang store" | Ang pinagmulang parcel ay may hatol na hindi valid ang store | Lahat maliban sa store |
| **MAIKLING MENSAHE** (walang kahon) | | |
| · "Napunan ang @username — i-type ang details" | Walang tala, walang tugma sa Customers | @username lang — **gaya ngayon** |
| · mensahe ngayon ("No QR found…") | Hindi nabasa / hindi QR ng TikTok | Wala — gaya ngayon |
| · "Hindi na-check ang details ngayon" | Hindi sumagot ang database (signal, error, wala pa ang RPC) | @username lang — gaya ngayon |

Kapag higit sa isang dahilan ng dilaw ang totoo, ang una sa listahan ang ipinapakita.
**N1 — username na ginamit na ng ibang tao:** bagong tao na kumuha ng lumang username → ibang code → walang tala →
"Nahanap sa username — pakisuri" (dilaw, may petsa ng huling gamit) — hindi kailanman berde. Kapag na-save ng encoder
ang tamang details, ang code ng bagong tao ay may sarili nang tala.

### 6.2 Mga tuntunin
- **Laging puwedeng i-edit** ang lahat bago mag-Save. Presyo ang natitirang ita-type.
- **Contact (sagot 5):** ang huling na-save ng encoder ang ipinupuno, kasama ang platform (LINE/WhatsApp/TikTok).
  Hindi kailanman kusang pinapalitan. Kung walang tala: @username ng sticker, TikTok (gaya ngayon).
- **Ang nag-aayos ng mali (H1):** "huling na-save ang masusunod" + bago mag-Save na may code, kung may tala at
  **parehong iba** ang phone at pangalan → tanong: **"Papalitan ang details ni @x?"**. Walang "Hindi ito ang buyer".
- **Chip "QR: @username ✕"** habang may code ang entry. ✕ = alisin ang code sa entry na ito (hindi binubura ang mga field).
  Sa edit ng naka-save na parcel: binabasa ang code ng **parcel na iyon lang**; ✕ → inaalis ang code sa parcel (H2).
  Scan QR habang nag-e-edit: @username lang, gaya ngayon — walang ikinakabit.
- **Walang maling kabit dahil sa timing:** naka-block ang Save habang may lookup; bawat lookup ay may token at ang
  huling dumating na sagot ay itinatapon; ang code ay kinukuha **sa mismong pindot ng Save** (bago ang anumang
  `await`); nabubura ang code sa Clear, Cancel, matagumpay na Save, susunod na file ng batch, at matagumpay na Import.
- **N2 — ⇄ (7-11 ⇄ 全家):** ang draft ng naka-type na entry ay **dala ang code nito** pagbalik sa **parehong** carrier
  (form at code ay sabay na iniimbak at ibinabalik, `parcelDrafts.ts`). **Hindi kailanman tumatawid** ang code o ang
  napunong details sa kabilang carrier (S4). Ang "hold" bago mag-save (`parcelDrafts.ts:43`) ay nag-aalis ng form **at** code.
- **📇 Customers habang may chip:** ang Import mula sa form na may code ay dala ang code; pagkatapos, nililinis ang form
  at chip. Ang Customers na binuksan mula sa Settings ay hindi kailanman nagpapadala ng code. (Disenyo — wala pang ganitong prop.)
- **S3:** walang sample code sa preview at test print; ang test sticker ay QR gaya ngayon.
- Naka-OFF ang `buyer_qr_scan_enabled` at walang feature key → Scan QR **eksaktong gaya ngayon** (username lang; walang
  tawag sa database; walang `buyer_qr_id` sa save).
- Dry/Frozen, mga check ng store/phone, batch cap, export, 賣貨便 col J, Pickup Status — **walang pagbabago**.

---

## 7. Mga file na gagalawin sa Hakbang 2 (listahan lang)

**Phase 0 (server lang):** BAGO `server/buyerQr.js` (puro, may vitest) · `server.js` `emitCommentScoped` (`:543`) at ang
Pin emit (`:1616`) · isang field sa live relay (`:1785`) at sa `server/initialComments.js:63` · `server/pinRelay.js:20`.

**Pagkatapos ng Phase 0:**
- Database: `sql/149_buyer_qr_id.sql` + rollback (iniiwan ang mga column) + `scripts/sql149-behaviour.mjs` (PGlite).
- `src/lib/buyerQr.ts` (BAGO): `parseBuyerQr`, `stickerQrMatrix(handle, code)`; `src/lib/qr.ts` (segments, ECC, version — §8).
- Daan ng code: `data.ts`, `useLiveFeed.ts` (comment + Pin), `pinToPrint.ts:61-76`, `useOrders.ts:225` at `:68-96`
  (`platform_meta.bq`), `useSessionWindow.ts:132/:183` (`bq` lang ang pipiliin), `lib/orderLogic.ts:66-82` + rebuild,
  `reprint.ts:36-47`, `ordersSearch.ts:44-66`, `pastSessions.ts`, `raffle.ts:99-110`, `Print.tsx`.
- Printing: ang 4 na lugar ng QR at mga gate (§8.1).
- Parcel Scan: `parcelScan.ts`, `fmScan.ts`, BAGO `buyerQrLookup.ts`, `parcelDrafts.ts`, `ParcelScan.tsx`,
  `FmParcelScan.tsx`, `CustomerDetails.tsx`, `FmCustomerDetails.tsx`. i18n × 8 wika.
- `featureAccess.ts`, `featureSwitches.ts`, `scripts/printing-paths.mjs`.
- Docs: `PRINTING_MAP.md`, `docs/support/sfl-guide.md` + `sql/116b`.


---

## 8. Printing (sinuri ng printer-guardian, ikalawang ikot — bagong format)

Hatol: **"GAPS FOUND (6)"** — *ligtas ang laki at layout sa sukat; ang mga kulang ay sa paghawak ng palya ng helper at sa
mga bagay na papel at phone lang ang makakapagpatunay.* Mga sukat niya: `docs/plans/buyer-qr-id-proof/guardian2-*.txt`
(sukat ng layout sa computer, **hindi papel**).

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

### 8.2 Ang babaguhin sa `src/lib/qr.ts` at ang iisang helper [PATUNAY: `guardian2-library-checks.txt`; `qrcode.js:386-411`]
- **Hindi gagalawin ang `qrMatrix(text, ecc)`** (`qr.ts:12-29`). Dagdag na function para sa mga segment na may takdang
  version. Suportado ng naka-pin na library (1.5.2) ang maraming segment at ang mga mode; iisang file ito na kasama na
  sa bundle → walang dagdag na laki. Sukat: ~1.3–1.7 ms bawat QR, synchronous → hindi apektado ang 35 s watchdog at
  ang 8 s na hintay ng font.
- **Ang tawag ngayon ay byte-identical:** 30 sa 30 na haba ng link, parehong matrix.
- **Dalawang tahimik na palya na dapat isara** (parehong nagiging "walang QR" ngayon dahil sa `catch` sa `qr.ts:28`):
  takdang v3 na hindi kasya (hal. v3-M na may 16-char na username; v3-L na may 27-char), at titik na bawal sa
  alphanumeric (maliit na titik, `_`, `?`).
- **`stickerQrMatrix(handle, code)` — iisang may-ari ng text, segment, ECC at version:**
  walang code, o code na hindi eksaktong 10 Crockford na malalaking titik → `qrMatrix(tiktokProfileUrl(handle), "M")`,
  **eksaktong ngayon**; may wastong code → v3, subukan ang M, saka L; **hindi kasya ang dalawa → balik sa link lang
  (QR ngayon), hindi kailanman "walang QR"**.
- Bawat lugar ay magpapasa ng **sarili nitong handle string** gaya ngayon (magkaiba ang paglilinis:
  `stickerRaster.ts:1097`, `:1371`, `printing.ts:1261`, `oneSticker.ts:294`) — kung hindi, gagalaw ang print ng walang code.
- **Pagbabago mula sa §3.3:** ECC **M para sa 1–15**, hindi Q para sa 1–5 (payo ng guardian: wala pang 2% ng order ang
  makikinabang, at dagdag na pangatlong uri na susubukin). L para sa 16–24.

### 8.3 Layout — laging 29 modules ang code sticker [PATUNAY bilang sukat ng guardian]
| Sukat | Resulta |
|---|---|
| Bagong sticker, username 7/10/15/16/22: 7 laki × D520, XP-420B, Flash, Niimbot, laptop × Buyer # 1×/1.5×/2× | parehong layout sa link ngayon: 480 / 480 |
| Sticker ngayon, parehong username: 6 laki × D520, generic, Niimbot × compact v2 on/off × maikli/mahabang comment | parehong kahon ng QR at parehong text: 180 / 180 |
| ECC L vs M vs ngayon | magkapareho: 192 / 192 (bago), 72 / 72 (ngayon) |
| Na-decode ang naka-print na QR (`jsQR` sa larawan) → link + code; ang parser ngayon → username | 531 / 531 (bago), 374 / 374 (ngayon) |
| Pinakamaliit na agwat ng QR sa kanang gilid ng label (bagong sticker) | 16 dots = 2 mm (Niimbot 20) |
| Bagong sticker 45×30 na pinilit ang QR | walang QR |
| D520 60×40 na walang compact v2 | walang QR, gaya ngayon |

**Ang nagbabago, para lang sa code sticker:**
| Path at laki | Username 1–6 (ngayon v2 → v3) — 1.7% | Username 23–24 (ngayon v4 → v3) — 0.3% |
|---|---|---|
| Sticker ngayon 70×50, 80×50, 80×60, 100×60 | 4 dots; QR 12.5 → 14.5 mm, 2 mm mas kaliwa at taas | 16.5 → 14.5 mm |
| Sticker ngayon 50×30 at font-C 60×40 | 5 dots; 15.6 → 18.1 mm; **lumilipat ang text** sa D520 50×30 at sa mahabang comment | 20.6 → 18.1 mm |
| Laptop (pahina ngayon) | 16.5 → 18.5 mm | 20.5 → 18.5 mm |
| Bagong sticker, Buyer # 1× | 6 dots, 18.8 → 21.8 mm; **50×40: 5 → 4 dots; Niimbot 50×30: 6 → 5** | 6 dots, 21.8 mm |
| Bagong sticker, Buyer # 1.5× / 2× | Buyer # 4–5 dots na mas maliit | Buyer # 4–5 dots na mas malaki |

### 8.4 Username na 16–24: v3 sa ECC L, o v4 sa ECC M? [PATUNAY bilang sukat; HINDI PA sa papel]
| Printer at laki | v3-L | v4-M |
|---|---|---|
| Bagong sticker 50×30 — D520 / XP-420B / Flash / laptop | 6 dots, 21.8 mm | **5 dots**, 20.6 mm, nagbabago ang text |
| Bagong sticker 50×30 — Niimbot | 5 dots, 18.1 mm | 5 dots, 20.6 mm, nagbabago ang text |
| Bagong sticker 50×40 — lahat | 4 dots, 14.5 mm | 4 dots, 16.5 mm, nagbabago ang text |
| Bagong sticker 60×40 — Niimbot | 6 dots, 21.8 mm | **5 dots**, 20.6 mm |
| Bagong sticker 60×40 / 70×50 / 80×60 — iba | 6 dots, 21.8 mm | 6 dots, 24.8 mm, nagbabago ang text |
| Sticker ngayon 50×30 at font-C 60×40 | 5 dots, 18.1 mm | 5 dots, 20.6 mm; lumilipat ang text |
| Sticker ngayon 70×50 … 100×60 | 4 dots, 14.5 mm | 4 dots, 16.5 mm |

Ang v4 ay nagbago ng text o Buyer # sa 252 sa 288 na kaso ng bagong sticker at 41 sa 108 ng sticker ngayon.
**Payo ng guardian at ng plano: v3-L** — iyon ang laki at layout na nakukuha na ngayon ng mga buyer na iyon (16–22 char
ay v3 ngayon); ang v4 ay maglilipat ng 12.7% ng code sticker sa laking 0.3% lang ang gumagamit ngayon; at ang
"Everything fits" ng Live print pattern ay walang v4 sa pinakamasamang kaso nito (`oneSticker.ts:523-532`).
**Ang kapalit ay ang mas mahinang ECC — papel ang magpapasya** (§8.7): pareho silang ipi-print at ii-scan.

### 8.5 Kailan lumalabas ang QR ngayon (N4) [PATUNAY: file:line ng guardian]
| Path | Mga gate | Sumusunod sa @username? |
|---|---|---|
| Sticker ngayon (fixed-cell, 50×30) | taas > 40 mm o 50×30 (`stickerRaster.ts:1094`); "Print QR" ng device + Taiwan + hindi Facebook/Instagram/Shopee (`printing.ts:135-142`, `:515`); may username | **Oo** (`stickerRaster.ts:1096`) |
| Font C (generic 50×30/60×40, Niimbot, compact v2) | parehong mga flag (`:1369-1372`); dapat kasya sa taas | **Oo** (`:1370`) |
| Laptop (pahina ngayon) | "Print QR" + Taiwan, platform, may username (`printing.ts:1330`) | **Oo** |
| **Bagong sticker** (lahat ng printer + laptop) | sariling "Print QR" na setting, label ≥ 50×30, platform, may username (`oneSticker.ts:295`) | **Hindi** — sinukat: naka-off ang @username, naka-on ang QR → lumalabas pa rin ang QR |

Hindi nagbabago ang alinman dito. Ang code ay nakasakay lang sa QR na **lalabas na sana**. (Tanong 3.)

### 8.6 Iba pa
- **Bagong app build: hindi kailangan** ayon sa code — lahat ng QR ay iginuguhit sa TypeScript at ipinapadala bilang
  larawan. [HINDI PA NAPAPATUNAYAN sa device.]
- **Walang QR at hindi apektado:** text sticker, iOS WiFi sticker, slip, D520 60×40 na walang compact v2, bagong sticker
  na mas maliit sa 50×30, Facebook/Instagram/Shopee.
- **Ang code ay hindi pumapasok sa JSON na ipinapadala sa native** (text sticker, WiFi sticker, slip): ihihiwalay sa
  itaas ng `printSlip`; bagong test na byte-identical ang mga argument.
- **Lumang app sa isang phone:** ang Scan QR nito ay nakakabasa ng username sa bagong QR. Kapag ito ang **nag-print**
  ng order na may code → QR ngayon (link lang). Kaya posibleng dalawang phone ay magkaibang QR sa iisang buyer —
  parehong nababasa.
- **Preview at test print (S3):** walang sample code. Ang sample na username (`maria_live`, `sellerflow`) ay 29 modules
  din → tapat pa rin ang laki at puwesto. Lima sa 11 admin language sample ay 25 modules (≤ 6 char) — admin lang ang
  nakakakita; iiwan at isusulat sa `PRINTING_MAP.md`. **Ang test print ay walang code** — ang paper test ay dapat
  totoong order.
- **Pupunta sa TikTok ang code** bilang bahagi ng link kapag binuksan ng camera. Hindi ito mababasa pabalik sa
  pangalan/phone/store, pero **makikita ng TikTok** ang code kasama ng username.
- Mga test na **hindi dapat gumalaw** para sa order na walang code: `qr.test.ts`, `stickerRasterPropGoldens.json`,
  `fixtures/*.json`, `v2TestSticker.golden`, `stickerSpacing.offPins`, mga golden ng `escposRaster`/`cpclRaster`,
  `oneSticker.switches`/`onePlace`/`parity`, `printing.test.ts`, `tspl.test.ts` at ang mga native golden. Ang parser
  ngayon ay tumatanggap na ng malalaking titik at query (`tiktokHandle.test.ts:38-41`).
- `scripts/printing-paths.mjs:3-15` ay hindi naglilista ng `src/lib/qr.ts` at `src/lib/tiktokHandle.ts` → idadagdag,
  kasama ang bagong helper. `PRINTING_MAP.md` ia-update sa parehong branch.
- Mga daan ng code na dapat sakupin (unang ikot ng guardian): 3 ruta ng Reprint, Pin to print, raffle, Print stickers.

### 8.7 Paper test para kay Jeff (totoong order, hindi Printer Test)
I-scan ang bawat sticker sa apat na paraan: **iPhone sa Parcel Scan · Android sa Parcel Scan · camera ng iPhone ·
camera ng Android**. Ang camera ay dapat magbukas ng TikTok profile ng buyer; itala kung app o browser ang bumukas.
Haba ng username: 5–6 (maikli) · 10 (karaniwan) · 15 (huling ECC M) · 16 (unang ECC L) · 24.

| Printer | Mga laki | Sticker |
|---|---|---|
| AIMO D520BT | 50×30, 70×50, 100×60 | bago at ngayon |
| Xprinter XP-420B | 50×40, 60×40 | bago; ngayon sa 60×40 |
| Flash Y41BT | 50×40, 60×40 | bago |
| Niimbot B1/B21 | 50×30 | bago at ngayon |
| Laptop (Windows kiosk + Chrome) | isang laki | bagong larawan at pahina ngayon |

Dagdag: (1) username na 16 at 24, bawat isa bilang **v3-L at v4-M**, sa D520 50×30, XP-420B 50×40 at Niimbot 50×30 —
ang tatlong pinakamasikip. (2) Buyer # na 1.5× sa 60×40, username 10 at 16. (3) Isang v3-L na ginasgas o tinupi sa
QR, katapat ng parehong v4-M. (4) Isang maliliit-na-titik na format C (username 10) sa D520 100×60. (5) Isang sticker
ng order na walang code — dapat mukhang at nababasa gaya ngayon.

---

## 9. Mga release

### 9.1 PHASE 0 — hiwalay na unang release (H4). Spec lang; hindi pa ginagawa.
**Layunin:** patunayan sa totoong live na may wastong TikTok `userId` ang mga comment, at matatag ito, **bago** ang SQL,
ang app at ang printing. **Walang nakikitang pagbabago** ang sinuman.

**Saklaw:** server lang (manual Render deploy sa tahimik na oras, may Business Pulse check). Walang SQL, walang web deploy.

**Ang ginagawa:**
1. Naka-OFF ang gate (nakapirmi sa code sa Phase 0; walang binabasang switch).
2. Kinukuwenta ang code sa `try/catch` sa apat na daan — live, "earlier comments", reuse re-emit (lahat sa
   `emitCommentScoped`) at Pin — mula sa UUID `sellerId`. Ang palya ng kuwenta ay hindi kailanman pumipigil sa padala.
3. **WALANG bagong field na ipinapadala.** Test: ang payload na lumalabas sa bawat daan ay **kapareho ng ngayon**
   (parehong mga key at value), at walang pribadong field o `userId` na nakakalusot.
4. **Bilang lang**, bawat daan: `total` · `valid` (`^[1-9]\d{5,24}$`) · `zero` (`"0"`) · `wala` (walang field o blangko)
   · `mali` (iba pa).
5. **Mga tsek ng katatagan sa memory lang** (bawat connection; may takdang laki; nabubura sa disconnect):
   - `handleMultiCode` — iisang username na nakitaan ng higit sa isang code;
   - `codeMultiHandle` — iisang code na nakitaan ng higit sa isang username;
   - `pinMatch` / `pinMismatch` — ang code ng Pin kumpara sa code ng parehong comment sa live;
   - `initialVsLive` — parehong username sa "earlier comments" at sa live: pareho / magkaiba ang code.
6. **Log:** isang summary line bawat connection bawat 10 minuto — mga bilang lang. **Walang username, `userId`, code o
   pangalan** sa log; ang connection ay tinutukoy ng numerong sunod-sunod, hindi ng account.

**Mga test bago i-deploy:** `node --check server.js`; vitest ng `server/buyerQr.js` (kuwenta, tsek ng `userId`, mga
bilang, limitasyon ng memory); payload = ngayon sa apat na daan; sadyang error sa kuwenta → tuloy ang comment; ang mga
umiiral na suite ng relay (`initialComments`, `pinRelay`, `sanitize`, `connectionHealth`) ay berde at hindi binago.

**Exit (lahat dapat totoo):** ≥ 3 araw · ≥ 5 seller · ≥ 20,000 comment · ≥ 20 pin · `valid` ≥ 99.5% sa live at ≥ 99% sa
pin · `handleMultiCode` = 0 · `pinMismatch` = 0 · walang dagdag na error o bagal (Render log at latency ng relay, kumpara
sa parehong mga araw bago ang deploy). **Hindi naabot → hinto, balik kay Jeff.**

**Rollback:** Render one-click rollback. Walang data na naisulat.

**Hindi sinasagot ng Phase 0** (tapat): kung hindi nagbabago ang `userId` kapag nagpalit ng username (kailangan ng
naka-save na code sa maraming araw — Phase 2); camera at TikTok (§3.5); papel (§8.7).

### 9.2 Pagkatapos ng Phase 0 (bawat isa ay sariling release at sariling audit)
| Phase | Ano | Sino ang apektado | Patunay bago umusad |
|---|---|---|---|
| Camera test | 4 na test QR (§3.5) — walang deploy | Wala | Camera → TikTok profile sa iPhone at Android; napili ang format (D / G / C) |
| 1 | SQL (additive) | Wala | PGlite script; `get_advisors`; palyang trigger ay hindi pumipigil sa save |
| 2 | Web deploy; feature key ni **Jeff at ng team niya** (sagot 7): may code na ang comment nila, at ang Scan QR nila ay gumagamit ng lookup | mga account ng team | Paper test (§8.7); parehong code sa live / earlier comments / Pin / Reprint; test account na nagpalit ng username → parehong code |
| 3 | `buyer_qr_scan_enabled` = ON (lahat ng may Parcel Scan: Scan QR ay naghahanap na rin sa Customers sa username) | lahat ng may Parcel Scan | Bilang ng berde / dilaw bawat dahilan / mensahe; walang ulat ng maling punô |
| 4 | `buyer_qr_id_enabled` = ON | Taiwan + Parcel Scan (93 seller ngayon, Q13) | — |

**Pataas:** server → SQL → web → feature key → `scan` → `id`. **Pababa:** `id` OFF (≈ 1 minuto sa bagong comment; ang mga
order na may code na ay code pa rin sa Reprint) → `scan` OFF (sa susunod na bukas ng app) → web rollback → SQL
rollback (**iniiwan ang mga column**, dahil may mga phone na may lumang JS na nagpapadala pa nito).

---

## 10. MGA BUTAS AT CONFLICT

"Ayos" = gagawin sa Hakbang 2. Wala pang napatunayan sa mga ito; bawat isa ay may test sa §11.

### A. Format ng QR at printing
| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| A1 | **Hindi nagbubukas ang TikTok profile sa camera** | Malalaking titik sa `HTTPS://TIKTOK.COM/`; dagdag na `?b=`; sa Android, posibleng browser muna ang bumukas | Camera test bago ang anumang code (§3.5); format C (maliliit na titik) bilang fallback |
| A2 | **Mahinang QR sa mahabang username (16–24)** | ECC L: mas kaunti ang kayang itama | Paper test na v3-L vs v4-M (§8.7); desisyon pagkatapos |
| A3 | Hindi nababasa ng Android ang mixed-mode | `BarcodeDetector` ay hindi nasubok | Paper test; kung palya → `jsQR` muna sa Android (parehong library ng iPhone) |
| A4 | **Walang QR sa sticker** dahil sa sirang code o sobrang haba | Ang library ay nagta-throw; ang `catch` ngayon ay "walang QR" | Helper na laging bumabalik sa link lang (§8.2); test |
| A5 | Gumalaw ang print ng **walang** code (ibang seller/bansa) | Pagbabago sa `qr.ts` o sa pagpasa ng handle | `qrMatrix` hindi ginagalaw; bawat lugar ay sariling handle; mga golden na hindi dapat gumalaw (§8.6) |
| A6 | Ibang QR sa Reprint / Pin / raffle / Print stickers | Mga rutang nagtatapon ng di-kilalang field | Dalhin ang code sa lahat (§7); test na iisang order → iisang QR |
| A7 | Code sa JSON ng text sticker / slip | Nakasakay sa buyer object | Ihiwalay bago ang native; byte-identical na test |
| A8 | Maikling username (1–6): mas malaking QR; mas maliit na tuldok sa 50×40 at Niimbot 50×30 | 25 → 29 modules | Tanggapin (kapareho ng karaniwan ngayon); kasama sa paper test |
| A9 | QR na sumusunod sa @username sa sticker ngayon pero hindi sa bagong sticker (N4) | Umiiral na pagkakaiba | Hindi ginagalaw; Tanong 3 |
| A10 | Lumang app na nag-print ng order na may code | Phone na hindi pa nare-refresh | Link lang ang QR nito (gaya ngayon) — nababasa sa username |
| A11 | Nakikita ng TikTok ang code | Bahagi ng link | Tanggap (walang personal na data); nakasulat sa §8.6 |
| A12 | Hindi na mababago ang format pagkatapos ng unang sticker | Permanente ang QR | Camera at paper test **bago** ang Phase 2; ang lumang parser ay laging gumagana bilang salo |

### B. Maling tao / maling address
| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| B1 | **Maraming buyer, iisang code** | `userId` na `"0"`/blangko | Mahigpit na tsek; Phase 0 binibilang |
| B2 | Dalawang buyer na nagkapareho ng 50-bit na code | Pagkakataon (§3.3) | Pangalawang bantay: iba ang username sa huling na-save → dilaw |
| B3 | Code ni A + details ni B ang na-save | Nag-scan, tapos nag-type ng iba | Chip; tanong na "Papalitan ang details ni @x?"; ang susunod na tamang Save ang nagtutuwid (H1). **Hindi lubusang maaalis** |
| B4 | Maling kabit dahil sa timing | Late na sagot; draft; `await` sa Save; Import | §6.2 (mga tuntunin) + test sa bawat isa |
| B5 | Username na ginamit na ng ibang tao (N1) | Bagong tao, lumang username | Ibang code → dilaw "Nahanap sa username", hindi berde (§6.1) |
| B6 | Bumibili para sa ibang tao / dalawang store (H3) | Parehong code, magkaibang tumatanggap | Dilaw + pagpipilian mula sa huling 5 parcel. **Limitasyon:** ang mga parcel na nabura na (Clear exported, purge) ay hindi na kasama — §14 Tanong 5 |
| B7 | Lumang parcel na in-edit o nahatulan | Trigger sa UPDATE | `source_parcel_id` + `created_at`; gumagalaw lang kapag may talagang nagbago |
| B8 | Maling store na kusang napupunan | Typo sa unang save | Dilaw "Mali ang store noong huli" kapag may hatol; ang bawat bagong parcel ay sinusuri pa rin |
| B9 | Binura sa Customers pero lumalabas pa | Dalawang lugar ng details | Trigger sa Customers (S5). **Limitasyon:** kung in-edit muna ang phone/pangalan sa Customers bago binura, tumutugma pa rin sa `customer_id`; kung walang `customer_id` (parcel na walang phone), hindi matutunton |
| B10 | Naibalik ang nilinis na tala | Kasunod na UPDATE ng parehong parcel | Gumagalaw lang kapag may nagbago sa mga field ng buyer; ang edit ng encoder sa pinagmulang parcel ay sadyang nagbabalik (bumabalik din sa Customers ngayon) |
| B11 | Pagbura ng **na-export** na pinagmulang parcel na mali | Hindi nililinis ang tala (H2: hindi kasama ang na-export) | Ang susunod na Save ang nagtutuwid; o bura sa Customers |

### C. Server at database
| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| C1 | Walang wastong `userId` sa production, o sa Pin | Iba ang totoong hugis ng data | Phase 0 (§9.1) |
| C2 | Email ang nagamit na key sa isang daan (W2) | "Earlier comments" ay email ang dala (`server.js:1711`) | Kuwenta sa `emitCommentScoped` lang, mula sa UUID (§4.1); Phase 0: `initialVsLive` |
| C3 | Lumabas ang hilaw na `userId` sa app | Pribadong field na hindi naalis | Inaalis sa `emitCommentScoped`; test sa lahat ng daan |
| C4 | Sacred zone: relay ng comment | Dagdag sa `emitCommentScoped` | `try/catch`; walang `await` na idinadagdag sa daan ng comment; sariling audit; Phase 0 muna |
| C5 | Gate na mali ang sagot | Lumang cache; palyang basa | Palya = walang code; ~60 s na cache bawat seller. [HINDI PA NAPAPATUNAYAN] |
| C6 | Trigger na pumipigil sa save | Bug, lock, timeout | Maliit, `EXCEPTION`, `lock_timeout`; PGlite na may sadyang error |
| C7 | Trigger sa Customers na nagpapabagal o pumipigil sa bura | Bagong `AFTER DELETE` | Isang `UPDATE` na may index; `EXCEPTION`; PGlite |
| C8 | Pekeng tala mula sa browser | Diretsong sulat | Walang INSERT/UPDATE/DELETE policy |
| C9 | Admin na nakakakita ng data ng iba | RLS na "own OR admin" sa ibang table | Tahasang `auth.uid()` sa RPC; contract test |
| C10 | Bagal / egress | Lookup (index sa code); `bq` sa session load (~15 bytes bawat TikTok order row); +~15 bytes bawat comment | `EXPLAIN ANALYZE` sa Hakbang 2. [HINDI PA NAPAPATUNAYAN] |
| C11 | Mga live na function na nag-a-UPDATE sa `parcel_scans` | 6 ang nakita (Q14) | Babasahin ang bawat isa sa Hakbang 2; ang "may nagbago" na tuntunin ang bantay |
| C12 | SQL rollback habang may lumang JS | — | Iniiwan ang mga column |

### D. Mga hindi ko naayos dahil wala ang teksto
W3, W4, W5, N3, N5, N6, N7, N8, N9, N10 ng pangatlong audit — §13.3.

---

## 11. Listahan ng test

### 11.1 Rule / sagot → test na babagsak kapag nasira
| Rule | Test |
|---|---|
| Iisang permanenteng code; TikTok lang | Server: parehong (UUID, userId) → parehong code; ibang username → pareho pa rin; `"0"`, blangko, wala, may titik → walang code; **parehong code sa live, earlier comments, reuse at Pin**. Facebook/Shopee/Instagram → walang code |
| Sagot 1: link + code; camera | Helper: text = `HTTPS://TIKTOK.COM/@x?b=CODE`; laging 29 modules para sa username 1–24; ECC M ≤ 15, L 16–24; na-decode = eksaktong text. Parser ngayon → username. (Camera: §8.7, si Jeff) |
| Sagot 3: iba = eksaktong ngayon | Walang code → matrix = `qrMatrix(url,"M")` para sa haba 1–30; lahat ng golden/hash sa §8.6 ay hindi gumalaw; gate ng server: hindi TW / walang Parcel Scan / expired / walang switch at key → walang `buyerQr` |
| Sagot 5: huling na-save | Bawat isang field na in-edit (pangalan / phone / store / contact / platform / "no contact") → susunod na lookup = bago, sa 7-11 at FM; LINE/WhatsApp na contact ay buo pagkatapos ng scan + Save; mungkahi ay hindi kusang inilalapat |
| Sagot 6: bura sa Customers | PGlite: bura ng row sa Customers → nilinis ang tala (pati sa "restricted" na rule); **edit** sa Customers → hindi gumalaw ang tala |
| S4: hiwalay ang carrier | Tala ng 7-11 ay hindi lumalabas sa FM at baliktad; walang kinokopya |
| H1 / S2 | Walang `buyer_qr_forget`; bilang user: `INSERT`/`UPDATE`/`DELETE` sa `buyer_qr_details` = tinanggihan |
| H2 | ✕ sa pinagmulang parcel → nilinis; bura ng pinagmulang parcel na hindi pa na-export → nilinis; **Clear exported at purge → hindi gumalaw**; mas lumang parcel → hindi nagbabalik |
| H3 | 2 store sa huling 5 parcel → dilaw + pagpipilian, pinakabago ang naka-pili; iisa → berde; laging may "huling ginamit" |
| N1 | Parehong username, ibang code, may tugma sa Customers → dilaw, hindi berde |
| N2 | ⇄ at pagbalik → form **at** code ay naibalik; ang kabilang carrier ay walang code at walang napuno; "hold" → pareho nabura |
| S1 | Bawat hanay ng §6.1 → tamang klase ng resulta; isang dahilan lang ang ipinapakita |
| S3 | Preview at test print = QR ngayon; walang code |
| Lumang sticker | URL at hubad na username → username + hanap sa Customers; mga umiiral na test ng `handleFromQrPayload` ay hindi ginagalaw |

### 11.2 Mga butas → test
A4: sirang code / 27+ char → link lang, hindi "walang QR". A6: iisang order → parehong matrix sa 1-Click / Enterprise /
Auto / 3 ruta ng Reprint / Pin / raffle / Print stickers / laptop. A7: argument ng `printStickerNative` /
`printStickerLan` / `printSlip` ay byte-identical. B2: tugmang code + ibang username → dilaw. B3: tanong bago mag-Save.
B4: late na sagot ay itinatapon; Save naka-block; code sa pindot; Import → malinis ang form at chip. B7/B10: UPDATE na
walang nagbago → walang sulat; export ng 70 row → walang sulat. C3: walang pribadong field sa anumang padala. C6/C7:
sadyang error at naka-lock na row → tuloy ang save / bura. C8/C9: RLS at contract test. C12: rollback script → naka-save
pa rin ang parcel na may `buyer_qr_id`. "OFF = ngayon": `scan` OFF at walang key → DOM ng Parcel Scan = ngayon, walang
tawag sa lookup, walang `buyer_qr_id` sa save.

### 11.3 Karaniwan
`npm run typecheck`, `npm test`, `npm run build`, lint = parehong bilang sa main; `node --check server.js`; mga
tangled-zone suite ay hindi binabago; i18n × 8 wika; 360/390/430 px. Phase 0: §9.1.

### 11.4 Sa totoong device at papel
§3.5 (camera) at §8.7 (papel) — si Jeff. Dagdag: dalawang phone ng iisang account; Reprint, Pin, raffle at Print
stickers ng iisang order → iisang code.

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
- **Q9** Mga seller na nag-save ng 7-11 parcel sa huling 30 araw: 61; may `parcel_check_access` na enabled: 61. `parcel_scans` huling 30 araw: 16,126 rows — `store_check_status` valid 13,972 · NULL 2,117 · unknown 33 · not_found 4.
- **Q10** `pg_get_triggerdef`: `trg_upsert_parcel_customer` = `AFTER INSERT OR UPDATE OF customer_name, phone, store_id, notes, contact_platform, store_check_status, phone_check_status`; `trg_upsert_fm_parcel_customer` = `AFTER INSERT OR UPDATE OF recipient_name, phone, store_id, buyer_username, contact_platform`.
- **Q11** `storage.buckets`: `product-images` public = true; `fb-receipts` public = true.
- **Q12** (v4) `live_session_orders`, TikTok, 177,581 rows: bilang bawat haba ng username — 4:1 · 5:258 · 6:2,770 · 7:9,617 · 8:19,125 · 9:23,412 · 10:23,830 · 11:21,287 · 12:18,623 · 13:15,045 · 14:12,392 · 15:8,643 · 16:6,516 · 17:8,811 · 18:3,125 · 19:1,469 · 20:971 · 21:786 · 22:441 · 23:233 · 24:226. May malaking titik: 0. Wala sa `a–z 0–9 . _`: 1. Pinakamaraming TikTok buyer ng isang seller sa `customers`: 7,977 (sunod: 7,624 · 7,377 · 7,148 · 6,336). (Ang Q5 ay mas naunang kuha: 176,351 rows.)
- **Q13** Seller na TW + plus/pro/master + active + hindi expired: 93; lahat ng active na may bayad: 150; `parcel_manual_enabled` = `true`. `parcel_scans`: 20,603 rows; na-export na naroon pa 20,446; mas luma sa 7 araw 15,428; mas luma sa 30 araw 4,471 (13 seller); nag-export sa huling 30 araw: 55 seller. Sa huling 60 araw (mga parcel na naroon pa): 2,398 (seller, contact) na may ≥ 2 parcel; 87 dito ay higit sa isang store; 81 ay higit sa isang phone.
- **Q14** Mga function na may `UPDATE … parcel_scans`: `admin_parcel_check_requeue`, `admin_parcel_check_verdict`, `admin_parcel_checks_pending`, `admin_parcel_frozen_pending`, `admin_parcel_frozen_verdict`, `undo_export_batch`. Wala para sa `fm_parcel_scans`. (Kung may alinman na nagse-set ng field ng buyer ay hindi natukoy ng query — babasahin sa Hakbang 2.)

---

## 13. Talaan ng audit

### 13.1 Mga naunang ikot (v1–v3)
Printer-guardian (12 kulang) at auditor (21 + 11 nakita) — lahat ay isinama noon. Ang mga nananatiling may bisa sa v4:
ang mga daan ng code sa printing (Reprint ×3, Pin, raffle, Print stickers), ang hindi pagpasok ng code sa native JSON,
ang mahigpit na tsek ng `userId`, ang mga tuntunin sa timing, ang hindi pagbura ng row ng tala (nililinis lang), at
ang rollback na nag-iiwan ng mga column. Ang mga **inalis** ng v4: TAG ng shop at "ibang shop"; `buyer_qr_forget` at
"Hindi ito ang buyer"; sample code; kopya ng pangalan/phone mula sa kabilang carrier; `buyer_qr_via`; ang paghahanap
ng username sa order rows (nasa QR na mismo ang username).

### 13.2 Printer-guardian, ikalawang ikot (bagong format) — 6 na kulang
| # | Nakita | Ayos |
|---|---|---|
| 1 | Sirang code / sobrang haba → walang QR, walang babala | Helper na bumabalik sa link lang (§8.2), A4 |
| 2 | Baka hindi magbukas ang TikTok sa camera dahil sa malalaking titik | Camera test bago ang code (§3.5), fallback na format C, A1 |
| 3 | Mahabang username: mas mahinang QR sa gasgas | Paper test v3-L vs v4-M (§8.7), A2 |
| 4 | QR na sumusunod sa @username sa sticker ngayon, hindi sa bago | Hindi ginagalaw; Tanong 3, A9 |
| 5 | 5 admin sample ay mas maliit ang QR kaysa totoong order | Iiwan, isusulat sa mapa (§8.6) |
| 6 | QR files na wala sa printing gate | `printing-paths.mjs` (§8.6) |
Itinama rin niya ako: sa 10-char na code, ECC Q ay kasya sa 1–5 (hindi 1–3); at ECC L ay kasya hanggang 26 char.
**Hindi napatunayan ng guardian:** camera, TikTok at `?b=`; `BarcodeDetector` sa mixed-mode; tibay ng ECC L sa thermal
na papel; ESC/POS at CPCL sa hardware.

### 13.3 Pangatlong audit (ang ibinigay sa utos) → saan inayos
| ID | Ano (ayon sa utos) | Kalagayan sa v4 |
|---|---|---|
| H1 | Alisin ang "Hindi ito ang buyer" / `buyer_qr_forget` / DELETE policy | Inalis — §5.1-2, §6.2 |
| H2 | `source_parcel_id`; inalis ang code o binura ang pinagmulang parcel → i-clear; hindi kasama ang Clear exported | §5.1-3 |
| H3 | Huling ~5 parcel; higit sa isang phone/store → dilaw + pagpipilian; laging "huling ginamit" | §5.1-5, §6.1 |
| H4 | Phase 0 bilang hiwalay na unang release | §9.1 |
| W2 | Kuwenta mula sa UUID sa lahat ng 4 na daan, hindi email | §4.1–4.2, C2 |
| **W3, W4, W5** | "Itama ang mga maling pahayag" — **walang paglalarawan sa utos** | **HINDI KO ALAM ang laman.** Ang nagawa ko: ipinahanap sa reviewer ang mga maling pahayag sa v4 (§13.4). Hindi iyon katumbas ng pag-ayos ng W3–W5 |
| N1 | Username na ginamit ng ibang tao | §6.1 |
| N2 | ⇄ draft dala ang code | §6.2 |
| **N3** | — walang paglalarawan | **HINDI KO ALAM** |
| N4 | QR lalabas lang kapag naka-ON ang "Print QR" at nakikita ang @username | §8.5; Tanong 3. Dagdag na nakita: sa **bagong** sticker, hindi ito sumusunod sa @username ngayon |
| **N5–N10** | — walang paglalarawan | **HINDI KO ALAM** |
| S1 | 3 resulta | §6.1 |
| S2 | Walang DELETE policy | §5.1-2 |
| S3 | Walang sample code | §6.2, §8.6 |
| S4 | Ganap na hiwalay ang 7-11 at FamilyMart | §5.2 |
| S5 | Bura sa Customers = bura ng QR details | §5.1-4 |
| S6 | Server: iisang lugar + Pin | §4.1–4.2 |

### 13.4 Audit ng v4 (hiwalay na reviewer)
> Pupunan pagkatapos ng review.

---

## 14. MGA TANONG PARA KAY JEFF

**Kailangan bago ang Hakbang 2:**
1. **Pakipadala ang teksto ng W3, W4, W5, N3 at N5–N10** ng pangatlong audit — wala ito sa akin.
2. **Format ng link:** `…?b=CODE` (nasa plano) o `…?CODE` (walang `b=`; mas maraming username ang nasa mas malakas na
   ECC: 95.9% vs 87.3%)? Imumungkahi kong piliin pagkatapos ng camera test, kung pareho silang gumagana.
3. **Kailan lalabas ang code QR (N4):** ngayon, sa **sticker ngayon** ay walang QR kapag naka-off ang @username; sa
   **bagong sticker** ay lumalabas ang QR kahit naka-off ang @username. Sa plano: hindi ginagalaw — ang code ay nakasakay
   lang sa QR na lalabas na sana. Ayos ba, o gusto mong iisang tuntunin?
4. **Mahabang username (16–24 char, 12.7% ng order):** parehong laki ng QR pero mas mahina sa gasgas (ECC L) — o mas
   malaking QR / mas maliit na tuldok (v4)? Imumungkahi kong papel ang magpasya (§8.7).
5. **H3 — pinagmulan ng "huling 5 parcel":** ang mga parcel na nabura na (Clear exported, purge) ay hindi na mababasa.
   Sa 55 seller na nag-export sa huling 30 araw, 13 lang ang may na-export na parcel na mas luma sa 30 araw (Q13) —
   ibig sabihin, para sa karamihan, **mawawala ang babala na "gumamit ng 2 store"** pagkatapos nilang mag-clear.
   Gusto mo bang itala na lang sa mismong tala ng QR ang huling 5 (hindi nabubura)?

**Puwedeng sagutin habang ginagawa:**
6. Pagbura ng **na-export** na parcel na mali ang details: sa plano, hindi nito nililinis ang tala (H2). Ayos ba?
7. Kailangan bang banggitin sa Privacy Policy ang code sa QR at ang bagong tala ng details?
8. Mga salita sa screen (nasa mockup ay mungkahi lang, English muna).
9. Gusto mo bang gawin ko na ngayon ang pahina ng 4 na test QR para sa camera test (hindi ito app code)?

---

## 15. Ano ang may patunay at ano ang HINDI PA

**May patunay (file:line / query / script output dito):**
- Mga katotohanan ng §1 (QR ngayon, Scan QR, Customers, walang `userId` sa relay/app/database).
- Sukat ng bawat opsyon ng QR laban sa totoong haba ng username; ang napiling format ay 29 modules para sa haba 1–24;
  na-decode ng `jsQR`; ang parser ngayon ay kumukuha ng username dito (`qrsize.output.txt`).
- Suportado ng naka-pin na library ang maraming segment; ang tawag ngayon ay byte-identical
  (`guardian2-library-checks.txt`).
- Sukat ng layout ng guardian (`guardian2-layout-*.txt`): code sticker = layout ngayon para sa username 7–22;
  ang mga pagbabago para sa 1–6 at 23–24; v3-L vs v4-M bawat laki. **Sukat sa computer, hindi papel.**
- Lahat ng comment ay dumadaan sa `emitCommentScoped` na may UUID (`server.js:543-564`).
- Mga bilang sa Q12–Q14.

**HINDI PA NAPAPATUNAYAN (at paano):**
| Ano | Paano mapapatunayan |
|---|---|
| Hindi naaapektuhan ng `?b=…` ang TikTok; diretso ang camera sa profile sa iPhone at Android; malalaking titik | Camera test (§3.5) — si Jeff |
| Nababasa ng `BarcodeDetector` (Android) at camera ng iPhone ang mixed-mode na QR | Camera at paper test |
| Tibay ng ECC L sa thermal na papel (simulation lang ang meron) | Paper test v3-L vs v4-M (§8.7) |
| May wastong `userId` ang totoong comments sa 4 na daan (lalo na Pin), at matatag sa loob ng isang live | Phase 0 |
| Hindi nagbabago ang `userId` kapag nagpalit ng username | Phase 2: test account + query |
| Buong disenyo ng §4–§6 ay gumagana | Wala pang code |
| Ang gate sa server ay tama at hindi nagpapabagal | Wala pang code; sariling audit |
| Ang mga trigger ay hindi kailanman pumipigil sa save o sa bura | PGlite sa Hakbang 2 |
| Walang live na function na nagse-set ng field ng buyer sa `parcel_scans` nang hindi encoder | Pagbasa ng 6 na function (Q14) |
| Lahat ng print path ay nasakop; print ng walang code ay byte-identical | Helper + source test + mga golden |
| Hindi kailangan ng bagong app build | Device na may kasalukuyang build |
| Bilis ng lookup; totoong dagdag na bytes | `EXPLAIN ANALYZE`; sukat |
| Itsura sa dark theme at sa 8 wika | Hakbang 2 |
| **Naayos ang W3, W4, W5, N3, N5–N10** | Kailangan ang teksto ng pangatlong audit |
