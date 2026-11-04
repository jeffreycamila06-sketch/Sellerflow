// Pickup Status with buyer contacts: per-platform one-tap buttons (WhatsApp link carries the
// ready message; LINE / Messenger / Instagram open with the message copied; Other = copy), the
// contact chip, the message built from the Customer Details name (masked → no name), and the
// no-stranger rules (v2 item 2, as audited): a known non-TikTok platform (the map) or a value
// starting with "+" (a saved WhatsApp number) never gets TikTok "Open profile" — feature on OR
// off, map present OR missing. Plain digits with no "+" stay today's Chase (identical to main).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import type { ParcelTrackingRow } from "../../adapters/parcelTracking";
import type { ContactMaps } from "../../adapters/buyerContactMap";

const M = vi.hoisted(() => ({ narrow: false }));
const { loadParcelTracking, loadBuyerNamesByHandle, loadBuyerContacts, copyText } = vi.hoisted(() => ({
  loadParcelTracking: vi.fn(async () => ({ ok: true, rows: [] as unknown[] })),
  loadBuyerNamesByHandle: vi.fn(async (_h: string[]) => new Map<string, string>()),
  loadBuyerContacts: vi.fn(async (_r: unknown[]) => ({ s711: new Map(), fm: new Map() }) as ContactMaps),
  copyText: vi.fn(async (_t: string) => true),
}));
vi.mock("../../adapters/parcelTracking", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/parcelTracking")>();
  return { ...actual, loadParcelTracking, loadMoreLive: vi.fn(async () => ({ ok: true, rows: [] })), loadBuyerNamesByHandle };
});
vi.mock("../../adapters/buyerContactMap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../adapters/buyerContactMap")>();
  return { ...actual, loadBuyerContacts };
});
vi.mock("../../adapters/parcelExportRead", () => ({ syncFromExport: vi.fn() }));
vi.mock("../../components/inviteShare", () => ({ copyText: (t: string) => copyText(t) }));
vi.mock("../../adapters/appShell", () => ({ isAppShell: () => false, isNarrowViewport: () => M.narrow }));
vi.mock("../../adapters/platform", () => ({ isIOS: () => false, isAndroid: () => false }));
vi.mock("../../../lib/dateHelpers", async (importOriginal) => ({ ...(await importOriginal<object>()), taipeiDayId: () => "2026-11-03" }));

import ParcelTracking from "../ParcelTracking";

let n = 0;
const mk = (over: Partial<ParcelTrackingRow> = {}): ParcelTrackingRow => ({
  id: `r${++n}`, trackingNo: `F0000${n}`, cmOrderNo: null, buyerUsername: `buyer${n}`, recipientName: "J*f*r*y",
  storeId: "266402", recStore: "松山門市", status: "at_store", statusMessage: null, pickupDeadline: "2026-11-05",
  arrivedAt: null, shipType: "C2C", specialType: null, terminal: false, orderAmount: 380, ...over,
});
const ROWS = () => [
  mk({ buyerUsername: "+886922333444" }),      // WhatsApp (stored as +digits)
  mk({ buyerUsername: "yating.line" }),        // LINE
  mk({ buyerUsername: "joy.reyes.90" }),       // Facebook username
  mk({ buyerUsername: "ana.cruz_ig" }),        // Instagram
  mk({ buyerUsername: "maria_shops" }),        // TikTok (NULL platform)
  mk({ buyerUsername: "Telegram @meiling" }),  // Other
  mk({ buyerUsername: "0912345678" }),         // plain digits, NO map entry → today's Chase (main parity)
  mk({ buyerUsername: "fb:100012345678901" }), // Facebook profile id (from a profile.php / people / p/ link)
];
const MAPS = (): ContactMaps => ({ s711: new Map([["+886922333444", "whatsapp"], ["yating.line", "line"], ["joy.reyes.90", "facebook"], ["ana.cruz_ig", "instagram"], ["telegram @meiling", "other"], ["fb:100012345678901", "facebook"]]), fm: new Map() });
const view = (contactOn: boolean) => render(<TProvider lang="en"><ParcelTracking contactOn={contactOn} /></TProvider>);
const rowsReady = (r: ReturnType<typeof view>) => waitFor(() => expect(r.getAllByTestId("pt-row").length).toBe(8));

beforeEach(() => {
  M.narrow = false; n = 0;
  loadParcelTracking.mockReset(); loadParcelTracking.mockResolvedValue({ ok: true, rows: ROWS() });
  loadBuyerNamesByHandle.mockReset(); loadBuyerNamesByHandle.mockResolvedValue(new Map([["+886922333444", "陳大文"], ["maria_shops", "王小美"]]));
  loadBuyerContacts.mockReset(); loadBuyerContacts.mockResolvedValue(MAPS());
  copyText.mockClear();
});

describe("feature ON", () => {
  it("one-tap button per platform; WhatsApp link carries the ready message (Customer Details name); chips on known platforms", async () => {
    const r = view(true);
    await rowsReady(r);
    await waitFor(() => expect(r.getByTestId("pt-open-whatsapp")).toBeTruthy());
    const wa = r.getByTestId("pt-open-whatsapp") as HTMLAnchorElement;
    expect(wa.href).toMatch(/^https:\/\/wa\.me\/886922333444\?text=/);
    const msg = decodeURIComponent(new URL(wa.href).searchParams.get("text")!);
    expect(msg).toBe("Hi 陳大文! Your parcel is at 7-11 松山門市 (NT$380). Please pick it up by 2026-11-05. Thank you!");
    expect(wa.target).toBe("_blank"); expect(wa.rel).toContain("noreferrer");
    expect((r.getByTestId("pt-open-line") as HTMLAnchorElement).href).toBe("https://line.me/R/ti/p/~yating.line");
    const fb = r.getAllByTestId("pt-open-facebook") as HTMLAnchorElement[];
    expect(fb.map((a) => a.href)).toEqual(["https://m.me/joy.reyes.90", "https://www.facebook.com/profile.php?id=100012345678901"]);
    expect((r.getByTestId("pt-open-instagram") as HTMLAnchorElement).href).toBe("https://ig.me/m/ana.cruz_ig");
    expect(r.getAllByTestId("pt-contact").map((c) => c.getAttribute("data-platform"))).toEqual(["whatsapp", "line", "facebook", "instagram", "other", "facebook"]);
    const fbRow = r.getAllByTestId("pt-row")[7];
    expect(fbRow.textContent).toContain("Facebook profile"); // the id is shown as "Facebook profile", never raw "fb:1000…"
    expect(fbRow.textContent).not.toContain("fb:1000");
    expect(r.getAllByTestId("pt-contact")[0].textContent).toBe("WhatsApp");
  });
  it("LINE / Messenger / Instagram copy the message on tap; Other and TikTok rows get Copy message; the masked name is never used", async () => {
    const r = view(true);
    await rowsReady(r);
    await waitFor(() => expect(r.getByTestId("pt-open-line")).toBeTruthy());
    fireEvent.click(r.getByTestId("pt-open-line"));
    expect(copyText).toHaveBeenLastCalledWith("Hi! Your parcel is at 7-11 松山門市 (NT$380). Please pick it up by 2026-11-05. Thank you!"); // no Customer Details name → no-name greeting (recipientName J*f*r*y never used)
    const msgs = r.getAllByTestId("pt-copy-msg");
    expect(msgs).toHaveLength(3);                                      // TikTok row, Other row, phone-shaped row
    fireEvent.click(msgs[0]);
    expect(copyText).toHaveBeenLastCalledWith("Hi 王小美! Your parcel is at 7-11 松山門市 (NT$380). Please pick it up by 2026-11-05. Thank you!");
    await waitFor(() => expect(r.container.textContent).toContain("Message copied"));
    // TikTok row keeps today's Chase link (Open profile) — labelled "TikTok" while the feature is on
    expect((r.getAllByTestId("pt-open-profile")[0] as HTMLAnchorElement).href).toBe("https://www.tiktok.com/@maria_shops");
    expect(r.getAllByTestId("pt-open-profile").map((a) => a.textContent)).toEqual(["TikTok", "TikTok"]);
    expect((r.getAllByTestId("pt-open-facebook")[0] as HTMLAnchorElement).textContent).toBe("Messenger"); // m.me/<username>
    // Other → Copy copies the contact
    const copies = r.getAllByTestId("pt-copy-username");
    fireEvent.click(copies[0]);
    expect(copyText).toHaveBeenLastCalledWith("Telegram @meiling");
  });
  it("plain digits with no map entry keep today's Chase (main parity); a '+' value is Copy; the map is loaded with the rows' carriers", async () => {
    const r = view(true);
    await rowsReady(r);
    await waitFor(() => expect(loadBuyerContacts).toHaveBeenCalled());
    expect(loadBuyerContacts.mock.calls[0][0]).toEqual(expect.arrayContaining([{ handle: "0912345678", carrier: "711" }]));
    const open = r.getAllByTestId("pt-open-profile").map((a) => (a as HTMLAnchorElement).href);
    expect(open).toEqual(["https://www.tiktok.com/@maria_shops", "https://www.tiktok.com/@0912345678"]);
    expect(open).not.toContain("https://www.tiktok.com/@+886922333444");
  });
  it("mobile layout: same buttons in the compact list", async () => {
    M.narrow = true;
    const r = view(true);
    await rowsReady(r);
    await waitFor(() => expect(r.getByTestId("pt-open-whatsapp")).toBeTruthy());
    expect(r.getByTestId("pt-list")).toBeTruthy();
    expect(r.getAllByTestId("pt-copy-msg")).toHaveLength(3);
  });
});

describe("Facebook id values in the Buyer cell", () => {
  it("feature ON: fb:<digits> and fbshare:<code> on a Facebook row → 'Facebook profile' (+ the right link); other fb-looking values show as stored", async () => {
    loadParcelTracking.mockResolvedValue({ ok: true, rows: [mk({ buyerUsername: "fbshare:19tvMLYXPi" }), mk({ buyerUsername: "FB:abc" }), mk({ buyerUsername: "fb:100012345678901" })] });
    loadBuyerContacts.mockResolvedValue({ s711: new Map([["fbshare:19tvmlyxpi", "facebook"], ["fb:abc", "facebook"], ["fb:100012345678901", "line"]]), fm: new Map() });
    const r = view(true);
    await waitFor(() => expect(r.getAllByTestId("pt-row").length).toBe(3));
    await waitFor(() => expect(r.getAllByTestId("pt-contact").length).toBe(3));
    const rows = r.getAllByTestId("pt-row");
    expect(rows[0].textContent).toContain("Facebook profile");
    expect(rows[0].textContent).not.toContain("fbshare:");
    expect((r.getByTestId("pt-open-facebook") as HTMLAnchorElement).href).toBe("https://www.facebook.com/share/19tvMLYXPi/");
    expect((r.getByTestId("pt-open-facebook") as HTMLAnchorElement).textContent).toBe("Facebook"); // a share link is not a Messenger chat
    expect(rows[1].textContent).toContain("FB:abc"); // not a real id → shown as stored
    expect(rows[1].textContent).not.toContain("Facebook profile");
    expect(rows[2].textContent).toContain("fb:100012345678901"); // a LINE row is never relabelled
    expect(rows[2].textContent).not.toContain("Facebook profile");
  });
  it("feature OFF: 'fb:100012345678901', 'FB:abc', 'fb:', 'fbshare:abc123' render as @username — exactly main", async () => {
    loadParcelTracking.mockResolvedValue({ ok: true, rows: [mk({ buyerUsername: "fb:100012345678901" }), mk({ buyerUsername: "FB:abc" }), mk({ buyerUsername: "fb:" }), mk({ buyerUsername: "fbshare:abc123" })] });
    loadBuyerContacts.mockResolvedValue({ s711: new Map([["fb:100012345678901", "facebook"], ["fbshare:abc123", "facebook"]]), fm: new Map() });
    const r = view(false);
    await waitFor(() => expect(r.getAllByTestId("pt-row").length).toBe(4));
    await waitFor(() => expect(loadBuyerContacts).toHaveBeenCalled());
    const rows = r.getAllByTestId("pt-row");
    expect(rows[0].textContent).toContain("@fb:100012345678901");
    expect(rows[1].textContent).toContain("@FB:abc");
    expect(rows[2].textContent).toContain("@fb:");
    expect(rows[3].textContent).toContain("@fbshare:abc123");
    expect(r.queryByText("Facebook profile")).toBeNull();
    expect(r.queryByTestId("pt-contact")).toBeNull();
    expect(r.queryByTestId("pt-open-facebook")).toBeNull();
  });
});

describe("Facebook button label", () => {
  it("'Messenger' only for an m.me/<username> chat; a profile id opens Facebook with the 'Facebook' label", async () => {
    loadParcelTracking.mockResolvedValue({ ok: true, rows: [mk({ buyerUsername: "joy.reyes.90" }), mk({ buyerUsername: "fb:100012345678901" }), mk({ buyerUsername: "fbshare:19tvMLYXPi" })] });
    loadBuyerContacts.mockResolvedValue({ s711: new Map([["joy.reyes.90", "facebook"], ["fb:100012345678901", "facebook"], ["fbshare:19tvmlyxpi", "facebook"]]), fm: new Map() });
    const r = view(true);
    await waitFor(() => expect(r.getAllByTestId("pt-open-facebook").length).toBe(3));
    const fb = r.getAllByTestId("pt-open-facebook") as HTMLAnchorElement[];
    expect(fb.map((a) => [a.textContent, a.href])).toEqual([
      ["Messenger", "https://m.me/joy.reyes.90"],
      ["Facebook", "https://www.facebook.com/profile.php?id=100012345678901"],
      ["Facebook", "https://www.facebook.com/share/19tvMLYXPi/"],
    ]);
  });
});

describe("feature OFF (the map is still read — v2 item 2)", () => {
  it("known non-TikTok platforms → Copy (never a TikTok link); no chips, no Copy message; TikTok row = today's Chase", async () => {
    const r = view(false);
    await rowsReady(r);
    await waitFor(() => expect(loadBuyerContacts).toHaveBeenCalled());
    await waitFor(() => expect(r.getAllByTestId("pt-copy-username").length).toBeGreaterThanOrEqual(5));
    expect(r.queryByTestId("pt-open-whatsapp")).toBeNull();
    expect(r.queryByTestId("pt-open-line")).toBeNull();
    expect(r.queryByTestId("pt-contact")).toBeNull();
    expect(r.queryByTestId("pt-copy-msg")).toBeNull();
    expect(r.getAllByTestId("pt-open-profile")).toHaveLength(2); // maria_shops + the plain-digit row (today's Chase)
    expect((r.getAllByTestId("pt-open-profile")[0] as HTMLAnchorElement).href).toBe("https://www.tiktok.com/@maria_shops");
    expect(r.getAllByTestId("pt-open-profile").map((a) => a.textContent)).toEqual(["Chase", "Chase"]); // feature OFF = main's label
    expect(r.queryByText("TikTok", { exact: true })).toBeNull();
  });
  it("map failed / empty: a LINE id that looks like a handle still opens TikTok today (unchanged), but a phone-shaped value never does", async () => {
    loadBuyerContacts.mockResolvedValue({ s711: new Map(), fm: new Map() });
    const r = view(false);
    await rowsReady(r);
    const open = r.getAllByTestId("pt-open-profile").map((a) => (a as HTMLAnchorElement).href);
    expect(open).toContain("https://www.tiktok.com/@maria_shops");
    expect(open).toContain("https://www.tiktok.com/@yating.line");       // today's behaviour for a handle-shaped value
    expect(open).toContain("https://www.tiktok.com/@0912345678");        // plain digits → today's Chase (main parity)
    expect(open).not.toContain("https://www.tiktok.com/@+886922333444"); // "+" → Copy (chaseTarget, as on main)
  });
  it("feature off: '12345678' and '0912345678' are Chase (identical to main); only '+digits' or a whatsapp map entry is Copy", async () => {
    loadParcelTracking.mockResolvedValue({ ok: true, rows: [mk({ buyerUsername: "12345678" }), mk({ buyerUsername: "0912345678" }), mk({ buyerUsername: "+886912345678" }), mk({ buyerUsername: "0933111222" })] });
    loadBuyerContacts.mockResolvedValue({ s711: new Map([["0933111222", "whatsapp"]]), fm: new Map() });
    const r = view(false);
    await waitFor(() => expect(r.getAllByTestId("pt-row").length).toBe(4));
    await waitFor(() => expect(loadBuyerContacts).toHaveBeenCalled());
    await waitFor(() => expect(r.getAllByTestId("pt-copy-username")).toHaveLength(2));
    const open = r.getAllByTestId("pt-open-profile").map((a) => (a as HTMLAnchorElement).href);
    expect(open).toEqual(["https://www.tiktok.com/@12345678", "https://www.tiktok.com/@0912345678"]);
    expect(r.queryByTestId("pt-open-whatsapp")).toBeNull(); // off → never the WhatsApp button
  });
});
