// "Server restarted on a new version." — ONE Telegram alert the first time the server starts on a commit
// (Jeff 2026-11-18, with the nightly Render deploy: .github/workflows/nightly-render-deploy.yml).
//   • The commit comes from Render's own env RENDER_GIT_COMMIT (Render sets it at every deploy). Missing,
//     or not a commit → no alert, nothing read, nothing written, one log word.
//   • ONCE per new commit, not at every restart. A restart forgets everything in memory and Render's
//     disk is new at every start, so the server keeps the 7 characters of the last version it announced
//     in ONE row it writes itself: app_settings, key "server_version_announced" (the server keeps other
//     small notes there the same way — the 全家 check's pause and count). A restart on the same commit
//     reads the row, finds its own version, and stays silent.
//   • The row is changed FIRST and the alert goes out only when THIS start changed it: two starts can
//     never both announce one version, and an alert Telegram refused is never repeated at every restart.
//   • Telegram alerts off (no token / chat id) → nothing is read or written. The first start after the
//     alerts are turned on announces the version it runs.
//   • The database does not answer → 3 tries, 1 minute apart, then nothing more until the next start.
//   • Logs: "[VERSION] <7 characters> <one word>" — the commit and a word, never anything else.
export const VERSION_ENV = "RENDER_GIT_COMMIT";
export const VERSION_SETTING_KEY = "server_version_announced";
export const VERSION_ALERT = "new_version";      // the key of the fixed text in server/telegramAlert.js
export const VERSION_TRIES = 3;
export const VERSION_RETRY_MS = 60 * 1000;
const TAG = "[VERSION]";
const SHORT_RE = /^[0-9a-f]{7}$/;

/** PURE — the 7 characters of the commit Render deployed, or "" when the env is missing / not a commit. */
export function shortCommit(env) {
  const raw = String(env?.[VERSION_ENV] ?? "").trim().toLowerCase();
  return /^[0-9a-f]{7,64}$/.test(raw) ? raw.slice(0, 7) : "";
}

const waitUnref = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); if (t && typeof t.unref === "function") t.unref(); });

/**
 * The one row. claim(commit) → "new"  this start changed the row to `commit` (it held another version, or was not there)
 *                              "same" the row already holds `commit` (a restart, or another start announced it)
 *                              "error" the database did not answer
 * `sb` = the server's service-role client. Never throws.
 */
export function createVersionStore(sb) {
  const table = () => sb.from("app_settings");
  return {
    async claim(commit, nowIso) {
      if (!SHORT_RE.test(String(commit))) return "error";
      try {
        // Two rounds at most: the second one only when another start wrote the row in between.
        for (let round = 0; round < 2; round++) {
          const cur = await table().select("value").eq("key", VERSION_SETTING_KEY).maybeSingle();
          if (cur.error) return "error";
          if (!cur.data) {
            const ins = await table().insert({ key: VERSION_SETTING_KEY, value: commit, updated_at: nowIso });
            if (!ins.error) return "new";
            if (ins.error.code !== "23505") return "error";
            continue;                                   // the row appeared: read it
          }
          if (cur.data.value === commit) return "same";
          // change it only if it still holds what was just read
          const upd = await table().update({ value: commit, updated_at: nowIso })
            .eq("key", VERSION_SETTING_KEY).eq("value", cur.data.value).select("key");
          if (upd.error) return "error";
          if (Array.isArray(upd.data) && upd.data.length > 0) return "new";
        }
        return "same";                                  // someone else kept changing it: not ours to announce
      } catch {
        return "error";
      }
    },
  };
}

/**
 * opts: env, store (createVersionStore, or null when the server has no service-role client),
 *       alert (createTelegramAlert), log, sleep (the wait between tries; tests pass their own), now.
 * start() — fire and forget, once per process. run() → the word it ended with (for the tests).
 */
export function createVersionAnnouncer({ env = process.env, store = null, alert = null, log = console.log, sleep = waitUnref, now = () => new Date() } = {}) {
  const say = (line) => { try { log(`${TAG} ${line}`); } catch { /* a log never stops anything */ } };
  let started = false;
  async function run() {
    const commit = shortCommit(env);
    if (!commit) { say("commit_unknown"); return "commit_unknown"; }
    if (!alert || typeof alert.enabled !== "function" || !alert.enabled()) { say(`${commit} alerts_off`); return "alerts_off"; }
    if (!store) { say(`${commit} no_store`); return "no_store"; }
    for (let n = 1; n <= VERSION_TRIES; n++) {
      let r = "error";
      try { r = await store.claim(commit, now().toISOString()); } catch { r = "error"; }
      if (r === "new") {
        try { alert.fire(VERSION_ALERT, commit); } catch { /* an alert never stops the server */ }
        say(`${commit} new`);
        return "new";
      }
      if (r === "same") { say(`${commit} same`); return "same"; }
      if (n < VERSION_TRIES) await sleep(VERSION_RETRY_MS);
    }
    say(`${commit} store_error`);
    return "store_error";
  }
  return {
    run,
    start() {
      if (started) return;
      started = true;
      try { void run().catch(() => {}); } catch { /* nothing */ }
    },
  };
}
