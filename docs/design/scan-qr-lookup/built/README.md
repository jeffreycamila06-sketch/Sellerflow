# Scan QR → punan mula sa Customers — Hakbang 4 + ayos sa username na pinalitan nang kamay (mga desisyon ni Jeff, 2026-11-12)

**Walang listahan, walang kahon, walang mensahe.** Pagka-Scan QR (kapag bukas ang feature para sa account):
- may record ang username → diretsong napupunan ang pangalan, phone at store mula sa **pinakabagong** record;
- may naka-type na sa pangalan, phone o store → walang pinupunan;
- ang mga record ng "username" ay may **3 o higit pang magkakaibang phone** (salitang isinusulat para sa maraming buyer, hal.
  `user`) → walang pinupunan;
- walang record / error / lampas 4 segundo → eksaktong gaya ngayon (username lang);
- **pagkatapos mapunan, pinalitan NANG KAMAY ang username** (type o paste) at **ibang username na** → binubura ang mga
  napunang detalye na **hindi ginalaw** ng encoder at kinakalimutan ang punan — parehong code ng pag-scan ng ibang buyer.
  Ang ginalaw na ng encoder ay nananatili. "Parehong buyer pa rin" kapag ang text (walang `@` at space sa unahan, maliit
  na letra) ay **nagsisimula pa rin sa napunang username at ang kasunod ay hindi character ng username**: `pedro123 (U)`,
  `pedro123(U)`, `pedro123 #3`, `@Pedro123` → walang binubura. `pedro12`, `pedro1234`, `maria88`, binura sa pag-type →
  binubura. **Ang tsek na "walang handle / no contact" ay walang binubura.** Walang bagong UI o mensahe. Hindi tumatakbo
  kapag naka-OFF ang switch o habang nag-e-edit ng naka-save na parcel.

> **Ayos mula sa audit (2026-11-12, magaan na takbo).** Tatlong binago pagkatapos ng mga takbo sa ibaba: (1) ang tala
> pagkatapos ng username ay hindi na nagbubura; (2) ang tsek na "walang handle" ay hindi na nagbubura; (3) tugma na rin sa
> Customers ang `pedro123 (U)`, `pedro123(U)`, `pedro123 #3`, `@pedro123(U)` (dagdag na 8 hugis sa tanong sa database).
> **Hindi inulit** para dito: ang mga sinadyang pagsira (`proof/`), ang hiwalay na reviewer, ang mga larawan,
> `make-handchange.txt` (ang kaso D doon ay lumang gawi) at `compare-with-main.txt`. Pinatakbo lang: typecheck at ang 4 na
> test file ng Scan QR lookup (361 test); ang buong suite ay sa CI. Ang mga bilang sa live (`proof/live-readonly-checks.md`)
> ay sinukat sa lumang rule #4 — hindi inulit; ngayon mas maraming record ang tutugma (hal. 2,295 na `x (U)` sa 7-11).

**BUMABASA lang ito ng Customers. Walang binago sa pag-save ng parcel sa Customers** — walang binubura, walang pinapalitan,
walang bagong SQL para doon (7-11 at FamilyMart ay eksaktong gaya ng live ngayon).

Ang mga larawan dito ay **totoong screen** ng app sa preview database (`src/dev/fakeSupabase.ts`; naka-ON doon ang switch
para lang sa preview). **Totoong QR na larawan** ang ipinasa sa totoong pindutang **Scan QR** — walang iginuhit sa ibabaw.

```bash
npx vite --config vite.preview.config.ts --port 5199
```
```bash
node docs/design/scan-qr-lookup/built/make-built.cjs
```

## Mga larawan (28)
`<711|fm>_<sitwasyon>_<lapad>.jpg` — lapad: `iphone390`, `android360`, `android430`, `laptop1280`.

| Sitwasyon | Na-scan | Ano ang makikita |
|---|---|---|
| `1-filled` | `@annc_tw` — may 3 record sa preview (2 magkaibang phone); ang pinakabago ay naka-save bilang `@annc_tw (U)` | Napunan ang pangalan, phone at store ng pinakabagong record; cursor sa Amount. Walang kahon, walang listahan |
| `2-no-match` | `@newbuyer_tw` (walang record) | Username lang at ang dating mensahe |
| `3-shared-word` | `@user` — sa preview, `user` ang contact ng 3 buyer na may 3 magkakaibang phone | Username lang at ang dating mensahe — kapareho ng `2-no-match` |
| `4-hand-change-before` / `-after` (iphone390 lang) | `@annc_tw`, tapos **in-type nang kamay** ang `another_buyer` sa username | Bago: napunan. Pagkatapos: blangko ang pangalan, phone at store; walang bagong linya o mensahe (ang pulang paalala sa store # ay ang dati nang paalala ng blangkong store) |

Sa preview database (7-11 at FamilyMart) may sadyang mga record na **hindi dapat gamitin**: `annc_tw2` (ibang username) at
isang `annc_tw` na LINE ang app — parehong mas bago kaysa sa tamang record. Hindi sila ang napunan, at hindi sila kasama sa
bilang ng phone. (Ang preview database ay hindi nagsasala gaya ng totoong database — ibinabalik nito ang lahat ng record ng
seller, kaya ang huling tsek ng app ang nakikita sa mga larawan, hindi ang tanong sa database.)

Ang 24 na larawan ng sitwasyon 1–3 ay mula sa Hakbang 4 (**hindi inulit** sa ikot na ito — walang binago sa itsura). Ang 4 na
larawan ng sitwasyon 4 ay bago (`make-handchange.cjs`).

**Username na pinalitan nang kamay — totoong browser, naka-ON** (`make-handchange.cjs` → `make-handchange.txt`): 7-11 at
FamilyMart × 360 / 390 / 430 / 1280 px × 6 tsek = **48 tsek, lahat ayon sa inaasahan**: (A) parehong username na `@ANNC_TW` →
walang nabura; (B) binago ng seller ang phone, tapos ibang username → nanatili ang phone, nabura ang pangalan at store;
(C) ibang username → nabura ang tatlo; (D) tsek na "walang handle" → nabura ang tatlo. Bagong elemento sa screen: 0;
pahinang may pahalang na scroll: 0. (Preview database, hindi production.)

**Sinukat ng script habang kinukuha ang mga larawan** (`make-built.txt`): 24 larawan · elemento ng dating kahon / listahan sa screen: **0** sa lahat · pahinang may pahalang na scroll: **0** · ang hilera ng "Batch" ay 50 px sa lahat ng lapad. (Ang purple na header sa itaas ay hindi ginalaw ng branch na ito — kapareho ng nasa `main`.)

## Mga test ng app
Apat na file: `scanQrLookup.test.ts`, `ScanQrLookup.{screens,camera,offOn}.test.tsx` — **301 test, lahat pumasa** (bago
ang ayos na ito: 204). Sa lumang code (`27fb07e3`, bago ang ayos) **bumabagsak** ang mga bagong test ng dalawang screen:
scan A → type B → wala nang detalye ni A; ang ginalaw na field ay nananatili; pati ang tsek na "walang handle", ang paste at
ang ⇄. (Ang mga test na "parehong username, ibang laki ng letra o may `@` → walang nabubura" ay likas na pumapasa rin sa
lumang code; bumabagsak ang mga iyon kapag sinira ang bagong tsek — tingnan ang mga sinadyang sira.)

Sinadyang sirain ang code ng app (sa hiwalay na kopya) — `proof/app-breakages.py` → `proof/app-breakages.txt`: **105 na
paraan, lahat nahuli** (79 dati + 26 para sa "username na pinalitan nang kamay"). Tapat na tala:
- Ang 79 dati ay pinatakbo sa commit `079ff20c`; ang 26 bago ay sa `55c00df7`. Ang 79 ay **hindi inulit** sa huling commit
  (ang mga linyang sinisira nila ay hindi na nagbago pagkatapos ng `079ff20c`; mga test lang ang nadagdag).
- Sa takbo sa `079ff20c`, **1 lumang kaso ang unang nakalusot** ("parehong sticker ulit, pinagpasyahan ayon sa text ng
  field"). Dinagdagan ng test at nahuli na sa ulit na takbo — nakasulat sa itaas ng file.
- 1 kaso ang nahuli dahil nag-error ang takbo (unhandled error), hindi ng isang `expect`.
- 2 kaso (ang `onNoContact` ng picker) ay nahuhuli **lang** ng test na bumabasa ng mismong text ng code; 2 kaso (hindi
  tumatakbo habang nag-e-edit / kapag naka-OFF) ay nahuhuli **lang** ng tig-isang test sa hook — sa screen, wala nang
  natatandaang punan sa dalawang sitwasyong iyon kaya pangalawang bantay lang ang nasa hook.

## Naka-OFF = kapareho ng `main`
`compare-with-main.cjs` — parehong hakbang sa `main` (`cc9f184a`, isinama na rin sa branch na ito) at sa branch na naka-OFF
ang switch (`?qlookup=off`): manual entry, Scan QR ng `@annc_tw`; tapos **in-type nang kamay** ang pangalan, phone, store at
ibang username; tapos ang tsek na "walang handle". Inihambing ang buong HTML ng form, ang mensahe at ang cursor sa 4 na
sandali; 7-11 at FamilyMart; 360 px at 1280 px. Resulta (`compare-with-main.txt`): **48 sa 48 magkapareho.** (Preview
database, hindi production.)

## Mga dapat malaman ni Jeff
1. **Bantay na "3+ phone".** Binibilang lang ang sariling record ng username na iyon (TikTok o walang app, tugma ayon sa
   rule #4), **lahat ng record, hindi lang ang pinakabago**; digits lang ng phone ang tinitingnan, kaya iisa ang
   `0911 222 333` at `0911222333`. Sa live ngayon (7-11):
   **137 "username" (765 record, 12 seller) ang may 3+ phone** — hindi na pupunan ang mga iyon. FamilyMart: wala pa.
   (`proof/live-readonly-checks.md` §2.)
2. **2 magkaibang phone → pinupunan pa rin mula sa pinakabago** (ayon sa utos: 3 o higit pa lang ang hindi). Live: 723
   username. Puwedeng iisang buyer na nagpalit ng phone, puwede ring dalawang magkaibang tao — makikita ng encoder ang
   napunan at puwede niyang palitan.
3. **Dahil walang binago sa pag-save, mananatili ang mga dobleng record sa Customers** gaya ngayon (hal. buyer na nagpalit ng
   phone = dalawang record). Ang pagpuno ay laging mula sa pinakabago.
4. **Mawawala ang "(U)" sa record kapag QR ang ginamit at hindi ito in-type ulit.** Hindi ito bago: ang kasalukuyang
   pag-save ay nagsusulat ng contact text ng bagong parcel sa record na may parehong phone + pangalan. Pagka-Scan QR,
   username lang ang nasa field (hal. `annc_tw`).
5. **Puwedeng mapunan ang store # na hindi pa pumasa sa tsek** — isinusulat ng kasalukuyang pag-save ang record ng parcel bago
   pa dumating ang hatol ng store (gawi ngayon, hindi binago). Tine-tsek pa rin ang store ng bagong parcel pagka-save.
6. ~~`@pedro123(U)` (walang space bago ang tala) ay HINDI tugma~~ — **TUGMA NA** (ayos mula sa audit). `@pedro123,` at `@pedro123/ig` ay hindi pa rin. Live: 102 record (7-11), 8 (FM).
7. ~~`pedro123 (U)` (walang `@`, may space) ay HINDI tugma~~ — **TUGMA NA** (ayos mula sa audit; tala na nagsisimula sa `(` o `#`). `pedro123 Garcia` ay hindi pa rin. Live: 2,295 record (7-11), 67 (FM).
8. **Kapag 100 o higit pa ang ibinalik na kandidato** para sa isang scan, walang pinupunan (hindi mabibilang ang lahat ng
   phone). Sa live, 60 ang pinakamaraming record ng iisang username.
9. **Isang karaniwang space lang ang hinahanap pagkatapos ng `@` o ng username.** Ang record na may tab o 2+ space doon
   (1 sa live) at ang full-width na 全形 space (0 sa live) ay hindi makikita ng paghahanap.
10. **Walang admin bypass**; **pagkatapos ng Import**, nililinis ang buong entry kapag may natitirang detalyeng pinunan ng
    Scan QR — kasama ang anumang itinama roon at ang na-type na amount.
10b. **Parehong sticker na na-scan ulit** habang nasa form pa ang napunan nito (hal. itinama ang pangalan): walang binubura
    at walang bagong basa. Para mapunan ulit, burahin muna ang pangalan, phone at store (lahat ng tatlo). Kapag ibang
    sticker ang sumunod, saka binabawi ang hindi ginalaw na detalye ng nauna.
10c. **Pinalitan ang app ng buyer (hal. LINE) habang hinihintay ang sagot** → walang pinupunan. (Kapag pinalitan
    pagkatapos nang mapunan, nananatili ang napunan.)
10h. **Username na pinalitan nang kamay — ISANG pindot lang ay sapat na kapag naging ibang username.** Hal. isang backspace
    (`pedro123` → `pedro12`) ay nagbubura na ng mga napunang detalye na hindi ginalaw, at **ang pag-type pabalik ay HINDI
    nagbabalik sa mga ito** — i-scan ulit ang sticker. Ang pagdagdag ng tala (`pedro123 (U)`, `pedro123(U)`, `pedro123 #3`)
    ay **hindi** nagbubura.
10i. **Mas maluwag ang tsek sa pag-type kaysa sa pagtutugma sa Customers.** Sa pag-type, kahit anong hindi character ng
    username ang kasunod ay parehong buyer pa rin (`pedro123 Garcia`, `pedro123, bayad`, full-width na space). Sa
    pagtutugma ng record, `(` o `#` lang ang puwedeng simula ng tala kapag walang `@` — kaya ang record na naka-save bilang
    `pedro123 Garcia` ay hindi pupunan sa susunod na scan.
10j. **Ang tsek na "walang handle / no contact"** pagkatapos mapunan ay nagbubura ng username pero **hindi ng napunang
    detalye**; mase-save ang parcel na may detalye ni A at walang username.
10k. **Ang pagpili ng ibang app** (hal. LINE) pagkatapos mapunan, nang hindi ginagalaw ang text ng username, ay **walang
    binubura**. Kapag nag-type na ng ibang contact, saka nabubura. **Tanong 2 sa ibaba.**
10l. **"Ginalaw" = iba na ang laman.** Ang detalyeng in-type ulit sa eksaktong parehong laman ng napunan ay itinuturing na
    hindi ginalaw (ganito na rin sa pag-scan ng ibang buyer).
10m. **Habang hinihintay pa ang sagot** ng Customers, mas mahigpit ang tsek: kapag ginawang `pedro123 (U)` ang field bago
    dumating ang sagot, hindi na pinupunan (dati nang ganito; hindi binago).
10n. **Tanong sa database:** 13 hugis na ngayon (5 dati + 8 para sa tala na `(` / `#`). Ang 8 bago ay may bracket kaya
    nakapaloob sa panipi. Kapag tinanggihan ng totoong API ang hugis na ito, **walang mapupunan kahit kanino** (walang
    error na lalabas) — tingnan ang "HINDI PA NAPAPATUNAYAN".
11. **Help guide:** tungkol lang sa pagpuno ang idinagdag (kasama ang "If nothing is filled in, type the details as usual."
    na binubura ng panibagong scan ang detalyeng pinunan ng nauna, at na nililinis ng Import ang entry na pinunan ng scan).
    Walang banggit tungkol sa pagpapalit ng entry sa
    Customers. `sql/116b` ay ni-regenerate; **hindi in-apply.**
12. **Para mabuksan:** i-apply ang `sql/149` (switch na naka-OFF + ang key), ilagay ang mga test account sa listahan, saka
    `sql/116b`. Hangga't hindi na-apply ang `sql/149`, naka-OFF ito sa lahat.

## Mga tanong kay Jeff (username na pinalitan nang kamay)
Nasagot na ng ayos mula sa audit: ang tala pagkatapos ng username, at ang tsek na "walang handle". Natitira:
1. **Isang pindot, walang balik** (10h) — (a) hayaan (ngayon); (b) "itabi at ibalik": kapag ang field ay bumalik sa
   username ni A at blangko pa ang pangalan, phone at store, ibalik ang binura nang hindi bumabasa ng Customers.
2. **Ibang app na pinili pagkatapos mapunan** (10k) — (a) hayaan: walang binubura (ngayon); (b) burahin din ang hindi
   ginalaw kapag hindi na TikTok ang app.
3. **Autocorrect ng keyboard sa username field** — hindi naka-off sa dalawang screen (dati na). Ang pag-off nito ay
   pagbabago sa field para sa LAHAT (kahit naka-OFF ang switch), kaya hindi ginawa rito.

## HINDI PA NAPAPATUNAYAN
- **Ang 8 bagong hugis ng tanong (may bracket, nakapanipi)** ay hindi pa napapatakbo sa totoong API. Mapapatunayan sa isang
  scan ng totoong sticker ng buyer na may record na `username (U)`, gamit ang account na nasa listahan, bago buksan sa iba.
- **Ang totoong tanong ng app sa totoong API** (lalo na ang space sa loob ng filter, at username na may `.` at `_`) at ang
  bilis mula sa phone. Walang login para subukin dito, at hindi maabot ang API mula sa makinang ito. Ang mga test ay gumagamit
  ng pekeng client, at ang preview database ay hindi nagsasala. Kung tanggihan ng totoong API ang tanong, ang resulta ay
  "walang napupunan" para sa lahat, walang error na lalabas. Ang kasalukuyang search sa Customers ay gumagamit ng parehong
  hugis ng tanong (may space, `@` at `.`), kaya mababa ang panganib — pero hindi iyon patunay.
  **Mapapatunayan sa isang scan ng totoong sticker gamit ang account na nasa listahan, bago buksan sa iba.**
- Kung gaano kadalas, sa totoong gamit, na ibang tao ang napunan (#2) — hindi masusukat mula rito.
- Totoong phone at camera; dark theme (walang bagong salita o kahon sa screen).
