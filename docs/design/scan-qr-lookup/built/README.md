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

**Sinukat ng script habang kinukuha ang mga larawan** (`make-built.txt`): 16 larawan · elemento ng dating kahon / listahan
sa screen: **0** · pahinang may pahalang na scroll: **0** · ang hilera ng "Batch" ay 50 px sa lahat ng lapad. (Ang purple na
header sa itaas ay hindi ginalaw ng branch na ito — kapareho ng nasa `main`.) Kinuha ang mga larawan pagkatapos isama ang
pinakabagong `main` (`4eef74f0`).

## Mga test ng app
Limang file (`scanQrLookup.test.ts`, `scanQrLookupSql150.test.ts`, `ScanQrLookup.{screens,camera,offOn}.test.tsx`).
Sinadyang sirain ang code ng app sa **47 paraan** (sa hiwalay na kopya): 46 ang nahuli ng isang `expect`; 1 (tinanggal ang
tsek na "walang record") ay nahuli dahil nag-error ang takbo ng test (unhandled error, exit 1) — hindi ng isang `expect`
(`proof/app-breakages.py` → `proof/app-breakages.txt`).

## Naka-OFF = kapareho ng `main`
`compare-with-main.cjs` — parehong hakbang (manual entry, Scan QR ng `@annc_tw`, na **may** 3 record) sa `main` (`4eef74f0`,
ang pinakabago noong sinulat ito — isinama na rin sa branch na ito)
at sa branch na naka-OFF ang switch (`?qlookup=off`). Inihambing ang buong HTML ng form, ang mensahe at ang cursor — agad
pagkatapos ng scan at 1.3 segundo pagkatapos; 7-11 at FamilyMart; 360 px at 1280 px.
Resulta (`compare-with-main.txt`): **24 sa 24 magkapareho.** (Preview database, hindi production.)

## sql/150 — pag-save ng parcel → Customers (NAKASULAT, HINDI IN-APPLY)
Binuo mula sa LIVE na dalawang function (binasa 2026-11-12, read-only). Ang rollback file **ay** ang live na teksto — parehong
fingerprint (md5) sa live database. Walang table, column, index, trigger o policy na binago; walang backfill.

### ⚠️ Hindi ito ang literal na rule 7 — mas makitid, at si Jeff ang magpapasya
Ang utos: *"i-update ang PINAKABAGO at BURAHIN ang iba pang record ng parehong username."*
Dalawang beses itong sinuri ng hiwalay na reviewer. Sa totoong data, ang literal na bersyon ay magbubura ng record ng
**iba-ibang buyer** (ang contact ay malayang text: isang seller ay may 60 buyer na `c` ang contact). Kaya ang nakasulat
ngayon ay ganito:

> Kapag nag-save ng parcel na may TikTok username: tinitingnan ang **ibang** record ng username na iyon
> ("iba" = hindi ang record na may eksaktong phone + pangalan ng parcel).
> - **Walang iba** → gaya ngayon.
> - **Eksaktong isa, at pareho ang phone O pangalan nito sa parcel** → isa na lang ang record ng buyer, may bagong
>   pangalan, phone, store, buong contact text (kasama ang "(U)") at app.
> - **Eksaktong isa pero iba ang phone AT pangalan** → gaya ngayon (ibang tao iyon).
> - **Dalawa o higit pa** → gaya ngayon. Walang ginagalaw.
>
> Kaya **pinakamarami, ISANG record ang nabubura sa bawat save.**

| Bantay | Ano | Bakit | HINDI sakop |
|---|---|---|---|
| **A — isang ibang record lang, ng parehong buyer** | Nasa itaas | Salitang gamit ng maraming buyer (`c`, `user`, `printer`, unang pangalan) — hindi username ng isang tao | Dalawang **magkaibang** buyer na pareho ang salita **at** pareho ang phone o pangalan, at silang dalawa lang ang may salitang iyon → napapalitan ang mas luma |
| **B — 7-11: pagkatapos ng dalawang hatol** | Nagsasama lang kapag `valid` ang store **at** `ok` ang phone. Ang mismong update na nagpapalit ng store # o phone ay hindi nagsasama (luma pa ang hatol sa row) | Nagse-save muna ang app; ilang segundo bago dumating ang hatol. Ayaw nating **mabura** ang ibang record ng buyer dahil sa maling store o restricted na phone | (1) **Hindi nito pinipigilan** ang pagsulat ng sariling record ng parcel sa mismong save — may store man na hindi pa natsetsek. Iyan ang gawi ngayon, hindi binago. (2) Pag in-edit ang store # at walang bagong hatol na naisulat (isinara agad ang app, o hindi 6 na digit ang store), nananatili ang lumang `valid` at puwedeng magsama sa susunod na sulat sa parcel na iyon |
| **C — pinakabagong parcel ang panalo** | Kapag may **mas bagong** parcel ang parehong buyer + username na pasado na (7-11: `valid` + `ok`; FamilyMart: kahit alin) at may record na ang buyer → ang mas lumang parcel ay **walang isinusulat** sa Customers | Kung wala ito, ibabalik ng late na hatol, re-check o edit ng lumang parcel ang lumang phone / store | **Ito ang nag-iisang lugar na MAS KAUNTI ang ginagawa kaysa ngayon:** ang pag-edit ng LUMANG parcel (may mas bago na) ay hindi na nagbabago ng Customers. Kapag binura ang mas bagong parcel at ginalaw ulit ang luma, babalik ang detalye ng luma |

Sa bantay C, hindi binibilang ang mas bagong parcel na: restricted ang phone, tinanggihan ang store, walang phone, ibang app,
o ibang username. Kapag ang mas bagong parcel ay **wala pang hatol** → eksaktong gaya ngayon (walang isinasama, walang
nilalaktawan). Kapag binura na sa Customer Details ang record ng buyer → gaya ngayon (naidadagdag ulit ang buyer).

**Ano ang ibig sabihin nito sa live data ngayon (7-11, basa lang — `proof/live-readonly-checks.md` §4b):**
- 37,964 username ang may 1 record — walang babaguhin hangga't walang bagong parcel na iba ang phone o pangalan.
- 1,415 username ang may eksaktong 2 record: **1,164** ang pareho ang phone o pangalan (magiging isa kapag nag-save ng parcel
  na may phone + pangalan ng isa sa dalawa); **251** ang walang pareho (hindi gagalawin).
- **233 username (1,069 record) ang may 3 o higit pa — hindi kailanman gagalawin ng sql/150.** 40 dito ay iisa ang phone at
  38 ay iisa ang pangalan (malamang iisang buyer na dati nang nadoble) — mananatiling doble maliban kung linisin nang kamay.

**Patunay sa pansamantalang database** (PGlite, Postgres 16; hindi kailanman ang live) — `scripts/sql150-behaviour.mjs`,
resulta sa `sql150-behaviour.txt`: **188 tsek, 188 pumasa, 0 bumagsak.** Ginagaya ng patunay ang totoong
pagkakasunod ng app: save na walang hatol → hatol ng store → hatol ng phone; at ang edit ay nagpapadala ng lahat ng field at
binubura ang hatol ng phone kapag nagbago ang phone (gaya ng `updateParcelScan`). Kasama:
- naka-OFF = kapareho ng live na function, hanay por hanay (pati hatol, re-check, edit at isang update ng maraming parcel);
- `(U)`, `@ pedro123`, `@pedro123 Garcia (NA)`; `@pedro12` ≠ `@pedro123` ≠ `@pedro1234`;
- 6 na buyer na `c` ang contact + ika-7 + isa sa kanila na bumalik = kapareho ng live; Ana / Bea / Cara na iisa ang phone at
  `c` ang contact = kapareho ng live; username na 3 na ang record = kapareho ng live;
- maling store / restricted / store na in-edit sa mali (totoong pagkakasunod) = kapareho ng live;
- lumang parcel pagkatapos ng bago = bago pa rin ang nasa record; mas bagong parcel na restricted / tinanggihan / ibang app /
  walang phone / ibang username = hindi binibilang; dalawang parcel na sabay na-save = ang mas malaki ang id ang "bago";
- banggaan sa unique index = hindi pumapalya; **laging tagumpay ang parcel save** kahit pumalya ang bagong bahagi;
- ang mga **hindi sakop** ay ipinapakita rin sa log, may tatak na `NOT COVERED` — para makita ang totoong gawi.

Iba pang patunay:
- Sinadyang sirain ang kopya ng sql/150 sa **80 na paraan** (`proof/sql150-breakages.py` → `proof/sql150-breakages.txt`):
  lahat ng 80 ay nagpabagsak ng kahit isang tsek ng patunay.
- Rule #4: iisang listahan ng 47 halimbawa para sa app at sa database
  (`src/redesign/adapters/__tests__/fixtures/scanQrUsernameKey.json`); pareho ang sagot sa app, sa pansamantalang database
  at sa live na Postgres 17.6 (read-only).
- Bigat: `proof/live-readonly-checks.md` §6. Sa pansamantalang database (huling linya ng `sql150-behaviour.txt`), isang
  parcel (save + 2 hatol): 2.8 ms sa live na function · 4.5 ms sa sql/150 kapag hindi bukas ang seller · 6.1 ms kapag bukas — maliit na dagdag sa bawat save ng LAHAT ng seller, bukas man o hindi ang feature.

## Mga tanong / dapat pagpasyahan ni Jeff (hindi ko hinulaan)
1. **Bantay A — tama ba ang "isa lang ang nabubura bawat save; 2+ ibang record = hindi gagalawin"?** Kapalit nito: ang 233
   username na 3+ na ang record ay hindi malilinis ng sql/150, at ang buyer na may 2 lumang record + parcel na **ikatlong**
   phone ay magiging 3 record. Ang kabilang dulo (literal na rule 7) ay magbubura ng iba-ibang buyer sa mga grupong gaya ng `c`.
2. **Bantay B — 7-11 ay naghihintay ng `valid` + `ok`.** Mga 15% ng parcel ay hindi nagkakaroon ng parehong hatol (hal.
   walang hatol ng store) → sa mga iyon, hindi kailanman nagsasama (gaya ngayon). OK ba?
3. **Bantay C — ang pag-edit ng LUMANG parcel ay hindi na nagbabago ng Customers** kapag may mas bago nang pasadong parcel
   ang parehong buyer. OK ba, o gusto mong ang huling **ginalaw** ang masunod?
4. **Maling phone na na-type para sa tamang buyer** (parehong pangalan + username): papalitan nito ang tamang phone sa
   Customers — sa FamilyMart agad; sa 7-11 pagka-`ok` ng phone (ang `ok` ay "hindi restricted", hindi "kay buyer talaga").
   **Walang undo**; ang tamang phone ay nasa lumang parcel na lang. Ganito ang hiniling na rule ("i-update ng bagong phone").
5. **Help guide (`sql/116b`):** may isang pangungusap tungkol sa pagpapalit ng lumang entry sa Customers. Totoo lang iyon
   kapag na-apply ang sql/150. **I-apply ang sql/116b kasabay o pagkatapos ng sql/150** — o sabihin kung aalisin ko muna ang
   pangungusap na iyon.
6. **Mawawala ang "(U)" kapag QR ang ginamit.** Ang isinusulat sa record ay ang contact text ng **bagong parcel**. Pagka-Scan
   QR, username lang ang nasa field (hal. `annc_tw`), kaya iyon na ang nasa record pagka-save — maliban kung i-type ulit
   ang "(U)".

## Iba pang dapat malaman
7. **Sa app, walang bantay A** (ayon sa utos: punan mula sa pinakabago, walang lalabas). Kung ang na-scan na username ay
   kapareho ng salitang ginagamit ng seller bilang contact ng iba-ibang buyer (hal. `user`), mapupunan ang detalye ng
   **pinakabagong** record na may ganoong contact — puwedeng ibang tao, walang babala. Live: 137 ganitong grupo (3+ phone),
   765 record. Nakikita ng encoder ang napunan at puwede niyang palitan.
8. **Puwedeng mapunan ang store # na hindi pa pumasa sa tsek.** Isinusulat ng live na function ang record ng parcel sa mismong
   save (bago ang hatol) — gawi ngayon, hindi binago. Kapag iyon ang pinakabagong record ng username, iyon ang pupunuin ng app.
   (Tine-tsek pa rin ang store ng bagong parcel pagka-save, gaya ngayon.)
9. **`@pedro123(U)` (walang space bago ang tala) ay HINDI tugma** — literal na "unang salita". Live: 102 record (7-11), 8 (FM).
10. **`pedro123 (U)` (walang `@`, may space) ay HINDI tugma** — ayon sa utos. Live: 2,295 record (7-11), 67 (FM).
11. **Kapag may record na may parehong phone + pangalan ng parcel, IYON ang natitira** (kahit hindi iyon ang mas bago) — iisa
    lang ang puwedeng record sa parehong phone + pangalan. Pareho ang laman ng resulta.
12. **Restricted na hatol PAGKATAPOS ng pagsasama** (bihira: 8 sa 16,163 parcel sa 30 araw): inaalis ang buyer (umiiral na
    tuntunin) at wala na ring lumang record niya — naisama na.
13. **Parcel na walang pangalan (7-11) → gaya ngayon.** Hindi ito kasali sa bagong tuntunin, para hindi mapalitan ng record na
    walang pangalan ang record na may pangalan. Live: 1 sa 16,178 parcel sa 30 araw.
13b. **"Space" = karaniwang space, tab at bagong linya lang** (hindi ang full-width na 全形 space; wala pang ganito sa live).
14. **Walang admin bypass**; **pagkatapos ng Import**, nililinis ang buong entry kapag may natitirang detalyeng pinunan ng
    Scan QR (gaya ng Hakbang 2).
15. **Hindi "isang linya lang" ang pagbabago ng alinmang bantay** — magkakaugnay ang A, B at C at may kani-kaniyang tsek sa
    patunay. Kung may babaguhin, uulitin ang patunay at ang review.

## HINDI PA NAPAPATUNAYAN
- Ang totoong tanong ng app sa totoong API (lalo na ang space sa loob ng filter, at username na may `.` at `_`) at ang bilis
  mula sa phone — walang login para subukin dito. Mapapatunayan sa scan ng totoong sticker gamit ang account na nasa listahan.
- **sql/150 sa live na database** — hindi in-apply. Ang patunay ay sa pansamantalang database (Postgres 16) na kinopyahan ng
  live na schema; ang live ay Postgres 17.6. Hindi rin nasukat sa live ang bigat ng buong bagong function.
- **Sabayang pagse-save** (dalawang device sa parehong username; ang checker na nag-a-update ng maraming parcel habang may
  nagse-save) — hindi masusubok sa pansamantalang database (iisang koneksyon). Sa pangangatwiran lang: ang bagong bahagi ay
  bumabalik sa lumang paraan kapag may error; ang hindi nagbagong `insert … on conflict` ay puwede pa ring maging biktima ng
  deadlock gaya ngayon. Walang totoong pagsubok.
- Kung gaano kadalas mangyari sa totoong gamit ang #4, #7 at ang mga "HINDI sakop" ng tatlong bantay — hindi masusukat mula rito.
- Totoong phone at camera; dark theme (walang bagong salita o kahon sa screen sa hakbang na ito).
