# Handoff (scoped): SellerFlowLive — **Channels** feature only

This package documents **only the Channels feature** of SellerFlowLive. Implement just this in the target codebase; ignore the rest of the app. The full prototype (`SellerFlowLive.dc.html`) is included **as visual reference** — do not rebuild the whole app, only the Channels flow described here.

> SellerFlowLive is a mobile-first live-selling assistant for TikTok/Facebook live sellers. "Channels" = the seller's connected TikTok accounts and Facebook pages/groups, and the act of connecting one to the live session.

---

## What "Channels" covers (two surfaces)

### A) Settings → Channels (manage connections)
A grouped card under a `CHANNELS` section header listing each platform:
- **TikTok Live** — icon chip (black rounded square, white "t"), title "TikTok Live", handle (e.g. `@maria_shops`) in the readable handle color, and a connection status on the right (green dot + "Connected", or muted "Not connected").
- **Facebook Live** — icon chip (`#1877f2` rounded square, white "f"), title "Facebook Live", page/group name, same status treatment.
Each row is tappable to manage (add / switch / disconnect) that platform's accounts.

### B) Dashboard channel chips (pick + connect for the live session)
Two chips in the live header — one per platform — that let the seller **choose which account** and **connect it to the current live**:
- **Chip (closed):** platform icon + currently-selected account name + status dot + chevron ▾.
- **Tap chip → dropdown** listing all connected accounts for that platform (avatar/initials + name + meta like "128K followers" / "Page"), the active one checkmarked. Selecting one switches the active account. Opening one platform's dropdown closes the other.
- **Dropdown footer:** two buttons — **Refresh** (re-scan connected accounts) and **Connect** (connect the selected account to the live).
- **Connect flow (3 states):**
  1. **Not connected** — chip neutral (no green), status dot muted/red, footer button says **Connect**.
  2. **Connecting…** — after pressing Connect, brief loading state (~1.2s), dot amber/pulsing, button shows "Connecting…".
  3. **Connected** — chip gets the **connected highlight**: green-tinted background, green inset border, and a glowing **pulsing green dot**; footer button flips to **Disconnect**. Pressing it returns to state 1.

### C) Manage [Platform] channels screens (add IDs / pages)
Tapping a row in **Settings → Channels** opens a dedicated manage screen:
- **Manage TikTok channels** — back button + platform icon + title; a list of connected IDs, each row = label **"ID TikTok N"** + an `@`-prefixed username input + a plan badge (**TRIAL** for the first, **PRO** otherwise; badge colors: TRIAL = `var(--surface-3)`/`var(--text-muted)`, PRO = `var(--accent-soft)`/`var(--accent-fg)`); helper text *"Username can only contain lowercase letters, numbers, underscores and periods."*; full-width **"Add TikTok — Multi Account"** button.
- **Manage Facebook channels** — same layout; rows labeled **"Facebook page N"** with a page/group name input; helper *"Connect a Facebook Page or Group you manage to capture live comments."*; **"Add Facebook — Multi Account"** button.
- **Add button → confirmation popup** (centered modal, redesign-styled — NOT the yellow of the source screenshot): title (e.g. "Add TikTok — Multi Account"), body *"To add a … for LIVE multi-account, please message our admin on Telegram and we'll set it up for you."*, a Telegram chip showing **@SellerFlowLive**, and two actions: **Cancel** (dismiss) and **OK** → opens `https://t.me/SellerFlowLive` in a new tab. State: `ttAddOpen` / `fbAddOpen`; screens `ttchannels` / `fbchannels`; data from `TT_ACCOUNTS` / `FB_ACCOUNTS`.

---

## Data model

```js
// TikTok = accounts; Facebook = pages/groups
TT_ACCOUNTS = [
  { handle: '@maria_shops',  name: "Maria's Live Shop", meta: '128K followers' },
  { handle: '@maria_beauty', name: 'Maria Beauty Hub',  meta: '54K followers'  },
  { handle: '@mariadeals',   name: 'Maria Deals PH',    meta: '31K followers'  },
];
FB_ACCOUNTS = [
  { handle: "Maria's Live Shop",  name: 'Page · 86K likes',     meta: 'Page'  },
  { handle: 'Maria Beauty Hub',   name: 'Page · 22K likes',     meta: 'Page'  },
  { handle: 'Reseller Group PH',  name: 'Group · 12K members',  meta: 'Group' },
];
```

## State (per platform, ×2: tt / fb)
- `ttIdx` / `fbIdx` — index of the selected account (default 0).
- `ttOpen` / `fbOpen` — dropdown open (opening one closes the other).
- `ttConnected` / `fbConnected` — boolean, **default false**.
- `ttConnecting` / `fbConnecting` — boolean transient loading flag.

## Behavior
- **Toggle dropdown:** `toggleTT` sets `ttOpen=!ttOpen, fbOpen=false` (and mirror for FB).
- **Pick account:** sets `ttIdx=i, ttOpen=false`.
- **Connect:** if already connected → disconnect (`ttConnected=false`). Else set `ttConnecting=true`, then after ~1200ms set `ttConnected=true, ttConnecting=false, ttOpen=false`.
- **Refresh:** re-scan placeholder (no-op in prototype; wire to real account fetch).
- In production, "connect" means binding the chosen account/page to the active live stream so comments are captured from it.

## Exact styling tokens (match the app's theme system)
The app is themeable (light/dark × 6 accents) via CSS variables; reuse them — **do not hardcode brand colors except platform marks and the green "connected" state.**

- **Chip (neutral):** `background: rgba(255,255,255,.14)`; `box-shadow: inset 0 0 0 1px rgba(255,255,255,.22)`; text `var(--on-header)`; status dot `rgba(255,255,255,.45)`.
- **Chip (connecting):** dot `#fbbf24`, pulsing.
- **Chip (connected):** `background: rgba(74,222,128,.22)`; `box-shadow: inset 0 0 0 1.3px rgba(74,222,128,.6)`; dot `#4ade80` with `box-shadow: 0 0 6px rgba(74,222,128,.9)` and a slow pulse animation.
- **Platform icon chips:** TikTok = `#000` rounded square, white "t"; Facebook = `#1877f2` rounded square, white "f".
- **Dropdown:** `background: var(--surface)`; `1px var(--border)`; radius 13px; `box-shadow: 0 16px 38px rgba(0,0,0,.3)`; section label 10px/800 letter-spaced in `var(--text-muted)`; rows = avatar + name (`var(--text)`) + meta (`var(--text-muted)`) + check in `var(--accent-fg)`; active row bg `var(--accent-soft)`.
- **Footer Refresh** = outlined (`1px var(--border-strong)`, `var(--surface-2)`, `var(--text)`); **Connect** = filled `var(--accent)` / `var(--accent-text)`. When connected, the Connect button becomes **Disconnect** (danger-tinted text on `var(--surface-2)`).
- **Settings → Channels status:** "Connected" = `var(--ok)` text + dot; handle in `var(--handle)`.

Theme tokens to honor: `--surface, --surface-2, --border, --border-strong, --text, --text-dim, --text-muted, --handle, --accent, --accent-text, --accent-fg, --accent-soft, --on-header, --ok`. (Light: white surfaces, accent header band; Dark: translucent surfaces over an indigo radial-gradient bg. See full README in the main handoff if needed.)

## Acceptance criteria
1. Settings → Channels lists TikTok + Facebook with correct icon, name/handle, and live status.
2. Dashboard shows two channel chips; each opens a dropdown of that platform's accounts; selecting switches the active account; opening one closes the other.
3. Connect runs neutral → connecting (~1.2s) → connected (green highlight + pulsing dot); Disconnect reverts.
4. Refresh and Connect buttons appear in each dropdown footer.
5. Everything is legible and correctly colored in all theme × accent combinations (use the CSS variables, not hardcoded colors, except platform marks + the green connected state).

## Files
- `SellerFlowLive.dc.html` — full prototype, **reference only**. The Channels markup lives in the Settings screen (under the `CHANNELS` label) and in the Dashboard header (the two chip buttons + dropdowns). The logic (state + handlers + `TT_ACCOUNTS`/`FB_ACCOUNTS`) is in the `Component` class — search for `toggleTT`, `connectTT`, `ttAccounts`, `ttChipBg`.
- This is a **design reference**, not production code — recreate the Channels flow in your stack (React Native / Flutter / web) following its patterns and your component library.
