// Forgot password — 6-digit email code flow on the Login screen. Switch OFF (or unreadable)
// = today's Telegram modal unchanged; ?reset_preview=1 or switch ON = the 3-step flow.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { TProvider } from "../../i18n";

const S = vi.hoisted(() => ({
  rpc: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
}));
vi.mock("../../../supabase", () => ({
  isSupabaseConfigured: true,
  supabase: { rpc: S.rpc, auth: { resetPasswordForEmail: S.resetPasswordForEmail, verifyOtp: S.verifyOtp, updateUser: S.updateUser, signOut: S.signOut, signInWithPassword: S.signInWithPassword } },
}));

import Login from "../Login";

const EMAIL = "seller@example.com", CODE = "482913", PW = "brandNew42";
const consoleSpies: ReturnType<typeof vi.spyOn>[] = [];
function view(lang = "en") {
  const onLogin = vi.fn(async () => ({ ok: true }));
  const r = render(
    <TProvider lang={lang}>
      <Login onLogin={onLogin} onSignup={vi.fn()} configured lang={lang} langOpen={false} onToggleLang={vi.fn()} onPickLang={vi.fn()} />
    </TProvider>,
  );
  return { ...r, onLogin };
}
const openForgot = () => fireEvent.click(screen.getByText("Forgot password?"));
const flowOn = () => S.rpc.mockResolvedValue({ data: true, error: null });

async function toCodeStep() {
  fireEvent.change(await screen.findByTestId("pwr-email"), { target: { value: EMAIL } });
  fireEvent.click(screen.getByTestId("pwr-send"));
  await screen.findByTestId("pwr-step-code", {}, { timeout: 3000 });
}
async function toPasswordStep() {
  await toCodeStep();
  fireEvent.change(screen.getByTestId("pwr-code"), { target: { value: CODE } });
  await screen.findByTestId("pwr-step-password");
}

beforeEach(() => {
  for (const f of Object.values(S)) f.mockReset();
  S.rpc.mockResolvedValue({ data: false, error: null });
  S.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  S.verifyOtp.mockResolvedValue({ data: { session: { user: { id: "u1" } } }, error: null });
  S.updateUser.mockResolvedValue({ data: {}, error: null });
  S.signOut.mockResolvedValue({ error: null });
  localStorage.clear(); sessionStorage.clear();
  window.history.replaceState(null, "", "/");
  for (const m of ["log", "info", "warn", "error", "debug"] as const) consoleSpies.push(vi.spyOn(console, m).mockImplementation(() => {}));
});
afterEach(() => {
  // NOTHING is ever logged with the email, code or password.
  for (const s of consoleSpies.splice(0)) {
    const all = JSON.stringify(s.mock.calls);
    expect(all).not.toContain(EMAIL); expect(all).not.toContain(CODE); expect(all).not.toContain(PW);
    s.mockRestore();
  }
  vi.useRealTimers();
});

describe("which modal", () => {
  it("switch OFF + no param → today's Telegram modal, unchanged", async () => {
    view();
    await waitFor(() => expect(S.rpc).toHaveBeenCalledWith("reset_code_enabled"));
    openForgot();
    expect(screen.getByText("Reset your password")).toBeTruthy();
    expect(screen.getByText("Maybe next time")).toBeTruthy();
    expect(screen.queryByTestId("pwr-modal")).toBeNull();
  });
  it("switch unreadable (error / throw) → OFF", async () => {
    S.rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    view(); await waitFor(() => expect(S.rpc).toHaveBeenCalled());
    openForgot();
    expect(screen.queryByTestId("pwr-modal")).toBeNull();
    expect(screen.getByText("Maybe next time")).toBeTruthy();
  });
  it("switch OFF + ?reset_preview=1 → the new flow", async () => {
    window.history.replaceState(null, "", "/?reset_preview=1");
    view();
    openForgot();
    expect(screen.getByTestId("pwr-modal")).toBeTruthy();
  });
  it("switch ON → the new flow", async () => {
    flowOn(); view();
    await waitFor(() => expect(S.rpc).toHaveBeenCalled());
    await act(async () => {});
    openForgot();
    expect(screen.getByTestId("pwr-step-email")).toBeTruthy();
  });
});

describe("step 1 — send code", () => {
  for (const [label, impl] of [
    ["success", () => S.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null })],
    ["unknown email", () => S.resetPasswordForEmail.mockResolvedValue({ data: null, error: { status: 400, message: "User not found" } })],
    ["error", () => S.resetPasswordForEmail.mockRejectedValue(new Error("fetch failed"))],
  ] as const) {
    it(`same neutral message for ${label}; no raw error text`, async () => {
      impl(); flowOn(); view(); await act(async () => {}); openForgot();
      await toCodeStep();
      expect(screen.getByTestId("pwr-sent").textContent).toBe("If this email has an account, we sent a 6-digit code. Check Inbox, Spam and Promotions — from SellerFlowLive");
      expect(document.body.textContent).not.toMatch(/not found|fetch failed/i);
    });
  }
  it("too many requests → 'Please wait a moment and try again'", async () => {
    S.resetPasswordForEmail.mockResolvedValue({ data: null, error: { status: 429, message: "email rate limit exceeded" } });
    flowOn(); view(); await act(async () => {}); openForgot();
    fireEvent.change(await screen.findByTestId("pwr-email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByTestId("pwr-send"));
    expect((await screen.findByTestId("pwr-wait", {}, { timeout: 3000 })).textContent).toBe("Please wait a moment and try again");
    expect(document.body.textContent).not.toMatch(/rate limit/i);
  });
  it("60 s resend countdown", async () => {
    flowOn(); view(); await act(async () => {}); openForgot();
    await toCodeStep();
    const resend = screen.getByTestId("pwr-resend") as HTMLButtonElement;
    expect(resend.disabled).toBe(true);
    expect(resend.textContent).toMatch(/Send a new code in (60|59)s/);
    fireEvent.click(resend);
    expect(S.resetPasswordForEmail).toHaveBeenCalledTimes(1);
  });
});

describe("step 2 — code", () => {
  it("paste with spaces/dashes → auto-submits verifyOtp type 'recovery'", async () => {
    flowOn(); view(); await act(async () => {}); openForgot();
    await toCodeStep();
    const box = screen.getByTestId("pwr-code") as HTMLInputElement;
    expect(box.getAttribute("inputmode")).toBe("numeric");
    fireEvent.change(box, { target: { value: "482 913" } });
    await screen.findByTestId("pwr-step-password");
    expect(S.verifyOtp).toHaveBeenCalledWith({ email: EMAIL, token: CODE, type: "recovery" });
  });
  it("wrong code → seller words, no raw text; 5 wrong tries lock the box (account untouched)", async () => {
    S.verifyOtp.mockResolvedValue({ data: { session: null }, error: { message: "Token has expired or is invalid" } });
    flowOn(); view(); await act(async () => {}); openForgot();
    await toCodeStep();
    for (let i = 0; i < 5; i++) {
      fireEvent.change(screen.getByTestId("pwr-code"), { target: { value: "111111" } });
      await waitFor(() => expect(S.verifyOtp).toHaveBeenCalledTimes(i + 1));
      await waitFor(() => expect((screen.getByTestId("pwr-code") as HTMLInputElement).value).toBe(""));
      if (i < 4) expect(screen.getByTestId("pwr-wrong").textContent).toBe("Wrong or expired code. Try again or send a new code.");
    }
    expect((screen.getByTestId("pwr-code") as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByTestId("pwr-locked")).toBeTruthy();
    expect(screen.getByTestId("pwr-resend")).toBeTruthy();
    fireEvent.change(screen.getByTestId("pwr-code"), { target: { value: "222222" } });
    expect(S.verifyOtp).toHaveBeenCalledTimes(5);
    expect(document.body.textContent).not.toMatch(/Token has expired/);
    expect(S.updateUser).not.toHaveBeenCalled();
    expect(S.signOut).not.toHaveBeenCalled(); // nothing done to the account
  });
});

describe("step 3 — new password", () => {
  it("too short / mismatch are blocked (no updateUser)", async () => {
    flowOn(); view(); await act(async () => {}); openForgot();
    await toPasswordStep();
    const [a, b] = Array.from(document.querySelectorAll('[data-testid="pwr-step-password"] input')) as HTMLInputElement[];
    fireEvent.change(a, { target: { value: "abc" } }); fireEvent.change(b, { target: { value: "abc" } });
    fireEvent.click(screen.getByTestId("pwr-save"));
    expect(screen.getByTestId("pwr-err").textContent).toBe("Password must be at least 6 characters.");
    fireEvent.change(a, { target: { value: PW } }); fireEvent.change(b, { target: { value: PW + "x" } });
    fireEvent.click(screen.getByTestId("pwr-save"));
    expect(screen.getByTestId("pwr-err").textContent).toBe("Passwords do not match.");
    expect(S.updateUser).not.toHaveBeenCalled();
  });
  it("save → updateUser, signOut global, NO auto-login, back on the login form with the email filled in", async () => {
    flowOn(); const { onLogin } = view(); await act(async () => {}); openForgot();
    await toPasswordStep();
    const [a, b] = Array.from(document.querySelectorAll('[data-testid="pwr-step-password"] input')) as HTMLInputElement[];
    fireEvent.change(a, { target: { value: PW } }); fireEvent.change(b, { target: { value: PW } });
    fireEvent.click(screen.getByTestId("pwr-save"));
    await screen.findByTestId("login-notice");
    expect(S.updateUser).toHaveBeenCalledWith({ password: PW });
    expect(S.signOut).toHaveBeenCalledWith({ scope: "global" });
    expect(onLogin).not.toHaveBeenCalled();
    expect(S.signInWithPassword).not.toHaveBeenCalled();
    expect(screen.queryByTestId("pwr-modal")).toBeNull();
    expect(screen.getByTestId("login-notice").textContent).toBe("Password changed. Please log in with your new password");
    expect((document.querySelector('input[name="username"]') as HTMLInputElement).value).toBe(EMAIL);
    expect((document.querySelector('input[name="password"]') as HTMLInputElement).value).toBe("");
  });
});

describe("leaving mid-flow", () => {
  it("closing after the code (before saving) signs that session out locally", async () => {
    flowOn(); view(); await act(async () => {}); openForgot();
    await toPasswordStep();
    fireEvent.click(screen.getByTestId("pwr-close"));
    await waitFor(() => expect(S.signOut).toHaveBeenCalledWith({ scope: "local" }));
    expect(screen.queryByTestId("pwr-modal")).toBeNull();
  });
  it("Back from the password step signs out locally and starts again at step 1", async () => {
    flowOn(); view(); await act(async () => {}); openForgot();
    await toPasswordStep();
    fireEvent.click(screen.getByTestId("pwr-back"));
    await waitFor(() => expect(S.signOut).toHaveBeenCalledWith({ scope: "local" }));
    expect(await screen.findByTestId("pwr-step-email")).toBeTruthy();
  });
  it("closing before any code → no sign-out call", async () => {
    flowOn(); view(); await act(async () => {}); openForgot();
    fireEvent.click(screen.getByTestId("pwr-close"));
    expect(S.signOut).not.toHaveBeenCalled();
  });
  it("Telegram link on every step", async () => {
    flowOn(); view(); await act(async () => {}); openForgot();
    expect(screen.getByTestId("pwr-telegram").textContent).toBe("Didn't get the code? Message us on Telegram");
    await toCodeStep(); expect(screen.getByTestId("pwr-telegram")).toBeTruthy();
    fireEvent.change(screen.getByTestId("pwr-code"), { target: { value: CODE } });
    await screen.findByTestId("pwr-step-password"); expect(screen.getByTestId("pwr-telegram")).toBeTruthy();
  });
});

describe("source pins", () => {
  const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
  it("nothing is logged or sent to analytics from the reset code files; no redirect link", () => {
    for (const f of ["../../adapters/resetCode.ts", "../../components/ResetCodeModal.tsx"]) {
      const s = src(f);
      expect(s).not.toMatch(/console\.|track\(|posthog/);
    }
    expect(src("../../adapters/resetCode.ts")).not.toMatch(/redirectTo/);
  });
  it("the old link-based PASSWORD_RECOVERY path is not in the served app (app.html not built; redesign never handles it)", () => {
    const input = /input:\s*\{[^}]*\}/.exec(src("../../../../vite.config.ts"))?.[0] ?? "";
    expect(input).toContain("redesign.html");
    expect(input).not.toMatch(/app\.html/);
    for (const f of ["../../RedesignApp.tsx", "../../adapters/useAuthSession.ts", "../../components/ResetCodeModal.tsx", "../Login.tsx"]) {
      expect(src(f)).not.toMatch(/PASSWORD_RECOVERY|recoveryMode|type=recovery/);
    }
  });
  it("reset_preview is never linked or shown anywhere in the app", () => {
    for (const f of ["../Login.tsx", "../../components/ResetCodeModal.tsx", "../../RedesignApp.tsx", "../../i18n/index.tsx"]) {
      expect(src(f)).not.toContain("reset_preview");
    }
  });
});
