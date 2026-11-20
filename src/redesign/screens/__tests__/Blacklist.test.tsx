// BLACKLIST screen — pick a reason, then scan the sticker QR or type the buyer; Undo right after an add;
// "Already added today"; "This QR has no buyer"; the list (counts, last added, platform, search); Remove
// asks inside the app (never the browser's confirm). FAKE DATA ONLY; the database calls are props.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TProvider } from "../../i18n";

const Q = vi.hoisted(() => ({ decode: vi.fn(async (_f: File): Promise<string | null> => null) }));
vi.mock("../../adapters/qrDecode", () => ({ decodeQrFromFile: (f: File) => Q.decode(f) }));

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
