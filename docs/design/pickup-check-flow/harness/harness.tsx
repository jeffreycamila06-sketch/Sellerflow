// Pickup Status screen (the REAL component + adapters) on a fake Supabase client — see fakeSupabase.ts.
import { createRoot } from "react-dom/client";
import "../../../../src/styles/design-tokens.css";
import "../../../../src/redesign/redesign.css";
import { TProvider } from "../../../../src/redesign/i18n";
import ParcelTracking from "../../../../src/redesign/screens/ParcelTracking";

const q = new URLSearchParams(location.search);
createRoot(document.getElementById("root")!).render(
  <TProvider lang={q.get("lang") || "en"}>
    <div data-redesign="" data-theme="light" style={{ minHeight: "100vh", background: "var(--app-bg)", color: "var(--text)", fontFamily: "var(--font-ui)" }}>
      <ParcelTracking userId="U1" />
    </div>
  </TProvider>,
);
