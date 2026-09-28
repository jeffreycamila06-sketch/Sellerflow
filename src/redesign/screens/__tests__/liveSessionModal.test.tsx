// Settings → Live session explainer — a CENTERED modal (approved mockup), not a
// bottom sheet. Rows are title + toggle / value only. Turning a toggle ON opens the
// modal and it flips ON only on "Turn on"; Cancel / click outside / Esc keep it OFF.
// Turning OFF is instant + a toast, never a modal. Driven through a stateful harness
// so the real ON/OFF state (aria-checked) is observable.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { useState } from "react";
import { readFileSync } from "node:fs";
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

function Harness({ onToast, init = {} }: { onToast: (m: string) => void; init?: Init }) {
  const [awake, setAwake] = useState(init.awake ?? false);
  const [pin, setPin] = useState(init.pin ?? false);
  const [autoOn, setAutoOn] = useState(init.auto ?? false);
  const [spOn, setSpOn] = useState(init.spOn ?? false);
  const [spPrice, setSpPrice] = useState<number | null>(init.spPrice ?? null);
  const auto: AutoControls = { detect: autoOn, toggle: () => setAutoOn((v) => !v) };
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
        onToast={onToast}
        printerIdx={0} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop}
        onSubscription={noop} onSupport={noop} onDelete={noop}
        account={account} onSaveProfile={vi.fn().mockResolvedValue({ ok: true })} onManageChannel={noop}
      />
    </TProvider>
  );
}
const checked = (id: string) => screen.getByTestId(id).getAttribute("aria-checked");
const modalGone = () => waitFor(() => expect(screen.queryByTestId("lsm-modal")).toBeNull());

beforeAll(() => { Element.prototype.scrollTo = (() => {}) as typeof Element.prototype.scrollTo; });

describe("Live session rows — title + toggle / value only", () => {
  it("no subtitles, no status line, no ▾ expand; print row is title + chevron only (no size)", () => {
    render(<Harness onToast={noop} />);
    const body = screen.getByTestId("ls-body");
    for (const gone of [/currently active/i, /Manual mode/, /Auto-detect/, /Prevents the phone/, /Map codes to products/, /What prints on each slip/, /Pin a comment on your/, /Low-stock warning at/, /Live codes now live/]) {
      expect(within(body).queryByText(gone), String(gone)).toBeNull();
    }
    expect(within(body).queryByText("▾")).toBeNull();
    expect(screen.queryByTestId("ls-print-size")).toBeNull();
    expect(screen.getByTestId("ls-print-pattern").textContent).toBe("LIVE print pattern›");
  });

  it("order: LIVE print pattern → Keep awake → Auto-print pinned → Auto mode → Same price (toggles consecutive)", () => {
    render(<Harness onToast={noop} />);
    const text = screen.getByTestId("ls-body").textContent || "";
    const seq = ["LIVE print pattern", "Keep screen awake while live", "Auto-print pinned comments", "Auto mode", "Same price for all items"].map((s) => text.indexOf(s));
    expect(seq.every((i) => i >= 0)).toBe(true);
    expect([...seq].sort((a, b) => a - b)).toEqual(seq);
  });
});

describe("the explainer is a CENTERED modal (not a bottom sheet)", () => {
  it("the dialog sits inside a centering backdrop and has no drag handle", () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("ls-tg-awake"));
    const backdrop = screen.getByTestId("lsm-backdrop");
    const modal = screen.getByTestId("lsm-modal");
    expect(modal.parentElement).toBe(backdrop);
    expect(backdrop.className).toContain("sfl-lsm-backdrop");
    expect(modal.className).toContain("sfl-lsm-modal");
    expect(modal.getAttribute("role")).toBe("dialog");
    expect(document.querySelector(".sfl-lss-sheet, .sfl-lss-backdrop")).toBeNull(); // the old sheet is gone
  });

  it("CSS contract: centered grid, width min(420px, 90vw), radius 20, fade + scale .96→1 in 200ms, reduced-motion off", () => {
    const css = readFileSync("src/redesign/redesign.css", "utf8");
    const rule = (sel: string) => { const i = css.indexOf(sel + " {"); return i < 0 ? "" : css.slice(i, css.indexOf("}", i)); };
    const bd = rule(".sfl-lsm-backdrop");
    expect(bd).toContain("position: fixed");
    expect(bd).toContain("place-items: center");
    expect(bd).toContain("rgba(20, 22, 40, .42)");
    const m = rule(".sfl-lsm-modal");
    expect(m).toContain("width: min(420px, 90vw)");
    expect(m).toContain("border-radius: 20px");
    expect(m).toContain("transform: scale(.96)");
    expect(m).toContain("transition: transform .2s ease-out, opacity .2s ease-out");
    expect(rule(".sfl-ls-knob")).toContain("cubic-bezier(.34, 1.56, .64, 1)");
    expect(css).toMatch(/prefers-reduced-motion: reduce\)\s*\{\s*\.sfl-lsm-backdrop, \.sfl-lsm-modal, \.sfl-ls-track, \.sfl-ls-knob \{ transition: none; \}/);
    expect(css).not.toContain(".sfl-lss-sheet"); // no bottom-sheet rules left
  });
});

describe("turning ON opens the modal; it flips ON only on 'Turn on'", () => {
  it("tap OFF toggle → modal with title + explanation; the toggle is NOT flipped yet", () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("ls-tg-awake"));
    const modal = screen.getByTestId("lsm-modal");
    expect(within(modal).getByText("Keep screen awake while live")).toBeTruthy();
    expect(within(modal).getByText(/Stops the phone from sleeping/)).toBeTruthy();
    expect(checked("ls-tg-awake")).toBe("false");
  });

  it("Turn on → ON, modal closes, no toast", async () => {
    const onToast = vi.fn();
    render(<Harness onToast={onToast} />);
    fireEvent.click(screen.getByTestId("ls-tg-awake"));
    fireEvent.click(screen.getByTestId("lsm-turn-on"));
    expect(checked("ls-tg-awake")).toBe("true");
    expect(onToast).not.toHaveBeenCalled();
    await modalGone();
  });

  it("a second 'Turn on' tap during the fade-out can't flip it back off", () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("ls-tg-awake"));
    const btn = screen.getByTestId("lsm-turn-on");
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(checked("ls-tg-awake")).toBe("true");
  });

  it("Cancel keeps it OFF", async () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("ls-tg-pin"));
    fireEvent.click(screen.getByTestId("lsm-cancel"));
    expect(checked("ls-tg-pin")).toBe("false");
    await modalGone();
  });

  it("click OUTSIDE (on the backdrop) keeps it OFF", async () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("ls-tg-pin"));
    fireEvent.click(screen.getByTestId("lsm-backdrop"));
    expect(checked("ls-tg-pin")).toBe("false");
    await modalGone();
  });

  it("a click INSIDE the modal does not close it", () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("ls-tg-pin"));
    fireEvent.click(screen.getByTestId("lsm-modal"));
    fireEvent.click(within(screen.getByTestId("lsm-modal")).getByText("Auto-print pinned comments"));
    expect(screen.getByTestId("lsm-modal")).toBeTruthy();
    expect(checked("ls-tg-pin")).toBe("false");
  });

  it("Esc closes and keeps it OFF", async () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("ls-tg-auto"));
    expect(screen.getByTestId("lsm-modal")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(checked("ls-tg-auto")).toBe("false");
    await modalGone();
  });

  it("Auto mode: modal copy points to Products; Turn on → ON", () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("ls-tg-auto"));
    expect(within(screen.getByTestId("lsm-modal")).getByText(/Set a Live code on each product in Products/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("lsm-turn-on"));
    expect(checked("ls-tg-auto")).toBe("true");
  });
});

describe("turning OFF is instant with a toast — never a modal", () => {
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
    expect(screen.queryByTestId("lsm-modal")).toBeNull();
  });
});

describe("Same price — modal with a price field", () => {
  it("'Turn on' is disabled until price > 0; 0 shows the error; a valid price enables it", () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("samePrice-toggle"));
    const turnOn = screen.getByTestId("lsm-turn-on") as HTMLButtonElement;
    expect(turnOn.disabled).toBe(true);
    expect(screen.getByTestId("lsm-sp-hint").textContent).toBe("Every 1-Click and Auto order will print this price.");
    fireEvent.change(screen.getByTestId("samePrice-input"), { target: { value: "0" } });
    expect(turnOn.disabled).toBe(true);
    expect(screen.getByTestId("lsm-sp-hint").textContent).toBe("Enter a price greater than 0.");
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

  it("the price field is focused automatically after the modal opens", async () => {
    render(<Harness onToast={noop} />);
    fireEvent.click(screen.getByTestId("samePrice-toggle"));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("samePrice-input")));
  });

  it("OFF with a remembered price: row shows 'NT$199 saved' and the modal pre-fills 199", () => {
    render(<Harness onToast={noop} init={{ spOn: false, spPrice: 199 }} />);
    expect(screen.getByTestId("samePrice-val").textContent).toBe("NT$199 saved");
    fireEvent.click(screen.getByTestId("samePrice-toggle"));
    expect((screen.getByTestId("samePrice-input") as HTMLInputElement).value).toBe("199");
    expect((screen.getByTestId("lsm-turn-on") as HTMLButtonElement).disabled).toBe(false);
  });

  it("Cancel keeps it OFF and the remembered price unchanged", async () => {
    render(<Harness onToast={noop} init={{ spOn: false, spPrice: 199 }} />);
    fireEvent.click(screen.getByTestId("samePrice-toggle"));
    fireEvent.change(screen.getByTestId("samePrice-input"), { target: { value: "300" } });
    fireEvent.click(screen.getByTestId("lsm-cancel"));
    expect(checked("samePrice-toggle")).toBe("false");
    expect(screen.getByTestId("samePrice-val").textContent).toBe("NT$199 saved");
    await modalGone();
  });

  it("ON → tap → instant OFF + 'Same price off · NT$199 remembered'; price stays remembered", () => {
    const onToast = vi.fn();
    render(<Harness onToast={onToast} init={{ spOn: true, spPrice: 199 }} />);
    fireEvent.click(screen.getByTestId("samePrice-toggle"));
    expect(checked("samePrice-toggle")).toBe("false");
    expect(onToast).toHaveBeenCalledWith("Same price off · NT$199 remembered");
    expect(screen.getByTestId("samePrice-val").textContent).toBe("NT$199 saved");
    expect(screen.queryByTestId("lsm-modal")).toBeNull();
  });
});
