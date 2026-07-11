import express from "express";
import cors from "cors";
import { WebcastPushConnection } from "tiktok-live-connector";
import http from "http";
import { Server } from "socket.io";
import { createClient } from "@supabase/supabase-js";
import { translateBroadcast } from "./server/broadcastTranslate.js";

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
      .select("plan, plan_status, plan_expiry")
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

    // Free plan is cap-limited (DB trigger), never time-blocked at /connect.
    if (plan === "free") {
      console.log(`[PLAN_CHECK] ALLOW ${ctx2} (free-tier exempt)`);
      return { allowed: true };
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
    return { allowed: true };
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
  return next();
}

const TIKTOK_RECONNECT_BASE_MS = 5 * 1000;
const TIKTOK_RECONNECT_MAX_MS = 30 * 60 * 1000;
const TIKTOK_RECONNECT_JITTER_MS = 30 * 1000;
const TIKTOK_RATE_LIMIT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
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
  let sockets = [];
  try {
    sockets = await io.in(sellerRoom(sellerId)).fetchSockets();
  } catch {
    io.to(sellerRoom(sellerId)).emit("comment", payload);
    return;
  }
  for (const s of sockets) {
    const sel = s.data && s.data.selected ? s.data.selected[platform] || "" : "";
    // No selection on this socket → ALL comments (main-compatible). Otherwise only
    // the selected account's comments. Missing src → send (never hide on bad data).
    if (!sel || !src || sel === src) s.emit("comment", payload);
  }
}

function isTikTokRateLimitError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("rate_limit") || message.includes("too many connections");
}

function rememberTikTokRateLimit(key, sellerId, username, sessionId, error) {
  const retryAt = Date.now() + TIKTOK_RATE_LIMIT_COOLDOWN_MS;
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
    nextRetryMs: TIKTOK_RATE_LIMIT_COOLDOWN_MS,
  });
  console.log(`TikTok rate limit cooldown for ${username} until ${new Date(retryAt).toISOString()}: ${error?.message || error}`);
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
    for (const active of facebookConnections.values()) {
      if (active.sellerId !== cleanId) continue;
      socket.emit("platform_status", {
        platform: "Facebook",
        connected: true,
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

  const key = liveKey(sellerId, "Facebook", username);
  facebookConnections.set(key, { username, sessionId, sellerId });

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
  const tiktokConnection = new WebcastPushConnection(cleanUsername, {
    processInitialData: false,
    fetchRoomInfoOnConnect: true,
    signApiKey: process.env.EULER_API_KEY,
  });
  const state = await tiktokConnection.connect();
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
  ["member", "like", "gift", "social", "emote", "envelope"].forEach((eventName) => {
    tiktokConnection.on(eventName, () => touchTikTokConnection(key, tiktokConnection));
  });

  tiktokConnection.on("chat", (data) => {
    touchTikTokConnection(key, tiktokConnection, "chat");
    const comment = data.comment || "";
    const name = data.nickname || data.uniqueId || "Unknown";
    const handle = data.uniqueId || "unknown";

    void emitCommentScoped(sellerId, "TikTok", cleanUsername, {
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
      time: new Date().toLocaleTimeString("en-US", { timeZone: "Asia/Taipei" }),
      timestamp: new Date().toISOString(),
    });
  });

  startTikTokHealthTimer(key, tiktokConnection);

  return tiktokConnection;
}

async function connectTikTok(username, res, meta = {}) {
  let key = "";
  let sellerId = "";
  let sessionId = "";
  let cleanUsername = "";
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
    if (existing) {
      existing.sessionId = sessionId || existing.sessionId;
      touchTikTokConnection(key, existing.connection);
      emitTikTokStatus({
        sellerId,
        username: cleanUsername,
        sessionId: existing.sessionId,
        connected: true,
        reconnecting: false,
        reason: "already_connected",
      });
      return res.json({
        success: true,
        reused: true,
        message: `TikTok LIVE already connected: ${cleanUsername}`,
      });
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
      rememberTikTokRateLimit(key, sellerId, cleanUsername, sessionId, error);
      return res.status(429).json({
        success: false,
        error: `TikTok rate limit reached. Auto reconnect stopped for ${Math.round(TIKTOK_RATE_LIMIT_COOLDOWN_MS / 3600000)} hours.`,
        cooldownMs: TIKTOK_RATE_LIMIT_COOLDOWN_MS,
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

