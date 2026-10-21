// What Bluetooth sticker printer this phone has saved — the native answer, remembered.
// Written by every bridge call that returns `savedPrinter` (get/set/clear/scan — see
// printerBridge.btCall), mirrored to localStorage so a cold open before the first native
// answer still routes right. The native side is the truth; this is only its last echo.
// Zero imports so printing.ts and printerBridge.ts can both read it without a cycle.
export type PrinterLang = "tspl" | "escpos";
export interface SavedBtPrinter { address: string; name: string; model?: "D520BT" | "generic"; lang?: PrinterLang }

const LS_KEY = "sfl_rd_bt_printer";
let saved: SavedBtPrinter | null | undefined; // undefined = nothing learned yet this session

function normalize(raw: unknown): SavedBtPrinter | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const address = typeof r.address === "string" ? r.address : "";
  if (!address) return null;
  const out: SavedBtPrinter = { address, name: typeof r.name === "string" ? r.name : "" };
  if (r.model === "generic" || r.model === "D520BT") out.model = r.model;
  if (r.lang === "tspl" || r.lang === "escpos") out.lang = r.lang;
  return out;
}

export function rememberSavedPrinter(raw: unknown): void {
  saved = normalize(raw);
  try {
    if (saved) localStorage.setItem(LS_KEY, JSON.stringify(saved)); else localStorage.removeItem(LS_KEY);
  } catch { /* per-device convenience only */ }
}

export function savedBtPrinter(): SavedBtPrinter | null {
  if (saved !== undefined) return saved;
  try { const s = localStorage.getItem(LS_KEY); saved = s ? normalize(JSON.parse(s)) : null; } catch { saved = null; }
  return saved;
}

// The language real orders must use on a saved GENERIC printer; null = not generic
// (the D520BT paths decide as before). A generic save without a language = "tspl"
// (every Phase-1 save printed TSPL).
export function savedGenericLang(): PrinterLang | null {
  const p = savedBtPrinter();
  if (!p || p.model !== "generic") return null;
  return p.lang === "escpos" ? "escpos" : "tspl";
}

export function __resetSavedPrinter(): void { saved = undefined; try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ } }
