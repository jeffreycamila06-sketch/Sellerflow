# Mga tsek sa LIVE na database — puro BASA lang (2026-11-12)

Walang isinulat, walang in-apply. Lahat ay `select` / `explain` / isang `do` block na nagbabasa lang at nagtatapos sa
`raise` para iulat ang oras. Postgres 17.6.

## 1. Ang dalawang live na function = ang nasa rollback file
`md5(pg_get_functiondef(...))`: `upsert_parcel_customer` = `0b295f54f336ea3afb163410a09e83e8` (1,680 character) ·
`upsert_fm_parcel_customer` = `b2cd4f054ab79c2983482f39e1a9f764` (1,172). Parehong numero ang lumalabas sa teksto ng
`sql/150_one_username_one_record_rollback.sql` (binabantayan ng `scanQrLookupSql150.test.ts` sa CI).
Wala pang `scan_qr_username_key` / `scan_qr_lookup_on` sa live.

## 2. Rule #4 sa live na Postgres
Ang 47 halimbawa ng `scanQrUsernameKey.json` ay pinatakbo sa parehong dalawang pattern (isang `select`, walang ginawang
function): **47 sa 47 kapareho ng sagot ng app.**

## 3. Hugis ng mga naka-save na contact (TikTok o walang app)
| | 7-11 | FamilyMart |
|---|---|---|
| Record na may contact | 45,621 | 675 |
| May username ayon sa rule #4 | 41,732 | 456 |
| `@username` + tala (hal. `@x (U)`) | 1,572 | 82 |
| May space pagkatapos ng `@` | 235 | 0 |
| 2+ space o tab pagkatapos ng `@` (hindi makukuha ng tanong ng app) | 1 | 0 |
| Tab / bagong linya pagkatapos ng username | 0 | 0 |
| Walang `@` pero may space (hal. `x (U)`) — HINDI tugma ayon sa utos | 2,295 | 67 |
| `@username` na may nakadikit (hal. `@x(U)`) — HINDI tugma | 102 | 8 |
| Magkakaibang (seller, username) | 39,485 | 455 |
| Username na 2+ ang record | 1,644 | 1 |

## 4. Mga "username" na iba-ibang tao pala (kaya may bantay A)
Sa 1,644 na username na 2+ ang record (7-11): **788** ay iisa ang phone · **719** ay 2 phone · 82 ay 3 phone · 34 ay 4–5 phone ·
**21 ay 6 o higit pang phone**. 765 record ang nasa mga grupong 3+ ang phone.
Mga halimbawa ng contact na ginagamit ng maraming magkakaibang buyer ng iisang seller (hindi mga username; walang `@`):
`c` (60 record, 59 phone), `f` (37), `j` (36), `printer` (26 record, 25 phone), `d` (24), `user` (18 record, 16 phone),
`1000` (10), at mga karaniwang unang pangalan (4–5 phone bawat isa).

## 4b. Ilang record bawat (seller, username) — para sa bantay A ("isang ibang record lang")
Binasa pagkatapos ng pangalawang review (TikTok o walang app; username ayon sa rule #4):
| | 7-11 | FamilyMart |
|---|---|---|
| Username na 1 ang record | 37,964 | 454 |
| Username na eksaktong 2 ang record | 1,415 | 1 |
| …pareho ang phone o ang pangalan ng dalawa | 1,164 | 1 |
| …walang pareho (hindi gagalawin) | 251 | 0 |
| …pareho ang phone o pangalan at 1–2 letra lang ang "username" | 6 | 0 |
| Username na 3+ ang record (hindi gagalawin) | 233 (1,069 record) | 0 |
| …sa mga iyon, iisa ang phone | 40 | 0 |
| …sa mga iyon, iisa ang pangalan | 38 | 0 |
| …sa mga iyon, 3+ phone at 3+ pangalan | 70 | 0 |
(Bahagyang iba ang kabuuan sa §3 dahil ilang oras ang pagitan ng dalawang basa.)

## 5. Kailan dumarating ang hatol (kaya may bantay B) — 16,163 parcel, 63 seller, huling 30 araw
| store / phone | parcel |
|---|---|
| valid / ok | 13,709 |
| (wala pa) / ok | 2,138 |
| valid / (wala pa) | 260 |
| unknown / ok | 34 |
| valid / restricted | 7 |
| not_found / ok | 4 |
| iba pa | 11 |
Ang app ay nagse-save muna nang walang hatol; ang hatol ay hiwalay na update pagkatapos. 62 sa 63 seller ang may hatol sa phone.

## 6. Bigat
Sa pinakamalaking seller (7,643 record sa Customers), sa hugis ng tanong na ginagamit ng trigger para hanapin ang mga record
ng isang username: 19.0 ms sa unang takbo, 7.2 ms sa pangalawa; 1 row lang ang natitira pagkatapos ng murang paunang salain.
(Sinukat sa hugis ng unang bersyon; ang kasalukuyang tanong ay parehong salain, may dagdag lang na bilang.)
May index ang `parcel_scans` at `fm_parcel_scans` sa (seller, petsa ng paggawa) — ginagamit ng bantay C.
(Hindi nasukat sa live ang buong bagong function — hindi ito in-apply.)

## 7. Sariling data lang (mula sa Hakbang 2)
Bilang `authenticated` na kumikilos bilang isang seller: 7,643 sariling row ang kita; **0** row ng ibang seller sa
`parcel_customers` at sa `fm_parcel_customers`.
