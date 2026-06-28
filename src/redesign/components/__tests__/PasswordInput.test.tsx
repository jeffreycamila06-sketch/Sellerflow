// PasswordInput — the eye toggle flips the input between hidden/visible and the
// aria-label updates with state. Default = masked.
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PasswordInput from "../PasswordInput";
import { TProvider } from "../../i18n";

const renderPI = () =>
  render(
    <TProvider lang="en">
      <PasswordInput value="secret123" onChange={() => {}} placeholder="Your password" />
    </TProvider>,
  );

describe("PasswordInput show/hide toggle", () => {
  it("defaults to masked (type=password) with a 'Show password' toggle", () => {
    renderPI();
    const input = screen.getByPlaceholderText("Your password") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(screen.getByLabelText("Show password")).toBeTruthy();
  });

  it("tapping the eye reveals the value (type=text) and flips the aria-label", () => {
    renderPI();
    const input = screen.getByPlaceholderText("Your password") as HTMLInputElement;
    fireEvent.click(screen.getByLabelText("Show password"));
    expect(input.type).toBe("text");
    expect(screen.getByLabelText("Hide password")).toBeTruthy();
  });

  it("tapping again hides it (back to type=password)", () => {
    renderPI();
    const input = screen.getByPlaceholderText("Your password") as HTMLInputElement;
    fireEvent.click(screen.getByLabelText("Show password"));
    fireEvent.click(screen.getByLabelText("Hide password"));
    expect(input.type).toBe("password");
    expect(screen.getByLabelText("Show password")).toBeTruthy();
  });
});
