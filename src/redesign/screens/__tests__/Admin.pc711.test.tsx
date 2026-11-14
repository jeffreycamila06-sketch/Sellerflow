// The 7-11 Login control tile: it renders on the Admin home, and a needs_login / key_missing
// status shows the attention dot. The status is read on mount via usePc711Status → the fetch is
// mocked so no network happens.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import Admin from "../Admin";
import { TProvider } from "../../i18n";

vi.mock("../../../supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } } }));

const mockStatus = (state: string | null) => {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
    ok: state !== null, status: state === null ? 500 : 200,
    json: async () => (state === null ? {} : { state, since: null, lastOkAt: null, autoLogins: 0, phoneTail: "", lastProblem: null }),
  }));
};
afterEach(() => { vi.restoreAllMocks(); });

const renderAdmin = () => render(<TProvider lang="en"><Admin onOpenPanel={() => {}} cur="NT$" /></TProvider>);

describe("Admin — 7-11 Login tile", () => {
  it("shows the tile", () => {
    mockStatus("connected");
    renderAdmin();
    expect(screen.getByTestId("admin-ctrl-pc711")).toBeTruthy();
    expect(screen.getByText("7-11 Login")).toBeTruthy();
  });
  it("connected → no attention dot", async () => {
    mockStatus("connected");
    renderAdmin();
    await waitFor(() => expect((globalThis as unknown as { fetch: ReturnType<typeof vi.fn> }).fetch).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByTestId("admin-ctrl-pc711-badge")).toBeNull();
  });
  it("needs_login → attention dot on the tile", async () => {
    mockStatus("needs_login");
    renderAdmin();
    await waitFor(() => expect(screen.getByTestId("admin-ctrl-pc711-badge")).toBeTruthy());
  });
  it("key_missing → attention dot too", async () => {
    mockStatus("key_missing");
    renderAdmin();
    await waitFor(() => expect(screen.getByTestId("admin-ctrl-pc711-badge")).toBeTruthy());
  });
});
