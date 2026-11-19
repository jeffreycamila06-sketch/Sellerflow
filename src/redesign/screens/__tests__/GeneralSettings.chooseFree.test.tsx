// "Show Free button" — the switch under the Choose price list (Settings → Live setup).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

const { maybeSingle, upsert } = vi.hoisted(() => ({
  maybeSingle: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: { enabled: true, prices: [39, 59] }, error: null })),
  upsert: vi.fn(async (_row: unknown): Promise<{ error: unknown }> => ({ error: null })),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => maybeSingle() }) }), upsert: (row: unknown) => upsert(row) }) },
}));

import GeneralSettings from "../GeneralSettings";
import { TProvider, buildT } from "../../i18n";
import type { AccountUser } from "../../../accountDb";
import type { AutoControls } from "../../data";
import { useChoosePrice } from "../../adapters/useChoosePrice";

const t = buildT("en");
const account: AccountUser = {
  authUserId: "u1", email: "g@x.com",
  profile: { fullName: "Test Owner", storeName: "Test Shop", phone: "0900", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};
const noop = () => {};
const spy = { free: vi.fn(), sp: vi.fn() };
const base = (lang = "en") => ({
  theme: "light" as const, accent: "indigo" as const, onSetTheme: noop, onSetAccent: noop,
  auto: { detect: false, toggle: noop } as AutoControls, cur: "₱", lang, onSetLang: noop, currency: "PHP", onSetCurrency: noop,
  profileOpen: false, onToggleProfile: noop, keepAwake: true, onToggleKeepAwake: noop, pinPrint: false, onTogglePinPrint: noop,
  liveSessionOpen: true, onToggleLiveSession: noop,
  printerIdx: 0, printerOpen: false, onTogglePrinter: noop, onPickPrinter: noop, onPrintPattern: noop,
  onSubscription: noop, onSupport: noop, onDelete: noop,
  account, onSaveProfile: vi.fn().mockResolvedValue({ ok: true }), onManageChannel: noop,
});
// The screen with the parent owning the values (as RedesignApp does).
function App({ cp = true, prices = [39, 59], free = false, withFree = true, lang = "en" }: { cp?: boolean; prices?: number[]; free?: boolean; withFree?: boolean; lang?: string }) {
  const [on, setOn] = useState(free);
  return (
    <TProvider lang={lang}>
      <GeneralSettings {...(base(lang) as object as Parameters<typeof GeneralSettings>[0])}
        samePriceEnabled={false} samePrice={null} onSetSamePriceEnabled={() => true}
        choosePriceEnabled={cp} choosePrices={prices} onSetChoosePriceEnabled={() => true} onSetChoosePrices={noop}
        {...(withFree ? { chooseShowFree: on, onSetChooseShowFree: (v: boolean) => { spy.free(v); setOn(v); } } : {})} />
    </TProvider>
  );
}
// The screen on the REAL hook (the database is the mock above).
function Real({ uid }: { uid: string | null }) {
  const cp = useChoosePrice(uid);
  const [sp, setSp] = useState(false);
  return (
    <TProvider lang="en">
      <GeneralSettings {...(base() as object as Parameters<typeof GeneralSettings>[0])}
        samePriceEnabled={sp} samePrice={39} onSetSamePriceEnabled={(v) => { spy.sp(v); setSp(v); return true; }}
        choosePriceEnabled={cp.enabled} choosePrices={cp.prices} onSetChoosePriceEnabled={(v, p) => cp.setEnabled(v, p)} onSetChoosePrices={(p) => void cp.setPrices(p)}
        choosePriceError={cp.saveErrors} chooseShowFree={cp.showFree} onSetChooseShowFree={(v) => void cp.setShowFree(v)} />
    </TProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  maybeSingle.mockResolvedValue({ data: { enabled: true, prices: [39, 59] }, error: null });
  upsert.mockResolvedValue({ error: null });
});

describe("Show Free button switch", () => {
  it("sits inside the price area, under the list: title + the sub-line, OFF by default, a big target", () => {
    render(<App />);
    const sw = screen.getByTestId("cpp-free-toggle");
    expect(screen.getByTestId("cpp-area").contains(sw)).toBe(true);
    expect(sw.compareDocumentPosition(screen.getByTestId("cpp-chip-1")) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy(); // after the prices
    expect(sw.textContent).toBe("Show Free buttonPrints FREE instead of a price");
    expect(sw.getAttribute("role")).toBe("switch");
    expect(sw.getAttribute("aria-checked")).toBe("false");
    expect(parseInt(sw.style.minHeight)).toBeGreaterThanOrEqual(44);
    expect(sw.style.width).toBe("100%");
  });
  it("tap → ON, tap → OFF; the prices and the default are not touched (Free is not a price)", () => {
    render(<App />);
    fireEvent.click(screen.getByTestId("cpp-free-toggle"));
    expect(spy.free).toHaveBeenLastCalledWith(true);
    expect(screen.getByTestId("cpp-free-toggle").getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByTestId(/^cpp-chip-\d$/)).toHaveLength(2);
    expect(screen.getAllByTestId("cpp-default-badge")).toHaveLength(1);
    expect(screen.getByTestId("cpp-chip-0").contains(screen.getByTestId("cpp-default-badge"))).toBe(true);
    fireEvent.click(screen.getByTestId("cpp-free-toggle"));
    expect(spy.free).toHaveBeenLastCalledWith(false);
  });
  it("Choose price OFF → the price area (and the switch) is not shown", () => {
    render(<App cp={false} />);
    expect(screen.queryByTestId("cpp-free-toggle")).toBeNull();
  });
  it("no handler (an older caller) → no row", () => {
    render(<App withFree={false} />);
    expect(screen.getByTestId("cpp-area")).toBeTruthy();
    expect(screen.queryByTestId("cpp-free-toggle")).toBeNull();
  });
  it("all 8 languages have the three texts; the sub-line always names the printed word FREE", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const T = buildT(lang);
      for (const k of ["rd_cpp_free", "rd_cpp_free_row", "rd_cpp_free_sub"] as const) expect(String(T[k] || "").trim(), `${lang} ${k}`).not.toBe("");
      expect(T.rd_cpp_free_sub, lang).toContain("FREE");
    }
    expect(t.rd_cpp_free_row).toBe("Show Free button");
    expect(t.rd_cpp_free_sub).toBe("Prints FREE instead of a price");
  });
});

describe("on the real hook", () => {
  it("ON is saved with show_free: true and stays ON", async () => {
    render(<Real uid="u1" />);
    const sw = await screen.findByTestId("cpp-free-toggle");
    await act(async () => { fireEvent.click(sw); });
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert.mock.calls[0][0]).toEqual(expect.objectContaining({ enabled: true, prices: [39, 59], show_free: true }));
    expect(screen.getByTestId("cpp-free-toggle").getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByTestId("cpp-error")).toBeNull();
  });
  it("the save fails (e.g. the database update is not in yet) → back to OFF + the normal \"Couldn't save\" line; prices, main switch and Same price untouched", async () => {
    render(<Real uid="u1" />);
    const sw = await screen.findByTestId("cpp-free-toggle");
    upsert.mockResolvedValue({ error: { message: "column show_free does not exist" } });
    await act(async () => { fireEvent.click(sw); });
    await waitFor(() => expect(screen.getByTestId("cpp-error")).toBeTruthy());
    expect(screen.getByTestId("cpp-error").textContent).toBe(t.rd_smp_error);
    expect(screen.getByTestId("cpp-free-toggle").getAttribute("aria-checked")).toBe("false");
    expect(screen.getByTestId("cpp-toggle").getAttribute("aria-checked")).toBe("true");
    expect(screen.getAllByTestId(/^cpp-chip-\d$/)).toHaveLength(2);
    expect(spy.sp).not.toHaveBeenCalled();
  });
  it("nobody signed in → nothing to switch (Choose price reads OFF), nothing is saved", async () => {
    render(<Real uid={null} />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId("cpp-free-toggle")).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });
});
