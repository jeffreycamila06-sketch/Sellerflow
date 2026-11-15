import type { Shop } from "../shopApi";
export const DEMO_SHOP: Shop = {
  online: true, sub: "budgetukay", country: "TW", powered: true, verified: true, stats: { orders: 12400, products: 12 },
  shop: { name: "BudgetUkay", tagline: "Pre-loved & new clothes · Taipei", about: "We sell pre-loved and new clothes.", announcement: "Free shipping over NT$1,500 · New drops every Friday",
    live: "Live tonight 8:00 PM on Facebook & TikTok", policy: "Message us within 3 days of pickup.", replyTime: "~1 hr", color: "#EE4D2D",
    socials: { facebook: "budgetukay", instagram: "budgetukay.tw", tiktok: "budgetukay", youtube: "BudgetUkayTV" }, chats: { messenger: "budgetukay", line: "budgetukay" } },
  checkout: { ship: { s711: { fee: 60 }, fm: { fee: 60 }, home: { fee: 120 } }, freeOver: 1500, bank: { bankName: "國泰世華 Cathay United Bank (013)", accountName: "BudgetUkay", accountNumber: "0123-4567-8901" }, cod: true, autoCancelHours: 24 },
  products: [
    { id: 1, name: "Floral midi dress, soft chiffon, lined", price: 350, stock: 4, code: "A01", category: "Dresses", createdAt: "2026-11-14T00:00:00Z", photos: [],
      groups: [{ name: "Size", values: ["S", "M", "L", "XL"] }, { name: "Color", values: ["Pink", "Blue"] }],
      variants: [
        { id: 11, values: ["S", "Pink"], price: 350, stock: 1, photo: null, code: "A01-S-PINK" }, { id: 12, values: ["M", "Pink"], price: 350, stock: 3, photo: null, code: "A01-M-PINK" },
        { id: 13, values: ["L", "Pink"], price: 350, stock: 0, photo: null, code: "A01-L-PINK" }, { id: 14, values: ["M", "Blue"], price: 380, stock: 2, photo: null, code: "A01-M-BLUE" },
        { id: 15, values: ["XL", "Pink"], price: 350, stock: 0, photo: null, code: "A01-XL-PINK" }, { id: 16, values: ["XL", "Blue"], price: 350, stock: 0, photo: null, code: "A01-XL-BLUE" },
      ] },
    { id: 2, name: "Linen button shirt, oversized", price: 280, stock: 9, code: "A02", category: "Tops", createdAt: "2026-11-01T00:00:00Z", photos: [] },
    { id: 3, name: "Mini shoulder bag, vegan leather", price: 300, stock: 2, code: "C03", category: "Bags", createdAt: "2026-10-01T00:00:00Z", photos: [] },
    { id: 4, name: "White leather sneakers", price: 890, stock: 0, code: "D04", category: "Shoes", createdAt: "2026-09-01T00:00:00Z", photos: [] },
  ],
};
