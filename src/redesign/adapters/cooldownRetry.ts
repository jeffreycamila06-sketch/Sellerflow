// Nov 3, 2026 — after a "connection limit" answer the server benches the account for a short
// cooldown (2 min default, header-driven up to 10). Instead of asking the seller to tap again,
// the app retries ONCE when that cooldown ends. One pending retry at a time; a manual tap or
// Disconnect cancels it; the retried attempt never schedules another (no loop). Pure timer
// holder — the delay math lives in connect.ts (cooldownRetryDelayMs).
// GENERATION: schedule() and cancel() bump a counter; the callback gets the generation it was
// scheduled under and must re-check isCurrent(gen) after its own await (the session check)
// before connecting — a manual tap / Disconnect / account switch in that moment wins (no double connect).
export interface CooldownRetry {
  schedule(account: string, delayMs: number, fn: (gen: number) => void): void;
  cancel(): void;
  pending(): string | null;
  isCurrent(gen: number): boolean;
}

export function createCooldownRetry(): CooldownRetry {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let account: string | null = null;
  let generation = 0;
  const cancel = () => { generation += 1; if (timer) clearTimeout(timer); timer = null; account = null; };
  return {
    schedule(acct, delayMs, fn) {
      cancel();                                   // bumps the generation too
      const gen = generation;
      account = acct;
      timer = setTimeout(() => { timer = null; account = null; fn(gen); }, Math.max(0, delayMs));
    },
    cancel,
    pending: () => account,
    isCurrent: (gen) => gen === generation,
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
