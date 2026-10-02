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
  const RED = "var(--danger, #dc2626)";
  const READY = { sfl: "connected", myship: "ok", emap: "ok", multi: true };
  const withStandby = (standby_state: unknown, standby_at = "2026-10-03T07:59:50Z") => ({ ...base, lease: {
    leader_id: "a", leader_label: "Windows laptop", leader_since: NOW, standby_id: "b", standby_label: "Mac", standby_at, standby_state } });
  const readyEl = async (standby_state: unknown, standby_at?: string) => {
    M.stats = withStandby(standby_state, standby_at);
    const r = view();
    await waitFor(() => expect(r.getByTestId("pm-lease-ready")).toBeTruthy());
    return { r, el: r.getByTestId("pm-lease-ready") as HTMLElement };
  };
  it("standby ready: sfl connected + emap ok + myship ok → '· ready' (not red)", async () => {
    const { r, el } = await readyEl(READY);
    expect(el.textContent).toBe(" · ready");
    expect(el.style.color).toBe("");
    expect(r.getByTestId("pm-lease").textContent).toContain("standby: Mac seen 10s ago · ready");
  });
  it("myship 'stale' is normal on a standby (it never runs phone checks) → still ready", async () => {
    const { el } = await readyEl({ ...READY, myship: "stale" });
    expect(el.textContent).toBe(" · ready");
  });
  it("NOT READY names the tab, in red — each tab", async () => {
    for (const [state, why] of [
      [{ ...READY, sfl: "signed_out" }, "sfl: signed_out"],
      [{ ...READY, myship: "no_tab" }, "myship: no_tab"],
      [{ ...READY, myship: "dead_script" }, "myship: dead_script"],
      [{ ...READY, emap: "dead" }, "emap: dead"],
      [{ ...READY, emap: "expired" }, "emap: expired"],
      [{ ...READY, emap: "no_tab" }, "emap: no_tab"],
      [{ ...READY, sfl: "no_token" }, "sfl: no_token"],
      [{ ...READY, myship: "no_config" }, "myship: no_config"],
      [{ sfl: "connected", myship: "ok", multi: true }, "emap: missing"],
      [{ ...READY, multi: false }, "Multi-seller mode off"],
      [{ sfl: "connected", myship: "ok", emap: "ok" }, "Multi-seller mode off"],
      [{ sfl: "asleep", myship: "no_tab", emap: "dead", multi: true }, "sfl: asleep, myship: no_tab, emap: dead"],
    ] as const) {
      const { r, el } = await readyEl(state);
      expect(el.textContent).toBe(` · NOT READY (${why})`);
      expect(el.style.color).toBe(RED);
      r.unmount();
    }
  });
  it("soft states are a passing blip → 'ready (<tab>: <state>)' in the normal colour", async () => {
    for (const [state, text] of [
      [{ ...READY, emap: "stale" }, " · ready (emap: stale)"],
      [{ ...READY, emap: "degraded" }, " · ready (emap: degraded)"],
      [{ ...READY, emap: "recovering" }, " · ready (emap: recovering)"],
      [{ ...READY, emap: "reminting" }, " · ready (emap: reminting)"],
      [{ ...READY, emap: "guid_missing" }, " · ready (emap: guid_missing)"],
      [{ ...READY, myship: "healing" }, " · ready (myship: healing)"],
    ] as const) {
      const { r, el } = await readyEl(state);
      expect(el.textContent).toBe(text);
      expect(el.style.color).toBe("");
      r.unmount();
    }
  });
  it("missing standby_state → NOT READY (no state reported)", async () => {
    const { el } = await readyEl(undefined);
    expect(el.textContent).toBe(" · NOT READY (no state reported)");
    expect(el.style.color).toBe(RED);
  });
  it("not seen for more than 3 min stays red, alongside the readiness", async () => {
    const { r, el } = await readyEl(READY, "2026-10-03T07:55:00Z");
    expect((r.getByTestId("pm-lease-standby") as HTMLElement).style.color).toBe(RED);
    expect(el.textContent).toBe(" · ready");
  });
  it("leader last seen (server clock): normal under 3 min, red after", async () => {
    M.stats = { ...base, lease: { leader_id: "a", leader_label: "Mac", leader_since: NOW, leader_at: "2026-10-03T07:59:40Z" } };
    let r = view();
    await waitFor(() => expect(r.getByTestId("pm-lease-leader-seen")).toBeTruthy());
    expect(r.getByTestId("pm-lease-leader-seen").textContent).toBe(" seen 20s ago");
    expect((r.getByTestId("pm-lease-leader-seen") as HTMLElement).style.color).toBe("");
    r.unmount();
    M.stats = { ...base, lease: { leader_id: "a", leader_label: "Mac", leader_since: NOW, leader_at: "2026-10-03T07:56:00Z" } };
    r = view();
    await waitFor(() => expect(r.getByTestId("pm-lease-leader-seen")).toBeTruthy());
    expect(r.getByTestId("pm-lease-leader-seen").textContent).toBe(" seen 4m ago");
    expect((r.getByTestId("pm-lease-leader-seen") as HTMLElement).style.color).toBe(RED);
  });
  it("DEGRADED in red when the leader reports leader_state.degraded; absent otherwise", async () => {
    M.stats = { ...base, lease: { leader_id: "a", leader_label: "Mac", leader_since: NOW, leader_at: NOW, leader_state: { degraded: true } } };
    let r = view();
    await waitFor(() => expect(r.getByTestId("pm-lease-degraded")).toBeTruthy());
    expect(r.getByTestId("pm-lease-degraded").textContent).toBe(" DEGRADED");
    expect((r.getByTestId("pm-lease-degraded") as HTMLElement).style.color).toBe(RED);
    r.unmount();
    M.stats = { ...base, lease: { leader_id: "a", leader_label: "Mac", leader_since: NOW, leader_at: NOW, leader_state: { degraded: false } } };
    r = view();
    await waitFor(() => expect(r.getByTestId("pm-lease")).toBeTruthy());
    expect(r.queryByTestId("pm-lease-degraded")).toBeNull();
  });
  it("no lease yet (pre-1.15 worker) → no line at all", async () => {
    const r = view();
    await waitFor(() => expect(r.getByTestId("pm-checkqueue")).toBeTruthy());
    expect(r.queryByTestId("pm-lease")).toBeNull();
  });
});
