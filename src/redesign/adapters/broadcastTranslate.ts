// Client side of the admin broadcast auto-translation. Calls the live server's
// admin-guarded POST /admin/broadcast-translate with the caller's Supabase JWT
// (server re-checks is_admin — this is NOT a UI-only gate). One outbound call
// per SEND; no Supabase egress, no polling. Returns the full 7-language map on
// success, or an honest error so the composer can offer "send English only".
import { SERVER } from "./serverIdentity";
import { supabase } from "../../supabase";

export interface TranslateResult {
  ok: boolean;
  i18n?: Record<string, string>;
  error?: string;
  unreachable?: boolean; // server not reachable (offer English-only fallback)
}

export async function translateBroadcast(text: string): Promise<TranslateResult> {
  const src = String(text || "").trim();
  if (!src) return { ok: false, error: "empty" };
  try {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null;
    const r = await fetch(`${SERVER}/admin/broadcast-translate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
      body: JSON.stringify({ text: src }),
    });
    const j = await r.json().catch(() => ({} as { success?: boolean; i18n?: Record<string, string>; error?: string }));
    if (r.status === 403) return { ok: false, error: "forbidden" };
    if (!r.ok || !j.success || !j.i18n) return { ok: false, error: j.error || `http_${r.status}` };
    return { ok: true, i18n: j.i18n };
  } catch {
    // Server not deployed yet / offline → honest error, offer English-only.
    return { ok: false, error: "unreachable", unreachable: true };
  }
}
