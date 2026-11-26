// A small in-memory stand-in for the two tables Invoicing talks to (invoice_sends, sql/220, and
// seller_receipt_settings), shaped like the PostgREST calls adapters/invoicing.ts makes. It keeps what a
// real upsert keeps: only the columns sent are written, and a seller's read returns only own rows (the
// real proof of that is the PGlite script scripts/sql220-behaviour.mjs — this one is for screen tests).
export interface FakeSend { user_id: string; session_key: string; platform: string; buyer_number: number; buyer_key: string; status: string; sent_at: string | null; lines_hash: string }
export interface FakeCall { table: string; op: "select" | "upsert"; payload?: Record<string, unknown>; filters?: Record<string, unknown> }

export function makeInvoiceDb() {
  const s = {
    uid: "u1" as string | null,
    sends: [] as FakeSend[],
    settings: new Map<string, Record<string, unknown>>(),
    failReads: false, failWrites: false, failFormatRead: false, failFormatWrite: false,
    now: "2026-11-26T01:12:00.000Z",
    calls: [] as FakeCall[],
  };
  const reset = () => {
    s.uid = "u1"; s.sends = []; s.settings = new Map(); s.failReads = false; s.failWrites = false; s.failFormatRead = false; s.failFormatWrite = false;
    s.now = "2026-11-26T01:12:00.000Z"; s.calls = [];
  };
  const err = { message: "boom" };
  const from = (table: string) => {
    const filters: Record<string, unknown> = {};
    let range: [number, number] | null = null;
    const rows = () => {
      if (table === "invoice_sends") {
        return s.sends
          .filter((r) => r.user_id === s.uid)   // a seller reads own rows only
          .filter((r) => Object.entries(filters).every(([k, v]) => (r as unknown as Record<string, unknown>)[k] === v))
          .sort((a, b) => a.buyer_number - b.buyer_number || a.buyer_key.localeCompare(b.buyer_key));
      }
      const row = s.uid ? s.settings.get(s.uid) : undefined;
      return row && Object.entries(filters).every(([k, v]) => k !== "user_id" || v === s.uid) ? [row] : [];
    };
    const read = {
      select: () => read,
      eq: (k: string, v: unknown) => { filters[k] = v; return read; },
      order: () => read,
      range: (a: number, b: number) => { range = [a, b]; return read; },
      maybeSingle: async () => {
        s.calls.push({ table, op: "select", filters: { ...filters } });
        if (table === "seller_receipt_settings" ? s.failFormatRead : s.failReads) return { data: null, error: err };
        return { data: rows()[0] ?? null, error: null };
      },
      then: (ok: (v: { data: unknown[] | null; error: unknown }) => unknown) => {
        s.calls.push({ table, op: "select", filters: { ...filters } });
        if (s.failReads) return Promise.resolve({ data: null, error: err }).then(ok);
        const all = rows();
        return Promise.resolve({ data: range ? all.slice(range[0], range[1] + 1) : all, error: null }).then(ok);
      },
    };
    return {
      ...read,
      upsert: (payload: Record<string, unknown>) => {
        s.calls.push({ table, op: "upsert", payload: { ...payload } });
        if (table === "invoice_sends") {
          let saved: FakeSend | null = null;
          if (!s.failWrites && payload.user_id === s.uid) {   // a row for somebody else is refused
            const i = s.sends.findIndex((r) => r.user_id === payload.user_id && r.session_key === payload.session_key && r.platform === payload.platform
              && r.buyer_number === payload.buyer_number && r.buyer_key === payload.buyer_key);
            saved = { ...(i >= 0 ? s.sends[i] : {}), ...(payload as unknown as FakeSend), sent_at: payload.status === "sent" ? s.now : null };
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
  const supabase = { from, auth: { getSession: async () => ({ data: { session: s.uid ? { user: { id: s.uid } } : null } }) } };
  return { s, reset, supabase };
}

export const DB = makeInvoiceDb();
