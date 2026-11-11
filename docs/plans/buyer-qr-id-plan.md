# Buyer QR ID — plano (Hakbang 1: pag-aaral + plano + preview lang)

Branch `claude/buyer-qr-id` mula sa `origin/main` `119257aa`. **Walang binago sa app code, server, SQL o printing.**
Ang mga file sa branch na ito: ang planong ito, `docs/plans/buyer-qr-id-proof/` (proof script, output, at mga sukat ng
printer-guardian) at `docs/design/buyer-qr-id/` (mga mockup). Lahat ng query sa database ay **read-only**.

Paano basahin: bawat pahayag ay may tatak —
**[PATUNAY]** = may file:line / query result / script output sa dokumentong ito ·
**[HINDI PA NAPAPATUNAYAN]** = hinala o disenyo pa lang; nakasulat kung paano ito mapapatunayan.
Walang "pasado" o "ligtas" dito na walang patunay. **Ang planong ito ay bersyon 2**: binago matapos suriin ng dalawang
hiwalay na reviewer (§13). Ang pinakamalaking pagbabago mula sa bersyon 1 ay nakalista sa §13.3.

---

## 0. Buod (isang pahina)

1. **Ngayon**, ang QR sa sticker ay ang link na `https://tiktok.com/@<username>` — nagbabago kapag nagpalit ng
   username ang buyer. Ang Scan QR sa Parcel Scan ay @username lang ang pinupunan.
2. **Walang stable na TikTok buyer ID sa app ngayon.** Ang TikTok library ay may `userId` (numeric) pero **hindi ito
   ipinapasa ng server** sa app at **hindi naka-save** kahit saan. Kailangan ng maliit na dagdag sa server — iyon ang
   pundasyon ng buong feature, at **hindi pa napapatunayan** na laging may laman ito sa totoong live (Phase 0).
3. **Iminumungkahing QR:** code na 27 character, hal. `SFB1-EE246-6S371M557HNBR1GA`. Walang pangalan, phone, store o
   username sa loob. Iba ang code ng parehong buyer sa bawat seller. **Kasya sa parehong laki ng QR** na nakukuha na ng
   98% ng sticker ngayon (29 modules) — may patunay. Para sa 1.7% na buyer na maikli ang username, **bahagyang lalaki
   ang QR** kaysa ngayon (§8.2).
4. **Details:** bawat code ay may sariling "huling na-save na details" bawat carrier (7-11 at FamilyMart ay hiwalay,
   kaya hiwalay ang store). Galing ito sa huling parcel na na-save na may code na iyon.
5. **Lumang sticker** (username/URL): gagana pa rin — hahanapin ang buyer sa username, pero ipapakita bilang
   "pakisuri" (dilaw), dahil hindi kasing-tiyak ng QR ID.
6. **Dating buyers:** hindi kayang bigyan ng ID nang maramihan (walang TikTok ID sa lumang data). Kusang magkaka-ID
   sila sa **susunod nilang order**; sa unang scan, hahanapin sila sa username at ikakabit.
7. **Mga conflict na kailangan ng desisyon ni Jeff** (§14): (1) mawawala ang "camera ng phone → TikTok profile";
   (2) ang sticker na na-scan mula sa **ibang account** ay wala nang mapupunan kahit username; (3) ano ang QR kapag
   walang code (TikTok link gaya ngayon, o walang QR); (4) gaano kahigpit ang privacy ng code.
8. **Bagong app build:** hindi kailangan ayon sa pagbasa ng code ng printer-guardian (§8.3) — **hindi pa napapatunayan
   sa device**. Kailangan ng **manual Render deploy** (server) at **SQL**.
9. **Hindi pa handang i-build nang walang sagot sa §14 at walang Phase 0.** Tingnan ang §15 para sa lahat ng hindi pa
   napapatunayan.

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

### 1.6 Idinagdag / itinama matapos ang audit
| Pahayag | Patunay |
|---|---|
| **Itinama:** ang "store na hindi valid → hindi idinadagdag sa Customers" ay hindi buo. Sa unang save, wala pang hatol ang store, kaya **naidadagdag** ang buyer kasama ang store; kapag dumating ang hatol na mali, hindi na ito binabawi | `parcelScan.ts:474-487` (walang `store_check_status` sa insert); function body sa Q3 (Rule 1 ay `return` lang) |
| Ang phonebook trigger ng 7-11 ay tumatakbo rin kapag nagbago ang `store_check_status` / `phone_check_status` — kaya ang **late na hatol o edit sa lumang parcel** ay nagsusulat ulit ng details ng lumang parcel sa Customers (hal. bumabalik ang lumang store). Umiiral na ugali ito ngayon, hindi dala ng feature | Query Q10 (`pg_get_triggerdef`) |
| Ang seller UUID ay **hindi lihim**: nasa public na URL ng product pictures (`<UUID>/<id>.jpg`, public bucket) | `adapters/productImages.ts:15`, `:93`; Query Q11 (`product-images` public = true) |
| May **pangatlong daan** ng comment papunta sa order: Pin to print. Iba ang hugis: `chat.user.userId` (nakapaloob, hindi top-level) | `server/pinRelay.js:20-36`, `:42-61`; `server.js:1616-1622` |
| Ang "earlier comments" (initial batch) ay tumatanggap ng **email id** bilang `sellerId`, hindi UUID | `server.js:1711` |
| Ang `userId` sa library ay `string`; ang nawawalang numero ay puwedeng dumating bilang `"0"` o `""`, hindi `undefined` | `tiktok-schema.d.ts:1180`; `data-converter.js:126` |
| Lahat ng 61 seller na nag-save ng 7-11 parcel sa huling 30 araw ay may store check (`parcel_check_access` enabled); sa 16,126 parcel: valid 13,972 · wala pang hatol 2,117 · unknown 33 · not_found 4 | Query Q9 |
| Ang mga switch at feature map ay binabasa **isang beses bawat sign-in** (walang poll) | `adapters/featureSwitches.ts:1-3`; `adapters/featureAccess.ts:27-45` |
| Ang dalawang bumabasa ng `platform_meta` sa server ay parehong naka-filter sa `platform = 'Facebook'` | `server.js:2364-2368`, `:2468-2470` (nakita ng auditor). [HINDI PA NAPAPATUNAYAN: mga live na database function] |

---

## 2. Ang disenyo sa isang tingin

```
TikTok comment ─► SERVER: may wastong TikTok userId? + pinapayagan ang seller?  ─► oo: field `buyerQr` sa comment
                                                                                  ─► hindi: walang field
        (live chat · "earlier comments" · reuse re-emit · Pin to print — apat na daan, iisang kuwenta)
order (1-Click / Enterprise / Auto / Pin) ─► may `buyerQr`? itatak sa order + sa order row (`platform_meta.bq`)
sticker / Reprint / raffle / Print stickers ─► may code ang order? QR = code · wala? QR = gaya ngayon

Parcel Scan ► Scan QR ► isang tawag sa database (`buyer_qr_lookup`):
   code ng ibang shop ............................ PULA   walang pupunan
   code ko, may huling na-save dito ............... BERDE  pangalan · phone · store · contact
   code ko, sa kabilang carrier lang .............. DILAW  pangalan · phone (store: hahanapin sa Customers dito, kung wala blangko)
   code ko, wala pa; may tugmang username ......... DILAW  mula sa Customers (isa) o pagpipilian (marami)
   code ko, wala pa; walang tugma ................. ASUL   "bagong buyer — i-type isang beses"
   lumang sticker (username) ...................... DILAW  mula sa Customers, o username lang (gaya ngayon)
   hindi nabasa / hindi nasagot ang database ...... walang pupunan + malinaw na mensahe
Save ► ang parcel ay may `buyer_qr_id` ► trigger: itala bilang "huling na-save" ng code na iyon sa carrier na iyon
```

---

## 3. Ano ang ilalagay sa QR

**Format (27 ASCII character, laging pareho ang haba):** `SFB1-<TAG>-<ID>`

| Bahagi | Laman | Para saan |
|---|---|---|
| `SFB1` | "SellerFlow Buyer", bersyon 1 | makilala na QR natin ito |
| `TAG` (5) | unang 5 hex ng `sha256("sfb-tag:" + seller UUID)` | malaman na sticker ito ng **ibang shop** |
| `ID` (16) | 16 character (Crockford base32, 80 bits) ng `HMAC-SHA256(key, "sfb1:" + TikTok userId)` | ang permanenteng ID ng buyer **sa seller na ito** |

**Ang `key`** — desisyon ni Jeff (Tanong 4), dahil **hindi na ito mababago pagkatapos lumabas ang unang sticker**:
- **(a) seller UUID** — walang dagdag na gamit, hindi mawawala. Pero ang UUID ay hindi lihim [PATUNAY §1.6]: ang
  sinumang may UUID ng seller **at** TikTok userId ng isang tao ay kayang kumpirmahin kung kanya ang sticker. Sa
  praktika maliit ito: naka-print din ang @username sa tabi ng QR sa karamihan ng sticker.
- **(b) sariling lihim na key bawat seller sa database** (server lang ang nakakabasa) — tunay na hindi mahuhulaan.
  Dagdag: isang basa sa database sa bawat pag-connect ng TikTok; kapag nabura ang key, **magbabago ang code ng lahat
  ng buyer ng seller na iyon**.
- Rekomendasyon: **(a)**, at hindi natin sasabihing "hindi maibabalik" — ang sasabihin lang ay ang totoo: *walang
  pangalan, phone, store o username sa QR.*

Mga katangian:
- **Permanente** hangga't (1) hindi nagbabago ang TikTok `userId` ng buyer at (2) hindi nagbabago ang key.
  Kinukuwenta ito **sa server** mula sa comment; hindi ito ginagawa ng phone. Parehong code sa lahat ng phone ng
  seller dahil iisang server ang pinanggagalingan. [PATUNAY na deterministic at magkaiba bawat seller:
  `qrcheck.output.txt`. HINDI PA NAPAPATUNAYAN: (1) sa production — §1.4]
- **Mahigpit na tsek ng `userId`:** tatanggapin lang ang `^[1-9][0-9]{5,24}$`. Ang `"0"`, `""`, wala, o may
  ibang character → **walang code**. (Kung hindi, lahat ng buyer na "0" ang userId ay magkakaroon ng **iisang
  code** — pinakamabigat na butas na nakita ng auditor.)
- **Hindi iniimbak ang TikTok `userId`.** Kapalit nito (tapat na sabi): kung kailangang palitan ang formula
  balang-araw (`SFB2`), **lahat ng buyer ay magkakaroon ng pangalawang code** at walang paraan para ilipat ang luma.
  Ang mga `SFB1` na sticker ay mababasa pa rin (ang code mismo ang naka-save, hindi kinukuwenta ulit sa scan).
- **Kasya sa QR:** 27 bytes → version 3 = 29 modules [PATUNAY: `qrcheck.output.txt`]. Epekto sa bawat laki: §8.2.
- **Hindi mababasa nang mali ng lumang app:** ang lumang parser ay tumatanggi rito dahil sa `-`
  [PATUNAY: `legacyParserAccepts=false`]. Ipi-pin ito ng test (huwag alisin ang gitling kailanman).
- Posibilidad na magkapareho ang code ng dalawang buyer ng iisang seller: sa 100,000 buyers ≈ 1 sa 240 trilyon
  (kuwenta, hindi sukat). Ang TAG (20 bits) ay puwedeng magkapareho sa dalawang seller (≈ 4% na may **kahit isang**
  pares sa 300 seller — kuwenta): ang epekto ay "bagong buyer" sa halip na "ibang shop"; walang data na nalalantad.

**Sino ang nakakatanggap ng code (iisang gate, sa server):** ang server ang nagpapasya kung maglalagay ng
`buyerQr` sa comment ng isang seller: global switch `buyer_qr_id_enabled` **o** feature key `buyer_qr_id` ng
account (binabasa sa pag-connect; ang global switch ay may cache na ilang minuto). Ang app ay **walang sariling
switch sa pag-print**: may code ang order → code ang QR. Bunga: (1) lahat ng phone ng seller ay pareho ang natatanggap
— walang "isang phone code, isang phone link"; (2) ang pagpatay ng switch ay tumatalab sa loob ng ilang minuto kahit
sa mga nakabukas na phone (hindi na naghihintay ng sign-in). Kapag hindi mabasa ng server ang switch → **walang code**.

---

## 4. Paano iuugnay ang code sa details (bawat seller; hiwalay ang 7-11 at FamilyMart)

> **Binago mula bersyon 1.** Ang unang disenyo ay "ikabit ang code sa row ng buyer sa Customers". Nakita ng auditor
> na ang Customers mismo ay hindi matatag bilang "huling na-save": ang late na hatol o edit sa **lumang** parcel ay
> nagsusulat ulit ng lumang store sa Customers [PATUNAY §1.6, Q10], at ang store na mali ay nananatili. Kaya ang
> code ay may **sariling tala ng huling na-save** na hindi nadadamay doon.

### 4.1 Bagong SQL (Hakbang 2; susunod na libreng numero ay sql/149 — kumpirmahin sa oras ng paggawa)
1. `parcel_scans.buyer_qr_id text null` at `fm_parcel_scans.buyer_qr_id text null` — additive, nullable, walang
   default. May `CHECK` na eksaktong hugis ng code (idinadagdag na `NOT VALID`, aral ng sql/142). Index
   `(user_id, buyer_qr_id) WHERE buyer_qr_id IS NOT NULL`.
2. Isang table **`buyer_qr_details`** — ang huling na-save bawat code, bawat carrier:
   `user_id, qr_id, carrier ('711'|'fm'), name, phone, store_id, contact, contact_platform, source_created_at,
   linked_via ('qr'|'username'|'typed'), first_saved_at, updated_at`, `PRIMARY KEY (user_id, qr_id, carrier)`,
   `user_id → auth.users ON DELETE CASCADE`.
   RLS: `SELECT` at `DELETE` ng sariling row; **walang** `INSERT`/`UPDATE` policy (trigger lang ang nagsusulat).
3. Dalawang **bagong, hiwalay** na trigger (hindi ginagalaw ang mga phonebook trigger):
   `AFTER INSERT OR UPDATE OF <mga field ng buyer>, buyer_qr_id, phone_check_status, store_check_status`
   (FM: walang check columns), `WHEN (NEW.buyer_qr_id IS NOT NULL)`. Ang ginagawa:
   - Laging `NEW.user_id` ang gamit (hindi `auth.uid()` — ang checker ay nagsusulat bilang admin).
   - Tinatanggihan ang code na hindi tugma ang TAG sa may-ari ng row.
   - **"Huling na-save na parcel ang panalo":** nagsusulat lang kapag `NEW.created_at >= source_created_at` ng
     kasalukuyang tala (o wala pang tala). Kaya ang edit o late na hatol sa **lumang** parcel ay **hindi** umaagaw;
     ang edit sa **pinakabagong** parcel ay pumapasok. Walang query sa ibang parcel → hindi apektado ng "Clear
     exported" o ng 90-araw na purge.
   - `phone_check_status = 'restricted'` at pareho ang phone → **burahin** ang tala (kapareho ng umiiral na rule sa
     Customers). Hatol ng store na mali (`not_found` atbp.) sa pinagmulang parcel → **alisin ang store** sa tala
     (pangalan/phone ay mananatili) — para hindi na kusang mapunan ang maling store.
   - Isang `upsert` sa primary key lang; `SET lock_timeout` na maikli sa function; buong laman sa
     `BEGIN … EXCEPTION WHEN OTHERS`. **Tapat na limitasyon:** ang `WHEN OTHERS` ay hindi sumasalo sa pagkansela ng
     statement (timeout); kaya maliit at mabilis ang ginagawa ng trigger. [HINDI PA NAPAPATUNAYAN — PGlite sa Hakbang 2.]
4. RPC `buyer_qr_lookup(p_text, p_handle, p_carrier) → jsonb` (`SECURITY INVOKER`, bawat query ay may tahasang
   `user_id = auth.uid()`), at `buyer_qr_forget(p_code, p_carrier)` (binubura ang sariling tala — para sa
   "Hindi ito ang buyer").
5. Dalawang switch sa `app_settings` (parehong seed `'false'`): `buyer_qr_id_enabled` (server: maglalagay ng code sa
   comment) at `buyer_qr_scan_enabled` (app: gagamitin ng Scan QR ang lookup at magse-save ng code). Feature key
   `buyer_qr_id` sa `my_feature_access()` (buuin mula sa LIVE na definition sa oras ng apply — aral ng sql/140).

### 4.2 Bakit ganito
- **Rule 4 nang literal:** ang lalabas ay ang huling parcel na na-save na may code na iyon — pangalan, phone, store
  at contact **gaya ng pagkaka-save** (kasama ang LINE/WhatsApp kung iyon ang inilagay ng encoder).
- **Hiwalay ang 7-11 at FamilyMart:** magkahiwalay na tala (`carrier`), kaya ang pagbabago sa isa ay hindi
  nakakaapekto sa isa.
- **Hindi nakadepende sa Customers:** ang 📇 Customers ay gumagana gaya ngayon, walang binago. Kapalit (tapat):
  **dalawang lugar na ang may details ng buyer.** Kapag in-edit o binura ang buyer sa Customers, **hindi** kusang
  nagbabago ang tala ng QR. Ayos: sinasabi ng lookup kung ang (phone + pangalan) ng tala ay **wala na sa
  Customers**, at ipinapakita itong dilaw ("wala na sa Customers — pakisuri"). (Tanong 6.)
- **Personal na data:** ang table ay may pangalan/phone/store — kaparehong uri ng nasa Customers. Kasama sa
  account delete (CASCADE). Walang awtomatikong purge (gaya ng Customers ngayon). (Tanong 9.)

### 4.3 Ang "Buyer contact"
- Ang ipupuno ay ang **huling na-save na contact at platform** (rule 4) — ino-override nito ang "sticky" na
  platform ng form. **Hindi kailanman papalitan nang kusa** ang LINE/WhatsApp/Facebook na contact ng TikTok username.
- Kapag ang naka-save na contact ay TikTok (o lumang row na walang platform) **at** iba ito sa pinakabagong
  username ng buyer sa sarili niyang order rows (`platform_meta->>'bq' = code`): lalabas na **mungkahi** —
  "Bagong username: @bago — gamitin?" — isang pindot. Hindi kusa. (Tanong 5.)
- Ang paglalagay sa form ay dadaan sa parehong normalisasyon ng edit-prefill (WhatsApp `+…`, "no contact").

---

## 5. Ang gagawin ng Scan QR (bawat sitwasyon)

| # | Na-scan | Kalagayan | Ano ang lalabas | Kulay |
|---|---|---|---|---|
| A | Code, akin | may huling na-save sa carrier na ito | pangalan, phone, store, contact — napunan; cursor sa **Amount** | berde "Nakilala sa QR" |
| A2 | (pareho) | pero: ang tala ay wala na sa Customers · o walang store (naalis dahil mali / hindi nailagay) · o unang naikabit sa username lang | napunan ang meron | **dilaw** + dahilan ("wala na sa Customers" / "i-type ang store" / "unang ikinabit sa username noong ‹petsa›") |
| B | Code, akin | walang tala dito, may tala sa kabilang carrier | pangalan + phone mula sa kabila; **store:** hahanapin ang parehong phone + pangalan sa Customers ng carrier na ito — kung meron, pupunan; kung wala, blangko | dilaw "pakisuri" |
| C | Code, akin | walang tala; alam ang username mula sa order row; **isa** ang tugma sa Customers | napunan mula sa Customers | dilaw "Nahanap sa username @x — pakisuri bago i-Save" |
| D | (pareho ng C) | **higit sa isa** ang tugma (1,572 ganitong username ngayon) | hanggang 5 pagpipilian + "Wala rito — ita-type ko" | dilaw |
| E | Code, akin | walang tala, walang tugma | contact = username kung alam; iba pa blangko; pindutang **"Hanapin sa Customers"** | asul "Bagong buyer — i-type isang beses" |
| F | Code, **TAG ng ibang shop** | — | **walang napunan, kahit username** | pula "Sticker ito ng ibang shop" |
| G | Lumang sticker (username / TikTok URL) | may tugma sa Customers | gaya ng C/D | dilaw "Lumang sticker — nahanap sa username, pakisuri" |
| H | Lumang sticker | walang tugma | @username lang ang napunan (**eksaktong gaya ngayon**) | toast gaya ngayon |
| I | Hindi QR natin / hindi nabasa | — | walang napunan (**gaya ngayon**) | toast gaya ngayon |
| J | Code o lumang sticker | hindi sumagot ang database (walang signal, timeout, error, wala pa ang RPC) | code: walang napunan; lumang sticker: @username lang (gaya ngayon) | "Hindi nahanap ngayon — i-type o gamitin ang Customers" |
| K | Sample code ng test print / preview | — | walang napunan | "Test sticker ito" |
| L | Kahit ano, **habang nag-e-edit ng naka-save na parcel** | — | **gaya ngayon lang**: contact/username ang napupunan; walang ikinakabit, walang binabago sa tala | gaya ngayon |

Mga tuntunin:
- **Laging puwedeng i-edit** ang lahat ng napunan bago mag-Save. Walang field na naka-lock.
- **Berde lang kapag tugma sa QR ID at walang alinlangan.** Lahat ng iba ay dilaw.
- **Pagtutugma sa username (C, D, G):** eksakto, hindi case-sensitive, walang `@`; mga row lang sa Customers na
  TikTok o walang platform; hindi kailanman ang handle na "unknown" (fallback ng server, `server.js:1783`).
- **Chip sa form:** "QR: @username ✕" habang may nakakabit na code. Ang ✕ ay nag-aalis ng code sa entry na ito
  (hindi binubura ang mga field). Sa berde/dilaw na kahon ay may **"Hindi ito ang buyer"** → binubura ang tala ng
  code na iyon (`buyer_qr_forget`) at nagiging E.
- **Bago mag-Save na may code:** kung may dating tala at **parehong iba** ang phone at pangalan → tanong muna:
  "Papalitan ang details ni @x?".
- **Walang maling kabit dahil sa timing:** (1) ang Save ay naka-block habang may lookup na tumatakbo; (2) bawat
  lookup ay may token (aling entry + aling file sa batch + bersyon ng form) at ang sagot na huli na ay itinatapon;
  (3) ang code ay kinukuha **sa mismong pindot ng Save** kasama ng mga field (bago ang anumang `await`); (4) ang
  code ay nabubura sa bawat Clear, Cancel, matagumpay na Save, paglipat sa susunod na file ng batch, at sa
  "hold" ng draft (`parcelDrafts.ts:43`); (5) hindi ito tumatawid sa 7-11 ⇄ 全家.
- **📇 Customers habang may chip:** kapag binuksan ang Customers mula sa form na may code at nag-Import, **dala ng
  parcel ang code** — kaya ang buyer na nahanap sa Customers ay naikakabit din.
- Presyo (Amount) ang natitirang ita-type. Dry/Frozen, mga check ng store/phone, batch cap, export —
  **walang pagbabago**.
- Kapag naka-OFF ang `buyer_qr_scan_enabled`: ang Scan QR ay **eksaktong gaya ngayon** (ang code sticker ay
  "No QR found"); walang tawag sa database, walang `buyer_qr_id` sa save.

---

## 6. Mga partikular na tanong ng Hakbang 1

**Paano babasahin ang lumang username QR?** Hindi gagalawin ang `handleFromQrPayload`. Bago nito: kung eksaktong
`^SFB1-[0-9A-F]{5}-[0-9A-HJKMNP-TV-Z]{16}$` → code; kung hindi → lumang parser, tapos hanapin ang username (G/H).

**Paano magkakaroon ng ID ang mga dating buyer?** Walang bulk na paraan — walang TikTok `userId` sa lumang data
[PATUNAY §1.4]. Kusang mangyayari: (1) susunod na order → code ang QR; (2) unang scan → C/D → Save → may tala na
(may tatak na "unang ikinabit sa username"). Walang migration, walang backfill.

**Nagpalit ng username ang buyer?** Parehong `userId` → parehong code → parehong tala (A). Lalabas ang mungkahing
"Bagong username" (§4.3). Ang lumang sticker niya (lumang username) ay G hangga't iyon ang nasa Customers.
[HINDI PA NAPAPATUNAYAN na hindi nagbabago ang `userId` — mapapatunayan lang kapag may naka-save nang mga code:
query ng parehong `bq` na may dalawang magkaibang `handle`.]

**Dalawang seller, iisang buyer?** Magkaibang code at TAG. Sticker ni Seller A na na-scan ni Seller B → F. Ang
lookup ay sariling rows lang ang binabasa; ang `buyer_qr_details` ay walang policy na nagpapabasa sa iba.
**Kapalit:** ngayon, kahit anong account ay nakakabasa ng username sa kahit anong SFL sticker; sa code, hindi na
(Tanong 2).

**Kailangan ba ng bagong app build?** Hindi, ayon sa code (§8.3). Hindi pa napapatunayan sa device.

---

## 7. Mga file na gagalawin sa Hakbang 2 (listahan, hindi pa ginagawa)

**Server** (manual Render deploy; sacred zone ang comment relay → sariling audit):
- BAGO `server/buyerQr.js` (puro, may vitest): `validTikTokUserId`, `buyerQrText(key, userId)`, gate cache.
- **Apat na daan, iisang function:** live chat `server.js:1785-1818` · initial batch `server/initialComments.js:63-87`
  (**bagong `sellerUuid` sa ctx** — ang `sellerId` doon ay email, `server.js:1711`) · reuse re-emit (kopya ng payload)
  · Pin `server/pinRelay.js:20-61` + `server.js:1616-1622` (`chat.user.userId`, nakapaloob).
- Gate: basa ng switch/feature key sa pag-connect (hindi humaharang sa connect; palya = walang code).
- Phase 0 log: bilang lang — wasto / `"0"` o blangko / wala — bawat daan. Walang personal na data.

**Database:** `sql/149_buyer_qr_id.sql` + rollback + `scripts/sql149-behaviour.mjs` (PGlite) — §4.1.

**App** (redesign adapters/screens lang; `App.tsx`, `db.ts` hindi gagalawin):
- BAGO `src/lib/buyerQr.ts`: `parseBuyerQr`, `stickerQrMatrix(handle, buyerQr)` (iisang helper, §8.4).
- Daan ng code papunta sa order: `data.ts`, `useLiveFeed.ts` (comment + `PinPayload`), `pinToPrint.ts:61-76`,
  `useOrders.ts:225` (tatak sa order) at `:68-96` (`platform_meta.bq`).
- Pabalik mula sa row: `useSessionWindow.ts:132/:183` (pipiliin lang ang `bq`, hindi ang buong `platform_meta`),
  `lib/orderLogic.ts:66-82` + rebuild (conditional na field, gaya ng `autoCode`), `reprint.ts:36-47`,
  `ordersSearch.ts:44-66`, `pastSessions.ts`, `raffle.ts:99-110`, `Print.tsx`.
- Printing: §8.1 (4 na lugar ng QR + mga gate + mga sample/preview).
- Parcel Scan: `adapters/parcelScan.ts`, `fmScan.ts` (optional `buyerQrId` sa save — kasama lang kapag may laman;
  **hindi** idadagdag sa mga `select` na listahan, para hindi masira ang app kung wala pa/tinanggal ang column),
  BAGO `adapters/buyerQrLookup.ts`, `parcelDrafts.ts`, `screens/ParcelScan.tsx`, `FmParcelScan.tsx`,
  `CustomerDetails.tsx`, `FmCustomerDetails.tsx` (Import na may dalang code). i18n × 8 wika.
- `featureAccess.ts`, `featureSwitches.ts`. `scripts/printing-paths.mjs` (+ mga bagong file).
- Docs: `PRINTING_MAP.md`, `docs/support/sfl-guide.md` + `sql/116b`.


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
4. **Isang desisyon sa oras ng paggawa ng order** (`useOrders.ts:225`, katabi ng `autoCode`): may `buyerQr` ang
   comment → itatatak sa order at sa row; ang print at lahat ng Reprint ay sumusunod sa order. Walang switch sa app
   para sa pag-print (ang gate ay nasa server, §3) — kaya walang "naka-OFF sa phone na ito" na kaso.
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
| 0 | Server: kuwenta ng code + bilang sa log, **pero naka-OFF ang gate** (walang `buyerQr` na ipinapadala). Render deploy sa tahimik na oras, may Business Pulse check | Wala | Sa log ng ilang araw ng totoong live: ≥ 99% ng TikTok comment ay may **wastong** `userId` sa bawat isa sa 4 na daan; bilang ng `"0"`/blangko. **Kapag mababa → hinto, balik kay Jeff** |
| 1 | SQL (additive) | Wala (walang nagsusulat pa) | `sql149-behaviour.mjs` berde; `get_advisors`; ang palyang trigger ay hindi pumipigil sa save |
| 2 | Web deploy, parehong switch OFF | Wala: Scan QR = gaya ngayon; walang code na ipinapadala | Mga test na "OFF = gaya ngayon" (§11.2) |
| 3 | `buyer_qr_scan_enabled` = ON muna (lahat ay marunong nang bumasa), pagkatapos feature key ng Jeff + googletest (server: may code na ang comment nila) | 2 account | Totoong papel at scan (§11.4); parehong code sa live / earlier comments / Pin / Reprint; **patunay ng "nagpalit ng username"** sa test account |
| 4 | Feature key ng ilang piling seller, ilang araw | piling seller | Walang maling napunan; bilang ng A/A2/B/C/D/E/F/J sa PostHog |
| 5 | `buyer_qr_id_enabled` = ON | lahat ng saklaw (Tanong 3) | — |

Bakit "scan" muna bago "print": para sa unang code sticker, lahat ng na-refresh na device ay marunong nang bumasa.
Ang device na may lumang bundle ay "No QR found" lang (hindi maling punô).

**Pagkakasunod na dapat sundin** (hindi hiwa-hiwalay ang rollback — itinama):
- Pataas: SQL → server → web → `scan` switch → feature key / `id` switch.
- Pababa: `id` switch OFF (server: tigil ang code sa loob ng ilang minuto, kahit sa nakabukas na phone) → `scan`
  switch OFF (tumatalab sa **susunod na bukas** ng app — isang beses lang binabasa ang switch) → web rollback →
  **saka pa lang** ang SQL rollback. **Bawal ang SQL rollback habang live ang web na nagse-save ng `buyer_qr_id`**
  (mabibigo ang save ng parcel na may code). Dahil hindi isinasama ng app ang column sa mga `select`, ang parcel na
  **walang** code ay hindi apektado kahit mawala ang column.
- Server rollback (Render) → wala nang code → QR gaya ngayon.
- Ang mga code sticker na nasa parcel na: nababasa habang ON ang `scan`; kapag OFF → "No QR found" → Customers o type.
  Walang nasisirang data sa alinman.

---

## 10. MGA BUTAS AT CONFLICT

"Ayos" = ang gagawin sa Hakbang 2. Wala sa mga ito ang napatunayan na — bawat isa ay may test sa §11.
(N) = nakita ng hiwalay na auditor · (G) = nakita ng printer-guardian · walang tatak = nakita sa sariling pagsusuri.

### A. Conflict sa umiiral na feature
| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| A1 | **Mawawala ang "camera ng phone → TikTok profile ng buyer"** | Sadyang dalawa ang gamit ng QR ngayon (`tiktokHandle.ts:1-4`) | Desisyon ni Jeff (Tanong 1) |
| A2 | **Na-scan mula sa ibang account: wala nang mapupunan** (N) | Ngayon, kahit anong account ay nakakabasa ng username sa kahit anong SFL sticker. Seller na nagbebenta sa isang login at nag-e-encode sa iba → lahat ng code sticker ay "ibang shop" | Desisyon ni Jeff (Tanong 2). Hindi ito maaayos nang hindi nilalabag ang privacy rule |
| A3 | Seller na **walang Parcel Scan**: mawawalan ng camera → profile, walang mapapala (N) | Code para sa lahat | Mungkahi: code lang para sa mga may Parcel Scan (Plus/Pro/Master, TW); ang iba ay QR gaya ngayon (Tanong 3) |
| A4 | **May sticker pa ring may TikTok link** kahit naka-ON (N) | Walang wastong `userId`; hindi pa sakop ang seller; lumang order row | Dalawang opsyon: QR gaya ngayon (gumagana pa rin sa username) o **walang QR** (Tanong 3b). Mahigpit na basa ng rule 6 = walang QR |
| A5 | Lumang bundle sa isang phone | Hindi nag-full close | Lumang parser ay tumatanggi sa code [PATUNAY] → "No QR found". "Scan" muna bago "print" (§9) |
| A6 | QR na naka-tali sa @username toggle | `stickerRaster.ts:1096`, `printing.ts:1330` | **Hindi babaguhin** (walang gagalaw na layout). Nakasulat sa guide |
| A7 | 賣貨便 col J / Pickup Status / Buyer Alert / Chrome extension | Lahat ay gumagamit ng contact sa `notes` / `buyer_username` | Hindi ginagalaw: ang contact ay ang naka-save pa rin; ang code ay nasa hiwalay na column na walang ibang bumabasa |
| A8 | `platform_meta` sa TikTok rows | Baka may code na umaasang "may `platform_meta` = Facebook" | Sa server, parehong naka-filter sa `platform='Facebook'` [PATUNAY §1.6]. [HINDI PA: live DB functions] → test + pagbasa sa Hakbang 2 |

### B. Maling tao / maling address (pinakamabigat)
| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| B0 | **Maraming buyer, iisang code** (N) | `userId` na `"0"`/blangko → parehong HMAC | Mahigpit na tsek (§3); Phase 0 binibilang; test |
| B1 | **Code ni A + details ni B ang na-save** | Nag-scan ng sticker ni A, tapos nag-type ng kay B | Chip na laging kita; tanong bago mag-Save kapag parehong iba ang phone at pangalan; **"Hindi ito ang buyer"** para burahin ang maling tala (N: dati walang paraan para bawiin). Hindi lubusang maaalis — umaasa sa pagsusuri ng encoder |
| B2 | **Maling kabit dahil sa timing** (N) | (a) "hold" ng draft ay nagtitira ng code sa blangkong form; (b) late na sagot ng lookup ay pumupuno sa **susunod** na parcel ng batch; (c) code na binasa pagkatapos ng `await` sa Save | §5 "Walang maling kabit dahil sa timing" (5 tuntunin) + test sa bawat isa |
| B3 | Na-reuse ang username ng ibang tao | Bagong tao, lumang username → C | Dilaw + "pakisuri"; ang tala ay may tatak na "unang ikinabit sa username noong ‹petsa›" kaya **hindi nagiging tahimik na berde** (N) |
| B4 | Iisang username, maraming row (1,572; 791 ay magkakaibang phone) | Kapamilya, nagpalit ng phone, typo | D: chooser, hindi kusang pumipili |
| B5 | Iisang TikTok account, dalawang tumatanggap | Parehong code | "Huling na-save" (rule 4). Limitasyon: isang tala bawat carrier (Tanong 7) |
| B6 | In-edit / na-recheck / nahatulan ang **lumang** parcel (N) | Trigger sa UPDATE | `source_created_at`: lumang parcel ay hindi umaagaw; hindi nakadepende sa Customers (§4.1). Test |
| B7 | **Maling store na kusang napupunan** (N) | Typo sa store sa unang save; ang hatol ay dumarating pagkatapos | Hatol na mali → inaalis ang store sa tala → susunod: A2 (dilaw, "i-type ang store"). 61 sa 61 aktibong seller ay may store check [Q9]; 13% ng parcel ay wala pang hatol |
| B8 | Phone na "restricted" | — | Binubura ang tala. **Itinama:** ang susunod na scan ay puwedeng C/D (hindi laging E) kung may ibang row sa Customers na pareho ang username (N) |
| B9 | Kusang napapalitan ang LINE/WhatsApp ng TikTok username (N) | Bersyon 1 ng plano | Tinanggal: naka-save na contact ang panalo; mungkahi lang ang bagong username (§4.3) |
| B10 | Binura/in-edit sa Customers pero lumalabas pa rin sa QR | Dalawang lugar ng details | A2: "wala na sa Customers — pakisuri" (dilaw). Tanong 6 kung dapat sabay na burahin |
| B11 | Dalawang encoder, sabay | Dalawang phone | Mas bagong parcel (`created_at`) ang panalo; isang `upsert` |
| B12 | Scan habang nag-e-edit ng lumang parcel (N) | Maglilipat ng tala sa lumang details | L: sa edit mode, gaya ngayon lang — walang ikinakabit |

### C. Printing at QR — lahat (G) maliban kung may tatak
| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| C1 | **Reprint: ibang QR kaysa unang sticker** | Tatlong ruta ng Reprint ay nagtatapon ng di-kilalang field | Dalhin ang code sa `reprint.ts`, `ordersSearch.ts`, mga select, `orderLogic` rebuild; test na iisang QR |
| C2 | **Pin to print: lumang QR, walang code sa order** (G, N) | Ikaapat na daan sa server; ibang hugis ng data | `pinRelay.js` + `pinToPrint.ts`. [HINDI PA NAPAPATUNAYAN: may `userId` ba ang pin event] |
| C3 | Raffle ticket at Print stickers screen: lumang QR | Gumagawa ng sariling buyer | Dalhin ang code; para sa maraming order: code ng pinakabagong order na meron |
| C4 | Code na pumapasok sa JSON ng text sticker / slip | Nakasakay sa buyer object | Ihiwalay bago ang native; bagong byte-identical na test (§8.4-2) |
| C5 | Sirang code → lumalaki/nawawala ang QR | Maling value mula sa DB/relay | Helper na tumatanggap lang ng eksaktong hugis; iba → QR gaya ngayon; test na laging 29 modules |
| C6 | Preview/test print ≠ totoong order | 5 sample ay maikli ang username (v2) | Sample code (§8.4-5) |
| C7 | **1.7% ng buyer: mas malaking QR, mas maliit na tuldok sa ilang laki** | 25 → 29 modules | Tanggapin (kapareho na ng 98%), may larawan at paper test sa 50×40, Niimbot 50×30, 80×50 @1.5× (§11.4). O v2 sa hiwalay na hakbang |
| C8 | Nabago ang QR nang hindi dumadaan sa printing gate | Wala sa listahan ang mga `lib` file | Idagdag sa `scripts/printing-paths.mjs` |
| C9 | Walang QR sa text sticker / WiFi sticker / slip | Umiiral na | Walang pagbabago; sasabihin sa guide |
| C10 | Hindi ma-scan sa totoong papel | Thermal, gusot, ilaw | [HINDI PA NAPAPATUNAYAN] — §11.4 |

### D. Data, server, database
| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| D1 | Walang wastong `userId` sa production | Iba ang totoong hugis ng data | Phase 0 (gate OFF). Mababa → hinto |
| D2 | Magkaibang code sa live vs "earlier comments" (N) | Maling `sellerId` (email) ang ginamit na key | Tahasang `sellerUuid` sa ctx; test na pareho ang code sa 4 na daan |
| D3 | Hindi makapag-save ng parcel dahil sa trigger | Bug, lock, timeout | Maliit na trigger, `lock_timeout`, `EXCEPTION`; tapat na limitasyon sa §4.1; PGlite test na may sadyang error at may naka-lock na row |
| D4 | Trigger na tumatakbo sa bawat export / hatol (N) | Walang listahan ng column | Tahasang listahan + `WHEN`; test: export ng 70 row ay walang isinusulat sa tala |
| D5 | Trigger na gumagamit ng maling user (N) | Ang checker ay nagsusulat bilang admin | `NEW.user_id` lang; test na may ibang nagsusulat |
| D6 | Pekeng tala / code ng iba | Diretsong sulat mula sa browser; code na may TAG ng iba | Walang INSERT/UPDATE policy; CHECK sa hugis; trigger na tumatanggi sa maling TAG |
| D7 | Admin na nakakakita ng data ng iba | RLS "own OR admin" sa ibang table | Tahasang `user_id = auth.uid()` sa bawat query ng RPC; SQL contract test |
| D8 | Bagal / egress | Lookup sa order rows (pinakamabigat na seller 9,290 rows); **dagdag na ~35 bytes bawat TikTok order row sa bawat bukas ng app** (N) kapag binasa ang `bq` sa session load; +~40 bytes bawat comment | `bq` lang ang pipiliin (hindi buong `platform_meta`). `EXPLAIN ANALYZE` sa Hakbang 2; kung > 50 ms → partial index `CONCURRENTLY`. [HINDI PA NAPAPATUNAYAN ang bilis at ang totoong dagdag na bytes] |
| D9 | Sacred zone: comment relay + connect | Dagdag na field at isang basa ng switch | Additive; sa loob ng `try` (palya = walang code, tuloy ang comment); ang basa ng switch ay hindi humaharang sa connect; sariling audit; Render deploy sa tahimik na oras |
| D10 | Hindi mapatay agad | Switch na isang beses lang binabasa ng app | Ang pag-print ay naka-gate **sa server** (minuto); ang scan ay may sariling switch; nakasulat ang tamang pagkakasunod (§9) |
| D11 | Phase 0 na hindi nasusukat (N) | "Parehong code sa dalawang araw" ay nangangailangan ng naka-save na code | Phase 0 = bilang lang ng wastong `userId`. Ang "hindi nagbabago" ay sa Phase 3 pa mapapatunayan |
| D12 | Account delete; privacy policy | Bagong table na may personal na data | CASCADE; Tanong 9 |

### E. Paggamit
| # | Panganib | Ayos |
|---|---|---|
| E1 | "Berde = tama" kaya hindi na sinusuri | Presyo ay laging blangko; lahat ng may alinlangan ay dilaw; guide |
| E2 | Bagong buyer na nasa Customers na (N: dati dead end) | "Hanapin sa Customers" na may dalang code (§5) |
| E3 | Encoder na walang signal | J: malinaw na mensahe; Customers/type gaya ngayon |
| E4 | Sa labas ng Taiwan | Walang pagbabago sa market gate |

---

## 11. Listahan ng test (bawat rule ni Jeff at bawat butas ay may test na babagsak kapag nasira)

### 11.1 Rule → test
| Rule | Test |
|---|---|
| 1. Iisang permanenteng QR; TikTok lang | Server: parehong (key, userId) → parehong text; ibang username/pangalan/oras → pareho pa rin; **`"0"`, `""`, wala, may letra → walang code** (B0). **Parehong code sa live, initial, reuse re-emit at Pin** (D2, C2). Print: dalawang order ng parehong buyer na magkaibang username → parehong QR matrix. Facebook/Shopee/Instagram na may code → walang QR pa rin. **Iisang order → parehong matrix sa 1-Click / Enterprise / Auto / 3 ruta ng Reprint / raffle / Print screen / laptop** (C1, C3) |
| 2. Unang beses: i-type isang beses | Screen (7-11 + FM): E → type → Save → payload ay may `buyer_qr_id`. PGlite: may tala pagkatapos |
| 3. Susunod: kusang napupunan; hiwalay ang store | Screen: A, apat na field, Amount blangko at naka-focus, platform mula sa tala. PGlite: tala ng 7-11 ay hindi lumalabas sa FM at baliktad; B (may/walang tugma sa Customers ng carrier na ito) |
| 4. Puwedeng i-edit; huling na-save ang lalabas | **Bawat isang field na in-edit** (store lang / phone lang / pangalan lang / contact lang / "no contact") → susunod na lookup = bagong value, sa 7-11 at FM. **Naka-save na LINE/WhatsApp/lumang contact ay buo pagkatapos ng scan + Save** (B9). **Edit, Recheck at late na hatol sa lumang parcel ay hindi nagbabago ng lalabas** (B6). "Clear exported" at purge ay hindi nagbabago ng tala |
| 5. Lumang sticker; dating buyers | `parseBuyerQr`: URL at hubad na username → lumang landas; ang mga umiiral na test ng `handleFromQrPayload` ay **hindi ginagalaw**. Screen: G, H. PGlite: C → Save → A2 na may tatak na "username". Pagtutugma: hindi tumutugma sa LINE/WhatsApp rows at sa "unknown" |
| 6. Privacy | Server: ang text ay walang bahagi ng username/pangalan/userId; magkaibang seller → magkaibang ID at TAG. Screen: F → walang napunan kahit username. RLS/PGlite: user B ay hindi makabasa/makasulat/makabura ng tala ni A; lookup bilang admin ay sariling rows lang; trigger na tumatanggi sa TAG ng iba |

### 11.2 "Walang nagbago kapag OFF" (permanenteng test)
- Walang `buyerQr` → lahat ng print hash/golden ay kapareho ng main (listahan ng guardian: `stickerRasterPropGoldens`,
  `fixtures/*.json`, `v2TestSticker.golden`, `stickerSpacing.offPins`, `escposRaster`/`cpclRaster` goldens,
  `oneSticker.switches`/`onePlace`, `PrinterSettings.todayParity`, `printing.test`, `printing.oneLane`, `tspl.test` +
  `tspl-parity/golden/*.bin`, `e2e/printing/onelabel`).
- `scan` switch OFF: DOM ng Parcel Scan (7-11, FM) = gaya ngayon; walang tawag sa `buyer_qr_lookup`; save payload ay
  **walang** `buyer_qr_id` key; code sticker → "No QR found".
- Order row `platform_meta` para sa TikTok = `null` kapag walang code.
- Lumang parser ay tumatanggi sa code (naka-pin ang gitling).
- May code pero native path: argument ng `printStickerNative` / `printStickerLan` / `printSlip` ay byte-identical (C4).

### 11.3 Mga butas → test (bukod sa nasa itaas)
B1: tanong bago mag-Save; "Hindi ito ang buyer" → E. B2: hold ng draft ay nag-aalis ng code; Save sa batch ay
nagre-reset; late na sagot ay itinatapon; Save naka-block habang may lookup; code kinukuha sa pindot. B7: hatol na
mali → walang store sa tala. B8: restricted → nabura; susunod C/D kapag may ibang row. B12: edit mode = gaya ngayon.
E2: Import na may dalang code. D3: sadyang error + naka-lock na row → naka-save pa rin ang parcel. D4: export ng 70
row → walang sulat. D5: ibang user ang nagsusulat → `NEW.user_id`. D6: diretsong insert/update = tinanggihan; maling
TAG = walang tala. D7: contract test. D10: RPC na wala/nag-error → J; SQL rollback order (script).
C5: laging 29 modules; sirang code → QR gaya ngayon. C6: preview = print na may sample code (pixel). C8: gate list.

### 11.4 Sa totoong device (si Jeff; hindi kayang patunayan mula rito)
1. AIMO D520BT: 100×60, 70×50, 50×30 — bagong sticker at sticker ngayon.
2. Xprinter XP-420B at Flash Y41BT: 60×40 at 50×40 (4-dot na tuldok).
3. Niimbot 50×30 (5-dot). 4. Laptop (Windows kiosk + Chrome).
5. Bawat isa: i-scan sa iPhone at Android sa Parcel Scan — unang subok, mahinang ilaw, bahagyang gusot.
6. Iisang order: 1-Click → Reprint (Live at Orders) → Pin → raffle → Print stickers: iisang code lahat.
7. Buyer na maikli ang username (≤ 6 letra) sa Buyer # 1.5×.
8. Dalawang phone, isa ay hindi pa na-refresh. 9. Test account na nagpalit ng username → parehong code.
10. Camera ng phone sa bagong QR: ano ang ipinapakita.

### 11.5 Mga larawang TODAY-vs-NEW na gagawin sa Hakbang 2 (rule ng printing)
Sticker ngayon: D520 70×50 / 80×50 / 80×60 / 100×60 / 50×30 + 60×40 (walang QR, dapat magkapareho); compact v2 50×30
at 60×40; XP-420B at Flash sa 6 na laki; isang ESC/POS, isang CPCL; Niimbot 50×30. Bagong sticker: D520, XP-420B,
Niimbot, laptop sa 7 laki × Buyer # 1× / 1.5× / 2×. Laptop HTML sa 6 na laki. Mga preview sa 360/390/430/1280.
Laman: username na 2, 6, 10, 22, 24 character; maikling code; mahabang comment; pangalang Chinese, Vietnamese, Thai;
Facebook buyer; reprint ng lumang row; buyer na maraming order; QR off.

### 11.6 Karaniwan
`npm run typecheck`, `npm test`, `npm run build`, lint = parehong bilang sa main; `node --check server.js`; ang mga
tangled-zone suite (`commentKey`, dedup, fan-out, reprint zero-write) ay **hindi binabago**; i18n × 8 wika; 360/390/430
px walang putol at walang dagdag na linya sa header.

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

---

## 13. Self-audit: ano ang nakita ng mga hiwalay na reviewer at paano inayos

Dalawang hiwalay na reviewer ang sumuri sa **bersyon 1** ng plano; hindi nila nakita ang pangangatwiran ko, ang plano
at ang code lang. Bago isama, **sinuri ko mismo sa code/database ang mga pangunahing sinabi nila** (nakatala sa ibaba).

### 13.1 Printer-guardian — hatol: "GAPS FOUND (12)"
Tama ang laki ng QR; kulang ang daan ng code papunta sa bawat paraan ng pag-print. Buong detalye sa §8.
| # | Nakita | Ayos sa plano |
|---|---|---|
| 1 | Reprint: ibang QR (3 ruta ay nagtatapon ng field) | C1, §7, §11.1 |
| 2 | Pin to print: lumang QR, walang code | C2, §7 (ikaapat na daan sa server) |
| 3 | Raffle ticket: lumang QR | C3 |
| 4 | Print stickers screen (isang buyer, maraming order) | C3 |
| 5 | Papasok ang code sa JSON ng text sticker/slip, walang test | C4, §8.4-2 |
| 6 | Sirang code → maling laki ng QR | C5, §8.4-1 |
| 7 | Preview/test print iba sa totoong order | C6, §8.4-5 |
| 8 | Maikling username: mas malaking QR, mas maliit na tuldok sa ilang laki | C7, §8.2 (may sukat) |
| 9 | QR files na wala sa printing gate | C8 |
| 10 | Lumang app sa isang phone; dalawang phone na magkaiba | A5; inalis ang switch sa app → gate sa server (§3) |
| 11 | Walang QR sa text/WiFi sticker at slip | C9 |
| 12 | Luma ang mga line number sa `PRINTING_MAP.md` | §8.4-7 |
Hindi napatunayan ng guardian (kaya nasa §15): scan sa papel, iPhone rendering, ESC/POS at CPCL hardware, hugis ng pin
event, lumang naka-install na app at dagdag na JSON key, paglipat ng text para sa lahat ng comment.

### 13.2 Auditor ng buong plano — 21 nakita (7 HIGH)
| # | Bigat | Nakita | Sinuri ko? | Ayos sa plano |
|---|---|---|---|---|
| 1 | HIGH | `userId` na `"0"`/blangko → iisang code para sa maraming buyer | Oo: `tiktok-schema.d.ts:1180` | B0, §3 |
| 2 | HIGH | Kusang pagpalit ng contact ng TikTok username → nawawala ang LINE/WhatsApp | Oo: `ParcelScan.tsx:1083` (pinipilit ang TikTok ngayon) | B9, §4.3 |
| 3 | HIGH | Nakaligtaan ang Pin to print sa server | Oo: `pinRelay.js:20-36` | C2 |
| 4 | HIGH | "Earlier comments" ay email ang `sellerId`, hindi UUID | Oo: `server.js:1711` | D2 |
| 5 | HIGH | Walang paraan para bawiin ang maling kabit | — (disenyo) | B1: "Hindi ito ang buyer", `buyer_qr_forget` |
| 6 | HIGH | 3 daan ng maling kabit dahil sa timing (draft hold, late lookup, `await` sa Save) | Oo: `parcelDrafts.ts:43`, `ParcelScan.tsx:1064` | B2, §5 |
| 7 | HIGH | Rollback/kill switch: walang switch sa scan; "hiwa-hiwalay" ay mali; switch ay isang beses lang binabasa | Oo: `featureSwitches.ts:1-3` | §3 (gate sa server), §9, D10 |
| 8 | HIGH/MED | Lumang parcel (edit/Recheck/late na hatol) ay nagbabalik ng lumang store sa Customers | Oo: Q10 | **Binago ang disenyo** (§4): sariling tala + `source_created_at` |
| 9 | MED/HIGH | Ibang account: wala nang mapupunan kahit username — tahimik na desisyon | — | A2, Tanong 2 |
| 10 | MED | Kulang ang detalye ng trigger (column list, sino ang nagsusulat, timeout, hugis) | Oo: Q10 | §4.1-3, D3–D6 |
| 11 | MED | Mali ang "store na hindi valid → hindi idinadagdag" | Oo: `parcelScan.ts:474-487` | §1.6 (itinama), B7 |
| 12 | MED | Customers Import ay nagtatapon ng code; E ay dead end | — (disenyo) | E2, §5 |
| 13 | MED | Sobra ang pahayag sa privacy; hindi lihim ang UUID; hindi na mababago ang key | Oo: `productImages.ts:15`, Q11 | §3 (itinama), Tanong 4 |
| 14 | MED | Hindi tinukoy ang pagtutugma sa username | — | §5 (eksakto, TikTok/walang platform, hindi "unknown"), B3 |
| 15 | MED | B: mali ang prayoridad ng store | — | §5 B |
| 16 | MED | Kulang na estado: palyang lookup, edit mode, walang store, restricted | — | §5 J, L, A2; B8 itinama |
| 17 | MED | Reprint kulang; hindi nabilang na egress sa session load | Oo (guardian din) | C1, D8 |
| 18 | MED | Mga desisyong dapat tanong | — | §14 (Tanong 2, 3, 3b, 4, 5) |
| 19 | LOW | Phase 0 ay hindi nasusukat gaya ng pagkakasulat | — | §9, D11 |
| 20 | LOW | TAG: banggaan; saan kinukuwenta; trigger dapat tumanggi | — | §3, D6; RPC ang nagtsetsek |
| 21 | LOW | Platform mula sa tala; normalisasyon; "kahit offline" ay mali; 98% ay mula sa lahat ng seller | — | §4.3, §3 (itinama); ang 98% ay mula sa order rows ng **lahat** ng seller, hindi lang ng naka-ON ang QR (hindi alam kung sino — nasa phone lang ang toggle) |
Mga pahayag ng bersyon 1 na sinuri ng auditor at **tama** (may file:line sa ulat niya): laman ng QR at lumang parser;
ECC "M" sa 4 na lugar; ginagawa ng Scan QR ngayon; `userId` ng chat ay top-level at sa nag-comment; hindi ipinapasa ng
relay; hindi binabago ng sanitizer ang bagong field; `sellerId` = auth UUID; `platform_meta` ay dumadaan; mga susi at
trigger ng Customers; purge na nagtitira ng 7 session; feature map ay fail-closed; draft ay per carrier.

### 13.3 Pinakamalaking pagbabago mula bersyon 1
1. Details: mula "kabit sa row ng Customers" → **sariling tala ng huling na-save** (§4).
2. Gate ng pag-print: mula sa app → **sa server** (§3); may hiwalay na switch ang scan.
3. Contact: mula "kusang pinakabagong username" → **naka-save ang panalo, mungkahi lang ang bago**.
4. Apat na daan sa server (dagdag ang Pin; itinama ang "earlier comments"); mahigpit na tsek ng `userId`.
5. Itinama ang mga pahayag: privacy ng code, "offline", "hiwa-hiwalay na rollback", "store na hindi valid".

### 13.4 Pangalawang ikot ng audit (sa bersyon 2)
> Pupunan: ipinasuri ulit ang mga binagong seksyon (§3–§5, §9, §10).

---

## 14. MGA TANONG PARA KAY JEFF

**Kailangan ng sagot bago ang Hakbang 2** (binabago nito ang disenyo):
1. **Camera ng phone → TikTok profile.** Mawawala ito kapag code na ang QR. (a) Tanggapin — sa app na lang bubuksan
   ang profile (Parcel Scan pagka-scan, Pickup Status). (b) Gawing link sa sarili nating site
   (`sellerflowlive.com/b/CODE`): mas mahabang text → mas malaking QR (33 modules) → panibagong sukat at paper test
   sa lahat ng laki. Ginagamit pa ba ito ng staff ngayon?
2. **Ibang account.** Ngayon, kahit anong account ay nakakabasa ng username sa kahit anong SFL sticker. Sa code,
   "Sticker ng ibang shop" at walang mapupunan. May seller ka bang nagbebenta sa isang login at nag-e-encode sa iba?
   Kung meron: (a) pareho silang gagamit ng iisang login, o (b) hindi para sa kanila ang feature.
3. **Sino ang magkaka-code?** Mungkahi: mga account lang na may Parcel Scan (Plus/Pro/Master, Taiwan). Ang iba ay
   mananatili sa QR ngayon (hindi sila mawawalan ng camera → profile).
   **3b.** Kapag walang code ang isang order (walang TikTok ID sa comment, lumang order): QR gaya ngayon (TikTok link —
   gumagana pa rin sa username) o **walang QR**? Mahigpit na basa ng "ID code lang" = walang QR.
4. **Gaano kahigpit ang privacy ng code** (§3)? (a) Simple at hindi mawawala — pero ang may hawak ng internal ID ng
   shop **at** TikTok ID ng isang tao ay kayang kumpirmahin kung kanya ang sticker. (b) Lihim na key bawat seller sa
   database — mas mahigpit, may dagdag na basa sa bawat connect, at kapag nawala ang key ay magbabago ang code ng
   lahat ng buyer ng seller. **Hindi na ito mababago pagkatapos lumabas ang unang sticker.** Mungkahi: (a).
5. **Nagpalit ng username ang buyer.** Sa plano: mungkahi lang ("Bagong username: @bago — gamitin?"), hindi kusa,
   para hindi mapalitan ang LINE/WhatsApp na inilagay ng encoder. Ayos ba, o kusa kapag TikTok ang naka-save?
6. **Binura o in-edit ang buyer sa 📇 Customers.** Sa plano: hindi kusang nagbabago ang lalabas sa QR; ipinapakita
   lang na dilaw ("wala na sa Customers"). Gusto mo bang ang pagbura sa Customers ay bumura rin sa QR details?

**Puwedeng sagutin habang ginagawa:**
7. Iisang TikTok account na bumibili para sa dalawang tao: sapat na ba ang "huling na-save, i-edit kung iba"?
8. Buyer na kilala sa 7-11 pero unang beses sa FamilyMart (o baliktad): pupunan ang pangalan at phone mula sa
   kabila (dilaw, "pakisuri") — ayos ba, o blangko lahat?
9. Kailangan bang banggitin sa Privacy Policy ang "buyer code" at ang bagong tala ng details?
10. Sino ang mga unang susubok pagkatapos mo at ng googletest?
11. Kailangan mo ba ng paraan para mag-print ng QR ng dating buyer **nang walang bagong order**? Sa plano: hindi.
12. Mga salita sa screen (nasa mockup ay mungkahi lang, English muna).

---

## 15. Ano ang may patunay at ano ang HINDI PA

**May patunay (file:line / query / script output sa dokumentong ito):**
- Laman ng QR ngayon; ginagawa ng Scan QR ngayon; istruktura, mga trigger at dami ng Customers (§1.1–1.3, §1.6).
- Walang TikTok `userId` sa relay, app o database ngayon; may `userId` sa library (§1.4).
- Kasya ang 27-byte na code sa 29-module na QR; tinatanggihan ito ng lumang parser; deterministic; magkaiba bawat
  seller; pareho ang `sha256` ng database at Node (`qrcheck.output.txt`, Q8).
- Sukat ng layout: username na 10 char → 96/96 magkapareho sa bagong sticker; mga pagbabago para sa maikli/mahabang
  username (`guardian-layout-*.txt`). **Sukat ng layout sa computer, hindi papel.**
- Ang mga pangunahing sinabi ng auditor na sinuri ko (§13.2, kolum na "Sinuri ko?").
- 56 na mockup sa `docs/design/buyer-qr-id/` (mga larawan ng mungkahi — **hindi patunay na gumagana**).

**HINDI PA NAPAPATUNAYAN (at paano):**
| Ano | Paano mapapatunayan |
|---|---|
| May wastong `userId` ang totoong comments sa lahat ng 4 na daan (lalo na ang Pin) | Phase 0 log |
| Hindi nagbabago ang `userId` kapag nagpalit ng username | Phase 3: test account + query ng parehong `bq` na may 2 handle |
| Buong disenyo ng §4–§5 ay gumagana | Wala pang code. PGlite script + screen tests sa Hakbang 2 |
| Ang trigger ay hindi pumipigil sa save sa lahat ng kaso (lalo na timeout) | PGlite; tapat na limitasyon sa §4.1 |
| Lahat ng print path ay nasakop | Iisang helper + source test + "iisang order, iisang matrix" test |
| Paglipat ng text sa lahat ng klase ng comment para sa maikling username | Mga larawang TODAY-vs-NEW (§11.5) |
| Nababasa ang QR sa totoong papel, bawat laki / printer / phone | §11.4 (Jeff) |
| Hindi kailangan ng bagong app build | Test sa device na may kasalukuyang build |
| Bilis ng lookup; totoong dagdag na bytes sa session load | `EXPLAIN ANALYZE`; sukat sa Hakbang 2 |
| Walang live na database function na umaasa sa `platform_meta` ng TikTok rows | Query ng `pg_proc` sa Hakbang 2 |
| Ang mga live na trigger sa `parcel_scans` (frozen, recheck, export) ay hindi naaapektuhan ng bagong column/trigger | PGlite na may kopya ng mga live na definition |
| Ipinapakita ng camera ng iPhone/Android sa text na `SFB1-…` | Totoong device |
| Itsura ng mga bagong kahon sa dark theme at sa 8 wika | Hakbang 2 (totoong screen, hindi mockup) |
| Kung may seller na gumagamit ng dalawang account (Tanong 2) | Si Jeff |
