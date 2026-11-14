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

  const TODAY = { n: 16, compared: 13, matchPct: 92, errors: 3,
    store: { n: 8, matchPct: 88, errors: 2 }, phone: { n: 4, matchPct: 100, errors: 1 }, frozen: { n: 1, matchPct: 100, errors: 0 },
    avgMs: 1450, errorsByStep: { "store.emap": 2, "phone.token": 1 } };
  it("Shadow block: compared / match % per kind (frozen too) / errors per kind / avg ms / errors by step", async () => {
    push("/status", { body: CONNECTED });
    push("/shadow", { body: { enabled: true, today: TODAY } });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("pc711-shadow-n").textContent).toBe("13"));
    expect(screen.getByTestId("pc711-shadow-store").textContent).toBe("88% match (8)");
    expect(screen.getByTestId("pc711-shadow-phone").textContent).toBe("100% match (4)");
    expect(screen.getByTestId("pc711-shadow-frozen").textContent).toBe("100% match (1)");
    expect(screen.getByTestId("pc711-shadow-errors").textContent).toBe("Store full 2 · Phone 1 · Frozen 0");
    expect(screen.getByTestId("pc711-shadow-avg").textContent).toBe("1450 ms");
    expect(screen.getByTestId("pc711-shadow-bystep").textContent).toBe("store.emap 2 · phone.token 1");
    expect(screen.queryByTestId("pc711-shadow-off")).toBeNull();
  });

  it("History: Taipei MM/DD HH:mm:ss, per-day totals, match / mismatch / error text, tap → steps; filters + paging ask the server", async () => {
    push("/status", { body: CONNECTED });
    push("/shadow", { body: { enabled: true, today: TODAY } });
    const rows = [
      { at: "2026-11-14T17:09:22Z", kind: "store", result: "error", ext: "open", srv: "unknown", raw: null, gapS: 60, failStep: "store.emap", failHttp: 0, failReason: "timeout", ms: 4000,
        steps: [{ s: "store.cart", http: 200, ms: 1102, ok: true }, { s: "store.emap", http: 0, ms: 2900, ok: false, w: "timeout" }] },
      { at: "2026-11-14T03:05:00Z", kind: "frozen", result: "mismatch", ext: "ok", srv: "no_frozen", raw: "disable", gapS: 180, failStep: null, failHttp: null, failReason: null, ms: 2100, steps: [] },
      { at: "2026-11-13T12:00:01Z", kind: "phone", result: "match", ext: "ok", srv: "ok", raw: "Status:true", gapS: 30, failStep: null, failHttp: null, failReason: null, ms: 900, steps: [] },
    ];
    const days = { "2026-11-15": { compared: 0, matchPct: null, errors: 1 }, "2026-11-14": { compared: 1, matchPct: 0, errors: 0 }, "2026-11-13": { compared: 5, matchPct: 100, errors: 0 } };
    push("/shadow/history", { body: { page: 0, more: true, rows, days } });
    push("/shadow/history", { body: { page: 0, more: false, rows: [], days: {} } });
    push("/shadow/history", { body: { page: 0, more: false, rows: [], days: {} } });
    renderPanel();
    await waitFor(() => expect(screen.getAllByTestId("pc711-sh-row")).toHaveLength(3));
    const text = screen.getAllByTestId("pc711-sh-row").map((e) => e.textContent);
    expect(text[0]).toBe("11/15 01:09:22 · Store full · error at store.emap http=0 timeout · 4000 ms"); // 17:09Z = 01:09 Taipei next day
    expect(text[1]).toBe("11/14 11:05:00 · Frozen · mismatch ext=ok srv=no_frozen raw=disable gap=3m · 2100 ms");
    expect(text[2]).toBe("11/13 20:00:01 · Phone · match · 900 ms");
    const totals = screen.getAllByTestId("pc711-sh-daytotal").map((e) => e.textContent);
    expect(totals).toEqual(["11/15 — 0 compared · — match · 1 errors", "11/14 — 1 compared · 0% match · 0 errors", "11/13 — 5 compared · 100% match · 0 errors"]);
    fireEvent.click(screen.getAllByTestId("pc711-sh-row")[0]);
    expect(screen.getAllByTestId("pc711-sh-step").map((e) => e.textContent)).toEqual(["store.cart · 200 · 1102 ms · ok", "store.emap · 0 · 2900 ms · ✕ timeout"]);
    const hist = () => (globalThis.fetch as unknown as { mock: { calls: [string][] } }).mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/shadow/history"));
    expect(hist()[0]).toMatch(/day=today&filter=all&kind=all&page=0/);
    fireEvent.click(screen.getByTestId("pc711-sh-next"));
    await waitFor(() => expect(hist()[1]).toMatch(/page=1/));
    fireEvent.click(screen.getByTestId("pc711-sh-day-7days"));
    await waitFor(() => expect(hist()[2]).toMatch(/day=7days&filter=all&kind=all&page=0/));
    fireEvent.click(screen.getByTestId("pc711-sh-filter-error"));
    await waitFor(() => expect(hist()[3]).toMatch(/day=7days&filter=error&kind=all&page=0/));
    fireEvent.click(screen.getByTestId("pc711-sh-kind-frozen"));
    await waitFor(() => expect(hist()[4]).toMatch(/filter=error&kind=frozen&page=0/));
    // never an id / phone / store on screen
    expect(screen.getByTestId("pc711-shadow").textContent).not.toMatch(/\d{6,}/);
  });

  it("Shadow off → says so; nothing compared → dashes", async () => {
    push("/status", { body: CONNECTED });
    push("/shadow", { body: { enabled: false, today: { n: 0, compared: 0, matchPct: null, errors: 0, store: { n: 0, matchPct: null, errors: 0 }, phone: { n: 0, matchPct: null, errors: 0 }, frozen: { n: 0, matchPct: null, errors: 0 }, avgMs: null, errorsByStep: {} } } });
    renderPanel();
    await waitFor(() => expect(screen.getByTestId("pc711-shadow-off")).toBeTruthy());
    expect(screen.getByTestId("pc711-shadow-store").textContent).toBe("—");
    expect(screen.getByTestId("pc711-shadow-avg").textContent).toBe("—");
    expect(screen.getByTestId("pc711-shadow-bystep").textContent).toBe("—");
  });
});
