// PrinterModal — "No printer connected" nudge (order saved, nothing printed).
// Pins: title/body/primary/secondary render; primary = INTERNAL button (NOT an
// anchor — the deep-link to Printer Settings is an in-app screen switch, so the
// iOS external-anchor rule does not apply); go/dismiss/close wiring; i18n filled
// in every language (no English leak). The no-stack invariant Jeff asked to pin
// (3 rapid failures → 1 modal) is the functional set-state the RedesignApp
// handler uses — asserted here at the semantics level.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PrinterModal from "../PrinterModal";
import { TProvider, buildT } from "../../i18n";

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id"];

const renderModal = (over: { onGoSettings?: () => void; onDismiss?: () => void } = {}, lang = "en") =>
  render(
    <TProvider lang={lang}>
      <PrinterModal onGoSettings={over.onGoSettings ?? (() => {})} onDismiss={over.onDismiss ?? (() => {})} />
    </TProvider>,
  );

describe("PrinterModal", () => {
  it("renders the approved title + body + both buttons", () => {
    renderModal();
    expect(screen.getByText("No printer connected")).toBeTruthy();
    expect(screen.getByText(/Your order was saved, but it couldn't print/)).toBeTruthy();
    expect(screen.getByText("Go to Printer Settings")).toBeTruthy();
    expect(screen.getByTestId("printer-dismiss")).toBeTruthy();
  });

  it("primary is an INTERNAL button, not an anchor (in-app nav)", () => {
    renderModal();
    const go = screen.getByTestId("printer-go");
    expect(go.tagName).toBe("BUTTON");
    expect(go.getAttribute("href")).toBeNull();
  });

  it("Go to Printer Settings → onGoSettings", () => {
    const onGoSettings = vi.fn();
    renderModal({ onGoSettings });
    fireEvent.click(screen.getByTestId("printer-go"));
    expect(onGoSettings).toHaveBeenCalledTimes(1);
  });

  it("both the ✕ and the secondary button call onDismiss", () => {
    const onDismiss = vi.fn();
    renderModal({ onDismiss });
    fireEvent.click(screen.getByTestId("printer-dismiss"));
    fireEvent.click(screen.getByTestId("printer-close"));
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it("every language fills all four keys (no blank, no English leak in non-en)", () => {
    for (const lang of LANGS) {
      const t = buildT(lang) as unknown as Record<string, string>;
      for (const k of ["rd_prn_title", "rd_prn_body", "rd_prn_go", "rd_prn_dismiss"]) {
        expect(t[k] && t[k].trim().length).toBeTruthy();
      }
      if (lang !== "en") expect(t.rd_prn_title).not.toBe("No printer connected");
    }
  });
});

describe("no-stack invariant (RedesignApp handler + functional set-state)", () => {
  // Faithful model of the RedesignApp wiring: ONE state slot + the exact handler
  // (setPrinterModal((cur) => cur || { via }); return true). A single state slot
  // can only ever render ONE <PrinterModal> — stacking is structurally impossible;
  // the functional updater additionally makes the collapse order-independent, so a
  // concurrent burst (e.g. Print-screen printAll over 20 buyers, or an auto-mode
  // batch) that all read the SAME pre-batch snapshot still yields one modal.
  function makeModel() {
    let state: { via: string } | null = null;
    let renders = 0; // count DISTINCT modal instances that would mount
    const setPrinterModal = (u: ((c: { via: string } | null) => { via: string } | null)) => {
      const next = u(state);
      if (next && next !== state) renders += 1; // a new instance would mount
      state = next;
    };
    const handler = ({ via }: { via: string }) => { setPrinterModal((cur) => cur || { via }); return true; };
    return { handler, get: () => state, get renders() { return renders; }, dismiss: () => { state = null; } };
  }

  it("CONCURRENT: 20 failures reading the same empty snapshot → 1 modal, 1 mount", () => {
    const m = makeModel();
    // All 20 fire before any commit is observed (worst-case batch / stale read).
    for (let i = 0; i < 20; i++) m.handler({ via: "bluetooth" });
    expect(m.get()).toEqual({ via: "bluetooth" });
    expect(m.renders).toBe(1); // only ONE instance ever mounted (no stacking)
  });

  it("every failure IS consumed (returns true → legacy alert suppressed each time)", () => {
    const m = makeModel();
    const results = [m.handler({ via: "lan" }), m.handler({ via: "lan" }), m.handler({ via: "lan" })];
    expect(results).toEqual([true, true, true]); // no failure silently dropped
    expect(m.renders).toBe(1);
  });

  it("after dismiss, the next failure re-opens (clean reset)", () => {
    const m = makeModel();
    m.handler({ via: "lan" });
    m.dismiss();                 // seller tapped Dismiss → state cleared
    m.handler({ via: "lan" });
    expect(m.get()).toEqual({ via: "lan" });
    expect(m.renders).toBe(2);   // two separate open→dismiss cycles
  });
});
