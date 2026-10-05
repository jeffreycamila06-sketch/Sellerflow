// MESSENGER RECEIPT step 2 — client half of /fb/receipt/info + /fb/receipt/send
// (server/fbReceipt.js). Same fetch + Supabase bearer pattern as fbConnect. The server picks
// the comment and the page from the database; the client only names the buyer of the
// session and sends the picture.
import { supabase } from "../../supabase";
import { SERVER } from "./serverIdentity";

export const RECEIPT_CLIENT_MAX_BYTES = 3 * 1024 * 1024;

export type FbReceiptReason = "no_access" | "no_orders" | "needs_messaging" | "none_left" | "mixed_buyer";
export interface FbReceiptInfo { ok: true; canSend: boolean; reason?: FbReceiptReason; sentCount: number; lastSentAt: string | null; remaining: number }
export type FbReceiptSendResult =
  | { ok: true; sentCount: number; remaining: number; lastSentAt: string | null }
  | { ok: false; error: string; code?: number };

async function bearer(): Promise<string> {
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    return session?.access_token || "";
  } catch {
    return "";
  }
}

async function post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const r = await fetch(`${SERVER}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await bearer()}` },
    body: JSON.stringify(body),
  });
  const json = (await r.json().catch(() => ({}))) as Record<string, unknown>;
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
    return { ok: false, error: String(json.error || "send_failed"), ...(typeof json.code === "number" ? { code: json.code } : {}) };
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
