// Item-5 containment (2026-07-23 audit finding). The self-delete path (mode "self")
// is reachable by any authenticated seller; the edge function's raw error can carry
// internal detail (table names, Postgres errors, GoTrue bodies, stack frames). This
// proves: a CODELESS failure (the raw 500) shows the generic localized string and
// NEVER the raw server text, while a KNOWN-SAFE guard code (protected_master) still
// surfaces its real message. Admin paths are untouched (they don't use the gate).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DeleteAccount from "../DeleteAccount";
import { TProvider, buildT } from "../../i18n";
import { isSafeDeleteCode, SAFE_DELETE_CODES } from "../../adapters/adminDelete";

const t = buildT("en") as Record<string, string>;
const EMAIL = "seller@example.com";
const RAW_INTERNAL = 'orders delete failed: column "orders.foo" does not exist';

function renderWith(onConfirm: () => Promise<{ ok: boolean; error?: string; code?: string }>) {
  render(<TProvider lang="en"><DeleteAccount email={EMAIL} onBack={() => {}} onConfirm={onConfirm} /></TProvider>);
  // arm: type the exact email, then click the confirm button
  fireEvent.change(screen.getByPlaceholderText(EMAIL), { target: { value: EMAIL } });
  fireEvent.click(screen.getByText(t.rd_del_confirm_btn));
}

describe("isSafeDeleteCode (pure gate)", () => {
  it("accepts only the four known guard codes", () => {
    expect([...SAFE_DELETE_CODES].sort()).toEqual(["not_found", "protected_admin", "protected_master", "self_delete"]);
    for (const c of ["self_delete", "protected_admin", "protected_master", "not_found"]) expect(isSafeDeleteCode(c)).toBe(true);
  });
  it("rejects a codeless failure and any unknown/server code", () => {
    expect(isSafeDeleteCode(undefined)).toBe(false);
    expect(isSafeDeleteCode("")).toBe(false);
    expect(isSafeDeleteCode("delete_failed")).toBe(false);
    expect(isSafeDeleteCode("orders delete failed")).toBe(false);
  });
});

describe("DeleteAccount — self-delete disclosure containment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("CODELESS 500 (raw internals) → shows the generic string, NOT the raw server text", async () => {
    renderWith(async () => ({ ok: false, error: RAW_INTERNAL, code: undefined }));
    await waitFor(() => expect(screen.getByText(new RegExp(t.rd_del_generic.slice(0, 20)))).toBeTruthy());
    // The raw internal detail must never reach the screen.
    expect(screen.queryByText(new RegExp("orders delete failed", "i"))).toBeNull();
    expect(screen.queryByText(/column .* does not exist/i)).toBeNull();
  });

  it("a stack-frame / GoTrue body style raw error is ALSO hidden when codeless", async () => {
    renderWith(async () => ({ ok: false, error: "auth deleteUser failed after retries: status=500 body={\"code\":\"unexpected_failure\"} stack=/tmp/user_fn_.../source/index.ts:142", code: undefined }));
    await waitFor(() => expect(screen.getByText(new RegExp(t.rd_del_generic.slice(0, 20)))).toBeTruthy());
    expect(screen.queryByText(/user_fn_|unexpected_failure|deleteUser failed/i)).toBeNull();
  });

  it("KNOWN-SAFE guard code (protected_master) → surfaces its REAL message", async () => {
    const guardMsg = "Master accounts can't self-delete — please contact support.";
    renderWith(async () => ({ ok: false, error: guardMsg, code: "protected_master" }));
    await waitFor(() => expect(screen.getByText(new RegExp("Master accounts can't self-delete"))).toBeTruthy());
    // and NOT the generic string
    expect(screen.queryByText(new RegExp(t.rd_del_generic.slice(0, 20)))).toBeNull();
  });

  it("rd_del_generic is filled in all 7 languages", () => {
    for (const l of ["en", "fil", "zh", "zh-TW", "vi", "th", "id"]) {
      const tt = buildT(l) as Record<string, string>;
      expect((tt.rd_del_generic || "").trim().length).toBeGreaterThan(0);
    }
  });
});
