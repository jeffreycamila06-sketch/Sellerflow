// Login save-password fix: the credential inputs live in a real <form onSubmit> with
// name + autoComplete on both fields — the shape mobile password managers need to
// offer "Save password?". Also pins EXACTLY ONE submit path (no double onLogin).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TProvider } from "../../i18n";
import Login from "../Login";

function renderLogin(onLogin = vi.fn(async () => ({ ok: true }))) {
  render(
    <TProvider lang="en">
      <Login
        onLogin={onLogin}
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
  return { onLogin, email, password, form };
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
