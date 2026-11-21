// "Choose price before print" — Settings with up to 9 prices. The list layout is today's (one price per
// row on phones, auto-fill on wider screens); below 9 the Price + Add row shows as today; at 9 it is gone
// and ONE short note says "9 of 9 prices saved. Remove one to add a new price." (8 languages).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import GeneralSettings from "../GeneralSettings";
import { TProvider, buildT } from "../../i18n";
import type { AccountUser } from "../../../accountDb";
import type { AutoControls } from "../../data";

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
const account: AccountUser = {
  authUserId: "u1", email: "g@x.com",
  profile: { fullName: "Test Owner", storeName: "Test Shop", phone: "0900", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};
const noop = () => {};
const saved = vi.fn();

function App({ prices: init, lang = "en" }: { prices: number[]; lang?: string }) {
  const [prices, setPrices] = useState<number[]>(init);
  const auto: AutoControls = { detect: false, toggle: noop };
  return (
    <TProvider lang={lang}>
      <GeneralSettings
        theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
        auto={auto} cur="₱" lang={lang} onSetLang={noop} currency="PHP" onSetCurrency={noop}
        profileOpen={false} onToggleProfile={noop} keepAwake onToggleKeepAwake={noop} pinPrint={false} onTogglePinPrint={noop}
        liveSessionOpen onToggleLiveSession={noop}
        printerIdx={0} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
        onSubscription={noop} onSupport={noop} onDelete={noop}
        account={account} onSaveProfile={vi.fn().mockResolvedValue({ ok: true })} onManageChannel={noop}
        samePriceEnabled={false} samePrice={null} onSetSamePriceEnabled={async () => true}
        choosePriceEnabled choosePrices={prices}
        onSetChoosePriceEnabled={async () => true}
        onSetChoosePrices={(p: number[]) => { saved(p); setPrices(p); }}
        chooseShowFree onSetChooseShowFree={noop}
        onToast={noop}
      />
    </TProvider>
  );
}
const EIGHT = [50, 80, 100, 120, 150, 180, 200, 250];
const add = (v: string) => { fireEvent.change(screen.getByTestId("cpp-add-input"), { target: { value: v } }); fireEvent.click(screen.getByTestId("cpp-add-btn")); };

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe("Settings — up to 9 prices", () => {
  it("8 prices: the Price + Add row shows as today, no note", () => {
    render(<App prices={EIGHT} />);
    expect(screen.getByTestId("cpp-add-input")).toBeTruthy();
    expect(screen.getByTestId("cpp-add-btn")).toBeTruthy();
    expect(screen.queryByTestId("cpp-full")).toBeNull();
    expect(screen.queryByTestId("cpp-add-err")).toBeNull();
  });

  it("the 9th price is added at the end; then the Add row is gone and the 9-of-9 note shows", () => {
    const t = buildT("en");
    render(<App prices={EIGHT} />);
    add("300");
    expect(saved).toHaveBeenLastCalledWith([...EIGHT, 300]);
    expect(screen.getByTestId("cpp-chip-8").textContent).toContain("₱300");
    expect(screen.queryByTestId("cpp-add-input")).toBeNull();
    expect(screen.queryByTestId("cpp-add-btn")).toBeNull();
    const note = screen.getByTestId("cpp-full");
    expect(note.textContent).toBe(t.rd_cpp_full);
    expect(note.textContent).toBe("9 of 9 prices saved. Remove one to add a new price.");
    expect(note.getAttribute("role")).toBe("status");
    expect(screen.queryByTestId("cpp-add-err")).toBeNull();            // not an error
  });

  it("removing one of the 9 brings the Add row back and the note goes", () => {
    render(<App prices={[...EIGHT, 300]} />);
    expect(screen.getByTestId("cpp-full")).toBeTruthy();
    fireEvent.click(screen.getByTestId("cpp-remove-4"));
    expect(saved).toHaveBeenLastCalledWith([50, 80, 100, 120, 180, 200, 250, 300]);
    expect(screen.getByTestId("cpp-add-input")).toBeTruthy();
    expect(screen.queryByTestId("cpp-full")).toBeNull();
  });

  it("☆ and × still work on the 7th–9th price (44 px targets, the default badge on the first)", () => {
    render(<App prices={[...EIGHT, 300]} />);
    for (let i = 1; i < 9; i++) {
      const star = screen.getByTestId(`cpp-make-default-${i}`) as HTMLElement;
      const x = screen.getByTestId(`cpp-remove-${i}`) as HTMLElement;
      expect([star.style.width, star.style.height, x.style.width, x.style.height]).toEqual(["44px", "44px", "44px", "44px"]);
    }
    fireEvent.click(screen.getByTestId("cpp-make-default-8"));
    expect(saved).toHaveBeenLastCalledWith([300, ...EIGHT]);
    expect(screen.getByTestId("cpp-chip-0").textContent).toContain("₱300");
    expect(screen.getByTestId("cpp-default-badge")).toBeTruthy();
  });

  it("the list layout is today's: one grid, auto-fill columns of at least 200 px (one per row on a phone)", () => {
    render(<App prices={[...EIGHT, 300]} />);
    const grid = screen.getByTestId("cpp-chip-0").parentElement as HTMLElement;
    expect(grid.style.gridTemplateColumns).toBe("repeat(auto-fill, minmax(200px, 1fr))");
    expect(grid.children).toHaveLength(9);
  });

  it("the hint says up to 9", () => {
    render(<App prices={[50]} />);
    expect(screen.getByTestId("cpp-area").textContent).toContain(buildT("en").rd_cpp_list_hint);
    expect(buildT("en").rd_cpp_list_hint).toBe("Your prices (up to 9). The first one is the default.");
  });

  it.each(LANGS)("%s: the three texts say 9, never 6, and the note shows in that language", (lang) => {
    const t = buildT(lang);
    for (const k of ["rd_cpp_full", "rd_cpp_list_hint", "rd_cpp_err_max"] as const) {
      expect(t[k], k).toBeTruthy();
      expect(t[k], k).toMatch(/9/);
      expect(t[k], k).not.toMatch(/6/);
    }
    if (lang !== "en") expect(t.rd_cpp_full).not.toBe(buildT("en").rd_cpp_full);
    render(<App prices={[...EIGHT, 300]} lang={lang} />);
    expect(screen.getByTestId("cpp-full").textContent).toBe(t.rd_cpp_full);
  });
});
