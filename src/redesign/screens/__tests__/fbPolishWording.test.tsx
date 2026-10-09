// Build 7 "Wording & receipts" (switch fb_polish_v2 unless noted). Pins:
//   • Receipt format: ON → each toggle saves on tap with exactly what its Save button writes (a
//     failed save puts the tick back); the "Nothing is sent yet" line goes while a toggle is on.
//     OFF → ticking saves nothing, every Save button as before;
//   • no raw "(FB …)" code in any seller-facing text (every i18n string, and the connect /
//     receipt error texts with the switch ON); OFF keeps today's texts;
//   • receipt sheet: the reason in place of Send (older than 7 days / not open yet) and a confirm
//     before "Send again"; OFF → as before;
//   • receipt picture (NOT switched): Messenger-bubble sizes, still one shared layout;
//   • buyer-tag pill 4.5:1 or better in both themes; the Orders row footer wraps (ON only);
//   • text batch (NOT switched) and no technical words in the new en / fil strings.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, fireEvent, act } from "@testing-library/react";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: false, supabase: null }));
const m = vi.hoisted(() => ({
  loadRs: vi.fn(), saveRs: vi.fn(), loadSo: vi.fn(), saveSo: vi.fn(), loadAuto: vi.fn(), saveAuto: vi.fn(), info: vi.fn(), send: vi.fn(), render: vi.fn(),
}));
vi.mock("../../adapters/receiptSettings", async (orig) => ({ ...(await orig<typeof import("../../adapters/receiptSettings")>()), loadReceiptSettings: m.loadRs, saveReceiptSettings: m.saveRs }));
vi.mock("../../adapters/fbSoldout", async (orig) => ({ ...(await orig<typeof import("../../adapters/fbSoldout")>()), loadSoldoutSettings: m.loadSo, saveSoldoutSettings: m.saveSo }));
vi.mock("../../adapters/fbAutoReceipt", async (orig) => ({ ...(await orig<typeof import("../../adapters/fbAutoReceipt")>()), loadAutoReceipt: m.loadAuto, saveAutoReceipt: m.saveAuto }));
vi.mock("../../adapters/useReceiptPicture", () => ({ useReceiptPicture: () => ({ url: null, failed: true }) }));
vi.mock("../../adapters/fbReceipt", async (orig) => ({ ...(await orig<typeof import("../../adapters/fbReceipt")>()), fbReceiptInfo: m.info, fbReceiptSend: m.send }));
vi.mock("../../adapters/receiptImage", async (orig) => ({ ...(await orig<typeof import("../../adapters/receiptImage")>()), renderReceiptPng: m.render }));

import { TProvider, buildT } from "../../i18n";
import ReceiptFormat from "../ReceiptFormat";
import ReceiptSheet from "../../components/ReceiptSheet";
import BuyerTagPill from "../../components/BuyerTagPill";
import Orders from "../Orders";
import { fbConnectFailText } from "../../adapters/fb";
import { receiptFailText } from "../../adapters/fbReceipt";
import { parseColor, over, contrastRatio } from "../../adapters/contrast";
import { receiptFonts, layoutReceipt, RECEIPT_WIDTH } from "../../../lib/receiptLayout.js";
import type { BuyerReceipt } from "../../adapters/useReadData";
import type { Order } from "../../data";

const t = buildT("en");
const fil = buildT("fil");
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
const flush = async () => { await act(async () => { for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 5)); }); };
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;

beforeEach(() => {
  vi.clearAllMocks();
  m.loadRs.mockResolvedValue({ ok: true, settings: { opening: "", note: "", qrImage: null } });
  m.saveRs.mockResolvedValue(true);
  m.loadSo.mockResolvedValue({ ok: true, settings: { enabled: false, text: "Sorry, sold out" } });
  m.saveSo.mockResolvedValue(true);
  m.loadAuto.mockResolvedValue({ ok: true, enabled: false });
  m.saveAuto.mockResolvedValue(true);
  m.render.mockImplementation(async () => new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" }));
});

// ── a. Receipt format ────────────────────────────────────────────────────────
describe("Receipt format toggles", () => {
  const view = (polish: boolean) => render(<TProvider lang="en"><ReceiptFormat cur="NT$" onBack={() => {}} polish={polish} soldout={{ onChanged: vi.fn() }} autoReceipt={{ lang: "fil", currency: "₱" }} /></TProvider>);
  const tick = (id: string) => fireEvent.click(q(id)!);
  it("ON: ticking saves at once — the same writes as each Save button", async () => {
    view(true); await flush();
    tick("rc-soldout-on"); await flush();
    expect(m.saveSo).toHaveBeenCalledWith({ enabled: true, text: "Sorry, sold out" });
    tick("rc-auto-on"); await flush();
    expect(m.saveAuto).toHaveBeenCalledWith({ enabled: true, lang: "fil", currency: "₱" });
    expect(q("rc-auto-save")).toBeNull();            // nothing left to save there
    expect(q("rc-soldout-save")).not.toBeNull();     // the text still has its Save
    fireEvent.click(q("rc-soldout-save")!); await flush();
    expect(m.saveSo).toHaveBeenLastCalledWith({ enabled: true, text: "Sorry, sold out" });
  });
  it("ON: a failed save puts the tick back", async () => {
    m.saveAuto.mockResolvedValue(false);
    view(true); await flush();
    tick("rc-auto-on"); await flush();
    expect((q("rc-auto-on") as HTMLInputElement).checked).toBe(false);
    expect(document.body.textContent).toContain(t.rd_rc_save_failed);
  });
  it("ON: the 'Nothing is sent yet' line goes while either toggle is on", async () => {
    view(true); await flush();
    expect(q("rc-sub")!.textContent).toBe(t.rd_rc_sub);
    tick("rc-auto-on"); await flush();
    expect(q("rc-sub")!.textContent).toBe(t.rd_rc_sub_live);
    expect(t.rd_rc_sub_live).not.toMatch(/Nothing is sent/);
  });
  it("OFF: ticking saves nothing; both Save buttons; today's header", async () => {
    view(false); await flush();
    tick("rc-soldout-on"); tick("rc-auto-on"); await flush();
    expect(m.saveSo).not.toHaveBeenCalled();
    expect(m.saveAuto).not.toHaveBeenCalled();
    expect(q("rc-auto-save")).not.toBeNull();
    expect(q("rc-sub")!.textContent).toBe(t.rd_rc_sub);
  });
});

// ── b. no raw codes ──────────────────────────────────────────────────────────
describe("no raw '(FB …)' code in seller-facing text", () => {
  it("no i18n string in any language carries '(FB '", () => {
    for (const l of LANGS) for (const [k, v] of Object.entries(buildT(l) as unknown as Record<string, unknown>)) {
      if (typeof v === "string") expect(v, `${l}.${k}`).not.toMatch(/\(FB /);
    }
  });
  it("ON: connect errors — 190 → access expired, timeout → no answer, other → plain failed; never a code", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(fbConnectFailText({ ok: false, fbCode: 190 }, t, undefined, true)).toBe(t.rd_fb_err_expired);
    expect(fbConnectFailText({ ok: false, fbTimeout: true }, t, undefined, true)).toBe(t.rd_fb_err_no_answer);
    expect(fbConnectFailText({ ok: false, fbCode: 100 }, t, undefined, true)).toBe(t.rd_cm_conn_failed);
    expect(console.info).toHaveBeenCalledWith("[FB] connect failed code=100"); // the code stays in the console
  });
  it("ON: receipt errors — 10903 own text, 190 → access expired, other code → refused; never a code", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(receiptFailText({ fbCode: "10903/0" }, t, true)).toBe(t.rd_rs_no_private_reply);
    expect(receiptFailText({ fbCode: "190/460" }, t, true)).toBe(t.rd_fb_err_expired);
    expect(receiptFailText({ fbCode: "100/1893060" }, t, true)).toBe(t.rd_fb_err_refused);
    expect(receiptFailText({ code: 4 }, t, true)).toBe(t.rd_fb_err_refused);
    expect(receiptFailText({}, t, true)).toBe(t.rd_rs_failed);
  });
  it("OFF: today's texts, codes included", () => {
    expect(fbConnectFailText({ ok: false, fbCode: 190 }, t)).toBe(`${t.rd_cm_conn_failed} (FB 190)`);
    expect(fbConnectFailText({ ok: false, fbTimeout: true }, t)).toBe(`${t.rd_cm_conn_failed} (FB timeout)`);
    expect(receiptFailText({ fbCode: "100/1893060" }, t)).toBe(`${t.rd_rs_failed} (FB 100/1893060)`);
  });
  it("RedesignApp passes the switch to both connect toasts", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src.match(/fbConnectFailText\(r, tApp, \{[^}]*\}, featureSw\.fbPolishV2\)/g)).toHaveLength(2);
    expect(src).toContain("<ReceiptFormat cur={cur} polish={featureSw.fbPolishV2}");
    expect(src).toContain("fbPolish={featureSw.fbPolishV2} topTabs=");
  });
});

// ── c / d. receipt sheet ─────────────────────────────────────────────────────
describe("receipt sheet", () => {
  const SID = "11111111-2222-3333-4444-555555555555";
  const receipt: BuyerReceipt = { num: 3, name: "Ann Reyes", handle: "@ann", lines: [{ item: "A1", total: 350 }], count: 1, total: 350, platform: "Facebook" };
  const info = (over = {}) => ({ ok: true, canSend: true, sentCount: 0, lastSentAt: null, remaining: 2, ...over });
  const sheet = (polish: boolean) => render(<TProvider lang="en"><ReceiptSheet receipt={receipt} cur="NT$" onClose={vi.fn()} sessionId={SID} polish={polish} /></TProvider>);
  it("ON: older than 7 days / not open yet → the reason in place of Send", async () => {
    for (const [reason, text] of [["no_orders", t.rd_rs_too_old], ["no_access", t.rd_rs_no_access]] as const) {
      m.info.mockResolvedValue(info({ canSend: false, reason, remaining: 0 }));
      const r = sheet(true); await flush();
      expect(q("rs-send")).toBeNull();
      expect(q("rs-reason")!.textContent).toBe(text);
      r.unmount();
    }
  });
  it("OFF: no reason line (as before)", async () => {
    m.info.mockResolvedValue(info({ canSend: false, reason: "no_orders", remaining: 0 }));
    sheet(false); await flush();
    expect(q("rs-reason")).toBeNull();
  });
  it("ON: 'Send again' asks first — Cancel sends nothing, Send sends once", async () => {
    m.info.mockResolvedValue(info({ sentCount: 1, lastSentAt: "2026-10-09T10:00:00Z", remaining: 2 }));
    m.send.mockResolvedValue({ ok: true, sentCount: 2, remaining: 1, lastSentAt: "2026-10-09T10:05:00Z" });
    sheet(true); await flush();
    fireEvent.click(q("rs-send")!);
    expect(q("rs-again-confirm")!.textContent).toContain("Send another receipt to Ann Reyes?");
    fireEvent.click(q("rs-again-cancel")!);
    expect(q("rs-again-confirm")).toBeNull();
    expect(m.send).not.toHaveBeenCalled();
    fireEvent.click(q("rs-send")!);
    fireEvent.click(q("rs-again-send")!); await flush();
    expect(m.send).toHaveBeenCalledTimes(1);
  });
  it("ON: the first send needs no confirm; OFF: 'Send again' sends at once", async () => {
    m.info.mockResolvedValue(info());
    m.send.mockResolvedValue({ ok: true, sentCount: 1, remaining: 1, lastSentAt: null });
    const a = sheet(true); await flush();
    fireEvent.click(q("rs-send")!); await flush();
    expect(m.send).toHaveBeenCalledTimes(1);
    a.unmount();
    m.info.mockResolvedValue(info({ sentCount: 1, remaining: 1 }));
    sheet(false); await flush();
    fireEvent.click(q("rs-send")!); await flush();
    expect(q("rs-again-confirm")).toBeNull();
    expect(m.send).toHaveBeenCalledTimes(2);
  });
});

// ── e. receipt picture (NOT switched) ────────────────────────────────────────
describe("receipt picture sized for the Messenger bubble", () => {
  it("items 30 px, total 36 px, 720 wide; phone and server share the layout", () => {
    const F = receiptFonts("X");
    expect(F.item).toBe("400 30px X");
    expect(F.price).toBe("600 30px X");
    expect(F.totalAmount).toBe("700 36px X");
    expect(F.header).toBe("700 38px X");
    expect(RECEIPT_WIDTH).toBe(720);
    const measure = (s: string) => s.length * 14;
    const input = { opening: "Hi", note: "Pay", qrImage: null, currency: "NT$", buyerNum: 1, buyerName: "A", lines: [{ item: "A1", total: 100 }], labels: { total: "Total", toBeConfirmed: "tbc" } };
    expect(layoutReceipt(input, measure, null).height).toBeGreaterThan(300);
    for (const f of ["src/redesign/adapters/receiptImage.ts", "server/receiptDraw.js"]) expect(readFileSync(f, "utf8")).toContain("layoutReceipt");
  });
});

// ── g. pill contrast + Orders footer ─────────────────────────────────────────
describe("buyer-tag pill contrast", () => {
  const css = readFileSync("src/styles/design-tokens.css", "utf8");
  const block = (sel: string) => css.slice(css.indexOf(sel), css.indexOf("}", css.indexOf(sel)));
  const tok = (b: string, name: string) => parseColor(new RegExp(`${name}:\\s*([^;]+);`).exec(b)![1].trim());
  const themes = { light: block('[data-redesign][data-theme="light"] {'), dark: block('[data-redesign][data-theme="dark"] {') };
  it("4.5:1 or better in both themes with the readable colors", () => {
    for (const [name, b] of Object.entries(themes)) {
      const surface = tok(b, "--surface");
      const okBg = over([...tok(b, "--ok").slice(0, 3), 0.16] as never, surface);
      const newBg = over(tok(b, "--danger-soft"), surface);
      expect(contrastRatio(tok(b, "--btag-old-fg"), okBg), `${name} old`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(tok(b, "--btag-new-fg"), newBg), `${name} new`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it("the old fixed dark text was unreadable in dark mode (why this exists)", () => {
    const b = themes.dark;
    const okBg = over([...tok(b, "--ok").slice(0, 3), 0.16] as never, tok(b, "--surface"));
    expect(contrastRatio(parseColor("#166534"), okBg)).toBeLessThan(4.5);
  });
  it("readable → theme colors; default → today's fixed colors", () => {
    const r = render(<TProvider lang="en"><BuyerTagPill tag="old" readable /><BuyerTagPill tag="new" /></TProvider>);
    const pills = r.getAllByTestId("buyer-tag");
    expect(pills[0].getAttribute("style")).toContain("var(--btag-old-fg, #166534)");
    expect(pills[1].getAttribute("style")).toContain("color: rgb(153, 27, 27)");
  });
  it("Orders row footer wraps on narrow phones only with the switch ON", () => {
    const o: Order = { id: "#1", buyer: "Ann", handle: "@ann", items: "A1", qty: 1, total: 100, status: "New", platform: "Facebook", time: "9:41 PM", orderNum: 1, date: "2026-10-09" };
    const on = render(<TProvider lang="th"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[o]} state="live" todayId="2026-10-09" fbPolish /></TProvider>);
    expect((on.getByTestId("ord-row-foot") as HTMLElement).style.flexWrap).toBe("wrap");
    on.unmount();
    const off = render(<TProvider lang="th"><Orders onGoPrint={vi.fn()} cur="NT$" orders={[o]} state="live" todayId="2026-10-09" /></TProvider>);
    expect((off.getByTestId("ord-row-foot") as HTMLElement).style.flexWrap).toBe("");
  });
});

// ── f. text batch (NOT switched) + wording rule ──────────────────────────────
describe("text batch", () => {
  const tw = buildT("zh-TW") as unknown as Record<string, string>;
  it("Filipino words", () => {
    expect(fil.rd_wl_skip).toBe("Skip");
    expect(fil.rd_rc_opening).toContain("Bati sa simula");
    expect(fil.rd_ord_mark_paid).toContain("I-mark na bayad");
    expect(fil.rd_fb_auth_error_toast).toBe("Hindi gumana ang Facebook — try ulit.");
    expect(fil.rd_fb_connected_toast).toBe("Naka-connect na sa Facebook!");
    expect(fil.rd_ord_expired).toBe("Di pa bayad (1 araw+)");
    expect(fil.rd_wl_title).toBe("Pila ng naghihintay (sold out)");
    expect(fil.rd_rc_auto_title).toBe("Kusang magpadala ng resibo pagkatapos ng live (Plus pataas)");
  });
  it("English words", () => {
    expect(t.rd_wl_title).toBe("Waiting list (sold-out buyers)");
    expect(t.rd_ord_expired).toBe("Unpaid 24h+");
    expect(t.rd_rc_auto_title).toBe("Send receipts automatically after the live (Plus plan and up)");
  });
  it("zh-TW: 給單, the App's comment list, one word for Page and for 'you', no '·' as a full stop", () => {
    expect(tw.rd_prd_rs_waitlist).toContain("從候補名單給單");
    expect(tw.rd_wl_give).not.toContain("給他");
    expect(tw.rd_fb_section_sub).toContain("顯示在 App 的留言列表");
    const fbKeys = Object.keys(tw).filter((k) => /^(rd_fb_|rd_rc_|rd_rs_|rd_wl_|rd_dash_fb|rd_ch_fb|rd_ch_pop_body_fb)/.test(k));
    for (const k of fbKeys) {
      expect(tw[k], k).not.toContain("粉絲專頁");
      expect(tw[k], k).not.toContain(" · ");
      if (k !== "rd_rc_so_default" && k !== "rd_rc_opening_ph") expect(tw[k], k).not.toContain("您"); // texts buyers read keep 您
    }
  });
  it("the sold-out default stays English in vi / th / id / bg", () => {
    for (const l of ["vi", "th", "id", "bg"] as const) expect((buildT(l) as unknown as Record<string, string>).rd_rc_so_default).toBe(t.rd_rc_so_default);
  });
  it("new en / fil strings: seller words only, at most 2 sentences", () => {
    const keys = ["rd_fb_err_expired", "rd_fb_err_no_answer", "rd_fb_err_refused", "rd_rs_too_old", "rd_rs_no_access", "rd_rs_again_confirm", "rd_rs_again_cancel", "rd_rs_again_send", "rd_rc_sub_live", "rd_wl_title", "rd_ord_expired", "rd_rc_auto_title"] as const;
    for (const tl of [t, fil]) for (const k of keys) {
      const s = (tl as unknown as Record<string, string>)[k];
      expect(s, k).not.toMatch(/server|poller|token|\bAPI\b|limit|feature|device|restart|timeout|\(FB|\bcode\b/i);
      expect(s.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length, k).toBeLessThanOrEqual(2);
    }
  });
});
