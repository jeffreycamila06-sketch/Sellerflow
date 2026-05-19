import http from "http";
import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONTROL_PORT = Number(process.env.SELLERFLOW_HELPER_PORT || 4788);
const DEBUG_PORT = Number(process.env.SELLERFLOW_CHROME_DEBUG_PORT || 9223);
const DEFAULT_SERVER_URL = process.env.SELLERFLOW_SERVER_URL || "https://sellerflow-live-server.onrender.com";
const DEFAULT_APP_URL = process.env.SELLERFLOW_APP_URL || "https://www.sellerflowlive.com";
const PROFILE_DIR = join(homedir(), "SellerFlowLiveHelperProfile");

let browserProcess = null;
let captureTimer = null;
let captureState = {
  running: false,
  sellerId: "",
  sessionId: "",
  liveAccount: "",
  serverUrl: DEFAULT_SERVER_URL,
  sent: 0,
  lastComment: "",
  lastError: "",
  lastFound: 0,
};
const seenComments = new Set();

function pageHtml() {
  const safe = (value) => String(value || "").replace(/"/g, "&quot;");
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>SellerFlowLive Helper</title>
  <style>
    body{margin:0;font-family:Arial,sans-serif;background:#120827;color:#fff}
    main{max-width:760px;margin:40px auto;padding:24px}
    .card{background:#1d1238;border:1px solid #7c3aed;border-radius:18px;padding:22px;box-shadow:0 0 30px rgba(168,85,247,.25)}
    h1{margin:0 0 8px;font-size:28px}
    p{color:#d8cafe;line-height:1.45}
    label{display:block;margin:14px 0 6px;color:#cdbdff;font-weight:700}
    input{width:100%;box-sizing:border-box;padding:12px;border-radius:12px;border:1px solid #8b5cf6;background:#0b0618;color:#fff;font-size:15px}
    button{margin-top:16px;border:0;border-radius:12px;padding:12px 16px;background:linear-gradient(135deg,#a855f7,#22d3ee);color:#fff;font-weight:800;cursor:pointer}
    button.secondary{background:#2b2148}
    .row{display:grid;grid-template-columns:1fr 1fr;gap:12px}
    .status{margin-top:16px;padding:14px;border-radius:12px;background:#0b0618;color:#d8cafe;white-space:pre-wrap}
    .ok{color:#86efac}.bad{color:#fca5a5}
  </style>
</head>
<body>
  <main>
    <div class="card">
      <h1>SellerFlowLive Helper Lite</h1>
      <p>Open TikTok LIVE in the helper browser. This helper reads visible comments and sends them to SellerFlowLive.</p>
      <form method="post" action="/start">
        <label>Seller email</label>
        <input name="sellerId" value="${safe(captureState.sellerId)}" placeholder="seller@email.com" required>
        <div class="row">
          <div>
            <label>Live account label</label>
            <input name="liveAccount" value="${safe(captureState.liveAccount)}" placeholder="optional, example: budgetukay4">
          </div>
          <div>
            <label>Session ID</label>
            <input name="sessionId" value="${safe(captureState.sessionId)}" placeholder="optional">
          </div>
        </div>
        <label>Live server URL</label>
        <input name="serverUrl" value="${safe(captureState.serverUrl)}" required>
        <label>TikTok LIVE URL</label>
        <input name="tiktokUrl" placeholder="https://www.tiktok.com/@shop/live">
        <button type="submit">Start Helper Browser</button>
        <button class="secondary" formaction="/stop">Stop Capture</button>
      </form>
      <div class="status">
Status: <span class="${captureState.running ? "ok" : "bad"}">${captureState.running ? "Running" : "Stopped"}</span>
Sent comments: ${captureState.sent}
Found on page: ${captureState.lastFound}
Last comment: ${captureState.lastComment || "-"}
Last error: ${captureState.lastError || "-"}
      </div>
      <p>Tip: Keep the TikTok LIVE tab open. Keep SellerFlowLive dashboard open in another browser window.</p>
    </div>
  </main>
</body>
</html>`;
}

function findBrowser() {
  const paths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  return paths.find((path) => existsSync(path));
}

function launchBrowser(tiktokUrl) {
  if (!existsSync(PROFILE_DIR)) mkdirSync(PROFILE_DIR, { recursive: true });
  const browserPath = findBrowser();
  if (!browserPath) throw new Error("Chrome or Microsoft Edge was not found.");
  if (browserProcess && !browserProcess.killed) return;
  const startUrl = tiktokUrl || DEFAULT_APP_URL;
  browserProcess = spawn(browserPath, [
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--disable-features=Translate",
    startUrl,
  ], {
    detached: true,
    stdio: "ignore",
  });
  browserProcess.unref();
}

async function getJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function cdpCall(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const id = Date.now();
    const timeout = setTimeout(() => {
      try { ws.close(); } catch {}
      reject(new Error("Chrome helper timeout"));
    }, 5000);
    ws.onopen = () => ws.send(JSON.stringify({ id, method, params }));
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.id !== id) return;
      clearTimeout(timeout);
      ws.close();
      if (data.error) reject(new Error(data.error.message || "Chrome helper error"));
      else resolve(data.result);
    };
    ws.onerror = () => {
      clearTimeout(timeout);
      reject(new Error("Cannot talk to helper browser"));
    };
  });
}

async function getTikTokPage() {
  const pages = await getJson(`http://127.0.0.1:${DEBUG_PORT}/json`);
  return pages.find((page) => /tiktok\.com/i.test(page.url || "") && page.webSocketDebuggerUrl);
}

const scrapeExpression = `(() => {
  const ignored = [
    'welcome to tiktok live',
    'creators must be',
    'community guidelines',
    'get coins',
    'discover live',
    'creator tools',
    'suggested live creators',
    'company',
    'program',
    'terms',
    'comments off',
    'joined',
    'liked the live',
    'followed the host'
  ];
  const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
  const isCommentLike = (item) => {
    const comment = clean(item.comment).toLowerCase();
    if (!comment || comment.length > 500) return false;
    if (ignored.some(word => comment.includes(word))) return false;
    return item.name && item.comment && item.name !== item.comment;
  };
  const normalize = (name, comment, handle = '') => ({
    name: clean(name) || clean(handle) || 'TikTok viewer',
    handle: clean(handle || name).replace(/^@+/, '') || 'tiktok-viewer',
    comment: clean(comment)
  });
  const parseTextBlock = (text) => {
    const lines = String(text || '').split('\\n').map(clean).filter(Boolean);
    if (lines.length < 2) return null;
    const name = lines[0];
    const comment = lines.slice(1).join(' ');
    return normalize(name, comment, name);
  };
  const selectors = [
    '[data-e2e="chat-message"]',
    '[data-e2e="comment-item"]',
    '[data-e2e*="live-comment"]',
    '[data-e2e*="live-chat"]',
    '[class*="DivChatRoom"] div',
    '[class*="DivComment"]',
    '[class*="DivChatMessage"]',
    '[class*="ChatMessage"]',
    '[class*="LiveComment"]',
    '[class*="CommentItem"]',
    'div[role="listitem"]'
  ];
  const nodes = Array.from(new Set(selectors.flatMap(selector => Array.from(document.querySelectorAll(selector)))))
    .filter(node => {
      const rect = node.getBoundingClientRect?.();
      if (!rect || rect.width < 40 || rect.height < 8) return false;
      const text = node.innerText || node.textContent || '';
      return text && text.length < 800;
    });
  const items = nodes.slice(-160).map((node) => {
    const multiline = node.innerText || node.textContent || '';
    const parsed = parseTextBlock(multiline);
    if (parsed) return parsed;
    const text = clean(multiline);
    const authorNode = node.querySelector('a[href*="/@"]') || node.querySelector('[data-e2e*="user"]') || node.querySelector('span');
    const author = clean(authorNode?.innerText || authorNode?.textContent || '');
    const href = authorNode?.getAttribute?.('href') || '';
    const handleMatch = href.match(/@([^/?]+)/);
    const handle = handleMatch ? handleMatch[1] : author;
    let comment = text;
    if (author && comment.startsWith(author)) comment = comment.slice(author.length).trim();
    return normalize(author || handle, comment, handle || author);
  }).filter(isCommentLike);
  const unique = [];
  const seen = new Set();
  for (const item of items) {
    const key = item.handle + '|' + item.comment;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique.slice(-80);
})()`;

async function readComments() {
  const page = await getTikTokPage();
  if (!page) throw new Error("Open a TikTok LIVE page in the helper browser.");
  const result = await cdpCall(page.webSocketDebuggerUrl, "Runtime.evaluate", {
    expression: scrapeExpression,
    returnByValue: true,
  });
  return result?.result?.value || [];
}

async function sendComment(item) {
  const key = `${item.handle}|${item.comment}`;
  if (seenComments.has(key)) return;
  seenComments.add(key);
  if (seenComments.size > 1200) {
    const first = seenComments.values().next().value;
    seenComments.delete(first);
  }

  const response = await fetch(`${captureState.serverUrl.replace(/\/$/, "")}/helper/comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sellerId: captureState.sellerId,
      sessionId: captureState.sessionId,
      liveAccount: captureState.liveAccount,
      name: item.name,
      handle: item.handle,
      comment: item.comment,
    }),
  });
  if (!response.ok) throw new Error(`Server rejected comment: ${response.status}`);
  captureState.sent += 1;
  captureState.lastComment = `${item.name}: ${item.comment}`.slice(0, 120);
}

async function tickCapture() {
  try {
    captureState.lastError = "";
    const comments = await readComments();
    captureState.lastFound = comments.length;
    for (const item of comments) await sendComment(item);
  } catch (error) {
    captureState.lastError = error.message || String(error);
  }
}

function startCapture(fields) {
  captureState = {
    ...captureState,
    running: true,
    sellerId: String(fields.sellerId || "").trim().toLowerCase(),
    sessionId: String(fields.sessionId || "").trim(),
    liveAccount: String(fields.liveAccount || "").trim().replace(/^@+/, ""),
    serverUrl: String(fields.serverUrl || DEFAULT_SERVER_URL).trim(),
    lastError: "",
  };
  launchBrowser(String(fields.tiktokUrl || "").trim());
  if (captureTimer) clearInterval(captureTimer);
  captureTimer = setInterval(() => void tickCapture(), 1200);
  void tickCapture();
}

function stopCapture() {
  captureState.running = false;
  if (captureTimer) clearInterval(captureTimer);
  captureTimer = null;
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString();
  return Object.fromEntries(new URLSearchParams(raw));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "POST" && req.url === "/start") {
      startCapture(await parseBody(req));
      res.writeHead(302, { Location: "/" });
      return res.end();
    }
    if (req.method === "POST" && req.url === "/stop") {
      stopCapture();
      res.writeHead(302, { Location: "/" });
      return res.end();
    }
    if (req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(captureState));
    }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return res.end(pageHtml());
  } catch (error) {
    captureState.lastError = error.message || String(error);
    res.writeHead(500, { "Content-Type": "text/plain" });
    return res.end(captureState.lastError);
  }
});

server.listen(CONTROL_PORT, () => {
  console.log(`SellerFlowLive Helper Lite running at http://127.0.0.1:${CONTROL_PORT}`);
  const browserPath = findBrowser();
  if (browserPath) {
    spawn(browserPath, [`http://127.0.0.1:${CONTROL_PORT}`], {
      detached: true,
      stdio: "ignore",
    }).unref();
  }
});
