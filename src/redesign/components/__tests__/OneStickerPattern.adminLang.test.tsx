// ADMIN language test on the new Live print pattern: chips + "New / Today's sticker" for admins only.
// A chip swaps the preview (and its notes) to that sample; Printer Test hands the picked sample + route
// to the app (which prints through the normal print functions — adminLangTest.print.test.ts).
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const seen = vi.hoisted(() => ({ preview: [] as string[], notes: [] as string[] }));
vi.mock("../../adapters/oneSticker", async (orig) => {
  const m = await orig<typeof import("../../adapters/oneSticker")>();
  return {
    ...m,
    renderOneSticker: (...a: Parameters<typeof m.renderOneSticker>) => { seen.preview.push(String(a[1].name)); return m.renderOneSticker(...a); },
    screenFitNotesSteps: function* (...a: Parameters<typeof m.screenFitNotesSteps>) { seen.notes.push(String(a[1].name)); return yield* m.screenFitNotesSteps(...a); },
  };
});
import OneStickerPattern from "../OneStickerPattern";
import { recommendedSettings } from "../../adapters/oneSticker";
import { TProvider } from "../../i18n";

type P = Parameters<typeof OneStickerPattern>[0];
const mount = (over: Partial<P> = {}) => {
  const onTest = vi.fn(), onTestSample = vi.fn();
  render(<TProvider lang="en"><OneStickerPattern onBack={() => {}} initial={recommendedSettings({ w: 60, h: 40 })} savedOnDevice={false} onSave={() => {}} shopName="Maria Ukay" devicePath="d520" qrAllowed onTest={onTest} onTestSample={onTestSample} {...over} /></TProvider>);
  return { onTest, onTestSample };
};

describe("admin language test", () => {
  it("sellers never see it — not even with the callback passed (gate = isAdmin only)", () => {
    mount({ isAdmin: false });
    expect(screen.queryByTestId("os-admin-lang")).toBeNull();
    expect(document.querySelectorAll("[data-testid^='os-admin-']").length).toBe(0);
    expect(document.body.textContent).not.toContain("Admin: language test");
  });
  it("a seller render without the admin props is the plain screen", () => {
    mount({ onTestSample: undefined });
    expect(screen.queryByTestId("os-admin-lang")).toBeNull();
  });
  it("admins see 11 language chips + New / Today's sticker", () => {
    mount({ isAdmin: true });
    const chips = Array.from(screen.getByTestId("os-admin-chips").querySelectorAll("button")).map((b) => b.textContent);
    expect(chips).toEqual(["English", "中文", "日本語", "한국어", "ไทย", "العربية", "Български", "Tiếng Việt", "Fancy/emoji", "Facebook", "Buyer #1234"]);
    expect(screen.getByTestId("os-admin-route-new").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("os-admin-route-today").getAttribute("aria-pressed")).toBe("false");
  });
  it("a chip changes the PREVIEW and its notes to that sample; tapping it again goes back to the normal sample", { timeout: 60000 }, async () => {
    mount({ isAdmin: true });
    await waitFor(() => expect(seen.preview).toContain("Maria Santos"));
    seen.preview.length = 0; seen.notes.length = 0;
    fireEvent.click(screen.getByTestId("os-admin-lang-ja"));
    // (the kana + Chinese cells load first — slow under jsdom)
    await waitFor(() => expect(seen.preview).toContain("田中さん"), { timeout: 20000 });
    await waitFor(() => expect(seen.notes).toContain("田中さん"), { timeout: 20000 });
    expect(screen.getByTestId("os-admin-lang-ja").getAttribute("aria-pressed")).toBe("true");
    seen.preview.length = 0;
    fireEvent.click(screen.getByTestId("os-admin-lang-ja"));
    await waitFor(() => expect(seen.preview).toContain("Maria Santos"));
  });
  it("Printer Test prints the picked sample with the current draft (New sticker)", { timeout: 60000 }, async () => {
    const { onTest, onTestSample } = mount({ isAdmin: true });
    await waitFor(() => expect((screen.getByTestId("os-buyer-plus") as HTMLButtonElement).disabled).toBe(false), { timeout: 20000 }); // "+" waits for its limit
    fireEvent.click(screen.getByTestId("os-buyer-plus")); // a draft change
    fireEvent.click(screen.getByTestId("os-admin-lang-th"));
    fireEvent.click(screen.getByTestId("os-test"));
    expect(onTest).not.toHaveBeenCalled();
    expect(onTestSample).toHaveBeenCalledTimes(1);
    const [draft, sample, route, unsaved] = onTestSample.mock.calls[0];
    expect(sample.key).toBe("th");
    expect(route).toBe("new");
    expect(unsaved).toBe(true);
    expect(draft.parts.buyer.scale).toBe(1.15);
  });
  it("a device that saved the sticker and changed nothing: the test is not 'unsaved'", () => {
    const { onTestSample } = mount({ isAdmin: true, savedOnDevice: true });
    fireEvent.click(screen.getByTestId("os-admin-lang-zh"));
    fireEvent.click(screen.getByTestId("os-test"));
    expect(onTestSample.mock.calls[0][3]).toBe(false);
  });
  it("Today's note: picture printers mention the language fix; TEXT / WiFi say there is none", () => {
    mount({ isAdmin: true });
    fireEvent.click(screen.getByTestId("os-admin-route-today"));
    expect(screen.getByTestId("os-admin-today-note").textContent).toContain("with the language fix");
    expect(screen.getByTestId("os-admin-today-note").textContent).toContain("Printer settings size");
  });
  it("Today's note on a TEXT phone: no language fix promised", () => {
    mount({ isAdmin: true, devicePath: "text" });
    fireEvent.click(screen.getByTestId("os-admin-route-today"));
    expect(screen.getByTestId("os-admin-today-note").textContent).toContain("no language fix");
  });
  it("Today's sticker: Printer Test routes to today's sticker, and the preview says the picture is the new sticker", () => {
    const { onTestSample } = mount({ isAdmin: true });
    expect(screen.queryByTestId("os-admin-today-note")).toBeNull();
    fireEvent.click(screen.getByTestId("os-admin-route-today"));
    expect(screen.getByTestId("os-admin-today-note").textContent).toContain("today's sticker");
    fireEvent.click(screen.getByTestId("os-admin-lang-ko"));
    fireEvent.click(screen.getByTestId("os-test"));
    expect(onTestSample.mock.calls[0][1].key).toBe("ko");
    expect(onTestSample.mock.calls[0][2]).toBe("today");
  });
  it("admin with no chip and New sticker: Printer Test is the screen's normal test print", () => {
    const { onTest, onTestSample } = mount({ isAdmin: true });
    fireEvent.click(screen.getByTestId("os-test"));
    expect(onTest).toHaveBeenCalledTimes(1);
    expect(onTestSample).not.toHaveBeenCalled();
  });
  it("every chip / toggle is at least 44 px tall and the chip rows wrap", () => {
    mount({ isAdmin: true });
    for (const b of Array.from(screen.getByTestId("os-admin-lang").querySelectorAll("button"))) expect(Number((b as HTMLElement).style.minHeight.replace("px", ""))).toBeGreaterThanOrEqual(44);
    expect(screen.getByTestId("os-admin-chips").style.flexWrap).toBe("wrap");
  });
});
