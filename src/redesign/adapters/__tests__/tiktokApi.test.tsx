// TikTok API — Branch 1 client: the gate, the status reader, the OAuth return, the card's states,
// the Manage TikTok accounts tile. Facebook Post Sales and the live connect are not touched.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { tiktokApiGate, parseTtReturn, readStatus, ttReturnText, TT_RETURN_PARAMS, initialsOf, followersText } from "../tiktokApi";
import { TProvider, buildT } from "../../i18n";
import TikTokVideos from "../../screens/TikTokVideos";
import ManageChannels from "../../screens/ManageChannels";

const t = buildT("en");
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("gate + pure helpers", () => {
  it("tiktokApiGate: switch OR admin OR the preview key; everything else off", () => {
    expect(tiktokApiGate({ switchOn: false, isAdmin: false, hasKey: false })).toBe(false);
    expect(tiktokApiGate({ switchOn: true, isAdmin: false, hasKey: false })).toBe(true);
    expect(tiktokApiGate({ switchOn: false, isAdmin: true, hasKey: false })).toBe(true);
    expect(tiktokApiGate({ switchOn: false, isAdmin: false, hasKey: true })).toBe(true);
  });
  it("readStatus: 404 off → off; 200 ok → account; anything else → error", () => {
    expect(readStatus(404, { ok: false, error: "off" })).toEqual({ kind: "off" });
    expect(readStatus(200, { ok: true, account: null })).toEqual({ kind: "ok", account: null });
    expect(readStatus(500, { ok: false })).toEqual({ kind: "error" });
    expect(readStatus(0, null)).toEqual({ kind: "error" });
    expect(readStatus(404, { ok: false, error: "not_found" })).toEqual({ kind: "error" });
  });
  it("parseTtReturn + ttReturnText: seller words, no codes; cancelled = silent", () => {
    expect(TT_RETURN_PARAMS).toEqual(["tt", "code"]);
    expect(parseTtReturn("?tt=connected")).toEqual({ status: "connected" });
    expect(parseTtReturn("?tt=error&code=not_business")).toEqual({ status: "error", code: "not_business" });
    expect(parseTtReturn("?fb=connected")).toBeNull();
    expect(ttReturnText({ status: "connected" }, t)).toBe(t.rd_tt_connected_toast);
    expect(ttReturnText({ status: "error", code: "not_business" }, t)).toBe(t.rd_tt_not_business_toast);
    expect(ttReturnText({ status: "error", code: "not_registered" }, t)).toBe(t.rd_tt_not_registered_toast);
    expect(ttReturnText({ status: "error", code: "token_exchange" }, t)).toBe(t.rd_tt_connect_failed);
    expect(ttReturnText({ status: "error", code: "cancelled" }, t)).toBe("");
    for (const s of [t.rd_tt_connect_failed, t.rd_tt_not_business_toast]) expect(s).not.toMatch(/token_exchange|bad_state|HTTP/);
  });
  it("initials + followers", () => {
    expect(initialsOf("Amy Santos")).toBe("AS"); expect(initialsOf("")).toBe("@");
    expect(followersText(12400)).toBe("12.4k"); expect(followersText(123)).toBe("123"); expect(followersText(25000)).toBe("25k");
  });
});

function mockServer(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ status, ok: status === 200, json: async () => body })));
}
const ui = (el: React.ReactElement) => render(<TProvider lang="en">{el}</TProvider>);

describe("TikTokVideos card — one state per server answer", () => {
  it("off (404) → the switched-off line, no Connect", async () => {
    mockServer(404, { ok: false, error: "off" });
    ui(<TikTokVideos onBack={() => {}} />);
    expect(await screen.findByTestId("tt-state-off")).toBeInTheDocument();
    expect(screen.queryByTestId("tt-connect")).toBeNull();
  });
  it("no account → Connect (a real anchor once the signed link arrives)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/tiktok/oauth/start")
      ? { status: 200, ok: true, json: async () => ({ ok: true, url: "https://www.tiktok.com/v2/auth/authorize/?state=x" }) }
      : { status: 200, ok: true, json: async () => ({ ok: true, account: null }) }));
    ui(<TikTokVideos onBack={() => {}} />);
    expect(await screen.findByTestId("tt-state-none")).toBeInTheDocument();
    await vi.waitFor(() => expect(screen.getByTestId("tt-connect").tagName).toBe("A"), { timeout: 5000 });
    const a2 = screen.getByTestId("tt-connect");
    expect(a2.getAttribute("href")).toContain("tiktok.com/v2/auth/authorize");
    expect(a2.getAttribute("target")).toBe("_blank");
    expect(a2.textContent).toBe(t.rd_tt_connect);
  });
  it("connected → @username, followers, Connected, Disconnect; revoked → Connect again + the paused notice", async () => {
    const acct = { id: "1", ttAccountId: "o1", username: "amy.ukay2026", displayName: "Amy Santos", avatarUrl: "", followers: 12400, status: "active", expiresAt: null, refreshExpiresAt: null, lastPollAt: null, lastWebhookAt: null, updatedAt: null };
    mockServer(200, { ok: true, account: acct });
    const r = ui(<TikTokVideos onBack={() => {}} />);
    expect(await screen.findByTestId("tt-state-connected")).toBeInTheDocument();
    expect(screen.getByText("@amy.ukay2026")).toBeInTheDocument();
    expect(screen.getByText(/12\.4k/)).toBeInTheDocument();
    expect(screen.getByTestId("tt-disconnect")).toBeInTheDocument();
    expect(screen.queryByTestId("tt-connect")).toBeNull();
    r.unmount();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/tiktok/oauth/start")
      ? { status: 200, ok: true, json: async () => ({ ok: true, url: "https://www.tiktok.com/v2/auth/authorize/?state=y" }) }
      : { status: 200, ok: true, json: async () => ({ ok: true, account: { ...acct, status: "revoked" } }) }));
    ui(<TikTokVideos onBack={() => {}} />);
    expect(await screen.findByTestId("tt-state-reconnect")).toBeInTheDocument();
    expect(screen.getByText(t.rd_tt_revoked_body)).toBeInTheDocument();
    expect((await screen.findByTestId("tt-connect")).textContent).toBe(t.rd_tt_connect_again);
    expect(screen.getByTestId("tt-disconnect")).toBeInTheDocument();
  });
  it("refused as a personal account → the Business-account steps + Connect again", async () => {
    mockServer(200, { ok: true, account: null });
    ui(<TikTokVideos onBack={() => {}} lastReturnCode="not_business" />);
    expect(await screen.findByTestId("tt-state-not-business")).toBeInTheDocument();
    expect(screen.getByText(t.rd_tt_personal_title)).toBeInTheDocument();
    expect(screen.getByText(/Switch to Business Account/)).toBeInTheDocument();
  });
  it("read failure → honest line + Try again", async () => {
    mockServer(500, { ok: false });
    ui(<TikTokVideos onBack={() => {}} />);
    expect(await screen.findByTestId("tt-state-error")).toBeInTheDocument();
  });
});

describe("Manage TikTok accounts tile", () => {
  it("shows the card tile only with onTikTokVideos, and never on the Facebook screen", () => {
    mockServer(200, { ok: true });
    const r = ui(<ManageChannels platform="tiktok" onBack={() => {}} onTikTokVideos={() => {}} />);
    expect(screen.getByTestId("mc-tiktok-videos").textContent).toContain(t.rd_tt_card_title);
    r.unmount();
    const r2 = ui(<ManageChannels platform="tiktok" onBack={() => {}} />);
    expect(screen.queryByTestId("mc-tiktok-videos")).toBeNull();
    r2.unmount();
    ui(<ManageChannels platform="facebook" onBack={() => {}} onTikTokVideos={() => {}} />);
    expect(screen.queryByTestId("mc-tiktok-videos")).toBeNull();
  });
});
