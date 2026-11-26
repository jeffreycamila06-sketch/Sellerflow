// INVOICING, step 2a (Settings → Invoicing, TikTok "Send next", text) — Jeff, 2026-11-26.
// The list is the CURRENT session's buyers, one row per buyer, built from the SAME code as the Orders
// buyer card (buyerReceipts) and the SAME message as Send to TikTok (buildSendMessage). Nothing here
// writes to orders / live_session_orders / products / Sales. What is remembered:
//   • the status of each invoice (sent / can't message) — table invoice_sends (sql/220), own rows only;
//   • the buyer the seller is sending right now ("pending") — this phone only, until the next tap;
//   • a buyer the seller marked "Buyer cancelled" — status 'cancelled' in invoice_sends (sql/222);
//   • one order line cancelled from the invoice — table invoice_line_cancels (sql/222), keyed by the
//     ORDER'S OWN DATABASE ID (live_session_orders.id), never by its text. The order itself is untouched.
// No buyer name, username or message text is logged or sent anywhere by this module.
import { useCallback, useEffect, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { fetchAllPages } from "../../lib/fetchAllPages";
import type { Buyer } from "../../lib/orderTypes";
import { buyerReceipts, type BuyerReceipt } from "./useReadData";
import type { Order } from "../data";
import { matchPaidRows, orderKey } from "./ordersPaid";
import { buildSendMessage, initialSendLines, messageTotal, priceInput, priceOf, qtyOf, type MessageLabels, type SendLine } from "./tiktokSend";
import { NOTE_MAX } from "./receiptSettings";

/** Who can open Invoicing: the switch (every plan), an admin, or a login on the preview list (sql/220). */
export const invoicingVisible = (a: { isAdmin: boolean; previewKey: boolean; switchOn: boolean }): boolean => a.switchOn || a.isAdmin || a.previewKey;

export const INVOICE_PLATFORMS = ["tiktok", "facebook", "instagram", "shopee"] as const;
export type InvoicePlatform = (typeof INVOICE_PLATFORMS)[number];
/** The platform name the orders carry (Buyer.platform). */
export const PLATFORM_NAME: Record<InvoicePlatform, string> = { tiktok: "TikTok", facebook: "Facebook", instagram: "Instagram", shopee: "Shopee" };

// ── a short one-way mark (not a secret, not reversible to the text in practice): cyrb53 → base36 ──
export function shortHash(s: string): string {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
/** Keeps two buyers with the SAME number apart (two phones can give the same number twice). */
export const buyerKeyOf = (handle: string): string => shortHash(String(handle || "").trim().replace(/^@+/, "").toLowerCase());
/** The buyer's lines + total as they are now. A different value later = "New item · send again". */
export const linesHashOf = (r: BuyerReceipt): string =>
  shortHash(JSON.stringify([r.lines.map((l) => [String(l.item ?? ""), Number(l.total) || 0, qtyOf(l.qty)]), Number(r.total) || 0]));

export interface InvoiceRow {
  id: string;            // `${num}:${key}`
  num: number;
  key: string;
  receipt: BuyerReceipt; // the Orders buyer card of this buyer (EVERY line, cancelled ones too)
  lines: SendLine[];     // the Send to TikTok lines of that card that are NOT cancelled (the message's lines)
  total: number;         // those lines + the shipping fee = the Total of the message
  hash: string;          // the lines that are not cancelled, as they are now
  /** every hash that still means "nothing new since it was sent": the current one first, then the same
   *  lines plus any of the cancelled ones (a line cancelled AFTER the invoice went out is not "new") */
  hashes: string[];
  orderNums: number[];
  /** per line of `receipt.lines`: the order's database id (null = not paired with its stored row yet) */
  orderIds: (number | null)[];
  /** per line of `receipt.lines`: cancelled from the invoice */
  cancelled: boolean[];
}

/** The hash of the lines kept (true) — exactly linesHashOf(receipt) when every line is kept, so the
 *  status saved before cancelled lines existed still matches. */
export function keptLinesHash(r: BuyerReceipt, keep: readonly boolean[]): string {
  if (r.lines.every((_, i) => keep[i] !== false)) return linesHashOf(r);
  const kept = r.lines.filter((_, i) => keep[i] !== false);
  const sum = kept.reduce((a, l) => a + (Number(l.total) || 0), 0);
  return shortHash(JSON.stringify([kept.map((l) => [String(l.item ?? ""), Number(l.total) || 0, qtyOf(l.qty)]), sum]));
}
/** Up to this many cancelled lines are tried back in (2^6 = 64 hashes at most per row). */
export const HASH_SUBSET_MAX = 6;
function rowHashes(r: BuyerReceipt, cancelled: readonly boolean[]): string[] {
  const keep = r.lines.map((_, i) => !cancelled[i]);
  const off = cancelled.map((c, i) => (c ? i : -1)).filter((i) => i >= 0).slice(0, HASH_SUBSET_MAX);
  const out = [keptLinesHash(r, keep)];
  for (let mask = 1; mask < 1 << off.length; mask++) {
    const k = [...keep];
    off.forEach((i, b) => { if (mask & (1 << b)) k[i] = true; });
    const h = keptLinesHash(r, k);
    if (!out.includes(h)) out.push(h);
  }
  return out;
}

/** The order as the Orders "Paid" flag pairs it with its stored row (adapters/ordersPaid.ts — ONE rule). */
export const orderLike = (o: { bNum: number; handle: string; platform: string; item: string; total: number; orderNum: number }): Order =>
  ({ id: `#${o.bNum}`, handle: o.handle, platform: o.platform, items: o.item, total: o.total, orderNum: o.orderNum } as unknown as Order);
/** The pairing key of an order (Map key of the ids map). */
export const lineKeyOf = (o: { bNum: number; handle: string; platform: string; item: string; total: number; orderNum: number }): string => orderKey(orderLike(o));
/** A stored row as the session read gives it. */
export interface OrderIdRow { id: number; buyer_number: number; handle: string | null; platform: string | null; product: string | null; price: number | null; qty: number | null; created_at: string }
/** Pairs every order of the buyers with its stored row (same buyer number, handle, platform, item and
 *  total; inside one group the n-th oldest order takes the n-th oldest row). → Map lineKey → order id. */
export function pairOrderIds(buyers: Buyer[], rows: readonly OrderIdRow[]): Map<string, number> {
  const orders = (Array.isArray(buyers) ? buyers : []).flatMap((b) => b.orders.map((o) => orderLike(o)));
  const m = matchPaidRows(orders, rows.map((r) => ({ ...r, paid_at: null })) as Parameters<typeof matchPaidRows>[1]);
  const out = new Map<string, number>();
  for (const [k, v] of m) out.set(k, v.id);
  return out;
}

/** The fee as the message field wants it: "" = no shipping line, "0" = a "Shipping fee: 0" line. */
export const feeText = (fee: number | null | undefined): string => (fee === null || fee === undefined || !Number.isFinite(Number(fee)) ? "" : String(Number(fee)));

/**
 * One row per buyer of that platform in the session, ordered by buyer number (same number twice → in
 * the session's own order). Lines / totals come from buyerReceipts — the Orders buyer card's code.
 */
export function invoiceRows(buyers: Buyer[], platform: InvoicePlatform, fee = "", extra: { ids?: ReadonlyMap<string, number>; cancelled?: ReadonlySet<number> } = {}): InvoiceRow[] {
  const name = PLATFORM_NAME[platform];
  const list = Array.isArray(buyers) ? buyers : [];
  const nums = [...new Set(list.filter((b) => b.platform === name).map((b) => b.num))].sort((a, b) => a - b);
  const out: InvoiceRow[] = [];
  for (const num of nums) {
    const cards = buyerReceipts(list, num);            // every buyer with exactly that number (any platform)
    const same = list.filter((b) => b.num === num);    // the same buyers, in the same order
    cards.forEach((receipt, i) => {
      if (receipt.platform !== name) return;
      const orders = same[i]?.orders || [];
      const orderIds = receipt.lines.map((_, j) => { const o = orders[j]; return o ? extra.ids?.get(lineKeyOf(o)) ?? null : null; });
      const cancelled = orderIds.map((oid) => oid !== null && !!extra.cancelled?.has(oid));
      const lines = initialSendLines(receipt.lines).filter((_, j) => !cancelled[j]);
      const key = buyerKeyOf(receipt.handle);
      const hashes = rowHashes(receipt, cancelled);
      out.push({
        id: `${num}:${key}`, num, key, receipt, lines,
        total: messageTotal(lines, null, fee),
        hash: hashes[0], hashes,
        orderNums: orders.map((o) => o.orderNum),
        orderIds, cancelled,
      });
    });
  }
  return out;
}

/** The message of a row — the Send to TikTok text for that buyer with the format's note and fee. */
export function invoiceMessage(row: InvoiceRow, o: { cur: string; note: string; fee: string; date: string; labels: MessageLabels }): string {
  return buildSendMessage({ name: row.receipt.name, date: o.date, lines: row.lines, total: row.total, cur: o.cur, note: o.note, labels: o.labels, shippingFee: o.fee });
}

// ── status ──────────────────────────────────────────────────────────────────────────────────────────
export type SavedKind = "sent" | "skipped" | "cancelled";
/** sentAt of a 'cancelled' row = when it was sent before the cancel (null = it never was) */
export interface SavedStatus { status: SavedKind; sentAt: string | null; hash: string }
export type InvoiceState = "sent" | "new_item" | "skipped" | "cancelled" | "not_sent";
/** "sending" and "copy_failed" live on this phone only (never saved). */
export type InvoiceTag = InvoiceState | "next" | "sending" | "copy_failed";

/** What the saved row says about this buyer now. */
export function stateOf(row: InvoiceRow, saved: SavedStatus | undefined): InvoiceState {
  if (!saved) return "not_sent";
  if (saved.status === "cancelled") return "cancelled";
  if (saved.status === "skipped") return "skipped";
  return saved.hash === row.hash || (row.hashes || []).includes(saved.hash) ? "sent" : "new_item";
}
/** The buyers "Send next" still has to go through, in buyer-number order (the one being sent is left out). */
export function sendQueue(rows: InvoiceRow[], saved: Map<string, SavedStatus>, pendingId: string | null): InvoiceRow[] {
  return rows.filter((r) => r.id !== pendingId && ["not_sent", "new_item"].includes(stateOf(r, saved.get(r.id))));
}
/** The buyer whose message could not be copied on this phone: only while that row is still there and is
 *  not Sent (a refused "Send again" on a Sent buyer leaves the buyer Sent). */
export function copyFailedRow(rows: InvoiceRow[], saved: Map<string, SavedStatus>, copyFailedId: string | null): InvoiceRow | null {
  const r = copyFailedId ? rows.find((x) => x.id === copyFailedId) : undefined;
  const st = r ? stateOf(r, saved.get(r.id)) : null;
  return r && st !== "sent" && st !== "cancelled" ? r : null;
}
/** The buyer the big button is on: the one whose copy failed (it stays there until a copy works — `again`),
 *  else the first of the queue. */
export function sendTarget(rows: InvoiceRow[], saved: Map<string, SavedStatus>, pendingId: string | null, copyFailedId: string | null): { row: InvoiceRow | null; again: boolean } {
  const failed = copyFailedRow(rows, saved, copyFailedId);
  if (failed) return { row: failed, again: true };
  return { row: sendQueue(rows, saved, pendingId)[0] ?? null, again: false };
}
/** The tag of a row: copy failed > being sent > what is saved > "Next" > "Not sent". */
export function tagOf(row: InvoiceRow, saved: Map<string, SavedStatus>, pendingId: string | null, nextId: string | null, copyFailedId: string | null = null): InvoiceTag {
  const s = stateOf(row, saved.get(row.id));
  if (s === "cancelled") return "cancelled";
  if (row.id === copyFailedId && s !== "sent") return "copy_failed";
  if (row.id === pendingId) return "sending";
  if (s !== "not_sent") return s;
  return row.id === nextId ? "next" : "not_sent";
}
export type InvoiceFilter = "all" | "not_sent" | "sent";
/** A cancelled buyer is listed under All only. */
export const inFilter = (state: InvoiceState, f: InvoiceFilter): boolean => f === "all" || (f === "sent" ? state === "sent" : state !== "sent" && state !== "cancelled");
/** all = every row (the All chip); active = the rows that still get an invoice (cancelled buyers left
 *  out) — "X of N sent" counts against active. */
export function invoiceCounts(rows: InvoiceRow[], saved: Map<string, SavedStatus>): { all: number; active: number; sent: number; notSent: number; cancelled: number } {
  const st = rows.map((r) => stateOf(r, saved.get(r.id)));
  const sent = st.filter((x) => x === "sent").length;
  const cancelled = st.filter((x) => x === "cancelled").length;
  const active = rows.length - cancelled;
  return { all: rows.length, active, sent, notSent: active - sent, cancelled };
}

/** The session the status belongs to: the session id, else (no session yet) the Taipei day. */
export const invoiceSessionKey = (sessionId: string | null | undefined, dayId: string): string => {
  const id = String(sessionId || "").trim();
  return (id || `day:${String(dayId || "").trim()}`).slice(0, 80);
};

// ── the buyer being sent right now (this phone only) ────────────────────────────────────────────────
// One per session + platform (the seller can look at a past session and come back): a small map, the
// newest PENDING_KEEP sessions kept.
const pendingKey = (userId: string) => `sfl_rd_invoice_pending:${userId || "anon"}`;
const PENDING_KEEP = 12;
const pendingSlot = (sessionKey: string, platform: InvoicePlatform) => `${platform}|${sessionKey}`;
function readPendingMap(userId: string): Record<string, string> {
  try {
    const p = JSON.parse(localStorage.getItem(pendingKey(userId)) || "null") as unknown;
    if (!p || typeof p !== "object" || Array.isArray(p)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(p as Record<string, unknown>)) if (typeof v === "string" && v) out[k] = v;
    return out;
  } catch { return {}; }
}
export function loadPending(userId: string, sessionKey: string, platform: InvoicePlatform): string | null {
  return readPendingMap(userId)[pendingSlot(sessionKey, platform)] ?? null;
}
export function savePending(userId: string, sessionKey: string, platform: InvoicePlatform, id: string | null): void {
  try {
    const map = readPendingMap(userId);
    const slot = pendingSlot(sessionKey, platform);
    delete map[slot];
    if (id) map[slot] = id;                                  // newest last
    const keep = Object.entries(map).slice(-PENDING_KEEP);
    if (keep.length) localStorage.setItem(pendingKey(userId), JSON.stringify(Object.fromEntries(keep)));
    else localStorage.removeItem(pendingKey(userId));
  } catch { /* this phone only — losing it shows the buyer as "Not sent" again */ }
}

// ── the saved status (invoice_sends, sql/220) ───────────────────────────────────────────────────────
const SENDS = "invoice_sends";
const PAGE = 1000;
async function ownUserId(): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}
interface SendRow { buyer_number: number; buyer_key: string; status: string; sent_at: string | null; lines_hash: string }
export function sendRowsToMap(rows: SendRow[]): Map<string, SavedStatus> {
  const m = new Map<string, SavedStatus>();
  for (const r of rows || []) {
    if (!r || (r.status !== "sent" && r.status !== "skipped" && r.status !== "cancelled")) continue;
    m.set(`${Number(r.buyer_number)}:${String(r.buyer_key ?? "")}`, { status: r.status, sentAt: r.sent_at ?? null, hash: String(r.lines_hash ?? "") });
  }
  return m;
}
/** One read when the screen opens (paged, never a partial list). null = could not read. */
export async function loadInvoiceSends(sessionKey: string, platform: InvoicePlatform): Promise<Map<string, SavedStatus> | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const uid = await ownUserId();
    if (!uid) return null;
    const sb = supabase;
    const rows = await fetchAllPages<SendRow>(async (page) => {
      const { data, error } = await sb.from(SENDS).select("buyer_number, buyer_key, status, sent_at, lines_hash")
        .eq("user_id", uid).eq("session_key", sessionKey).eq("platform", platform)
        .order("buyer_number", { ascending: true }).order("buyer_key", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      return error ? null : ((data || []) as SendRow[]);
    }, PAGE);
    return rows ? sendRowsToMap(rows) : null;
  } catch { return null; }
}
/** One upsert per mark. Answers the saved time (the database's clock), or null when it was not saved. */
export async function saveInvoiceSend(sessionKey: string, platform: InvoicePlatform, row: { num: number; key: string; hash: string }, status: SavedKind): Promise<{ sentAt: string | null } | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const uid = await ownUserId();
    if (!uid) return null;
    const { data, error } = await supabase.from(SENDS).upsert({
      user_id: uid, session_key: sessionKey, platform, buyer_number: row.num, buyer_key: row.key, status, lines_hash: row.hash,
    }, { onConflict: "user_id,session_key,platform,buyer_number,buyer_key" }).select("sent_at").maybeSingle();
    if (error) return null;
    return { sentAt: (data as { sent_at?: string | null } | null)?.sent_at ?? null };
  } catch { return null; }
}

/** "Undo cancel" of a buyer that was never sent: the row goes (= Not sent). true = gone. */
export async function deleteInvoiceSend(sessionKey: string, platform: InvoicePlatform, row: { num: number; key: string }): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const uid = await ownUserId();
    if (!uid) return false;
    const { error } = await supabase.from(SENDS).delete()
      .eq("user_id", uid).eq("session_key", sessionKey).eq("platform", platform).eq("buyer_number", row.num).eq("buyer_key", row.key);
    return !error;
  } catch { return false; }
}

type SendOp = SavedKind | "clear";
export interface InvoiceStatusApi {
  state: "loading" | "ready" | "error";
  saved: Map<string, SavedStatus>;
  /** marks that are shown but not saved yet (no connection) */
  unsaved: number;
  /** hash: what to save as the lines (default the row's current hash) */
  mark: (row: InvoiceRow, status: SavedKind, hash?: string) => void;
  /** removes the saved row (the buyer is Not sent again) */
  clear: (row: InvoiceRow) => void;
  retry: () => void;
  reload: () => void;
}
/**
 * The status of the session's invoices: one read when the screen opens (and on reload), one write per
 * mark, no timer. A mark shows at once; when the write fails it stays on screen, is counted in `unsaved`
 * and is sent again by retry() or by the next mark.
 */
const NO_SAVED: Map<string, SavedStatus> = new Map();
export function useInvoiceStatus(sessionKey: string, platform: InvoicePlatform, enabled: boolean): InvoiceStatusApi {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [saved, setSaved] = useState<Map<string, SavedStatus>>(() => new Map());
  const [unsaved, setUnsaved] = useState(0);
  const [turn, setTurn] = useState(0);
  // which session + platform `saved` belongs to: after a switch (the session picker) the old session's
  // tags are never shown for the new one, not even for one frame
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const failed = useRef(new Map<string, { row: { num: number; key: string; hash: string }; status: SendOp }>());
  const scope = useRef("");
  const open = useRef(true);
  useEffect(() => { open.current = true; return () => { open.current = false; }; }, []);

  useEffect(() => {
    if (!enabled) return;
    const mine = `${sessionKey}|${platform}|${turn}`;
    scope.current = mine;
    failed.current = new Map();
    let alive = true;
    void Promise.resolve().then(() => { if (alive) { setState("loading"); setUnsaved(0); } });
    void loadInvoiceSends(sessionKey, platform).then((m) => {
      if (!alive || scope.current !== mine) return;
      setLoadedFor(`${sessionKey}|${platform}`);
      if (m) { setSaved(m); setState("ready"); } else { setSaved(new Map()); setState("error"); }
    });
    return () => { alive = false; };
  }, [sessionKey, platform, enabled, turn]);

  const write = useCallback((id: string, row: { num: number; key: string; hash: string }, status: SendOp) => {
    const mine = scope.current;
    const go = status === "clear"
      ? deleteInvoiceSend(sessionKey, platform, row).then((ok) => (ok ? { sentAt: null } : null))
      : saveInvoiceSend(sessionKey, platform, row, status);
    void go.then((r) => {
      if (!open.current || scope.current !== mine) return;
      if (r) {
        failed.current.delete(id);
        if (r.sentAt) setSaved((m) => { const cur = m.get(id); if (!cur || cur.status !== "sent") return m; const n = new Map(m); n.set(id, { ...cur, sentAt: r.sentAt }); return n; });
      } else failed.current.set(id, { row, status });
      setUnsaved(failed.current.size);
    });
  }, [sessionKey, platform]);

  const retry = useCallback(() => {
    for (const [id, f] of [...failed.current]) write(id, f.row, f.status);
  }, [write]);

  const mark = useCallback((row: InvoiceRow, status: SavedKind, hash?: string) => {
    const h = hash ?? row.hash;
    const slim = { num: row.num, key: row.key, hash: h };
    setSaved((m) => {
      const prev = m.get(row.id);
      // the database keeps the time of the send through a cancel and gives it back on Undo (sql/222)
      const sentAt = status === "sent" ? (prev?.status === "cancelled" && prev.sentAt ? prev.sentAt : new Date().toISOString())
        : status === "cancelled" ? (prev && (prev.status === "sent" || prev.status === "cancelled") ? prev.sentAt : null)
        : null;
      const n = new Map(m); n.set(row.id, { status, sentAt, hash: h }); return n;
    });
    for (const [id, f] of [...failed.current]) if (id !== row.id) write(id, f.row, f.status);   // an earlier mark that did not save goes again
    write(row.id, slim, status);
  }, [write]);
  const clear = useCallback((row: InvoiceRow) => {
    setSaved((m) => { if (!m.has(row.id)) return m; const n = new Map(m); n.delete(row.id); return n; });
    for (const [id, f] of [...failed.current]) if (id !== row.id) write(id, f.row, f.status);
    write(row.id, { num: row.num, key: row.key, hash: row.hash }, "clear");
  }, [write]);

  const reload = useCallback(() => setTurn((n) => n + 1), []);
  if (loadedFor !== `${sessionKey}|${platform}`) return { state: "loading", saved: NO_SAVED, unsaved: 0, mark, clear, retry, reload };
  return { state, saved, unsaved, mark, clear, retry, reload };
}

// ── the format: ONE for every platform (seller_receipt_settings: the note + the invoice shipping fee) ──
export const INVOICE_FEE_MAX = 1_000_000;
export interface InvoiceFormat { note: string; fee: string }   // fee: the field's text ("" = none)
export const EMPTY_INVOICE_FORMAT: InvoiceFormat = { note: "", fee: "" };
/** A typed fee: the shared price field rule; nothing above the limit. */
export const feeInput = (s: string, cur: string): string => {
  const v = priceInput(s, cur);
  return priceOf(v) > INVOICE_FEE_MAX ? String(INVOICE_FEE_MAX) : v;
};
export function normalizeInvoiceFormat(row: Record<string, unknown> | null | undefined): InvoiceFormat {
  if (!row) return { ...EMPTY_INVOICE_FORMAT };
  const raw = row.invoice_shipping_fee;
  const n = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
  return { note: String(row.note ?? "").slice(0, NOTE_MAX), fee: Number.isFinite(n) && n >= 0 ? String(n) : "" };
}
/** One read. The payment note is the Receipt format note (same row, same column). */
export async function loadInvoiceFormat(): Promise<{ ok: true; format: InvoiceFormat } | { ok: false }> {
  if (!isSupabaseConfigured || !supabase) return { ok: false };
  try {
    const uid = await ownUserId();
    if (!uid) return { ok: false };
    const { data, error } = await supabase.from("seller_receipt_settings").select("*").eq("user_id", uid).maybeSingle();
    if (error) return { ok: false };
    return { ok: true, format: normalizeInvoiceFormat(data as Record<string, unknown> | null) };
  } catch { return { ok: false }; }
}
/** Saves ONLY the note and the invoice fee — the receipt's opening text and QR picture are not sent, so they stay. */
export async function saveInvoiceFormat(f: InvoiceFormat): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const uid = await ownUserId();
    if (!uid) return false;
    const fee = f.fee.trim() === "" ? null : Math.min(INVOICE_FEE_MAX, priceOf(f.fee));
    const { error } = await supabase.from("seller_receipt_settings").upsert({
      user_id: uid, note: f.note.slice(0, NOTE_MAX), invoice_shipping_fee: fee, updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    return !error;
  } catch { return false; }
}

/** "9:12" — the saved time in the phone's own clock (display only). */
export function sentTime(iso: string | null | undefined): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** The number of items in a row = the order lines its sheet shows (one per order; an order with qty x2
 *  is ONE line with "x2" in the sheet, so it counts as 1). */
export const itemCount = (r: InvoiceRow): number => r.receipt.lines.filter((_, i) => !r.cancelled?.[i]).length;
/** "I sent it by hand" is offered only for a buyer whose copy failed or who is being sent right now. */
export const byHandAllowed = (tag: InvoiceTag): boolean => tag === "copy_failed" || tag === "sending";

// ── one order line cancelled from the invoice (invoice_line_cancels, sql/222) ─────────────────────────
// One row per cancelled line: seller + session + platform + the ORDER'S DATABASE ID. Nothing else (no
// name, username, item text or price). Cancel = one insert, Undo = one delete — two phones never
// overwrite each other's lines. The order row itself is never written.
const LINE_CANCELS = "invoice_line_cancels";
export const isOrderId = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n > 0;
export async function loadLineCancels(sessionKey: string, platform: InvoicePlatform): Promise<Set<number> | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const uid = await ownUserId();
    if (!uid) return null;
    const sb = supabase;
    const rows = await fetchAllPages<{ order_id: number | string }>(async (page) => {
      const { data, error } = await sb.from(LINE_CANCELS).select("order_id")
        .eq("user_id", uid).eq("session_key", sessionKey).eq("platform", platform)
        .order("order_id", { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
      return error ? null : ((data || []) as { order_id: number | string }[]);
    }, PAGE);
    if (!rows) return null;
    const out = new Set<number>();
    for (const r of rows) { const n = Number(r.order_id); if (isOrderId(n)) out.add(n); }
    return out;
  } catch { return null; }
}
/** on = cancel (insert, a second one is ignored), off = undo (delete). true = saved. */
export async function saveLineCancel(sessionKey: string, platform: InvoicePlatform, orderId: number, on: boolean): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase || !isOrderId(orderId)) return false;
  try {
    const uid = await ownUserId();
    if (!uid) return false;
    if (on) {
      const { error } = await supabase.from(LINE_CANCELS).upsert(
        { user_id: uid, session_key: sessionKey, platform, order_id: orderId },
        { onConflict: "user_id,session_key,platform,order_id", ignoreDuplicates: true });
      return !error;
    }
    const { error } = await supabase.from(LINE_CANCELS).delete()
      .eq("user_id", uid).eq("session_key", sessionKey).eq("platform", platform).eq("order_id", orderId);
    return !error;
  } catch { return false; }
}
export interface LineCancelsApi {
  state: "loading" | "ready" | "error";
  cancelled: ReadonlySet<number>;
  unsaved: number;
  set: (orderId: number, on: boolean) => void;
  retry: () => void;
  reload: () => void;
}
const NO_CANCELS: ReadonlySet<number> = new Set();
/** One read when the screen / session opens, one write per tap, no timer. A tap shows at once; a write
 *  that fails stays on screen, is counted in `unsaved` and goes again on retry() or the next tap. */
export function useInvoiceLineCancels(sessionKey: string, platform: InvoicePlatform, enabled: boolean): LineCancelsApi {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [cancelled, setCancelled] = useState<Set<number>>(() => new Set());
  const [unsaved, setUnsaved] = useState(0);
  const [turn, setTurn] = useState(0);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const failed = useRef(new Map<number, boolean>());
  const scope = useRef("");
  const open = useRef(true);
  useEffect(() => { open.current = true; return () => { open.current = false; }; }, []);
  useEffect(() => {
    if (!enabled) return;
    const mine = `${sessionKey}|${platform}|${turn}`;
    scope.current = mine;
    failed.current = new Map();
    let alive = true;
    void Promise.resolve().then(() => { if (alive) { setState("loading"); setUnsaved(0); } });
    void loadLineCancels(sessionKey, platform).then((s) => {
      if (!alive || scope.current !== mine) return;
      setLoadedFor(`${sessionKey}|${platform}`);
      if (s) { setCancelled(s); setState("ready"); } else { setCancelled(new Set()); setState("error"); }
    });
    return () => { alive = false; };
  }, [sessionKey, platform, enabled, turn]);
  const write = useCallback((orderId: number, on: boolean) => {
    const mine = scope.current;
    void saveLineCancel(sessionKey, platform, orderId, on).then((ok) => {
      if (!open.current || scope.current !== mine) return;
      if (ok) { if (failed.current.get(orderId) === on) failed.current.delete(orderId); }
      else failed.current.set(orderId, on);
      setUnsaved(failed.current.size);
    });
  }, [sessionKey, platform]);
  const set = useCallback((orderId: number, on: boolean) => {
    if (!isOrderId(orderId)) return;
    setCancelled((c) => { const n = new Set(c); if (on) n.add(orderId); else n.delete(orderId); return n; });
    for (const [id, v] of [...failed.current]) if (id !== orderId) write(id, v);
    failed.current.delete(orderId);
    write(orderId, on);
  }, [write]);
  const retry = useCallback(() => { for (const [id, v] of [...failed.current]) write(id, v); }, [write]);
  const reload = useCallback(() => setTurn((n) => n + 1), []);
  if (loadedFor !== `${sessionKey}|${platform}`) return { state: "loading", cancelled: NO_CANCELS, unsaved: 0, set, retry, reload };
  return { state, cancelled, unsaved, set, retry, reload };
}

// ── the order ids of the session's lines (read only — the same small read the Orders "Paid" flag makes) ──
// A session id → that session's rows; no session id (old one-day sessions) → the rows from one minute
// before the oldest order. Read once when the screen / session opens, then only the NEW rows when the
// number of orders grows (an order made while the screen is open). No timer. Never written.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export async function loadOrderIdRows(scope: { sessionId: string | null; sinceIso: string | null }, platform: InvoicePlatform): Promise<OrderIdRow[] | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const uid = await ownUserId();
    if (!uid) return null;
    const sb = supabase;
    const sid = scope.sessionId && UUID_RE.test(scope.sessionId) ? scope.sessionId : null;
    if (!sid && !scope.sinceIso) return [];
    return await fetchAllPages<OrderIdRow>(async (page) => {
      let q = sb.from("live_session_orders").select("id,buyer_number,handle,platform,product,price,qty,created_at")
        .eq("user_id", uid).eq("platform", PLATFORM_NAME[platform]);
      if (sid) q = q.eq("session_id", sid);
      if (scope.sinceIso) q = q.gte("created_at", scope.sinceIso);
      const { data, error } = await q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(page * PAGE, page * PAGE + PAGE - 1);
      return error ? null : ((data || []) as OrderIdRow[]);
    }, PAGE);
  } catch { return null; }
}
export function useInvoiceOrderIds(buyers: Buyer[], platform: InvoicePlatform, sessionIdArg: string | null, enabled: boolean): { ids: ReadonlyMap<string, number>; state: "loading" | "ready" | "error" } {
  // only a real session id (a uuid) scopes the read; anything else = no session id → the time window
  const sessionId = sessionIdArg && UUID_RE.test(sessionIdArg) ? sessionIdArg : null;
  const [rows, setRows] = useState<{ scope: string; list: OrderIdRow[] }>({ scope: "", list: [] });
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const list = Array.isArray(buyers) ? buyers : [];
  const nums = list.flatMap((b) => b.orders.map((o) => o.orderNum)).filter((n) => Number.isFinite(n));
  const count = nums.length;
  const oldest = nums.length ? Math.min(...nums) : 0;
  const scopeKey = `${sessionId || ""}|${platform}|${sessionId ? "" : oldest}`;
  const seen = useRef({ scope: "", count: -1, newest: "" });
  const curScope = useRef(scopeKey);
  useEffect(() => { curScope.current = scopeKey; }, [scopeKey]);
  useEffect(() => {
    if (!enabled) return;
    const first = seen.current.scope !== scopeKey;
    if (!first && count <= seen.current.count) return;
    if (!sessionId && !oldest) { seen.current = { scope: scopeKey, count, newest: "" }; void Promise.resolve().then(() => setState("ready")); return; }
    // the first read takes the whole session; a later one only rows from a minute before the newest seen
    const sinceIso = first
      ? (sessionId ? null : new Date(oldest - 60_000).toISOString())
      : (seen.current.newest ? new Date(Date.parse(seen.current.newest) - 60_000).toISOString() : (sessionId ? null : new Date(oldest - 60_000).toISOString()));
    seen.current = { ...seen.current, scope: scopeKey, count };
    const mine = scopeKey;
    // not cancelled by a re-render: an answer for this session is always used (merged by row id)
    void loadOrderIdRows({ sessionId, sinceIso }, platform).then((got) => {
      if (curScope.current !== mine) return;
      if (!got) { if (first) setState("error"); return; }
      setRows((prev) => {
        const base = prev.scope === mine ? prev.list : [];
        const byId = new Map(base.map((r) => [r.id, r]));
        for (const r of got) byId.set(r.id, r);
        const merged = [...byId.values()];
        const newest = merged.reduce((a, r) => (r.created_at > a ? r.created_at : a), "");
        seen.current = { ...seen.current, newest };
        return { scope: mine, list: merged };
      });
      setState("ready");
    });
  }, [enabled, scopeKey, count, sessionId, oldest, platform]);
  const ids = rows.scope === scopeKey ? pairOrderIds(list, rows.list) : new Map<string, number>();
  return { ids, state: rows.scope === scopeKey ? state : "loading" };
}
