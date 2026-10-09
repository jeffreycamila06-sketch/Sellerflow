import express from "express";
import cors from "cors";
import { WebcastPushConnection } from "tiktok-live-connector";
import http from "http";
import { Server } from "socket.io";
import { createClient } from "@supabase/supabase-js";
import { translateBroadcast } from "./server/broadcastTranslate.js";
import { scanParcelImage, SCAN_MEDIA_TYPES, describeRawReply } from "./server/parcelScan.js";
import { runScanWithCredit } from "./server/parcelCredits.js";
import { checkEmapStore } from "./server/emapCheck.js";
import { createOcr, readPollGate, writePollHealth } from "./server/parcelTrackingRunner.js";
import { createWorker as createParcelWorker } from "./server/parcelTrackingWorker.js";
import { shouldForceFreshConnect, shouldSkipQueuedReconnect, LIVENESS_EVENTS, reuseVerdict, singleFlight, REUSE_VERIFY_TIMEOUT_MS, shouldRelayViewers, resolveRateLimitCooldownMs, checkConnectRate, CONNECT_RATE_WINDOW_MS, isOwningConnection, relaySessionId } from "./server/connectionHealth.js";
import { buildInitialCommentPayloads, pushRecent, reuseReEmitPayload, RECENT_RING_CAP } from "./server/initialComments.js";
import { timingSafeTokenEqual, makeFailureThrottle } from "./server/pollAuth.js";
import { sweepProductImages, makeSweepStore, readSweepSwitch } from "./server/productImagesSweep.js";
import { sanitizeCommentPayload } from "./server/sanitize.js";
import { pinChatOf, buildPinPayload, pinAlreadySeen, pinLagMs } from "./server/pinRelay.js";
import { validGmShape, parseGmPage } from "./server/myshipValidate.js";
import { accountCapVerdict } from "./server/accountCap.js";
import { checkAccountLive, createLiveAdmissions } from "./server/accountLive.js";
import { concurrencyCap, freshLiveKeysForSeller, capDecision } from "./server/concurrencyCap.js";
import { fbConnectedNow } from "./server/fbLiveness.js";
import { formatMemoryLine, memorySnapshot, crashLogLine, shutdownLogLine, MEMORY_LOG_INTERVAL_MS } from "./server/observability.js";
import { shopeeConfig } from "./server/shopeeConfig.js";
import { createShopeeRuntime } from "./server/shopeeLive.js";
import { fbConfig } from "./server/fbConfig.js";
import { createFbRuntime, replayFbStatus } from "./server/fbLive.js";
import { createIgRuntime, replayIgStatus, igConfig } from "./server/igLive.js";
import { createIgLock, createIgAccessHandler } from "./server/igAccess.js";
import { createFbReceipt, startReceiptImageCleanup } from "./server/fbReceipt.js";
import { opaqueErrors } from "./server/errorCodes.js";
import { registerHealthRoutes } from "./server/healthRoutes.js";
import { createAutoReceiptRunner, AUTO_RECEIPT_DELAY_MS, AUTO_RECEIPT_TICK_MS } from "./server/fbAutoReceipt.js";
import { createFbSoldout } from "./server/fbSoldout.js";
import { withAppSecretProof } from "./server/fbHardening.js";
import { createFbFlagReader, createFbTesterReader, createFbLock, createFbPlanCheck, createFbAccessHandler } from "./server/fbAccess.js";

const app = express();
app.disable("x-powered-by"); // Build 10b — no framework name in every answer
const server = http.createServer(app);
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "";
// Broadcast auto-translation (admin-only). Set on Render → Environment. When
// absent the /admin/broadcast-translate endpoint returns an honest
// "translation_not_configured" error (never a silent/partial success).
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
// Parcel Scan (admin-only dogfood) vision model — overridable on Render without
// a deploy; empty → the core's DEFAULT_SCAN_MODEL.
const PARCEL_SCAN_MODEL = process.env.PARCEL_SCAN_MODEL || "";
// Parcel pickup tracking (SHOPMORE). Stage 2 (sql/63): checks run as queued JOBS
// (parcel_tracking_jobs) processed one at a time by the in-process worker
// (server/parcelTrackingWorker.js). The cron route below only ENQUEUES manual jobs for
// the allowlist — gated by a SHARED SECRET (cron-job.org can't present a JWT).
// PARCEL_POLL_USER_ID = optional override: enqueue only that one user.
// PARCEL_HEALTH_USER_ID = optional: one health-check job for that user per Taipei day.
// On/off = app_settings.parcel_tracking_enabled (read every worker tick).
const PARCEL_POLL_TOKEN = process.env.PARCEL_POLL_TOKEN || "";
// Product-picture cleanup (server/productImagesSweep.js), its own cron secret.
const PRODUCT_IMAGES_SWEEP_TOKEN = process.env.PRODUCT_IMAGES_SWEEP_TOKEN || "";
const PARCEL_POLL_USER_ID = process.env.PARCEL_POLL_USER_ID || "";
const PARCEL_HEALTH_USER_ID = process.env.PARCEL_HEALTH_USER_ID || "";
const sb = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

// SHOPEE LIVE (P2) — a SERVICE-ROLE Supabase client used ONLY by the Shopee token
// path (OAuth callback + background refresh/poller have no user JWT, so they must
// bypass RLS to read/write shopee_shops tokens). Created only when the new
// SUPABASE_SERVICE_ROLE_KEY env is set; never exposed to the client. Everything
// Shopee is additionally gated on shopeeConfig().enabled (fail-closed) below.
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const serviceSb = (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null;

function normalizeOrigin(origin) {
  return String(origin || "").trim().replace(/\/$/, "");
}

const allowedOrigins = new Set([
  "https://sellerflowlive.com",
  "https://www.sellerflowlive.com",
  "https://sellerflow-live-server.onrender.com",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "capacitor://localhost",
  "https://localhost",
  "http://localhost",
  ...(process.env.CLIENT_ORIGIN || "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean),
]);

function isAllowedOrigin(origin) {
  const normalized = normalizeOrigin(origin);
  return !normalized || allowedOrigins.has(normalized);
}

const corsOptions = {
  origin: (origin, cb) => {
    const normalized = normalizeOrigin(origin || "");
    if (!origin) {
      return cb(null, true);
    }
    if (allowedOrigins.has(normalized)) {
      return cb(null, normalized);
    }
    return cb(null, false);
  },
  credentials: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

const io = new Server(server, {
  path: "/socket.io/",
  transports: ["polling", "websocket"],
  allowRequest: (req, callback) => {
    callback(null, isAllowedOrigin(req.headers.origin));
  },
  cors: corsOptions,
});

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
// Global JSON body parsing keeps the express DEFAULT limit (100kb). The ONE
// exception is /admin/parcel-scan, whose body carries a base64 photo (~1–5MB):
// that route parses its own body with a raised limit (route middleware at the
// route definition). The global parser must SKIP that path — otherwise it
// rejects the large body with 413 before the route's parser ever runs.
const defaultJsonParser = express.json();
// /admin/parcel-tracking-poll is cron-triggered with no meaningful body and gates
// on a shared-secret token BEFORE doing anything — skip the global parser so the
// token check runs before any body handling (the B1 auth-before-parser discipline).
// /fb/receipt/send carries a base64 receipt picture (≤ 4 MB) — it parses its own body with a
// 6mb limit AFTER auth + its rate limit (server/fbReceipt.js), same discipline as parcel-scan.
app.use((req, res, next) => (req.path === "/admin/parcel-scan" || req.path === "/admin/parcel-tracking-poll" || req.path === "/admin/product-images-sweep" || req.path === "/fb/receipt/send" ? next() : defaultJsonParser(req, res, next)));
// Build 10 — error/reason words leave as short codes on the app-facing routes (server/errorCodes.js).
app.use(opaqueErrors());

function bearerToken(req) {
  const h = String(req.get("authorization") || "");
  return h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
}

async function verifyToken(token) {
  if (!sb || !token) return null;
  const { data, error } = await sb.auth.getUser(token);
  return error ? null : data.user;
}

async function requireAuth(req, res, next) {
  if (!sb) {
    return res.status(500).json({
      success: false,
      error: "Server auth is not configured",
    });
  }
  const token = bearerToken(req);
  const user = await verifyToken(token);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: "Unauthorized",
    });
  }
  // H1 — the seller identity KEY is the auth UUID, never the email. The old
  // cleanSellerId(email) key invited plus-addressing collisions (a+b@gmail.com →
  // ab@gmail.com = ANOTHER seller's rooms/keys). Email is emit/log-only now.
  req.sellerId = String(user.id || "");
  rememberSellerEmail(user.id, user.email);
  // Stashed for the plan-enforcement middleware that may follow this one.
  req.userEmail = user.email || "";
  req.authUserId = user.id || "";
  req.authToken = token || "";
  return next();
}

// Admin gate — SERVER-SIDE (not a UI-only check). Runs AFTER requireAuth. Uses a
// JWT-scoped client so the DB's public.is_admin() SECURITY DEFINER helper (the
// same gate behind the announcements RLS + admin_business_pulse) evaluates for
// THIS caller's auth.uid(). Non-admin (or any doubt) → 403. FAIL-CLOSED: unlike
// plan enforcement, an admin gate must deny on error, never allow.
async function requireAdmin(req, res, next) {
  const deny = () => res.status(403).json({ success: false, error: "forbidden" });
  if (!sb || !SUPABASE_URL || !SUPABASE_KEY || !req.authToken) return deny();
  try {
    const userSb = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${req.authToken}` } },
    });
    const { data, error } = await userSb.rpc("is_admin");
    if (error || data !== true) return deny();
    return next();
  } catch {
    return deny();
  }
}

// ============================================================================
// PLAN ENFORCEMENT
// ----------------------------------------------------------------------------
// Reads seller_profiles.{plan,plan_status,plan_expiry} for the authenticated
// user and decides whether to allow a new /connect attempt.
//
// SAFETY:
//   * FAIL-OPEN — any error (missing client, DB error, no profile row, network
//     failure, thrown exception) → allow + log [PLAN_CHECK] ERROR. We will
//     never lock out paying sellers because of a transient infra problem.
//   * KILL-SWITCH — flip PLAN_ENFORCEMENT_ENABLED to false and redeploy to
//     instantly disable enforcement without reverting code. When disabled the
//     check still LOGS what it WOULD have done so you can keep observing.
//   * FREE TIER — sellers with plan='free' are never blocked here (cap-based
//     elsewhere via DB trigger). Pending free sellers are stopped at the
//     frontend's PendingApprovalWall before ever reaching /connect.
//   * No hard-coded emails. No deny-list. Decisions come from the DB only.
//
// Every decision emits a single greppable log line:
//   [PLAN_CHECK] ALLOW  email=... plan=... status=... expiry=...
//   [PLAN_CHECK] BLOCK  email=... plan=... status=... expiry=... reason=...
//   [PLAN_CHECK] ERROR  email=... err=... -> FAIL-OPEN (allowing)
//   [PLAN_CHECK] (disabled) WOULD BLOCK email=... ... reason=...
// ============================================================================

const PLAN_ENFORCEMENT_ENABLED = true;

async function checkPlanActive(email, authUserId, token) {
  const ctx = `email=${email || "(unknown)"}`;

  if (!sb || !SUPABASE_URL || !SUPABASE_KEY) {
    console.log(`[PLAN_CHECK] ERROR ${ctx} err=no_supabase_client -> FAIL-OPEN (allowing)`);
    return { allowed: true };
  }
  if (!authUserId || !token) {
    console.log(`[PLAN_CHECK] ERROR ${ctx} err=missing_auth_context -> FAIL-OPEN (allowing)`);
    return { allowed: true };
  }

  try {
    // Per-request, JWT-scoped client so the seller's own RLS policy lets us
    // read their seller_profiles row by auth_user_id (same pattern the
    // frontend uses in getMyProfile).
    const userSb = createClient(SUPABASE_URL, SUPABASE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data, error } = await userSb
      .from("seller_profiles")
      .select("plan, plan_status, plan_expiry, role, tiktok, facebook")
      .eq("auth_user_id", authUserId)
      .maybeSingle();

    if (error) {
      console.log(`[PLAN_CHECK] ERROR ${ctx} err=${error.message || "rls_or_db_error"} -> FAIL-OPEN (allowing)`);
      return { allowed: true };
    }
    if (!data) {
      // H2 (security audit 2026-09-26) — a CLEAN "no row" is a HARD DENY, not an
      // infra failure: an auth.users account created via bare supabase.auth.signUp
      // (never finishing signup in the app) used to fail open here with NO plan →
      // no free-tier cap, no account cap, no concurrency cap = unlimited free
      // lives burning the shared Euler quota. Genuine DB/RLS errors above and
      // below still FAIL OPEN so an outage never locks out paying sellers; the
      // legit signup flow creates the profile row (awaited) before the socket or
      // any Connect tap exists, so a real seller never lands here.
      console.log(`[PLAN_CHECK] BLOCK ${ctx} reason=no_profile`);
      return { allowed: false, reason: "no_profile" };
    }

    const plan = String(data.plan || "");
    const status = String(data.plan_status || "");
    const expiry = data.plan_expiry ? String(data.plan_expiry) : "";
    const ctx2 = `${ctx} plan=${plan} status=${status} expiry=${expiry}`;
    // #6 — the account-cap fields ride along on the ALLOW returns (same read, zero
    // extra egress) so requirePlanActive can attach them to the request.
    const capFields = { plan, role: String(data.role || ""), tiktok: data.tiktok, facebook: data.facebook };

    // Free plan is cap-limited (DB trigger), never time-blocked at /connect.
    if (plan === "free") {
      console.log(`[PLAN_CHECK] ALLOW ${ctx2} (free-tier exempt)`);
      return { allowed: true, ...capFields };
    }

    const expiredStatus = status === "expired";
    const pastExpiry = expiry ? new Date(expiry).getTime() < Date.now() : false;

    if (expiredStatus || pastExpiry) {
      const reason = expiredStatus ? "expired" : "past_expiry";
      if (!PLAN_ENFORCEMENT_ENABLED) {
        console.log(`[PLAN_CHECK] (disabled) WOULD BLOCK ${ctx2} reason=${reason}`);
        return { allowed: true };
      }
      console.log(`[PLAN_CHECK] BLOCK ${ctx2} reason=${reason}`);
      return { allowed: false, reason };
    }

    console.log(`[PLAN_CHECK] ALLOW ${ctx2}`);
    return { allowed: true, ...capFields };
  } catch (err) {
    console.log(`[PLAN_CHECK] ERROR ${ctx} err=${err && err.message ? err.message : String(err)} -> FAIL-OPEN (allowing)`);
    return { allowed: true };
  }
}

async function requirePlanActive(req, res, next) {
  const result = await checkPlanActive(req.userEmail, req.authUserId, req.authToken);
  if (!result.allowed) {
    // H2 — distinguish "account setup incomplete" from a real expiry so the
    // seller-facing toast says the right thing.
    if (result.reason === "no_profile") {
      return res.status(403).json({
        success: false,
        error: "no_profile",
        message: "Your account setup is incomplete — open the SellerFlow app and finish signup, then try again.",
      });
    }
    return res.status(403).json({
      success: false,
      error: "plan_expired",
      message: "Your plan has expired. Please upgrade.",
    });
  }
  // #6 — carry the account-cap context from the SAME plan read (fail-open paths
  // leave these undefined → accountCapVerdict fails open, never blocks on infra).
  req.sellerPlan = result.plan;
  req.sellerRole = result.role;
  req.sellerTiktok = result.tiktok;
  req.sellerFacebook = result.facebook;
  return next();
}

// #6 — returns a 403 body when the requested account exceeds the seller's plan
// cap (Option B: must be a REGISTERED account within maxAccountsForPlan), else
// null. Reuses the plan/role/tiktok/facebook attached by requirePlanActive — no
// extra query. Fail-open on unknown plan / admin / broken registered list.
function accountCapReject(req, platform, username, opts = {}) {
  const v = accountCapVerdict({
    plan: req.sellerPlan, role: req.sellerRole,
    tiktok: req.sellerTiktok, facebook: req.sellerFacebook,
    platform, username,
    ignoreListOrder: opts.ignoreListOrder === true,
    refuseUnregistered: opts.refuseUnregistered === true,
  });
  if (v.allowed) return null;
  console.log(`[ACCOUNT-CAP] block seller=${req.sellerId} email=${req.userEmail} plan=${v.plan} platform=${platform} (max ${v.max}, account not registered)`);
  return {
    success: false,
    error: "account_limit",
    message: `Your ${v.plan} plan allows ${v.max} live account(s). Contact support to add more.`,
  };
}

// Account total, Build 2 (sql/85) — asks the database which accounts may go live, as the
// seller (their own JWT; account_live_check uses auth.uid() only). ~1.5 s timeout; any
// failure → allow exactly as today (server/accountLive.js). Called only for a NEW connect.
function accountLiveCheck(req, platform, key) {
  if (!SUPABASE_URL || !SUPABASE_KEY || !req.authToken) {
    console.log("[ACCOUNT-LIVE] ERROR → FAIL-OPEN");
    return Promise.resolve({ allow: true, failOpen: true, ignoreListOrder: false, refuseUnregistered: false });
  }
  const userSb = createClient(SUPABASE_URL, SUPABASE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${req.authToken}` } },
  });
  return checkAccountLive(() => userSb.rpc("account_live_check", { p_platform: platform, p_key: String(key == null ? "" : key) })).then((v) => {
    if (!v.allow) console.log(`[ACCOUNT-LIVE] refuse platform=${platform} rank=${v.rank} limit=${v.limit}`);
    return v;
  });
}
// The options each NEW TikTok connect was admitted with, reused on the reuse path (a tap on
// an already-running live) so enforcing never flips back to list order there.
const liveAdmissions = createLiveAdmissions();
const ACCOUNT_LIVE_REFUSAL = {
  success: false,
  ok: false,
  error: "account_not_covered",
  message: "Only your oldest accounts within the plan can go live. Remove an account or upgrade.",
};

// #5a — per-seller /connect rate limit (defense-in-depth for the shared Euler
// quota + the checkPlanActive read). Runs AFTER requireAuth (req.authUserId
// available) and BEFORE requirePlanActive (so a throttled attempt never even hits
// Supabase). Fail-open if no identity. In-memory; a Render restart clears it.
function requireConnectRate(req, res, next) {
  const uid = req.authUserId;
  if (!uid) return next(); // fail-open — downstream auth handles a missing identity
  const { allowed, kept } = checkConnectRate(connectAttempts.get(uid), Date.now());
  connectAttempts.set(uid, kept);
  if (!allowed) {
    console.log(`[CONNECT-RATE] throttle seller=${req.sellerId} email=${req.userEmail} (${kept.length} attempts in ${CONNECT_RATE_WINDOW_MS / 1000}s)`);
    return res.status(429).json({
      success: false,
      error: "too_many_requests",
      message: "Too many connection attempts. Please wait a moment and try again.",
    });
  }
  return next();
}

const TIKTOK_RECONNECT_BASE_MS = 5 * 1000;
const TIKTOK_RECONNECT_MAX_MS = 30 * 60 * 1000;
const TIKTOK_RECONNECT_JITTER_MS = 30 * 1000;
// #4 — the rate-limit cooldown is no longer a fixed 24h constant; it is resolved
// per-429 from Euler's own reset headers (resolveRateLimitCooldownMs in
// server/connectionHealth.js), defaulting to 30 min when no header is present.
const TIKTOK_MAX_PARALLEL_RECONNECTS = 1;
const TIKTOK_MAX_RECONNECT_QUEUE = 50;
// Hard rate cap: minimum spacing between successive reconnect connect() starts. With
// MAX_PARALLEL=1 this guarantees at most ~6 reconnects/min regardless of backlog size,
// so a stale-wave (many sockets dead at once) or a restart storm can NEVER spike the
// single Render IP into TikTok's rate limit. Backoff/jitter/max-parallel are unchanged.
const TIKTOK_RECONNECT_MIN_GAP_MS = 10 * 1000;
const TIKTOK_HEALTH_CHECK_MS = 60 * 1000;
// Faster stale recovery (was 18m/35m). Only the DETECTION delay changes — the reconnect
// throttle (backoff + jitter + max-parallel + MIN_GAP) is untouched, so the per-reconnect
// rate is unchanged; sockets just recover in minutes instead of tens of minutes. Kept
// conservative (12m event / 10m chat) so normal live lulls don't false-positive into an
// unnecessary reconnect (each reconnect costs a connect() against the per-IP budget; a
// real rate-limit benches the account for 24h).
const TIKTOK_STALE_MS = 12 * 60 * 1000;
const TIKTOK_CHAT_STALE_MS = 10 * 60 * 1000;
const TIKTOK_CHAT_WATCH_START_MS = 5 * 60 * 1000;
let activeTikTokReconnects = 0;
let lastTikTokReconnectStartedAt = 0;
let tiktokDrainTimer = null;
const pendingTikTokReconnects = [];
const tiktokConnections = new Map();
const facebookConnections = new Map();
const tiktokReconnectTimers = new Map();
const tiktokReconnectAttempts = new Map();
const tiktokRateLimitCooldowns = new Map();
// #5a — per-seller /connect attempt timestamps (rolling-window rate limit).
const connectAttempts = new Map();
const tiktokConnectLocks = new Set();
const manualTikTokDisconnects = new Set();
// Per-seller concurrency cap (kick-oldest) — keys reserved SYNCHRONOUSLY the moment a
// NEW-account live connect is admitted, held across the async connect, released in the
// finally. Counted alongside tiktokConnections so two parallel new-key connects for the
// same seller can't both slip past the cap (TOCTOU guard). Map<key, {sellerId, startedAt}>.
const liveConnectReservations = new Map();

// Passive health tracking for /health/tiktok. Ring buffer of the last 20 TikTok
// connection attempts populated from connectTikTok success and catch branches.
// Bounded by the shift() to avoid unbounded memory growth across the process
// lifetime. No external calls; no Eulerstream quota cost.
const recentTiktokAttempts = [];
const TIKTOK_ATTEMPT_RING_MAX = 20;
function recordTikTokAttempt(outcome, reason) {
  recentTiktokAttempts.push({
    outcome,                       // "ok" | "fail" | "rate_limit"
    reason: reason || null,
    timestamp: Date.now(),
  });
  if (recentTiktokAttempts.length > TIKTOK_ATTEMPT_RING_MAX) {
    recentTiktokAttempts.shift();
  }
}

function cleanSellerId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._-]/g, "");
}

// H1 — KEY vs EMIT split. Rooms, liveKey and every connection map key on the auth
// UUID (set in requireAuth + the socket handshake). But every CLIENT build
// (web/APK/iOS + the rollback app.html) filters incoming payloads against its own
// email.trim().toLowerCase() (sellerIdOf), so payload `sellerId` FIELDS must keep
// carrying the lowercased email. This map is the UUID → email-id bridge for the
// emit sites. Bounded (one entry per seller that authenticates in this process
// lifetime). Unknown → "" — every client check is `if (p.sellerId && mismatch)`,
// so an empty field passes instead of wrongly dropping.
const sellerEmailIds = new Map();
function rememberSellerEmail(userId, email) {
  const id = String(userId || "");
  if (id) sellerEmailIds.set(id, String(email || "").trim().toLowerCase());
}
function emailIdOf(sellerId) {
  return sellerEmailIds.get(String(sellerId || "")) || "";
}

function sellerRoom(sellerId) {
  // cleanSellerId is the identity function on a UUID (kept as belt-and-braces
  // normalization; every caller now passes the auth UUID).
  return `seller:${cleanSellerId(sellerId)}`;
}

function cleanAccountKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/[^a-z0-9@._-]/g, "");
}

function liveKey(sellerId, platform, username) {
  return `${cleanSellerId(sellerId)}:${platform}:${cleanAccountKey(username)}`;
}

// Forward a comment only to the sockets in this seller's room that are VIEWING the
// source account (or that sent no selection at all → they get everything, which
// keeps production main byte-identical: it never emits select_account). Single-node
// socket.io (no Redis adapter) → fetchSockets() is a cheap in-memory iteration.
// If fetchSockets() ever fails, fall back to the old room broadcast so a comment is
// never silently dropped.
async function emitCommentScoped(sellerId, platform, sourceUsername, payload) {
  const src = cleanAccountKey(sourceUsername || "");
  // #3 PRINTING INJECTION — the SINGLE choke-point for every client-bound comment
  // (live relay + initial history + reuse re-emit all pass through here). Strip
  // control bytes from the buyer-text fields (comment/name/handle) so a raw
  // newline/ESC can never reach the thermal-printer command stream. CJK/emoji and
  // all other fields (msgId/avatar/timestamps) are untouched; idempotent.
  const safe = sanitizeCommentPayload(payload);
  let sockets = [];
  try {
    sockets = await io.in(sellerRoom(sellerId)).fetchSockets();
  } catch {
    io.to(sellerRoom(sellerId)).emit("comment", safe);
    return;
  }
  for (const s of sockets) {
    const sel = s.data && s.data.selected ? s.data.selected[platform] || "" : "";
    // No selection on this socket → ALL comments (main-compatible). Otherwise only
    // the selected account's comments. Missing src → send (never hide on bad data).
    if (!sel || !src || sel === src) s.emit("comment", safe);
  }
}

function isTikTokRateLimitError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("rate_limit") || message.includes("too many connections");
}

function rememberTikTokRateLimit(key, sellerId, username, sessionId, error) {
  // #4 — honor Euler's own reset window (Retry-After / X-RateLimit-Reset carried
  // on the SignatureRateLimitError); fall back to 30 min, not a fixed 24h.
  const cooldownMs = resolveRateLimitCooldownMs(error, Date.now());
  const retryAt = Date.now() + cooldownMs;
  tiktokRateLimitCooldowns.set(key, retryAt);
  clearTikTokReconnect(key);
  tiktokReconnectAttempts.delete(key);
  emitTikTokStatus({
    sellerId,
    username,
    sessionId,
    connected: false,
    reconnecting: false,
    reason: "rate_limited",
    nextRetryMs: cooldownMs,
  });
  console.log(`TikTok rate limit cooldown for ${username} until ${new Date(retryAt).toISOString()} (${Math.round(cooldownMs / 60000)}m): ${error?.message || error}`);
  return cooldownMs;
}

function getTikTokCooldownMs(key) {
  const retryAt = tiktokRateLimitCooldowns.get(key) || 0;
  const remainingMs = retryAt - Date.now();
  if (remainingMs <= 0) {
    tiktokRateLimitCooldowns.delete(key);
    return 0;
  }
  return remainingMs;
}

function clearTikTokReconnect(key) {
  const timer = tiktokReconnectTimers.get(key);
  if (timer) clearTimeout(timer);
  tiktokReconnectTimers.delete(key);
}

function runQueuedTikTokReconnect(task) {
  pendingTikTokReconnects.push(task);
  while (pendingTikTokReconnects.length > TIKTOK_MAX_RECONNECT_QUEUE) {
    pendingTikTokReconnects.shift();
  }
  drainTikTokReconnectQueue();
}

function drainTikTokReconnectQueue() {
  while (activeTikTokReconnects < TIKTOK_MAX_PARALLEL_RECONNECTS && pendingTikTokReconnects.length) {
    // Hard rate cap: never start two reconnects within TIKTOK_RECONNECT_MIN_GAP_MS. If the
    // last connect() started too recently, defer one re-drain to the remaining gap (single
    // pending timer; new pushes won't stack it) instead of firing now. Effective rate =
    // max(connect-time, MIN_GAP) per reconnect ≈ ≤6/min even with a full 50-item backlog.
    const sinceLast = Date.now() - lastTikTokReconnectStartedAt;
    if (sinceLast < TIKTOK_RECONNECT_MIN_GAP_MS) {
      if (!tiktokDrainTimer) {
        tiktokDrainTimer = setTimeout(() => { tiktokDrainTimer = null; drainTikTokReconnectQueue(); }, TIKTOK_RECONNECT_MIN_GAP_MS - sinceLast);
      }
      return;
    }
    const task = pendingTikTokReconnects.shift();
    lastTikTokReconnectStartedAt = Date.now();
    activeTikTokReconnects += 1;
    Promise.resolve()
      .then(task)
      .finally(() => {
        activeTikTokReconnects = Math.max(0, activeTikTokReconnects - 1);
        drainTikTokReconnectQueue();
      });
  }
}

function clearTikTokHealthTimer(active) {
  if (active?.healthTimer) clearInterval(active.healthTimer);
}

function touchTikTokConnection(key, connection, type = "event") {
  const active = tiktokConnections.get(key);
  if (!active || active.connection !== connection) return;
  active.lastEventAt = Date.now();
  if (type === "chat") active.lastCommentAt = active.lastEventAt;
}

function startTikTokHealthTimer(key, connection) {
  const active = tiktokConnections.get(key);
  if (!active || active.connection !== connection) return;

  clearTikTokHealthTimer(active);
  active.healthTimer = setInterval(() => {
    const current = tiktokConnections.get(key);
    if (!current || current.connection !== connection) {
      clearInterval(active.healthTimer);
      return;
    }

    const now = Date.now();
    const connectionAgeMs = now - (current.startedAt || now);
    const silentMs = now - (current.lastEventAt || current.startedAt || now);
    const chatSilentMs = now - (current.lastCommentAt || current.startedAt || now);
    const eventIsFresh = silentMs < TIKTOK_STALE_MS;
    const chatLooksStale = connectionAgeMs >= TIKTOK_CHAT_WATCH_START_MS && chatSilentMs >= TIKTOK_CHAT_STALE_MS;
    if (eventIsFresh && !chatLooksStale) return;

    console.log(`TikTok health reconnect for ${current.username}: event silent ${Math.round(silentMs / 1000)}s, chat silent ${Math.round(chatSilentMs / 1000)}s`);
    emitTikTokStatus({
      sellerId: current.sellerId,
      username: current.username,
      sessionId: current.sessionId,
      connected: false,
      reconnecting: true,
      reason: chatLooksStale ? "chat_stale" : "silent_timeout",
    });
    clearTikTokHealthTimer(current);
    tiktokConnections.delete(key);
    try {
      current.connection.disconnect();
    } catch {}
    scheduleTikTokReconnect(key, current.username, current.sellerId, current.sessionId, chatLooksStale ? "chat_stale" : "silent_timeout");
  }, TIKTOK_HEALTH_CHECK_MS);
}

async function disconnectTikTokConnection(key, { manual = false } = {}) {
  const existing = tiktokConnections.get(key);
  if (manual) clearTikTokReconnect(key);
  if (!existing) {
    manualTikTokDisconnects.delete(key);
    return;
  }
  if (manual) manualTikTokDisconnects.add(key);
  clearTikTokHealthTimer(existing);
  try {
    await existing.connection.disconnect();
  } catch {}
  tiktokConnections.delete(key);
  tiktokReconnectAttempts.delete(key);
  manualTikTokDisconnects.delete(key);
}

io.use(async (socket, next) => {
  const token = socket.handshake.auth?.token || "";
  const user = await verifyToken(token);
  if (!user) return next(new Error("unauthorized"));
  socket.data.sellerId = String(user.id || ""); // H1 — UUID key, never the email
  rememberSellerEmail(user.id, user.email);

  // Same plan gate as the HTTP /connect routes — fail-open on lookup error,
  // free-tier exempt, kill-switch via PLAN_ENFORCEMENT_ENABLED. An expired
  // seller is rejected at the handshake so they can't receive live comments
  // even from a connection that was alive before they expired.
  const planResult = await checkPlanActive(user.email, user.id, token);
  if (!planResult.allowed) {
    // H2 — no_profile is denied here too (no socket, no room, no relayed comments).
    return next(new Error(planResult.reason === "no_profile" ? "no_profile" : "plan_expired"));
  }
  next();
});

io.on("connection", (socket) => {
  socket.on("join_live_room", ({ sessionId } = {}) => {
    const cleanId = socket.data.sellerId;
    if (!cleanId) return;
    socket.join(sellerRoom(cleanId));
    socket.data.sessionId = String(sessionId || "");

    for (const active of tiktokConnections.values()) {
      if (active.sellerId !== cleanId) continue;
      const silentMs = Date.now() - (active.lastEventAt || active.startedAt || 0);
      const stale = silentMs >= TIKTOK_STALE_MS;
      socket.emit("platform_status", {
        platform: "TikTok",
        connected: !stale,
        stale,
        sellerId: emailIdOf(cleanId),
        username: active.username,
        sessionId: active.sessionId,
      });
    }
    // #2 — FB has no server-side receive signal, so "connected" is a time-boxed
    // assertion (6h since Connect, then honest gray). Expired entries are PRUNED
    // here (facebookConnections was never deleted → grew until a restart).
    for (const [fbKey, active] of facebookConnections) {
      if (active.sellerId !== cleanId) continue;
      const live = fbConnectedNow(active.startedAt, Date.now());
      if (!live) facebookConnections.delete(fbKey); // prune expired (leak fix)
      socket.emit("platform_status", {
        platform: "Facebook",
        connected: live,
        stale: !live,
        sellerId: emailIdOf(cleanId),
        username: active.username,
        sessionId: active.sessionId,
      });
    }
    // Facebook pollers (server/fbLive.js) that are running for this seller: replay their
    // status to this socket so the FB pill is right again after a socket reconnect.
    replayFbStatus(fbRuntime, cleanId, emailIdOf(cleanId), (payload) => socket.emit("platform_status", payload));
    // Instagram pollers (server/igLive.js) — same replay; igRuntime is null while IG is off.
    replayIgStatus(igRuntime, cleanId, emailIdOf(cleanId), (payload) => socket.emit("platform_status", payload));
  });

  // Per-socket comment scoping. The client tells the server which account it is
  // currently VIEWING per platform; the server then only forwards that account's
  // comments to this socket (see emitCommentScoped). Multiple accounts stay live
  // simultaneously — this only governs what THIS socket receives.
  // ⚠️ Backward-compat: a client that never emits select_account leaves
  // socket.data.selected undefined → emitCommentScoped treats it as "no selection"
  // → that socket receives ALL comments, exactly like before (production main).
  socket.on("select_account", ({ platform, username } = {}) => {
    if (!socket.data.selected) socket.data.selected = {};
    // Additive 3rd platform: "Shopee" is now an accepted scoping key (P2). Any
    // other value still coerces to "TikTok" (backward-compatible). This is the
    // ONLY sacred-zone edit — emitCommentScoped is already platform-generic and
    // sanitizes every payload, so Shopee needs no change there.
    const ps = String(platform);
    // "Instagram" (phase 1): its own key — only the IG runtime emits that platform.
    const p = ps === "Facebook" ? "Facebook" : ps === "Shopee" ? "Shopee" : ps === "Instagram" ? "Instagram" : "TikTok";
    socket.data.selected[p] = cleanAccountKey(username || "");
  });
});


// TikTok-signing health probe. Synchronous, makes no external calls
// (zero Eulerstream quota cost), reads existing in-memory state plus the
// recentTiktokAttempts ring buffer populated from real connect outcomes.
// Catches:
//   - Missing EULER_API_KEY env var (sync)
//   - Recent failure rate spike (>=50% fail in last >=5 attempts)
// Misses by design (passive tracker, not active probe):
//   - Eulerstream service down before any seller has tried to connect
//   - Quota exhaustion before a real attempt hits the wall
// EULER_API_KEY value is NEVER returned -- only a boolean flag.
function tiktokHealthDetail() {
  const eulerKeyConfigured = !!process.env.EULER_API_KEY;
  const activeConnections = tiktokConnections.size;
  const reconnectingNow = tiktokReconnectTimers.size;
  const rateLimitedAccounts = tiktokRateLimitCooldowns.size;

  const last = recentTiktokAttempts;
  const fails = last.filter(a => a.outcome === "fail").length;
  const recentFailureRate = last.length === 0 ? null : `${fails}/${last.length}`;
  const lastFailReason = [...last].reverse().find(a => a.outcome === "fail")?.reason || null;

  const warnings = [];
  if (!eulerKeyConfigured) {
    warnings.push("EULER_API_KEY is not set; sign requests will use the free tier and likely fail.");
  }
  if (last.length >= 5 && fails / last.length >= 0.5) {
    warnings.push(`High recent failure rate: ${recentFailureRate}. Last reason: ${lastFailReason || "unknown"}`);
  }

  const ok = warnings.length === 0;
  const status = ok ? "healthy" : "degraded";

  return {
    ok,
    status,
    service: "tiktok-signing",
    checks: {
      eulerKeyConfigured,
      activeConnections,
      reconnectingNow,
      rateLimitedAccounts,
    },
    // Quick memory read so Jeff can eyeball RAM without opening Render.
    memory: memorySnapshot(process.memoryUsage()),
    recentFailureRate,
    lastFailReason,
    warnings,
    timestamp: new Date().toISOString(),
  };
}
// Build 10b — "/", "/health", "/health/tiktok": public = {ok:true} only; the detail above
// needs X-Poll-Token = PARCEL_POLL_TOKEN (server/healthRoutes.js).
registerHealthRoutes(app, { token: PARCEL_POLL_TOKEN, tiktokDetail: tiktokHealthDetail });


// fb_connect_v2 — a CONFIRMED platform switch stops the caller's own TikTok live on the server
// (the plain Disconnect button stays local). Same clean teardown as the concurrency kick:
// disconnectTikTokConnection(manual) also clears a scheduled reconnect, then one terminal gray.
app.post("/disconnect/tiktok", requireAuth, async (req, res) => {
  const key = liveKey(req.sellerId, "TikTok", (req.body || {}).username);
  const existing = tiktokConnections.get(key);
  if (!existing) {
    clearTikTokReconnect(key);
    return res.json({ ok: true, stopped: false });
  }
  const username = existing.username || cleanAccountKey((req.body || {}).username);
  const sessionId = existing.sessionId || "";
  await disconnectTikTokConnection(key, { manual: true });
  emitTikTokStatus({ sellerId: req.sellerId, username, sessionId, connected: false, reconnecting: false, reason: "disconnect" });
  console.log(`[DISCONNECT] tiktok seller=${req.sellerId} account=${username} (platform switch)`);
  return res.json({ ok: true, stopped: true });
});

app.post("/connect/tiktok", requireAuth, requireConnectRate, requirePlanActive, async (req, res) => {
  // Build 2 — only a NEW connect is checked: a live already running for this account (the
  // reuse path) is never asked about; health reconnects never come through this route.
  const tkKey = liveKey(req.sellerId, "TikTok", req.body.username);
  const isNew = !!cleanAccountKey(req.body.username) && !tiktokConnections.has(tkKey);
  if (isNew) liveAdmissions.forget(tkKey);
  const live = isNew ? await accountLiveCheck(req, "tiktok", req.body.username) : null;
  // Reuse path (live already running): the options it was admitted with, no database call.
  const reject = accountCapReject(req, "TikTok", req.body.username, live || liveAdmissions.optionsFor(tkKey));
  if (reject) return res.status(403).json(reject);
  if (live && !live.allow) return res.status(403).json(ACCOUNT_LIVE_REFUSAL);
  if (live) liveAdmissions.remember(tkKey, live, (k) => tiktokConnections.has(k));
  return connectTikTok(req.body.username, res, {
    sellerId: req.sellerId,
    sessionId: req.body.sessionId,
    // Concurrency cap (server-authoritative plan from requirePlanActive → checkPlanActive;
    // undefined on a fail-open DB error → concurrencyCap returns null → no cap).
    plan: req.sellerPlan,
    role: req.sellerRole,
  });
});

app.post("/connect/facebook", requireAuth, requireConnectRate, requirePlanActive, (req, res) => {
  const sellerId = req.sellerId;
  const username = cleanAccountKey(req.body.username || req.body.liveVideoId || req.body.pageName);
  const sessionId = String(req.body.sessionId || "");

  if (!sellerId) {
    return res.status(400).json({
      success: false,
      error: "Seller account is required before connecting live",
    });
  }

  if (!username) {
    return res.status(400).json({
      success: false,
      error: "Facebook page is required",
    });
  }

  const reject = accountCapReject(req, "Facebook", username);
  if (reject) return res.status(403).json(reject);

  const key = liveKey(sellerId, "Facebook", username);
  // #2 — stamp startedAt so the status pill can time-box "connected" (FB has no
  // server-side liveness signal; see server/fbLiveness.js). A re-connect refreshes it.
  facebookConnections.set(key, { username, sessionId, sellerId, startedAt: Date.now() });

  io.to(sellerRoom(sellerId)).emit("platform_status", {
    platform: "Facebook",
    connected: true,
    sellerId: emailIdOf(sellerId),
    username,
    sessionId,
  });
  io.to(sellerRoom(sellerId)).emit("live_session_started", {
    platform: "Facebook",
    username,
    sellerId: emailIdOf(sellerId),
    sessionId,
    timestamp: new Date().toISOString(),
  });

  return res.json({
    success: true,
    message: `Connected to Facebook page: ${username}`,
  });
});

// Admin broadcast auto-translation. Admin types ONE message; this translates it
// into all 7 supported languages in a SINGLE Anthropic call at SEND time. The
// admin previews + confirms; the row is written client-side (message = EN,
// message_i18n = all 7). Server-side admin gate (requireAdmin). On any failure
// returns success:false so the composer can offer "send English only" — it never
// ships a partial translation. Requires ANTHROPIC_API_KEY in the Render env; when
// absent it returns { success:false, error:"translation_not_configured" }.
// ── GM VALIDATION (multi-seller parcel check, 2026-09-27) ────────────────────
// Validates a seller's 賣貨便 GM id by fetching their PUBLIC cart page (the
// anonymous buyer-facing page — probe-verified: no login, shop name = <title>,
// Cgdm_Id hidden input echoes the GM). CORS blocks the browser doing this
// itself, and the sellers entering GMs don't run the extension → Render is the
// only place it can run for everyone. VERIFY-OPTIONAL contract: any failure
// here → the client saves unverified (honest badge) — this endpoint must never
// gate the save. Rate-limited per user (the page is 7-11's checkout infra).
const gmValidateHits = new Map(); // userId → { count, windowStart }
function gmValidateAllowed(userId) {
  const now = Date.now();
  const h = gmValidateHits.get(userId);
  if (!h || now - h.windowStart > 60_000) { gmValidateHits.set(userId, { count: 1, windowStart: now }); return true; }
  h.count += 1;
  return h.count <= 5; // 5/min/user — validation is a save-time act, not a loop
}
app.post("/myship/validate-gm", requireAuth, async (req, res) => {
  const gmId = String((req.body && req.body.gmId) || "").trim();
  if (!validGmShape(gmId)) return res.status(400).json({ valid: false, error: "bad_gm_shape" });
  if (!gmValidateAllowed(req.sellerId)) return res.status(429).json({ valid: false, error: "rate_limited" });
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(`https://myship.7-11.com.tw/cart/easy/${encodeURIComponent(gmId)}`, {
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    }).finally(() => clearTimeout(t));
    if (!r.ok) return res.json({ valid: false, error: `http_${r.status}` });
    const parsed = parseGmPage(await r.text(), gmId);
    console.log(`[GM-VALIDATE] ${req.userEmail || req.sellerId} ${gmId} valid=${parsed.valid} shop=${parsed.shopName || "-"}`);
    return res.json(parsed);
  } catch (e) {
    // Datacenter-IP block / timeout — expected-possible (unverified from Render
    // before this shipped). The client treats any failure as "unreachable".
    console.warn(`[GM-VALIDATE] fetch failed for ${gmId}:`, e?.message || e);
    return res.status(502).json({ valid: false, error: "fetch_failed" });
  }
});

app.post("/admin/broadcast-translate", requireAuth, requireAdmin, async (req, res) => {
  const text = String((req.body && req.body.text) || "").trim();
  if (!text) {
    return res.status(400).json({ success: false, error: "empty" });
  }
  const result = await translateBroadcast(text, { apiKey: ANTHROPIC_API_KEY });
  if (!result.ok) {
    // Log the raw model reply (server console ONLY — never sent to the client) so
    // a recurring parse failure can be diagnosed from its exact shape.
    console.log(`[BROADCAST_TRANSLATE] FAIL error=${result.error}${result.raw ? ` raw=${JSON.stringify(result.raw)}` : ""}`);
    return res.status(502).json({ success: false, error: result.error });
  }
  return res.json({ success: true, i18n: result.i18n });
});

// Parcel Scan (Phase A1, ADMIN-ONLY dogfood). One handwritten-slip photo per
// call (the client loops parcels sequentially); Claude vision extracts the
// recipient fields; the confirmed row is written CLIENT-side to parcel_scans
// (own-scoped RLS). Same shape as /admin/broadcast-translate: requireAuth →
// requireAdmin (server-side is_admin gate) → shared core → raw Anthropic fetch
// with the existing ANTHROPIC_API_KEY. The image is never stored anywhere.
// Route-scoped 8mb JSON parser — the global parser deliberately skips this path
// (see the app.use above) so every other route keeps the 100kb default.
// ⚠️ AUDIT B1 ORDER: auth runs BEFORE the 8mb parser (requireAuth/requireAdmin
// are header-only) — an unauthenticated/non-admin caller is rejected without
// the server ever buffering or parsing a large body.
app.post("/admin/parcel-scan", requireAuth, requireAdmin, express.json({ limit: "8mb" }), async (req, res) => {
  const imageBase64 = String((req.body && req.body.imageBase64) || "");
  const mediaType = String((req.body && req.body.mediaType) || "");
  // Cheap client-input rejects run BEFORE the credit debit — a malformed request
  // must never cost the seller a credit (they never reach the charge below).
  if (!imageBase64.trim()) {
    return res.status(400).json({ success: false, error: "empty_image" });
  }
  if (!SCAN_MEDIA_TYPES.includes(mediaType)) {
    return res.status(400).json({ success: false, error: "bad_media_type" });
  }

  // ── CREDIT DEBIT → SCAN → REFUND-ON-FAILURE ────────────────────────────────
  // Bypass-proof: ANTHROPIC_API_KEY is server-only, so every scan traverses this
  // route. JWT-scoped anon client (the requireAdmin/checkPlanActive pattern) so
  // the RPCs' auth.uid() = this caller; the atomic guarded UPDATE inside
  // check_and_debit_credit is what actually enforces the balance. The three
  // thunks are handed to runScanWithCredit (server/parcelCredits.js) — the
  // orchestration lives there so vitest can drive it (server.js has no harness).
  const creditUid = req.authUserId || "";
  const userSb = (SUPABASE_URL && SUPABASE_KEY && req.authToken)
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${req.authToken}` } },
      })
    : null;
  if (!userSb) {
    // Fail CLOSED — a paid feature must not hand out a free scan when the credit
    // ledger is unreachable.
    console.log(`[CREDIT] debit unavailable user=${creditUid} (no supabase client) -> failing closed`);
    return res.status(503).json({ success: false, error: "credit_unavailable" });
  }

  const out = await runScanWithCredit({
    uid: creditUid,
    debit: async () => {
      const { data, error } = await userSb.rpc("check_and_debit_credit", { p_amount: 1 });
      if (error) throw error;
      return data;
    },
    scan: async () => {
      const result = await scanParcelImage(imageBase64, mediaType, {
        apiKey: ANTHROPIC_API_KEY,
        ...(PARCEL_SCAN_MODEL ? { model: PARCEL_SCAN_MODEL } : {}),
      });
      if (!result.ok) {
        // Server console ONLY (never the client). Two findable lines per failure:
        // FAIL carries error + stop_reason + Anthropic HTTP status; RAW carries the
        // reply's SHAPE ONLY (len / json / key names) — NEVER its body: the reply is
        // buyer PII (name, phone, store). (result.raw !== undefined — not truthy — so
        // an EMPTY reply still logs "RAW len=0", the signal that caught the first outage.)
        console.log(`[PARCEL_SCAN] FAIL error=${result.error} stop_reason=${result.stopReason || "-"} http=${result.httpStatus ?? "-"}`);
        if (result.raw !== undefined) {
          console.log(`[PARCEL_SCAN] RAW ${describeRawReply(result.raw)}`);
        }
      }
      return result;
    },
    refund: async (debitId) => {
      // GATED RPC — matches the just-created scan_debit by id (no id / no match →
      // no_refundable_debit, no mint). debitId comes from the debit's response.
      const { data, error } = await userSb.rpc("refund_parcel_credit", { p_debit_id: debitId, p_amount: 1 });
      if (error) throw error;
      return data;
    },
    setOutcome: async (debitId, outcome) => {
      // Best-effort per-scan outcome stamp on the caller's own scan_debit
      // (own-scoped RPC). A failure here never breaks the scan/debit/refund.
      const { data, error } = await userSb.rpc("set_scan_outcome", { p_debit_id: debitId, p_outcome: outcome });
      if (error) throw error;
      return data;
    },
    log: (m) => console.log(m),
  });
  return res.status(out.status).json(out.body);
});

// Parcel Scan A2 — 7-11 E-Map store-code check. requireAuth ONLY (relaxed from
// requireAdmin 2026-09-10): manual encode is open to paying sellers, and their
// store-code check must work. This is a pure external 7-11 lookup — no auth.uid()
// use, no per-user table, no credit — so any signed-in caller is safe (the AI
// scan at /admin/parcel-scan stays requireAdmin). Path name kept for the client.
// requirePlanActive is deliberately NOT added (it passes free too, so it buys
// nothing here; free never reaches this screen client-side). Body is tiny
// ({ storeId }), so the GLOBAL 100kb json parser applies (not the parcel-scan
// skip). Best-effort: the core has its own ~5s timeout, returns "unknown" on fail.
app.post("/admin/parcel-emap-check", requireAuth, async (req, res) => {
  const storeId = String((req.body && req.body.storeId) || "").trim();
  if (!/^\d{6}$/.test(storeId)) {
    return res.status(400).json({ success: false, error: "bad_store_id" });
  }
  const result = await checkEmapStore(storeId);
  // ONE diagnostic line on EVERY check (server console ONLY, never the client):
  // which query variant ran, the verdict, and how many store nodes came back —
  // so scanning a known-valid code (982063) shows, per variant, whether real
  // store data returned (pois>=1). note flags an S1 not_found→unknown downgrade.
  console.log(`[EMAP_CHECK] variant=${result.variant} store=${storeId} result=${result.status} pois=${result.pois ?? 0}${result.note ? ` (${result.note})` : ""}`);
  // RAW: the bounded response body (server console ONLY) — attached on every
  // non-valid verdict AND on a valid verdict while the S1 gate is unconfirmed,
  // so the owner can confirm the real XML shape before flipping
  // EMAP_CHECK_CONFIRMED=true.
  if (result.raw !== undefined) {
    console.log(`[EMAP_CHECK] RAW ${JSON.stringify(String(result.raw).slice(0, 500))}`);
  }
  return res.json({ success: true, storeId: result.storeId, status: result.status, storeName: result.storeName, address: result.address });
});

// ── SHOPMORE pickup-tracking: cron route ENQUEUES manual jobs (Stage 2) ─────────
// SECRET-gated (cron-job.org can't present a JWT): PARCEL_POLL_TOKEN via the
// X-Poll-Token HEADER ONLY (M5 — never ?token=), compared timing-safe with a
// failed-attempt lockout (server/pollAuth.js), checked BEFORE any body handling.
// The worker does the SHOPMORE work; this route never touches SHOPMORE itself.
const parcelPollAuthThrottle = makeFailureThrottle({ max: 5, windowMs: 15 * 60 * 1000 });

app.post("/admin/parcel-tracking-poll", async (req, res) => {
  if (!PARCEL_POLL_TOKEN) return res.status(503).json({ ok: false, error: "poll_not_configured" });
  // M5 — header only (never the query string), lockout after repeated bad tokens,
  // constant-time compare. The cron-job.org job sends X-Poll-Token (documented).
  if (parcelPollAuthThrottle.blocked()) {
    console.log("[PARCEL-POLL] auth throttle — locked out after repeated bad tokens");
    return res.status(429).json({ ok: false, error: "too_many_attempts" });
  }
  const token = req.headers["x-poll-token"];
  if (!timingSafeTokenEqual(token, PARCEL_POLL_TOKEN)) {
    parcelPollAuthThrottle.fail();
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  parcelPollAuthThrottle.ok();
  if (!serviceSb) return res.status(503).json({ ok: false, error: "no_service_role" });
  // KILL SWITCH (app_settings.parcel_tracking_enabled) — checked here too so a
  // disabled poller answers 200 immediately (cron history shows it) without
  // queueing anything. The worker re-checks it every tick.
  const gate = await readPollGate(serviceSb, new Date());
  if (!gate.run && gate.reason === "disabled") {
    console.log("[PARCEL-POLL] disabled");
    await writePollHealth(serviceSb, { ran_at: new Date().toISOString(), ok: true, reason: "disabled" });
    return res.status(200).json({ ok: true, disabled: true });
  }
  // WHO: the override, else every enabled allowlist row. One manual job each; a seller
  // with a job already queued/running is skipped (the RPC returns null).
  let ids = [];
  if (PARCEL_POLL_USER_ID) ids = [PARCEL_POLL_USER_ID];
  else {
    const { data, error } = await serviceSb.from("parcel_tracking_access").select("user_id").eq("enabled", true);
    if (error) return res.status(500).json({ ok: false, error: "select_failed" });
    ids = (data || []).map((r) => String(r.user_id)).filter(Boolean);
  }
  let enqueued = 0;
  for (const id of ids) {
    const { data, error } = await serviceSb.rpc("parcel_tracking_enqueue_job", { p_user_id: id, p_kind: "manual", p_created_by: "admin" });
    if (!error && data) enqueued += 1;
  }
  console.log(`[PARCEL-JOB] cron enqueued ${enqueued}/${ids.length} manual job(s)`);
  // 202 Accepted: queued, not done — the worker runs them one at a time.
  return res.status(202).json({ ok: true, scheduled: true, enqueued });
});

// ── Product-picture cleanup: cron route (cron-job.org, daily) ─────────────────
// Same discipline as /admin/parcel-tracking-poll: PRODUCT_IMAGES_SWEEP_TOKEN via the
// X-Poll-Token HEADER only, timing-safe, lockout after repeated bad tokens, all BEFORE any
// work. Off (app_settings.product_images_sweep_enabled != 'true') → 204, nothing done.
// On → 202 and the sweep runs in the background (one at a time). Logs counts only.
const productImagesSweepAuthThrottle = makeFailureThrottle({ max: 5, windowMs: 15 * 60 * 1000 });
let productImagesSweepRunning = false;

app.post("/admin/product-images-sweep", async (req, res) => {
  if (!PRODUCT_IMAGES_SWEEP_TOKEN) return res.status(503).json({ ok: false, error: "sweep_not_configured" });
  if (productImagesSweepAuthThrottle.blocked()) return res.status(429).json({ ok: false, error: "too_many_attempts" });
  if (!timingSafeTokenEqual(req.headers["x-poll-token"], PRODUCT_IMAGES_SWEEP_TOKEN)) {
    productImagesSweepAuthThrottle.fail();
    return res.status(403).json({ ok: false, error: "forbidden" });
  }
  productImagesSweepAuthThrottle.ok();
  if (!serviceSb) return res.status(503).json({ ok: false, error: "no_service_role" });
  if (!(await readSweepSwitch(serviceSb))) return res.status(204).end();
  if (productImagesSweepRunning) return res.status(409).json({ ok: false, error: "already_running" });
  productImagesSweepRunning = true;
  res.status(202).json({ ok: true, scheduled: true });
  try {
    await sweepProductImages({ store: makeSweepStore(serviceSb), log: (m) => console.log(m) });
  } catch (e) {
    console.log(`[PRODUCT-IMG-SWEEP] failed: ${e && e.message ? e.message : "error"}`);
  } finally {
    productImagesSweepRunning = false;
  }
});

function emitTikTokStatus({ sellerId, username, sessionId, connected, reconnecting = false, reason = "", nextRetryMs = 0 }) {
  io.to(sellerRoom(sellerId)).emit("platform_status", {
    platform: "TikTok",
    connected,
    reconnecting,
    sellerId: emailIdOf(sellerId), // H1 — payload field = email id (client filter); the room key is the UUID
    username,
    sessionId,
    reason,
    nextRetryMs,
  });
}

function scheduleTikTokReconnect(key, username, sellerId, sessionId, reason = "disconnected") {
  if (tiktokReconnectTimers.has(key)) return;
  const cooldownMs = getTikTokCooldownMs(key);
  if (cooldownMs > 0) {
    emitTikTokStatus({
      sellerId,
      username,
      sessionId,
      connected: false,
      reconnecting: false,
      reason: "rate_limited",
      nextRetryMs: cooldownMs,
    });
    return;
  }

  const attempt = (tiktokReconnectAttempts.get(key) || 0) + 1;
  tiktokReconnectAttempts.set(key, attempt);
  const backoffMs = Math.min(TIKTOK_RECONNECT_BASE_MS * attempt, TIKTOK_RECONNECT_MAX_MS);
  const jitterMs = Math.floor(Math.random() * TIKTOK_RECONNECT_JITTER_MS);
  const retryMs = backoffMs + jitterMs;

  emitTikTokStatus({
    sellerId,
    username,
    sessionId,
    connected: false,
    reconnecting: true,
    reason,
    nextRetryMs: retryMs,
  });

  const timer = setTimeout(async () => {
    tiktokReconnectTimers.delete(key);
    runQueuedTikTokReconnect(async () => {
      // clientfix RC3 — STALE-RECONNECT GUARD. Once this closure is queued,
      // clearTikTokReconnect can no longer cancel it. If the seller's own
      // Connect tap already restored the account (map entry) or a connect is
      // in flight (lock), this reconnect is STALE: running it would either
      // clobber a healthy green with a terminal not_live + live_session_ended
      // (the observed false-gray: comments flowing while gray) or silently
      // overwrite the healthy connection (orphaned double-relay — the G1
      // hole reached from the scheduler). Skip = the correct outcome.
      if (shouldSkipQueuedReconnect(tiktokConnections.has(key), tiktokConnectLocks.has(key))) {
        console.log(`[RECONNECT] skip stale queued reconnect for ${username} (${sellerId}) — connection already restored or connect in flight`);
        tiktokReconnectAttempts.delete(key);
        return;
      }
      // Hold the SAME connect lock the /connect route uses, so a user tap and a
      // reconnect can never run startTikTokConnection for one key in parallel
      // (the tap sees 429 "already starting" for a few seconds — honest).
      tiktokConnectLocks.add(key);
      try {
        await startTikTokConnection(key, username, sellerId, sessionId, { emitStart: false });
        console.log(`Reconnected TikTok LIVE: ${username} for ${sellerId}`);
      } catch (error) {
        console.log(`TikTok reconnect failed for ${username}: ${error.message}`);
        if (error && error.notLive) {
          // Stream ended / went offline on reconnect → TERMINAL, like streamEnd: stop
          // the loop entirely (no re-schedule) so Fix A/B never retry a dead room.
          clearTikTokReconnect(key);
          tiktokReconnectAttempts.delete(key);
          emitTikTokStatus({ sellerId, username, sessionId, connected: false, reconnecting: false, reason: "not_live" });
          io.to(sellerRoom(sellerId)).emit("live_session_ended", {
            platform: "TikTok", username, sellerId: emailIdOf(sellerId), sessionId, timestamp: new Date().toISOString(),
          });
          return;
        }
        if (isTikTokRateLimitError(error)) {
          rememberTikTokRateLimit(key, sellerId, username, sessionId, error);
          return;
        }
        scheduleTikTokReconnect(key, username, sellerId, sessionId, "retry_failed");
      } finally {
        tiktokConnectLocks.delete(key);
      }
    });
  }, retryMs);

  tiktokReconnectTimers.set(key, timer);
}

function handleTikTokDisconnected(key, connection, reason = "disconnected", { reconnect = true } = {}) {
  const active = tiktokConnections.get(key);
  if (!active || active.connection !== connection) return;

  clearTikTokHealthTimer(active);
  tiktokConnections.delete(key);

  if (manualTikTokDisconnects.has(key) || !reconnect) {
    manualTikTokDisconnects.delete(key);
    tiktokReconnectAttempts.delete(key);
    emitTikTokStatus({
      sellerId: active.sellerId,
      username: active.username,
      sessionId: active.sessionId,
      connected: false,
      reconnecting: false,
      reason: reconnect ? "manual" : reason,
    });
    io.to(sellerRoom(active.sellerId)).emit("live_session_ended", {
      platform: "TikTok",
      username: active.username,
      sellerId: emailIdOf(active.sellerId),
      sessionId: active.sessionId,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  scheduleTikTokReconnect(key, active.username, active.sellerId, active.sessionId, reason);
}

async function startTikTokConnection(key, username, sellerId, sessionId, { emitStart = false } = {}) {
  clearTikTokReconnect(key);

  const cleanUsername = cleanAccountKey(username);
  // FRESH-VERIFY (fresh-path fail-open fix, 2026-07-14 — the kimmyukay
  // capture): BEFORE any connect work, ONE authoritative Euler is_live GET via
  // the SAME C1 core as the reuse verify (throwaway listener-less probe, 4s
  // timeout, strict-boolean, REUSE_VERIFY_SOURCE flag, shared single-flight).
  // Covers ALL callers of this function — fresh tap, forced-fresh, and the
  // health-cycle reconnect. not_live → the EXISTING notLiveError plumbing:
  //   • fresh tap → connectTikTok's catch → the byte-pinned 409 + client toast
  //     (a just-went-live seller who races Euler's view simply taps again —
  //     not_live is never a cooldown, so the block is retry-able by design);
  //   • health reconnect → the reconnect catch's TERMINAL path (clear
  //     reconnect, not_live status emit, live_session_ended) — the ZOMBIE-LOOP
  //     KILL: a just-ended live stops at its FIRST reconnect instead of
  //     looping fake Branch-A connects every 10-12min forever.
  // live → proceed. ambiguous → FAIL-OPEN, proceed to connect() — the
  // chentrendyukay protection: a real live seller with an odd-shape response
  // is NEVER blocked; the post-connect roomInfo gate below stays as layer 2.
  // ⚠️ STATUS-CODE MAPPING DELIBERATELY REJECTED — do NOT re-propose blocking
  // on roomInfo.status_code (e.g. 4003110, the kimmyukay shape): production
  // capture 2026-06-30 observed chentrendyukay LIVE with status_code 4003110
  // (and OFFLINE with the same value) — it is an availability/blocking code,
  // NOT a live-state signal. Only Euler's is_live boolean discriminates.
  const preVerdict = await verifyIsLive(key, cleanUsername, "FRESH-VERIFY");
  if (preVerdict === "not_live") {
    const notLiveError = new Error("not_live");
    notLiveError.notLive = true;
    notLiveError.liveStatus = "euler_is_live_false";
    throw notLiveError;
  }
  const tiktokConnection = new WebcastPushConnection(cleanUsername, {
    // Approach A (FLive parity) — decode TikTok's buffered "last minutes"
    // messages from the signed-websocket fetch (they were previously discarded;
    // enabling this costs ZERO extra requests). They are captured by the
    // temporary collector below and relayed DISPLAY-ONLY (initial:true).
    processInitialData: true,
    fetchRoomInfoOnConnect: true,
    signApiKey: process.env.EULER_API_KEY,
  });
  // ⚠️ Initial-batch boundary (structural, not a timing heuristic): the library
  // processes the initial buffer INSIDE connect(), BEFORE the websocket is even
  // created — so every "chat" that fires before connect() resolves is history
  // BY CONSTRUCTION. The live chat handler is attached AFTER connect() (below),
  // exactly as before, so the live relay path is unchanged.
  const initialChats = [];
  const initialCollector = (data) => { initialChats.push(data); };
  tiktokConnection.on("chat", initialCollector);
  // [PIN-PROBE] Phase 1 (2026-09-26) — LOG-ONLY, ZERO behavior. Question: does
  // TikTok deliver WebcastRoomPinMessage (host pins a comment) on our wire, and
  // what shape/action values does it carry? The legacy WebcastPushConnection
  // switch NEVER emits a "roomPin" event — but it emits decodedData for EVERY
  // message type (simplifyObject already ran on all of them regardless), so this
  // listener only filters; zero added per-message cost. Attached BEFORE connect()
  // so pins inside the pre-connect initial buffer are captured too
  // (phase=initial) — Phase 2 must know whether a still-pinned comment is
  // RE-DELIVERED on every health-cycle reconnect (the print-every-10-min
  // hazard). SHADOW-FIRST per the 2026-07-14 wire-shape rule; Phase 2 (relay +
  // client toggle, Option A: pin = 1-Click order + print) ships only after this
  // probe's production data is reviewed. Expected fields (schema): top-level
  // msgId/createTime = the PIN event's own (F1 flatten), nested chatMessage
  // (NOT simplified: chatMessage.common.msgId = the ORIGINAL comment's msgId,
  // chatMessage.user.uniqueId, chatMessage.content), action (pin/unpin enum —
  // UNVERIFIED, the probe's main quarry), pinTime, pinId, operator.
  let pinProbeConnected = false;
  // [PIN-PROBE-DIAG] (2026-09-26, TEMPORARY, log-only) — the Phase-1 probe saw
  // ZERO [PIN-PROBE] lines in a real pinned-comment live test. This counter
  // distinguishes (a) decodedData never fires vs (b) it fires but
  // WebcastRoomPinMessage never arrives, and shows the ACTUAL type strings on
  // the wire (the pin may travel under a different name; the legacy wrapper
  // emits decodedData even for UNDECODED types, so those show up too). At most
  // one bounded line per 60s per connection, piggybacked on message arrival —
  // no timer to leak. Remove after review (Phase-0 probe / PARCEL-DBG precedent).
  const pinDiag = { counts: new Map(), lastLogAt: Date.now(), startedAt: Date.now() };
  tiktokConnection.on("decodedData", (msgType, obj) => {
    try {
      const t = String(msgType || "unknown");
      if (pinDiag.counts.has(t) || pinDiag.counts.size < 50) {
        pinDiag.counts.set(t, (pinDiag.counts.get(t) || 0) + 1);
      } else {
        pinDiag.counts.set("__other__", (pinDiag.counts.get("__other__") || 0) + 1);
      }
      const now = Date.now();
      if (now - pinDiag.lastLogAt >= 60000) {
        pinDiag.lastLogAt = now;
        const entries = [...pinDiag.counts.entries()].sort((x, y) => y[1] - x[1]);
        const shown = entries.slice(0, 12).map(([k, v]) => `${k}:${v}`).join(",");
        const extra = entries.length > 12 ? `,+${entries.length - 12} more types` : "";
        console.log(`[PIN-PROBE-DIAG] ${cleanUsername} sinceConnectMs=${now - pinDiag.startedAt} types={${shown}${extra}}`.slice(0, 800));
      }
    } catch { /* the diag must never affect the connection */ }
    if (msgType !== "WebcastRoomPinMessage") return;
    try {
      const owning = isOwningConnection(tiktokConnections, key, tiktokConnection);
      let raw = "";
      try { raw = JSON.stringify(obj).slice(0, 2000); } catch { raw = "unstringifiable"; } // 2000: the 800 cap cut off action/isShowMsg
      console.log(`[PIN-PROBE] ${cleanUsername} phase=${pinProbeConnected ? "live" : "initial"} owning=${owning} ${raw}`);
    } catch { /* the probe must never affect the connection */ }
    // ── PIN-TO-PRINT Phase 2 relay (Option A: pin = 1-Click on the client) ──
    // Ordering is load-bearing: live-phase gate FIRST (pre-connect-buffer pins
    // are history — relaying them is the reconnect/print-every-10-min hazard),
    // then the OWNING guard (G1 discipline, now ENFORCED — an orphaned old
    // connection must never relay a pin), then validity, then per-connection
    // msgId dedup (pin/expire/re-pin = one relay; pin-vs-expire semantics are
    // deliberately not distinguished — see server/pinRelay.js). DELIBERATELY a
    // separate `platform_pin` event, NEVER emitCommentScoped: re-emitting as a
    // normal comment would re-enter the client feed + the Auto-Mode seam with a
    // fresh server-stamped commentKey — the exact F4 double-order trap. Account
    // scoping happens client-side on payload.username (the platform_viewers
    // pattern). Best-effort by contract: a relay failure never touches the
    // connection.
    try {
      if (!pinProbeConnected) return;
      if (!isOwningConnection(tiktokConnections, key, tiktokConnection)) return;
      const chat = pinChatOf(obj);
      if (!chat) { console.log(`[PIN-RELAY] drop (no valid chatMessage) ${cleanUsername}`); return; }
      const entry = tiktokConnections.get(key);
      if (!entry || pinAlreadySeen(entry, chat.msgId)) return;
      const payload = sanitizeCommentPayload(buildPinPayload(chat, {
        sellerId: emailIdOf(sellerId), // payload field = email id (client filter); room key = UUID
        sessionId: relaySessionId(entry, sessionId),
        sourceUsername: cleanUsername,
        roomId: state?.roomId || "",
      }));
      io.to(sellerRoom(sellerId)).emit("platform_pin", { ...payload, username: cleanUsername });
      console.log(`[PIN-RELAY] ${cleanUsername} msgId=${chat.msgId} @${chat.handle} lagMs=${pinLagMs(obj) ?? "?"}`); // lagMs = TikTok pin-broadcast leg
    } catch (e) {
      console.warn(`[PIN-RELAY] failed for ${cleanUsername} (connection unaffected):`, e?.message || e);
    }
  });
  let state;
  try {
    state = await tiktokConnection.connect();
  } finally {
    tiktokConnection.off("chat", initialCollector);
  }
  pinProbeConnected = true; // everything after connect() resolves = live-phase pins
  // Phase 1 — is-LIVE gate (FAIL-OPEN). Fixes "Connected but offline": only BLOCK
  // when roomInfo POSITIVELY reports not-live (roomInfo present + numeric status
  // !== 1; LIVE = status:1 confirmed by the Phase 0 probe). Any ambiguity
  // (status===1, missing roomInfo, non-numeric status) ALLOWS the connection so a
  // real live seller is NEVER false-blocked. Logs both the block AND the ambiguous
  // fail-open so a real Branch-A (resolved-but-not-live) sample is captured in prod.
  const liveRoomInfo = tiktokConnection.roomInfo;
  const liveStatus = liveRoomInfo && typeof liveRoomInfo.status === "number" ? liveRoomInfo.status : null;
  if (liveStatus !== null && liveStatus !== 1) {
    try { console.log("[NOT-LIVE] block", cleanUsername, "status=", liveStatus, JSON.stringify(liveRoomInfo)); }
    catch { console.log("[NOT-LIVE] block", cleanUsername, "status=", liveStatus); }
    try { await tiktokConnection.disconnect(); } catch {}
    const notLiveError = new Error("not_live");
    notLiveError.notLive = true;
    notLiveError.liveStatus = liveStatus;
    throw notLiveError; // terminal, do-not-retry (handled in both callers)
  }
  if (liveStatus === null) {
    try { console.log("[NOT-LIVE] fail-open (ambiguous, allowed)", cleanUsername, JSON.stringify(liveRoomInfo ?? null)); }
    catch { console.log("[NOT-LIVE] fail-open (ambiguous, allowed)", cleanUsername, "roomInfo unstringifiable"); }
  }
  const now = Date.now();
  tiktokReconnectAttempts.delete(key);
  tiktokConnections.set(key, {
    connection: tiktokConnection,
    username: cleanUsername,
    sessionId,
    sellerId,
    roomId: state?.roomId || "",
    startedAt: now,
    lastEventAt: now,
    lastCommentAt: now,
    healthTimer: null,
    // clientfix RC2 — last relayed comments (seeded below with the connect-time
    // buffer, appended by the chat relay). Re-emitted initial:true on B2 reuse
    // so a refresh mid-live still gets its FLive-parity history block.
    recentComments: [],
  });

  console.log(`Connected to TikTok LIVE: ${cleanUsername} for ${sellerId} room ${state?.roomId || "unknown"}`);
  recordTikTokAttempt("ok");

  emitTikTokStatus({
    sellerId,
    username: cleanUsername,
    sessionId,
    connected: true,
    reconnecting: false,
  });

  if (emitStart) {
    io.to(sellerRoom(sellerId)).emit("live_session_started", {
      platform: "TikTok",
      username: cleanUsername,
      sellerId: emailIdOf(sellerId),
      sessionId,
      roomId: state?.roomId || "",
      timestamp: new Date().toISOString(),
    });
  }

  // Approach A — relay the collected initial batch (TikTok's recent room
  // buffer) as DISPLAY-ONLY history: every payload carries initial:true +
  // msgId; the client routes them BEFORE its Auto-Mode seam / order path and
  // only shows them on a fresh open (empty feed). Same scoped relay as live
  // comments (select_account gate applies). Dedup + shaping: server/initialComments.js.
  if (initialChats.length) {
    // Audit F3 — best-effort by contract: the connect is ALREADY successful and
    // registered above, so a relay failure must never fail it (an uncaught
    // throw here would emit a terminal status while the live connection stays
    // in the map).
    try {
      const initialPayloads = buildInitialCommentPayloads(initialChats, {
        sellerId: emailIdOf(sellerId), // payload field only — the room emit below keys on the UUID
        sessionId,
        sourceUsername: cleanUsername,
        roomId: state?.roomId || "",
        nowMs: now,
      });
      console.log(`[INITIAL] relaying ${initialPayloads.length}/${initialChats.length} buffered comments for ${cleanUsername} (${sellerId})`);
      for (const payload of initialPayloads) {
        void emitCommentScoped(sellerId, "TikTok", cleanUsername, payload);
      }
      // RC2 — seed the reuse ring with the connect-time buffer.
      const entry = tiktokConnections.get(key);
      if (entry && entry.connection === tiktokConnection) {
        entry.recentComments = initialPayloads.slice(-RECENT_RING_CAP);
      }
    } catch (err) {
      console.warn(`[INITIAL] relay failed for ${cleanUsername} (connect unaffected):`, err?.message || err);
    }
  }

  tiktokConnection.on("disconnected", () => handleTikTokDisconnected(key, tiktokConnection, "disconnected"));
  tiktokConnection.on("streamEnd", () => handleTikTokDisconnected(key, tiktokConnection, "streamEnd", { reconnect: false }));
  tiktokConnection.on("error", (error) => {
    console.log(`TikTok connection error for ${cleanUsername}: ${error?.message || error}`);
    if (isTikTokRateLimitError(error)) {
      rememberTikTokRateLimit(key, sellerId, cleanUsername, sessionId, error);
      handleTikTokDisconnected(key, tiktokConnection, "rate_limited", { reconnect: false });
      return;
    }
    handleTikTokDisconnected(key, tiktokConnection, "error");
  });
  // F1 (audit) — liveness list now includes roomUser/follow/share (see
  // server/connectionHealth.js) so quiet-but-alive rooms stay demonstrably fresh.
  LIVENESS_EVENTS.forEach((eventName) => {
    tiktokConnection.on(eventName, () => touchTikTokConnection(key, tiktokConnection));
  });

  // Viewer-count relay (FLive parity) — the roomUser entry in LIVENESS_EVENTS
  // above only stamps lastEventAt; this SECOND listener reads the payload.
  // DISPLAY DATA ONLY (never a liveness/status signal): the owning-connection
  // guard (G1 discipline) stops a replaced/orphaned connection from emitting,
  // and the throttle state lives ON the tiktokConnections entry so it dies
  // with the connection — a fresh connection's first count always relays.
  // viewerCount is TOP-LEVEL on the legacy simplified shape (the F1 lesson:
  // `common` gets flattened+deleted by data-converter.js).
  // ⚠️ CONTRACT: platform:"TikTok" casing (the platform_status convention) is
  // PINNED by the client's useLiveFeed.viewers.test — read it before changing
  // this payload shape.
  tiktokConnection.on("roomUser", (data) => {
    const entry = tiktokConnections.get(key);
    if (!entry || entry.connection !== tiktokConnection) return; // owning guard
    const count = Number(data?.viewerCount);
    const now = Date.now();
    if (!shouldRelayViewers(entry.lastViewerCount, entry.lastViewerRelayAt || 0, count, now)) return;
    entry.lastViewerCount = count;
    entry.lastViewerRelayAt = now;
    io.to(sellerRoom(sellerId)).emit("platform_viewers", { platform: "TikTok", username: cleanUsername, count, ts: now });
  });

  tiktokConnection.on("chat", (data) => {
    // G1 — OWNING GUARD (money path): only the connection that is CURRENTLY the
    // seller's active connection for this key may relay. An orphaned old
    // connection (a failed disconnect() left its listeners alive) would otherwise
    // double-relay the SAME comment with a fresh server-stamped commentKey → a
    // DUPLICATE order (Auto Mode) / duplicate feed row. The ring write below shared
    // this predicate; both now go through isOwningConnection (one source of truth).
    // For Facebook (no msgId → no DB unique-index backstop) this guard is the ONLY
    // double-relay protection, so it is load-bearing enough for a pure unit test.
    if (!isOwningConnection(tiktokConnections, key, tiktokConnection)) return;
    touchTikTokConnection(key, tiktokConnection, "chat");
    const comment = data.comment || "";
    const name = data.nickname || data.uniqueId || "Unknown";
    const handle = data.uniqueId || "unknown";

    const payload = {
      handle,
      name,
      comment,
      avatar: data.profilePictureUrl || "", //
      platform: "TikTok",
      sellerId: emailIdOf(sellerId), // payload field = email id (client filter); room key = UUID
      // B3 fix — OWNERSHIP READ AT RELAY TIME, not from the creation closure:
      // the B2 reuse branch keeps entry.sessionId current with the latest
      // Connect tap, so the live flow follows the most recent device to tap
      // Connect (one tap recovers a reinstall/device switch). The owning-guard
      // above proved the entry exists this tick; the closure value is only the
      // defensive fallback (see server/connectionHealth.js relaySessionId).
      sessionId: relaySessionId(tiktokConnections.get(key), sessionId),
      sourceUsername: cleanUsername,
      roomId: state?.roomId || "",
      isBuy: false,
      buyerNum: null,
      buyerData: null,
      // Orderable earlier-comments (sql/18): the client stores this on the order
      // row so a later restored copy of the same message can render "Ordered ✓".
      // Legacy top-level shape (see server/initialComments.js msgIdOf).
      msgId: String(data.msgId || ""),
      // Miner-risk signals — READ-OFF-DATA ONLY (no profile fetch, no extra network
      // call). Both are CONDITIONAL: the connector's getUserAttributes adds followInfo
      // / userDetails only when TikTok includes them on THIS event, so an absent field
      // relays as `undefined` (backward-compatible — the client treats missing as
      // "unknown", never risky). followerCount = data.followInfo.followerCount;
      // accountCreatedAt = data.userDetails.createTime (ACCOUNT creation epoch —
      // DISTINCT from the message createTime handled elsewhere).
      followerCount: data.followInfo?.followerCount,
      accountCreatedAt: data.userDetails?.createTime,
      time: new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Taipei" }),
      timestamp: new Date().toISOString(),
    };
    void emitCommentScoped(sellerId, "TikTok", cleanUsername, payload);
    // RC2 — keep the reuse ring fresh with the latest relayed comments. Same
    // owning predicate as the top guard (consolidated to isOwningConnection); the
    // top guard already returned for a non-owning connection, so this is defensive
    // + a single source of truth for the check.
    if (isOwningConnection(tiktokConnections, key, tiktokConnection)) {
      const activeEntry = tiktokConnections.get(key);
      if (!activeEntry.recentComments) activeEntry.recentComments = [];
      pushRecent(activeEntry.recentComments, { ...payload }); // payload carries msgId now
    }
  });

  startTikTokHealthTimer(key, tiktokConnection);

  return tiktokConnection;
}

// ── B4 reuse is-LIVE verification (Phase 2: ENFORCED since 2026-07-14) ──────
// Decision core (reuseVerdict / singleFlight / timeout) lives in
// server/connectionHealth.js (vitest-covered — server.js has no harness).
const reuseVerifyInFlight = new Map();

// R3 (audit catch): a THROWAWAY, LISTENER-LESS connection — NEVER the live
// instance. fetchIsLive()'s fallback tiers call handleError() on intermediate
// failures (the HTML tier fails routinely); with a listener attached that
// becomes an `error` event, and OUR error listener answers with
// handleTikTokDisconnected — i.e. verifying on the live instance would tear
// down a healthy connection on a mere tier hiccup. On this listener-less
// probe, handleError is a structural no-op (tiktok-live-connector client.js:
// returns when listenerCount(ERROR) < 1). The probe is never connect()ed —
// fetchIsLive() is a standalone HTML → API → Euler status read.
// C1 → RETIRED TO OPTION (2026-07-14 W1 verdict): the direct Euler
// /webcast/room_id turned out to be PAYWALLED on the free tier — every call
// returned 401 "This endpoint requires a Business plan." (production
// [VERIFY-FALLBACK] capture). Not a bug — a pricing wall. The tiers walk is
// free-tier endpoints and carried the ENTIRE trilogy validation (~500ms,
// correct live/not_live verdicts), so it is now the DEFAULT — this also
// removes the dead 401 GET (+quota, ~100ms) every verify was burning before
// falling back. REUSE_VERIFY_SOURCE=euler stays as the env option: if we ever
// buy the Business plan, the ~100ms direct route (with the same diagnostic
// throw + tiers fallback) unlocks with an env change, zero code. Strict-
// boolean acceptance either way: anything that isn't a clean boolean is_live
// falls to reuseVerdict "ambiguous" → FAIL-OPEN.
const REUSE_VERIFY_SOURCE = process.env.REUSE_VERIFY_SOURCE || "tiers";

async function fetchIsLiveOutcome(cleanUsername) {
  try {
    const probe = new WebcastPushConnection(cleanUsername, {
      processInitialData: false,
      fetchRoomInfoOnConnect: false,
      signApiKey: process.env.EULER_API_KEY,
    });
    const timeout = new Promise((_, reject) => {
      const t = setTimeout(() => reject(new Error("reuse-verify timeout")), REUSE_VERIFY_TIMEOUT_MS);
      if (typeof t.unref === "function") t.unref();
    });
    // ⚠️ WIRE-SHAPE LESSON (2026-07-14 production capture — every verdict came
    // back "ambiguous" with NO reason at ~80-120ms): the Euler SDK ships
    // validateStatus:()=>true (SignConfig.baseOptions), so HTTP 401/403/429
    // RESOLVE with an error BODY instead of rejecting — and the original
    // silent shape-check (`? is_live : undefined`) swallowed exactly that
    // diagnosable failure. Two rules encoded here:
    //   1. A shape mismatch THROWS a diagnostic (code/ok/message/keys) so the
    //      [FRESH-VERIFY]/[REUSE-VERIFY] ambiguous line always carries the
    //      wire truth in its reason= suffix.
    //   2. A direct-route failure FALLS BACK to the tiers walk
    //      (probe.fetchIsLive()) — the path the Phase-1 shadow PROVED in
    //      production (257 correct live verdicts) — so the gate keeps
    //      functioning even while the direct route misbehaves. The whole
    //      chain still races the same 4s timeout.
    const eulerDirect = () =>
      probe.webClient.fetchRoomIdFromEuler({ uniqueId: cleanUsername }).then((d) => {
        if (d && d.code === 200 && typeof d.is_live === "boolean") return d.is_live;
        const keys = d && typeof d === "object" ? Object.keys(d).join(",") : typeof d;
        throw new Error(`euler_shape code=${d?.code} ok=${d?.ok} msg=${String(d?.message || "").slice(0, 60)} keys=${keys}`);
      });
    const fetchPromise = REUSE_VERIFY_SOURCE === "tiers"
      ? probe.fetchIsLive()
      : eulerDirect().catch((directErr) => {
          console.log(`[VERIFY-FALLBACK] euler-direct failed for ${cleanUsername} (${String(directErr?.message || directErr).slice(0, 140)}) — using tiers walk`);
          return probe.fetchIsLive();
        });
    const value = await Promise.race([fetchPromise, timeout]);
    return { value };
  } catch (error) {
    return { error };
  }
}

// B4 PHASE 2 — AWAITED verification (was fire-and-forget log-only). Same
// single-flight (R1: tap spam / two devices share ONE probe). The log line
// keeps the Phase-1 [REUSE-VERIFY] format and ADDS the enforced outcome
// marker for the 48hr post-flip watch:
//   not_live  → "BLOCKED"             (the 409 teardown fired)
//   live      → "allowed"
//   ambiguous → "allowed (fail-open)" (error/timeout/odd shape — never block)
// KILL SIGNAL: a BLOCKED line on an account that is actually live. Expected
// count across the watch: ZERO. Any hit → rollback / REUSE_VERIFY_SOURCE=tiers.
async function verifyIsLive(key, cleanUsername, tag) {
  const startedAt = Date.now();
  const outcome = await singleFlight(reuseVerifyInFlight, key, () => fetchIsLiveOutcome(cleanUsername));
  const verdict = reuseVerdict(outcome);
  const marker = verdict === "not_live" ? "BLOCKED" : verdict === "live" ? "allowed" : "allowed (fail-open)";
  console.log(`[${tag}] ${verdict} ${cleanUsername} ${Date.now() - startedAt}ms ${marker}${outcome.error ? ` reason=${String(outcome.error?.message || outcome.error).slice(0, 120)}` : ""}`);
  return verdict;
}

// FRESH-VERIFY shares the core (and the single-flight map — a concurrent
// reuse-verify and fresh-verify on the same key ride ONE probe); the separate
// [FRESH-VERIFY] tag keeps the running [REUSE-VERIFY] 48hr watch clean. The
// combined kill-signal grep is simply "BLOCKED" on an actually-live account.
async function verifyReuse(key, cleanUsername) {
  return verifyIsLive(key, cleanUsername, "REUSE-VERIFY");
}

async function connectTikTok(username, res, meta = {}) {
  let key = "";
  let sellerId = "";
  let sessionId = "";
  let cleanUsername = "";
  let forcedFresh = false; // B2 — a stale existing connection was replaced on this tap
  try {
    if (!username) {
      return res.status(400).json({
        success: false,
        error: "TikTok username is required",
      });
    }

    sellerId = cleanSellerId(meta.sellerId);
    if (!sellerId) {
      return res.status(400).json({
        success: false,
        error: "Seller account is required before connecting live",
      });
    }

    sessionId = String(meta.sessionId || "");
    cleanUsername = cleanAccountKey(username);
    if (!cleanUsername) {
      return res.status(400).json({
        success: false,
        error: "TikTok username is required",
      });
    }
    key = liveKey(sellerId, "TikTok", cleanUsername);
    const cooldownMs = getTikTokCooldownMs(key);
    if (cooldownMs > 0) {
      return res.status(429).json({
        success: false,
        error: `TikTok connection is on cooldown after a rate limit. Try again in ${Math.ceil(cooldownMs / 60000)} minutes.`,
        cooldownMs,
      });
    }

    const existing = tiktokConnections.get(key);
    // Concurrency cap applies ONLY to a genuinely NEW account (no prior entry for this
    // key). A reuse OR a force-fresh of the SAME key is the same account resuming — it
    // never raises the distinct-account count, so it's exempt (checked below, gated on
    // isNewKey). The !existing path is synchronous from here to the cap block (no await),
    // which keeps the count→reserve critical section race-free.
    const isNewKey = !existing;
    // STATUS-TRUTH (B2): reuse the existing connection ONLY when it is demonstrably
    // alive (event within CONNECT_REUSE_FRESH_MS). An event-silent connection on an
    // EXPLICIT Connect tap = force a fresh TikTok connection through the normal path
    // below (lock → clean disconnect → startTikTokConnection) — this is the seller's
    // self-service zombie fix (DoD #5: disconnect → refresh → connect just works).
    // NOTE: touchTikTokConnection is NOT called before the check — it would stamp
    // lastEventAt=now and mask the very staleness being measured.
    if (existing) {
      if (!shouldForceFreshConnect(existing.lastEventAt, Date.now())) {
        // B4 PHASE 2 (ENFORCED, 2026-07-14 GO — Phase-1 distribution 257 live /
        // 0 not_live / 2 ambiguous-fail-open, zero false blocks): the reuse tap
        // now AWAITS the is-LIVE verification. Same single-flight (R1), same
        // throwaway listener-less probe (R3), C1 Euler-first source (one GET).
        // Latency trade: the reuse tap gains ~0.2-0.8s typical (4s worst →
        // ambiguous → fail-open reuse) — the pill is already amber during the
        // POST, no new UX state.
        const verdict = await verifyReuse(key, cleanUsername);
        // R2 OWNERSHIP GUARD — the await yielded; the health cycle / another
        // tap may have replaced or deleted the entry. NEVER act on the stale
        // reference: on mismatch, fall through to the normal fresh path below
        // (idempotent — worst case one extra clean connect, correct end state).
        const owned = tiktokConnections.get(key);
        if (owned && owned === existing && verdict === "not_live") {
          // ZOMBIE ESCAPE (the B4 fix itself) — TikTok's own signal says this
          // room is over: tear down the dead connection and answer exactly like
          // the fresh-path 409 (client toast/gray handling needs ZERO change;
          // byte-parity pinned by b4Phase2.contract.test).
          // ⚠️ 3b SEAM (Jeff requirement, 2026-07-13): this teardown RETURNS
          // BEFORE the ring re-emit and the A4 viewer re-emit below — no stale
          // history/count emit may accompany a 409.
          clearTikTokHealthTimer(existing);
          tiktokConnections.delete(key);
          try { existing.connection.disconnect(); } catch { /* already dead */ }
          clearTikTokReconnect(key);
          tiktokReconnectAttempts.delete(key);
          recordTikTokAttempt("not_live", "reuse-verify");
          emitTikTokStatus({ sellerId, username: cleanUsername, sessionId, connected: false, reconnecting: false, reason: "not_live" });
          return res.status(409).json({
            success: false,
            notLive: true,
            error: "Account is not live right now. Start your TikTok LIVE first.",
          });
        }
        if (owned && owned === existing) {
        // live / ambiguous (fail-open) → the EXISTING reuse flow, byte-unchanged.
        existing.sessionId = sessionId || existing.sessionId;
        emitTikTokStatus({
          sellerId,
          username: cleanUsername,
          sessionId: existing.sessionId,
          connected: true,
          reconnecting: false,
          reason: "already_connected",
        });
        // clientfix RC2 — the reuse branch never runs startTikTokConnection, so
        // a refresh mid-live (healthy connection) previously got NO history
        // block at all. Re-emit the connection's recent-comments ring flagged
        // initial:true (display-only lane; the client's empty-feed guard drops
        // it whenever these comments are already showing live). Best-effort.
        try {
          const ring = existing.recentComments || [];
          if (ring.length) {
            console.log(`[INITIAL] reuse re-emit ${ring.length} recent comments for ${cleanUsername} (${sellerId})`);
            for (const p of ring) {
              // M1 — carry the REQUESTER's sessionId so a second device's
              // client doesn't drop the block on its own sessionId filter.
              void emitCommentScoped(sellerId, "TikTok", cleanUsername, reuseReEmitPayload(p, sessionId));
            }
          }
        } catch (err) {
          console.warn(`[INITIAL] reuse re-emit failed for ${cleanUsername} (reuse unaffected):`, err?.message || err);
        }
        // Viewer chip instant-on for the reuse tap (plan A4, audit-approved):
        // the client NULLS its count at connect initiation, and the throttle
        // stays silent while the count is unchanged — without this re-emit a
        // quiet room's chip would wait for the 30s heartbeat after EVERY reuse
        // tap. Pure re-emit of the last known count (throttle state untouched).
        // Inherits the open B4 caveat: a zombie reuse re-emits a stale count —
        // cosmetic, same root, closed by B4 Phase 2. Best-effort.
        if (Number.isFinite(existing.lastViewerCount) && existing.lastViewerCount >= 0) {
          io.to(sellerRoom(sellerId)).emit("platform_viewers", {
            platform: "TikTok", username: cleanUsername, count: existing.lastViewerCount, ts: Date.now(),
          });
        }
        return res.json({
          success: true,
          message: "Connected to your TikTok LIVE.", // Build 10b — no reuse detail in the answer
        });
        }
        // R2 fall-through: ownership moved mid-verify (health cycle replaced /
        // deleted the entry while we awaited). The stale reference is dead to
        // us — take the normal fresh path below, which operates on the KEY
        // (disconnect whatever holds it now → clean connect). Idempotent.
        forcedFresh = true;
        console.log(`[CONNECT] ownership moved mid-verify for ${cleanUsername} — fresh connect instead of stale reuse`);
      } else {
        forcedFresh = true;
        console.log(`[CONNECT] force_fresh for ${cleanUsername}: event-silent ${Math.round((Date.now() - (existing.lastEventAt || 0)) / 1000)}s — replacing stale connection`);
      }
    }

    if (tiktokConnectLocks.has(key)) {
      return res.status(429).json({
        success: false,
        error: "TikTok connection is already starting. Please wait before trying again.",
      });
    }
    // Acquire the per-KEY lock BEFORE the cap block (has→add is synchronous, no await
    // between) so a parallel connect to the SAME new account can't slip past into the
    // kick-await window below. Released in the finally. (The concurrency reservation
    // below guards the CROSS-account race; this key lock guards the same-account race.)
    tiktokConnectLocks.add(key);

    // ── PER-SELLER CONCURRENCY CAP (kick-oldest) — NEW accounts only. Synchronous
    // critical section: snapshot → decide → RESERVE (before any await) so parallel
    // new-key connects for the same seller can't both pass. Admin / unknown-plan →
    // concurrencyCap returns null → allow (never false-block a paying seller on a DB
    // hiccup). Only FRESH (≤60s) connections count → a crashed device self-clears.
    if (isNewKey) {
      const now = Date.now();
      const entries = [];
      for (const [k, e] of tiktokConnections) entries.push({ key: k, sellerId: e.sellerId, startedAt: e.startedAt, lastEventAt: e.lastEventAt });
      const realFresh = freshLiveKeysForSeller(entries, sellerId, now, key);
      let reservedCount = 0;
      for (const [rk, r] of liveConnectReservations) if (rk !== key && String(r.sellerId || "") === sellerId) reservedCount += 1;
      const decision = capDecision({ realFresh, reservedCount, max: concurrencyCap(meta.plan, meta.role) });
      if (decision.action === "block") {
        // Pure parallel race (sibling reservation holds the only slot) — reject this one.
        console.log(`[CONCURRENCY] block seller=${sellerId} plan=${meta.plan} tried=${cleanUsername} (already at cap)`);
        return res.status(429).json({
          success: false,
          concurrentLimit: true,
          error: "You're already connecting a live on another device. Please try again.",
        });
      }
      if (decision.action === "kick") {
        // At cap: tear down the seller's oldest fresh live(s) to make room, then connect
        // the new one → net concurrency stays at the plan's max. Reuse the existing clean
        // teardown; emit a terminal gray for each kicked account so its pill (on the other
        // device) stops showing green. RESERVE FIRST so the awaited teardown can't open a
        // TOCTOU window. Sacred comment-delivery path untouched.
        liveConnectReservations.set(key, { sellerId, startedAt: now });
        for (const victimKey of decision.keys) {
          const victim = tiktokConnections.get(victimKey);
          const vUser = victim ? victim.username : "";
          const vSession = victim ? victim.sessionId : "";
          console.log(`[CONCURRENCY] kick seller=${sellerId} plan=${meta.plan} victim=${victimKey} for new=${cleanUsername}`);
          await disconnectTikTokConnection(victimKey, { manual: true });
          if (vUser) emitTikTokStatus({ sellerId, username: vUser, sessionId: vSession, connected: false, reconnecting: false, reason: "live_session_ended" });
        }
      } else {
        // Under cap → still reserve the slot for the duration of this async connect.
        liveConnectReservations.set(key, { sellerId, startedAt: now });
      }
    }

    await disconnectTikTokConnection(key, { manual: true });
    await startTikTokConnection(key, cleanUsername, sellerId, sessionId, { emitStart: true });

    return res.json({
      success: true,
      message: `Connected to TikTok LIVE: ${cleanUsername}`,
    });
  } catch (error) {
    console.log(error);
    // B2 — if this tap REPLACED a stale connection and the fresh connect failed,
    // the old (possibly green) status is now definitively dead: emit a terminal
    // gray so the pill never shows a stale green after a failed force-fresh.
    // Deliberately ONLY when forcedFresh (rate-limit already emits its own): a
    // plain failed connect for account B must not gray a live account A's pill.
    if (forcedFresh && !isTikTokRateLimitError(error)) {
      emitTikTokStatus({
        sellerId,
        username: cleanUsername,
        sessionId,
        connected: false,
        reconnecting: false,
        reason: error && error.notLive ? "not_live" : "connect_failed",
      });
    }
    if (error && error.notLive) {
      // Account resolved connect() but is not live → distinct 409 (NOT a 500/red
      // "can't reach server"). No reconnect is scheduled from this catch.
      recordTikTokAttempt("not_live", `status=${error.liveStatus}`);
      return res.status(409).json({
        success: false,
        notLive: true,
        error: "Account is not live right now. Start your TikTok LIVE first.",
      });
    }
    if (key && isTikTokRateLimitError(error)) {
      recordTikTokAttempt("rate_limit", error?.message);
      // #4 — the cooldown now reflects Euler's own reset window (else 30 min),
      // not a fixed 24h. Report the real duration in the response.
      const cooldownMs = rememberTikTokRateLimit(key, sellerId, cleanUsername, sessionId, error);
      const mins = Math.max(1, Math.round(cooldownMs / 60000));
      const wait = mins >= 60 ? `${Math.round(mins / 60)} hour(s)` : `${mins} minute(s)`;
      return res.status(429).json({
        success: false,
        error: `TikTok rate limit reached. Try again in about ${wait}.`,
        cooldownMs,
      });
    }

    recordTikTokAttempt("fail", error?.message);
    return res.status(500).json({
      success: false,
      error: error.message,
    });
  } finally {
    if (key) tiktokConnectLocks.delete(key);
    if (key) liveConnectReservations.delete(key); // release the concurrency reservation (success or failure)
  }
}

// M5 (security audit 2026-09-26) — the GET /test-comment route was DELETED outright.
// It injected a fake comment into an arbitrary seller's room, gated only by a
// query-string shared secret compared with !==, and bypassed emitCommentScoped's
// sanitizer. It had ZERO production callers (the client's synthetic injector is
// window.__sflInject, a client-side mechanism). Nothing to configure anymore —
// the old "verify TEST_COMMENT_TOKEN is unset on Render" audit item (S3) is moot.

// Keep Render awake — i-lagay bago ang server.listen
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || "";
let keepAliveTimer = null;
if (RENDER_URL && typeof fetch === "function") {
  keepAliveTimer = setInterval(() => {
    try {
      fetch(`${RENDER_URL}/health`)
        .then(() => console.log("Keep-alive ping sent"))
        .catch((err) => console.warn("Keep-alive failed:", err.message));
    } catch (err) {
      console.warn("Keep-alive failed:", err.message);
    }
  }, 840000); // every 14 minutes
}

// ── SHOPEE LIVE (P2) — wire ONLY when fully configured + enabled ─────────────
// Fail-closed: needs shopeeConfig().enabled (SHOPEE_ENABLED="true" + partner id/
// key + token key) AND the service-role client AND RENDER_EXTERNAL_URL (OAuth
// redirect). When OFF: no routes are registered, no timers start, ZERO behavior
// change. All logic lives in server/shopeeLive.js; this block is the thin wiring.
let shopeeRuntime = null;
// F5 — a Shopee init failure must NEVER take down the server (and the live TikTok
// relays). The whole gated block is wrapped so any throw is logged and leaves
// shopeeRuntime null; TikTok routes/relays are unaffected.
try {
  const shopeeCfg = shopeeConfig();
  if (shopeeCfg.enabled && serviceSb && RENDER_URL) {
    const store = {
      // Throws on a database error: the authorize callback shows an error, never "no limit".
      async getPlan(userId) {
        const { data, error } = await serviceSb.from("seller_profiles").select("plan").eq("auth_user_id", userId).maybeSingle();
        if (error) throw new Error("plan_read_failed");
        return data?.plan || "";
      },
      async countShops(userId) {
        const { count, error } = await serviceSb.from("shopee_shops").select("id", { count: "exact", head: true }).eq("user_id", userId);
        if (error) throw new Error("count_read_failed");
        return count || 0;
      },
      async getShop(userId, shopId) {
        const { data } = await serviceSb.from("shopee_shops").select("*").eq("user_id", userId).eq("shop_id", Number(shopId)).maybeSingle();
        return data || null;
      },
      async upsertShop(row) {
        // Throws on a database error; the combined account limit (sql/84) → "account_limit".
        const { error } = await serviceSb.from("shopee_shops").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id,shop_id" });
        if (error) throw new Error(/account_limit/.test(String(error.message || "")) ? "account_limit" : "shop_save_failed");
      },
      async listActiveShops() {
        const { data } = await serviceSb.from("shopee_shops").select("*").eq("active", true);
        return data || [];
      },
      async updateTokens(userId, shopId, { access, refresh, expiresAtIso }) {
        await serviceSb.from("shopee_shops").update({ access_token: access, refresh_token: refresh, token_expires_at: expiresAtIso, active: true, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("shop_id", Number(shopId));
      },
      async setActive(userId, shopId, active) {
        await serviceSb.from("shopee_shops").update({ active, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("shop_id", Number(shopId));
      },
    };
    shopeeRuntime = createShopeeRuntime({
      config: shopeeCfg,
      store,
      liveKey,
      renderUrl: RENDER_URL,
      // → the SAME emitCommentScoped choke-point (sanitizes + per-account scoping).
      emitComment: (sellerId, shopUsername, payload) => { void emitCommentScoped(sellerId, "Shopee", shopUsername, { ...payload, sellerId: emailIdOf(sellerId) }); },
      // platform_status for the Shopee pill (username = shop id, the scoping key).
      statusEmit: (sellerId, { connected, shopId, sessionId }) => {
        io.to(sellerRoom(sellerId)).emit("platform_status", { platform: "Shopee", connected, sellerId: emailIdOf(sellerId), username: String(shopId), sessionId: String(sessionId || "") });
      },
      log: (line) => console.log(line),
    });
    // F3 — pass the SAME connect middlewares TikTok uses so /shopee/connect
    // enforces the paywall (requirePlanActive) + rate limit (requireConnectRate).
    shopeeRuntime.registerRoutes(app, requireAuth, { requireConnectRate, requirePlanActive, accountLiveCheck });
    shopeeRuntime.startRefreshTimer();
    console.log("[SHOPEE] enabled — OAuth + poller routes registered");
  }
} catch (e) {
  shopeeRuntime = null;
  console.error("[SHOPEE] init failed — Shopee disabled, TikTok unaffected:", e && e.message);
}

// ── FACEBOOK LIVE (F-P2) — wire ONLY when fully configured + enabled ─────────
// Fail-closed: needs fbConfig().enabled (FB_ENABLED="true" + app id/secret + token
// key) AND the service-role client AND RENDER_EXTERNAL_URL (OAuth redirect). When
// OFF: no routes are registered, no timers start, ZERO behavior change. All logic
// lives in server/fbLive.js; this block is the thin wiring. NOTE: this is entirely
// SEPARATE from the /connect/facebook stopgap + server/fbLiveness.js (the 6h-green
// pill) — different routes (/fb/*), untouched here.
let fbRuntime = null;
let stopReceiptCleanup = null;
let autoReceiptRunner = null; // B1 — set inside the Facebook block; the timer below is a no-op while null
// F5 — an FB init failure must NEVER take down the server (or the live TikTok/Shopee
// relays). The whole gated block is wrapped so any throw is logged and leaves
// fbRuntime null; TikTok/Shopee routes/relays are unaffected.
try {
  const fbCfg = fbConfig();
  if (fbCfg.enabled && serviceSb && RENDER_URL) {
    const autoReceiptFlag = createFbFlagReader({
      readFlag: async () => {
        const { data, error } = await serviceSb.from("app_settings").select("value").eq("key", "fb_auto_receipt_enabled").maybeSingle();
        if (error) throw new Error("fb_auto_receipt_enabled_read_failed");
        return data ? data.value : null;
      },
    });
    const store = {
      // Throws on a database error: the authorize callback shows an error, never "no limit".
      async getPlan(userId) {
        const { data, error } = await serviceSb.from("seller_profiles").select("plan").eq("auth_user_id", userId).maybeSingle();
        if (error) throw new Error("plan_read_failed");
        return data?.plan || "";
      },
      async countPages(userId) {
        const { count, error } = await serviceSb.from("fb_pages").select("id", { count: "exact", head: true }).eq("user_id", userId);
        if (error) throw new Error("count_read_failed");
        return count || 0;
      },
      // Throws on a database error (null only when there really is no row): the poller keeps
      // looping, /fb/connect answers 502 fb_check_failed, the receipt treats it as no page.
      // The OAuth confirm page: which SellerFlowLive account receives the Page. Throws on a
      // database error; null when there is no profile row.
      async getAccountLabel(userId) {
        const { data, error } = await serviceSb.from("seller_profiles").select("email, store_name").eq("auth_user_id", String(userId || "")).maybeSingle();
        if (error) throw new Error("fb_account_read_failed");
        return data ? { email: data.email || "", storeName: data.store_name || "" } : null;
      },
      async getPage(userId, pageId) {
        const { data, error } = await serviceSb.from("fb_pages").select("*").eq("user_id", userId).eq("page_id", String(pageId)).maybeSingle();
        if (error) throw new Error("fb_page_read_failed");
        return data || null;
      },
      // fb_receipt_access (sql/73): may this user grant pages_messaging? Any error → false.
      async hasReceiptAccess(userId) {
        try {
          const { data, error } = await serviceSb.from("fb_receipt_access").select("user_id").eq("user_id", String(userId || "")).eq("enabled", true).maybeSingle();
          return !error && !!data;
        } catch { return false; }
      },
      // ── Messenger receipt (server/fbReceipt.js, sql/75) — service role, explicit user_id ──
      async listReceiptOrders(userId, sessionId, buyerNumber, sinceIso) {
        const { data, error } = await serviceSb.from("live_session_orders")
          .select("comment_msg_id, platform_meta, handle, created_at")
          .eq("user_id", userId).eq("session_id", sessionId).eq("buyer_number", buyerNumber)
          .eq("platform", "Facebook").not("comment_msg_id", "is", null).gte("created_at", sinceIso);
        if (error) throw new Error("receipt_orders_read");
        return data || [];
      },
      async listReceiptRows(commentIds) {
        const { data, error } = await serviceSb.from("fb_receipts").select("user_id, comment_id, status, sent_at, kind, error_code").in("comment_id", commentIds);
        if (error) throw new Error("receipt_rows_read");
        return data || [];
      },
      async insertReceipt(row) {
        const { data, error } = await serviceSb.from("fb_receipts").insert(row).select("id").single();
        if (error) return error.code === "23505" ? { conflict: true } : { error: "insert_failed" };
        return { id: data.id };
      },
      // Returns { error } when the update is refused (fbReceipt retries a failed-send update
      // without error_detail if that column is missing); callers that ignore it are unchanged.
      async updateReceipt(id, patch) {
        const { error } = await serviceSb.from("fb_receipts").update(patch).eq("id", id);
        return error ? { error } : {};
      },
      // F2 sold-out message (sql/91): the seller's own toggle + text. Throws on a read error
      // (fbSoldout treats that as off).
      async getSoldoutSettings(userId) {
        const { data, error } = await serviceSb.from("seller_receipt_settings").select("soldout_enabled, soldout_text").eq("user_id", String(userId || "")).maybeSingle();
        if (error) throw new Error("soldout_settings_read");
        return { enabled: data?.soldout_enabled === true, text: String(data?.soldout_text || "") };
      },
      // Own pending claim only (upload failed → nothing reached Facebook). true when deleted.
      async deleteReceipt(id, userId) {
        const { error } = await serviceSb.from("fb_receipts").delete().eq("id", id).eq("user_id", userId).eq("status", "pending");
        return !error;
      },
      // Receipt picture cleanup (startReceiptImageCleanup): the oldest objects first, only those
      // created before beforeIso. Folder placeholders (no id) are skipped.
      async listOldReceiptImages(beforeIso, limit) {
        const { data, error } = await serviceSb.storage.from("fb-receipts").list("", { limit, offset: 0, sortBy: { column: "created_at", order: "asc" } });
        if (error) throw new Error("receipt_images_list");
        return (data || []).filter((o) => o && o.id && o.created_at && o.created_at < beforeIso).map((o) => o.name);
      },
      async removeReceiptImages(paths) {
        const { data, error } = await serviceSb.storage.from("fb-receipts").remove(paths);
        if (error) throw new Error("receipt_images_remove");
        return (data || []).length;
      },
      // Read-only Facebook alt probe (server/fbProbe.js, sql/78): metadata only, service role.
      async insertProbeRow(row) {
        const { error } = await serviceSb.from("fb_probe_log").insert(row);
        if (error) throw new Error("fb_probe_log_insert_failed");
      },
      async uploadReceiptImage(path, buf) {
        const { error } = await serviceSb.storage.from("fb-receipts").upload(path, buf, { contentType: "image/png", upsert: false });
        if (error) throw new Error("upload_failed");
        return serviceSb.storage.from("fb-receipts").getPublicUrl(path).data.publicUrl;
      },
      // ── B1 automatic receipt (sql/100) — service role, explicit user_id ──
      // Queues a job 10 minutes after the live ended, only while fb_auto_receipt_enabled is on.
      async insertAutoReceiptJob({ userId, pageId, liveVideoId }) {
        if (!userId || !pageId || !liveVideoId || !(await autoReceiptFlag())) return;
        await serviceSb.from("fb_auto_receipt_jobs").insert({
          user_id: String(userId), page_id: String(pageId), live_video_id: String(liveVideoId),
          due_at: new Date(Date.now() + AUTO_RECEIPT_DELAY_MS).toISOString(),
        });
      },
      async claimJobs(limit) {
        const { data, error } = await serviceSb.rpc("claim_auto_receipt_jobs", { p_limit: limit });
        if (error) throw new Error("auto_receipt_claim");
        return data || [];
      },
      async finishJob(id, patch) {
        const { error } = await serviceSb.from("fb_auto_receipt_jobs").update(patch).eq("id", id).eq("status", "running");
        if (error) throw new Error("auto_receipt_finish");
      },
      async readProfile(userId) {
        const { data, error } = await serviceSb.from("seller_profiles").select("plan, plan_status").eq("auth_user_id", String(userId || "")).maybeSingle();
        if (error) throw new Error("auto_receipt_profile");
        return data || null;
      },
      async getAutoReceiptSettings(userId) {
        const { data, error } = await serviceSb.from("seller_receipt_settings")
          .select("opening, note, qr_image, auto_receipt_enabled, auto_receipt_lang, auto_receipt_currency")
          .eq("user_id", String(userId || "")).maybeSingle();
        if (error) throw new Error("auto_receipt_settings");
        if (!data) return null;
        return { enabled: data.auto_receipt_enabled === true, opening: data.opening || "", note: data.note || "", qrImage: data.qr_image || null, lang: data.auto_receipt_lang || "en", currency: data.auto_receipt_currency || "NT$" };
      },
      // That live's Facebook orders (platform_meta.live_video_id), oldest first, all pages.
      async listLiveRows(userId, liveVideoId) {
        const out = [];
        for (let from = 0; ; from += 1000) {
          const { data, error } = await serviceSb.from("live_session_orders")
            .select("id, session_id, buyer_number, handle, customer_name, product, price, qty, created_at")
            .eq("user_id", String(userId)).eq("platform", "Facebook").eq("platform_meta->>live_video_id", String(liveVideoId))
            .order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, from + 999);
          if (error) throw new Error("auto_receipt_rows");
          out.push(...(data || []));
          if (!data || data.length < 1000) return out;
        }
      },
      async listPages(userId) {
        // NEVER select access_token — the /fb/pages response must not carry tokens.
        const { data } = await serviceSb.from("fb_pages").select("page_id, page_name, page_username, active, token_expires_at").eq("user_id", userId); // the expiry date only (fb_stop_reasons badge)
        return data || [];
      },
      // Throws on a database error so the OAuth callback never reports a page as saved when it
      // was not (handleCallback counts it as failed → ?fb=error&code=save_failed).
      async upsertPage(row) {
        const { error } = await serviceSb.from("fb_pages").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id,page_id" });
        if (error) throw new Error(/account_limit/.test(String(error.message || "")) ? "account_limit" : "fb_page_save_failed");
      },
      async listActivePages() {
        const { data } = await serviceSb.from("fb_pages").select("*").eq("active", true);
        return data || [];
      },
      async setActive(userId, pageId, active) {
        await serviceSb.from("fb_pages").update({ active, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("page_id", String(pageId));
      },
      async updateExpiry(userId, pageId, iso) {
        await serviceSb.from("fb_pages").update({ token_expires_at: iso, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("page_id", String(pageId));
      },
      // Build 8 (sql/111 fb_pages.fb_user_id): who authorized the Page. Throws on error; the OAuth
      // callback ignores it (before sql/111 the column is missing and the Page is saved anyway).
      async setPageFbUser(userId, pageId, fbUserId) {
        const { error } = await serviceSb.from("fb_pages").update({ fb_user_id: String(fbUserId) }).eq("user_id", userId).eq("page_id", String(pageId));
        if (error) throw new Error("fb_user_save_failed");
      },
      // Meta Deauthorize Callback: delete every Page this Facebook user authorized (any seller).
      async deletePagesByFbUser(fbUserId) {
        const { data, error } = await serviceSb.from("fb_pages").delete().eq("fb_user_id", String(fbUserId)).select("user_id,page_id");
        if (error) throw new Error("fb_deauth_failed");
        return data || [];
      },
    };
    // fb_stop_reasons (sql/104): read like fb_enabled (service role, cached 60 s); off on any error.
    const fbStopReasonsFlag = createFbFlagReader({
      readFlag: async () => {
        const { data, error } = await serviceSb.from("app_settings").select("value").eq("key", "fb_stop_reasons").maybeSingle();
        if (error) throw new Error("fb_stop_reasons_read_failed");
        return data ? data.value : null;
      },
    });
    // fb_comment_paging (sql/105): same cached reader (60 s); off on any error. Asked only when a
    // poll's first page is full and all new (a code drop), never on a normal tick.
    const fbCommentPagingFlag = createFbFlagReader({
      readFlag: async () => {
        const { data, error } = await serviceSb.from("app_settings").select("value").eq("key", "fb_comment_paging").maybeSingle();
        if (error) throw new Error("fb_comment_paging_read_failed");
        return data ? data.value : null;
      },
    });
    // fb_identity_v2 (sql/106): same cached reader (60 s); off on any error. Read once per Connect.
    const fbIdentityV2Flag = createFbFlagReader({
      readFlag: async () => {
        const { data, error } = await serviceSb.from("app_settings").select("value").eq("key", "fb_identity_v2").maybeSingle();
        if (error) throw new Error("fb_identity_v2_read_failed");
        return data ? data.value : null;
      },
    });
    fbRuntime = createFbRuntime({
      config: fbCfg,
      store,
      stopReasonsEnabled: fbStopReasonsFlag,
      commentPagingEnabled: fbCommentPagingFlag,
      identityV2Enabled: fbIdentityV2Flag,
      liveKey,
      renderUrl: RENDER_URL,
      // → the SAME emitCommentScoped choke-point (sanitizes + per-account scoping).
      emitComment: (sellerId, scopeKey, payload) => { void emitCommentScoped(sellerId, "Facebook", scopeKey, { ...payload, sellerId: emailIdOf(sellerId) }); },
      // platform_status for the Facebook pill (username = the scoping key = page
      // username || page id, matching the emitComment sourceUsername).
      // sessionId = the CONNECTING browser's session (from the /fb/connect body), NOT the
      // live-video id — useLiveFeed drops any status whose sessionId ≠ its own, which is why
      // the FB pill never went green when this carried liveVideoId.
      // fb_stop_reasons — a stop carries its reason (additive; absent on connected:true).
      statusEmit: (sellerId, { connected, scopeKey, sessionId, reason }) => {
        io.to(sellerRoom(sellerId)).emit("platform_status", { platform: "Facebook", connected, sellerId: emailIdOf(sellerId), username: String(scopeKey || ""), sessionId: String(sessionId || ""), ...(!connected && reason ? { reason: String(reason) } : {}) });
      },
      log: (line) => console.log(line),
    });
    // F3 — pass the SAME connect middlewares TikTok uses so /fb/connect enforces the
    // paywall (requirePlanActive) + rate limit (requireConnectRate).
    // Server-side lock (server/fbAccess.js): app_settings.fb_enabled (service role, cached 60 s)
    // OR a preview account — the same rule as the client gate.
    const fbEnabled = createFbFlagReader({
      readFlag: async () => {
        const { data, error } = await serviceSb.from("app_settings").select("value").eq("key", "fb_enabled").maybeSingle();
        if (error) throw new Error("fb_enabled_read_failed");
        return data ? data.value : null;
      },
    });
    // Testers without a code change (sql/77): an enabled fb_tester_access row (service role,
    // cached 60 s per email like fb_enabled). They still go through the plan checks.
    const isFbTester = createFbTesterReader({
      readTester: async (email) => {
        const { data, error } = await serviceSb.from("fb_tester_access").select("email").eq("email", email).eq("enabled", true).maybeSingle();
        if (error) throw new Error("fb_tester_read_failed");
        return !!data;
      },
    });
    const requireFbAvailable = createFbLock({ fbEnabled, isFbTester });
    // What the app may show: Facebook (the lock's decision) + Messenger receipts (fb_receipt_access).
    app.get("/fb/access", requireAuth, createFbAccessHandler({ fbEnabled, isFbTester, hasReceiptAccess: (uid) => store.hasReceiptAccess(uid) }));
    // Facebook-only plan check on /fb/connect: a free plan must be "active" (the shared
    // checkPlanActive lets "free" through whatever its status). plan_status is not on the
    // request, so a free (or unknown) plan costs one service-role read here.
    const requireFbPlan = createFbPlanCheck({
      readProfile: async (userId) => {
        const { data, error } = await serviceSb.from("seller_profiles").select("plan, plan_status, role").eq("auth_user_id", String(userId || "")).maybeSingle();
        if (error) throw new Error("fb_plan_read_failed");
        return data || null;
      },
    });
    fbRuntime.registerRoutes(app, requireAuth, { requireConnectRate, requirePlanActive, requireFbAvailable, requireFbPlan, accountLiveCheck });
    // Messenger receipt (fb_receipt_access only) — reads/writes its own rows; never the poller.
    // Isolated: a throw here must never null fbRuntime or skip the refresh timer below.
    let fbReceiptApi = null; // one instance: the manual send and the automatic receipt share its buyer lock
    try {
      fbReceiptApi = createFbReceipt({ config: fbCfg, store, log: (line) => console.log(line) });
      fbReceiptApi.registerRoutes(app, requireAuth);
    } catch {
      console.log("[FB] receipt routes not registered");
    }
    // F2 — sold-out text reply (switch fb_soldout_enabled, read like fb_enabled; fb_receipt_access;
    // the seller's toggle; page owned; comment emitted by this seller's poller). Isolated.
    try {
      const soldoutEnabled = createFbFlagReader({
        readFlag: async () => {
          const { data, error } = await serviceSb.from("app_settings").select("value").eq("key", "fb_soldout_enabled").maybeSingle();
          if (error) throw new Error("fb_soldout_enabled_read_failed");
          return data ? data.value : null;
        },
      });
      createFbSoldout({
        config: fbCfg, store, soldoutEnabled,
        isOwnedComment: (userId, commentId, pageId) => fbRuntime ? fbRuntime.wasEmitted(userId, commentId, pageId) : false,
        log: (line) => console.log(line),
      }).registerRoutes(app, requireAuth);
    } catch {
      console.log("[FB] sold-out route not registered");
    }
    // B1 — automatic receipt after a live (switch fb_auto_receipt_enabled, read like fb_enabled;
    // plan plus/pro/master; fb_receipt_access; the seller's toggle). Isolated.
    try {
      if (fbReceiptApi) autoReceiptRunner = createAutoReceiptRunner({
        store, flag: autoReceiptFlag, hasAccess: (uid) => store.hasReceiptAccess(uid),
        fetchImpl: withAppSecretProof(globalThis.fetch, fbCfg.appSecret), // Build 8: the preflight GET too
        receipt: fbReceiptApi, log: (line) => console.log(line),
      });
    } catch {
      autoReceiptRunner = null;
      console.log("[FB] auto-receipt not started");
    }
    // Receipt pictures older than 24 hours are deleted from the bucket (hourly).
    try {
      stopReceiptCleanup = startReceiptImageCleanup({ store, log: (line) => console.log(line) });
    } catch {
      console.log("[FB] receipt image cleanup not started");
    }
    fbRuntime.startRefreshTimer();
    console.log("[FB] enabled — OAuth + poller routes registered");
  }
} catch (e) {
  fbRuntime = null;
  console.error("[FB] init failed — Facebook disabled, TikTok/Shopee unaffected:", e && e.message);
}
// B1 automatic receipt: one small job claim per minute (no-op while the Facebook block did not
// create the runner). Never throws; unref'd.
{
  const autoReceiptTimer = setInterval(() => { if (autoReceiptRunner) void autoReceiptRunner.tick().catch(() => {}); }, AUTO_RECEIPT_TICK_MS);
  if (typeof autoReceiptTimer.unref === "function") autoReceiptTimer.unref();
}

// ── INSTAGRAM LIVE (phase 1, admin / preview only) — server/igLive.js ─────────
// OFF unless IG_ENABLED is "true" on Render (plus the Facebook secrets). Per request also
// locked by server/igAccess.js (ig_enabled / preview list / ig_tester_access). Any init
// failure leaves igRuntime null; nothing else is affected.
let igRuntime = null;
try {
  const igCfg = igConfig();
  if (igCfg.enabled && serviceSb && RENDER_URL) {
    const igStore = {
      async getPlan(userId) {
        const { data, error } = await serviceSb.from("seller_profiles").select("plan").eq("auth_user_id", userId).maybeSingle();
        if (error) throw new Error("plan_read_failed");
        return data?.plan || "";
      },
      async countAccounts(userId) {
        const { count, error } = await serviceSb.from("ig_accounts").select("id", { count: "exact", head: true }).eq("user_id", userId);
        if (error) throw new Error("count_read_failed");
        return count || 0;
      },
      async getAccountLabel(userId) {
        const { data, error } = await serviceSb.from("seller_profiles").select("email, store_name").eq("auth_user_id", String(userId || "")).maybeSingle();
        if (error) throw new Error("ig_account_label_failed");
        return data ? { email: data.email || "", storeName: data.store_name || "" } : null;
      },
      async getAccount(userId, igUserId) {
        const { data, error } = await serviceSb.from("ig_accounts").select("*").eq("user_id", userId).eq("ig_user_id", String(igUserId)).maybeSingle();
        if (error) throw new Error("ig_account_read_failed");
        return data || null;
      },
      async listAccounts(userId) {
        // NEVER the token column.
        const { data } = await serviceSb.from("ig_accounts").select("ig_user_id, ig_username, page_name, active").eq("user_id", userId);
        return data || [];
      },
      async upsertAccount(row) {
        const { error } = await serviceSb.from("ig_accounts").upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: "user_id,ig_user_id" });
        if (error) throw new Error(/account_limit/.test(String(error.message || "")) ? "account_limit" : "ig_account_save_failed");
      },
      async setActive(userId, igUserId, active) {
        await serviceSb.from("ig_accounts").update({ active, updated_at: new Date().toISOString() }).eq("user_id", userId).eq("ig_user_id", String(igUserId));
      },
    };
    igRuntime = createIgRuntime({
      config: igCfg,
      store: igStore,
      liveKey,
      renderUrl: RENDER_URL,
      // → the SAME emitCommentScoped choke-point (sanitizes + per-account scoping).
      emitComment: (sellerId, scopeKey, payload) => { void emitCommentScoped(sellerId, "Instagram", scopeKey, { ...payload, sellerId: emailIdOf(sellerId) }); },
      statusEmit: (sellerId, { connected, scopeKey, sessionId }) => {
        io.to(sellerRoom(sellerId)).emit("platform_status", { platform: "Instagram", connected, sellerId: emailIdOf(sellerId), username: String(scopeKey || ""), sessionId: String(sessionId || "") });
      },
      log: (line) => console.log(line),
    });
    const igEnabled = createFbFlagReader({
      readFlag: async () => {
        const { data, error } = await serviceSb.from("app_settings").select("value").eq("key", "ig_enabled").maybeSingle();
        if (error) throw new Error("ig_enabled_read_failed");
        return data ? data.value : null;
      },
    });
    const isIgTester = createFbTesterReader({
      readTester: async (email) => {
        const { data, error } = await serviceSb.from("ig_tester_access").select("email").eq("email", email).eq("enabled", true).maybeSingle();
        if (error) throw new Error("ig_tester_read_failed");
        return !!data;
      },
    });
    app.get("/ig/access", requireAuth, createIgAccessHandler({ igEnabled, isIgTester }));
    // The Facebook-only free-plan rule applies to Instagram too (same helper, its own reader).
    const requireIgPlan = createFbPlanCheck({
      readProfile: async (userId) => {
        const { data, error } = await serviceSb.from("seller_profiles").select("plan, plan_status, role").eq("auth_user_id", String(userId || "")).maybeSingle();
        if (error) throw new Error("ig_plan_read_failed");
        return data || null;
      },
    });
    igRuntime.registerRoutes(app, requireAuth, { requireConnectRate, requirePlanActive, requireIgAvailable: createIgLock({ igEnabled, isIgTester }), requireIgPlan, accountLiveCheck });
    console.log("[IG] enabled — OAuth + poller routes registered");
  }
} catch (e) {
  igRuntime = null;
  console.error("[IG] init failed — Instagram disabled, TikTok/Facebook/Shopee unaffected:", e && e.message);
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SellerFlow TikTok LIVE server running on port ${PORT}`);
});

// Parcel tracking job worker (Stage 2) — needs the service role; one job at a time.
if (serviceSb) {
  createParcelWorker({
    serviceSb,
    makeOcr: createOcr,
    healthUserId: PARCEL_HEALTH_USER_ID,
    emit: (userId, payload) => io.to(sellerRoom(userId)).emit("parcel-tracking:job-done", payload),
  }).start();
}

// ── Memory observability (5-min heartbeat + threshold warning) ────────────────
// One greppable line every 5 min: rss, heapUsed, active relays, % of 512 MB.
// Past ~75% it becomes [MEM-WARN] so Jeff sees pressure BEFORE an OOM. .unref()
// so this timer never keeps the process alive during shutdown.
const memoryLogTimer = setInterval(() => {
  const line = formatMemoryLine(process.memoryUsage(), tiktokConnections.size);
  if (line.startsWith("[MEM-WARN]")) console.warn(line);
  else console.log(line);
}, MEMORY_LOG_INTERVAL_MS);
if (typeof memoryLogTimer.unref === "function") memoryLogTimer.unref();

// ── Crash handlers — LOG WHY, then exit; let Render restart ───────────────────
// A single instance carries every live relay, so a silent death is the worst
// case. We capture the reason + how many relays just dropped, then exit(1). We do
// NOT try to keep a possibly-corrupted process alive (Node best practice). A
// re-entrancy guard stops a crash-inside-a-crash from looping.
let crashing = false;
function handleFatal(kind, err) {
  if (crashing) return;
  crashing = true;
  try { console.error(crashLogLine(kind, err, tiktokConnections.size)); } catch { /* logging must never mask the exit */ }
  // Give stdout a tick to flush the line on platforms with async pipes, then die.
  setTimeout(() => process.exit(1), 100).unref?.();
}
process.on("uncaughtException", (err) => handleFatal("uncaughtException", err));
process.on("unhandledRejection", (reason) => handleFatal("unhandledRejection", reason));

// ── Graceful shutdown (Render sends SIGTERM before a restart) ─────────────────
// Log how many relays will drop (sellers re-Connect after restart — manual-connect
// world), stop timers, close socket.io + the HTTP server, then exit(0). A bounded
// fallback forces exit so we never exceed Render's shutdown window.
let shuttingDown = false;
process.on("SIGTERM", () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(shutdownLogLine(tiktokConnections.size));
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  clearInterval(memoryLogTimer);
  if (shopeeRuntime) { try { shopeeRuntime.stopAll(); } catch { /* best effort */ } }
  if (fbRuntime) { try { fbRuntime.stopAll(); } catch { /* best effort */ } }
  if (igRuntime) { try { igRuntime.stopAll(); } catch { /* best effort */ } }
  if (stopReceiptCleanup) { try { stopReceiptCleanup(); } catch { /* best effort */ } }
  const forceExit = setTimeout(() => process.exit(0), 5000);
  if (typeof forceExit.unref === "function") forceExit.unref();
  try { io.close(); } catch { /* best effort */ }
  server.close(() => { clearTimeout(forceExit); process.exit(0); });
});

