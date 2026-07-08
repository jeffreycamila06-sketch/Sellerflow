// Open an external URL the SAME proven way the working Settings Telegram
// redirects do (Support.tsx / Subscription.tsx): a real
// <a target="_blank" rel="noreferrer"> click. The Capacitor WKWebView shell
// handles that on iOS, whereas window.open() from JS is SILENTLY BLOCKED there
// (the expiry-modal "slide completes but Telegram never opens" bug).
//
// ⚠️ Call this SYNCHRONOUSLY inside the user-gesture handler (the slide pointerup
// → onComplete chain) — no awaits/timeouts before it — so iOS keeps the gesture
// context that authorizes opening an external target.
export function openExternalLink(url: string): void {
  try {
    if (typeof document === "undefined") return;
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noreferrer";
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch {
    /* last-ditch: navigate the current context (desktop browsers) */
    try { window.location.href = url; } catch { /* */ }
  }
}
