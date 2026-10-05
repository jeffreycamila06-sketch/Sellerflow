// FACEBOOK LIVE — server-side lock, mirroring the client gate (src/redesign/adapters/fbPreview.ts
// + loadFbEnabled + GET /fb/access): Facebook is available when app_settings.fb_enabled is 'true'
// OR the caller is one of the preview accounts OR has an enabled row in fb_tester_access (sql/77,
// service role only). DB testers do NOT skip any plan check (only the hard-coded preview list
// does). Applied after requireAuth to GET /fb/oauth/start, GET /fb/pages and
// POST /fb/connect. NOT to /fb/disconnect (stopping must always work) and not to the OAuth
// callback (its signed state can only come from a locked /fb/oauth/start). The /fb/receipt/*
// routes keep their own fb_receipt_access gate.
//
// ⚠️ The preview list exists twice (here + fbPreview.ts); a test fails if they differ.

export const FB_PREVIEW_EMAILS = ["camilajeffrey1@gmail.com", "googletest@gmail.com", "test@gmail.com"];
export const FB_FLAG_TTL_MS = 60 * 1000;

export function fbPreviewEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  return e !== "" && FB_PREVIEW_EMAILS.includes(e);
}

// fb_enabled reader: a successful read is cached for 60 s. On a read error the last value that was
// read successfully is used (false if there never was one), and the next read is again 60 s later.
// Concurrent callers share one in-flight read. readFlag() resolves the raw value (null/undefined
// for a missing row) or throws.
export function createFbFlagReader({ readFlag, now = () => Date.now(), ttlMs = FB_FLAG_TTL_MS }) {
  let lastGood = null;       // boolean | null
  let checkedAt = -Infinity; // time of the last read attempt (success or error)
  let inFlight = null;
  return async function fbEnabled() {
    if (now() - checkedAt < ttlMs) return lastGood === true;
    if (!inFlight) {
      inFlight = (async () => {
        try {
          const v = await readFlag();
          lastGood = String(v ?? "").trim() === "true";
        } catch {
          /* keep lastGood */
        } finally {
          checkedAt = now();
          inFlight = null;
        }
      })();
    }
    await inFlight;
    return lastGood === true;
  };
}

export const FB_TESTER_CACHE_MAX = 1000; // emails kept in the tester cache (oldest dropped)

// fb_tester_access reader, per email: the same rules as createFbFlagReader — a successful read is
// cached 60 s; on a read error the last value read successfully for THAT email is used (false if
// there never was one) and the next read is again 60 s later; concurrent callers for one email
// share one in-flight read. readTester(emailLowerCase) resolves true (enabled row) / false, or
// throws. Empty email → false, no read.
export function createFbTesterReader({ readTester, now = () => Date.now(), ttlMs = FB_FLAG_TTL_MS, max = FB_TESTER_CACHE_MAX }) {
  const cache = new Map(); // email → { lastGood: boolean|null, checkedAt, inFlight }
  return async function isFbTester(email) {
    const e = String(email || "").trim().toLowerCase();
    if (!e) return false;
    let c = cache.get(e);
    if (!c) {
      c = { lastGood: null, checkedAt: -Infinity, inFlight: null };
      cache.set(e, c);
      while (cache.size > max) cache.delete(cache.keys().next().value);
    }
    if (now() - c.checkedAt < ttlMs) return c.lastGood === true;
    if (!c.inFlight) {
      const entry = c;
      entry.inFlight = (async () => {
        try {
          entry.lastGood = (await readTester(e)) === true;
        } catch {
          /* keep lastGood */
        } finally {
          entry.checkedAt = now();
          entry.inFlight = null;
        }
      })();
    }
    await c.inFlight;
    return c.lastGood === true;
  };
}

// The Facebook decision shared by the lock and GET /fb/access: preview (no read) → flag → tester.
// Never throws; any failure counts as "no".
export async function fbFacebookAllowed({ email, fbEnabled, isFbTester = null }) {
  if (fbPreviewEmail(email)) return true;
  try { if ((await fbEnabled()) === true) return true; } catch { /* flag unreadable → not on */ }
  try { return typeof isFbTester === "function" && (await isFbTester(email)) === true; } catch { return false; }
}

// Express middleware: allowed → next(); else 403 { ok:false, error:"fb_not_available" } and nothing
// else runs. The preview check needs no database read.
export function createFbLock({ fbEnabled, isFbTester = null }) {
  return async function requireFbAvailable(req, res, next) {
    if (await fbFacebookAllowed({ email: req.userEmail, fbEnabled, isFbTester })) return next();
    return res.status(403).json({ ok: false, error: "fb_not_available" });
  };
}

// GET /fb/access (after requireAuth) → { ok:true, facebook, receipt }. facebook = the lock's
// decision; receipt = hasReceiptAccess (fb_receipt_access) for this user. Never 500s — any
// failure answers false for that part.
export function createFbAccessHandler({ fbEnabled, isFbTester = null, hasReceiptAccess = null }) {
  return async function fbAccess(req, res) {
    const facebook = await fbFacebookAllowed({ email: req.userEmail, fbEnabled, isFbTester });
    let receipt = false;
    try { receipt = typeof hasReceiptAccess === "function" && (await hasReceiptAccess(req.authUserId)) === true; } catch { receipt = false; }
    return res.json({ ok: true, facebook, receipt });
  };
}

// ── Facebook-only plan check on POST /fb/connect (mirrors the client's isFbEligible) ──────────
// The shared checkPlanActive (TikTok/Shopee too) lets plan "free" through whatever its status;
// the client allows a free plan only when plan_status is "active". This check closes that gap
// for Facebook only. Admin and preview accounts pass; a paid plan keeps requirePlanActive's
// decision (not re-decided here). Plan name compared case-insensitively, like isFreePlan.
export const isFreePlanName = (plan) => String(plan || "").trim().toLowerCase() === "free";
export const isAdminRoleName = (role) => String(role || "").trim().toLowerCase() === "admin";

export function fbPlanAllowed({ email, role, plan, planStatus }) {
  if (fbPreviewEmail(email)) return true;
  if (isAdminRoleName(role)) return true;
  if (isFreePlanName(plan)) return planStatus === "active";
  return true; // paid: requirePlanActive already decided
}

// Runs AFTER requirePlanActive, which attaches req.sellerPlan / req.sellerRole (but not
// plan_status). No extra read for preview, admin or a known paid plan. For a free plan — or an
// unknown plan, when requirePlanActive failed open — ONE read of { plan, plan_status, role }.
// If that read fails: unknown plan → allow (stay consistent with requirePlanActive's fail-open);
// known free plan → refuse. Refused → 403 { ok:false, error:"plan_expired" }.
export function createFbPlanCheck({ readProfile }) {
  return async function requireFbPlan(req, res, next) {
    const deny = () => res.status(403).json({ ok: false, error: "plan_expired" });
    if (fbPreviewEmail(req.userEmail) || isAdminRoleName(req.sellerRole)) return next();
    const knownPlan = typeof req.sellerPlan === "string" ? req.sellerPlan : null;
    if (knownPlan !== null && !isFreePlanName(knownPlan)) return next();
    let row;
    try { row = await readProfile(req.authUserId); } catch { row = undefined; }
    if (row === undefined) return knownPlan === null ? next() : deny();
    if (!row) return deny();
    return fbPlanAllowed({ email: req.userEmail, role: row.role, plan: row.plan, planStatus: row.plan_status }) ? next() : deny();
  };
}
