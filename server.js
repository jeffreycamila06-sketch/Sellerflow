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

let tiktokConnection = null;

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
  return connectTikTok(req.params.username, res);
});

app.post("/connect/tiktok", async (req, res) => {
  return connectTikTok(req.body.username, res);
});

async function connectTikTok(username, res) {
  try {
    if (!username) {
      return res.status(400).json({
        success: false,
        error: "TikTok username is required",
      });
    }

    if (tiktokConnection) {
      try {
        await tiktokConnection.disconnect();
      } catch {}
    }

    tiktokConnection = new WebcastPushConnection(username);
    await tiktokConnection.connect();

    console.log(`Connected to TikTok LIVE: ${username}`);

    io.emit("platform_status", {
      platform: "TikTok",
      connected: true,
    });
    io.emit("live_session_started", {
      platform: "TikTok",
      username,
      timestamp: new Date().toISOString(),
    });

    const markTikTokDisconnected = () => {
      io.emit("platform_status", {
        platform: "TikTok",
        connected: false,
      });
      io.emit("live_session_ended", {
        platform: "TikTok",
        username,
        timestamp: new Date().toISOString(),
      });
    };

    tiktokConnection.on("disconnected", markTikTokDisconnected);
    tiktokConnection.on("streamEnd", markTikTokDisconnected);

    tiktokConnection.on("chat", (data) => {
      const comment = data.comment || "";
      const name = data.nickname || data.uniqueId || "Unknown";
      const handle = data.uniqueId || "unknown";

      console.log(`${name}: ${comment}`);

      const keywords = ["mine", "buy", "order", "gusto", "bibilhin", "我要"];
      const isBuy = keywords.some((word) =>
        comment.toLowerCase().includes(word.toLowerCase())
      );

      io.emit("comment", {
        handle,
        name,
        comment,
        platform: "TikTok",
        isBuy,
        buyerNum: isBuy ? 1 : null,
        buyerData: isBuy
          ? {
              handle,
              name,
              platform: "TikTok",
              num: 1,
              totalSpent: 380,
              totalOrders: 1,
              orders: [
                {
                  orderNum: Date.now(),
                  item: comment,
                  qty: 1,
                  price: 380,
                  total: 380,
                  time: new Date().toLocaleTimeString(),
                  handle,
                  name,
                  bNum: 1,
                  platform: "TikTok",
                  status: "New",
                  date: new Date().toISOString().slice(0, 10),
                },
              ],
            }
          : null,
        time: new Date().toLocaleTimeString(),
        timestamp: new Date().toISOString(),
      });

      if (isBuy) {
        console.log("ORDER DETECTED 🚀");
      }
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
  if (TEST_COMMENT_TOKEN && req.query.token !== TEST_COMMENT_TOKEN) {
    return res.status(401).json({
      success: false,
      error: "Invalid test comment token",
    });
  }

  console.log("Maria Reyes: mine blue blouse");
  console.log("ORDER DETECTED 🚀");

  io.emit("comment", {
    handle: "maria_reyes",
    name: "Maria Reyes",
    comment: "mine blue blouse",
    platform: "TikTok",
    isBuy: true,
    buyerNum: 1,
    buyerData: {
      handle: "maria_reyes",
      name: "Maria Reyes",
      platform: "TikTok",
      num: 1,
      totalSpent: 380,
      totalOrders: 1,
      orders: [
        {
          orderNum: Date.now(),
          item: "Blue Blouse",
          qty: 1,
          price: 380,
          total: 380,
          time: new Date().toLocaleTimeString(),
          handle: "maria_reyes",
          name: "Maria Reyes",
          bNum: 1,
          platform: "TikTok",
          status: "New",
          date: new Date().toISOString().slice(0, 10),
        },
      ],
    },
    time: new Date().toLocaleTimeString(),
    timestamp: new Date().toISOString(),
  });

  res.json({
    success: true,
    message: "Fake TikTok comment received",
    comment: "mine blue blouse",
  });
});

server.listen(3001, () => {
  console.log("SellerFlow TikTok LIVE server running on port 3001");
});
