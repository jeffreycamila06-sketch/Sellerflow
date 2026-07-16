// Country-picker phone field — one component reused by Signup AND GeneralSettings
// so the phone rule lives in ONE place (single-source, no drift). A country button
// (flag + dial code) opens a searchable dropdown of ALL countries (core pinned on
// top, names localized via Intl.DisplayNames); the local number goes in the input.
// Validation is the caller's job via adapters/phone.validatePhone(value, country) —
// this component only surfaces the picked country + number + an inline hint.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { listCountries, filterCountries, flagOf } from "../adapters/phone";
import { getCountryCallingCode, type CountryCode } from "libphonenumber-js/min";

const input: CSSProperties = { width: "100%", padding: "12px 13px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 600, outline: "none" };

function dialOf(iso: string): string {
  try { return "+" + getCountryCallingCode(iso as CountryCode); } catch { return ""; }
}

export default function CountryPhoneField({
  value, onChange, country, onCountryChange, lang, invalid, hint, placeholder, countryLabel, searchLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  country: string;
  onCountryChange: (iso: string) => void;
  lang: string;
  invalid: boolean;
  hint: string;
  placeholder?: string;
  countryLabel: string;   // i18n "Country" (aria)
  searchLabel: string;    // i18n "Search countries"
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef<HTMLDivElement>(null);
  const countries = useMemo(() => listCountries(lang), [lang]);
  const filtered = useMemo(() => filterCountries(countries, q), [countries, q]);

  // Close on tap-outside / Escape (listener, not overlay — a sticky-header backdrop
  // would trap a fixed overlay; same pattern as the Dashboard dropdowns).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const dial = dialOf(country);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button" data-testid="phone-country-btn" aria-label={countryLabel}
          onClick={() => setOpen((o) => !o)}
          style={{ display: "flex", alignItems: "center", gap: 5, padding: "12px 10px", border: "1px solid var(--border-strong)", borderRadius: 11, background: "var(--surface-2)", color: "var(--text)", fontFamily: "var(--font-mono)", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
        >
          <span style={{ fontSize: 15 }}>{flagOf(country)}</span>
          <span>{dial}</span>
          <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
        </button>
        <input
          value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
          inputMode="tel" data-testid="phone-input" style={{ ...input, flex: 1, minWidth: 0 }}
        />
      </div>
      {invalid && <div data-testid="phone-hint" style={{ fontSize: 11, fontWeight: 600, color: "var(--danger)", marginTop: 4 }}>{hint}</div>}

      {open && (
        <div data-testid="country-list" style={{ position: "absolute", zIndex: 40, top: "calc(100% + 4px)", left: 0, right: 0, maxHeight: 260, overflow: "hidden", display: "flex", flexDirection: "column", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 12, boxShadow: "0 12px 30px rgba(9,7,24,.28)" }}>
          <input
            autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchLabel} aria-label={searchLabel}
            style={{ ...input, borderRadius: 0, borderWidth: "0 0 1px 0", fontFamily: "var(--font-ui)" }}
          />
          <div style={{ overflowY: "auto" }}>
            {filtered.map((c) => (
              <button
                key={c.iso} type="button"
                onClick={() => { onCountryChange(c.iso); setOpen(false); setQ(""); }}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "10px 12px", border: "none", background: c.iso === country ? "var(--chip-bg)" : "transparent", color: "var(--text)", fontFamily: "var(--font-ui)", fontSize: 13, cursor: "pointer", textAlign: "left" }}
              >
                <span style={{ fontSize: 16 }}>{c.flag}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-dim)" }}>{c.dial}</span>
              </button>
            ))}
            {filtered.length === 0 && <div style={{ padding: "12px", fontSize: 12, color: "var(--text-muted)" }}>—</div>}
          </div>
        </div>
      )}
    </div>
  );
}
