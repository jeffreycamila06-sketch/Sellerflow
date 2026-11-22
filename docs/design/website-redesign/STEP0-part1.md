# Seller Website redesign — Step 0, part 1 (for the auditor)

Design proposal only. The live site is not changed, nothing is merged, no SQL, no server, no deploy.
Branch: `claude/serene-fermat-j04cf6`.

**Status: the two skills are installed but NOT used and nothing of theirs has been run.**
The audit / critique and the new design wait for the auditor's OK on the list below.

## 1. The two skills

| Skill | Source | Pinned commit | Licence | Where |
|---|---|---|---|---|
| Impeccable 4.10.0 | github.com/pbakaus/impeccable | `b49177d32788f2dc585c42831d845dacf1ebed2c` | Apache 2.0 | `.claude/skills/impeccable/` |
| UI/UX Pro Max 2.15.0 | github.com/nextlevelbuilder/ui-ux-pro-max-skill | `6ec2bb58334ca3014573c4cbd4834ee3a40afd9d` | MIT | `.claude/skills/ui-ux-pro-max/` |

Every file with size and fingerprint: `skills-files.txt` (78 files, 2.09 MB).
Each skill folder has a `SOURCE.md` (what was copied, what was left out).
The copies are byte-identical to the pinned commits (checked with `cmp` / `diff -rq`).

### What is in the folders

- **Impeccable — 54 files, 616 KB, text only.** `SKILL.md`, 49 playbooks under `reference/` (Markdown),
  `LICENSE`, `NOTICE.md`, `SOURCE.md`. **No script, no program.**
- **UI/UX Pro Max — 24 files, 1.5 MB.** `SKILL.md`, 2 reference texts, 15 CSV tables (styles, colours,
  font pairings, UX rules…), 4 Python scripts, `LICENSE`, `SOURCE.md`.

### The scripts (all four belong to UI/UX Pro Max)

| File | Size | What it does |
|---|---|---|
| `scripts/search.py` | 13.6 KB | The command. Reads the words given, searches the CSV tables, prints the matching rows. |
| `scripts/core.py` | 45.5 KB | The search itself (reads the CSV files in `data/`, ranks rows). |
| `scripts/design_system.py` | 80.3 KB | Builds a "design system" suggestion from the tables and prints it. Has a save mode (`--persist`) that writes `design-system/<name>/…` in the current folder. |
| `scripts/reasoning_contract.py` | 5.8 KB | Reads the rule column of one CSV table. |

Checked by reading the code (text search, nothing executed):

- **Network:** none. They import only `csv`, `json`, `re`, `os`, `sys`, `io`, `tempfile`, `argparse`, `difflib`,
  `math`, `collections`, `datetime`, `pathlib`. No `urllib`, `requests`, `socket`, `http`, `subprocess`,
  `eval`, `exec`. The web addresses in them are plain text put into the printed suggestion.
- **Writing files:** only with `--persist` (and `--page`, `--tokens` together with it). I will not use those:
  searches print to the screen only.
- **Outside the repo:** nothing. They read `../data/*.csv` next to themselves.

### Left out on purpose

- **Impeccable's whole `scripts/` folder.** Its launcher (`scripts/impeccable`) downloads a compiled program
  from GitHub releases on first run and saves it in `~/.impeccable/` — a network call and a folder outside
  the repo. Also its "live" browser scripts. So: no automatic 62-rule detector, no `shot`, no `live`, no `pin`.
  The `/audit`, `/critique`, `/distill`, `/polish`, `/animate` playbooks are followed by hand
  (Impeccable's own rule when the launcher is not available).
- Impeccable's hooks, plugin, helper agents and browser extension.
- UI/UX Pro Max: `preview.py` (writes into the system temp folder), `validate_data.py`, the tests, the JSON
  catalogues, 20 unused stack tables, and the six other skills of that repository.

### Confirmed

- **No hooks:** `.claude/settings.json` and `.claude/hooks/` are unchanged (`git diff` empty). The only
  setting change is one line in `.gitignore` so `.claude/skills/` can be seen in git.
- **Not global:** nothing was written to `~/.claude` or anywhere in the home folder.
- **No executable file:** no file in `.claude/skills` has the executable bit; no symlinks.
- **Nothing run:** no skill script has been started and no playbook has been followed.

### For the auditor to decide

1. OK to use these two folders as they are?
2. Impeccable without its program means the audit is done by reading the pages and the code, not by its
   automatic detector. If the detector is wanted, it needs one download (pinned by sha256 in the skill's
   own checksum file) into a folder outside the repo — only on your say.

## 2. Today's pictures (taken without the skills)

Folder `before/` — the real shop app, unchanged, opened through the existing harness
(`docs/design/seller-website-v2/harness`) with the demo shop "Budgetukay". All data is demo data answered
by the harness; the buyer is the placeholder "Demo Buyer / 0900 000 000".

- `brand-1-home`, `brand-2-product`, `brand-3-cart`, `brand-4-checkout`, `brand-5-order` = Brand store +
  Ocean (what a website started today looks like).
- `market-1-home` = Marketplace layout (shops made before the look settings).
- Each at `iphone390`, `android412`, `laptop1280`; `_first` = the first screen, `_full` = the whole page.
- Retake: `harness/before.cjs` (the header says how).

## 3. Which files a build would touch (first list — to be confirmed with the design)

**Would change (look only):**

- `src/website/shopStyle.ts`, `src/website/v2/styles.ts`, `src/website/v3/styles.ts` — the shop's CSS.
- `src/website/v3/look.ts` — only the part that turns the seller's saved settings into colours, fonts and
  corners (`lookStyle`, `LOOK_FONTS`). The saved settings themselves and their checks stay as they are.
- `src/website/v2/theme.ts` — the three older themes' colours.
- Page markup and inline styles in: `ui.tsx`, `v2/Shell.tsx`, `v2/Card.tsx`, `v2/icons.tsx`,
  `v3/BrandCard.tsx`, `v3/BrandHome.tsx`, `v3/QuickSheets.tsx`, `pages/Home.tsx`, `pages/Product.tsx`,
  `pages/ShopList.tsx`, `pages/Cart.tsx`, `pages/DevicePages.tsx`, `checkoutPages.tsx`.
- `shop.html` — the font link, if the fonts change.

`checkoutPages.tsx` and `pages/Cart.tsx` are the checkout, order and cart SCREENS. Only how they are drawn
would change; every field, step, button, `data-testid` and every function they call stays.

**Would NOT change (0 lines):**

- Cart, checkout, payment, order logic and data: `cart.ts`, `checkoutLogic.ts`, `orderApi.ts`,
  `orderText.ts`, `pricing.ts`, `shipPay.ts`, `addressForm.ts`, `saved.ts`, `shopApi.ts`, `shopLogic.ts`,
  `shopFilter.ts`, `shopLinks.ts`, `route.ts`, `og.ts`, `pages/homeData.ts`, `pages/productData.ts`,
  `v2/cardFacts.ts`, `v3/brandData.ts`, `v3/brandBadge.ts`, `v3/quickAdd.ts`.
- Seller side: Website editor, Payment & shipping, Website orders, Products (`src/redesign/**`).
- Database (`sql/**`), server (`server.js`, `server/**`, `api/**`), printing, Chrome extension, phone apps.

Open point for the design step: if the new direction needs a look option that does not exist today
(for example a new font choice), that is a seller setting and a database whitelist — it would be listed
separately and is not assumed here.
