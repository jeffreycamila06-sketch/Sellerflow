# Receipt format — Payment QR picture (branch `receipt-qr-picture`, 2026-11-12)

- `qr_card_{w360,iphone390,android412,w430,laptop1280}.jpg` — TODAY (main) vs NEW: the QR preview is a
  160 × 160 white box showing the WHOLE QR (contain, never cropped); Choose picture / Remove sit beside it and wrap
  below on a very narrow screen; tapping the box opens Choose picture.
- `sample_receipt_iphone390.jpg` — the sample receipt picture with the same saved QR: byte-identical (sha256 in
  `proof.txt`). The receipt drawing is not changed.
- `proof.txt` — the upload run on real files (sideways phone photo, HEIC with and without a file type, a phone
  screenshot): upright, ≤ 600 px, PNG, under the cap, the saved QR still decodes; main fails on HEIC.
