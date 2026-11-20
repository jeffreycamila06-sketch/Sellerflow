// BLACKLIST screen — pick a reason, then scan the sticker QR or type the buyer; Undo right after an add;
// "Already added today"; "This QR has no buyer"; the list (counts, last added, platform, search); Remove
// asks inside the app (never the browser's confirm). FAKE DATA ONLY; the database calls are props.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";

const Q = vi.hoisted(() => ({ decode: vi.fn(async (_f: File): Promise<string | null | string[]> => null) }));
vi.mock("../../adapters/qrDecode", async () => (await import("./qrReaderMock")).qrReaderModule((f: File) => Q.decode(f)));

import Blacklist from "../Blacklist";
import type { BlAddResult, BlRow } from "../../adapters/blacklist";

const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };
const row = (id: string, platform: "tiktok" | "facebook", label: string, reason: "returned" | "not_checked_out", day: string): BlRow =>
  ({ id, platform, label, reason, day, createdAt: `${day}T10:00:00Z` });
const ROWS = [
  row("r1", "tiktok", "maria_shop", "returned", "2026-11-18"), row("r2", "tiktok", "maria_shop", "returned", "2026-11-02"),
  row("r3", "tiktok", "maria_shop", "not_checked_out", "2026-10-30"), row("r4", "facebook", "Ana Reyes", "not_checked_out", "2026-11-16"),
];
function mount(over: Partial<Parameters<typeof Blacklist>[0]> = {}, lang = "en") {
  const p = {
    onBack: vi.fn(), rows: ROWS as BlRow[] | null, error: false, onReload: vi.fn(),
    onAdd: vi.fn(async (): Promise<BlAddResult> => ({ kind: "added", id: "new1", day: "2026-11-20" })),
    onUndo: vi.fn(async () => true), onRemove: vi.fn(async () => true), ...over,
  };
  render(<TProvider lang={lang}><Blacklist {...p} /></TProvider>);
  return p;
}
const type = (v: string) => fireEvent.change(screen.getByTestId("bl-type"), { target: { value: v } });
const add = async () => { fireEvent.click(screen.getByTestId("bl-add")); await flush(); };
const pickFile = async () => {
  const input = screen.getByTestId("bl-file") as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "sticker.jpg", { type: "image/jpeg" })] } });
  await flush();
};

const realWidth = window.innerWidth;
beforeEach(() => { Q.decode.mockReset(); Q.decode.mockResolvedValue(null); Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 }); });
afterEach(() => { Object.defineProperty(window, "innerWidth", { configurable: true, value: realWidth }); vi.restoreAllMocks(); });

describe("adding", () => {
  it("nothing can be added before a reason is picked", () => {
    mount();
    expect(screen.getByTestId("bl-pick-first").textContent).toBe("Pick a reason first");
    expect((screen.getByTestId("bl-scan") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("bl-add") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("bl-type") as HTMLInputElement).disabled).toBe(true);
  });
  it("type a TikTok @username → saved with the picked reason → Added + Undo → Undo", async () => {
    const p = mount();
    fireEvent.click(screen.getByTestId("bl-reason-return"));
    type("@Maria_Shop");
    await add();
    expect(p.onAdd).toHaveBeenCalledWith("tiktok", "@Maria_Shop", "returned");
    expect(screen.getByTestId("bl-added").textContent).toContain("Added @Maria_Shop — Return item");
    expect((screen.getByTestId("bl-type") as HTMLInputElement).value).toBe("");
    fireEvent.click(screen.getByTestId("bl-undo")); await flush();
    expect(p.onUndo).toHaveBeenCalledWith("new1");
    expect(screen.queryByTestId("bl-added")).toBeNull();
    expect(screen.getByTestId("bl-undone").textContent).toContain("Undone — @Maria_Shop was not added.");
  });
  it("Enter in the box adds too (one way to save)", async () => {
    const p = mount();
    fireEvent.click(screen.getByTestId("bl-reason-notout"));
    type("maria_shop");
    fireEvent.submit(screen.getByTestId("bl-type").closest("form")!);
    await flush();
    expect(p.onAdd).toHaveBeenCalledTimes(1);
    expect(p.onAdd).toHaveBeenCalledWith("tiktok", "maria_shop", "not_checked_out");
  });
  it("a Facebook name", async () => {
    const p = mount();
    fireEvent.click(screen.getByTestId("bl-reason-notout"));
    fireEvent.click(screen.getByTestId("bl-pf-fb"));
    type("Ana Reyes");
    await add();
    expect(p.onAdd).toHaveBeenCalledWith("facebook", "Ana Reyes", "not_checked_out");
    expect(screen.getByTestId("bl-added").textContent).toContain("Added Ana Reyes — Not checked out");
  });
  it("Already added today (the database said so)", async () => {
    mount({ onAdd: vi.fn(async (): Promise<BlAddResult> => ({ kind: "already", day: "2026-11-20" })) });
    fireEvent.click(screen.getByTestId("bl-reason-return"));
    type("maria_shop");
    await add();
    expect(screen.getByTestId("bl-already").textContent).toContain("Already added today — @maria_shop (Return item).");
    expect(screen.queryByTestId("bl-undo")).toBeNull();
  });
  it("a failed save says so", async () => {
    mount({ onAdd: vi.fn(async (): Promise<BlAddResult> => ({ kind: "error" })) });
    fireEvent.click(screen.getByTestId("bl-reason-return"));
    type("maria_shop");
    await add();
    expect(screen.getByTestId("bl-err").textContent).toContain("Couldn't save");
  });
  it("a TikTok username with a space can't be added", () => {
    const p = mount();
    fireEvent.click(screen.getByTestId("bl-reason-return"));
    type("maria shop");
    expect((screen.getByTestId("bl-add") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("bl-type-problem").textContent).toBe("A TikTok username has no spaces.");
    expect(p.onAdd).not.toHaveBeenCalled();
  });
  it("Add is the app's violet, not red (red = remove)", () => {
    mount();
    fireEvent.click(screen.getByTestId("bl-reason-return"));
    type("maria_shop");
    const btn = screen.getByTestId("bl-add") as HTMLButtonElement;
    expect(btn.style.background).toBe("var(--accent)");
    expect(btn.style.background).not.toContain("danger");
    expect(btn.style.color).toBe("var(--accent-text)");
  });
});

describe("scanning the sticker QR", () => {
  it("a TikTok profile link → that buyer is added with the picked reason", async () => {
    Q.decode.mockResolvedValue("https://tiktok.com/@jhun.belle");
    const p = mount();
    fireEvent.click(screen.getByTestId("bl-reason-notout"));
    await pickFile();
    expect(p.onAdd).toHaveBeenCalledWith("tiktok", "jhun.belle", "not_checked_out");
    expect(screen.getByTestId("bl-added").textContent).toContain("Added @jhun.belle — Not checked out");
  });
  it("any other QR → 'This QR has no buyer', nothing saved", async () => {
    Q.decode.mockResolvedValue("ABC123");
    const p = mount();
    fireEvent.click(screen.getByTestId("bl-reason-return"));
    await pickFile();
    expect(p.onAdd).not.toHaveBeenCalled();
    expect(screen.getByTestId("bl-noqr").textContent).toContain("This QR has no buyer");
  });
  it("no QR in the photo → try again or type", async () => {
    const p = mount();
    fireEvent.click(screen.getByTestId("bl-reason-return"));
    await pickFile();
    expect(p.onAdd).not.toHaveBeenCalled();
    expect(screen.getByTestId("bl-noqr-found").textContent).toContain("No QR found");
  });
  it("2 stickers in the photo → '2 stickers in the photo — show only one', nothing saved (never a guess)", async () => {
    Q.decode.mockResolvedValue(["https://tiktok.com/@jhun.belle", "https://tiktok.com/@maria_live"]);
    const p = mount();
    fireEvent.click(screen.getByTestId("bl-reason-return"));
    await pickFile();
    expect(p.onAdd).not.toHaveBeenCalled();
    expect(screen.getByTestId("bl-qr-many").textContent).toContain("2 stickers in the photo — show only one");
    expect(screen.queryByTestId("bl-noqr-found")).toBeNull();
  });
});

describe("the list", () => {
  it("one row per buyer: counts per reason, platform, last added; newest first", () => {
    mount();
    expect(screen.getByTestId("bl-list-head").textContent).toBe("YOUR LIST · 2");
    const rows = screen.getAllByTestId("bl-row");
    expect(rows.map((r) => r.querySelector("[data-testid='bl-counts']")!.textContent)).toEqual(["2× Return · 1× Not checked out", "1× Not checked out"]);
    expect(rows[0].textContent).toContain("@maria_shop");
    expect(rows[0].textContent).toContain("TikTok · last added Nov 18");
    expect(rows[1].textContent).toContain("Facebook · last added Nov 16");
  });
  it("search", () => {
    mount();
    fireEvent.change(screen.getByTestId("bl-search"), { target: { value: "ana" } });
    expect(screen.getAllByTestId("bl-row")).toHaveLength(1);
    fireEvent.change(screen.getByTestId("bl-search"), { target: { value: "zzz" } });
    expect(screen.getByTestId("bl-empty").textContent).toBe("No buyer matches");
  });
  it("empty list", () => {
    mount({ rows: [] });
    expect(screen.getByTestId("bl-empty").textContent).toBe("No buyers yet. Pick a reason, then scan or type a buyer.");
  });
  it("loading, and a failed read with Try again", () => {
    const p = mount({ rows: null, error: true });
    expect(screen.getByTestId("bl-load-err").textContent).toContain("Couldn't load your list.");
    fireEvent.click(screen.getByTestId("bl-retry"));
    expect(p.onReload).toHaveBeenCalledTimes(1);
  });
  it("Remove asks inside the app (never the browser's confirm); Cancel keeps; Remove removes", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockImplementation(() => true);
    const p = mount();
    fireEvent.click(screen.getAllByTestId("bl-remove")[0]);
    expect(screen.getByTestId("bl-remove-sheet").textContent).toContain("Remove @maria_shop from your blacklist?");
    fireEvent.click(screen.getByTestId("bl-remove-cancel"));
    expect(screen.queryByTestId("bl-remove-sheet")).toBeNull();
    expect(p.onRemove).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByTestId("bl-remove")[0]);
    fireEvent.click(screen.getByTestId("bl-remove-ok")); await flush();
    expect(p.onRemove).toHaveBeenCalledTimes(1);
    expect(vi.mocked(p.onRemove).mock.calls[0][0]).toMatchObject({ platform: "tiktok", key: "maria_shop" });
    expect(screen.queryByTestId("bl-remove-sheet")).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
  });
  it("a failed Remove stays open and says so", async () => {
    mount({ onRemove: vi.fn(async () => false) });
    fireEvent.click(screen.getAllByTestId("bl-remove")[0]);
    fireEvent.click(screen.getByTestId("bl-remove-ok")); await flush();
    expect(screen.getByTestId("bl-remove-err").textContent).toContain("Couldn't save");
  });
});

// The Remove sheet sat inside the screen's scroll box, under the bottom nav: on a phone Cancel / Remove could not be
// tapped. It is now drawn in a portal into the [data-redesign] root (the BlacklistSheet pattern), above the nav.
describe("the Remove sheet is drawn outside the screen (above the bottom nav)", () => {
  const ROOT_ID = "bl-test-redesign-root";
  afterEach(() => { document.getElementById(ROOT_ID)?.remove(); });
  const openSheet = () => { fireEvent.click(screen.getAllByTestId("bl-remove")[0]); return screen.getByTestId("bl-remove-sheet"); };

  it("it is in the [data-redesign] root, not inside the screen; Cancel and Remove still work", async () => {
    const root = document.createElement("div");
    root.id = ROOT_ID; root.setAttribute("data-redesign", "");
    document.body.appendChild(root);
    const p = mount();
    const screenEl = screen.getByTestId("bl-file").closest("div[style]")!.parentElement!.parentElement!;
    const sheet = openSheet();
    expect(root.contains(sheet)).toBe(true);
    expect(sheet.parentElement).toBe(root);
    expect(screenEl.contains(sheet)).toBe(false);
    fireEvent.click(within(sheet).getByTestId("bl-remove-cancel"));
    expect(screen.queryByTestId("bl-remove-sheet")).toBeNull();
    expect(p.onRemove).not.toHaveBeenCalled();
    const again = openSheet();
    expect(root.contains(again)).toBe(true);
    fireEvent.click(within(again).getByTestId("bl-remove-ok")); await flush();
    expect(p.onRemove).toHaveBeenCalledTimes(1);
    expect(vi.mocked(p.onRemove).mock.calls[0][0]).toMatchObject({ platform: "tiktok", key: "maria_shop" });
    expect(screen.queryByTestId("bl-remove-sheet")).toBeNull();
  });
  it("no [data-redesign] root → into document.body (never inside the screen)", () => {
    const { container } = render(<TProvider lang="en"><Blacklist onBack={vi.fn()} rows={ROWS} error={false} onReload={vi.fn()} onAdd={vi.fn()} onUndo={vi.fn()} onRemove={vi.fn(async () => true)} /></TProvider>);
    const sheet = openSheet();
    expect(container.contains(sheet)).toBe(false);
    expect(sheet.parentElement).toBe(document.body);
  });
  it("above the nav, clear of the home indicator; the text scrolls inside, the buttons always stay", () => {
    mount();
    const sheet = openSheet();
    expect(sheet.style.zIndex).toBe("1300");
    expect(sheet.style.position).toBe("fixed");
    expect(sheet.style.alignItems).toBe("flex-end"); // phone: a bottom sheet
    const panel = screen.getByTestId("bl-remove-panel");
    // jsdom drops a padding that uses env(), so the home-indicator padding is read from the source line itself
    const panelLine = readFileSync("src/redesign/screens/Blacklist.tsx", "utf8").split("\n").find((l) => l.includes('data-testid="bl-remove-panel"'))!;
    expect(panelLine).toContain('padding: "18px 16px calc(18px + env(safe-area-inset-bottom))"');
    expect(panel.style.maxHeight).toBe("80vh");
    expect(panel.style.display).toBe("flex");
    expect(panel.style.flexDirection).toBe("column");
    const body = screen.getByTestId("bl-remove-body");
    expect(body.style.overflowY).toBe("auto");
    expect(["0", "0px"]).toContain(body.style.minHeight);
    const buttons = screen.getByTestId("bl-remove-ok").parentElement!;
    expect(buttons.style.flexShrink).toBe("0");
    expect(body.contains(screen.getByTestId("bl-remove-ok"))).toBe(false);
  });
  it("busy: both buttons off and a tap outside does not close it; a failure keeps it open with the message", async () => {
    let finish: (v: boolean) => void = () => {};
    const p = mount({ onRemove: vi.fn(() => new Promise<boolean>((r) => { finish = r; })) });
    const sheet = openSheet();
    fireEvent.click(screen.getByTestId("bl-remove-ok")); await flush();
    expect((screen.getByTestId("bl-remove-ok") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("bl-remove-cancel") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(sheet);
    expect(screen.getByTestId("bl-remove-sheet")).toBeTruthy();
    await act(async () => { finish(false); });
    await flush();
    expect(screen.getByTestId("bl-remove-err").textContent).toContain("Couldn't save");
    expect(p.onRemove).toHaveBeenCalledTimes(1);
  });
  it("a tap on the dark area closes it (not busy); a long name wraps inside the sheet", () => {
    mount({ rows: [row("x1", "facebook", "Maria Cristina Dela Cruz Santos Villanueva Reyes Mendoza Bautista Ocampo", "returned", "2026-11-18")] });
    const sheet = openSheet();
    expect(within(sheet).getByRole("dialog").textContent).toContain("Remove Maria Cristina Dela Cruz Santos Villanueva Reyes Mendoza Bautista Ocampo from your blacklist?");
    fireEvent.click(sheet);
    expect(screen.queryByTestId("bl-remove-sheet")).toBeNull();
  });
  it("laptop: still a centered dialog", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    mount();
    expect(openSheet().style.alignItems).toBe("center");
  });
});

describe("laptop", () => {
  it("upload a photo instead of scanning, the no-camera hint, a table", () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 1280 });
    mount();
    expect(screen.getByTestId("bl-scan").textContent).toContain("Upload sticker photo");
    expect(document.body.textContent).toContain("No camera? Type the TikTok @username or the Facebook name.");
    expect(screen.getByTestId("bl-table")).toBeTruthy();
  });
  it("the phone says Scan sticker QR", () => {
    mount();
    expect(screen.getByTestId("bl-scan").textContent).toContain("Scan sticker QR");
  });
});

describe("Filipino", () => {
  it("the words", async () => {
    mount({}, "fil");
    expect(screen.getByTestId("bl-reason-notout").textContent).toContain("Hindi nag-check out");
    expect(screen.getByTestId("bl-reason-return").textContent).toContain("Nag-return ng item");
    expect(screen.getByTestId("bl-add").textContent).toBe("Idagdag");
  });
});
