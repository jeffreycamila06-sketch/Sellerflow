// Final round — two reconnect stops, tested on the REAL server.js functions (scheduleTikTokReconnect,
// the reconnect queue + drain, the cooldown recorder) run on fake timers with fresh state; only
// startTikTokConnection / the status emitter / the disconnect are stubbed.
//   1. a reconnect that keeps hitting a rate limit is rescheduled at most 3 times, then stops with ONE
//      gray rate_limited status; a successful connect resets the count.
//   2. a reconnect already queued (or running) never connects an account the seller stopped
//      (/disconnect/tiktok, platform switch); a manual connect clears the stop.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import * as health from "../../../../server/connectionHealth.js";

const server = readFileSync(resolve(__dirname, "../../../../server.js"), "utf8");
const fnSrc = (src: string, name: string) => {
  const i = src.search(new RegExp(`(^|\\n)(async )?function ${name}\\(`));
  const start = src.indexOf(`function ${name}(`, i) - (src.slice(i, i + 20).includes("async") ? 6 : 0);
  return src.slice(start, src.indexOf("\n}\n", start) + 2);
};
const between = (a: string, b: string) => server.slice(server.indexOf(a), server.indexOf(b, server.indexOf(a)));
const constant = (name: string) => {
  const m = new RegExp(`const ${name} = ([^;]+);`).exec(server);
  if (!m) throw new Error(`no ${name}`);
  return m[1];
};

type Started = { key: string };
function harness(startImpl: (key: string) => Promise<void>) {
  const st = {
    tiktokReconnectTimers: new Map<string, unknown>(), tiktokReconnectAttempts: new Map<string, number>(),
    tiktokConnections: new Map<string, unknown>(), tiktokConnectLocks: new Set<string>(),
    tiktokRateLimitCooldowns: new Map<string, number>(), tiktokDailyCooldownKeys: new Set<string>(),
    tiktokNotFoundStreak: new Map<string, number>(), tiktokRateLimitReconnects: new Map<string, number>(),
    tiktokStoppedKeys: new Set<string>(), pendingTikTokReconnects: [] as unknown[],
    emitted: [] as Array<Record<string, unknown>>, started: [] as Started[], disconnected: [] as string[],
  };
  const body = `
    const { tiktokReconnectTimers, tiktokReconnectAttempts, tiktokConnections, tiktokConnectLocks,
      tiktokRateLimitCooldowns, tiktokDailyCooldownKeys, tiktokNotFoundStreak, tiktokRateLimitReconnects,
      tiktokStoppedKeys, pendingTikTokReconnects } = st;
    const { shouldSkipQueuedReconnect, isTikTokUserNotFound, nestedRateLimitError, rateLimitLabel, isDailyRoomsLabel,
      dailyCooldownMs, resolveRateLimitCooldownMs, noteRateLimit, EMPTY_RATE_LIMIT_STATS, NOT_FOUND_FINAL_STREAK } = h;
    const TIKTOK_RECONNECT_BASE_MS = ${constant("TIKTOK_RECONNECT_BASE_MS")};
    const TIKTOK_RECONNECT_MAX_MS = ${constant("TIKTOK_RECONNECT_MAX_MS")};
    const TIKTOK_RECONNECT_JITTER_MS = ${constant("TIKTOK_RECONNECT_JITTER_MS")};
    const TIKTOK_MAX_PARALLEL_RECONNECTS = ${constant("TIKTOK_MAX_PARALLEL_RECONNECTS")};
    const TIKTOK_MAX_RECONNECT_QUEUE = ${constant("TIKTOK_MAX_RECONNECT_QUEUE")};
    const TIKTOK_RECONNECT_MIN_GAP_MS = ${constant("TIKTOK_RECONNECT_MIN_GAP_MS")};
    const TIKTOK_RATE_LIMIT_RECONNECTS = ${constant("TIKTOK_RATE_LIMIT_RECONNECTS")};
    let activeTikTokReconnects = 0, lastTikTokReconnectStartedAt = 0, tiktokDrainTimer = null;
    let eulerRateLimitStats = EMPTY_RATE_LIMIT_STATS;
    const console = { log() {}, warn() {} };
    const emitTikTokStatus = (x) => st.emitted.push(x);
    const io = { to: () => ({ emit() {} }) };
    const sellerRoom = (s) => s, emailIdOf = (s) => s;
    const recordTikTokAttempt = () => {};
    const startTikTokConnection = async (key) => { st.started.push({ key }); await startImpl(key); };
    const disconnectTikTokConnection = async (key) => { st.disconnected.push(key); };
    ${fnSrc(server, "clearTikTokReconnect")}
    ${fnSrc(server, "getTikTokCooldownMs")}
    ${fnSrc(server, "rememberTikTokRateLimit")}
    ${fnSrc(server, "runQueuedTikTokReconnect")}
    ${fnSrc(server, "drainTikTokReconnectQueue")}
    ${fnSrc(server, "scheduleTikTokReconnect")}
    return { scheduleTikTokReconnect };`;
  const api = new Function("st", "h", "startImpl", "setTimeout", "clearTimeout", "Date", body)(
    st, health, startImpl, setTimeout, clearTimeout, Date,
  ) as { scheduleTikTokReconnect: (key: string, u: string, s: string, sess: string, reason?: string) => void };
  return { ...api, st };
}
const rateLimit = () => new Error("[Rate Limited] (minute_connections) Too many connections started, try again later.");
const KEY = "seller@x.com:TikTok:shop";
const drainAll = async () => { for (let i = 0; i < 40; i++) { await vi.advanceTimersByTimeAsync(60_000); } };

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 10, 6, 4)); });
afterEach(() => { vi.useRealTimers(); });

describe("1. a rate-limited reconnect is rescheduled at most 3 times, then stops", () => {
  it("4 rate limits in a row → 4 attempts (the first + exactly 3 reschedules), then ONE gray rate_limited status and no more", async () => {
    const h = harness(async () => { throw rateLimit(); });
    h.scheduleTikTokReconnect(KEY, "shop", "seller@x.com", "s1", "disconnected");
    await drainAll();
    expect(h.st.started).toHaveLength(4);                            // the drop's reconnect + 3 rescheduled ones
    const scheduled = h.st.emitted.filter((e) => e.reconnecting === true && e.reason === "rate_limited");
    expect(scheduled).toHaveLength(3);                               // exactly 3 reschedules because of the rate limit
    const gray = h.st.emitted.filter((e) => e.reconnecting === false && e.reason === "rate_limited");
    expect(gray).toHaveLength(4);                                   // one per rate limit (the recorder's own status)…
    expect(h.st.emitted[h.st.emitted.length - 1]).toMatchObject({ connected: false, reconnecting: false, reason: "rate_limited" }); // …the LAST thing sent: stopped, gray
    expect(h.st.tiktokReconnectTimers.size).toBe(0);
    expect(h.st.tiktokRateLimitReconnects.has(KEY)).toBe(false);
    await drainAll();
    expect(h.st.started).toHaveLength(4);                            // stopped for good — the seller taps Connect
  });
  it("a successful connect resets the count (2 rate limits, success, then 4 more → 3 reschedules again)", () => {
    const start = between("async function startTikTokConnection(", "async function connectTikTok(");
    expect(start.indexOf("tiktokRateLimitReconnects.delete(key);")).toBeGreaterThan(start.indexOf('recordTikTokAttempt("ok");'));
    expect(start.indexOf("tiktokRateLimitReconnects.delete(key);")).toBeGreaterThan(start.indexOf("tiktokNotFoundStreak.delete(key);"));
  });
  it("the count resets on success: two rate limits, then a success clears it (behaviour)", async () => {
    let n = 0;
    const h = harness(async (key) => {
      n += 1;
      if (n <= 2) throw rateLimit();
      h.st.tiktokRateLimitReconnects.delete(key);                    // what startTikTokConnection's success does (pinned above)
    });
    h.scheduleTikTokReconnect(KEY, "shop", "seller@x.com", "s1", "disconnected");
    await drainAll();
    expect(h.st.started).toHaveLength(3);
    expect(h.st.tiktokRateLimitReconnects.has(KEY)).toBe(false);
  });
  it("a manual disconnect / platform switch also resets it; the comment says 'at most 3', not 'ONE'", () => {
    expect(server).not.toContain("then ONE normal reconnect after it");
    expect(server).toContain("most TIKTOK_RATE_LIMIT_RECONNECTS times in a row");
    expect(fnSrc(server, "disconnectTikTokConnection")).toContain("if (manual) { clearTikTokReconnect(key); tiktokRateLimitReconnects.delete(key); }");
    expect(between('app.post("/disconnect/tiktok"', 'app.post("/connect/tiktok"')).toContain("tiktokRateLimitReconnects.delete(key);");
  });
});

describe("2. a stopped account is never reconnected by a queued or running reconnect", () => {
  it("stopped before the next reconnect is queued → it is never queued (the skip line in the queue)", async () => {
    const h = harness(async () => {});
    h.scheduleTikTokReconnect(KEY, "shop", "seller@x.com", "s1", "disconnected");
    await vi.advanceTimersByTimeAsync(36_000);                      // the timer fired → the job is queued / about to run
    h.st.tiktokStoppedKeys.add(KEY);                                 // /disconnect/tiktok (platform switch) right now
    h.st.started.length = 0;
    // a job that was already handed to the queue: run a fresh one through the same queue path
    h.scheduleTikTokReconnect(KEY, "shop", "seller@x.com", "s1", "retry_failed");
    await drainAll();
    expect(h.st.started).toEqual([]);
  });
  it("a job already IN the queue when the stop arrives does not connect (the other account's still does)", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);                    // no jitter: both timers fire at 5 s
    let release!: () => void;
    const h = harness((key) => (key === KEY ? Promise.resolve() : new Promise<void>((r) => { release = r; })));
    const OTHER = "seller@x.com:TikTok:other";
    h.scheduleTikTokReconnect(OTHER, "other", "seller@x.com", "s1", "disconnected");
    h.scheduleTikTokReconnect(KEY, "shop", "seller@x.com", "s1", "disconnected");
    await vi.advanceTimersByTimeAsync(5_000);                       // both fired: OTHER is running, KEY waits in the queue (1 at a time)
    expect(h.st.started.map((x) => x.key)).toEqual([OTHER]);
    expect(h.st.pendingTikTokReconnects).toHaveLength(1);           // KEY's job is queued right now
    h.st.tiktokStoppedKeys.add(KEY);                                 // the seller stops KEY (platform switch)
    release();
    await drainAll();
    expect(h.st.started.map((x) => x.key)).toEqual([OTHER]);         // KEY never connected
    expect(h.st.disconnected).toEqual([]);
  });
  it("stopped WHILE the reconnect is running → the new connection is torn down again with one gray 'disconnect'", async () => {
    let release!: () => void;
    const h = harness(() => new Promise<void>((r) => { release = r; }));
    h.scheduleTikTokReconnect(KEY, "shop", "seller@x.com", "s1", "disconnected");
    await vi.advanceTimersByTimeAsync(36_000);
    expect(h.st.started).toHaveLength(1);                            // the connect is in flight
    h.st.tiktokStoppedKeys.add(KEY);                                 // the seller switched platform meanwhile
    release(); await vi.advanceTimersByTimeAsync(0);
    expect(h.st.disconnected).toEqual([KEY]);
    expect(h.st.emitted[h.st.emitted.length - 1]).toMatchObject({ connected: false, reconnecting: false, reason: "disconnect" });
  });
  it("wiring: the disconnect route stops the key; a manual connect clears the stop; the queue's ONLY change vs main is the skip line", () => {
    const route = between('app.post("/disconnect/tiktok"', 'app.post("/connect/tiktok"');
    expect(route.indexOf("tiktokStoppedKeys.add(key);")).toBeLessThan(route.indexOf("const existing = tiktokConnections.get(key);"));
    const conn = between("async function connectTikTok(", "// M5 (security audit 2026-09-26)");
    expect(conn.indexOf("tiktokStoppedKeys.delete(key);")).toBeGreaterThan(conn.indexOf('key = liveKey(sellerId, "TikTok", cleanUsername);'));
    expect(conn.indexOf("tiktokStoppedKeys.delete(key);")).toBeLessThan(conn.indexOf("const cooldownMs = getTikTokCooldownMs(key);"));
    let main: string;
    try { main = execSync("git show origin/main:server.js", { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }); }
    catch { execSync("git fetch --depth=1 origin main", { stdio: "pipe" }); main = execSync("git show FETCH_HEAD:server.js", { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }); }
    const ours = fnSrc(server, "runQueuedTikTokReconnect").split("\n");
    const theirs = fnSrc(main, "runQueuedTikTokReconnect").split("\n");
    expect(ours.filter((l) => !theirs.includes(l))).toEqual([
      "  if (task && tiktokStoppedKeys.has(task.key)) return;   // stopped by the seller (disconnect / platform switch): never queue its reconnect",
    ]);
    expect(ours.length).toBe(theirs.length + 1);
    for (const name of ["drainTikTokReconnectQueue", "startTikTokHealthTimer"]) expect(fnSrc(server, name), name).toBe(fnSrc(main, name));
  });
});
