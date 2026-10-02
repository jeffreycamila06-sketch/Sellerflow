// Admin → Parcel Scan monitoring → Store/phone check queue card: the 1.15.0 failover
// line (sql/71 stats.lease) — who is on duty + the standby, aged on the SERVER clock.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelScanOverview } from "../../adapters/useAdmin";

const M = vi.hoisted(() => ({ stats: {} as Record<string, unknown> }));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: async (n: string) => (n === "admin_parcel_check_stats" ? { data: M.stats, error: null } : { data: [], error: null }) },
}));
const overview: ParcelScanOverview = {
  totalCredits: 0, scansThisMonth: 0, activeUsers: 0, technicalRefundsThisMonth: 0, creditsGrantedThisMonth: 0,
  successesThisMonth: 0, badPhotoThisMonth: 0, technicalThisMonth: 0, untrackedThisMonth: 0, monthly: [], rows: [],
};
vi.mock("../../adapters/useAdmin", async (importActual) => ({
  ...(await importActual<typeof import("../../adapters/useAdmin")>()),
  getParcelScanOverview: async () => ({ ok: true, data: overview }),
}));
import { AdminPanel } from "../Admin";

const NOW = "2026-10-03T08:00:00Z";
const base = { enabled: "true", queue_depth: 0, oldest_pending_min: 0, awaiting_setup: 0, cache_size: 1, sender_phone: "09", sender_healthy: "true", server_now: NOW };
const view = () => render(<TProvider lang="en"><AdminPanel panel="parcelmon" onClose={() => {}} cur="NT$" /></TProvider>);
beforeEach(() => { M.stats = { ...base }; });

describe("check-queue card — on duty / standby line", () => {
  it("leader label + since, and the standby seen N s ago (server clock)", async () => {
    M.stats = { ...base, lease: { leader_id: "a", leader_label: "Windows laptop", leader_at: NOW, leader_since: "2026-10-03T06:00:00Z", standby_id: "b", standby_label: "Mac", standby_at: "2026-10-03T07:59:30Z" } };
    const r = view();
    await waitFor(() => expect(r.getByTestId("pm-lease")).toBeTruthy());
    expect(r.getByTestId("pm-lease").textContent).toContain("on duty: Windows laptop (since ");
    expect(r.getByTestId("pm-lease-standby").textContent).toBe("standby: Mac seen 30s ago");
    expect((r.getByTestId("pm-lease-standby") as HTMLElement).style.color).toBe("");
  });
  it("standby older than 3 min → red; minutes past 90 s", async () => {
    M.stats = { ...base, lease: { leader_id: "a", leader_label: "Windows laptop", leader_since: NOW, standby_id: "b", standby_label: "Mac", standby_at: "2026-10-03T07:55:00Z" } };
    const r = view();
    await waitFor(() => expect(r.getByTestId("pm-lease-standby")).toBeTruthy());
    expect(r.getByTestId("pm-lease-standby").textContent).toBe("standby: Mac seen 5m ago");
    expect((r.getByTestId("pm-lease-standby") as HTMLElement).style.color).toBe("var(--danger, #dc2626)");
  });
  it("no standby → says so", async () => {
    M.stats = { ...base, lease: { leader_id: "a", leader_label: "Mac", leader_since: NOW } };
    const r = view();
    await waitFor(() => expect(r.getByTestId("pm-lease-standby")).toBeTruthy());
    expect(r.getByTestId("pm-lease-standby").textContent).toBe("no standby");
  });
  it("no lease yet (pre-1.15 worker) → no line at all", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pm-checkqueue")).toBeTruthy());
    expect(r.queryByTestId("pm-lease")).toBeNull();
  });
});
