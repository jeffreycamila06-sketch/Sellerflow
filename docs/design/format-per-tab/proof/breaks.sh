#!/usr/bin/env bash
# On-purpose breaks: each edit must turn the per-tab Format tests red. The file is restored after each.
cd "$(dirname "$0")/../../../.."
T="src/redesign/screens/__tests__/Invoicing.formatPerTab.test.tsx src/redesign/screens/__tests__/formatPerTab.sameAsMain.test.tsx src/redesign/screens/__tests__/Invoicing.test.tsx"
br() { # name file python-replace(old,new)
  local name="$1" file="$2" old="$3" new="$4"
  cp "$file" /tmp/sfl-break.bak
  OLD="$old" NEW="$new" F="$file" python3 -c 'import os;f=os.environ["F"];s=open(f).read();o=os.environ["OLD"];assert o in s,"anchor missing";open(f,"w").write(s.replace(o,os.environ["NEW"],1))' || { echo "?? $name (anchor missing)"; cp /tmp/sfl-break.bak "$file"; return; }
  if npx vitest run $T >/dev/null 2>&1; then echo "MISSED $name"; else echo "caught $name"; fi
  cp /tmp/sfl-break.bak "$file"
}
br "Facebook tab opens the TikTok sheet" src/redesign/screens/Invoicing.tsx 'tab === "facebook" && onReceiptFormat
          ?' 'false
          ?'
br "Facebook sheet for sellers WITHOUT the add-on" src/redesign/screens/Invoicing.tsx 'tab === "facebook" && onReceiptFormat
          ?' 'tab === "facebook"
          ?'
br "TikTok title not set" src/redesign/screens/Invoicing.tsx 'title={tab === "tiktok" ? t.rd_ivc_fmt_title_tt : undefined}' 'title={undefined}'
br "Message type row back" src/redesign/components/InvoiceFormatSheet.tsx '<div style={{ ...hint, marginBottom: 6 }}>{t.rd_ivc_fmt_fee_hint}</div>' '<div style={{ ...hint, marginBottom: 6 }}>{t.rd_ivc_fmt_fee_hint}</div><div data-testid="ivc-format-type">Message type</div>'
br "Facebook sheet saves the fee elsewhere" src/redesign/adapters/invoicing.ts '      invoice_shipping_fee: fee,
      updated_at' '      fb_shipping_fee: fee,
      updated_at'
br "Facebook sheet does not tell the screen (TikTok keeps the old note)" src/redesign/components/FbReceiptFormatSheet.tsx 'onSaved({ note: next.note, fee: next.fee });' ''
br "Facebook sheet drops the QR" src/redesign/adapters/invoicing.ts 'qr_image: f.qrImage && f.qrImage.length <= QR_DATA_URL_CAP ? f.qrImage : null,' 'qr_image: null,'
br "shared hint swapped" src/redesign/components/FbReceiptFormatSheet.tsx '{t.rd_ivc_fbf_shared_tt}' '{t.rd_ivc_fmt_shared_fb}'
br "sample without the shipping fee" src/redesign/components/FbReceiptFormatSheet.tsx 'labels, f.fee.trim() === "" ? 0 : priceOf(f.fee))' 'labels)'
br "Receipt format screen QR buttons changed" src/redesign/components/ReceiptFormatParts.tsx 'const b = tall ? { ...rcBtn(false), minHeight: 44 } : rcBtn(false);' 'const b = { ...rcBtn(false), minHeight: 44 };'
br "sample input changed for the screen" src/redesign/adapters/receiptSample.ts 'buyerNum: 12' 'buyerNum: 1'
br "TikTok message changed" src/redesign/adapters/invoicing.ts 'const fee = f.fee.trim() === "" ? null : Math.min(INVOICE_FEE_MAX, priceOf(f.fee));
    const { error } = await supabase.from("seller_receipt_settings").upsert({
      user_id: uid, note' 'const fee = f.fee.trim() === "" ? null : Math.min(INVOICE_FEE_MAX, priceOf(f.fee)) + 1;
    const { error } = await supabase.from("seller_receipt_settings").upsert({
      user_id: uid, note'
