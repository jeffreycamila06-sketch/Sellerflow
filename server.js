import express from "express";
import cors from "cors";
import { WebcastPushConnection } from "tiktok-live-connector";
import http from "http";
import { Server } from "socket.io";
import { createClient } from "@supabase/supabase-js";

const app = express();
const server = http.createServer(app);
const TEST_COMMENT_TOKEN = process.env.TEST_COMMENT_TOKEN || "";
const SUPABASE_URL = process.env.SUPABASE_URL || "";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || "";
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
const TIKTOK_HEALTH_CHECK_MS = 60 * 1000;
const TIKTOK_STALE_MS = 18 * 60 * 1000;
const TIKTOK_CHAT_STALE_MS = 35 * 60 * 1000;
const TIKTOK_CHAT_WATCH_START_MS = 5 * 60 * 1000;
let activeTikTokReconnects = 0;
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
    const task = pendingTikTokReconnects.shift();
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

app.post("/disconnect/tiktok", requireAuth, async (req, res) => {
  const sellerId = req.sellerId;
  const username = cleanAccountKey(req.body.username);
  const sessionId = String(req.body.sessionId || "");

  if (!sellerId || !username) {
    return res.status(400).json({
      success: false,
      error: "Seller account and TikTok username are required",
    });
  }

  const key = liveKey(sellerId, "TikTok", username);
  await disconnectTikTokConnection(key, { manual: true });
  clearTikTokReconnect(key);
  emitTikTokStatus({
    sellerId,
    username,
    sessionId,
    connected: false,
    reconnecting: false,
    reason: "manual",
  });
  io.to(sellerRoom(sellerId)).emit("live_session_ended", {
    platform: "TikTok",
    username,
    sellerId,
    sessionId,
    timestamp: new Date().toISOString(),
  });

  return res.json({
    success: true,
    message: `Disconnected TikTok LIVE: ${username}`,
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

    io.to(sellerRoom(sellerId)).emit("comment", {
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
      time: new Date().toLocaleTimeString(),
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
    time: new Date().toLocaleTimeString(),
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

