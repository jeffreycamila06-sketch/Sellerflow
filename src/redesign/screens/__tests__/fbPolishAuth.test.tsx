// Build 5 "Authorize clarity" — app half (switch fb_polish_v2). Pins:
//   • fbReturnText: switch ON → partial save names the Pages left out; no_pages / expired link /
//     save failure each get their own words; switch OFF → every code gives exactly today's text;
//   • parseFbReturn reads the partial-save details; RedesignApp strips all of them from the URL;
//   • FbChannels: ON → "Preparing…" gives up after 15 s / a failed fetch → "Try again" (fetches
//     again) and the confirm page language is sent; OFF → the screen as before (no timeout, no lang);
//   • Settings → Facebook names: ON + Facebook not open → only the activation notice + Telegram
//     link (no name slots, nothing saved); OFF → the slots as before;
//   • plain text fixes (not switched): no "or Group" / "Page / Group"; the new en / fil strings use
//     seller words only.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { render, act, fireEvent } from "@testing-library/react";

vi.mock("../../../supabase", () => ({ isSupabaseConfigured: false, supabase: null }));
const m = vi.hoisted(() => ({ startAuth: vi.fn() }));
vi.mock("../../adapters/fb", async (orig) => {
  const real = await orig<typeof import("../../adapters/fb")>();
  return { ...real, startFbAuth: m.startAuth, __real: real };
});

import { TProvider, buildT } from "../../i18n";
import FbChannels, { FB_AUTH_PREPARE_TIMEOUT_MS } from "../FbChannels";
import ManageChannels from "../ManageChannels";
import * as fbMod from "../../adapters/fb";

const real = (fbMod as unknown as { __real: typeof fbMod }).__real;
const t = buildT("en");
const fil = buildT("fil");
const account = { email: "a@b.c", plan: "pro", planStatus: "active", role: "admin", tiktok: "", facebook: "maria.page" } as never;

describe("fbReturnText", () => {
  const codes = ["no_pages", "token_exchange", "bad_state", "missing_params", "save_failed", "read_failed", "exception", "cap", "account_limit", "cancelled", "weird"];
  // Build 11 (M5): a partial save now names the Pages that did not fit with the switch OFF too.
  it("switch OFF → exactly today's texts for every error code; a partial save names the dropped Pages", () => {
    for (const code of codes) expect(real.fbReturnText({ status: "error", code }, t, 3)).toBe(real.fbReturnText({ status: "error", code }, t, 3, false));
    expect(real.fbReturnText({ status: "error", code: "no_pages" }, t, 3)).toBe(t.rd_fb_auth_error_toast);
    const partial = real.fbReturnText({ status: "connected", saved: 1, dropped: 2, kept: ["A"], names: ["B", "C"] }, t, 1);
    expect(partial).toBe(real.fbReturnText({ status: "connected", saved: 1, dropped: 2, kept: ["A"], names: ["B", "C"] }, t, 1, true));
    expect(partial).toContain("B");
    expect(real.fbReturnText({ status: "connected" }, t, 1)).toBe(t.rd_fb_authorized_toast);
  });
  it("switch ON → own words per code; cap / account_limit / cancelled unchanged", () => {
    const on = (code: string) => real.fbReturnText({ status: "error", code }, t, 3, true);
    expect(on("no_pages")).toBe(t.rd_fb_ret_no_pages);
    for (const c of ["token_exchange", "bad_state", "missing_params"]) expect(on(c)).toBe(t.rd_fb_ret_expired);
    for (const c of ["save_failed", "read_failed", "exception"]) expect(on(c)).toBe(t.rd_fb_ret_save_failed);
    expect(on("cap")).toBe(real.fbReturnText({ status: "error", code: "cap" }, t, 3));
    expect(on("cancelled")).toBeNull();
    expect(on("weird")).toBe(t.rd_fb_auth_error_toast);
  });
  it("switch ON → a partial save names what was saved and what did not fit", () => {
    expect(real.fbReturnText({ status: "connected", saved: 1, dropped: 2, kept: ["Ukay Queen"], names: ["Ukay 2", "Bags"] }, t, 1, true))
      .toBe("Saved Ukay Queen. Ukay 2, Bags didn't fit your plan (max 1 Pages).");
    expect(real.fbReturnText({ status: "connected", saved: 1, dropped: 5, kept: ["A"], names: ["B", "C", "D"] }, fil, 1, true))
      .toBe("Na-save ang A. Hindi kasya ang B, C, D +2 sa plan mo (max 1 Page).");
    expect(real.fbReturnText({ status: "connected" }, t, 1, true)).toBe(t.rd_fb_authorized_toast);
  });
  it("parseFbReturn reads saved / dropped / kept / names; RedesignApp strips them all", () => {
    expect(real.parseFbReturn("?fb=connected&saved=1&dropped=2&kept=A&names=B%0AC")).toEqual({ status: "connected", saved: 1, dropped: 2, kept: ["A"], names: ["B", "C"] });
    expect(real.parseFbReturn("?fb=connected")).toEqual({ status: "connected" });
    expect(real.parseFbReturn("?fb=connected&dropped=0")).toEqual({ status: "connected" });
    expect(real.FB_RETURN_PARAMS).toEqual(["fb", "code", "saved", "dropped", "kept", "names"]);
    const src = readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(src).toContain("for (const k of FB_RETURN_PARAMS) url.searchParams.delete(k);");
    expect(src).toContain("fbReturnText(ret, tApp, maxAcc(fbReturnPlan || \"free\"), featureSw.fbPolishV2)");
    expect(src).toContain("polish={featureSw.fbPolishV2}");
    expect(src).toContain("fbActivationOnly={featureSw.fbPolishV2 && !fbEnabled}");
  });
  it("startFbAuth: lang only when given", async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ url: "https://www.facebook.com/x" }) });
    vi.stubGlobal("fetch", f);
    await real.startFbAuth({ lang: "fil" });
    await real.startFbAuth({ app: true, lang: "zh-TW" });
    await real.startFbAuth();
    // Build 11 (H4): + the new-app marker
    expect(String(f.mock.calls[0][0])).toMatch(/\/fb\/oauth\/start\?lang=fil&sfl_codes=1$/);
    expect(String(f.mock.calls[1][0])).toMatch(/\/fb\/oauth\/start\?client=app&lang=zh-TW&sfl_codes=1$/);
    expect(String(f.mock.calls[2][0])).toMatch(/\/fb\/oauth\/start\?sfl_codes=1$/);
    vi.unstubAllGlobals();
  });
});

describe("FbChannels — Preparing… timeout / Try again", () => {
  beforeEach(() => { vi.useFakeTimers(); m.startAuth.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });
  const view = (polish: boolean, lang = "en") => render(
    <TProvider lang={lang as "en"}><FbChannels account={account} pages={[]} onReload={vi.fn()} onBack={vi.fn()} onUpsell={vi.fn()} polish={polish} /></TProvider>,
  );
  const flush = async () => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };
  it("ON: no link after 15 s → 'Try again'; tapping it fetches again", async () => {
    m.startAuth.mockReturnValue(new Promise(() => {}));
    const r = view(true);
    expect(r.getByText(t.rd_fb_authorize_preparing)).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(FB_AUTH_PREPARE_TIMEOUT_MS - 1); });
    expect(r.queryByTestId("fb-authorize-retry")).toBeNull();
    await act(async () => { vi.advanceTimersByTime(1); });
    expect(r.getByTestId("fb-open-failed").textContent).toBe(t.rd_fb_open_failed);
    m.startAuth.mockResolvedValue({ ok: true, url: "https://www.facebook.com/v25.0/dialog/oauth?state=S" });
    fireEvent.click(r.getByTestId("fb-authorize-retry"));
    await flush();
    expect(m.startAuth).toHaveBeenCalledTimes(2);
    expect(r.queryByTestId("fb-authorize-retry")).toBeNull();
    expect((r.container.querySelector("a[href^='https://www.facebook.com']") as HTMLAnchorElement).textContent).toBe(t.rd_fb_authorize);
  });
  it("ON: a failed fetch shows 'Try again' at once; the confirm page language is sent", async () => {
    m.startAuth.mockResolvedValue({ ok: false, error: "HTTP 500" });
    const r = view(true, "fil");
    await flush();
    expect(r.getByTestId("fb-authorize-retry").textContent).toBe(fil.rd_fb_try_again);
    expect(m.startAuth).toHaveBeenCalledWith({ lang: "fil" });
  });
  it("OFF: Preparing… stays (no timeout), no lang is sent — today's screen", async () => {
    m.startAuth.mockReturnValue(new Promise(() => {}));
    const r = view(false, "fil");
    await act(async () => { vi.advanceTimersByTime(FB_AUTH_PREPARE_TIMEOUT_MS * 4); });
    expect(r.queryByTestId("fb-authorize-retry")).toBeNull();
    expect(r.getByText(fil.rd_fb_authorize_preparing)).toBeTruthy();
    expect(m.startAuth).toHaveBeenCalledWith({});
  });
});

describe("Settings → Facebook names (legacy name editor)", () => {
  const acct = { authUserId: "u", email: "g@x.com", profile: { fullName: "O", storeName: "S", phone: "", tiktok: "saved_tt", facebook: "fbpage", adminContactNote: "" }, plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller" } as never;
  const view = (fbActivationOnly: boolean) => render(
    <TProvider lang="en"><ManageChannels platform="facebook" account={acct} onBack={vi.fn()} onSaveChannels={vi.fn()} fbActivationOnly={fbActivationOnly} /></TProvider>,
  );
  it("ON + Facebook not open → only the activation notice + Telegram link; no name slots, no add button", () => {
    const r = view(true);
    expect(r.getByTestId("mc-fb-activation").textContent).toContain(t.rd_dash_fb_activation);
    expect((r.getByTestId("mc-fb-telegram") as HTMLAnchorElement).href).toContain("t.me/");
    expect(r.container.querySelector("input")).toBeNull();
    expect(r.queryByText(t.rd_ch_add_fb_multi)).toBeNull();
  });
  it("OFF → the name slots as before", () => {
    const r = view(false);
    expect(r.queryByTestId("mc-fb-activation")).toBeNull();
    expect(r.container.querySelector("input")).not.toBeNull();
  });
  it("TikTok screen is never affected", () => {
    const r = render(<TProvider lang="en"><ManageChannels platform="tiktok" account={acct} onBack={vi.fn()} fbActivationOnly /></TProvider>);
    expect(r.queryByTestId("mc-fb-activation")).toBeNull();
    expect(r.container.querySelector("input")).not.toBeNull();
  });
});

describe("texts", () => {
  const LANGS = ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"] as const;
  it("no Facebook text offers a Group as something to connect", () => {
    for (const l of LANGS) {
      const tl = buildT(l) as unknown as Record<string, string>;
      expect(tl.rd_dash_fb_page_group).not.toMatch(/group|grup|nhóm|กลุ่ม|群组|社團|група/i);
      expect(tl.rd_ch_pop_body_fb).not.toMatch(/ or group| o group|或群组|或社團|hoặc Nhóm|หรือกลุ่ม|atau grup|или група/i);
    }
    expect(t.rd_ch_fb_helper).toBe(t.rd_fb_authorize_help);
    expect(t.rd_fb_authorize).toBe("Connect my Facebook Page");
    expect(fil.rd_fb_authorize).toBe("Ikonekta ang Facebook Page ko");
  });
  it("new en / fil strings: seller words only, at most 2 sentences", () => {
    const keys = ["rd_fb_partial_saved", "rd_fb_ret_no_pages", "rd_fb_ret_expired", "rd_fb_ret_save_failed", "rd_fb_try_again", "rd_fb_open_failed", "rd_fb_authorize_help", "rd_fb_authorize"] as const;
    for (const tl of [t, fil]) for (const k of keys) {
      const s = (tl as unknown as Record<string, string>)[k];
      expect(s, k).not.toMatch(/server|poller|token|\bAPI\b|limit|feature|device|restart|timeout|\(FB|\bcode\b/i);
      // rd_fb_authorize_help is the spec's own 3-sentence help text (a plain text fix, reported)
      if (k !== "rd_fb_authorize_help") expect(s.split(/[.!?](\s|$)/).filter((x) => x && x.trim()).length, k).toBeLessThanOrEqual(2);
    }
  });
});
