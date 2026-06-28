// Web-landing-only pop-up wrapper for the Login / Signup forms. Renders a backdrop
// + centered card over the marketing landing (which stays mounted behind). Used ONLY
// from RedesignApp when screen === "landing" (web visitors) — the APK never shows the
// landing (isAppShell → anonScreen "login" → the full-screen Login as before), so this
// changes ZERO native/APK behavior. The Login/Signup components inside are unchanged;
// only HOW they are presented (modal vs full screen) differs.
//
// Close affordances: backdrop click, the ✕ button, and the Esc key.
import { useEffect, type ReactNode } from "react";

export default function AuthModal({
  onClose,
  closeLabel,
  brand,
  children,
}: {
  onClose: () => void;
  closeLabel: string;
  // Optional left brand panel (web split-screen). Hidden on narrow via CSS; the form
  // (children) always shows. Omitting it = the original single-column modal.
  brand?: ReactNode;
  children: ReactNode;
}) {
  // Esc to close (window-level; cleaned up on unmount).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000, // above the landing nav (z30) + lang dropdown (z40)
        background: "rgba(8,6,24,.55)",
        backdropFilter: "blur(3px)",
        WebkitBackdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sfl-authcard"
        style={{
          position: "relative",
          width: "100%",
          maxHeight: "92dvh",
          overflowY: "auto",
          overflowX: "hidden",
          borderRadius: 20,
          background: "var(--app-bg)",
          boxShadow: "0 30px 80px rgba(0,0,0,.5)",
          scrollbarWidth: "none",
        }}
      >
        <button
          onClick={onClose}
          aria-label={closeLabel}
          style={{
            position: "absolute",
            top: 12,
            right: 12,
            zIndex: 5,
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "50%",
            border: "none",
            background: "rgba(255,255,255,.18)",
            color: "#fff",
            fontSize: 17,
            lineHeight: 1,
            cursor: "pointer",
            backdropFilter: "blur(4px)",
          }}
        >
          ✕
        </button>
        {/* Split row: brand panel (left, ≥720px only) | form (right, children). On narrow
            screens .sfl-authbrand is display:none, so the form shows alone as before. */}
        <div className="sfl-authsplit">
          {brand}
          <div className="sfl-authform">{children}</div>
        </div>
      </div>
    </div>
  );
}
