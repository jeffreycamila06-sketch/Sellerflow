// Build 11 (M8) — the LAST middleware, mounted after every route. Express's own error page
// prints the full program trace whenever NODE_ENV is not "production" (a broken JSON body was
// enough). This one never does, whatever NODE_ENV is: the status stays (4xx kept, anything
// else 500), the body is fixed, and the detail goes to the server log only.
export function finalErrorHandler({ log = console.error } = {}) {
  // Express spots an error handler by its 4 arguments.
  return (err, req, res, next) => {
    const s = Number(err && (err.status || err.statusCode));
    const status = s >= 400 && s < 500 ? s : 500;
    try {
      log(`[HTTP-ERR] ${req.method} ${req.path} ${status} ${String((err && (err.type || err.message)) || err).slice(0, 200)}`);
    } catch { /* logging must never break the answer */ }
    // Answer already started: Express's own handler then only closes the connection (no page).
    if (res.headersSent) return next(err);
    res.status(status).json({ ok: false, error: status < 500 ? "bad_request" : "server_error" });
  };
}
