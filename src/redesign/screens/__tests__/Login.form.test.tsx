// Login save-password fix: the credential inputs live in a real <form onSubmit> with
// name + autoComplete on both fields — the shape mobile password managers need to
// offer "Save password?". Also pins EXACTLY ONE submit path (no double onLogin).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import Login from "../Login";

function renderLogin(
  onLogin = vi.fn(async () => ({ ok: true })),
  onGoogle: (() => Promise<{ ok: boolean; error?: string }>) | undefined = undefined,
) {
  const { container } = render(
    <TProvider lang="en">
      <Login
        onLogin={onLogin}
        onGoogle={onGoogle}
        onSignup={vi.fn()}
        configured={true}
        lang="en"
        langOpen={false}
        onToggleLang={vi.fn()}
        onPickLang={vi.fn()}
      />
    </TProvider>,
  );
  const email = document.querySelector('input[name="username"]') as HTMLInputElement;
  const password = document.querySelector('input[name="password"]') as HTMLInputElement;
  const form = email.closest("form") as HTMLFormElement;
  return { onLogin, email, password, form, container };
}

describe("Login — password-manager form shape", () => {
  it("email + password are inside ONE <form>, with name + autoComplete (save-password shape)", () => {
    const { email, password, form } = renderLogin();
    expect(form).toBeTruthy();
    expect(email.getAttribute("autocomplete")).toBe("username");
    expect(email.getAttribute("name")).toBe("username");
    // Password field is a real <input type=password> carrying the pairing attrs.
    expect(password.getAttribute("type")).toBe("password");
    expect(password.getAttribute("autocomplete")).toBe("current-password");
    expect(password.getAttribute("name")).toBe("password");
    // Both fields belong to the SAME form (so the manager pairs them).
    expect(email.closest("form")).toBe(form);
    expect(password.closest("form")).toBe(form);
  });

  it("form uses display:contents so the flex-column layout is visually unchanged", () => {
    const { form } = renderLogin();
    expect(form.style.display).toBe("contents");
  });

  it("the login button is type=submit (fires the form, not a separate onClick)", () => {
    renderLogin();
    const btn = screen.getByRole("button", { name: /log in|logg/i });
    expect(btn.getAttribute("type")).toBe("submit");
  });
});

describe("Login — exactly one submit path", () => {
  it("clicking the submit button calls onLogin exactly ONCE (no onClick+onSubmit double-fire)", async () => {
    const { onLogin, email, password } = renderLogin();
    fireEvent.change(email, { target: { value: "seller@example.com" } });
    fireEvent.change(password, { target: { value: "secret123" } });
    const btn = screen.getByRole("button", { name: /log in|logg/i });
    fireEvent.click(btn);
    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
    expect(onLogin).toHaveBeenCalledWith("seller@example.com", "secret123");
  });

  it("submitting the form (Enter path) calls onLogin exactly ONCE and prevents default nav", async () => {
    const { onLogin, email, password, form } = renderLogin();
    fireEvent.change(email, { target: { value: "seller@example.com" } });
    fireEvent.change(password, { target: { value: "secret123" } });
    // fireEvent.submit models the native form submission that Enter triggers.
    const evt = fireEvent.submit(form);
    expect(evt).toBe(false); // preventDefault was called → SPA, no page navigation
    await waitFor(() => expect(onLogin).toHaveBeenCalledTimes(1));
  });

  it("empty credentials → onLogin NOT called (validation preserved)", () => {
    const { onLogin, form } = renderLogin();
    fireEvent.submit(form);
    expect(onLogin).not.toHaveBeenCalled();
  });
});

describe("Login — Continue with Google", () => {
  it("no onGoogle → no Google button (backward-compatible)", () => {
    renderLogin(); // onGoogle omitted
    expect(screen.queryByText(/continue with google/i)).toBeNull();
  });

  it("with onGoogle → renders the button, the official 4-color G, and an 'or' divider", () => {
    const onGoogle = vi.fn(async () => ({ ok: true }));
    const { container } = renderLogin(vi.fn(async () => ({ ok: true })), onGoogle);
    const gbtn = screen.getByRole("button", { name: /continue with google/i });
    expect(gbtn).toBeTruthy();
    // Google button is NEUTRAL (theme tokens, not the accent) and light/dark aware.
    expect(gbtn.style.background).toContain("var(--surface)");
    expect(gbtn.style.border).toContain("var(--border-strong)");
    expect(gbtn.style.color).toContain("var(--text)");
    // Official Google G = all four brand colors present, unaltered, square viewBox.
    const svg = gbtn.querySelector("svg")!;
    expect(svg.getAttribute("viewBox")).toBe("0 0 48 48"); // aspect ratio preserved
    const fills = Array.from(svg.querySelectorAll("path")).map((p) => p.getAttribute("fill"));
    expect(fills).toEqual(expect.arrayContaining(["#EA4335", "#4285F4", "#FBBC05", "#34A853"]));
    // 'or' divider text present.
    expect(screen.getByText("or")).toBeTruthy();
    expect(container).toBeTruthy();
  });

  it("clicking Google calls onGoogle exactly once (does NOT call onLogin)", async () => {
    const onGoogle = vi.fn(async () => ({ ok: true }));
    const { onLogin } = renderLogin(vi.fn(async () => ({ ok: true })), onGoogle);
    fireEvent.click(screen.getByRole("button", { name: /continue with google/i }));
    await waitFor(() => expect(onGoogle).toHaveBeenCalledTimes(1));
    expect(onLogin).not.toHaveBeenCalled();
  });

  it("the Google button is type=button (never submits the login form)", () => {
    renderLogin(vi.fn(async () => ({ ok: true })), vi.fn(async () => ({ ok: true })));
    const gbtn = screen.getByRole("button", { name: /continue with google/i });
    expect(gbtn.getAttribute("type")).toBe("button");
  });
});
