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

## Naka-OFF = kapareho ng `main`
`compare-with-main.cjs` — parehong hakbang (manual entry, Scan QR ng `@annc_tw`, na **may** 3 record) sa `main` (`119257aa`)
at sa branch na naka-OFF ang switch (`?qlookup=off`). Inihambing ang buong HTML ng form, ang mensahe at ang cursor — agad
pagkatapos ng scan at 1.3 segundo pagkatapos; 7-11 at FamilyMart; 360 px at 1280 px.
Resulta (`compare-with-main.log`): **24 sa 24 magkapareho.** (Preview database, hindi production.)

## sql/150 — "isang username = isang record" (NAKASULAT, HINDI IN-APPLY)
- Binuo mula sa LIVE na dalawang function (binasa 2026-11-12, read-only). Ang rollback file **ay** ang live na teksto —
  parehong fingerprint (md5) sa live database: `0b295f54…` (7-11) at `b2cd4f05…` (FamilyMart).
- Patunay sa **pansamantalang database** (PGlite; hindi kailanman ang live): `scripts/sql150-behaviour.mjs` →
  `sql150-behaviour.log`: **95 tsek, 95 pumasa.** Kasama: naka-OFF = kapareho ng live na function, hanay por hanay;
  pinakabago ang natitira; `(U)`; `@ pedro123`; `@pedro12` ≠ `@pedro123` ≠ `@pedro1234`; banggaan sa unique index (parehong
  phone + pangalan) — hindi pumapalya ang save; "no social handle"; ibang app; `unknown`; restricted na phone; maling store;
  ibang seller at ibang store na table ay hindi nagagalaw; **laging tagumpay ang parcel save** kahit pumalya ang bagong bahagi.
- Sinadyang sirain ang kopya ng sql/150 sa **23 paraan** — lahat nahuli ng patunay.
- Ang rule #4 sa database at sa app ay iisang listahan ng 47 halimbawa
  (`src/redesign/adapters/__tests__/fixtures/scanQrUsernameKey.json`): pareho ang sagot sa app, sa pansamantalang database,
  at sa **live na Postgres 17.6** (isang read-only na `select`, walang ginawang function): 47 sa 47.
- Bigat sa pinakamalaking seller (7,643 record), sa hugis na gagamitin ng trigger (read-only na sukat sa live): 19 ms sa una,
  7 ms sa pangalawa, sa bawat save ng parcel na may username — para lang sa account na bukas ang feature.

## Mga dapat malaman ni Jeff (hindi ko hinulaan — nakalista)
1. **Mawawala ang "(U)" kapag QR ang ginamit.** Ang isinusulat sa record ay ang contact text ng **bagong parcel**. Kapag
   nag-Scan QR, ang nasa field ay ang username lang (hal. `annc_tw`), kaya pagka-save ay iyon na ang nasa record — wala na ang
   "(U)" maliban kung i-type ulit ng encoder.
2. **`@pedro123(U)` (walang space bago ang tala) ay HINDI tugma** — sinunod nang literal ang "unang salita". Sa live data
   ngayon: 102 record (7-11) at 8 (FamilyMart) ang ganito.
3. **`pedro123 (U)` (walang `@`, may space) ay HINDI tugma** — ayon sa utos. Sa live data: 2,295 record (7-11), 67 (FamilyMart).
4. **Kapag may record na may parehong phone + pangalan ng parcel, IYON ang natitira** (hindi palaging ang pinakabago) — dahil
   iisa lang ang puwedeng record sa parehong phone + pangalan. Pareho ang laman ng resulta; ang ibang record ng username ay
   binubura pa rin.
5. **Late na hatol o edit ng MAS LUMANG parcel ng parehong username:** isinusulat ulit nito ang iisang record gamit ang
   detalye ng lumang parcel (ganito na rin ngayon kapag pareho ang phone + pangalan). Hindi ko ito hinarangan — wala sa utos.
   Kung gusto mong harangan, sabihin lang.
6. **Sa live data ngayon (7-11):** 1,644 username ang may 2 o higit pang record; 2,247 dagdag na record ang unti-unting
   mawawala habang may bagong save ang bawat username (pinakamarami sa isang username: 60). FamilyMart: 1 username.
   Walang binubura nang sabay-sabay.
7. **"Space" = karaniwang space, tab at bagong linya lang.** Ang full-width na space (全形) ay hindi itinuturing na space —
   wala pang ganitong record sa live data.
8. **Walang admin bypass** (gaya ng Hakbang 2): switch o listahan lang.
9. **Pagkatapos ng Import mula sa Customers:** kung may napunan ang Scan QR sa kasalukuyang entry, nililinis ang buong entry
   (gaya ng Hakbang 2).

## HINDI PA NAPAPATUNAYAN
- Ang totoong tanong ng app sa totoong API (lalo na ang space sa loob ng filter, at username na may `.` at `_`) at ang bilis
  mula sa phone — walang login para subukin dito. Mapapatunayan sa scan ng totoong sticker gamit ang account na nasa listahan.
- sql/150 sa **live** na database — hindi in-apply. Ang patunay ay sa pansamantalang database (Postgres 16) na kinopyahan ng
  live na schema; ang live ay Postgres 17.6.
- Dalawang device na sabay nagse-save ng parehong username sa parehong sandali — hindi masusubok sa pansamantalang database
  (iisang koneksyon). Ang code ay bumabalik sa lumang paraan kapag may hindi inaasahan, at may tsek para sa "nawala na ang
  record"; pero walang totoong sabayang pagsubok.
- Totoong phone at camera; dark theme; ibang wika (walang bagong salita sa screen sa hakbang na ito).
