// Shared harness for the parcel-checker service-worker tests: evaluates the REAL
// chrome-extension/background.js under a faithful `chrome` stub (node:vm) and
// exposes the worker's top-level functions + spies. No tests in this file.
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { vi } from "vitest";

export function fakeJwt(expSecFromNow = 3600): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ sub: "u1", exp: Math.floor(Date.now() / 1000) + expSecFromNow })}.sig`;
}

export const PENDING_ROW = {
  id: "row-1", phone: "0912345678", store_id: "195965", customer_name: "測試",
  gm_id: "GM2609096099718", sender_phone: "0979593026", need_phone: true, need_store: true,
  queue_depth: 1, created_at: new Date(Date.now() - 4000).toISOString(),
};

export type EmapTab = { id: number; url: string; guid: boolean; discarded?: boolean };
export type BootOpts = {
  multiSeller?: boolean;
  rows?: unknown[];
  emapTab?: boolean;              // false = no emap tab at all
  emapTabs?: EmapTab[];           // explicit emap tab set (overrides emapTab)
  storeVerdict?: () => string;    // PC_CHECK_STORE reply (default "open")
  phoneVerdict?: () => string;    // PC_CHECK_PHONE reply (default "ok")
  now?: () => number;             // injectable clock for Date.now()
  initialStatus?: Record<string, unknown>; // what a PREVIOUS worker life left in pc_status
};

export function bootWorker(opts: BootOpts = {}) {
  const src = readFileSync("chrome-extension/background.js", "utf8");
  const calls = { sendMessage: [] as { type: string; tabId: number }[], fetch: [] as string[], fetchBodies: [] as string[], update: [] as unknown[], reload: [] as number[], logs: [] as string[], scheduled: [] as number[] };
  const storage: Record<string, unknown> = {
    pc_config: { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon", multiSeller: opts.multiSeller ?? true },
    ...(opts.initialStatus ? { pc_status: opts.initialStatus } : {}),
  };
  const emapTabs: EmapTab[] = opts.emapTabs ?? (opts.emapTab === false ? [] : [{ id: 3, url: "https://emap.unipcsc.com.tw/ecmap/default.aspx", guid: true }]);
  const tabFor = (patterns: string[]) => {
    const p = patterns[0] || "";
    if (/emap/.test(p)) return emapTabs.map((t) => ({ id: t.id, url: t.url, discarded: Boolean(t.discarded), frozen: false }));
    return [{ id: /sellerflow/.test(p) ? 1 : 2, url: p.replace("*", "cart/easy/GM1"), discarded: false, frozen: false }];
  };
  const chrome = {
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
    runtime: { lastError: undefined, onMessage: { addListener: vi.fn() }, getManifest: () => ({ version: "test" }) },
    scripting: { executeScript: (_o: unknown, cb: () => void) => cb() },
    storage: { local: {
      get: (k: string | string[], cb: (r: Record<string, unknown>) => void) => { const key = Array.isArray(k) ? k[0] : k; cb({ [key]: storage[key] }); },
      set: (o: Record<string, unknown>, cb?: () => void) => { Object.assign(storage, o); cb?.(); },
    } },
    tabs: {
      query: (q: { url: string[] }, cb: (t: unknown[]) => void) => cb(tabFor(q.url)),
      sendMessage: (id: number, msg: { type: string }, cb: (r: unknown) => void) => {
        calls.sendMessage.push({ type: msg.type, tabId: id });
        const emap = emapTabs.find((t) => t.id === id);
        if (msg.type === "SFL_GET_TOKEN") return cb({ ok: true, token: fakeJwt() });
        if (msg.type === "PC_PING") return cb({ ok: true, script: "x" });
        if (msg.type === "PC_EMAP_PROBE") return cb({ ok: true, script: "emap", guidFound: Boolean(emap && emap.guid), url: emap ? emap.url : "" });
        if (msg.type === "PC_CHECK_STORE") {
          const v = emap && emap.guid ? (opts.storeVerdict ? opts.storeVerdict() : "open") : "unknown";
          return cb({ ok: true, store_full_status: v, store_reason: v === "unknown" ? "eshopGuid not found on emap page" : "", guidFound: Boolean(emap && emap.guid) });
        }
        if (msg.type === "PC_CHECK_PHONE") {
          const v = opts.phoneVerdict ? opts.phoneVerdict() : "ok";
          return cb({ ok: true, phone_check_status: v, phone_check_message: null, phone_restricted_until: null, phone_reason: v === "unknown" ? "myship not responding" : "", tokenMs: 100, postMs: 90 });
        }
        cb({ ok: true });
      },
      update: (id: number, props: unknown, cb?: () => void) => { calls.update.push({ id, props }); cb?.(); },
      reload: (id: number) => { calls.reload.push(id); },
    },
  };
  const fetch = async (url: string, init?: { body?: string }) => {
    calls.fetch.push(url); calls.fetchBodies.push(String(init?.body ?? ""));
    const rows = opts.rows ?? [PENDING_ROW];
    const body = /admin_parcel_checks_pending/.test(url) ? rows
      : /admin_parcel_check_config/.test(url) ? { enabled: "true", healthy: "true", sender_phone: "0979593026", probe_buyer: "0919342192", sample_gm: "GM1" }
      : /rest\/v1\/parcel_scans/.test(url) ? []
      : {};
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => "application/json" } };
  };
  // setTimeout: the row-gap/health sleeps (<=2s) resolve immediately; the boot
  // schedule (0) and the ~5s re-arm are recorded, NOT run — the test drives ticks.
  const setTimeout = (fn: () => void, ms: number) => { if (ms > 0 && ms <= 2000) fn(); else calls.scheduled.push(ms); return 1; };
  const now = opts.now;
  const DateCtor = now
    ? new Proxy(Date, { get: (t, k) => (k === "now" ? now : Reflect.get(t, k)), construct: (t, args) => new t(...(args.length ? (args as [number]) : [now()])) })
    : Date;
  const sandbox: Record<string, unknown> = {
    chrome, fetch, setTimeout, clearTimeout: () => {},
    console: { log: (...a: unknown[]) => calls.logs.push(a.join(" ")), warn: (...a: unknown[]) => calls.logs.push(a.join(" ")), error: (...a: unknown[]) => calls.logs.push(a.join(" ")) },
    Date: DateCtor, Promise, JSON, Math, Number, String, Boolean, Array, Object, Set, Map, URL, URLSearchParams, Error, RegExp, atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
  };
  vm.createContext(sandbox);
  vm.runInNewContext(src, sandbox, { filename: "background.js" }); // BOOT — throws here = dead worker
  const sb = sandbox as Record<string, (...a: unknown[]) => Promise<unknown>> & { chrome: typeof chrome };
  const status = () => (storage.pc_status as Record<string, unknown>) || {};
  // the boot status-reset is async (one storage write) — settle it before driving ticks
  const booted = new Promise<void>((r) => { let n = 0; const step = () => { if (++n > 20) return r(); Promise.resolve().then(step); }; step(); });
  return { sb, calls, storage, status, booted, emapTabs };
}
