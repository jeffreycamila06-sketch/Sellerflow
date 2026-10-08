// INSTAGRAM LIVE — server-side lock (phase 1). Instagram is available when app_settings
// ig_enabled is 'true' OR the caller is a preview account (the SAME list as Facebook,
// FB_PREVIEW_EMAILS — imported, so the two can never drift) OR has an enabled
// ig_tester_access row. The flag / tester readers are server/fbAccess.js's generic
// createFbFlagReader / createFbTesterReader, built in server.js on the IG table + key.
// Applied after requireAuth to /ig/oauth/start, /ig/accounts and /ig/connect — never to
// /ig/disconnect (stopping must always work) or the OAuth callback.
import { fbFacebookAllowed } from "./fbAccess.js";

export async function igInstagramAllowed({ email, igEnabled, isIgTester = null }) {
  return fbFacebookAllowed({ email, fbEnabled: igEnabled, isFbTester: isIgTester });
}

export function createIgLock({ igEnabled, isIgTester = null }) {
  return async function requireIgAvailable(req, res, next) {
    if (await igInstagramAllowed({ email: req.userEmail, igEnabled, isIgTester })) return next();
    return res.status(403).json({ ok: false, error: "ig_not_available" });
  };
}

// GET /ig/access (after requireAuth) → { ok:true, instagram }. Never 500s.
export function createIgAccessHandler({ igEnabled, isIgTester = null }) {
  return async function igAccess(req, res) {
    const instagram = await igInstagramAllowed({ email: req.userEmail, igEnabled, isIgTester });
    return res.json({ ok: true, instagram });
  };
}
