// Logout = a FULL app reset (audit Oct 14, item 1). Signing out used to only flip the screen to
// login, so everything held in memory — the live feed, the session's buyers/orders, report
// caches, Buyer Alert data, products — was still there for the NEXT account on the same device
// (seller B could see and even 1-Click seller A's comments). A full page reload is the only
// reset that cannot miss a piece of state, so every way out of a signed-in session ends in one.
//
// Reload target = the same page and query, without the hash: the phone shells carry ?apk / ?ios
// in the URL, and dropping them would show a phone the web landing instead of the login.

/** How long a sign-out may take before we reload anyway (a dead network must not block it). */
export const SIGN_OUT_TIMEOUT_MS = 4000;

export function reloadTarget(loc: Pick<Location, "pathname" | "search"> = window.location): string {
  return `${loc.pathname || "/"}${loc.search || ""}`;
}

/** The full reset. Exported as an object member so tests can replace it. */
export const appReload = {
  run(): void {
    if (typeof window === "undefined") return;
    window.location.replace(reloadTarget());
  },
};

/** Await the sign-out (at most timeoutMs; a failure counts as done), then reload. */
export async function signOutAndReload(signOut: () => Promise<unknown>, timeoutMs = SIGN_OUT_TIMEOUT_MS): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.resolve().then(signOut).catch(() => undefined),
      new Promise((r) => { timer = setTimeout(r, timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  appReload.run();
}

/** A signed-in session ended (logout, account deleted, session expired, logout in another tab). */
export const sessionEnded = (prev: string | null, next: string): boolean => prev === "authed" && next === "anon";
