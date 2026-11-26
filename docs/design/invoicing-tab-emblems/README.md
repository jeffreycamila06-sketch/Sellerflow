# Invoicing tabs — the Live picker's emblems + motion

Jeff, 2026-11-26. Settings → Invoicing: the tab bar TikTok · Facebook · Instagram · Shopee now shows, above each
name, a small version of the SAME emblem the Live picker's tiles show (circle "t", rounded square "f", leaf "IG",
diamond "S", brand colours). Web only (Vercel). No SQL, no server.

## How it is built

- The emblem is ONE component, `src/redesign/components/PlatformEmblem.tsx`. The Live picker (Dashboard) and the
  Invoicing tabs both draw it. Its letters, colours and shape names are in `adapters/livePicker.ts`
  (`EMBLEM_LETTER`, `EMBLEM_BRAND`, `EMBLEM_SLUG`).
- In a tab the emblem is drawn at the picker's full size and made smaller as a whole (×0.36), so its ring, letter
  and movement keep the picker's proportions.
- Motion: the picker's own keyframes (`sflLpkBeat` TikTok, `sflLpkBob` Facebook, `sflLpkSway` Instagram,
  `sflLpkFlip` Shopee) and the picker's own durations. The selected tab's emblem moves at the picker's speed; the
  other three 2.5× slower (`--ivc-calm` in redesign.css — one number).
- It stops with the same three things as the picker: the picker's motion mode "off", the app's motion switch, and
  the phone's "reduce motion".
- Selected tab: 2px outline in the platform's colour on the card colour. No LIVE tag on the tabs.

## Two choices made while building (for Jeff)

- **"Livelier" and "calm" = speed.** The Live picker has one motion per platform, not a lively and a calm one. So
  the selected tab gets that motion at the picker's speed and the others the same motion 2.5× slower. To change
  how calm: the one number `--ivc-calm`.
- **TikTok's outline and the dark theme.** TikTok's brand colour is black. A black outline cannot be seen on the
  dark theme, so TikTok's outline uses the text colour (black on light, near-white on dark) — the same choice the
  emblem's own ring already makes. "White background" = the card colour: white on the light theme, the dark card
  on the dark theme (a pure white tab on the dark theme would hide the TikTok ring and glare).

## Pictures (`shots/`, the real app in preview mode, made-up seller and buyers)

| What | Files |
|---|---|
| The tab bar, TikTok selected — iPhone 390, Android 360, laptop 1280, light + dark | `tabs_<device>_<theme>.png` |
| Facebook / Instagram / Shopee selected (iPhone 390, light + dark) | `tabs_<platform>_iphone390_<theme>.png` |
| The tab bar at 360 px in the other 7 languages | `lang_360_<language>.png` |
| The Live picker on this branch (same pixels as main) | `livepicker_<theme>_branch.png` |

## Measured (`measured.txt`, all ok) — `node docs/design/invoicing-tab-emblems/shoot.cjs`

- 360 / 390 / 430 / 1280 px in all 8 languages: 4 tabs fit, each 58 px tall (78 px wide at 360), no name cut,
  every emblem inside its tab and above the name, nothing runs sideways.
- The animation each emblem really runs in the browser: selected = the picker's duration (1.7 / 2.8 / 3.2 /
  3.8 s), the others 4.25 / 7 / 8 / 9.5 s.
- "Reduce motion" and the app's motion switch: all four emblems report no animation; the tabs look the same.
- **The Live picker, main vs this branch:** the same pixels (picture fingerprints equal on 3 sizes × light / dark,
  taken with motion stopped so the frames match) and the same animations (name + duration per tile).

## Proof

- `src/redesign/screens/__tests__/Invoicing.tabEmblems.test.tsx` — the Live picker's markup equals what was
  recorded on main before the emblem was moved (`fixtures/livePicker.main.json`, four tiles and a chosen tile);
  a tab's emblem is the picker tile's emblem; 4 emblems above 4 names; no LIVE tag; the selected outline; 44 px+;
  the picker's keyframes / durations / switches.
- `Dashboard.livePicker.test.tsx` (not edited) — green.
- `proof/breaks.txt` — changes made on purpose and the test that caught each.

## Not changed

Orders, Send next, saved status, SQL, server, printing, `chrome-extension/` (0 lines), the Live picker's
behaviour and CSS. The help guide needs no change (the tabs have the same names and do the same thing).
