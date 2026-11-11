// Scan QR → look the scanned @username up in Customers (Jeff 2026-11-11, sql/149).
// The match rule (pure), the one read it makes (shape, own rows only, time limit), and what the
// form shows. The Supabase client is a recording fake — no network.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";

const h = vi.hoisted(() => ({
  calls: [] as { table: string; select: string; eq: [string, unknown][]; or: string[]; order: unknown[]; limit: number | null; aborted: boolean }[],
  data: [] as Record<string, unknown>[],
  error: null as unknown,
  session: { user: { id: "me-1" } } as { user: { id: string } } | null,
  hold: null as null | Promise<void>,
  configured: true,
}));
vi.mock("../../../supabase", () => {
  const from = (table: string) => {
    const c = { table, select: "", eq: [] as [string, unknown][], or: [] as string[], order: [] as unknown[], limit: null as number | null, aborted: false };
    h.calls.push(c);
    const q = {
      select(s: string) { c.select = s; return q; },
      eq(k: string, v: unknown) { c.eq.push([k, v]); return q; },
      or(f: string) { c.or.push(f); return q; },
      order(...a: unknown[]) { c.order = a; return q; },
      limit(n: number) { c.limit = n; return q; },
      abortSignal(sig: AbortSignal) { sig.addEventListener("abort", () => { c.aborted = true; }); return q; },
      then(res: (v: { data: unknown; error: unknown }) => unknown, rej?: (e: unknown) => unknown) {
        return (h.hold ?? Promise.resolve()).then(() => ({ data: h.data, error: h.error })).then(res, rej);
      },
    };
    return q;
  };
  return {
    get isSupabaseConfigured() { return h.configured; },
    supabase: { from, auth: { getSession: async () => ({ data: { session: h.session } }) } },
  };
});

import {
  isLookupable, lookupCustomersByHandle, lookupDate, lookupDiffers, lookupKey, lookupView, matchLookupRows, scanQrLookupVisible,
  untouchedFilled, SCAN_QR_LOOKUP_LIMIT, SCAN_QR_LOOKUP_TIMEOUT_MS, type ScanQrLookupMark, type ScanQrLookupRaw,
} from "../scanQrLookup";

const raw = (id: string, username: string, extra: Partial<ScanQrLookupRaw> = {}): ScanQrLookupRaw => ({
  id, name: `Name ${id}`, phone: "0912345678", storeId: "123456", updatedAt: "2026-11-01T00:00:00+00:00", username, platform: null, ...extra,
});
const db = (id: string, username: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: "me-1", name: `Name ${id}`, phone: "0912345678", store_id: "123456", updated_at: "2026-11-01T00:00:00+00:00",
  notes: username, buyer_username: username, contact_platform: null, ...extra,
});

beforeEach(() => { h.calls.length = 0; h.data = []; h.error = null; h.session = { user: { id: "me-1" } }; h.hold = null; h.configured = true; });
afterEach(() => { vi.useRealTimers(); });

describe("the match rule — EXACT username only", () => {
  it("key: trim, ONE leading @, lower case", () => {
    expect(lookupKey("  @Maria_Shops ")).toBe("maria_shops");
    expect(lookupKey("Maria_Shops")).toBe("maria_shops");
    expect(lookupKey("@@x")).toBe("@x"); // only one @ is dropped
    expect(lookupKey(null)).toBe("");
  });
  it("only a username-shaped key is looked up; 'unknown' and blank never", () => {
    expect(isLookupable("maria_shops")).toBe(true);
    expect(isLookupable("a.b_c9")).toBe(true);
    expect(isLookupable("")).toBe(false);
    expect(isLookupable("unknown")).toBe(false);
    expect(isLookupable("maria shops")).toBe(false);
    expect(isLookupable("a,b")).toBe(false);
    expect(isLookupable("a)b")).toBe(false);
    expect(isLookupable("x".repeat(51))).toBe(false);
  });
  it("with / without @ and any letter case match", () => {
    const rows = [raw("1", "Maria_Shops"), raw("2", "@maria_shops"), raw("3", "MARIA_SHOPS")];
    expect(matchLookupRows(rows, "maria_shops").map((r) => r.id).sort()).toEqual(["1", "2", "3"]);
  });
  it("@pedro123 never matches @pedro12, and @pedro12 never matches @pedro123", () => {
    const rows = [raw("a", "pedro123"), raw("b", "@pedro12")];
    expect(matchLookupRows(rows, "pedro123").map((r) => r.id)).toEqual(["a"]);
    expect(matchLookupRows(rows, "pedro12").map((r) => r.id)).toEqual(["b"]);
  });
  it("'_' and '.' are ordinary characters: maria_shops ≠ mariaXshops, a.b ≠ aXb, a_b ≠ a.b", () => {
    const rows = [raw("1", "mariaXshops"), raw("2", "maria.shops"), raw("3", "maria_shops2"), raw("4", "xmaria_shops")];
    expect(matchLookupRows(rows, "maria_shops")).toEqual([]);
    expect(matchLookupRows([raw("5", "aXb"), raw("6", "a_b")], "a.b")).toEqual([]);
    expect(matchLookupRows([raw("7", "a.b")], "a.b").map((r) => r.id)).toEqual(["7"]);
    expect(matchLookupRows([raw("8", "_._")], "_._").map((r) => r.id)).toEqual(["8"]);
  });
  it("TikTok or no app only — any other app never matches", () => {
    const rows = [raw("n", "x1"), raw("e", "x1", { platform: "" }), raw("t", "x1", { platform: "tiktok" }), raw("T", "x1", { platform: "TikTok" }),
      raw("l", "x1", { platform: "line" }), raw("w", "x1", { platform: "whatsapp" }), raw("f", "x1", { platform: "facebook" }), raw("i", "x1", { platform: "instagram" }), raw("o", "x1", { platform: "other" })];
    expect(matchLookupRows(rows, "x1").map((r) => r.id).sort()).toEqual(["T", "e", "n", "t"]);
  });
  it("'unknown' and blank are never matched, even when a record holds them", () => {
    expect(matchLookupRows([raw("1", "unknown"), raw("2", "@Unknown")], "unknown")).toEqual([]);
    expect(matchLookupRows([raw("1", ""), raw("2", "@")], "")).toEqual([]);
  });
  it("newest 'last updated' first; same time keeps a fixed order", () => {
    const rows = [raw("old", "x1", { updatedAt: "2026-09-01T00:00:00+00:00" }), raw("new", "x1", { updatedAt: "2026-11-10T00:00:00+00:00" }), raw("b", "x1", { updatedAt: "2026-10-01T00:00:00+00:00" }), raw("a", "x1", { updatedAt: "2026-10-01T00:00:00+00:00" })];
    expect(matchLookupRows(rows, "x1").map((r) => r.id)).toEqual(["new", "a", "b", "old"]);
  });
  it("what differs between the records: store first, then phone, else only the name", () => {
    const r = (id: string, phone: string, storeId: string) => ({ id, name: id, phone, storeId, updatedAt: "" });
    expect(lookupDiffers([r("1", "0911", "111111"), r("2", "0922", "222222")])).toBe("store");
    expect(lookupDiffers([r("1", "0911", "111111"), r("2", "0922", "111111")])).toBe("phone");
    expect(lookupDiffers([r("1", "0911", "111111"), r("2", "0911", "111111")])).toBe("name");
  });
});

describe("the read — one per scan, this screen's table, own rows only", () => {
  it("7-11 reads parcel_customers.notes; FamilyMart reads fm_parcel_customers.buyer_username — never the other", async () => {
    h.data = [db("1", "Maria_Shops")];
    const a = await lookupCustomersByHandle("711", "@Maria_Shops");
    expect(a).toEqual({ ok: true, more: false, rows: [{ id: "1", name: "Name 1", phone: "0912345678", storeId: "123456", updatedAt: "2026-11-01T00:00:00+00:00" }] });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].table).toBe("parcel_customers");
    expect(h.calls[0].select).toBe("id, user_id, phone, name, store_id, notes, contact_platform, updated_at");
    expect(h.calls[0].eq).toEqual([["user_id", "me-1"]]); // explicit own-rows filter, on top of the database rule
    expect(h.calls[0].or).toEqual(["notes.ilike.maria_shops,notes.ilike.@maria_shops"]);
    expect(h.calls[0].order).toEqual(["updated_at", { ascending: false }]);
    expect(h.calls[0].limit).toBe(SCAN_QR_LOOKUP_LIMIT);
    h.calls.length = 0;
    await lookupCustomersByHandle("fm", "maria_shops");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].table).toBe("fm_parcel_customers");
    expect(h.calls[0].or).toEqual(["buyer_username.ilike.maria_shops,buyer_username.ilike.@maria_shops"]);
    expect(h.calls[0].eq).toEqual([["user_id", "me-1"]]);
  });
  it("the app makes the final check: near-names, other apps, 'unknown' and ANOTHER seller's rows are dropped even if the database returned them", async () => {
    h.data = [db("ok", "@maria_shops"), db("near", "mariaXshops"), db("longer", "maria_shops2"), db("line", "maria_shops", { contact_platform: "line" }), db("other-seller", "maria_shops", { user_id: "someone-else" })];
    const r = await lookupCustomersByHandle("711", "maria_shops");
    expect(r.ok && r.rows.map((x) => x.id)).toEqual(["ok"]);
  });
  it("pedro123 ↔ pedro12 through the read, both ways", async () => {
    h.data = [db("a", "pedro123"), db("b", "pedro12")];
    const r1 = await lookupCustomersByHandle("711", "pedro123");
    const r2 = await lookupCustomersByHandle("711", "pedro12");
    expect(r1.ok && r1.rows.map((x) => x.id)).toEqual(["a"]);
    expect(r2.ok && r2.rows.map((x) => x.id)).toEqual(["b"]);
  });
  it("every record of the username comes back, newest first (2+ = the seller picks)", async () => {
    h.data = [db("1", "x1", { updated_at: "2026-09-01T00:00:00+00:00" }), db("2", "@X1", { updated_at: "2026-11-01T00:00:00+00:00" }), db("3", "x1", { updated_at: "2026-10-01T00:00:00+00:00" })];
    const r = await lookupCustomersByHandle("711", "x1");
    expect(r.ok && r.rows.map((x) => x.id)).toEqual(["2", "3", "1"]);
  });
  it("'unknown', blank and anything not username-shaped: NO read at all", async () => {
    for (const v of ["unknown", "@Unknown", "", "  ", "maria shops", "a,b.ilike.%", "x)"]) {
      expect(await lookupCustomersByHandle("711", v)).toEqual({ ok: true, rows: [], more: false });
    }
    expect(h.calls).toHaveLength(0);
  });
  it("not signed in / no client / database error → ok:false (never 'no record')", async () => {
    h.session = null;
    expect(await lookupCustomersByHandle("711", "x1")).toEqual({ ok: false });
    expect(h.calls).toHaveLength(0);
    h.session = { user: { id: "me-1" } }; h.error = { message: "boom" };
    expect(await lookupCustomersByHandle("711", "x1")).toEqual({ ok: false });
    h.error = null; h.configured = false; h.calls.length = 0;
    expect(await lookupCustomersByHandle("711", "x1")).toEqual({ ok: false });
    expect(h.calls).toHaveLength(0);
  });
  it("slower than 4 s → ok:false, the request is stopped, and the late answer changes nothing", async () => {
    vi.useFakeTimers();
    let release: () => void = () => {};
    h.hold = new Promise<void>((r) => { release = r; });
    h.data = [db("1", "x1")];
    const p = lookupCustomersByHandle("711", "x1");
    await vi.advanceTimersByTimeAsync(SCAN_QR_LOOKUP_TIMEOUT_MS - 1);
    let done = false; void p.then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await p).toEqual({ ok: false });
    expect(h.calls[0].aborted).toBe(true);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(await p).toEqual({ ok: false });
    expect(SCAN_QR_LOOKUP_TIMEOUT_MS).toBe(4000);
  });
  it("a full page with no exact record in it = 'could not look up' (never a false 'none'); a full page with records says there may be more", async () => {
    h.data = Array.from({ length: SCAN_QR_LOOKUP_LIMIT }, (_, i) => db(`n${i}`, "aXb"));
    expect(await lookupCustomersByHandle("711", "a_b")).toEqual({ ok: false });
    h.data = [db("hit", "a_b"), ...Array.from({ length: SCAN_QR_LOOKUP_LIMIT - 1 }, (_, i) => db(`n${i}`, "aXb"))];
    const r = await lookupCustomersByHandle("711", "a_b");
    expect(r.ok && r.more).toBe(true);
    expect(r.ok && r.rows.map((x) => x.id)).toEqual(["hit"]);
  });
  it("the adapter reads only — no insert / update / delete / rpc anywhere in it", () => {
    const src = readFileSync("src/redesign/adapters/scanQrLookup.ts", "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(src.match(/\.from\(/g)).toHaveLength(1);
  });
});

describe("what the form shows", () => {
  const row = (id: string, storeId = "123456") => ({ id, name: `N${id}`, phone: "0912345678", storeId, updatedAt: "2026-11-01T00:00:00+00:00" });
  it("nothing without a mark", () => {
    expect(lookupView(null, "x1")).toEqual({ kind: "none" });
    expect(lookupView({ applied: null, pending: null }, "x1")).toEqual({ kind: "none" });
  });
  it("found while the field still holds that username (any case, with @); a warning once it holds another", () => {
    const m: ScanQrLookupMark = { applied: { handle: "x1", updatedAt: "2026-11-01T00:00:00+00:00", filled: { name: "A", phone: "1", store: "2" } }, pending: null };
    expect(lookupView(m, "@X1")).toEqual({ kind: "found", handle: "x1", updatedAt: "2026-11-01T00:00:00+00:00" });
    expect(lookupView(m, "x2")).toEqual({ kind: "mismatch", handle: "x1" });
    expect(lookupView(m, "")).toEqual({ kind: "mismatch", handle: "x1" });
  });
  it("one waiting record = a suggestion; 2+ = always a list; both only for the username in the field", () => {
    expect(lookupView({ applied: null, pending: { handle: "x1", rows: [row("1")], more: false } }, "x1")).toMatchObject({ kind: "suggest", handle: "x1" });
    const many = lookupView({ applied: null, pending: { handle: "x1", rows: [row("1", "111111"), row("2", "222222")], more: false } }, "x1");
    expect(many).toMatchObject({ kind: "choose", differs: "store", more: false });
    expect(many.kind === "choose" && many.rows.map((r) => r.id)).toEqual(["1", "2"]);
    expect(lookupView({ applied: null, pending: { handle: "x1", rows: [row("1"), row("2")], more: false } }, "other")).toEqual({ kind: "none" });
  });
  it("a waiting record for B while the form still holds details of A: the view carries 'from A'", () => {
    const applied = { handle: "a", updatedAt: "", filled: { name: "A", phone: "1", store: "2" } };
    expect(lookupView({ applied, pending: { handle: "b", rows: [row("1")], more: false } }, "b")).toMatchObject({ kind: "suggest", handle: "b", from: "a" });
    expect(lookupView({ applied, pending: { handle: "b", rows: [row("1"), row("2")], more: false } }, "b")).toMatchObject({ kind: "choose", from: "a" });
    expect(lookupView({ applied: null, pending: { handle: "b", rows: [row("1")], more: false } }, "b")).toMatchObject({ kind: "suggest", from: null });
    expect(lookupView({ applied: { ...applied, handle: "b" }, pending: { handle: "b", rows: [row("1")], more: false } }, "b")).toMatchObject({ from: null });
  });
  it("'could not check' shows only for the username it was about, and never over a box", () => {
    expect(lookupView(null, "@X1", "x1")).toEqual({ kind: "failed" });
    expect(lookupView(null, "x2", "x1")).toEqual({ kind: "none" });
    expect(lookupView(null, "", "")).toEqual({ kind: "none" });
    const applied = { handle: "x1", updatedAt: "", filled: { name: "A", phone: "1", store: "2" } };
    expect(lookupView({ applied, pending: null }, "x1", "x1")).toMatchObject({ kind: "found" });
  });
  it("the details a new scan must blank = written by the lookup and not touched since", () => {
    const applied = { handle: "a", updatedAt: "", filled: { name: "Ana", phone: "0911", store: "111111" } };
    expect(untouchedFilled(applied, { name: "Ana", phone: "0911", store: "111111" })).toEqual({ name: "", phone: "", store: "" });
    expect(untouchedFilled(applied, { name: "Ana Cruz", phone: "0911", store: "222222" })).toEqual({ phone: "" });
    expect(untouchedFilled(null, { name: "Ana", phone: "0911", store: "111111" })).toEqual({});
  });
  it("on = the switch OR this login on the list; off and not listed = off (no admin bypass)", () => {
    expect(scanQrLookupVisible({ switchOn: false, previewKey: false })).toBe(false);
    expect(scanQrLookupVisible({ switchOn: true, previewKey: false })).toBe(true);
    expect(scanQrLookupVisible({ switchOn: false, previewKey: true })).toBe(true);
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain('const scanQrLookupOn = scanQrLookupVisible({ switchOn: featureSw.scanQrLookup, previewKey: hasFeature("scan_qr_lookup") });');
  });
  it("the date is the Taipei day, in the app language; unreadable → blank", () => {
    expect(lookupDate("2026-11-10T17:30:00+00:00", "en")).toBe("Nov 11, 2026"); // 01:30 on the 11th in Taipei
    expect(lookupDate("2026-11-10T15:30:00+00:00", "en")).toBe("Nov 10, 2026");
    for (const l of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) expect(lookupDate("2026-11-10T17:30:00+00:00", l)).toMatch(/11/);
    expect(lookupDate("", "en")).toBe("");
    expect(lookupDate("not a date", "en")).toBe("");
  });
});

describe("sql/149 — the switch and the per-account key (written, NOT applied)", () => {
  const up = readFileSync("sql/149_scan_qr_lookup.sql", "utf8");
  const down = readFileSync("sql/149_scan_qr_lookup_rollback.sql", "utf8");
  it("seeds the switch OFF and adds the key; nothing else (no schema change)", () => {
    expect(up).toContain("insert into public.app_settings (key, value) values ('scan_qr_lookup_enabled', 'false')\non conflict (key) do nothing;");
    expect(up).toContain("('sticker_all_scripts'), ('scan_qr_lookup')");
    const code = up.replace(/^\s*--.*$/gm, "");
    expect(code).not.toMatch(/\b(create table|alter table|create index|create trigger|create policy|drop )\b/i);
    expect(code).not.toMatch(/feature_access_emails \(feature, email/i); // no account is listed by the file itself
    expect(up).not.toMatch(/[a-z0-9._-]+@[a-z0-9-]+\.[a-z]{2,}/i); // no email address in the file
  });
  it("the rollback removes the row, the listed accounts and the key", () => {
    expect(down).toContain("delete from public.app_settings where key = 'scan_qr_lookup_enabled';");
    expect(down).toContain("delete from public.feature_access_emails where feature = 'scan_qr_lookup';");
    expect(down.replace(/^\s*--.*$/gm, "")).not.toContain("scan_qr_lookup')");
  });
});
