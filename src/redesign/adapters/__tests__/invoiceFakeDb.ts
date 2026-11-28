// A small in-memory stand-in for the two tables Invoicing talks to (invoice_sends, sql/220, and
// seller_receipt_settings), shaped like the PostgREST calls adapters/invoicing.ts makes. It keeps what a
// real upsert keeps: only the columns sent are written, and a seller's read returns only own rows (the
// real proof of that is the PGlite script scripts/sql220-behaviour.mjs — this one is for screen tests).
// For the session picker it also answers what the Orders tab's past sessions read: the list
// (rpc my_session_summaries, grouped the way sql/128 groups) and one session's stored order rows
// (live_session_orders by session_id) — both from `s.orders`.
export interface FakeSend { user_id: string; session_key: string; platform: string; buyer_number: number; buyer_key: string; status: string; sent_at: string | null; lines_hash: string }
export interface FakeCall { table: string; op: "select" | "upsert" | "delete" | "rpc"; payload?: Record<string, unknown>; filters?: Record<string, unknown> }
/** sql/222: one cancelled order line of an invoice */
export interface FakeLineCancel { user_id: string; session_key: string; platform: string; order_id: number }
export interface FakeOrderRow { user_id: string; session_id: string; session_date: string; created_at: string; [k: string]: unknown }

export function makeInvoiceDb() {
  const s = {
    uid: "u1" as string | null,
    sends: [] as FakeSend[],
    settings: new Map<string, Record<string, unknown>>(),
    failReads: false, failWrites: false, failFormatRead: false, failFormatWrite: false,
    now: "2026-11-26T01:12:00.000Z",
    calls: [] as FakeCall[],
    orders: [] as FakeOrderRow[],
    failSummaries: false, failPast: false,
    lineCancels: [] as FakeLineCancel[],
    failCancelReads: false, failCancelWrites: false, failIdReads: false,
    /** sql/222 not applied yet: 'cancelled' is refused like the sql/220 check refuses it */
    noCancelStatus: false,
    /** a session's platform read (live_session_orders …limit(1)) fails */
    failPlatformReads: false,
    /** sql/233 fb_receipt_edits: one row per seller + session + buyer number */
    edits: [] as Record<string, unknown>[],
    failEditReads: false, failEditWrites: false, noEditsTable: false,
    /** a slow network: an edit write waits for this before it lands; hang = it never answers */
    editWriteGate: null as Promise<void> | null, hangEditWrites: false,
  };
  const reset = () => {
    s.uid = "u1"; s.sends = []; s.settings = new Map(); s.failReads = false; s.failWrites = false; s.failFormatRead = false; s.failFormatWrite = false;
    s.now = "2026-11-26T01:12:00.000Z"; s.calls = [];
    s.orders = []; s.failSummaries = false; s.failPast = false;
    s.lineCancels = []; s.failCancelReads = false; s.failCancelWrites = false; s.failIdReads = false; s.noCancelStatus = false;
    s.failPlatformReads = false;
    s.edits = []; s.failEditReads = false; s.failEditWrites = false; s.noEditsTable = false;
    s.editWriteGate = null; s.hangEditWrites = false;
  };
  const err = { message: "boom" };
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    const since: Record<string, string> = {};
    let range: [number, number] | null = null;
    let lim: number | null = null;
    const notNull: string[] = [];
    const rows = () => {
      if (table === "invoice_sends") {
        return s.sends
          .filter((r) => r.user_id === s.uid)   // a seller reads own rows only
          .filter((r) => Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v))
          .sort((a, b) => a.buyer_number - b.buyer_number || a.buyer_key.localeCompare(b.buyer_key));
      }
      if (table === "invoice_line_cancels") {
        return s.lineCancels
          .filter((r) => r.user_id === s.uid)
          .filter((r) => Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v))
          .sort((a, b) => a.order_id - b.order_id);
      }
      if (table === "fb_receipt_edits") {
        return s.edits
          .filter((r) => r.user_id === s.uid)
          .filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
      }
      if (table === "live_session_orders") {
        return s.orders
          .filter((r) => r.user_id === s.uid)
          .filter((r) => Object.entries(filters).every(([k, v]) => r[k] === v))
          .filter((r) => Object.entries(since).every(([k, v]) => String(r[k]) >= v))
          .filter((r) => notNull.every((k) => r[k] != null))
          .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
      }
      const row = s.uid ? s.settings.get(s.uid) : undefined;
      return row && Object.entries(filters).every(([k, v]) => k !== "user_id" || v === s.uid) ? [row] : [];
    };
    const read = {
      select: () => read,
      eq: (k: string, v: unknown) => { filters[k] = v; return read; },
      gte: (k: string, v: string) => { since[k] = v; return read; },
      order: () => read,
      range: (a: number, b: number) => { range = [a, b]; return read; },
      not: (k: string, op: string, v: unknown) => { if (op === "is" && v === null) notNull.push(k); return read; },
      limit: (n: number) => { lim = n; return read; },
      maybeSingle: async () => {
        s.calls.push({ table, op: "select", filters: { ...filters } });
        if (table === "seller_receipt_settings" ? s.failFormatRead : s.failReads) return { data: null, error: err };
        return { data: rows()[0] ?? null, error: null };
      },
      then: (ok: (v: { data: unknown[] | null; error: unknown }) => unknown) => {
        s.calls.push({ table, op: "select", filters: { ...filters } });
        if (table === "fb_receipt_edits" && s.noEditsTable) return Promise.resolve({ data: null, error: { message: "missing", code: "PGRST205" } }).then(ok);
        const failNow = table === "live_session_orders" ? (lim !== null ? s.failPlatformReads : filters.platform !== undefined ? s.failIdReads : s.failPast)
          : table === "invoice_line_cancels" ? s.failCancelReads : table === "fb_receipt_edits" ? s.failEditReads : s.failReads;
        if (failNow) return Promise.resolve({ data: null, error: err }).then(ok);
        const all = rows();
        const cut = range ? all.slice(range[0], range[1] + 1) : all;
        return Promise.resolve({ data: lim !== null ? cut.slice(0, lim) : cut, error: null }).then(ok);
      },
    };
    return {
      ...read,
      // .delete().eq(...).eq(...) — awaited at the end; a seller deletes own rows only
      delete: () => {
        const del: Record<string, unknown> = {};
        const chain = {
          eq: (k: string, v: unknown) => { del[k] = v; return chain; },
          then: (ok: (v: { error: unknown }) => unknown) => {
            s.calls.push({ table, op: "delete", filters: { ...del } });
            const fail = table === "invoice_line_cancels" ? s.failCancelWrites : table === "fb_receipt_edits" ? s.failEditWrites : s.failWrites;
            if (fail || del.user_id !== s.uid) return Promise.resolve({ error: err }).then(ok);
            const hit = (r: Record<string, unknown>) => Object.entries(del).every(([k, v]) => r[k] === v);
            if (table === "invoice_line_cancels") s.lineCancels = s.lineCancels.filter((r) => !hit(r as unknown as Record<string, unknown>));
            if (table === "invoice_sends") s.sends = s.sends.filter((r) => !hit(r as unknown as Record<string, unknown>));
            if (table === "fb_receipt_edits") s.edits = s.edits.filter((r) => !hit(r));
            return Promise.resolve({ error: null }).then(ok);
          },
        };
        return chain;
      },
      upsert: (payload: Record<string, unknown>, _opts?: unknown) => {
        s.calls.push({ table, op: "upsert", payload: { ...payload } });
        if (table === "invoice_line_cancels") {
          const ok = !s.failCancelWrites && payload.user_id === s.uid;
          if (ok && !s.lineCancels.some((r) => r.user_id === payload.user_id && r.session_key === payload.session_key && r.platform === payload.platform && r.order_id === payload.order_id)) {
            s.lineCancels.push(payload as unknown as FakeLineCancel);
          }
          return Promise.resolve({ error: ok ? null : err });
        }
        if (table === "fb_receipt_edits") {
          const land = () => {
            const ok = !s.failEditWrites && !s.noEditsTable && payload.user_id === s.uid;
            if (ok) {
              const i = s.edits.findIndex((r) => r.user_id === payload.user_id && r.session_id === payload.session_id && r.buyer_number === payload.buyer_number);
              const row = { ...payload, updated_at: s.now };
              if (i >= 0) s.edits[i] = row; else s.edits.push(row);
            }
            return { error: ok ? null : err };
          };
          if (s.hangEditWrites) return new Promise<{ error: null }>(() => { /* never answers */ });
          return s.editWriteGate ? s.editWriteGate.then(land) : Promise.resolve(land());
        }
        if (table === "invoice_sends") {
          let saved: FakeSend | null = null;
          const refusedStatus = s.noCancelStatus && payload.status === "cancelled";
          if (!s.failWrites && !refusedStatus && payload.user_id === s.uid) {   // a row for somebody else is refused
            const i = s.sends.findIndex((r) => r.user_id === payload.user_id && r.session_key === payload.session_key && r.platform === payload.platform
              && r.buyer_number === payload.buyer_number && r.buyer_key === payload.buyer_key);
            const old = i >= 0 ? s.sends[i] : null;
            // sql/222's stamp: 'cancelled' keeps the earlier send time; 'sent' after 'cancelled' gives it back
            const sentAt = payload.status === "cancelled" ? (old && (old.status === "sent" || old.status === "cancelled") ? old.sent_at : null)
              : payload.status === "sent" ? (old?.status === "cancelled" && old.sent_at ? old.sent_at : s.now) : null;
            saved = { ...(old || {}), ...(payload as unknown as FakeSend), sent_at: sentAt };
            if (i >= 0) s.sends[i] = saved; else s.sends.push(saved);
          }
          const res = { data: saved ? { sent_at: saved.sent_at } : null, error: saved ? null : err };
          return { select: () => ({ maybeSingle: async () => res }) };
        }
        const ok = !s.failFormatWrite && payload.user_id === s.uid;
        if (ok) s.settings.set(String(payload.user_id), { ...(s.settings.get(String(payload.user_id)) || {}), ...payload });
        return Promise.resolve({ error: ok ? null : err });
      },
    };
  };
  // my_session_summaries() (sql/128): one row per session of the signed-in seller
  const rpc = async (fn: string) => {
    s.calls.push({ table: `rpc:${fn}`, op: "rpc" });
    if (fn !== "my_session_summaries" || s.failSummaries) return { data: null, error: err };
    const by = new Map<string, { session_id: string; first_day: string; last_day: string; orders: number; latest: string }>();
    for (const r of s.orders.filter((x) => x.user_id === s.uid)) {
      const g = by.get(r.session_id);
      if (!g) { by.set(r.session_id, { session_id: r.session_id, first_day: r.session_date, last_day: r.session_date, orders: 1, latest: r.created_at }); continue; }
      if (r.session_date < g.first_day) g.first_day = r.session_date;
      if (r.session_date > g.last_day) g.last_day = r.session_date;
      if (r.created_at > g.latest) g.latest = r.created_at;
      g.orders += 1;
    }
    return { data: [...by.values()], error: null };
  };
  const supabase = { from, rpc, auth: { getSession: async () => ({ data: { session: s.uid ? { user: { id: s.uid } } : null } }) } };
  return { s, reset, supabase };
}

export const DB = makeInvoiceDb();
