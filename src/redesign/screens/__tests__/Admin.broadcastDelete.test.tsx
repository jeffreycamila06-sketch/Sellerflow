// Broadcast panel — per-row trash delete. A confirm step gates the hard delete
// (window.confirm); confirming dispatches ann.remove(id), cancelling does not.
// The non-admin/RLS block is proven at the adapter layer (useAnnouncements test);
// here we prove the UI dispatch + confirm/cancel wiring.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AdminPanel } from "../Admin";
import { TProvider } from "../../i18n";
import type { Announcement } from "../../adapters/useAnnouncements";

const list: Announcement[] = [
  { id: "a1", message: "Live sale tonight", active: true, createdAt: "2026-07-02T10:00:00Z" },
  { id: "a2", message: "Old test message", active: false, createdAt: "2026-07-01T10:00:00Z" },
];

const renderBroadcast = (remove: (id: string) => Promise<{ ok: boolean; error?: string }>) =>
  render(
    <TProvider lang="en">
      <AdminPanel
        panel="broadcast"
        onClose={() => {}}
        assignAmount=""
        onAssignAmount={() => {}}
        cur="NT$"
        ann={{
          list,
          publish: async () => ({ ok: true }),
          unpublish: async () => ({ ok: true }),
          remove,
        }}
      />
    </TProvider>,
  );

afterEach(() => vi.restoreAllMocks());

describe("Admin broadcast — delete button", () => {
  it("renders a trash delete control per history row", () => {
    renderBroadcast(async () => ({ ok: true }));
    const trash = screen.getAllByLabelText("Delete");
    expect(trash.length).toBe(2); // one per row (a1, a2)
  });

  it("confirm → dispatches ann.remove(id) for that row", async () => {
    const remove = vi.fn(async () => ({ ok: true }));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderBroadcast(remove);
    fireEvent.click(screen.getAllByLabelText("Delete")[0]); // newest = a1
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith("a1");
  });

  it("cancel at the confirm step → NO delete dispatched", () => {
    const remove = vi.fn(async () => ({ ok: true }));
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderBroadcast(remove);
    fireEvent.click(screen.getAllByLabelText("Delete")[1]); // a2
    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(remove).not.toHaveBeenCalled();
  });

  it("the confirm prompt warns sellers lose it + it cannot be undone", () => {
    const spy = vi.spyOn(window, "confirm").mockReturnValue(false);
    renderBroadcast(async () => ({ ok: true }));
    fireEvent.click(screen.getAllByLabelText("Delete")[0]);
    const msg = String(spy.mock.calls[0][0]);
    expect(msg).toMatch(/Sellers will no longer see it/i);
    expect(msg).toMatch(/cannot be undone/i);
  });
});
