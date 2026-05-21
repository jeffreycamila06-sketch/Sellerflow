const APP_PORTS = new Set();
const PENDING_KEY = "sflc_pending_comments";
const MAX_PENDING = 300;

function getPending() {
  return new Promise((resolve) => {
    chrome.storage.local.get([PENDING_KEY], (result) => {
      resolve(Array.isArray(result[PENDING_KEY]) ? result[PENDING_KEY] : []);
    });
  });
}

function setPending(comments) {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [PENDING_KEY]: comments.slice(-MAX_PENDING) }, resolve);
  });
}

async function queueComment(comment) {
  const pending = await getPending();
  pending.push(comment);
  await setPending(pending);
}

async function flushPending(port) {
  const pending = await getPending();
  if (!pending.length) return;
  for (const comment of pending) {
    port.postMessage({ type: "SFL_COMMENT", comment });
  }
  await setPending([]);
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sellerflow-live-comment-app") return;
  APP_PORTS.add(port);
  flushPending(port);
  port.onDisconnect.addListener(() => APP_PORTS.delete(port));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "SFL_COMMENT" || !message.comment) return false;
  const comment = message.comment;
  if (APP_PORTS.size) {
    for (const port of APP_PORTS) {
      port.postMessage({ type: "SFL_COMMENT", comment });
    }
    sendResponse({ ok: true, delivered: true });
    return true;
  }

  queueComment(comment).then(() => {
    sendResponse({ ok: true, delivered: false, queued: true });
  });
  return true;
});
