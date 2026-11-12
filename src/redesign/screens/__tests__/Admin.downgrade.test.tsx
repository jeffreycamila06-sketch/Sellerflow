// Admin → Manage sellers (sql/153):
//   • the card shows the Pages / Instagram / Shopee accounts the seller CONNECTED (name + date)
//     and "Accounts N" counts them (Kevin: 1 TikTok + 1 Page = 2);
//   • a plan DOWNGRADE that leaves the seller over the new plan's TOTAL opens a confirm dialog
//     BEFORE anything is saved: every account listed, the newest N − M pre-checked, OK only
//     with exactly N − M checked; OK = plan + removal in one step; Cancel = nothing;
//   • within the limit / an upgrade / expiry → no dialog and nothing is ever removed.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, within } from "@testing-library/react";
import { readFileSync, readdirSync } from "node:fs";
import { TProvider } from "../../i18n";
import type { AccountUser } from "../../../accountDb";
import type { AdminActions } from "../../adapters/useAdmin";

const DB = vi.hoisted(() => ({
  connected: [] as unknown[] | null,
  seller: {} as Record<string, unknown>,       // user id → admin_seller_accounts answer
  sellerError: null as null | { code?: string; message: string },
  rpcs: [] as { fn: string; args: unknown }[],
}));
vi.mock("../../../supabase", () => {
  const from = () => ({ select: async () => ({ data: [], error: null }), upsert: async () => ({ error: null }), delete: () => ({ eq: async () => ({ error: null }) }) });
  const rpc = async (fn: string, args?: { p_user?: string }) => {
    DB.rpcs.push({ fn, args });
    if (fn === "admin_connected_accounts") return DB.connected ? { data: DB.connected, error: null } : { data: null, error: { message: "boom" } };
    if (fn === "admin_seller_accounts") return DB.sellerError ? { data: null, error: DB.sellerError } : { data: DB.seller[String(args?.p_user)] ?? null, error: null };
    return { data: null, error: { message: "not mocked" } };
  };
  return { supabase: { from, rpc, auth: { getSession: async () => ({ data: { session: null } }) } }, isSupabaseConfigured: true };
});
vi.mock("../../adapters/appShell", async (importActual) => ({ ...(await importActual<object>()), isAppShell: () => false }));

import { AdminPanel } from "../Admin";
import { accountUsersToRedesign } from "../../adapters/useReadData";

const mk = (id: string, email: string, plan: AccountUser["plan"], tiktok: string, extra: Partial<AccountUser> = {}): AccountUser => ({
  authUserId: id, email, plan, planStatus: "active", planExpiry: new Date(Date.now() + 30 * 864e5).toISOString(), connectedAccounts: [], role: "seller", createdAt: "2026-11-01T00:00:00Z",
  profile: { fullName: "", storeName: "", phone: "", tiktok, facebook: "", adminContactNote: "", country: "TW" }, ...extra,
});
const RAW = [
  mk("u-kevin", "kevin@x.com", "plus", "kevintt"),
  mk("u-plus", "plus11@x.com", "plus", "olderTT"),
  mk("u-pro", "pro@x.com", "pro", "a\nb"),
  mk("u-solo", "solo@x.com", "plus", "only"),
];
const rawByEmail = Object.fromEntries(RAW.map((u) => [u.email, u]));
const users = accountUsersToRedesign(RAW);

const acct = (platform: string, key: string, name: string, rank: number, added: string) => ({ platform, key, name, rank, added_at: added });
const actions = () => ({
  changePlan: vi.fn(async () => ({ ok: true })), expire: vi.fn(async () => ({ ok: true })), downgradeRemove: vi.fn(async () => ({ ok: true, liveStopped: true })),
  shopeeBetaList: vi.fn(async () => ({})), editAccounts: vi.fn(async () => ({ ok: true })),
} as unknown as AdminActions & { changePlan: ReturnType<typeof vi.fn>; expire: ReturnType<typeof vi.fn>; downgradeRemove: ReturnType<typeof vi.fn> });

const toasts: { msg: string; kind: string }[] = [];
const view = (a: AdminActions) => render(<TProvider lang="en"><AdminPanel panel="sellers" onClose={() => {}} cur="NT$" users={users} usersState="live" rawByEmail={rawByEmail} actions={a} onToast={(msg, kind) => toasts.push({ msg, kind })} /></TProvider>);
const card = (r: ReturnType<typeof view>, email: string) => r.getAllByText(email).map((n) => n.closest("[data-testid=adm-seller-head]")).find(Boolean)!.parentElement as HTMLElement;
const planBtn = (r: ReturnType<typeof view>, email: string, label: string) => within(card(r, email)).getByRole("button", { name: label });
const sellerCalls = () => DB.rpcs.filter((c) => c.fn === "admin_seller_accounts").length;

beforeEach(() => {
  toasts.length = 0; DB.rpcs = []; DB.sellerError = null;
  DB.connected = [
    { user_id: "u-kevin", platform: "facebook", key: "K1", name: "Kais Taiwan", connected_at: "2026-11-07T07:07:36Z" },
    { user_id: "u-plus", platform: "facebook", key: "P1", name: "Newer Page", connected_at: "2026-10-13T07:00:00Z" },
    { user_id: "u-pro", platform: "instagram", key: "I1", name: "shop.ig", connected_at: "2026-10-20T07:00:00Z" },
    { user_id: "u-pro", platform: "shopee", key: "501", name: "Shop 501", connected_at: "2026-10-21T07:00:00Z" },
  ];
  DB.seller = {
    "u-plus": { plan: "plus", limit: 2, unlimited: false, accounts: [acct("tiktok", "oldertt", "oldertt", 1, "2026-07-24T00:00:00Z"), acct("facebook", "P1", "Newer Page", 2, "2026-10-13T07:00:00Z")] },
    "u-pro": { plan: "pro", limit: 3, unlimited: false, accounts: [acct("tiktok", "a", "a", 1, "2026-07-01T00:00:00Z"), acct("tiktok", "b", "b", 2, "2026-07-01T00:00:00.001Z"), acct("instagram", "I1", "shop.ig", 3, "2026-10-20T07:00:00Z"), acct("shopee", "501", "Shop 501", 4, "2026-10-21T07:00:00Z")] },
    "u-solo": { plan: "plus", limit: 2, unlimited: false, accounts: [acct("tiktok", "only", "only", 1, "2026-07-01T00:00:00Z")] },
    "u-kevin": { plan: "plus", limit: 2, unlimited: true, accounts: [acct("facebook", "K1", "Kais Taiwan", 1, "2026-11-07T07:07:36Z"), acct("tiktok", "kevintt", "kevintt", 2, "2026-11-11T00:00:00Z")] },
  };
  window.confirm = vi.fn(() => true);
});

describe("Manage sellers card — connected accounts", () => {
  it("Kevin: the connected Page (name + date) is shown and Accounts = 2", async () => {
    const r = view(actions());
    await waitFor(() => expect(within(card(r, "kevin@x.com")).getByTestId("adm-accounts").textContent).toBe("2"));
    const lines = within(card(r, "kevin@x.com")).getByTestId("adm-connected").textContent || "";
    expect(lines).toContain("Facebook");
    expect(lines).toContain("Kais Taiwan");
    expect(lines).toContain("since Nov 7, 2026");
    // Instagram + Shopee are listed and counted too (2 TikTok + 1 + 1)
    expect(within(card(r, "pro@x.com")).getByTestId("adm-accounts").textContent).toBe("4");
    expect(within(card(r, "pro@x.com")).getByTestId("adm-connected").textContent).toMatch(/Instagram shop\.ig.*Shopee Shop 501/);
    // a seller with nothing connected: no extra lines, TikTok count only
    expect(within(card(r, "solo@x.com")).queryByTestId("adm-connected")).toBeNull();
    expect(within(card(r, "solo@x.com")).getByTestId("adm-accounts").textContent).toBe("1");
  });
  it("the read fails (sql/153 not applied) → the card is exactly as before: TikTok count, no lines", async () => {
    DB.connected = null;
    const r = view(actions());
    await waitFor(() => expect(DB.rpcs.some((c) => c.fn === "admin_connected_accounts")).toBe(true));
    expect(within(card(r, "kevin@x.com")).getByTestId("adm-accounts").textContent).toBe("1");
    expect(within(card(r, "kevin@x.com")).queryByTestId("adm-connected")).toBeNull();
  });
  it("Edit accounts: connected accounts are read-only lines; the old typed field has its own clear label", async () => {
    const r = view(actions());
    await waitFor(() => expect(within(card(r, "kevin@x.com")).getByTestId("adm-accounts").textContent).toBe("2"));
    fireEvent.click(within(card(r, "kevin@x.com")).getByRole("button", { name: "Edit" }));
    const box = await r.findByTestId("adm-edit-connected");
    expect(box.textContent).toContain("Connected by the seller");
    expect(box.textContent).toContain("Kais Taiwan");
    expect(box.textContent).toContain("Nov 7, 2026");
    expect(box.querySelector("input, textarea, button")).toBeNull(); // read-only
    expect(r.getByText("Facebook names (old typed list)")).toBeTruthy();
    expect(r.getByText("Not the connected Pages. Connected Pages are listed below.")).toBeTruthy();
  });
});

describe("plan downgrade over the TOTAL → confirm dialog before saving", () => {
  it("Plus 1 TikTok + 1 FB → Basic: the dialog lists both, the newest (FB) is pre-checked; OK removes FB and sets Basic", async () => {
    const a = actions();
    const r = view(a);
    fireEvent.click(planBtn(r, "plus11@x.com", "Basic"));
    const dlg = await r.findByTestId("dg-dialog");
    expect(a.changePlan).not.toHaveBeenCalled();       // nothing saved yet
    expect(window.confirm).not.toHaveBeenCalled();
    expect(within(dlg).getByTestId("dg-lead").textContent).toBe("Over the plan limit (2, Basic allows 1). Will remove:");
    const fb = within(dlg).getByTestId("dg-check-facebook:P1") as HTMLInputElement;
    const tt = within(dlg).getByTestId("dg-check-tiktok:oldertt") as HTMLInputElement;
    expect([tt.checked, fb.checked]).toEqual([false, true]);
    expect(dlg.textContent).toContain("@oldertt");
    expect(dlg.textContent).toContain("Newer Page");
    expect(dlg.textContent).toContain("since Oct 13, 2026");
    expect(dlg.textContent).toContain("Orders, customers and all other data stay.");
    fireEvent.click(within(dlg).getByTestId("dg-ok"));
    await waitFor(() => expect(a.downgradeRemove).toHaveBeenCalledTimes(1));
    const [email, userId, plan, current, items] = a.downgradeRemove.mock.calls[0];
    expect([email, userId, plan]).toEqual(["plus11@x.com", "u-plus", "basic"]);
    expect((current as { status: string }).status).toBe("active");
    expect(items).toEqual([{ platform: "facebook", key: "P1", name: "Newer Page" }]);
    expect(a.changePlan).not.toHaveBeenCalled();       // ONE step, not plan-then-remove
    await waitFor(() => expect(r.queryByTestId("dg-dialog")).toBeNull());
    expect(toasts.at(-1)).toEqual({ msg: "Plan changed to Basic. Removed: Facebook Newer Page.", kind: "ok" });
  });
  it("switching the check to TikTok removes TikTok instead", async () => {
    const a = actions();
    const r = view(a);
    fireEvent.click(planBtn(r, "plus11@x.com", "Basic"));
    const dlg = await r.findByTestId("dg-dialog");
    fireEvent.click(within(dlg).getByTestId("dg-check-facebook:P1"));
    fireEvent.click(within(dlg).getByTestId("dg-check-tiktok:oldertt"));
    fireEvent.click(within(dlg).getByTestId("dg-ok"));
    await waitFor(() => expect(a.downgradeRemove).toHaveBeenCalledTimes(1));
    expect(a.downgradeRemove.mock.calls[0][4]).toEqual([{ platform: "tiktok", key: "oldertt", name: "oldertt" }]);
    await waitFor(() => expect(toasts.at(-1)?.msg).toBe("Plan changed to Basic. Removed: TikTok @oldertt."));
  });
  it("OK stays disabled until EXACTLY N − M are checked (0, too many, back to exact)", async () => {
    const a = actions();
    const r = view(a);
    fireEvent.click(planBtn(r, "pro@x.com", "Basic")); // 4 accounts, Basic allows 1 → remove 3
    const dlg = await r.findByTestId("dg-dialog");
    const ok = within(dlg).getByTestId("dg-ok") as HTMLButtonElement;
    const box = (id: string) => within(dlg).getByTestId(`dg-check-${id}`) as HTMLInputElement;
    expect(["tiktok:a", "tiktok:b", "instagram:I1", "shopee:501"].map((i) => box(i).checked)).toEqual([false, true, true, true]); // the 3 newest
    expect(within(dlg).getByTestId("dg-pick").textContent).toBe("Check exactly 3 to remove. Checked: 3.");
    expect(ok.disabled).toBe(false);
    fireEvent.click(box("shopee:501"));            // 2 checked
    expect(ok.disabled).toBe(true);
    fireEvent.click(ok);
    expect(a.downgradeRemove).not.toHaveBeenCalled();
    fireEvent.click(box("tiktok:a")); fireEvent.click(box("shopee:501")); // 4 checked
    expect(ok.disabled).toBe(true);
    fireEvent.click(box("tiktok:b"));              // 3 checked again (a, I1, 501)
    expect(ok.disabled).toBe(false);
    fireEvent.click(ok);
    await waitFor(() => expect(a.downgradeRemove).toHaveBeenCalledTimes(1));
    expect((a.downgradeRemove.mock.calls[0][4] as { key: string }[]).map((i) => i.key)).toEqual(["a", "I1", "501"]);
  });
  it("Cancel changes nothing — no plan change, no removal", async () => {
    const a = actions();
    const r = view(a);
    fireEvent.click(planBtn(r, "plus11@x.com", "Basic"));
    fireEvent.click(within(await r.findByTestId("dg-dialog")).getByTestId("dg-cancel"));
    expect(r.queryByTestId("dg-dialog")).toBeNull();
    expect(a.downgradeRemove).not.toHaveBeenCalled();
    expect(a.changePlan).not.toHaveBeenCalled();
    expect(toasts).toEqual([]);
    // tapping outside the dialog = Cancel too
    fireEvent.click(planBtn(r, "plus11@x.com", "Basic"));
    await r.findByTestId("dg-dialog");
    fireEvent.click(r.getByTestId("dg-overlay"));
    expect(r.queryByTestId("dg-dialog")).toBeNull();
    expect(a.downgradeRemove).not.toHaveBeenCalled();
    expect(a.changePlan).not.toHaveBeenCalled();
  });
  it("a downgrade WITHIN the limit shows no dialog: the plain plan change, nothing removed", async () => {
    const a = actions();
    const r = view(a);
    fireEvent.click(planBtn(r, "solo@x.com", "Basic")); // 1 account, Basic allows 1
    await waitFor(() => expect(a.changePlan).toHaveBeenCalledTimes(1));
    expect(a.changePlan.mock.calls[0].slice(0, 2)).toEqual(["solo@x.com", "basic"]);
    expect(r.queryByTestId("dg-dialog")).toBeNull();
    expect(a.downgradeRemove).not.toHaveBeenCalled();
  });
  it("an upgrade / the same plan never reads the accounts and never opens the dialog", async () => {
    const a = actions();
    const r = view(a);
    fireEvent.click(planBtn(r, "plus11@x.com", "Plus"));   // the same plan
    await waitFor(() => expect(a.changePlan).toHaveBeenCalledTimes(1));
    fireEvent.click(planBtn(r, "plus11@x.com", "Pro"));    // an upgrade
    await waitFor(() => expect(a.changePlan).toHaveBeenCalledTimes(2));
    expect(sellerCalls()).toBe(0);
    expect(r.queryByTestId("dg-dialog")).toBeNull();
    expect(a.downgradeRemove).not.toHaveBeenCalled();
  });
  it("EXPIRY removes nothing: Expire never opens the dialog and never calls the removal", async () => {
    const a = actions();
    const r = view(a);
    fireEvent.click(within(card(r, "plus11@x.com")).getByText("Expire"));
    await waitFor(() => expect(a.expire).toHaveBeenCalledTimes(1));
    expect(r.queryByTestId("dg-dialog")).toBeNull();
    expect(a.downgradeRemove).not.toHaveBeenCalled();
    expect(sellerCalls()).toBe(0);
  });
  it("an admin / exempt seller (no limit) → the plain plan change, no dialog", async () => {
    const a = actions();
    const r = view(a);
    fireEvent.click(planBtn(r, "kevin@x.com", "Basic")); // the mock marks this one unlimited
    await waitFor(() => expect(a.changePlan).toHaveBeenCalledTimes(1));
    expect(r.queryByTestId("dg-dialog")).toBeNull();
  });
  it("the accounts cannot be read (a real error) → NOTHING is changed, an error is shown", async () => {
    DB.sellerError = { code: "57014", message: "canceling statement due to statement timeout" };
    const a = actions();
    const r = view(a);
    fireEvent.click(planBtn(r, "plus11@x.com", "Basic"));
    await waitFor(() => expect(toasts.at(-1)).toEqual({ msg: "Couldn't read this seller's accounts. The plan was not changed — try again.", kind: "err" }));
    expect(a.changePlan).not.toHaveBeenCalled();
    expect(a.downgradeRemove).not.toHaveBeenCalled();
    expect(r.queryByTestId("dg-dialog")).toBeNull();
  });
  it("sql/153 not applied yet (function missing) → the plan change works as before, nothing removed", async () => {
    DB.sellerError = { code: "PGRST202", message: "Could not find the function public.admin_seller_accounts(p_user) in the schema cache" };
    const a = actions();
    const r = view(a);
    fireEvent.click(planBtn(r, "plus11@x.com", "Basic"));
    await waitFor(() => expect(a.changePlan).toHaveBeenCalledTimes(1));
    expect(a.downgradeRemove).not.toHaveBeenCalled();
  });
  it("the removal is refused because the accounts changed → dialog closes, nothing claimed, plan pill unchanged", async () => {
    const a = actions();
    a.downgradeRemove.mockResolvedValueOnce({ ok: false, error: "accounts_changed" });
    const r = view(a);
    fireEvent.click(planBtn(r, "plus11@x.com", "Basic"));
    fireEvent.click(within(await r.findByTestId("dg-dialog")).getByTestId("dg-ok"));
    await waitFor(() => expect(toasts.at(-1)?.msg).toBe("This seller's accounts just changed. Nothing was changed — open the list again."));
    expect(r.queryByTestId("dg-dialog")).toBeNull();
    expect(a.changePlan).not.toHaveBeenCalled();
  });
  it("any other failure keeps the dialog open and says nothing was changed", async () => {
    const a = actions();
    a.downgradeRemove.mockResolvedValueOnce({ ok: false, error: "error" });
    const r = view(a);
    fireEvent.click(planBtn(r, "plus11@x.com", "Basic"));
    fireEvent.click(within(await r.findByTestId("dg-dialog")).getByTestId("dg-ok"));
    await waitFor(() => expect(toasts.at(-1)).toEqual({ msg: "Couldn't change the plan. Nothing was changed or removed.", kind: "err" }));
    expect(r.getByTestId("dg-dialog")).toBeTruthy();
  });
  it("a live that could not be stopped is said plainly (the removal itself is done)", async () => {
    const a = actions();
    a.downgradeRemove.mockResolvedValueOnce({ ok: true, liveStopped: false });
    const r = view(a);
    fireEvent.click(planBtn(r, "plus11@x.com", "Basic"));
    fireEvent.click(within(await r.findByTestId("dg-dialog")).getByTestId("dg-ok"));
    await waitFor(() => expect(toasts.at(-1)?.msg).toContain("that live keeps running until it ends"));
  });
});

describe("source: the removal has exactly one caller", () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  it("actions.downgradeRemove is called only from the dialog's confirm; Expire / add days / edit accounts never reach it", () => {
    const src = strip(readFileSync("src/redesign/screens/Admin.tsx", "utf8"));
    expect(src.match(/downgradeRemove\(/g)?.length).toBe(1);
    const confirm = src.slice(src.indexOf("const confirmDowngrade"), src.indexOf("const doPassword"));
    expect(confirm).toContain("actions.downgradeRemove(");
    const admin = strip(readFileSync("src/redesign/adapters/useAdmin.ts", "utf8"));
    const expire = admin.slice(admin.indexOf("const expire = useCallback"), admin.indexOf("const setPassword"));
    expect(expire).not.toMatch(/downgrade|admin_downgrade_remove|stopRemovedLives/);
    expect(admin.match(/downgradeRemoveRpc\(/g)?.length).toBe(1);
  });
  it("the database function is called from ONE place in the app", () => {
    const hits: string[] = [];
    const walk = (d: string) => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = `${d}/${f.name}`; if (f.isDirectory()) { if (f.name !== "__tests__" && f.name !== "node_modules") walk(p); } else if (/\.(ts|tsx|js)$/.test(f.name) && strip(readFileSync(p, "utf8")).includes("admin_downgrade_remove")) hits.push(p); } };
    walk("src"); walk("server");
    expect(hits).toEqual(["src/redesign/adapters/adminAccounts.ts"]);
    expect(strip(readFileSync("server.js", "utf8"))).not.toContain("admin_downgrade_remove");
  });
});
