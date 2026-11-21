// SHOPEE LIVE — DIAGNOSTIC COUNTERS (2026-11-20, log only). Question: do other viewers' comments reach the
// share-link reader (server/shopeeLiveLink.js) at all, or do they arrive and get dropped by our parsing?
// One summary line per poller every 60 s, plus one at once the first time a new message shape is seen, and one
// when the poller stops:
//   [SHOPEE-DIAG] seller=<id> polls=<n> msgs_message=<n> msgs_e2e=<n> msgs_system=<n> types=<101:n,…>
//     content=json:n,string:n,object:n,other:n from_host=<n> from_others=<n> from_nouid=<n> kept=<n>
//     dropped_notext=<n> dropped_dupe=<n> dupe_collide=<n> keys_unknown=<field names | ->
//     kept_100=<n> keys_100=<field paths of each type-100 content shape | ->
// Counts are since the poller started. types / content / from_* / kept / dropped_* cover the messages the reader
// reads (the "message" and "e2e_message" lists); msgs_system counts the "system" list, which the reader never reads.
// from_host = the sender uid equals the live host's uid (compared in memory, never printed).
// dupe_collide = a message dropped as a repeat whose id was first seen on a DIFFERENT message (other sender or text).
// kept_100 = kept messages of content type 100 (another viewer's comment, 2026-11-21). keys_100 = the field PATHS inside
// the content JSON of every distinct type-100 shape seen (kept or dropped), names only, shapes split by "|"; a new
// type-100 shape writes a line at once (its own budget of DIAG_100_SHAPES_MAX, apart from the other shape lines).
// The line never holds comment text, a name, a username, a uid, an avatar, a link, a chatroom id or a token:
// only counts, small type numbers and JSON field NAMES (cleaned: ≤ 24 characters, no 4+ digit runs; an object with
// more than 12 unknown field names is a map keyed by ids or names → "many:<n>" only).
// Nothing here changes what the reader does: it only reads the objects the reader already has.

export const DIAG_EVERY_MS = 60 * 1000;
export const DIAG_SHAPE_LINES_MAX = 10;   // "new shape" lines per poller (the 60 s line still comes after)
export const DIAG_TYPES_MAX = 12;         // distinct type keys kept; the rest are counted as "more"
export const DIAG_KEYS_MAX = 12;
export const DIAG_SEEN_MAX = 5000;        // = the reader's DEDUPE_CAP
export const DIAG_100_SHAPES_MAX = 4;     // distinct type-100 content shapes listed (more = "+<n>" at the end)
export const DIAG_PATHS_MAX = 24;         // field paths listed per shape (more = "+<n>")
export const DIAG_PATH_DEPTH = 4;         // how deep into the content JSON the walk goes
// the shapes seen in the research run (scripts/probes/shopee, 2026-10-27, TW)
export const KNOWN_MSG_KEYS = ["id", "uid", "nickname", "display_name", "avatar", "content", "ts", "privacy_type"];
export const KNOWN_DATA_KEYS = ["message", "e2e_message", "system", "timestamp", "poll_interval"];
export const DIAG_BUCKETS = ["message", "e2e_message", "system"];

/** The same walk as parseChatBatches (shopeeLiveLink.js) for one bucket: the msgs it would read, same order. Pure. */
export function bucketMsgs(d, kind) {
  const b = d && typeof d === "object" ? d[kind] : undefined;
  const batches = Array.isArray(b) ? b : b && typeof b === "object" && Object.keys(b).length ? [b] : [];
  const out = [];
  for (const batch of batches) {
    const msgs = Array.isArray(batch && batch.msgs) ? batch.msgs : Array.isArray(batch) ? batch : [];
    for (const m of msgs) if (m && typeof m === "object") out.push(m);
  }
  return out;
}

/** A field NAME as it may be logged: letters / digits / _ (first a letter or _), ≤ 24 long, no run of 4+ digits; else "?". Pure. */
export function safeKeyName(k) {
  const s = String(k ?? "");
  return /^[A-Za-z_][A-Za-z0-9_]{0,23}$/.test(s) && !/\d{4,}/.test(s) ? s : "?";
}
/** The unknown field names of one object as they may be logged. More than DIAG_KEYS_MAX of them = an object keyed by
 *  ids or names (a map), not a record → only "many:<n>", never the names. Pure. */
export function unknownNames(names, prefix = "") {
  const list = Array.isArray(names) ? names : [];
  if (list.length > DIAG_KEYS_MAX) return [`${prefix}many:${list.length}`];
  return list.map((k) => `${prefix}${safeKeyName(k)}`);
}
/** A type value as it may be logged: 1–4 digits; missing → "none"; anything else → "other". Pure. */
export function typeWord(t) {
  if (t == null || t === "") return "none";
  const s = typeof t === "number" && Number.isInteger(t) && t >= 0 ? String(t) : typeof t === "string" ? t.trim() : "";
  return /^\d{1,4}$/.test(s) ? s : "other";
}

/** The field PATHS inside one content object, names only (never a value): "a", "a.b", "list[].x" (an array: the names of
 *  its first object). A string is never parsed (a comment typed as JSON must not put its words in the log). Every name
 *  goes through safeKeyName; an object with more than DIAG_KEYS_MAX names is a map → "<path>.many:<n>" only.
 *  At most DIAG_PATHS_MAX paths, DIAG_PATH_DEPTH levels. Pure. */
export function contentPaths(obj) {
  const out = [];
  let more = 0;
  const add = (p) => { if (out.length < DIAG_PATHS_MAX) out.push(p); else more += 1; };
  const walk = (o, prefix, depth) => {
    const names = Object.keys(o);
    if (names.length > DIAG_KEYS_MAX) { add(`${prefix}many:${names.length}`); return; }
    for (const k of names) {
      const path = `${prefix}${safeKeyName(k)}`;
      let v = o[k];
      if (Array.isArray(v)) {
        add(`${path}[]`);
        v = v.find((x) => x && typeof x === "object" && !Array.isArray(x));
        if (v && depth < DIAG_PATH_DEPTH) walk(v, `${path}[].`, depth + 1);
        continue;
      }
      add(path);
      if (v && typeof v === "object" && depth < DIAG_PATH_DEPTH) walk(v, `${path}.`, depth + 1);
    }
  };
  if (obj && typeof obj === "object" && !Array.isArray(obj)) walk(obj, "", 1);
  if (more) out.push(`+${more}`);
  return out;
}
/** The parsed content object of one message (a JSON string or an object), else null. Pure. */
function contentObject(m) {
  const c = m && typeof m === "object" ? m.content : undefined;
  if (typeof c === "string" && c.trim().startsWith("{")) { try { const p = JSON.parse(c); return p && typeof p === "object" && !Array.isArray(p) ? p : null; } catch { return null; } }
  return c && typeof c === "object" && !Array.isArray(c) ? c : null;
}

/** One message → { content: json|string|object|other, type, who: host|others|nouid, unknownKeys[] }. Pure. */
export function messageShape(m, hostUid) {
  const msg = m && typeof m === "object" ? m : {};
  const c = msg.content;
  let kind = "other", obj = null;
  if (typeof c === "string") {
    kind = "string";
    if (c.trim().startsWith("{")) { try { const p = JSON.parse(c); if (p && typeof p === "object" && !Array.isArray(p)) { kind = "json"; obj = p; } } catch { /* a plain string */ } }
  } else if (c && typeof c === "object" && !Array.isArray(c)) { kind = "object"; obj = c; }
  const t = obj && obj.type != null ? obj.type : msg.type != null ? msg.type : msg.msg_type;
  const type = obj || t != null ? typeWord(t) : "na";
  const uid = msg.uid == null ? "" : String(msg.uid);
  const who = !uid ? "nouid" : uid === String(hostUid ?? "") ? "host" : "others";
  const unknownKeys = Object.keys(msg).filter((k) => !KNOWN_MSG_KEYS.includes(k));
  return { content: kind, type, who, unknownKeys };
}

// FNV-1a 32-bit of the sender + the raw content: tells a real repeat from two messages sharing one id. Never logged.
function fnv(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h;
}
const sigOf = (m) => fnv(`${m && m.uid != null ? m.uid : ""}\u0000${m && typeof m.content === "string" ? m.content : JSON.stringify((m && m.content) ?? "")}`);

/** The counters of ONE poller. hostUid stays in memory. */
export function createShopeeDiag({ hostUid = "", startMs = 0 } = {}) {
  const host = String(hostUid ?? "");
  const n = { polls: 0, msgs_message: 0, msgs_e2e: 0, msgs_system: 0, from_host: 0, from_others: 0, from_nouid: 0, kept: 0, dropped_notext: 0, dropped_dupe: 0, dupe_collide: 0, kept_100: 0 };
  const content = { json: 0, string: 0, object: 0, other: 0 };
  const types = new Map();
  let keysUnknown = null;             // the unknown field names of the first message / data with any
  const shapes = new Set();
  let shapeLines = 0, shapePending = false;
  let lastAt = startMs;
  const bucketOf = new WeakMap();     // message object → the list it came in
  const firstSig = new Map();         // msgId → the first message's signature (≤ DIAG_SEEN_MAX)
  const shapes100 = [];               // the field paths of each distinct type-100 content shape (≤ DIAG_100_SHAPES_MAX)
  const seen100 = new Set();          // their keys (also past the list cap, for the "+<n>" count)
  let pending100 = false;

  function data(d) {
    if (!d || typeof d !== "object") return;
    for (const kind of DIAG_BUCKETS) {
      const list = bucketMsgs(d, kind);
      if (kind === "message") n.msgs_message += list.length;
      else if (kind === "e2e_message") n.msgs_e2e += list.length;
      else n.msgs_system += list.length;
      for (const m of list) if (!bucketOf.has(m)) bucketOf.set(m, kind);
    }
    if (!keysUnknown) {
      const extra = Object.keys(d).filter((k) => !KNOWN_DATA_KEYS.includes(k));
      if (extra.length) keysUnknown = unknownNames(extra, "data.");
    }
  }
  /** A message the reader read, and what it did with it: "kept" | "notext" | "dupe". */
  function msg(m, outcome, msgId) {
    const s = messageShape(m, host);
    content[s.content] += 1;
    const tk = types.has(s.type) || types.size < DIAG_TYPES_MAX ? s.type : "more";
    types.set(tk, (types.get(tk) || 0) + 1);
    n[`from_${s.who}`] += 1;
    if (outcome === "kept") {
      n.kept += 1;
      if (s.type === "100") n.kept_100 += 1;
      const id = String(msgId ?? "");
      if (id && !firstSig.has(id)) {
        firstSig.set(id, sigOf(m));
        if (firstSig.size > DIAG_SEEN_MAX) firstSig.delete(firstSig.keys().next().value);
      }
    } else if (outcome === "dupe") {
      n.dropped_dupe += 1;
      const first = firstSig.get(String(msgId ?? ""));
      if (first !== undefined && first !== sigOf(m)) n.dupe_collide += 1;
    } else n.dropped_notext += 1;
    if (!keysUnknown && s.unknownKeys.length) keysUnknown = unknownNames(s.unknownKeys);
    const shape = `${bucketOf.get(m) || "?"}|${s.content}|${s.type}|${s.who}|${unknownNames(s.unknownKeys).sort().join(",")}`;
    if (!shapes.has(shape)) { shapes.add(shape); if (shapeLines < DIAG_SHAPE_LINES_MAX) shapePending = true; }
    if (s.type === "100") {
      const paths = contentPaths(contentObject(m));
      const key = paths.join(",");
      if (!seen100.has(key)) {
        seen100.add(key);
        if (shapes100.length < DIAG_100_SHAPES_MAX) { shapes100.push(paths); pending100 = true; }
      }
    }
  }
  function keys100() {
    if (!shapes100.length) return "-";
    const extra = seen100.size - shapes100.length;
    return shapes100.map((p) => (p.length ? p.join(",") : "none")).join("|") + (extra > 0 ? `|+${extra}` : "");
  }
  function line(sellerId) {
    const ty = types.size ? [...types].map(([k, v]) => `${k}:${v}`).join(",") : "-";
    const co = Object.entries(content).map(([k, v]) => `${k}:${v}`).join(",");
    return `[SHOPEE-DIAG] seller=${sellerId} polls=${n.polls} msgs_message=${n.msgs_message} msgs_e2e=${n.msgs_e2e} msgs_system=${n.msgs_system}`
      + ` types=${ty} content=${co} from_host=${n.from_host} from_others=${n.from_others} from_nouid=${n.from_nouid}`
      + ` kept=${n.kept} dropped_notext=${n.dropped_notext} dropped_dupe=${n.dropped_dupe} dupe_collide=${n.dupe_collide}`
      + ` keys_unknown=${keysUnknown && keysUnknown.length ? keysUnknown.join(",") : "-"}`
      + ` kept_100=${n.kept_100} keys_100=${keys100()}`;
  }
  /** After a poll: the line when a new shape was seen in it, or when 60 s passed since the last line. */
  function maybeLog(t, log, sellerId) {
    const due = t - lastAt >= DIAG_EVERY_MS;
    if (!shapePending && !pending100 && !due) return false;
    if (shapePending) shapeLines += 1;
    shapePending = false; pending100 = false; lastAt = t;
    log(line(sellerId));
    return true;
  }
  return { poll: () => { n.polls += 1; }, data, msg, line, maybeLog, counts: () => ({ ...n, content: { ...content }, types: Object.fromEntries(types), keysUnknown, keys100: shapes100.map((p) => [...p]) }) };
}
