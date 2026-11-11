# Scan QR → hanapin sa Customers — mga TOTOONG screen (Hakbang 2)

Hindi mockup ang mga ito. Bawat larawan ay ang totoong screen ng app sa preview database
(`src/dev/fakeSupabase.ts`, naka-ON doon ang switch para lang sa preview), at **totoong QR na larawan**
ang ipinasa sa totoong pindutang **Scan QR** — walang iginuhit sa ibabaw.

Paggawa ulit:
```bash
npx vite --config vite.preview.config.ts --port 5199
```
```bash
node docs/design/scan-qr-lookup/built/make-built.cjs
```

## Mga larawan (32)
`<711|fm>_<sitwasyon>_<lapad>.jpg` — lapad: `iphone390`, `android360`, `android430`, `laptop1280`.

| Sitwasyon | Na-scan | Ano ang makikita |
|---|---|---|
| `1-one-match` | `@maria_shops` (1 record) | Asul na kahon "Found in Customers: @maria_shops — please check" + "last updated ‹petsa›"; napunan ang pangalan, phone, store; cursor sa Amount |
| `2-many-matches` | `@annc_tw` (3 record) | Listahan ng 3 record, pinakabago sa itaas, bawat isa may petsa; "Not here — I'll type it"; walang napunan |
| `3-no-match` | `@newbuyer_tw` (walang record) | Username lang at ang dating mensahe — walang kahon |
| `4-typed` | `@maria_shops`, may naka-type nang pangalan | Mungkahi + pindutang **Use**; hindi pinatungan ang naka-type |

Sa preview database, may sadyang mga "halos kapareho" na record na **hindi dapat lumabas**:
`annc_tw2` (ibang username) at isang `annc_tw` na LINE ang app. Sa larawan ng `2-many-matches`, 3 lang ang nasa
listahan — hindi kasama ang dalawang iyon.

## Sinukat habang kinukuha ang mga larawan (galing sa script, hindi sa mata)
Ang script ay nagpi-print, sa bawat larawan, ng: uri ng kahon, taas ng bawat pindutan sa kahon, kung may pahalang na
scroll ang pahina, at taas ng header. Ang buong output ay nasa `make-built.log`.

## Hindi kasama sa mga larawan
- Dark theme at ibang wika (English at light lang ang mga larawan; may test ang Filipino na teksto).
- Ang mensahe kapag hindi ma-check ang Customers (error / walang signal / lampas 4 s) — may test, walang larawan.
- Totoong phone at totoong camera — si Jeff ang susubok.

## Paghahambing sa `main` kapag naka-OFF ang switch
`compare-with-main.cjs` — parehong hakbang (buksan ang manual entry, mag-Scan QR ng `@maria_shops`, na **may** record sa
Customers) sa `main` (`119257aa`) at sa branch na ito na naka-OFF ang switch (`?qlookup=off` sa preview). Inihambing ang
buong HTML ng form, ang mensahe at kung nasaan ang cursor — agad pagkatapos ng scan at 1.3 segundo pagkatapos; 7-11 at
FamilyMart; 360 px at 1280 px. Resulta sa `compare-with-main.log`: **24 sa 24 ay magkapareho** ("ALL IDENTICAL").
(Preview database ito, hindi production.)

## Mga pinili sa build na iba sa nakasulat sa plano (para kay Jeff — madaling baguhin)
1. **Walang admin bypass.** Lalabas lang kapag naka-ON ang switch o nasa listahan ang login. Para masubukan ni Jeff, idagdag
   ang sariling login sa listahan (nasa `sql/149_scan_qr_lookup.sql` ang isang linyang gagamitin).
2. **Lahat ng record ng username ang nasa listahan** (hindi "5 lang + N pa") — ayon sa sagot 6. Hanggang 100 ang binabasa;
   kapag umabot ng 100, may linyang "ang 100 pinakabago lang ang ipinapakita". Pinakamarami ngayon sa totoong data: 47.
3. **Ang `_` sa username ay hindi "ine-escape" sa tanong sa database** (hindi ito napatunayan sa totoong API). Sa halip,
   ang app ang gumagawa ng huling eksaktong tsek sa bawat ibinalik na record. Sinukat sa pinakamalaking seller (6,162
   record na puwedeng tumugma, 347 username na may `_`): sa 12 username lang may dagdag na ibinabalik, pinakamarami 3
   dagdag — malayo sa 100.
4. **Ang mensahe kapag hindi ma-check ang Customers** ay isang linya sa loob ng form (hindi ang lumilipas na mensahe sa
   itaas) — para hindi ito mabura agad ng timer ng naunang mensahe. Filipino: "Hindi ma-check ang Customers ngayon —
   i-type, o gamitin ang Customers" (pinalitan ang "Hindi nahanap…" dahil puwedeng mayroon naman talagang record).
5. **Pagkatapos ng Import mula sa Customers:** kung may **naisulat ang hanap** sa kasalukuyang entry (napunan mula sa
   record), **nililinis ang buong entry** (pati username at ang lumang mensahe ng bigong save). Kung mungkahi o listahan
   lang ang nakalabas (walang naisulat), o walang hinanap: hindi ginagalaw ang naka-type — gaya ngayon; ang mungkahi /
   listahan lang ang nawawala.
6. **Kapag pinindot ang Save habang naghahanap pa:** itinatapon ang sagot (hindi na ito lalabas sa parcel na iyon o sa
   susunod). Kung **bumagsak ang save**, may linyang "Hindi ma-check ang Customers ngayon…" para hindi magmukhang
   "walang record".
7. **Kapag may details pa ni @A sa form at lumabas ang mungkahi para kay @B:** may dagdag na dilaw na linyang "Ang details
   ay galing kay @A — pakisuri" sa loob ng parehong kahon. Kapag hindi na-check si @B, sinasabi rin iyon sa kahon.
8. **"Gamitin" / pagpili ng record:** sa form na ang seller ang nag-type, isinusulat lang ang may laman sa record (hindi
   binubura ang naka-type kapag blangko ang katumbas sa record). Pero kapag ang nasa form ay tira ng record ni @A, ang
   **buong** record ni @B ang pumapalit (pati blangko) — walang matitira kay @A sa ilalim ng "Nahanap: @B".

Ang 32 larawan ay kinuha sa commit `ca183185`. Ang mga ayos pagkatapos noon ay hindi nagbago sa apat na sitwasyong nasa
larawan (dagdag lang na linya sa dilaw na kahon ng "galing kay @A" kapag hindi na-check); ang paghahambing sa `main` ay
inulit sa huling code.
