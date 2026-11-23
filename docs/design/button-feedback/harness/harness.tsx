// Button feedback — screenshot harness (NOT part of the app build: no entry in vite.config.ts).
// The REAL Settings → Website screen with a stand-in save: ?save=ok | slow (never answers) | fail.
// Demo shop, no database, nothing leaves the machine.
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider } from "../../../../src/redesign/i18n";
import WebsiteEditor from "../../../../src/redesign/screens/WebsiteEditor";
import type { EditorApi } from "../../../../src/redesign/adapters/websiteEditorApi";
import type { MyWebsite } from "../../../../src/redesign/adapters/websiteSeller";
import { DEFAULT_SETTINGS } from "../../../../src/redesign/adapters/websiteEditor";

const q = new URLSearchParams(location.search);
const save = q.get("save") || "ok";
const DESIGN = { name: "Demo Shop", tagline: "Pre-loved & new clothes · Taipei", about: "Checked one by one. Ships every day." };
const SITE: MyWebsite = { subdomain: "demoshop", draft: DESIGN, published: DESIGN, publishedAt: "2026-11-14T02:00:00Z", settings: DEFAULT_SETTINGS, customDomain: null };
const api: EditorApi = {
  load: async () => SITE,
  save: () => (save === "slow" ? new Promise(() => {}) : new Promise((r) => setTimeout(() => r(save === "fail" ? ({ ok: false, reason: "failed" } as never) : { ok: true }), 250))),
  publish: async () => ({ ok: true, at: new Date().toISOString() }),
  subdomainFree: async () => true, uploadPicture: async () => null, loadProducts: async () => [],
};
const noop = () => {};
createRoot(document.getElementById("root")!).render(
  <div data-redesign="" data-theme={q.get("theme") || "light"} data-accent="indigo" className="sfl-stage" style={{ minHeight: "100vh", background: "var(--bg)" }}>
    <TProvider lang={q.get("lang") || "en"}>
      <WebsiteEditor onBack={noop} onPayShip={noop} onUpgrade={noop} ios={q.get("ios") === "1"} plan="pro" planStatus="active" planExpiry="2027-01-01" onToast={noop} api={api} newLook={false} subdomainReady />
    </TProvider>
  </div>,
);
