import express from "express";
import cors from "cors";
import { WebcastPushConnection } from "tiktok-live-connector";
import http from "http";
import { Server } from "socket.io";

const app = express();
const server = http.createServer(app);
const TEST_COMMENT_TOKEN = process.env.TEST_COMMENT_TOKEN || "";


const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

app.use(cors());
app.use(express.json());

const tiktokConnections = new Map();
const facebookConnections = new Map();

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

async function disconnectTikTokConnection(key) {
  const existing = tiktokConnections.get(key);
  if (!existing) return;
  try {
    await existing.connection.disconnect();
  } catch {}
  tiktokConnections.delete(key);
}

io.on("connection", (socket) => {
  socket.on("join_live_room", ({ sellerId, sessionId } = {}) => {
    const cleanId = cleanSellerId(sellerId);
    if (!cleanId) return;
    socket.join(sellerRoom(cleanId));
    socket.data.sellerId = cleanId;
    socket.data.sessionId = String(sessionId || "");

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

async function connectTikTok(username, res, meta = {}) {
  try {
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
    const key = liveKey(sellerId, "TikTok", username);
    await disconnectTikTokConnection(key);

    const tiktokConnection = new WebcastPushConnection(username);
    await tiktokConnection.connect();
    tiktokConnections.set(key, { connection: tiktokConnection, username, sessionId, sellerId });

    console.log(`Connected to TikTok LIVE: ${username} for ${sellerId}`);

    io.to(sellerRoom(sellerId)).emit("platform_status", {
      platform: "TikTok",
      connected: true,
      sellerId,
      username,
      sessionId,
    });
    io.to(sellerRoom(sellerId)).emit("live_session_started", {
      platform: "TikTok",
      username,
      sellerId,
      sessionId,
      timestamp: new Date().toISOString(),
    });

    const markTikTokDisconnected = () => {
      const active = tiktokConnections.get(key);
      if (active?.connection === tiktokConnection) tiktokConnections.delete(key);
      io.to(sellerRoom(sellerId)).emit("platform_status", {
        platform: "TikTok",
        connected: false,
        sellerId,
        username,
        sessionId,
      });
      io.to(sellerRoom(sellerId)).emit("live_session_ended", {
        platform: "TikTok",
        username,
        sellerId,
        sessionId,
        timestamp: new Date().toISOString(),
      });
    };

    tiktokConnection.on("disconnected", markTikTokDisconnected);
    tiktokConnection.on("streamEnd", markTikTokDisconnected);

    tiktokConnection.on("chat", (data) => {
      const comment = data.comment || "";
      const name = data.nickname || data.uniqueId || "Unknown";
      const handle = data.uniqueId || "unknown";

      io.to(sellerRoom(sellerId)).emit("comment", {
        handle,
        name,
        comment,
        platform: "TikTok",
        sellerId,
        sessionId,
        sourceUsername: username,
        isBuy: false,
        buyerNum: null,
        buyerData: null,
        time: new Date().toLocaleTimeString(),
        timestamp: new Date().toISOString(),
      });
    });

    return res.json({
      success: true,
      message: `Connected to TikTok LIVE: ${username}`,
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
