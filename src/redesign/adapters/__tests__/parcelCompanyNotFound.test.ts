// E-Map 'company' / 'not_found' store answers (extension 1.14.8 + sql/68).
// byIDData "…+close+…" = a closed-area store inside a factory/park (a valid store
// with no open/full info) → 'company'; "NO2" = no such store → 'not_found'.
// Parser tests with the real captured strings live in parcelCheckerEmap.test.ts;
// the screen in ParcelScan.extchecks.test.tsx.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { bootWorker, PENDING_ROW } from "./parcelCheckerHarness";
import {
  splitScansForExport, rowAwaitsVerdict, rowCheckUnresolved, verdictPollMs, storeClear, wrongStoreCode,
  type ParcelScanRow,
} from "../parcelScan";

const verdictBodies = (calls: { fetch: string[]; fetchBodies: string[] }) =>
  calls.fetch.map((u, i) => ({ u, b: calls.fetchBodies[i] })).filter((x) => /admin_parcel_check_verdict/.test(x.u)).map((x) => JSON.parse(x.b));

describe("worker · company / not_found are real store verdicts", () => {
  it.each(["company", "not_found"])("'%s' is written to the verdict RPC and counts as E-Map evidence (green)", async (v) => {
    const { sb, calls, status, booted } = bootWorker({ rows: [{ ...PENDING_ROW, need_phone: false }], storeVerdict: () => v });
    await booted;
    await sb.pcTick();
    const bodies = verdictBodies(calls);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].p_store_full_status).toBe(v);
    expect(bodies[0].p_expected_store).toBe("195965");
    expect(status().emap).toBe("ok");
  });

  it("a row that failed first and then resolves to 'company' resets its backoff (no give-up)", async () => {
    let t = 1_000_000_000_000;
    const seq = ["unknown", "company"];
    let i = 0;
    const { sb, calls, booted } = bootWorker({ now: () => t, rows: [{ ...PENDING_ROW, need_phone: false }], storeVerdict: () => seq[Math.min(i++, seq.length - 1)] });
    await booted;
    await sb.pcTick();
    t += 10 * 60_000; await sb.pcTick();
    expect(calls.logs.some((l) => /\[PC-BACKOFF\] row=row-1 store resolved/.test(l))).toBe(true);
    expect(verdictBodies(calls).map((b) => b.p_store_full_status)).toEqual(["company"]);
  });

  it("keepalive: 'company' proves the session alive; 'not_found' for the known-good keepalive store is a MISS", async () => {
    const alive = bootWorker({ rows: [], storeVerdict: () => "company" });
    await alive.booted;
    await alive.sb.pcTick();
    expect(alive.calls.logs.some((l) => /\[PC-KEEPALIVE\].*verdict=company .*sessionAlive=true/.test(l))).toBe(true);
    const nf = bootWorker({ rows: [], storeVerdict: () => "not_found" });
    await nf.booted;
    await nf.sb.pcTick();
    expect(nf.calls.logs.some((l) => /\[PC-KEEPALIVE\].*verdict=not_found .*sessionAlive=false/.test(l))).toBe(true);
  });

  it("the verdict set is defined once and used by both lanes + keepalive", () => {
    const bg = readFileSync("chrome-extension/background.js", "utf8");
    expect(bg).toContain('const PC_STORE_VERDICTS = ["open", "full", "company", "not_found"];');
    expect(bg).not.toMatch(/=== "open" \|\| [a-zA-Z.]+ === "full"/);
    expect(bg.split("pcIsStoreVerdict(").length - 1).toBe(4); // definition + legacy lane + multi lane + keepalive
    expect(bg).toContain('const alive = pcIsStoreVerdict(verdict) && verdict !== "not_found";');
    const m = JSON.parse(readFileSync("chrome-extension/manifest.json", "utf8"));
    expect(m.version).toBe("1.16.0");
  });
});

describe("sql/68", () => {
  const sql = readFileSync("sql/68_parcel_check_company_notfound.sql", "utf8");
  const fn = (name: string) => { const i = sql.indexOf(`function public.${name}(`); return sql.slice(i, sql.indexOf("$$;", i)); };

  it("both cache tables accept the two new values (idempotent constraint swap)", () => {
    for (const t of ["store_check_cache", "store_check_log"]) {
      expect(sql).toContain(`alter table public.${t} drop constraint if exists ${t}_status_check;`);
      expect(sql).toMatch(new RegExp(`alter table public\\.${t} add constraint ${t}_status_check\\s+check \\(status in \\('open','full','company','not_found'\\)\\);`));
    }
  });

  it("verdict: accepts company/not_found, caches + logs them, 'unknown' never overwrites them; still 7 args (1.14.6/1.14.7 compatible)", () => {
    const f = fn("admin_parcel_check_verdict");
    expect(f).toContain("p_expected_phone text default null, p_expected_store text default null)");
    expect(f).toContain("not in ('open','full','company','not_found','unknown')");
    expect(f.split("store_full_status in ('open','full','company','not_found') then").length - 1).toBe(2);
    expect(f).toContain("if p_store_full_status in ('open','full','company','not_found') and coalesce(v_store_key, '') <> '' then");
    expect(f).toContain("insert into store_check_log(store_id, status, checked_at) values (v_store_key, p_store_full_status, now());");
    expect(sql).not.toContain("drop function");
  });

  it("pending: company/not_found cache reused for 24 h; the hourly recheck is still FULL-only", () => {
    const f = fn("admin_parcel_checks_pending");
    expect(f).toContain("v_store_fixed_ttl constant interval := interval '24 hours';");
    expect(f).toContain("or (c.status in ('company','not_found') and c.checked_at > now() - v_store_fixed_ttl) )");
    expect(f).toContain("and ps.store_full_status = 'full'\n       and ps.store_full_at < now() - v_store_full_ttl");
  });

  it("Recheck trigger clears the cache for all four store verdicts", () => {
    expect(fn("parcel_scans_recheck_clears_store_cache")).toContain("if old.store_full_status in ('open','full','company','not_found') and new.store_full_status is null");
  });
});

const row = (over: Partial<ParcelScanRow>): ParcelScanRow => ({
  id: "r", customerName: "王小明", phone: "0912345678", storeId: "180849", amount: 500, notes: "", status: "confirmed",
  storeCheckStatus: "valid", storeFullStatus: null, phoneCheckStatus: "ok", phoneRestrictedUntil: null,
  createdAt: new Date(0).toISOString(), ...over,
});

describe("app adapters", () => {
  it("company counts like open; not_found is the wrong-store-code case", () => {
    expect(storeClear("open")).toBe(true);
    expect(storeClear("company")).toBe(true);
    for (const s of ["full", "not_found", "unknown", null]) expect(storeClear(s)).toBe(false);
    expect(wrongStoreCode({ storeFullStatus: "not_found" })).toBe(true);
    expect(wrongStoreCode({ storeCheckStatus: "not_found" })).toBe(true);
    expect(wrongStoreCode({ storeFullStatus: "company" })).toBe(false);
  });

  it("export: company → ready; not_found → excluded as wrong_store (same as the encode-time wrong code)", () => {
    const { ready, attention } = splitScansForExport([
      row({ id: "c", storeFullStatus: "company" }),
      row({ id: "n", storeFullStatus: "not_found" }),
      row({ id: "w", storeCheckStatus: "not_found", storeFullStatus: "open" }),
    ], 38);
    expect(ready.map((r) => r.id)).toEqual(["c"]);
    expect(attention.map((a) => [a.row.id, a.reason])).toEqual([["n", "wrong_store"], ["w", "wrong_store"]]);
  });

  it("neither is 'still checking': not awaited, not in the Wait/Export prompt, no badge poll", () => {
    for (const s of ["company", "not_found"]) {
      const r = row({ storeFullStatus: s });
      expect(rowAwaitsVerdict(r)).toBe(false);
      expect(rowCheckUnresolved(r)).toBe(false);
      expect(verdictPollMs([r], 0, 180_000)).toBeNull();
    }
  });
});
