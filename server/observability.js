// Crash safety + memory observability — PURE helpers (formatting / thresholds /
// snapshots) so vitest can cover them; server.js (no test harness) just wires the
// process handlers + the interval to these. No dependencies, no side effects here.
//
// Render Starter = 512 MB RAM, single instance. A process death takes every live
// relay with it, so the goal is VISIBILITY: log why we died + how many relays
// were lost, and warn BEFORE the box is full — not to keep a corrupted process
// alive.

export const MEMORY_LIMIT_MB = 512;      // Render Starter plan RAM
export const MEMORY_WARN_PCT = 0.75;     // warn at ~384 MB rss (before OOM)
export const MEMORY_LOG_INTERVAL_MS = 300000; // 5 min — light, not a hot loop

const MB = 1024 * 1024;
const toMb = (bytes) => Math.round((Number(bytes) || 0) / MB);

// rss as a fraction (0..1) of the plan limit. Guards a bad/zero limit → 0.
export function memoryPct(rssBytes, limitMb = MEMORY_LIMIT_MB) {
  const limitBytes = (Number(limitMb) || 0) * MB;
  if (limitBytes <= 0) return 0;
  return (Number(rssBytes) || 0) / limitBytes;
}

export function isMemoryWarn(rssBytes, limitMb = MEMORY_LIMIT_MB, warnPct = MEMORY_WARN_PCT) {
  return memoryPct(rssBytes, limitMb) >= warnPct;
}

// Compact snapshot for the /health/tiktok endpoint. `mem` = process.memoryUsage().
export function memorySnapshot(mem = {}, limitMb = MEMORY_LIMIT_MB) {
  const rss = Number(mem.rss) || 0;
  return {
    rssMb: toMb(rss),
    heapUsedMb: toMb(mem.heapUsed),
    limitMb,
    pctOfLimit: Math.round(memoryPct(rss, limitMb) * 100),
    warn: isMemoryWarn(rss, limitMb),
  };
}

// One-line periodic memory log. `mem` = process.memoryUsage(), relays = active
// relay count. Marked [MEM-WARN] past the threshold so it's greppable in Render.
export function formatMemoryLine(mem = {}, activeRelays = 0, limitMb = MEMORY_LIMIT_MB) {
  const rss = Number(mem.rss) || 0;
  const pct = Math.round(memoryPct(rss, limitMb) * 100);
  const tag = isMemoryWarn(rss, limitMb) ? "[MEM-WARN]" : "[MEM]";
  return `${tag} rss=${toMb(rss)}MB heapUsed=${toMb(mem.heapUsed)}MB relays=${activeRelays} (${pct}% of ${limitMb}MB)`;
}

// Crash log line — the ONE thing we must capture before dying: what kind, when,
// how many relays we just dropped, and the stack. err may be an Error or any
// thrown value. Kept single-string so it can't be split across log lines.
export function crashLogLine(kind, err, activeRelays = 0, at = new Date()) {
  const ts = (at instanceof Date ? at : new Date()).toISOString();
  const stack = err && err.stack ? String(err.stack) : String(err);
  return `[CRASH] ${kind} at ${ts} — ${activeRelays} live relay(s) lost. ${stack}`;
}

// Graceful-shutdown log line (SIGTERM). Same relay-loss visibility, non-fatal.
export function shutdownLogLine(activeRelays = 0, at = new Date()) {
  const ts = (at instanceof Date ? at : new Date()).toISOString();
  return `[SHUTDOWN] SIGTERM at ${ts} — closing; ${activeRelays} live relay(s) will drop (sellers re-Connect after restart).`;
}
