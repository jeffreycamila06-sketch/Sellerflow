# Smoke robot

A robot that opens the **real app** (www.sellerflowlive.com) in a browser, logs in as **one
test seller**, and clicks through the main screens the way a seller would. It tells you in a
few minutes whether the app still opens and works after a change.

It runs on GitHub (Actions), not on your computer.

## How to run it

1. Open the repo on GitHub → **Actions** tab.
2. On the left, click **Smoke robot**.
3. Click **Run workflow** → keep the branch → **Run workflow**.
4. Wait about 3–5 minutes.

It also runs by itself on every push to the branch `claude/build9-smoke-robot`. It never runs
on pushes to `main`.

Only one robot runs at a time. A second one waits for the first.

## How to read the result

- **Green check** = everything it checked works.
- **Red cross** = something needs a look.

Click the run, then **Summary**. You see one table:

| Result | Meaning |
|---|---|
| ✅ PASS | It works. |
| ✅ PASS (on the 2nd try) | It worked when tried again. Fine, but if it keeps happening, tell Claude. |
| ⏭️ SKIPPED | Not checked this time. The reason is in the last column. |
| ❌ FAIL | Something is wrong. The last column says what. |
| ❌ STOPPED | The robot stopped before any test (login failed, or the safety check below). Nothing was touched. |

At the bottom of the run page, under **Artifacts**, there is **smoke-robot-report**. Download
it and open `index.html` for the full report. A failed test has one screenshot there. Every
input box and the account email are blacked out in it.

## What to do when it is red

Send Claude the **name of the failed test** and the **sentence in the last column**. That is
usually enough. If you can, add the screenshot from the report.

## What it checks

| Test | What it checks |
|---|---|
| 01 Login | Logs in. The Live screen opens. No error message, no `E` code. |
| 02 Every main screen | Live, Orders, Products, Sales, Settings, Customers, Shipping (or its "Coming soon" tile for a seller), General Settings, sticker print pattern, printer settings, subscription (view only), support, Privacy & Terms, and the public `/privacy/` and `/terms/` pages all open. None is blank, none shows a code or a text key like `rd_...`. |
| 03 Language | Switches to Filipino, opens a few screens, switches back to English. No text key shows. |
| 04 Products | First removes any test product an earlier run left. Then adds a test product with a code, sees it in the list and on the Live screen (it turns Auto mode on in its own browser for this, and back off after), adds 1 to its stock, reloads, then deletes it. |
| 05 Manual order | **Always skipped.** In the app an order can only come from a live comment, and there is no button to remove an order. The robot would leave it behind. |
| 06 Sticker preview | The sticker preview shows "Buyer 12", no long number, no error. It never presses Printer Test. |
| 07a / 07b Shipping | Since Build 16 Shipping opens for admins only. For the robot's test seller (not an admin), 07a checks that the Settings tile and the Orders 🚚 button both say "Coming soon", are disabled and never open Shipping; 07b is skipped. For an admin account: the 7-11 shipping screen opens, and if a buyer is in the current session it opens that buyer's form and presses **Cancel** (never Save). |
| 08 Facebook | For a seller without Facebook access: the Facebook screen shows the plain "activation required" notice, no empty boxes, no technical words. Skipped if the test account has Facebook access. If it fails, it says whether the `fb_polish_v2` switch is on or off (it reads the app's own answer; it never changes the switch). |
| 14 Live picker | The Live screen shows the 4 tiles TikTok, Facebook, Instagram, Shopee (Instagram and Shopee "Coming soon"). Taps Facebook: a seller without Facebook access sees the "activation required" notice and the Telegram link (it only reads where the link goes, never opens it), no Connect. Then Back. Never connects. Skipped if the test account is live. |
| 11a TikTok add | Adds a made-up TikTok name (`sfl_robot_x7q9z_notlive`) to the test account and sees it in the list. |
| 12 TikTok not live | Opens the TikTok menu from the Live picker's TikTok tile (or the old TikTok chip, which only shows while 2+ sources are live), picks the made-up name and connects it **once**. The app must say in plain words that it is not live (no code, no technical words), and nothing may stay connected. Never retried. Skipped if the test account is live. |
| 11b TikTok remove | Removes the made-up name again. |
| 13 Practice comments | **Always skipped.** The practice comment feed is switched off on the real site; turning it on would mean changing the app. |
| 10 Server health | The live server's `/health` answers exactly `{"ok":true}`. |
| 09 Console | No crash messages in the browser during the whole run. |
| 99 Leftovers | Everything the robot added was removed again. If not, it names what is left. |

## What it never does

- It checks that the app is signed in to **exactly** the test account. If not, it stops at once
  and touches nothing.
- It never opens Admin, never changes the plan, never presses Delete account or Log out.
- It never connects to a real live (TikTok, Facebook, Shopee, Instagram). The only connect is
  the made-up TikTok name, once per run. This protects the live server from a TikTok cooldown
  that would hit every seller.
- It never sends a Messenger message or receipt, never exports to 7-11, never prints.
- It never writes to the database directly. Every change goes through the app's own buttons,
  and only on the test account.
- The password is never shown, saved in the report, or recorded. There is no video and no trace.

## What it may leave on the test account

- **The made-up TikTok name, for up to 4 hours.** The app locks a TikTok place for 4 hours after
  a name is removed. So if a run starts less than 4 hours after the last one, the robot does
  not add the name (11a, 12 and 11b show SKIPPED with the time it is free again). If removing
  ever fails anyway, test 99 says so, and the next run after the 4 hours removes it.
- **A 1-day live session.** If no session is running when it presses Connect, the app asks for a
  session length and the robot picks 1 day. The report says when this happened. The session
  only holds the test account's own data and ends by itself.

## Settings it needs

Two GitHub Actions secrets, already set: `E2E_EMAIL` and `E2E_PASSWORD` (the test seller's
login). To change them: repo **Settings → Secrets and variables → Actions**.

The app and server addresses are read from the repo itself (`mobile/capacitor.config.ts` and
`src/redesign/adapters/serverIdentity.ts`), so nothing else needs setting.

## Files

- `e2e/smoke/` — the robot (Playwright, Chromium only). `tests/smoke.spec.ts` has the checks.
- `.github/workflows/smoke-robot.yml` — the GitHub run.

For a developer test on a local copy: `ROBOT_APP_URL` and `ROBOT_SERVER_URL` point the robot
somewhere else. They are never set on GitHub.
