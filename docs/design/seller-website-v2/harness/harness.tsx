/* eslint-disable react-refresh/only-export-components -- a screenshot harness page, not an app module */
// Seller Website v2 — screenshot harness (NOT part of the app build: no entry in vite.config.ts).
// Renders every v2 screen with demo data. The buyer pages run the REAL shop app; their
// database calls are answered by shoot.cjs (Playwright routes) — nothing leaves the machine.
// Seller screens get fake data objects through their `api` props.
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import ShopApp from "../../../../src/website/ShopApp";
import { TProvider } from "../../../../src/redesign/i18n";
import WebsiteEditor from "../../../../src/redesign/screens/WebsiteEditor";
import WebsitePayShip from "../../../../src/redesign/screens/WebsitePayShip";
import WebsiteOrders from "../../../../src/redesign/screens/WebsiteOrders";
import Products from "../../../../src/redesign/screens/Products";
import type { EditorApi, PayShipApi, OrdersApi } from "../../../../src/redesign/adapters/websiteEditorApi";
import type { MyWebsite, WebsiteOrder } from "../../../../src/redesign/adapters/websiteSeller";

const q = new URLSearchParams(location.search);
const m = q.get("m") || "shop";
const lang = q.get("lang") || "en";
const ios = q.get("ios") === "1";
const plan = q.get("plan") || "pro";
const country = q.get("country") || "TW";

const DESIGN = {
  name: "BudgetUkay", tagline: "Pre-loved & new clothes · Taipei", about: "We sell pre-loved and new clothes, checked one by one. Ships from Taipei every day.",
  announcement: "Free shipping over NT$1,500 · New drops every Friday", live: "Live tonight 8:00 PM on Facebook & TikTok", policy: "Message us within 3 days of pickup if something is wrong.",
  replyTime: "~1 hr", color: "#EE4D2D", logo: "demo/logo.jpg", cover: "demo/cover.jpg",
  socials: { facebook: "budgetukay", instagram: "budgetukay.tw", tiktok: "budgetukay", youtube: "BudgetUkayTV" },
  chats: { messenger: "budgetukay", line: "@budgetukay", whatsapp: "886912000111" },
};
const SETTINGS = { ship: { s711: { enabled: true, fee: 60 }, fm: { enabled: true, fee: 60 }, home: { enabled: true, fee: 120 } }, freeOver: 1500, bank: { enabled: true, bankName: "Cathay United Bank (013)", accountName: "BudgetUkay", accountNumber: "0123-4567-8901" }, qr: { enabled: false }, cod: { enabled: true }, autoCancelHours: 24 };
const SITE: MyWebsite = { subdomain: "budgetukay", draft: DESIGN, published: { ...DESIGN, tagline: "Pre-loved clothes" }, publishedAt: "2026-11-14T02:00:00Z", settings: SETTINGS, customDomain: null };
const editorApi: EditorApi = {
  load: async () => (q.get("new") === "1" ? null : SITE), save: async () => ({ ok: true }), publish: async () => ({ ok: true, at: new Date().toISOString() }),
  subdomainFree: async () => true, uploadPicture: async () => null,
  loadProducts: async () => [
    { id: 4, name: "Floral midi dress, soft chiffon", price: 350, stock: 6, code: "A01", category: "Dresses", photos: ["demo/p1.jpg"], groups: [{ name: "Size", values: ["S", "M"] }], variants: [{ id: 41, values: ["S"], price: 350, stock: 2, photo: null }, { id: 42, values: ["M"], price: 350, stock: 4, photo: null }] },
    { id: 3, name: "Linen button shirt", price: 280, stock: 9, code: "A02", category: "Tops", photos: ["demo/p2.jpg"] },
  ],
};
const payApi: PayShipApi = { load: async () => SITE, save: async () => true, uploadQr: async () => null };
const T = "f".repeat(64);
const ORDERS: WebsiteOrder[] = [
  { id: "o3", orderNo: 14, token: T, status: "payment_sent", paymentIssue: false, buyerName: "Maria Santos", buyerPhone: "0912345678", buyerContact: "maria.santos", delivery: "s711", storeId: "123456", storeName: "Xinyi", address: null, payment: "bank",
    items: [{ pid: 4, vid: 42, name: "Floral midi dress, soft chiffon", label: "M · Pink", code: "A01-M-PINK", price: 350, qty: 2, photo: "demo/p1.jpg" }, { pid: 3, vid: null, name: "Linen button shirt", code: "A02", price: 280, qty: 1, photo: "demo/p2.jpg" }],
    subtotal: 980, shipFee: 60, total: 1040, note: "Please pack well", receiptPath: `${T}/r1.jpg`, receiptAt: "2026-11-15T03:10:00Z", autoCancelAt: null, paidAt: null, shippedAt: null, cancelledAt: null, cancelReason: null, seenAt: null, createdAt: "2026-11-15T03:02:00Z" },
  { id: "o2", orderNo: 13, token: T, status: "awaiting_payment", paymentIssue: false, buyerName: "Anne Lim", buyerPhone: "0922333444", buyerContact: null, delivery: "fm", storeId: "012345", storeName: "Taipei Main", address: null, payment: "bank",
    items: [{ pid: 3, vid: null, name: "Linen button shirt", price: 280, qty: 1, photo: "demo/p2.jpg" }], subtotal: 280, shipFee: 60, total: 340, note: null, receiptPath: null, receiptAt: null, autoCancelAt: "2026-11-16T02:00:00Z", paidAt: null, shippedAt: null, cancelledAt: null, cancelReason: null, seenAt: null, createdAt: "2026-11-15T02:00:00Z" },
  { id: "o1", orderNo: 12, token: T, status: "confirmed", paymentIssue: false, buyerName: "JC Dela Cruz", buyerPhone: "0933444555", buyerContact: null, delivery: "s711", storeId: "654321", storeName: "Zhongshan", address: null, payment: "cod",
    items: [{ pid: 5, vid: null, name: "Mini shoulder bag", price: 300, qty: 1, photo: "demo/p3.jpg" }], subtotal: 300, shipFee: 60, total: 360, note: null, receiptPath: null, receiptAt: null, autoCancelAt: null, paidAt: null, shippedAt: null, cancelledAt: null, cancelReason: null, seenAt: "2026-11-15T01:00:00Z", createdAt: "2026-11-14T09:00:00Z" },
  { id: "o0", orderNo: 11, token: T, status: "shipped", paymentIssue: false, buyerName: "Lea P.", buyerPhone: "0944555666", buyerContact: null, delivery: "home", storeId: null, storeName: null, address: "No. 5, Lane 20, Taipei", payment: "bank",
    items: [{ pid: 3, vid: null, name: "Linen button shirt", price: 280, qty: 3, photo: "demo/p2.jpg" }], subtotal: 840, shipFee: 120, total: 960, note: null, receiptPath: `${T}/r0.jpg`, receiptAt: "2026-11-13T03:10:00Z", autoCancelAt: null, paidAt: "2026-11-13T04:00:00Z", shippedAt: "2026-11-14T01:00:00Z", cancelledAt: null, cancelReason: null, seenAt: "2026-11-13T03:20:00Z", createdAt: "2026-11-13T03:00:00Z" },
];
const ordersApi: OrdersApi = {
  load: async () => ORDERS, blocked: async () => new Set(), shopSub: async () => "budgetukay",
  receipt: async () => "https://demo.supabase.co/storage/v1/object/public/product-images/demo/receipt.jpg",
  act: async (_id, a) => ({ ok: true, status: a === "paid" ? "paid" : "payment_sent", blocked: a === "block" }),
  ship: async (_id, c, tr) => ({ ok: true, courier: c || null, tracking: tr || null }),
};

const noop = () => {};
function Seller({ children }: { children: React.ReactNode }) {
  return <div data-redesign="" data-theme="light" data-accent="indigo" className="sfl-stage" style={{ minHeight: "100vh", background: "var(--bg)" }}><TProvider lang={lang}>{children}</TProvider></div>;
}
let el: React.ReactNode;
if (m === "shop") el = <ShopApp host="www.sellerflowlive.com" path={q.get("path") || "/s/budgetukay"} nowMs={Date.parse("2026-11-16T08:00:00Z")} />;
else if (m === "editor") el = <Seller><WebsiteEditor onBack={noop} onPayShip={noop} onUpgrade={ios ? undefined : noop} ios={ios} plan={plan} planStatus="active" planExpiry="2027-01-01" country={country} onToast={noop} api={editorApi} /></Seller>;
else if (m === "payship") el = <Seller><WebsitePayShip onBack={noop} onToast={noop} api={payApi} country={country} cur={country === "CA" ? "CA$" : country === "AU" ? "A$" : country === "PH" ? "₱" : "NT$"} /></Seller>;
else if (m === "orders") el = <Seller><WebsiteOrders onToast={noop} api={ordersApi} topTabs={<OrdersTabs />} /></Seller>;
else if (m === "products") el = <Seller><Products cur="NT$" website /></Seller>;
else el = <div>unknown mode</div>;
createRoot(document.getElementById("root")!).render(el);

function OrdersTabs() {
  const seg = (on: boolean) => ({ flex: 1, padding: "7px 0", borderRadius: 8, border: "none", fontWeight: 800 as const, fontSize: 12.5, background: on ? "#fff" : "transparent", color: on ? "var(--accent-fg)" : "var(--on-header)", fontFamily: "var(--font-ui)" });
  return (
    <div style={{ display: "flex", gap: 4, marginTop: 11, background: "rgba(255,255,255,.16)", borderRadius: 10, padding: 3 }}>
      <button style={seg(false)}>Orders</button><button style={seg(false)}>Miners</button>
      <button style={seg(true)}>Website<span style={{ marginLeft: 5, fontSize: 10.5, fontWeight: 800, background: "var(--danger)", color: "#fff", borderRadius: 999, padding: "1px 6px" }}>2</span></button>
    </div>
  );
}
