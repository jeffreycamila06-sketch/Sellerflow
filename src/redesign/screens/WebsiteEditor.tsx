// Seller Website — the editor (Settings → Website). Draft vs published: Save keeps a draft (any
// plan); Publish copies it live (website_publish — the database refuses Free / expired). Free sees
// "Upgrade to publish your website"; on iOS the Publish button is locked with no price or plan name,
// and the own-domain (Master) row is hidden (App Store rule). Preview = the real shop pages with the
// draft, in memory (no network, no order can be placed).
import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { headerBar, headerTitle, card } from "../ui";
import { useT, tpl } from "../i18n";
import { HeaderWithBack } from "../components/BackButton";
import type { ShopDesign, ShopProduct, SocialKey, ChatKey } from "../../website/shopApi";
import { SHOP_COLORS } from "../../website/shopStyle";
import { BrandIcon, type BrandKey } from "../../website/brandIcons";
import { shopUrl } from "../../website/route";
import { productImageUrl } from "../adapters/productImages";
import { subdomainProblem, suggestSubdomain, planCanPublish, isMasterPlan, type MyWebsite, type WebsiteSettings } from "../adapters/websiteSeller";
import { previewShop, hasUnpublished, DEFAULT_SETTINGS } from "../adapters/websiteEditor";
import { realEditorApi, type EditorApi } from "../adapters/websiteEditorApi";

const ShopApp = lazy(() => import("../../website/ShopApp"));

const SOCIALS: SocialKey[] = ["facebook", "instagram", "tiktok", "youtube", "x", "threads", "shopee"];
const SOCIAL_NAME: Record<SocialKey, string> = { facebook: "Facebook", instagram: "Instagram", tiktok: "TikTok", youtube: "YouTube", x: "X", threads: "Threads", shopee: "Shopee" };
const CHATS: ChatKey[] = ["messenger", "line", "whatsapp", "instagram"];
const CHAT_NAME: Record<ChatKey, string> = { messenger: "Messenger", line: "LINE", whatsapp: "WhatsApp", instagram: "Instagram DM" };
const SECTIONS = ["announcement", "live", "categories", "about", "policy", "socials"] as const;

export default function WebsiteEditor({ onBack, onPayShip, onUpgrade, ios, plan, planStatus, planExpiry, country = "TW", onToast, api = realEditorApi, nowMs }: {
  onBack?: () => void; onPayShip: () => void; onUpgrade?: () => void; ios: boolean;
  plan?: string; planStatus?: string; planExpiry?: string | null; country?: string; onToast: (m: string) => void; api?: EditorApi; nowMs?: number;
}) {
  const t = useT() as unknown as Record<string, string>;
  const [site, setSite] = useState<MyWebsite | null | "loading" | "error">("loading");
  const [draft, setDraft] = useState<ShopDesign>({});
  const [sub, setSub] = useState("");
  const [subState, setSubState] = useState<"" | "free" | "taken" | "checking">("");
  const [busy, setBusy] = useState<"" | "save" | "publish" | "logo" | "cover">("");
  const [msg, setMsg] = useState<{ text: string; tone: "ok" | "bad" } | null>(null);
  const [preview, setPreview] = useState<ShopProduct[] | null>(null);
  // Publish feedback: "running" = Publishing… (save + publish), "done" = ✓ Published for PUBLISHED_FLASH_MS
  const [pub, setPub] = useState<"" | "running" | "done">("");
  const [pubUpgrade, setPubUpgrade] = useState(false);
  useEffect(() => {
    if (pub !== "done") return;
    const id = setTimeout(() => setPub(""), PUBLISHED_FLASH_MS);
    return () => clearTimeout(id);
  }, [pub]);
  useEffect(() => {
    let live = true;
    void api.load().then((w) => {
      if (!live) return;
      setSite(w === "error" ? "error" : w);
      if (w && w !== "error") { setDraft(w.draft); setSub(w.subdomain); }
    });
    return () => { live = false; };
  }, [api]);
  const exists = !!site && site !== "loading" && site !== "error";
  const published = exists ? (site as MyWebsite).published : null;
  const canPublish = planCanPublish(plan, planStatus, planExpiry, nowMs);
  const subProblem = sub ? subdomainProblem(sub) : "short";
  const set = (p: Partial<ShopDesign>) => setDraft((d) => ({ ...d, ...p }));
  const settings: WebsiteSettings = exists ? (site as MyWebsite).settings : DEFAULT_SETTINGS;
  const changes = hasUnpublished(draft, published);
  const upToDate = !!published && !changes && exists && sub === (site as MyWebsite).subdomain;

  const save = async (o: { quiet?: boolean } = {}): Promise<boolean> => {
    setMsg(null);
    if (!(draft.name || "").trim()) { setMsg({ text: t.rd_wed_need_name, tone: "bad" }); return false; }
    if (subProblem) { setMsg({ text: subText(t, subProblem), tone: "bad" }); return false; }
    setBusy("save");
    const r = await api.save({ subdomain: sub, draft }, exists);
    setBusy("");
    if (r.ok === false) { setMsg({ text: r.reason === "taken" ? t.rd_wed_addr_taken : r.reason === "bad_address" ? t.rd_wed_addr_chars : t.rd_wed_save_failed, tone: "bad" }); if (r.reason === "taken") setSubState("taken"); return false; }
    setSite((s) => (s && s !== "loading" && s !== "error" ? { ...s, subdomain: sub, draft } : { subdomain: sub, draft, published: null, publishedAt: null, settings: DEFAULT_SETTINGS, customDomain: null }));
    if (!o.quiet) setMsg({ text: t.rd_wed_saved, tone: "ok" });
    return true;
  };
  const publish = async () => {
    if (!canPublish || pub === "running") return;
    setPubUpgrade(false);
    setPub("running");
    if (!(await save({ quiet: true }))) { setPub(""); return; }
    setBusy("publish");
    const r = await api.publish();
    setBusy("");
    if (r.ok === false) {
      setPub("");
      const text = r.reason === "upgrade_required" ? (ios ? t.rd_wed_locked : t.rd_wed_upgrade) : r.reason === "not_available" ? t.rd_wed_not_available : t.rd_wed_save_failed;
      setMsg({ text, tone: "bad" });
      setPubUpgrade(r.reason === "upgrade_required" && !ios && !!onUpgrade);
      onToast(text);
      return;
    }
    setSite((s) => (s && s !== "loading" && s !== "error" ? { ...s, published: draft, publishedAt: r.at } : s));
    setMsg(null);
    setPub("done");
    onToast(t.rd_wed_published_ok);
  };
  const checkSub = async () => {
    if (!sub || subProblem) { setSubState(""); return; }
    setSubState("checking");
    const free = await api.subdomainFree(sub);
    setSubState(free === true ? "free" : free === false ? "taken" : "");
  };
  const pic = async (kind: "logo" | "cover", f: File | undefined) => {
    if (!f) return;
    setBusy(kind);
    const path = await api.uploadPicture(kind, f);
    setBusy("");
    if (path) set({ [kind]: path } as Partial<ShopDesign>); else onToast(t.rd_wed_pic_failed);
  };
  const openPreview = async () => { setPreview(await api.loadProducts()); };
  const closePreview = useCallback(() => setPreview(null), []);
  const address = sub && !subProblem ? shopUrl(sub, true).replace(/^https:\/\//, "") : "";
  const fallback = sub && !subProblem ? shopUrl(sub) : "";

  if (site === "loading") return <Frame t={t} onBack={onBack}><div style={{ padding: 30, textAlign: "center", color: "var(--text-muted)" }}>…</div></Frame>;
  if (site === "error") return <Frame t={t} onBack={onBack}><div style={{ ...card, margin: 14, color: "var(--danger)" }}>{t.rd_wor_load_failed}</div></Frame>;

  const input: CSSProperties = { width: "100%", minHeight: 44, borderRadius: 11, border: "1px solid var(--border)", background: "var(--surface-2, var(--surface))", color: "var(--text)", padding: "9px 11px", fontSize: 16, boxSizing: "border-box", fontFamily: "var(--font-ui)" };
  return (
    <Frame t={t} onBack={onBack}>
      <div style={{ padding: "14px 14px 120px", display: "flex", flexDirection: "column", gap: 12, maxWidth: 720, margin: "0 auto" }}>
        {/* address + status + Preview / Publish */}
        <section style={card} data-testid="wed-status">
          <Label text={t.rd_wed_address} />
          <div style={{ display: "flex", alignItems: "center", gap: 6, ...input, padding: "0 11px" }}>
            <input data-testid="wed-sub" value={sub} maxLength={30} placeholder={suggestSubdomain(draft.name || "") || "myshop"} autoCapitalize="none" autoCorrect="off" spellCheck={false}
              onChange={(e) => { setSub(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")); setSubState(""); }} onBlur={() => void checkSub()}
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", color: "var(--text)", fontSize: 16, fontWeight: 700, fontFamily: "var(--font-ui)" }} />
            <span style={{ color: "var(--text-muted)", fontSize: 13.5, flexShrink: 0 }}>.sellerflowlive.com</span>
          </div>
          <div data-testid="wed-sub-state" style={{ fontSize: 12.5, marginTop: 6, fontWeight: 700, color: subState === "free" ? "var(--ok)" : subState === "taken" || (sub && subProblem) ? "var(--danger)" : "var(--text-muted)" }}>
            {sub && subProblem ? subText(t, subProblem) : subState === "free" ? t.rd_wed_addr_free : subState === "taken" ? t.rd_wed_addr_taken : t.rd_wed_addr_chars}
          </div>
          {address && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
              <div data-testid="wed-url" style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, color: "var(--accent-fg)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{address}</div>
              <button type="button" data-testid="wed-copy" style={smallBtn} onClick={() => { void navigator.clipboard?.writeText(`https://${address}`).catch(() => {}); onToast(t.rd_shop_od_copied); }}>{t.rd_shop_od_copy}</button>
            </div>
          )}
          {fallback && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, overflowWrap: "anywhere" }}>{fallback.replace(/^https:\/\//, "")}</div>}
          <div data-testid="wed-state" style={{ marginTop: 12, fontSize: 13, fontWeight: 700, color: published ? "var(--ok)" : "var(--text-muted)" }}>
            {published && !canPublish
              ? <span data-testid="wed-offline" style={{ color: "var(--danger)" }}>{t.rd_wed_status_offline}</span>
              : published ? tpl(t.rd_wed_status_live, { date: fmtDate((site as MyWebsite).publishedAt) }) : t.rd_wed_status_draft}
            {changes && <span style={{ display: "block", color: "var(--warn, #B45309)", marginTop: 2 }}>{t.rd_wed_status_changes}</span>}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button type="button" data-testid="wed-preview" style={{ ...btn, flex: 1, background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }} onClick={() => void openPreview()}>{t.rd_wed_preview}</button>
            {canPublish
              ? pub === "running"
                ? <button type="button" data-testid="wed-publish" data-state="running" style={{ ...btn, flex: 1, opacity: 0.85, cursor: "progress" }} disabled aria-busy="true"><Spinner />{t.rd_wed_publishing}</button>
                : pub === "done"
                  ? <button type="button" data-testid="wed-publish" data-state="done" style={{ ...btn, flex: 1, background: "var(--ok)", color: "#fff", cursor: "default" }} disabled>{t.rd_wed_published_now}</button>
                  : upToDate
                    ? <button type="button" data-testid="wed-publish" data-state="uptodate" style={{ ...btn, flex: 1, background: "var(--surface)", color: "var(--ok)", border: "1px solid var(--ok)", cursor: "default" }} disabled>{t.rd_wed_up_to_date}</button>
                    : <button type="button" data-testid="wed-publish" data-state="ready" style={{ ...btn, flex: 1 }} disabled={!!busy} onClick={() => void publish()}>{t.rd_wed_publish}</button>
              : <button type="button" data-testid="wed-publish-locked" style={{ ...btn, flex: 1, opacity: 0.55, cursor: "not-allowed" }} disabled aria-disabled="true">🔒 {t.rd_wed_publish}</button>}
          </div>
          {!canPublish && (ios
            ? <div data-testid="wed-locked-note" style={noteStyle}>{t.rd_wed_locked}</div>
            : <button type="button" data-testid="wed-upgrade" onClick={onUpgrade} disabled={!onUpgrade} style={{ ...noteStyle, border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: onUpgrade ? "pointer" : "default", color: "var(--accent-fg)", fontWeight: 800 }}>{t.rd_wed_upgrade} {onUpgrade ? "›" : ""}</button>)}
          {msg && <div role="status" data-testid="wed-msg" style={{ marginTop: 10, fontSize: 13, fontWeight: 700, color: msg.tone === "ok" ? "var(--ok)" : "var(--danger)" }}>{msg.text}</div>}
          {pubUpgrade && <button type="button" data-testid="wed-pub-upgrade" onClick={onUpgrade} style={{ ...noteStyle, border: "none", background: "transparent", padding: 0, textAlign: "left", cursor: "pointer", color: "var(--accent-fg)", fontWeight: 800 }}>{t.rd_wed_upgrade_short} ›</button>}
        </section>

        {/* own domain — Master only; hidden on iOS (no plan upsell there) */}
        {!ios && (
          <section style={{ ...card, display: "flex", alignItems: "center", gap: 10 }} data-testid="wed-domain">
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{t.rd_wed_domain}</div>
              <span style={{ fontSize: 11, fontWeight: 800, color: "var(--accent-fg)", background: "var(--accent-soft)", padding: "2px 7px", borderRadius: 999 }}>{t.rd_wed_domain_master}</span>
            </div>
            <button type="button" data-testid="wed-domain-connect" style={{ ...smallBtn, opacity: isMasterPlan(plan) ? 1 : 0.5 }} disabled={!isMasterPlan(plan)} onClick={() => onToast(t.rd_wed_domain_soon)}>{t.rd_wed_domain_connect}</button>
          </section>
        )}

        <button type="button" data-testid="wed-payship" onClick={onPayShip} style={{ ...card, display: "flex", alignItems: "center", gap: 10, cursor: "pointer", textAlign: "left", fontFamily: "var(--font-ui)", color: "var(--text)" }}>
          <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: 14, fontWeight: 800 }}>{t.rd_wed_payship}</span><span style={{ fontSize: 12, color: "var(--text-muted)" }}>{t.rd_wed_payship_sub}</span></span>
          <span aria-hidden="true">›</span>
        </button>

        <Section title={t.rd_wed_look}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <PicField label={t.rd_wed_logo} path={draft.logo} round busy={busy === "logo"} onFile={(f) => void pic("logo", f)} t={t} testid="wed-logo" />
            <PicField label={t.rd_wed_cover} path={draft.cover} busy={busy === "cover"} onFile={(f) => void pic("cover", f)} t={t} testid="wed-cover" />
          </div>
          <Label text={t.rd_wed_color} />
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }} role="radiogroup">
            {SHOP_COLORS.map((c) => <button key={c} type="button" role="radio" aria-checked={(draft.color || SHOP_COLORS[0]) === c} aria-label={c} data-testid={`wed-color-${c.slice(1)}`} onClick={() => set({ color: c })}
              style={{ width: 44, height: 44, borderRadius: 22, background: c, backgroundClip: "padding-box", border: (draft.color || SHOP_COLORS[0]) === c ? "3px solid var(--text)" : "3px solid transparent", cursor: "pointer", color: "#fff", fontSize: 18, fontWeight: 800 }}>{(draft.color || SHOP_COLORS[0]) === c ? "✓" : ""}</button>)}
          </div>
        </Section>

        <Section title={t.rd_wed_info}>
          <Field label={t.rd_wed_name}><input data-testid="wed-name" value={draft.name || ""} maxLength={60} onChange={(e) => set({ name: e.target.value })} style={input} /></Field>
          <Field label={t.rd_wed_tagline}><input data-testid="wed-tagline" value={draft.tagline || ""} maxLength={120} onChange={(e) => set({ tagline: e.target.value })} style={input} /></Field>
          <Field label={t.rd_wed_announcement}><input data-testid="wed-announcement" value={draft.announcement || ""} maxLength={160} onChange={(e) => set({ announcement: e.target.value })} style={input} /></Field>
          <Field label={t.rd_wed_live}><input data-testid="wed-live" value={draft.live || ""} maxLength={120} onChange={(e) => set({ live: e.target.value })} style={input} /></Field>
          <Field label={t.rd_wed_reply}><input value={draft.replyTime || ""} maxLength={20} onChange={(e) => set({ replyTime: e.target.value })} style={input} /></Field>
          <Field label={t.rd_wed_about}><textarea data-testid="wed-about" value={draft.about || ""} maxLength={2000} rows={3} onChange={(e) => set({ about: e.target.value })} style={{ ...input, resize: "vertical" }} /></Field>
          <Field label={t.rd_wed_policy}><textarea data-testid="wed-policy" value={draft.policy || ""} maxLength={2000} rows={3} onChange={(e) => set({ policy: e.target.value })} style={{ ...input, resize: "vertical" }} /></Field>
        </Section>

        <Section title={t.rd_wed_socials} hint={t.rd_wed_socials_hint}>
          {SOCIALS.map((k) => <IconRow key={k} brand={k} label={SOCIAL_NAME[k]}><input data-testid={`wed-social-${k}`} value={draft.socials?.[k] || ""} maxLength={120} autoCapitalize="none" onChange={(e) => set({ socials: { ...draft.socials, [k]: e.target.value } })} style={input} /></IconRow>)}
        </Section>

        <Section title={t.rd_wed_chats} hint={t.rd_wed_chats_hint}>
          {CHATS.map((k) => <IconRow key={k} brand={k} label={CHAT_NAME[k]}><input data-testid={`wed-chat-${k}`} value={draft.chats?.[k] || ""} maxLength={120} autoCapitalize="none" inputMode={k === "whatsapp" ? "tel" : "text"} onChange={(e) => set({ chats: { ...draft.chats, [k]: e.target.value } })} style={input} /></IconRow>)}
        </Section>

        <Section title={t.rd_wed_sections}>
          {SECTIONS.map((k) => {
            const on = draft.sections?.[k] !== false;
            return (
              <button key={k} type="button" role="switch" aria-checked={on} data-testid={`wed-sec-${k}`} onClick={() => set({ sections: { ...draft.sections, [k]: !on } })}
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", minHeight: 46, border: "none", borderTop: "1px solid var(--border)", background: "transparent", color: "var(--text)", fontSize: 14, fontFamily: "var(--font-ui)", cursor: "pointer", padding: "0 2px" }}>
                <span>{t[`rd_wed_sec_${k}`]}</span><Toggle on={on} />
              </button>
            );
          })}
        </Section>
      </div>
      <div style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 20, padding: "10px 14px calc(10px + env(safe-area-inset-bottom))", background: "var(--surface)", borderTop: "1px solid var(--border)" }}>
        <div style={{ maxWidth: 720, margin: "0 auto", display: "flex", gap: 8 }}>
          <button type="button" data-testid="wed-save" style={{ ...btn, flex: 1 }} disabled={!!busy} onClick={() => void save()}>{busy === "save" ? t.rd_wed_saving : t.rd_wed_save}</button>
        </div>
      </div>
      {preview && <PreviewSheet title={t.rd_wed_preview} closeLabel={t.rd_wed_preview_close} onClose={closePreview}>
        <Suspense fallback={null}><ShopApp preview={previewShop(sub, draft, settings, preview, country, plan || "")} /></Suspense>
      </PreviewSheet>}
    </Frame>
  );
}

/** The preview, drawn ON TOP OF THE WHOLE APP: a portal to document.body, so it is outside the
 *  app's animated screen container (.sfl-anim-screen fades + slides its children — a fixed sheet
 *  inside it was see-through and moved with the screen) and above the bottom bar. Fully opaque;
 *  the shop draws its own colours (SHOP_CSS is scoped to .sfl-shop, like on the real page). */
const PREVIEW_Z = 5000;
function PreviewSheet({ title, closeLabel, onClose, children }: { title: string; closeLabel: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [onClose]);
  if (typeof document === "undefined") return null;
  return createPortal(
    <div data-testid="wed-preview-sheet" role="dialog" aria-modal="true" aria-label={title}
      style={{ position: "fixed", inset: 0, zIndex: PREVIEW_Z, background: "#F5F5F7", opacity: 1, isolation: "isolate", display: "flex", flexDirection: "column", fontFamily: "system-ui, -apple-system, \"Segoe UI\", sans-serif" }}>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "calc(6px + env(safe-area-inset-top)) 12px 6px 16px", background: "#111827", color: "#fff" }}>
        <span style={{ fontSize: 14, fontWeight: 800 }}>{title}</span>
        <button type="button" data-testid="wed-preview-close" onClick={onClose}
          style={{ minHeight: 44, padding: "0 16px", borderRadius: 999, border: "1px solid rgba(255,255,255,.35)", background: "#fff", color: "#111827", fontWeight: 800, fontSize: 14, fontFamily: "inherit", cursor: "pointer" }}>✕ {closeLabel}</button>
      </div>
      <div data-testid="wed-preview-body" style={{ flex: 1, minHeight: 0, overflowY: "auto", overscrollBehavior: "contain", WebkitOverflowScrolling: "touch", position: "relative" }}>{children}</div>
    </div>,
    document.body,
  );
}

const PUBLISHED_FLASH_MS = 3000;
function Spinner() {
  return <span aria-hidden="true" className="sfl-wed-spin" style={{ display: "inline-block", width: 14, height: 14, marginRight: 8, verticalAlign: "-2px", borderRadius: 7, border: "2px solid currentColor", borderRightColor: "transparent", animation: "sflWedSpin .8s linear infinite" }}><style>{"@keyframes sflWedSpin{to{transform:rotate(360deg)}}"}</style></span>;
}

function subText(t: Record<string, string>, p: "short" | "chars" | "reserved"): string {
  return p === "short" ? t.rd_wed_addr_short : p === "reserved" ? t.rd_wed_addr_reserved : t.rd_wed_addr_chars;
}
function fmtDate(s: string | null): string {
  if (!s) return "";
  const d = new Date(s);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-CA", { timeZone: "Asia/Taipei" }) : "";
}
const btn: CSSProperties = { minHeight: 46, borderRadius: 12, border: "none", background: "var(--accent)", color: "var(--accent-text)", fontWeight: 800, fontSize: 14.5, cursor: "pointer", fontFamily: "var(--font-ui)", padding: "0 14px" };
const smallBtn: CSSProperties = { minHeight: 36, borderRadius: 10, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "var(--font-ui)", padding: "0 12px", flexShrink: 0 };
const noteStyle: CSSProperties = { marginTop: 8, fontSize: 12.5, color: "var(--text-muted)", fontFamily: "var(--font-ui)" };

function Frame({ t, onBack, children }: { t: Record<string, string>; onBack?: () => void; children: ReactNode }) {
  return (
    <div>
      <div style={headerBar}>
        <HeaderWithBack onBack={onBack}>
          <div className="sfl-anim-beat" style={headerTitle}>{t.rd_wed_title}</div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 1 }}>{t.rd_wed_sub}</div>
        </HeaderWithBack>
      </div>
      {children}
    </div>
  );
}
function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return <section style={card}><div style={{ fontSize: 14.5, fontWeight: 800, marginBottom: hint ? 2 : 10 }}>{title}</div>{hint && <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 10 }}>{hint}</div>}{children}</section>;
}
function Label({ text }: { text: string }) { return <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--text-dim)", margin: "8px 0 6px" }}>{text}</div>; }
function Field({ label, children }: { label: string; children: ReactNode }) { return <label style={{ display: "block", marginBottom: 10 }}><Label text={label} />{children}</label>; }
function IconRow({ brand, label, children }: { brand: BrandKey; label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
      <span aria-hidden="true" style={{ width: 36, height: 36, borderRadius: 18, background: "var(--chip-bg)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><BrandIcon brand={brand} size={18} /></span>
      <span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>{label}</span>
      <div style={{ flex: 1, minWidth: 0 }} title={label}>{children}</div>
    </div>
  );
}
function Toggle({ on }: { on: boolean }) {
  return <span aria-hidden="true" style={{ width: 44, height: 26, borderRadius: 13, background: on ? "var(--accent)" : "var(--chip-bg)", position: "relative", flexShrink: 0, transition: "background .15s" }}><span style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20, borderRadius: 10, background: "#fff", boxShadow: "0 1px 3px rgba(0,0,0,.25)", transition: "left .15s" }} /></span>;
}
function PicField({ label, path, round, busy, onFile, t, testid }: { label: string; path?: string; round?: boolean; busy: boolean; onFile: (f: File | undefined) => void; t: Record<string, string>; testid: string }) {
  const src = useMemo(() => (path ? productImageUrl(path) : ""), [path]);
  return (
    <label data-testid={testid} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, border: "1px dashed var(--border)", borderRadius: 14, padding: 10, cursor: "pointer", minHeight: 120, justifyContent: "center" }}>
      <span style={{ width: round ? 64 : "100%", height: 64, borderRadius: round ? 32 : 10, background: "var(--chip-bg)", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 22, color: "var(--text-muted)" }}>＋</span>}
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 700 }}>{label}</span>
      <span style={{ fontSize: 11.5, color: "var(--accent-fg)", fontWeight: 700 }}>{busy ? "…" : path ? t.rd_wed_change_pic : t.rd_wed_add_pic}</span>
      <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
    </label>
  );
}
