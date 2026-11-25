// The Telegram texts of the server-capacity alarms (Jeff 2026-11-24) — Taglish, NUMBERS ONLY.
// PURE. Every text is built from whole numbers that are checked first; a value of any other kind gives ""
// (nothing is sent). There is no way to pass a name, an email, a token or an id through here.
//   mem_warning   ⚠️  60 % of the memory limit
//   mem_danger    🔴 75 %
//   mem_ok        ✅ back under the line
//   restart       🔴 the last run did not end cleanly
// (The database-connections alarm is sent by the database itself: sql/215.)
const isCount = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

export const LIVE_PLATFORMS = [["tiktok", "TikTok"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["shopee", "Shopee"]];

/** "41 TikTok" / "41 TikTok, 3 Facebook, 2 Shopee" — TikTok always, the others only when not 0. "" = bad input. */
export function livesText(lives) {
  if (!lives || typeof lives !== "object") return "";
  const parts = [];
  for (const [key, label] of LIVE_PLATFORMS) {
    const n = own(lives, key) ? lives[key] : 0;
    if (!isCount(n, 100000)) return "";
    if (key === "tiktok" || n > 0) parts.push(`${n} ${label}`);
  }
  return parts.join(", ");
}

/** total of the four counts, or -1 on bad input */
export function livesTotal(lives) {
  if (!lives || typeof lives !== "object") return -1;
  let sum = 0;
  for (const [key] of LIVE_PLATFORMS) {
    const n = own(lives, key) ? lives[key] : 0;
    if (!isCount(n, 100000)) return -1;
    sum += n;
  }
  return sum;
}

const memOk = (v) => v && typeof v === "object" && isCount(v.pct, 999) && isCount(v.usedMb, 1000000) && isCount(v.limitMb, 1000000) && v.limitMb > 0;

export const CAPACITY_TEXTS = {
  mem_warning(v) {
    const lives = memOk(v) ? livesText(v.lives) : "";
    if (!lives) return "";
    return [
      "⚠️ SellerFlowLive server",
      `Memory: ${v.pct}% (${v.usedMb} MB sa ${v.limitMb} MB)`,
      `Naka-live ngayon: ${lives}`,
      "Wala pang problema, pero sumisikip na.",
    ].join("\n");
  },
  mem_danger(v) {
    const lives = memOk(v) ? livesText(v.lives) : "";
    if (!lives) return "";
    return [
      "🔴 SellerFlowLive server — DELIKADO",
      `Memory: ${v.pct}% (${v.usedMb} MB sa ${v.limitMb} MB)`,
      `Naka-live ngayon: ${lives}`,
      "Kapag napuno ito, magre-restart ang server at mapuputol ang lahat ng live.",
      "Gawin: itaas ang plan sa Render.",
    ].join("\n");
  },
  mem_ok(v) {
    const lives = v && typeof v === "object" && isCount(v.pct, 999) ? livesText(v.lives) : "";
    if (!lives) return "";
    return ["✅ SellerFlowLive server — ok na ulit", `Memory: ${v.pct}%. Naka-live: ${lives}.`].join("\n");
  },
  // lives = how many lives the run(s) that died were carrying; times = how many runs died (1 = the usual case);
  // lastPct = the memory of the last heartbeat before it died (-1 = not known → that line is left out).
  restart(v) {
    if (!v || typeof v !== "object" || !isCount(v.lives, 1000000) || !isCount(v.times, 1000) || v.times < 1) return "";
    const lastPct = own(v, "lastPct") ? v.lastPct : -1;
    if (lastPct !== -1 && !isCount(lastPct, 999)) return "";
    const lines = [
      "🔴 SellerFlowLive server — NAG-RESTART",
      `Naputol: ${v.lives} live. Kailangang mag-Connect ulit ang mga seller.`,
    ];
    if (v.times > 1) lines.push(`Nag-restart nang ${v.times} beses.`);
    if (lastPct >= 0) lines.push(`Huling memory bago naputol: ${lastPct}%.`);
    return lines.join("\n");
  },
};
