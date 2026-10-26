// Research probe (read-only, no login, no browser): poll the Shopee chat-room message endpoint
// for one or more lives in parallel from plain Node, exactly like the viewer page does, and log
// counts / timings / status codes. Never stores buyer data: at most 3 sample comments per live
// with usernames masked. Stops after --minutes (default 5).
//   node scripts/probes/shopee/poll.mjs --lives <share link|uid:<hostUid>|sessionId>[,…] [--minutes 5] [--cc ph] [--uuid-per-live]
import { randomUUID } from "node:crypto";
import { resolveSessionId, anySessionMeta } from "./resolve.mjs";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const args = Object.fromEntries(process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] && !all[i + 1].startsWith("--") ? all[i + 1] : "1"] : [])).filter((x) => x.length));
const lives = String(args.lives || "").split(",").map((s) => s.trim()).filter(Boolean);
const minutes = Number(args.minutes || 5);
const cc = args.cc || "ph";
const uuidPerLive = "uuid-per-live" in args;
if (!lives.length) { console.error("usage: poll.mjs --lives <id,id> [--minutes 5] [--cc ph] [--uuid-per-live]"); process.exit(2); }

const mask = (u) => { const s = String(u ?? ""); return s.length <= 2 ? "*".repeat(s.length || 1) : s[0] + "*".repeat(Math.max(1, s.length - 2)) + s[s.length - 1]; };
const sharedUuid = randomUUID();

async function pollLive(input) {
  const ids = await resolveSessionId(input);
  const meta = await anySessionMeta(ids, cc);
  const s = meta.body?.data?.session;
  const sessionId = s?.session_id ?? ids.sessionId ?? input;
  const log = (m) => console.log(`[${sessionId}] ${new Date().toISOString().slice(11, 19)} ${m}`);
  if (!s?.chatroom_id) { log(`${meta.route} API HTTP ${meta.status}: no chatroom_id (${JSON.stringify(meta.body).slice(0, 160)})`); return null; }
  log(`chatroom ${s.chatroom_id} status=${s.status} viewers=${s.viewer_count ?? s.member_cnt ?? "?"} (${meta.route} API ${meta.ms} ms, via ${ids.via})`);
  const uuid = uuidPerLive ? randomUUID() : sharedUuid;
  const stat = { sessionId, chatroom: s.chatroom_id, requests: 0, ok: 0, codes: {}, httpStatuses: {}, msgs: 0, msgTypes: {}, latencies: [], intervals: new Set(), samples: [], errors: 0, firstMsgAt: null, cookiesSeen: false };
  let timestamp = 0, interval = 3;
  const until = Date.now() + minutes * 60_000;
  while (Date.now() < until) {
    const t0 = Date.now();
    let r, body;
    try {
      r = await fetch(`https://chatroom-live.shopee.${cc}/api/v1/fetch/chatroom/${s.chatroom_id}/message?uuid=${uuid}&timestamp=${timestamp}&version=v2`, { headers: { "user-agent": UA, accept: "application/json", "content-type": "application/json", "client-info": "os=2;platform=9", "x-livestreaming-source": "shopee" } });
      body = await r.json();
    } catch (e) { stat.errors++; log(`fetch error ${String(e).slice(0, 100)}`); await new Promise((res) => setTimeout(res, interval * 1000)); continue; }
    const ms = Date.now() - t0;
    stat.requests++; stat.latencies.push(ms);
    stat.httpStatuses[r.status] = (stat.httpStatuses[r.status] || 0) + 1;
    if (r.headers.get("set-cookie")) stat.cookiesSeen = true;
    const rl = [...r.headers.entries()].filter(([k]) => /ratelimit|retry-after|x-sap|x-shopee/i.test(k));
    if (rl.length && stat.requests <= 2) log(`notable headers: ${JSON.stringify(rl)}`);
    stat.codes[body?.code] = (stat.codes[body?.code] || 0) + 1;
    if (r.status !== 200 || body?.code !== 0) { log(`HTTP ${r.status} code=${body?.code} msg=${body?.msg} (${ms} ms)`); if (r.status === 429 || r.status === 403) stat.blocked = (stat.blocked || 0) + 1; await new Promise((res) => setTimeout(res, Math.max(interval, 5) * 1000)); continue; }
    stat.ok++;
    const d = body.data || {};
    if (typeof d.poll_interval === "number") { interval = Math.max(2, d.poll_interval); stat.intervals.add(d.poll_interval); }
    if (typeof d.timestamp === "number") timestamp = d.timestamp;
    for (const kind of ["message", "e2e_message", "system"]) {
      const bucket = d[kind];
      const msgs = Array.isArray(bucket?.msgs) ? bucket.msgs : Array.isArray(bucket) ? bucket : [];
      if (!msgs.length) continue;
      stat.msgs += msgs.length; stat.msgTypes[kind] = (stat.msgTypes[kind] || 0) + msgs.length;
      if (!stat.firstMsgAt) stat.firstMsgAt = Date.now();
      for (const m of msgs) {
        const t = m?.type ?? m?.msg_type; stat.msgTypes[`type:${t}`] = (stat.msgTypes[`type:${t}`] || 0) + 1;
        if (stat.samples.length < 3) {
          const user = m?.nickname ?? m?.username ?? m?.user_name ?? m?.name ?? m?.from_user?.nickname ?? "";
          const text = m?.content ?? m?.text ?? m?.message ?? m?.msg ?? "";
          const ts = m?.timestamp ?? m?.ts ?? m?.create_time ?? null;
          stat.samples.push({ kind, type: t, user: mask(user), text: String(text).slice(0, 40), delayMs: typeof ts === "number" ? Date.now() - (ts > 1e12 ? ts : ts * 1000) : null, keys: Object.keys(m || {}).slice(0, 14) });
        }
      }
    }
    if (stat.requests % 20 === 0) log(`${stat.requests} polls, ${stat.msgs} msgs, last ${ms} ms, interval ${interval}s, ts=${timestamp}`);
    await new Promise((res) => setTimeout(res, interval * 1000));
  }
  return stat;
}

console.log(`polling ${lives.length} live(s) for ${minutes} min, uuid ${uuidPerLive ? "per live" : "shared"}, cc=${cc}`);
const stats = (await Promise.all(lives.map(pollLive))).filter(Boolean);
for (const s of stats) {
  const lat = s.latencies.sort((a, b) => a - b);
  const p = (q) => lat[Math.min(lat.length - 1, Math.floor(q * lat.length))];
  console.log(`\n== session ${s.sessionId} chatroom ${s.chatroom}: ${s.requests} polls in ${minutes} min (${(s.requests / minutes).toFixed(1)}/min), ok ${s.ok}, HTTP ${JSON.stringify(s.httpStatuses)}, codes ${JSON.stringify(s.codes)}, blocked ${s.blocked || 0}, errors ${s.errors}`);
  console.log(`   latency ms p50 ${p(0.5)} p90 ${p(0.9)} max ${lat[lat.length - 1]} | server poll_interval values ${[...s.intervals].join("/") || "none"} | cookies offered: ${s.cookiesSeen}`);
  console.log(`   messages ${s.msgs} ${JSON.stringify(s.msgTypes)} | samples (masked): ${JSON.stringify(s.samples)}`);
}
