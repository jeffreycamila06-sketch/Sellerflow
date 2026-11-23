// Button feedback on the real seller screens (the pattern itself: adapters/__tests__/buttonFeedback.test.tsx).
// Settings → Website (Copy + Save), Website → Payment & shipping (Save), Orders → Website (order link Copy),
// Settings → profile (Save). The clock is moved by hand.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TProvider } from "../../i18n";
import WebsiteEditor from "../WebsiteEditor";
import WebsitePayShip from "../WebsitePayShip";
import WebsiteOrders from "../WebsiteOrders";
import GeneralSettings from "../GeneralSettings";
import { DEFAULT_SETTINGS } from "../../adapters/websiteEditor";
import type { MyWebsite, WebsiteOrder } from "../../adapters/websiteSeller";
import type { EditorApi, PayShipApi, OrdersApi } from "../../adapters/websiteEditorApi";
import type { AccountUser } from "../../../accountDb";
import { FEEDBACK_MS } from "../../adapters/buttonFeedback";
import { settle, tick, until } from "../../adapters/__tests__/pageGone";

const SITE: MyWebsite = { subdomain: "live", draft: { name: "Live Shop", tagline: "Ukay" }, published: { name: "Live Shop", tagline: "Ukay" }, publishedAt: "2026-11-14T02:00:00Z", settings: { ...DEFAULT_SETTINGS, bank: { ...DEFAULT_SETTINGS.bank, enabled: true, accountNumber: "0123" } }, customDomain: null };
interface Deferred<V> { promise: Promise<V>; resolve: (v: V) => void }
function defer<V>(): Deferred<V> { let resolve!: (v: V) => void; const promise = new Promise<V>((a) => { resolve = a; }); return { promise, resolve }; }
function clipboard(allowed: boolean) {
  const written: string[] = [];
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn(async (s: string) => { if (!allowed) throw new Error("NotAllowedError"); written.push(s); }) } });
  (document as unknown as { execCommand: (c: string) => boolean }).execCommand = () => false;
  return written;
}
function editorApi(over: Partial<EditorApi> = {}): EditorApi {
  return { load: vi.fn(async () => SITE), save: vi.fn(async () => ({ ok: true as const })), publish: vi.fn(async () => ({ ok: true as const, at: "2026-11-15T00:00:00Z" })),
    subdomainFree: vi.fn(async () => true), uploadPicture: vi.fn(async () => "u/site-logo-1.jpg"), loadProducts: vi.fn(async () => []), ...over };
}
function editor(api: EditorApi, onToast = vi.fn()) {
  render(<TProvider lang="en"><WebsiteEditor onPayShip={vi.fn()} onToast={onToast} ios={false} plan="pro" planStatus="active" planExpiry="2099-01-01" api={api} newLook={false} /></TProvider>);
  return { onToast };
}
const by = (id: string) => screen.getByTestId(id);
const name = () => by("wed-name") as HTMLInputElement;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Settings → Website: Copy", () => {
  it("copied: ✓ Copied on the button for 2 s; the clipboard holds the shop link", async () => {
    const written = clipboard(true);
    const { onToast } = editor(editorApi());
    await until(() => screen.queryByTestId("wed-copy"));
    expect(by("wed-copy")).toHaveTextContent(/^Copy$/);
    fireEvent.click(by("wed-copy"));
    await until(() => by("wed-copy").textContent === "✓ Copied");
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^https:\/\/.*live/);
    await tick(FEEDBACK_MS + 50);
    expect(by("wed-copy")).toHaveTextContent(/^Copy$/);
    expect(onToast).not.toHaveBeenCalled(); // the button itself says it
  });
  it("clipboard refused: no 'Copied' anywhere; the link is shown selected with the press-and-hold line", async () => {
    clipboard(false);
    const { onToast } = editor(editorApi());
    await until(() => screen.queryByTestId("wed-copy"));
    fireEvent.click(by("wed-copy"));
    await until(() => screen.queryByTestId("wed-copy-fail"));
    expect(by("wed-copy")).toHaveTextContent(/^Copy$/);
    expect(by("wed-copy-fail")).toHaveTextContent("Couldn't copy — press and hold the link to copy");
    const box = by("wed-copy-fail-text") as HTMLTextAreaElement;
    expect(box.value).toMatch(/^https:\/\/.*live/);
    expect([box.selectionStart, box.selectionEnd]).toEqual([0, box.value.length]);
    expect(onToast).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("Copied");
  });
});

describe("Settings → Website: Save", () => {
  it("nothing changed since the last save: 'Saved', not tappable", async () => {
    const api = editorApi(); editor(api);
    await until(() => screen.queryByTestId("wed-save"));
    expect(by("wed-save")).toHaveTextContent(/^Saved$/);
    expect(by("wed-save")).toBeDisabled();
    fireEvent.click(by("wed-save")); await settle();
    expect(api.save).not.toHaveBeenCalled();
  });
  it("Save → Saving… → ✓ Saved (2 s) → Saved; double tap = one save request", async () => {
    const d = defer<{ ok: true }>();
    const api = editorApi({ save: vi.fn(() => d.promise) }); editor(api);
    await until(() => screen.queryByTestId("wed-save"));
    fireEvent.change(name(), { target: { value: "Live Shop 2" } });
    expect(by("wed-save")).toHaveTextContent(/^Save$/);
    expect(by("wed-save")).toBeEnabled();
    fireEvent.click(by("wed-save")); fireEvent.click(by("wed-save"));
    // a tap that slips through at the same moment the button turns off is ignored as well
    by("wed-save").removeAttribute("disabled"); fireEvent.click(by("wed-save")); by("wed-save").setAttribute("disabled", "");
    await settle();
    expect(by("wed-save")).toHaveTextContent("Saving…");
    expect(api.save).toHaveBeenCalledTimes(1);
    d.resolve({ ok: true });
    await until(() => by("wed-save").textContent === "✓ Saved");
    expect(by("wed-save")).toBeDisabled();
    await tick(FEEDBACK_MS + 50);
    expect(by("wed-save")).toHaveTextContent(/^Saved$/);
    expect(by("wed-save")).toBeDisabled();
    expect(api.save).toHaveBeenCalledTimes(1);
    // changing something again brings Save back
    fireEvent.change(name(), { target: { value: "Live Shop 3" } });
    expect(by("wed-save")).toHaveTextContent(/^Save$/);
    expect(by("wed-save")).toBeEnabled();
  });
  it("failed: red 'Couldn't save — tap to try again'; nothing is lost from the form; a tap tries again", async () => {
    const save = vi.fn<EditorApi["save"]>().mockResolvedValueOnce({ ok: false, reason: "failed" } as never).mockResolvedValueOnce({ ok: true });
    editor(editorApi({ save }));
    await until(() => screen.queryByTestId("wed-save"));
    fireEvent.change(name(), { target: { value: "My new shop name" } });
    fireEvent.click(by("wed-save"));
    await until(() => by("wed-save").textContent === "Couldn't save — tap to try again");
    expect(by("wed-save")).toBeEnabled();
    expect(by("wed-save")).toHaveAttribute("data-state", "failed");
    expect(name().value).toBe("My new shop name");
    fireEvent.click(by("wed-save"));
    await until(() => by("wed-save").textContent === "✓ Saved");
    expect(save).toHaveBeenCalledTimes(2);
    expect((save.mock.calls[1][0] as { draft: { name: string } }).draft.name).toBe("My new shop name");
  });
  it("a missing shop name: nothing is sent, the message says why, the button is Save again (not red)", async () => {
    const api = editorApi(); editor(api);
    await until(() => screen.queryByTestId("wed-save"));
    fireEvent.change(name(), { target: { value: "" } });
    fireEvent.click(by("wed-save"));
    await until(() => screen.queryByTestId("wed-msg"));
    await settle();
    expect(api.save).not.toHaveBeenCalled();
    expect(by("wed-save")).toHaveTextContent(/^Save$/);
    expect(by("wed-save")).toHaveAttribute("data-state", "ready");
    expect(by("wed-save")).toBeEnabled();
  });
  it("address already taken: the message, and Save again (retrying the same address would not help)", async () => {
    const api = editorApi({ save: vi.fn(async () => ({ ok: false as const, reason: "taken" as const })) }); editor(api);
    await until(() => screen.queryByTestId("wed-save"));
    fireEvent.change(name(), { target: { value: "Live Shop 2" } });
    fireEvent.click(by("wed-save"));
    await until(() => screen.queryByTestId("wed-msg"));
    await settle();
    expect(by("wed-save")).toHaveAttribute("data-state", "ready");
    expect(by("wed-msg").textContent!.length).toBeGreaterThan(5);
  });
});

describe("Website → Payment & shipping: Save", () => {
  const api = (over: Partial<PayShipApi> = {}): PayShipApi => ({ load: vi.fn(async () => SITE), save: vi.fn(async () => true), uploadQr: vi.fn(async () => "u/q.jpg"), ...over });
  const open = (a: PayShipApi) => render(<TProvider lang="en"><WebsitePayShip onToast={vi.fn()} api={a} /></TProvider>);
  it("unchanged = Saved; a change → Save → Saving… → ✓ Saved → Saved; one request", async () => {
    const d = defer<boolean>(); const a = api({ save: vi.fn(() => d.promise) }); open(a);
    await until(() => screen.queryByTestId("wps-save"));
    expect(by("wps-save")).toHaveTextContent(/^Saved$/);
    expect(by("wps-save")).toBeDisabled();
    fireEvent.change(by("wps-fee-s711"), { target: { value: "45" } });
    expect(by("wps-save")).toHaveTextContent(/^Save$/);
    fireEvent.click(by("wps-save")); fireEvent.click(by("wps-save"));
    await settle();
    expect(by("wps-save")).toHaveTextContent("Saving…");
    d.resolve(true);
    await until(() => by("wps-save").textContent === "✓ Saved");
    await tick(FEEDBACK_MS + 50);
    expect(by("wps-save")).toHaveTextContent(/^Saved$/);
    expect(a.save).toHaveBeenCalledTimes(1);
  });
  it("failed: red, tappable, the typed fee is still there", async () => {
    const a = api({ save: vi.fn(async () => false) }); open(a);
    await until(() => screen.queryByTestId("wps-save"));
    fireEvent.change(by("wps-fee-s711"), { target: { value: "45" } });
    fireEvent.click(by("wps-save"));
    await until(() => by("wps-save").textContent === "Couldn't save — tap to try again");
    expect(by("wps-save")).toBeEnabled();
    expect((by("wps-fee-s711") as HTMLInputElement).value).toBe("45");
  });
});

describe("Orders → Website: the buyer's order link", () => {
  const ORDER: WebsiteOrder = {
    id: "o1", orderNo: 12, token: "f".repeat(64), status: "payment_sent", paymentIssue: false, buyerName: "Demo Buyer", buyerPhone: "0900000000", buyerContact: "",
    delivery: "s711", storeId: "123456", storeName: "Test Store", address: null, payment: "bank", items: [{ pid: 1, vid: 12, name: "Dress", label: "M", price: 350, qty: 2 }],
    subtotal: 700, shipFee: 60, total: 760, note: null, receiptPath: null, receiptAt: null, autoCancelAt: null, paidAt: null, shippedAt: null,
    cancelledAt: null, cancelReason: null, seenAt: null, createdAt: "2026-11-15T01:00:00Z",
  } as WebsiteOrder;
  const api = (): OrdersApi => ({ load: vi.fn(async () => [ORDER]), blocked: vi.fn(async () => new Set<string>()), receipt: vi.fn(async () => null), shopSub: vi.fn(async () => "live"),
    act: vi.fn(async () => ({ ok: true as const, status: "payment_sent" as const, blocked: false })) } as unknown as OrdersApi);
  it("copied → ✓ Copied on the button; refused → the link selected with the press-and-hold line, no 'Copied' toast", async () => {
    const written = clipboard(true); const toast = vi.fn();
    render(<TProvider lang="en"><WebsiteOrders onToast={toast} api={api()} /></TProvider>);
    await until(() => screen.queryByTestId("wor-row"));
    fireEvent.click(by("wor-row"));
    await until(() => screen.queryByTestId("wor-link"));
    expect(by("wor-link")).toHaveTextContent("Buyer's order link");
    fireEvent.click(by("wor-link"));
    await until(() => by("wor-link").textContent === "✓ Copied");
    expect(written[0]).toContain(`/o/${"f".repeat(64)}`);
    await tick(FEEDBACK_MS + 50);
    expect(by("wor-link")).toHaveTextContent("Buyer's order link");
    clipboard(false);
    fireEvent.click(by("wor-link"));
    await until(() => screen.queryByTestId("wor-copy-fail"));
    expect((by("wor-copy-fail-text") as HTMLTextAreaElement).value).toContain(`/o/${"f".repeat(64)}`);
    expect(by("wor-link")).toHaveTextContent("Buyer's order link");
    expect(toast).not.toHaveBeenCalledWith("Copied");
  });
});

describe("Settings → profile: Save changes", () => {
  const account: AccountUser = { authUserId: "u1", email: "seller@example.com", profile: { fullName: "Test Owner", storeName: "Test Shop", phone: "0912345678", tiktok: "", facebook: "", adminContactNote: "" }, plan: "pro", planStatus: "active", planExpiry: "", connectedAccounts: [], role: "seller" };
  const noop = () => {};
  const open = (onSaveProfile: (p: unknown) => Promise<{ ok: boolean }>) => render(
    <TProvider lang="en">
      <GeneralSettings theme="light" accent="indigo" onSetTheme={noop} onSetAccent={noop} auto={{ detect: false, toggle: noop }} cur="NT$" lang="en" onSetLang={noop} currency="TWD" onSetCurrency={noop}
        profileOpen onToggleProfile={noop} printerIdx={0} printerOpen={false} onTogglePrinter={noop} onPickPrinter={noop} onPrintPattern={noop} onSubscription={noop} onSupport={noop} onDelete={noop}
        account={account} onSaveProfile={onSaveProfile as never} onManageChannel={noop} />
    </TProvider>);
  const btn = () => by("set-profile-save");
  it("unchanged = Saved; saved = ✓ Saved then Saved; one request for a double tap", async () => {
    const d = defer<{ ok: boolean }>(); const save = vi.fn(() => d.promise); open(save);
    expect(btn()).toHaveTextContent(/^Saved$/);
    expect(btn()).toBeDisabled();
    fireEvent.change(screen.getByDisplayValue("Test Shop"), { target: { value: "Test Shop 2" } });
    expect(btn()).toHaveTextContent("Save changes");
    fireEvent.click(btn()); fireEvent.click(btn());
    await settle();
    expect(btn()).toHaveTextContent("Saving…");
    expect(save).toHaveBeenCalledTimes(1);
    d.resolve({ ok: true });
    await until(() => btn().textContent === "✓ Saved");
    await tick(FEEDBACK_MS + 50);
    expect(btn()).toHaveTextContent(/^Saved$/); // the same text is not offered for saving again
    expect(btn()).toBeDisabled();
  });
  it("failed: red 'Couldn't save — tap to try again', the typed name is kept", async () => {
    open(vi.fn(async () => ({ ok: false })));
    fireEvent.change(screen.getByDisplayValue("Test Shop"), { target: { value: "Test Shop 2" } });
    fireEvent.click(btn());
    await until(() => btn().textContent === "Couldn't save — tap to try again");
    expect(btn()).toBeEnabled();
    expect(screen.getByDisplayValue("Test Shop 2")).toBeInTheDocument();
  });
  it("a wrong phone: nothing is sent, the line above the button says why, the button stays Save changes", async () => {
    const save = vi.fn(async () => ({ ok: true })); open(save);
    fireEvent.change(screen.getByDisplayValue("0912345678"), { target: { value: "1234567890" } });
    fireEvent.click(btn());
    await settle();
    expect(save).not.toHaveBeenCalled();
    expect(btn()).toHaveTextContent("Save changes");
    expect(screen.getAllByText(/valid phone/i).length).toBeGreaterThan(0);
  });
});

// ── the rest of the seller app, by its source ──
const src = (p: string) => readFileSync(join("src/redesign", p), "utf8");
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? (f === "__tests__" ? [] : files(p)) : /\.tsx?$/.test(f) ? [p] : []; });
}
describe("every seller screen", () => {
  it("only ONE place writes to the clipboard — and it answers whether it worked", () => {
    const writers = files("src/redesign").filter((p) => /clipboard\??\.writeText|execCommand\(/.test(readFileSync(p, "utf8")));
    expect(writers.map((p) => p.replace(/\\/g, "/"))).toEqual(["src/redesign/components/inviteShare.ts"]);
    expect(src("components/inviteShare.ts")).toMatch(/export async function copyText\(text: string\): Promise<boolean>/);
  });
  it("no screen says 'Copied' without looking at the answer", () => {
    for (const p of ["screens/WebsiteEditor.tsx", "screens/WebsiteOrders.tsx"]) expect(src(p), p).not.toContain("rd_shop_od_copied");
    const pt = src("screens/ParcelTracking.tsx");
    expect(pt).toMatch(/const ok = await copyFb\.copy\(msg\);\s*if \(ok\) showToast\(t\.rd_pt_msg_copied/);
    expect(pt).toMatch(/const ok = await copyFb\.copy\(handle\);\s*if \(ok\) showToast\(t\.rd_pt_copied/);
    expect(pt).toContain('<CopyFailNote fb={copyFb} t={t} what="text" floating testid="pt-copy-fail" />');
  });
  it("forms that close or clear after saving say 'Saving…' while they save", () => {
    for (const [p, n] of [["screens/Shipping.tsx", 2], ["screens/ParcelScan.tsx", 1], ["screens/FmParcelScan.tsx", 1], ["screens/CustomerDetails.tsx", 1], ["screens/FmCustomerDetails.tsx", 1], ["screens/PostSales.tsx", 1]] as const)
      expect(src(p).split("t.rd_fb_saving").length - 1, p).toBe(n);
    expect(src("screens/Shipping.tsx")).not.toMatch(/\? "…" : (t\.rd_shp_save|tpl\(t\.rd_shp_split_save)/);
  });
  it("Posts: a price / stock save that fails says so under the row (it used to stay silent)", () => {
    const p = src("screens/PostSales.tsx");
    expect(p).toMatch(/if \(ok\) setEditing\(null\); else setSaveFailed\(id\);/);
    expect(p).toContain('data-testid="my-post-save-failed"');
    expect(p).toContain("{t.rd_fb_save_failed}");
  });
});
