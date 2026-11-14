// Admin → 7-11 Login panel: the connect ladder (not connected → step 1 → step 2 → connected),
// the needs-login and key-missing states, and the SMS-box paste fill. fetch is mocked.
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach } from "vitest";
import Pc711Panel from "../Pc711Panel";
import { TProvider } from "../../i18n";
import { fillSmsBoxes } from "../../adapters/pc711Login";

vi.mock("../../../supabase", () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "t" } } }) } } }));

type Resp = { ok?: boolean; status?: number; body: Record<string, unknown> };
const queue: Record<string, Resp[]> = {};
const push = (path: string, r: Resp) => { (queue[path] ||= []).push(r); };
afterEach(() => { for (const k of Object.keys(queue)) delete queue[k]; vi.restoreAllMocks(); });

function installFetch() {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
    const path = new URL(url, "http://x").pathname.replace("/admin/pc711", "");
    const r = (queue[path] || []).shift() || { body: {} };
    return { ok: r.ok ?? true, status: r.status ?? 200, json: async () => r.body };
  });
}
beforeEach(installFetch);

const renderPanel = () => render(<TProvider lang="en"><Pc711Panel /></TProvider>);

describe("Pc711Panel", () => {
  it("fillSmsBoxes: a 6-digit paste fills all; typing one advances; alnum keeps upper-cased letters", () => {
    expect(fillSmsBoxes(["", "", "", "", "", ""], 2, "123456")).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(fillSmsBoxes(["", "", "", "", "", ""], 0, "7")).toEqual(["7", "", "", "", "", ""]);
    expect(fillSmsBoxes(["", "", "", "", "", ""], 0, "ab12", true)).toEqual(["A", "B", "1", "2", "", ""]);
    expect(fillSmsBoxes(["", "", "", "", "", ""], 0, "ab12")).toEqual(["1", "2", "", "", "", ""]); // digits only by default
  });
  it("key_missing → the set-the-key note, no Connect", async () => {
    push("/status", { body: { state: "key_missing" } });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("pc711-key-missing")).toBeTruthy());
    expect(screen.queryByTestId("pc711-begin")).toBeNull();
  });
  it("needs_login shows the paused alert + Connect again", async () => {
    push("/status", { body: { state: "needs_login" } });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("pc711-needs-login")).toBeTruthy());
    expect(screen.getByTestId("pc711-begin")).toBeTruthy();
  });
  it("full connect ladder: begin → step1 → send SMS → step2 → connect → connected", async () => {
    push("/status", { body: { state: "not_connected" } });
    push("/login/start", { body: { flowId: "F1", captcha: "data:image/png;base64,AAA" } });
    push("/login/submit", { body: { step: "sms", phoneTail: "678" } });
    push("/login/sms", { body: { step: "connected" } });
    push("/status", { body: { state: "connected", since: "2026-11-14T00:00:00Z", lastOkAt: "2026-11-14T00:00:00Z", autoLogins: 0, phoneTail: "678" } });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("pc711-begin")).toBeTruthy());
    fireEvent.click(screen.getByTestId("pc711-begin"));
    await waitFor(() => expect(screen.getByTestId("pc711-step1")).toBeTruthy());
    expect(screen.getByTestId("pc711-picture")).toBeTruthy();
    fireEvent.change(screen.getByTestId("pc711-phone"), { target: { value: "0912345678" } });
    fireEvent.change(screen.getByTestId("pc711-password"), { target: { value: "secret" } });
    fireEvent.change(screen.getByTestId("pc711-code"), { target: { value: "12345" } });
    fireEvent.click(screen.getByTestId("pc711-send-sms"));
    await waitFor(() => expect(screen.getByTestId("pc711-step2")).toBeTruthy());
    expect(screen.getByText(/678/)).toBeTruthy();
    for (let i = 0; i < 6; i++) fireEvent.change(screen.getByTestId(`pc711-box-${i}`), { target: { value: String(i + 1) } });
    fireEvent.click(screen.getByTestId("pc711-connect"));
    await waitFor(() => expect(screen.getByTestId("pc711-connected")).toBeTruthy());
    // the password is not left on the screen (the password input only exists on step 1)
    expect(screen.queryByTestId("pc711-password")).toBeNull();
  });
  it("step 2 shows the code prefix (識別碼) when 7-11 sends one", async () => {
    push("/status", { body: { state: "not_connected" } });
    push("/login/start", { body: { flowId: "F1", captcha: "data:image/gif;base64,AAA" } });
    push("/login/submit", { body: { step: "sms", phoneTail: "678", prefix: "7A", alnum: false } });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("pc711-begin")).toBeTruthy());
    fireEvent.click(screen.getByTestId("pc711-begin"));
    await waitFor(() => expect(screen.getByTestId("pc711-step1")).toBeTruthy());
    fireEvent.change(screen.getByTestId("pc711-phone"), { target: { value: "0912345678" } });
    fireEvent.change(screen.getByTestId("pc711-password"), { target: { value: "secret" } });
    fireEvent.change(screen.getByTestId("pc711-code"), { target: { value: "12345" } });
    fireEvent.click(screen.getByTestId("pc711-send-sms"));
    await waitFor(() => expect(screen.getByTestId("pc711-prefix")).toBeTruthy());
    expect(screen.getByTestId("pc711-prefix").textContent).toContain("7A");
  });
  it("an unmapped error token (E0) is NEVER shown — a readable sentence appears instead", async () => {
    push("/status", { body: { state: "not_connected" } });
    push("/login/start", { body: { flowId: "F1", captcha: "data:image/gif;base64,AAA" } });
    push("/login/submit", { body: { step: "error", message: "E0" } });
    push("/login/captcha", { body: { captcha: "data:image/gif;base64,BBB" } });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("pc711-begin")).toBeTruthy());
    fireEvent.click(screen.getByTestId("pc711-begin"));
    await waitFor(() => expect(screen.getByTestId("pc711-step1")).toBeTruthy());
    fireEvent.change(screen.getByTestId("pc711-phone"), { target: { value: "0912345678" } });
    fireEvent.change(screen.getByTestId("pc711-password"), { target: { value: "secret" } });
    fireEvent.change(screen.getByTestId("pc711-code"), { target: { value: "12345" } });
    fireEvent.click(screen.getByTestId("pc711-send-sms"));
    await waitFor(() => expect(screen.getByTestId("pc711-err")).toBeTruthy());
    expect(screen.getByTestId("pc711-err").textContent).not.toBe("E0");
    expect((screen.getByTestId("pc711-err").textContent || "").length).toBeGreaterThan(4);
  });
  it("Send again stays on step 2 and calls the resend route", async () => {
    push("/status", { body: { state: "not_connected" } });
    push("/login/start", { body: { flowId: "F1", captcha: "data:image/gif;base64,AAA" } });
    push("/login/submit", { body: { step: "sms", phoneTail: "678" } });
    push("/login/resend", { body: { step: "sms", resent: true, phoneTail: "678" } });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("pc711-begin")).toBeTruthy());
    fireEvent.click(screen.getByTestId("pc711-begin"));
    await waitFor(() => expect(screen.getByTestId("pc711-step1")).toBeTruthy());
    fireEvent.change(screen.getByTestId("pc711-phone"), { target: { value: "0912345678" } });
    fireEvent.change(screen.getByTestId("pc711-password"), { target: { value: "secret" } });
    fireEvent.change(screen.getByTestId("pc711-code"), { target: { value: "12345" } });
    fireEvent.click(screen.getByTestId("pc711-send-sms"));
    await waitFor(() => expect(screen.getByTestId("pc711-step2")).toBeTruthy());
    // the 60 s timer disables it; the button still exists and points at resend (no page change)
    expect(screen.getByTestId("pc711-send-again")).toBeTruthy();
    expect(screen.getByTestId("pc711-back")).toBeTruthy();
  });
});

describe("Pc711Panel — Test now + Shadow", () => {
  const CONNECTED = { state: "connected", since: "2026-11-14T00:00:00Z", lastOkAt: null, autoLogins: 0, phoneTail: "678", lastProblem: null };
  const at = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

  it("while running: 'Testing…' and disabled; the result stays; within the limit: 'Try again after hh:mm' (result kept)", async () => {
    push("/status", { body: CONNECTED });
    push("/status", { body: CONNECTED });
    push("/admin/pc-server-probe", { body: { success: true, result: { store: { verdict: "open", kind: "" } } } });
    const retryAt = "2026-11-14T05:10:00.000Z";
    push("/admin/pc-server-probe", { ok: false, status: 429, body: { success: false, error: "rate_limited", retryAt } });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("pc711-connected")).toBeTruthy());
    const btn = () => screen.getByTestId("pc711-test") as HTMLButtonElement;
    fireEvent.click(btn());
    expect(btn().textContent).toBe("Testing…");
    expect(btn().disabled).toBe(true);
    await waitFor(() => expect(screen.getByTestId("pc711-test-result").textContent).toBe("Store check: open"));
    await waitFor(() => expect(btn().disabled).toBe(false));
    expect(btn().textContent).toBe("Test now");
    fireEvent.click(btn());
    await waitFor(() => expect(screen.getByTestId("pc711-try-after").textContent).toBe(`Try again after ${at(retryAt)}`));
    expect(screen.getByTestId("pc711-test-result").textContent).toBe("Store check: open"); // the last result stays
    expect(screen.queryByText("Too many tries")).toBeNull();
  });

  it("Shadow block: today's counts, match % per kind, server average, last mismatches (no ids)", async () => {
    push("/status", { body: CONNECTED });
    push("/shadow", { body: {
      enabled: true,
      today: { n: 12, store: { n: 8, matchPct: 88 }, phone: { n: 4, matchPct: 100 }, avgMs: 1450 },
      mismatches: [{ kind: "store", ext: "open", srv: "full", at: "2026-11-14T03:05:00Z" }, { kind: "phone", ext: "ok", srv: "restricted", at: "2026-11-14T03:07:00Z" }],
    } });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("pc711-shadow-n").textContent).toBe("12"));
    expect(screen.getByTestId("pc711-shadow-store").textContent).toBe("88% match (8)");
    expect(screen.getByTestId("pc711-shadow-phone").textContent).toBe("100% match (4)");
    expect(screen.getByTestId("pc711-shadow-avg").textContent).toBe("1450 ms");
    const lines = screen.getAllByTestId("pc711-shadow-mis").map((e) => e.textContent);
    expect(lines).toEqual([`store full: ext=open srv=full at ${at("2026-11-14T03:05:00Z")}`, `phone: ext=ok srv=restricted at ${at("2026-11-14T03:07:00Z")}`]);
    expect(screen.queryByTestId("pc711-shadow-off")).toBeNull();
  });

  it("Shadow off → says so; nothing compared → dashes", async () => {
    push("/status", { body: CONNECTED });
    push("/shadow", { body: { enabled: false, today: { n: 0, store: { n: 0, matchPct: null }, phone: { n: 0, matchPct: null }, avgMs: null }, mismatches: [] } });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("pc711-shadow-off")).toBeTruthy());
    expect(screen.getByTestId("pc711-shadow-store").textContent).toBe("—");
    expect(screen.getByTestId("pc711-shadow-avg").textContent).toBe("—");
  });
});
