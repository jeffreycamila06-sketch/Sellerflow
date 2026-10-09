// BUYER ALERT Phase 1 — pure rules, the gate, the hook's query discipline, and the sql/72
// contract. FAKE DATA ONLY: nothing here touches a real database (supabase is mocked).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderHook, act } from "@testing-library/react";

const { rpc, from } = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc, from } }));

import {
  BUYER_ALERT_PUBLIC, BUYER_ALERT_REFRESH_MS,
  buildViews, buyerAlertGate, daysLeft, loadBuyerAlertAccess, normHandle, parseLookup, taipeiDate, useBuyerAlert, viewFor,
  type BuyerRecord,
} from "../buyerAlert";

const ret = (id: string, forgiven = false) => ({ id, returned_at: "2026-09-01T03:00:00+00:00", store: "大安門市", amount: 350, forgiven });
const rec = (n: number, near: { store: string; deadline: string }[] = []): BuyerRecord =>
  ({ returned: Array.from({ length: n }, (_, i) => ({ id: `r${i}`, returnedAt: null, store: "", amount: null, forgiven: false })), near, atStore: near.length, pickedUp: 0 });
const NOW = Date.UTC(2026, 9, 4, 4, 0, 0); // 12:00 Taipei, Oct 4

beforeEach(() => { rpc.mockReset(); from.mockReset(); });

describe("handle matching — trim, lowercase, strip ONE leading @, exact", () => {
  it("normalises case, @ and spaces the same way as sql/72", () => {
    expect(normHandle("  @Maria_Shops ")).toBe("maria_shops");
    expect(normHandle("MARIA_SHOPS")).toBe("maria_shops");
    expect(normHandle("@@maria")).toBe("@maria");          // only ONE @ is stripped
    expect(normHandle(" @ maria")).toBe(" maria");          // exact: inner space kept → no fuzzy match
    expect(normHandle(null)).toBe("");
  });
  it("exact match only: a prefix / near-miss handle finds nothing", () => {
    const views = buildViews(parseLookup({ maria_shops: { returned: [ret("a"), ret("b"), ret("c")] } }), {}, NOW);
    expect(views.get(normHandle("@Maria_Shops"))?.red).toBe(true);
    expect(views.get(normHandle("@maria_shop"))).toBeUndefined();
    expect(views.get(normHandle("@maria_shops2"))).toBeUndefined();
  });
  it("parseLookup normalises keys and drops malformed entries without throwing", () => {
    const m = parseLookup({ " @Ann ": { returned: [ret("x"), { nope: 1 }], near: [{ store: "s" }], at_store: "2", picked_up: 1 }, bad: null });
    expect([...m.keys()]).toEqual(["ann"]);
    expect(m.get("ann")).toMatchObject({ returned: [{ id: "x", store: "大安門市", amount: 350 }], near: [], atStore: 2, pickedUp: 1 });
    expect(parseLookup(null).size).toBe(0);
    expect(parseLookup([1, 2]).size).toBe(0);
  });
});

describe("red threshold — 2 returns no, 3 returns yes", () => {
  it("2 → not red, 3 → red", () => {
    expect(viewFor(rec(2), {}, NOW)).toMatchObject({ returns: 2, red: false });
    expect(viewFor(rec(3), {}, NOW)).toMatchObject({ returns: 3, red: true });
  });
  it("forgive one of 3 → 2 (not red); undo → 3 (red again)", () => {
    const r = rec(3);
    expect(viewFor(r, { r1: true }, NOW)).toMatchObject({ returns: 2, red: false });
    expect(viewFor(r, { r1: false }, NOW)).toMatchObject({ returns: 3, red: true });
  });
  it("a return forgiven server-side stays forgiven until undone locally", () => {
    const m = parseLookup({ b: { returned: [ret("a"), ret("b", true), ret("c")] } });
    expect(viewFor(m.get("b")!, {}, NOW).returns).toBe(2);
    expect(viewFor(m.get("b")!, { b: false }, NOW).returns).toBe(3);
  });
});

describe("Taipei deadline math (UTC+8) at day boundaries", () => {
  const t2359 = Date.UTC(2026, 9, 3, 15, 59, 59); // 23:59:59 Taipei Oct 3 (UTC still Oct 3)
  const t0000 = Date.UTC(2026, 9, 3, 16, 0, 0);   // 00:00:00 Taipei Oct 4 (UTC still Oct 3!)
  it("the Taipei day flips at 16:00 UTC, not at UTC midnight", () => {
    expect(taipeiDate(t2359)).toBe("2026-10-03");
    expect(taipeiDate(t0000)).toBe("2026-10-04");
    expect(daysLeft("2026-10-06", t2359)).toBe(3);
    expect(daysLeft("2026-10-06", t0000)).toBe(2);
  });
  it("amber window is 0..3 days inclusive; 4 days and past deadlines don't alert", () => {
    const n = (deadline: string, now: number) => viewFor(rec(0, [{ store: "S", deadline }]), {}, now).near;
    expect(n("2026-10-07", t2359)).toBeNull();                       // 4 days at 23:59:59
    expect(n("2026-10-07", t0000)).toEqual({ days: 3, store: "S" }); // → 3 at midnight
    expect(n("2026-10-04", t0000)).toEqual({ days: 0, store: "S" }); // deadline today
    expect(n("2026-10-03", t0000)).toBeNull();                       // yesterday → gone
  });
  it("several near parcels → the soonest one is shown", () => {
    const v = viewFor(rec(0, [{ store: "Far", deadline: "2026-10-07" }, { store: "Soon", deadline: "2026-10-05" }]), {}, NOW);
    expect(v.near).toEqual({ days: 1, store: "Soon" });
  });
});

describe("gate — the server access list only (buyer_alert_can_use), fail-closed", () => {
  it("is not public in this phase; the gate is PUBLIC || serverAccess", () => {
    expect(BUYER_ALERT_PUBLIC).toBe(false);
    expect(buyerAlertGate(true)).toBe(true);
    expect(buyerAlertGate(false)).toBe(false);
  });
  it("loadBuyerAlertAccess calls the access RPC and opens only on a literal true", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    expect(await loadBuyerAlertAccess()).toBe(true);
    expect(rpc).toHaveBeenCalledWith("buyer_alert_can_use");
    for (const data of [false, null, "true", 1, {}]) {
      rpc.mockResolvedValue({ data, error: null });
      expect(await loadBuyerAlertAccess(), String(data)).toBe(false);
    }
  });
  it("an RPC error or a thrown call → false", async () => {
    rpc.mockResolvedValue({ data: true, error: { message: "boom" } });
    expect(await loadBuyerAlertAccess()).toBe(false);
    rpc.mockImplementation(() => { throw new Error("network"); });
    expect(await loadBuyerAlertAccess()).toBe(false);
  });
  it("no email rule anywhere on the client", () => {
    const src = readFileSync("src/redesign/adapters/buyerAlert.ts", "utf8");
    expect(src).not.toMatch(/startsWith\(|budgetukay/);
  });
  it("RedesignApp loads access once per signed-in user (keyed, fail-closed) and gates on it — no email", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain("void loadBuyerAlertAccess().then((on) => { if (alive) setBaAccess({ uid: pcUserId, on }); });");
    expect(src).toContain("const buyerAlertAccess = authed && !!pcUserId && baAccess?.uid === pcUserId && baAccess.on;");
    expect(src).toContain("useBuyerAlert(buyerAlertGate(buyerAlertAccess), ");
    expect(src).not.toMatch(/buyerAlertAllowed|buyerAlertGate\([^)]*email/);
  });
});

describe("useBuyerAlert — one RPC per live start + every 10 min, never per comment", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

  it("non-gated account: no RPC at all, no views", async () => {
    const { result, rerender } = renderHook(({ ok, live }) => useBuyerAlert(ok, live), { initialProps: { ok: false, live: true } });
    await flush();
    for (let i = 0; i < 20; i++) rerender({ ok: false, live: true });
    await act(async () => { vi.advanceTimersByTime(BUYER_ALERT_REFRESH_MS * 3); });
    expect(rpc).not.toHaveBeenCalled();
    expect(result.current.views).toBeUndefined();
    expect(result.current.data).toBeNull();
  });

  it("gated but not live: no RPC", async () => {
    renderHook(() => useBuyerAlert(true, false));
    await flush();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("gated + live: exactly ONE RPC regardless of re-renders (comments arriving), +1 per 10 min", async () => {
    rpc.mockResolvedValue({ data: { ann: { returned: [ret("a"), ret("b"), ret("c")] } }, error: null });
    const { result, rerender } = renderHook(({ n }) => { void n; return useBuyerAlert(true, true); }, { initialProps: { n: 0 } });
    await flush();
    for (let n = 1; n <= 200; n++) rerender({ n });          // 200 comments → still one query
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("buyer_alert_lookup");
    expect(result.current.views?.get("ann")?.red).toBe(true);
    await act(async () => { vi.advanceTimersByTime(BUYER_ALERT_REFRESH_MS - 1); });
    expect(rpc).toHaveBeenCalledTimes(1);
    await act(async () => { vi.advanceTimersByTime(1); });
    await flush();
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("forgive → insert (optimistic, count drops); undo → delete; a failed write reverts", async () => {
    rpc.mockResolvedValue({ data: { ann: { returned: [ret("a"), ret("b"), ret("c")] } }, error: null });
    const insert = vi.fn().mockResolvedValue({ error: null });
    const eq = vi.fn().mockResolvedValue({ error: null });
    from.mockReturnValue({ insert, delete: () => ({ eq }) });
    const { result } = renderHook(() => useBuyerAlert(true, true));
    await flush();
    await act(async () => { expect(await result.current.setForgiven("b", true)).toBe(true); });
    expect(from).toHaveBeenCalledWith("buyer_alert_forgive");
    expect(insert).toHaveBeenCalledWith({ parcel_tracking_id: "b" });
    expect(result.current.views?.get("ann")).toMatchObject({ returns: 2, red: false });
    await act(async () => { await result.current.setForgiven("b", false); });
    expect(eq).toHaveBeenCalledWith("parcel_tracking_id", "b");
    expect(result.current.views?.get("ann")).toMatchObject({ returns: 3, red: true });
    insert.mockResolvedValueOnce({ error: { code: "42501", message: "rls" } });
    await act(async () => { expect(await result.current.setForgiven("a", true)).toBe(false); });
    expect(result.current.views?.get("ann")).toMatchObject({ returns: 3, red: true }); // reverted
  });

  it("an RPC error leaves no alerts (no partial data)", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "boom" } });
    const { result } = renderHook(() => useBuyerAlert(true, true));
    await flush();
    expect(result.current.views).toBeUndefined();
  });
});

describe("sql/72 contract", () => {
  const sql = readFileSync(resolve(__dirname, "../../../../sql/72_buyer_alert.sql"), "utf8");
  const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n").toLowerCase();
  it("SECURITY DEFINER with a pinned search_path, execute for authenticated only", () => {
    expect(code).toContain("security definer");
    expect(code).toContain("set search_path to 'public'");
    expect(code).toContain("revoke all on function public.buyer_alert_lookup() from public, anon");
    expect(code).toContain("grant execute on function public.buyer_alert_lookup() to authenticated");
  });
  it("server-side gate = the access list via buyer_alert_can_use(), otherwise {}", () => {
    expect(code).toContain("if not public.buyer_alert_can_use() then");
    expect(code).toMatch(/v_public\s+constant boolean := false/);
  });
  it("the email-prefix gate is gone (seller_profiles.email is user-chosen)", () => {
    expect(code).not.toContain("budgetukay");
    expect(code).not.toContain("v_email");
    expect(code).not.toMatch(/email[^\n]*like/);
  });
  it("access table: RLS on, revoked from anon + authenticated; can_use = admin or an enabled own row", () => {
    expect(code).toContain("user_id    uuid primary key references auth.users(id) on delete cascade");
    expect(code).toContain("alter table public.buyer_alert_access enable row level security");
    expect(code).toContain("revoke all on public.buyer_alert_access from anon, authenticated");
    expect(code).toMatch(/select public\.is_admin\(\)\s+or exists \(select 1 from public\.buyer_alert_access a\s+where a\.user_id = auth\.uid\(\) and a\.enabled\)/);
    expect(code).toContain("revoke all on function public.buyer_alert_can_use() from public, anon");
    expect(code).toContain("grant execute on function public.buyer_alert_can_use() to authenticated");
  });
  it("no DROP statements", () => { expect(code).not.toMatch(/\bdrop\b/); });
  it("test-phase data owner (server-side only — Build 10b took the email out of the app); explicit owner filter", () => {
    expect(code).toContain("'googletest@gmail.com'");
    expect(code).toContain("where t.user_id = v_owner");
  });
  it("never returns phone numbers or recipient names", () => {
    expect(code).not.toContain("recipient_phone");
    expect(code).not.toContain("recipient_name");
  });
  it("same handle normalisation as the client; Taipei today; 0..3 day window", () => {
    expect(code).toContain("lower(regexp_replace(btrim(t.buyer_username), '^@', ''))");
    expect(code).toContain("(now() at time zone 'asia/taipei')::date");
    expect(code).toContain("between 0 and 3");
  });
  it("forgive table: own-scoped RLS, FK to parcel_tracking ON DELETE CASCADE, no change to existing tables", () => {
    expect(code).toContain("references public.parcel_tracking(id) on delete cascade");
    expect(code).toContain("alter table public.buyer_alert_forgive enable row level security");
    for (const op of ["select", "insert", "update", "delete"]) expect(code).toContain(`buyer_alert_forgive_${op}`);
    expect(code).not.toMatch(/alter table public\.parcel_tracking\b/);
  });
});
