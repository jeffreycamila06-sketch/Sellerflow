import express from "express";
import cors from "cors";
import { WebcastPushConnection } from "tiktok-live-connector";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const TEST_COMMENT_TOKEN = process.env.TEST_COMMENT_TOKEN || "";
const HELPER_COMMENT_TOKEN = process.env.HELPER_COMMENT_TOKEN || "";
const ENABLE_DIRECT_TIKTOK = process.env.ENABLE_DIRECT_TIKTOK === "true";


const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(cors());
app.use(express.json());

const tiktokConnections = new Map();
const facebookConnections = new Map();
const tiktokReconnectTimers = new Map();
const tiktokReconnectAttempts = new Map();
const tiktokReconnectTargets = new Map();
const manualTikTokDisconnects = new Set();
const TIKTOK_RECONNECT_RETRY_MS = 30000;
const TIKTOK_MAX_RECONNECT_TRIES = 20;

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

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
}

function isViewerOrSystemText(value) {
  const text = compactText(value);
  if (!text) return true;
  const blocked = [
    "welcome to tiktok live",
    "community guidelines",
    "creators must be",
    "viewers must be",
    "comments off",
    "liked the live",
    "joined",
    "followed the host",
    "suggested live creators",
    "recommended live streams",
    "discover live",
    "creator tools",
    "get coins",
    "recharge",
    "company",
    "program",
    "terms & policies",
    "watch now",
    "filtered to protect",
    "send gifts",
    "follow our community"
  ];
  return blocked.some((word) => text.includes(word));
}

function isBadIdentity(value) {
  const text = compactText(value);
  if (!text || text.length < 2 || text.length > 80) return true;
  if (text === "viewers" || text === "viewer" || text === "tiktok-viewer") return true;
  if (/\bviewers?\b/.test(text)) return true;
  if (/^[\s\d\-_.:]+$/.test(text)) return true;
  if (/^[\W_]+$/u.test(text)) return true;
  if (/^\d+\s*[-:]/.test(text)) return true;
  return isViewerOrSystemText(text);
}

function isViewerNoisePayload({ name = "", handle = "", comment = "" } = {}) {
  const cleanName = String(name || "").trim();
  const cleanHandle = String(handle || "").trim();
  const cleanComment = String(comment || "").trim();
  const joined = compactText(`${cleanName} ${cleanHandle} ${cleanComment}`);
  if (!cleanComment) return true;
  if (isBadIdentity(cleanName) || isBadIdentity(cleanHandle)) return true;
  if (/\bviewers?\b/.test(joined)) return true;
  if (isViewerOrSystemText(cleanComment)) return true;
  if (/^\d+\s*[-:]\s*/.test(cleanComment)) return true;
  if (/^[-_.:\s]+$/.test(cleanComment)) return true;
  return false;
}

function isBadHelperComment({ name = "", handle = "", comment = "" } = {}) {
  if (isViewerNoisePayload({ name, handle, comment })) return true;
  const joined = `${name} ${handle} ${comment}`.replace(/\s+/g, " ").trim().toLowerCase();
  const cleanName = String(name || "").trim();
  const cleanHandle = String(handle || "").trim().toLowerCase();
  const cleanComment = String(comment || "").trim();
  const nameValue = cleanName.toLowerCase();
  const commentValue = cleanComment.toLowerCase();
  const handleValue = cleanHandle.toLowerCase();
  const hasViewers = /\bviewers?\b/.test(joined);
  const numericOrDashOnly = /^[\s\d\-_.:]+$/.test(cleanName) || /^[\s\d\-_.:]+$/.test(cleanHandle);
  const startsWithNumberDash = /^\d+\s*[-:]\s*/.test(cleanName) || /^\d+\s*[-:]\s*/.test(cleanComment);
  const looksLikeViewerPanelName =
    nameValue === "viewers" ||
    handleValue === "viewers" ||
    nameValue.startsWith("viewers -") ||
    handleValue === "tiktok-viewer";
  if (looksLikeViewerPanelName || hasViewers || numericOrDashOnly || startsWithNumberDash) return true;
  if (!cleanComment) return true;
  if (nameValue === "viewers" || cleanHandle === "viewers") return true;
  if (/^viewers?\b/i.test(cleanName)) return true;
  if (/\bviewers?\s*[-–—]/i.test(cleanName)) return true;
  if (/^\d+\s*[-–—]\s*/.test(cleanComment)) return true;
  if (/^[-\s]*\d+\s*[-–—]\s*/.test(cleanComment)) return true;
  if (/^\d+\s*$/.test(cleanComment) && /\bviewers?\b/.test(joined)) return true;
  if (/^\d+\s+[\p{L}\p{N}_@.[\]\- ]{1,80}$/u.test(cleanComment) && /\bviewers?\b/.test(joined)) return true;
  if (/^(viewers?|viewer)$/i.test(cleanName) || /^(viewers?|viewer)$/i.test(cleanHandle)) return true;
  if (/^(new|send|more|recharge)$/i.test(commentValue)) return true;
  if (/^(back|more|send|recharge)$/i.test(cleanName)) return true;
  if (/^[-\s]*\d+\s*-/.test(cleanName)) return true;
  if (/^(viewers?|viewer|new|live|more|send|recharge)$/i.test(cleanName)) return true;
  if (/^(viewers?|viewer)$/i.test(cleanHandle)) return true;
  if (/^[-–—.•·\s]+$/u.test(cleanName)) return true;
  if (/^\d+$/.test(cleanName)) return true;
  if (/^\d+\s*-\s*/.test(cleanComment) || /^[-–—]\s*\d+/.test(cleanComment)) return true;
  const blocked = [
    "welcome to tiktok live",
    "community guidelines",
    "comments off",
    "liked the live",
    "joined",
    "suggested live creators",
    "recommended live streams",
    "discover live",
    "creator tools",
    "get coins",
    "recharge",
    "company",
    "program",
    "terms & policies",
    "filtered to protect",
    "have fun interacting",
    "creators must be",
    "viewers must be",
    "send gifts",
    "follow our community",
    "pouch-life joined",
    "viewers"
  ];
  return blocked.some((word) => joined.includes(word));
}

function liveKey(sellerId, platform, username) {
  return `${cleanSellerId(sellerId)}:${platform}:${cleanAccountKey(username)}`;
}

function clearTikTokReconnect(key) {
  const timer = tiktokReconnectTimers.get(key);
  if (timer) clearTimeout(timer);
  tiktokReconnectTimers.delete(key);
  tiktokReconnectTargets.delete(key);
}

async function disconnectTikTokConnection(key, { manual = false } = {}) {
  const existing = tiktokConnections.get(key);
  if (manual) {
    clearTikTokReconnect(key);
    tiktokReconnectAttempts.delete(key);
  }
  if (!existing) {
    manualTikTokDisconnects.delete(key);
    return;
  }
  if (manual) manualTikTokDisconnects.add(key);
  try {
    await existing.connection.disconnect();
  } catch {}
  tiktokConnections.delete(key);
  manualTikTokDisconnects.delete(key);
}

io.on("connection", (socket) => {
  socket.on("join_live_room", ({ sellerId, sessionId } = {}) => {
    const cleanId = cleanSellerId(sellerId);
    if (!cleanId) return;
    socket.join(sellerRoom(cleanId));
    socket.data.sellerId = cleanId;
    socket.data.sessionId = String(sessionId || "");

    if (ENABLE_DIRECT_TIKTOK) {
      for (const active of tiktokConnections.values()) {
        if (active.sellerId !== cleanId) continue;
        socket.emit("platform_status", {
          platform: "TikTok",
          connected: true,
          sellerId: cleanId,
          username: active.username,
          sessionId: active.sessionId,
        });
      }
      for (const target of tiktokReconnectTargets.values()) {
        if (target.sellerId !== cleanId) continue;
        socket.emit("platform_status", {
          platform: "TikTok",
          connected: false,
          reconnecting: true,
          sellerId: cleanId,
          username: target.username,
          sessionId: target.sessionId,
          reason: target.reason,
          nextRetryMs: TIKTOK_RECONNECT_RETRY_MS,
        });
      }
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


app.get("/connect-live/:username", async (req, res) => {
  return connectTikTok(req.params.username, res, {
    sellerId: req.query.sellerId || req.params.username,
    sessionId: req.query.sessionId || "",
  });
});

app.post("/connect/tiktok", async (req, res) => {
  return connectTikTok(req.body.username, res, {
    sellerId: req.body.sellerId,
    sessionId: req.body.sessionId,
  });
});

app.post("/disconnect/tiktok", async (req, res) => {
  const sellerId = cleanSellerId(req.body.sellerId);
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
  tiktokReconnectAttempts.delete(key);
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

app.post("/connect/facebook", (req, res) => {
  const sellerId = cleanSellerId(req.body.sellerId);
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

app.post("/helper/comment", (req, res) => {
  if (HELPER_COMMENT_TOKEN && req.body.token !== HELPER_COMMENT_TOKEN && req.headers["x-helper-token"] !== HELPER_COMMENT_TOKEN) {
    return res.status(401).json({
      success: false,
      error: "Invalid helper token",
    });
  }

  const sellerId = cleanSellerId(req.body.sellerId || req.body.email);
  const sessionId = String(req.body.sessionId || "");
  const sourceUsername = cleanAccountKey(req.body.sourceUsername || req.body.liveAccount || "");
  const handle = cleanAccountKey(req.body.handle || req.body.username || "tiktok-viewer") || "tiktok-viewer";
  const name = String(req.body.name || req.body.nickname || handle || "TikTok viewer").trim();
  const comment = String(req.body.comment || req.body.text || "").trim();

  if (!sellerId || !comment) {
    return res.status(400).json({
      success: false,
      error: "sellerId and comment are required",
    });
  }

  if (isBadHelperComment({ name, handle, comment })) {
    return res.status(202).json({
      success: true,
      skipped: true,
      reason: "Ignored TikTok page text",
    });
  }

  io.to(sellerRoom(sellerId)).emit("comment", {
    handle,
    name,
    comment,
    platform: "TikTok",
    sellerId,
    sessionId,
    sourceUsername: sourceUsername || undefined,
    roomId: "desktop-helper",
    isBuy: false,
    buyerNum: null,
    buyerData: null,
    time: new Date().toLocaleTimeString(),
    timestamp: new Date().toISOString(),
  });

  return res.json({
    success: true,
  });
});

function emitTikTokStatus({ sellerId, username, sessionId, connected, reconnecting = false, reason = "" }) {
  io.to(sellerRoom(sellerId)).emit("platform_status", {
    platform: "TikTok",
    connected,
    reconnecting,
    sellerId,
    username,
    sessionId,
    reason,
    nextRetryMs: reconnecting ? TIKTOK_RECONNECT_RETRY_MS : 0,
  });
}

function scheduleTikTokReconnect(key, username, sellerId, sessionId, reason = "disconnected") {
  if (!ENABLE_DIRECT_TIKTOK) {
    clearTikTokReconnect(key);
    tiktokReconnectAttempts.delete(key);
    tiktokReconnectTargets.delete(key);
    return;
  }
  if (tiktokReconnectTimers.has(key)) return;
  const tries = (tiktokReconnectAttempts.get(key) || 0) + 1;
  tiktokReconnectAttempts.set(key, tries);
  tiktokReconnectTargets.set(key, { username, sellerId, sessionId, reason });

  if (tries > TIKTOK_MAX_RECONNECT_TRIES) {
    console.log(`TikTok reconnect stopped for ${username}: max retry reached after ${reason}`);
    emitTikTokStatus({
      sellerId,
      username,
      sessionId,
      connected: false,
      reconnecting: false,
      reason: "rate_safe_stop",
    });
    clearTikTokReconnect(key);
    return;
  }

  emitTikTokStatus({
    sellerId,
    username,
    sessionId,
    connected: false,
    reconnecting: true,
    reason,
  });

  const timer = setTimeout(async () => {
    tiktokReconnectTimers.delete(key);
    try {
      await startTikTokConnection(key, username, sellerId, sessionId, { emitStart: false });
      console.log(`Reconnected TikTok LIVE: ${username} for ${sellerId}`);
    } catch (error) {
      console.log(`TikTok reconnect failed for ${username}: ${error.message}`);
      if (isRateLimitError(error)) {
        tiktokReconnectAttempts.delete(key);
        clearTikTokReconnect(key);
        emitTikTokStatus({
          sellerId,
          username,
          sessionId,
          connected: false,
          reconnecting: false,
          reason: "rate_limited",
        });
        return;
      }
      scheduleTikTokReconnect(key, username, sellerId, sessionId, "retry_failed");
    }
  }, TIKTOK_RECONNECT_RETRY_MS);

  tiktokReconnectTimers.set(key, timer);
}

function isRateLimitError(error) {
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("rate_limit") || message.includes("rate limit") || message.includes("too many connections");
}

function handleTikTokDisconnected(key, connection, reason = "disconnected", { reconnect = true } = {}) {
  const active = tiktokConnections.get(key);
  if (!active || active.connection !== connection) return;

  tiktokConnections.delete(key);

  if (manualTikTokDisconnects.has(key) || !reconnect) {
    manualTikTokDisconnects.delete(key);
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
  if (!ENABLE_DIRECT_TIKTOK) {
    throw new Error("Direct TikTok connector is disabled. Use the SellerFlowLive TikTok Grabber extension.");
  }
  clearTikTokReconnect(key);

  const cleanUsername = cleanAccountKey(username);
  const tiktokConnection = new WebcastPushConnection(cleanUsername, {
    processInitialData: false,
    fetchRoomInfoOnConnect: true,
  });
  const state = await tiktokConnection.connect();
  tiktokReconnectAttempts.delete(key);
  tiktokConnections.set(key, { connection: tiktokConnection, username: cleanUsername, sessionId, sellerId, roomId: state?.roomId || "", lastCommentAt: Date.now() });

  console.log(`Connected to TikTok LIVE: ${cleanUsername} for ${sellerId} room ${state?.roomId || "unknown"}`);

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
  tiktokConnection.on("streamEnd", () => handleTikTokDisconnected(key, tiktokConnection, "streamEnd"));

  tiktokConnection.on("chat", (data) => {
    const comment = data.comment || "";
    const name = data.nickname || data.uniqueId || "Unknown";
    const handle = data.uniqueId || "unknown";
    const active = tiktokConnections.get(key);
    if (active?.connection === tiktokConnection) active.lastCommentAt = Date.now();
    if (isBadHelperComment({ name, handle, comment })) return;

    io.to(sellerRoom(sellerId)).emit("comment", {
      handle,
      name,
      comment,
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

  return tiktokConnection;
}

async function connectTikTok(username, res, meta = {}) {
  try {
    if (!ENABLE_DIRECT_TIKTOK) {
      return res.status(409).json({
        success: false,
        disabled: true,
        error: "Direct TikTok connector is disabled. Use the SellerFlowLive TikTok Grabber extension.",
      });
    }

    if (!username) {
      return res.status(400).json({
        success: false,
        error: "TikTok username is required",
      });
    }

    const sellerId = cleanSellerId(meta.sellerId);
    if (!sellerId) {
      return res.status(400).json({
        success: false,
        error: "Seller account is required before connecting live",
      });
    }

    const sessionId = String(meta.sessionId || "");
    const cleanUsername = cleanAccountKey(username);
    if (!cleanUsername) {
      return res.status(400).json({
        success: false,
        error: "TikTok username is required",
      });
    }
    const key = liveKey(sellerId, "TikTok", cleanUsername);
    await disconnectTikTokConnection(key, { manual: true });
    await startTikTokConnection(key, cleanUsername, sellerId, sessionId, { emitStart: true });

    return res.json({
      success: true,
      message: `Connected to TikTok LIVE: ${cleanUsername}`,
    });
  } catch (error) {
    console.log(error);

    return res.status(500).json({
      success: false,
      error: error.message,
    });
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

server.listen(3001, () => {
  console.log("SellerFlow TikTok LIVE server running on port 3001");
});
