// Sign-up "Invite code (optional)" (sql/165): live Code found / Not found, and it NEVER blocks the
// sign-up — empty or wrong, the Create account button and the submit behave exactly the same.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const rpc = vi.fn();
vi.mock("../../../supabase", () => ({ isSupabaseConfigured: true, supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock("../../adapters/useGeoCountry", () => ({ useGeoCountry: () => null }));

import Signup from "../Signup";
import { TProvider } from "../../i18n";

const setup = () => {
  const onRegister = vi.fn(async () => ({ ok: true }));
  render(<TProvider lang="en"><Signup onBack={() => {}} onLegal={() => {}} onRegister={onRegister} /></TProvider>);
  const c = document.querySelectorAll("input");
  // storeName, fullName, phone (CountryPhoneField), email, password, confirm, invite
  fireEvent.change(c[0], { target: { value: "Shop" } });
  fireEvent.change(c[1], { target: { value: "Owner" } });
  fireEvent.change(screen.getByTestId("phone-input"), { target: { value: "0912345678" } });
  const email = Array.from(c).find((i) => i.getAttribute("autocomplete") === "email")!;
  fireEvent.change(email, { target: { value: "a@b.com" } });
  const pw = Array.from(document.querySelectorAll("input")).filter((i) => i.getAttribute("autocomplete") === "new-password");
  fireEvent.change(pw[0], { target: { value: "secret1" } });
  fireEvent.change(pw[1], { target: { value: "secret1" } });
  return onRegister;
};
const createBtn = () => screen.getAllByRole("button").find((b) => /^Create account$/.test(b.textContent || ""))! as HTMLButtonElement;

beforeEach(() => { rpc.mockReset(); });

describe("Signup invite code", () => {
  it("empty → Create account works, no inviteCode sent", async () => {
    const onRegister = setup();
    expect(createBtn().disabled).toBe(false);
    fireEvent.click(createBtn());
    await waitFor(() => expect(onRegister).toHaveBeenCalledTimes(1));
    expect((onRegister.mock.calls[0] as unknown[])[0]).not.toHaveProperty("inviteCode");
  });

  it("found → 'Code found ✓', code sent uppercase", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const onRegister = setup();
    fireEvent.change(screen.getByTestId("su-invite"), { target: { value: "budgetukay" } });
    await waitFor(() => expect(screen.getByTestId("su-invite-state").textContent).toBe("Code found ✓"), { timeout: 2000 });
    fireEvent.click(createBtn());
    await waitFor(() => expect(onRegister).toHaveBeenCalledTimes(1));
    expect((onRegister.mock.calls[0] as unknown[])[0]).toMatchObject({ inviteCode: "BUDGETUKAY" });
  });

  it("full-width code typed on a Chinese keyboard → plain letters, sent normalised", async () => {
    rpc.mockResolvedValue({ data: true, error: null });
    const onRegister = setup();
    fireEvent.change(screen.getByTestId("su-invite"), { target: { value: "ｂｕｄｇｅｔｕｋａｙ" } });
    expect((screen.getByTestId("su-invite") as HTMLInputElement).value).toBe("BUDGETUKAY");
    fireEvent.click(createBtn());
    await waitFor(() => expect(onRegister).toHaveBeenCalledTimes(1));
    expect((onRegister.mock.calls[0] as unknown[])[0]).toMatchObject({ inviteCode: "BUDGETUKAY" });
  });

  it("WRONG code → 'Code not found' but Create account still works", async () => {
    rpc.mockResolvedValue({ data: false, error: null });
    const onRegister = setup();
    fireEvent.change(screen.getByTestId("su-invite"), { target: { value: "nope99" } });
    await waitFor(() => expect(screen.getByTestId("su-invite-state").textContent).toBe("Code not found"), { timeout: 2000 });
    expect(createBtn().disabled).toBe(false);
    fireEvent.click(createBtn());
    await waitFor(() => expect(onRegister).toHaveBeenCalledTimes(1));
  });

  it("the check failing (database without sql/165) → just the hint, sign-up unaffected", async () => {
    rpc.mockRejectedValue(new Error("offline"));
    setup();
    fireEvent.change(screen.getByTestId("su-invite"), { target: { value: "ABCD12" } });
    await waitFor(() => expect(screen.getByTestId("su-invite-state").textContent).toMatch(/You can leave this empty/), { timeout: 2000 });
    expect(createBtn().disabled).toBe(false);
  });

  it("box label says optional; no link, no ?ref anywhere", () => {
    setup();
    expect(screen.getByText("Invite code (optional)")).toBeTruthy();
    expect(document.body.innerHTML).not.toMatch(/\?ref=/);
  });
});
