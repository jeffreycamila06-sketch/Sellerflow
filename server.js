import express from "express";
import cors from "cors";
import { WebcastPushConnection } from "tiktok-live-connector";
import http from "http";
import { Server } from "socket.io";
import { createClient } from "@supabase/supabase-js";
import { translateBroadcast } from "./server/broadcastTranslate.js";
import { shouldForceFreshConnect, shouldSkipQueuedReconnect, LIVENESS_EVENTS, reuseVerdict, singleFlight, REUSE_VERIFY_TIMEOUT_MS, shouldRelayViewers, resolveRateLimitCooldownMs } from "./server/connectionHealth.js";
import { buildInitialCommentPayloads, pushRecent, reuseReEmitPayload, RECENT_RING_CAP } from "./server/initialComments.js";
import { sanitizeCommentPayload } from "./server/sanitize.js";
import { accountCapVerdict } from "./server/accountCap.js";
import { fbConnectedNow } from "./server/fbLiveness.js";

const app = express();
const server = http.createServer(app);
const TEST_COMMENT_TOKEN = process.env.TEST_COMMENT_TOKEN || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "";
// Broadcast auto-translation (admin-only). Set on Render → Environment. When
// absent the /admin/broadcast-translate endpoint returns an honest
// "translation_not_configured" error (never a silent/partial success).
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const sb = (SUPABASE_URL && SUPABASE_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
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
app.use(express.json());

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
  req.sellerId = cleanSellerId(user.email);
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
      console.log(`[PLAN_CHECK] ERROR ${ctx} err=no_profile_row -> FAIL-OPEN (allowing)`);
      return { allowed: true };
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
function accountCapReject(req, platform, username) {
  const v = accountCapVerdict({
    plan: req.sellerPlan, role: req.sellerRole,
    tiktok: req.sellerTiktok, facebook: req.sellerFacebook,
    platform, username,
  });
  if (v.allowed) return null;
  console.log(`[ACCOUNT-CAP] block seller=${req.sellerId} plan=${v.plan} platform=${platform} (max ${v.max}, account not registered)`);
  return {
    success: false,
    error: "account_limit",
    message: `Your ${v.plan} plan allows ${v.max} live account(s). Contact support to add more.`,
  };
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
const tiktokConnectLocks = new Set();
const manualTikTokDisconnects = new Set();

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

function sellerRoom(sellerId) {
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
  socket.data.sellerId = cleanSellerId(user.email);

  // Same plan gate as the HTTP /connect routes — fail-open on lookup error,
  // free-tier exempt, kill-switch via PLAN_ENFORCEMENT_ENABLED. An expired
  // seller is rejected at the handshake so they can't receive live comments
  // even from a connection that was alive before they expired.
  const planResult = await checkPlanActive(user.email, user.id, token);
  if (!planResult.allowed) {
    return next(new Error("plan_expired"));
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
        sellerId: cleanId,
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
        sellerId: cleanId,
        username: active.username,
        sessionId: active.sessionId,
      });
    }
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
    const p = String(platform) === "Facebook" ? "Facebook" : "TikTok";
    socket.data.selected[p] = cleanAccountKey(username || "");
  });
});

app.get("/", (req, res) => {
  res.send("SellerFlow TikTok Server Running 🚀");
});
app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "sellerflow-live-server",
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
app.get("/health/tiktok", (_req, res) => {
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

  res.json({
    ok,
    status,
    service: "tiktok-signing",
    checks: {
      eulerKeyConfigured,
      activeConnections,
      reconnectingNow,
      rateLimitedAccounts,
    },
    recentFailureRate,
    lastFailReason,
    warnings,
    timestamp: new Date().toISOString(),
  });
});


app.post("/connect/tiktok", requireAuth, requirePlanActive, async (req, res) => {
  const reject = accountCapReject(req, "TikTok", req.body.username);
  if (reject) return res.status(403).json(reject);
  return connectTikTok(req.body.username, res, {
    sellerId: req.sellerId,
    sessionId: req.body.sessionId,
  });
});

app.post("/connect/facebook", requireAuth, requirePlanActive, (req, res) => {
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
    sellerId,
    username,
    sessionId,
  });
  io.to(sellerRoom(sellerId)).emit("live_session_started", {
    platform: "Facebook",
    username,
    sellerId,
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

function emitTikTokStatus({ sellerId, username, sessionId, connected, reconnecting = false, reason = "", nextRetryMs = 0 }) {
  io.to(sellerRoom(sellerId)).emit("platform_status", {
    platform: "TikTok",
    connected,
    reconnecting,
    sellerId,
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
            platform: "TikTok", username, sellerId, sessionId, timestamp: new Date().toISOString(),
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
      sellerId: active.sellerId,
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
  let state;
  try {
    state = await tiktokConnection.connect();
  } finally {
    tiktokConnection.off("chat", initialCollector);
  }
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
      sellerId,
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
        sellerId,
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
      sellerId,
      sessionId,
      sourceUsername: cleanUsername,
      roomId: state?.roomId || "",
      isBuy: false,
      buyerNum: null,
      buyerData: null,
      // Orderable earlier-comments (sql/18): the client stores this on the order
      // row so a later restored copy of the same message can render "Ordered ✓".
      // Legacy top-level shape (see server/initialComments.js msgIdOf).
      msgId: String(data.msgId || ""),
      time: new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Taipei" }),
      timestamp: new Date().toISOString(),
    };
    void emitCommentScoped(sellerId, "TikTok", cleanUsername, payload);
    // RC2 — keep the reuse ring fresh with the latest relayed comments. Guarded
    // to THIS connection (an orphaned old connection must never write the ring).
    const activeEntry = tiktokConnections.get(key);
    if (activeEntry && activeEntry.connection === tiktokConnection) {
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
          reused: true,
          message: `TikTok LIVE already connected: ${cleanUsername}`,
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

    tiktokConnectLocks.add(key);
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
  }
}

app.get("/test-comment", (req, res) => {
  if (!TEST_COMMENT_TOKEN) {
    return res.status(404).json({
      success: false,
      error: "Test comments are disabled",
    });
  }

  if (TEST_COMMENT_TOKEN && req.query.token !== TEST_COMMENT_TOKEN) {
    return res.status(401).json({
      success: false,
      error: "Invalid test comment token",
    });
  }

  const sellerId = cleanSellerId(req.query.sellerId);
  if (!sellerId) {
    return res.status(400).json({
      success: false,
      error: "sellerId is required for test comments",
    });
  }

  const platform = String(req.query.platform || "TikTok").toLowerCase() === "facebook" ? "Facebook" : "TikTok";
  const sourceUsername = cleanAccountKey(req.query.sourceUsername || req.query.username || "test");

  console.log(`Maria Reyes: test ${platform} live comment for ${sellerId}`);

  io.to(sellerRoom(sellerId)).emit("comment", {
    handle: "maria_reyes",
    name: "Maria Reyes",
    comment: "test live comment",
    platform,
    sellerId,
    sessionId: String(req.query.sessionId || ""),
    sourceUsername,
    isBuy: false,
    buyerNum: null,
    buyerData: null,
    time: new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Taipei" }),
    timestamp: new Date().toISOString(),
  });

  res.json({
    success: true,
    message: `Fake ${platform} comment received`,
    comment: "test live comment",
  });
});

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

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`SellerFlow TikTok LIVE server running on port ${PORT}`);
});

process.on("SIGTERM", () => {
  if (keepAliveTimer) clearInterval(keepAliveTimer);
  server.close(() => process.exit(0));
});

