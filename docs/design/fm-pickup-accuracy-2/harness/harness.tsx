// The REAL Pickup Status screen on made-up rows (fakeSupabase.ts). Nothing is drawn on top.
//   ?lang=en|fil|zh|zh-TW|vi|th|id|bg
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider, normalizeLang } from "../../../../src/redesign/i18n";
import ParcelTracking from "../../../../src/redesign/screens/ParcelTracking";

const lang = normalizeLang(new URLSearchParams(location.search).get("lang") || "en");
createRoot(document.getElementById("root")!).render(
  <TProvider lang={lang}>
    <div data-redesign="" data-theme="light" style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--text)", fontFamily: "var(--font-ui)" }}>
      <ParcelTracking userId="U1" fm />
    </div>
  </TProvider>,
);
