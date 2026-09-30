// Oct 1 blockers (Parcel Scan audit, 2026-09-30) — one suite per item.
// H1 expected-value verdicts (sql/67 + extension) · H2 tab-aware slots ·
// H3 re-mint from expired/no_tab · M1 restriction wording · M2 two-strike
// sender pause · M12 parcel_check_* settings admin-only · M3 poll backoff ·
// M4 unexported rows always loaded · M7 unknown counted at export.
// (H4 banner / M5 / M6 live in myshipSetup.test.tsx + parcelCheck.test.ts.)
import { describe, it, expect, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import vm from "node:vm";
import { bootWorker, PENDING_ROW, type EmapTab } from "./parcelCheckerHarness";
import {
  verdictPollMs, VERDICT_POLL_FAST_MS, VERDICT_POLL_SLOW_MS, rowCheckUnresolved, mergeScanLists, SCANS_PAGE,
  type ParcelScanRow,
} from "../parcelScan";

const sql67 = readFileSync("sql/67_parcel_check_oct1.sql", "utf8");
const fnBody = (name: string) => {
  const i = sql67.indexOf(`function public.${name}(`);
  return sql67.slice(i, sql67.indexOf("$$;", i));
};
const verdictBody = () => {
  const i = sql67.indexOf("create or replace function public.admin_parcel_check_verdict(");
  return sql67.slice(i, sql67.indexOf("end $$;", i));
};
const verdictCalls = (calls: { fetch: string[]; fetchBodies: string[] }) =>
  calls.fetch.map((u, i) => ({ u, b: calls.fetchBodies[i] })).filter((x) => /admin_parcel_check_verdict/.test(x.u)).map((x) => JSON.parse(x.b));

describe("H1 · a late verdict only lands on the value that was checked", () => {
  it("sql/67: the old 5-arg overload is dropped first (no PostgREST ambiguity), the new one takes both expected values defaulting NULL", () => {
    const drop = sql67.indexOf("drop function if exists public.admin_parcel_check_verdict(uuid, text, text, text, date);");
    expect(drop).toBeGreaterThan(-1);
    expect(drop).toBeLessThan(sql67.indexOf("create or replace function public.admin_parcel_check_verdict("));
    expect(sql67).toMatch(/p_expected_phone text default null, p_expected_store text default null\)/);
  });

  it("sql/67: each half applies only while the row still holds the expected value (NULL = today's behaviour); row locked while deciding", () => {
    const f = verdictBody();
    expect(f).toContain("from parcel_scans ps where ps.id = p_id for update;");
    expect(f).toContain("and (p_expected_store is null or v_cur_store is not distinct from p_expected_store);");
    expect(f).toContain("and (p_expected_phone is null or v_cur_phone is not distinct from p_expected_phone);");
    expect(f).toContain("phone_check_status     = case when v_apply_phone then p_phone_check_status else phone_check_status end");
    expect(f).toContain("store_full_status      = case when not v_apply_store then store_full_status");
    // sql/66 rule kept: a give-up never overwrites a real store verdict
    expect(f).toContain("when p_store_full_status = 'unknown' and store_full_status in ('open','full') then store_full_status");
  });

  it("sql/67: shared caches + the store log are keyed on the CHECKED values, never the row's current ones", () => {
    const f = verdictBody();
    expect(f).toContain("v_store_key := coalesce(p_expected_store, v_cur_store);");
    expect(f).toContain("v_phone_key := coalesce(p_expected_phone, v_cur_phone);");
    expect(f).toContain("values (v_store_key, p_store_full_status, now())");
    expect(f).toContain("insert into store_check_log(store_id, status, checked_at) values (v_store_key, p_store_full_status, now());");
    expect(f).toContain("values (v_phone_key, p_phone_check_status, p_phone_check_message, p_phone_restricted_until, now())");
    // no cache write may use the row's live columns directly
    expect(f).not.toMatch(/values \(v_cur_(phone|store)/);
    expect(f).toContain("if not public.is_admin() then");
  });

  it("extension: the verdict carries the row's phone + store_id as the expected values", async () => {
    const { sb, calls, booted } = bootWorker({ rows: [PENDING_ROW] });
    await booted;
    await sb.pcTick();
    const v = verdictCalls(calls);
    expect(v).toHaveLength(1);
    expect(v[0].p_expected_phone).toBe("0912345678");
    expect(v[0].p_expected_store).toBe("195965");
    expect(v[0].p_phone_check_status).toBe("ok");
    expect(v[0].p_store_full_status).toBe("open");
  });

  it("sql/67 Recheck trigger: clearing a real phone verdict on the SAME phone deletes that phone's cache entry (an edit does not)", () => {
    const f = fnBody("parcel_scans_recheck_clears_phone_cache");
    expect(f).toContain("if old.phone_check_status in ('ok','restricted') and new.phone_check_status is null");
    expect(f).toContain("and new.phone is not distinct from old.phone and coalesce(new.phone, '') <> ''");
    expect(f).toContain("delete from public.phone_check_cache where phone = new.phone;");
    expect(sql67).toContain("revoke all on function public.parcel_scans_recheck_clears_phone_cache() from public, anon, authenticated;");
    expect(sql67).toMatch(/after update of phone_check_status on public\.parcel_scans\s+for each row execute function public\.parcel_scans_recheck_clears_phone_cache\(\);/);
  });
});

describe("H2 · a missing tab never uses up the slots", () => {
  const storeOnly = (i: number) => ({ ...PENDING_ROW, id: `s-${i}`, need_phone: false, need_store: true });
  const phoneRow = { ...PENDING_ROW, id: "p-1", need_phone: true, need_store: true };

  it("no E-Map tab + 5 store-only rows ahead: the phone row behind them is still checked in the SAME poll", async () => {
    const { sb, calls, booted } = bootWorker({ emapTab: false, cartDetailTab: false, rows: [1, 2, 3, 4, 5].map(storeOnly).concat([phoneRow]) });
    await booted;
    await sb.pcTick();
    const phoneChecks = calls.sendMessage.filter((m) => m.type === "PC_CHECK_PHONE" && m.rowId);
    expect(phoneChecks.map((m) => m.rowId)).toEqual(["p-1"]);
    expect(calls.sendMessage.some((m) => m.type === "PC_CHECK_STORE")).toBe(false);
    const v = verdictCalls(calls);
    expect(v.map((x) => x.p_id)).toEqual(["p-1"]);
    expect(v[0].p_store_full_status).toBeNull(); // store half untouched (no tab) — stays queued
  });

  it("a row whose halves can't run doesn't count: 5 runnable phone rows behind 5 store-only rows ALL run", async () => {
    const phones = [1, 2, 3, 4, 5].map((i) => ({ ...PENDING_ROW, id: `p-${i}`, need_phone: true, need_store: false }));
    const { sb, calls, booted } = bootWorker({ emapTab: false, cartDetailTab: false, rows: [1, 2, 3, 4, 5].map(storeOnly).concat(phones) });
    await booted;
    await sb.pcTick();
    expect(calls.sendMessage.filter((m) => m.type === "PC_CHECK_PHONE" && m.rowId).map((m) => m.rowId)).toEqual(["p-1", "p-2", "p-3", "p-4", "p-5"]);
  });
});

describe("H3 · auto re-mint from 'expired' and parked 'no_tab'", () => {
  const clicks = (calls: { sendMessage: { type: string; tabId: number }[] }) => calls.sendMessage.filter((m) => m.type === "PC_CLICK_PICK_STORE").map((m) => m.tabId);

  it("expired (only error.aspx) + a parked /cart/detail tab → ONE click, then the new guid tab is adopted → green", async () => {
    let t = 1_000_000_000_000;
    const boot = bootWorker({
      now: () => t, rows: [],
      emapTabs: [{ id: 5, url: "https://emap.unipcsc.com.tw/ecmap/error.aspx", guid: false }],
      onPickStoreClick: (tabs: EmapTab[]) => { tabs.push({ id: 9, url: "https://emap.unipcsc.com.tw/mobilemap/default.aspx", guid: true }); return { clicked: true }; },
    });
    await boot.booted;
    await boot.sb.pcTick();
    expect(clicks(boot.calls)).toEqual([2]);
    expect(boot.status().emap).toBe("reminting");
    t += 5000; await boot.sb.pcTick();
    expect(boot.status().emapTabId).toBe(9);
    expect(boot.status().emap).toBe("ok");
    expect(clicks(boot.calls)).toEqual([2]);
  });

  it("expired: one attempt per episode (same cooldown as 'dead') — a failed re-mint is not retried every tick", async () => {
    let t = 1_000_000_000_000;
    const boot = bootWorker({ now: () => t, rows: [], emapTabs: [{ id: 5, url: "https://emap.unipcsc.com.tw/ecmap/error.aspx", guid: false }], onPickStoreClick: () => ({ clicked: true }) });
    await boot.booted;
    await boot.sb.pcTick();
    for (let i = 0; i < 10; i++) { t += 30_000; await boot.sb.pcTick(); }
    expect(clicks(boot.calls)).toEqual([2]);
  });

  it("no_tab + a parked /cart/detail tab → re-mint; no_tab with nothing parked → no click, stays 'no_tab'", async () => {
    const a = bootWorker({ rows: [], emapTab: false, onPickStoreClick: (tabs: EmapTab[]) => { tabs.push({ id: 9, url: "https://emap.unipcsc.com.tw/mobilemap/default.aspx", guid: true }); return { clicked: true }; } });
    await a.booted;
    await a.sb.pcTick();
    expect(clicks(a.calls)).toEqual([2]);
    const b = bootWorker({ rows: [], emapTab: false, cartDetailTab: false });
    await b.booted;
    await b.sb.pcTick();
    expect(clicks(b.calls)).toEqual([]);
    expect(b.status().emap).toBe("no_tab");
  });
});

describe("M1 · only 7-11's no-pickup wording is 'restricted'", () => {
  // Runs the REAL content script; the anonymous token GET + CheckoutValidation POST are stubbed.
  async function check(message: string | null, status = false) {
    const src = readFileSync("chrome-extension/myship-711.js", "utf8");
    let listener: ((m: unknown, s: unknown, cb: (r: unknown) => void) => boolean) | null = null;
    const fetch = vi.fn(async (url: string) => {
      if (/\/cart\/easy\//.test(url)) return { ok: true, status: 200, redirected: false, text: async () => "var tokenID = 'A:B';", headers: { get: () => "text/html" } };
      return { ok: true, status: 200, redirected: false, headers: { get: () => "application/json" }, json: async () => ({ Status: status, Message: message }) };
    });
    const sandbox: Record<string, unknown> = {
      window: {}, document: { documentElement: { innerHTML: "" }, getElementById: () => null },
      chrome: { runtime: { onMessage: { addListener: (l: typeof listener) => { listener = l; } } } },
      fetch, AbortController, setTimeout, clearTimeout, URLSearchParams, Promise, String, Date, console,
    };
    vm.runInNewContext(src, sandbox);
    return await new Promise<{ phone_check_status: string; phone_restricted_until: string | null; phone_reason: string }>((res) => {
      listener!({ type: "PC_CHECK_PHONE", anon: true, row: { store_id: "195965", phone: "0912345678", customer_name: "測試" }, config: { cgdmId: "GM1", ordMobile: "0979593026" } }, {}, res as (r: unknown) => void);
    });
  }

  it("the dated buyer wording → restricted, with the date parsed", async () => {
    const r = await check("此手機號碼因多次未取紀錄，已被限制使用取貨付款功能，預計2026年10月15日 才能再次使用取貨付款功能");
    expect(r.phone_check_status).toBe("restricted");
    expect(r.phone_restricted_until).toBe("2026-10-15");
  });

  it("the undated 遭檢舉 wording → restricted (no date)", async () => {
    const r = await check("您因多次未取紀錄遭檢舉，暫無法於平台成立訂單，如需了解更多資訊，請瀏覽幫助中心");
    expect(r.phone_check_status).toBe("restricted");
    expect(r.phone_restricted_until).toBeNull();
  });

  it("any OTHER Status:false (store / name / GM problems) → 'unknown' with the message as the reason, never red", async () => {
    for (const m of ["取件門市目前無法提供服務", "收件人姓名格式錯誤", "賣場已關閉", "", null]) {
      const r = await check(m);
      expect(r.phone_check_status).toBe("unknown");
      expect(r.phone_reason).toMatch(/^CheckoutValidation rejected/);
    }
  });

  it("Status:true → ok (unchanged)", async () => {
    expect((await check(null, true)).phone_check_status).toBe("ok");
  });

  it("worker: an 'unknown' phone answer is never written (so never cached for other sellers)", async () => {
    const { sb, calls, booted } = bootWorker({ rows: [{ ...PENDING_ROW, need_store: false }], phoneVerdict: () => "unknown" });
    await booted;
    await sb.pcTick();
    expect(verdictCalls(calls)).toEqual([]);
  });
});

describe("M2 · the sender pauses only on two restricted probes in a row", () => {
  const MIN = 60_000;
  async function run(seq: string[]) {
    let t = 1_000_000_000_000;
    let i = 0;
    const boot = bootWorker({ now: () => t, rows: [], phoneVerdict: () => seq[Math.min(i++, seq.length - 1)] });
    await boot.booted;
    const pauses = () => boot.calls.fetchBodies.filter((b, k) => /admin_set_parcel_sender_health/.test(boot.calls.fetch[k]) && JSON.parse(b).p_ok === false).length;
    return { ...boot, pauses, advance: (ms: number) => { t += ms; } };
  }

  it("one restricted probe → NO pause; the confirming probe runs a minute later (not 5)", async () => {
    const w = await run(["restricted", "ok"]);
    await w.sb.pcTick();
    expect(w.pauses()).toBe(0);
    expect(w.status().multi).toBe("ok");
    expect(w.calls.logs.some((l) => /\[PC-SENDER\] probe returned 'restricted' \(1\/2\)/.test(l))).toBe(true);
    const probes = () => w.calls.sendMessage.filter((m) => m.type === "PC_CHECK_PHONE").length;
    const before = probes();
    w.advance(61_000); await w.sb.pcTick();
    expect(probes()).toBe(before + 1);   // confirmed within ~1 min
    expect(w.pauses()).toBe(0);          // …and it came back ok → never paused
  });

  it("two restricted probes in a row → paused, and the status says sender_poisoned in that same pass (not overwritten by 'ok')", async () => {
    const w = await run(["restricted", "restricted"]);
    await w.sb.pcTick();
    w.advance(61_000); await w.sb.pcTick();
    expect(w.pauses()).toBe(1);
    expect(w.status().multi).toBe("sender_poisoned");
  });

  it("restricted, ok, restricted → the strike count resets on ok (no pause)", async () => {
    const w = await run(["restricted", "ok", "restricted"]);
    await w.sb.pcTick();
    w.advance(61_000); await w.sb.pcTick();
    w.advance(6 * MIN); await w.sb.pcTick();
    expect(w.pauses()).toBe(0);
  });
});

describe("M12 · parcel_check_* settings are admin-only", () => {
  it("sql/67 replaces the select policy: other keys stay readable, parcel_check_* needs is_admin()", () => {
    expect(sql67).toContain("drop policy if exists app_settings_select on public.app_settings;");
    expect(sql67).toMatch(/create policy app_settings_select on public\.app_settings\s+for select to authenticated\s+using \(left\(key, 13\) <> 'parcel_check_' or public\.is_admin\(\)\);/);
    expect("parcel_check_".length).toBe(13);
  });

  it("no seller-side code reads a parcel_check_* key directly (they go through SECURITY DEFINER RPCs)", () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? (d.name === "__tests__" ? [] : walk(`${dir}/${d.name}`)) : /\.(ts|tsx)$/.test(d.name) ? [`${dir}/${d.name}`] : []);
    const offenders = walk("src").filter((f) => /getAppSetting\(\s*["'`]parcel_check_|from\(\s*["']app_settings["']\)[\s\S]{0,200}parcel_check_/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});

const r = (id: string, extra: Partial<ParcelScanRow>): ParcelScanRow => ({
  id, customerName: "A", phone: "0912345678", storeId: "195965", amount: 100, notes: "", status: "confirmed",
  storeCheckStatus: null, storeFullStatus: null, phoneCheckStatus: null, phoneRestrictedUntil: null,
  createdAt: new Date(1_000_000).toISOString(), ...extra,
});

describe("M3 · the 3 s badge poll backs off for old rows", () => {
  const FRESH = 3 * 60_000;
  const t0 = 1_000_000;
  it("any awaiting row younger than 3 min → 3 s", () => {
    expect(verdictPollMs([r("a", {}), r("b", { createdAt: new Date(t0 - 10 * 60_000).toISOString() })], t0 + 60_000, FRESH)).toBe(VERDICT_POLL_FAST_MS);
    expect(VERDICT_POLL_FAST_MS).toBe(3000);
  });
  it("only rows older than 3 min await → 30 s", () => {
    expect(verdictPollMs([r("a", {})], t0 + FRESH + 1, FRESH)).toBe(VERDICT_POLL_SLOW_MS);
    expect(VERDICT_POLL_SLOW_MS).toBe(30000);
  });
  it("nothing awaiting (all resolved or exported) → no poll", () => {
    expect(verdictPollMs([r("a", { phoneCheckStatus: "ok", storeFullStatus: "open" }), r("b", { status: "exported" })], t0, FRESH)).toBeNull();
    expect(verdictPollMs([], t0, FRESH)).toBeNull();
  });
  it("the screen uses the helper's cadence (no hard-coded 3000 left)", () => {
    const screen = readFileSync("src/redesign/screens/ParcelScan.tsx", "utf8");
    expect(screen).toContain("const pollMs = checkOn ? verdictPollMs(rows, nowMs, STILL_CHECKING_MS) : null;");
    expect(screen).toContain("}, pollMs);");
    expect(screen).not.toContain("}, 3000);");
  });
});

describe("M4 · every unexported row is loaded (plus the latest exported)", () => {
  it("merge: all open rows + exported tail, newest-first, de-duplicated by id", () => {
    const row = (id: string, status: string, at: number) => ({ id, status, created_at: new Date(at).toISOString(), customer_name: "", phone: "", store_id: "" });
    const open = Array.from({ length: 60 }, (_, i) => row(`o${i}`, "confirmed", 1000 + i));
    const exported = [row("e1", "exported", 5000), row("o5", "exported", 1005)]; // o5 flipped between the two reads
    const merged = mergeScanLists(open, exported);
    expect(merged).toHaveLength(61);                               // 60 open (none dropped) + e1
    expect(merged[0].id).toBe("e1");                               // newest first
    expect(merged.filter((x) => x.id === "o5")).toHaveLength(1);
    expect(merged.filter((x) => x.status !== "exported").length).toBe(60);
  });
  it("loadParcelScans reads non-exported rows paged (never capped at 50) and only the exported tail is limited", () => {
    const a = readFileSync("src/redesign/adapters/parcelScan.ts", "utf8");
    const f = a.slice(a.indexOf("export async function loadParcelScans"), a.indexOf("export function mergeScanLists"));
    expect(f).toContain('.eq("user_id", me).neq("status", "exported")');
    expect(f).toContain("fetchAllPages");
    expect(f).toContain('.eq("user_id", me).eq("status", "exported")');
    expect(f).toContain(".limit(SCANS_PAGE)");
    expect(f.indexOf(".limit(SCANS_PAGE)")).toBeGreaterThan(f.indexOf('.eq("status", "exported")'));
    expect(SCANS_PAGE).toBe(50);
  });
});

describe("M7 · 'unknown' rows count in the Wait / Export anyway prompt", () => {
  it("still-checking OR gave-up counts; resolved / exported don't", () => {
    expect(rowCheckUnresolved(r("a", {}))).toBe(true);
    expect(rowCheckUnresolved(r("a", { phoneCheckStatus: "unknown", storeFullStatus: "open" }))).toBe(true);
    expect(rowCheckUnresolved(r("a", { phoneCheckStatus: "ok", storeFullStatus: "unknown" }))).toBe(true);
    expect(rowCheckUnresolved(r("a", { phoneCheckStatus: "ok", storeFullStatus: "open" }))).toBe(false);
    expect(rowCheckUnresolved(r("a", { status: "exported", phoneCheckStatus: "unknown" }))).toBe(false);
  });
});
