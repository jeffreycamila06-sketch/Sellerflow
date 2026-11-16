// Seller Website — the editor / Payment & shipping / orders data calls bundled as injectable objects
// (the screens take them as a prop so tests and the screenshot harness can pass fakes).
import type { ShopDesign, ShopProduct } from "../../website/shopApi";
import {
  loadMyWebsite, saveMyWebsite, saveWebsiteSettings, publishWebsite, subdomainFree, loadWebsiteOrders, loadBlockedPhones,
  websiteOrderAction, websiteOrderShip, receiptUrl,
  type MyWebsite, type PublishResult, type SaveResult, type WebsiteSettings, type WebsiteOrder, type OrderAction, type WebsiteOrderStatus,
} from "./websiteSeller";
import { uploadSitePicture } from "./websitePhotos";
import { shopProductsFrom } from "./websiteEditor";
import { loadProductsDb } from "./productsDb";
import { loadProductImagePaths } from "./productImages";
import { loadSoldUnits } from "./soldUnits";

export interface EditorApi {
  load: () => Promise<MyWebsite | null | "error">;
  save: (w: { subdomain: string; draft: ShopDesign }, exists: boolean) => Promise<SaveResult>;
  publish: () => Promise<PublishResult>;
  subdomainFree: (s: string) => Promise<boolean | null>;
  uploadPicture: (kind: "logo" | "cover", f: Blob) => Promise<string | null>;
  loadProducts: () => Promise<ShopProduct[]>;
}
export const realEditorApi: EditorApi = {
  load: loadMyWebsite, save: (w, e) => saveMyWebsite(w, e), publish: publishWebsite, subdomainFree, uploadPicture: uploadSitePicture,
  loadProducts: async () => {
    const [p, img, sold] = await Promise.all([loadProductsDb(), loadProductImagePaths(), loadSoldUnits()]);
    return shopProductsFrom(p || [], img || new Map(), undefined, Date.now(), sold);
  },
};
export interface PayShipApi { load: () => Promise<MyWebsite | null | "error">; save: (s: WebsiteSettings) => Promise<boolean>; uploadQr: (f: Blob) => Promise<string | null> }
export const realPayShipApi: PayShipApi = { load: loadMyWebsite, save: saveWebsiteSettings, uploadQr: (f) => uploadSitePicture("qr", f) };

export interface OrdersApi {
  load: () => Promise<WebsiteOrder[] | null>;
  blocked: () => Promise<Set<string>>;
  act: (id: string, a: OrderAction) => Promise<{ ok: true; status: WebsiteOrderStatus; blocked: boolean } | { ok: false }>;
  receipt: (path: string) => Promise<string | null>;
  shopSub: () => Promise<string | null>;
  /** v2 (sql/165): ship with an optional courier + tracking (or change them). Absent → the plain 'shipped' action. */
  ship?: (id: string, courier: string, tracking: string) => Promise<{ ok: true; courier: string | null; tracking: string | null } | { ok: false }>;
}
export const realOrdersApi: OrdersApi = {
  load: loadWebsiteOrders, blocked: loadBlockedPhones, act: websiteOrderAction, receipt: receiptUrl, ship: websiteOrderShip,
  shopSub: async () => { const w = await loadMyWebsite(); return w && w !== "error" ? w.subdomain : null; },
};
