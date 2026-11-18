// @vitest-environment node
// "Server restarted on a new version." + the 7-character commit (server/versionAlert.js, Jeff 2026-11-18).
// ONE Telegram alert per new commit, not at every restart. A FAKE Telegram and a FAKE database only.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createVersionAnnouncer, createVersionStore, shortCommit, VERSION_ENV, VERSION_SETTING_KEY, VERSION_ALERT, VERSION_TRIES, VERSION_RETRY_MS } from "../../../../server/versionAlert.js";
import { createTelegramAlert, alertText, ALERT_TEXTS, ALERT_VALUE_SHAPES } from "../../../../server/telegramAlert.js";

const FULL = "16b4bb93aaaabbbbccccddddeeeeffff00001111";
const OTHER = "0cc49da3aaaabbbbccccddddeeeeffff00002222";
const TOKEN = "123456789:MARKTOKENaaaaBBBBccccDDDDeeee_-1234";
const TG_ENV = { TELEGRAM_BOT_TOKEN: TOKEN, TELEGRAM_CHAT_ID: "-1001234567890" };

// ── a fake app_settings table that behaves like the real one for the calls the store makes ──────
type Row = { key: string; value: string; updated_at?: string };
function fakeDb(start: Row[] = [], opts: { failRead?: number; failInsert?: string; failUpdate?: boolean; onRead?: (rows: Row[]) => void } = {}) {
  const rows: Row[] = start.map((r) => ({ ...r }));
  const calls: string[] = [];
  let failRead = opts.failRead ?? 0;
  const sb = {
    from(table: string) {
      if (table !== "app_settings") throw new Error(`unexpected table ${table}`);
      return {
        select(cols: string) {
          const filters: Array<[string, string]> = [];
          const q = {
            eq(col: string, val: string) { filters.push([col, val]); return q; },
            async maybeSingle() {
              calls.push(`select ${cols} ${filters.map((f) => f.join("=")).join(" ")}`);
              if (failRead > 0) { failRead -= 1; return { data: null, error: { code: "08006", message: "connection failure" } }; }
              const hit = rows.find((r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v));
              const out = { data: hit ? { value: hit.value } : null, error: null };
              opts.onRead?.(rows);
              return out;
            },
          };
          return q;
        },
        async insert(row: Row) {
          calls.push(`insert ${row.key}=${row.value}`);
          if (opts.failInsert) return { error: { code: opts.failInsert, message: "insert failed" } };
          if (rows.some((r) => r.key === row.key)) return { error: { code: "23505", message: "duplicate key" } };
          rows.push({ ...row });
          return { error: null };
        },
        update(patch: Partial<Row>) {
          const filters: Array<[string, string]> = [];
          const q = {
            eq(col: string, val: string) { filters.push([col, val]); return q; },
            async select() {
              calls.push(`update value=${patch.value} where ${filters.map((f) => f.join("=")).join(" ")}`);
              if (opts.failUpdate) return { data: null, error: { code: "08006", message: "connection failure" } };
              const hits = rows.filter((r) => filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v));
              for (const r of hits) Object.assign(r, patch);
              return { data: hits.map((r) => ({ key: r.key })), error: null };
            },
          };
          return q;
        },
      };
    },
  };
  return { sb, rows, calls, value: () => rows.find((r) => r.key === VERSION_SETTING_KEY)?.value ?? null };
}

// ── a fake Telegram behind the REAL alert module ─────────────────────────────────────────────────
function telegram(env: Record<string, string> = TG_ENV, ok = true) {
  const texts: string[] = [];
  const logs: string[] = [];
  const f = vi.fn(async (_url: string, init: { body?: string }) => { texts.push(JSON.parse(String(init.body)).text); return { status: ok ? 200 : 500, json: async () => ({ ok }) }; });
  const alert = createTelegramAlert({ env, fetchImpl: f as never, log: (l: string) => logs.push(l), sleep: async () => {} });
  return { alert, texts, logs, f };
}
/** one start of the server on `commit`, against the same database and the same Telegram */
async function start(db: ReturnType<typeof fakeDb>, tg: ReturnType<typeof telegram>, commit: string | undefined, sleeps: number[] = []) {
  const logs: string[] = [];
  const a = createVersionAnnouncer({
    env: commit === undefined ? {} : { [VERSION_ENV]: commit }, store: createVersionStore(db.sb as never), alert: tg.alert,
    log: (l: string) => logs.push(l), sleep: async (ms: number) => { sleeps.push(ms); }, now: () => new Date("2026-11-19T20:10:00Z"),
  });
  const word = await a.run();
  await tg.alert.deliver("test").catch(() => {});      // let the fired alert leave before the test looks (alerts go out in order)
  for (let i = tg.texts.length - 1; i >= 0; i--) if (tg.texts[i] === ALERT_TEXTS.test) tg.texts.splice(i, 1);
  return { word, logs };
}

describe("V1 the message", () => {
  it("the fixed text + the 7-character commit, and nothing else", () => {
    expect(ALERT_TEXTS.new_version).toBe("Server restarted on a new version.");
    expect(alertText("new_version", "16b4bb9")).toBe("Server restarted on a new version. 16b4bb9");
    expect(VERSION_ALERT).toBe("new_version");
  });
  it("the value can ONLY be 7 characters 0-9 a-f: anything else sends nothing", async () => {
    const tg = telegram();
    for (const bad of [undefined, null, "", "16b4bb", "16b4bb93", "16B4BB9", "16b4bbg", "16b4 bb", " 16b4bb9", "16b4bb9\n", 1234567, ["16b4bb9"], { toString: () => "16b4bb9" },
      "call 0912345678", FULL, "<b>x</b>"]) {
      expect(alertText("new_version", bad as never), String(bad)).toBe("");
      expect(await tg.alert.send("new_version", bad as never)).toEqual({ ok: false, word: "unknown_text" });
    }
    expect(tg.f).not.toHaveBeenCalled();
    expect(String(ALERT_VALUE_SHAPES.new_version)).toBe("/^[0-9a-f]{7}$/");
  });
  it("7 characters is too short to be a phone, a store number or a tracking number in full", () => {
    // Taiwan mobile = 10 digits, 7-11 store = 6 digits, tracking = 8+ : a 7-character commit cannot be any of them.
    expect(alertText("new_version", "0912345")).toBe("Server restarted on a new version. 0912345");
    expect(alertText("new_version", "0912345678")).toBe("");
    expect(alertText("new_version", "123456")).toBe("");
  });
  it("every OTHER text takes no value: whatever is passed is never read, the message is word for word", async () => {
    const tg = telegram();
    for (const kind of Object.keys(ALERT_TEXTS).filter((k) => k !== "new_version")) {
      expect(alertText(kind, "0912345678 Maria")).toBe((ALERT_TEXTS as Record<string, string>)[kind]);
      await tg.alert.send(kind, "0912345678 Maria" as never);
    }
    expect(tg.texts).toEqual(Object.entries(ALERT_TEXTS).filter(([k]) => k !== "new_version").map(([, v]) => v));
    expect(Object.keys(ALERT_VALUE_SHAPES)).toEqual(["new_version"]);
  });
  it("send / deliver / fire all carry the value (the alert goes out through the module's own retries)", async () => {
    const tg = telegram();
    expect(await tg.alert.send("new_version", "16b4bb9")).toEqual({ ok: true });
    expect(await tg.alert.deliver("new_version", "0cc49da")).toEqual({ ok: true });
    tg.alert.fire("new_version", "abcdef0");
    await tg.alert.deliver("test");
    expect(tg.texts).toEqual(["Server restarted on a new version. 16b4bb9", "Server restarted on a new version. 0cc49da", "Server restarted on a new version. abcdef0", ALERT_TEXTS.test]);
  });
});

describe("V2 the commit comes from Render's env RENDER_GIT_COMMIT", () => {
  it("the first 7 characters, lower case", () => {
    expect(VERSION_ENV).toBe("RENDER_GIT_COMMIT");
    expect(shortCommit({ RENDER_GIT_COMMIT: FULL })).toBe("16b4bb9");
    expect(shortCommit({ RENDER_GIT_COMMIT: ` ${FULL.toUpperCase()}\n` })).toBe("16b4bb9");
    expect(shortCommit({ RENDER_GIT_COMMIT: "16b4bb9" })).toBe("16b4bb9");
  });
  it("missing, empty or not a commit → ''", () => {
    for (const env of [undefined, null, {}, { RENDER_GIT_COMMIT: "" }, { RENDER_GIT_COMMIT: "   " }, { RENDER_GIT_COMMIT: "main" }, { RENDER_GIT_COMMIT: "16b4bb" }, { RENDER_GIT_COMMIT: "16b4bb9 x" },
      { RENDER_GIT_COMMIT: "unknown" }, { GIT_COMMIT: FULL }, { RENDER_GIT_COMMIT: `${FULL}${FULL}0` }]) expect(shortCommit(env as never), JSON.stringify(env)).toBe("");
  });
  it("missing → no alert, NOTHING read or written, one log word", async () => {
    const db = fakeDb();
    const tg = telegram();
    for (const commit of [undefined, "", "not-a-commit"]) {
      const r = await start(db, tg, commit);
      expect(r).toEqual({ word: "commit_unknown", logs: ["[VERSION] commit_unknown"] });
    }
    expect(db.calls).toEqual([]);
    expect(tg.texts).toEqual([]);
  });
});

describe("V3 ONCE per new commit, not at every restart", () => {
  it("first start on a commit → ONE alert; five restarts on it → none", async () => {
    const db = fakeDb();
    const tg = telegram();
    expect(await start(db, tg, FULL)).toEqual({ word: "new", logs: ["[VERSION] 16b4bb9 new"] });
    expect(tg.texts).toEqual(["Server restarted on a new version. 16b4bb9"]);
    for (let i = 0; i < 5; i++) expect(await start(db, tg, FULL)).toEqual({ word: "same", logs: ["[VERSION] 16b4bb9 same"] });
    expect(tg.texts).toEqual(["Server restarted on a new version. 16b4bb9"]);
    expect(db.value()).toBe("16b4bb9");
  });
  it("the next commit → ONE more alert; restarts on it → none; going back to the older commit is a new version again", async () => {
    const db = fakeDb();
    const tg = telegram();
    await start(db, tg, OTHER);
    await start(db, tg, OTHER);
    await start(db, tg, FULL);
    await start(db, tg, FULL);
    await start(db, tg, FULL);
    expect(tg.texts).toEqual(["Server restarted on a new version. 0cc49da", "Server restarted on a new version. 16b4bb9"]);
    await start(db, tg, OTHER);                                  // a rollback in Render
    expect(tg.texts.at(-1)).toBe("Server restarted on a new version. 0cc49da");
    expect(tg.texts.length).toBe(3);
  });
  it("a restart costs ONE small read and writes nothing", async () => {
    const db = fakeDb([{ key: VERSION_SETTING_KEY, value: "16b4bb9" }]);
    await start(db, telegram(), FULL);
    expect(db.calls).toEqual([`select value key=${VERSION_SETTING_KEY}`]);
  });
  it("the row is made on the very first start, and changed only where it still holds the old version", async () => {
    const first = fakeDb();
    await start(first, telegram(), FULL);
    expect(first.calls).toEqual([`select value key=${VERSION_SETTING_KEY}`, `insert ${VERSION_SETTING_KEY}=16b4bb9`]);
    const next = fakeDb([{ key: VERSION_SETTING_KEY, value: "0cc49da" }, { key: "shipping_default_fee", value: "38" }]);
    await start(next, telegram(), FULL);
    expect(next.calls).toEqual([`select value key=${VERSION_SETTING_KEY}`, `update value=16b4bb9 where key=${VERSION_SETTING_KEY} value=0cc49da`]);
    expect(next.rows.find((r) => r.key === "shipping_default_fee")?.value).toBe("38");                     // no other setting is touched
    expect(next.rows.find((r) => r.key === VERSION_SETTING_KEY)?.updated_at).toBe("2026-11-19T20:10:00.000Z");
  });
  it("two starts of the same new version at the same moment: only ONE announces", async () => {
    // both read the old value; the second one's change finds the row already changed
    const db = fakeDb([{ key: VERSION_SETTING_KEY, value: "0cc49da" }]);
    const a = createVersionStore(db.sb as never);
    const b = createVersionStore(db.sb as never);
    const [ra, rb] = await Promise.all([a.claim("16b4bb9", "t"), b.claim("16b4bb9", "t")]);
    expect([ra, rb].sort()).toEqual(["new", "same"]);
    // and on the very first row: one insert wins, the other finds the row
    const empty = fakeDb();
    const [rc, rd] = await Promise.all([createVersionStore(empty.sb as never).claim("16b4bb9", "t"), createVersionStore(empty.sb as never).claim("16b4bb9", "t")]);
    expect([rc, rd].sort()).toEqual(["new", "same"]);
  });
  it("another start wrote ANOTHER version in between → this one still announces its own, once", async () => {
    let swapped = false;
    const db = fakeDb([{ key: VERSION_SETTING_KEY, value: "aaaaaaa" }], { onRead: (rows) => { if (!swapped) { swapped = true; rows[0].value = "bbbbbbb"; } } });
    expect(await createVersionStore(db.sb as never).claim("16b4bb9", "t")).toBe("new");
    expect(db.value()).toBe("16b4bb9");
  });
  it("a value that is not 7 commit characters is never written", async () => {
    const db = fakeDb();
    for (const bad of ["", "16b4bb", FULL, "0912345678", "x".repeat(7)]) expect(await createVersionStore(db.sb as never).claim(bad, "t")).toBe("error");
    expect(db.calls).toEqual([]);
  });
});

describe("V4 the row is changed FIRST: a failed alert is never repeated at every restart", () => {
  it("Telegram refuses (all 3 tries): the version is noted, and the next restarts stay silent", async () => {
    const db = fakeDb();
    const tg = telegram(TG_ENV, false);
    expect((await start(db, tg, FULL)).word).toBe("new");
    expect(db.value()).toBe("16b4bb9");
    const tries = tg.f.mock.calls.length;
    expect(tries).toBeGreaterThanOrEqual(3);
    expect((await start(db, tg, FULL)).word).toBe("same");
    expect((await start(db, tg, FULL)).word).toBe("same");
    expect(tg.texts.filter((t) => t.startsWith("Server restarted")).length).toBe(3);         // the 3 tries of the ONE alert
  });
  it("the database does not answer: 3 tries, 1 minute apart, then nothing more — and NO alert", async () => {
    expect([VERSION_TRIES, VERSION_RETRY_MS]).toEqual([3, 60000]);
    const db = fakeDb([], { failRead: 99 });
    const tg = telegram();
    const sleeps: number[] = [];
    expect(await start(db, tg, FULL, sleeps)).toEqual({ word: "store_error", logs: ["[VERSION] 16b4bb9 store_error"] });
    expect(sleeps).toEqual([60000, 60000]);
    expect(db.calls.length).toBe(3);
    expect(tg.texts).toEqual([]);
  });
  it("the database answers at the 2nd try → the alert goes out then, once", async () => {
    const db = fakeDb([], { failRead: 1 });
    const tg = telegram();
    const sleeps: number[] = [];
    expect((await start(db, tg, FULL, sleeps)).word).toBe("new");
    expect(sleeps).toEqual([60000]);
    expect(tg.texts).toEqual(["Server restarted on a new version. 16b4bb9"]);
  });
  it("the write fails (insert or change) → no alert; the next start announces it", async () => {
    for (const opts of [{ failInsert: "42501" }, { failUpdate: true }]) {
      const db = fakeDb("failUpdate" in opts ? [{ key: VERSION_SETTING_KEY, value: "0cc49da" }] : [], opts);
      const tg = telegram();
      expect((await start(db, tg, FULL)).word).toBe("store_error");
      expect(tg.texts).toEqual([]);
    }
    const db = fakeDb([{ key: VERSION_SETTING_KEY, value: "0cc49da" }]);
    const tg = telegram();
    expect((await start(db, tg, FULL)).word).toBe("new");
    expect(tg.texts.length).toBe(1);
  });
  it("a store that throws is an error, never a crash and never an alert", async () => {
    const tg = telegram();
    const logs: string[] = [];
    const a = createVersionAnnouncer({ env: { RENDER_GIT_COMMIT: FULL }, store: { claim: async () => { throw new Error("boom at https://db.example/x?key=SECRET"); } }, alert: tg.alert, log: (l: string) => logs.push(l), sleep: async () => {} });
    expect(await a.run()).toBe("store_error");
    expect(logs).toEqual(["[VERSION] 16b4bb9 store_error"]);              // the error's own words never reach a log
    const bad = createVersionStore({ from: () => { throw new Error("no client"); } } as never);
    expect(await bad.claim("16b4bb9", "t")).toBe("error");
    expect(tg.texts).toEqual([]);
  });
});

describe("V5 Telegram alerts off, or no database client", () => {
  it("alerts off → nothing read, nothing written; when they are turned on, the next start announces the running version", async () => {
    const db = fakeDb();
    for (const env of [{}, { TELEGRAM_BOT_TOKEN: TOKEN }, { TELEGRAM_BOT_TOKEN: "x", TELEGRAM_CHAT_ID: "y" }]) {
      const off = telegram(env as never);
      expect(await start(db, off, FULL)).toEqual({ word: "alerts_off", logs: ["[VERSION] 16b4bb9 alerts_off"] });
      expect(off.f).not.toHaveBeenCalled();
    }
    expect(db.calls).toEqual([]);
    expect(db.value()).toBeNull();
    const on = telegram();
    expect((await start(db, on, FULL)).word).toBe("new");
    expect(on.texts).toEqual(["Server restarted on a new version. 16b4bb9"]);
  });
  it("no service-role client (store null) or no alert module → no alert, one log word", async () => {
    const tg = telegram();
    const logs: string[] = [];
    expect(await createVersionAnnouncer({ env: { RENDER_GIT_COMMIT: FULL }, store: null, alert: tg.alert, log: (l: string) => logs.push(l) }).run()).toBe("no_store");
    expect(await createVersionAnnouncer({ env: { RENDER_GIT_COMMIT: FULL }, store: createVersionStore(fakeDb().sb as never), alert: null, log: (l: string) => logs.push(l) }).run()).toBe("alerts_off");
    expect(logs).toEqual(["[VERSION] 16b4bb9 no_store", "[VERSION] 16b4bb9 alerts_off"]);
    expect(tg.texts).toEqual([]);
  });
});

describe("V6 start(): once per process, never awaited, never throws", () => {
  it("returns at once while the database hangs; a second start() does nothing", async () => {
    let claims = 0;
    const tg = telegram();
    const a = createVersionAnnouncer({ env: { RENDER_GIT_COMMIT: FULL }, store: { claim: () => { claims += 1; return new Promise(() => {}); } }, alert: tg.alert, log: () => {} });
    expect(a.start()).toBeUndefined();
    a.start();
    a.start();
    await Promise.resolve();
    expect(claims).toBe(1);
  });
  it("a log that throws, an alert that throws: nothing escapes", async () => {
    const db = fakeDb();
    const alert = { enabled: () => true, fire: () => { throw new Error("x"); } };
    const a = createVersionAnnouncer({ env: { RENDER_GIT_COMMIT: FULL }, store: createVersionStore(db.sb as never), alert, log: () => { throw new Error("log"); } });
    expect(await a.run()).toBe("new");
    expect(() => a.start()).not.toThrow();
  });
  it("the logs hold the 7 characters and ONE word — never the token, an address or an error text", async () => {
    const db = fakeDb([], { failRead: 99 });
    const tg = telegram();
    const all: string[] = [];
    for (const commit of [FULL, undefined]) all.push(...(await start(db, tg, commit)).logs);
    all.push(...(await start(fakeDb(), tg, FULL)).logs, ...(await start(fakeDb([{ key: VERSION_SETTING_KEY, value: "16b4bb9" }]), tg, FULL)).logs);
    for (const l of all) expect(l).toMatch(/^\[VERSION\] ([0-9a-f]{7} )?[a-z_]+$/);
    expect(all.join(" ")).not.toContain("connection failure");
  });
});

describe("V7 server.js wiring", () => {
  const src = readFileSync("server.js", "utf8");
  const mod = readFileSync("server/versionAlert.js", "utf8");
  it("made with the service-role client and the Admin alert; started when the server is listening, not awaited", () => {
    expect(src).toContain('import { createVersionAnnouncer, createVersionStore } from "./server/versionAlert.js";');
    expect(src).toMatch(/const versionAnnouncer = createVersionAnnouncer\(\{ env: process\.env, store: serviceSb \? createVersionStore\(serviceSb\) : null, alert: adminAlert \}\);/);
    expect(src).toMatch(/server\.listen\(PORT, \(\) => \{\n\s+console\.log\(`SellerFlow TikTok LIVE server running on port \$\{PORT\}`\);\n\s+versionAnnouncer\.start\(\);[^\n]*\n\}\);/);
    expect(src.split("versionAnnouncer.").length - 1).toBe(1);
    expect(src).not.toMatch(/await\s+versionAnnouncer/);
  });
  it("the module reads ONE env name, touches ONE table with ONE key, and has no request of its own", () => {
    expect(mod.split("process.env").length - 1).toBe(1);                       // the default of the env option
    expect([...mod.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1])).toEqual(["app_settings"]);
    expect(VERSION_SETTING_KEY).toBe("server_version_announced");
    expect(mod).not.toMatch(/\bfetch\(|https?:\/\//);
    expect(mod).not.toMatch(/\.delete\(|\.upsert\(|\.rpc\(/);
    // the key is hidden behind neither admin-only prefix on purpose: it holds 7 commit characters only
    expect(VERSION_SETTING_KEY.startsWith("parcel_check_") || VERSION_SETTING_KEY.startsWith("fm_check_")).toBe(false);
  });
});
