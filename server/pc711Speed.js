// 7-11 server checker — three speed changes (Jeff 2026-11-18). Server only. No new request to 7-11 and no
// rule changed: the extension's order, rests, timers and limits (server/pc711Shadow.js, server/pc711Emap.js)
// stay exactly as copied. Measured before (the evidence table, 12:13–17:42 Taipei): one parcel cost the server
// about 3.1 s of work against the extension's 0.3 s — a new connection for almost every check (store check
// 1.07 s, 0.23 s when the connection was still open), three settings read before every phone check, and a
// save between the store half and the phone half.
//
//   1. createKeepAliveFetch — the connections to the two 7-11 hosts stay open between checks, as a browser
//      tab keeps them. Node's own fetch closes an unused connection after 4 s; here it is PC711_KEEPALIVE_MS.
//      The SAME fetch, the SAME requests — only the connection's idle time. When the far server says to
//      close sooner (a Keep-Alive hint) or closes by itself, that wins; nothing here can keep it open.
//   2. createPassSettings — a setting read in a pass is reused for the rest of that pass (the extension's
//      pending read brings each parcel's shop and sender once a pass too). A failed read is not kept.
//   3. (in server/pc711Shadow.js) the store row is saved after the phone check, not between the two.
//
// Logs: one line at start, a word and a number only — never a phone, name, store number, cookie, token or guid.

export const PC711_KEEPALIVE_MS = 50 * 1000;        // an unused connection is kept this long (Node's default: 4 s)
export const PC711_KEEPALIVE_MIN_MS = 5 * 1000;
export const PC711_KEEPALIVE_MAX_MS = 120 * 1000;   // … and never longer, whatever the far server suggests
export const PC711_KEEPALIVE_ENV = "PC711_KEEPALIVE_MS"; // Render: 0 = off (Node's default again); 5000–120000 = that long
// the two 7-11 hosts of a check: 賣貨便, and E-Map (two names, the one that served the page)
export const PC711_KEEPALIVE_HOSTS = ["myship.7-11.com.tw", "emap.unipcsc.com.tw", "emap.pcsc.com.tw"];
const TAG = "[PC711_KEEPALIVE]";

/** The idle time from the environment: not set → PC711_KEEPALIVE_MS; "0" → 0 (off); a number → clamped to
 *  5 s – 120 s; anything else → PC711_KEEPALIVE_MS. Pure. */
export function keepAliveMsFrom(env = process.env) {
  const raw = String((env && env[PC711_KEEPALIVE_ENV]) ?? "").trim();
  if (raw === "") return PC711_KEEPALIVE_MS;
  if (!/^\d{1,7}$/.test(raw)) return PC711_KEEPALIVE_MS;
  const n = Number(raw);
  if (n === 0) return 0;
  return Math.min(PC711_KEEPALIVE_MAX_MS, Math.max(PC711_KEEPALIVE_MIN_MS, n));
}

/** The connection-pool class of Node's OWN fetch (the same library, the same version — no extra package).
 *  Node creates its default pool when its fetch library loads; its class is read from there. null when it
 *  cannot be found (then the keep-alive is off and every request goes exactly as before). */
export function builtInAgentClass(g = globalThis) {
  try {
    void g.Response;                                    // loads Node's fetch library (it creates the default pool)
    const d = g[Symbol.for("undici.globalDispatcher.1")];
    const C = d && d.constructor;
    return typeof C === "function" && C.prototype && typeof C.prototype.dispatch === "function" ? C : null;
  } catch { return null; }
}

/** The host of a request URL (string / URL / Request), lower case; "" when it cannot be read. */
export function hostOfRequest(url) {
  try { return new URL(typeof url === "string" ? url : String((url && url.url) || url)).hostname.toLowerCase(); } catch { return ""; }
}

/**
 * Two fetch functions that keep the connection to the 7-11 hosts open between requests:
 *   anon    — the phone check (sent without the 賣貨便 login);
 *   session — everything that carries a session (the E-Map open and the kept E-Map session).
 * Each has its own pool, so a request without the login never travels on a connection that carried it
 * (a browser separates them the same way). A URL of any other host goes through the plain fetch.
 * ms 0, no pool class, or a pool that cannot be built → both are the plain fetch (exactly as before).
 */
export function createKeepAliveFetch({ fetchImpl = fetch, ms = PC711_KEEPALIVE_MS, AgentClass = builtInAgentClass(), hosts = PC711_KEEPALIVE_HOSTS, log = console.log } = {}) {
  const plain = (url, init) => fetchImpl(url, init);
  const off = (why) => ({ anon: plain, session: plain, on: false, ms: 0, word: `off ${why}`, close: async () => {} });
  const idle = Number(ms) || 0;
  if (!(idle > 0)) return off("by_setting");
  if (typeof AgentClass !== "function") return off("no_pool");
  const pools = [];
  const build = () => {
    // only the idle time is set: connect, pipelining, the number of connections stay Node's defaults
    const pool = new AgentClass({ keepAliveTimeout: idle, keepAliveMaxTimeout: Math.max(idle, PC711_KEEPALIVE_MAX_MS) });
    if (!pool || typeof pool.dispatch !== "function") throw new Error("no_dispatch");
    pools.push(pool);
    return (url, init) => (hosts.includes(hostOfRequest(url)) ? fetchImpl(url, { ...(init || {}), dispatcher: pool }) : fetchImpl(url, init));
  };
  let anon, session;
  try { anon = build(); session = build(); } catch {
    for (const p of pools) { try { void Promise.resolve(p.close()).catch(() => {}); } catch { /* nothing */ } }
    return off("pool_failed");
  }
  return {
    anon, session, on: true, ms: idle, word: `on idle=${Math.round(idle / 1000)}s`,
    close: async () => { for (const p of pools) { try { await p.close(); } catch { /* nothing */ } } },
  };
}

/** The one start line. */
export const keepAliveLogLine = (ka) => `${TAG} ${ka && ka.word ? ka.word : "off"}`;

/**
 * Settings read once a pass. read(key) → the value read earlier in THIS pass, else one read. reset() at the
 * start of a pass. A read that fails is not kept: the next check of the pass reads again (as before).
 */
export function createPassSettings(readSetting) {
  let seen = new Map();
  return {
    reset() { seen = new Map(); },
    read(key) {
      const k = String(key);
      if (seen.has(k)) return seen.get(k);
      const mine = seen;
      const p = Promise.resolve().then(() => readSetting(k));
      mine.set(k, p);
      p.catch(() => { if (mine.get(k) === p) mine.delete(k); });
      return p;
    },
    /** how many keys this pass holds (tests) */
    size: () => seen.size,
  };
}

/** One at a time: run(fn) starts fn after every earlier one has ended (whatever its result). */
export function createSerial() {
  let tail = Promise.resolve();
  return function run(fn) {
    const mine = tail.then(() => fn());
    tail = mine.then(() => {}, () => {});
    return mine;
  };
}
