# Settings tab — the "Invoicing" card (Soon)

Jeff, 2026-11-26. One full-width card replaces the "Receipt format" tile. Everyone sees it, right after the
Website card (or where that card would be).

- Tap, seller who has the Receipt format screen today → that screen opens, as before.
- Tap, everyone else → a short note in the app's own toast (4 seconds): "Coming soon: send each buyer their
  invoice in a few minutes after your live." No link, no new screen, nothing sent.

## Pictures (`shots/`, the real app in preview mode, made-up seller)

| What | Files |
|---|---|
| Settings tab, a Free seller, light + dark | `settings_iphone390_*.png`, `settings_android360_*.png`, `settings_laptop1280_*.png` |
| The "coming soon" note on a phone | `note_iphone390_light.png`, `note_iphone390_dark.png` |
| With the Website card / its "Soon" teaser (the card comes right after) | `settings_iphone390_with_website.png`, `settings_iphone390_with_website_soon.png` |
| The card alone at 320 px, each language | `card_320_<language>.png` |

## Measured (`measured.txt`, 42 checks, all ok)

`node docs/design/invoicing-soon/shoot.cjs` against `npx vite --config vite.preview.config.ts --port 5199`.
On 320 / 360 / 390 / 430 px in all 8 languages, and on the pictures above: the card is inside the screen with
its 14 px sides, nothing runs sideways, "Soon" is whole and on one line, no text is cut, the old tile is not there.

The border is written as 1.5px. The test browser draws whole pixels on its 1x screen; a phone (2x / 3x) draws 1.5.

## Seen while measuring — old, not changed here

At 320 px in Filipino, Bulgarian and Indonesian the tile PAIRS (General Settings / Customers …) and the Invite
friends card are wider than the screen by 12–38 px (long labels; the same with the new card hidden). The new
card has its own limit (the screen minus the 14 px sides), so it stays whole. 360 px and wider: no such case.
