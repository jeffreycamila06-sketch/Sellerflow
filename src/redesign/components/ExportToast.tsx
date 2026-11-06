// Short failure / hint message for the branded Excel/PDF export buttons (useBrandedExport).
// Same look as the app toast (red pill, ⚠).
export default function ExportToast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    // animation:none — the screen's entrance rule (.sfl-anim-screen > * > *) would otherwise fade it in late.
    <div style={{ position: "fixed", left: 0, right: 0, bottom: 90, display: "flex", justifyContent: "center", padding: "0 16px", zIndex: 1200, pointerEvents: "none", animation: "none" }}>
      <div key={message} role="status" className="sfl-toast-in" data-testid="export-toast" style={{ maxWidth: "100%", background: "var(--danger)", color: "#fff", fontSize: 13, fontWeight: 700, padding: "10px 18px", borderRadius: 999, boxShadow: "0 8px 24px rgba(0,0,0,.3)", textAlign: "center", lineHeight: 1.35 }}>⚠ {message}</div>
    </div>
  );
}
