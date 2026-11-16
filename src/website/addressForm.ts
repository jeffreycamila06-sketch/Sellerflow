// Seller Website v2 — the buyer's address + phone follow the SHOP's country (pure, unit-tested).
// Canada: street, city, province, postal code (A1A 1A1). Australia: street, suburb, state, postcode
// (4 digits). Everywhere else: one address box (as today). The order still stores ONE address line
// (website_orders.address, 5–200 characters) — no tax is calculated anywhere.
export interface AddrParts { street: string; city: string; region: string; post: string }
export const EMPTY_ADDR: AddrParts = { street: "", city: "", region: "", post: "" };
export type AddrForm = "CA" | "AU" | "free";
export const CA_PROVINCES = ["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"];
export const AU_STATES = ["ACT", "NSW", "NT", "QLD", "SA", "TAS", "VIC", "WA"];

export function addrFormOf(country: string): AddrForm {
  const c = (country || "").toUpperCase();
  return c === "CA" ? "CA" : c === "AU" ? "AU" : "free";
}
const CA_POST = /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z] ?\d[ABCEGHJ-NPRSTV-Z]\d$/;
/** A1A1A1 / a1a-1a1 → "A1A 1A1" (Canada); else trimmed. Pure. */
export function cleanPost(form: AddrForm, post: string): string {
  const p = post.trim().toUpperCase();
  if (form === "CA") { const x = p.replace(/[\s-]/g, ""); return x.length === 6 ? `${x.slice(0, 3)} ${x.slice(3)}` : p; }
  return p;
}
export function postOk(form: AddrForm, post: string): boolean {
  const p = cleanPost(form, post);
  return form === "CA" ? CA_POST.test(p) : form === "AU" ? /^\d{4}$/.test(p) : true;
}
export type AddrError = "street" | "city" | "region" | "post";
export function addressErrors(form: AddrForm, a: AddrParts): AddrError[] {
  if (form === "free") return [];
  const e: AddrError[] = [];
  if (a.street.trim().length < 3) e.push("street");
  if (!a.city.trim()) e.push("city");
  if (!(form === "CA" ? CA_PROVINCES : AU_STATES).includes(a.region)) e.push("region");
  if (!postOk(form, a.post)) e.push("post");
  return e;
}
/** The one address line the order keeps. Canada: "12 King St W, Toronto, ON M5H 2N2"; Australia: "1 George St, Sydney NSW 2000". Pure. */
export function composeAddress(form: AddrForm, a: AddrParts, free: string): string {
  if (form === "free") return free.trim();
  const street = a.street.trim(), city = a.city.trim(), post = cleanPost(form, a.post);
  const line = form === "CA" ? `${street}, ${city}, ${a.region} ${post}` : `${street}, ${city} ${a.region} ${post}`;
  return line.slice(0, 200);
}

/** The phone shape a buyer is shown, by the shop's country. Pure. */
export const PHONE_HINT: Record<string, string> = { TW: "0912 345 678", CA: "416 555 0123", AU: "0412 345 678", PH: "0917 123 4567", US: "212 555 0123" };
export const phoneHintOf = (country: string) => PHONE_HINT[(country || "").toUpperCase()] || "";
/** Phone check by country (the database accepts 8–15 digits everywhere). Pure. */
export function phoneOk(country: string, phone: string): boolean {
  const d = phone.replace(/\D/g, "");
  if (d.length < 8 || d.length > 15) return false;
  const c = (country || "").toUpperCase();
  if (c === "CA" || c === "US") return d.length === 10 || (d.length === 11 && d.startsWith("1"));
  if (c === "AU") return /^0?[2-478]\d{8}$/.test(d) || /^61[2-478]\d{8}$/.test(d);
  if (c === "PH") return /^0?9\d{9}$/.test(d) || /^639\d{9}$/.test(d);
  return true;
}
