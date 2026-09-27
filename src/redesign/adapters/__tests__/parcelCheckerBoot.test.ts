// BOOT SMOKE TEST for the parcel-checker service worker (chrome-extension/
// background.js). Would have caught 1.12.0: it evaluates the REAL worker source
// under a faithful chrome stub, then drives BOTH lanes directly (pcTick swallows
// per-lane errors, so calling pcPoll / pcPollMulti themselves is what detects a
// throw) and asserts the multi lane runs all the way to the verdict write.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function fakeJwt(expSecFromNow = 3600): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b64({ alg: "HS256" })}.${b64({ sub: "u1", exp: Math.floor(Date.now() / 1000) + expSecFromNow })}.sig`;
}

const PENDING_ROW = {
  id: "row-1", phone: "0912345678", store_id: "195965", customer_name: "測試",
  gm_id: "GM2609096099718", sender_phone: "0979593026", need_phone: true, need_store: true,
  queue_depth: 1, created_at: new Date(Date.now() - 4000).toISOString(),
};

// Boots the worker. Returns the sandbox (top-level function declarations become
// globals under runInNewContext) plus spies for assertions.
function bootWorker(opts: { multiSeller?: boolean; rows?: unknown[]; emapTab?: boolean } = {}) {
  const src = readFileSync("chrome-extension/background.js", "utf8");
  const calls = { sendMessage: [] as unknown[], fetch: [] as string[], update: [] as unknown[], logs: [] as string[], scheduled: [] as number[] };
  const storage: Record<string, unknown> = {
    pc_config: { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "anon", multiSeller: opts.multiSeller ?? true },
  };
  const tabFor = (patterns: string[]) => {
    const p = patterns[0] || "";
    if (/emap/.test(p) && opts.emapTab === false) return [];
    return [{ id: /sellerflow/.test(p) ? 1 : /myship/.test(p) ? 2 : 3, url: p.replace("*", "cart/easy/GM1"), discarded: false, frozen: false }];
  };
  const chrome = {
    alarms: { create: vi.fn(), onAlarm: { addListener: vi.fn() } },
    runtime: { lastError: undefined, onMessage: { addListener: vi.fn() } },
    scripting: { executeScript: (_o: unknown, cb: () => void) => cb() },
    storage: { local: {
      get: (k: string | string[], cb: (r: Record<string, unknown>) => void) => { const key = Array.isArray(k) ? k[0] : k; cb({ [key]: storage[key] }); },
      set: (o: Record<string, unknown>, cb?: () => void) => { Object.assign(storage, o); cb?.(); },
    } },
    tabs: {
      query: (q: { url: string[] }, cb: (t: unknown[]) => void) => cb(tabFor(q.url)),
      sendMessage: (_id: number, msg: { type: string }, cb: (r: unknown) => void) => {
        calls.sendMessage.push(msg);
        if (msg.type === "SFL_GET_TOKEN") return cb({ ok: true, token: fakeJwt() });
        if (msg.type === "PC_PING") return cb({ ok: true, script: "x" });
        if (msg.type === "PC_CHECK_STORE") return cb({ ok: true, store_full_status: "open", store_reason: "", guidFound: true });
        if (msg.type === "PC_CHECK_PHONE") return cb({ ok: true, phone_check_status: "ok", phone_check_message: null, phone_restricted_until: null, phone_reason: "", tokenMs: 100, postMs: 90 });
        cb({ ok: true });
      },
      update: (id: number, props: unknown, cb?: () => void) => { calls.update.push({ id, props }); cb?.(); },
      reload: vi.fn(),
    },
  };
  const fetch = async (url: string) => {
    calls.fetch.push(url);
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
  const sandbox: Record<string, unknown> = {
    chrome, fetch, setTimeout, clearTimeout: () => {},
    console: { log: (...a: unknown[]) => calls.logs.push(a.join(" ")), warn: (...a: unknown[]) => calls.logs.push(a.join(" ")), error: (...a: unknown[]) => calls.logs.push(a.join(" ")) },
    Date, Promise, JSON, Math, Number, String, Boolean, Array, Object, Set, Map, URL, URLSearchParams, Error, RegExp, atob: (s: string) => Buffer.from(s, "base64").toString("binary"),
  };
  vm.createContext(sandbox);
  vm.runInNewContext(src, sandbox, { filename: "background.js" }); // BOOT — throws here = dead worker
  return { sb: sandbox as Record<string, (...a: unknown[]) => Promise<unknown>>, calls, storage };
}

describe("parcel-checker worker BOOT smoke (the test 1.12.0 was missing)", () => {
  it("background.js evaluates under the chrome stub without throwing (top-level boot) and registers its listeners", () => {
    const { sb, calls } = bootWorker();
    expect(typeof sb.pcTick).toBe("function");
    expect(typeof sb.pcPoll).toBe("function");
    expect(typeof sb.pcPollMulti).toBe("function");
    expect(calls.scheduled).toContain(0); // pcScheduleLoop(0) armed at load
  });

  it("legacy lane pcPoll runs the full SFL handshake + health prelude without throwing (multi mode → returns before its row loop)", async () => {
    const { sb, storage } = bootWorker({ multiSeller: true });
    await expect(sb.pcPoll()).resolves.not.toThrow();
    const st = storage.pc_status as Record<string, unknown>;
    expect(st.sfl).toBe("connected"); // the handshake reached 'connected' — the 1.12.0 popup never did
  });

  it("multi lane pcPollMulti runs to the ROW LOOP and writes a verdict (does not throw, reaches the verdict RPC)", async () => {
    const { sb, calls } = bootWorker({ multiSeller: true });
    await expect(sb.pcPollMulti()).resolves.not.toThrow();
    expect(calls.fetch.some((u) => /admin_parcel_checks_pending/.test(u))).toBe(true);
    expect(calls.sendMessage.some((m) => (m as { type: string }).type === "PC_CHECK_PHONE")).toBe(true); // row loop reached
    expect(calls.fetch.some((u) => /admin_parcel_check_verdict/.test(u))).toBe(true);   // verdict written
  });

  it("a full pcTick (both lanes) completes and re-arms the ~5s loop", async () => {
    const { sb, calls } = bootWorker({ multiSeller: true });
    await expect(sb.pcTick()).resolves.not.toThrow();
    expect(calls.scheduled).toContain(5000);
  });

  it("robustness: chrome.tabs.update (autoDiscardable) THROWING must not break the find/handshake", async () => {
    const boot = bootWorker({ multiSeller: true });
    (boot.sb.chrome as unknown as { tabs: { update: () => void } }).tabs.update = () => { throw new Error("autoDiscardable unsupported"); };
    await expect(boot.sb.pcPoll()).resolves.not.toThrow();
    expect((boot.storage.pc_status as Record<string, unknown>).sfl).toBe("connected");
  });

  it("robustness: no emap tab at all → lanes still complete (keepalive/session-state just skip)", async () => {
    const { sb } = bootWorker({ multiSeller: true, emapTab: false, rows: [] });
    await expect(sb.pcPoll()).resolves.not.toThrow();
    await expect(sb.pcPollMulti()).resolves.not.toThrow();
  });
});
