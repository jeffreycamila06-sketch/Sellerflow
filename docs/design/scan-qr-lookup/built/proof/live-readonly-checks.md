# Mga tsek sa LIVE na database — puro BASA lang (2026-11-12)

Walang isinulat, walang in-apply. Lahat ay `select` lang. Para ito sa pagpuno ng app pagka-Scan QR
(ang app ay BUMABASA lang ng Customers; walang binabago sa pag-save ng parcel).

## 1. Hugis ng mga naka-save na contact (TikTok o walang app)
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

## 2. Ilang magkakaibang phone bawat (seller, username) — ang batayan ng bantay na "3+ phone = walang punan"
Binilang gaya ng app: digits lang ng phone (kaya `0911 222 333` = `0911222333`), TikTok o walang app, username ayon sa rule #4.
| | 7-11 | FamilyMart |
|---|---|---|
| Lahat ng (seller, username) | 39,641 | 455 |
| 1 phone | 38,781 | 455 |
| 2 phone → pinupunan pa rin mula sa pinakabago | 723 | 0 |
| **3 o higit pang phone → HINDI pupunan** | **137** (765 record, 12 seller) | 0 |
| Pinakamaraming record sa iisang username | 60 | 2 |
| Username na 100+ ang record | 0 | 0 |

Mga halimbawa ng contact na ginagamit ng maraming magkakaibang buyer ng iisang seller (hindi mga username; walang `@`):
`c` (60 record, 59 phone), `f` (37), `j` (36), `printer` (26 record, 25 phone), `d` (24), `user` (18 record, 16 phone),
`1000` (10), at mga karaniwang unang pangalan (4–5 phone bawat isa).

Sa 723 na may 2 phone: hindi matitiyak mula rito kung iisang buyer na nagpalit ng phone o dalawang magkaibang tao.
Pupunan ang mga iyon mula sa pinakabagong record (ayon sa utos: 3 o higit pa lang ang hindi pinupunan).

## 3. Sariling data lang
Bilang `authenticated` na kumikilos bilang isang seller: 7,643 sariling row ang kita; **0** row ng ibang seller sa
`parcel_customers` at sa `fm_parcel_customers`.

## Hindi nasukat dito
- Ang bilis ng mismong tanong ng app mula sa phone, at ang eksaktong tanong sa totoong API — walang login para subukin.
