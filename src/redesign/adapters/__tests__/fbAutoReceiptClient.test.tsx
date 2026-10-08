// B1 — client side of the automatic receipt. Pins: the gate (switch AND server receipt access AND
// Facebook open AND the Facebook world AND Plus or higher), Receipt format (no prop = the screen
// exactly as before; with the prop = the toggle, default OFF, saved on its own with the app's
// language + currency), the RedesignApp wiring, the i18n text in all 8 languages, the sql/100
// contract.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const db = vi.hoisted(() => ({ settings: { opening: "", note: "", qr_image: null } as Record<string, unknown>, auto: { auto_receipt_enabled: false } as Record<string, unknown>, upserts: [] as Record<string, unknown>[], fail: false }));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" }, access_token: "JWT" } } }) },
    from: () => ({
      select: (cols: string) => ({ eq: () => ({ maybeSingle: async () => (db.fail && cols.includes("auto_receipt") ? { data: null, error: { message: "x" } } : { data: cols.includes("auto_receipt") ? db.auto : db.settings, error: null }) }) }),
      upsert: async (row: Record<string, unknown>) => { db.upserts.push(row); return { error: null }; },
    }),
  },
}));
vi.mock("../useReceiptPicture", () => ({ useReceiptPicture: () => ({ url: null, failed: true }) }));

import { autoReceiptGate } from "../fbAutoReceipt";
import ReceiptFormat from "../../screens/ReceiptFormat";
import { TProvider, buildT } from "../../i18n";

beforeEach(() => { db.upserts.length = 0; db.auto = { auto_receipt_enabled: false }; db.fail = false; });

describe("gate", () => {
  it("switch AND receipt access AND Facebook open AND not hidden AND plus/pro/master", () => {
    const all = { flag: true, receiptAccess: true, fbEnabled: true, hidden: false, plan: "plus" };
    expect(autoReceiptGate(all)).toBe(true);
    for (const p of ["Pro", "master"]) expect(autoReceiptGate({ ...all, plan: p })).toBe(true);
    for (const k of ["flag", "receiptAccess", "fbEnabled"] as const) expect(autoReceiptGate({ ...all, [k]: false })).toBe(false);
    expect(autoReceiptGate({ ...all, hidden: true })).toBe(false);
    for (const p of ["free", "basic", "", null, undefined]) expect(autoReceiptGate({ ...all, plan: p })).toBe(false);
  });
});

describe("Receipt format", () => {
  const view = (extra: Record<string, unknown> = {}) => render(<TProvider lang="en"><ReceiptFormat cur="NT$" onBack={() => {}} {...extra} /></TProvider>);
  it("no prop → no section", async () => {
    view();
    await waitFor(() => expect(screen.getByTestId("rc-save")).toBeTruthy());
    expect(screen.queryByTestId("rc-auto")).toBeNull();
  });
  it("with the prop: default OFF, saved on its own with lang + currency", async () => {
    view({ autoReceipt: { lang: "zh-TW", currency: "NT$" } });
    await waitFor(() => expect(screen.getByTestId("rc-auto-on")).toBeTruthy());
    expect((screen.getByTestId("rc-auto-on") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId("rc-auto-on"));
    fireEvent.click(screen.getByTestId("rc-auto-save"));
    await waitFor(() => expect(db.upserts).toHaveLength(1));
    const row = db.upserts[0];
    expect(row).toMatchObject({ user_id: "u1", auto_receipt_enabled: true, auto_receipt_lang: "zh-TW", auto_receipt_currency: "NT$" });
    expect(Object.keys(row).sort()).toEqual(["auto_receipt_currency", "auto_receipt_enabled", "auto_receipt_lang", "updated_at", "user_id"]);
  });
  it("load error → error line, no toggle", async () => {
    db.fail = true;
    view({ autoReceipt: { lang: "en", currency: "₱" } });
    await waitFor(() => expect(screen.getByTestId("rc-auto-error")).toBeTruthy());
    expect(screen.queryByTestId("rc-auto-on")).toBeNull();
  });
});

describe("i18n", () => {
  it("title / hint / toggle filled in all 8 languages; title says Plus and up in English", () => {
    for (const l of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const t = buildT(l);
      for (const k of ["rd_rc_auto_title", "rd_rc_auto_hint", "rd_rc_auto_toggle"] as const) expect(String(t[k] || "").trim()).not.toBe("");
    }
    expect(buildT("en").rd_rc_auto_title).toBe("Automatic receipt after live (Plus and up)");
  });
});

describe("RedesignApp wiring (source contract)", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("gate from the switch, server receipt access, Facebook world and the plan; prop only when it passes", () => {
    expect(src).toContain('const autoReceiptUi = autoReceiptGate({ flag: featureSw.fbAutoReceipt, receiptAccess: fbAccess.receipt, fbEnabled, hidden: platformHides("fbSoldout", world), plan: auth.profile?.plan });');
    expect(src).toContain("{...(autoReceiptUi ? { autoReceipt: { lang, currency: cur } } : {})}");
  });
});

describe("sql/100 contract", () => {
  const read = (f: string) => readFileSync(resolve(__dirname, "../../../../sql", f), "utf8");
  const code = read("100_fb_auto_receipt.sql").split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  it("jobs table server-only; toggle default false; switch seeded 'false'; claim function service-role only", () => {
    expect(code).toContain("status in ('due', 'running', 'done', 'failed', 'skipped')");
    expect(code).toContain("revoke all on public.fb_auto_receipt_jobs from anon;");
    expect(code).toContain("revoke all on public.fb_auto_receipt_jobs from authenticated;");
    expect(code).toContain("enable row level security");
    expect(code).toContain("add column if not exists auto_receipt_enabled boolean not null default false");
    expect(code).toContain("('fb_auto_receipt_enabled', 'false')");
    expect(code).toContain("on conflict (key) do nothing");
    expect(code).toContain("grant execute on function public.claim_auto_receipt_jobs(int) to service_role;");
    expect(code).toContain("revoke all on function public.claim_auto_receipt_jobs(int) from authenticated;");
    expect(code).not.toMatch(/drop /i);
  });
  it("rollback = plain drops", () => {
    const rb = read("100_fb_auto_receipt_rollback.sql");
    expect(rb).not.toMatch(/if exists/i);
    expect(rb).toContain("drop table public.fb_auto_receipt_jobs;");
  });
});
