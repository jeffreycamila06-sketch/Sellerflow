// Admin → Global shipping fee: the 7-11 block (unchanged) and, under it, the FamilyMart (全家) block
// (app_settings 'fm_shipping_fee', sql/121). Same look; admin-only write via the app_settings adapter.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";

const s = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn() }));
vi.mock("../../adapters/appSettings", () => ({ getAppSetting: s.get, setAppSetting: s.set }));

import { AdminPanel } from "../Admin";

const view = () => render(<TProvider lang="en"><AdminPanel panel="shipfee" onClose={() => {}} cur="NT$" /></TProvider>);

beforeEach(() => {
  s.get.mockReset(); s.set.mockReset();
  s.get.mockImplementation(async (key: string) => (key === "fm_shipping_fee" ? { value: "45", updatedAt: "2026-10-10T02:00:00Z" } : { value: "38", updatedAt: null }));
  s.set.mockResolvedValue({ ok: true });
});

describe("Global shipping fee modal — FamilyMart block", () => {
  it("shows the 7-11 block first and the FamilyMart block under it", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("fmf-current").textContent).toBe("NT$45"));
    expect(r.getByTestId("sf-current").textContent).toBe("NT$38");
    const sf = r.getByTestId("sf-panel"), fm = r.getByTestId("fmf-panel");
    expect(sf.compareDocumentPosition(fm) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(fm.textContent).toContain("FamilyMart (全家) shipping fee");
    expect(fm.textContent).toContain("Last changed:");
  });

  it("saves 0–200 to fm_shipping_fee only; the 7-11 key is never written", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("fmf-input")).toBeTruthy());
    fireEvent.change(r.getByTestId("fmf-input"), { target: { value: "0" } });
    fireEvent.click(r.getByTestId("fmf-save"));
    await waitFor(() => expect(r.getByTestId("fmf-current").textContent).toBe("NT$0"));
    expect(s.set).toHaveBeenCalledTimes(1);
    expect(s.set).toHaveBeenCalledWith("fm_shipping_fee", "0");
  });

  it("above 200 → error, nothing written", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("fmf-input")).toBeTruthy());
    fireEvent.change(r.getByTestId("fmf-input"), { target: { value: "201" } });
    fireEvent.click(r.getByTestId("fmf-save"));
    expect(r.getByTestId("fmf-note").textContent).toBe("Enter a whole number from 0 to 200.");
    expect(s.set).not.toHaveBeenCalled();
  });

  it("a refused write (not admin) shows the 7-11 'admin only' message", async () => {
    s.set.mockResolvedValue({ ok: false, error: "denied" });
    const r = view();
    await waitFor(() => expect(r.getByTestId("fmf-input")).toBeTruthy());
    fireEvent.change(r.getByTestId("fmf-input"), { target: { value: "50" } });
    fireEvent.click(r.getByTestId("fmf-save"));
    await waitFor(() => expect(r.getByTestId("fmf-note").textContent).toBe("Couldn't save — admin only."));
    expect(r.getByTestId("fmf-current").textContent).toBe("NT$45");
  });

  it("missing or invalid stored value → 39", async () => {
    s.get.mockImplementation(async (key: string) => (key === "fm_shipping_fee" ? { value: "abc", updatedAt: null } : { value: "38", updatedAt: null }));
    const r = view();
    await waitFor(() => expect(r.getByTestId("fmf-current").textContent).toBe("NT$39"));
  });
});
