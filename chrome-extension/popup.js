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
  multi: document.getElementById("pcMulti"), multiRow: document.getElementById("pcMultiRow"), multiQueue: document.getElementById("pcMultiQueue"),
  emapSessionRow: document.getElementById("pcEmapSessionRow"),
  perSellerCfg: document.getElementById("pcPerSellerCfg"),
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
  expired: ["warn", "Refreshing session…"],                 // 1.14.5: auto-refresh in flight (was "click the tab")
  refreshing: ["warn", "Refreshing SellerFlowLive session…"], // in-place refresh / GET re-nav underway
  signed_out: ["bad", "SellerFlowLive: signed out — log in once"], // truly logged out — the only manual case
  asleep: ["warn", "Tab asleep — click it once"],           // discarded SFL tab (never auto-reloaded)
  healing: ["warn", "Waking up…"],                           // auto reload/inject fired; next check confirms
  dead_script: ["bad", "Reload that tab"],                   // re-inject failed — the one truly manual case
  // 1.14.0 — evidence-based per-tab states (green ONLY when that tab's checks resolved
  // in the last 6 min; every other state names the ONE fix):
  starting: ["off", "Starting…"],                            // worker just booted — nothing earned yet
  stale: ["warn", "No check resolved in 6 min — click that tab once"],
  guid_missing: ["warn", "Session lost — re-opening…"],
  recovering: ["warn", "Re-opened — verifying…"],
  degraded: ["warn", "Last check failed — recovering…"],     // 1.14.4: a recent verdict never hides a fresh failure
  reminting: ["warn", "Re-opening via 賣貨便 選擇取貨門市…"],  // 1.14.3 unattended re-mint in flight
  dead: ["bad", "Re-open via 賣貨便 → 選擇門市"],            // 2 recoveries didn't help = real expiry
  maintenance: ["warn", "7-ELEVEN maintenance (1–5 AM)"],     // 1.14.6: nightly window, checks slowed, nothing counted
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
  pcBadge(pcEls.emap, st.inMaintenanceWindow ? "maintenance" : st.emap);
  // TRUE emap session state (never "all green" when broken): red = a reload landed
  // on error.aspx (real expiry); amber = no emap tab; green = a store check /
  // keepalive actually resolved; grey = tab present, awaiting a verdict.
  if (pcEls.emapSessionRow) {
    const dom = st.emapDomain ? ` · ${st.emapDomain}` : "";
    const tab = st.emapTabId != null ? ` (tab ${st.emapTabId})` : "";
    const lastV = st.lastStoreVerdictAt ? ` — last store check ${new Date(st.lastStoreVerdictAt).toLocaleTimeString()}` : "";
    const s = st.emapSession;
    const m = st.inMaintenanceWindow ? ["#b45309", "7-ELEVEN maintenance window (1–5 AM) — store checks resume at 5:00"]
      : s === "expired" ? ["#e5484d", `⚠️ E-Map landed on error.aspx (session expired) — re-open via 賣貨便 → 選擇門市${dom}${tab}`]
      : s === "dead" ? ["#e5484d", st.emapDeadReason === "no_cart_detail"
          ? `⚠️ E-Map session expired — re-open via 賣貨便 → 選擇門市 (or park 賣貨便 on /cart/detail for auto re-mint)${dom}${tab}`
          : st.emapDeadReason === "timeout"
            ? `⚠️ E-Map session expired — auto re-mint via 選擇取貨門市 did not yield a session in 20 s — re-open via 賣貨便 → 選擇門市${dom}${tab}`
            : `⚠️ E-Map session expired — re-open via 賣貨便 → 選擇門市${st.emapDeadReason ? ` (${st.emapDeadReason})` : ""}${dom}${tab}`]
      : s === "reminting" ? ["#b45309", "⏳ E-Map session expired — re-opening via 賣貨便 → 選擇取貨門市 (auto, ≤20 s)"]
      : s === "no_tab" ? ["#b45309", "⚠️ E-Map tab not found — open E-Map via 賣貨便 → 選擇門市"]
      : s === "guid_missing" || s === "recovering" ? ["#b45309", `⚠️ E-Map session lost — re-opening the tab (GET, no resubmission dialog) to re-mint it${dom}${tab}`]
      : s === "degraded" ? ["#b45309", `⚠️ E-Map: latest store check failed (${st.lastStoreReason || "guid missing"}) — recovering…${lastV}${dom}${tab}`]
      : s === "stale" ? ["#b45309", `⚠️ E-Map tab open but no store check resolved in 6 min${lastV}${dom}${tab}`]
      : s === "ok" ? ["#16a34a", `● E-Map session OK${lastV}${dom}${tab}`]
      : s === "starting" ? ["#8a8a8a", "○ Worker starting — first check in a few seconds"]
      : null;
    pcEls.emapSessionRow.style.display = m ? "" : "none";
    if (m) { pcEls.emapSessionRow.style.color = m[0]; pcEls.emapSessionRow.textContent = m[1]; }
  }
  // Multi-seller mode ignores the per-seller GM / phone fields (the RPC supplies
  // them per row) — hide them so a blank field never looks like a missing setup.
  if (pcEls.perSellerCfg) pcEls.perSellerCfg.style.display = st.multi != null ? "none" : "";
  pcEls.last.textContent = st.lastCheckAt ? `${new Date(st.lastCheckAt).toLocaleTimeString()} · ${st.lastCount ?? 0} parcels` : "—";
  const showErr = Boolean(st.lastError);
  pcEls.errK.style.display = showErr ? "" : "none";
  pcEls.err.style.display = showErr ? "" : "none";
  pcEls.err.textContent = st.lastError || "";
  // Exact per-check reason for the last 'unknown' — so Jeff never opens DevTools.
  pcReasonRow(pcEls.storeErrRow, pcEls.storeErr, st.lastStoreReason, st.lastStoreAt);
  // multi-seller queue depth (visible once the mode has reported at least once)
  const showMulti = st.multi != null;
  pcEls.multiRow.style.display = showMulti ? "" : "none";
  if (showMulti) pcEls.multiQueue.textContent = st.multi === "ok" ? String(st.multiQueueDepth ?? 0) : String(st.multi);
  pcReasonRow(pcEls.phoneErrRow, pcEls.phoneErr, st.lastPhoneReason, st.lastPhoneAt);
}
async function pcRenderConfig() {
  const c = (await pcOne(PC_CONFIG_KEY, {})) || {};
  pcEls.url.value = c.supabaseUrl || PC_DEFAULT_URL;
  pcEls.key.value = c.supabaseAnonKey || "";
  pcEls.cgdm.value = c.cgdmId || "";
  pcEls.ord.value = c.ordMobile || "";
  pcEls.pause.textContent = c.paused ? "Resume" : "Pause";
  pcEls.multi.checked = c.multiSeller === true; // multi-seller mode — DEFAULT OFF (dogfood)
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
    multiSeller: pcEls.multi.checked === true,
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
pcEls.multi.addEventListener("change", async () => {
  const c = (await pcOne(PC_CONFIG_KEY, {})) || {};
  await pcSetObj({ [PC_CONFIG_KEY]: { ...c, multiSeller: pcEls.multi.checked === true } });
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
