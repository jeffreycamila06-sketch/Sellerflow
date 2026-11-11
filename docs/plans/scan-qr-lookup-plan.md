# Scan QR → hanapin sa Customers — plano (Hakbang 1: plano + preview lang)

Branch `claude/scan-qr-lookup` mula sa `origin/main` `119257aa`. **Docs lang** — walang binago sa app code, server, SQL o
printing. Lahat ng query sa database ay read-only. Mga mockup: `docs/design/scan-qr-lookup/`.
(Ang Buyer QR ID ay kinansela; ang branch na `claude/buyer-qr-id` ay reference lang.)

Tatak: **[PATUNAY]** = may file:line o query result dito · **[HINDI PA NAPAPATUNAYAN]** = disenyo pa lang, may nakasulat
kung paano mapapatunayan. Walang "pasado" na walang patunay.

---

## 0. Buod
- **Walang gagalawin** sa sticker QR, printing, server, comment/order, save, export, batch cap, at mga check ng store/phone.
  Parehong QR (`https://tiktok.com/@username`) at parehong parser (`handleFromQrPayload`).
- **Ang dagdag lang:** pagka-Scan QR, hahanapin ang @username sa **sariling Customers ng seller sa screen na iyon** (7-11 →
  `parcel_customers`; FamilyMart → `fm_parcel_customers`). Isa ang tugma → kusang napupunan. Marami → pagpipilian. Wala →
  gaya ngayon.
- **Hindi kailangan ng SQL o index** para sa hanap: sinukat sa pinakamalaking seller (7,643 record) — 19 ms (51 ms sa unang
  takbo). [PATUNAY §1.3]
- **95.8% ng username ay iisa lang ang record** → kusang punô. 4.2% ay may 2 o higit pa → pagpipilian. [PATUNAY §1.2]
- Web lang ang babaguhin (Hakbang 2): dalawang screen + isang maliit na adapter. Walang bagong app build, walang Render deploy.

---

## 1. Ano ang meron ngayon (may patunay)

### 1.1 Code
| Pahayag | Patunay |
|---|---|
| Scan QR, 7-11: litrato → decode → `handleFromQrPayload` → pinupunan ang **@username lang** (`notes`), inaalis ang "no contact", pinipili ang TikTok, toast | `screens/ParcelScan.tsx:1072-1091` |
| Scan QR, FamilyMart: pareho, field na `username` | `screens/FmParcelScan.tsx:201-212` |
| Parser: TikTok URL o hubad na username `[A-Za-z0-9._]{1,30}`; iba → walang napupunan | `src/lib/tiktokHandle.ts:28-36` |
| Customers 7-11: ang username ay nasa `notes`; FamilyMart: nasa `buyer_username`; pareho may `contact_platform` (NULL = TikTok / luma) | `adapters/parcelCustomers.ts:50`; `adapters/fmCustomers.ts:43` |
| Ang hanap ng Customers ngayon ay "naglalaman" (`%…%`), hindi eksakto, hanggang 30 resulta | `parcelCustomers.ts:72-88`; `fmCustomers.ts:47-58` |
| Ang draft ng ⇄ ay `form` / `noHandle` / `platform` lang, sa memory, hiwalay bawat screen; ang "hold" bago mag-save ay nagbablangko ng `form` | `adapters/parcelDrafts.ts:12-43` |
| Sariling data lang: RLS ng dalawang table ay `user_id = auth.uid()` sa SELECT | Query Q2 (2026-11-11, `pg_policies`) |
| Ang trigger na nagsusulat sa Customers ay nagti-trim ng username | Query Q3 (`upsert_parcel_customer`, `upsert_fm_parcel_customer`) |

### 1.2 Data — ilan ang record bawat username [PATUNAY: read-only query, 2026-11-11]
"Kwalipikado" = TikTok o walang platform, hugis-username, hindi "unknown" (ang tuntunin ng utos).
| | 7-11 (`parcel_customers`) | FamilyMart (`fm_parcel_customers`) |
|---|---|---|
| Lahat ng row / may contact | 56,557 / 45,277 | 670 / 665 |
| Kwalipikadong row | 39,622 | 368 |
| Magkakaibang (seller, username) | 37,554 | 368 |
| **Username na 1 record** | **35,983 (95.8%)** | **368 (100%)** |
| **Username na 2–4 record** | **1,531 (4.1%)** | 0 |
| **Username na 5+ record** | **40 (0.1%)** — pinakamarami: 47 | 0 |
| Sa may 2+: higit sa isang **store** | 435 | — |
| Sa may 2+: higit sa isang **phone** | 795 | — |
| Sa may 2+: parehong phone at store (baybay ng pangalan lang ang iba) | 725 | — |
| Naka-save na may `@` sa unahan | 8,395 | 116 |
| Naka-save na may **malaking titik** | 15,469 | 164 |
| May espasyo sa dulo/unahan | 0 | 0 |
| Contact na "unknown" | 1 | 0 |
| TikTok/walang platform pero **hindi hugis-username** (hal. may espasyo, "(IG)", numero) — hindi matutugma ng QR | 5,316 | 276 |
| Walang store | 0 | — |
| Huling gamit ng username: ≤ 30 araw / 31–90 / lampas 90 | 26,414 / 11,140 / 0 (nagsimula ang table noong 2026-09-13) | — |
| Seller / pinakamaraming row ng isang seller | 74 / 7,643 | 26 / 138 |

Ibig sabihin: kailangan talaga ang "hindi case-sensitive" at "walang @" — 15,469 ang may malaking titik at 8,395 ang may `@`.

### 1.3 Bilis ng hanap — kailangan ba ng index o SQL? [PATUNAY: `EXPLAIN (ANALYZE, BUFFERS)`, pinakamalaking seller, 7,643 row]
Ang query na katumbas ng gagawin ng app (sariling `user_id` + username na may at walang `@`, hindi case-sensitive + TikTok o
walang platform, pinakabago muna, hanggang 20):
| Takbo | Oras sa database | Paano |
|---|---|---|
| Una (malamig) — may 1 tugma | 51.4 ms | umiiral na index sa `user_id` (`parcel_customers_uniq`) → sinala ang 7,643 row |
| Pangalawa — walang tugma | 18.6 ms | pareho |

- **Hindi kailangan ng bagong index.** Tumataas ito kasabay ng dami ng Customers ng seller (hula: ~120 ms sa 50,000 row —
  kuwenta, hindi sukat); balikan kung may seller na lumampas ng ~50,000.
- **Hindi kailangan ng SQL (RPC).** Kaya ng isang query mula sa app, sa ilalim ng umiiral na RLS.
- **[HINDI PA NAPAPATUNAYAN]:** ang oras na kasama ang network (mula sa phone), at ang eksaktong hugis ng query sa PostgREST
  (ang sinukat ay ang katumbas na SQL). Susukatin sa Hakbang 2 gamit ang test account.

---

## 2. Ang daloy

```
Scan QR ─► nabasa ang QR?
   hindi ─► gaya ngayon ("No QR found…"), walang napupunan                                   (sitwasyon 6)
   oo ───► @username napupunan AGAD, eksaktong gaya ngayon (parehong code, parehong toast)
           └► (bago) hanapin sa Customers ng screen na ito ─► isang query, sariling data lang
                 1 tugma ──► punan ang pangalan, phone, store · kahon: "Nahanap sa Customers: @x — pakisuri"   (3)
                 2+ tugma ─► pagpipilian, pinakabago sa itaas, + "Wala rito — ita-type ko"                    (4)
                 0 tugma ──► wala nang iba — @username lang, gaya ngayon                                       (5)
                 error / walang signal / mabagal ─► @username lang + maikling mensahe                        (6)
```

### 2.1 Ang hanap (isang maliit na adapter, purong function para sa pagtutugma)
- **Tuntunin ng tugma (utos 2):** tanggalin ang espasyo sa dulo, tanggalin ang isang `@` sa unahan, gawing maliliit na titik;
  **eksaktong pareho** sa na-scan na username. Mga row lang na `contact_platform` ay wala o `tiktok`. **Hindi kailanman**
  hahanapin ang "unknown" o blangko.
- **Paano:** isang query sa table ng screen — sariling `user_id` (tahasan, bukod pa sa RLS), username na may at walang `@`
  gamit ang hindi case-sensitive na paghahambing, pinakabago muna, hanggang 20 row. Sa ganitong paghahambing, ang `_` sa
  username ay tumutugma sa kahit anong isang character — kaya **ang app ang gumagawa ng huling eksaktong tsek** sa bawat
  ibinalik na row (purong function, may test). Walang maling tugma kahit maluwag ang query.
- **Hiwalay ang dalawang screen:** 7-11 → `parcel_customers.notes`; FamilyMart → `fm_parcel_customers.buyer_username`.
  Walang binabasa mula sa kabila, kahit walang tugma.
- **Egress:** isang query bawat scan (kilos ng user), hanggang 20 maliliit na row. Walang poll.
- **May hangganan ang hintay:** 4 na segundo; lampas → sitwasyon 6.

---

## 3. Bawat sitwasyon

| # | Sitwasyon | Ano ang lalabas |
|---|---|---|
| 1 | **Walang binago sa QR/printing/server** | Parehong QR, parehong parser. Walang file ng printing, server o SQL na gagalawin |
| 2 | **Paghahanap** | §2.1 |
| 3 | **Isang tugma** | Napupunan ang **pangalan, phone, store**; ang buyer contact ay ang @username na na-scan (TikTok), gaya ngayon. Kahon: **"Nahanap sa Customers: @x — pakisuri · huling ginamit ‹petsa›"**. Cursor sa **Amount**. Lahat puwedeng i-edit |
| 4 | **Higit sa isang tugma** | **Walang kusang napupunan** maliban sa @username. Pagpipilian — pinakabago sa itaas, bawat hanay: pangalan · phone · **store** · petsa. Pamagat: **"3 record para kay @x — iba-iba ang store"** (o "iba-iba ang phone"; kung pangalan lang ang iba: "3 record para kay @x"). Huling pindutan: **"Wala rito — ita-type ko"**. Hanggang 5 ang ipinapakita; kung higit: "at N pa — buksan ang Customers" |
| 5 | **Walang tugma** | @username lang, toast gaya ngayon — **eksaktong gaya ngayon** (walang kahon, walang dagdag na mensahe) |
| 6 | **Hindi nabasa** | Gaya ngayon |
| 6 | **Walang signal / error / lampas 4 s** | @username napunan (gaya ngayon) + maikling mensahe: **"Hindi nahanap sa Customers ngayon — i-type, o gamitin ang Customers"** |
| 7 | **Save, export, batch cap, mga check, ⇄** | Walang binago. Ang napunang form ay karaniwang form — dumadaan sa parehong validation at save |

**Kailan HINDI kusang pinupunan (kahit isa ang tugma):**
- **May naka-type na** sa pangalan, phone o store (hal. galing sa OCR ng camera sa 7-11, o tinype na ng encoder) → hindi
  pinapatungan. Lalabas ang tugma bilang **mungkahi**: "Nahanap sa Customers: @x" + pindutang **"Gamitin"**.
- **Nag-e-edit ng naka-save na parcel** → Scan QR ay **gaya ngayon lang** (@username). Walang hanap.

---

## 4. MGA BUTAS AT AYOS
"Ayos" = gagawin sa Hakbang 2; bawat isa ay may test sa §5. Wala pang napatunayan sa mga ito.

| # | Panganib | Paano mangyayari | Ayos |
|---|---|---|---|
| B1 | **Details ni A, username ni B** | Na-scan si A (napunan), tapos na-scan si B na walang tugma → ngayon, username lang ang pinapalitan → naiwan ang pangalan/phone/store ni A | Tinatandaan ng form kung alin ang **kusang napunan at hindi pa ginalaw**. Sa bagong scan: ang mga iyon ay **binubura muna** bago ilapat ang bagong resulta. Kung ginalaw na ng encoder → hindi binubura, pero dilaw na babala: "Bagong username — pakisuri ang details" |
| B2 | Pinalitan ng encoder ang username sa field pagkatapos mapunan | Details ng dating buyer, bagong username | Ang kahon ay nakatali sa username na hinanap; kapag iba na ang nasa field → nagiging babala: "Ang details ay galing kay @x — pakisuri" |
| B3 | **Username na ginamit na ng ibang tao** | Binitawan ng dating may-ari, kinuha ng iba → details ng dating tao | Hindi ito matutukoy mula sa username lang. Kaya: laging "pakisuri", laging may **petsa ng huling gamit** at **pangalan** sa kahon. Kapareho ng panganib ngayon kapag naghanap sa Customers. (Aral mula sa kinanselang plano: walang "berde/tiyak" dito — lahat ay "pakisuri") |
| B4 | **Lumang record** | Lumipat na ng store o nagpalit ng phone | Petsa ng huling gamit sa kahon at sa bawat hanay. Ngayon, walang record na lampas 90 araw [§1.2]; Tanong 3 kung gusto ng mas matinding babala kapag luma |
| B5 | **Dobleng record** (725 username: parehong phone at store, baybay ng pangalan lang ang iba) | Typo sa pangalan sa nakaraan | Pagpipilian pa rin (magkaiba ang pangalan); pinakabago sa itaas. Hindi pinagsasama nang kusa — desisyon ng encoder |
| B6 | **Iba-ibang store / phone** (435 / 795 username) | Bumibili para sa iba; lumipat | Pagpipilian, hindi kusang pumipili; malinaw na "iba-iba ang store" |
| B7 | **Mabagal na network** | Dumating ang sagot pagkatapos mag-type ng encoder | Bawat hanap ay may token; ang sagot ay inilalapat **lang** kung pareho pa ang entry at **blangko pa** ang pangalan/phone/store. Kung hindi → mungkahi lang, o itinatapon |
| B8 | **Race sa Save** | Pinindot ang Save habang naghahanap; dumating ang sagot pagkatapos | **Hindi hinaharangan ang Save** (walang ikinakabit sa Save). Ang Save, Cancel, Clear at paglipat sa susunod na litrato ay nagpapalit ng token → itinatapon ang huling sagot, kaya **hindi nito mapupunan ang susunod na parcel** |
| B9 | **Dalawang sunod na scan** | Mabilis na magkasunod | Ang bago ang panalo; itinatapon ang sagot ng nauna |
| B10 | **⇄ bridge** | Lumipat sa kabilang screen habang may napunan | Ang napunang form ay kasama na sa draft ngayon (`form`). Idadagdag sa draft ang maliit na tanda (aling username, petsa, alin ang kusang napunan) para bumalik ang kahon. **Hindi tumatawid** sa kabilang screen. Ang "hold" bago mag-save (`parcelDrafts.ts:43`) ay dapat ding magbura ng tandang ito. Ang pagpipilian (sitwasyon 4) ay hindi ibinabalik — i-scan ulit |
| B11 | Hanap habang lumilipat ng screen | Dumating ang sagot pagkaalis | Itinatapon (token + naka-mount na tsek; ang 7-11 handler ay walang ganitong tsek ngayon, ang FamilyMart ay meron — `FmParcelScan.tsx:212`) |
| B12 | **Maling tugma dahil sa `_`** | Maluwag ang query | Huling eksaktong tsek sa app (§2.1) |
| B13 | "unknown" o hindi TikTok | Naka-save na LINE/WhatsApp/Facebook contact na kapareho ng username | Hindi kailanman tinutugma (tuntunin ng platform); "unknown" ay hindi hinahanap |
| B14 | Data ng ibang seller | Admin account; maling filter | Tahasang `user_id` + RLS na sariling row lang [§1.1]. Test na may dalawang user |
| B15 | Store na mali o sarado na sa Customers | Naka-save noon na mali | Hindi bago: ang bawat bagong parcel ay dumadaan pa rin sa parehong check ng store/phone pagkatapos ng Save (walang binago) |
| B16 | Buyer na inalis sa Customers (restricted na phone) | Umiiral na tuntunin | Walang tugma → gaya ngayon |
| B17 | Higit sa 20 record sa isang username (pinakamarami: 47) | — | 5 ang ipinapakita + "at N pa — buksan ang Customers" |
| B18 | Pagkakaiba ng tuntunin ng 7-11 at FamilyMart sa pangalan/phone | Record na hindi na pumapasa sa validation ngayon | Ang napunan ay dumadaan sa parehong validation ng form; pula ang field kung mali, gaya ng tinype |
| B19 | Hindi sinasadyang pagbabago kapag naka-OFF | — | Naka-OFF → walang query, parehong DOM at parehong save gaya ngayon (permanenteng test) |

---

## 5. Listahan ng test (Hakbang 2)
- **Pagtutugma (purong function):** `Maria_Shops` / `@maria_shops` / `maria_shops` → tugma; `mariaXshops` (dahil sa `_`) → hindi;
  `maria_shops2` → hindi; platform `line`/`whatsapp`/`facebook`/`instagram`/`other` → hindi; `unknown` at blangko → hindi
  hinahanap; pagkakasunod = pinakabago muna; "iba-iba ang store / phone / pangalan lang".
- **Bawat sitwasyon, sa 7-11 at sa FamilyMart:** 1 tugma → 3 field napunan, contact = na-scan, cursor sa Amount, kahon na may
  petsa; 2+ → walang napunan, pagpipilian, pindot → napunan; "Wala rito" → sarado, walang napunan; 0 → **DOM at toast =
  ngayon**; error / timeout → username + mensahe; hindi nabasa → ngayon.
- **Hiwalay ang screen:** tugma sa 7-11 lang → walang napupunan sa FamilyMart, at baliktad; ang query ng bawat screen ay sa
  sariling table lang.
- **B1:** scan A (napunan) → scan B (walang tugma) → blangko ang pangalan/phone/store; kung in-edit muna → nananatili + babala.
- **B2, B7, B8, B9, B11:** pinalitan ang username → babala; huling sagot pagkatapos mag-type → hindi pumapatong; Save habang
  naghahanap → naka-save ang tinype, ang **susunod** na entry ay blangko; dalawang scan → huli ang panalo; umalis sa screen → walang error.
- **B10:** ⇄ at pagbalik → form at kahon ay naibalik; ang kabilang screen ay walang napunan; "hold" → nabura ang lahat.
- **May naka-type na / OCR / edit mode:** hindi pinapatungan; "Gamitin" → pinupunan; edit mode → walang query.
- **Walang binago:** payload ng Save (7-11 at FM) ay kapareho ng ngayon; export, batch cap, mga check — mga umiiral na suite,
  hindi ginagalaw. Naka-OFF → walang query at parehong DOM (B19).
- **RLS / B14:** dalawang user sa PGlite o sa test account → walang row ng iba.
- **Bilis:** sukat sa test account mula sa phone (kasama ang network).
- i18n × 8 wika; 360 / 390 / 430 px (walang putol, walang dagdag na linya sa header); `npm run typecheck`, `npm test`,
  `npm run build`; lint = parehong bilang sa main.
- **Sa totoong device (si Jeff):** iPhone at Android — scan ng totoong sticker ng kilalang buyer, ng buyer na maraming
  record, at ng bagong buyer; 7-11 at FamilyMart; mahinang signal.

---

## 6. Ano ang gagalawin sa Hakbang 2 (listahan lang)
- BAGO `src/redesign/adapters/scanQrLookup.ts` (query + purong function ng pagtutugma) + test.
- `screens/ParcelScan.tsx`, `screens/FmParcelScan.tsx` (pagkatapos ng umiiral na `onScanQr`: hanap, kahon, pagpipilian).
- `adapters/parcelDrafts.ts` (tanda sa draft; "hold").
- `adapters/featureSwitches.ts` kung may switch (Tanong 1). i18n × 8 wika.
- `docs/support/sfl-guide.md` + `sql/116b` (tuntunin ng help guide — nakikita ito ng seller).
- **Hindi gagalawin:** anumang file ng printing, `src/lib/tiktokHandle.ts`, `server.js`, `db.ts`, mga table at trigger, ang
  save/export. Walang bagong SQL para sa hanap.

---

## 7. Self-audit (hiwalay na reviewer)
> Pupunan pagkatapos ng review.

---

## 8. MGA TANONG PARA KAY JEFF
1. **Paglabas:** (a) bukas agad sa lahat ng may Parcel Scan, o (b) may switch na naka-OFF muna (admin lang ang makakakita
   hangga't hindi binubuksan)? Ang (b) ay nangangailangan ng **isang row** sa `app_settings` kapag bubuksan na (walang
   pagbabago sa schema).
2. **Kulay ng kahon ng isang tugma:** asul ("Nahanap sa Customers… pakisuri") gaya ng nasa mockup, o dilaw gaya ng
   pagpipilian?
3. **Lumang record:** gusto mo bang mas matinding babala kapag matagal nang hindi nagamit ang record (hal. lampas 90 o 180
   araw)? Ngayon ay petsa lang ang ipinapakita.
4. **May naka-type na** (hal. galing sa OCR ng camera): sa plano, hindi pinapatungan — mungkahi na may pindutang "Gamitin".
   Ayos ba?
5. **Nag-e-edit ng naka-save na parcel:** sa plano, Scan QR ay gaya ngayon (walang hanap). Ayos ba?
6. **Dobleng record na pangalan lang ang iba** (725 username): pagpipilian pa rin, o kusang piliin ang pinakabago?
7. Mga salita sa screen (nasa mockup ay mungkahi lang, English muna).

---

## 9. Ano ang may patunay at ano ang HINDI PA
**May patunay:** ang ginagawa ng Scan QR at ng parser ngayon (§1.1); ang bilang ng record bawat username at ang kalagayan ng
naka-save na username (§1.2); ang bilis ng hanap sa database at na walang index na kailangan (§1.3); na ang "walang tugma" sa
mockup ay ang totoong screen ngayon (totoong QR na ipinasa sa totoong Scan QR — `docs/design/scan-qr-lookup/README.md`).

**HINDI PA NAPAPATUNAYAN:**
| Ano | Paano mapapatunayan |
|---|---|
| Gumagana ang disenyo ng §2–§4 | Wala pang code; mga test ng §5 |
| Bilis mula sa phone, kasama ang network; ang eksaktong query sa PostgREST | Sukat sa test account sa Hakbang 2 |
| Itsura ng mga kahon sa dark theme at sa 8 wika | Totoong screen sa Hakbang 2 (light at English lang ang mockup) |
| Na sapat ang "pakisuri" para hindi mapunan ng maling tao (B3) | Hindi ito mapapatunayan ng test — umaasa sa pagsusuri ng encoder |
