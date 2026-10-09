// Build 11 (M4 + M5).
//   M4: Settings → Facebook with Facebook Pages on: no dead "Facebook page 1" name boxes, no
//       "Tick ONLY the Page…" note, no multi-account button — only "Manage Facebook pages".
//       TikTok screen and Facebook-off screen unchanged.
//   M5: coming back from Facebook in the browser while the feature switches are still loading:
//       no message yet and the address keeps the result; once loaded → the right message
//       (never the generic "failed" by mistake), then the address is cleaned.
import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import ManageChannels from "../screens/ManageChannels";
import { TProvider, buildT } from "../i18n";
import type { AccountUser } from "../../accountDb";

beforeAll(() => { (HTMLElement.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {}; });

const H = vi.hoisted(() => ({ release: null as null | (() => void) }));
vi.mock("../adapters/useAuthSession", async (orig) => ({
  ...(await orig() as object),
  useAuthSession: () => ({
    status: "authed",
    profile: {
      authUserId: "u1", email: "g@x.com", plan: "pro", planStatus: "active", planExpiry: "", role: "seller", connectedAccounts: [],
      profile: { fullName: "T", storeName: "Shop", phone: "", tiktok: "", facebook: "", adminContactNote: "" },
    },
    reloadProfile: vi.fn(async () => {}),
  }),
}));
// The switch read finishes only when the test releases it (polish on).
vi.mock("../adapters/featureSwitches", async (orig) => {
  const a = await orig() as { SWITCHES_OFF: Record<string, boolean> };
  const React = await import("react");
  return {
    ...a,
    useFeatureSwitches: () => {
      const [sw, setSw] = React.useState(a.SWITCHES_OFF);
      React.useEffect(() => { H.release = () => setSw({ ...a.SWITCHES_OFF, fbPolishV2: true }); }, []);
      return sw;
    },
  };
});

import RedesignApp from "../RedesignApp";

const t = buildT("en");
const acct: AccountUser = {
  authUserId: "u", email: "g@x.com",
  profile: { fullName: "O", storeName: "S", phone: "", tiktok: "saved_tt", facebook: "fbpage", adminContactNote: "" },
  plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller",
};
const view = (platform: "tiktok" | "facebook", fbPagesEnabled: boolean) =>
  render(<TProvider lang="en"><ManageChannels platform={platform} account={acct} onBack={() => {}}
    onSaveChannels={async () => ({ ok: true })} fbPagesEnabled={fbPagesEnabled} onFbPages={() => {}} /></TProvider>);

describe("M4 — Settings → Facebook with Pages on", () => {
  it("no name boxes, no note, no multi-account button; the Pages button stays", () => {
    view("facebook", true);
    expect(screen.queryByText(`${t.rd_ch_fb_page_label} 1`)).toBeNull();
    expect(screen.queryByText(t.rd_ch_fb_helper)).toBeNull();
    expect(screen.queryByText(t.rd_ch_add_fb_multi)).toBeNull();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(t.rd_fb_channels_title)).toBeTruthy();
  });
  it("Facebook Pages off: the screen is as before", () => {
    view("facebook", false);
    expect(screen.getByText(`${t.rd_ch_fb_page_label} 1`)).toBeTruthy();
    expect(screen.getByText(t.rd_ch_add_fb_multi)).toBeTruthy();
  });
  it("TikTok screen: unchanged even with Facebook Pages on", () => {
    view("tiktok", true);
    expect(screen.getByText(`${t.rd_ch_id_tiktok} 1`)).toBeTruthy();
    expect(screen.getByText(t.rd_ch_add_tt_multi)).toBeTruthy();
  });
});

describe("M5 — browser return from Facebook while the switches load", () => {
  beforeEach(() => { localStorage.clear(); H.release = null; });
  const flush = async () => { for (let i = 0; i < 6; i++) await act(async () => { await Promise.resolve(); }); };

  it("error code: nothing shown until the switches are read, then the right words (not the generic 'failed')", async () => {
    window.history.replaceState({}, "", "/?fb=error&code=no_pages");
    render(<RedesignApp />);
    await flush();
    expect(document.body.textContent).not.toContain(t.rd_fb_auth_error_toast);
    expect(window.location.search).toContain("fb=error");          // kept until we know
    await act(async () => { H.release?.(); });
    await flush();
    expect(document.body.textContent).toContain(t.rd_fb_ret_no_pages);
    expect(document.body.textContent).not.toContain(t.rd_fb_auth_error_toast);
    expect(window.location.search).not.toContain("fb=");
  });

  it("some Pages did not fit → the message names them", async () => {
    window.history.replaceState({}, "", "/?fb=connected&saved=1&dropped=1&kept=Shop%20A&names=Shop%20B");
    render(<RedesignApp />);
    await flush();
    expect(document.body.textContent).not.toContain(t.rd_fb_authorized_toast);
    expect(window.location.search).toContain("fb=connected");
    await act(async () => { H.release?.(); });
    await flush();
    expect(document.body.textContent).toContain("Shop A");
    expect(document.body.textContent).toContain("Shop B");
    expect(window.location.search).not.toContain("fb=");
  });
});
