# Scan QR → punan mula sa Customers — Hakbang 4 (mga desisyon ni Jeff, 2026-11-12)

**Walang listahan, walang kahon, walang mensahe.** Pagka-Scan QR (kapag bukas ang feature para sa account):
- may record ang username → diretsong napupunan ang pangalan, phone at store mula sa **pinakabagong** record;
- may naka-type na sa pangalan, phone o store → walang pinupunan;
- ang mga record ng "username" ay may **3 o higit pang magkakaibang phone** (salitang isinusulat para sa maraming buyer, hal.
  `user`) → walang pinupunan;
- walang record / error / lampas 4 segundo → eksaktong gaya ngayon (username lang).

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

## Mga larawan (24)
`<711|fm>_<sitwasyon>_<lapad>.jpg` — lapad: `iphone390`, `android360`, `android430`, `laptop1280`.

| Sitwasyon | Na-scan | Ano ang makikita |
|---|---|---|
| `1-filled` | `@annc_tw` — may 3 record sa preview (2 magkaibang phone); ang pinakabago ay naka-save bilang `@annc_tw (U)` | Napunan ang pangalan, phone at store ng pinakabagong record; cursor sa Amount. Walang kahon, walang listahan |
| `2-no-match` | `@newbuyer_tw` (walang record) | Username lang at ang dating mensahe |
| `3-shared-word` | `@user` — sa preview, `user` ang contact ng 3 buyer na may 3 magkakaibang phone | Username lang at ang dating mensahe — kapareho ng `2-no-match` |

Sa preview database (7-11 at FamilyMart) may sadyang mga record na **hindi dapat gamitin**: `annc_tw2` (ibang username) at
isang `annc_tw` na LINE ang app — parehong mas bago kaysa sa tamang record. Hindi sila ang napunan, at hindi sila kasama sa
bilang ng phone. (Ang preview database ay hindi nagsasala gaya ng totoong database — ibinabalik nito ang lahat ng record ng
seller, kaya ang huling tsek ng app ang nakikita sa mga larawan, hindi ang tanong sa database.)

**Sinukat ng script habang kinukuha ang mga larawan** (`make-built.txt`): 24 larawan · elemento ng dating kahon / listahan sa screen: **0** sa lahat · pahinang may pahalang na scroll: **0** · ang hilera ng "Batch" ay 50 px sa lahat ng lapad. (Ang purple na header sa itaas ay hindi ginalaw ng branch na ito — kapareho ng nasa `main`.)

## Mga test ng app
Apat na file: `scanQrLookup.test.ts`, `ScanQrLookup.{screens,camera,offOn}.test.tsx` — *(tumatakbo pa sa huling code — pupunan pagkatapos)*
Sinadyang sirain ang code ng app (sa hiwalay na kopya) — `proof/app-breakages.py` → `proof/app-breakages.txt`: *(tumatakbo pa sa huling code — pupunan pagkatapos; ang kasalukuyang laman ng `proof/app-breakages.txt` ay ang takbo sa mas naunang commit `b1a7fb31`: 55 paraan, lahat nahuli)*

## Naka-OFF = kapareho ng `main`
`compare-with-main.cjs` — parehong hakbang (manual entry, Scan QR ng `@annc_tw`, na **may** 3 record) sa `main` (`0b30f3ec`,
isinama na rin sa branch na ito) at sa branch na naka-OFF ang switch (`?qlookup=off`). Inihambing ang buong HTML ng form,
ang mensahe at ang cursor — agad pagkatapos ng scan at 1.3 segundo pagkatapos; 7-11 at FamilyMart; 360 px at 1280 px.
Resulta (`compare-with-main.txt`): **24 sa 24 magkapareho.** (Preview database, hindi production.)

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
6. **`@pedro123(U)` (walang space bago ang tala) ay HINDI tugma** — literal na "unang salita". Live: 102 record (7-11), 8 (FM).
7. **`pedro123 (U)` (walang `@`, may space) ay HINDI tugma** — ayon sa utos. Live: 2,295 record (7-11), 67 (FM).
8. **Kapag 100 o higit pa ang ibinalik na kandidato** para sa isang scan, walang pinupunan (hindi mabibilang ang lahat ng
   phone). Sa live, 60 ang pinakamaraming record ng iisang username.
9. **Isang karaniwang space lang ang hinahanap pagkatapos ng `@` o ng username.** Ang record na may tab o 2+ space doon
   (1 sa live) at ang full-width na 全形 space (0 sa live) ay hindi makikita ng paghahanap.
10. **Walang admin bypass**; **pagkatapos ng Import**, nililinis ang buong entry kapag may natitirang detalyeng pinunan ng
    Scan QR.
10b. **Parehong sticker na na-scan ulit** habang may laman ang form (hal. itinama ang pangalan): walang binubura at walang
    bagong basa. Kapag ibang sticker ang sumunod, saka binabawi ang hindi ginalaw na detalye ng nauna.
10c. **Pinalitan ang app ng buyer (hal. LINE) habang hinihintay ang sagot** → walang pinupunan.
10d. **"Pinakabago" = huling naisulat na record.** Kapag ang lumang parcel ng buyer ay na-edit o na-recheck kamakailan, ang
    record nito ang nagiging "pinakabago" — puwedeng lumang store ang mapunan. Nakikita ng encoder; walang petsa o babala
    (inalis kasama ng kahon).
10e. **Binibilang ang lahat ng record kailanman ng username.** Ang totoong buyer na may 3 magkakaibang phone sa Customers
    (o 3 maling type) ay hindi na pupunan hangga't hindi binabawasan ang mga record niya sa Customers. `0911…` at `+886911…`
    ay binibilang na dalawang magkaibang phone.
10f. **Pinakabagong record na walang store #:** napupunan ang pangalan at phone, blangko ang store, at nasa Amount ang cursor.
10g. **Cancel habang binabasa pa ang QR na larawan:** may isa pa ring basa sa Customers (kapag bukas ang feature) para sa
    saradong form; walang lumalabas at malinis ang form pagbukas ulit.
11. **Help guide:** tungkol lang sa pagpuno ang idinagdag (kasama ang "If nothing is filled in, type the details as usual."
    at na ang panibagong scan ay pumapalit sa detalyeng pinunan ng nauna). Walang banggit tungkol sa pagpapalit ng entry sa
    Customers. `sql/116b` ay ni-regenerate; **hindi in-apply.**
12. **Para mabuksan:** i-apply ang `sql/149` (switch na naka-OFF + ang key), ilagay ang mga test account sa listahan, saka
    `sql/116b`. Hangga't hindi na-apply ang `sql/149`, naka-OFF ito sa lahat.

## HINDI PA NAPAPATUNAYAN
- **Ang totoong tanong ng app sa totoong API** (lalo na ang space sa loob ng filter, at username na may `.` at `_`) at ang
  bilis mula sa phone. Walang login para subukin dito, at hindi maabot ang API mula sa makinang ito. Ang mga test ay gumagamit
  ng pekeng client, at ang preview database ay hindi nagsasala. Kung tanggihan ng totoong API ang tanong, ang resulta ay
  "walang napupunan" para sa lahat, walang error na lalabas. Ang kasalukuyang search sa Customers ay gumagamit ng parehong
  hugis ng tanong (may space, `@` at `.`), kaya mababa ang panganib — pero hindi iyon patunay.
  **Mapapatunayan sa isang scan ng totoong sticker gamit ang account na nasa listahan, bago buksan sa iba.**
- Kung gaano kadalas, sa totoong gamit, na ibang tao ang napunan (#2) — hindi masusukat mula rito.
- Totoong phone at camera; dark theme (walang bagong salita o kahon sa screen).
