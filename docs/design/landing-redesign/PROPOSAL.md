# SellerFlowLive homepage — redesign proposal, Step 0

Proposal, preview and pictures only. The real page (`src/redesign/screens/Landing.tsx`) is not changed.
Nothing merged, no SQL, no deploy. Branch `claude/landing-redesign` (from main `7a03c7e`).

- **Preview page:** `preview/index.html` (open it in a browser; switch the hero with the two buttons at the top).
- **The same preview as a private link:** https://claude.ai/artifact/WZS8JnMNDxjKABWtAzF7vW
- **Pictures:** `shots/` — both hero directions × iPhone 390 / Android 360 / laptop 1280 × light / dark,
  first screen (`*_first-screen.png`) and the whole page (`*_whole-page.jpg`), plus `shots/measure.txt`.
- **How they were made:** `harness/` (`capture-app.cjs` = the real app screens, `to-webp.cjs`, `shots.cjs`).

---

## 1. Research (short)

Ten services were looked at: BobaLive 播霸 and MokiBuy (Taiwan), SHOPLINE LIVE (Taiwan / HK), Upmesh
(Singapore), Vrich (Thailand), Pancake (Vietnam), CommentSold and SoldLive (US), Rollo and MUNBYN
(label printers).

**Limit, stated plainly:** this session's network refused every one of those sites, so none was opened
directly. The findings below come from search-engine excerpts of each company's own pages. That is
enough for *what they tell a seller*; it is **not** enough for how their hero pictures and animations
look, so nothing here is copied from a competitor's look. If you want that part checked, the sites
need to be allowed for the session (list at the end).

**What a seller is told on those sites, and is not told on ours today**

| Sellers expect to see | Who shows it | Ours today |
|---|---|---|
| Exactly which platforms work, per feature — and which do not | BobaLive (even lists what is *not* supported), SoldLive ("TikTok: beta") | "TikTok & Facebook" in one line; Shopee not mentioned |
| Which device is needed (Android, iPhone, computer) | BobaLive, MUNBYN | One line: "works on every device" |
| Which printer models work, label sizes, how they connect | BobaLive, Rollo, MUNBYN | "like AIMO", "like Xprinter" |
| The exact step: what the buyer types, what the seller taps, what happens next | Upmesh, SoldLive, CommentSold | Three vague steps |
| What each plan includes, and its limits | MokiBuy, SoldLive, CommentSold, Vrich | Nothing (no plans section) |
| Free trial terms in one line under the button | SoldLive ("14-day trial on Basic"), Rollo ("no card") | "no credit card needed" only inside the FAQ |
| How to reach a person, and setup help | MokiBuy, BobaLive (LINE), Upmesh (WhatsApp), Vrich (phone) | Telegram button |
| Local shipping names | MokiBuy, BobaLive (7-11, FamilyMart) | 7-11 only |
| Guides or videos you can open | MokiBuy, Rollo, BobaLive | Four "guide" cards that all open the sign-up form |

**What reads badly on their sites (so we avoid it):** big round numbers that differ from page to page
(CommentSold), statistics with no date or label (Upmesh, SHOPLINE), "#1 / ultimate platform"
headlines that never say what the product does, prices hidden behind "contact us", small print that
differs between pages. The two headlines that explain the product in five seconds are literal lists of
what it does (BobaLive, Vrich).

## 2. Audit of today's page

### Not true, or cannot be shown to be true

| On the page today | Problem |
|---|---|
| "12k+ active sellers", "1.4M orders captured", "4.9★ seller rating" | Invented. |
| "<2s comment → order" | A measurement nobody made. |
| "Join thousands of live sellers", "Trusted by live sellers across Taiwan" | Not backed by anything. |
| Three testimonials (Cherry, Nicole, Mrs. Ho) | Written for the page, not said by sellers. |
| "Real sellers — Live sellers across Asia" with three photos | The photos are generated pictures, not our sellers. One shows a Vietnamese shop screen that is not our app. |
| "Watch a real live session — 2-minute demo" | There is no video; it is an empty poster. |
| "Built from 8 years of real live selling" | Unknown to me — true or not? (question 5 below) |
| Dashboard with "REVENUE ▲ 18% vs last month", "1.2k watching", "47 orders · NT$18,420" | Drawn sample numbers presented as "LIVE DATA". |
| "Connect your account once and the app captures comments automatically each time you go live" | You tap Connect at each live. |
| "Auto-capture every 'mine' … never blinks, every claim is caught" | Orders are made by your tap (or by Auto mode with codes). |
| "7 languages" · "1, 2, or 3-day session windows" | It is 8 languages and 1 to 5 days. |
| "Phone + computer, synced live" | The session opens on another device; it is not a live mirror. |
| "Guide" cards with "Read guide →" | Each one opens the sign-up form. |

### Why it reads as machine-made

Checked against the installed design playbooks (see section 7):

- A small coloured label above **every** heading ("INSIDE THE APP", "SEE IT LIVE", "LOVED BY LIVE SELLERS").
- The "big number + small label" statistics row.
- Eight same-size cards, each = emoji + title + two lines.
- Emoji used as icons everywhere (📡 ⚡ 🖨️ 🧲 🎡 📊 🌏 🔄 🚀).
- A purple-to-violet gradient, glow blobs, a ring light, floating hearts, a bobbing photo, heartbeat
  pulses, hover lifts: many effects, none of them explaining the product.
- Every section fades in the same way.
- The "app" in the pictures is drawn, not the app. A seller never sees what they will actually use.
- Monospace letters used for decoration.

### Missing

Shopee. What each platform gives. Which printers, which sticker sizes, what a sticker looks like.
iPhone / Android / computer. Countries, currencies, languages as lists. The steps of one live. The
ways to take an order (1-Click, Type price, Same price, Choose price, Auto mode). Plans and what each
includes. What the Free plan is. How to pay. How to get help.

## 3. Instead of the invented numbers

The row of four made-up statistics becomes a row of **facts about the product**, which need no counting:

> **3** live platforms on one screen (Instagram coming) · **50×30 – 100×60 mm** sticker sizes ·
> **1 to 5 days** in one session · **8** languages · **11** currencies

If you want real proof on the page as well, these are the counts I would use — tell me the ones you
are happy to publish and I will add a dated line ("as of November 2026"):

1. Sellers who went live in the last 30 days.
2. Orders made in the app so far (all time), or last month.
3. Countries your sellers are in.
4. The year you started.
5. The Google Play and App Store ratings **with** the number of ratings (public, anyone can check).

Real seller quotes and photos can come back when sellers give them (name, shop, permission).

## 4. Sections — today and proposed

| # | Today | Proposed |
|---|---|---|
| 1 | Header: logo, How it works, Features ▾, Guide, FAQ, language, Log in, Create free account | **Same functions.** Links: How a live works, Platforms, Stickers & printers, Plans, FAQ. On phones: logo, language, Log in (the account button is the first thing under the headline) |
| 2 | Hero: drawn phone, ring light, hearts, generated photo, drawn printer | **Hero** (direction A or B, below): real app screen + real sticker; one line under the button: "Free plan: 150 orders and 1 live account. No card needed." Store badges kept |
| 3 | "Works with" bar + "Trusted by…" | **Facts row** (section 3 above) |
| 4 | Invented statistics | removed |
| 5 | Three steps | **How a live works — 6 steps**, each with the real screen: go live → Connect and choose 1–5 days → comments arrive → tap to order → sticker prints → after the live |
| 6 | Drawn dashboard "assembling" | removed |
| 7 | Two "deep dives" (drawn slips) | **What you get on each platform**: a table for TikTok, Facebook, Shopee, Instagram, with "needs activation" and "coming soon" said openly |
| 8 | Eight feature cards | **Take orders the way your live runs**: 1-Click, Type price, Same price, Choose price, Auto mode, Games — a plain list beside the real Live screen |
| 9 | — | **Stickers and printers**: real stickers at their true relative sizes, the real sticker-layout screen, and a printer table (model, what it prints, how it connects, where) |
| 10 | — | **Phone, tablet or computer**: the real app on a laptop; what each device is for |
| 11 | — | **Where you can use it**: countries, 8 languages, 11 currencies; the Taiwan-only pickup tools |
| 12 | — (no prices, no plans) | **Plans**: Free / Basic / Plus / Pro / Master — live accounts, orders, Posts, Taiwan tools, help. No prices (question 2) |
| 13 | Video poster with no video | removed until a real video exists (then it takes the place of the demo, or sits under the steps) |
| 14 | FAQ (6) | **FAQ (11)**, corrected and longer |
| 15 | Testimonials | removed |
| 16 | "Real sellers" photos | removed |
| 17 | Guide cards → sign-up | **Help when you need it**: Telegram, help chat in the app, user guide in the app |
| 18 | Final call + store badges | **Same** |
| 19 | Footer: Product, Support, Get the app, Privacy, Terms, Telegram | **Same links** |
| 20 | Floating "Need help? Message us" → Telegram | **Same** (short "Help" on phones so it does not cover buttons) |

Every button keeps its job: Log in, Create free account, Try it for free (= create account, as today),
See how it works (scrolls), language picker, Google Play, App Store, Telegram, Privacy, Terms.

## 5. The two hero directions

Both use the same page below the hero.

**A · On the phone** — `shots/hero-a_*`
Light page. Headline: *"From a live comment to a printed sticker, in one tap."* Beside it, the real
Live screen in a phone, stepping through four real moments (a comment arrives → the price is typed →
it is an order → the sticker comes out of a slot beside the phone). The four steps are written under it.
Safe and clear: a seller sees the screen they will use.

**B · The sticker roll** — `shots/hero-b_*`
A full band in the app's indigo. Headline: *"Every order on your live comes out as a sticker."*
On the right, the comment as it looks on the Live screen, a printer slot, and a roll of real stickers
running down and off the bottom of the band; the newest one feeds out when the comment becomes an order.
Bolder and unlike any other tool's page, because the sticker is the thing only this product makes.

My pick: **B on laptop-size screens is the stronger, more memorable page; A explains the app faster on
a phone.** If you want one for both, I would take B and keep A's four written steps under it.

## 6. Animation

One authored moment, nothing else moving:

- **The demo loop** in the hero: four steps, about two seconds each, made of four real screenshots that
  cross-fade, plus the sticker sliding out. Only opacity and one slide: cheap on a low-end Android phone.
  It stops when it is off screen, when the tab is hidden, and with a **Pause** button.
- **Scroll reveals:** each block eases up once, 0.5 s. The page is complete without them (they are only
  switched on by script), so nothing is ever left invisible.
- **Reduced motion:** no loop, no reveals; the hero shows the last step (order made, sticker out).
- **First load:** only one screenshot of the loop loads with the page; the other three are fetched after
  the page has finished loading. Measured on the preview: about 290 KB of the page's own files on a
  phone before scrolling (fonts not counted). Today's page loads four photos of 330–470 KB each.
- Removed: ring-light glow, floating hearts, bobbing photo, heartbeat pulses, glow blobs, the
  dashboard "assembly".

## 7. How the design skills were used

Read only. No hooks, no downloads, nothing saved; `.claude/skills` is not on the branch.

- **Impeccable** (playbooks read: persuade mode, craft floor, animate, critique): the audit list in
  section 2 follows its "refuse" list (labels above headings, statistic tiles, equal icon cards, emoji
  as icons, decoration effects). The direction follows its rule that the page should be built from the
  product's own material — here the printed sticker — and that motion gets one authored moment.
- **UI/UX Pro Max** (search only, printing to the screen): the "real-time / operations" landing pattern
  — show the product working in the hero, mark live things as live only when they are, give moving
  content a pause, show a still final state for reduced motion. Its default colour and font answer was
  not used; the page keeps the app's own indigo and its three fonts, so it costs no extra font download.

## 8. What the build would touch

- `src/redesign/screens/Landing.tsx` — rewritten (same props: `onLogin`, `onSignup`, `lang`,
  `langOpen`, `onToggleLang`, `onPickLang`; same store, Telegram, Privacy and Terms links).
- `src/redesign/redesign.css` — the old landing styles (`.sfl-l2-*`, `.sfl-lp-*`, about 98 rules)
  replaced by a smaller set.
- `src/redesign/i18n/index.tsx` — new English texts first, then the other 7 languages; the old landing
  keys removed.
- `public/` — new picture files (real screens as WebP, stickers as PNG, about 1 MB in total, loaded as
  the visitor scrolls); the four `landing-seller*.jpg` photos (1.6 MB) deleted.
- Tests for the landing (`Landing` render, the "no prices" check, i18n completeness) updated.
- The help guide is not affected (the public page is not in the guide). No SQL. No Render deploy.
  No new app build (the homepage is web-only; the phone apps never show it).
- Web only → goes live with a Vercel deploy after merge.

## 9. Things I need from you

1. **Hero A or B** (or B with A's written steps).
2. **Prices on the Plans table: yes or no?** Today the page shows none. The table is drawn without them.
3. **Shopee:** the page says Shopee works for every seller (Taiwan and Philippines). On production the
   switch for that is still off. The build should go live only after you turn it on — or the Shopee
   column says "opening soon".
4. **Printers on iPhone:** I wrote "Android and iPhone app" only for the D520BT. For the Xprinter
   XP-420B, Flash Y41BT and Niimbot I wrote "Phone app" because I could not confirm iPhone for each.
   Tell me which are confirmed.
5. **"Built from 8 years of real live selling"** — true? If yes it can stay as one honest line.
6. **Real numbers** from section 3, if you want any.
7. **Dark version:** the preview follows the visitor's phone setting (light or dark). Today's page is
   light only. Keep both, or light only?

## 10. Notes

- The app screens in the preview are the real app running with sample data (made-up buyer names). The
  stickers are drawn by the app's own sticker code, not by hand.
- One small thing seen while capturing: the Live bar says "1 buyers · 1 orders" for a single order.
  Not changed here.
- To check competitors' pictures and layouts directly, these sites would have to be allowed for the
  session: `bobaliveshop.online`, `mokibuy.com`, `www.upmesh.io`, `www.vrichapp.com`, `pancake.vn`,
  `marketing.shopline.tw`, `try.commentsold.com`, `soldlive.ai`, `www.rollo.com`, `munbyn.com`.
