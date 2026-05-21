(function sellerFlowLiveComment() {
  const STORAGE_KEYS = {
    running: "sflc_running",
    position: "sflc_position",
    backendUrl: "sflc_backend_url",
    collapsed: "sflc_collapsed",
  };
  const WIDGET_ID = "sellerflow-live-comment-widget";
  const COMMENT_SCAN_MS = 450;
  const MAX_SEEN = 900;
  const seen = new Set();
  const recentPayloads = [];
  let running = false;
  let scanTimer = 0;
  let sentCount = 0;
  let widget;
  let statusEl;
  let countEl;
  let backendInput;
  let startBtn;
  let stopBtn;
  let toggleBtn;
  let collapsed = true;
  let wasDragged = false;

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

  function hasViewerListText(text) {
    const lower = cleanText(text).toLowerCase();
    return (
      lower.includes("tiktok viewer") ||
      /^viewers\b/.test(lower) ||
      /\bviewers\s*[·-]?\s*\d+/i.test(lower)
    );
  }

  function hasGiftOrNotificationText(text) {
    const normalized = cleanText(text);
    const lower = normalized.toLowerCase();
    return (
      /\bx\s*\d{1,3}\b/i.test(normalized) ||
      /\bmost\s+sent\b/i.test(normalized) ||
      /\bsent\d+\b/i.test(normalized) ||
      lower.includes("shared the live") ||
      lower.includes("sent the live") ||
      lower.includes("sent a gift") ||
      lower.includes("gift")
    );
  }

  function isViewerListElement(element) {
    const rawText = String(element.innerText || element.textContent || "");
    if (hasViewerListText(rawText)) return true;
    let parent = element.parentElement;
    let depth = 0;
    while (parent && depth < 8) {
      const text = String(parent.innerText || parent.textContent || "");
      if (hasViewerListText(text) && !/\btype\.\.\.|comment|comments\b/i.test(text)) return true;
      parent = parent.parentElement;
      depth += 1;
    }
    return false;
  }

  function isSystemText(text) {
    const lower = text.toLowerCase();
    if (!text || text.length < 1) return true;
    if (text.length > 500) return true;
    if (hasGiftOrNotificationText(text)) return true;
    return [
      "joined",
      "join",
      "liked",
      "like",
      "shared",
      "share",
      "followed",
      "follow",
      "sent a gift",
      "gift",
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
      "some comments in this live were filtered",
      "to protect the community",
      "have fun interacting",
      "go live",
      "get coins",
      "recharge",
      "creator tools",
    ].some((needle) => lower.includes(needle));
  }

  function isLikelyCommentText(text) {
    if (isSystemText(text)) return false;
    const lower = text.toLowerCase();
    if (/^\d{2,8}$/.test(text)) return true;
    if (/^\d+(\.\d+)?[kKmM]?$/.test(text)) return false;
    if (/^[\u2665\s]+$/.test(text)) return false;
    if (["like", "likes", "follow", "share"].includes(lower)) return false;
    return /[a-zA-Z0-9\u00c0-\uFFFF]/.test(text);
  }

  function isNumericOnly(text) {
    return /^\d{1,8}$/.test(cleanText(text));
  }

  function isLikelyNameOrHandle(text) {
    const cleaned = cleanText(text).replace(/^@/, "");
    return /^[a-zA-Z0-9._-]{2,32}$/.test(cleaned) && /[a-zA-Z_]/.test(cleaned);
  }

  function isLikelyDisplayName(text) {
    const cleaned = cleanText(text);
    const lower = cleaned.toLowerCase();
    if (!cleaned || cleaned.length > 80) return false;
    if (isNumericOnly(cleaned)) return false;
    if (hasViewerListText(cleaned) || hasGiftOrNotificationText(cleaned) || isSystemText(cleaned)) return false;
    if (/https?:\/\//i.test(cleaned)) return false;
    if (["new", "comments", "viewers"].includes(lower)) return false;
    return /[a-zA-Z\u00c0-\uFFFF]/.test(cleaned);
  }

  function visibleElements() {
    const rightSide = Array.from(document.querySelectorAll("div, section, aside")).filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.left > window.innerWidth * 0.58 && rect.width > 180 && rect.height > 240 && rect.bottom > 120;
    });
    const roots = rightSide.length ? rightSide : [document.body];
    const elements = roots.flatMap((root) => Array.from(root.querySelectorAll("div, span, p")));
    return elements.filter((element) => {
      if (widget && widget.contains(element)) return false;
      if (isViewerListElement(element)) return false;
      const rect = element.getBoundingClientRect();
      const text = cleanText(element.innerText || element.textContent || "");
      if (!text || text.length > 220) return false;
      if (element.children.length > 4) return false;
      return rect.width > 35 && rect.height >= 10 && rect.height < 96 && rect.bottom > 0 && rect.top < window.innerHeight;
    });
  }

  function extractFromElement(element) {
    const rawText = String(element.innerText || element.textContent || "");
    const text = cleanText(rawText);
    if (hasViewerListText(rawText)) return null;
    if (hasGiftOrNotificationText(rawText)) return null;
    if (!text || isSystemText(text)) return null;

    let lines = rawText
      .split(/\n+/)
      .map(cleanText)
      .filter(Boolean)
      .filter((line) => !isSystemText(line));

    if (!lines.length) lines = [text];
    if (lines.length < 2 || lines.length > 6) return null;

    const commentIndex = lines.findLastIndex((line) => isLikelyCommentText(line));
    const commentLine = commentIndex >= 0 ? lines[commentIndex] : "";
    const beforeComment = commentIndex > 0 ? lines.slice(0, commentIndex) : lines.slice(0, -1);
    const handleLine = beforeComment.find(isLikelyNameOrHandle);
    const nameLine = [...beforeComment].reverse().find(isLikelyDisplayName) || handleLine || "";
    const fallbackComment = "";
    const comment = cleanText(commentLine || fallbackComment);

    if (!isLikelyCommentText(comment)) return null;

    const handle = cleanText(handleLine || nameLine).replace(/^@/, "") || "viewer";
    const name = cleanText(nameLine || handle) || handle;
    if (hasViewerListText(`${handle} ${name} ${comment}`)) return null;
    if (hasGiftOrNotificationText(`${handle} ${name} ${comment}`)) return null;
    if (/^(viewer|tiktok viewer)$/i.test(handle) || /^(viewer|tiktok viewer)$/i.test(name)) return null;
    if (isNumericOnly(handle) || isNumericOnly(name) || !isLikelyDisplayName(name)) return null;
    if (isNumericOnly(comment) && (isNumericOnly(handle) || isNumericOnly(name))) return null;
    const key = `${handle}|${comment}|${Math.floor(Date.now() / 30000)}`;
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

  function sendToSellerFlowTab(payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type: "SFL_COMMENT", comment: payload }, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(response || { ok: false });
        });
      } catch (error) {
        resolve({ ok: false, error: error instanceof Error ? error.message : "Message failed" });
      }
    });
  }

  async function sendToBackend(payload) {
    const value = cleanText(backendInput?.value || "");
    if (!value) return false;
    const endpoint = `${value.replace(/\/+$/, "")}/browser-helper/comment`;
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      return response.ok;
    } catch {
      return false;
    }
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

    const bridge = await sendToSellerFlowTab(payload);
    if (bridge.ok) return bridge.delivered ? "delivered" : "queued";
    if (await sendToBackend(payload)) return "backend";
    return "failed";
  }

  async function scanComments() {
    if (!running) return;
    const candidates = visibleElements()
      .map(extractFromElement)
      .filter(Boolean)
      .filter((item) => dedupe(item.key));

    for (const item of candidates) {
      const sent = await sendComment(item);
      if (sent !== "failed") {
        sentCount += 1;
        setStatus(sent === "queued" ? "Captured. Open/refresh SellerFlowLive tab to sync." : `Captured: ${item.comment.slice(0, 56)}`);
      } else {
        setStatus("Cannot sync. Open SellerFlowLive tab.");
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
    widget.classList.toggle("sflc-collapsed", collapsed);
    toggleBtn.textContent = collapsed ? "Show" : "Hide";
    toggleBtn.title = collapsed ? "Show controls" : "Hide controls";
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

  function makeDraggable(handle) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let startLeft = 0;
    let startTop = 0;

    const beginDrag = (event) => {
      if (event.target.closest("button,input")) return;
      dragging = true;
      moved = false;
      wasDragged = false;
      const rect = widget.getBoundingClientRect();
      startX = event.clientX;
      startY = event.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      widget.style.right = "auto";
      widget.style.bottom = "auto";
      widget.style.left = `${rect.left}px`;
      widget.style.top = `${rect.top}px`;
      widget.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    };

    const moveDrag = (event) => {
      if (!dragging) return;
      const deltaX = event.clientX - startX;
      const deltaY = event.clientY - startY;
      if (Math.abs(deltaX) > 3 || Math.abs(deltaY) > 3) {
        moved = true;
        wasDragged = true;
      }
      const nextLeft = Math.max(0, Math.min(window.innerWidth - widget.offsetWidth, startLeft + deltaX));
      const nextTop = Math.max(0, Math.min(window.innerHeight - widget.offsetHeight, startTop + deltaY));
      widget.style.left = `${nextLeft}px`;
      widget.style.top = `${nextTop}px`;
    };

    const endDrag = async (event) => {
      if (!dragging) return;
      dragging = false;
      widget.releasePointerCapture?.(event.pointerId);
      await storageSet({
        [STORAGE_KEYS.position]: {
          left: widget.style.left,
          top: widget.style.top,
        },
      });
      if (moved) {
        window.setTimeout(() => {
          wasDragged = false;
        }, 200);
      }
    };

    handle.addEventListener("pointerdown", beginDrag);
    window.addEventListener("pointermove", moveDrag);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
  }

  async function createWidget() {
    if (document.getElementById(WIDGET_ID)) return;
    widget = document.createElement("div");
    widget.id = WIDGET_ID;
    widget.innerHTML = `
      <div class="sflc-head">
        <div class="sflc-title">SellerFlow Live Comment</div>
        <div class="sflc-dot" aria-hidden="true"></div>
        <button class="sflc-toggle" type="button" title="Show controls">Show</button>
      </div>
      <div class="sflc-body">
        <div class="sflc-status">Stopped</div>
        <div class="sflc-count">0 comments sent</div>
        <input class="sflc-backend" type="text" placeholder="Optional backend URL" />
        <div class="sflc-actions">
          <button class="sflc-btn sflc-start" type="button">START</button>
          <button class="sflc-btn sflc-stop" type="button">STOP</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(widget);
    statusEl = widget.querySelector(".sflc-status");
    countEl = widget.querySelector(".sflc-count");
    backendInput = widget.querySelector(".sflc-backend");
    startBtn = widget.querySelector(".sflc-start");
    stopBtn = widget.querySelector(".sflc-stop");
    toggleBtn = widget.querySelector(".sflc-toggle");
    startBtn.addEventListener("click", start);
    stopBtn.addEventListener("click", stop);
    toggleBtn.addEventListener("click", async () => {
      if (wasDragged) return;
      collapsed = !collapsed;
      await storageSet({ [STORAGE_KEYS.collapsed]: collapsed });
      updateWidget();
    });
    widget.addEventListener("dblclick", async (event) => {
      if (event.target.closest("button,input")) return;
      collapsed = !collapsed;
      await storageSet({ [STORAGE_KEYS.collapsed]: collapsed });
      updateWidget();
    });
    backendInput.addEventListener("change", () => storageSet({ [STORAGE_KEYS.backendUrl]: cleanText(backendInput.value) }));
    makeDraggable(widget);

    const saved = await storageGet([STORAGE_KEYS.running, STORAGE_KEYS.position, STORAGE_KEYS.backendUrl, STORAGE_KEYS.collapsed]);
    collapsed = saved[STORAGE_KEYS.collapsed] !== false;
    backendInput.value = saved[STORAGE_KEYS.backendUrl] || "";
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
