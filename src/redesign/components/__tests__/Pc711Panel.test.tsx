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
  it("fillSmsBoxes: a 6-digit paste fills all; typing one advances", () => {
    expect(fillSmsBoxes(["", "", "", "", "", ""], 2, "123456")).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(fillSmsBoxes(["", "", "", "", "", ""], 0, "7")).toEqual(["7", "", "", "", "", ""]);
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
});
