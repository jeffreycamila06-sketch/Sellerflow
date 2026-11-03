// Nov 3, 2026 — after a "connection limit" answer the server benches the account for a short
// cooldown (2 min default, header-driven up to 10). Instead of asking the seller to tap again,
// the app retries ONCE when that cooldown ends. One pending retry at a time; a manual tap or
// Disconnect cancels it; the retried attempt never schedules another (no loop). Pure timer
// holder — the delay math lives in connect.ts (cooldownRetryDelayMs).
export interface CooldownRetry {
  schedule(account: string, delayMs: number, fn: () => void): void;
  cancel(): void;
  pending(): string | null;
}

export function createCooldownRetry(): CooldownRetry {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let account: string | null = null;
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; account = null; };
  return {
    schedule(acct, delayMs, fn) {
      cancel();
      account = acct;
      timer = setTimeout(() => { timer = null; account = null; fn(); }, Math.max(0, delayMs));
    },
    cancel,
    pending: () => account,
  };
}

// PURE: may the scheduled retry fire now? Only when TikTok is still not live, no OTHER platform
// went live meanwhile (Facebook / Instagram / Shopee — one platform at a time), and the server
// says the session is still running and is TikTok's (or has no platform stamped yet).
export interface RetryContext { ttLive: boolean; otherLive: boolean; session: { running: boolean; platform: string | null } }
export function retryAllowed(c: RetryContext): boolean {
  if (c.ttLive || c.otherLive) return false;
  if (!c.session.running) return false;
  return c.session.platform === null || c.session.platform === "TikTok";
}
