# SellerFlowLive — Deep Context

## What it is
Capacitor-based live-selling assistant app para sa TikTok/Facebook sellers sa Taiwan.
~45–53 active paying users. App is FREE to download; subscriptions (Basic/Pro/Master)
bayad manually via Wise + Telegram, LABAS ng Google Play. Free tier = cap-limited
sa 200 orders (hindi time-limited).

## Stack & infra
- Frontend: Vercel (auto-deploy) — sellerflowlive.com
- Backend: Render (sellerflow-live-server) — MANUAL DEPLOY LANG
- DB: Supabase "Sellerflow2" (sqeuyuktdpidmlfpqgoc) — FREE TIER (Pro canceled 2026-06-21)
- Capacitor pinned 8.3.4
- tiktok-live-connector pinned 2.1.1-beta1 exact (wag i-upgrade)

## ⚠️ Critical rules — WAG GALAWIN
- **billing orders ledger** may 200-cap trigger — wag galawin
- **live_session_orders** table = SEPARATE sa billing ledger (cross-device live session). RLS user_id=auth.uid(), keyed per user_id+session_date (Taipei). Write-on-1click + read-on-load LANG (zero poll — para wag maulit ang egress crisis)
- Render = manual deploy after every server.js push
- npm Cluster B (protobufjs/tiktok-live-connector/xlsx) — deliberately NOT forced (sira ang TikTok kung i-force)
- cron-job.org handles 3-hr restarts ng Render server (stale TikTok WebSocket)

## Egress (matuto sa nakaraan)
Dating crisis: in-app chat polling every 10s → sumabog ang egress. Fix: tinanggal chat,
Telegram redirect na lang. Lahat ng bagong feature: avoid polling. Write-on-action +
read-on-load lang.

## Native printing (pinaka-active na front)
- Slip: ESC/POS (Android + iOS), XP-N160II via WiFi/LAN TCP 9100
- Sticker: TSPL, AIMO D520BT (Bluetooth Classic SPP — DI compatible sa iOS BLE; iOS sticker permanently parked)
- 5 paper sizes via PER-SIZE CONFIG TABLE (total-isolation: bawat size own SizeConfig row sa Java/Swift/TS, golden-guarded). Sizes: 100×60 / 80×60 / 80×50 / 70×50 / 60×40
- ⚠️ 80×50 / 70×50 UNTESTED on paper — device-test Chinese-48 fit pag dumating papel
- Language-agnostic buyer names (commit acf4abd): Latin/Vietnamese → transliterate+font32; CJK → TSS24.BF2 48-tall; Arabic/Korean/Thai/unsupported → @handle or omit. AIMO hardware: ASCII + Simplified Chinese lang ang kayang i-render.

## iOS status
Apple Developer enrolled (W1850218684). iOS slip printing via XP-N160II viable.
iOS sticker = parked. Capacitor 8.3.4; iOS app loads remote sellerflowlive.com.

## Google Play
Closed-testing approval pending. Subscriptions outside Play (Wise + Telegram).

## NEXT
Build final APK (lahat ng native sticker + language changes) + distribute via Telegram.
Prior distributed APK lacks language/fill/isolation changes.

## TODO checks
- After Taipei 24:00 (2026-06-23): verify 23:59 date-filter reset ng loadTodaysLiveSession
