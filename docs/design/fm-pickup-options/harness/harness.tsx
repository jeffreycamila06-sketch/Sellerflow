// MOCK-UPS for the STEP 0 report (2026-11-19) — nothing here is built into the app.
// The REAL Pickup Status screen is rendered on made-up rows (fakeSupabase.ts); then `__decorate(opt)`
// draws one option ON TOP of the rendered page (chips, a group header, a tab / card). No app file is
// edited, so "today" (no decoration) is exactly what the screen shows now.
//   ?lang=en|fil|zh|zh-TW|vi|th|id|bg      window.__decorate("today" | "opt1" | "opt2" | "opt3")
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider, buildT, normalizeLang } from "../../../../src/redesign/i18n";
import ParcelTracking from "../../../../src/redesign/screens/ParcelTracking";

const q = new URLSearchParams(location.search);
const lang = normalizeLang(q.get("lang") || "en");
const t = buildT(lang) as unknown as Record<string, string>;

// NEW words the options would need — DRAFTS (English is the source; the others are not reviewed).
const NEW: Record<string, { one: string; noRecord: string; leaves: string; hint: string }> = {
  en: { one: "Not at FamilyMart yet", noRecord: "No record yet", leaves: "Leaves this list {date}", hint: "FamilyMart has not received these yet. They leave this list after 10 days." },
  fil: { one: "Wala pa sa FamilyMart", noRecord: "Wala pang record", leaves: "Aalisin sa listahan sa {date}", hint: "Hindi pa natatanggap ng FamilyMart ang mga ito. Aalisin sa listahan pagkalipas ng 10 araw." },
  zh: { one: "全家尚未收件", noRecord: "尚无记录", leaves: "{date} 移出列表", hint: "全家尚未收到这些包裹。10 天后会从列表移除。" },
  "zh-TW": { one: "全家尚未收件", noRecord: "尚無紀錄", leaves: "{date} 移出清單", hint: "全家尚未收到這些包裹。10 天後會從清單移除。" },
  vi: { one: "Chưa đến FamilyMart", noRecord: "Chưa có dữ liệu", leaves: "Rời danh sách ngày {date}", hint: "FamilyMart chưa nhận các kiện này. Sau 10 ngày sẽ rời khỏi danh sách." },
  th: { one: "ยังไม่ถึง FamilyMart", noRecord: "ยังไม่มีข้อมูล", leaves: "ออกจากรายการ {date}", hint: "FamilyMart ยังไม่ได้รับพัสดุเหล่านี้ ครบ 10 วันจะออกจากรายการ" },
  id: { one: "Belum di FamilyMart", noRecord: "Belum tercatat", leaves: "Keluar dari daftar {date}", hint: "FamilyMart belum menerima paket ini. Setelah 10 hari keluar dari daftar." },
  bg: { one: "Още не е във FamilyMart", noRecord: "Още няма запис", leaves: "Отпада от списъка на {date}", hint: "FamilyMart още не е получил тези пратки. След 10 дни отпадат от списъка." },
};
const W = NEW[lang] ?? NEW.en;
const notDropped = t.rd_pt_fm_not_dropped; // already in the app, 8 languages

// The three rows of the study: what FamilyMart's site said at the last check.
const FLAG: Record<string, "notDropped" | "noRecord"> = { "ella.tw": "notDropped", faye_ukay: "notDropped", ivy_live: "noRecord" };
const ORDER = ["ella.tw", "faye_ukay", "ivy_live"];
const DAY = 86400000;
const leaveDate = new Date(Date.now() + 7 * DAY); // saved 3 days ago + 10 days
const shortDate = (d: Date) => { try { return d.toLocaleDateString(lang, { month: "short", day: "numeric" }); } catch { return d.toISOString().slice(5, 10); } };

const CHIP = "display:inline-block;margin-top:3px;margin-right:4px;padding:1px 7px;border-radius:999px;border:1px solid var(--warn);font-size:10.5px;font-weight:700;color:var(--warn);white-space:nowrap";
const chip = (text: string) => { const s = document.createElement("span"); s.setAttribute("style", CHIP); s.dataset.mock = "chip"; s.textContent = text; return s; };
const nameOf = (row: Element) => row.querySelector('span[title^="@"]')?.getAttribute("title")?.slice(1) ?? "";
const rowsNow = () => [...document.querySelectorAll('[data-testid="pt-row"]')];

function strip(title: string | null, n: number | null, asRow: boolean): Element {
  const box = document.createElement("div");
  box.dataset.mock = "group";
  box.setAttribute("style", "padding:9px 12px;background:var(--warn-soft);border-top:1px solid var(--border);border-bottom:1px solid var(--border)");
  if (title) {
    const h = document.createElement("div");
    h.setAttribute("style", "font-size:12.5px;font-weight:800;color:var(--text)");
    h.textContent = n === null ? title : `${title} · ${n}`;
    box.appendChild(h);
  }
  const p = document.createElement("div");
  p.setAttribute("style", `font-size:11.5px;color:var(--text-dim);line-height:1.35;${title ? "margin-top:2px" : ""}`);
  p.textContent = W.hint;
  box.appendChild(p);
  if (!asRow) return box;
  const tr = document.createElement("tr"); const td = document.createElement("td");
  td.colSpan = 6; td.setAttribute("style", "padding:0"); td.appendChild(box); tr.appendChild(td); tr.dataset.mock = "group";
  return tr;
}

function setCount(tab: string, n: number) {
  const card = document.querySelector(`[data-testid="pt-card-${tab}"]`);
  if (card?.firstElementChild) card.firstElementChild.textContent = String(n);
  const tabEl = document.querySelector(`[data-testid="pt-tab-${tab}"] span`);
  if (tabEl) tabEl.textContent = String(n);
}

function decorate(opt: string) {
  const rows = rowsNow();
  const flagged = ORDER.map((u) => rows.find((r) => nameOf(r) === u)).filter(Boolean) as Element[];
  const out = { opt, lang, rows: rows.length, flagged: flagged.length };
  if (opt === "today" || !flagged.length) return finish(out);

  for (const row of flagged) {
    const kind = FLAG[nameOf(row)];
    const old = row.querySelector('[data-testid="pt-not-dropped"]');
    const hadFileDate = !!old;
    old?.remove();
    const text = opt === "opt1" ? W.one : kind === "noRecord" ? W.noRecord : notDropped;
    const carrier = row.querySelector('[data-testid="pt-carrier"]');
    carrier?.after(chip(text));
    const left = row.querySelector('[data-testid="pt-left"]') as HTMLElement | null;
    if (left && !hadFileDate) { // a row with the file's "drop off before" date keeps that line
      left.textContent = W.leaves.replace("{date}", shortDate(leaveDate));
      left.setAttribute("style", "font-size:12.5px;font-weight:400;color:var(--text-dim);display:block;line-height:1.3;white-space:normal");
    }
  }
  if (opt === "opt1") return finish(out);

  const parent = flagged[0].parentElement!;
  const asRow = parent.tagName === "TBODY";
  const others = rows.filter((r) => !flagged.includes(r));
  if (opt === "opt2") {
    // own group UNDER the moving parcels; the In transit number counts the moving ones only
    for (const r of flagged) parent.appendChild(r);
    parent.insertBefore(strip(notDropped, flagged.length, asRow), flagged[0]);
    if (!asRow) (flagged[0] as HTMLElement).style.borderTop = "none";
    setCount("transit", others.length);
    const card = document.querySelector('[data-testid="pt-card-transit"]');
    if (card) {
      const sub = document.createElement("div");
      sub.dataset.mock = "card-sub";
      sub.setAttribute("style", "font-size:10.5px;font-weight:700;color:var(--warn);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap");
      sub.textContent = `+${flagged.length} ${notDropped}`;
      card.appendChild(sub);
    }
    return finish(out);
  }
  // opt3 — its own tab (laptop) / card (phone), shown selected
  for (const r of others) r.remove();
  if (!asRow) (flagged[0] as HTMLElement).style.borderTop = "none";
  parent.insertBefore(strip(null, null, asRow), flagged[0]);
  setCount("transit", others.length);
  const tabT = document.querySelector('[data-testid="pt-tab-transit"]') as HTMLElement | null;
  const tabIdle = document.querySelector('[data-testid="pt-tab-returned"]') as HTMLElement | null;
  if (tabT && tabIdle) {
    const mine = tabT.cloneNode(true) as HTMLElement;
    mine.dataset.testid = "pt-tab-notdropped"; mine.dataset.mock = "tab";
    mine.firstChild!.textContent = `${notDropped} `;
    mine.querySelector("span")!.textContent = String(flagged.length);
    tabT.setAttribute("style", tabIdle.getAttribute("style") || "");
    tabT.setAttribute("aria-selected", "false");
    tabIdle.after(mine);
  }
  const cardT = document.querySelector('[data-testid="pt-card-transit"]') as HTMLElement | null;
  const cardIdle = document.querySelector('[data-testid="pt-card-returned"]') as HTMLElement | null;
  if (cardT && cardIdle) {
    const mine = cardT.cloneNode(true) as HTMLElement;
    mine.dataset.testid = "pt-card-notdropped"; mine.dataset.mock = "card";
    mine.style.gridColumn = "1 / -1"; mine.style.display = "flex"; mine.style.alignItems = "baseline"; mine.style.gap = "10px";
    const [num, label] = [mine.children[0] as HTMLElement, mine.children[1] as HTMLElement];
    num.textContent = String(flagged.length); num.style.color = "var(--warn)";
    label.textContent = notDropped; label.style.marginTop = "0";
    cardT.style.border = cardIdle.style.border;
    cardT.setAttribute("aria-pressed", "false");
    cardIdle.after(mine);
  }
  return finish(out);
}
function finish<T extends object>(out: T) {
  const doc = document.documentElement;
  return { ...out, sideways: doc.scrollWidth - doc.clientWidth, transit: document.querySelector('[data-testid="pt-card-transit"]')?.firstElementChild?.textContent ?? document.querySelector('[data-testid="pt-tab-transit"] span')?.textContent ?? null };
}
(window as unknown as { __decorate: typeof decorate }).__decorate = decorate;

createRoot(document.getElementById("root")!).render(
  <TProvider lang={lang}>
    <div data-redesign="" data-theme="light" style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--text)", fontFamily: "var(--font-ui)" }}>
      <ParcelTracking userId="U1" fm />
    </div>
  </TProvider>,
);
