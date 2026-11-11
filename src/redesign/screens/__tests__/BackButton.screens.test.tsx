// Back button rule (Jeff 2026-11-11) — every one of the 23 sub-screens renders the ONE shared "‹ Back":
// at least 44 px, the rd_back text (8 languages), top left of the header (first button in it), and a tap
// calls onBack. The 12 that had none show nothing without onBack (Admin from its nav button, the
// Customer Details overlay inside Parcel Scan). Where Back goes: backNav.test.ts + backButton.app.test.tsx.
import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import type { ComponentType, ReactElement } from "react";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { TProvider, buildT } from "../../i18n";
import GeneralSettings from "../GeneralSettings";
import Customers from "../Customers";
import Subscription from "../Subscription";
import Support from "../Support";
import Admin from "../Admin";
import Shipping from "../Shipping";
import CustomerData from "../CustomerData";
import Legal from "../Legal";
import ParcelScan from "../ParcelScan";
import FmParcelScan from "../FmParcelScan";
import CustomerDetails from "../CustomerDetails";
import ParcelTracking from "../ParcelTracking";
import PrinterSettings from "../PrinterSettings";
import PrintPattern, { DEFAULT_PP } from "../PrintPattern";
import ManageChannels from "../ManageChannels";
import ShopeeChannels from "../ShopeeChannels";
import FbChannels from "../FbChannels";
import IgChannels from "../IgChannels";
import ReceiptFormat from "../ReceiptFormat";
import DeleteAccount from "../DeleteAccount";
import Print from "../Print";
import Signup from "../Signup";
import OneStickerPattern from "../../components/OneStickerPattern";
import { recommendedSettings } from "../../adapters/oneSticker";
import { DEF_SETTINGS } from "../../adapters/printing";

afterEach(cleanup);
const n = () => {};
const acct = { authUserId: "u", email: "s@x.com", plan: "pro", planStatus: "active", planExpiry: "", role: "seller", connectedAccounts: [], profile: { fullName: "O", storeName: "S", phone: "", tiktok: "shop1", facebook: "", adminContactNote: "" } };
// Props are filled loosely (the screens only need to mount); each case passes onBack.
function el<C extends ComponentType<never>>(C: C, props: Record<string, unknown>): (onBack?: () => void) => ReactElement {
  return (onBack) => { const P = C as unknown as ComponentType<Record<string, unknown>>; return <P {...props} {...(onBack ? { onBack } : {})} />; };
}
type Case = [string, (onBack?: () => void) => ReactElement];

const NEW_12: Case[] = [
  ["General Settings", el(GeneralSettings, { theme: "light", accent: "indigo", onSetTheme: n, onSetAccent: n, auto: { detect: true, toggle: n }, lang: "en", onSetLang: n, currency: "TWD", onSetCurrency: n, profileOpen: false, onToggleProfile: n, printerIdx: 1, printerOpen: false, onTogglePrinter: n, onPickPrinter: n, onPrintPattern: n, onSubscription: n, onSupport: n, onDelete: n, account: { ...acct, connectedAccounts: [] } })],
  ["Customers", el(Customers, { cur: "NT$" })],
  ["Subscription", el(Subscription, { cur: "NT$" })],
  ["Support", el(Support, { onLegal: n })],
  ["Admin (from the Settings tile)", el(Admin, { onOpenPanel: n, cur: "NT$" })],
  ["7-11 Shipping", el(Shipping, { cur: "NT$", sessionKey: "2026-11-11" })],
  ["Customer data", el(CustomerData, { onLegal: n, cur: "NT$" })],
  ["Legal", el(Legal, {})],
  ["Parcel Scan 7-11", el(ParcelScan, { cur: "NT$", manualOnly: true })],
  ["Parcel Scan FamilyMart", el(FmParcelScan, { cur: "NT$" })],
  ["Customer Details", el(CustomerDetails, { cur: "NT$" })],
  ["Pickup Status", el(ParcelTracking, {})],
];
const SAME_11: Case[] = [
  ["Printer settings", el(PrinterSettings, { psType: "bt", psOut: "sticker", onSetPsOut: n, psSize: "100x60mm (Standard)", psSizeOpen: false, onTogglePsSize: n, onPickPsSize: n, settings: { ...DEF_SETTINGS } })],
  ["Live print pattern", el(OneStickerPattern, { initial: recommendedSettings({ w: 100, h: 60 }), size: { w: 100, h: 60 }, savedOnDevice: true, onSave: n, shopName: "S", devicePath: "d520", qrAllowed: true, onTest: n, onChangeSize: n })],
  ["Print pattern (old)", el(PrintPattern, { pp: DEFAULT_PP, shopName: "S", onToggle: n, onStep: n, onTestPrint: n, psSize: "100x60mm (Standard)", cur: "NT$" })],
  ["Manage accounts", el(ManageChannels, { platform: "tiktok", account: acct, onSaveChannels: async () => ({ ok: true }) })],
  ["Shopee shops", el(ShopeeChannels, { account: acct, shops: [], preview: false, onReload: n, onToast: n, onUpsell: n })],
  ["Facebook pages", el(FbChannels, { account: acct, pages: [], onReload: n, onToast: n, onUpsell: n })],
  ["Instagram", el(IgChannels, { account: acct, accounts: [], onReload: n, onToast: n, onUpsell: n })],
  ["Receipt format", el(ReceiptFormat, { cur: "NT$" })],
  ["Delete account", el(DeleteAccount, { email: "s@x.com", onConfirm: async () => ({ ok: true }) })],
  ["Print stickers", el(Print, { cur: "NT$", buyers: [], storeName: "S", settings: { ...DEF_SETTINGS } })],
  ["Sign up", el(Signup, { onLegal: n, onRegister: async () => ({ ok: false }) })],
];

const mount = (node: ReactElement, lang = "en") => render(<TProvider lang={lang}>{node}</TProvider>);
const backs = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLButtonElement>("[data-testid='back-btn']"));

describe("all 23 sub-screens: one shared ‹ Back, 44 px, top left, tap = onBack", () => {
  for (const [name, make] of [...NEW_12, ...SAME_11]) {
    it(name, () => {
      const onBack = vi.fn();
      const r = mount(make(onBack));
      const b = backs(r.container);
      expect(b).toHaveLength(1);
      expect(b[0].textContent).toBe("‹ Back");
      expect(b[0].style.minHeight).toBe("44px");
      expect(b[0].style.padding).toBe("9px 12px 9px 9px");
      // top left: the first button of the screen, before any title text in its row
      expect(r.container.querySelector("button")).toBe(b[0]);
      fireEvent.click(b[0]);
      expect(onBack).toHaveBeenCalledTimes(1);
    });
  }
});

describe("the 12 new ones show nothing without onBack (Admin from its nav button, Customer Details inside Parcel Scan)", () => {
  for (const [name, make] of NEW_12) {
    it(name, () => {
      const r = mount(make());
      expect(backs(r.container)).toHaveLength(0);
    });
  }
});

describe("8 languages: the text is rd_back", () => {
  it("vi / th / bg / zh-TW / fil / zh / id / en", () => {
    for (const lang of ["en", "fil", "zh", "zh-TW", "vi", "th", "id", "bg"]) {
      const r = mount(NEW_12[0][1](n), lang);
      expect(backs(r.container)[0].textContent, lang).toBe(buildT(lang).rd_back);
      r.unmount();
    }
  });
});

describe("one look everywhere: no screen keeps its own Back button", () => {
  it("no old 32 px header Back left in the screens", () => {
    for (const f of fs.readdirSync("src/redesign/screens").filter((x) => x.endsWith(".tsx"))) {
      const src = fs.readFileSync(`src/redesign/screens/${f}`, "utf8");
      expect(src, f).not.toContain('padding: "7px 12px 7px 9px", borderRadius: 9, color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "var(--font-ui)" }}>{t.rd_back}</button>');
      expect(src, f).not.toMatch(/onClick=\{onBack\} style=\{\{ background: "rgba\(255,255,255,\.18\)", border: "none", width: 32, height: 32/);
    }
  });
  it("RedesignApp: every Back goes through the origin record (no hard-coded targets, no chanBack / psBack)", () => {
    const app = fs.readFileSync("src/redesign/RedesignApp.tsx", "utf8");
    expect(app).not.toMatch(/chanBack|psBack/);
    expect(app).not.toMatch(/onBack=\{\(\) => setScreen\(/);
    expect((app.match(/onBack=\{\(\) => goBack\(\)\}/g) ?? []).length).toBeGreaterThanOrEqual(19);
    expect(app).toContain('onBack={showsBack(navOrigins, "admin") ? () => goBack() : undefined}');
    expect(app).toContain('<Legal onBack={() => goBack(authed ? "menu" : anonScreen())} />');
    for (const tab of ["dashboard", "salestab", "products", "menu", "admin"]) expect(app).toContain(`onClick={() => openTab("${tab}")}`);
    expect(app).toContain('openTab("orders")');
  });
});
