// Server-side credit orchestration (server/parcelCredits.js). server.js has no
// vitest harness, so the /admin/parcel-scan debit→scan→refund flow is extracted
// into runScanWithCredit and driven here with injected thunks (the
// broadcastTranslateServer.test.ts convention). Covers the money-critical route
// behaviors: debit-before-scan, 402 + no-scan on insufficient, REFUND only on a
// TECHNICAL failure, NO refund (debit stands) on a BAD-PHOTO failure, no refund
// on success, fail-closed on debit error, and isTechnicalFailure classification.
//
// The DB RPCs themselves (check_and_debit_credit's atomic guarded UPDATE
// returning insufficient_credits when balance < amount; refund_parcel_credit's
// GATE that a refund matches only the caller's own UNREFUNDED scan_debit;
// grant_parcel_credit's is_admin() gate) are plpgsql and can't run in vitest —
// they were verified LIVE via Supabase MCP (rolled-back smokes: debit 1 of 3 →
// ok bal 2; debit 5 → insufficient bal 2; refund a FAKE debit id → no_refundable_
// debit, nothing minted; refund a real debit with forged p_amount=999 → credits
// only 1; second refund of the same debit → no_refundable_debit; grant by a
// non-admin → RAISED 42501 forbidden).
import { describe, it, expect, vi } from "vitest";
import { runScanWithCredit, isTechnicalFailure, CREDIT_DEBIT_AMOUNT } from "../../../../server/parcelCredits.js";

const ok = { ok: true, fields: { name: "A" }, confidence: {} };

describe("isTechnicalFailure — refund set vs bad-photo (seller's fault)", () => {
  it("TECHNICAL (refund): network_error, any anthropic_http_*, anthropic_bad_json, scan_not_configured", () => {
    expect(isTechnicalFailure("network_error")).toBe(true);
    expect(isTechnicalFailure("anthropic_http_500")).toBe(true);
    expect(isTechnicalFailure("anthropic_http_429")).toBe(true);
    expect(isTechnicalFailure("anthropic_http_no_response")).toBe(true);
    expect(isTechnicalFailure("anthropic_bad_json")).toBe(true);
    expect(isTechnicalFailure("scan_not_configured")).toBe(true); // server misconfig, never the seller's fault
  });
  it("BAD PHOTO (no refund, debit stands): no_json_in_response, bad_json_in_response, model_refused, truncated", () => {
    expect(isTechnicalFailure("no_json_in_response")).toBe(false);
    expect(isTechnicalFailure("bad_json_in_response")).toBe(false);
    expect(isTechnicalFailure("model_refused")).toBe(false);
    expect(isTechnicalFailure("truncated")).toBe(false);
  });
  it("unknown / empty → not technical (default no-refund)", () => {
    expect(isTechnicalFailure("")).toBe(false);
    expect(isTechnicalFailure(undefined)).toBe(false);
    expect(isTechnicalFailure("something_new")).toBe(false);
  });
});

describe("runScanWithCredit — debit → scan → refund", () => {
  it("debit-before-scan: on insufficient_credits returns 402 and NEVER calls scan or refund", async () => {
    const scan = vi.fn(async () => ok);
    const refund = vi.fn(async () => ({ ok: true, balance: 1 }));
    const out = await runScanWithCredit({
      debit: async () => ({ ok: false, error: "insufficient_credits", balance: 0 }),
      scan, refund,
    });
    expect(out.status).toBe(402);
    expect(out.body).toEqual({ success: false, error: "insufficient_credits", balance: 0 });
    expect(out.scanned).toBe(false);
    expect(scan).not.toHaveBeenCalled();   // no Anthropic cost when the debit fails
    expect(refund).not.toHaveBeenCalled();
  });

  it("ordering proof: scan runs only AFTER the debit resolves", async () => {
    const order: string[] = [];
    const scan = vi.fn(async () => { order.push("scan"); return ok; });
    await runScanWithCredit({
      debit: async () => { order.push("debit"); return { ok: true, balance: 4 }; },
      scan,
      refund: async () => ({ ok: true, balance: 5 }),
    });
    expect(order).toEqual(["debit", "scan"]);
  });

  it("debit RPC throws → fail CLOSED (503 credit_unavailable), scan never called", async () => {
    const scan = vi.fn(async () => ok);
    const out = await runScanWithCredit({
      debit: async () => { throw new Error("network down"); },
      scan, refund: async () => ({ ok: true, balance: 1 }),
    });
    expect(out.status).toBe(503);
    expect(out.body).toEqual({ success: false, error: "credit_unavailable" });
    expect(out.scanned).toBe(false);
    expect(scan).not.toHaveBeenCalled();
  });

  it("successful scan → 200 fields + post-debit balance, NO refund", async () => {
    const refund = vi.fn(async () => ({ ok: true, balance: 3 }));
    const out = await runScanWithCredit({
      debit: async () => ({ ok: true, balance: 4, debit_id: "d1" }),
      scan: async () => ok,
      refund,
    });
    expect(out.status).toBe(200);
    expect(out.body).toEqual({ success: true, fields: { name: "A" }, confidence: {}, balance: 4 });
    expect(out.refunded).toBeNull();
    expect(refund).not.toHaveBeenCalled();  // a good scan must never refund
  });

  it("TECHNICAL failure → refund called WITH the debit_id, body carries the refunded balance", async () => {
    for (const code of ["network_error", "anthropic_http_500", "anthropic_bad_json"]) {
      const refund = vi.fn(async () => ({ ok: true, balance: 4 }));
      const out = await runScanWithCredit({
        debit: async () => ({ ok: true, balance: 3, debit_id: "debit-xyz" }),
        scan: async () => ({ ok: false, error: code }),
        refund,
      });
      expect(refund).toHaveBeenCalledTimes(1);
      expect(refund).toHaveBeenCalledWith("debit-xyz"); // the GATE matches this exact debit
      expect(out.status).toBe(502);
      expect(out.body).toEqual({ success: false, error: code, balance: 4 }); // refunded balance
      expect(out.refunded).toBe("ok");
    }
  });

  it("BAD-PHOTO failure → NO refund, debit STANDS, body carries the post-debit balance", async () => {
    for (const code of ["no_json_in_response", "model_refused", "truncated", "bad_json_in_response"]) {
      const refund = vi.fn(async () => ({ ok: true, balance: 4 }));
      const logs: string[] = [];
      const out = await runScanWithCredit({
        debit: async () => ({ ok: true, balance: 3, debit_id: "d1" }),
        scan: async () => ({ ok: false, error: code }),
        refund,
        log: (m) => logs.push(m),
      });
      expect(refund).not.toHaveBeenCalled();          // seller consumed a real scan
      expect(out.status).toBe(502);
      expect(out.body).toEqual({ success: false, error: code, balance: 3 }); // debit stands
      expect(out.refunded).toBeNull();
      expect(logs.some((l) => l.includes("no-refund (bad photo)") && l.includes(`code=${code}`))).toBe(true);
    }
  });

  it("a FAILED refund on a technical failure → refunded:'failed', money-owed logged, balance stays post-debit", async () => {
    const logs: string[] = [];
    const out = await runScanWithCredit({
      debit: async () => ({ ok: true, balance: 3, debit_id: "d1" }),
      scan: async () => ({ ok: false, error: "network_error" }),
      refund: async () => { throw new Error("refund rpc down"); },
      log: (m) => logs.push(m),
    });
    expect(out.status).toBe(502);
    expect(out.body).toEqual({ success: false, error: "network_error", balance: 3 }); // refund failed → debit still stands
    expect(out.refunded).toBe("failed");
    expect(logs.some((l) => l.includes("refund failed") && l.includes("money owed"))).toBe(true);
  });

  it("debits exactly one credit (CREDIT_DEBIT_AMOUNT)", () => {
    expect(CREDIT_DEBIT_AMOUNT).toBe(1);
  });
});
