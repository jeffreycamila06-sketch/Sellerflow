// Batch D (#11) — the Products write-throughs were fire-and-forget: a failed
// cloud upsert/delete was invisible. Now: (a) a failed SAVE keeps the local
// product (localStorage is this screen's primary store) and shows the sync-
// failure pill; (b) a failed DELETE RESTORES the product (the DB row survived —
// the DB-wins reconcile would resurrect it next load, so "gone" was a lie) and
// shows the delete-failure pill.
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Products from "../Products";
import { TProvider } from "../../i18n";
import { PRODUCT_DEFAULTS } from "../../adapters/products";

vi.mock("../../adapters/productsDb", () => ({
  resolveInitialProducts: vi.fn(async (local: unknown) => ({ products: local, source: "local" })),
  saveProductDb: vi.fn(async () => true),
  deleteProductDb: vi.fn(async () => true),
}));
import { resolveInitialProducts, saveProductDb, deleteProductDb } from "../../adapters/productsDb";

const renderProducts = () => render(<TProvider lang="en"><Products cur="NT$" /></TProvider>);

describe("Products screen — cloud-sync failure surfacing (Batch D #11)", () => {
  beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });

  it("failed cloud SAVE → product stays locally + the sync-failure pill shows", async () => {
    (saveProductDb as Mock).mockResolvedValueOnce(false);
    renderProducts();
    await vi.waitFor(() => expect(resolveInitialProducts as Mock).toHaveBeenCalled());
    fireEvent.click(screen.getByText("+ Add"));
    const form = document.querySelector("form") as HTMLFormElement;
    fireEvent.change(form.querySelector("input") as HTMLInputElement, { target: { value: "Offline Item" } });
    fireEvent.submit(form);
    await vi.waitFor(() => expect(screen.getByText(/cloud sync failed/i)).toBeTruthy());
    expect(screen.getByText("Offline Item")).toBeTruthy(); // kept locally (primary store)
  });

  it("failed cloud DELETE → product is RESTORED (no fake 'gone') + the delete-failure pill shows", async () => {
    (deleteProductDb as Mock).mockResolvedValueOnce(false);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderProducts();
    await vi.waitFor(() => expect(resolveInitialProducts as Mock).toHaveBeenCalled());
    const victim = PRODUCT_DEFAULTS[0].name;
    expect(screen.getByText(victim)).toBeTruthy();
    fireEvent.click(screen.getAllByText("Delete")[0]);
    await vi.waitFor(() => expect(screen.getByText(/Delete failed/i)).toBeTruthy());
    expect(screen.getByText(victim)).toBeTruthy(); // restored — DB row still exists
  });

  it("successful save/delete → NO failure pill (no false alarms)", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderProducts();
    await vi.waitFor(() => expect(resolveInitialProducts as Mock).toHaveBeenCalled());
    fireEvent.click(screen.getAllByText("Delete")[0]);
    await vi.waitFor(() => expect(deleteProductDb as Mock).toHaveBeenCalled());
    expect(screen.queryByText(/Delete failed/i)).toBeNull();
    expect(screen.queryByText(/cloud sync failed/i)).toBeNull();
  });
});
