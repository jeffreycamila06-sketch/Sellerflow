// MESSENGER RECEIPT step 2 — client half of /fb/receipt/info + /fb/receipt/send
// (server/fbReceipt.js). Same fetch + Supabase bearer pattern as fbConnect. The server picks
// the comment and the page from the database; the client only names the buyer of the
// session and sends the picture.
import type { RedesignT } from "../i18n";
import { supabase } from "../../supabase";
import { SERVER } from "./serverIdentity";
import { log } from "../../lib/log";
import { decodeServerJson, withCodes } from "../../lib/errCodes.js";

export const RECEIPT_CLIENT_MAX_BYTES = 3 * 1024 * 1024;

export type FbReceiptReason = "no_access" | "no_orders" | "needs_messaging" | "none_left" | "mixed_buyer";
export interface FbReceiptInfo { ok: true; canSend: boolean; reason?: FbReceiptReason; sentCount: number; lastSentAt: string | null; remaining: number }
export type FbReceiptSendResult =
  | { ok: true; sentCount: number; remaining: number; lastSentAt: string | null }
  | { ok: false; error: string; code?: number; fbCode?: string }; // fbCode = Facebook "code/subcode", e.g. "100/1893060"

async function bearer(): Promise<string> {
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    return session?.access_token || "";
  } catch {
    return "";
  }
}

async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(withCodes(`${SERVER}${path}`), {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await bearer()}` },
    body: JSON.stringify(body),
  });
  const json = decodeServerJson(await r.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: r.status, json };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

// → FbReceiptInfo, or { ok:false } on any failure (the caller shows an inline note).
export async function fbReceiptInfo(sessionId: string, buyerNumber: number): Promise<FbReceiptInfo | { ok: false; error: string }> {
  try {
    const { status, json } = await post("/fb/receipt/info", { sessionId, buyerNumber });
    if (status !== 200 || json.ok !== true) return { ok: false, error: String(json.error || `http_${status}`) };
    return {
      ok: true,
      canSend: json.canSend === true,
      reason: typeof json.reason === "string" ? (json.reason as FbReceiptReason) : undefined,
      sentCount: num(json.sentCount),
      lastSentAt: typeof json.lastSentAt === "string" ? json.lastSentAt : null,
      remaining: num(json.remaining),
    };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

export async function fbReceiptSend(sessionId: string, buyerNumber: number, imagePngBase64: string): Promise<FbReceiptSendResult> {
  try {
    const { json } = await post("/fb/receipt/send", { sessionId, buyerNumber, imagePngBase64 });
    if (json.ok === true) return { ok: true, sentCount: num(json.sentCount), remaining: num(json.remaining), lastSentAt: typeof json.lastSentAt === "string" ? json.lastSentAt : null };
    return {
      ok: false, error: String(json.error || "send_failed"),
      ...(typeof json.code === "number" ? { code: json.code } : {}),
      ...(typeof json.fb_code === "string" && /^\d+\/\d+$/.test(json.fb_code) ? { fbCode: json.fb_code } : {}),
    };
  } catch {
    return { ok: false, error: "unreachable" };
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || "").replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(new Error("read_failed"));
    r.readAsDataURL(blob);
  });
}

// Facebook code 10903: a private reply to this commenter is not allowed (they commented as a
// Page, or their settings block it). Retrying cannot help, so the sheet says so instead.
export const FB_NO_PRIVATE_REPLY_CODE = 10903;
// The failed-send note: the generic text, or the 10903 text, + "(FB code/subcode)" when the server sent it —
// the same style as the connect toast. polish (fb_polish_v2): no code on screen (console only) —
// 10903 → its own text, 190 → "access expired", anything else with a code → "Facebook refused".
export function receiptFailText(r: { code?: number; fbCode?: string }, t: RedesignT, polish = false): string {
  const code = typeof r.code === "number" ? r.code : r.fbCode ? Number(r.fbCode.split("/")[0]) : NaN;
  if (polish) {
    if (r.fbCode || Number.isFinite(code)) log.info(`[FB] receipt failed code=${r.fbCode || code}`);
    if (code === FB_NO_PRIVATE_REPLY_CODE) return t.rd_rs_no_private_reply;
    if (code === 190) return t.rd_fb_err_expired;
    return Number.isFinite(code) ? t.rd_fb_err_refused : t.rd_rs_failed;
  }
  // Build 10: never a Facebook code on screen. A refusal with a code → "reconnect your Page".
  if (code === FB_NO_PRIVATE_REPLY_CODE) return t.rd_rs_no_private_reply;
  return r.fbCode ? t.rd_cm_reconnect_page : t.rd_rs_failed; // no fb_code (old server / no Graph answer) → plain text
}
