// "Choose price before print" — the Settings → Live setup row and its price list. Controlled
// wrapper mirrors RedesignApp (it owns both settings); the mutual exclusion lives in the screen.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import GeneralSettings from "../GeneralSettings";
import { TProvider, buildT } from "../../i18n";
import type { AccountUser } from "../../../accountDb";
import type { AutoControls } from "../../data";

const t = buildT("en");
const account: AccountUser = {
  authUserId: "u1", email: "g@x.com",
  profile: { fullName: "Test Owner", storeName: "Test Shop", phone: "0900", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};
const noop = () => {};
const spy = { sp: vi.fn(), cpOn: vi.fn(), cpPrices: vi.fn(), toast: vi.fn() };

// cpFails / spFails: the save of that switch fails (the handler answers false and nothing changes).
function App(init: { sp?: boolean; spPrice?: number | null; cp?: boolean; prices?: number[]; withCpp?: boolean; cpFails?: boolean; spFails?: boolean } = {}) {
  const [open, setOpen] = useState(true);
  const [sp, setSp] = useState(!!init.sp);
  const [spPrice, setSpPrice] = useState<number | null>(init.spPrice ?? null);
  const [cp, setCp] = useState(!!init.cp);
  const [prices, setPrices] = useState<number[]>(init.prices ?? []);
  const auto: AutoControls = { detect: false, toggle: noop };
  return (
    <TProvider lang="en">
      <GeneralSettings
        theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
        auto={auto} cur="₱" lang="en" onSetLang={noop} currency="PHP" onSetCurrency={noop}
        profileOpen={false} onToggleProfile={noop} keepAwake onToggleKeepAwake={noop} pinPrint={false} onTogglePinPrint={noop}
        liveSessionOpen={open} onToggleLiveSession={() => setOpen((o) => !o)}
        printerIdx={0} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
        onSubscription={noop} onSupport={noop} onDelete={noop}
        account={account} onSaveProfile={vi.fn().mockResolvedValue({ ok: true })} onManageChannel={noop}
        samePriceEnabled={sp} samePrice={spPrice}
        onSetSamePriceEnabled={async (on, draft) => { spy.sp(on, draft); if (init.spFails && on) return false; setSp(on); if (draft !== undefined) setSpPrice(Number(draft)); return true; }}
        {...(init.withCpp === false ? {} : {
          choosePriceEnabled: cp, choosePrices: prices,
          onSetChoosePriceEnabled: async (on: boolean, p?: number[]) => { spy.cpOn(on, p); if (init.cpFails && on) return false; setCp(on); if (p) setPrices(p); return true; },
          onSetChoosePrices: (p: number[]) => { spy.cpPrices(p); setPrices(p); },
        })}
        onToast={spy.toast}
      />
    </TProvider>
  );
}
const turnOn = () => act(async () => { fireEvent.click(screen.getByTestId("lsm-turn-on")); for (let i = 0; i < 6; i++) await Promise.resolve(); });

beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

describe("Choose price before print — Settings row", () => {
  it("sits directly under Same price; OFF by default; no list area while OFF", () => {
    render(<App />);
    const row = screen.getByTestId("cpp-row");
    expect(row.textContent).toContain("Choose price before print");
    expect(screen.getByTestId("samePrice-row").nextElementSibling).toBe(row);
    expect(screen.getByTestId("cpp-toggle").getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("cpp-area")).toBeNull();
  });

  it("no handler → no row (screen as before)", () => {
    render(<App withCpp={false} />);
    expect(screen.queryByTestId("cpp-row")).toBeNull();
  });

  it("empty list: turning ON asks for a price first; Turn on stays off until a valid price", async () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("cpp-toggle"));
    const input = screen.getByTestId("cpp-first-input");
    expect(screen.getByTestId("cpp-first-hint").textContent).toBe(t.rd_cpp_need_one);
    expect((screen.getByTestId("lsm-turn-on") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "0" } });
    expect((screen.getByTestId("lsm-turn-on") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "39" } });
    await turnOn();
    expect(spy.cpOn).toHaveBeenCalledWith(true, [39]);
    expect(screen.getByTestId("cpp-area").textContent).toContain(t.rd_cpp_list_hint);
    expect(screen.getByTestId("cpp-chip-0").textContent).toContain("₱39");
    expect(screen.getByTestId("cpp-default-badge")).toBeTruthy();
  });

  it("saved prices: turning ON reuses them (no price question); OFF keeps them", async () => {
    render(<App prices={[39, 59]} />);
    fireEvent.click(screen.getByTestId("cpp-toggle"));
    expect(screen.queryByTestId("cpp-first-input")).toBeNull();
    await turnOn();
    expect(spy.cpOn).toHaveBeenLastCalledWith(true, [39, 59]);
    fireEvent.click(screen.getByTestId("cpp-toggle"));
    expect(spy.cpOn).toHaveBeenLastCalledWith(false, undefined);
    expect(spy.toast).toHaveBeenCalledWith(t.rd_cpp_off_toast);
    expect(screen.queryByTestId("cpp-area")).toBeNull();
  });

  it("list: add at the end, no duplicates, no zero, max 6; ☆ makes a price the default; × removes; the last one cannot be removed", () => {
    render(<App cp prices={[39]} />);
    expect(screen.queryByTestId("cpp-remove-0")).toBeNull();           // only one → keep it
    expect(screen.getByTestId("cpp-keep-one")).toBeTruthy();
    const add = (v: string) => { fireEvent.change(screen.getByTestId("cpp-add-input"), { target: { value: v } }); fireEvent.click(screen.getByTestId("cpp-add-btn")); };
    add("39");
    expect(screen.getByTestId("cpp-add-err").textContent).toBe(t.rd_cpp_err_dup);
    add("0");
    expect(screen.getByTestId("cpp-add-err").textContent).toBe(t.rd_cpp_err_bad);
    add("59"); add("79"); add("99"); add("129"); add("149");
    expect(spy.cpPrices).toHaveBeenLastCalledWith([39, 59, 79, 99, 129, 149]);
    expect(screen.queryByTestId("cpp-add-input")).toBeNull();          // 6 = full
    expect(screen.getByTestId("cpp-add-err").textContent).toBe(t.rd_cpp_err_max);
    fireEvent.click(screen.getByTestId("cpp-make-default-3"));
    expect(spy.cpPrices).toHaveBeenLastCalledWith([99, 39, 59, 79, 129, 149]);
    expect(screen.getByTestId("cpp-chip-0").textContent).toContain("₱99");
    fireEvent.click(screen.getByTestId("cpp-remove-1"));
    expect(spy.cpPrices).toHaveBeenLastCalledWith([99, 59, 79, 129, 149]);
  });

  it("only one ON: Choose price ON turns Same price OFF (its price kept) + a note", async () => {
    render(<App sp spPrice={39} prices={[59]} />);
    fireEvent.click(screen.getByTestId("cpp-toggle"));
    await turnOn();
    expect(spy.cpOn).toHaveBeenLastCalledWith(true, [59]);
    expect(spy.sp).toHaveBeenLastCalledWith(false, undefined);         // no draft → the remembered price stays
    expect(screen.getByTestId("ls-excl-note").textContent).toBe(t.rd_cpp_note_sp_off);
    expect(screen.getByTestId("samePrice-val").textContent).toContain("₱39");
  });

  it("only one ON: Same price ON turns Choose price OFF (its prices kept) + a note", async () => {
    render(<App cp prices={[59, 79]} spPrice={39} />);
    fireEvent.click(screen.getByTestId("samePrice-toggle"));
    await turnOn();
    expect(spy.sp).toHaveBeenLastCalledWith(true, "39");
    expect(spy.cpOn).toHaveBeenLastCalledWith(false, undefined);       // no list → the saved prices stay
    expect(spy.cpPrices).not.toHaveBeenCalled();
    expect(screen.getByTestId("ls-excl-note").textContent).toBe(t.rd_cpp_note_cpp_off);
    expect(screen.queryByTestId("cpp-area")).toBeNull();
  });

  it("Choose price save FAILS → Same price stays ON with its price; no note", async () => {
    render(<App sp spPrice={39} prices={[59]} cpFails />);
    fireEvent.click(screen.getByTestId("cpp-toggle"));
    await turnOn();
    expect(spy.cpOn).toHaveBeenLastCalledWith(true, [59]);
    expect(spy.sp).not.toHaveBeenCalled();                             // never turned off
    expect(screen.getByTestId("samePrice-toggle").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("samePrice-val").textContent).toBe("₱39");
    expect(screen.queryByTestId("ls-excl-note")).toBeNull();
    expect(screen.getByTestId("cpp-toggle").getAttribute("aria-checked")).toBe("false");
  });

  it("Same price save FAILS → Choose price stays ON with its prices; no note", async () => {
    render(<App cp prices={[59, 79]} spPrice={39} spFails />);
    fireEvent.click(screen.getByTestId("samePrice-toggle"));
    await turnOn();
    expect(spy.sp).toHaveBeenLastCalledWith(true, "39");
    expect(spy.cpOn).not.toHaveBeenCalled();
    expect(screen.getByTestId("cpp-toggle").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("cpp-area")).toBeTruthy();
    expect(screen.queryByTestId("ls-excl-note")).toBeNull();
  });

  it("the note is cleared when the seller leaves the section (closes Live setup)", async () => {
    render(<App sp spPrice={39} prices={[59]} />);
    fireEvent.click(screen.getByTestId("cpp-toggle"));
    await turnOn();
    expect(screen.getByTestId("ls-excl-note")).toBeTruthy();
    fireEvent.click(screen.getByTestId("ls-header"));                   // close
    fireEvent.click(screen.getByTestId("ls-header"));                   // open again
    expect(screen.getByTestId("cpp-row")).toBeTruthy();
    expect(screen.queryByTestId("ls-excl-note")).toBeNull();
  });

  it("both read ON (two devices) → Same price wins here too: Choose price shows OFF, no list", async () => {
    render(<App sp spPrice={39} cp prices={[59, 79]} />);
    expect(screen.getByTestId("samePrice-toggle").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("cpp-toggle").getAttribute("aria-checked")).toBe("false");
    expect(screen.queryByTestId("cpp-area")).toBeNull();
    fireEvent.click(screen.getByTestId("cpp-toggle"));                 // shown OFF → turning it on works as usual
    await turnOn();
    expect(spy.cpOn).toHaveBeenLastCalledWith(true, [59, 79]);
    expect(spy.sp).toHaveBeenLastCalledWith(false, undefined);
    expect(screen.getByTestId("cpp-toggle").getAttribute("aria-checked")).toBe("true");
  });

  it("☆ and × are at least 44×44 with a gap between them", () => {
    render(<App cp prices={[39, 59]} />);
    for (const id of ["cpp-make-default-1", "cpp-remove-1", "cpp-remove-0"]) {
      const b = screen.getByTestId(id) as HTMLElement;
      expect(parseInt(b.style.width)).toBeGreaterThanOrEqual(44);
      expect(parseInt(b.style.height)).toBeGreaterThanOrEqual(44);
    }
    expect(parseInt((screen.getByTestId("cpp-chip-1") as HTMLElement).style.gap)).toBeGreaterThanOrEqual(4);
  });

  it("no note when the other one was already OFF", async () => {
    render(<App prices={[59]} />);
    fireEvent.click(screen.getByTestId("cpp-toggle"));
    await turnOn();
    expect(spy.sp).not.toHaveBeenCalled();
    expect(screen.queryByTestId("ls-excl-note")).toBeNull();
  });
});

describe("texts in every language", () => {
  it("each new text is filled in all 8 languages", () => {
    const keys = Object.keys(buildT("en")).filter((k) => k.startsWith("rd_cpp_"));
    expect(keys.length).toBeGreaterThanOrEqual(17);
    for (const l of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const tl = buildT(l) as Record<string, string>;
      for (const k of keys) expect(tl[k], `${l} ${k}`).toBeTruthy();
    }
  });
});
