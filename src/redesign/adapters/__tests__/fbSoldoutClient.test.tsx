// F2 — client side of the sold-out message. Pins: the gate expression (switch AND server
// receipt access AND Facebook open AND the Facebook world; never fbReceiptUi), which comments
// can be answered (live Facebook with comment + page id; never "Earlier comments"), the send
// request, Receipt format (no prop = the screen exactly as before; with the prop = the toggle
// + text, saved on their own), the RedesignApp wiring (after the existing badge, DB stock
// re-check first, no change to autoMode / order creation), the built-in text = the server's,
// and the sql/91 contract.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const db = vi.hoisted(() => ({ settings: { opening: "", note: "", qr_image: null } as Record<string, unknown>, soldout: { soldout_enabled: false, soldout_text: "" } as Record<string, unknown>, upserts: [] as Record<string, unknown>[] }));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: "u1" }, access_token: "JWT" } } }) },
    from: () => ({
      select: (cols: string) => ({ eq: () => ({ maybeSingle: async () => ({ data: cols.includes("soldout") ? db.soldout : db.settings, error: null }) }) }),
      upsert: async (row: Record<string, unknown>) => { db.upserts.push(row); return { error: null }; },
    }),
  },
}));
vi.mock("../useReceiptPicture", () => ({ useReceiptPicture: () => ({ url: null, failed: true }) }));

import { soldoutGate, soldoutTarget, sendSoldOut } from "../fbSoldout";
import ReceiptFormat from "../../screens/ReceiptFormat";
import { TProvider, buildT } from "../../i18n";
import { SOLDOUT_DEFAULTS } from "../../../../server/fbSoldout.js";

beforeEach(() => { db.upserts.length = 0; db.soldout = { soldout_enabled: false, soldout_text: "" }; });

describe("gate", () => {
  it("all four must hold", () => {
    const all = { flag: true, receiptAccess: true, fbEnabled: true, hidden: false };
    expect(soldoutGate(all)).toBe(true);
    for (const k of ["flag", "receiptAccess", "fbEnabled"] as const) expect(soldoutGate({ ...all, [k]: false })).toBe(false);
    expect(soldoutGate({ ...all, hidden: true })).toBe(false);
  });
  it("only live Facebook comments with comment + page id", () => {
    expect(soldoutTarget({ platform: "Facebook", msgId: "1_2", pageId: "9" })).toEqual({ commentId: "1_2", pageId: "9" });
    expect(soldoutTarget({ platform: "TikTok", msgId: "1_2", pageId: "9" })).toBeNull();
    expect(soldoutTarget({ platform: "Facebook", msgId: "1_2", pageId: "9", initial: true })).toBeNull();
    expect(soldoutTarget({ platform: "Facebook", msgId: "", pageId: "9" })).toBeNull();
    expect(soldoutTarget({ platform: "Facebook", msgId: "1_2" })).toBeNull();
  });
  it("send: POST /fb/soldout/send with the bearer and the body", async () => {
    const f = vi.fn(async () => ({ status: 200, json: async () => ({ ok: true }) })) as unknown as typeof fetch;
    expect(await sendSoldOut({ pageId: "9", commentId: "1_2", code: "A1", lang: "fil", position: 2 }, f)).toEqual({ ok: true });
    const [url, init] = (f as unknown as { mock: { calls: [string, { headers: Record<string, string>; body: string }][] } }).mock.calls[0];
    expect(url).toMatch(/\/fb\/soldout\/send$/);
    expect(init.headers.Authorization).toBe("Bearer JWT");
    expect(JSON.parse(init.body)).toEqual({ pageId: "9", commentId: "1_2", code: "A1", lang: "fil", position: 2 });
    const g = vi.fn(async () => ({ status: 403, json: async () => ({ ok: false, error: "not_owned" }) })) as unknown as typeof fetch;
    expect(await sendSoldOut({ pageId: "9", commentId: "1_2", code: "A1", lang: "en" }, g)).toEqual({ ok: false, error: "not_owned" });
  });
});

describe("Receipt format", () => {
  const view = (extra: Record<string, unknown> = {}) => render(<TProvider lang="en"><ReceiptFormat cur="NT$" onBack={() => {}} {...extra} /></TProvider>);
  it("no prop → no section, same markup as before", async () => {
    const a = view();
    await waitFor(() => expect(screen.getByTestId("rc-save")).toBeTruthy());
    expect(screen.queryByTestId("rc-soldout")).toBeNull();
    a.unmount();
  });
  it("with the prop: default OFF, default text as placeholder, saved on its own → onChanged", async () => {
    const onChanged = vi.fn();
    view({ soldout: { onChanged } });
    await waitFor(() => expect(screen.getByTestId("rc-soldout-on")).toBeTruthy());
    expect((screen.getByTestId("rc-soldout-on") as HTMLInputElement).checked).toBe(false);
    expect((screen.getByTestId("rc-soldout-text") as HTMLTextAreaElement).placeholder).toBe(SOLDOUT_DEFAULTS.en.plain);
    fireEvent.click(screen.getByTestId("rc-soldout-on"));
    fireEvent.change(screen.getByTestId("rc-soldout-text"), { target: { value: "Ubos na {code}" } });
    fireEvent.click(screen.getByTestId("rc-soldout-save"));
    await waitFor(() => expect(onChanged).toHaveBeenCalledWith(true));
    expect(db.upserts.at(-1)).toMatchObject({ user_id: "u1", soldout_enabled: true, soldout_text: "Ubos na {code}" });
    expect(Object.keys(db.upserts.at(-1)!)).not.toContain("opening");   // receipt fields untouched
  });
});

describe("built-in text = the server's", () => {
  it("en / fil / zh / zh-TW placeholders match SOLDOUT_DEFAULTS; others = English", () => {
    for (const l of ["en", "fil", "zh", "zh-TW"] as const) expect(buildT(l).rd_rc_so_default).toBe(SOLDOUT_DEFAULTS[l].plain);
    for (const l of ["vi", "th", "id", "bg"]) expect(buildT(l).rd_rc_so_default).toBe(SOLDOUT_DEFAULTS.en.plain);
  });
});

describe("RedesignApp wiring (source contract)", () => {
  const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("gate uses fbAccess.receipt (never fbReceiptUi) + the world", () => {
    expect(src).toContain('const soldoutBase = soldoutGate({ flag: featureSw.fbSoldout, receiptAccess: fbAccess.receipt, fbEnabled, hidden: platformHides("fbSoldout", world) });');
  });
  it("called in the sold-out branch AFTER the badge, BEFORE the return", () => {
    expect(src).toContain('if (plan.kind === "soldout") { setAutoBadges((b) => ({ ...b, [key]: "soldout" })); onSoldOutFacebook(c, plan.code); return; }');
  });
  it("DB stock re-checked first; > 0 or unreadable → no message; one try per comment", () => {
    const i = src.indexOf("const onSoldOutFacebook = ");
    const b = src.slice(i, src.indexOf("\n  };", i));
    expect(b).toContain("if (!soldoutBase || !soldoutOn) return;");
    expect(b).toContain("soldoutSentRef.current.has(target.commentId)");
    expect(b.indexOf("loadProductStock(")).toBeLessThan(b.indexOf("sendSoldOut("));
    expect(b).toContain("if (stock == null) return;");
    expect(b).toContain("if (stock > 0) {");
  });
  it("autoMode.ts and the order hub are untouched by F2", () => {
    for (const f of ["src/redesign/adapters/autoMode.ts", "src/redesign/adapters/useOrders.ts"]) expect(readFileSync(f, "utf8")).not.toMatch(/soldout\/send|sendSoldOut|fbSoldout/);
  });
});

describe("sql/91 contract", () => {
  const sql = readFileSync(resolve(__dirname, "../../../../sql", "91_fb_soldout.sql"), "utf8");
  const code = sql.split("\n").filter((l) => !l.trimStart().startsWith("--")).join("\n");
  it("additive columns with safe defaults + checks; the unique index is not touched", () => {
    expect(code).toContain("add column if not exists soldout_enabled boolean not null default false");
    expect(code).toContain("add column if not exists soldout_text text not null default ''");
    expect(code).toContain("check (char_length(soldout_text) <= 500)");
    expect(code).toContain("add column if not exists kind text not null default 'receipt'");
    expect(code).toContain("check (kind in ('receipt', 'soldout'))");
    expect(code).not.toMatch(/fb_receipts_one_live_per_comment/);
  });
  it("rollback = plain drops", () => {
    const rb = readFileSync(resolve(__dirname, "../../../../sql", "91_fb_soldout_rollback.sql"), "utf8");
    expect(rb).not.toMatch(/if exists/i);
    expect(rb).toContain("alter table public.fb_receipts drop column kind;");
  });
});
