// Orders header, mobile-first (Oct 14 2026): the chips + the 🗓 button stay on ONE line at every
// width (the chips scroll sideways, never wrap); Send to TikTok users see "🗓 Sessions ▾", a
// "Session · N" badge and a session empty state. Real widths (360 / 390 / 430 / 1280 px) were
// measured in a browser; jsdom has no layout, so here we pin the structure + the CSS rules.
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { readFileSync } from "node:fs";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: false, supabase: null }));
import { TProvider } from "../../i18n";
import Orders from "../Orders";
import type { Order } from "../../data";

const order = { id: "#3", buyer: "Ann", handle: "@ann", items: "A1", qty: 1, total: 350, time: "1:00 PM", platform: "TikTok", status: "New", date: "2026-10-14", orderNum: 1791900000000 } as Order;
const view = (p: { gated: boolean; lang?: string; orders?: Order[]; state?: "live" | "empty"; paid?: boolean }) =>
  render(<TProvider lang={p.lang || "en"}><Orders onGoPrint={vi.fn()} cur="NT$" orders={p.orders ?? [order]} state={p.state ?? "live"} buyers={[]} todayId="2026-10-14" tiktokSend={p.gated} paidFlag={p.paid} /></TProvider>);
const q = (id: string) => document.querySelector(`[data-testid='${id}']`) as HTMLElement | null;
const menuIds = () => Array.from(document.querySelectorAll("[role='menu'] [data-testid]")).map((e) => e.getAttribute("data-testid"));

describe("the 🗓 button", () => {
  it("Send to TikTok users: '🗓 Sessions ▾' (en + fil); the menu is This session + Past sessions", () => {
    const r = view({ gated: true });
    expect(q("ord-range")!.textContent).toBe("🗓 Sessions ▾");
    fireEvent.click(q("ord-range")!);
    expect(menuIds().slice(0, 2)).toEqual(["ord-range-session", "ord-past-heading"]);
    expect(q("ord-range-session")!.textContent).toBe("This session");
    r.unmount();
    view({ gated: true, lang: "fil" });
    expect(q("ord-range")!.textContent).toBe("🗓 Sessions ▾");
  });
  it("everyone else: labels and menu exactly as before (This session / Today / Last 7 days / Custom)", () => {
    view({ gated: false });
    expect(q("ord-range")!.textContent).toBe("🗓 This session ▾");
    fireEvent.click(q("ord-range")!);
    expect(menuIds()).toEqual(["ord-range-session", "ord-range-today", "ord-range-7days", "ord-range-custom"]);
    expect(Array.from(document.querySelectorAll("[role='menu'] button")).map((b) => b.textContent)).toEqual(["This session", "Today", "Last 7 days", "Custom"]);
  });
});

describe("one line: chips + button", () => {
  for (const gated of [true, false]) {
    it(`${gated ? "gated" : "ungated"}: the chips (incl. Unpaid) sit in one scroll row; the 🗓 button is beside it on the same line, outside the scroll`, () => {
      view({ gated, paid: true });
      const chips = q("ord-chips")!;
      expect(chips.className).toBe("sfl-ord-chips");
      expect(Array.from(chips.querySelectorAll("button")).map((b) => b.getAttribute("data-testid"))).toEqual(["ord-pf-all", "ord-pf-TikTok", "ord-pf-Facebook", "ord-unpaid-pill"]);
      const row = chips.parentElement!;
      expect(row.className).toBe("sfl-ord-filters");
      expect(row.contains(q("ord-range"))).toBe(true);
      expect(chips.contains(q("ord-range"))).toBe(false);          // the menu is never clipped by the scroll
      expect(row.getAttribute("style")).not.toMatch(/flex-wrap:\s*wrap/);
      for (const b of [...chips.querySelectorAll("button"), q("ord-range")!]) expect(b.className).toContain("sfl-tap44");
    });
  }
  it("CSS: nowrap, sideways scroll with no scrollbar, 44px tap areas", () => {
    const css = readFileSync("src/redesign/redesign.css", "utf8");
    const rule = (sel: string) => { const i = css.indexOf(`[data-redesign] ${sel} {`); expect(i, sel).toBeGreaterThan(-1); return css.slice(i, css.indexOf("}", i)); };
    expect(rule(".sfl-ord-filters")).toMatch(/flex-wrap: nowrap/);
    const chips = rule(".sfl-ord-chips");
    expect(chips).toMatch(/flex-wrap: nowrap/);
    expect(chips).toMatch(/overflow-x: auto/);
    expect(chips).toMatch(/scrollbar-width: none/);
    expect(css).toContain("[data-redesign] .sfl-ord-chips::-webkit-scrollbar { display: none; }");
    expect(css).toMatch(/\.sfl-tap44::after \{[^}]*height: 44px/);
  });
});

describe("badge + empty state", () => {
  it("gated: 'Session · N' and 'No orders yet in this session.'; ungated unchanged", () => {
    const g = view({ gated: true });
    expect(g.container.textContent).toContain("Session · 1");
    g.unmount();
    const u = view({ gated: false });
    expect(u.container.textContent).toContain("Today · 1");
    u.unmount();
    const ge = view({ gated: true, orders: [], state: "empty" });
    expect(ge.container.textContent).toContain("No orders yet in this session.");
    expect(ge.container.textContent).toContain("Session · 0");
    ge.unmount();
    const ue = view({ gated: false, orders: [], state: "empty" });
    expect(ue.container.textContent).toContain("No orders yet today.");
    expect(ue.container.textContent).toContain("Today · 0");
  });
});
