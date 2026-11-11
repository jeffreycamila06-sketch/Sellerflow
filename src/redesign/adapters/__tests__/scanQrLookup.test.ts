// Scan QR → fill from Customers (Jeff 2026-11-12, sql/149).
// Which records belong to a username (rule #4), the one read it makes (shape, own rows only, time
// limit), and which record is used (the newest — none when the records have 3+ different phones).
// The Supabase client is a recording fake — no network.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";

const h = vi.hoisted(() => ({
  calls: [] as { table: string; select: string; eq: [string, unknown][]; or: string[]; order: unknown[][]; limit: number | null; aborted: boolean }[],
  data: [] as Record<string, unknown>[],
  error: null as unknown,
  session: { user: { id: "me-1" } } as { user: { id: string } } | null,
  hold: null as null | Promise<void>,
  configured: true,
}));
vi.mock("../../../supabase", () => {
  const from = (table: string) => {
    const c = { table, select: "", eq: [] as [string, unknown][], or: [] as string[], order: [] as unknown[][], limit: null as number | null, aborted: false };
    h.calls.push(c);
    const q = {
      select(s: string) { c.select = s; return q; },
      eq(k: string, v: unknown) { c.eq.push([k, v]); return q; },
      or(f: string) { c.or.push(f); return q; },
      order(...a: unknown[]) { c.order.push(a); return q; },
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
  distinctPhones, isLookupable, lookupCustomersByHandle, lookupFilter, lookupKey, matchLookupRows, recordToFill, scanQrLookupVisible, untouchedFilled, usernameKeyOf,
  SCAN_QR_LOOKUP_LIMIT, SCAN_QR_LOOKUP_TIMEOUT_MS, SCAN_QR_SHARED_PHONES, type ScanQrLookupRaw,
} from "../scanQrLookup";

const FIXTURES = JSON.parse(readFileSync("src/redesign/adapters/__tests__/fixtures/scanQrUsernameKey.json", "utf8")) as { cases: { text: string; key: string; why: string }[] };

const raw = (id: string, username: string, extra: Partial<ScanQrLookupRaw> = {}): ScanQrLookupRaw => ({
  id, name: `Name ${id}`, phone: "0912345678", storeId: "123456", updatedAt: "2026-11-01T00:00:00+00:00", username, platform: null, ...extra,
});
const db = (id: string, username: string, extra: Record<string, unknown> = {}) => ({
  id, user_id: "me-1", name: `Name ${id}`, phone: "0912345678", store_id: "123456", updated_at: "2026-11-01T00:00:00+00:00",
  notes: username, buyer_username: username, contact_platform: null, ...extra,
});
const ids = (r: Awaited<ReturnType<typeof lookupCustomersByHandle>>) => (r.ok ? r.rows.map((x) => x.id) : "FAILED");

beforeEach(() => { h.calls.length = 0; h.data = []; h.error = null; h.session = { user: { id: "me-1" } }; h.hold = null; h.configured = true; });
afterEach(() => { vi.useRealTimers(); });

describe("rule #4 — which saved text stands for which username", () => {
  it(`every example of the list (${FIXTURES.cases.length})`, () => {
    expect(FIXTURES.cases.length).toBeGreaterThanOrEqual(40);
    for (const c of FIXTURES.cases) expect([c.text, usernameKeyOf(c.text)], c.why).toEqual([c.text, c.key]);
  });
  it("Jeff's examples, word for word", () => {
    for (const t of ["@pedro123", "pedro123", "@PEDRO123", "@pedro123 (U)", "@pedro123 #3", "@ pedro123", "@pedro123 Garcia (NA)"]) expect(usernameKeyOf(t), t).toBe("pedro123");
    for (const t of ["@pedro12", "@pedro1234", "(U) @pedro123", "Pedro Garcia", "pedro123 (U)", "pedro12 3"]) expect(usernameKeyOf(t), t).not.toBe("pedro123");
    expect(usernameKeyOf(null)).toBe("");
    expect(usernameKeyOf(undefined)).toBe("");
  });
  it("the scanned username: trim, ONE leading @, lower case; only a username-shaped one is looked up, never 'unknown' or blank", () => {
    expect(lookupKey("  @Maria_Shops ")).toBe("maria_shops");
    expect(lookupKey("@@x")).toBe("@x");
    expect(lookupKey(null)).toBe("");
    for (const k of ["maria_shops", "a.b_c9", "x".repeat(50)]) expect(isLookupable(k), k).toBe(true);
    for (const k of ["", "unknown", "maria shops", "a,b", "a)b", "a%b", "x".repeat(51)]) expect(isLookupable(k), k).toBe(false);
  });
  it("a record matches only when ITS text stands for exactly the scanned username", () => {
    const rows = [
      raw("exact", "pedro123"), raw("at", "@Pedro123"), raw("note", "@pedro123 (U)"), raw("num", "@pedro123 #3"), raw("sp", "@ pedro123"), raw("more", "@pedro123 Garcia (NA)"),
      raw("short", "@pedro12"), raw("long", "@pedro1234"), raw("front", "(U) @pedro123"), raw("name", "Pedro Garcia"), raw("noat", "pedro123 (U)"), raw("glued", "@pedro123(U)"),
    ];
    expect(matchLookupRows(rows, "pedro123").map((r) => r.id).sort()).toEqual(["at", "exact", "more", "note", "num", "sp"]);
    expect(matchLookupRows(rows, "pedro12").map((r) => r.id)).toEqual(["short"]);
    expect(matchLookupRows(rows, "pedro1234").map((r) => r.id)).toEqual(["long"]);
    expect(matchLookupRows(rows, "pedro")).toEqual([]);
    expect(matchLookupRows(rows, "garcia")).toEqual([]);
  });
  it("'_' and '.' are ordinary characters: maria_shops ≠ mariaXshops, a.b ≠ aXb", () => {
    expect(matchLookupRows([raw("1", "mariaXshops"), raw("2", "maria.shops"), raw("3", "@mariaXshops (U)"), raw("4", "xmaria_shops")], "maria_shops")).toEqual([]);
    expect(matchLookupRows([raw("5", "aXb"), raw("6", "a_b")], "a.b")).toEqual([]);
    expect(matchLookupRows([raw("7", "@a.b (U)")], "a.b").map((r) => r.id)).toEqual(["7"]);
  });
  it("TikTok or no app only — any other app never matches", () => {
    const rows = [raw("n", "x1"), raw("e", "x1", { platform: "" }), raw("t", "@x1 (U)", { platform: "tiktok" }), raw("T", "x1", { platform: "TikTok" }),
      raw("l", "x1", { platform: "line" }), raw("w", "@x1", { platform: "whatsapp" }), raw("f", "x1", { platform: "facebook" }), raw("i", "x1", { platform: "instagram" }), raw("o", "x1", { platform: "other" })];
    expect(matchLookupRows(rows, "x1").map((r) => r.id).sort()).toEqual(["T", "e", "n", "t"]);
  });
  it("'unknown' and blank are never matched, even when a record holds them", () => {
    expect(matchLookupRows([raw("1", "unknown"), raw("2", "@Unknown")], "unknown")).toEqual([]);
    expect(matchLookupRows([raw("1", ""), raw("2", "@")], "")).toEqual([]);
  });
  it("the NEWEST record comes first (last updated; same time → by id) — it is the one that is used", () => {
    const rows = [raw("old", "x1", { updatedAt: "2026-09-01T00:00:00+00:00" }), raw("new", "@x1 (U)", { updatedAt: "2026-11-10T00:00:00+00:00" }), raw("b", "x1", { updatedAt: "2026-10-01T00:00:00+00:00" }), raw("a", "@ x1", { updatedAt: "2026-10-01T00:00:00+00:00" })];
    expect(matchLookupRows(rows, "x1").map((r) => r.id)).toEqual(["new", "a", "b", "old"]);
  });
});

describe("the read — one per scan, this screen's table, own rows only", () => {
  it("asks for the five shapes a record of the username can have", () => {
    expect(lookupFilter("notes", "pedro123")).toBe("notes.ilike.pedro123,notes.ilike.@pedro123,notes.ilike.@pedro123 %,notes.ilike.@ pedro123,notes.ilike.@ pedro123 %");
  });
  it("7-11 reads parcel_customers.notes; FamilyMart reads fm_parcel_customers.buyer_username — never the other", async () => {
    h.data = [db("1", "@Maria_Shops (U)")];
    const a = await lookupCustomersByHandle("711", "@Maria_Shops");
    expect(a).toEqual({ ok: true, rows: [{ id: "1", name: "Name 1", phone: "0912345678", storeId: "123456", updatedAt: "2026-11-01T00:00:00+00:00" }] });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].table).toBe("parcel_customers");
    expect(h.calls[0].select).toBe("id, user_id, phone, name, store_id, notes, contact_platform, updated_at");
    expect(h.calls[0].eq).toEqual([["user_id", "me-1"]]); // explicit own-rows filter, on top of the database rule
    expect(h.calls[0].or).toEqual([lookupFilter("notes", "maria_shops")]);
    expect(h.calls[0].order).toEqual([["updated_at", { ascending: false }], ["id", { ascending: true }]]);
    expect(h.calls[0].limit).toBe(SCAN_QR_LOOKUP_LIMIT);
    h.calls.length = 0;
    await lookupCustomersByHandle("fm", "maria_shops");
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].table).toBe("fm_parcel_customers");
    expect(h.calls[0].or).toEqual([lookupFilter("buyer_username", "maria_shops")]);
    expect(h.calls[0].eq).toEqual([["user_id", "me-1"]]);
  });
  it("the app makes the final check: near-names, other apps, 'unknown' and ANOTHER seller's rows are dropped even if the database returned them", async () => {
    h.data = [db("ok", "@maria_shops (U)"), db("near", "mariaXshops"), db("longer", "@maria_shops2"), db("front", "(U) @maria_shops"), db("line", "maria_shops", { contact_platform: "line" }), db("other-seller", "maria_shops", { user_id: "someone-else" })];
    expect(ids(await lookupCustomersByHandle("711", "maria_shops"))).toEqual(["ok"]);
  });
  it("pedro123 ↔ pedro12 ↔ pedro1234 through the read, every way", async () => {
    h.data = [db("a", "@pedro123 (U)"), db("b", "@pedro12"), db("c", "pedro1234")];
    expect(ids(await lookupCustomersByHandle("711", "pedro123"))).toEqual(["a"]);
    expect(ids(await lookupCustomersByHandle("711", "pedro12"))).toEqual(["b"]);
    expect(ids(await lookupCustomersByHandle("711", "pedro1234"))).toEqual(["c"]);
  });
  it("2+ records: all come back, the NEWEST first", async () => {
    h.data = [db("1", "x1", { updated_at: "2026-09-01T00:00:00+00:00" }), db("2", "@X1 (U)", { updated_at: "2026-11-01T00:00:00+00:00" }), db("3", "@ x1", { updated_at: "2026-10-01T00:00:00+00:00" })];
    expect(ids(await lookupCustomersByHandle("711", "x1"))).toEqual(["2", "3", "1"]);
  });
  it("'unknown', blank and anything not username-shaped: NO read at all", async () => {
    for (const v of ["unknown", "@Unknown", "", "  ", "maria shops", "a,b.ilike.%", "x)"]) {
      expect(await lookupCustomersByHandle("711", v)).toEqual({ ok: true, rows: [] });
    }
    expect(h.calls).toHaveLength(0);
  });
  it("not signed in / no client / database error → ok:false", async () => {
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
  it("a full page = not every record was seen → 'could not read' (never a false 'none', never a fill from a list that was not fully counted)", async () => {
    h.data = Array.from({ length: SCAN_QR_LOOKUP_LIMIT }, (_, i) => db(`n${i}`, "aXb"));
    expect(await lookupCustomersByHandle("711", "a_b")).toEqual({ ok: false });
    // also with an exact record inside the full page: more records (with other phones) may lie beyond it
    h.data = [db("n0", "aXb", { updated_at: "2026-11-09T00:00:00+00:00" }), db("hit", "@a_b (U)", { updated_at: "2026-11-08T00:00:00+00:00" }), ...Array.from({ length: SCAN_QR_LOOKUP_LIMIT - 2 }, (_, i) => db(`n${i + 1}`, "aXb"))];
    expect(await lookupCustomersByHandle("711", "a_b")).toEqual({ ok: false });
    // one row fewer than a full page: everything was seen → the record is found
    h.data = h.data.slice(0, SCAN_QR_LOOKUP_LIMIT - 1);
    expect(ids(await lookupCustomersByHandle("711", "a_b"))).toEqual(["hit"]);
  });
  it("the adapter reads only — no insert / update / delete / rpc anywhere in it", () => {
    const src = readFileSync("src/redesign/adapters/scanQrLookup.ts", "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/\.(insert|update|upsert|delete|rpc)\(/);
    expect(src.match(/\.from\(/g)).toHaveLength(1);
  });
});

describe("which record is used — and the word that is NOT one person's username", () => {
  const row = (id: string, phone: string, updatedAt = "2026-11-01T00:00:00+00:00") => ({ id, name: `Name ${id}`, phone, storeId: "123456", updatedAt });
  it("the limit is 3 different phones", () => { expect(SCAN_QR_SHARED_PHONES).toBe(3); });
  it("no record → nothing; 1 record → that one; several records → the first (= the newest)", () => {
    expect(recordToFill([])).toBeNull();
    expect(recordToFill([row("a", "0911000001")])?.id).toBe("a");
    expect(recordToFill([row("new", "0911000001", "2026-11-09T00:00:00+00:00"), row("old", "0911000001", "2026-09-01T00:00:00+00:00")])?.id).toBe("new");
  });
  it("2 different phones (any number of records) → still the newest", () => {
    expect(recordToFill([row("a", "0911000001"), row("b", "0922000002")])?.id).toBe("a");
    expect(recordToFill([row("a", "0911000001"), row("b", "0922000002"), row("c", "0911000001"), row("d", "0922000002"), row("e", "0922000002")])?.id).toBe("a");
  });
  it("3 or more DIFFERENT phones → nothing is used (a word the seller writes for many buyers)", () => {
    expect(recordToFill([row("a", "0911000001"), row("b", "0922000002"), row("c", "0933000003")])).toBeNull();
    expect(recordToFill(Array.from({ length: 60 }, (_, i) => row(`r${i}`, `09${String(10000000 + i)}`)))).toBeNull();
  });
  it("the same phone written with spaces or dashes is ONE phone; a blank phone is not counted", () => {
    expect(distinctPhones([row("a", "0911222333"), row("b", "0911 222 333"), row("c", "0911-222-333"), row("d", " 0911222333 ")])).toBe(1);
    expect(distinctPhones([row("a", "0911222333"), row("b", ""), row("c", "   "), row("d", "0955000111")])).toBe(2);
    expect(recordToFill([row("a", "0911222333"), row("b", "0911 222 333"), row("c", "0955000111"), row("d", "")])?.id).toBe("a");
    expect(distinctPhones([])).toBe(0);
  });
  it("only the username's OWN records are counted: other apps and near-names never reach the count", async () => {
    // 2 phones under @x1 (TikTok / no app) + the same text saved as LINE and a longer name with other phones
    h.data = [
      db("1", "@x1", { phone: "0911000001", updated_at: "2026-11-09T00:00:00+00:00" }), db("2", "x1", { phone: "0922000002" }),
      db("3", "x1", { phone: "0933000003", contact_platform: "line" }), db("4", "@x12", { phone: "0944000004" }), db("5", "(U) @x1", { phone: "0955000005" }),
    ];
    const res = await lookupCustomersByHandle("711", "x1");
    expect(ids(res)).toEqual(["1", "2"]);
    expect(res.ok && recordToFill(res.rows)?.id).toBe("1");
    // a third TikTok phone → the word is shared → nothing
    h.data = [...h.data, db("6", "@x1 (U)", { phone: "0966000006" })];
    const shared = await lookupCustomersByHandle("fm", "x1");
    expect(ids(shared)).toHaveLength(3);
    expect(shared.ok && recordToFill(shared.rows)).toBeNull();
  });
});

describe("what the form remembers, and the gate", () => {
  it("the details a new scan must blank = written by the last fill and not touched since", () => {
    const mark = { handle: "a", filled: { name: "Ana", phone: "0911", store: "111111" } };
    expect(untouchedFilled(mark, { name: "Ana", phone: "0911", store: "111111" })).toEqual({ name: "", phone: "", store: "" });
    expect(untouchedFilled(mark, { name: "Ana Cruz", phone: "0911", store: "222222" })).toEqual({ phone: "" });
    expect(untouchedFilled({ handle: "a", filled: { name: "", phone: "0911", store: "" } }, { name: "", phone: "0911", store: "" })).toEqual({ phone: "" });
    expect(untouchedFilled(null, { name: "Ana", phone: "0911", store: "111111" })).toEqual({});
  });
  it("on = the switch OR this login on the list; off and not listed = off (no admin bypass)", () => {
    expect(scanQrLookupVisible({ switchOn: false, previewKey: false })).toBe(false);
    expect(scanQrLookupVisible({ switchOn: true, previewKey: false })).toBe(true);
    expect(scanQrLookupVisible({ switchOn: false, previewKey: true })).toBe(true);
    const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).toContain('const scanQrLookupOn = scanQrLookupVisible({ switchOn: featureSw.scanQrLookup, previewKey: hasFeature("scan_qr_lookup") });');
  });
  it("saving a parcel is not touched: the removed 'one username = one record' database change is not in the repo", () => {
    for (const f of ["sql/150_one_username_one_record.sql", "sql/150_one_username_one_record_rollback.sql", "scripts/sql150-behaviour.mjs", "src/redesign/adapters/__tests__/scanQrLookupSql150.test.ts"]) expect(existsSync(f), f).toBe(false);
    // …and the lookup code only reads (see "the adapter reads only" above); the hook never calls a save
    const hook = readFileSync("src/redesign/adapters/useScanQrLookup.ts", "utf8").replace(/\/\/.*$/gm, "");
    expect(hook).not.toMatch(/supabase|\.(insert|update|upsert|delete|rpc)\(|saveParcelScan|saveFmScan|updateParcelScan/);
  });
  it("nothing new is ever shown: no box component, no words for it, no view logic left", () => {
    expect(existsSync("src/redesign/components/ScanQrLookupBox.tsx")).toBe(false);
    expect(readFileSync("src/redesign/i18n/index.tsx", "utf8")).not.toMatch(/rd_ql_/);
    const code = ["src/redesign/adapters/scanQrLookup.ts", "src/redesign/adapters/useScanQrLookup.ts", "src/redesign/screens/ParcelScan.tsx", "src/redesign/screens/FmParcelScan.tsx"].map((f) => readFileSync(f, "utf8")).join("\n");
    expect(code).not.toMatch(/ScanQrLookupBox|lookupView|rd_ql_|-ql["`-]/);
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
