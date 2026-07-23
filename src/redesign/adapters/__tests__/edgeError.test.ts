// Task 1 regression: a FunctionsHttpError (what supabase-js returns for a non-2xx
// edge response) must yield the REAL server message/code from error.context —
// NOT the generic "non-2xx status code" wrapper that made every admin delete
// undiagnosable in production.
import { describe, it, expect } from "vitest";
import { readEdgeError } from "../edgeError";

const GENERIC = "Edge Function returned a non-2xx status code";

// Minimal FunctionsHttpError stand-in: supabase-js attaches the raw Response as
// `.context` and sets the generic string as `.message`.
function httpError(status: number, body: unknown): { name: string; message: string; context: Response } {
  return {
    name: "FunctionsHttpError",
    message: GENERIC,
    context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
  };
}

describe("readEdgeError — surfaces the real edge-function error", () => {
  it("reads {error,code} from the FunctionsHttpError context body (not the wrapper)", async () => {
    const err = httpError(500, { success: false, error: "auth deleteUserById failed after retries: boom", code: undefined });
    const e = await readEdgeError(err, null);
    expect(e.message).toBe("auth deleteUserById failed after retries: boom");
    expect(e.message).not.toBe(GENERIC);
    expect(e.status).toBe(500);
  });

  it("carries the machine code through", async () => {
    const err = httpError(400, { success: false, error: "Cannot delete an admin account.", code: "protected_admin" });
    const e = await readEdgeError(err, null);
    expect(e.message).toBe("Cannot delete an admin account.");
    expect(e.code).toBe("protected_admin");
  });

  it("prefers a structured `data` body when present (no thrown error path)", async () => {
    const e = await readEdgeError(null, { success: false, error: "email_required" });
    expect(e.message).toBe("email_required");
  });

  it("falls back to raw text when the context body is not JSON", async () => {
    const err = { name: "FunctionsHttpError", message: GENERIC, context: new Response("Boom plain text", { status: 502 }) };
    const e = await readEdgeError(err, null);
    expect(e.message).toBe("Boom plain text");
    expect(e.status).toBe(502);
  });

  it("never returns the bare generic wrapper when no body is available", async () => {
    const err = { name: "FunctionsHttpError", message: GENERIC, context: new Response("", { status: 500 }) };
    const e = await readEdgeError(err, null);
    expect(e.message).not.toBe(GENERIC);           // must be annotated, not the bare wrapper
    expect(e.message).toContain("no error body");
  });

  it("uses a non-generic error.message directly when there is no context", async () => {
    const e = await readEdgeError({ message: "Failed to send a request to the Edge Function" }, null);
    expect(e.message).toBe("Failed to send a request to the Edge Function");
  });
});
