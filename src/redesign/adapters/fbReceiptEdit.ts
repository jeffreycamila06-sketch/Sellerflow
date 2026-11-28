// INVOICING → FACEBOOK: the seller's saved edit of one buyer's Messenger receipt (sql/233 fb_receipt_edits).
// One read when a session's Facebook list opens (no timer, no poll), one upsert per save (the editor waits a
// moment after the last change), one delete for "Reset to original". RLS: own rows only. The server's Send all
// reads the same rows (service role) and draws them (server/fbSendAll.js). Nothing here touches an order,
// Sales, a sticker or the saved receipt format.
import { useCallback, useEffect, useRef, useState } from "react";
import { isSupabaseConfigured, supabase } from "../../supabase";
import { cleanReceiptEdit, type ReceiptEdit } from "../../lib/receiptEdit.js";

export const FB_EDIT_SAVE_MS = 800;
const TABLE = "fb_receipt_edits";
const HASH_RE = /^[0-9a-z]{1,40}$/;
export interface SavedReceiptEdit { edit: ReceiptEdit; basedOn: string | null }

async function ownUserId(): Promise<string | null> {
  if (!supabase) return null;
  try { return (await supabase.auth.getSession()).data.session?.user?.id ?? null; } catch { return null; }
}
/** A session's saved edits → buyer number → edit. null = the read failed. The table not there yet (sql/233 not
 *  applied) = no edits. */
export async function loadReceiptEdits(sessionId: string): Promise<Map<number, SavedReceiptEdit> | null> {
  if (!isSupabaseConfigured || !supabase) return null;
  try {
    const { data, error } = await supabase.from(TABLE).select("buyer_number, opening, lines, shipping_fee, note, based_on").eq("session_id", sessionId);
    if (error) return ["42P01", "PGRST205"].includes(String((error as { code?: string }).code)) ? new Map() : null;
    const out = new Map<number, SavedReceiptEdit>();
    for (const r of (data || []) as Record<string, unknown>[]) {
      const n = Number(r.buyer_number);
      if (Number.isInteger(n) && n > 0) out.set(n, { edit: cleanReceiptEdit(r), basedOn: typeof r.based_on === "string" ? r.based_on : null });
    }
    return out;
  } catch { return null; }
}
/** One upsert. true = saved. */
// `signal`: a save given up on (no answer in time) is called off, so it cannot land later over a newer one
type Abortable<T> = T & { abortSignal?: (s: AbortSignal) => T };
const withSignal = <T,>(q: Abortable<T>, signal?: AbortSignal): T => (signal && typeof q.abortSignal === "function" ? q.abortSignal(signal) : q);
export async function saveReceiptEdit(sessionId: string, buyerNumber: number, edit: ReceiptEdit, basedOn: string | null, signal?: AbortSignal): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const uid = await ownUserId();
    if (!uid || signal?.aborted) return false;
    const e = cleanReceiptEdit(edit);
    const { error } = await withSignal(supabase.from(TABLE).upsert({
      user_id: uid, session_id: sessionId, buyer_number: buyerNumber,
      opening: e.opening, note: e.note, lines: e.lines, shipping_fee: e.shippingFee,
      based_on: basedOn && HASH_RE.test(basedOn) ? basedOn : null,
    }, { onConflict: "user_id,session_id,buyer_number" }) as Abortable<PromiseLike<{ error: unknown }>>, signal);
    return !error;
  } catch { return false; }
}
/** "Reset to original" (or an edit put back exactly as the orders): the row goes. true = gone. */
export async function deleteReceiptEdit(sessionId: string, buyerNumber: number, signal?: AbortSignal): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return false;
  try {
    const uid = await ownUserId();
    if (!uid || signal?.aborted) return false;
    const { error } = await withSignal(supabase.from(TABLE).delete().eq("user_id", uid).eq("session_id", sessionId).eq("buyer_number", buyerNumber) as Abortable<PromiseLike<{ error: unknown }>>, signal);
    return !error;
  } catch { return false; }
}

// ── saves that outlive the editor (2026-11-28 save fix) ──────────────────────────────────────────────
// A save keeps going when the editor closes or the Facebook list is drawn again (a new order, a tab switch):
// its result is told to EVERY list of that session on screen (put), and while it is on its way — or after it
// failed — the list knows that buyer's receipt is not saved yet, so Send all / Send wait instead of drawing the
// old receipt. A save that gets no answer in FB_EDIT_SAVE_TIMEOUT_MS counts as failed (the seller sees it and
// can save again) instead of waiting forever; that save is called off, and a moment later every list of the
// session reads the edits again, so the screen shows what the server really has.
export const FB_EDIT_SAVE_TIMEOUT_MS = 15000;
export const FB_EDIT_REREAD_MS = 3000;
/** a second read later still: a write the server got just before the call-off may land late */
export const FB_EDIT_REREAD_LATE_MS = 15000;
let rereadMs = FB_EDIT_REREAD_MS;
let rereadLateMs = FB_EDIT_REREAD_LATE_MS;
let saveTimeoutMs = FB_EDIT_SAVE_TIMEOUT_MS;
const keyOf = (sessionId: string, n: number) => `${sessionId}|${n}`;
const inFlight = new Map<string, number>();
const failedKeys = new Set<string>();
// what THIS phone last heard the server confirm for a receipt (JSON of the clean edit, "null" = no edit). A read
// that finds something else there (a write given up on that landed late) marks that receipt "not saved" so Send
// all waits and the seller looks at it.
const confirmed = new Map<string, string>();
const fingerprint = (v: SavedReceiptEdit | null | undefined) => (v ? JSON.stringify(cleanReceiptEdit(v.edit)) : "null");
type Listener = (e: { sessionId: string; buyerNumber: number; value?: SavedReceiptEdit | null; reread?: boolean }) => void;
const listeners = new Set<Listener>();
const tell = (e: Parameters<Listener>[0]) => { for (const f of [...listeners]) f(e); };

/** Save (or remove, `edit` null) one buyer's edit. true = the server confirmed. */
export async function persistReceiptEdit(sessionId: string, buyerNumber: number, edit: ReceiptEdit | null, basedOn: string | null, timeoutMs = saveTimeoutMs): Promise<boolean> {
  const k = keyOf(sessionId, buyerNumber);
  inFlight.set(k, (inFlight.get(k) ?? 0) + 1);
  tell({ sessionId, buyerNumber });
  let timer: ReturnType<typeof setTimeout> | null = null;
  let timedOut = false;
  const stop = typeof AbortController === "function" ? new AbortController() : null;
  const late = new Promise<boolean>((r) => { timer = setTimeout(() => { timedOut = true; stop?.abort(); r(false); }, timeoutMs); });
  const call = edit ? saveReceiptEdit(sessionId, buyerNumber, edit, basedOn, stop?.signal) : deleteReceiptEdit(sessionId, buyerNumber, stop?.signal);
  const ok = await Promise.race([call, late]).catch(() => false);
  if (timer) clearTimeout(timer);
  if (timedOut) for (const ms of [rereadMs, rereadLateMs]) setTimeout(() => tell({ sessionId, buyerNumber, reread: true }), ms);
  const left = (inFlight.get(k) ?? 1) - 1;
  if (left > 0) inFlight.set(k, left); else inFlight.delete(k);
  const value: SavedReceiptEdit | null = edit ? { edit: cleanReceiptEdit(edit), basedOn: basedOn && HASH_RE.test(basedOn) ? basedOn : null } : null;
  if (ok) { failedKeys.delete(k); confirmed.set(k, fingerprint(value)); } else failedKeys.add(k);
  tell(ok ? { sessionId, buyerNumber, value } : { sessionId, buyerNumber });
  return ok;
}
/** Read the session's edits again on every list (after a save the seller gave up on — Discard). */
export function rereadReceiptEdits(sessionId: string, buyerNumber: number): void { tell({ sessionId, buyerNumber, reread: true }); }
/** The seller looked at that buyer's receipt again (saved it, put it back, or chose Discard): no warning. */
export function clearReceiptEditFailed(sessionId: string, buyerNumber: number): void {
  if (failedKeys.delete(keyOf(sessionId, buyerNumber))) tell({ sessionId, buyerNumber });
}
const numsOf = (sessionId: string, from: Iterable<string>) => [...from].filter((k) => k.startsWith(`${sessionId}|`)).map((k) => Number(k.slice(sessionId.length + 1))).sort((a, b) => a - b);
/** test helper: forget every save that is on its way / failed */
export function _resetReceiptEditSaves(timeoutMs = FB_EDIT_SAVE_TIMEOUT_MS, rereadAfterMs = FB_EDIT_REREAD_MS, rereadLateAfterMs = FB_EDIT_REREAD_LATE_MS): void {
  inFlight.clear(); failedKeys.clear(); confirmed.clear(); saveTimeoutMs = timeoutMs; rereadMs = rereadAfterMs; rereadLateMs = rereadLateAfterMs;
}

/** The saved edits of the session on screen: read once per session; every save / reset of that session (from
 *  any editor, even one already closed) is applied as soon as the server confirms it. `saving` / `failed` = the
 *  buyer numbers whose receipt is not saved yet. */
export function useReceiptEdits(sessionId: string | null): {
  state: "loading" | "ready" | "error"; edits: Map<number, SavedReceiptEdit>; reload: () => void;
  put: (buyerNumber: number, v: SavedReceiptEdit | null) => void;
  saving: number[]; failed: number[];
} {
  const [got, setGot] = useState<{ key: string; edits: Map<number, SavedReceiptEdit> | null; state: "loading" | "ready" | "error" }>({ key: "", edits: null, state: "loading" });
  const [turn, setTurn] = useState(0);
  const [, setTick] = useState(0);
  const key = sessionId || "";
  // saves confirmed WHILE a read is on its way may not be in what it reads: they are kept and put on top of it
  // (else the read would wipe a newer saved edit off the list and the sheet would start from the old receipt)
  const reading = useRef<{ key: string; arrivals: Map<number, SavedReceiptEdit | null> } | null>(null);
  useEffect(() => {
    if (!key) return;
    let alive = true;
    const run = { key, arrivals: new Map<number, SavedReceiptEdit | null>() };
    reading.current = run;
    void loadReceiptEdits(key).then((m) => {
      if (!alive) return;
      if (reading.current === run) reading.current = null;
      let flagged = false;
      if (m) {
        for (const [n, v] of run.arrivals) { if (v) m.set(n, v); else m.delete(n); }
        for (const [k, fp] of confirmed) {
          if (!k.startsWith(`${key}|`)) continue;
          const n = Number(k.slice(key.length + 1));
          if (inFlight.has(k) || fingerprint(m.get(n)) === fp) continue;
          failedKeys.add(k); confirmed.delete(k); flagged = true;    // not what this phone saved last: look at it
        }
      }
      setGot({ key, edits: m, state: m ? "ready" : "error" });
      if (flagged) setTick((x) => x + 1);
    });
    return () => { alive = false; };
  }, [key, turn]);
  const reload = useCallback(() => setTurn((n) => n + 1), []);
  const put = useCallback((n: number, v: SavedReceiptEdit | null) => setGot((g) => {
    if (g.key !== key || !g.edits) return g;
    const m = new Map(g.edits);
    if (v) m.set(n, v); else m.delete(n);
    return { ...g, edits: m };
  }), [key]);
  useEffect(() => {
    if (!key) return;
    const on: Listener = (e) => {
      if (e.sessionId !== key) return;
      if (e.reread) setTurn((n) => n + 1);
      else if (e.value !== undefined) {
        const r = reading.current;
        if (r && r.key === key) r.arrivals.set(e.buyerNumber, e.value);
        put(e.buyerNumber, e.value);
      }
      setTick((n) => n + 1);
    };
    listeners.add(on);
    return () => { listeners.delete(on); };
  }, [key, put]);
  const mine = got.key === key ? got : null;
  return {
    state: !key ? "ready" : mine ? mine.state : "loading", edits: mine?.edits ?? new Map(), reload, put,
    saving: key ? numsOf(key, inFlight.keys()) : [], failed: key ? numsOf(key, failedKeys) : [],
  };
}
