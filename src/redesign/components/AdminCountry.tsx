// ADMIN-ONLY country flag + name per user, and the country picker. Only rendered inside
// AdminPanel (through AdminCountryCtx) — no seller ever sees any of it.
//
// Flags are small SVG images (country-flag-icons, MIT), NOT emoji: Windows Chrome shows
// flag emoji as two letters. The whole flag set (~45 KB gzipped) is loaded lazily the
// first time an admin list shows a flag, so it is never in the seller bundle.
//
import { useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { allCountryOptions, countryName, FREQUENT_COUNTRIES, searchCountries } from "../adapters/adminCountry";
import { ACT, AdminCountryCtx, type CountryInfo } from "../adapters/adminCountryCtx";


// ── Flag images (lazy, one shared load) ─────────────────────────────────────────
type FlagSet = Record<string, string>;
let flagSet: FlagSet | null = null;
let flagLoad: Promise<FlagSet | null> | null = null;
function loadFlags(): Promise<FlagSet | null> {
  if (flagSet) return Promise.resolve(flagSet);
  if (!flagLoad) {
    flagLoad = import("country-flag-icons/string/3x2")
      .then((m) => { flagSet = m as unknown as FlagSet; return flagSet; })
      .catch(() => { flagLoad = null; return null; });
  }
  return flagLoad;
}
const flagSrc = (svg: string) => "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);

export function CountryFlag({ iso, w = 18, h = 12 }: { iso: string; w?: number; h?: number }) {
  const [, force] = useState(0);
  useEffect(() => { if (!flagSet) { let alive = true; void loadFlags().then(() => { if (alive) force((n) => n + 1); }); return () => { alive = false; }; } }, []);
  const svg = flagSet?.[iso];
  const box = { width: w, height: h, flexShrink: 0, boxSizing: "border-box" as const, border: "1px solid var(--border-strong, #d1d5db)", borderRadius: 2, display: "block" };
  // Same-size grey box while loading / for a code without a flag → no layout jump.
  if (!svg) return <span aria-hidden="true" data-testid="cty-flag-ph" style={{ ...box, background: "var(--surface-3, #e5e7eb)" }} />;
  return <img src={flagSrc(svg)} alt="" aria-hidden="true" width={w} height={h} data-testid="cty-flag" data-iso={iso} style={{ ...box, objectFit: "cover" }} />;
}

function GlobeIcon() {
  return <svg aria-hidden="true" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" /></svg>;
}


// Pill for the Manage sellers card (same row as Seller / plan). Tap → picker.
export function CountryPill({ email }: { email: string }) {
  const api = useContext(AdminCountryCtx);
  const info = api?.infoFor(email);
  if (!api || !info) return null;
  const known = !!info.iso;
  const label = known ? countryName(info.iso!) : ACT.unknown;
  return (
    <button type="button" onClick={(e) => { e.stopPropagation(); api.open(email); }} className="sfl-cty-hit" data-testid="cty-pill" data-source={info.source} title={label} aria-label={`${label} — ${ACT.title}`}
      style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10, fontWeight: 800, lineHeight: "14px", color: known ? "var(--text)" : "var(--text-dim)", background: "var(--surface)", border: known ? "1px solid var(--border)" : "1px dashed var(--text-muted)", padding: "3px 7px", borderRadius: 6, cursor: "pointer", fontFamily: "var(--font-ui)", maxWidth: "100%", minWidth: 0 }}>
      {known ? <CountryFlag iso={info.iso!} w={16} h={11} /> : <GlobeIcon />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
    </button>
  );
}

// Inline flag + name for the bucket lists (Active / Expiring / Expired / Free / Pulse …).
// Tappable too, so the admin can fix it from any list.
export function CountryTag({ email, suffix }: { email: string | null | undefined; suffix?: ReactNode }) {
  const api = useContext(AdminCountryCtx);
  const info = api?.infoFor(email);
  if (!api || !info) return suffix ? <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 1 }}>{suffix}</div> : null;
  const known = !!info.iso;
  const label = known ? countryName(info.iso!) : ACT.unknown;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3, minWidth: 0, fontSize: 10.5, color: "var(--text-muted)" }}>
      <button type="button" onClick={(e) => { e.stopPropagation(); api.open(info.email); }} className="sfl-cty-hit" data-testid="cty-tag" data-source={info.source} title={label} aria-label={`${label} — ${ACT.title}`}
        style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0, maxWidth: "100%", fontSize: 11, fontWeight: 700, lineHeight: "14px", color: known ? "var(--text)" : "var(--text-dim)", background: "transparent", border: known ? "1px solid transparent" : "1px dashed var(--text-muted)", padding: known ? "1px 0" : "1px 6px", borderRadius: 6, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
        {known ? <CountryFlag iso={info.iso!} /> : <GlobeIcon />}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
      </button>
      {suffix ? <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>· {suffix}</span> : null}
    </div>
  );
}

// ── Picker (bottom sheet on phone, small dialog on laptop — .sfl-cty-* in redesign.css) ─
export function AdminCountryPicker({ info, onClose, onSave }: { info: CountryInfo; onClose: () => void; onSave: (iso: string | null) => Promise<{ ok: boolean }> }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string | null>(info.iso);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const all = useMemo(() => allCountryOptions(), []);
  const results = useMemo(() => searchCountries(all, q), [all, q]);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const srcText = info.source === "admin" ? ACT.srcAdmin : info.source === "saved" ? ACT.srcSaved : info.source === "phone" ? ACT.srcPhone : "";
  const go = async (iso: string | null) => {
    if (busy) return;
    setBusy(true); setErr(false);
    const r = await onSave(iso);
    setBusy(false);
    if (r.ok) onClose(); else setErr(true);
  };
  const quickBtn = (iso: string) => (
    <button key={iso} type="button" onClick={() => setSel(iso)} data-testid="cty-quick" data-iso={iso} aria-pressed={sel === iso}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, minHeight: 44, padding: "0 12px", border: sel === iso ? "1.5px solid var(--accent)" : "1px solid var(--border)", borderRadius: 10, background: sel === iso ? "var(--accent-soft)" : "var(--surface)", color: "var(--text)", fontSize: 14, fontWeight: 600, fontFamily: "var(--font-ui)", cursor: "pointer" }}>
      <CountryFlag iso={iso} />{countryName(iso)}
    </button>
  );
  return (
    <div className="sfl-cty-wrap" onClick={(e) => { e.stopPropagation(); onClose(); }} data-testid="cty-picker">
      <div className="sfl-cty-card" role="dialog" aria-modal="true" aria-label={ACT.title} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--font-display)", fontSize: 18, fontWeight: 700, color: "var(--text)" }}>{ACT.title}</div>
            <div style={{ fontSize: 13, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} data-testid="cty-picker-email">{info.email}</div>
            {info.iso && <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2 }} data-testid="cty-picker-now">{ACT.now}: {countryName(info.iso)}{srcText ? ` (${srcText})` : ""}</div>}
          </div>
          <button type="button" onClick={onClose} aria-label={ACT.close} title={ACT.close} style={{ width: 44, height: 44, flexShrink: 0, border: "none", borderRadius: 12, background: "var(--surface-2)", color: "var(--text-dim)", fontSize: 18, cursor: "pointer" }}>×</button>
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: "var(--text-muted)" }}>{ACT.search}
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} type="text" autoComplete="off" data-testid="cty-search"
            style={{ height: 44, boxSizing: "border-box", border: "1.3px solid var(--accent)", borderRadius: 12, padding: "0 14px", fontSize: 16, fontFamily: "var(--font-ui)", color: "var(--text)", background: "var(--surface)", outline: "none" }} />
        </label>

        {!q.trim() && (
          <>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", letterSpacing: ".04em" }}>{ACT.frequent}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{FREQUENT_COUNTRIES.map(quickBtn)}</div>
          </>
        )}

        <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-muted)", letterSpacing: ".04em" }}>{ACT.results}</div>
        <div className="sfl-scroll" style={{ border: "1px solid var(--border)", borderRadius: 12, overflowY: "auto", maxHeight: 260, minHeight: 52 }} data-testid="cty-results">
          {results.length === 0 && <div style={{ padding: "16px 14px", fontSize: 13, color: "var(--text-muted)" }}>{ACT.none}</div>}
          {results.map((c, i) => (
            <button key={c.iso} type="button" onClick={() => setSel(c.iso)} data-testid="cty-opt" data-iso={c.iso} aria-pressed={sel === c.iso}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: 48, padding: "0 14px", border: "none", borderTop: i ? "1px solid var(--border)" : "none", background: sel === c.iso ? "var(--accent-soft)" : "var(--surface)", color: "var(--text)", fontSize: 15, fontFamily: "var(--font-ui)", textAlign: "left", cursor: "pointer" }}>
              <CountryFlag iso={c.iso} w={22} h={15} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
              {sel === c.iso && <span style={{ color: "var(--accent-fg)", fontWeight: 800 }}>✓</span>}
            </button>
          ))}
        </div>

        {err && <div role="alert" style={{ fontSize: 12.5, fontWeight: 700, color: "var(--danger)" }} data-testid="cty-err">{ACT.saveErr}</div>}
        <button type="button" onClick={() => void go(sel)} disabled={busy || !sel || (info.source === "admin" && sel === info.iso)} data-testid="cty-save"
          style={{ minHeight: 48, border: "none", borderRadius: 12, background: busy || !sel ? "var(--border-strong)" : "var(--accent)", color: "var(--accent-text, #fff)", fontSize: 16, fontWeight: 700, fontFamily: "var(--font-ui)", cursor: busy || !sel ? "default" : "pointer", opacity: info.source === "admin" && sel === info.iso ? 0.6 : 1 }}>
          {ACT.save}{sel ? ` · ${countryName(sel)}` : ""}
        </button>
        {info.source === "admin" && (
          <button type="button" onClick={() => void go(null)} disabled={busy} data-testid="cty-auto"
            style={{ minHeight: 44, border: "1px solid var(--border)", borderRadius: 12, background: "var(--surface)", color: "var(--text-dim)", fontSize: 14, fontWeight: 700, fontFamily: "var(--font-ui)", cursor: "pointer" }}>{ACT.auto}</button>
        )}
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", textAlign: "center" }}>{ACT.hint}</div>
      </div>
    </div>
  );
}
