// SellerFlow parcel checker — popup status + config.
const PC_CONFIG_KEY = "pc_config";
const PC_STATUS_KEY = "pc_status";
const PC_DEFAULT_URL = "https://sqeuyuktdpidmlfpqgoc.supabase.co";
const pcEls = {
  sfl: document.getElementById("pcSfl"), myship: document.getElementById("pcMyship"), emap: document.getElementById("pcEmap"),
  last: document.getElementById("pcLast"), errK: document.getElementById("pcErrK"), err: document.getElementById("pcErr"),
  storeErrRow: document.getElementById("pcStoreErrRow"), storeErr: document.getElementById("pcStoreErr"),
  phoneErrRow: document.getElementById("pcPhoneErrRow"), phoneErr: document.getElementById("pcPhoneErr"),
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
  no_tab: ["bad", "Tab not open"], no_token: ["bad", "Log in"], ok: ["ok", "OK"], issue: ["warn", "See note below"],
  // Self-heal (v1.7.0) — each non-green state names the ONE action needed:
  expired: ["warn", "Click the SellerFlowLive tab once"],   // frozen tab stopped the token refresh
  asleep: ["warn", "Tab asleep — click it once"],           // discarded SFL tab (never auto-reloaded)
  healing: ["warn", "Waking up…"],                           // auto reload/inject fired; next check confirms
  dead_script: ["bad", "Reload that tab"],                   // re-inject failed — the one truly manual case
};
function pcBadge(el, status) {
  const [cls, label] = PC_STATUS_LABEL[status] || ["off", status || "—"];
  el.innerHTML = `<span class="dot ${cls}"></span>${label}`;
}
function pcReasonRow(rowEl, valEl, reason, at) {
  const show = Boolean(reason);
  rowEl.style.display = show ? "" : "none";
  valEl.textContent = show ? `${reason}${at ? ` (${new Date(at).toLocaleTimeString()})` : ""}` : "";
}
async function pcRenderStatus() {
  const st = (await pcOne(PC_STATUS_KEY, {})) || {};
  pcBadge(pcEls.sfl, st.sfl);
  pcBadge(pcEls.myship, st.myship);
  pcBadge(pcEls.emap, st.emap);
  pcEls.last.textContent = st.lastCheckAt ? `${new Date(st.lastCheckAt).toLocaleTimeString()} · ${st.lastCount ?? 0} parcels` : "—";
  const showErr = Boolean(st.lastError);
  pcEls.errK.style.display = showErr ? "" : "none";
  pcEls.err.style.display = showErr ? "" : "none";
  pcEls.err.textContent = st.lastError || "";
  // Exact per-check reason for the last 'unknown' — so Jeff never opens DevTools.
  pcReasonRow(pcEls.storeErrRow, pcEls.storeErr, st.lastStoreReason, st.lastStoreAt);
  pcReasonRow(pcEls.phoneErrRow, pcEls.phoneErr, st.lastPhoneReason, st.lastPhoneAt);
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
