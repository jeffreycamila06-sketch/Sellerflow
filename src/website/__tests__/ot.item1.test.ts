// Order tracking — item 1: the parcel state reaches the order page / the seller only as the six allowed fields.
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { cleanParcel } from "../parcelView";
import { toOrderView } from "../orderApi";

describe("cleanParcel (what the app keeps)", () => {
  it("the four states, the six fields; anything else dropped", () => {
    expect(cleanParcel({ state: "at_store", arrivedAt: "2026-11-19T01:30:00+00:00", deadline: "2026-11-26", checkedAt: "2026-11-19T01:40:00+00:00", recipient_name: "X", buyer_username: "y", rec_store: "z", recipient_phone: "0999" }))
      .toEqual({ state: "at_store", arrivedAt: "2026-11-19T01:30:00+00:00", deadline: "2026-11-26", checkedAt: "2026-11-19T01:40:00+00:00" });
    for (const s of ["in_transit", "at_store", "picked_up", "returned"]) expect(cleanParcel({ state: s })?.state).toBe(s);
  });
  it("no parcel, another state or odd data → nothing (the page stays as today)", () => {
    for (const x of [undefined, null, "at_store", [], {}, { state: "not_found" }, { state: "created" }, { state: "unknown" }, { state: "AT_STORE" }]) expect(cleanParcel(x)).toBeUndefined();
    expect(cleanParcel({ state: "returned", returnedAt: "nope", deadline: "26/11" })).toEqual({ state: "returned" });
  });
  it("the order page: parcel only from the answer's parcel key", () => {
    const base = { found: true, orderNo: "W-0001", status: "shipped", items: [], subtotal: 80, shipFee: 60, total: 140, delivery: "s711", payment: "cod", buyerName: "M", phoneTail: "678", createdAt: "2026-11-16T00:00:00Z", tracking: "F12345678901" };
    expect(toOrderView(base)!.parcel).toBeUndefined();
    expect(toOrderView({ ...base, parcel: { state: "in_transit", checkedAt: "2026-11-18T01:00:00Z", recipient_name: "X" } })!.parcel).toEqual({ state: "in_transit", checkedAt: "2026-11-18T01:00:00Z" });
  });
});

describe("the seller side loader", () => {
  it("one RPC (website_my_parcels), a map by order id; any error → empty (screen as before)", async () => {
    vi.resetModules();
    const rpc = vi.fn(async () => ({ data: [{ id: "o1", parcel: { state: "at_store", deadline: "2026-11-26", recipient_name: "X" } }, { id: "o2", parcel: { state: "nope" } }, { id: 3, parcel: { state: "at_store" } }], error: null }));
    vi.doMock("../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc } }));
    const { loadWebsiteParcels } = await import("../../redesign/adapters/websiteSeller");
    const m = await loadWebsiteParcels();
    expect(rpc).toHaveBeenCalledWith("website_my_parcels");
    expect([...m.entries()]).toEqual([["o1", { state: "at_store", deadline: "2026-11-26" }]]);
    rpc.mockImplementationOnce(async () => ({ data: null, error: { message: "function does not exist" } }) as never);
    expect((await loadWebsiteParcels()).size).toBe(0);
    vi.doUnmock("../../supabase");
  });
});

describe("sql/171 (the database side; full proof: scripts/sql171-behaviour.mjs)", () => {
  const up = readFileSync("sql/171_website_parcel_tracking.sql", "utf8");
  it("the matching rule as approved", () => {
    expect(up).toContain("select upper(regexp_replace(coalesce(p, ''), '[[:space:]-]', '', 'g'));");
    expect(up).toContain("where pt.user_id = p_user and pt.carrier = c and public.website_parcel_norm(pt.tracking_no) = t;");
    expect(up).toContain("c := case p_delivery when 's711' then '711' else 'fm' end;");
    expect(up).toContain("if n <> 1 then return null; end if;");
    expect(up).toContain("not in ('in_transit', 'at_store', 'picked_up', 'returned') then return null;");
    expect(up).toContain("'state', r.status, 'arrivedAt', r.arrived_at, 'deadline', r.pickup_deadline,\n    'pickedUpAt', r.picked_up_at, 'returnedAt', r.returned_at, 'checkedAt', r.last_polled_at));");
  });
  it("who may call what", () => {
    expect(up).toContain("revoke all on function public.website_parcel_for(uuid, text, text, text) from public, anon, authenticated;");
    expect(up).toContain("revoke all on function public.website_my_parcels() from public, anon;");
    expect(up).toContain("if me is null then raise exception 'not_signed_in'");
    expect(up).toContain("where o.user_id = me and o.status = 'shipped' and o.delivery in ('s711', 'fm')) x");
    expect(up).not.toMatch(/\b(insert|update|delete)\b[^;]*parcel_tracking/i);
  });
  it("website_order = sql/167's text + the one parcel line; the rollback = sql/167's text", () => {
    const fn = (s: string) => s.slice(s.indexOf("create or replace function public.website_order(p_token text)"), s.indexOf("grant execute on function public.website_order(text) to anon, authenticated;"));
    const s167 = fn(readFileSync("sql/167_seller_website_v2.sql", "utf8"));
    expect(fn(up).replace("    -- sql/171: the parcel's state from Pickup Status (same seller, same chain, same number); absent = no match\n    'parcel', public.website_parcel_for(o.user_id, o.delivery, o.status, o.tracking_no),\n", "")).toBe(s167);
    expect(fn(readFileSync("sql/171_website_parcel_tracking_rollback.sql", "utf8"))).toBe(s167);
  });
});
