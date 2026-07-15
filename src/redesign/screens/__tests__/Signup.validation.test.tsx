// Signup form validation (required fields + Taiwan phone) at the COMPONENT level —
// pins the two audit vectors that matter: (2) you cannot submit without a valid
// phone (no bypass — invalid phone → translated error, onRegister NOT called), and
// the button is disabled until all six fields are filled ("kulang" signal). A valid
// form calls onRegister. Login is a separate component — untouched by this.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Signup from "../Signup";
import { TProvider } from "../../i18n";

// DOM input order: storeName, fullName, phone, email, password, confirm.
const IDX = { store: 0, owner: 1, phone: 2, email: 3, pw: 4, confirm: 5 };
function renderSignup(onRegister = vi.fn(async () => ({ ok: true }))) {
  const utils = render(
    <TProvider lang="en">
      <Signup onBack={() => {}} onLegal={() => {}} onRegister={onRegister} />
    </TProvider>,
  );
  const inputs = () => Array.from(utils.container.querySelectorAll("input"));
  const fill = (i: number, v: string) => fireEvent.change(inputs()[i], { target: { value: v } });
  const fillAll = (over: Partial<Record<keyof typeof IDX, string>> = {}) => {
    fill(IDX.store, over.store ?? "My Shop");
    fill(IDX.owner, over.owner ?? "Owner Name");
    fill(IDX.phone, over.phone ?? "0912345678");
    fill(IDX.email, over.email ?? "new@shop.com");
    fill(IDX.pw, over.pw ?? "secret1");
    fill(IDX.confirm, over.confirm ?? "secret1");
  };
  const button = () => screen.getByRole("button", { name: /create account/i }) as HTMLButtonElement;
  return { onRegister, fill, fillAll, button };
}

describe("Signup — required fields + phone validation", () => {
  it("button is DISABLED until all six fields are filled", () => {
    const s = renderSignup();
    expect(s.button().disabled).toBe(true);       // nothing filled
    s.fillAll({ phone: "" });                       // everything but phone
    expect(s.button().disabled).toBe(true);        // phone missing → still disabled
    s.fill(IDX.phone, "0912345678");
    expect(s.button().disabled).toBe(false);       // now complete
  });

  it("NO BYPASS: an invalid phone → translated error, onRegister NOT called", async () => {
    const s = renderSignup();
    s.fillAll({ phone: "12345" });                  // all filled → button enabled, but phone invalid
    expect(s.button().disabled).toBe(false);
    fireEvent.click(s.button());
    await waitFor(() => expect(screen.getByText(/valid Taiwan mobile/i)).toBeTruthy());
    expect(s.onRegister).not.toHaveBeenCalled();    // blocked before the network call
  });

  it("a bad Taiwan format (08…, wrong length) is also rejected", async () => {
    const s = renderSignup();
    s.fillAll({ phone: "0812345678" });             // 10 digits but not 09
    fireEvent.click(s.button());
    await waitFor(() => expect(screen.getByText(/valid Taiwan mobile/i)).toBeTruthy());
    expect(s.onRegister).not.toHaveBeenCalled();
  });

  it("REGRESSION (prod bug 2026-07-16): Jeff's exact '1234567890' → rejected, onRegister NOT called", async () => {
    // 10 digits but NOT 09-prefixed. Accepted in prod ONLY because a stale
    // pre-deploy bundle ran the old >=8-digit rule; the CURRENT code rejects it.
    const s = renderSignup();
    s.fillAll({ phone: "1234567890" });
    expect(s.button().disabled).toBe(false);        // all fields filled → button enabled
    fireEvent.click(s.button());
    await waitFor(() => expect(screen.getByText(/valid Taiwan mobile/i)).toBeTruthy());
    expect(s.onRegister).not.toHaveBeenCalled();     // blocked BEFORE any account create
  });

  it("a mismatched password → translated error, onRegister NOT called", async () => {
    const s = renderSignup();
    s.fillAll({ confirm: "different1" });
    fireEvent.click(s.button());
    await waitFor(() => expect(screen.getByText(/do not match/i)).toBeTruthy());
    expect(s.onRegister).not.toHaveBeenCalled();
  });

  it("a valid form (spaces/+886 normalized) calls onRegister", async () => {
    const s = renderSignup();
    s.fillAll({ phone: "0912 345 678" });           // spaces normalized, valid
    fireEvent.click(s.button());
    await waitFor(() => expect(s.onRegister).toHaveBeenCalledTimes(1));
    expect(s.onRegister).toHaveBeenCalledWith(expect.objectContaining({ phone: "0912 345 678", email: "new@shop.com" }));
  });

  it("NO Enter-key bypass: pressing Enter (invalid phone) never submits", async () => {
    const s = renderSignup();
    s.fillAll({ phone: "1234567890" });             // filled but invalid
    // There is no <form>, so Enter has no submit handler — it must NOT reach onRegister.
    const inputs = Array.from(document.querySelectorAll("input"));
    fireEvent.keyDown(inputs[IDX.phone], { key: "Enter", code: "Enter" });
    fireEvent.keyDown(inputs[IDX.pw], { key: "Enter", code: "Enter" });
    await new Promise((r) => setTimeout(r, 0));
    expect(s.onRegister).not.toHaveBeenCalled();    // Enter is not a submit/bypass path
  });
});
