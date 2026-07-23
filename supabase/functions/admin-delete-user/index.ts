// admin-delete-user — Supabase Edge Function (Deno). Phase 2 of the admin
// security audit (owner decision: OPTION B — FULL WIPE, no retention, no undo).
//
// WHY AN EDGE FUNCTION: a true delete needs (1) the service_role key to bypass
// RLS + reach auth.admin, and (2) auth.admin.deleteUserById to remove the login
// account itself — neither is available to the browser anon key. The old client
// deleteUser() only removed the seller_profiles row, leaving a "half-alive" user
// (auth account survived, data orphaned, free-cap re-settable). This closes it.
//
// SECURITY (mirrors admin-set-password): deploy with `verify_jwt: true` so the
// Supabase gateway rejects unauthenticated calls, PLUS an internal is_admin()
// gate (the gateway only proves the JWT is valid, not that the caller is admin).
// Fail-closed on every path.
//
// SECRETS: uses only the auto-injected edge-runtime secrets — SUPABASE_URL,
// SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY. NO new secret to configure.
//
// MODES (body.mode):
//   "user"        — hard-delete ONE seller (by email). Guards: not self,
//                   not admin/master (see guards.ts). DEFAULT.
//   "ghost-scan"  — DRY RUN: list every auth.users with NO seller_profiles row
//                   (the half-alive leftovers) + their orphan-row counts. No delete.
//   "ghost-purge" — hard-delete every ghost from ghost-scan (same FULL WIPE).
//
// DELETE SEQUENCE (proven complete against the FK cascade map from the audit):
//   auth.users delete CASCADES to: seller_profiles, customers, live_session_orders,
//   products, raffle_config, seller_auto_codes, seller_session_config,
//   seller_shipping_settings, shipping_entries. It does NOT cascade to:
//     - orders          (FK = NO ACTION → would BLOCK the auth delete) → deleted first
//     - announcements.created_by (FK = NO ACTION) → nulled first
//     - support_messages (email-keyed, no FK)      → deleted (part of the wipe)
//   audit_logs + admin_password_log are the ADMIN audit trail (not the user's own
//   data) → KEPT, and a new audit row records this deletion (best-effort — a failed
//   audit insert never turns a completed wipe into an error).
//
// RETRY-SAFETY (NOT atomic): the wipe crosses the GoTrue auth admin HTTP API AND
// Postgres SQL, so NO single transaction can wrap both. Instead every step is
// idempotent and hardWipe is RETRY-SAFE — re-invoking it on a partially-wiped user
// converges to fully-wiped (see hardWipe's contract comment). ghost-purge wraps each
// wipe in try/catch so one failure neither aborts the batch nor skips the audit.
//
// deno-lint-ignore-file no-explicit-any
import { createClient } from "npm:@supabase/supabase-js@2";
import { checkDeleteAllowed, checkSelfDeleteAllowed, type DeleteTarget } from "./guards.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Tables keyed by user_id that the auth-delete CASCADE handles — counted (pre-delete)
// only for the honest "what was wiped" report; NOT deleted here (cascade does it).
const CASCADE_TABLES = [
  "seller_profiles", "customers", "live_session_orders", "products",
  "raffle_config", "seller_auto_codes", "seller_session_config",
  "seller_shipping_settings", "shipping_entries",
];

// The user-id column differs per table: seller_profiles keys on auth_user_id;
// every other user-owned table keys on user_id. The old hard-coded "user_id"
// made the seller_profiles count 400 with "column seller_profiles.user_id does
// not exist" on EVERY delete — it was swallowed (so it never threw), but it made
// the "what was wiped" report wrong (seller_profiles always 0). Fixed here.
function keyColumnFor(table: string): string {
  return table === "seller_profiles" ? "auth_user_id" : "user_id";
}

// Best-effort pre-delete count for the report — NEVER throws (a bad count must
// not abort a wipe). A residual error is logged (permanent failure-path logging)
// instead of masquerading as 0.
async function countRows(admin: any, table: string, uid: string): Promise<number> {
  const { count, error } = await admin.from(table).select("*", { count: "exact", head: true }).eq(keyColumnFor(table), uid);
  if (error) { console.error(`[admin-delete] countRows(${table}) failed: ${error.message}`); return 0; }
  return count ?? 0;
}

// Flattens ANY thrown value (AuthError shapes vary; a network throw is a plain
// Error) into one loggable string — name/message + any status/code/body-ish
// fields + a short stack. Never throws itself.
function describeThrow(e: unknown): string {
  if (e && typeof e === "object") {
    const o = e as Record<string, unknown>;
    const extra: Record<string, unknown> = {};
    for (const k of ["status", "code", "name", "__isAuthError", "body", "error", "error_description", "msg", "cause"]) {
      if (o[k] !== undefined) extra[k] = o[k];
    }
    const msg = typeof o.message === "string" ? o.message : "";
    const stack = typeof o.stack === "string" ? o.stack.split("\n").slice(0, 4).join(" | ") : "";
    let extraStr = "";
    try { extraStr = JSON.stringify(extra); } catch { extraStr = String(extra); }
    return `name=${o.name ?? "?"} msg=${msg} extra=${extraStr} stack=${stack}`;
  }
  try { return `raw=${JSON.stringify(e)}`; } catch { return `raw=${String(e)}`; }
}

// Idempotent + retried auth-account delete. ⚠️ TRANSACTIONAL SAFETY: a real DB
// transaction CANNOT span this + the SQL steps — the auth delete is a GoTrue admin
// HTTP call, not SQL. So the whole wipe is instead RETRY-SAFE (see hardWipe).
//
// ⚠️ DO NOT "modernize" this back to admin.auth.admin.deleteUserById — CONFIRMED
// FIX 2026-07-23 (first successful admin delete since Jul 17 came from this change):
// that SDK wrapper THREW a NON-AuthError while transforming the DELETE response
// into a user object. gotrue-js returns { error } ONLY for AuthErrors and RE-THROWS
// everything else, so the throw jumped the retry loop straight to the outer catch —
// a bare 500 with the real reason swallowed (broke EVERY admin delete Jul 17→23).
// Calling the GoTrue admin REST endpoint DIRECTLY and checking ONLY the HTTP status
// (no response-body/user parse — that parse is exactly what the SDK died on) both
// fixes it AND surfaces the raw status/body on failure. The SQL side is proven
// independently. Hard delete (should_soft_delete:false) = FULL WIPE, unchanged.
//   • 200 / 204 / 404      → success (204/200 = deleted this run; 404 = already
//                            gone from a prior partial run → idempotent success).
//   • other status / throw → bounded retry with backoff, then throw with the raw
//                            status+body / thrown value for the outer catch → 500.
async function deleteAuthUserIdempotent(_admin: any, uid: string): Promise<void> {
  const url = `${SUPABASE_URL}/auth/v1/admin/users/${uid}`;
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  let last = "unknown";
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { method: "DELETE", headers, body: JSON.stringify({ should_soft_delete: false }) });
      // STATUS-ONLY success check (no body parse): 200/204 deleted, 404 already-gone.
      if (res.status === 200 || res.status === 204 || res.status === 404) return;
      const bodyText = (await res.text().catch(() => "")).slice(0, 800);
      last = `status=${res.status} body=${bodyText}`;
      console.error(`[admin-delete] deleteUser REST FAIL attempt=${attempt} ${last}`);   // permanent failure-path logging
    } catch (e) {
      last = describeThrow(e);
      console.error(`[admin-delete] deleteUser REST THREW attempt=${attempt} ${last}`);  // permanent failure-path logging
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 200 * attempt)); // 200ms, 400ms — no sleep after the final attempt
  }
  throw new Error(`auth deleteUser failed after retries: ${last}`);
}

// The single-user FULL WIPE, shared by mode "user" and "ghost-purge". Assumes the
// caller's admin + self/admin-master guards already passed. Order is load-bearing:
// non-cascading refs FIRST, then the auth-account delete triggers the cascade.
//
// ⚠️ RETRY-SAFETY CONTRACT (atomicity is impossible at the auth-API+SQL boundary):
// every step is IDEMPOTENT, so re-invoking hardWipe on a PARTIALLY-wiped user
// converges to fully-wiped — a failed step throws → 500 → the caller simply calls
// again with the SAME args. On the 2nd run: the row-deletes match 0 rows, the
// announcements-null matches 0 rows, and the auth delete treats "already gone" as
// success. There is NO state a retry cannot finish. The only visible artifact of a
// mid-wipe failure is that this user's billing `orders` are removed before the auth
// account (required — FK NO ACTION would otherwise block the cascade); a retry
// completes the rest. Each SQL step's error is surfaced (throw) so a partial
// failure is diagnosable + triggers the retry rather than being silently swallowed.
async function hardWipe(admin: any, uid: string, email: string): Promise<Record<string, number | string>> {
  const wiped: Record<string, number | string> = { email, userId: uid };
  // pre-count the cascade tables (for the report — cascade fires inside the auth delete)
  for (const t of CASCADE_TABLES) wiped[t] = await countRows(admin, t, uid);

  // 1. orders — FK NO ACTION: MUST go before the auth delete or it blocks (FULL WIPE = delete billing too). Idempotent (re-run = 0 rows).
  const ord = await admin.from("orders").delete().eq("user_id", uid).select("id");
  if (ord.error) throw new Error(`orders delete failed: ${ord.error.message}`);
  wiped.orders = ord.data?.length ?? 0;
  // 2. announcements.created_by — FK NO ACTION: null it so the auth delete isn't blocked. Idempotent.
  const ann = await admin.from("announcements").update({ created_by: null }).eq("created_by", uid).select("id");
  if (ann.error) throw new Error(`announcements clear failed: ${ann.error.message}`);
  wiped.announcements_cleared = ann.data?.length ?? 0;
  // 3. support_messages — email-keyed, no FK, no cascade → part of the wipe. Idempotent.
  const sm = await admin.from("support_messages").delete().ilike("email", email).select("id");
  if (sm.error) throw new Error(`support_messages delete failed: ${sm.error.message}`);
  wiped.support_messages = sm.data?.length ?? 0;
  // 4. the auth account — CASCADE wipes every CASCADE_TABLES row above. Idempotent + retried.
  await deleteAuthUserIdempotent(admin, uid);
  return wiped;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ success: false, error: "method_not_allowed" }, 405);
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) return json({ success: false, error: "not_configured" }, 500);

  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader) return json({ success: false, error: "unauthorized" }, 401);

  // Caller-scoped client (their JWT) → identity + server-side admin gate.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user: caller }, error: whoErr } = await userClient.auth.getUser();
  if (whoErr || !caller) return json({ success: false, error: "unauthorized" }, 401);

  let body: any = {};
  try { body = await req.json(); } catch { /* empty body ok */ }
  const mode: string = body.mode || "user";

  // AUTHORIZATION is mode-aware: the admin modes (user / ghost-*) require the
  // server-side is_admin() gate; the SELF mode is reachable by any authenticated
  // seller (they can only ever delete themselves, and checkSelfDeleteAllowed
  // still blocks admin/master self-wipes below). This is why the gate can't sit
  // before the mode dispatch.
  if (mode !== "self") {
    const { data: isAdmin, error: adminErr } = await userClient.rpc("is_admin");
    if (adminErr || isAdmin !== true) return json({ success: false, error: "forbidden" }, 403);
  }

  // Service client (bypasses RLS + reaches auth.admin). Only ever reached after
  // the mode-aware gate above.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  try {
    // ── mode "self": a seller deletes THEIR OWN account (full wipe) ──────────
    if (mode === "self") {
      const { data: prof, error: sErr } = await admin
        .from("seller_profiles").select("role, plan, email").eq("auth_user_id", caller.id).maybeSingle();
      if (sErr) throw new Error(`self profile lookup failed: ${sErr.message}`);
      // Guard: admin/master accounts may NOT self-delete (protected).
      const guard = checkSelfDeleteAllowed(prof?.role ?? null, prof?.plan ?? null);
      if (!guard.allowed) return json({ success: false, error: guard.error, code: guard.code }, 403);
      const email = String(prof?.email ?? caller.email ?? "").trim().toLowerCase();
      const wiped = await hardWipe(admin, caller.id, email);
      // Best-effort audit — a failed insert must NOT report a completed wipe as an error.
      try {
        await admin.from("audit_logs").insert({
          actor_email: email, action: "self-deleted account", target_email: email, details: JSON.stringify(wiped),
        });
      } catch { /* audit is best-effort; the wipe already happened */ }
      return json({ success: true, mode: "self", deleted: wiped });
    }

    // ── GHOST modes: auth.users with NO seller_profiles row ──────────────────
    if (mode === "ghost-scan" || mode === "ghost-purge") {
      // 1. all profile auth_user_ids (the "has a profile" set)
      const { data: profs, error: pErr } = await admin.from("seller_profiles").select("auth_user_id");
      if (pErr) throw new Error(`profile scan failed: ${pErr.message}`);
      const hasProfile = new Set<string>((profs ?? []).map((r: any) => r.auth_user_id));
      // 2. every auth user (paginated)
      const ghosts: { userId: string; email: string }[] = [];
      let page = 1;
      for (;;) {
        const { data: list, error: lErr } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (lErr) throw new Error(`listUsers failed: ${lErr.message}`);
        const users = list?.users ?? [];
        for (const u of users) if (!hasProfile.has(u.id)) ghosts.push({ userId: u.id, email: u.email ?? "" });
        if (users.length < 200) break;
        page += 1;
      }
      if (mode === "ghost-scan") {
        // DRY RUN: enrich each ghost with orphan-row counts so the owner can review first
        const detail = [];
        for (const g of ghosts) {
          const counts: Record<string, number> = {};
          for (const t of ["orders", ...CASCADE_TABLES]) counts[t] = await countRows(admin, t, g.userId);
          detail.push({ ...g, orphanRows: counts });
        }
        return json({ success: true, mode, count: ghosts.length, ghosts: detail });
      }
      // ghost-purge: FULL WIPE each (ghosts have no profile → cannot be admin/master; still never the caller).
      // Per-ghost try/catch: one failing wipe must NOT abort the batch NOR skip the audit — the loop
      // continues, failures are collected, and the audit ALWAYS records the real outcome afterward.
      const purged = [];
      const failed: { userId: string; email: string; error: string }[] = [];
      for (const g of ghosts) {
        if (g.userId === caller.id) continue; // paranoia: caller always has a profile, so never a ghost
        try {
          purged.push(await hardWipe(admin, g.userId, g.email));
        } catch (e) {
          failed.push({ userId: g.userId, email: g.email, error: e instanceof Error ? e.message : "wipe failed" });
        }
      }
      // Best-effort audit — ALWAYS attempted (even if some/all wipes failed) and never
      // allowed to turn a completed purge into a 500. Records purged + failed both.
      try {
        await admin.from("audit_logs").insert({
          actor_email: caller.email, action: "ghost-purge",
          target_email: `${purged.length} purged${failed.length ? `, ${failed.length} failed` : ""}`,
          details: JSON.stringify({ purged: purged.map((p) => p.email), failed }),
        });
      } catch { /* audit is best-effort; the purge already happened */ }
      return json({ success: true, mode, purged: purged.length, failed: failed.length, detail: purged, failures: failed });
    }

    // ── mode "user": hard-delete ONE seller by email ─────────────────────────
    const email = String(body.email ?? "").trim().toLowerCase();
    if (!email) return json({ success: false, error: "email_required" }, 400);

    // Resolve target from seller_profiles (auth_user_id + role + plan for the guards).
    const { data: prof, error: profErr } = await admin
      .from("seller_profiles").select("auth_user_id, role, plan").ilike("email", email).maybeSingle();
    if (profErr) throw new Error(`profile lookup failed: ${profErr.message}`);
    const target: DeleteTarget = {
      authUserId: prof?.auth_user_id ?? null, email, role: prof?.role ?? null, plan: prof?.plan ?? null,
    };
    // HARD GUARDS (pure, unit-tested) — not self, not admin/master, must exist.
    const guard = checkDeleteAllowed(caller.id, target);
    if (!guard.allowed) return json({ success: false, error: guard.error, code: guard.code }, 400);

    const wiped = await hardWipe(admin, target.authUserId!, email);
    // audit trail (kept — records the deletion; service role bypasses RLS). Best-effort:
    // a failed insert must NOT report a completed wipe as an error (the wipe is retry-safe
    // but re-running is pointless once it's done — don't mislead the admin into retrying).
    try {
      await admin.from("audit_logs").insert({
        actor_email: caller.email, action: "hard-deleted seller", target_email: email,
        details: JSON.stringify(wiped),
      });
    } catch { /* audit is best-effort; the wipe already happened */ }
    return json({ success: true, mode: "user", deleted: wiped });
  } catch (e) {
    return json({ success: false, error: e instanceof Error ? e.message : "delete_failed" }, 500);
  }
});
