// Settings → Invoicing → Facebook tab (Jeff, 2026-11-26).
//   • a seller WITHOUT the Receipt add-on: a locked card — lock icon, "Facebook invoicing", one line,
//     "Ask Admin to turn it on" = a real Telegram link with a ready message (the Website teaser's
//     helper), "Opens Telegram @SellerFlowLive". No price, no "upgrade", in every language;
//   • the same card on the web, the Android app and the iPhone app;
//   • a seller WITH the add-on: the tab is exactly main's (markup recorded on main 58d780b in
//     fixtures/invoicingFbAddon.main.json — re-record it there if that card changes on purpose).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act, cleanup } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

vi.mock("../../../supabase", async () => {
  const { DB } = await import("../../adapters/__tests__/invoiceFakeDb");
  return { isSupabaseConfigured: true, supabase: DB.supabase };
});

import { TProvider, buildT, tpl } from "../../i18n";
import Invoicing from "../Invoicing";
import { DB } from "../../adapters/__tests__/invoiceFakeDb";
import { telegramDraftUrl, TELEGRAM_HANDLE, TELEGRAM_URL } from "../../../lib/telegram";

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
type Lang = (typeof LANGS)[number];
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const flush = async () => { for (let i = 0; i < 8; i++) await act(async () => { await Promise.resolve(); }); };
const MAIN = JSON.parse(readFileSync(join(__dirname, "fixtures/invoicingFbAddon.main.json"), "utf8")) as Record<Lang, string>;

async function openFb(lang: Lang = "en", onReceiptFormat?: () => void) {
  render(
    <TProvider lang={lang}>
      <div data-redesign="">
        <Invoicing cur="₱" onBack={() => {}} buyers={[]} sessionKey="S1" sellerId="u1" todayId="2026-11-26" tapGuardMs={0} {...(onReceiptFormat ? { onReceiptFormat } : {})} />
      </div>
    </TProvider>,
  );
  await flush();
  fireEvent.click(q("ivc-tab-facebook")!);
}
const setBuild = (b: "web" | "android" | "ios") => {
  const w = window as unknown as { Capacitor?: unknown };
  if (b === "web") delete w.Capacitor;
  else w.Capacitor = { getPlatform: () => b, isNativePlatform: () => true, Plugins: {} };
  window.history.replaceState({}, "", b === "ios" ? "/?ios=1" : "/");
};

beforeEach(() => { DB.reset(); localStorage.clear(); setBuild("web"); });
afterEach(() => { cleanup(); setBuild("web"); });

describe("Facebook tab, a seller without the Receipt add-on", () => {
  it("the locked card: icon, title, line, the button and the Telegram line — and not today's Soon card", async () => {
    await openFb();
    const t = buildT("en");
    expect(q("ivc-fb-locked")).not.toBeNull();
    expect(q("ivc-fb-lock-icon")!.querySelector("svg")).not.toBeNull();
    expect(q("ivc-fb-lock-title")!.textContent).toBe("Facebook invoicing");
    expect(q("ivc-fb-lock-body")!.textContent).toBe("Send every Facebook buyer their invoice in Messenger — automatically, in one tap.");
    expect(q("ivc-fb-lock-ask")!.textContent).toBe("Ask Admin to turn it on");
    expect(q("ivc-fb-lock-hint")!.textContent).toBe("Opens Telegram @SellerFlowLive");
    expect(t.rd_ivc_fb_lock_title).toBe("Facebook invoicing");
    expect(q("ivc-soon-facebook")).toBeNull();
    expect(q("ivc-receipt-format")).toBeNull();
    expect(q("ivc-send-next")).toBeNull();          // nothing to send on this tab
  });
  it("the button is a real link to the Telegram chat with the ready message (the Website teaser's helper)", async () => {
    await openFb();
    const a = q("ivc-fb-lock-ask") as HTMLAnchorElement;
    expect(a.tagName).toBe("A");
    expect(a.getAttribute("href")).toBe(telegramDraftUrl("Hi Admin, I'd like Facebook invoicing."));
    expect(a.getAttribute("href")).toBe(`${TELEGRAM_URL}?text=${encodeURIComponent("Hi Admin, I'd like Facebook invoicing.")}`);
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noreferrer");
    expect(a.style.minHeight).toBe("46px");          // ≥ 44 px tap target
  });
  it("the same card, word for word, on the web, the Android app and the iPhone app", async () => {
    const html: string[] = [];
    for (const b of ["web", "android", "ios"] as const) {
      setBuild(b);
      await openFb();
      html.push(q("ivc-fb-locked")!.outerHTML);
      cleanup();
    }
    expect(html[1]).toBe(html[0]);
    expect(html[2]).toBe(html[0]);
  });
  it("all 8 languages: filled, the Telegram line names @SellerFlowLive, the link carries that language's message, no price / upgrade words", async () => {
    for (const lang of LANGS) {
      const t = buildT(lang);
      for (const k of ["rd_ivc_fb_lock_title", "rd_ivc_fb_lock_body", "rd_ivc_fb_lock_btn", "rd_ivc_fb_lock_hint", "rd_ivc_fb_lock_msg"] as const) expect(String(t[k]).trim(), `${lang} ${k}`).not.toBe("");
      await openFb(lang);
      const card = q("ivc-fb-locked")!;
      expect(q("ivc-fb-lock-hint")!.textContent).toBe(tpl(t.rd_ivc_fb_lock_hint, { handle: TELEGRAM_HANDLE }));
      expect(q("ivc-fb-lock-hint")!.textContent).toContain("@SellerFlowLive");
      expect(q("ivc-fb-lock-ask")!.getAttribute("href")).toBe(telegramDraftUrl(t.rd_ivc_fb_lock_msg));
      const words = `${card.textContent} ${t.rd_ivc_fb_lock_msg}`;
      expect(words, lang).not.toMatch(/NT\$|₱|\$\s?\d|\d+\s?(?:\/\s?mo|per month)|price|upgrade|subscri|plan\b/i);
      cleanup();
    }
  });
});

describe("Facebook tab, a seller with the Receipt add-on", () => {
  it("exactly main's card (Soon line + Receipt format), in all 8 languages — no locked card", async () => {
    for (const lang of LANGS) {
      await openFb(lang, () => {});
      expect(q("ivc-fb-locked")).toBeNull();
      expect(q("ivc-soon-facebook")!.outerHTML, lang).toBe(MAIN[lang]);
      cleanup();
    }
  });
  it("its Receipt format button still opens Receipt format", async () => {
    const go = vi.fn();
    await openFb("en", go);
    fireEvent.click(q("ivc-receipt-format")!);
    expect(go).toHaveBeenCalledTimes(1);
  });
});

describe("the other tabs are not touched", () => {
  it("Instagram and Shopee still say Soon, with or without the add-on", async () => {
    for (const has of [false, true]) {
      await openFb("en", has ? () => {} : undefined);
      for (const p of ["instagram", "shopee"] as const) {
        fireEvent.click(q(`ivc-tab-${p}`)!);
        expect(q(`ivc-soon-${p}`)).not.toBeNull();
        expect(q("ivc-fb-locked")).toBeNull();
      }
      cleanup();
    }
  });
});
