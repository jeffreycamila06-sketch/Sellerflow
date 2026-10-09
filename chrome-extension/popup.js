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
  role: document.getElementById("pcRole"), device: document.getElementById("pcDevice"),
};

function pcOne(key, fallback) {
  return new Promise((resolve) => chrome.storage.local.get([key], (r) => resolve(r[key] ?? fallback)));
}
function pcSetObj(value) {
  return new Promise((resolve) => chrome.storage.local.set(value, resolve));
}
// Build 10b — plain words (what happened + what to do); the worker's status keys are unchanged.
const PC_STATUS_LABEL = {
  connected: ["ok", "Connected"], paused: ["off", "Paused"], no_config: ["bad", "Finish setup"],
  no_tab: ["bad", "Tab not open — open it"], no_token: ["bad", "Log in"], ok: ["ok", "OK"], issue: ["warn", "See below"],
  expired: ["warn", "Reconnecting…"],
  refreshing: ["warn", "Reconnecting…"],
  signed_out: ["bad", "SellerFlowLive: signed out — log in once"], // truly logged out — the only manual case
  asleep: ["warn", "Click the SellerFlowLive tab once"],      // discarded SFL tab (never auto-reloaded)
  healing: ["warn", "Waking up…"],
  dead_script: ["bad", "Reload that tab"],
  starting: ["off", "Starting…"],
  stale: ["warn", "Hasn't checked in a while — click the 7-11 tab"],
  guid_missing: ["warn", "Reconnecting…"],
  recovering: ["warn", "Reconnecting…"],
  degraded: ["warn", "Last check failed — trying again…"],
  reminting: ["warn", "Reconnecting…"],
  dead: ["bad", "7-11 store map logged out — open it again from 選擇門市"],
  maintenance: ["warn", "7-ELEVEN maintenance (1–5 AM)"],
};
// The worker's last-error / per-check reasons in plain words (the raw reason stays in the
// worker's console log). Unknown texts pass through unchanged.
function pcPlain(reason) {
  const r = String(reason || "");
  if (!r) return "";
  if (/Supabase URL|anon key/i.test(r)) return "Set up the connection first";
  if (/parcel_scans read failed|\b401\b/i.test(r)) return "Couldn't load parcels. Log in again.";
  if (/CheckoutValidation|tokenID|returned HTML|session\/token/i.test(r)) return "7-11 page logged out — log in again";
  if (/eshopGuid|guid|error\.aspx|byIDData|bounced/i.test(r)) return "7-11 store map not ready — reopen it";
  return r;
}
function pcBadge(el, status) {
  const [cls, label] = PC_STATUS_LABEL[status] || ["off", status || "—"];
  el.innerHTML = `<span class="dot ${cls}"></span>${label}`;
}
function pcReasonRow(rowEl, valEl, reason, at) {
  const show = Boolean(reason);
  rowEl.style.display = show ? "" : "none";
  valEl.textContent = show ? `${pcPlain(reason)}${at ? ` (${new Date(at).toLocaleTimeString()})` : ""}` : "";
}
// 1.15.0 — two-machine failover: which machine is on duty. Labels come from the
// lease (another machine's Device name) → always set as TEXT, never as HTML.
// Order matters: a config problem first (Multi-seller off = cannot serve the sellers),
// then a lease failure (the role shown below it would be stale), then the role.
function pcRenderRole(st, cfg) {
  if (!pcEls.role) return;
  const me = st.workerLabel ? ` · this computer: ${st.workerLabel}` : "";
  let cls = "off", text = `Starting…${me}`;
  if (cfg && cfg.multiSeller !== true) { cls = "bad"; text = `This computer is not checking — turn on "Check for all sellers"${me}`; }
  else if (st.leaseFailing && st.leaseFailOpen) { cls = "warn"; text = `Reconnecting — still checking${me}`; }
  // While the lease fails the text says what this machine is ACTUALLY doing (leaseWorking
  // is decided by the worker on every attempt) — never "leader" while no work is done.
  else if (st.leaseFailing && st.leaseRole === "leader" && st.leaseLone) { cls = "warn"; text = `Reconnecting — still checking${me}`; }
  else if (st.leaseFailing && st.leaseRole === "leader" && st.leaseWorking !== false) { cls = "warn"; text = `Reconnecting — still checking${me}`; }
  else if (st.leaseFailing && st.leaseRole === "leader") { cls = "bad"; text = `Paused — reconnecting${me}`; }
  else if (st.leaseFailing && st.leaseRole === "standby") { cls = "warn"; text = `Waiting — reconnecting${me}`; }
  else if (st.leaseFailing) { cls = "warn"; text = `Reconnecting — still checking${me}`; }
  else if (st.leaseRole === "leader") { cls = "ok"; text = `Checking now${st.degraded ? " — a 7-11 tab needs attention" : ""}${me}`; }
  else if (st.leaseRole === "standby") {
    const age = typeof st.leaseLeaderAgeS === "number"
      ? st.leaseLeaderAgeS + (st.leaseAt ? Math.max(0, Math.round((Date.now() - st.leaseAt) / 1000)) : 0) : null;
    cls = "warn"; text = `Waiting — another computer is checking (${st.leaseLeaderLabel || "?"}${age != null ? `, seen ${age}s ago` : ""})${me}`;
  }
  pcEls.role.textContent = "";
  const dot = document.createElement("span"); dot.className = `dot ${cls}`;
  pcEls.role.append(dot, text);
}
async function pcRenderStatus() {
  const st = (await pcOne(PC_STATUS_KEY, {})) || {};
  pcRenderRole(st, (await pcOne(PC_CONFIG_KEY, {})) || {});
  pcBadge(pcEls.sfl, st.sfl);
  pcBadge(pcEls.myship, st.myship);
  pcBadge(pcEls.emap, st.inMaintenanceWindow ? "maintenance" : st.emap);
  // TRUE emap session state (never "all green" when broken): red = a reload landed
  // on error.aspx (real expiry); amber = no emap tab; green = a store check /
  // keepalive actually resolved; grey = tab present, awaiting a verdict.
  if (pcEls.emapSessionRow) {
    const lastV = st.lastStoreVerdictAt ? ` — last store check ${new Date(st.lastStoreVerdictAt).toLocaleTimeString()}` : "";
    const s = st.emapSession;
    const m = st.inMaintenanceWindow ? ["#b45309", "7-ELEVEN maintenance (1–5 AM) — store checks resume at 5:00"]
      : s === "expired" || (s === "dead" && st.emapDeadReason !== "no_cart_detail") ? ["#e5484d", "⚠️ 7-11 store map logged out — open it again from the 7-11 seller page (選擇門市)"]
      : s === "dead" ? ["#e5484d", "⚠️ 7-11 store map logged out — open it again from the 7-11 seller page (選擇門市), or keep a 7-11 checkout page open so it reopens by itself"]
      : s === "reminting" || s === "guid_missing" || s === "recovering" ? ["#b45309", "⏳ 7-11 store map logged out — opening it again…"]
      : s === "no_tab" ? ["#b45309", "⚠️ 7-11 store map not open — open it from the 7-11 seller page (選擇門市)"]
      : s === "degraded" ? ["#b45309", `⚠️ Last store check failed — trying again…${lastV}`]
      : s === "stale" ? ["#b45309", `⚠️ Hasn't checked in a while — click the 7-11 store map tab${lastV}`]
      : s === "ok" ? ["#16a34a", `● 7-11 store map OK${lastV}`]
      : s === "starting" ? ["#8a8a8a", "○ Starting — first check in a few seconds"]
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
  pcEls.err.textContent = pcPlain(st.lastError);
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
  if (pcEls.device) pcEls.device.value = c.deviceName || "";
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
    deviceName: pcEls.device ? pcEls.device.value.trim().slice(0, 40) : (c.deviceName || ""),
  } });
  pcEls.save.textContent = "Saved ✓";
  setTimeout(() => { pcEls.save.textContent = "Save"; }, 1500);
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
