// The REAL Orders screen (Posts side / Posts 🔒) and the REAL "Sell on a post" form on made-up data.
// Nothing is drawn on top. The access answer comes from the REAL postSalesAccess for each plan.
//   ?view=plus|free|ends|readonly&lang=en|fil|zh|zh-TW|vi|th|id|bg
//   readonly (fix round 1): a Plus seller whose plan EXPIRED and who has post orders → view-only Posts
//   + the waiting line with a post buyer (Give off) and a live buyer (Give on).
import { createRoot } from "react-dom/client";
import { useState } from "react";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider, normalizeLang, buildT } from "../../../../src/redesign/i18n";
import Orders, { type WaitlistUi } from "../../../../src/redesign/screens/Orders";
import { groupWaitlist, type WaitlistRow } from "../../../../src/redesign/adapters/fbWaitlist";
import type { PostsUi } from "../../../../src/redesign/screens/PostSales";
import ContactSupportPopup from "../../../../src/redesign/components/ContactSupportPopup";
import { postSalesAccess, type PostSale, type PostOrder } from "../../../../src/redesign/adapters/fbPostSales";

const qs = new URLSearchParams(location.search);
const lang = normalizeLang(qs.get("lang") || "en");
const view = qs.get("view") || "plus";
const NOW = Date.now();
const iso = (ms: number) => new Date(ms).toISOString();
const sale = (id: number, msg: string, mode: "code" | "plus_one", items: [string, string, number, number | null, number][]): PostSale => ({
  id, pageId: "P1", postId: `P1_${id}`, postMessage: msg, postPicture: null, mode, startsAt: iso(NOW - 86400000), endsAt: iso(NOW + 6 * 86400000), status: "selling", createdAt: iso(NOW - 86400000 * id),
  items: items.map(([name, code, price, stock, sold], i) => ({ id: id * 10 + i, saleId: id, productId: null, name, code, price, stock, sold })),
});
const SALES = [
  sale(1, "Weekend sale! Comment the code", "code", [["Red dress", "A", 350, 3, 2], ["Blue top", "B", 200, null, 1]]),
  sale(2, "Last piece — comment +1", "plus_one", [["Leather bag", "+1", 890, 5, 1]]),
  sale(3, "Kids shoes, +1 for one pair", "plus_one", [["Kids shoes", "+1", 420, 10, 0]]),
];
const ord = (id: number, saleId: number, itemId: number, buyer: string, price: number, mins: number, printed = false, qty = 1): PostOrder =>
  ({ id, saleId, itemId, buyerFbId: `B_${buyer}`, buyerName: buyer, qty, price, commentId: `c${id}`, commentText: "", createdAt: iso(NOW - mins * 60000), printedAt: printed ? iso(NOW) : null });
const ORDERS = [ord(1, 1, 10, "Ana Cruz", 350, 50), ord(2, 1, 11, "Ana Cruz", 200, 45), ord(3, 2, 20, "Ben Lim", 890, 30, false, 1), ord(4, 1, 10, "陳小美", 350, 20, true)];

export function Harness() {
  const plan = view === "free" ? "free" : "plus";
  const ro = view === "readonly";
  const access = postSalesAccess({ switchOn: true, isAdmin: false, hasKey: false, pageCount: 1, plan, planStatus: ro ? "expired" : "active", planExpiry: iso(NOW + (ro ? -2 : 30) * 86400000), hasOrders: ro });
  const [popup, setPopup] = useState(false);
  const ui: PostsUi = {
    state: "ready", sales: SALES, orders: view === "ends" ? [] : ORDERS, waitlistCounts: new Map([[1, 2]]), pages: [{ pageId: "P1", name: "My Shop" }], products: [], busy: false, note: null, readOnly: access === "readonly",
    onReload: () => {}, onPrintNew: () => {}, onCreate: async () => ({ ok: true as const, id: 9 }), onEnd: async () => true, onUpdateItem: async () => true,
    loadPosts: async () => ({ ok: true as const, posts: [{ id: "P1_9", message: "New arrivals this week!", createdTime: iso(NOW - 3600000), picture: "", url: "" }, { id: "P1_8", message: "Restock: kids shoes", createdTime: iso(NOW - 86400000), picture: "", url: "" }] }),
  };
  const t = buildT(lang);
  const wrow = (id: number, code: string, name: string, source: "live" | "post", saleId: number | null): WaitlistRow => ({ id, sessionId: source === "live" ? "s1" : null, code, productLocalId: null, commentId: `w${id}`, pageId: "P1", liveVideoId: null, commenterId: `W${id}`, commenterName: name, handle: name, createdAt: iso(NOW - id * 60000), status: "waiting", source, saleId });
  const waitlist: WaitlistUi | undefined = ro ? { state: "ready", groups: groupWaitlist([wrow(1, "A", "Mei Lin", "post", 1), wrow(2, "A", "Rosa Diaz", "post", 1), wrow(3, "C2", "Joy Tan", "live", null)]), stockFor: () => 2, onGive: () => {}, onSkip: () => {}, busyId: null, postLabel: (sid) => SALES.find((x) => x.id === sid)!.postMessage, postGiveOff: true } : undefined;
  return (
    <div data-redesign="" data-theme="light" data-access={access} style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--text)", fontFamily: "var(--font-ui)" }}>
      <Orders onGoPrint={() => {}} cur="NT$" orders={[]} state="live" todayId={iso(NOW).slice(0, 10)} buyers={[]}
        {...(access === "full" || access === "readonly" ? { posts: ui } : access === "locked" ? { postsLocked: true, onPostsLocked: () => setPopup(true) } : {})} {...(waitlist ? { waitlist } : {})} />
      {popup && <ContactSupportPopup title={t.rd_lock_title} message={t.rd_lock_body} onClose={() => setPopup(false)} />}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<TProvider lang={lang}><Harness /></TProvider>);
