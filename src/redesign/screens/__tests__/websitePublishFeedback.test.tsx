// Seller Website hotfix 3 — Publish gives feedback: Publishing… while it runs (save + publish),
// then "✓ Published" on the button for ~3 s + toast "Your website is live", then "Published ✓"
// (disabled) while there is nothing new to publish. On error the reason is shown (+ toast).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { TProvider } from "../../i18n";
import WebsiteEditor from "../WebsiteEditor";
import type { EditorApi } from "../../adapters/websiteEditorApi";
import type { MyWebsite, PublishResult } from "../../adapters/websiteSeller";
import { DEFAULT_SETTINGS } from "../../adapters/websiteEditor";

const DESIGN = { name: "BudgetUkay", tagline: "Ukay" };
const site = (published: MyWebsite["published"]): MyWebsite => ({ subdomain: "budgetukay", draft: DESIGN, published, publishedAt: published ? "2026-11-14T02:00:00Z" : null, settings: DEFAULT_SETTINGS, customDomain: null });
function deferred<T>() { let resolve!: (v: T) => void; const p = new Promise<T>((r) => { resolve = r; }); return { p, resolve }; }
function setup(w: MyWebsite, publish: EditorApi["publish"], p: { ios?: boolean; onUpgrade?: () => void } = {}) {
  const onToast = vi.fn();
  const api: EditorApi = { load: vi.fn(async () => w), save: vi.fn(async () => ({ ok: true as const })), publish: vi.fn(publish), subdomainFree: vi.fn(async () => true), uploadPicture: vi.fn(async () => null), loadProducts: vi.fn(async () => []) };
  render(<TProvider lang="en"><WebsiteEditor onPayShip={vi.fn()} onToast={onToast} ios={!!p.ios} onUpgrade={p.onUpgrade} plan="pro" planStatus="active" planExpiry="2099-01-01" api={api} /></TProvider>);
  return { api, onToast };
}
const btn = () => screen.getByTestId("wed-publish");
afterEach(() => vi.useRealTimers());

describe("Publish feedback", () => {
  it("Publishing… → ✓ Published (3 s) + toast → Published ✓ (disabled)", async () => {
    const d = deferred<PublishResult>();
    const { api, onToast } = setup(site({ name: "BudgetUkay" }), () => d.p);
    await screen.findByTestId("wed-publish");
    expect(btn()).toHaveTextContent(/^Publish$/);
    expect(btn()).toBeEnabled();
    fireEvent.click(btn());
    expect(btn()).toHaveTextContent("Publishing…"); // at once — also while the draft is being saved
    expect(btn()).toBeDisabled();
    await vi.waitFor(() => expect(api.publish).toHaveBeenCalledTimes(1));
    expect(btn()).toHaveTextContent("Publishing…");
    vi.useFakeTimers();
    await act(async () => { d.resolve({ ok: true, at: "2026-11-16T00:00:00Z" }); });
    expect(btn()).toHaveTextContent("✓ Published");
    expect(btn()).toBeDisabled();
    expect(onToast).toHaveBeenCalledWith("Your website is live");
    expect(screen.queryByTestId("wed-msg")).toBeNull(); // no second "Saved" line
    act(() => { vi.advanceTimersByTime(2900); });
    expect(btn()).toHaveTextContent("✓ Published");
    act(() => { vi.advanceTimersByTime(200); });
    expect(btn()).toHaveTextContent("Published ✓");
    expect(btn()).toBeDisabled();
    expect(api.publish).toHaveBeenCalledTimes(1);
  });

  it("nothing new to publish → 'Published ✓' disabled; an edit brings back Publish", async () => {
    const { api } = setup(site(DESIGN), async () => ({ ok: true, at: "x" }));
    await screen.findByTestId("wed-publish");
    expect(btn()).toHaveTextContent("Published ✓");
    expect(btn()).toBeDisabled();
    fireEvent.click(btn());
    expect(api.publish).not.toHaveBeenCalled();
    fireEvent.change(screen.getByTestId("wed-sub"), { target: { value: "budgetukay2" } }); // a new address is a change too
    expect(btn()).toHaveTextContent(/^Publish$/);
    expect(btn()).toBeEnabled();
  });

  it("never published → plain Publish", async () => {
    setup(site(null), async () => ({ ok: true, at: "x" }));
    await screen.findByTestId("wed-publish");
    expect(btn()).toHaveTextContent(/^Publish$/);
  });

  it("error: upgrade needed → reason shown + toast + Upgrade link; button back to Publish", async () => {
    const onUpgrade = vi.fn();
    const { onToast } = setup(site({ name: "BudgetUkay" }), async () => ({ ok: false, reason: "upgrade_required" }), { onUpgrade });
    fireEvent.click(await screen.findByTestId("wed-publish"));
    expect(await screen.findByTestId("wed-msg")).toHaveTextContent("Upgrade to publish your website");
    expect(onToast).toHaveBeenCalledWith("Upgrade to publish your website");
    expect(btn()).toHaveTextContent(/^Publish$/);
    fireEvent.click(screen.getByTestId("wed-pub-upgrade"));
    expect(onUpgrade).toHaveBeenCalled();
  });

  it("error on iOS: no plan words, no Upgrade link", async () => {
    setup(site({ name: "BudgetUkay" }), async () => ({ ok: false, reason: "upgrade_required" }), { ios: true, onUpgrade: vi.fn() });
    fireEvent.click(await screen.findByTestId("wed-publish"));
    expect(await screen.findByTestId("wed-msg")).toHaveTextContent("Publishing isn't available on this account yet.");
    expect(screen.queryByTestId("wed-pub-upgrade")).toBeNull();
  });

  it("error: other failure → 'Couldn't save. Please try again.'", async () => {
    setup(site({ name: "BudgetUkay" }), async () => ({ ok: false, reason: "failed" }));
    fireEvent.click(await screen.findByTestId("wed-publish"));
    expect(await screen.findByTestId("wed-msg")).toHaveTextContent("Couldn't save. Please try again.");
    expect(btn()).toBeEnabled();
  });
});
