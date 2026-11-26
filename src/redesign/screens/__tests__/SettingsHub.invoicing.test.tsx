// Settings tab — the "Invoicing" card (Jeff, 2026-11-26). It replaces the "Receipt format" tile.
//   • everyone sees ONE card: every plan, iPhone, Android, web — whatever else the Settings tab shows;
//   • it sits right after the Website card (the open one, the "Soon" teaser, or where it would be);
//   • filled accent chip with the receipt icon, title, sub-line, "Soon" on the right, 1.5px accent border,
//     the Website card's shape;
//   • the tap calls what the app passes (the app decides: the Receipt format screen, or a short note);
//   • the old "Receipt format" tile is gone for everyone;
//   • the three texts exist in all 8 languages, with no price / payment words.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import { TProvider, buildT } from "../../i18n";
import SettingsHub from "../SettingsHub";

afterEach(() => { cleanup(); window.history.replaceState({}, "", "/"); });

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
const base = { onGeneral: vi.fn(), onCustomers: vi.fn(), onAdmin: vi.fn(), onCustomerData: vi.fn(), onLegal: vi.fn(), onDelete: vi.fn(), onLogout: vi.fn() };
const hub = (extra: Record<string, unknown> = {}, lang: string = "en") =>
  render(<TProvider lang={lang}><SettingsHub {...base} {...extra} /></TProvider>);
const q = (c: HTMLElement, id: string) => c.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const t = buildT("en");

// what a Settings tab can look like: a Free seller, a paid Taiwan seller, an admin, a tester with everything
const KINDS: Record<string, Record<string, unknown>> = {
  "a Free seller (nothing extra)": {},
  "a paid seller in Taiwan": { onParcelScan: vi.fn(), onCustomerDetails: vi.fn(), onParcelTracking: vi.fn(), onParcelSoon: vi.fn(), shippingSoon: true },
  "a locked (Basic) seller": { parcelLocked: true, pickupLocked: true, onParcelUpsell: vi.fn(), onParcelSoon: vi.fn() },
  "an admin": { isAdmin: true, onShipping: vi.fn(), onWebsite: vi.fn(), onParcelScan: vi.fn(), onFmScan: vi.fn() },
  "a seller with the Website teaser": { websiteTeaser: true },
  "a seller outside Taiwan with Blacklist + the help bot": { onBlacklist: vi.fn(), blacklistNew: true, helpBot: true },
};

describe("the Invoicing card", () => {
  for (const [who, props] of Object.entries(KINDS)) {
    it(`${who}: ONE card, with the title, the sub-line and "Soon"; no "Receipt format" tile`, () => {
      const { container } = hub({ ...props, onInvoicing: vi.fn() });
      const cards = container.querySelectorAll("[data-testid='tile-invoicing']");
      expect(cards).toHaveLength(1);
      const card = cards[0] as HTMLElement;
      expect(card.textContent).toBe(`${t.rd_invoice_title}${t.rd_invoice_sub}${t.rd_soon}`);
      expect(t.rd_invoice_title).toBe("Invoicing");
      expect(t.rd_invoice_sub).toBe("Send every buyer their invoice in minutes");
      expect(q(card, "invoicing-soon")!.textContent).toBe("Soon");
      expect(q(container, "tile-receipt-format")).toBeNull();
      expect(container.textContent).not.toContain(t.rd_rc_title);          // the words "Receipt format" are nowhere on the tab
    });
  }
  it("the same card on the iPhone app (?ios=1)", () => {
    window.history.replaceState({}, "", "/?ios=1");
    const { container } = hub({ onInvoicing: vi.fn() });
    expect(q(container, "tile-invoicing")!.textContent).toBe(`${t.rd_invoice_title}${t.rd_invoice_sub}${t.rd_soon}`);
  });
  it("it is shown even when the app passes no handler (a tap then does nothing, it never throws)", () => {
    const { container } = hub();
    expect(q(container, "tile-invoicing")).not.toBeNull();
    expect(() => fireEvent.click(q(container, "tile-invoicing")!)).not.toThrow();
  });

  it("PLACE: right after the Website card — the open one, the Soon teaser, or straight after Invite friends when there is none", () => {
    const next = (c: HTMLElement, id: string) => (q(c, id)!.nextElementSibling as HTMLElement).getAttribute("data-testid");
    expect(next(hub({ onWebsite: vi.fn() }).container, "tile-website")).toBe("tile-invoicing");
    cleanup();
    expect(next(hub({ websiteTeaser: true }).container, "tile-website-soon")).toBe("tile-invoicing");
    cleanup();
    const { container } = hub();
    const card = q(container, "tile-invoicing")!;
    expect(q(container, "tile-website")).toBeNull();
    expect(q(container, "tile-website-soon")).toBeNull();
    expect(card.parentElement!.children[1]).toBe(card);                     // [0] = Invite friends
    expect((card.nextElementSibling as HTMLElement).textContent).toBe(t.rd_sh_general);   // General Settings follows
  });
  it("it is on the Settings tab itself, not inside another tile, and there is only one grid", () => {
    const { container } = hub({ onWebsite: vi.fn(), onInvoicing: vi.fn() });
    const card = q(container, "tile-invoicing")!;
    expect(card.parentElement).toBe(q(container, "tile-website")!.parentElement);
    expect(card.tagName).toBe("BUTTON");
  });

  it("LOOK: full width, 1.5px accent border, a FILLED accent chip with the receipt icon, the Website card's shape and spacing", () => {
    const { container } = hub({ onWebsite: vi.fn() });
    const card = q(container, "tile-invoicing")!, web = q(container, "tile-website")!;
    expect(card.style.gridColumn).toBe("1 / -1");
    expect(card.style.border).toBe("1.5px solid var(--accent)");
    for (const k of ["display", "alignItems", "gap", "padding", "borderRadius", "background", "boxShadow", "textAlign", "gridColumn"] as const) {
      expect(card.style[k], k).toBe(web.style[k]);
    }
    const chip = q(card, "invoicing-chip")!, webChip = web.querySelector("span")!;
    expect(chip.style.background).toBe("var(--accent)");                    // filled, not the soft tint
    expect(chip.style.color).toBe("var(--accent-text)");
    expect(webChip.style.background).toBe("var(--accent-soft)");            // the Website chip keeps its soft tint
    for (const k of ["width", "height", "borderRadius", "flexShrink"] as const) expect(chip.style[k], k).toBe(webChip.style[k]);
    expect(chip.querySelector("svg path")!.getAttribute("d")).toContain("M6 3h12v18");   // the receipt drawing
  });
  it("320 px phone: the text column can shrink and wrap, the badge never shrinks or wraps", () => {
    const { container } = hub();
    const card = q(container, "tile-invoicing")!;
    const column = card.children[1] as HTMLElement, badge = q(card, "invoicing-soon")!;
    expect(column.style.minWidth).toBe("0px");
    expect(column.style.flexDirection).toBe("column");
    expect((column.children[1] as HTMLElement).style.whiteSpace).toBe("");   // the sub-line wraps
    expect(badge.style.flexShrink).toBe("0");
    expect(badge.style.whiteSpace).toBe("nowrap");
    expect(badge.style.marginLeft).toBe("auto");
    // never wider than the screen minus the tab's 14 px sides — even when the tile pairs below are (long labels at 320 px)
    expect(card.style.maxWidth).toBe("calc(100vw - 28px)");
  });

  it("TAP: one call of what the app passed, nothing else (no other tile's handler, no link, no window opened)", () => {
    const onInvoicing = vi.fn();
    const others = { onGeneral: vi.fn(), onCustomers: vi.fn(), onWebsite: vi.fn(), onParcelUpsell: vi.fn(), onParcelSoon: vi.fn() };
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const { container } = hub({ ...others, onInvoicing });
    const card = q(container, "tile-invoicing")!;
    fireEvent.click(card);
    expect(onInvoicing).toHaveBeenCalledTimes(1);
    for (const f of Object.values(others)) expect(f).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(card.closest("a")).toBeNull();                                   // not a link: no Telegram, nothing sent
    expect(card.querySelector("a")).toBeNull();
    open.mockRestore();
  });
  it("the Website teaser keeps its own Soon badge and its Telegram link (not changed by the new card)", () => {
    const { container } = hub({ websiteTeaser: true });
    expect(container.querySelectorAll("[data-testid='soon-badge']")).toHaveLength(1);
    expect(q(container, "tile-website-soon")!.getAttribute("href")).toContain("t.me/");
  });
});

describe("the texts", () => {
  it("title, sub-line and the note exist in all 8 languages; the card shows them", () => {
    for (const lang of LANGS) {
      const tt = buildT(lang);
      for (const k of ["rd_invoice_title", "rd_invoice_sub", "rd_invoice_soon_note"] as const) expect(String(tt[k] || "").trim().length, `${lang} ${k}`).toBeGreaterThan(1);
      const { container } = hub({}, lang);
      expect(q(container, "tile-invoicing")!.textContent, lang).toBe(`${tt.rd_invoice_title}${tt.rd_invoice_sub}${tt.rd_soon}`);
      cleanup();
    }
    expect(buildT("en").rd_invoice_soon_note).toBe("Coming soon: send each buyer their invoice in a few minutes after your live.");
  });
  it("only English and Filipino may equal the English text (every other language is its own)", () => {
    const en = buildT("en");
    for (const lang of LANGS.filter((l) => l !== "en" && l !== "fil")) {
      const tt = buildT(lang);
      expect(tt.rd_invoice_sub, lang).not.toBe(en.rd_invoice_sub);
      expect(tt.rd_invoice_soon_note, lang).not.toBe(en.rd_invoice_soon_note);
    }
  });
  it("no price / payment / plan words in any language (the iPhone app shows the same texts)", () => {
    const BAD = /\b(pay|paid|payment|price|subscri\w*|upgrade|plan|buy|purchase|fee|bayad|presyo|bili)\b|NT\$|₱|\$|付款|支付|价格|價格|订阅|訂閱|升级|升級|方案|ราคา|ชำระ|สมัคร|giá|thanh toán|gói|harga|bayar|langganan|цена|плащане|абонамент/i;
    for (const lang of LANGS) {
      const tt = buildT(lang);
      for (const k of ["rd_invoice_title", "rd_invoice_sub", "rd_invoice_soon_note"] as const) expect(tt[k], `${lang} ${k}`).not.toMatch(BAD);
    }
  });
  it("Chinese says 账单 / 帳單 (a bill), never 发票 / 發票 (the official tax receipt)", () => {
    for (const lang of ["zh", "zh-TW"] as const) {
      const tt = buildT(lang);
      for (const k of ["rd_invoice_title", "rd_invoice_sub", "rd_invoice_soon_note"] as const) expect(tt[k]).not.toMatch(/发票|發票/);
    }
    expect(buildT("zh-TW").rd_invoice_title).toBe("帳單");
  });
});
