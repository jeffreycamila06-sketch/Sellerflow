(() => {
  const DEFAULT_SERVER_URL = "https://sellerflow-live-server.onrender.com";
  const SEND_INTERVAL_MS = 650;
  const SEEN_LIMIT = 1800;

  let settings = {
    sellerId: "",
    liveAccount: "",
    active: true,
    serverUrl: DEFAULT_SERVER_URL
  };
  let sent = 0;
  let found = 0;
  let lastHeartbeatAt = 0;
  const seen = new Set();

  function clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function compactText(value) {
    return clean(value).toLowerCase();
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
    const cleanName = clean(name);
    const cleanHandle = clean(handle);
    const cleanComment = clean(comment);
    const joined = compactText(`${cleanName} ${cleanHandle} ${cleanComment}`);
    if (!cleanComment) return true;
    if (isBadIdentity(cleanName) || isBadIdentity(cleanHandle)) return true;
    if (/\bviewers?\b/.test(joined)) return true;
    if (isViewerOrSystemText(cleanComment)) return true;
    if (/^\d+\s*[-:]\s*/.test(cleanComment)) return true;
    if (/^[-_.:\s]+$/.test(cleanComment)) return true;
    return false;
  }

  function normalizeHandle(value) {
    return clean(value).replace(/^@+/, "").toLowerCase();
  }

  function detectLiveAccount() {
    const urlMatch = location.pathname.match(/@([^/]+)/);
    if (urlMatch?.[1]) return normalizeHandle(urlMatch[1]);
    const titleMatch = document.title.match(/@([a-z0-9._-]+)/i);
    if (titleMatch?.[1]) return normalizeHandle(titleMatch[1]);
    return "";
  }

  function statusPanel() {
    let box = document.getElementById("sellerflowlive-grabber-status");
    if (box) return box;
    box = document.createElement("div");
    box.id = "sellerflowlive-grabber-status";
    box.style.cssText = [
      "position:fixed",
      "right:12px",
      "top:86px",
      "z-index:2147483647",
      "background:rgba(24,8,52,.9)",
      "color:#fff",
      "border:1px solid #a855f7",
      "border-radius:12px",
      "padding:10px",
      "font:12px Arial,sans-serif",
      "box-shadow:0 0 18px rgba(168,85,247,.35)",
      "width:260px"
    ].join(";");
    box.innerHTML = `
      <div style="font-weight:800;margin-bottom:6px">SellerFlowLive Grabber</div>
      <input id="sfl-seller-email" placeholder="seller@email.com" style="width:100%;box-sizing:border-box;border:1px solid #7c3aed;border-radius:8px;background:#0b0618;color:#fff;padding:8px;margin-bottom:8px">
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <button id="sfl-save" style="flex:1;border:0;border-radius:8px;padding:7px;background:#7c3aed;color:#fff;font-weight:700">Save</button>
        <button id="sfl-toggle" style="flex:1;border:0;border-radius:8px;padding:7px;background:#2b2148;color:#fff;font-weight:700">Pause</button>
      </div>
      <div id="sfl-line" style="color:#d8cafe">Loading...</div>
    `;
    document.documentElement.appendChild(box);
    const email = box.querySelector("#sfl-seller-email");
    const save = box.querySelector("#sfl-save");
    const toggle = box.querySelector("#sfl-toggle");
    email.value = settings.sellerId || "";
    save.addEventListener("click", () => {
      settings.sellerId = email.value.trim().toLowerCase();
      settings.liveAccount = detectLiveAccount();
      settings.active = true;
      chrome.storage.local.set({ sellerId: settings.sellerId, liveAccount: settings.liveAccount, active: true });
      setStatus(`Saved. Reading only ${settings.liveAccount || "this TikTok LIVE"}.`);
    });
    toggle.addEventListener("click", () => {
      settings.active = !settings.active;
      chrome.storage.local.set({ active: settings.active });
      toggle.textContent = settings.active ? "Pause" : "Start";
      setStatus(settings.active ? "Started." : "Paused.");
    });
    return box;
  }

  function setStatus(text) {
    const box = statusPanel();
    const line = box.querySelector("#sfl-line");
    if (line) line.textContent = text;
  }

  function isLivePage() {
    return /tiktok\.com\/@[^/]+\/live/i.test(location.href);
  }

  function isUiText(text) {
    const value = clean(text).toLowerCase();
    if (!value) return true;
    const uiWords = [
      "welcome to tiktok live",
      "community guidelines",
      "creators must be",
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
      "viewers",
      "viewer",
      "watch now",
      "rose",
      "love you so",
      "divine fingers",
      "bouquet",
      "filtered to protect"
    ];
    return uiWords.some((word) => value.includes(word));
  }

  function isBadName(name) {
    const value = clean(name);
    if (!value || value.length < 2) return true;
    if (value.length > 80) return true;
    if (/\bviewers?\b/i.test(value)) return true;
    if (/^\d+\s*[-–—]\s*\d+$/.test(value)) return true;
    if (/^[-–—\s\d]+$/.test(value)) return true;
    if (/\bsuggested\b|\bfollowing\b|\brecommended\b/i.test(value)) return true;
    if (/^[\W_]+$/u.test(value)) return true;
    if (/^\d+$/.test(value)) return true;
    if (/^[-–—.•·\s]+$/u.test(value)) return true;
    if (/^(viewers?|viewer|new|live|more|send|recharge|company|program)$/i.test(value)) return true;
    return isUiText(value);
  }

  function isBadComment(comment) {
    const value = clean(comment);
    if (!value || value.length > 500) return true;
    if (/\bviewers?\b/i.test(value)) return true;
    if (/^\d+\s*[-–—]\s*/.test(value)) return true;
    if (/^[-–—\s\d]+$/.test(value)) return true;
    if (/\bsuggested\b|\bfollowing\b|\brecommended\b/i.test(value)) return true;
    if (/^\d+$/.test(value)) return true;
    if (/^\d+\s*-\s*/.test(value)) return true;
    if (/^[-–—]\s*\d+/.test(value)) return true;
    if (/^(new|send|more|recharge)$/i.test(value)) return true;
    return isUiText(value);
  }

  function isViewerPanelRow({ name = "", handle = "", comment = "" } = {}) {
    const cleanName = clean(name);
    const cleanHandle = clean(handle);
    const cleanComment = clean(comment);
    const nameValue = cleanName.toLowerCase();
    const handleValue = cleanHandle.toLowerCase();
    const commentValue = cleanComment.toLowerCase();
    const joined = `${nameValue} ${handleValue} ${commentValue}`;

    if (!cleanComment) return true;
    if (nameValue === "viewers" || handleValue === "viewers") return true;
    if (handleValue === "tiktok-viewer") return true;
    if (joined.includes("viewers")) return true;
    if (/^viewers?\b/i.test(cleanName)) return true;
    if (/^\d+\s*[-–—]\s*\d+$/.test(cleanName)) return true;
    if (/^\d+\s*[-–—]\s*/.test(cleanComment)) return true;
    if (/\bviewers?\s*[-–—]/i.test(cleanName)) return true;
    if (/^\d+\s*[-–—]\s*/.test(cleanComment)) return true;
    if (/^[-\s]*\d+\s*[-–—]\s*/.test(cleanComment)) return true;
    if (/^\d+\s*$/.test(cleanComment) && /\bviewers?\b/.test(joined)) return true;
    if (/^\d+\s+[\p{L}\p{N}_@.[\]\- ]{1,80}$/u.test(cleanComment) && /\bviewers?\b/.test(joined)) return true;
    return false;
  }

  function parseBlock(text) {
    const lines = String(text || "").split("\n").map(clean).filter(Boolean);
    if (lines.length < 2) return null;
    if (lines.length > 4) return null;
    if (lines.some((line) => /\bviewers?\b/i.test(line))) return null;
    const joined = lines.join(" ").toLowerCase();
    if (isUiText(joined)) return null;
    if (/\b(viewers?|suggested live|recommended live|following|discover live|creator tools|get coins|recharge)\b/i.test(joined)) return null;

    let name = lines[0];
    let comment = lines.slice(1).join(" ");
    const cleanName = clean(name);
    const cleanComment = clean(comment);
    if (isBadName(cleanName)) return null;
    if (isBadComment(cleanComment)) return null;
    if (isViewerPanelRow({ name: cleanName, handle: cleanName, comment: cleanComment })) return null;
    if (cleanName === cleanComment) return null;

    const handleMatch = joined.match(/@([a-z0-9._-]{2,40})/i);
    const handle = handleMatch ? handleMatch[1] : name;
    const normalizedHandle = normalizeHandle(handle);
    if (!normalizedHandle || normalizedHandle === "tiktok-viewer" || /\bviewers?\b/i.test(normalizedHandle)) return null;
    return {
      name: clean(name),
      handle: normalizedHandle,
      comment: clean(comment)
    };
  }

  // Final parser overrides. Keep these near the scraping code so TikTok UI changes
  // cannot leak viewer counts/system rows into SellerFlowLive as comments.
  function isUiText(text) {
    const value = compactText(text);
    return !value || isViewerOrSystemText(value) || /\bviewers?\b/.test(value);
  }

  function isBadName(name) {
    return isBadIdentity(name);
  }

  function isBadComment(comment) {
    const value = clean(comment);
    if (!value || value.length > 500) return true;
    if (/\bviewers?\b/i.test(value)) return true;
    if (/^\d+\s*[-:]\s*/.test(value)) return true;
    if (/^\d+\s*-\s*/.test(value)) return true;
    if (/^[-_.:\s]+$/.test(value)) return true;
    if (/\bsuggested\b|\bfollowing\b|\brecommended\b/i.test(value)) return true;
    if (/^(new|send|more|recharge)$/i.test(value)) return true;
    return isViewerOrSystemText(value);
  }

  function isViewerPanelRow({ name = "", handle = "", comment = "" } = {}) {
    return isViewerNoisePayload({ name, handle, comment });
  }

  function parseBlock(text) {
    const lines = String(text || "").split("\n").map(clean).filter(Boolean);
    if (lines.length < 2 || lines.length > 4) return null;
    if (lines.some((line) => /\bviewers?\b/i.test(line))) return null;
    const joined = lines.join(" ");
    if (isUiText(joined)) return null;

    const name = clean(lines[0]);
    const comment = clean(lines.slice(1).join(" "));
    if (isBadName(name) || isBadComment(comment)) return null;
    if (name === comment) return null;

    const handleMatch = joined.match(/@([a-z0-9._-]{2,40})/i);
    const normalizedHandle = normalizeHandle(handleMatch ? handleMatch[1] : name);
    if (!normalizedHandle || isBadName(normalizedHandle)) return null;
    if (isViewerNoisePayload({ name, handle: normalizedHandle, comment })) return null;

    return { name, handle: normalizedHandle, comment };
  }

  function panelScore(node) {
    const rect = node.getBoundingClientRect();
    const text = clean(node.innerText || node.textContent);
    if (!text) return -1;
    if (rect.right < window.innerWidth * 0.72) return -1;
    if (rect.top < 40 || rect.bottom > window.innerHeight + 20) return -1;
    if (rect.width < 220 || rect.width > 520 || rect.height < 360) return -1;

    let score = 0;
    if (/viewers?\s*[·:\-]?\s*\d+/i.test(text)) score += 12;
    if (/welcome to tiktok live/i.test(text)) score += 8;
    if (/type\.\.\./i.test(text)) score += 8;
    if (/community guidelines|comments off|filtered to protect/i.test(text)) score += 4;
    if (/suggested live creators|recommended live streams|discover live|creator tools|get coins|company|program|terms & policies/i.test(text)) score -= 25;
    score += Math.min(8, rect.height / 120);
    return score;
  }

  function findLiveChatPanel() {
    return Array.from(document.querySelectorAll("div"))
      .map((node) => ({ node, score: panelScore(node) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)[0]?.node || null;
  }

  function findCommentRoot() {
    const liveChatPanel = findLiveChatPanel();
    if (liveChatPanel) return liveChatPanel;

    const candidates = [
      '[data-e2e*="live-comment"]',
      '[data-e2e*="live-chat"]',
      '[data-e2e="chat-message"]',
      '[class*="DivChatRoom"]',
      '[class*="ChatRoom"]',
      '[class*="CommentList"]'
    ];
    for (const selector of candidates) {
      const node = document.querySelector(selector);
      if (node && clean(node.innerText || node.textContent)) return node.closest("div") || node;
    }
    const textNodes = Array.from(document.querySelectorAll("div"))
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        const text = clean(node.innerText || node.textContent);
        return rect.width > 160 && rect.height > 80 && text.includes("Welcome to TikTok LIVE");
      })
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right);
    return textNodes[0] || null;
  }

  function isInsideGrabber(node) {
    return Boolean(node.closest?.("#sellerflowlive-grabber-status"));
  }

  function getGrabberReadStartY() {
    const box = document.getElementById("sellerflowlive-grabber-status");
    if (!box) return 0;
    const rect = box.getBoundingClientRect();
    return Math.max(0, rect.bottom + 6);
  }

  function isBelowGrabber(node) {
    const startY = getGrabberReadStartY();
    if (!startY) return true;
    const rect = node.getBoundingClientRect();
    return rect.top >= startY;
  }

  function isInsideTopViewerArea(node, root) {
    const rootRect = root.getBoundingClientRect();
    const rect = node.getBoundingClientRect();
    return rect.top < rootRect.top + 120;
  }

  function isSystemOrJoinRow(text) {
    const value = clean(text).toLowerCase();
    if (!value) return true;
    return (
      /\bjoined\b/.test(value) ||
      /\bliked the live\b/.test(value) ||
      /\bfollowed the host\b/.test(value) ||
      /\bwelcome to tiktok live\b/.test(value) ||
      /\bcommunity guidelines\b/.test(value) ||
      /\bcomments? (off|in this live were filtered)\b/.test(value) ||
      /\bfiltered to protect\b/.test(value) ||
      /^new$/.test(value) ||
      /^viewers?\b/.test(value)
    );
  }

  function looksLikeTopViewerRow(text) {
    const lines = String(text || "").split("\n").map(clean).filter(Boolean);
    const joined = lines.join(" ").toLowerCase();
    if (!lines.length) return true;
    if (/\bviewers?\b/.test(joined)) return true;
    if (/^\d+\s*$/.test(lines[0])) return true;
    if (/^[\s\d\-_.:]+$/.test(lines[0])) return true;
    if (/^\d+\s+[\p{L}\p{N}_@.[\]\- ]{1,80}$/u.test(lines.join(" "))) return true;
    if (/^[-_.:\s]*\d+\s*[-:]/.test(joined)) return true;
    return false;
  }

  function looksLikeRealChatRow(node) {
    const text = node.innerText || node.textContent || "";
    const lines = String(text).split("\n").map(clean).filter(Boolean);
    const rect = node.getBoundingClientRect();
    if (looksLikeTopViewerRow(text)) return false;
    if (lines.length < 2 || lines.length > 4) return false;
    if (rect.width < 120 || rect.width > 430 || rect.height < 18 || rect.height > 120) return false;
    const first = lines[0] || "";
    const second = lines[1] || "";
    if (isBadName(first) || isBadComment(second)) return false;
    if (first === second) return false;
    return true;
  }

  function hasSimilarTextChild(node) {
    const text = clean(node.innerText || node.textContent);
    if (!text) return false;
    return Array.from(node.children || []).some((child) => {
      const childText = clean(child.innerText || child.textContent);
      return childText && childText.length > 20 && childText === text;
    });
  }

  function scrapeVisibleComments() {
    if (!isLivePage()) return [];
    const root = findCommentRoot();
    if (!root) return [];
    const selectors = [
      '[data-e2e="chat-message"]',
      '[data-e2e="comment-item"]',
      '[data-e2e*="live-comment"]',
      '[data-e2e*="live-chat"]',
      'div[role="listitem"]'
    ];
    const nodes = Array.from(new Set(selectors.flatMap((selector) => Array.from(root.querySelectorAll(selector)))))
      .filter((node) => {
        if (isInsideGrabber(node)) return false;
        if (!isBelowGrabber(node)) return false;
        if (isInsideTopViewerArea(node, root)) return false;
        const rect = node.getBoundingClientRect();
        const text = node.innerText || node.textContent || "";
        const lower = clean(text).toLowerCase();
        const lineCount = String(text).split("\n").map(clean).filter(Boolean).length;
        if (!text || text.length >= 360 || lineCount < 2 || lineCount > 4) return false;
        if (isSystemOrJoinRow(text)) return false;
        if (!looksLikeRealChatRow(node)) return false;
        if (hasSimilarTextChild(node)) return false;
        if (rect.right < window.innerWidth * 0.72) return false;
        if (isUiText(lower)) return false;
        if (lower.startsWith("viewers") || lower.includes("viewers")) return false;
        if (/^viewers?\b/i.test(lower)) return false;
        if (/\bviewers?\b/i.test(lower)) return false;
        if (/^\s*\d+\s*[-–—]\s*\d+\s*$/.test(lower)) return false;
        if (/\n\s*\d+\s*[-–—]\s*/.test(text)) return false;
        if (/^\s*\d+\s*[-–—]\s*/.test(lower)) return false;
        if (/\n\s*\d+\s*[-–—]\s*/.test(text)) return false;
        if (/^\s*\d+\s*[-–—]\s*/.test(lower)) return false;
        if (lower.includes("suggested live creators")) return false;
        if (lower.includes("recommended live streams")) return false;
        if (lower.includes("discover live")) return false;
        if (lower.includes("creator tools")) return false;
        if (lower.includes("get coins")) return false;
        if (lower.includes("recharge")) return false;
        if (lower.includes("welcome to tiktok live")) return false;
        if (lower.includes("comments off")) return false;
        if (lower.includes("filtered to protect")) return false;
        return rect.width >= 80 && rect.height >= 14 && rect.height <= 130;
      });

    const items = [];
    for (const node of nodes.slice(-220)) {
      const item = parseBlock(node.innerText || node.textContent || "");
      if (!item) continue;
      const key = `${item.handle}|${item.comment}`;
      if (items.some((existing) => `${existing.handle}|${existing.comment}` === key)) continue;
      items.push(item);
    }
    return items.slice(-100);
  }

  async function sendComment(item) {
    if (!settings.active) {
      setStatus("Paused.");
      return;
    }
    if (!settings.sellerId) {
      setStatus("SellerFlowLive: set seller email in extension");
      return;
    }
    if (isViewerPanelRow(item) || isBadName(item.name) || isBadComment(item.comment)) return;
    const key = `${item.handle}|${item.comment}`;
    if (seen.has(key)) return;
    seen.add(key);
    if (seen.size > SEEN_LIMIT) seen.delete(seen.values().next().value);

    const response = await fetch(`${(settings.serverUrl || DEFAULT_SERVER_URL).replace(/\/$/, "")}/helper/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sellerId: settings.sellerId,
        liveAccount: detectLiveAccount() || "tiktok-live",
        sourceUsername: detectLiveAccount() || "tiktok-live",
        name: item.name,
        handle: item.handle,
        comment: item.comment
      })
    });
    if (!response.ok) throw new Error(`Server ${response.status}`);
    sent += 1;
  }

  async function sendHeartbeat() {
    if (!settings.active || !settings.sellerId || !isLivePage()) return;
    const now = Date.now();
    if (now - lastHeartbeatAt < 10000) return;
    lastHeartbeatAt = now;
    await fetch(`${(settings.serverUrl || DEFAULT_SERVER_URL).replace(/\/$/, "")}/helper/heartbeat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sellerId: settings.sellerId,
        liveAccount: detectLiveAccount() || "tiktok-live",
        sourceUsername: detectLiveAccount() || "tiktok-live"
      })
    });
  }

  async function tick() {
    try {
      if (!isLivePage()) {
        setStatus("Open any TikTok LIVE page.");
        return;
      }
      const liveAccount = detectLiveAccount();
      if (settings.liveAccount && liveAccount && settings.liveAccount !== liveAccount) {
        setStatus(`Locked to ${settings.liveAccount}. Click Save on this LIVE to switch.`);
        return;
      }
      if (!settings.active) {
        setStatus("Paused.");
        return;
      }
      await sendHeartbeat();
      const comments = scrapeVisibleComments();
      found = comments.length;
      for (const item of comments) await sendComment(item);
      setStatus(`${liveAccount || "TikTok LIVE"} | found ${found}, sent ${sent}`);
    } catch (error) {
      setStatus(`SellerFlowLive: ${error.message || error}`);
    }
  }

  chrome.storage.local.get(settings, (saved) => {
    settings = { ...settings, ...saved };
    setStatus(settings.sellerId ? "Ready. Reading below purple box only." : "Set seller email, then Save.");
    setInterval(tick, SEND_INTERVAL_MS);
    void tick();
  });

  chrome.storage.onChanged.addListener((changes) => {
    for (const [key, change] of Object.entries(changes)) settings[key] = change.newValue;
  });
})();
