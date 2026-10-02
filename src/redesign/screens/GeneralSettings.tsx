// Screen 6b — General Settings. dc.html v2 L463–645.
// Profile (ONCE) · Live session auto-detect card (per v2, here) · Appearance
// (REAL theme + accent control — replaces the old floating toggle) · Channels ·
// Printer & display · Account links. Visual/sample only; theme+accent drive the
// redesign preview state.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ACCENT_ORDER, ACCENTS, LANGS, CURRENCIES, CURRENCY_ORDER, type ThemeMode, type AccentKey, type AutoControls } from "../data";
import { headerBar, headerTitle, card, sectionLabel } from "../ui";
import { profileToDisplay, planLabel, renewLabel } from "../adapters/useAuthSession";
import { validatePhone, DEFAULT_COUNTRY } from "../adapters/phone";
import { normalizeSamePrice, canEnableSamePrice } from "../adapters/useSamePrice";
import LiveSettingModal from "../components/LiveSettingModal";
import CountryPhoneField from "../components/CountryPhoneField";
import type { AccountUser } from "../../accountDb";
import { useT, tpl } from "../i18n";
import { accountList } from "../adapters/connect";
import ChannelsList, { type ManageChan } from "../components/ChannelsList";

// Motion toggle is INTENTIONALLY HIDDEN for now (Jeff — pending a phone
// heat/jank report). The whole motion machinery stays live (defaults ON); this
// only hides the Appearance pill. Flip to `true` to re-show the row in one step.
const SHOW_MOTION_TOGGLE = false;
import { isIOS } from "../adapters/platform";
import { canSeeKioskLauncher, KIOSK_COMMAND_WINDOWS, KIOSK_COMMAND_MAC } from "../adapters/kioskLauncher";
import { copyText } from "../components/inviteShare";
import { usePrinterStatus, type PrinterConnState } from "../adapters/usePrinterStatus";

const label: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 5 };
const input: CSSProperties = { width: "100%", padding: "11px 13px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 600, outline: "none" };
const rowTitle: CSSProperties = { fontSize: 13.5, fontWeight: 700, color: "var(--text)" };
const rowSub: CSSProperties = { fontSize: 11.5, color: "var(--text-muted)" };

// ── Live session rows (approved mockup): title + toggle / value / chevron only ──
type LsKey = "awake" | "pin" | "auto" | "sp";
const lsRow: CSSProperties = { display: "flex", alignItems: "center", gap: 12, padding: "15px 14px", borderBottom: "1px solid var(--border)", minHeight: 56, boxSizing: "border-box" };
const lsLabel: CSSProperties = { flex: 1, minWidth: 0, fontSize: 15, fontWeight: 600, color: "var(--text)" };
const lsVal: CSSProperties = { fontSize: 13, color: "var(--text-muted)", fontFamily: "var(--font-mono)", flexShrink: 0 };
const svgProps = { width: 22, height: 22, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2 } as const;
const ICON_AWAKE = <svg {...svgProps}><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M8 21h8M12 18v3" /></svg>;
const ICON_PIN = <svg {...svgProps}><path d="M12 17v5M9 3h6l-1 6 3 3H7l3-3z" /></svg>;
const ICON_AUTO = <svg {...svgProps}><path d="M4 12h4l2-6 4 12 2-6h4" /></svg>;
const ICON_TAG = <svg {...svgProps}><path d="M20 12l-8 8-9-9V4h7z" /><circle cx="7.5" cy="7.5" r="1.5" fill="currentColor" /></svg>;

// Live-session toggle with the mockup's spring knob (redesign.css .sfl-ls-knob).
function LsToggle({ on, title, testId, onClick }: { on: boolean; title: string; testId?: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={title} title={title} onClick={onClick} data-testid={testId}
      style={{ background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}>
      <span className="sfl-ls-track" style={{ width: 44, height: 26, borderRadius: 13, background: on ? "var(--accent)" : "var(--border-strong)", position: "relative", display: "block" }}>
        <span className="sfl-ls-knob" style={{ position: "absolute", top: 3, left: 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)", transform: on ? "translateX(18px)" : "none" }} />
      </span>
    </button>
  );
}

export default function GeneralSettings({
  theme, accent, onSetTheme, onSetAccent,
  auto, lang, onSetLang, currency, onSetCurrency,
  profileOpen, onToggleProfile,
  printerIdx, printerOpen, printerFocus = 0, onPrinterFocused, onTogglePrinter, onPickPrinter, onPrintPattern,
  onSubscription, onSupport, onDelete,
  account = null, onSaveProfile, onManageChannel,
  channelsV2 = false, onOpenChannel, channelsInfo,
  keepAwake = true, onToggleKeepAwake, pinPrint = false, onTogglePinPrint,
  liveSessionOpen, onToggleLiveSession,
  cur = "NT$", samePriceEnabled = false, samePrice = null, onSetSamePriceEnabled, samePriceError = 0,
  onToast,
  motionOn = true, onToggleMotion,
}: {
  theme: ThemeMode; accent: AccentKey; onSetTheme: (t: ThemeMode) => void; onSetAccent: (a: AccentKey) => void;
  auto: AutoControls; cur?: string; // cur retained (optional) for callers; no longer used here (auto price editor moved to Products)
  lang: string; onSetLang: (c: string) => void; currency: string; onSetCurrency: (c: string) => void;
  profileOpen: boolean; onToggleProfile: () => void;
  printerIdx: number; printerOpen: boolean; printerFocus?: number; onPrinterFocused?: () => void; onTogglePrinter: () => void; onPickPrinter: (i: number, alreadySetUp: boolean) => void; onPrintPattern: () => void;
  onSubscription: () => void; onSupport: () => void; onDelete: () => void;
  account?: AccountUser | null; // Phase 5a: real signed-in profile (null → demo fallback)
  // Phase 5i — real self-edit save (upsertUser → seller_profiles). Profile card writes
  // ONLY name/store/phone — NOT tiktok/facebook (the Channels editor is the sole account writer).
  onSaveProfile?: (fields: { fullName: string; storeName: string; phone: string }) => Promise<{ ok: boolean; error?: string }>;
  // Channels card is DISPLAY-only here; tapping a row opens the Manage screen (C).
  onManageChannel?: (platform: "tiktok" | "facebook") => void;
  // Owner-gated (LIVE_SOURCE_EMAILS) compact Channels list → opens LiveConnectModal in
  // "manage" mode. channelsV2 false → the classic two channelRow cards (byte-unchanged).
  channelsV2?: boolean;
  onOpenChannel?: (platform: ManageChan) => void;
  channelsInfo?: { ttLive: string | null; showShopee: boolean; shopeeName?: string; shopeeConnected?: boolean };
  // Keep-awake habang naka-live (web Screen Wake Lock) — display toggle only;
  // the lock lifecycle lives in RedesignApp (useWakeLock on green/amber).
  keepAwake?: boolean; onToggleKeepAwake?: () => void;
  liveSessionOpen?: boolean; onToggleLiveSession?: () => void; // lifted to RedesignApp so a remount can't lose it
  // "Same price for all items" — ON/OFF toggle + a remembered price (DB-backed,
  // RedesignApp owns useSamePrice). `samePrice` = the remembered price (persists
  // across OFF). onSetSamePriceEnabled(on, draft): ON comes only from the modal's
  // "Turn on" (commits the typed price; blocked when no price > 0).
  samePriceEnabled?: boolean; samePrice?: number | null;
  onSetSamePriceEnabled?: (on: boolean, draft?: unknown) => void; samePriceError?: number;
  // Live-session toggles turned OFF show a bottom toast (RedesignApp's global toast).
  onToast?: (msg: string) => void;
  pinPrint?: boolean; onTogglePinPrint?: () => void; // PIN-TO-PRINT — per-device, default OFF
  // Motion kill switch — pause looping animations (display toggle; RedesignApp
  // sets [data-motion] on the root). One-shot entrances stay.
  motionOn?: boolean; onToggleMotion?: () => void;
}) {
  const t = useT();
  const [kioskCopied, setKioskCopied] = useState(false); // "Copy kiosk command" feedback (web-only card)
  const copyKioskCommand = async () => { setKioskCopied(await copyText(KIOSK_COMMAND_WINDOWS)); };
  const [apLangOpen, setApLangOpen] = useState(false);
  const [apCurOpen, setApCurOpen] = useState(false);
  const curLang = LANGS.find((l) => l.code === lang) || LANGS[0];
  // LIVE SESSION explainer — a centered modal (approved mockup). Turning a toggle ON
  // opens it; it flips ON only on "Turn on" (Cancel / click outside / Esc = stays OFF).
  // Turning OFF is instant + a toast, never a modal. `modalKey` keeps the content
  // through the fade-out; `modalOpen` drives the motion.
  const [modalKey, setModalKey] = useState<LsKey | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [spDraft, setSpDraft] = useState(""); // Same-price field (pre-filled with the remembered price)
  const spInputRef = useRef<HTMLInputElement>(null);
  const spValid = canEnableSamePrice(normalizeSamePrice(spDraft));
  const spErr = spDraft !== "" && !spValid;
  const openModal = (k: LsKey) => {
    setModalKey(k); setModalOpen(true);
    if (k === "sp") {
      setSpDraft(samePrice != null && samePrice > 0 ? String(samePrice) : "");
      setTimeout(() => spInputRef.current?.focus(), 220); // after the modal fade-in
    }
  };
  const closeModal = () => setModalOpen(false);
  const fmtPrice = (p: number | null) => `${cur}${p != null ? p.toLocaleString("en-US") : ""}`;
  // Tap a Live-session toggle: OFF → open the explainer; ON → instant off + toast.
  const lsToggle = (k: LsKey, isOn: boolean) => {
    if (!isOn) { openModal(k); return; }
    if (k === "awake") { onToggleKeepAwake?.(); onToast?.(t.rd_lss_off_awake); }
    else if (k === "pin") { onTogglePinPrint?.(); onToast?.(t.rd_lss_off_pin); }
    else if (k === "auto") { auto.toggle(); onToast?.(t.rd_lss_off_auto); }
    else { onSetSamePriceEnabled?.(false); onToast?.(tpl(t.rd_lss_off_sp, { price: fmtPrice(samePrice) })); }
  };
  // "Turn on" — the only path that flips a Live-session toggle ON. Guarded on
  // modalOpen so a second tap during the fade-out can't flip it back off.
  const turnOn = () => {
    if (!modalOpen || !modalKey) return;
    if (modalKey === "sp") { if (!spValid) return; onSetSamePriceEnabled?.(true, spDraft); }
    else if (modalKey === "awake") onToggleKeepAwake?.();
    else if (modalKey === "pin") onTogglePinPrint?.();
    else auto.toggle();
    closeModal();
  };
  const MODAL: Record<LsKey, { icon: ReactNode; title: string; text: string }> = {
    awake: { icon: ICON_AWAKE, title: t.rd_set_keepawake, text: t.rd_lss_awake_text },
    pin: { icon: ICON_PIN, title: t.rd_set_pinprint, text: t.rd_lss_pin_text },
    auto: { icon: ICON_AUTO, title: t.rd_set_auto_mode, text: t.rd_lss_auto_text },
    sp: { icon: ICON_TAG, title: t.rd_smp_row_title, text: t.rd_lss_sp_text },
  };
  // Same price row value (mono): "NT$199" when ON, "NT$199 saved" when OFF.
  const spRowVal = samePrice != null && samePrice > 0 ? (samePriceEnabled ? fmtPrice(samePrice) : tpl(t.rd_lss_saved, { price: fmtPrice(samePrice) })) : "";

  // Phase 5i — controlled profile-edit form, initialized from the real profile and
  // re-synced when it changes (e.g. after a save reload). Only user-editable fields.
  const [form, setForm] = useState({ fullName: "", storeName: "", phone: "" });
  const [phoneCountry, setPhoneCountry] = useState(() => { try { return localStorage.getItem("sfl_rd_phone_country") || DEFAULT_COUNTRY; } catch { return DEFAULT_COUNTRY; } });
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveErr, setSaveErr] = useState("");
  useEffect(() => {
    setForm({
      fullName: account?.profile.fullName || "",
      storeName: account?.profile.storeName || "",
      phone: account?.profile.phone || "",
    });
    setSaveState("idle"); setSaveErr("");
  }, [account]);
  const setField = (k: keyof typeof form, v: string) => { setForm((f) => ({ ...f, [k]: v })); setSaveState("idle"); };
  const pickPhoneCountry = (iso: string) => { setPhoneCountry(iso); setSaveState("idle"); try { localStorage.setItem("sfl_rd_phone_country", iso); } catch { /* ignore */ } };
  // Inline hint only when the phone was CHANGED to an invalid value (grandfathered
  // pre-filled values are never flagged — validate-on-change).
  const phoneChangedInvalid = form.phone.trim() !== (account?.profile.phone || "").trim() && form.phone.trim().length > 0 && !validatePhone(form.phone, phoneCountry).valid;
  const handleSaveProfile = async () => {
    if (!onSaveProfile || saveState === "saving") return;
    if (!form.fullName.trim() || !form.storeName.trim()) { setSaveState("error"); setSaveErr(t.rd_set_err_required); return; }
    // Phone: SAME single-source validatePhone(number, country) as signup. GRANDFATHER
    // — only validate when the phone was CHANGED, so an existing seller with an empty
    // OR malformed stored phone can still edit their other fields (their pre-filled
    // value passes untouched). A NEWLY-typed phone must be valid for the picked
    // country (blocks "1234567890"); a valid change is stored as clean national digits.
    const ph = form.phone.trim();
    const originalPh = (account?.profile.phone || "").trim();
    const phChanged = ph !== originalPh;
    if (phChanged && ph && !validatePhone(ph, phoneCountry).valid) { setSaveState("error"); setSaveErr(t.rd_su_err_phone); return; }
    setSaveState("saving"); setSaveErr("");
    // ⚠️ name/store/phone ONLY — never tiktok/facebook (Channels editor owns accounts).
    const r = await onSaveProfile({
      fullName: form.fullName.trim(),
      storeName: form.storeName.trim(),
      phone: phChanged && ph ? validatePhone(ph, phoneCountry).national : ph, // clean national on a valid change; else keep as-is (grandfather)
    });
    if (r.ok) { setSaveState("saved"); }
    else { setSaveState("error"); setSaveErr(r.error || t.rd_set_err_save_failed); }
  };

  // Phase 5a — real profile (falls back to the demo strings when signed out / no row).
  const pd = profileToDisplay(account);
  const pAvatar = pd ? pd.initials : "MS";
  const pShop = pd ? pd.shopName : "Maria's Live Shop";
  const pHandle = pd ? (pd.handle || "—") : "@maria_shops";
  const pPlanLine = pd ? pd.planLine : "Pro plan · renews Jul 28";
  const pEmail = account ? account.email : "maria@liveshop.ph";
  const pSubRow = account ? `${planLabel(account.plan)}${renewLabel(account.planExpiry) ? " · " + renewLabel(account.planExpiry).replace(/^renews /, "") : ""} ›` : "Pro · Jul 28 ›";
  // LIVE SESSION group — collapsed by default, remembered per device. The
  // open/closed state is LIFTED to RedesignApp when the parent provides it
  // (survives a GeneralSettings remount — a local flag would reset, matching the
  // printer-focus lesson). Falls back to local state for standalone callers.
  const [liveOpenLocal, setLiveOpenLocal] = useState(() => { try { return localStorage.getItem("sfl_rd_livesession_open") === "1"; } catch { return false; } });
  const liveOpen = liveSessionOpen ?? liveOpenLocal;
  const toggleLiveOpen = onToggleLiveSession ?? (() => setLiveOpenLocal((v) => { const n = !v; try { localStorage.setItem("sfl_rd_livesession_open", n ? "1" : "0"); } catch { /* ignore */ } return n; }));
  const lsSummary = [
    `${t.rd_set_ls_auto} ${auto.detect ? t.rd_set_ls_on : t.rd_set_ls_off}`,
    `${t.rd_set_ls_awake} ${keepAwake ? t.rd_set_ls_on : t.rd_set_ls_off}`,
    onTogglePinPrint ? `${t.rd_set_ls_print} ${pinPrint ? t.rd_set_ls_on : t.rd_set_ls_off}` : null,
  ].filter(Boolean).join(" · ");
  const seg = (active: boolean): CSSProperties => ({ flex: 1, padding: "9px 0", border: "none", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, ...(active ? { background: "var(--accent)", color: "#fff" } : { background: "transparent", color: "var(--text-dim)" }) });
  // Batch B #6 — the picker's fictional PRINTERS sample hardware ("192.168.1.42",
  // "Xprinter XP-365B USB") is gone. TWO honest slots matching the app's REAL
  // printing capabilities (slot 0 = WiFi/LAN slip, slot 1 = Bluetooth sticker);
  // the meta line shows the REAL saved device (BT name / LAN host:port) from the
  // native bridge when one exists, else the generic capability description.
  const printerStatus = usePrinterStatus(printerOpen);
  const printerSlots = [
    { name: t.rd_set_prn_wifi, meta: printerStatus.lanDetail || t.rd_set_prn_wifi_meta },
    { name: t.rd_set_prn_bt, meta: printerStatus.btDetail || t.rd_set_prn_bt_meta },
  ];
  // "Already set up" per slot = a device is saved (a LAN host:port for WiFi, a
  // paired device for BT). Native-only truth (web/preview = "" → always false →
  // the guide always shows on preview). Passed up so RedesignApp shows the setup
  // guide only when the picked type isn't set up yet.
  const slotSetUp = (i: number): boolean => (i === 0 ? !!printerStatus.lanDetail : !!printerStatus.btDetail);
  // Scroll the printer picker into view when arriving from the no-printer modal.
  // ONE-SHOT: after scrolling, signal the parent to reset printerFocus to 0 so the
  // intent is consumed. Otherwise — because this screen is conditionally mounted —
  // the effect would re-run on EVERY later mount (printerFocus stays > 0) and
  // auto-scroll to the printer section on plain Settings opens for the rest of the
  // session. Resetting in the parent (not a local ref) is what survives remount.
  const printerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (printerFocus > 0) { printerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); onPrinterFocused?.(); }
  }, [printerFocus, onPrinterFocused]);
  // A stale persisted index (the old picker had 3 slots) clamps to the last slot.
  const printerSlotIdx = Math.min(Math.max(printerIdx, 0), printerSlots.length - 1);
  const printer = printerSlots[printerSlotIdx];
  const slotState = (i: number): PrinterConnState => (i === 0 ? printerStatus.lan : printerStatus.bt);
  const stateLabel = (s: PrinterConnState): string => (s === "connected" ? t.rd_ps_connected : s === "saved" ? t.rd_ps_bt_saved_state : s === "checking" ? t.rd_ps_checking : t.rd_ps_disconnected);
  const stateColor = (s: PrinterConnState): string => (s === "connected" || s === "saved" ? "var(--ok)" : s === "checking" ? "var(--warn)" : "var(--text-muted)");

  // ── Channels card = clean DISPLAY (A). Each row shows the platform, first saved
  // account handle, and live connection status; tapping opens the Manage screen (C),
  // where the seller edits/saves accounts. No account writes happen here.
  const channelRow = (platform: "tiktok" | "facebook") => {
    const isTT = platform === "tiktok";
    const accts = accountList(account?.profile[isTT ? "tiktok" : "facebook"] || "");
    const connected = !!account?.connectedAccounts.includes(isTT ? "TikTok" : "Facebook");
    const handle = accts[0] || "";
    return (
      <button onClick={() => onManageChannel?.(platform)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 14, border: "none", borderBottom: isTT ? "1px solid var(--border)" : "none", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}>
        <div className="sfl-anim-heart" style={{ width: 38, height: 38, borderRadius: 11, background: isTT ? "#000" : "#1877f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: isTT ? 15 : 17, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: isTT ? undefined : "var(--font-display)" }}>{isTT ? "t" : "f"}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{isTT ? t.rd_ch_tiktok_live : t.rd_ch_facebook_live}</div>
          {handle && <div style={{ fontSize: 11.5, fontWeight: 600, color: "var(--handle)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{isTT ? `@${handle.replace(/^@/, "")}` : handle}</div>}
        </div>
        <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 700, color: connected ? "var(--ok)" : "var(--text-muted)" }}><span style={{ width: 7, height: 7, borderRadius: "50%", background: connected ? "var(--ok)" : "var(--text-muted)" }} />{connected ? t.rd_ch_connected : t.rd_ch_not_connected}</span>
        <span style={{ fontSize: 16, color: "var(--text-muted)", marginLeft: 2 }}>›</span>
      </button>
    );
  };
  return (
    <div>
      <div style={headerBar}><div className="sfl-anim-beat" style={headerTitle}>{t.rd_set_title}</div></div>
      <div style={{ padding: "14px 14px 22px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* PROFILE (appears once) */}
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{ width: 54, height: 54, borderRadius: 16, background: "#f59e0b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 800, color: "#fff", fontFamily: "var(--font-display)" }}>{pAvatar}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{pShop}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--handle)" }}>{pHandle}</div>
              {!isIOS() && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{pPlanLine}</div>}
            </div>
            <button onClick={onToggleProfile} style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-fg)", background: "var(--accent-soft)", border: "none", padding: "8px 12px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{profileOpen ? t.rd_set_close : t.rd_set_edit}</button>
          </div>
          {profileOpen && (
            <div style={{ marginTop: 15, paddingTop: 15, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, letterSpacing: ".1em", fontWeight: 800, color: "var(--text-muted)", marginBottom: 13 }}>{t.rd_set_basic_info}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div><label style={label}>{t.rd_set_shop_name}</label><input value={form.storeName} onChange={(e) => setField("storeName", e.target.value)} style={input} /></div>
                <div><label style={label}>{t.rd_set_owner_name}</label><input value={form.fullName} onChange={(e) => setField("fullName", e.target.value)} style={input} /></div>
                {/* Phone on its OWN full-width row — the picker + number input need the full width so a 10–11 digit number stays fully visible on mobile (was clipped in a 50/50 split). */}
                <div><label style={label}>{t.rd_set_phone}</label><CountryPhoneField value={form.phone} onChange={(v) => setField("phone", v)} country={phoneCountry} onCountryChange={pickPhoneCountry} lang={lang} invalid={phoneChangedInvalid} hint={t.rd_su_err_phone} countryLabel={t.rd_ph_country} searchLabel={t.rd_ph_search} /></div>
                {/* Username handle moved to the Channels editor (sole account writer). */}
                {/* Email is identity — changing it needs the secure server step (production blocks it too). */}
                <div><label style={label}>{t.rd_set_email}</label><input value={pEmail} disabled style={{ ...input, opacity: 0.6 }} /></div>
              </div>
              {saveState === "error" && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--danger)", marginTop: 10 }}>{saveErr}</div>}
              {saveState === "saved" && <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ok)", marginTop: 10 }}>{t.rd_set_saved}</div>}
              <button onClick={handleSaveProfile} disabled={saveState === "saving"} style={{ width: "100%", marginTop: 12, padding: "12px 0", border: "none", borderRadius: 12, background: "var(--accent)", color: "var(--accent-text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 700, cursor: saveState === "saving" ? "default" : "pointer", opacity: saveState === "saving" ? 0.7 : 1, boxShadow: "0 4px 14px var(--accent-soft)" }}>{saveState === "saving" ? t.rd_set_saving : t.rd_set_save_changes}</button>
            </div>
          )}
        </div>

        {/* LAPTOP AUTO-PRINT setup — admin + kiosk allowlist ONLY. Silent per-order
            printing on a laptop needs Chrome/Edge launched with --kiosk-printing (a
            browser launch flag, not an app setting) + the label printer set as
            default. The WHOLE card (label, steps, command + Copy button, Mac note)
            is gated on canSeeKioskLauncher — admins + KIOSK_LAUNCHER_EMAILS (the one
            place to widen it, e.g. add a PH seller later). Not eligible → no card at
            all, on BOTH web and phone. */}
        {canSeeKioskLauncher(account) && (
          <div>
            <div className="sfl-anim-textglow" style={sectionLabel}>{t.rd_wp_setup_label}</div>
            <div style={card}>
              <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text)", marginBottom: 6 }}>{t.rd_wp_setup_title}</div>
              <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5, whiteSpace: "pre-line" }}>{t.rd_wp_setup_body}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.5, marginTop: 8, fontFamily: "var(--font-mono)", wordBreak: "break-all" }}>{t.rd_wp_setup_tip}</div>
              {/* Kiosk COMMAND (copy-to-clipboard). A pasted command beats a downloaded
                  .bat: Windows 11 Smart App Control blocks .bat files, but a pasted
                  command has no file → no block. The read-only input is the manual-copy
                  fallback (and transparency) if the clipboard API is unavailable. */}
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.55, whiteSpace: "pre-line", marginBottom: 10 }}>{t.rd_wp_cmd_steps}</div>
                <input
                  readOnly value={KIOSK_COMMAND_WINDOWS}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={t.rd_wp_cmd_label}
                  style={{ width: "100%", boxSizing: "border-box", fontFamily: "var(--font-mono)", fontSize: 11, padding: "8px 10px", border: "1px solid var(--border-strong)", borderRadius: 8, background: "var(--surface-2)", color: "var(--text)", marginBottom: 8 }}
                />
                <button onClick={copyKioskCommand} style={{ fontSize: 12, fontWeight: 800, color: "var(--accent-text)", background: "var(--accent)", border: "none", padding: "9px 16px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{kioskCopied ? t.rd_wp_cmd_copied : t.rd_wp_cmd_btn}</button>
                <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5, marginTop: 10, whiteSpace: "pre-line", wordBreak: "break-word" }}>{tpl(t.rd_wp_cmd_mac, { cmd: KIOSK_COMMAND_MAC })}</div>
              </div>
            </div>
          </div>
        )}
        {/* LIVE SESSION — collapsible group (compact row like the LIVE print pattern row) */}
        <div>
          <div className="sfl-anim-textglow" style={sectionLabel}>{t.rd_set_live_session}</div>
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <button type="button" onClick={toggleLiveOpen} data-testid="ls-header" style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 14, border: "none", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-fg)", flexShrink: 0 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" fill="currentColor" /><circle cx="12" cy="12" r="8.2" stroke="currentColor" strokeWidth="1.7" opacity=".55" /></svg></div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={rowTitle}>{t.rd_set_ls_title}</div><div style={{ ...rowSub, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{lsSummary}</div></div>
              <span style={{ color: "var(--text-muted)", fontSize: 13, transition: "transform .2s", transform: liveOpen ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0, display: "inline-block" }}>▾</span>
            </button>
            {liveOpen && (<div data-testid="ls-body" className="sfl-ls-rows" style={{ borderTop: "1px solid var(--border)" }}>
            {/* 1. LIVE print pattern — title + chevron (first, so the toggle rows below are consecutive) */}
            {/* border reset per-side: a `border` shorthand after the lsRow spread would wipe its borderBottom */}
            <button type="button" onClick={onPrintPattern} data-testid="ls-print-pattern" style={{ ...lsRow, width: "100%", borderTop: 0, borderLeft: 0, borderRight: 0, background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}>
              <span style={lsLabel}>{t.rd_set_live_pattern}</span>
              <span style={{ color: "var(--text-muted)", fontSize: 18, lineHeight: 1, flexShrink: 0 }}>›</span>
            </button>
            {/* 2. Keep screen awake while live */}
            <div style={lsRow}>
              <span style={lsLabel}>{t.rd_set_keepawake}</span>
              <LsToggle on={keepAwake} title={t.rd_set_keepawake} testId="ls-tg-awake" onClick={() => lsToggle("awake", keepAwake)} />
            </div>
            {/* 3. Auto-print pinned comments — DOGFOOD GATE: the handler is passed only
                for allowlisted accounts (absent handler = no row, zero change). */}
            {onTogglePinPrint && <div style={lsRow}>
              <span style={lsLabel}>{t.rd_set_pinprint}</span>
              <LsToggle on={pinPrint} title={t.rd_set_pinprint} testId="ls-tg-pin" onClick={() => lsToggle("pin", pinPrint)} />
            </div>}
            {/* 4. Auto mode — plain title + toggle (codes live on each product; the
                low-stock threshold moved to the Products screen). */}
            <div style={lsRow}>
              <span style={lsLabel}>{t.rd_set_auto_mode}</span>
              <LsToggle on={auto.detect} title={t.rd_set_auto_mode} testId="ls-tg-auto" onClick={() => lsToggle("auto", auto.detect)} />
            </div>
            {/* 5. Same price for all items — "NT$199" when ON, "NT$199 saved" when OFF with a remembered price */}
            {onSetSamePriceEnabled && (
              <div style={lsRow} data-testid="samePrice-row">
                <span style={lsLabel}>{t.rd_smp_row_title}</span>
                {spRowVal && <span style={lsVal} data-testid="samePrice-val">{spRowVal}</span>}
                <LsToggle on={samePriceEnabled} title={t.rd_smp_row_title} testId="samePrice-toggle" onClick={() => lsToggle("sp", samePriceEnabled)} />
              </div>
            )}
            {samePriceError > 0 && <div style={{ padding: "0 14px 12px", fontSize: 11, color: "var(--danger)" }} data-testid="samePrice-error">{t.rd_smp_error}</div>}
            </div>)}
          </div>
          {/* Centered explainer modal (portaled) — opens only when a Live-session toggle is turned ON */}
          {modalKey && (
            <LiveSettingModal open={modalOpen} icon={MODAL[modalKey].icon} title={MODAL[modalKey].title} text={MODAL[modalKey].text}
              primaryLabel={t.rd_lss_turn_on} primaryDisabled={modalKey === "sp" && !spValid} onPrimary={turnOn}
              cancelLabel={t.rd_sp_cancel} onCancel={closeModal}>
              {modalKey === "sp" && (
                <>
                  <div className="sfl-lsm-field">
                    <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)", fontSize: 14 }}>{cur}</span>
                    <input ref={spInputRef} inputMode="numeric" autoComplete="off" value={spDraft} placeholder={t.rd_smp_placeholder}
                      onChange={(e) => setSpDraft(e.target.value.replace(/[^0-9.]/g, ""))}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); turnOn(); } }}
                      data-testid="samePrice-input"
                      style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600, color: "var(--text)", outline: "none", padding: 0 }} />
                  </div>
                  <div data-testid="lsm-sp-hint" style={{ fontSize: 12, color: spErr ? "var(--danger)" : "var(--text-muted)", minHeight: 16, marginBottom: 10 }}>{spErr ? t.rd_lss_sp_err : t.rd_lss_sp_hint}</div>
                </>
              )}
            </LiveSettingModal>
          )}
        </div>

        {/* APPEARANCE — real theme + accent control */}
        <div>
          <div className="sfl-anim-textglow" style={sectionLabel}>{t.rd_set_appearance}</div>
          <div style={{ ...card, padding: 13 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", marginBottom: 7 }}>{t.rd_set_theme}</div>
            <div style={{ display: "flex", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 11, padding: 4, gap: 4, marginBottom: 13 }}>
              <button onClick={() => onSetTheme("light")} style={seg(theme === "light")}>{t.rd_set_light}</button>
              <button onClick={() => onSetTheme("dark")} style={seg(theme === "dark")}>{t.rd_set_dark}</button>
            </div>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)", marginBottom: 9 }}>{t.rd_set_accent_color}</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 13 }}>
              {ACCENT_ORDER.map((k) => {
                const on = k === accent;
                return (
                  <button key={k} onClick={() => onSetAccent(k)} title={ACCENTS[k].name} style={{ width: 36, height: 36, borderRadius: 11, cursor: "pointer", background: ACCENTS[k].base, border: `${on ? "3px" : "1.5px"} solid ${on ? "var(--accent)" : "var(--border-strong)"}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, color: "#fff", outline: "none" }}>{on ? "✓" : ""}</button>
                );
              })}
            </div>
            {/* F-batch #2: the "Readable @handles" row was a STATIC div dressed
                as a toggle (always-on, wired to nothing, demo @maria_shops
                handle) — removed rather than faked. */}
            {/* MOTION toggle — pause looping animations (kill switch). Same pill
                pattern as keep-awake; RedesignApp sets [data-motion]. One-shot
                entrances are not gated.
                ⚠️ INTENTIONALLY HIDDEN (Jeff, pending a perf trigger). All the
                plumbing stays live — the [data-motion] root attr, sfl_rd_motion
                persistence, the state/handler, the CSS [data-motion="off"] kill
                switch, and prefers-reduced-motion. Motion defaults ON. To RE-SHOW
                the row: flip SHOW_MOTION_TOGGLE (module scope, top of file) to
                true. Do NOT delete this block. */}
            {SHOW_MOTION_TOGGLE && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, paddingTop: 12, marginTop: 1, borderTop: "1px solid var(--border)" }}>
              <span style={{ flex: 1 }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_set_motion}</span>
                <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{t.rd_set_motion_desc}</span>
              </span>
              <button onClick={onToggleMotion} title={t.rd_set_motion} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}>
                <span style={{ width: 44, height: 26, borderRadius: 13, background: motionOn ? "var(--accent)" : "var(--border-strong)", position: "relative", display: "block", transition: "background .15s" }}>
                  <span style={{ position: "absolute", top: 3, left: motionOn ? 21 : 3, width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "left .15s" }} />
                </span>
              </button>
            </div>
            )}
            {/* Language — inline accordion (dc.html v3 L686) */}
            <div style={{ paddingTop: 12, marginTop: 12, borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_set_language}</div>
                <button onClick={() => { setApLangOpen((o) => !o); setApCurOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "var(--accent-fg)", background: "var(--accent-soft)", border: "none", padding: "6px 11px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)", minWidth: 150, justifyContent: "space-between" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>{curLang.flag} {curLang.label}</span>
                  <span style={{ fontSize: 9, transition: "transform .2s", transform: apLangOpen ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}>▾</span>
                </button>
              </div>
              {apLangOpen && (
                <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 11, overflow: "hidden" }}>
                  {LANGS.map((l) => {
                    const on = l.code === lang;
                    return (
                      <button key={l.code} onClick={() => { onSetLang(l.code); setApLangOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "none", borderBottom: "1px solid var(--border)", background: on ? "var(--accent-softer)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}>
                        <span style={{ fontSize: 15 }}>{l.flag}</span>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{l.label}</span>
                        <span style={{ color: "var(--accent-fg)", fontWeight: 800, fontSize: 13, width: 12 }}>{on ? "✓" : ""}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
            {/* Currency — inline accordion (dc.html v3 L706) */}
            <div style={{ paddingTop: 12, marginTop: 12, borderTop: "1px solid var(--border)" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <div><div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_set_currency}</div><div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{t.rd_set_currency_sub}</div></div>
                <button onClick={() => { setApCurOpen((o) => !o); setApLangOpen(false); }} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, fontWeight: 700, color: "var(--accent-fg)", background: "var(--accent-soft)", border: "none", padding: "6px 11px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)", minWidth: 150, justifyContent: "space-between" }}>
                  <span style={{ fontFamily: "var(--font-mono)" }}>{currency} {CURRENCIES[currency] || "$"}</span>
                  <span style={{ fontSize: 9, transition: "transform .2s", transform: apCurOpen ? "rotate(180deg)" : "rotate(0deg)", display: "inline-block" }}>▾</span>
                </button>
              </div>
              {apCurOpen && (
                <div style={{ marginTop: 8, border: "1px solid var(--border)", borderRadius: 11, overflow: "hidden" }}>
                  {CURRENCY_ORDER.map((code) => {
                    const on = code === currency;
                    return (
                      <button key={code} onClick={() => { onSetCurrency(code); setApCurOpen(false); }} style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", border: "none", borderBottom: "1px solid var(--border)", background: on ? "var(--accent-softer)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: 14, fontWeight: 700, color: "var(--accent-fg)", width: 30 }}>{CURRENCIES[code]}</span>
                        <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{code}</span>
                        <span style={{ color: "var(--accent-fg)", fontWeight: 800, fontSize: 13, width: 12 }}>{on ? "✓" : ""}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* CHANNELS — clean display card (A); each row → Manage screen (C) */}
        <div>
          <div className="sfl-anim-textglow" style={sectionLabel}>{t.rd_set_channels}</div>
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            {channelsV2 && onOpenChannel
              ? <ChannelsList account={account} ttLive={channelsInfo?.ttLive ?? null} showShopee={!!channelsInfo?.showShopee} shopeeName={channelsInfo?.shopeeName} shopeeConnected={channelsInfo?.shopeeConnected} onOpen={onOpenChannel} />
              : <>{channelRow("tiktok")}{channelRow("facebook")}</>}
          </div>
        </div>

        {/* PRINTER & DISPLAY */}
        <div ref={printerRef}>
          <div className="sfl-anim-textglow" style={sectionLabel}>{t.rd_set_printer_display}</div>
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <button onClick={onTogglePrinter} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 14, border: "none", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)", borderBottom: "1px solid var(--border)" }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-fg)", flexShrink: 0 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="6" y="3" width="12" height="6" stroke="currentColor" strokeWidth="1.7" /><rect x="4" y="9" width="16" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" /><rect x="7" y="15" width="10" height="6" stroke="currentColor" strokeWidth="1.7" /></svg></div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={rowTitle}>{t.rd_set_printer}</div><div style={{ fontSize: 11.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{printer.name} · {printer.meta}</div></div>
              <span style={{ color: "var(--text-muted)", fontSize: 13, transition: "transform .2s", transform: printerOpen ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0, display: "inline-block" }}>▾</span>
            </button>
            {printerOpen && (
              <div style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)", padding: 7 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em", color: "var(--text-muted)", padding: "6px 9px 8px" }}>{t.rd_set_choose_printer}</div>
                {printerSlots.map((p, i) => {
                  const on = i === printerSlotIdx;
                  const st = slotState(i);
                  return (
                    <button key={p.name} onClick={() => onPickPrinter(i, slotSetUp(i))} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: 10, border: "none", borderRadius: 10, background: on ? "var(--accent-softer)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}>
                      <span style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${on ? "var(--accent)" : "var(--border-strong)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: on ? "var(--accent)" : "transparent" }} /></span>
                      <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{p.name}</span><span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>{p.meta}</span></span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: stateColor(st), flexShrink: 0 }}>{stateLabel(st)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ACCOUNT */}
        <div>
          <div className="sfl-anim-textglow" style={sectionLabel}>{t.rd_set_account}</div>
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            {!isIOS() && <button onClick={onSubscription} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 14, border: "none", borderBottom: "1px solid var(--border)", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}><span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_sub_title}</span><span style={{ fontSize: 12, color: "var(--text-muted)" }}>{pSubRow}</span></button>}
            <button onClick={onSupport} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 14, border: "none", borderBottom: "1px solid var(--border)", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}><span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_set_support_guide}</span><span style={{ fontSize: 16, color: "var(--text-muted)" }}>›</span></button>
            <button onClick={onDelete} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 14, border: "none", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}><span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: "var(--danger)" }}>{t.rd_del_title}</span><span style={{ fontSize: 16, color: "var(--danger)" }}>›</span></button>
          </div>
        </div>

      </div>
    </div>
  );
}
