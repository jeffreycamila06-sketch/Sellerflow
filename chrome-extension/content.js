(function sellerFlowLiveComment() {
  const STORAGE_KEYS = {
    running: "sflc_running",
    position: "sflc_position",
  };
  const ENDPOINTS = [
    "http://localhost:3001/browser-helper/comment",
    "http://127.0.0.1:3001/browser-helper/comment",
  ];
  const WIDGET_ID = "sellerflow-live-comment-widget";
  const COMMENT_SCAN_MS = 650;
  const MAX_SEEN = 900;
  const seen = new Set();
  const recentPayloads = [];
  let running = false;
  let scanTimer = 0;
  let sentCount = 0;
  let widget;
  let statusEl;
  let countEl;
  let startBtn;
  let stopBtn;

  function storageGet(keys) {
    return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
  }

  function storageSet(value) {
    return new Promise((resolve) => chrome.storage.local.set(value, resolve));
  }

  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .replace(/\u00a0/g, " ")
      .trim();
  }

  function isSystemText(text) {
    const lower = text.toLowerCase();
    if (!text || text.length < 1) return true;
    if (text.length > 500) return true;
    return [
      "joined",
      "liked",
      "shared",
      "followed",
      "sent a gift",
      "viewers",
      "viewer",
      "started following",
      "is watching",
      "tap the screen",
      "host muted",
      "moderator",
      "pinned",
      "subscribe",
      "ranking",
      "live goal",
      "creator",
      "welcome to tiktok live",
    ].some((needle) => lower.includes(needle));
  }

  function isLikelyCommentText(text) {
    if (isSystemText(text)) return false;
    const lower = text.toLowerCase();
    if (/^\d+(\.\d+)?[kKmM]?$/.test(text)) return false;
    if (/^[\u2665\s]+$/.test(text)) return false;
    if (lower === "like" || lower === "likes" || lower === "follow" || lower === "share") return false;
    return /[a-zA-Z0-9\u00c0-\uFFFF]/.test(text);
  }

  function visibleElements() {
    const selectors = [
      '[data-e2e*="chat"]',
      '[data-e2e*="comment"]',
      '[class*="chat"]',
      '[class*="Chat"]',
      '[class*="comment"]',
      '[class*="Comment"]',
    ];
    return Array.from(document.querySelectorAll(selectors.join(","))).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 60 && rect.height > 12 && rect.height < 180 && rect.bottom > 0 && rect.top < window.innerHeight;
    });
  }

  function extractFromElement(element) {
    const text = cleanText(element.innerText || element.textContent || "");
    if (!text || isSystemText(text)) return null;

    const lines = text
      .split(/\n+/)
      .map(cleanText)
      .filter(Boolean)
      .filter((line) => !isSystemText(line));

    if (!lines.length || lines.length > 6) return null;

    const handleLine = lines.find((line) => /^@?[a-zA-Z0-9._-]{2,32}$/.test(line));
    const nameLine = lines.find((line) => line !== handleLine && line.length <= 80) || handleLine || "TikTok viewer";
    const commentLine = [...lines].reverse().find((line) => line !== handleLine && line !== nameLine && isLikelyCommentText(line));
    const fallbackComment = lines.length === 1 && isLikelyCommentText(lines[0]) ? lines[0] : "";
    const comment = cleanText(commentLine || fallbackComment);

    if (!isLikelyCommentText(comment)) return null;

    const handle = cleanText(handleLine || nameLine).replace(/^@/, "") || "viewer";
    const name = cleanText(nameLine || handle) || handle;
    const key = `${handle}|${comment}`;
    return { key, handle, name, comment };
  }

  function dedupe(key) {
    if (seen.has(key)) return false;
    seen.add(key);
    recentPayloads.push(key);
    while (recentPayloads.length > MAX_SEEN) {
      const old = recentPayloads.shift();
      if (old) seen.delete(old);
    }
    return true;
  }

  async function sendComment(comment) {
    const payload = {
      handle: comment.handle,
      name: comment.name,
      comment: comment.comment,
      platform: "TikTok",
      source: "SellerFlow Live Comment",
      pageUrl: location.href,
      timestamp: new Date().toISOString(),
    };

    for (const endpoint of ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (response.ok) return true;
      } catch {
        continue;
      }
    }
    return false;
  }

  async function scanComments() {
    if (!running) return;
    const candidates = visibleElements()
      .map(extractFromElement)
      .filter(Boolean)
      .filter((item) => dedupe(item.key));

    for (const item of candidates) {
      const sent = await sendComment(item);
      if (sent) {
        sentCount += 1;
        setStatus(`Captured: ${item.comment.slice(0, 56)}`);
      } else {
        setStatus("SellerFlow backend not reachable on port 3001");
      }
    }
    updateWidget();
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text;
  }

  function updateWidget() {
    if (!widget) return;
    widget.classList.toggle("sflc-running", running);
    startBtn.disabled = running;
    stopBtn.disabled = !running;
    countEl.textContent = `${sentCount} comments sent`;
    if (!running && !statusEl.textContent) setStatus("Stopped");
  }

  async function start() {
    if (running) return;
    running = true;
    await storageSet({ [STORAGE_KEYS.running]: true });
    setStatus("Started. Watching visible TikTok comments only.");
    updateWidget();
    scanComments();
    scanTimer = window.setInterval(scanComments, COMMENT_SCAN_MS);
  }

  async function stop() {
    running = false;
    window.clearInterval(scanTimer);
    await storageSet({ [STORAGE_KEYS.running]: false });
    setStatus("Stopped");
    updateWidget();
  }

  function makeDraggable(header) {
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    header.addEventListener("mousedown", (event) => {
      dragging = true;
      const rect = widget.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      widget.style.right = "auto";
      widget.style.bottom = "auto";
      widget.style.left = `${rect.left}px`;
      widget.style.top = `${rect.top}px`;
      event.preventDefault();
    });

    window.addEventListener("mousemove", (event) => {
      if (!dragging) return;
      const nextLeft = Math.max(0, Math.min(window.innerWidth - widget.offsetWidth, startLeft + event.clientX - startX));
      const nextTop = Math.max(0, Math.min(window.innerHeight - widget.offsetHeight, startTop + event.clientY - startY));
      widget.style.left = `${nextLeft}px`;
      widget.style.top = `${nextTop}px`;
    });

    window.addEventListener("mouseup", async () => {
      if (!dragging) return;
      dragging = false;
      await storageSet({
        [STORAGE_KEYS.position]: {
          left: widget.style.left,
          top: widget.style.top,
        },
      });
    });
  }

  async function createWidget() {
    if (document.getElementById(WIDGET_ID)) return;
    widget = document.createElement("div");
    widget.id = WIDGET_ID;
    widget.innerHTML = `
      <div class="sflc-head">
        <div class="sflc-title">SellerFlow Live Comment</div>
        <div class="sflc-dot" aria-hidden="true"></div>
      </div>
      <div class="sflc-body">
        <div class="sflc-status">Stopped</div>
        <div class="sflc-count">0 comments sent</div>
        <div class="sflc-actions">
          <button class="sflc-btn sflc-start" type="button">START</button>
          <button class="sflc-btn sflc-stop" type="button">STOP</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(widget);
    statusEl = widget.querySelector(".sflc-status");
    countEl = widget.querySelector(".sflc-count");
    startBtn = widget.querySelector(".sflc-start");
    stopBtn = widget.querySelector(".sflc-stop");
    startBtn.addEventListener("click", start);
    stopBtn.addEventListener("click", stop);
    makeDraggable(widget.querySelector(".sflc-head"));

    const saved = await storageGet([STORAGE_KEYS.running, STORAGE_KEYS.position]);
    const position = saved[STORAGE_KEYS.position];
    if (position?.left && position?.top) {
      widget.style.right = "auto";
      widget.style.bottom = "auto";
      widget.style.left = position.left;
      widget.style.top = position.top;
    }
    updateWidget();
    if (saved[STORAGE_KEYS.running]) start();
  }

  createWidget();
})();
