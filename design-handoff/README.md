# Handoff: SellerFlowLive — Color / Theme System

## What this is
A **color + theme layer** to apply across the existing SellerFlowLive app. It does **not** change any layout, screens, routing, data, or functionality — only colors, theming, and text-readability. Use the existing `App.tsx` / `App.css` structure as-is; just wire in these tokens.

The reference mockup (`SellerFlowLive App.dc.html`, open in a browser) shows every screen in both themes with the accent picker and @handle adjuster working. It is a **design reference**, not production code — `support.js` is a preview runtime only, **ignore it**.

## Scope — what changed (and nothing else)
1. **Two themes:** Dark mode (the indigo "automation" look) + Light mode (clean white).
2. **Accent color system:** one accent drives buttons, links, active nav, header gradient, highlights. 6 presets, user-selectable in Settings.
3. **@username (@handle) readability:** handles were too faint — now a dedicated, darker token with a 4-level adjuster.
4. **Readability rule:** every text/icon color is a theme token, so contrast stays correct when theme OR accent changes.

No new screens, copy, layout, or behavior. Keep all existing components.

## How to implement
Define these as CSS custom properties on a theme root (e.g. `[data-theme="dark"]` / `[data-theme="light"]` on `<body>` or the app shell), and replace hard-coded colors in `App.css` with `var(--*)`. Store `theme`, `accent`, and `handleLevel` in app state + `localStorage`. Respect `prefers-color-scheme` for first-run default if you like (current mockup defaults to **dark**).

## Theme tokens

### DARK theme
```
--bg:            radial-gradient(125% 65% at 80% -5%, #3730a3 0%, #251f7a 38%, #15123f 70%, #0a0824 100%)
--surface:       rgba(255,255,255,.055)
--surface2:      rgba(255,255,255,.05)
--border:        rgba(129,140,248,.22)
--border2:       rgba(129,140,248,.30)
--text:          #ffffff      /* primary text */
--text2:         #e0e7ff      /* secondary text */
--dim:           rgba(199,210,254,.72)   /* labels */
--faint:         rgba(199,210,254,.50)   /* timestamps, meta */
--handle:        (see @handle levels — default rgba(214,222,255,.90))
--on-accent:     #ffffff
--success:       #34d399      --success-soft: rgba(52,211,153,.14)
--cyan:          #22d3ee      --cyan-text: #a5f3fc
--cyan-soft:     rgba(34,211,238,.10)    --cyan-border: rgba(34,211,238,.32)
--shadow:        0 16px 40px rgba(10,8,36,.40)
--grid:          rgba(129,140,248,.085)  /* animated bg grid; dark only */
--nav:           rgba(15,12,46,.82)      --nav-border: rgba(129,140,248,.20)
--head-bg:       transparent             --head-border: rgba(129,140,248,.16)
--head-text:     #ffffff                 --head-sub: rgba(199,210,254,.60)
--head-btn:      rgba(255,255,255,.07)   --head-btn-border: rgba(129,140,248,.30)
```
Dark mode also shows: animated grid (`--grid`, scrolls 7s), top-right indigo glow `rgba(99,102,241,.5)` blur 36px, bottom-left cyan glow `rgba(34,211,238,.22)` blur 44px. Light mode hides all of these.

### LIGHT theme
```
--bg:            #f3f4fb
--surface:       #ffffff
--surface2:      #f6f7fc
--border:        #ebecf5
--border2:       #e2e3ef
--text:          #1c1a35
--text2:         #34324f
--dim:           #6f6c86
--faint:         #a3a0b5
--handle:        (see @handle levels — default #5a5770)
--on-accent:     #ffffff
--success:       #059669      --success-soft: #ecfdf5
--cyan:          = accent     --cyan-text: = accent.text   (light mode reuses accent for these)
--cyan-soft:     = accent.soft    --cyan-border: = accent.border
--shadow:        0 12px 34px rgba(28,26,53,.10)
--grid:          transparent
--nav:           rgba(255,255,255,.92)   --nav-border: #ececf4
--head-bg:       linear-gradient(135deg, accent.a, accent.a2)   /* colored header band */
--head-border:   transparent             --head-text: #ffffff   --head-sub: rgba(255,255,255,.80)
--head-btn:      rgba(255,255,255,.18)   --head-btn-border: rgba(255,255,255,.30)
```

## Accent color system
One accent feeds these tokens (recompute on accent change):
`--accent`, `--accent2` (gradient partner), `--accent-bright` (links/active text — in dark mode this is the lighter shade; in light mode it equals `--accent`), `--accent-soft`, `--accent-border`, `--accent-glow`.
Primary button = `linear-gradient(135deg, var(--accent-bright), var(--accent))`, shadow `0 10px 26px var(--accent-glow)`. Light-mode header band = `linear-gradient(135deg, accent.a, accent.a2)`.

**6 presets** (`a` = base, `a2` = gradient partner, `bright` = light shade for dark-mode links, `soft`/`border`/`ring` = light tints, `text` = readable-on-light, `glow` = button shadow):
```
Indigo  a:#4f46e5 a2:#6366f1 bright:#818cf8 soft:#eef2ff border:#e0e7ff ring:#c7d2fe text:#3730a3 glow:rgba(79,70,229,.4)
Violet  a:#7c3aed a2:#8b5cf6 bright:#a78bfa soft:#f5f3ff border:#ede9fe ring:#ddd6fe text:#5b21b6 glow:rgba(124,58,237,.4)
Emerald a:#059669 a2:#10b981 bright:#34d399 soft:#ecfdf5 border:#d1fae5 ring:#a7f3d0 text:#065f46 glow:rgba(5,150,105,.4)
Rose    a:#e11d48 a2:#f43f5e bright:#fb7185 soft:#fff1f3 border:#ffe4e8 ring:#fecdd3 text:#9f1239 glow:rgba(225,29,72,.4)
Sky     a:#0284c7 a2:#0ea5e9 bright:#38bdf8 soft:#f0f9ff border:#e0f2fe ring:#bae6fd text:#075985 glow:rgba(2,132,199,.4)
Amber   a:#d97706 a2:#f59e0b bright:#fbbf24 soft:#fffbeb border:#fef3c7 ring:#fde68a text:#92400e glow:rgba(217,119,6,.4)
```
- **Dark mode:** `--accent-bright = bright`, `--accent-soft = rgba(255,255,255,.06)`, `--accent-border = rgba(129,140,248,.40)`.
- **Light mode:** `--accent-bright = a`, `--accent-soft = soft`, `--accent-border = border`; cyan tokens map to the accent (`--cyan = a`, `--cyan-text = text`, `--cyan-soft = soft`, `--cyan-border = border`).
- Settings → Appearance renders a swatch per preset; active swatch gets a 2px ring. Persist choice.

## @username (@handle) readability
Handles use a dedicated `--handle` token (NOT `--faint`), with **4 darkness levels** the user picks. Apply `--handle` to every `@handle` label (live comment meta, buyer rows, etc.); keep timestamps/secondary meta on `--faint`.
```
level   DARK value              LIGHT value
0 Subtle   rgba(199,210,254,.55)   #9b98ad
1 Medium   rgba(199,210,254,.72)   #7b7890
2 Dark *   rgba(214,222,255,.90)   #5a5770     (* current default — most readable balance)
3 Darkest  #e6ebff                 #403d54
```
Render handles at `font-weight:600` for extra legibility. Expose the 4-level control in Settings (or app preferences). Persist `handleLevel`.

## State to add
- `theme: "dark" | "light"` (persisted; toggled by header ☾/☀ button and Settings pills)
- `accent: <preset name>` (persisted; Settings swatches)
- `handleLevel: 0..3` (persisted; default 2)
Each just recomputes the CSS custom properties on the theme root — no layout reflow.

## Readability guarantee
Because every color is a token and accents ship with both a dark-mode `bright` shade and a light-mode `text` shade, text stays readable in all theme × accent combinations. When adding any new colored text, use `--text` / `--text2` / `--dim` / `--handle` (never a raw hex) so it auto-adapts.

## Files
- `SellerFlowLive App.dc.html` — interactive reference (all screens, both themes, pickers). Read its inline styles / the `tokens()` + `ACCENTS` + `HANDLE` objects in its script for exact mappings.
- `assets/icon-180.png` — app icon (already in repo as brand asset; included for convenience).
- `support.js` — preview runtime only; **ignore for implementation**.

## Suggested prompt for Claude Code
> "Apply the color/theme system in this handoff's README.md across the SellerFlowLive app. Add dark/light theming, the 6-preset accent picker (Settings → Appearance), and the 4-level @handle readability control, using CSS custom properties. Do NOT change any layout, screens, copy, or behavior — only colors and theming. Persist theme/accent/handleLevel in localStorage."
