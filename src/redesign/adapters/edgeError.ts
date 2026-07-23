// Surfacing the REAL error from a Supabase Edge Function call.
//
// supabase-js `functions.invoke` returns a FunctionsHttpError on any non-2xx
// response, whose `.message` is the useless generic wrapper
// ("Edge Function returned a non-2xx status code"). The ACTUAL server message —
// our functions return `{ success:false, error, code }` in the body — lives in
// `error.context`, which is the raw `Response`. This reads it so the UI shows
// the real failure (e.g. "auth deleteUserById failed after retries: …") and
// the machine `code`, instead of the wrapper. Genuine debuggability fix.
//
// It also accepts the `data` payload: some non-2xx paths (and any future change)
// may still deliver `{ success:false, error }` in `data` with no thrown error —
// that is checked first so a real message is never missed.

export interface EdgeError {
  message: string;
  code?: string;
  status?: number;
}

interface WithContext { context?: unknown }
interface BodyShape { error?: string; code?: string }

const GENERIC = "Edge Function returned a non-2xx status code";

// Reads the best available error message/code out of an invoke() result.
// `error` is the FunctionsHttpError (or null); `data` is the parsed body (or null).
export async function readEdgeError(error: unknown, data: unknown): Promise<EdgeError> {
  // 1. A structured body delivered via `data` (no thrown error path).
  const d = data as BodyShape | null;
  if (d && typeof d.error === "string" && d.error) return { message: d.error, code: d.code };

  // 2. FunctionsHttpError carries the Response in `.context`. Read its JSON body
  //    (clone so we never consume a body another caller might read).
  const ctx = (error as WithContext | null)?.context as Response | undefined;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = (await ctx.clone().json()) as BodyShape;
      if (body && typeof body.error === "string" && body.error) {
        return { message: body.error, code: body.code, status: ctx.status };
      }
    } catch {
      // body wasn't JSON — fall back to raw text
      try {
        const text = (await ctx.clone().text()).trim();
        if (text) return { message: text, status: ctx.status };
      } catch { /* context unreadable — fall through */ }
    }
  }

  // 3. Last resort: the error's own message, but never the generic wrapper alone.
  const msg = (error as { message?: string } | null)?.message;
  if (msg && msg !== GENERIC) return { message: msg };
  return { message: msg ? `${GENERIC} (no error body returned)` : "Edge function call failed" };
}
