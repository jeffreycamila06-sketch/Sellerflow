# Buyer QR ID — plano v5 (plano lang; walang binubuo)

Branch `claude/buyer-qr-id`. **Docs lang** — walang binago sa app code, server, SQL o printing. Lahat ng query sa database
ay read-only. Mga file: ang planong ito · `docs/plans/buyer-qr-id-proof/` (mga script at output ng sukat) ·
`docs/design/buyer-qr-id/` (mga mockup).

Tatak ng bawat pahayag: **[PATUNAY]** = may file:line / query / script output dito · **[HINDI PA NAPAPATUNAYAN]** =
disenyo o hinala pa lang, may nakasulat kung paano mapapatunayan. Walang "pasado" o "ligtas" na walang patunay.

**Ano ang bago sa v5:** ang resulta ng camera test ni Jeff at ang **pinal na format ng link** (§2, §3); ang mga sagot niya
sa mga tanong ng v4 (§2); ang teksto ng W3–W5, N3, N5–N10 ng pangatlong audit, bawat isa may ayos (§13.3); at ang
ikalimang ikot ng pagsusuri (§13.5).

---

## 0. Buod

1. **Format (pinal, desisyon ni Jeff matapos ang camera test):** `https://www.tiktok.com/@username?CODE` — maliliit na
   titik ang link, may `www.`, code sa dulo na walang `b=`. CODE = 10 character, malalaking titik (Crockford base32).
   Sa screen test niya, ito ang **laging diretso sa TikTok app** sa iPhone at Samsung. [Screen test ni Jeff; **hindi pa
   sa totoong sticker** — kasama sa paper test.]
2. **Kapalit ng format na ito sa laki ng QR** [PATUNAY: `qrsize-v5.output.txt`]: kasya sa 29 modules (v3) sa **ECC M
   para lang sa username na hanggang 9 character (31.1% ng order)**; sa **ECC L para sa 10–20 (68.0%)**; at ang
   **21–24 (0.9%) ay hindi kasya sa v3** — 33 modules (v4). Tatlong paraan ng pagpili ang ipi-print sa papel (§3.4);
   **papel ang magpapasya**.
3. **Code lang para sa Taiwan + may Parcel Scan** (kasama ang admin at blangkong bansa, gaya ng Parcel Scan), at kapag
   may code ang order. Lahat ng iba: QR **eksaktong gaya ngayon**.
4. **Details:** bawat code ay may sariling "huling na-save" bawat carrier; nakatala rin doon ang **huling 5 na-save**
   (para sa "gumamit ng 2 store") — hindi nawawala sa Clear exported. 7-11 at FamilyMart ay ganap na hiwalay.
5. **Tatlong klase ng resulta ng Scan QR:** berde · dilaw na may isang dahilan · maikling mensahe.
6. **Phase 0 muna, hiwalay na release** (server lang, naka-OFF, bilang lang) — §9.1, pinal na spec.
7. **Hindi pa handang i-build:** paper test, Phase 0, at ilang tanong (§14). Lahat ng hindi pa napapatunayan: §15.

---

## 1. Ano ang meron ngayon (may patunay)

### 1.1 Laman ng sticker QR
| Pahayag | Patunay |
|---|---|
| QR text **ngayon** = `https://tiktok.com/@<handle>` (walang www; isang `@` lang ang tinatanggal) — mananatili ito para sa order na walang code | `src/lib/tiktokHandle.ts:17-20` |
| ECC "M", byte mode, pinakamaliit na version na kasya | `src/lib/qr.ts:13-17`; tawag: `oneSticker.ts:295-298`, `stickerRaster.ts:1099-1101`, `stickerRaster.ts:1373-1375`, `printing.ts:1263-1265` |
| TikTok lang (walang QR sa Facebook / Instagram / Shopee) | `printing.ts:139-142` |
| Per-device toggle `sfl_rd_sticker_qr`, default OFF; kailangan din ng entitlement (market TW) | `printing.ts:116-129`; `parcelScan.ts:67-69` |
| Sumusunod sa @username toggle (walang QR kapag naka-off ang @username) | `stickerRaster.ts:1096`; `printing.ts:1330` |
| QR ≥ 2 mm mula sa kanang gilid; walang QR sa ilalim ng 50×30 | `oneSticker.ts:44-45`; `docs/printing/PRINTING_MAP.md:156` |
| Laki ng QR ngayon ayon sa haba ng username: 1–6 char → v2 (25 modules); 7–22 → v3 (29); 23–24 → v4 (33) | `docs/plans/buyer-qr-id-proof/qrcheck.output.txt` (script output) |
| Gaano kadalas ang bawat isa (TikTok order rows sa live DB): 7–22 char = **172,885** (98.0%); 1–6 = 3,008 (1.7%); 23+ = 458 (0.3%) | Query Q5 (§12; mas naunang kuha, 176,351 rows — ang §3 ay gumagamit ng Q12, 177,581 rows) |

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
| **[HINDI PA NAPAPATUNAYAN]** na sa totoong production comments ay laging may laman ang `data.userId`, at na hindi ito nagbabago kapag nagpalit ng username. Ang una: library code lang ang nabasa (aral ng "F1": minsan iba ang totoong hugis ng data). Ang pangalawa: kilalang ugali ng TikTok pero wala pa sa sarili nating data. | Ang una: **Phase 0** (§9.1) — bilang sa server log. Ang pangalawa: **Phase 2** pa (kailangan ng naka-save na code): query ng parehong code na may dalawang username |

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

## 2. Mga desisyon ni Jeff (2026-11-11)

### 2.1 Camera test (inulit nang 2–3 beses) — resulta ni Jeff, hindi ko nasubok
| Link | iPhone camera | Samsung camera |
|---|---|---|
| Malalaking titik (`HTTPS://TIKTOK.COM/…`, `HTTPS://WWW.TIKTOK.COM/…`) | diretso sa TikTok app | **browser muna** bago TikTok, o naiiwan sa browser |
| `https://tiktok.com/…` (walang `www.`) — **ito ang link ng sticker ngayon** | diretso | **pabago-bago** (browser muna) |
| `https://www.tiktok.com/@tiktok` | diretso | **laging diretso** |
| `https://www.tiktok.com/@tiktok?8K2M4P9QX7` | diretso | **laging diretso** |

**Desisyon:** `https://www.tiktok.com/@username?CODE` — maliliit na titik ang link (**hindi kailanman gagawing malalaki**),
may `www.`, walang `b=`. Ang code ay malalaking titik at numero. Idagdag sa paper test ang camera test sa **totoong
sticker** sa iPhone at Samsung.
(Tala, labas sa saklaw — Tanong 3: ang link ng sticker **ngayon** ay ang "pabago-bago" sa Samsung.)

### 2.2 Mga sagot at ang epekto
| Sagot | Epekto sa plano |
|---|---|
| QR = TikTok link + code; camera → TikTok profile; ang app ang babasa ng code | §3 |
| Isang login bawat seller | Walang TAG ng shop; walang "sticker ng ibang shop" |
| Code: Taiwan + may Parcel Scan lang; iba: QR eksaktong gaya ngayon; walang code ang order → QR gaya ngayon | §4.3, §8 |
| Kasama ang admin at ang blangkong bansa, gaya ng Parcel Scan (v4 Tanong 7) | §4.3 |
| Simpleng key (seller UUID) | §3.3 |
| Contact: ang huling na-save ng encoder ang masusunod; mungkahi lang ang bago | §6.2 |
| Binura sa Customers → bura rin ang QR details; edit ay hindi dumadaloy | §5.1-4 |
| "Ilang store/phone" ay itatala **sa mismong tala ng QR**, hindi sa huling 5 parcel (v4 Tanong 5) | §5.1-2, §6.1 |
| Buyer na unang nakilala sa username: dilaw sa unang scan, **berde pagkatapos ng isang Save** (v4 Tanong 6) | §6.1 |
| Ang tuntunin ng @username / "Print QR" ay **hindi gagalawin** — labas sa saklaw (v4 Tanong 3) | §8.5 |
| Mahahabang username: **papel ang magpapasya** (v4 Tanong 4) | §3.4, §8.7 |
| Phase 0 exit: pin na **may katapat sa live** (v4 Tanong 8) | §9.1 |
| Unang susubok: si Jeff at ang team niya | §9.2 |

**Daloy na kinumpirma:** (a) buyer na wala pang details → Scan QR ay pinupunan ang @username (gaya ngayon); ita-type ang
pangalan/phone/store isang beses. (b) Buyer na may details → napupunan lahat, presyo na lang, puwedeng i-edit.
(c) Lumang sticker o walang code → @username gaya ngayon + hanap sa Customers sa username (dilaw "pakisuri").

---

## 3. Ang QR: sukat ng pinal na format

Lahat ng numero ay galing sa `docs/plans/buyer-qr-id-proof/qrsize-v5.cjs` → `qrsize-v5.output.txt` — parehong library ng
app (`qrcode-generator`, pinakamaliit na version na kasya), tinimbang sa haba ng username ng 177,581 TikTok order rows
(Q12). Standard QR lang. (Ang paghahambing ng mga naunang opsyon — malalaking titik, `b=`, code na numero — ay nasa
`qrsize.output.txt`; hindi na sila pagpipilian dahil sa camera test.)

### 3.1 Haba ng username sa live data [PATUNAY: Q12]
| Haba | 4–6 | 7–9 | 10–12 | 13–15 | 16–17 | 18–20 | 21–24 |
|---|---|---|---|---|---|---|---|
| Order rows | 3,029 | 52,154 | 63,740 | 36,080 | 15,327 | 5,565 | 1,686 |
| % | 1.7% | 29.4% | 35.9% | 20.3% | 8.6% | 3.1% | 0.9% |

Hanggang 9 char = 31.1% · hanggang 20 = 99.1% · pinakamahaba: 24. Walang malaking titik sa alinmang username.

### 3.2 Gaano karami ang kasya [PATUNAY: `qrsize-v5.output.txt` §1–§2]
Pagsulat: **mixed-mode** — ang link (`https://www.tiktok.com/@username?`) bilang "byte", ang CODE bilang "alphanumeric".
| Code | v3 (29 modules) sa ECC M | v3 sa ECC L | v4 (33 modules) sa ECC M |
|---|---|---|---|
| 8 char (40 bits) | username ≤ 10 · 44.5% | ≤ 21 · 99.5% | lahat (≤ 24) · 100% |
| **10 char (50 bits)** | **≤ 9 · 31.1%** | **≤ 20 · 99.1%** | **lahat (≤ 24) · 100%** |
| 12 char (60 bits) | ≤ 7 · 7.1% | ≤ 18 · 97.7% | lahat · 100% |
| 10 char, hindi mixed-mode | ≤ 7 · 7.1% | ≤ 18 · 97.7% | lahat · 100% |
| *Ngayon (link lang, walang `www.`)* | *≤ 22 · 99.7%* | *≤ 24 · 100%* | — |

Para sa 10-char na code: **31.1%** ng order ay kasya sa v3 sa ECC M · **68.0%** ay kasya sa v3 sa ECC L lang ·
**0.9%** (username na 21–24) ay **kailangan ng v4** kahit anong ECC. Lahat ay kasya sa v4 sa ECC M.
Ang mixed-mode ay nakakatipid ng 2 character ng username kumpara sa hindi mixed. Ang `www.` at ang maliliit na titik
(na kailangan para sa Samsung) ang dahilan kung bakit mas kaunti ang kasya sa ECC M kaysa sa mungkahi ng v4.

### 3.3 Ang format at ang code
```
https://www.tiktok.com/@<username>?<CODE>        CODE = 10 character, Crockford base32 (0-9 A-Z maliban sa I L O U)
```
- **CODE** = unang 50 bits ng `HMAC-SHA256(key = seller UUID, "sfb1:" + TikTok userId)`. Kinukuwenta sa server.
  Tinatanggap lang ang `userId` na `^[1-9]\d{5,24}$`; iba → walang code.
- **Bakit 10 character:** sa 100,000 buyers ng iisang seller, 1 sa 225,000 ang tsansang magkapareho ang code ng dalawa;
  sa 8,000 (pinakamalaking seller ngayon, Q12), 1 sa 35 milyon [kuwenta: `qrsize-v5.output.txt` §5]. May pangalawang
  bantay: kapag tumugma ang code pero **hindi pa nakikita ang username ng sticker** para sa code na iyon → dilaw (§6.1).
  Ang 8 char ay 1 sa 220 sa 100,000 buyers — masyadong mataas. Ang 12 char ay halos walang kasya sa ECC M (7.1%).
- **Ang @username ay hindi ginagalaw** (maliliit na titik, gaya ngayon). Ang code ay nakikita rin ng TikTok kapag
  binuksan ang link (bahagi ito ng link); walang pangalan, phone o store dito.
- **Hindi na mababago ang code** pagkatapos lumabas ang unang sticker. Kung babaguhin balang-araw ang **hugis ng link**,
  kailangang idagdag ang bagong hugis sa parser; ang parser ngayon ay laging nakakabasa ng **username** sa anumang link ng
  TikTok (§3.6), kaya hindi kailanman "walang nabasa".

### 3.4 Aling version at ECC — tatlong paraan; **papel ang magpapasya** (sagot ni Jeff)
| Paraan | Username ≤ 9 (31.1%) | 10–20 (68.0%) | 21–24 (0.9%) | Kapalit |
|---|---|---|---|---|
| **P1 "parehong laki gaya ngayon"** | v3, ECC M | v3, **ECC L** | v4, ECC M | 68% ng code sticker ay nasa mas mahinang ECC. Layout: halos walang nagbabago (§8.3) |
| **P2 "laging ECC M"** | v3, ECC M | **v4**, ECC M | v4, ECC M | 69% ng code sticker ay 33 modules — laki na 0.3% lang ang gumagamit ngayon: mas malaking QR o mas maliit na tuldok, lumilipat ang text (§8.4) |
| **P3 "iisang laki"** | v4, ECC M | v4, ECC M | v4, ECC M | Lahat ng code sticker ay 33 modules; iisang laki na susubukin, pero lahat ay nagbabago kumpara ngayon |

**Mungkahi ko para sa unang print sa papel: P1**, at ihambing ang **v3-L laban sa v4-M** sa parehong username at papel
(§8.7). Dahilan: P1 lang ang hindi nagbabago ng layout ng sticker; ang kapalit nito (ECC L) ay eksaktong bagay na papel
lang ang makakapagsabi. **Kung mahina ang ECC L sa papel → P2.** [HINDI PA NAPAPATUNAYAN kung alin ang mas nababasa.]

Simulation ng sira, v3-L laban sa v4-M [PATUNAY bilang SIMULATION lang: `qrsize-v5.output.txt` §4 — 400 subok bawat hanay,
`jsQR`; sukat sa tuldok ng printer, 8 tuldok = 1 mm]. **Hindi nito ginagaya ang labo ng camera o ang pagkalat ng tinta —
kung saan ang mas maliit na tuldok ang talo.** Ang paghahambing lang ang makabuluhan, hindi ang mismong porsyento.
| Sira | v3-L, 6 tuldok/module (21.8 mm) | v4-M, 6 tuldok (24.8 mm) | v4-M, 5 tuldok (20.6 mm) |
|---|---|---|---|
| Puting guhit, 6 tuldok ang lapad | 64% | 81% | 78% |
| Puting guhit, 12 tuldok | 11% | 50% | 44% |
| Itim na mantsa, 24×24 tuldok | 75% | 80% | 80% |
| Itim na mantsa, 36×36 | 55% | 77% | 75% |
| Itim na mantsa, 48×48 | 2% | 76% | 63% |

### 3.5 Ano ang napatunayan at hindi pa tungkol sa camera at TikTok
- **Resulta ni Jeff (§2.1):** sa screen, ang pinal na format ay laging diretso sa TikTok app sa iPhone at Samsung.
- **[HINDI PA NAPAPATUNAYAN]:** sa **totoong naka-print na sticker** (bawat laki at printer); sa ibang Android na hindi
  Samsung; sa phone na walang TikTok app; sa ibang bansa; at kung may anumang ginagawa ang TikTok sa `?CODE`
  (hal. sa loob ng app). Lahat ay nasa paper test (§8.7).
- **[HINDI PA NAPAPATUNAYAN]:** kung nababasa ng `BarcodeDetector` ng Android ang mixed-mode na QR sa Parcel Scan
  (`jsQR` lang ang nasubok: 72 sa 72, `qrsize-v5.output.txt` §3). Ang camera ni Jeff ay nakabasa ng test QR, pero hindi ko
  alam kung mixed-mode ang test QR niya.

### 3.6 Pagbasa sa app (parser) — spec; ang code ay sa Hakbang 2 pa
[PATUNAY ng spec: 22 halimbawa sa `qrsize-v5.output.txt` §3, gamit ang mismong regex ng app ngayon.]
1. **Bagong sticker:** tinatanggal muna ang espasyo at bagong-linya sa magkabilang dulo (gaya ng parser ngayon,
   `tiktokHandle.ts:28`); tapos `^https?://(www\.|m\.)?tiktok\.com/@<username>\?<10 Crockford>$` → username + code.
   **Ang scheme at host lang ang hindi case-sensitive; ang code ay dapat malalaking titik** (ang bahaging alphanumeric ng QR
   ay malalaking titik lang ang kayang dalhin, at ibinabalik ito ng scanner nang eksakto).
2. **Lahat ng iba** → ang parser ngayon (`handleFromQrPayload`, `tiktokHandle.ts:28-36`, **hindi gagalawin**) → username lang:
   - sticker ngayon `https://tiktok.com/@x`; lumang URL na may `www.` o `m.`; malalaking titik; walang `https://`;
   - link na may sariling query ng TikTok (`?lang=en`, `?_t=…&_r=1`) → username lang, **walang code**;
   - "code" na maliliit na titik, 9 o 11 character, may `L`/`O`, may kasunod na `&…` o `#…`, may `/` bago ang `?`, o
     walang `https://` → username lang (nawawala ang code — hindi ganito ang sticker natin);
   - hubad na `annc` / `@annc` (pinakalumang sticker).
3. Hindi TikTok / kung anu-ano → wala (walang napupunan), gaya ngayon.
- **Walang code na ilalagay sa QR** kapag ang username ay "unknown" (pamalit ng server, `server.js:1783`) o may character
  na wala sa `a–z 0–9 . _` (1 row, Q12) — link lang, gaya ngayon.
- **Walang sticker ngayon na mababasa nang iba:** ang tuntunin 2 ay ang hindi ginagalaw na parser; ang tuntunin 1 ay
  nagdaragdag lang ng code.
- **Lumang app sa phone na hindi pa nare-refresh:** ang parser ngayon ay kumukuha ng username sa bagong link
  [PATUNAY: 72 sa 72] → gumagana **gaya ngayon** (username lang). Walang "No QR found", walang maling punô.

---

## 4. Server (S6, W2): saan kinukuwenta ang code

### 4.1 Iisang lugar para sa comment: `emitCommentScoped`
[PATUNAY: lahat ng comment papunta sa app — live `server.js:1820`, "earlier comments" `:1719`, reuse re-emit `:2051` —
ay dumadaan sa `emitCommentScoped(sellerId, …)` (`:543-564`); dalawa lang ang `emit("comment")` (`:555`, `:562`), parehong
nasa loob nito; ang `sellerId` doon ay ang **UUID** (`:553`).]
- Ang mga gumagawa ng payload (live relay `:1785-1818`; `server/initialComments.js:63-87`) ay magdadala lang ng **hilaw
  na `userId`** sa isang pribadong field. **Hindi sila nagkukuwenta** — kaya walang paraan na magamit ang email
  (`server.js:1711`) bilang key.
- **N9 — TikTok lang.** Dumadaan din sa `emitCommentScoped` ang Shopee (`:2288`, `:2740`), Facebook (`:2545`) at
  Instagram (`:2808`). Ang bagong hakbang ay tumatakbo lang kapag `platform === "TikTok"`; ang iba ay **hindi nagbabago
  kahit isang byte** (test).
- Ang hakbang: (1) gumawa ng **bagong object** na walang pribadong field — **hindi binabago ang orihinal**, dahil ang
  parehong object ay iniimbak pagkatapos sa ring ng reuse (`:1820` → `:1828`; `:1719` → `:1724`); (2) sa `try/catch`,
  kuwentahin ang code mula sa `sellerId` (UUID) at `userId`; (3) kung pinapayagan ang seller (§4.3) → idagdag ang
  `buyerQr`; (4) ipadala. Ang ring ay nag-iimbak ng hilaw na value (memory ng server lang), kaya ang reuse re-emit ay
  sinasala rin sa oras ng padala.
- **Ang hakbang 1–3 ay isang purong function sa `server/buyerQr.js`** (may vitest) — walang test harness ang `server.js`.
  Dagdag na source-contract test: tinatawag ito bago ang dalawang `emit`; ang padala ng Pin ay walang hilaw na ID.
- **N10:** ang kuwenta ay isang HMAC bawat comment (microseconds); walang `await` na idinadagdag sa daan ng comment.
  Ang mga log ay **pinagsamang bilang**, hindi kailanman isang linya bawat comment.

### 4.2 Pin to print: pangalawang lugar
Hiwalay ang padala ng Pin (`platform_pin`, `server.js:1616-1622`, `server/pinRelay.js:20-61`), at nakapaloob ang ID
(`chat.user.userId`). Parehong function ng kuwenta, parehong UUID `sellerId`.
[HINDI PA NAPAPATUNAYAN na may `userId` ang pin event — Phase 0.]

### 4.3 Sino ang pinapayagan — **bagong code** (W3); disenyo, HINDI PA NAPAPATUNAYAN
Pinapayagan ang seller kapag **lahat** ng ito: Taiwan (`country` na `TW` o blangko) · may Parcel Scan (plan na
plus/pro/master, active, hindi expired, naka-ON ang `parcel_manual_enabled`) **o admin** · **at** (naka-ON ang
`buyer_qr_id_enabled` **o** may feature key `buyer_qr_id` ang account). Parehong tuntunin ng Parcel Scan sa app
(`parcelScan.ts:105-123`) at ng `fm_scan_allowed` (Q3); test na naghahambing ng dalawa.
- **W3 — pagtutuwid:** mali ang sinabi ng mga naunang bersyon na may naka-cache nang basa ng feature key bawat seller sa
  server. Ang `server.js:1081-1088` ay ang `helpBotAllowed`: **query sa bawat request, walang cache**. Ang may
  60-segundong cache ay ang `fb_enabled` lang at ang basa ng FB tester bawat email (`server/fbAccess.js:13`, `:24`, `:55`).
  **Ang gate ng buyer QR bawat seller ay bagong code** — ang hugis ng `createFbTesterReader` ang gagayahin.
- **Isang SQL function ang sasagot** (plan + bansa + switch + key sa isang tawag). Tinatawag ito ng server gamit ang
  service role, kaya **walang `auth.uid()`**: hindi nito magagamit ang `is_admin()`, `my_feature_access()` o
  `fm_scan_allowed()` (lahat ay bumabasa ng `auth.uid()`, `sql/120:26-42`). Kailangan nito ng **parameter na user id**,
  sariling tsek ng admin at ng feature key sa email, at `EXECUTE` para sa service role lang. Ang tuntunin ng app ay walang
  bypass na makakaligtaan nito (ang "view as" ng admin ay display lang, `market.ts:56-62`).
- **Ang basa:** isang **sabay (synchronous) na silip** sa cache sa daan ng comment + refresh sa background. Hindi kinokopya
  nang buo ang `createFbTesterReader` (async iyon, at pinapanatili ang huling sagot kapag nabigo ang basa,
  `fbAccess.js:70-73`).
- **N6 — walang timer, at hindi inaalis sa disconnect.** Ang cache ay bawat **seller**, pero ang connection ay bawat
  **account**; kung aalisin sa bawat disconnect (4 na lugar: `server.js:690`, `:710`, `:1476`, `:2016`), mawawalan ng code
  sa gitna ng live ang ibang account ng seller, at pagkatapos ng bawat health reconnect. Kaya: mapa na may takdang dami +
  edad na ~60 s; **habang nire-refresh, ang dating sagot ang ginagamit**; "walang code" lang kapag **wala pang naging
  sagot** o lampas na sa ilang minuto ang huling matagumpay na basa. Walang `setInterval`; ang luma ay inaalis kapag
  nadaanan. Ang refresh ay may sariling `catch` (walang unhandled rejection).
- **N6 — maagang basa, WALANG hintay.** Sinisimulan ang basa **sa itaas ng `connectTikTok`** (`server.js:1949` — sakop pati
  ang reuse tap) **at sa itaas ng `startTikTokConnection`** (`:1502` — sakop ang reconnect ng health cycle, na hindi
  dumadaan sa `/connect`). Ilang segundo ang mismong connect, kaya karaniwang may sagot na. **Walang idinadagdag na
  hintay bago ang "earlier comments"**: sa `startTikTokConnection`, walang `await` sa pagitan ng pag-resolve ng `connect()`
  (`:1630`) at ng pagkabit ng mga listener ng live (`:1731-1741`, `:1770`) — ang hintay doon ay magtatapon ng mga live na
  comment habang berde ang pill. Hindi pa dumating ang sagot → walang code sa batch na iyon (QR nila ay gaya ngayon).
- Palya ng basa na wala pang naging sagot → walang code. Pagpatay: ~1–2 minuto, wala nang code ang **bagong** comment;
  ang Reprint ng mga order na may code na ay humihinto sa susunod na bukas ng app (§6.2).
- 93 seller ang saklaw ngayon (TW + plus/pro/master na active) sa 150 na active na may bayad [Q13].

---

## 5. Database: ang details ng bawat code

### 5.1 Bagong SQL (Hakbang 2; susunod na libreng numero ay sql/149 — kumpirmahin noon)
1. **Mga column sa parcel** (nullable, walang default, **walang `CHECK`** — W4): `buyer_qr_id` at `buyer_qr_handle` sa
   `parcel_scans` at sa `fm_parcel_scans`. `buyer_qr_id` = ang 10-char na code; `buyer_qr_handle` = ang @username na
   nasa sticker noong na-scan. Index `(user_id, buyer_qr_id)` kung may laman.
   **Walang `buyer_qr_via`** (N8): walang ugali ng app na nakadepende rito (sagot: berde pagkatapos ng isang Save). Kung
   paano nakilala ang buyer — `qr` / `username` / `customers` — ay ipapadala lang sa analytics.
2. **Table `buyer_qr_details`** — isang row bawat (seller, code, carrier `'711'`|`'fm'`):
   `name, phone, store_id, contact, contact_platform, qr_handles, recent, source_parcel_id, source_created_at,
   customer_id, cleared_at, updated_at`. `user_id → auth.users ON DELETE CASCADE`.
   - `recent` = **ang huling 5 na-save** para sa code na ito (parcel id, pangalan, phone, store, petsa) — sagot ni Jeff:
     nakatala rito, kaya **hindi nawawala sa Clear exported o sa purge**. Bawat hanay ay may **parcel id**: ang edit ng
     seller sa parcel na iyon ay nag-a-update ng hanay nito (kahit hindi ito ang pinagmulan), at ang pagbura ng seller sa
     parcel na hindi pa na-export ay nag-aalis ng hanay nito — para hindi maiwan ang maling store sa pagpipilian.
     **Ang blangkong store o phone ay hindi binibilang** bilang "pangalawang store".
     **Tapat na ibig sabihin ng "huling 5":** ang buyer na talagang lumipat ng store ay **dilaw sa susunod na 4 na save at
     berde sa ika-5**. At **ang mga save na walang code ay hindi nakikita rito** (parcel mula sa Customers o lumang
     sticker) — kaya inihahambing din ng lookup ang tala sa row ng buyer sa Customers (§5.1-5).
   - `qr_handles` = hanggang 5 username ng sticker na nakita na para sa code.
   - **RLS (W4, S2): `SELECT` ng sariling row lang.** Walang `INSERT`, `UPDATE` o `DELETE` policy. Ang mga row ay
     **hindi binubura — nililinis** (tingnan sa ibaba). Mga trigger lang ang nagsusulat.
3. **Trigger sa parcel** (bago at hiwalay; hindi ginagalaw ang mga phonebook trigger), `AFTER INSERT OR UPDATE OF
   <mga field ng buyer>, buyer_qr_id, buyer_qr_handle` at `AFTER DELETE`. Laging `NEW.user_id`/`OLD.user_id`. Ang
   pangalan nito ay mas huli sa alpabeto kaysa `trg_upsert_parcel_customer`, para nandiyan na ang row sa Customers.
   - **Save / edit:** isinusulat ang tala kapag (a) wala pang tala, o (b) ito mismo ang pinagmulang parcel
     (`source_parcel_id`), o (c) mas bago ang parcel kaysa sa pinagmulan (`created_at`). Sa UPDATE, gumagalaw lang kapag
     **may talagang nagbago** sa mga field na iyon. Kaya ang edit o hatol sa **lumang** parcel ay hindi umaagaw.
   - **H2 — inalis ang code sa pinagmulang parcel** (✕ sa edit) **o binura ng seller ang pinagmulang parcel na hindi pa
     na-export** → **nililinis ang tala**: pangalan, phone, store, contact, `recent` → blangko; `cleared_at`;
     **nananatili ang `source_created_at`** (para hindi ito maibalik ng mas lumang parcel). Sa pagbura, gumagalaw lang
     kapag **ang naka-sign-in na seller mismo** ang nagbura (`auth.uid() = OLD.user_id`) at hindi pa na-export
     (7-11: `status <> 'exported'`; FamilyMart: `exported_at IS NULL`, `fmScan.ts:268`). **Hindi nililinis** ng: "Clear
     exported" (`parcelScan.ts:906`); ng purge — na nagbubura rin ng hindi na-export na parcel pagkalipas ng 180 araw
     (`sql/65_privacy_retention_purge.sql:38-41`; FamilyMart `sql/120:110-114`); ng pagbura ng account (CASCADE); at ng
     pagbura ng isang na-export na parcel. Tapat na epekto: ang pagbura ng pinagmulang parcel ay naglilinis ng **buong**
     tala kahit may mas lumang tamang parcel — ang susunod na scan ay "wala pang details" o "nahanap sa username".
   - Maling hugis ng code → binabalewala (walang tala), naka-save pa rin ang parcel. Buong laman sa
     `BEGIN … EXCEPTION WHEN OTHERS`, may maikling `lock_timeout`. Tapat na limitasyon: hindi nasasalo ng `WHEN OTHERS`
     ang pagkansela ng statement (timeout). [HINDI PA NAPAPATUNAYAN — PGlite sa Hakbang 2.]
4. **Trigger sa Customers** (`parcel_customers`, `fm_parcel_customers`) `AFTER DELETE` (S5): nililinis ang mga tala ng
   parehong carrier na tumuturo sa nabura — `customer_id`, **o** parehong phone + pangalan, **o** ang TikTok username ng
   nabura ay kabilang sa `qr_handles` ng tala. (Mas mabuting sumobra ang linis: 1,572 username ang may higit sa isang row
   sa Customers, Q4.) Sakop din ang umiiral na "restricted na phone → burahin sa Customers" (Q3) — ang checker ay
   naka-login bilang admin, kaya gumagalaw ang trigger **kahit sino ang naka-sign-in na nagbura**. **Walang ginagawa kapag
   walang naka-sign-in** (`auth.uid() IS NULL` = pagbura ng account, cron, dashboard): hanggang 7,643 row ng Customers ang
   isang seller (Q4), at ang mga tala ay nabubura na rin naman sa cascade. **Edit sa Customers ay walang epekto.**
   (Sa PGlite script, dapat i-set ang JWT — kung hindi, lahat ng bura ay magmumukhang cron.)
5. **RPC `buyer_qr_lookup(p_code, p_handle, p_carrier) → jsonb`** — `SECURITY INVOKER`, tahasang `user_id = auth.uid()`
   sa bawat query. Isang tawag bawat scan. Ibinabalik: ang tala (kung meron at hindi nilinis) kasama ang `recent` at
   `qr_handles`; ang hatol ng store at ng phone ng pinagmulang parcel kung naroon pa ito; **ang store at phone ng
   nakakabit na row sa Customers (`customer_id`), para makita kung iba na ito sa tala**; at kung walang tala — mga row sa
   Customers ng carrier na ito na tugma sa username (hanggang 5, pinakabago muna).
6. Mga switch (seed `'false'`): `buyer_qr_id_enabled` (server; binabasa rin ng app bilang pang-emergency na patay) at
   `buyer_qr_scan_enabled` (app — **switch o feature key**). Feature key `buyer_qr_id` sa `my_feature_access()` (mula sa
   LIVE na definition sa oras ng apply).

### 5.2 Mga tuntunin
- **"Huling na-save ang masusunod":** ang tala ay eksaktong ang huling parcel na na-save na may code na iyon.
- **S4 — ganap na hiwalay ang 7-11 at FamilyMart.** Walang kinokopya mula sa kabila.
- **Tapat na kapalit:** dalawang lugar ang may details (Customers at ang tala ng QR). Bura = bura; edit = hindi dumadaloy.
- **N7 — rollback, nang tapat:** ang pag-alis ng table na `buyer_qr_details` ay **bumubura ng lahat ng naka-save na
  details ng QR ng lahat ng seller** — mabuti sa privacy, pero **ita-type ulit** ng mga encoder kapag in-on muli. Ang
  mga **code** ay naiiwan sa mga column ng parcel at sa `platform_meta.bq` ng order rows hanggang ma-purge ang mga iyon;
  code lang iyon — walang pangalan, phone o store. Kaya ang rollback ng SQL ay **huling hakbang lang**, at ang unang
  pagpatay ay sa mga switch (§9.2).
- Account delete → CASCADE.

---

## 6. Scan QR: tatlong klase ng resulta (S1)

### 6.1 Ano ang lalabas
| Resulta | Kailan | Ano ang napupunan |
|---|---|---|
| **BERDE** "Kilala sa QR · huling ginamit: ‹petsa›" | May code, may tala na **kumpleto** (pangalan, phone, store), **iisa ang phone at store sa huling 5 na-save**, tugma sa row sa Customers (kung meron), walang masamang hatol, at ang username ng sticker ay **nakita na** para sa code | Pangalan, phone, store, contact + platform (gaya ng huling na-save). Cursor sa **Amount** |
| **DILAW** — isang dahilan lang, laging may "huling ginamit: ‹petsa›" | | Napupunan ang meron; **pakisuri** |
| · "Restricted ang phone noong huli" / "Mali ang store noong huli" | Hatol sa pinagmulang parcel — **inuuna ito sa lahat**, para hindi mapunan ang may problemang field nang walang babala | Lahat maliban sa field na may problema |
| · "Gumamit ng 2 store — pakisuri" (o 2 phone) (H3) | Higit sa isang phone o store sa huling 5 na-save (nasa tala mismo) | Pagpipilian; **pinakabago ang naka-pili**; ang pindot sa iba ay pumupuno ng iyon |
| · "Iba ang store sa Customers — pakisuri" | Ang row ng buyer sa Customers ay may ibang store o phone kaysa sa tala (may na-save na parcel na walang code pagkatapos) | Pagpipilian: tala o Customers; pinakabago ang naka-pili |
| · "Bagong username sa sticker — pakisuri" | Tugma ang code pero ang username ng sticker ay **hindi pa nakikita** para sa code (nagpalit ng username, **o ibang tao**). Ang lumang sticker ng parehong buyer ay hindi na nagpapadilaw ulit | Details ng tala + mungkahi "Gamitin ang @bago" kung TikTok ang naka-save na contact |
| · "Nahanap sa username — pakisuri" | Walang code (lumang sticker / hindi saklaw / order na walang code) **o** may code pero wala pang tala, at may tugma sa Customers ng carrier na ito | Mula sa Customers. Higit sa isa ang tugma → pagpipilian, pinakabago ang naka-pili |
| · "Kulang ang details — pakikumpleto" | May tala pero walang phone o store | Ang meron |
| **MAIKLING MENSAHE** (walang kahon) | | |
| · "Napunan ang @username — i-type ang details" | Walang tala, walang tugma sa Customers | @username lang — **gaya ngayon** |
| · mensahe ngayon ("No QR found…") | Hindi nabasa / hindi QR ng TikTok | Wala — gaya ngayon |
| · "Hindi na-check ang details ngayon" | Hindi sumagot ang database | @username lang — gaya ngayon |

Kapag higit sa isang dahilan ng dilaw ang totoo, ang una sa listahan ang ipinapakita.
- **Buyer na unang nakilala sa username** (kasama ang **N1** — username na ginamit na ng ibang tao: ibang code, walang
  tala): **dilaw sa unang scan; pagkatapos i-Save ng encoder, berde na sa susunod** (sagot ni Jeff). Tapat na panganib na
  tinanggap: kung nag-Save ang encoder nang hindi pinapalitan ang details ng dating may-ari ng username, berde na ang
  maling details sa susunod.
- **N5:** ang username at ang mungkahing "bagong username" ay galing sa **mismong QR na na-scan**, hindi sa order rows —
  kaya **hindi ito apektado ng purge** ng order rows. (Ang lumang disenyo na naghahanap sa order rows ay tinanggal sa v4.)

### 6.2 Mga tuntunin
- **Laging puwedeng i-edit** ang lahat bago mag-Save. Presyo ang natitirang ita-type.
- **Contact:** ang huling na-save ng encoder ang ipinupuno, kasama ang platform. Hindi kailanman kusang pinapalitan. Kung
  walang tala: @username ng sticker, TikTok (gaya ngayon).
- **Ang nag-aayos ng mali (H1):** "huling na-save ang masusunod" + bago mag-Save na may code, kung may tala at **parehong
  iba** ang phone at pangalan → tanong: **"Papalitan ang details ni @x?"**. Walang "Hindi ito ang buyer".
- **Chip "QR: @username ✕"** habang may code ang entry. ✕ = alisin ang code sa entry (hindi binubura ang mga field).
  Sa edit ng naka-save na parcel: binabasa ang code ng **parcel na iyon lang**; ✕ → **tahasang `null`** sa dalawang bagong
  column (H2) — ang mga update ngayon ay hindi nagpapadala ng mga ito (`parcelScan.ts:875-881`, `fmScan.ts:221-235`).
  Scan QR habang nag-e-edit: @username lang, gaya ngayon — walang ikinakabit.
- **Walang maling kabit dahil sa timing:** naka-block ang Save habang may lookup; bawat lookup ay may token at ang huling
  dumating na sagot ay itinatapon; ang code ay kinukuha **sa mismong pindot ng Save**; nabubura ang code sa Clear, Cancel,
  matagumpay na Save, susunod na file ng batch, at matagumpay na Import.
- **N2 — ⇄ (7-11 ⇄ 全家):** ang draft ay **dala ang code** pagbalik sa **parehong** carrier (disenyo: form, code, username
  ng sticker, at ang phone + pangalan ng tala ay sabay na iniimbak — ngayon, form / noHandle / platform lang,
  `parcelDrafts.ts`). **Hindi kailanman tumatawid** sa kabilang carrier. Ang "hold" bago mag-save (`:43`) ay nag-aalis ng lahat.
- **📇 Customers habang may chip (N8):** ang Import ay **isa-isa** (`CustomerDetails.tsx:158` `doImport(c)`), kaya ligtas
  dalhin ang code: ang Import mula sa form na may code ay dala ang code at ang username ng sticker, dumadaan sa parehong
  tanong, at pagkatapos ay nililinis ang form at chip. Ang Customers mula sa Settings ay hindi kailanman nagpapadala ng
  code. (Disenyo — wala pang ganitong prop: `CustomerDetails.tsx:42`, `FmCustomerDetails.tsx:26`.)
- **N3 — parehong buyer, magkaibang QR sa iisang live.** Posible kapag walang code ang isang order: comment na dumating
  bago sumagot ang gate, phone na may lumang app, o order na walang TikTok ID. (Sa code ngayon, **lahat ng gumagawa ng
  order ay may comment** — `RedesignApp.tsx:2128`, `:2280`, `:2343`, `:2393`, `:2478`; **hindi ko nahanap ang "Manual /
  Type price na walang comment"** na binanggit — Tanong 2.) **Ayos (kasama sa plano):** sa paggawa ng order na walang
  code (`useOrders.createOrder`, bago i-schedule ang print), gamitin ang code ng **parehong buyer sa kasalukuyang session**
  — tugma sa username **at** platform na TikTok, gaya ng umiiral na pagtutugma ng buyer (`orderLogic.ts:36`) — at **itatak
  ito sa bagong order at sa row nito** (para pareho ang Reprint). Mga bantay: **hindi kailanman** para sa blangko o
  "unknown" na username (dalawang magkaibang tao ang puwedeng "unknown"); at **lang habang may dumarating pang comment na
  may code sa app na ito** — para hindi magpatuloy ang code mula sa mga lumang row kapag pinatay na ang gate o nag-expire
  ang plan. Hindi nito naaayos ang **unang** order ng buyer na walang code. Parehong nababasa ng Scan QR ang dalawang
  klase, kaya walang nasisira kahit hindi ito tumama.
- **S3:** walang sample code sa preview at test print.
- **Pang-emergency na patay sa pag-print:** ang iisang helper ng QR ay sumusunod sa `buyer_qr_id_enabled` / feature key na
  binasa ng app. Naka-OFF → **link lang** kahit may code ang order (pati Reprint). Tumatalab sa susunod na bukas ng app.
- Naka-OFF ang `buyer_qr_scan_enabled` at walang feature key → Scan QR **eksaktong gaya ngayon**.
- Dry/Frozen, mga check ng store/phone, batch cap, export, 賣貨便 col J, Pickup Status — **walang pagbabago**.


---

## 7. Mga file na gagalawin sa Hakbang 2 (listahan lang)

**Phase 0 (server lang):** BAGO `server/buyerQr.js` (puro, may vitest) · `server.js` `emitCommentScoped` (`:543`) at ang
Pin emit (`:1616`) · isang field sa live relay (`:1785`) at sa `server/initialComments.js:63` · `server/pinRelay.js:20`.

**Pagkatapos ng Phase 0:**
- Database: `sql/149_buyer_qr_id.sql` + rollback (iniiwan ang mga column) + `scripts/sql149-behaviour.mjs` (PGlite).
- `src/lib/buyerQr.ts` (BAGO): ang parser ng §3.6 (`parseBuyerQr`; ang `handleFromQrPayload` ay hindi ginagalaw at siyang
  salo), `stickerQrMatrix(handle, code)`; `src/lib/qr.ts` (dagdag na function para sa mga segment — §8.2).
- Daan ng code: `data.ts`, `useLiveFeed.ts` (comment + Pin), `pinToPrint.ts:61-76`, `useOrders.ts:225` (tatak sa order; **N3:
  kung walang code ang comment, ang code ng parehong TikTok username sa session**) at `:68-96`
  (`platform_meta.bq`), `useSessionWindow.ts:132/:183` (`bq` lang ang pipiliin), `lib/orderLogic.ts:66-82` + rebuild,
  `reprint.ts:36-47`, `ordersSearch.ts:44-66`, `pastSessions.ts`, `raffle.ts:99-110`, `Print.tsx`.
- Printing: ang 4 na lugar ng QR at mga gate (§8.1).
- Parcel Scan: `parcelScan.ts`, `fmScan.ts`, BAGO `buyerQrLookup.ts`, `parcelDrafts.ts`, `ParcelScan.tsx`,
  `FmParcelScan.tsx`, `CustomerDetails.tsx`, `FmCustomerDetails.tsx`. i18n × 8 wika.
- `featureAccess.ts`, `featureSwitches.ts`, `scripts/printing-paths.mjs`.
- Docs: `PRINTING_MAP.md`, `docs/support/sfl-guide.md` + `sql/116b`.


---

## 8. Printing (sinuri ng printer-guardian, ikatlong ikot — pinal na format)

Hatol: **"GAPS FOUND (7)"** — *tama ang talahanayan ng version; sa lahat ng tatlong paraan ay nananatili ang QR, ang 2 mm sa
kanan, at nababasa ang lumalabas sa bawat path na sinukat. P1 lang ang hindi nagbabago ng layout para sa 97.6% ng code
sticker.* Mga sukat: `docs/plans/buyer-qr-id-proof/guardian3-*.txt` — **sukat ng layout sa computer, hindi papel.**

### 8.1 Lahat ng lugar na gumagawa / gumuguhit / sumusukat ng QR [PATUNAY: file:line ng guardian; 4 pa rin ang tawag sa `qrMatrix`]
| # | Lugar | Mga tumatawag | Mga path |
|---|---|---|---|
| a | `stickerRaster.ts:1092-1118` `stickerQrPlacement` | `:1046`, `:1135`, **`stickerFit.ts:28`** (W5) | sticker ngayon: D520 70×50…100×60, 50×30, generic ≥ 70×50; babala ng "fit" |
| b | `stickerRaster.ts:1368-1383` `propQrPlacement` | `:1461/:1464`, `:1611/:1614`, at ang plano ng laki ng font `propPlanCjkSizes :1499` (mula `printing.ts:601`) | font C: generic 50×30/60×40, Niimbot, D520 compact v2 |
| c | `oneSticker.ts:295-298` `layoutSticker` | `:139`, `:152` (plano ng font), `:617` (pagguhit) | bagong sticker (lahat ng printer + laptop picture + preview) |
| d | `printing.ts:1260-1272` `webStickerQrSvg` | `:1330` | laptop/web HTML |

Mga gate: `imageStickerPayload` (`printing.ts:514-516`; tinatawag sa `:527`, `:611`, `:671`), `oneStickerInputFrom`
(`oneStickerPrint.ts:281-298`; tinatawag sa `printing.ts:741`, `:1412`). Display lang: `OneStickerPattern.tsx:47`,
`ExactStickerPreview.tsx:31`, `stickerPreview.ts`, mga tsek ng screen. Walang QR code sa native Java/Swift o sa `server/`.
- **W5:** ang `stickerFit.ts:28` ay hindi apektado — ang sample nitong buyer (`cristineramos`, 13 char) ay walang code, kaya
  link lang. Sinukat sa 162 setting: walang pagkakaiba sa babala kahit v4 ang totoong print. Labas doon: hindi napatunayan.
- Mga nagpi-print na gumagawa ng sariling buyer (dapat dalhin ang code): Pin to print (`pinToPrint.ts:61-76`), raffle
  (`raffle.ts:99-110`), Print stickers (`Print.tsx:29/32`), at tatlong ruta ng Reprint (`reprint.ts:36-47`,
  `ordersSearch.ts:44-66`, mga raw-row na ruta). Lahat ay dumadaan sa `printSlip`.

### 8.2 Ang babaguhin sa `src/lib/qr.ts` at ang iisang helper
- **Hindi gagalawin ang `qrMatrix(text, ecc)`** (`qr.ts:12-29`). Dagdag na function para sa mga segment na may takdang
  version. Suportado ng naka-pin na library (1.5.2, `qrcode.js:386-411`); iisang file na kasama na sa bundle. Sukat:
  1.5–2.0 ms bawat QR kasama ang mga bigong subok, synchronous → hindi apektado ang 35 s watchdog at ang 8 s na hintay.
- **Version ng pinal na format, haba 1–30** [PATUNAY: `guardian3-library-checks.txt`, tugma sa `qrsize-v5.output.txt`]:
  1–9 → v3 sa M · 10–20 → v3 sa L lang · 21–29 → v4 sa M · **30 → hindi kasya sa v4 sa M**.
- **`stickerQrMatrix(handle, code)`** — iisang may-ari ng text, segment, ECC at version:
  walang code, o code na hindi eksaktong 10 Crockford na malalaking titik, o username na "unknown" / may character na
  wala sa `a–z 0–9 . _` → `qrMatrix(tiktokProfileUrl(handle), "M")`, **eksaktong ngayon**; may wastong code → ayon sa
  napiling paraan (§3.4); **hindi kasya hanggang v4 → link lang, hindi kailanman "walang QR" at hindi kailanman v5**
  (ang 37 modules sa Niimbot 50×30 ay 225 dots laban sa 224 na frame → walang QR, `stickerRaster.ts:1379`).
- **Ang code ay nasa loob ng raster payload at ng `OneStickerInput`, hindi hiwalay na argument.** Ang font C ay
  naglalatag nang tatlong beses mula sa payload, at ang bagong sticker ay nagpaplano ng font bago gumuhit; kung hiwalay
  ang code, puwedeng magkaiba ang laki ng QR sa plano at sa print.
- Bawat lugar ay magpapasa ng **sarili nitong handle string** gaya ngayon (magkaiba ang paglilinis: `stickerRaster.ts:1097`,
  `:1371`, `printing.ts:1261`, `oneSticker.ts:294`).
- **Pang-emergency na patay:** isang flag sa module na gaya ng `stickerQrEntitled` (`printing.ts:131-135`, sine-set mula
  `RedesignApp.tsx:329`) — walang `await`. Inilalapat **isang beses**, sa itaas ng `printSlip` (`printing.ts:1277`) at ng
  `printStickerViaBluetooth` (para sa test entry). Lahat ng nagpi-print ay dumadaan doon.
- **Ang code ay hindi pumapasok sa JSON na ipinapadala sa native** (text sticker, WiFi sticker, slip): inihihiwalay sa
  parehong lugar, at **pangalawang kandado** — inaalis din ang key sa loob ng `buildNativeStickerPayload` at
  `buildSlipPayload` (lahat ng tawag sa native ay dumadaan doon). Test: byte-identical ang mga argument.

### 8.3 Epekto ng bawat paraan sa layout [PATUNAY bilang sukat ng guardian]
Sinukat: bagong sticker — 7 laki × D520, XP-420B, Flash, Niimbot, laptop × Buyer # 1× / 1.5× / 2× × username na 2, 6, 7,
9, 10, 13, 20, 21, 22, 24; sticker ngayon — 6 laki × D520 / generic / Niimbot × compact v2 on/off × maikli/mahabang comment.

**Totoo sa lahat ng tatlong paraan:** walang laking nawawalan ng QR (0 sa mga karaniwang laki; 0 sa 120 na custom na laki
kahit v4) · ang QR ay hindi kailanman mas malapit sa 16 dots (2 mm) sa kanang gilid (Niimbot 20) · D520 60×40 na walang
compact v2 ay walang QR gaya ngayon · walang QR sa ilalim ng 50×30 · XP-420B, Flash at laptop ay kapareho ng D520 ang
latag · na-decode ang naka-print na QR sa 648 / 648 (bago) at 1,020 / 1,020 (ngayon) na larawan (`jsQR`).

**Ilang kaso ang nag-iba sa layout ngayon** (bagong sticker / sticker ngayon):
| Username | % ng order | P1 | P2 | P3 |
|---|---|---|---|---|
| 1–6 (ngayon v2) | 1.7% | lahat nag-iba | lahat | lahat |
| 7–9 | 29.4% | **0 / 192, 0 / 72** | 0 / 192, 0 / 72 | 192 / 192, 68 / 72 |
| 10–20 | 68.0% | **0 / 288, 0 / 108** | 288 / 288, 102 / 108 | 288 / 288, 102 / 108 |
| 21–22 (ngayon v3) | 0.7% | lahat nag-iba | lahat | lahat |
| 23–24 (ngayon v4) | 0.3% | 0 / 96, 0 / 36 | pareho | pareho |

Sa **P1**, ang nagbabago lang kumpara ngayon ay ang username na 1–6 (3,029 rows, 1.7%) at 21–22 (1,227 rows, 0.7%) —
**97.6% ng code sticker ay kapareho ng layout ngayon**. Sa P2/P3, 69–100% ang nagbabago.

**Bagong sticker, username na 10–20: ngayon = P1 (v3) laban sa P2 = P3 (v4)**
| Laki | Buyer # | Ngayon = P1 | P2 = P3 | Ano ang nagbabago |
|---|---|---|---|---|
| 50×30 — D520 / XP / Flash / laptop | 1× | 6 tuldok, 21.8 mm | **5 tuldok**, 20.6 mm | tuldok 6 → 5 |
| 50×30 — Niimbot | 1× | 5 tuldok, 18.1 mm | 5 tuldok, 20.6 mm | mas makitid ang pangalan / @username |
| 50×40 — lahat | 1× | 4 tuldok, 14.5 mm | 4 tuldok, 16.5 mm | mas makitid ang text sa ilan |
| 60×40 — D520 / XP / Flash / laptop | 1× | 6 tuldok, 21.8 mm | 6 tuldok, 24.8 mm | mas makitid ang text |
| 60×40 — Niimbot | 1× | 6 tuldok, 21.8 mm | **5 tuldok**, 20.6 mm | tuldok 6 → 5 |
| 70×50, 80×60 | 1× | 6 tuldok, 21.8 mm | 6 tuldok, 24.8 mm | mas makitid ang text |
| 80×50, 100×60 | 1× | 6 tuldok, 21.8 mm | 6 tuldok, 24.8 mm | QR lang |
| 50×30 … 80×60 | 1.5× at 2× | 4 tuldok, 14.5 mm | 4 tuldok, 16.5 mm | Buyer # 3–5 tuldok na mas maliit (hal. 60×40: 87 → 82) |

- Ang v4 ay hindi nagpapababa ng tuldok mula 5 → 4 para sa username na 7–24.
- **Username na 1–6** (anumang paraan, dahil v2 sila ngayon): 50×40 sa 1× ay 5 → 4 tuldok; Niimbot 50×30 sa 1× at 80×50 sa
  1.5× ay 6 → 5. Sa P3, dagdag pa ang 50×30 (D520 / XP / Flash / laptop) at Niimbot 60×40.
- **Sticker ngayon, v4 laban sa v3:** hindi nagbabago ang tuldok (takdang 4 o 5); lumalaki ang kahon ng QR 14.5 → 16.5 mm
  (70×50 … 100×60) at 18.1 → 20.6 mm (50×30, font-C 60×40); **lumipat ang text sa bawat 50×30 at sa font-C 60×40**.
  Laptop: 18.5 → 20.5 mm. [Dalawang comment lang ang sinukat; ang iba ay hindi napatunayan.]

**Ang "Everything fits" ng Live print pattern sa P2/P3:** ang mga buyer ng pinakamasamang kaso nito ay may username na 2,
6, 11, 13, 14 at 17 character (`oneSticker.ts:523-532`) — walang v4. Sa 110 setting na sinubok, **2 ang nagsasabing
"Everything fits" habang lumiliit ang Buyer # sa totoong print** (Niimbot 50×30 at 60×40 sa Buyer # 1.3×); 20 sa 110 ang
magkaiba ang limit. **Sa P1, kapareho ng ngayon ang lahat ng 110.** Kapag P2 ang pinili, kailangang ayusin ang tsek na iyon
sa parehong branch. [Mga hakbang ng Buyer # lang ang sinubok.]

### 8.4 Payo ng guardian at ng plano
**I-print ang P1.** 97.6% ng code sticker ay eksaktong layout ngayon; nananatiling totoo ang preview, ang "Everything fits"
at ang babala ng `stickerFit`; nananatili ang 6-tuldok na module sa 50×30, ang pinakamasikip. Ang P3 ay talo ng P2 (pinaliliit
nito ang module o text ng 29.4% na kasya na sa v3-M). **Kung ipakita ng papel na masyadong marupok ang v3-L → P2**, at saka
ayusin ang tsek ng screen sa parehong branch. Papel lang ang makakapagsabi: kung nakakayanan ng v3-L ang totoong depekto ng
thermal; kung nagbubukas ng TikTok app ang camera mula sa naka-print na 4-, 5- at 6-tuldok na QR; kung nababasa ng Android
ang mixed-mode sa Parcel Scan.

### 8.5 Kailan lumalabas ang QR ngayon — **hindi gagalawin** (sagot ni Jeff) [PATUNAY: file:line ng guardian]
| Path | Mga gate | Sumusunod sa @username? |
|---|---|---|
| Sticker ngayon (fixed-cell, 50×30) | taas > 40 mm o 50×30 (`stickerRaster.ts:1094`); "Print QR" ng device + Taiwan + hindi Facebook/Instagram/Shopee (`printing.ts:135-142`, `:515`); may username | Oo (`stickerRaster.ts:1096`) |
| Font C (generic 50×30/60×40, Niimbot, compact v2) | parehong mga flag (`:1369-1372`); dapat kasya sa taas | Oo (`:1370`) |
| Laptop (pahina ngayon) | "Print QR" + Taiwan, platform, may username (`printing.ts:1330`) | Oo |
| Bagong sticker (lahat ng printer + laptop) | sariling "Print QR", label ≥ 50×30, platform, may username (`oneSticker.ts:295`) | Hindi |

Ang code ay nakasakay lang sa QR na **lalabas na sana**.

### 8.6 Iba pa
- **Bagong app build: hindi kailangan** ayon sa code — lahat ng QR ay iginuguhit sa TypeScript. [HINDI PA NAPAPATUNAYAN sa device.]
- **Walang QR at hindi apektado:** text sticker, iOS WiFi sticker, slip, D520 60×40 na walang compact v2, bagong sticker na
  mas maliit sa 50×30, Facebook/Instagram/Shopee.
- **Lumang app sa isang phone:** nakakabasa ng username sa bagong QR. Kapag ito ang **nag-print** ng order na may code →
  QR ngayon (link lang). Posibleng magkaibang QR sa iisang buyer mula sa dalawang phone — parehong nababasa.
- **Ang pang-emergency na patay ay hindi agad:** ang mga switch ay binabasa isang beses bawat sign-in
  (`featureSwitches.ts:62-71`) — ang phone na nakabukas ay tuloy sa code hanggang buksan ulit. Ang mabilis na hinto ay
  ang server (bagong order). **Ang bigong basa ng switch ay itinatala bilang OFF** — link lang ang ipi-print ng phone na
  iyon sa buong session habang may code pa rin ang mga order nito (ligtas na direksyon). Kapag in-ON ang switch, ang phone
  na nakabukas na ay link muna ang ipi-print hanggang buksan ulit; ang Reprint pagkatapos ay code na.
- **Preview at test print:** walang sample code. Ang sample na username ay 29 modules din (P1). Lima sa 11 admin language
  sample ay 25 modules — admin lang; isusulat sa `PRINTING_MAP.md`. **Ang test print ay walang code.**
- Mga test na **hindi dapat gumalaw** para sa order na walang code: `qr.test.ts`, `stickerRasterPropGoldens.json`,
  `fixtures/*.json`, `v2TestSticker.golden`, `stickerSpacing.offPins`, mga golden ng `escposRaster`/`cpclRaster`,
  `oneSticker.switches`/`onePlace`/`parity`, `printing.test.ts`, `tspl.test.ts` at ang mga native golden.
- `scripts/printing-paths.mjs:3-15`: idadagdag ang `src/lib/qr.ts`, `src/lib/tiktokHandle.ts` at ang bagong helper.
  `PRINTING_MAP.md` ia-update sa parehong branch.
- **Labas sa saklaw (Tanong 3):** kung palitan ng `https://www.tiktok.com/@u` ang link ng sticker **ngayon**, magbabago ang
  version ng username na 3–6 (v2 → v3: 3,029 rows, 1.7%) **at** 19–22 (v3 → v4: 3,667 rows, 2.1%) — kabuuang 3.8%. (Itinama
  ako ng guardian: 2.1% lang ang nasabi ko.) Maraming test at golden ang naka-pin sa kasalukuyang text.

### 8.7 Paper test para kay Jeff — **ito ang susunod na kailangan**
**Kailangan muna (Hakbang 2):** isang paraan na **admin lang** para pilitin ang v3-L o v4-M sa isang test order — kung wala
nito, hindi maipi-print ang paghahambing. (O isang pahina ng mga test QR na ipi-print mula sa laptop — Tanong 1.)
Totoong order, hindi Printer Test (walang code ang test print). I-scan ang bawat sticker sa **apat na paraan: iPhone sa
Parcel Scan · Samsung sa Parcel Scan · camera ng iPhone · camera ng Samsung.** Ang camera ay dapat **diretso sa TikTok app**.

| Printer | Mga laki | Sticker |
|---|---|---|
| AIMO D520BT | 50×30, 70×50, 100×60 | bago; ngayon sa 50×30 at 100×60 |
| Xprinter XP-420B | 50×40, 60×40 | bago; ngayon sa 60×40 |
| Flash Y41BT | 50×40 | bago |
| Niimbot B1 / B21 | 50×30 | bago at ngayon |
| Laptop (Windows kiosk + Chrome) | isang laki | bagong larawan at pahina ngayon |

Sa bawat hanay, username na: **5 o 6 · 9 (huling v3-M) · 10 (unang v3-L) · 20 (huling v3) · 21 (unang v4) · 24**; tapos ang
**10 at 20 ulit, pinilit sa v4-M** — 8 sticker bawat hanay.
Dagdag: (1) Buyer # na 1.5× sa D520 50×30 at XP-420B 60×40, username 10 at 20, v3-L at v4-M. (2) **Sira, v3-L katabi ng
v4-M**, username 13 at 20, sa D520 50×30, XP-420B 50×40 at Niimbot 50×30: tupi sa QR · gasgas ng kuko ayon sa labas ng papel
· tape sa ibabaw · kupas o kiniskis · sticker sa nakabaluktot na supot. (3) Isang sticker ng order na walang code bawat
printer — dapat mukhang at nababasa gaya ngayon. (4) Kung maaari: isang Android na hindi Samsung, at isang phone na walang
TikTok app.


---

## 9. Mga release

### 9.1 PHASE 0 — hiwalay na unang release (H4). Spec lang; hindi pa ginagawa.
**Layunin:** patunayan sa totoong live na may wastong TikTok `userId` ang mga comment, at matatag ito, **bago** ang SQL,
ang app at ang printing. **Walang nakikitang pagbabago** ang sinuman.

**Saklaw:** server lang (manual Render deploy sa tahimik na oras, may Business Pulse check). Walang SQL, walang web deploy.

**Ang ginagawa:**
1. Naka-OFF ang gate (nakapirmi sa code sa Phase 0; walang binabasang switch, walang SQL na kailangan).
2. Kinukuwenta ang code sa `try/catch` sa apat na daan — live, "earlier comments", reuse re-emit (lahat sa
   `emitCommentScoped`) at Pin — mula sa UUID `sellerId`. Ang palya ng kuwenta ay hindi kailanman pumipigil sa padala.
3. **WALANG bagong field na ipinapadala.** Test: ang payload na lumalabas sa bawat daan ay **kapareho ng ngayon**
   (parehong mga key at value), at walang pribadong field o `userId` na nakakalusot.
4. **Bilang lang**, bawat daan (live · earlier comments · Pin): `total` · `valid` (`^[1-9]\d{5,24}$`) · `zero` (`"0"`)
   · `wala` (walang field o blangko) · `mali` (iba pa). **Ang reuse re-emit ay binibilang nang hiwalay** at **hindi
   kasama sa `total`** (inuulit lang nito ang hanggang 20 comment sa bawat pindot ng Connect).
5. **Mga tsek ng katatagan sa memory lang** — nasa module ng kuwenta, naka-susi sa connection (seller + TikTok
   account), may takdang laki, **nabubura sa bawat bagong connection** (pati sa reconnect ng health cycle):
   - `handleMultiCode` — iisang username na nakitaan ng higit sa isang code (**hindi kasama** ang blangko at ang
     "unknown", ang pamalit ng server kapag walang username, `server.js:1783`);
   - `codeMultiHandle` — iisang code na nakitaan ng higit sa isang username;
   - `pinMatch` / `pinMismatch` / **`pinWalangKatapat`** — ang code ng Pin kumpara sa code ng parehong comment sa live
     (sa `msgId`). Ang pin ng lumang comment ay walang katapat — **binibilang nang hiwalay**, kung hindi ay papasa ang
     "`pinMismatch` = 0" kahit walang naihambing;
   - `initialVsLive` — parehong username sa "earlier comments" at sa live: pareho / magkaiba / **isa ay walang wastong ID**.
6. **Log (N10):** isang summary line bawat connection bawat 10 minuto — **pinagsamang bilang lang, hindi kailanman isang
   linya bawat comment**, pati **oras ng kuwenta (kabuuan at
   pinakamatagal)** para masukat ang "walang dagdag na bagal". **Walang username, `userId`, code o pangalan**; ang
   connection ay tinutukoy ng numerong sunod-sunod; ang seller ay tinutukoy ng **maikling token na hindi nagbabago sa
   restart** (unang 6 na hex ng `sha256` ng UUID niya — hindi username, hindi email) para mabilang ang "≥ 5 seller" sa loob
   ng 3 araw kahit mag-restart ang Render. Walang timer: ang linya ay isinusulat kapag may dumating na comment at lumipas
   na ang 10 minuto, **at sa disconnect** (para hindi mawala ang huling bahagi).

**Mga test bago i-deploy:** `node --check server.js`; vitest ng `server/buyerQr.js` (kuwenta, tsek ng `userId`, mga
bilang, limitasyon ng memory); **ang purong function: lumalabas = pumasok na walang pribadong field, para sa TikTok;
Facebook / Shopee / Instagram = hindi nagalaw; hindi binabago ang orihinal na object** (kaya may ID pa rin ang ring);
source-contract test (§4.1); sadyang error sa kuwenta → tuloy ang comment; ang mga
umiiral na suite ng relay (`initialComments`, `pinRelay`, `sanitize`, `connectionHealth`) ay berde at hindi binago.

**Exit (lahat dapat totoo):** ≥ 3 araw · ≥ 5 seller · ≥ 20,000 comment · **≥ 20 pin na may katapat sa live**
(`pinMatch` + `pinMismatch` ≥ 20 — sagot ni Jeff) · `valid` ≥ 99.5% sa live at ≥ 99% sa pin · `handleMultiCode` = 0 ·
`pinMismatch` = 0 · walang dagdag na error o bagal (Render log, at ang oras ng kuwenta sa summary line).
**Hindi naabot → hinto, balik kay Jeff.**

**Rollback:** Render one-click rollback. Walang data na naisulat.

**Hindi sinasagot ng Phase 0** (tapat): kung hindi nagbabago ang `userId` kapag nagpalit ng username (kailangan ng
naka-save na code sa maraming araw — Phase 2); papel at camera sa totoong sticker (§8.7).

### 9.2 Pagkatapos ng Phase 0 (bawat isa ay sariling release at sariling audit)
| Phase | Ano | Sino ang apektado | Patunay bago umusad |
|---|---|---|---|
| Papel | Mga test sticker ng §8.7 — kailangan ng paraang admin lang para pilitin ang v3-L / v4-M (o pahina ng mga test QR); walang deploy sa mga seller | Wala | Napili ang P1 o P2; camera sa totoong sticker → TikTok app sa iPhone at Samsung |
| 1 | SQL (additive) | Wala | PGlite script; `get_advisors`; palyang trigger ay hindi pumipigil sa save o sa bura; **pagbura ng test account mula umpisa hanggang dulo** |
| 1b | **Pangalawang release ng server** (manual Render deploy, tahimik na oras): babasahin na ang gate at ilalagay ang `buyerQr` sa comment at sa Pin ng mga pinapayagan. **Ito ang unang pagbabago sa ipinapadala ng relay** — sariling audit | Wala pa (walang may key; OFF ang switch) | Payload ng hindi pinapayagan = ngayon; walang dagdag na `await` sa daan ng comment; walang timer na naiiwan (N6) |
| 2 | Web deploy; feature key ni **Jeff at ng team niya**: may code na ang comment nila, at ang Scan QR nila ay gumagamit ng lookup | mga account ng team | Totoong order sa papel; parehong code sa live / earlier comments / Pin / Reprint; test account na nagpalit ng username → parehong code |
| 3 | `buyer_qr_scan_enabled` = ON (lahat ng may Parcel Scan: Scan QR ay naghahanap na rin sa Customers sa username) | lahat ng may Parcel Scan | Bilang ng berde / dilaw bawat dahilan / mensahe; walang ulat ng maling punô |
| 4 | `buyer_qr_id_enabled` = ON | Taiwan + Parcel Scan (93 seller ngayon, Q13) | — |

**Pataas:** server (Phase 0) → SQL → server (1b) → web → feature key → `scan` → `id`. **Pababa:** `id` OFF (≈ 1 minuto sa bagong comment; Reprint: sa susunod na
bukas ng app) → `scan` OFF (sa susunod na bukas ng app) → web rollback → SQL rollback. **Ang SQL rollback (N7):** iniiwan
ang mga column ng parcel (may mga phone na may lumang JS na nagpapadala pa nito); ang pag-alis ng `buyer_qr_details` ay
**bumubura ng lahat ng naka-save na details ng QR** — ita-type ulit kapag in-on muli; ang mga code ay naiiwan sa parcel
at sa order rows hanggang ma-purge (walang personal na data). Huling hakbang lang ito.

---

## 10. MGA BUTAS AT CONFLICT

"Ayos" = gagawin sa Hakbang 2. Wala pang napatunayan sa mga ito; bawat isa ay may test sa §11.

### A. Format ng QR at printing
| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| A1 | **Hindi nagbubukas ang TikTok app mula sa totoong sticker** | Ang screen test ni Jeff ay pumasa; ang papel, ibang Android, at phone na walang TikTok app ay hindi pa nasubok | Camera test sa totoong sticker (§8.7) **bago** ang Phase 2; pang-emergency na patay (§6.2) |
| A2 | **68% ng code sticker ay nasa ECC L (P1), o 69% ay mas malaking QR (P2)** | Ang `www.` at maliliit na titik ay kumakain ng lugar (§3.2) | Paper test na v3-L laban sa v4-M (§8.7); papel ang magpapasya |
| A3 | Hindi nababasa ng Android ang mixed-mode | `BarcodeDetector` ay hindi nasubok | Paper test; kung palya → `jsQR` muna sa Android (parehong library ng iPhone) |
| A4 | **Walang QR sa sticker** dahil sa sirang code o sobrang haba | Ang library ay nagta-throw; ang `catch` ngayon ay "walang QR" | Helper na laging bumabalik sa link lang (§8.2); test |
| A5 | Gumalaw ang print ng **walang** code (ibang seller/bansa) | Pagbabago sa `qr.ts` o sa pagpasa ng handle | `qrMatrix` hindi ginagalaw; bawat lugar ay sariling handle; mga golden na hindi dapat gumalaw (§8.6) |
| A6 | Ibang QR sa Reprint / Pin / raffle / Print stickers | Mga rutang nagtatapon ng di-kilalang field | Dalhin ang code sa lahat (§7); test na iisang order → iisang QR |
| A7 | Code sa JSON ng text sticker / slip | Nakasakay sa buyer object | Ihiwalay bago ang native; byte-identical na test |
| A8 | Maikling username (1–6): mas malaking QR; mas maliit na tuldok sa 50×40 at Niimbot 50×30 | 25 → 29 modules | Tanggapin (kapareho ng karaniwan ngayon); kasama sa paper test |
| A9 | QR na sumusunod sa @username sa sticker ngayon pero hindi sa bagong sticker (N4) | Umiiral na pagkakaiba | Hindi gagalawin — sagot ni Jeff (§8.5) |
| A10 | Lumang app na nag-print ng order na may code | Phone na hindi pa nare-refresh | Link lang ang QR nito (gaya ngayon) — nababasa sa username |
| A11 | Nakikita ng TikTok ang code | Bahagi ng link | Tanggap (walang personal na data); nakasulat sa §8.6 |
| A12 | Problema sa link pagkatapos ng rollout | Nagbago ang ugali ng TikTok o ng camera | Pang-emergency na patay na sumasakop din sa Reprint (§6.2); ang parser ngayon ay laging nakakabasa ng username sa anumang link ng TikTok. Ang **code** lang ang hindi na mababago |
| A13 | **Parehong buyer, code QR at link QR sa iisang live (N3)** | Comment bago sumagot ang gate; lumang app; order na walang TikTok ID | Code ng parehong username sa session (§6.2); parehong nababasa |
| A14 | Username na 21–24: laging mas malaking QR | Hindi kasya sa v3 (§3.2) | 0.9% ng order; kasama sa paper test |

### B. Maling tao / maling address
| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| B1 | **Maraming buyer, iisang code** | `userId` na `"0"`/blangko | Mahigpit na tsek; Phase 0 binibilang |
| B2 | Dalawang buyer na nagkapareho ng 50-bit na code | Pagkakataon (§3.3) | Pangalawang bantay: username ng sticker na hindi pa nakikita para sa code → dilaw |
| B3 | Code ni A + details ni B ang na-save | Nag-scan, tapos nag-type ng iba | Chip; tanong na "Papalitan ang details ni @x?"; ang susunod na tamang Save ang nagtutuwid (H1). **Hindi lubusang maaalis** |
| B4 | Maling kabit dahil sa timing | Late na sagot; draft; `await` sa Save; Import | §6.2 (mga tuntunin) + test sa bawat isa |
| B5 | Username na ginamit na ng ibang tao (N1) | Bagong tao, lumang username | Ibang code → dilaw sa unang scan; berde pagkatapos ng isang Save — **tinanggap ni Jeff** (§6.1) |
| B6 | Bumibili para sa ibang tao / dalawang store (H3) | Parehong code, magkaibang tumatanggap | Dilaw + pagpipilian mula sa **huling 5 na-save na nasa tala mismo** (hindi nawawala sa Clear exported) |
| B7 | Lumang parcel na in-edit o nahatulan | Trigger sa UPDATE | `source_parcel_id` + `created_at`; gumagalaw lang kapag may talagang nagbago |
| B8 | Maling store na kusang napupunan | Typo sa unang save | Dilaw "Mali ang store noong huli" kapag may hatol; ang bawat bagong parcel ay sinusuri pa rin |
| B9 | Binura sa Customers pero lumalabas pa | Dalawang lugar ng details; maraming row bawat buyer | Trigger sa Customers: `customer_id`, o phone + pangalan, o username na nasa `qr_handles` (§5.1-4). **Limitasyon:** contact na hindi TikTok at walang `customer_id` (parcel na walang phone) ay hindi matutunton |
| B12 | Restricted na phone na berde pa rin | Ang row sa Customers ay wala o napalitan ang pangalan, kaya walang nabura | Binabasa rin ng lookup ang hatol ng phone ng pinagmulang parcel → dilaw (§6.1) |
| B13 | Tala na walang phone o store na lumalabas na berde | Scan-confirm na daan | Dilaw "Kulang ang details" (§6.1) |
| B14 | Papalit-palit na dilaw pagkatapos magpalit ng username | Lumang at bagong sticker ng parehong buyer | Listahan ng mga username na nakita na para sa code (§5.1-2) |
| B10 | Naibalik ang nilinis na tala | Kasunod na UPDATE ng parehong parcel | Gumagalaw lang kapag may nagbago sa mga field ng buyer; ang edit ng encoder sa pinagmulang parcel ay sadyang nagbabalik (bumabalik din sa Customers ngayon) |
| B11 | Pagbura ng **na-export** na pinagmulang parcel na mali | Hindi nililinis ang tala (H2: hindi kasama ang na-export) | Ang susunod na Save ang nagtutuwid; o bura sa Customers |

### C. Server at database
| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| C1 | Walang wastong `userId` sa production, o sa Pin | Iba ang totoong hugis ng data | Phase 0 (§9.1) |
| C2 | Email ang nagamit na key sa isang daan (W2) | "Earlier comments" ay email ang dala (`server.js:1711`) | Kuwenta sa `emitCommentScoped` lang, mula sa UUID (§4.1); Phase 0: `initialVsLive` |
| C3 | Lumabas ang hilaw na `userId` sa app | Pribadong field na hindi naalis | Purong function na gumagawa ng bagong object; test + source-contract test (§4.1) |
| C13 | Nagalaw ang relay ng Facebook / Shopee / Instagram | Iisang `emitCommentScoped` ang gamit nila | Bantay na `platform === "TikTok"`; test na hindi nagalaw ang iba |
| C14 | Nawalan ng ID ang reuse re-emit | Binago ang orihinal na object na nasa ring | Hindi binabago ang orihinal (§4.1); test |
| C15 | Nililinis ng purge o ng pagbura ng account ang mga tala | `AFTER DELETE` na tumatakbo sa bawat row | Gumagalaw lang kapag ang seller mismo ang nagbura (§5.1-3); test ng 180-araw na purge at ng buong pagbura ng account |
| C16 | Nakaligtaang release ng server | Phase 0 ay naka-pirmi ang gate | Phase 1b (§9.2) |
| C4 | Sacred zone: relay ng comment | Dagdag sa `emitCommentScoped` | `try/catch`; walang `await` na idinadagdag sa daan ng comment; sariling audit; Phase 0 muna |
| C5 | Gate na mali ang sagot, o tumutulo ang memory (W3, N6) | Bagong code ito; lumang cache; palyang basa; cache na hindi naaalis | Palya = walang code; ~60 s bawat seller; **walang timer**; inaalis sa disconnect; maagang basa sa `/connect` (§4.3). [HINDI PA NAPAPATUNAYAN] |
| C6 | Trigger na pumipigil sa save | Bug, lock, timeout | Maliit, `EXCEPTION`, `lock_timeout`; PGlite na may sadyang error |
| C7 | Trigger sa Customers na nagpapabagal o pumipigil sa bura | Bagong `AFTER DELETE` | Isang `UPDATE` na may index; `EXCEPTION`; PGlite |
| C8 | Pekeng tala mula sa browser | Diretsong sulat | Walang INSERT/UPDATE/DELETE policy |
| C9 | Admin na nakakakita ng data ng iba | RLS na "own OR admin" sa ibang table | Tahasang `auth.uid()` sa RPC; contract test |
| C10 | Bagal / egress | Lookup (index sa code); `bq` sa session load (~15 bytes bawat TikTok order row); +~15 bytes bawat comment | `EXPLAIN ANALYZE` sa Hakbang 2. [HINDI PA NAPAPATUNAYAN] |
| C11 | Mga live na function na nag-a-UPDATE sa `parcel_scans` | 6 ang nakita (Q14) | Babasahin ang bawat isa sa Hakbang 2; ang "may nagbago" na tuntunin ang bantay |
| C12 | SQL rollback habang may lumang JS | — | Iniiwan ang mga column |

---

## 11. Listahan ng test

### 11.1 Rule / sagot → test na babagsak kapag nasira
| Rule | Test |
|---|---|
| Iisang permanenteng code; TikTok lang | Server: parehong (UUID, userId) → parehong code; ibang username → pareho pa rin; `"0"`, blangko, wala, may titik → walang code; **parehong code sa live, earlier comments, reuse at Pin**. Facebook/Shopee/Instagram → walang code |
| Format (camera test) | Helper: text = `https://www.tiktok.com/@x?CODE` — **walang malaking titik sa link**; version at ECC ayon sa napiling paraan (§3.4) para sa bawat haba 1–24; na-decode = eksaktong text. Parser: ang 16 na halimbawa ng §3.6 + bawat haba; parser ngayon → username. (Camera: §8.7, si Jeff) |
| Sagot 3: iba = eksaktong ngayon | Walang code → matrix = `qrMatrix(url,"M")` para sa haba 1–30; lahat ng golden/hash sa §8.6 ay hindi gumalaw; gate ng server: hindi TW / walang Parcel Scan / expired / walang switch at key → walang `buyerQr` |
| Sagot 5: huling na-save | Bawat isang field na in-edit (pangalan / phone / store / contact / platform / "no contact") → susunod na lookup = bago, sa 7-11 at FM; LINE/WhatsApp na contact ay buo pagkatapos ng scan + Save; mungkahi ay hindi kusang inilalapat |
| Sagot 6: bura sa Customers | PGlite: bura ng row sa Customers → nilinis ang tala (pati sa "restricted" na rule); **edit** sa Customers → hindi gumalaw ang tala |
| S4: hiwalay ang carrier | Tala ng 7-11 ay hindi lumalabas sa FM at baliktad; walang kinokopya |
| H1 / S2 | Walang `buyer_qr_forget`; bilang user: `INSERT`/`UPDATE`/`DELETE` sa `buyer_qr_details` = tinanggihan |
| H2 | ✕ sa pinagmulang parcel → nilinis; bura ng pinagmulang parcel na hindi pa na-export → nilinis; **Clear exported at purge → hindi gumalaw**; mas lumang parcel → hindi nagbabalik |
| H3 (sagot: nasa tala) | 2 store sa huling 5 na-save → dilaw + pagpipilian, pinakabago ang naka-pili; **pagkatapos ng Clear exported → dilaw pa rin**; 5 magkakasunod na save sa iisang store → berde; edit ng pinagmulang parcel → ina-update ang pinakabagong hanay; laging may "huling ginamit" |
| N1 (dilaw → berde) | Parehong username, ibang code, may tugma sa Customers → dilaw sa unang scan; pagkatapos ng Save → berde |
| N3 | Order na walang code + parehong TikTok buyer sa session na may code → parehong code, nakatatak sa order at row; ibang username, "unknown", blangko, Facebook/Shopee na kapangalan → wala; **wala nang dumarating na code → wala** |
| N6 | Walang timer ng gate; **hindi nawawala ang code ng account B kapag nag-reconnect ang account A**; basa ay nagsisimula sa `connectTikTok` at `startTikTokConnection`; **walang `await` na idinagdag sa pagitan ng `connect()` at ng mga listener** (source-contract); palyang refresh → dating sagot, walang unhandled rejection |
| N9 | Facebook / Shopee / Instagram na payload → hindi nagalaw |
| N2 | ⇄ at pagbalik → form **at** code ay naibalik; ang kabilang carrier ay walang code at walang napuno; "hold" → pareho nabura |
| S1 | Bawat hanay ng §6.1 → tamang klase ng resulta; isang dahilan lang ang ipinapakita |
| S3 | Preview at test print = QR ngayon; walang code |
| Lumang sticker | URL at hubad na username → username + hanap sa Customers; mga umiiral na test ng `handleFromQrPayload` ay hindi ginagalaw |

### 11.2 Mga butas → test
A4: sirang code / username na 30+ char / "unknown" → link lang, hindi "walang QR" at hindi v5. A6: iisang order → parehong matrix sa 1-Click / Enterprise /
Auto / 3 ruta ng Reprint / Pin / raffle / Print stickers / laptop (sa parehong estado ng switch — ang phone na nakabukas
bago in-ON ang switch ay link muna hanggang buksan ulit). A7: argument ng `printStickerNative` /
`printStickerLan` / `printSlip` ay byte-identical. B2: tugmang code + ibang username → dilaw. B3: tanong bago mag-Save.
B4: late na sagot ay itinatapon; Save naka-block; code sa pindot; Import → malinis ang form at chip. B7/B10: UPDATE na
walang nagbago → walang sulat; export ng 70 row → walang sulat. C3: walang pribadong field sa anumang padala. C6/C7:
sadyang error at naka-lock na row → tuloy ang save / bura. C8/C9: RLS at contract test. C12: rollback script → naka-save
pa rin ang parcel na may `buyer_qr_id`. "OFF = ngayon": `scan` OFF at walang key → DOM ng Parcel Scan = ngayon, walang
tawag sa lookup, walang `buyer_qr_id` sa save.

Mula sa audit ng v4: purge ng 180 araw at pagbura ng account (buo) → hindi nililinis ang mga tala at hindi bumabagsak;
bura ng row sa Customers na ibang row pero parehong username → nilinis; restricted na phone ng pinagmulang parcel →
dilaw; tala na walang store → dilaw; lumang username na nakita na → hindi nagpapadilaw ulit; ✕ sa edit → `null` sa
dalawang column; Import na may code → may tanong at may `buyer_qr_handle`; ⇄ at pagbalik → gumagana pa ang tanong;
pang-emergency na patay → Reprint ng order na may code = link lang;
SQL gate kumpara sa tuntunin ng app (talahanayan); Facebook/Shopee/Instagram na payload → hindi nagalaw; ring → may ID pa rin.

Mula sa ikalimang ikot: `recent` — edit ng mas lumang parcel → na-update ang hanay nito; bura ng parcel na hindi pa
na-export → naalis ang hanay; blangkong store → hindi binibilang; lumipat ng store → dilaw ×4, berde sa ika-5; tala na iba
sa row sa Customers → dilaw. Prayoridad ng dilaw: restricted / maling store ang una. Parser: ang 22 halimbawa (may
bagong-linya, espasyo, `#x`, `/?`, walang scheme); code na maliliit na titik → username lang. Trigger sa Customers: may
JWT → nililinis; walang JWT (pagbura ng account) → walang ginagawa. Helper: code sa loob ng payload → parehong laki ng QR
sa plano ng font at sa print (font C at bagong sticker).

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
- (v5) Walang bagong query sa database; ang sukat ng pinal na format ay mula sa Q12.
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

### 13.2 Printer-guardian, ikalawang ikot (link + code, bago ang camera test) — 6 na kulang
| # | Nakita | Ayos |
|---|---|---|
| 1 | Sirang code / sobrang haba → walang QR, walang babala | Helper na bumabalik sa link lang (§8.2), A4 |
| 2 | Baka hindi magbukas ang TikTok sa camera dahil sa malalaking titik | **Nangyari nga sa Samsung** (§2.1) → pinal na format ay maliliit na titik na may `www.` |
| 3 | Mahabang username: mas mahinang QR sa gasgas | Paper test v3-L vs v4-M (§8.7), A2 |
| 4 | QR na sumusunod sa @username sa sticker ngayon, hindi sa bago | Hindi gagalawin — sagot ni Jeff; A9 |
| 5 | 5 admin sample ay mas maliit ang QR kaysa totoong order | Iiwan, isusulat sa mapa (§8.6) |
| 6 | QR files na wala sa printing gate | `printing-paths.mjs` (§8.6) |
**Hindi napatunayan ng guardian:** `BarcodeDetector` sa mixed-mode; tibay ng ECC L sa thermal
na papel; ESC/POS at CPCL sa hardware.

### 13.3 Pangatlong audit → saan inayos (kumpleto na ang teksto)
| ID | Nakita | Ayos sa v5 |
|---|---|---|
| H1 | Alisin ang "Hindi ito ang buyer" / `buyer_qr_forget` / DELETE policy | Inalis — §5.1-2, §6.2 |
| H2 | `source_parcel_id`; inalis ang code o binura ang pinagmulang parcel → i-clear; hindi kasama ang Clear exported | §5.1-3 |
| H3 | Higit sa isang phone/store → dilaw + pagpipilian; laging "huling ginamit" | §5.1-2 (`recent`, nasa tala mismo — sagot ni Jeff), §6.1 |
| H4 | Phase 0 bilang hiwalay na unang release | §9.1 |
| W2 | Kuwenta mula sa UUID sa lahat ng 4 na daan, hindi email | §4.1–4.2 |
| W3 | Maling pahayag: walang naka-cache na basa ng feature key bawat seller sa server (`helpBotAllowed` iyon, query bawat request); `fb_enabled` lang ang may 60 s na cache | **Itinama** — §4.3. Sinuri ko: `server.js:1081-1088`; `server/fbAccess.js:13`, `:24`, `:55`. Bagong code ang gate |
| W4 | Magkasalungat: DELETE policy vs "hindi binubura ang rows"; `CHECK` vs "walang CHECK" | **Itinama** — iisa na ang sinasabi: **walang DELETE policy, nililinis lang ang row, walang `CHECK`** (§5.1-1, §5.1-2) |
| W5 | `stickerFit.ts:28` ay tumatawag din ng `stickerQrPlacement` at wala sa listahan | **Idinagdag** — §8.1. Sinuri ko: sample na username `cristineramos`, 13 char (`stickerFit.ts:11`) |
| N1 | Username na ginamit ng ibang tao | §6.1 (dilaw sa unang scan; berde pagkatapos ng Save — tinanggap ni Jeff) |
| N2 | ⇄ draft dala ang code | §6.2 |
| N3 | Order na walang code → code QR at link QR sa iisang live | §6.2: code ng parehong username sa session. **Hindi ko nahanap** sa code ang "Manual / Type price na walang comment" — Tanong 2 |
| N4 | QR lalabas lang kapag naka-ON ang "Print QR" at nakikita ang @username | **Hindi gagalawin** (sagot ni Jeff) — §8.5 |
| N5 | Na-purge ang order rows → walang makukuha ang lookup ng username at ang mungkahi | Hindi na tumatama: ang username ay galing sa mismong QR (§6.1). Isinulat |
| N6 | Timer ng gate ay dapat huminto kapag walang connection; simulan ang basa sa `/connect` | §4.3 (walang timer; maagang basa) |
| N7 | Rollback: ang pag-alis ng table ay bumubura ng lahat ng details; ang mga code ay naiiwan | §5.2, §9.2 (isinulat nang tapat) |
| N8 | Import ay isa-isa → ligtas dalhin ang code; `buyer_qr_via` kailangan ng `'customers'` | §6.2 (Import). Ang `buyer_qr_via` ay **wala na sa plano** (walang ugaling nakadepende rito); `customers` ay isa sa tatlong value sa analytics lang (§5.1-1) — **Tanong 4** kung gusto mong itala ito sa database |
| N9 | TikTok lang sa `emitCommentScoped` | §4.1 |
| N10 | HMAC ay microseconds; log ay pinagsamang bilang | §4.1, §9.1 |
| S1–S6 | 3 resulta · walang DELETE policy · walang sample code · hiwalay ang carrier · bura sa Customers = bura · iisang lugar sa server + Pin | §6.1 · §5.1-2 · §6.2 · §5.2 · §5.1-4 · §4.1–4.2 |

### 13.4 Audit ng v4 (hiwalay na reviewer) — 12 nakita (3 HIGH), lahat isinama
Sinuri ko muna sa code ang tatlong mabigat: ang purge (`sql/65:38-41`), ang mga tumatawag sa `emitCommentScoped`
(`server.js:1719/1820/2051/2288/2545/2740/2808`), at ang paggamit ulit ng parehong object sa ring (`:1719-1724`).
| # | Bigat | Nakita | Ayos |
|---|---|---|---|
| 1 | HIGH | **Maling pahayag:** ang purge ay nagbubura rin ng hindi na-export na parcel (180 araw); pagbura ng account ay tumatakbo rin sa trigger | §5.1-3 (itinama; seller mismo ang nagbura), C15 |
| 2 | HIGH | Nawawalang release ng server sa pagitan ng SQL at web | §9.2 Phase 1b, C16 |
| 3 | HIGH/MED | `emitCommentScoped`: (a) pagbago ng object na nasa ring, (b) gamit din ng Facebook/Shopee/Instagram, (c) hindi masusubok kung hindi purong function | §4.1, C3, C13, C14 |
| 4 | MED | Mga bilang at exit ng Phase 0 na hindi nasusukat | §9.1 (itinama; nasagot ni Jeff ang tungkol sa pin) |
| 5 | MED | N1 "hindi kailanman berde" ay mali pagkatapos ng isang Save | §6.1 (itinama ang pahayag), B5 — tinanggap ni Jeff |
| 6 | MED | Sagot 6 ay hindi garantisado (pagkakasunod ng trigger; maraming row; restricted) | §5.1-3/4, §6.1, B9, B12 |
| 7 | MED | Ang patay ay hindi pumipigil sa Reprint | §6.2, A12 |
| 8 | MED | Mga paglihis / desisyong hindi naitanong (malalaking titik; admin at blangkong bansa; hanap sa Customers sa daloy (a); epekto ng pagbura; haba ng code) | §3.3, §4.3, §5.1-3; nasagot ni Jeff o nasa §14 (Tanong 5, 6) |
| 9 | MED/LOW | Berde na kulang ang tala; draft at ang tanong; Import; ✕ na tahasang `null` | §6.1, §6.2, B13 |
| 10 | LOW | Papalit-palit na dilaw | §5.1-2, B14 |
| 11 | LOW | Mga hindi tugmang teksto (simulation, §1.4, §8.2, mga bilang) | Itinama |
| 12 | LOW | Ang SQL gate ay inuulit ang tuntunin ng app | §4.3 (test na naghahambing) |
Mga pahayag ng v4 na sinuri ng reviewer at **tama**: mga numero ng §3 laban sa `qrsize.output.txt`; ang parser ngayon
ay bumabasa ng bagong link; lahat ng comment ay dumadaan sa `emitCommentScoped` na may UUID; hiwalay ang Pin;
"Clear exported" ay na-export lang ang binubura; ang mga edit ay hindi nagpapadala ng mga bagong column; ang laman ng
`parcelDrafts.ts` ngayon; walang prop ng code ang Import ngayon; gumagana ang lookup sa FamilyMart; kumpleto ang mga
item ng Phase 0 spec; walang nakitang daan na nagbabalik ng nilinis na tala mula sa mas lumang parcel.

Ang mga ayos sa 12 na ito ay ipinasuri sa ikalimang ikot (§13.5).

### 13.5 Ikalimang ikot (v5): ang mga ayos na hindi pa napasuri + ang pinal na format
**Hiwalay na reviewer — hatol sa 12 nakita niya sa v4:** 10 FIXED · 2 PARTLY (mga naiwang teksto; disenyo ng SQL gate) · 0
OPEN. **12 bagong nakita (2 HIGH)**, lahat isinama. Sinuri ko muna sa code ang dalawang mabigat: walang `await` sa pagitan
ng `connect()` at ng mga listener (`server.js:1630-1770`), at pinapanatili ng `createFbTesterReader` ang huling sagot kapag
nabigo (`fbAccess.js:70-73`).
| # | Bigat | Nakita | Ayos |
|---|---|---|---|
| 1 | HIGH | Ang "≤ 1 s na hintay bago ang earlier comments" ay magtatapon ng mga live na comment (wala pang listener) | **Tinanggal ang hintay** — §4.3 |
| 2 | HIGH/MED | "Inaalis ang cache sa disconnect" → nawawala ang code sa gitna ng live (maraming account; health reconnect) | Hindi inaalis; dating sagot habang nire-refresh — §4.3 |
| 3 | MED | Kulang ang spec ng gate at ng SQL function (walang `auth.uid()` sa service role) | §4.3 |
| 4 | MED | `recent`: hindi nakikita ang save na walang code; walang parcel id; blangko; "lumipat ng store" | §5.1-2, §5.1-5, §6.1 |
| 5 | MED | N3: puwedeng maling code ("unknown") o code na hindi na pinapayagan | §6.2 (mga bantay) |
| 6 | MED | Ang paper test ay para pa sa lumang format | §8.7 (isinulat muli) |
| 7 | MED/LOW | Trigger sa Customers habang binubura ang account | §5.1-4 |
| 8 | LOW/MED | Prayoridad ng dilaw: una dapat ang restricted / maling store | §6.1 |
| 9 | LOW | Parser: trim; aling bahagi ang case-insensitive; mga kaso; "unknown" | §3.6 + 6 na bagong halimbawa sa `qrsize-v5.output.txt` |
| 10 | LOW | Mga naiwang teksto at maling numero ng tanong | Itinama |
| 11 | LOW | Phase 0: numero ng seller na nagbabago sa restart; huling bahagi ng 10 minuto | §9.1 |
| 12 | LOW | Switch na binabasa sa bukas ng app → pansamantalang magkaibang QR | §8.6, §11.2 |
Mga pahayag ng v5 na sinuri niya at **tama**: mga numero ng §3 laban sa `qrsize-v5.output.txt`; ang mga halimbawa ng parser;
W3; mga tumatawag sa `emitCommentScoped`; N8; N7 at W4 (iisa na ang sinasabi saanman); N5; nasunod ang format at mga sagot
ni Jeff; mga sipi tungkol sa purge. Tumatama ang tuntunin ng pagbura sa bawat konteksto (app, Clear exported, cron,
pagbura ng account, checker).

**Printer-guardian, ikatlong ikot — 7 kulang**, lahat isinama sa §8: (1) "Everything fits" na mali sa P2/P3 → P1, o ayusin
ang tsek kapag P2; (2) sobrang habang username → walang QR sa Niimbot → hanggang v4 lang, tapos link; (3) hindi agad ang
patay sa nakabukas na phone → isinulat; (4) code sa JSON ng text sticker/slip → hiwalay + pangalawang kandado; (5) code na
hiwalay na argument → magkaibang laki sa plano at print → nasa loob ng payload; (6) walang paraan para i-print ang
paghahambing → admin-only na pagpili ng v3-L / v4-M; (7) QR files na wala sa printing gate. Itinama rin niya ang bilang ko
sa Tanong 3 (3.8%, hindi 2.1%).

**Tapat na kalagayan:** ang mga ayos sa ikalimang ikot (12 + 7) ay **hindi na muling ipinasuri**. Limang ikot na, at bawat
isa ay may nakitang mabigat — karamihan sa **server (§4)** at sa **mga trigger (§5)**, na parehong wala pang code. Ang
dalawang iyon ay dapat dumaan sa sariling audit sa Hakbang 2, kasama ang totoong code at PGlite. Hindi sinuri ng
sinuman: mga resulta ng query, mga live na function ng database, at ang camera test ni Jeff.

---

## 14. MGA TANONG PARA KAY JEFF

**Nasagot na** (v4): format ng link · tuntunin ng @username/QR (hindi gagalawin) · mahahabang username (papel) · "ilang
store" sa tala · dilaw→berde pagkatapos ng Save · admin at blangkong bansa · pin na may katapat sa live.

**Natitira:**
1. **Paper test (§8.7).** Ito ang susunod na kailangan: P1 laban sa P2 sa totoong papel, at camera sa totoong sticker.
   Paano mo gustong makuha ang mga test sticker — (a) gagawa ako ng maliit na pahina ng mga test QR na ipi-print mo mula
   sa laptop (mabilis, pero hindi dumadaan sa totoong daan ng printer ng phone), o (b) sa Hakbang 2: isang paraang admin
   lang para pilitin ang v3-L / v4-M sa totoong order ng account mo (kailangan ng code, pero iyon ang totoong print)?
2. **N3:** aling order ang "Manual / Type price na walang comment"? Sa code ngayon, lahat ng gumagawa ng order ay may
   comment (1-Click, Enterprise, Auto, Pin, waitlist). Kung may daan akong hindi nakita, pakituro.
3. **Labas sa saklaw, pero nakita sa test mo:** ang link ng sticker **ngayon** (`https://tiktok.com/…`, walang `www.`) ay
   "pabago-bago" sa Samsung. Gusto mo bang planuhin nang hiwalay ang paglipat ng lahat ng QR sa `https://www.tiktok.com/…`?
   (Babaguhin nito ang QR ng lahat ng seller, at lalaki ang QR ng username na 3–6 at 19–22 character — 3.8% ng order.)
4. **N8:** gusto mo bang itala sa database kung paano nakilala ang buyer sa bawat save (`qr` / `username` / `customers`)?
   Sa plano: sa analytics lang.
5. Daloy (a): kapag may code ang sticker pero wala pang tala, **hinahanap din sa Customers sa username** (dilaw kung may
   tugma). Ang sinabi mo ay "@username lang, gaya ngayon". Ayos ba ang dagdag na hanap?
6. Pagbura ng pinagmulang parcel na hindi pa na-export ay naglilinis ng buong tala kahit may mas lumang tamang parcel; ang
   pagbura ng **na-export** na parcel ay hindi. Ayos ba?
7. Kailangan bang banggitin sa Privacy Policy ang code sa QR (na nakikita rin ng TikTok kapag binuksan ang link) at ang
   bagong tala ng details?
8. Camera test "kahit anong bansa" at ibang Android (hindi Samsung): alin ang susubukan?
9. Mga salita sa screen (nasa mockup ay mungkahi lang, English muna).

---

## 15. Ano ang may patunay at ano ang HINDI PA

**May patunay (file:line / query / script output dito):**
- Mga katotohanan ng §1 (QR ngayon, Scan QR, Customers, walang `userId` sa relay/app/database).
- **Sukat ng pinal na format** laban sa totoong haba ng username: 31.1% sa v3-M, 68.0% sa v3-L lang, 0.9% ay v4; lahat ay
  kasya sa v4-M (`qrsize-v5.output.txt` §1–§2).
- Na-decode ng `jsQR` ang pinal na format sa bawat haba at ECC; ang iminumungkahing parser ay nagbabalik ng username +
  code; ang parser **ngayon** ay nagbabalik ng username mula sa bagong link (72 sa 72); 16 na halimbawa ng luma at bagong
  hugis (`qrsize-v5.output.txt` §3).
- Suportado ng naka-pin na library ang maraming segment; ang tawag ngayon ay byte-identical (`guardian2-library-checks.txt`).
- Lahat ng comment ay dumadaan sa `emitCommentScoped` na may UUID, at ginagamit din ito ng Shopee, Facebook at Instagram.
- W3, W5, N8: sinuri sa code (§13.3). Mga bilang sa Q12–Q14.
- **Resulta ni Jeff, hindi akin:** ang pinal na format ay laging diretso sa TikTok app sa iPhone at Samsung, **sa screen**.

**HINDI PA NAPAPATUNAYAN (at paano):**
| Ano | Paano mapapatunayan |
|---|---|
| Camera → TikTok app mula sa **totoong naka-print na sticker**; ibang Android; walang TikTok app; ibang bansa | Paper test (§8.7) — si Jeff |
| Alin ang mas nababasa: v3-L o v4-M (simulation lang ang meron, at hindi nito ginagaya ang labo) | Paper test (§8.7) |
| Nababasa ng `BarcodeDetector` (Android) ang mixed-mode na QR sa Parcel Scan | Paper test |
| May wastong `userId` ang totoong comments sa 4 na daan (lalo na Pin), at matatag sa loob ng isang live | Phase 0 |
| Hindi nagbabago ang `userId` kapag nagpalit ng username | Phase 2: test account + query |
| Buong disenyo ng §4–§6 ay gumagana | Wala pang code |
| Ang gate sa server (bagong code) ay tama, hindi nagpapabagal, at walang tumutulong memory | Wala pang code; sariling audit |
| Ang mga trigger ay hindi kailanman pumipigil sa save o sa bura | PGlite sa Hakbang 2 |
| Walang live na function na nagse-set ng field ng buyer sa `parcel_scans` nang hindi encoder | Pagbasa ng 6 na function (Q14) |
| Lahat ng print path ay nasakop; print ng walang code ay byte-identical | Helper + source test + mga golden |
| Hindi kailangan ng bagong app build | Device na may kasalukuyang build |
| Bilis ng lookup; totoong dagdag na bytes | `EXPLAIN ANALYZE`; sukat |
| Itsura sa dark theme at sa 8 wika | Hakbang 2 |
| Umiiral ang daan na "Manual / Type price na walang comment" (N3) | Tanong 2 |
| **Tama at kumpleto ang mga ayos ng ikalimang ikot** (12 ng reviewer + 7 ng guardian) | Hindi na ipinasuri ulit; sariling audit sa Hakbang 2 |
| Tama ang "Everything fits" at mga babala ng screen para sa mga hakbang na hindi Buyer # (pangalan, @username, comment) sa v4 | Sukat sa Hakbang 2 kung P2 ang mapili |
| Paglipat ng text sa lahat ng klase ng comment kapag v4 | Mga larawang TODAY-vs-NEW sa Hakbang 2 |
