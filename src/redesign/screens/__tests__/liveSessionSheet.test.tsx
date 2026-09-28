// Settings → Live session bottom-sheet explainer (approved mockup). Rows are title +
// toggle / value only. Turning a toggle ON opens the sheet and it flips ON only on
// "Turn on"; Cancel / backdrop / swipe-down keep it OFF. Turning OFF is instant + a
// toast, never a sheet. Driven through a stateful harness so the real ON/OFF state
// (aria-checked) is observable.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import GeneralSettings from "../GeneralSettings";
import { TProvider } from "../../i18n";
import { normalizeSamePrice } from "../../adapters/useSamePrice";
import type { AutoControls } from "../../data";
import type { AccountUser } from "../../../accountDb";

const noop = () => {};
const account: AccountUser = {
  authUserId: "u1", email: "googletest@sellerflowlive.com",
  profile: { fullName: "Owner", storeName: "Shop", phone: "0900", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};
type Init = { awake?: boolean; pin?: boolean; auto?: boolean; spOn?: boolean; spPrice?: number | null };

function Harness({ onToast, init = {}, toggleSetup = noop }: { onToast: (m: string) => void; init?: Init; toggleSetup?: () => void }) {
  const [awake, setAwake] = useState(init.awake ?? false);
  const [pin, setPin] = useState(init.pin ?? false);
  const [autoOn, setAutoOn] = useState(init.auto ?? false);
  const [spOn, setSpOn] = useState(init.spOn ?? false);
  const [spPrice, setSpPrice] = useState<number | null>(init.spPrice ?? null);
  const auto: AutoControls = { detect: autoOn, setupOpen: false, toggle: () => setAutoOn((v) => !v), toggleSetup };
  return (
    <TProvider lang="en">
      <GeneralSettings
        theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop}
        auto={auto} cur="NT$" lang="en" onSetLang={noop} currency="TWD" onSetCurrency={noop}
        profileOpen={false} onToggleProfile={noop}
        keepAwake={awake} onToggleKeepAwake={() => setAwake((v) => !v)}
        pinPrint={pin} onTogglePinPrint={() => setPin((v) => !v)}
        liveSessionOpen onToggleLiveSession={noop}
        samePriceEnabled={spOn} samePrice={spPrice}
        onSetSamePriceEnabled={(on, draft) => {
          if (on) { const p = normalizeSamePrice(draft ?? spPrice); if (!p) return; setSpPrice(p); }
          setSpOn(on);
        }}
        onToast={onToast} printSize="60x40mm (Small)"
        printerIdx={0} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
        onSubscription={noop} onSupport={noop} onDelete={noop}
        account={account} onSaveProfile={vi.fn().mockResolvedValue({ ok: true })} onManageChannel={noop}
      />
    </TProvider>
  );
}
const checked = (id: string) => screen.getByTestId(id).getAttribute("aria-checked");
const sheetGone = () => waitFor(() => expect(screen.queryByTestId("lss-sheet")).toBeNull());

beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

describe("Live session rows — title + toggle / value only", () => {
  it("no subtitles and no 'currently active' status line; print size shows as a mono value", () => {
    render(<Harness onToast={noop} />);
    const body = screen.getByTestId("ls-body");
    for (const gone of [/currently active/i, /Manual mode/, /Auto-detect/, /Prevents the phone/, /Map codes to products/, /What prints on each slip/, /Pin a comment on your/]) {
      expect(within(body).queryByText(gone), String(gone)).toBeNull();
    }
    expect(screen.getByTestId("ls-print-size").textContent).toBe("60×40");
  });

  it("order: Keep awake → LIVE print pattern → Auto-print pinned → Auto mode → Same price", () => {
    render(<Harness onToast={noop} />);
    const text = screen.getByTestId("ls-body").textContent || "";
    const at = (s: string) => text.indexOf(s);
    const seq = ["Keep screen awake while live", "LIVE print pattern", "Auto-print pinned comments", "Auto mode", "Same price for all items"].map(at);
    expect(seq.every((i) => i >= 0)).toBe(true);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);
  });
});

describe("turning ON opens the explainer; it flips ON only on 'Turn on'", () => {
  it("tap OFF toggle → sheet with title + explanation; the toggle is NOT flipped yet", () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("ls-tg-awake"));
    const sheet = screen.getByTestId("lss-sheet");
    expect(within(sheet).getByText("Keep screen awake while live")).toBeTruthy();
    expect(within(sheet).getByText(/Stops the phone from sleeping/)).toBeTruthy();
    expect(checked("ls-tg-awake")).toBe("false");
  });

  it("Turn on → ON, sheet closes, no toast", async () => {
    const onToast = vi.fn();
    render(<Harness onToast={onToast} />);
    fireEvent.click(screen.getByTestId("ls-tg-awake"));
    fireEvent.click(screen.getByTestId("lss-turn-on"));
    expect(checked("ls-tg-awake")).toBe("true");
    expect(onToast).not.toHaveBeenCalled();
    await sheetGone();
  });

  it("a second 'Turn on' tap during the slide-down can't flip it back off", () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("ls-tg-awake"));
    const btn = screen.getByTestId("lss-turn-on");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(checked("ls-tg-awake")).toBe("true");
  });

  it("Cancel keeps it OFF", async () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("ls-tg-pin"));
    fireEvent.click(screen.getByTestId("lss-cancel"));
    expect(checked("ls-tg-pin")).toBe("false");
    await sheetGone();
  });

  it("backdrop tap keeps it OFF", async () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("ls-tg-pin"));
    fireEvent.click(screen.getByTestId("lss-backdrop"));
    expect(checked("ls-tg-pin")).toBe("false");
    await sheetGone();
  });

  it("swipe-down on the sheet keeps it OFF", async () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("ls-tg-auto"));
    const sheet = screen.getByTestId("lss-sheet");
    fireEvent.touchStart(sheet, { touches: [{ clientY: 100 }] });
    fireEvent.touchEnd(sheet, { changedTouches: [{ clientY: 220 }] });
    expect(checked("ls-tg-auto")).toBe("false");
    await sheetGone();
  });

  it("Auto mode: sheet mentions setting up codes; Turn on → ON", () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("ls-tg-auto"));
    expect(within(screen.getByTestId("lss-sheet")).getByText(/Set up your codes after turning on/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("lss-turn-on"));
    expect(checked("ls-tg-auto")).toBe("true");
  });

  it("Auto mode ▾ still expands the code setup and never opens the sheet", () => {
    const toggleSetup = vi.fn();
    render(<Harness onToast={noop} toggleSetup={toggleSetup} />);
    fireEvent.click(within(screen.getByTestId("ls-body")).getByText("Auto mode"));
    expect(toggleSetup).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("lss-sheet")).toBeNull();
  });
});

describe("turning OFF is instant with a toast — never a sheet", () => {
  it.each([
    ["ls-tg-awake", { awake: true }, "Screen awake off"],
    ["ls-tg-pin", { pin: true }, "Auto-print off"],
    ["ls-tg-auto", { auto: true }, "Auto mode off"],
  ] as const)("%s ON → tap → OFF + toast %s", (id, init, msg) => {
    const onToast = vi.fn();
    render(<Harness onToast={onToast} init={init} />);
    fireEvent.click(screen.getByTestId(id));
    expect(checked(id)).toBe("false");
    expect(onToast).toHaveBeenCalledWith(msg);
    expect(screen.queryByTestId("lss-sheet")).toBeNull();
  });
});

describe("Same price — sheet with a price field", () => {
  it("'Turn on' is disabled until price > 0; 0 shows the error; a valid price enables it", () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("samePrice-toggle"));
    const turnOn = screen.getByTestId("lss-turn-on") as HTMLButtonElement;
    expect(turnOn.disabled).toBe(true);
    expect(screen.getByTestId("lss-sp-hint").textContent).toBe("Every 1-Click and Auto order will print this price.");
    fireEvent.change(screen.getByTestId("samePrice-input"), { target: { value: "0" } });
    expect(turnOn.disabled).toBe(true);
    expect(screen.getByTestId("lss-sp-hint").textContent).toBe("Enter a price greater than 0.");
    fireEvent.click(turnOn); // disabled → no flip
    expect(checked("samePrice-toggle")).toBe("false");
    fireEvent.change(screen.getByTestId("samePrice-input"), { target: { value: "199" } });
    expect(turnOn.disabled).toBe(false);
  });

  it("Enter in the price field = Turn on → ON with the typed price, row shows NT$199", () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("samePrice-toggle"));
    const input = screen.getByTestId("samePrice-input");
    fireEvent.change(input, { target: { value: "199" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(checked("samePrice-toggle")).toBe("true");
    expect(screen.getByTestId("samePrice-val").textContent).toBe("NT$199");
  });

  it("OFF with a remembered price: row shows 'NT$199 saved' and the sheet pre-fills 199", () => {
    render(<Harness onToast={noop} init={{ spOn: false, spPrice: 199 }} />);
    expect(screen.getByTestId("samePrice-val").textContent).toBe("NT$199 saved");
    fireEvent.click(screen.getByTestId("samePrice-toggle"));
    expect((screen.getByTestId("samePrice-input") as HTMLInputElement).value).toBe("199");
    expect((screen.getByTestId("lss-turn-on") as HTMLButtonElement).disabled).toBe(false);
  });

  it("Cancel keeps it OFF and the remembered price unchanged", async () => {
    render(<Harness onToast={noop} init={{ spOn: false, spPrice: 199 }} />);
    fireEvent.click(screen.getByTestId("samePrice-toggle"));
    fireEvent.change(screen.getByTestId("samePrice-input"), { target: { value: "300" } });
    fireEvent.click(screen.getByTestId("lss-cancel"));
    expect(checked("samePrice-toggle")).toBe("false");
    expect(screen.getByTestId("samePrice-val").textContent).toBe("NT$199 saved");
    await sheetGone();
  });

  it("ON → tap → instant OFF + 'Same price off · NT$199 remembered'; price stays remembered", () => {
    const onToast = vi.fn();
    render(<Harness onToast={onToast} init={{ spOn: true, spPrice: 199 }} />);
    fireEvent.click(screen.getByTestId("samePrice-toggle"));
    expect(checked("samePrice-toggle")).toBe("false");
    expect(onToast).toHaveBeenCalledWith("Same price off · NT$199 remembered");
    expect(screen.getByTestId("samePrice-val").textContent).toBe("NT$199 saved");
    expect(screen.queryByTestId("lss-sheet")).toBeNull();
  });
});
