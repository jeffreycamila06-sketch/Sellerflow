// "Accounts used: X of Y" (combined account limit, sql/84). Shows nothing when the
// numbers can't be read, the function doesn't exist yet, or the seller is unlimited.
import { useAccountQuota, quotaLineText } from "../adapters/accountQuota";
import { useT } from "../i18n";

export default function AccountQuotaLine({ reloadKey }: { reloadKey?: unknown }) {
  const t = useT();
  const text = quotaLineText(useAccountQuota(reloadKey), t);
  if (!text) return null;
  return <div data-testid="account-quota-line" style={{ fontSize: 12, fontWeight: 600, color: "var(--text-muted)", margin: "0 2px 12px" }}>{text}</div>;
}
