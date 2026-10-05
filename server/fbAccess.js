// FACEBOOK LIVE — server-side lock, mirroring the client gate (src/redesign/adapters/fbPreview.ts
// + loadFbEnabled): Facebook is available when app_settings.fb_enabled is 'true' OR the caller is
// one of the preview accounts. Applied after requireAuth to GET /fb/oauth/start, GET /fb/pages and
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

// Express middleware: allowed → next(); else 403 { ok:false, error:"fb_not_available" } and nothing
// else runs. The preview check needs no database read.
export function createFbLock({ fbEnabled }) {
  return async function requireFbAvailable(req, res, next) {
    if (fbPreviewEmail(req.userEmail)) return next();
    let on = false;
    try { on = (await fbEnabled()) === true; } catch { on = false; }
    if (on) return next();
    return res.status(403).json({ ok: false, error: "fb_not_available" });
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
