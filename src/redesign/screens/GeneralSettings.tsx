// Screen 6b — General Settings. dc.html v2 L463–645.
// Profile (ONCE) · Live session auto-detect card (per v2, here) · Appearance
// (REAL theme + accent control — replaces the old floating toggle) · Channels ·
// Printer & display · Account links. Visual/sample only; theme+accent drive the
// redesign preview state.
import { useEffect, useState, type CSSProperties } from "react";
import { ACCENT_ORDER, ACCENTS, PRINTERS, LANGS, CURRENCIES, CURRENCY_ORDER, type ThemeMode, type AccentKey, type AutoControls } from "../data";
import { headerBar, headerTitle, card, sectionLabel } from "../ui";
import { profileToDisplay, planLabel, renewLabel } from "../adapters/useAuthSession";
import type { AccountUser } from "../../accountDb";
import SoonBadge from "../components/SoonBadge";
import { useT, tpl } from "../i18n";
import { accountList } from "../adapters/connect";

const label: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "var(--text-dim)", display: "block", marginBottom: 5 };
const input: CSSProperties = { width: "100%", padding: "11px 13px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13.5, fontWeight: 600, outline: "none" };
const rowTitle: CSSProperties = { fontSize: 13.5, fontWeight: 700, color: "var(--text)" };
const rowSub: CSSProperties = { fontSize: 11.5, color: "var(--text-muted)" };

export default function GeneralSettings({
  theme, accent, onSetTheme, onSetAccent,
  auto, cur, lang, onSetLang, currency, onSetCurrency,
  profileOpen, onToggleProfile,
  printerIdx, printerOpen, onTogglePrinter, onPickPrinter, onPrintPattern,
  onSubscription, onSupport, onDelete,
  account = null, onSaveProfile, onManageChannel,
}: {
  theme: ThemeMode; accent: AccentKey; onSetTheme: (t: ThemeMode) => void; onSetAccent: (a: AccentKey) => void;
  auto: AutoControls; cur: string;
  lang: string; onSetLang: (c: string) => void; currency: string; onSetCurrency: (c: string) => void;
  profileOpen: boolean; onToggleProfile: () => void;
  printerIdx: number; printerOpen: boolean; onTogglePrinter: () => void; onPickPrinter: (i: number) => void; onPrintPattern: () => void;
  onSubscription: () => void; onSupport: () => void; onDelete: () => void;
  account?: AccountUser | null; // Phase 5a: real signed-in profile (null → demo fallback)
  // Phase 5i — real self-edit save (upsertUser → seller_profiles). Profile card writes
  // ONLY name/store/phone — NOT tiktok/facebook (the Channels editor is the sole account writer).
  onSaveProfile?: (fields: { fullName: string; storeName: string; phone: string }) => Promise<{ ok: boolean; error?: string }>;
  // Channels card is DISPLAY-only here; tapping a row opens the Manage screen (C).
  onManageChannel?: (platform: "tiktok" | "facebook") => void;
}) {
  const t = useT();
  const [apLangOpen, setApLangOpen] = useState(false);
  const [apCurOpen, setApCurOpen] = useState(false);
  const curLang = LANGS.find((l) => l.code === lang) || LANGS[0];

  // Phase 5i — controlled profile-edit form, initialized from the real profile and
  // re-synced when it changes (e.g. after a save reload). Only user-editable fields.
  const [form, setForm] = useState({ fullName: "", storeName: "", phone: "" });
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
  const handleSaveProfile = async () => {
    if (!onSaveProfile || saveState === "saving") return;
    if (!form.fullName.trim() || !form.storeName.trim()) { setSaveState("error"); setSaveErr(t.rd_set_err_required); return; }
    setSaveState("saving"); setSaveErr("");
    // ⚠️ name/store/phone ONLY — never tiktok/facebook (Channels editor owns accounts).
    const r = await onSaveProfile({
      fullName: form.fullName.trim(),
      storeName: form.storeName.trim(),
      phone: form.phone.trim(),
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
  const autoLabel = auto.detect ? t.rd_set_auto_detect : t.rd_set_manual_mode;
  const autoLabelColor = auto.detect ? "var(--accent-fg)" : "var(--text-muted)";
  const autoTrack = auto.detect ? "var(--accent)" : "var(--border-strong)";
  const autoKnobLg = auto.detect ? 21 : 3;
  const autoChevron = auto.setupOpen ? "rotate(180deg)" : "rotate(0deg)";
  const seg = (active: boolean): CSSProperties => ({ flex: 1, padding: "9px 0", border: "none", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 700, ...(active ? { background: "var(--accent)", color: "#fff" } : { background: "transparent", color: "var(--text-dim)" }) });
  const printer = PRINTERS[printerIdx];

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
        <div style={{ width: 38, height: 38, borderRadius: 11, background: isTT ? "#000" : "#1877f2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: isTT ? 15 : 17, fontWeight: 800, color: "#fff", flexShrink: 0, fontFamily: isTT ? undefined : "var(--font-display)" }}>{isTT ? "t" : "f"}</div>
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
      <div style={headerBar}><div style={headerTitle}>{t.rd_set_title}</div></div>
      <div style={{ padding: "14px 14px 22px", display: "flex", flexDirection: "column", gap: 16 }}>

        {/* PROFILE (appears once) */}
        <div style={card}>
          <div style={{ display: "flex", alignItems: "center", gap: 13 }}>
            <div style={{ width: 54, height: 54, borderRadius: 16, background: "#f59e0b", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 19, fontWeight: 800, color: "#fff", fontFamily: "var(--font-display)" }}>{pAvatar}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text)" }}>{pShop}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--handle)" }}>{pHandle}</div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{pPlanLine}</div>
            </div>
            <button onClick={onToggleProfile} style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-fg)", background: "var(--accent-soft)", border: "none", padding: "8px 12px", borderRadius: 9, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{profileOpen ? t.rd_set_close : t.rd_set_edit}</button>
          </div>
          {profileOpen && (
            <div style={{ marginTop: 15, paddingTop: 15, borderTop: "1px solid var(--border)" }}>
              <div style={{ fontSize: 11, letterSpacing: ".1em", fontWeight: 800, color: "var(--text-muted)", marginBottom: 13 }}>{t.rd_set_basic_info}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <div><label style={label}>{t.rd_set_shop_name}</label><input value={form.storeName} onChange={(e) => setField("storeName", e.target.value)} style={input} /></div>
                <div style={{ display: "flex", gap: 9 }}>
                  <div style={{ flex: 1, minWidth: 0 }}><label style={label}>{t.rd_set_owner_name}</label><input value={form.fullName} onChange={(e) => setField("fullName", e.target.value)} style={input} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}><label style={label}>{t.rd_set_phone}</label><input value={form.phone} onChange={(e) => setField("phone", e.target.value)} style={{ ...input, fontFamily: "var(--font-mono)", fontSize: 13 }} /></div>
                </div>
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

        {/* LIVE SESSION — auto-detect (per v2, lives here) */}
        <div>
          <div style={sectionLabel}>{t.rd_set_live_session}</div>
          <div style={card}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <button onClick={auto.toggleSetup} style={{ flex: 1, display: "flex", alignItems: "flex-start", gap: 9, background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: 0, fontFamily: "var(--font-ui)" }}>
                <span style={{ flex: 1 }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{t.rd_set_auto_mode} <SoonBadge /></span>
                  <span style={{ display: "block", fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }}>{t.rd_set_auto_desc}</span>
                </span>
                <span style={{ color: "var(--text-muted)", fontSize: 12, marginTop: 1, transition: "transform .2s", transform: autoChevron, display: "inline-block" }}>▾</span>
              </button>
              <button onClick={auto.toggle} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, flexShrink: 0 }}>
                <span style={{ width: 44, height: 26, borderRadius: 13, background: autoTrack, position: "relative", display: "block", transition: "background .15s" }}>
                  <span style={{ position: "absolute", top: 3, left: autoKnobLg, width: 20, height: 20, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.3)", transition: "left .15s" }} />
                </span>
              </button>
            </div>
            {auto.setupOpen && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "var(--text)" }}>{t.rd_set_trigger_sets}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>{auto.words.length} / 20</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.45, marginBottom: 11 }}>{t.rd_set_auto_help_pre}<span style={{ color: "var(--accent-fg)", fontWeight: 700 }}>{t.rd_set_auto_help_eg}</span>{tpl(t.rd_set_auto_help_post, { cur })}</div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {auto.words.map((w, i) => (
                    <span key={w.word} style={{ display: "flex", alignItems: "center", gap: 7, background: "var(--accent-soft)", border: "1px solid var(--accent)", color: "var(--accent-fg)", padding: "6px 8px 6px 11px", borderRadius: 9, fontSize: 12, fontWeight: 700 }}>{w.word}<span style={{ fontFamily: "var(--font-mono)", fontWeight: 700, opacity: 0.85 }}>{cur}{w.price}</span><button onClick={() => auto.removeWord(i)} title={t.rd_set_remove} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent-fg)", fontSize: 15, lineHeight: 1, padding: 0, display: "flex", alignItems: "center" }}>×</button></span>
                  ))}
                  {auto.words.length < 20 && (
                    <input value={auto.input} onChange={(e) => auto.setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); auto.addWord(); } }} placeholder={t.rd_set_word_ph} style={{ background: "transparent", border: "1.3px dashed var(--border-strong)", color: "var(--text)", padding: "6px 11px", borderRadius: 9, fontSize: 12, fontWeight: 700, fontFamily: "var(--font-ui)", outline: "none", width: 188 }} />
                  )}
                </div>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: autoLabelColor }} />
              <span style={{ fontSize: 11.5, fontWeight: 700, color: autoLabelColor }}>{autoLabel}</span>
              <span style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{t.rd_set_currently_active}</span>
            </div>
          </div>
        </div>

        {/* APPEARANCE — real theme + accent control */}
        <div>
          <div style={sectionLabel}>{t.rd_set_appearance}</div>
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
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 12, borderTop: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_set_readable}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1 }}>{t.rd_set_readable_sub_pre}<span style={{ color: "var(--handle)", fontWeight: 700 }}>@maria_shops</span></div>
              </div>
              <div style={{ width: 44, height: 26, borderRadius: 13, background: "var(--accent)", position: "relative", flexShrink: 0 }}><div style={{ width: 20, height: 20, borderRadius: "50%", background: "#fff", position: "absolute", top: 3, right: 3, boxShadow: "0 1px 3px rgba(0,0,0,.3)" }} /></div>
            </div>
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
          <div style={sectionLabel}>{t.rd_set_channels}</div>
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            {channelRow("tiktok")}
            {channelRow("facebook")}
          </div>
        </div>

        {/* PRINTER & DISPLAY */}
        <div>
          <div style={sectionLabel}>{t.rd_set_printer_display}</div>
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <button onClick={onTogglePrinter} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 14, border: "none", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)", borderBottom: "1px solid var(--border)" }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-fg)", flexShrink: 0 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="6" y="3" width="12" height="6" stroke="currentColor" strokeWidth="1.7" /><rect x="4" y="9" width="16" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" /><rect x="7" y="15" width="10" height="6" stroke="currentColor" strokeWidth="1.7" /></svg></div>
              <div style={{ flex: 1, minWidth: 0 }}><div style={rowTitle}>{t.rd_set_printer}</div><div style={{ fontSize: 11.5, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{printer.name} · {printer.meta}</div></div>
              <span style={{ color: "var(--text-muted)", fontSize: 13, transition: "transform .2s", transform: printerOpen ? "rotate(180deg)" : "rotate(0deg)", flexShrink: 0, display: "inline-block" }}>▾</span>
            </button>
            {printerOpen && (
              <div style={{ background: "var(--surface-2)", borderBottom: "1px solid var(--border)", padding: 7 }}>
                <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: ".1em", color: "var(--text-muted)", padding: "6px 9px 8px" }}>{t.rd_set_choose_printer}</div>
                {PRINTERS.map((p, i) => {
                  const on = i === printerIdx;
                  return (
                    <button key={p.name} onClick={() => onPickPrinter(i)} style={{ width: "100%", display: "flex", alignItems: "center", gap: 11, padding: 10, border: "none", borderRadius: 10, background: on ? "var(--accent-softer)" : "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}>
                      <span style={{ width: 20, height: 20, borderRadius: "50%", border: `2px solid ${on ? "var(--accent)" : "var(--border-strong)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><span style={{ width: 10, height: 10, borderRadius: "50%", background: on ? "var(--accent)" : "transparent" }} /></span>
                      <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "var(--text)" }}>{p.name}</span><span style={{ display: "block", fontSize: 11, color: "var(--text-muted)" }}>{p.meta}</span></span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: p.status === "Ready" ? "var(--ok)" : "var(--text-muted)", flexShrink: 0 }}>{p.status}</span>
                    </button>
                  );
                })}
              </div>
            )}
            <button onClick={onPrintPattern} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 14, border: "none", borderTop: "1px solid var(--border)", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}>
              <div style={{ width: 36, height: 36, borderRadius: 10, background: "var(--accent-soft)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent-fg)", flexShrink: 0 }}><svg width="20" height="20" viewBox="0 0 24 24" fill="none"><rect x="6" y="3" width="12" height="6" stroke="currentColor" strokeWidth="1.7" /><rect x="4" y="9" width="16" height="8" rx="2" stroke="currentColor" strokeWidth="1.7" /><rect x="7" y="14" width="10" height="7" stroke="currentColor" strokeWidth="1.7" /></svg></div>
              <div style={{ flex: 1 }}><div style={rowTitle}>{t.rd_set_live_pattern}</div><div style={rowSub}>{t.rd_set_pattern_sub}</div></div>
              <span style={{ fontSize: 16, color: "var(--text-muted)" }}>›</span>
            </button>
          </div>
        </div>

        {/* ACCOUNT */}
        <div>
          <div style={sectionLabel}>{t.rd_set_account}</div>
          <div style={{ ...card, padding: 0, overflow: "hidden" }}>
            <button onClick={onSubscription} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 14, border: "none", borderBottom: "1px solid var(--border)", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}><span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_sub_title}</span><span style={{ fontSize: 12, color: "var(--text-muted)" }}>{pSubRow}</span></button>
            <button onClick={onSupport} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 14, border: "none", borderBottom: "1px solid var(--border)", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}><span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: "var(--text)" }}>{t.rd_set_support_guide}</span><span style={{ fontSize: 16, color: "var(--text-muted)" }}>›</span></button>
            <button onClick={onDelete} style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: 14, border: "none", background: "transparent", cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)" }}><span style={{ flex: 1, fontSize: 13.5, fontWeight: 700, color: "var(--danger)" }}>{t.rd_del_title}</span><span style={{ fontSize: 16, color: "var(--danger)" }}>›</span></button>
          </div>
        </div>

      </div>
    </div>
  );
}
