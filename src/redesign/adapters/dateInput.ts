// datetime-local inputs ↔ ISO (PURE).
/** ISO → the value of a datetime-local input (this device's time); "" when empty. */
export function toLocalInput(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "";
  const d = new Date(t), p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}
/** A datetime-local value (this device's time) → ISO, or null. */
export function fromLocalInput(v: string): string | null {
  const t = v ? new Date(v).getTime() : NaN;
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

