// BLACKLIST on the live comment rows + the dates sheet. FAKE DATA ONLY.
//   • no map (Taiwan, switch off, not a tester) → the rows are byte-identical to today;
//   • a blacklisted buyer: red tint + the chip ON ITS OWN LINE under the comment; exact match only;
//   • the name opens the dates sheet ("Alert only — the order still prints as usual.");
//   • alert only: 1-Click / Type price get exactly the same calls with or without the list.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, fireEvent, screen } from "@testing-library/react";
import { TProvider, buildT } from "../../i18n";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: false, supabase: null }));
vi.mock("../../adapters/useRaffleConfig", () => ({
  useRaffleConfig: () => ({ enabled: false, enabledAt: null, loading: false, toggle: vi.fn() }),
}));
beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

import Dashboard from "../Dashboard";
import BlacklistSheet from "../../components/BlacklistSheet";
import type { Comment } from "../../data";
import { blacklistMap, groupBlacklist, type BlRow } from "../../adapters/blacklist";

const t = buildT("en");
const c = (id: string, name: string, handle: string, platform: string, text = "mine A"): Comment =>
  ({ id, name, handle, text, mine: true, time: "9:41:00 PM", platform } as Comment);
const FEED = [
  c("c1", "Maria", "@maria_shop", "TikTok", "mine A"),
  c("c2", "Ana Reyes", "100009988", "Facebook", "mine 2"),
  c("c3", "Liza", "@lizamae", "TikTok", "magkano po"),
  c("c4", "maria_shop", "@someone_else", "TikTok", "mine B"),   // the NICKNAME is maria_shop — never a match
  c("c5", "Ana Reyes", "@ana_reyes", "Instagram", "mine C"),    // Instagram never matches
  c("c6", "Maria", "@maria_shop2", "TikTok", "mine D"),         // never a partial match
];
const row = (id: string, platform: "tiktok" | "facebook", label: string, reason: "returned" | "not_checked_out", day: string): BlRow =>
  ({ id, platform, label, reason, day, createdAt: `${day}T10:00:00Z` });
const LIST = groupBlacklist([
  row("r1", "tiktok", "Maria_Shop", "returned", "2026-11-18"), row("r2", "tiktok", "maria_shop", "returned", "2026-11-02"),
  row("r3", "tiktok", "maria_shop", "not_checked_out", "2026-10-30"), row("r4", "facebook", "Ana Reyes", "not_checked_out", "2026-11-16"),
]);
const MAP = blacklistMap(LIST);
const noop = () => {};
const props = (onOneClick = noop as (...a: unknown[]) => void, onOpenEnt = noop as (...a: unknown[]) => void) => ({
  comments: FEED, cur: "₱", historyReady: true,
  ttOpen: false, fbOpen: false, ttIdx: 0, fbIdx: 0,
  onToggleTT: noop, onToggleFB: noop, onPickTT: noop, onPickFB: noop,
  ttConnected: true, fbConnected: false, ttConnecting: false, fbConnecting: false,
  onConnectTT: noop, onConnectFB: noop,
  printed: {}, entId: null, entPrice: "",
  onOneClick, onOpenEnt, onEntPrice: noop, onEntKey: noop,
});
const rowOf = (container: HTMLElement, text: string) =>
  ([...container.querySelectorAll(".sfl-comm-row")] as HTMLElement[]).find((r) => r.textContent?.includes(text))!;

describe("not on the list / no list — nothing changes", () => {
  it("no map: no blacklist markup, byte-identical to the props being undefined", () => {
    const a = render(<TProvider lang="en"><Dashboard {...props()} /></TProvider>).container;
    expect(a.querySelector("[data-blacklist]")).toBeNull();
    expect(a.querySelector("[data-testid^='bl-']")).toBeNull();
    const html = a.innerHTML;
    const b = render(<TProvider lang="en"><Dashboard {...props()} blacklist={undefined} onBlacklistTap={undefined} /></TProvider>).container.innerHTML;
    expect(html).toBe(b);
    const empty = render(<TProvider lang="en"><Dashboard {...props()} blacklist={new Map()} onBlacklistTap={noop} /></TProvider>).container.innerHTML;
    expect(empty).toBe(html);
  });
});

describe("a blacklisted buyer on the live", () => {
  it("TikTok by @username, Facebook by name — red tint and the chip on its own line under the comment", () => {
    const { container } = render(<TProvider lang="en"><Dashboard {...props()} blacklist={MAP} onBlacklistTap={noop} /></TProvider>);
    const marked = [...container.querySelectorAll("[data-blacklist='1']")].map((r) => r.textContent);
    expect(marked).toHaveLength(2);
    const tt = rowOf(container, "mine A");
    expect(tt.getAttribute("data-blacklist")).toBe("1");
    expect(tt.style.background).toBe("var(--danger-soft)");
    const chip = tt.querySelector("[data-testid='bl-chip']")!;
    expect(chip.textContent).toBe("⛔ 2× Return · 1× Not checked out");
    // its own line: the chip line comes right AFTER the comment-text line, not inside the name line
    const line = chip.closest("[data-testid='bl-chip-line']")!;
    expect(line.previousElementSibling?.textContent).toContain("mine A");
    expect(line.parentElement!.firstElementChild!.contains(chip)).toBe(false);
    expect(rowOf(container, "mine 2").querySelector("[data-testid='bl-chip']")!.textContent).toBe("⛔ 1× Not checked out");
  });
  it("exact match only: a nickname, Instagram, a longer username — no tint, no chip", () => {
    const { container } = render(<TProvider lang="en"><Dashboard {...props()} blacklist={MAP} onBlacklistTap={noop} /></TProvider>);
    for (const text of ["magkano po", "mine B", "mine C", "mine D"]) {
      const r = rowOf(container, text);
      expect(r.getAttribute("data-blacklist"), text).toBeNull();
      expect(r.querySelector("[data-testid='bl-chip']"), text).toBeNull();
    }
  });
  it("tapping the name gives the buyer's entry (for the dates sheet)", () => {
    const onTap = vi.fn();
    const { container } = render(<TProvider lang="en"><Dashboard {...props()} blacklist={MAP} onBlacklistTap={onTap} /></TProvider>);
    fireEvent.click(rowOf(container, "mine A").querySelector("[data-testid='bl-name']")!);
    expect(onTap).toHaveBeenCalledTimes(1);
    expect(onTap.mock.calls[0][0]).toMatchObject({ platform: "tiktok", key: "maria_shop", returned: 2, notCheckedOut: 1 });
  });
  it("alert only: 1-Click and Type price get the very same calls with or without the list", () => {
    const tapAll = (withList: boolean) => {
      const one = vi.fn(), ent = vi.fn();
      const { container, unmount } = render(<TProvider lang="en"><Dashboard {...props(one, ent)} {...(withList ? { blacklist: MAP, onBlacklistTap: noop } : {})} /></TProvider>);
      for (const text of ["mine A", "mine 2", "magkano po"]) {
        const r = rowOf(container, text);
        fireEvent.click([...r.querySelectorAll("button")].find((b) => b.textContent?.includes(t.rd_dash_1click))!);
      }
      for (const text of ["mine A", "mine 2"]) {
        const r = rowOf(container, text);
        const typeBtn = [...r.querySelectorAll("button")].find((b) => b.textContent?.includes(t.rd_dash_enterprise));
        if (typeBtn) fireEvent.click(typeBtn);
      }
      unmount();
      return { one: one.mock.calls, ent: ent.mock.calls };
    };
    const without = tapAll(false), withList = tapAll(true);
    expect(without.one.length).toBe(3);
    expect(without.ent.length).toBe(2);
    expect(withList).toEqual(without);
  });
});

describe("the dates sheet", () => {
  it("both counts, every date with its reason, and 'Alert only'", () => {
    render(<TProvider lang="en"><div data-redesign=""><BlacklistSheet entry={LIST[0]} onClose={noop} /></div></TProvider>);
    expect(screen.getByTestId("bl-sheet-buyer").textContent).toBe("@Maria_Shop");
    expect(screen.getByTestId("bl-stat-ret").textContent).toContain("2");
    expect(screen.getByTestId("bl-stat-notout").textContent).toContain("1");
    expect(screen.getAllByTestId("bl-date").map((d) => d.textContent)).toEqual(["Return itemNov 18, 2026", "Return itemNov 2, 2026", "Not checked outOct 30, 2026"]);
    expect(screen.getByTestId("bl-alert-only").textContent).toBe("Alert only — the order still prints as usual.");
  });
  it("Close and a tap outside close it; it writes nothing", () => {
    const onClose = vi.fn();
    render(<TProvider lang="en"><div data-redesign=""><BlacklistSheet entry={LIST[0]} onClose={onClose} /></div></TProvider>);
    fireEvent.click(screen.getByTestId("bl-sheet-close"));
    fireEvent.click(screen.getByTestId("bl-sheet-overlay"));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
