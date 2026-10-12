// Socket.io input hardening. A malformed socket message must never crash the
// server: a throw inside a socket.io handler surfaces on process.nextTick as an
// uncaughtException, and a rejected io.use promise as an unhandledRejection —
// both end in handleFatal → process.exit(1), dropping every seller. Pure
// helpers so the guards are unit-testable (server.js has no vitest harness).

/** Any payload → a plain object (null / number / string / array → {}). */
export function socketPayload(payload) {
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
}

/** A string field of a normalized payload; anything else → "". */
export function strField(p, key) {
  const v = p ? p[key] : undefined;
  return typeof v === "string" ? v : "";
}

/** The handshake token, string only (an object/number token → ""). */
export function socketToken(socket) {
  const t = socket && socket.handshake && socket.handshake.auth ? socket.handshake.auth.token : undefined;
  return typeof t === "string" ? t : "";
}

/**
 * Wrap a socket.on handler: the body always gets a plain object and any throw
 * is logged as one short line (event name only — never payload contents).
 */
export function safeSocketHandler(event, body) {
  return (payload) => {
    try {
      body(socketPayload(payload));
    } catch {
      console.warn(`[SOCKET] ${event} handler failed`);
    }
  };
}

/** Wrap an io.use middleware: any throw/rejection → next(Error("unauthorized")). */
export function safeSocketMiddleware(body) {
  return async (socket, next) => {
    let called = false;
    const once = (err) => { if (called) return; called = true; next(err); };
    try {
      await body(socket, once);
    } catch {
      console.warn("[SOCKET] auth middleware failed");
      once(new Error("unauthorized"));
    }
  };
}
