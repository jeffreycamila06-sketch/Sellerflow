# Scan QR → punan mula sa Customers — Hakbang 3 (desisyon ni Jeff, 2026-11-12)

**Walang listahan, walang kahon.** Pagka-Scan QR (kapag bukas ang feature para sa account):
- may record ang username → diretsong napupunan ang pangalan, phone at store mula sa **pinakabagong** record;
- may naka-type na sa pangalan, phone o store → walang pinupunan, walang lumalabas;
- walang record / error / lampas 4 segundo → eksaktong gaya ngayon (username lang), walang mensahe.

Ang mga larawan dito ay **totoong screen** ng app sa preview database (`src/dev/fakeSupabase.ts`; naka-ON doon ang switch
para lang sa preview). **Totoong QR na larawan** ang ipinasa sa totoong pindutang **Scan QR** — walang iginuhit sa ibabaw.

```bash
npx vite --config vite.preview.config.ts --port 5199
```
```bash
node docs/design/scan-qr-lookup/built/make-built.cjs
```

## Mga larawan (16)
`<711|fm>_<sitwasyon>_<lapad>.jpg` — lapad: `iphone390`, `android360`, `android430`, `laptop1280`.

| Sitwasyon | Na-scan | Ano ang makikita |
|---|---|---|
| `1-filled` | `@annc_tw` — may **3 record** sa preview; ang pinakabago ay naka-save bilang `@annc_tw (U)` | Napunan ang pangalan, phone at store ng pinakabagong record; cursor sa Amount. Walang kahon, walang listahan |
| `2-no-match` | `@newbuyer_tw` (walang record) | Username lang at ang dating mensahe |

Sa preview database may sadyang mga record na **hindi dapat gamitin**: `annc_tw2` (ibang username) at isang `annc_tw` na LINE
ang app. Hindi sila ang napunan.

**Sinukat ng script habang kinukuha ang mga larawan** (`make-built.log`): 16 larawan · bagong elemento sa screen: **0** ·
pahinang may pahalang na scroll: **0** · parehong taas ng bar sa itaas sa lahat ng lapad.

## Mga test ng app
153+ test sa limang file (`scanQrLookup.test.ts`, `scanQrLookupSql150.test.ts`, `ScanQrLookup.{screens,camera,offOn}.test.tsx`).
Sinadyang sirain ang code ng app sa **47 paraan** (sa hiwalay na kopya) — lahat nahuli ng mga test
(`proof/app-breakages.py` → `proof/app-breakages.log`).

## Naka-OFF = kapareho ng `main`
`compare-with-main.cjs` — parehong hakbang (manual entry, Scan QR ng `@annc_tw`, na **may** 3 record) sa `main` (`119257aa`)
at sa branch na naka-OFF ang switch (`?qlookup=off`). Inihambing ang buong HTML ng form, ang mensahe at ang cursor — agad
pagkatapos ng scan at 1.3 segundo pagkatapos; 7-11 at FamilyMart; 360 px at 1280 px.
Resulta (`compare-with-main.log`): **24 sa 24 magkapareho.** (Preview database, hindi production.)

## sql/150 — "isang username = isang record" (NAKASULAT, HINDI IN-APPLY)
Binuo mula sa LIVE na dalawang function (binasa 2026-11-12, read-only). Ang rollback file **ay** ang live na teksto — parehong
fingerprint (md5) sa live database. Walang table, column, index, trigger o policy na binago; walang backfill.

**Ang hiwalay na reviewer ay may nakitang 3 mabigat na butas sa unang bersyon** (sinunod nito nang literal ang rule 7).
Kinumpirma ko ang bawat isa sa live data (`proof/live-readonly-checks.md`) at nilagyan ng **tatlong bantay**. Bawat bantay
ay nagpapaliit lang ng ginagawa ng bagong bahagi: kapag "hindi" ang bantay, **eksaktong gaya ngayon** ang resulta at walang
binubura.

| Bantay | Ano | Bakit (patunay) |
|---|---|---|
| **A — parehong buyer lang** | Ang isinasama / binubura ay ang mga record lang ng username na may **parehong phone o parehong pangalan** ng parcel | Ang contact ay malayang text. Sa live: isang seller ay may 60 buyer (59 phone) na `c` ang contact; may `printer`, `user`, mga unang pangalan. Kung wala ito, ang unang bagong parcel na `c` ang contact ay magbubura sa lahat ng buyer na iyon |
| **B — pagkatapos ng hatol (7-11)** | Walang isinasama hangga't hindi `valid` ang store **at** `ok` ang phone | Nagse-save muna ang app; ilang segundo bago dumating ang hatol. Kung wala ito, ang maling store o restricted na phone ay papalit agad sa tamang record ng buyer |
| **C — pinakabagong parcel ang panalo** | Kapag may mas bagong parcel ang parehong buyer + username, ang mas lumang parcel (late na hatol, re-check, edit) ay **walang isinusulat** sa Customers | Kung wala ito, ibabalik ng lumang parcel ang lumang phone / store |

Kaya ang totoong gawi ng sql/150 ngayon: **isang username = isang record BAWAT BUYER** (parehong phone o pangalan).
Ito ay **iba sa literal na rule 7** ("burahin ang iba pang record ng parehong key") — tingnan ang "Mga dapat malaman" sa ibaba.

**Patunay sa pansamantalang database** (PGlite, Postgres 16; hindi kailanman ang live) — `scripts/sql150-behaviour.mjs`,
resulta sa `sql150-behaviour.log`: **134 tsek, 134 pumasa.** Ginagaya ng patunay ang totoong pagkakasunod ng app (save na
walang hatol → hatol ng store → hatol ng phone). Kasama: naka-OFF = kapareho ng live na function, hanay por hanay (pati
hatol, re-check, edit at isang update ng maraming parcel); `(U)`; `@ pedro123`; `@pedro12` ≠ `@pedro123` ≠ `@pedro1234`;
6 na buyer na `c` ang contact + ika-7 = walang nabura; parcel ng ibang tao na mali ang username = walang nabura; maling
store / restricted (totoong pagkakasunod) = kapareho ng live; lumang parcel pagkatapos ng bago = bago pa rin ang nasa record;
banggaan sa unique index = hindi pumapalya; **laging tagumpay ang parcel save** kahit pumalya ang bagong bahagi.
- Sinadyang sirain ang kopya ng sql/150 sa **36 na paraan** — lahat nahuli ng patunay
  (`proof/sql150-breakages.py` → `proof/sql150-breakages.log`).
- Rule #4: iisang listahan ng 47 halimbawa para sa app at sa database
  (`src/redesign/adapters/__tests__/fixtures/scanQrUsernameKey.json`); pareho ang sagot sa app, sa pansamantalang database
  at sa live na Postgres 17.6 (read-only).
- Bigat: `proof/live-readonly-checks.md` §6. Sa pansamantalang database, ang isang parcel (save + 2 hatol) ay 2.7 ms sa live
  na function at 5.0 ms sa sql/150 — para sa LAHAT ng seller, bukas man o hindi ang feature (maliit na dagdag sa bawat save).

## Mga dapat malaman ni Jeff (hindi ko hinulaan — nakalista; sabihin kung iba ang gusto)
1. **Tatlong bantay sa sql/150 na wala sa utos mo** (A, B, C sa itaas). Idinagdag dahil ang literal na rule 7 ay magbubura ng
   record ng iba-ibang buyer sa totoong data. Epekto ng bantay A: kapag ang buyer ay nagpalit ng **phone AT pangalan nang
   sabay**, hindi pagsasamahin — dalawa ang record niya (gaya ngayon). Kung gusto mong alisin o baguhin ang alinmang bantay,
   isang linya lang bawat isa.
2. **Sa app, walang ganitong bantay** (ayon sa utos: punan mula sa pinakabago, walang lalabas). Kung ang TikTok username na
   na-scan ay kapareho ng salitang ginagamit ng seller bilang contact ng iba-ibang buyer (hal. `user`, isang unang
   pangalan), mapupunan ang detalye ng **pinakabagong** record na may ganoong contact — puwedeng ibang tao, at walang babala.
   Sa live: 137 ganitong grupo (3+ phone), 765 record. Nakikita ng encoder ang napunan at puwede niyang palitan.
3. **Mawawala ang "(U)" kapag QR ang ginamit.** Ang isinusulat sa record ay ang contact text ng **bagong parcel**. Pagka-Scan
   QR, ang nasa field ay username lang (hal. `annc_tw`), kaya pagka-save ay iyon na ang nasa record — maliban kung i-type
   ulit ng encoder ang "(U)".
4. **`@pedro123(U)` (walang space bago ang tala) ay HINDI tugma** — literal na "unang salita". Live: 102 record (7-11), 8 (FM).
5. **`pedro123 (U)` (walang `@`, may space) ay HINDI tugma** — ayon sa utos. Live: 2,295 record (7-11), 67 (FM).
6. **Kapag may record na may parehong phone + pangalan ng parcel, IYON ang natitira** (hindi palaging ang pinakabago) — iisa
   lang ang puwedeng record sa parehong phone + pangalan. Pareho ang laman ng resulta.
7. **Mga 15% ng parcel ay hindi nagkakaroon ng parehong hatol** (hal. walang hatol ng store) → sa mga iyon, hindi kailanman
   nagsasama (gaya ngayon). Hindi apektado ang pagpuno sa app.
8. **Restricted na hatol PAGKATAPOS ng pagsasama** (bihira: 8 sa 16,163 parcel sa 30 araw): inaalis ang buyer (umiiral na
   tuntunin) at wala na ring lumang record niya na may ibang phone — naisama na.
9. **Sa live ngayon (7-11):** 1,644 username ang may 2+ record. Dahil sa bantay A, ang unti-unting mawawala ay ang mga dobleng
   record ng **parehong buyer** lang (788 username ang iisa ang phone; 719 ang 2 phone) habang may bagong save. Walang binubura
   nang sabay-sabay.
10. **"Space" = karaniwang space, tab at bagong linya lang** (hindi ang full-width na 全形 space; wala pang ganito sa live).
11. **Walang admin bypass**; **pagkatapos ng Import**, nililinis ang buong entry kapag may natitirang detalyeng pinunan ng
    Scan QR (gaya ng Hakbang 2).
12. **Help guide (`sql/116b`):** binabanggit nito na ina-update ang entry ng buyer sa halip na magdagdag — totoo lang iyon
    kapag na-apply na ang sql/150 at bukas ang feature sa account. **I-apply ang sql/116b pagkatapos ng sql/150.**

## HINDI PA NAPAPATUNAYAN
- Ang totoong tanong ng app sa totoong API (lalo na ang space sa loob ng filter, at username na may `.` at `_`) at ang bilis
  mula sa phone — walang login para subukin dito. Mapapatunayan sa scan ng totoong sticker gamit ang account na nasa listahan.
- **sql/150 sa live na database** — hindi in-apply. Ang patunay ay sa pansamantalang database (Postgres 16) na kinopyahan ng
  live na schema; ang live ay Postgres 17.6. Hindi rin nasukat sa live ang bigat ng buong bagong function.
- **Sabayang pagse-save** (dalawang device sa parehong username; ang checker na nag-a-update ng maraming parcel habang may
  nagse-save) — hindi masusubok sa pansamantalang database (iisang koneksyon). Sa pangangatwiran: ang bagong bahagi ay
  bumabalik sa lumang paraan kapag may error; ang hindi nagbagong `insert … on conflict` ay puwede pa ring maging biktima ng
  deadlock gaya ngayon. Walang totoong pagsubok.
- Kung gaano kadalas mangyari sa totoong gamit ang #2 (maling tao ang napunan) — hindi masusukat mula rito.
- Totoong phone at camera; dark theme (walang bagong salita o kahon sa screen sa hakbang na ito).
