// ── Parcel checker (v1.1) — status + config; the comment UI below is unchanged ──
const PC_CONFIG_KEY = "pc_config";
const PC_STATUS_KEY = "pc_status";
const PC_DEFAULT_URL = "https://sqeuyuktdpidmlfpqgoc.supabase.co";
const pcEls = {
  sfl: document.getElementById("pcSfl"), myship: document.getElementById("pcMyship"),
  last: document.getElementById("pcLast"), errK: document.getElementById("pcErrK"), err: document.getElementById("pcErr"),
  url: document.getElementById("pcUrl"), key: document.getElementById("pcKey"),
  cgdm: document.getElementById("pcCgdm"), ord: document.getElementById("pcOrd"),
  save: document.getElementById("pcSave"), pause: document.getElementById("pcPause"), checkNow: document.getElementById("pcCheckNow"),
};

function pcOne(key, fallback) {
  return new Promise((resolve) => chrome.storage.local.get([key], (r) => resolve(r[key] ?? fallback)));
}
function pcSetObj(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}
const PC_STATUS_LABEL = {
  connected: ["ok", "Connected"], paused: ["off", "Paused"], no_config: ["bad", "Set URL + key"],
  no_tab: ["bad", "Tab not open"], no_token: ["bad", "Log in"], ok: ["ok", "Session OK"], expired: ["warn", "Session expired"],
};
function pcBadge(el, status) {
  const [cls, label] = PC_STATUS_LABEL[status] || ["off", status || "—"];
  el.innerHTML = `<span class="dot ${cls}"></span>${label}`;
}
async function pcRenderStatus() {
  const st = (await pcOne(PC_STATUS_KEY, {})) || {};
  pcBadge(pcEls.sfl, st.sfl);
  pcBadge(pcEls.myship, st.myship);
  pcEls.last.textContent = st.lastCheckAt ? `${new Date(st.lastCheckAt).toLocaleTimeString()} · ${st.lastCount ?? 0} parcels` : "—";
  const showErr = Boolean(st.lastError);
  pcEls.errK.style.display = showErr ? "" : "none";
  pcEls.err.style.display = showErr ? "" : "none";
  pcEls.err.textContent = st.lastError || "";
}
async function pcRenderConfig() {
  const c = (await pcOne(PC_CONFIG_KEY, {})) || {};
  pcEls.url.value = c.supabaseUrl || PC_DEFAULT_URL;
  pcEls.key.value = c.supabaseAnonKey || "";
  pcEls.cgdm.value = c.cgdmId || "";
  pcEls.ord.value = c.ordMobile || "";
  pcEls.pause.textContent = c.paused ? "Resume" : "Pause";
  pcEls.pause.classList.toggle("primary", Boolean(c.paused));
}
pcEls.save.addEventListener("click", async () => {
  const c = (await pcOne(PC_CONFIG_KEY, {})) || {};
  await pcSetObj({ [PC_CONFIG_KEY]: {
    ...c,
    supabaseUrl: (pcEls.url.value || PC_DEFAULT_URL).trim().replace(/\/+$/, ""),
    supabaseAnonKey: pcEls.key.value.trim(),
    cgdmId: pcEls.cgdm.value.trim(),
    ordMobile: pcEls.ord.value.trim(),
  } });
  pcEls.save.textContent = "Saved ✓";
  setTimeout(() => { pcEls.save.textContent = "Save config"; }, 1500);
});
pcEls.pause.addEventListener("click", async () => {
  const c = (await pcOne(PC_CONFIG_KEY, {})) || {};
  const paused = !(c.paused === true);
  await pcSetObj({ [PC_CONFIG_KEY]: { ...c, paused } });
  await pcRenderConfig();
  if (!paused) chrome.runtime.sendMessage({ type: "PC_POLL_NOW" });
  await pcRenderStatus();
});
pcEls.checkNow.addEventListener("click", () => {
  pcEls.checkNow.textContent = "Checking…";
  chrome.runtime.sendMessage({ type: "PC_POLL_NOW" }, () => {
    setTimeout(async () => { pcEls.checkNow.textContent = "Check now"; await pcRenderStatus(); }, 1200);
  });
});
pcRenderConfig();
pcRenderStatus();
setInterval(pcRenderStatus, 3000);

const HISTORY_KEY = "sflc_comment_history";
const metaEl = document.getElementById("meta");
const listEl = document.getElementById("commentList");
const downloadBtn = document.getElementById("downloadCsv");
const clearBtn = document.getElementById("clearHistory");

function storageGet(key, fallback) {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve(Array.isArray(result[key]) ? result[key] : fallback);
    });
  });
}

function storageSet(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function csvValue(value) {
  return `"${cleanText(value).replace(/"/g, '""')}"`;
}

function downloadCsv(comments) {
  const rows = [
    ["time", "platform", "handle", "name", "comment", "pageUrl"],
    ...comments.map((item) => [
      item.timestamp || "",
      item.platform || "TikTok",
      item.handle || "",
      item.name || "",
      item.comment || "",
      item.pageUrl || "",
    ]),
  ];
  const csv = rows.map((row) => row.map(csvValue).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `sellerflow-live-comments-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

async function render() {
  const comments = await storageGet(HISTORY_KEY, []);
  const newest = [...comments].reverse();
  metaEl.textContent = `${comments.length} captured comments`;
  listEl.innerHTML = newest
    .slice(0, 80)
    .map((item) => {
      const name = cleanText(item.name || item.handle || "TikTok viewer");
      const handle = cleanText(item.handle || "");
      const comment = cleanText(item.comment || "");
      const time = cleanText(item.timestamp || "");
      return `
        <li>
          <div class="name">${name}${handle && handle !== name ? ` - @${handle}` : ""}</div>
          <div class="comment">${comment}</div>
          <div class="time">${time}</div>
        </li>
      `;
    })
    .join("");
  return comments;
}

downloadBtn.addEventListener("click", async () => {
  downloadCsv(await storageGet(HISTORY_KEY, []));
});

clearBtn.addEventListener("click", async () => {
  await storageSet({ [HISTORY_KEY]: [] });
  await render();
});

render();
