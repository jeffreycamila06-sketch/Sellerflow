// Combined account limit (sql/84) — web side: the quota line, the blocked-add messages in
// all 8 languages (iOS neutral), and a refused TikTok save keeping the typed value.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { buildT } from "../../i18n";
import { parseQuota, quotaLineText, accountLimitText, isAccountLimitError, type AccountQuota } from "../accountQuota";
import { fbReturnText } from "../fb";

const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"];
const KEYS = ["rd_acct_used", "rd_acct_limit", "rd_acct_limit_ios", "rd_acct_locked", "rd_acct_limit_generic", "rd_acct_limit_generic_ios"];
const q = (o: Partial<AccountQuota> = {}): AccountQuota => ({ used: 1, limit: 1, unlimited: false, locked: 0, nextFreeAt: null, ...o });

describe("parse / line", () => {
  it("parses the RPC result; junk → null", () => {
    expect(parseQuota({ used: 2, limit: 3, unlimited: false, locked: 1, next_free_at: "2026-10-08T10:00:00Z" }))
      .toEqual({ used: 2, limit: 3, unlimited: false, locked: 1, nextFreeAt: "2026-10-08T10:00:00Z" });
    expect(parseQuota(null)).toBeNull();
    expect(parseQuota({ used: "x" })).toBeNull();
  });
  it("line: 'Accounts used: X of Y'; nothing when unknown or unlimited", () => {
    const t = buildT("en");
    expect(quotaLineText(q({ used: 2, limit: 3 }), t)).toBe("Accounts used: 2 of 3");
    expect(quotaLineText(null, t)).toBeNull();
    expect(quotaLineText(q({ unlimited: true }), t)).toBeNull();
  });
  it("detects the database error", () => {
    expect(isAccountLimitError(new Error("account_limit (hint)"))).toBe(true);
    expect(isAccountLimitError(new Error("permission denied"))).toBe(false);
  });
});

describe("messages in all 8 languages", () => {
  it("every key exists, is non-empty and keeps its placeholders", () => {
    const ph: Record<string, string[]> = { rd_acct_used: ["{used}", "{max}"], rd_acct_limit: ["{plan}", "{max}", "{used}"], rd_acct_limit_ios: ["{max}", "{used}"], rd_acct_locked: ["{time}"] };
    for (const l of LANGS) {
      const t = buildT(l);
      for (const k of KEYS) {
        expect(t[k], `${l}.${k}`).toBeTruthy();
        for (const p of ph[k] || []) expect(t[k], `${l}.${k} ${p}`).toContain(p);
      }
    }
  });
  it("English texts are exactly the agreed wording", () => {
    const t = buildT("en");
    expect(accountLimitText(t, q({ used: 1, limit: 1 }), { ios: false, planName: "Basic", lang: "en" }))
      .toBe("Your Basic plan allows 1 account(s) in total across all live platforms. You're using 1. Remove one, or upgrade to add more.");
    const at = new Date(2026, 9, 8, 15, 30).toISOString();
    const msg = accountLimitText(t, q({ used: 2, limit: 2, locked: 1, nextFreeAt: at }), { ios: false, planName: "Plus", lang: "en", now: new Date(2026, 9, 8, 12, 0).getTime() });
    expect(msg).toMatch(/^This place is locked for 4 hours after an account is added\. You can add a new one at 0?3:30\s?PM\.$/);
  });
  it("lock message only when the seller's real accounts still leave room", () => {
    const t = buildT("en");
    const o = { ios: false, planName: "Plus", lang: "en" };
    expect(accountLimitText(t, q({ used: 2, limit: 2, locked: 1, nextFreeAt: "2026-10-08T10:00:00Z" }), o)).toMatch(/^This place is locked/);
    expect(accountLimitText(t, q({ used: 3, limit: 2, locked: 1, nextFreeAt: "2026-10-08T10:00:00Z" }), o)).toMatch(/plan allows 2/);
  });
  it("no numbers (quota failed) → generic text, never a raw code", () => {
    for (const l of LANGS) {
      const t = buildT(l);
      expect(accountLimitText(t, null, { ios: false, planName: "Basic", lang: l })).toBe(t.rd_acct_limit_generic);
      expect(accountLimitText(t, null, { ios: true, planName: "Basic", lang: l })).toBe(t.rd_acct_limit_generic_ios);
    }
    expect(fbReturnText({ status: "error", code: "account_limit" }, buildT("en"), 1)).toBe(buildT("en").rd_acct_limit_generic);
  });
  it("iOS wording has no plan name, no upgrade, no price — in every language", () => {
    const banned = /plan|upgrade|price|NT\$|₱|套餐|方案|升级|升級|gói|nâng cấp|แพ็กเกจ|อัปเกรด|paket|план|надгради/i;
    for (const l of LANGS) {
      const t = buildT(l);
      for (const m of [
        accountLimitText(t, q({ used: 1, limit: 1 }), { ios: true, planName: "Basic", lang: l }),
        accountLimitText(t, null, { ios: true, planName: "Basic", lang: l }),
        accountLimitText(t, q({ used: 2, limit: 2, locked: 1, nextFreeAt: "2026-10-08T10:00:00Z" }), { ios: true, planName: "Basic", lang: l }),
      ]) {
        expect(m, `${l}: ${m}`).not.toMatch(banned);
        expect(m).not.toContain("Basic");
        expect(m).not.toContain("account_limit");
      }
    }
  });
});

// ── screens ───────────────────────────────────────────────────────────────────
const load = vi.fn<() => Promise<AccountQuota | null>>();
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: async () => { const r = await load(); return r ? { data: { used: r.used, limit: r.limit, unlimited: r.unlimited, locked: r.locked, next_free_at: r.nextFreeAt }, error: null } : { data: null, error: { message: "function account_quota() does not exist" } }; } },
}));
const { default: ManageChannels } = await import("../../screens/ManageChannels");
const { TProvider } = await import("../../i18n");
const acct: import("../../../accountDb").AccountUser = {
  authUserId: "u", email: "g@x.com",
  profile: { fullName: "O", storeName: "S", phone: "", tiktok: "", facebook: "", adminContactNote: "" },
  plan: "plus", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};

describe("Manage TikTok screen", () => {
  beforeEach(() => load.mockReset());
  it("shows 'Accounts used: X of Y'", async () => {
    load.mockResolvedValue(q({ used: 1, limit: 2 }));
    render(<TProvider lang="en"><ManageChannels platform="tiktok" account={acct} onBack={() => {}} onSaveChannels={async () => ({ ok: true })} /></TProvider>);
    expect(await screen.findByText("Accounts used: 1 of 2")).toBeTruthy();
  });
  it("quota unavailable → no extra line", async () => {
    load.mockResolvedValue(null);
    render(<TProvider lang="en"><ManageChannels platform="tiktok" account={acct} onBack={() => {}} onSaveChannels={async () => ({ ok: true })} /></TProvider>);
    await waitFor(() => expect(load).toHaveBeenCalled());
    expect(screen.queryByTestId("account-quota-line")).toBeNull();
  });
  it("a refused save shows the message and keeps the typed value", async () => {
    load.mockResolvedValue(q({ used: 2, limit: 2 }));
    const onSave = vi.fn().mockResolvedValue({ ok: false, accountLimit: true });
    render(<TProvider lang="en"><ManageChannels platform="tiktok" account={acct} onBack={() => {}} onSaveChannels={onSave} /></TProvider>);
    const input = (screen.getAllByPlaceholderText("yourusername") as HTMLInputElement[]).find((el) => !el.disabled)!;
    fireEvent.change(input, { target: { value: "newone" } });
    fireEvent.click(screen.getByText("Save profile"));
    expect(await screen.findByText(/Your Plus plan allows 2 account\(s\) in total/)).toBeTruthy();
    expect(screen.getByDisplayValue("newone")).toBeTruthy();
    expect(screen.queryByText(/account_limit/)).toBeNull();
  });
});
