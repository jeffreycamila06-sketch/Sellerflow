// Build 10b — the public health answers say only {ok:true}. The TikTok detail (counts,
// failure rate, memory, warnings) needs the X-Poll-Token header = PARCEL_POLL_TOKEN (the
// secret the cron routes already use), compared timing-safe with its own lockout.
import { timingSafeTokenEqual, makeFailureThrottle } from "./pollAuth.js";

export function registerHealthRoutes(app, { token, tiktokDetail, throttle = makeFailureThrottle({ max: 5, windowMs: 15 * 60 * 1000 }) }) {
  app.get("/", (_req, res) => res.send("OK"));
  app.get("/health", (_req, res) => res.json({ ok: true }));
  app.get("/health/tiktok", (req, res) => {
    const sent = req.headers["x-poll-token"];
    if (!sent || !token) return res.json({ ok: true });          // public: nothing more
    if (throttle.blocked()) return res.status(429).json({ ok: false });
    if (!timingSafeTokenEqual(sent, token)) { throttle.fail(); return res.status(403).json({ ok: false }); }
    throttle.ok();
    return res.json(tiktokDetail());
  });
}
