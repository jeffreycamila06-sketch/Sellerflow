// Account total, Build 2 (sql/85) — the app side: the Manage save never deletes hidden
// accounts (always), the over-limit view + labels and the picker order (enforcing only),
// and the readable refusal in 8 languages (iOS neutral). Other connect errors unchanged.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, screen, waitFor } from "@testing-library/react";
import { composeChannelSave, keepLockedAccounts, fitProfileAccounts, accountSlots, accountText, accountList } from "../connect";
import { buildT } from "../../i18n";
import { parseCoverage, overLimitView, isCovered, coveredTikTokNames, liveKeyOf, liveRefusedText, notCoveredLabel, type Coverage } from "../accountLive";
import { fbConnectFailText } from "../fb";
import type { AccountUser } from "../../../accountDb";

// ── composeChannelSave ───────────────────────────────────────────────────────
// Verbatim copy of composeChannelSave as it was on main before Build 2.
function oldCompose(original: { tiktok: string; facebook: string }, lists: { tiktok: string; facebook: string }, limit: number, isAdmin: boolean, unlocked: { tiktok?: number[]; facebook?: number[] } = {}) {
  if (isAdmin) return { tiktok: lists.tiktok, facebook: lists.facebook };
  const blank = (value: string, lim: number, u: number[]) => (u.length === 0 ? value : accountText(accountSlots(value, lim).map((v, i) => (u.includes(i) ? "" : v))));
  const ttU = unlocked.tiktok ?? [];
  const fbU = unlocked.facebook ?? [];
  const tiktok = keepLockedAccounts(original.tiktok, lists.tiktok, limit, ttU);
  const facebook = keepLockedAccounts(original.facebook, lists.facebook, limit, fbU);
  const capOriginal = { ...original, tiktok: blank(original.tiktok, limit, ttU), facebook: blank(original.facebook, limit, fbU) };
  const fitted = fitProfileAccounts(capOriginal, { tiktok, facebook }, limit);
  return { tiktok: fitted.tiktok, facebook: fitted.facebook };
}

describe("composeChannelSave", () => {
  it("within the plan: byte-identical to today (randomized)", () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    const pool = ["a", "b", "c", "d", "@E", " f ", "g"];
    const pick = (k: number) => Array.from({ length: k }, () => pool[rnd(pool.length)]);
    let checked = 0;
    for (let i = 0; i < 4000; i++) {
      const limit = [1, 2, 3, 5][rnd(4)];
      const tt = pick(rnd(limit + 1)); const fb = pick(rnd(limit + 1 - Math.min(limit, accountList(tt.join(",")).length)));
      const original = { tiktok: tt.join(rnd(2) ? "," : "\n"), facebook: fb.join(",") };
      if (accountList(original.tiktok).length + accountList(original.facebook).length > limit) continue;
      const lists = { tiktok: pick(rnd(limit + 2)).join("\n"), facebook: pick(rnd(limit + 1)).join("\n") };
      const unlocked = { tiktok: [0, 1, 2].filter(() => rnd(3) === 0), facebook: [0, 1].filter(() => rnd(4) === 0) };
      expect(composeChannelSave(original, lists, limit, false, unlocked), JSON.stringify({ original, lists, limit, unlocked })).toEqual(oldCompose(original, lists, limit, false, unlocked));
      checked++;
    }
    expect(checked).toBeGreaterThan(1000);
  });
  // Basic (limit 1) seller with 3 names after a downgrade; the editor (log-only) shows slot 0.
  const original = { tiktok: "a\nb\nc", facebook: "" };
  it("over the plan, change the visible slot: b and c are kept", () => {
    expect(oldCompose(original, { tiktok: "x", facebook: "" }, 1, false, { tiktok: [0] }).tiktok).toBe("x");   // today: b, c lost
    expect(composeChannelSave(original, { tiktok: "x", facebook: "" }, 1, false, { tiktok: [0] }).tiktok).toBe("b\nc\nx");
  });
  it("over the plan, clear the visible slot: b and c are kept", () => {
    expect(composeChannelSave(original, { tiktok: "", facebook: "" }, 1, false, { tiktok: [0] }).tiktok).toBe("b\nc");
  });
  it("over the plan, add nothing: unchanged", () => {
    expect(composeChannelSave(original, { tiktok: "a", facebook: "" }, 1, false, {}).tiktok).toBe("a\nb\nc");
  });
  it("over the plan, editing a later slot (all shown while enforcing) keeps the rest", () => {
    expect(composeChannelSave(original, { tiktok: "a\nb\ny", facebook: "" }, 1, false, { tiktok: [2] }).tiktok).toBe("a\nb\ny");
    expect(composeChannelSave(original, { tiktok: "a\n\nc", facebook: "" }, 1, false, { tiktok: [1] }).tiktok).toBe("a\nc");
  });
  it("over the plan, nothing new is added beyond what is saved", () => {
    expect(composeChannelSave(original, { tiktok: "a\nb\nc\nz", facebook: "" }, 1, false, {}).tiktok).toBe("a\nb\nc");
  });
  it("the other platform's hidden names are kept too", () => {
    expect(composeChannelSave({ tiktok: "a", facebook: "f1\nf2" }, { tiktok: "", facebook: "f1" }, 1, false, { tiktok: [0] })).toEqual({ tiktok: "", facebook: "f1\nf2" });
  });
});

// ── coverage helpers ─────────────────────────────────────────────────────────
const cov = (o: Partial<Coverage> = {}): Coverage => ({
  enforce: true, limit: 1, unlimited: false, total: 3,
  accounts: [
    { platform: "tiktok", key: "b", rank: 1, covered: true },
    { platform: "facebook", key: "P1", rank: 2, covered: false },
    { platform: "tiktok", key: "a", rank: 3, covered: false },
  ], ...o,
});

describe("coverage helpers", () => {
  it("parse: junk → null", () => {
    expect(parseCoverage(null)).toBeNull();
    expect(parseCoverage({ limit: 1, total: 1 })).toBeNull();
    expect(parseCoverage({ enforce: true, limit: 1, unlimited: false, total: 1, accounts: [{ platform: "tiktok", key: "a", rank: 1, covered: true }, { platform: "x", key: 1 }] })?.accounts).toHaveLength(1);
  });
  it("the over-limit view applies only while enforcing, over the plan, not unlimited", () => {
    expect(overLimitView(cov())).toBe(true);
    expect(overLimitView(cov({ enforce: false }))).toBe(false);
    expect(overLimitView(cov({ total: 1 }))).toBe(false);
    expect(overLimitView(cov({ unlimited: true }))).toBe(false);
    expect(overLimitView(null)).toBe(false);
  });
  it("keys match the database normalization", () => {
    expect(liveKeyOf("tiktok", "\t @MyShop\u200b\r")).toBe("myshop");
    expect(liveKeyOf("facebook", " 123 ")).toBe("123");
  });
  it("isCovered: true / false while the view applies, null otherwise", () => {
    expect(isCovered(cov(), "tiktok", "@B")).toBe(true);
    expect(isCovered(cov(), "tiktok", "a")).toBe(false);
    expect(isCovered(cov(), "facebook", "P1")).toBe(false);
    expect(isCovered(cov({ enforce: false }), "tiktok", "a")).toBeNull();
  });
  it("picker: oldest covered first while enforcing; null (today's list) otherwise", () => {
    expect(coveredTikTokNames(["a", "B"], cov())).toEqual(["B"]);
    expect(coveredTikTokNames(["a", "B"], cov({ enforce: false }))).toBeNull();
    expect(coveredTikTokNames(["a", "B"], null)).toBeNull();
    const two = cov({ limit: 2, total: 3, accounts: [{ platform: "tiktok", key: "c", rank: 1, covered: true }, { platform: "tiktok", key: "a", rank: 2, covered: true }, { platform: "tiktok", key: "b", rank: 3, covered: false }] });
    expect(coveredTikTokNames(["a", "b", "c"], two)).toEqual(["c", "a"]);
  });
  it("RedesignApp: the picker falls back to today's list (source pin)", () => {
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain('? coveredTikTokNames(accountList(auth.profile.profile.tiktok), liveCoverage) ?? registeredAccountsFor(auth.profile, "TikTok")');
    // FIX 2: re-read when the TikTok list, the plan, the Pages or the shops change.
    expect(src).toContain('useAccountCoverage([auth.profile?.profile.tiktok ?? "", auth.profile?.plan ?? "", fbPages.map((p) => p.pageId).join(","), shopeeShops.map((s) => s.shopId).join(",")].join("|"))');
  });
});

// ── texts ────────────────────────────────────────────────────────────────────
const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const BANNED = /plan|upgrade|price|NT\$|₱|套餐|方案|升级|升級|gói|nâng cấp|แพ็กเกจ|อัปเกรด|paket|план|надгради/i;

describe("texts in 8 languages", () => {
  it("present, with placeholders", () => {
    for (const l of LANGS) {
      const t = buildT(l);
      for (const k of ["rd_acct_live_refused", "rd_acct_live_refused_ios", "rd_acct_not_covered", "rd_acct_not_covered_ios"]) expect(t[k], `${l}.${k}`).toBeTruthy();
      expect(t.rd_acct_live_refused).toContain("{plan}");
      expect(t.rd_acct_live_refused).toContain("{max}");
      expect(t.rd_acct_live_refused_ios).toContain("{max}");
    }
  });
  it("English wording", () => {
    const t = buildT("en");
    expect(liveRefusedText(t, { ios: false, planName: "Basic", max: 1 })).toBe("Your Basic plan covers 1 account(s) across all live platforms. Only your 1 oldest can go live. Remove an account or upgrade.");
    expect(notCoveredLabel(t, false)).toBe("Not covered by your plan");
  });
  it("iOS: no plan, upgrade or price words — every language", () => {
    for (const l of LANGS) {
      const t = buildT(l);
      for (const m of [liveRefusedText(t, { ios: true, planName: "Basic", max: 1 }), notCoveredLabel(t, true)]) {
        expect(m, `${l}: ${m}`).not.toMatch(BANNED);
        expect(m).not.toContain("Basic");
      }
    }
  });
});

describe("Facebook toast: only the new code is mapped", () => {
  const t = buildT("en");
  const live = { ios: false, planName: "Plus", max: 2 };
  it("account_not_covered → readable text, never the raw code", () => {
    const m = fbConnectFailText({ ok: false, error: "account_not_covered" }, t, live);
    expect(m).toBe(liveRefusedText(t, live));
    expect(m).not.toContain("account_not_covered");
  });
  it("other errors exactly as before", () => {
    for (const r of [{ ok: false, error: "needs_reauth" }, { ok: false, error: "too_many_requests" }, { ok: false, reason: "not_live" }, { ok: false, error: "plan_expired" }, { ok: false, fbCode: 4 }]) {
      expect(fbConnectFailText(r as never, t, live)).toBe(fbConnectFailText(r as never, t));
    }
  });
});

describe("TikTok and Shopee: only the new code is mapped (source pins)", () => {
  const app = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
  it("TikTok: account_not_covered → readable text; every other error → the generic text (Build 10)", () => {
    const body = app.slice(app.indexOf("const performConnect = async"), app.indexOf("const doConnect = async"));
    expect(body).toContain('if (!r.ok && (r.error === ACCOUNT_NOT_COVERED || (platform === "TikTok" && r.error === "account_limit"))) { setToast({ msg: liveRefusedText(tApp,');
    expect(body.match(/account_limit/g)).toHaveLength(2);   // the mapping + its comment only
    expect(body).toContain("if (!r.ok) setToast({ msg: connectFailText(r, tApp), kind: \"err\" });"); // Build 10: never the server's words
    expect(body.indexOf("ACCOUNT_NOT_COVERED")).toBeLessThan(body.indexOf("if (!r.ok) setToast({ msg: connectFailText("));
  });
  it("Shopee: account_not_covered → readable text in the connect sheet", () => {
    const cm = readFileSync("src/redesign/screens/ConnectModal.tsx", "utf8");
    expect(cm).toContain("r.error === ACCOUNT_NOT_COVERED ? liveRefusedText(t,");
    expect(cm).toContain(": t.rd_shp_connect_failed); return; }"); // Build 10: never the server's words
  });
  it("LIVE_SOURCE_EMAILS carries the switch note", () => {
    const ls = readFileSync("src/redesign/adapters/liveSource.ts", "utf8");
    expect(ls).toMatch(/account_live_unregistered_enforce[\s\S]{0,300}sql\/112 feature "live_source"/); // Build 10b: the list moved to the database
  });
});

// ── Manage screen: over-limit view only while enforcing ─────────────────────
const rpc = vi.fn<(name: string) => Promise<{ data: unknown; error: unknown }>>();
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc: (name: string) => rpc(name) } }));
const { default: ManageChannels } = await import("../../screens/ManageChannels");
const { TProvider } = await import("../../i18n");
const acct: AccountUser = {
  authUserId: "u", email: "g@x.com",
  profile: { fullName: "O", storeName: "S", phone: "", tiktok: "a\nb\nc", facebook: "", adminContactNote: "" },
  plan: "basic", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};
const covData = (enforce: boolean) => ({ enforce, limit: 1, unlimited: false, total: 3, accounts: [
  { platform: "tiktok", key: "b", rank: 1, covered: true }, { platform: "tiktok", key: "a", rank: 2, covered: false }, { platform: "tiktok", key: "c", rank: 3, covered: false }] });

describe("Manage TikTok screen", () => {
  beforeEach(() => rpc.mockReset());
  it("enforcing + over the plan: all 3 names, 'not covered' on 2, no empty slot", async () => {
    rpc.mockImplementation(async (n) => (n === "account_live_coverage" ? { data: covData(true), error: null } : { data: null, error: { message: "x" } }));
    render(<TProvider lang="en"><ManageChannels platform="tiktok" account={acct} onBack={() => {}} onSaveChannels={async () => ({ ok: true })} /></TProvider>);
    await waitFor(() => expect(screen.getByDisplayValue("c")).toBeTruthy());
    expect(screen.getByDisplayValue("a")).toBeTruthy();
    expect(screen.getByDisplayValue("b")).toBeTruthy();
    expect(screen.getAllByTestId("mc-not-covered")).toHaveLength(2);
    expect(screen.queryAllByDisplayValue("")).toHaveLength(0);
  });
  it("log-only: exactly today's view (one slot, no label)", async () => {
    rpc.mockImplementation(async (n) => (n === "account_live_coverage" ? { data: covData(false), error: null } : { data: null, error: { message: "x" } }));
    render(<TProvider lang="en"><ManageChannels platform="tiktok" account={acct} onBack={() => {}} onSaveChannels={async () => ({ ok: true })} /></TProvider>);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("account_live_coverage"));
    expect(screen.getByDisplayValue("a")).toBeTruthy();
    expect(screen.queryByDisplayValue("b")).toBeNull();
    expect(screen.queryAllByTestId("mc-not-covered")).toHaveLength(0);
  });
  it("coverage unreadable: today's view", async () => {
    rpc.mockImplementation(async () => ({ data: null, error: { message: "function does not exist" } }));
    render(<TProvider lang="en"><ManageChannels platform="tiktok" account={acct} onBack={() => {}} onSaveChannels={async () => ({ ok: true })} /></TProvider>);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("account_live_coverage"));
    expect(screen.queryByDisplayValue("b")).toBeNull();
  });
});

describe("Facebook Pages / Shopee shops: 'not covered' label", () => {
  beforeEach(() => rpc.mockReset());
  const mixed = (enforce: boolean) => ({ enforce, limit: 1, unlimited: false, total: 3, accounts: [
    { platform: "facebook", key: "P1", rank: 1, covered: true }, { platform: "facebook", key: "P2", rank: 2, covered: false }, { platform: "shopee", key: "9", rank: 3, covered: false }] });
  const pages = [{ id: "1", pageId: "P1", name: "One", username: "", active: true }, { id: "2", pageId: "P2", name: "Two", username: "", active: true }];
  const shops = [{ id: "s9", shopId: 9, shopName: "Nine", active: true }];
  it("enforcing + over the plan: labels only the not-covered rows", async () => {
    rpc.mockImplementation(async (n) => (n === "account_live_coverage" ? { data: mixed(true), error: null } : { data: null, error: { message: "x" } }));
    const { default: FbChannels } = await import("../../screens/FbChannels");
    const { default: ShopeeChannels } = await import("../../screens/ShopeeChannels");
    const fb = render(<TProvider lang="en"><FbChannels account={acct} pages={pages} onReload={() => {}} onBack={() => {}} onUpsell={() => {}} /></TProvider>);
    await waitFor(() => expect(fb.getAllByTestId("not-covered")).toHaveLength(1));
    fb.unmount();
    const sh = render(<TProvider lang="en"><ShopeeChannels account={acct} shops={shops} onReload={() => {}} onBack={() => {}} onUpsell={() => {}} /></TProvider>);
    await waitFor(() => expect(sh.getAllByTestId("not-covered")).toHaveLength(1));
  });
  it("log-only: no label", async () => {
    rpc.mockImplementation(async (n) => (n === "account_live_coverage" ? { data: mixed(false), error: null } : { data: null, error: { message: "x" } }));
    const { default: FbChannels } = await import("../../screens/FbChannels");
    render(<TProvider lang="en"><FbChannels account={acct} pages={pages} onReload={() => {}} onBack={() => {}} onUpsell={() => {}} /></TProvider>);
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("account_live_coverage"));
    expect(screen.queryAllByTestId("not-covered")).toHaveLength(0);
  });
});
