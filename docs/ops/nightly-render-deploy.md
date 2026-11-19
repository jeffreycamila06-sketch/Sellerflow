# Nightly Render deploy

Every night at **04:00 Taiwan time**, GitHub looks at `main`. If the server code changed and the
checks passed, it tells Render to deploy. You do not have to be awake.

It deploys **only when all three are true**:

1. server code on `main` changed since the last deploy (app-only changes never deploy);
2. the checks (CI) for that exact commit finished and passed;
3. the Render Deploy Hook is saved in GitHub (the one-time setup below).

Otherwise it does nothing and writes one line that says why.

---

## One-time setup (about 3 minutes)

### 1. Copy the Deploy Hook in Render

1. Open the Render dashboard and click the service **sellerflow-live-server**.
2. Click **Settings** (left side).
3. Find **Deploy Hook** and click the copy button next to the address.

The address is like a password: anyone who has it can restart the server.
Do not paste it in a chat, a note or a commit.

### 2. Paste it in GitHub

1. Open the repository on GitHub and click **Settings** (top row).
2. Left side: **Secrets and variables** → **Actions**.
3. Tab **Secrets** → **New repository secret**.
4. **Name:** `RENDER_DEPLOY_HOOK_URL`
5. **Secret:** paste the address from Render.
6. Click **Add secret**.

Leave Render's own **Auto-Deploy** setting as it is (off).

### 3. Check it

1. GitHub → **Actions** (top row) → **Nightly Render deploy** (left side).
2. **Run workflow** → tick **Only tell me what would happen (deploys nothing)** → **Run workflow**.
3. Open the new run. It shows three lines: the facts, and what it would do.

---

## Run it by hand

GitHub → **Actions** → **Nightly Render deploy** → **Run workflow** → **Run workflow**
(leave the box unticked, branch `main`).

It follows the same three rules as the nightly run. If it deploys, the server restarts right then,
so every seller who is live must tap Connect again. Check Business Pulse first.

## Turn it off for one night

1. GitHub → **Settings** → **Secrets and variables** → **Actions** → tab **Variables**.
2. **New repository variable**.
3. **Name:** `NIGHTLY_DEPLOY_PAUSE_UNTIL`
4. **Value:** the date of the morning to skip, written like `2026-11-20`.
   (The run is at 04:00 in the morning. To skip the run early on 20 November, type `2026-11-20`.)
5. **Add variable**.

The day after that date it works again by itself. To skip several nights, type the date of the last
morning. To end the pause early, delete the variable. A run started by hand ignores the pause.

## Turn it off for good

GitHub → **Actions** → **Nightly Render deploy** → the **…** button (top right) → **Disable workflow**.
To turn it on again: same place → **Enable workflow**.

---

## What the lines mean

Open a run (Actions → Nightly Render deploy → the run) to read its line.

| The line starts with | Meaning | What to do |
|---|---|---|
| `Skipped: nothing new on main…` | No commit since the last deploy. | Nothing. |
| `Skipped: … none of them is server code.` | Only the app changed. The app is already live through Vercel. | Nothing. |
| `Skipped: CI is still running…` | The checks were not finished at 04:00. | Nothing. The next night tries again. |
| `Skipped: CI did not pass…` | The checks failed for the newest commit. | Fix the checks (or re-run them if it was a one-off). The next night tries again. |
| `Skipped: the Render Deploy Hook is not saved yet…` | The setup above is not done. | Do the one-time setup. |
| `Skipped: the nightly deploy is paused until…` | You paused it. | Nothing. |
| `Deploying …` then `Render accepted the deploy…` | Render is building and restarting the server. | Wait for the Telegram message. |
| `Stopped: …` (the run is red) | Something needs you. The line says what. | See below. |

Red runs:

- **`the saved secret … is not a Render Deploy Hook address`** — copy the hook again from Render and
  save the secret again.
- **`Render answered 401` or `404`** — the hook was changed in Render (Regenerate), or Render cannot
  find the commit. Copy the hook again into the secret.
- **`the variable NIGHTLY_DEPLOY_PAUSE_UNTIL is not a date`** — fix the date (`2026-11-20`) or delete
  the variable.
- **`GitHub did not answer…`** — a GitHub hiccup. The next night tries again.

## The Telegram message

When the server has really restarted on new code, you get **one** message:

> Server restarted on a new version. 16b4bb9

The 7 characters are the commit. You get it once per new version, not at every restart.
It also comes after a deploy you start by hand in Render.

A message that ends with **(sent again)** is a second or third try: the first try failed, or
Telegram gave no answer for 80 seconds. If you see the same alert twice and one of them ends with
(sent again), it is ONE event, not two. This is the same for every alert the server sends.

No message in the morning, although server work was merged? Open last night's run and read its line.
If it says `Render accepted the deploy`, open Render → the service → **Events** to see if the build failed.

## Good to know

- **A merge to `main` with server code now goes live the next 04:00.** Before, nothing reached Render
  until you pressed Deploy. If a piece of server work must wait (for example until its database change
  is applied), apply that first, or pause the nightly run until it is done.
- **It does not check who is live.** A seller who is live at 04:00 must tap Connect again after the
  restart, as after any Render deploy.
- **GitHub can start it late.** Usually a few minutes after 04:00, sometimes more.
- **"Render accepted" is not "Render finished".** The run does not wait for Render. The Telegram
  message is the proof that the server is up on the new version.
- **A deploy you start by hand in Render is not seen by GitHub.** The next night may deploy the same
  version once more (one extra restart at 04:00). Nothing breaks.
- **The first run always deploys once** (if the checks passed): it has no note of an earlier deploy yet.
- **Where the note is kept:** a tag on GitHub called `render-deployed` (Code → **Tags**). Only this
  workflow moves it. To make the next run deploy again — for example after a build failed in Render —
  delete that tag.
- **If the hook leaks:** Render → the service → Settings → Deploy Hook → **Regenerate**, then save the
  new address in the GitHub secret.
