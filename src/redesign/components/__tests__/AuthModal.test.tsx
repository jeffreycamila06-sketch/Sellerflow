// AuthModal — the web-landing pop-up wrapper. Proves: renders its child (Login/Signup),
// closes via ✕ button / backdrop / Esc, the inner card swallows clicks (no accidental
// close), and it overlays WITHOUT unmounting siblings (landing stays behind).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import AuthModal from "../AuthModal";
import Login from "../../screens/Login";
import Signup from "../../screens/Signup";
import { TProvider } from "../../i18n";

const noop = () => {};
const asyncOk = async () => ({ ok: true as const });

describe("AuthModal — landing auth pop-up wrapper", () => {
  it("renders its child content", () => {
    render(
      <AuthModal onClose={noop} closeLabel="Close">
        <div>MODAL-CHILD</div>
      </AuthModal>,
    );
    expect(screen.getByText("MODAL-CHILD")).toBeTruthy();
  });

  it("✕ button closes", () => {
    const onClose = vi.fn();
    render(
      <AuthModal onClose={onClose} closeLabel="Close">
        <div>x</div>
      </AuthModal>,
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("backdrop click closes; inner card click does NOT", () => {
    const onClose = vi.fn();
    render(
      <AuthModal onClose={onClose} closeLabel="Close">
        <div>inner</div>
      </AuthModal>,
    );
    // clicking the child (inside the card) must not close (stopPropagation)
    fireEvent.click(screen.getByText("inner"));
    expect(onClose).not.toHaveBeenCalled();
    // clicking the backdrop (role=dialog outer) closes
    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc key closes", () => {
    const onClose = vi.fn();
    render(
      <AuthModal onClose={onClose} closeLabel="Close">
        <div>x</div>
      </AuthModal>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("overlays WITHOUT unmounting siblings (landing stays mounted behind)", () => {
    render(
      <>
        <div>LANDING-BEHIND</div>
        <AuthModal onClose={noop} closeLabel="Close">
          <div>OVERLAY</div>
        </AuthModal>
      </>,
    );
    expect(screen.getByText("LANDING-BEHIND")).toBeTruthy(); // still in the DOM
    expect(screen.getByText("OVERLAY")).toBeTruthy();
  });

  it("renders the Login form inside the modal", () => {
    render(
      <TProvider lang="en">
        <AuthModal onClose={noop} closeLabel="Close">
          <Login onLogin={asyncOk} onSignup={noop} configured lang="en" langOpen={false} onToggleLang={noop} onPickLang={noop} />
        </AuthModal>
      </TProvider>,
    );
    expect(screen.getByText("Welcome back")).toBeTruthy(); // login-only string
  });

  it("renders the Signup form inside the modal", () => {
    render(
      <TProvider lang="en">
        <AuthModal onClose={noop} closeLabel="Close">
          <Signup onBack={noop} onLegal={noop} onRegister={asyncOk} />
        </AuthModal>
      </TProvider>,
    );
    expect(screen.getByText("SHOP PROFILE")).toBeTruthy(); // signup-only group label
  });

  it("renders the optional brand panel alongside the form (split-screen)", () => {
    render(
      <AuthModal onClose={noop} closeLabel="Close" brand={<div>BRAND-PANEL</div>}>
        <div>FORM</div>
      </AuthModal>,
    );
    expect(screen.getByText("BRAND-PANEL")).toBeTruthy();
    expect(screen.getByText("FORM")).toBeTruthy();
  });

  it("without a brand prop, only the form renders (single-column, unchanged)", () => {
    render(
      <AuthModal onClose={noop} closeLabel="Close">
        <div>FORM-ONLY</div>
      </AuthModal>,
    );
    expect(screen.getByText("FORM-ONLY")).toBeTruthy();
    expect(screen.queryByText("BRAND-PANEL")).toBeNull();
  });
});
