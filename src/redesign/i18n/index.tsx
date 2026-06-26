// Redesign i18n — REUSES production's translation data (translations.ts) without
// editing it. import-only (never edit translations.ts / useTranslation.ts / lib).
//
// AUTHORING SHAPE: `RAW` maps each NEW redesign key → its value in ALL 7 languages
// (en/fil/zh/zh-TW/vi/th/id) together. This guarantees every key is filled in every
// language (a test enforces it) and makes per-screen review easy. RAW is transposed
// into REDESIGN_STRINGS (Record<Lang, …>) at module load.
//
// ⚠️ NEW-KEY RULE: `en` is the real shipped English (byte-identical to the prior
// hardcoded text). zh-TW is NATIVE-VERIFIED (Jeff's Taiwan friend reviewed the full
// master list 2026-06-26 and confirmed all Traditional Chinese correct as-is). th/id
// (and the other-lang fil/vi/zh) remain AI drafts — no native verifier for those.
// Reused production keys (if any) keep production's values. New keys live ONLY here,
// never in translations.ts.
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { TRANSLATIONS, type Lang, type T } from "../../translations";

export type RedesignT = T & Record<string, string>;
const VALID_LANGS: Lang[] = ["en", "fil", "zh", "zh-TW", "vi", "th", "id"];

// Redesign picker code → production Lang. "zh-tw" → "zh-TW"; case-insensitive; unknown → "en".
export function normalizeLang(code: string): Lang {
  const c = (code || "").trim().toLowerCase();
  if (c === "zh-tw") return "zh-TW";
  return VALID_LANGS.find((l) => l.toLowerCase() === c) ?? "en";
}

// {placeholder} interpolation, mirroring production's tpl (App.tsx:61).
export function tpl(str: string, vars: Record<string, string | number>): string {
  return String(str || "").replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export type RedesignStrings = Record<Lang, Record<string, string>>;
type Row = Record<Lang, string>;

// ── NEW redesign keys: key → { 7 langs }. en = real English; zh-TW native-verified;
//    fil/zh/vi/th/id = AI drafts. ──
const RAW: Record<string, Row> = {
  // ════ Legal (Privacy & Terms) ════
  lg_pt_title: { en: "Privacy & Terms", fil: "Privacy at Mga Tuntunin", zh: "隐私与条款", "zh-TW": "隱私與條款", vi: "Quyền riêng tư & Điều khoản", th: "ความเป็นส่วนตัวและข้อกำหนด", id: "Privasi & Ketentuan" },
  lg_updated: { en: "Last updated Jun 1, 2026", fil: "Huling na-update Hun 1, 2026", zh: "最后更新于 2026年6月1日", "zh-TW": "最後更新於 2026年6月1日", vi: "Cập nhật lần cuối 1 thg 6, 2026", th: "อัปเดตล่าสุด 1 มิ.ย. 2026", id: "Terakhir diperbarui 1 Jun 2026" },
  lg_collect_h: { en: "1. Data we collect", fil: "1. Datos na kinokolekta namin", zh: "1. 我们收集的数据", "zh-TW": "1. 我們收集的資料", vi: "1. Dữ liệu chúng tôi thu thập", th: "1. ข้อมูลที่เราเก็บ", id: "1. Data yang kami kumpulkan" },
  lg_collect_p: { en: "SellerFlowLive captures public live-stream comments, buyer handles, and order details you create during live sessions. We store these to build order slips, analytics, and shipping records on your behalf.", fil: "Kinukuha ng SellerFlowLive ang mga pampublikong komento sa live, mga handle ng mamimili, at detalye ng order na ginagawa mo tuwing live. Iniimbak namin ito para gumawa ng order slip, analytics, at shipping records para sa iyo.", zh: "SellerFlowLive 会记录直播期间的公开评论、买家账号以及你创建的订单信息。我们储存这些数据，用于为你生成订单单据、分析报表和出货记录。", "zh-TW": "SellerFlowLive 會記錄直播期間的公開留言、買家帳號以及你建立的訂單資訊。我們儲存這些資料，用於為你產生訂單單據、分析報表與出貨紀錄。", vi: "SellerFlowLive ghi lại bình luận công khai trong buổi live, tên người mua và chi tiết đơn hàng bạn tạo trong phiên live. Chúng tôi lưu trữ để tạo phiếu đơn hàng, phân tích và hồ sơ giao hàng cho bạn.", th: "SellerFlowLive บันทึกคอมเมนต์สาธารณะระหว่างไลฟ์ ชื่อผู้ซื้อ และรายละเอียดออเดอร์ที่คุณสร้างระหว่างไลฟ์ เราจัดเก็บไว้เพื่อสร้างใบออเดอร์ รายงานวิเคราะห์ และบันทึกการจัดส่งให้คุณ", id: "SellerFlowLive merekam komentar live publik, handle pembeli, dan detail pesanan yang Anda buat selama sesi live. Kami menyimpannya untuk membuat slip pesanan, analitik, dan catatan pengiriman atas nama Anda." },
  lg_use_h: { en: "2. How we use it", fil: "2. Paano namin ito ginagamit", zh: "2. 我们如何使用", "zh-TW": "2. 我們如何使用", vi: "2. Cách chúng tôi sử dụng", th: "2. เราใช้ข้อมูลอย่างไร", id: "2. Bagaimana kami menggunakannya" },
  lg_use_p: { en: 'Data is used solely to operate your shop — detecting "mine" claims, generating slips, and reporting sales. We never sell customer data to third parties.', fil: 'Ginagamit lang ang datos para patakbuhin ang iyong shop — pag-detect ng "mine", paggawa ng slip, at pag-uulat ng benta. Hindi namin ibinebenta ang datos ng customer sa iba.', zh: '这些数据仅用于经营你的店铺——识别"mine"留言、生成单据和销售报表。我们绝不会把客户数据出售给第三方。', "zh-TW": "這些資料僅用於經營你的賣場——辨識「mine」留言、產生單據與銷售報表。我們絕不會將客戶資料出售給第三方。", vi: 'Dữ liệu chỉ dùng để vận hành cửa hàng của bạn — phát hiện bình luận "mine", tạo phiếu và báo cáo doanh số. Chúng tôi không bao giờ bán dữ liệu khách hàng cho bên thứ ba.', th: 'ข้อมูลใช้เพื่อดำเนินร้านของคุณเท่านั้น — ตรวจจับคอมเมนต์ "mine" สร้างใบออเดอร์ และรายงานยอดขาย เราไม่ขายข้อมูลลูกค้าให้บุคคลที่สาม', id: 'Data hanya digunakan untuk menjalankan toko Anda — mendeteksi komentar "mine", membuat slip, dan melaporkan penjualan. Kami tidak pernah menjual data pelanggan ke pihak ketiga.' },
  lg_rights_h: { en: "3. Your rights", fil: "3. Ang iyong mga karapatan", zh: "3. 你的权利", "zh-TW": "3. 你的權利", vi: "3. Quyền của bạn", th: "3. สิทธิ์ของคุณ", id: "3. Hak Anda" },
  lg_rights_p: { en: "You may export or permanently delete all shop and customer data at any time from Settings. Deletion is irreversible and completes within 30 days.", fil: "Maaari mong i-export o permanenteng burahin ang lahat ng datos ng shop at customer anumang oras sa Settings. Hindi na maibabalik ang pagbura at matatapos sa loob ng 30 araw.", zh: "你可以随时在设置中导出或永久删除所有店铺和客户数据。删除不可恢复，并会在 30 天内完成。", "zh-TW": "你可以隨時在設定中匯出或永久刪除所有賣場與客戶資料。刪除無法復原，並會在 30 天內完成。", vi: "Bạn có thể xuất hoặc xóa vĩnh viễn toàn bộ dữ liệu cửa hàng và khách hàng bất cứ lúc nào trong Cài đặt. Việc xóa là không thể hoàn tác và hoàn tất trong vòng 30 ngày.", th: "คุณสามารถส่งออกหรือลบข้อมูลร้านและลูกค้าทั้งหมดอย่างถาวรได้ทุกเมื่อในการตั้งค่า การลบไม่สามารถย้อนกลับได้และจะเสร็จสิ้นภายใน 30 วัน", id: "Anda dapat mengekspor atau menghapus permanen semua data toko dan pelanggan kapan saja dari Pengaturan. Penghapusan tidak dapat dibatalkan dan selesai dalam 30 hari." },
  lg_contact_h: { en: "4. Contact", fil: "4. Kontakin kami", zh: "4. 联系我们", "zh-TW": "4. 聯絡我們", vi: "4. Liên hệ", th: "4. ติดต่อเรา", id: "4. Kontak" },
  lg_contact_pre: { en: "Questions? Reach us on Telegram ", fil: "May tanong? Mag-message sa Telegram ", zh: "有疑问？请在 Telegram 联系我们 ", "zh-TW": "有疑問？請在 Telegram 聯絡我們 ", vi: "Có câu hỏi? Liên hệ Telegram ", th: "มีคำถาม? ติดต่อเราทาง Telegram ", id: "Ada pertanyaan? Hubungi kami di Telegram " },
  lg_contact_post: { en: " or email privacy@sellerflowlive.app.", fil: " o mag-email sa privacy@sellerflowlive.app.", zh: " 或发送邮件至 privacy@sellerflowlive.app。", "zh-TW": " 或寄信至 privacy@sellerflowlive.app。", vi: " hoặc email privacy@sellerflowlive.app.", th: " หรืออีเมล privacy@sellerflowlive.app", id: " atau email privacy@sellerflowlive.app." },

  // ════ Support ════
  rd_sup_title: { en: "Support", fil: "Suporta", zh: "支持", "zh-TW": "支援", vi: "Hỗ trợ", th: "ฝ่ายสนับสนุน", id: "Dukungan" },
  rd_sup_need: { en: "Need a hand?", fil: "Kailangan ng tulong?", zh: "需要帮助吗？", "zh-TW": "需要協助嗎？", vi: "Cần trợ giúp?", th: "ต้องการความช่วยเหลือ?", id: "Butuh bantuan?" },
  rd_sup_reply: { en: "We reply within minutes on Telegram during live hours.", fil: "Sumasagot kami sa loob ng ilang minuto sa Telegram tuwing live.", zh: "直播期间我们会在几分钟内通过 Telegram 回复。", "zh-TW": "直播期間我們會在幾分鐘內透過 Telegram 回覆。", vi: "Chúng tôi trả lời trong vài phút trên Telegram trong giờ live.", th: "เราตอบกลับภายในไม่กี่นาทีทาง Telegram ในช่วงเวลาไลฟ์", id: "Kami membalas dalam hitungan menit di Telegram selama jam live." },
  rd_sup_chat: { en: "Chat with", fil: "Mag-chat kay", zh: "联系", "zh-TW": "聯絡", vi: "Trò chuyện với", th: "แชทกับ", id: "Chat dengan" },
  rd_sup_g1: { en: "Connecting TikTok & Facebook live", fil: "Pagkonekta ng TikTok at Facebook live", zh: "连接 TikTok 和 Facebook 直播", "zh-TW": "連接 TikTok 與 Facebook 直播", vi: "Kết nối live TikTok & Facebook", th: "การเชื่อมต่อไลฟ์ TikTok และ Facebook", id: "Menghubungkan live TikTok & Facebook" },
  rd_sup_g2: { en: 'How "mine" auto-capture works', fil: 'Paano gumagana ang auto-capture ng "mine"', zh: '"mine" 自动捕捉的运作方式', "zh-TW": "「mine」自動擷取的運作方式", vi: 'Cách tự động ghi nhận "mine" hoạt động', th: 'การจับ "mine" อัตโนมัติทำงานอย่างไร', id: 'Cara kerja tangkapan otomatis "mine"' },
  rd_sup_g3: { en: "Printing slips & shipping orders", fil: "Pag-print ng slip at pag-ship ng order", zh: "打印单据和发货订单", "zh-TW": "列印單據與出貨訂單", vi: "In phiếu & giao đơn hàng", th: "การพิมพ์ใบออเดอร์และจัดส่งออเดอร์", id: "Mencetak slip & mengirim pesanan" },
  rd_sup_g4: { en: "Renewing your subscription", fil: "Pag-renew ng iyong subscription", zh: "续订你的订阅", "zh-TW": "續訂你的訂閱", vi: "Gia hạn đăng ký của bạn", th: "การต่ออายุการสมัครสมาชิก", id: "Memperpanjang langganan Anda" },
  rd_sup_guide: { en: "User guide", fil: "Gabay sa user", zh: "用户指南", "zh-TW": "使用者指南", vi: "Hướng dẫn sử dụng", th: "คู่มือผู้ใช้", id: "Panduan pengguna" },
  rd_sup_ver: { en: "SellerFlowLive v4.2 · ", fil: "SellerFlowLive v4.2 · ", zh: "SellerFlowLive v4.2 · ", "zh-TW": "SellerFlowLive v4.2 · ", vi: "SellerFlowLive v4.2 · ", th: "SellerFlowLive v4.2 · ", id: "SellerFlowLive v4.2 · " },

  // ════ Subscription ════
  rd_sub_title: { en: "Subscription", fil: "Subscription", zh: "订阅", "zh-TW": "訂閱", vi: "Đăng ký", th: "การสมัครสมาชิก", id: "Langganan" },
  rd_sub_current: { en: "CURRENT PLAN", fil: "KASALUKUYANG PLAN", zh: "当前方案", "zh-TW": "目前方案", vi: "GÓI HIỆN TẠI", th: "แผนปัจจุบัน", id: "PAKET SAAT INI" },
  rd_sub_active: { en: "ACTIVE", fil: "AKTIBO", zh: "有效", "zh-TW": "有效", vi: "ĐANG HOẠT ĐỘNG", th: "ใช้งานอยู่", id: "AKTIF" },
  rd_sub_expired: { en: "EXPIRED", fil: "EXPIRED", zh: "已过期", "zh-TW": "已過期", vi: "HẾT HẠN", th: "หมดอายุ", id: "KEDALUWARSA" },
  rd_sub_pending: { en: "PENDING", fil: "NAKABINBIN", zh: "待处理", "zh-TW": "待處理", vi: "ĐANG CHỜ", th: "รอดำเนินการ", id: "TERTUNDA" },
  rd_sub_per_month: { en: "/ month", fil: "/ buwan", zh: "/ 月", "zh-TW": "/ 月", vi: "/ tháng", th: "/ เดือน", id: "/ bulan" },
  rd_sub_free_tier: { en: "Free tier", fil: "Libreng tier", zh: "免费版", "zh-TW": "免費版", vi: "Gói miễn phí", th: "ระดับฟรี", id: "Tingkat gratis" },
  rd_sub_renews: { en: "Renews on", fil: "Mariri-renew sa", zh: "续订于", "zh-TW": "續訂於", vi: "Gia hạn vào", th: "ต่ออายุวันที่", id: "Diperpanjang pada" },
  rd_sub_days_left: { en: "Days left", fil: "Natitirang araw", zh: "剩余天数", "zh-TW": "剩餘天數", vi: "Số ngày còn lại", th: "วันที่เหลือ", id: "Sisa hari" },
  rd_sub_days_unit: { en: "days", fil: "araw", zh: "天", "zh-TW": "天", vi: "ngày", th: "วัน", id: "hari" },
  rd_sub_free_orders: { en: "Free orders this cycle", fil: "Libreng order ngayong cycle", zh: "本周期的免费订单", "zh-TW": "本週期的免費訂單", vi: "Đơn miễn phí chu kỳ này", th: "ออเดอร์ฟรีรอบนี้", id: "Pesanan gratis siklus ini" },
  rd_sub_resets_one: { en: "Resets in {n} day", fil: "Magre-reset sa {n} araw", zh: "{n} 天后重置", "zh-TW": "{n} 天後重置", vi: "Đặt lại sau {n} ngày", th: "รีเซ็ตใน {n} วัน", id: "Reset dalam {n} hari" },
  rd_sub_resets_many: { en: "Resets in {n} days", fil: "Magre-reset sa {n} araw", zh: "{n} 天后重置", "zh-TW": "{n} 天後重置", vi: "Đặt lại sau {n} ngày", th: "รีเซ็ตใน {n} วัน", id: "Reset dalam {n} hari" },
  rd_sub_included: { en: "Included in {plan}", fil: "Kasama sa {plan}", zh: "{plan} 包含", "zh-TW": "{plan} 包含", vi: "Bao gồm trong {plan}", th: "รวมอยู่ใน {plan}", id: "Termasuk dalam {plan}" },
  rd_sub_f1: { en: "Unlimited live sessions", fil: "Walang limitasyong live session", zh: "无限直播场次", "zh-TW": "無限直播場次", vi: "Phiên live không giới hạn", th: "ไลฟ์ได้ไม่จำกัด", id: "Sesi live tanpa batas" },
  rd_sub_f2: { en: 'Auto "mine" detection & order slips', fil: 'Auto-detect ng "mine" at order slip', zh: '自动识别"mine"与订单单据', "zh-TW": "自動辨識「mine」與訂單單據", vi: 'Tự động phát hiện "mine" & phiếu đơn', th: 'ตรวจจับ "mine" อัตโนมัติและใบออเดอร์', id: 'Deteksi otomatis "mine" & slip pesanan' },
  rd_sub_f3: { en: "TikTok + Facebook channels", fil: "TikTok + Facebook channels", zh: "TikTok + Facebook 频道", "zh-TW": "TikTok + Facebook 頻道", vi: "Kênh TikTok + Facebook", th: "ช่อง TikTok + Facebook", id: "Saluran TikTok + Facebook" },
  rd_sub_f4: { en: "Printer & shipping tools", fil: "Mga tool sa printer at shipping", zh: "打印机与发货工具", "zh-TW": "印表機與出貨工具", vi: "Công cụ in & giao hàng", th: "เครื่องมือพิมพ์และจัดส่ง", id: "Alat printer & pengiriman" },
  rd_sub_renew_tg: { en: "Renew via Telegram", fil: "Mag-renew sa Telegram", zh: "通过 Telegram 续订", "zh-TW": "透過 Telegram 續訂", vi: "Gia hạn qua Telegram", th: "ต่ออายุผ่าน Telegram", id: "Perpanjang via Telegram" },
  rd_sub_msg_pre: { en: "Message ", fil: "Mag-message kay ", zh: "发送消息给 ", "zh-TW": "傳訊給 ", vi: "Nhắn tin ", th: "ส่งข้อความหา ", id: "Kirim pesan ke " },
  rd_sub_msg_post: { en: " to renew or upgrade", fil: " para mag-renew o mag-upgrade", zh: " 以续订或升级", "zh-TW": " 以續訂或升級", vi: " để gia hạn hoặc nâng cấp", th: " เพื่อต่ออายุหรืออัปเกรด", id: " untuk memperpanjang atau upgrade" },

  // ════ Delete Account ════
  rd_del_title: { en: "Delete account", fil: "Burahin ang account", zh: "删除账户", "zh-TW": "刪除帳號", vi: "Xóa tài khoản", th: "ลบบัญชี", id: "Hapus akun" },
  rd_del_heading: { en: "Delete this seller account", fil: "Burahin ang seller account na ito", zh: "删除此卖家账户", "zh-TW": "刪除此賣家帳號", vi: "Xóa tài khoản người bán này", th: "ลบบัญชีผู้ขายนี้", id: "Hapus akun penjual ini" },
  rd_del_desc_pre: { en: "This will delete the seller account for ", fil: "Buburahin nito ang seller account para sa ", zh: "这将删除以下卖家账户：", "zh-TW": "這將刪除以下賣家帳號：", vi: "Thao tác này sẽ xóa tài khoản người bán của ", th: "การดำเนินการนี้จะลบบัญชีผู้ขายสำหรับ ", id: "Ini akan menghapus akun penjual untuk " },
  rd_del_desc_post: { en: ", sign out this browser, and remove support messages for this email where possible.", fil: ", mag-sign out sa browser na ito, at aalisin ang mga support message para sa email na ito kung maaari.", zh: "，退出此浏览器，并尽可能删除此邮箱的支持消息。", "zh-TW": "，登出此瀏覽器，並盡可能移除此電子郵件的支援訊息。", vi: ", đăng xuất trình duyệt này và xóa tin nhắn hỗ trợ cho email này nếu có thể.", th: " ออกจากระบบเบราว์เซอร์นี้ และลบข้อความสนับสนุนสำหรับอีเมลนี้หากเป็นไปได้", id: ", keluar dari browser ini, dan menghapus pesan dukungan untuk email ini jika memungkinkan." },
  rd_del_your_account: { en: "your account", fil: "ang iyong account", zh: "你的账户", "zh-TW": "你的帳號", vi: "tài khoản của bạn", th: "บัญชีของคุณ", id: "akun Anda" },
  rd_del_records: { en: "Order, buyer, payment, audit, or legal records may be kept if needed for business history, security, or law.", fil: "Maaaring panatilihin ang mga record ng order, mamimili, bayad, audit, o legal kung kailangan para sa kasaysayan ng negosyo, seguridad, o batas.", zh: "如出于业务记录、安全或法律需要，订单、买家、付款、审计或法律记录可能会被保留。", "zh-TW": "如因業務紀錄、安全或法律需要，訂單、買家、付款、稽核或法律紀錄可能會被保留。", vi: "Hồ sơ đơn hàng, người mua, thanh toán, kiểm toán hoặc pháp lý có thể được giữ lại nếu cần cho lịch sử kinh doanh, bảo mật hoặc pháp luật.", th: "บันทึกออเดอร์ ผู้ซื้อ การชำระเงิน การตรวจสอบ หรือทางกฎหมายอาจถูกเก็บไว้หากจำเป็นสำหรับประวัติธุรกิจ ความปลอดภัย หรือกฎหมาย", id: "Catatan pesanan, pembeli, pembayaran, audit, atau hukum dapat disimpan jika diperlukan untuk riwayat bisnis, keamanan, atau hukum." },
  rd_del_type_email: { en: "Type your email to confirm", fil: "I-type ang iyong email para kumpirmahin", zh: "输入你的邮箱以确认", "zh-TW": "輸入你的電子郵件以確認", vi: "Nhập email của bạn để xác nhận", th: "พิมพ์อีเมลของคุณเพื่อยืนยัน", id: "Ketik email Anda untuk konfirmasi" },
  rd_del_warning_pre: { en: "Warning: ", fil: "Babala: ", zh: "警告：", "zh-TW": "警告：", vi: "Cảnh báo: ", th: "คำเตือน: ", id: "Peringatan: " },
  rd_del_fail: { en: "Delete failed. Please try again.", fil: "Nabigo ang pagbura. Subukan ulit.", zh: "删除失败，请重试。", "zh-TW": "刪除失敗，請重試。", vi: "Xóa thất bại. Vui lòng thử lại.", th: "ลบไม่สำเร็จ กรุณาลองใหม่", id: "Gagal menghapus. Silakan coba lagi." },
  rd_del_deleting: { en: "Deleting…", fil: "Binubura…", zh: "正在删除…", "zh-TW": "正在刪除…", vi: "Đang xóa…", th: "กำลังลบ…", id: "Menghapus…" },
  rd_del_confirm_btn: { en: "Delete my account", fil: "Burahin ang aking account", zh: "删除我的账户", "zh-TW": "刪除我的帳號", vi: "Xóa tài khoản của tôi", th: "ลบบัญชีของฉัน", id: "Hapus akun saya" },
  rd_del_keep: { en: "Keep my account", fil: "Panatilihin ang aking account", zh: "保留我的账户", "zh-TW": "保留我的帳號", vi: "Giữ tài khoản của tôi", th: "เก็บบัญชีของฉันไว้", id: "Pertahankan akun saya" },

  // ════ Cap popup (free-tier) ════
  rd_cap_hard_title: { en: "You've reached your {cap}-order limit", fil: "Naabot mo na ang {cap}-order na limit", zh: "你已达到 {cap} 单的上限", "zh-TW": "你已達到 {cap} 筆訂單的上限", vi: "Bạn đã đạt giới hạn {cap} đơn", th: "คุณถึงขีดจำกัด {cap} ออเดอร์แล้ว", id: "Anda mencapai batas {cap} pesanan" },
  rd_cap_near_title: { en: "You're almost there!", fil: "Malapit ka na!", zh: "就快到上限了！", "zh-TW": "就快到上限了！", vi: "Sắp đạt rồi!", th: "ใกล้ถึงแล้ว!", id: "Hampir mencapai batas!" },
  rd_cap_hard_msg_one: { en: "You've used all {cap} free orders this cycle. It resets in {days} day — or upgrade to keep selling now.", fil: "Naubos mo na ang lahat ng {cap} libreng order ngayong cycle. Magre-reset ito sa {days} araw — o mag-upgrade para magpatuloy sa pagbebenta ngayon.", zh: "本周期的 {cap} 个免费订单已用完。将在 {days} 天后重置——或立即升级以继续销售。", "zh-TW": "本週期的 {cap} 筆免費訂單已用完。將在 {days} 天後重置——或立即升級以繼續銷售。", vi: "Bạn đã dùng hết {cap} đơn miễn phí chu kỳ này. Sẽ đặt lại sau {days} ngày — hoặc nâng cấp để tiếp tục bán ngay.", th: "คุณใช้ออเดอร์ฟรีครบ {cap} รายการในรอบนี้แล้ว จะรีเซ็ตใน {days} วัน — หรืออัปเกรดเพื่อขายต่อทันที", id: "Anda telah memakai semua {cap} pesanan gratis siklus ini. Reset dalam {days} hari — atau upgrade untuk terus berjualan sekarang." },
  rd_cap_hard_msg_many: { en: "You've used all {cap} free orders this cycle. It resets in {days} days — or upgrade to keep selling now.", fil: "Naubos mo na ang lahat ng {cap} libreng order ngayong cycle. Magre-reset ito sa {days} araw — o mag-upgrade para magpatuloy sa pagbebenta ngayon.", zh: "本周期的 {cap} 个免费订单已用完。将在 {days} 天后重置——或立即升级以继续销售。", "zh-TW": "本週期的 {cap} 筆免費訂單已用完。將在 {days} 天後重置——或立即升級以繼續銷售。", vi: "Bạn đã dùng hết {cap} đơn miễn phí chu kỳ này. Sẽ đặt lại sau {days} ngày — hoặc nâng cấp để tiếp tục bán ngay.", th: "คุณใช้ออเดอร์ฟรีครบ {cap} รายการในรอบนี้แล้ว จะรีเซ็ตใน {days} วัน — หรืออัปเกรดเพื่อขายต่อทันที", id: "Anda telah memakai semua {cap} pesanan gratis siklus ini. Reset dalam {days} hari — atau upgrade untuk terus berjualan sekarang." },
  rd_cap_near_msg: { en: "Only {left} of your {cap} free orders left this cycle. Upgrade for unlimited orders.", fil: "{left} na lang sa iyong {cap} libreng order ang natitira ngayong cycle. Mag-upgrade para sa walang limitasyong order.", zh: "本周期你的 {cap} 个免费订单只剩 {left} 个。升级以获得无限订单。", "zh-TW": "本週期你的 {cap} 筆免費訂單只剩 {left} 筆。升級以獲得無限訂單。", vi: "Chỉ còn {left} trong {cap} đơn miễn phí chu kỳ này. Nâng cấp để có đơn không giới hạn.", th: "เหลือเพียง {left} จาก {cap} ออเดอร์ฟรีในรอบนี้ อัปเกรดเพื่อออเดอร์ไม่จำกัด", id: "Hanya tersisa {left} dari {cap} pesanan gratis siklus ini. Upgrade untuk pesanan tanpa batas." },
  rd_cap_upgrade: { en: "Upgrade plan", fil: "Mag-upgrade ng plan", zh: "升级方案", "zh-TW": "升級方案", vi: "Nâng cấp gói", th: "อัปเกรดแผน", id: "Upgrade paket" },
  rd_cap_view_orders: { en: "View my orders", fil: "Tingnan ang aking mga order", zh: "查看我的订单", "zh-TW": "查看我的訂單", vi: "Xem đơn hàng của tôi", th: "ดูออเดอร์ของฉัน", id: "Lihat pesanan saya" },
  rd_cap_later: { en: "Maybe later", fil: "Sa susunod na lang", zh: "以后再说", "zh-TW": "稍後再說", vi: "Để sau", th: "ไว้ก่อน", id: "Nanti saja" },

  // ════ Shared ════
  rd_export: { en: "⬇ Export", fil: "⬇ I-export", zh: "⬇ 导出", "zh-TW": "⬇ 匯出", vi: "⬇ Xuất", th: "⬇ ส่งออก", id: "⬇ Ekspor" },

  // ════ Orders ════
  rd_ord_title: { en: "Orders", fil: "Mga Order", zh: "订单", "zh-TW": "訂單", vi: "Đơn hàng", th: "ออเดอร์", id: "Pesanan" },
  rd_ord_today: { en: "Today", fil: "Ngayon", zh: "今天", "zh-TW": "今天", vi: "Hôm nay", th: "วันนี้", id: "Hari ini" },
  rd_ord_all: { en: "All", fil: "Lahat", zh: "全部", "zh-TW": "全部", vi: "Tất cả", th: "ทั้งหมด", id: "Semua" },
  rd_ord_unpaid: { en: "Unpaid", fil: "Hindi bayad", zh: "未付款", "zh-TW": "未付款", vi: "Chưa thanh toán", th: "ยังไม่ชำระ", id: "Belum bayar" },
  rd_ord_paid: { en: "Paid", fil: "Bayad", zh: "已付款", "zh-TW": "已付款", vi: "Đã thanh toán", th: "ชำระแล้ว", id: "Sudah bayar" },
  rd_ord_shipped: { en: "Shipped", fil: "Naipadala", zh: "已发货", "zh-TW": "已出貨", vi: "Đã giao", th: "จัดส่งแล้ว", id: "Dikirim" },
  rd_ord_loading: { en: "Loading today’s orders…", fil: "Nilo-load ang mga order ngayon…", zh: "正在加载今天的订单…", "zh-TW": "正在載入今天的訂單…", vi: "Đang tải đơn hàng hôm nay…", th: "กำลังโหลดออเดอร์วันนี้…", id: "Memuat pesanan hari ini…" },
  rd_ord_empty: { en: "No orders yet today.", fil: "Wala pang order ngayon.", zh: "今天还没有订单。", "zh-TW": "今天還沒有訂單。", vi: "Chưa có đơn hàng nào hôm nay.", th: "ยังไม่มีออเดอร์วันนี้", id: "Belum ada pesanan hari ini." },
  rd_ord_print_slip: { en: "Print slip", fil: "I-print ang slip", zh: "打印单据", "zh-TW": "列印單據", vi: "In phiếu", th: "พิมพ์ใบออเดอร์", id: "Cetak slip" },
  rd_ord_ago: { en: "ago", fil: "ang nakalipas", zh: "前", "zh-TW": "前", vi: "trước", th: "ที่แล้ว", id: "lalu" },

  // ════ Customers ════
  rd_cus_title: { en: "Customers", fil: "Mga Customer", zh: "客户", "zh-TW": "客戶", vi: "Khách hàng", th: "ลูกค้า", id: "Pelanggan" },
  rd_cus_total_suffix: { en: "total", fil: "kabuuan", zh: "总计", "zh-TW": "總計", vi: "tổng", th: "ทั้งหมด", id: "total" },
  rd_cus_search: { en: "Search name or @handle", fil: "Maghanap ng pangalan o @handle", zh: "搜索名称或 @handle", "zh-TW": "搜尋名稱或 @handle", vi: "Tìm tên hoặc @handle", th: "ค้นหาชื่อหรือ @handle", id: "Cari nama atau @handle" },
  rd_cus_loading: { en: "Loading customers…", fil: "Nilo-load ang mga customer…", zh: "正在加载客户…", "zh-TW": "正在載入客戶…", vi: "Đang tải khách hàng…", th: "กำลังโหลดลูกค้า…", id: "Memuat pelanggan…" },
  rd_cus_empty: { en: "No customers yet.", fil: "Wala pang customer.", zh: "还没有客户。", "zh-TW": "還沒有客戶。", vi: "Chưa có khách hàng.", th: "ยังไม่มีลูกค้า", id: "Belum ada pelanggan." },
  rd_cus_orders_suffix: { en: "orders", fil: "order", zh: "订单", "zh-TW": "訂單", vi: "đơn", th: "ออเดอร์", id: "pesanan" },
  rd_cus_archive: { en: "Comment archive", fil: "Archive ng komento", zh: "评论存档", "zh-TW": "留言封存", vi: "Lưu trữ bình luận", th: "คลังคอมเมนต์", id: "Arsip komentar" },

  // ════ Products ════
  rd_prd_title: { en: "Products", fil: "Mga Produkto", zh: "产品", "zh-TW": "產品", vi: "Sản phẩm", th: "สินค้า", id: "Produk" },
  rd_prd_soon: { en: "Soon · cross-device", fil: "Soon · cross-device", zh: "即将推出 · 跨设备", "zh-TW": "即將推出 · 跨裝置", vi: "Sắp có · đa thiết bị", th: "เร็วๆ นี้ · ข้ามอุปกรณ์", id: "Segera · lintas perangkat" },
  rd_prd_add: { en: "+ Add", fil: "+ Magdagdag", zh: "+ 添加", "zh-TW": "+ 新增", vi: "+ Thêm", th: "+ เพิ่ม", id: "+ Tambah" },
  rd_prd_search: { en: "Search name or SKU", fil: "Maghanap ng pangalan o SKU", zh: "搜索名称或 SKU", "zh-TW": "搜尋名稱或 SKU", vi: "Tìm tên hoặc SKU", th: "ค้นหาชื่อหรือ SKU", id: "Cari nama atau SKU" },
  rd_prd_confirm_del: { en: "Delete this product?", fil: "Burahin ang produktong ito?", zh: "删除此产品？", "zh-TW": "刪除此產品？", vi: "Xóa sản phẩm này?", th: "ลบสินค้านี้?", id: "Hapus produk ini?" },
  rd_prd_total: { en: "Total", fil: "Kabuuan", zh: "总计", "zh-TW": "總計", vi: "Tổng", th: "ทั้งหมด", id: "Total" },
  rd_prd_instock: { en: "In stock", fil: "May stock", zh: "有库存", "zh-TW": "有庫存", vi: "Còn hàng", th: "มีสต็อก", id: "Tersedia" },
  rd_prd_low: { en: "Low", fil: "Mababa", zh: "偏低", "zh-TW": "偏低", vi: "Sắp hết", th: "ใกล้หมด", id: "Sedikit" },
  rd_prd_out: { en: "Out", fil: "Ubos", zh: "缺货", "zh-TW": "缺貨", vi: "Hết", th: "หมด", id: "Habis" },
  rd_prd_empty: { en: "No products.", fil: "Walang produkto.", zh: "没有产品。", "zh-TW": "沒有產品。", vi: "Không có sản phẩm.", th: "ไม่มีสินค้า", id: "Tidak ada produk." },
  rd_prd_left: { en: "left", fil: "natitira", zh: "剩余", "zh-TW": "剩餘", vi: "còn lại", th: "เหลือ", id: "tersisa" },
  rd_prd_edit: { en: "Edit product", fil: "I-edit ang produkto", zh: "编辑产品", "zh-TW": "編輯產品", vi: "Sửa sản phẩm", th: "แก้ไขสินค้า", id: "Edit produk" },
  rd_prd_add_title: { en: "Add product", fil: "Magdagdag ng produkto", zh: "添加产品", "zh-TW": "新增產品", vi: "Thêm sản phẩm", th: "เพิ่มสินค้า", id: "Tambah produk" },
  rd_prd_name: { en: "Name", fil: "Pangalan", zh: "名称", "zh-TW": "名稱", vi: "Tên", th: "ชื่อ", id: "Nama" },
  rd_prd_sku: { en: "SKU", fil: "SKU", zh: "SKU", "zh-TW": "SKU", vi: "SKU", th: "SKU", id: "SKU" },
  rd_prd_price: { en: "Price", fil: "Presyo", zh: "价格", "zh-TW": "價格", vi: "Giá", th: "ราคา", id: "Harga" },
  rd_prd_stock: { en: "Stock", fil: "Stock", zh: "库存", "zh-TW": "庫存", vi: "Tồn kho", th: "สต็อก", id: "Stok" },
  rd_prd_platform: { en: "Platform", fil: "Platform", zh: "平台", "zh-TW": "平台", vi: "Nền tảng", th: "แพลตฟอร์ม", id: "Platform" },
  rd_prd_status_will: { en: "Status will be: ", fil: "Magiging status: ", zh: "状态将为：", "zh-TW": "狀態將為：", vi: "Trạng thái sẽ là: ", th: "สถานะจะเป็น: ", id: "Status akan menjadi: " },
  rd_prd_st_active: { en: "Active", fil: "Aktibo", zh: "有货", "zh-TW": "有貨", vi: "Còn hàng", th: "พร้อมขาย", id: "Aktif" },
  rd_prd_st_low: { en: "Low stock", fil: "Mababang stock", zh: "库存偏低", "zh-TW": "庫存偏低", vi: "Sắp hết hàng", th: "สต็อกใกล้หมด", id: "Stok menipis" },
  rd_prd_st_out: { en: "Out of stock", fil: "Ubos na stock", zh: "缺货", "zh-TW": "缺貨", vi: "Hết hàng", th: "สินค้าหมด", id: "Stok habis" },
  rd_prd_cancel: { en: "Cancel", fil: "Kanselahin", zh: "取消", "zh-TW": "取消", vi: "Hủy", th: "ยกเลิก", id: "Batal" },
  rd_prd_save: { en: "Save", fil: "I-save", zh: "保存", "zh-TW": "儲存", vi: "Lưu", th: "บันทึก", id: "Simpan" },
  rd_prd_edit_btn: { en: "Edit", fil: "I-edit", zh: "编辑", "zh-TW": "編輯", vi: "Sửa", th: "แก้ไข", id: "Edit" },
  rd_prd_delete_btn: { en: "Delete", fil: "Burahin", zh: "删除", "zh-TW": "刪除", vi: "Xóa", th: "ลบ", id: "Hapus" },

  // ════ Miners ════
  rd_min_title: { en: "Miners", fil: "Miners", zh: "Miners", "zh-TW": "Miners", vi: "Miners", th: "Miners", id: "Miners" },
  rd_min_sub: { en: 'Buyers who claimed "mine"', fil: 'Mga mamimiling nag-claim ng "mine"', zh: '认领了"mine"的买家', "zh-TW": "認領「mine」的買家", vi: 'Người mua đã nhận "mine"', th: 'ผู้ซื้อที่พิมพ์ "mine"', id: 'Pembeli yang klaim "mine"' },
  rd_min_30days: { en: "30 days ▾", fil: "30 araw ▾", zh: "30 天 ▾", "zh-TW": "30 天 ▾", vi: "30 ngày ▾", th: "30 วัน ▾", id: "30 hari ▾" },
  rd_min_total_buyers: { en: "Total buyers", fil: "Kabuuang mamimili", zh: "买家总数", "zh-TW": "買家總數", vi: "Tổng người mua", th: "ผู้ซื้อทั้งหมด", id: "Total pembeli" },
  rd_min_up12: { en: "▲ 12% this month", fil: "▲ 12% ngayong buwan", zh: "▲ 本月 12%", "zh-TW": "▲ 本月 12%", vi: "▲ 12% tháng này", th: "▲ 12% เดือนนี้", id: "▲ 12% bulan ini" },
  rd_min_total_orders: { en: "Total orders", fil: "Kabuuang order", zh: "订单总数", "zh-TW": "訂單總數", vi: "Tổng đơn hàng", th: "ออเดอร์ทั้งหมด", id: "Total pesanan" },
  rd_min_up8: { en: "▲ 8% this month", fil: "▲ 8% ngayong buwan", zh: "▲ 本月 8%", "zh-TW": "▲ 本月 8%", vi: "▲ 8% tháng này", th: "▲ 8% เดือนนี้", id: "▲ 8% bulan ini" },
  rd_min_total_spent: { en: "Total spent", fil: "Kabuuang nagastos", zh: "总消费", "zh-TW": "總消費", vi: "Tổng chi tiêu", th: "ยอดใช้จ่ายรวม", id: "Total belanja" },
  rd_min_avg_order: { en: "avg order", fil: "avg na order", zh: "平均订单", "zh-TW": "平均訂單", vi: "đơn trung bình", th: "เฉลี่ยต่อออเดอร์", id: "rata-rata pesanan" },
  rd_min_platforms: { en: "Platforms", fil: "Mga platform", zh: "平台", "zh-TW": "平台", vi: "Nền tảng", th: "แพลตฟอร์ม", id: "Platform" },
  rd_min_top_buyers: { en: "Top buyers", fil: "Nangungunang mamimili", zh: "顶级买家", "zh-TW": "頂尖買家", vi: "Người mua hàng đầu", th: "ผู้ซื้อยอดนิยม", id: "Pembeli teratas" },
  rd_min_empty: { en: "No buyers yet.", fil: "Wala pang mamimili.", zh: "还没有买家。", "zh-TW": "還沒有買家。", vi: "Chưa có người mua.", th: "ยังไม่มีผู้ซื้อ", id: "Belum ada pembeli." },

  // ════ Sales report ════
  rd_sal_title: { en: "Sales report", fil: "Sales report", zh: "销售报表", "zh-TW": "銷售報表", vi: "Báo cáo doanh số", th: "รายงานยอดขาย", id: "Laporan penjualan" },
  rd_sal_this_session: { en: "This live session", fil: "Ngayong live session", zh: "本场直播", "zh-TW": "本場直播", vi: "Phiên live này", th: "ไลฟ์รอบนี้", id: "Sesi live ini" },
  rd_sal_empty: { en: "No sales yet this session.", fil: "Wala pang benta ngayong session.", zh: "本场还没有销售。", "zh-TW": "本場還沒有銷售。", vi: "Chưa có doanh số phiên này.", th: "ยังไม่มียอดขายในรอบนี้", id: "Belum ada penjualan sesi ini." },
  rd_sal_revenue: { en: "Revenue", fil: "Kita", zh: "营收", "zh-TW": "營收", vi: "Doanh thu", th: "รายได้", id: "Pendapatan" },
  rd_sal_avg: { en: "avg", fil: "avg", zh: "平均", "zh-TW": "平均", vi: "TB", th: "เฉลี่ย", id: "rata-rata" },
  rd_sal_buyers: { en: "Buyers", fil: "Mamimili", zh: "买家", "zh-TW": "買家", vi: "Người mua", th: "ผู้ซื้อ", id: "Pembeli" },
  rd_sal_avg_order: { en: "Avg order", fil: "Avg na order", zh: "平均订单", "zh-TW": "平均訂單", vi: "Đơn trung bình", th: "เฉลี่ยต่อออเดอร์", id: "Rata-rata pesanan" },
  rd_sal_top_products: { en: "Top products", fil: "Nangungunang produkto", zh: "热销产品", "zh-TW": "熱銷產品", vi: "Sản phẩm bán chạy", th: "สินค้าขายดี", id: "Produk terlaris" },
  rd_sal_no_sales: { en: "No sales yet.", fil: "Wala pang benta.", zh: "还没有销售。", "zh-TW": "還沒有銷售。", vi: "Chưa có doanh số.", th: "ยังไม่มียอดขาย", id: "Belum ada penjualan." },
  rd_sal_sold: { en: "sold", fil: "naibenta", zh: "已售", "zh-TW": "已售", vi: "đã bán", th: "ขายแล้ว", id: "terjual" },
  rd_sal_rev_platform: { en: "Revenue by platform", fil: "Kita kada platform", zh: "各平台营收", "zh-TW": "各平台營收", vi: "Doanh thu theo nền tảng", th: "รายได้ตามแพลตฟอร์ม", id: "Pendapatan per platform" },

  // ════ Customer data (admin export) ════
  rd_cd_title: { en: "Customer data", fil: "Datos ng customer", zh: "客户数据", "zh-TW": "客戶資料", vi: "Dữ liệu khách hàng", th: "ข้อมูลลูกค้า", id: "Data pelanggan" },
  rd_cd_admin_export: { en: "Admin export", fil: "Admin export", zh: "管理员导出", "zh-TW": "管理員匯出", vi: "Xuất quản trị", th: "ส่งออกสำหรับแอดมิน", id: "Ekspor admin" },
  rd_cd_export_csv: { en: "Export CSV", fil: "I-export ang CSV", zh: "导出 CSV", "zh-TW": "匯出 CSV", vi: "Xuất CSV", th: "ส่งออก CSV", id: "Ekspor CSV" },
  rd_cd_col_customer: { en: "CUSTOMER", fil: "CUSTOMER", zh: "客户", "zh-TW": "客戶", vi: "KHÁCH HÀNG", th: "ลูกค้า", id: "PELANGGAN" },
  rd_cd_col_orders: { en: "ORDERS", fil: "ORDER", zh: "订单", "zh-TW": "訂單", vi: "ĐƠN HÀNG", th: "ออเดอร์", id: "PESANAN" },
  rd_cd_col_spent: { en: "SPENT", fil: "NAGASTOS", zh: "消费", "zh-TW": "消費", vi: "ĐÃ CHI", th: "ยอดใช้จ่าย", id: "BELANJA" },
  rd_cd_foot_pre: { en: "Customer data is encrypted and handled per our ", fil: "Ang datos ng customer ay naka-encrypt at hinahawakan ayon sa aming ", zh: "客户数据已加密，并按照我们的", "zh-TW": "客戶資料已加密，並依照我們的", vi: "Dữ liệu khách hàng được mã hóa và xử lý theo ", th: "ข้อมูลลูกค้าถูกเข้ารหัสและจัดการตาม", id: "Data pelanggan dienkripsi dan ditangani sesuai " },
  rd_cd_privacy_policy: { en: "Privacy Policy", fil: "Patakaran sa Privacy", zh: "隐私政策", "zh-TW": "隱私政策", vi: "Chính sách bảo mật", th: "นโยบายความเป็นส่วนตัว", id: "Kebijakan Privasi" },
  rd_cd_foot_post: { en: ". Export access is logged.", fil: ". Naka-log ang access sa export.", zh: "。导出访问会被记录。", "zh-TW": "。匯出存取會被記錄。", vi: ". Quyền truy cập xuất được ghi lại.", th: " การเข้าถึงการส่งออกจะถูกบันทึก", id: ". Akses ekspor dicatat." },

  // ════ Dashboard (live) ════
  rd_dash_session_title: { en: "Set how many days this live runs before shipping", fil: "Itakda kung ilang araw tatagal ang live bago mag-ship", zh: "设置本场直播在发货前持续几天", "zh-TW": "設定本場直播在出貨前持續幾天", vi: "Đặt số ngày live này kéo dài trước khi giao", th: "ตั้งค่าจำนวนวันที่ไลฟ์นี้ดำเนินก่อนจัดส่ง", id: "Atur berapa hari live ini berjalan sebelum pengiriman" },
  rd_dash_session: { en: "Session", fil: "Session", zh: "场次", "zh-TW": "場次", vi: "Phiên", th: "รอบ", id: "Sesi" },
  rd_dash_day: { en: "day", fil: "araw", zh: "天", "zh-TW": "天", vi: "ngày", th: "วัน", id: "hari" },
  rd_dash_days: { en: "days", fil: "araw", zh: "天", "zh-TW": "天", vi: "ngày", th: "วัน", id: "hari" },
  rd_dash_session_length: { en: "LIVE SESSION LENGTH", fil: "HABA NG LIVE SESSION", zh: "直播场次长度", "zh-TW": "直播場次長度", vi: "ĐỘ DÀI PHIÊN LIVE", th: "ความยาวรอบไลฟ์", id: "DURASI SESI LIVE" },
  rd_dash_ship_same_day: { en: "Ship same day", fil: "I-ship sa parehong araw", zh: "当天发货", "zh-TW": "當天出貨", vi: "Giao trong ngày", th: "จัดส่งวันเดียวกัน", id: "Kirim hari yang sama" },
  rd_dash_nday_live: { en: "{n}-day live before sending", fil: "{n}-araw na live bago ipadala", zh: "{n} 天直播后再发货", "zh-TW": "{n} 天直播後再出貨", vi: "Live {n} ngày trước khi gửi", th: "ไลฟ์ {n} วันก่อนส่ง", id: "Live {n} hari sebelum dikirim" },
  rd_dash_session_foot: { en: "Orders from this live stay open until the session ends, then ship together.", fil: "Mananatiling bukas ang mga order mula sa live na ito hanggang matapos ang session, tapos sabay-sabay na i-ship.", zh: "本场直播的订单会保持开放，直到场次结束后一起发货。", "zh-TW": "本場直播的訂單會保持開放，直到場次結束後一起出貨。", vi: "Đơn hàng từ buổi live này vẫn mở cho đến khi phiên kết thúc, rồi giao cùng nhau.", th: "ออเดอร์จากไลฟ์นี้จะเปิดอยู่จนกว่ารอบจะจบ แล้วจึงจัดส่งพร้อมกัน", id: "Pesanan dari live ini tetap terbuka sampai sesi berakhir, lalu dikirim bersamaan." },
  rd_dash_connect_tiktok: { en: "Connect TikTok", fil: "Ikonekta ang TikTok", zh: "连接 TikTok", "zh-TW": "連接 TikTok", vi: "Kết nối TikTok", th: "เชื่อมต่อ TikTok", id: "Hubungkan TikTok" },
  rd_dash_connect_facebook: { en: "Connect Facebook", fil: "Ikonekta ang Facebook", zh: "连接 Facebook", "zh-TW": "連接 Facebook", vi: "Kết nối Facebook", th: "เชื่อมต่อ Facebook", id: "Hubungkan Facebook" },
  rd_dash_tiktok_account: { en: "TIKTOK ACCOUNT", fil: "TIKTOK ACCOUNT", zh: "TIKTOK 账户", "zh-TW": "TIKTOK 帳號", vi: "TÀI KHOẢN TIKTOK", th: "บัญชี TIKTOK", id: "AKUN TIKTOK" },
  rd_dash_no_accounts: { en: "No accounts yet — Connect to add one.", fil: "Wala pang account — Mag-Connect para magdagdag.", zh: "还没有账户——点击连接添加。", "zh-TW": "還沒有帳號——點擊連接新增。", vi: "Chưa có tài khoản — Kết nối để thêm.", th: "ยังไม่มีบัญชี — เชื่อมต่อเพื่อเพิ่ม", id: "Belum ada akun — Hubungkan untuk menambah." },
  rd_dash_tap_go_live: { en: "tap to go live", fil: "i-tap para mag-live", zh: "点击开始直播", "zh-TW": "點擊開始直播", vi: "chạm để phát live", th: "แตะเพื่อไลฟ์", id: "ketuk untuk live" },
  rd_dash_manage_add: { en: "Manage / add account", fil: "Pamahalaan / magdagdag ng account", zh: "管理 / 添加账户", "zh-TW": "管理 / 新增帳號", vi: "Quản lý / thêm tài khoản", th: "จัดการ / เพิ่มบัญชี", id: "Kelola / tambah akun" },
  rd_dash_connect: { en: "Connect", fil: "Ikonekta", zh: "连接", "zh-TW": "連接", vi: "Kết nối", th: "เชื่อมต่อ", id: "Hubungkan" },
  rd_dash_fb_page_group: { en: "FACEBOOK PAGE / GROUP", fil: "FACEBOOK PAGE / GROUP", zh: "FACEBOOK 主页 / 群组", "zh-TW": "FACEBOOK 粉專 / 社團", vi: "TRANG / NHÓM FACEBOOK", th: "เพจ / กลุ่ม FACEBOOK", id: "HALAMAN / GRUP FACEBOOK" },
  rd_dash_no_pages: { en: "No pages yet — Connect to add one.", fil: "Wala pang page — Mag-Connect para magdagdag.", zh: "还没有主页——点击连接添加。", "zh-TW": "還沒有粉專——點擊連接新增。", vi: "Chưa có trang — Kết nối để thêm.", th: "ยังไม่มีเพจ — เชื่อมต่อเพื่อเพิ่ม", id: "Belum ada halaman — Hubungkan untuk menambah." },
  rd_dash_conn_title: { en: "Connected to live stream", fil: "Nakakonekta sa live stream", zh: "已连接到直播", "zh-TW": "已連接到直播", vi: "Đã kết nối với buổi live", th: "เชื่อมต่อกับไลฟ์แล้ว", id: "Terhubung ke siaran live" },
  rd_dash_not_conn_title: { en: "Not connected — pick an account, then Connect", fil: "Hindi nakakonekta — pumili ng account, tapos mag-Connect", zh: "未连接——选择账户后点击连接", "zh-TW": "未連接——選擇帳號後點擊連接", vi: "Chưa kết nối — chọn tài khoản rồi Kết nối", th: "ยังไม่เชื่อมต่อ — เลือกบัญชีแล้วเชื่อมต่อ", id: "Belum terhubung — pilih akun, lalu Hubungkan" },
  rd_dash_today_badge: { en: "TODAY", fil: "NGAYON", zh: "今天", "zh-TW": "今天", vi: "HÔM NAY", th: "วันนี้", id: "HARI INI" },
  rd_dash_buyers: { en: "buyers", fil: "mamimili", zh: "买家", "zh-TW": "買家", vi: "người mua", th: "ผู้ซื้อ", id: "pembeli" },
  rd_dash_loading_session: { en: "Loading today’s session…", fil: "Nilo-load ang session ngayon…", zh: "正在加载今天的场次…", "zh-TW": "正在載入今天的場次…", vi: "Đang tải phiên hôm nay…", th: "กำลังโหลดรอบของวันนี้…", id: "Memuat sesi hari ini…" },
  rd_dash_live_comments: { en: "Live comments", fil: "Mga live na komento", zh: "直播评论", "zh-TW": "直播留言", vi: "Bình luận trực tiếp", th: "คอมเมนต์สด", id: "Komentar live" },
  rd_dash_inject_title: { en: "Preview only — inject a synthetic test comment", fil: "Preview lang — maglagay ng synthetic na test comment", zh: "仅预览——注入一条模拟测试评论", "zh-TW": "僅預覽——注入一則模擬測試留言", vi: "Chỉ xem trước — chèn bình luận thử nghiệm", th: "พรีวิวเท่านั้น — แทรกคอมเมนต์ทดสอบ", id: "Pratinjau saja — sisipkan komentar uji" },
  rd_dash_test_comment: { en: "+ Test comment", fil: "+ Test comment", zh: "+ 测试评论", "zh-TW": "+ 測試留言", vi: "+ Bình luận thử", th: "+ คอมเมนต์ทดสอบ", id: "+ Komentar uji" },
  rd_dash_waiting: { en: "Waiting for live comments…", fil: "Naghihintay ng mga live na komento…", zh: "正在等待直播评论…", "zh-TW": "正在等待直播留言…", vi: "Đang chờ bình luận trực tiếp…", th: "กำลังรอคอมเมนต์สด…", id: "Menunggu komentar live…" },
  rd_dash_connect_start: { en: "Connect an account to start your live session.", fil: "Mag-connect ng account para simulan ang iyong live session.", zh: "连接账户以开始你的直播场次。", "zh-TW": "連接帳號以開始你的直播場次。", vi: "Kết nối tài khoản để bắt đầu phiên live.", th: "เชื่อมต่อบัญชีเพื่อเริ่มรอบไลฟ์ของคุณ", id: "Hubungkan akun untuk memulai sesi live Anda." },
  rd_dash_preview_hint: { en: " (Preview: tap “+ Test comment”.)", fil: " (Preview: i-tap ang “+ Test comment”.)", zh: " （预览：点击「+ 测试评论」。）", "zh-TW": " （預覽：點擊「+ 測試留言」。）", vi: " (Xem trước: chạm “+ Bình luận thử”.)", th: " (พรีวิว: แตะ “+ คอมเมนต์ทดสอบ”)", id: " (Pratinjau: ketuk “+ Komentar uji”.)" },
  rd_dash_printed: { en: "Printed", fil: "Na-print", zh: "已打印", "zh-TW": "已列印", vi: "Đã in", th: "พิมพ์แล้ว", id: "Tercetak" },
  rd_dash_type_price: { en: "Type price, Enter to print", fil: "I-type ang presyo, Enter para i-print", zh: "输入价格，按 Enter 打印", "zh-TW": "輸入價格，按 Enter 列印", vi: "Nhập giá, Enter để in", th: "พิมพ์ราคา กด Enter เพื่อพิมพ์", id: "Ketik harga, Enter untuk cetak" },
  rd_dash_ent_title: { en: "Enterprise — type a price, then Enter to auto-print", fil: "Enterprise — mag-type ng presyo, tapos Enter para auto-print", zh: "Enterprise——输入价格后按 Enter 自动打印", "zh-TW": "Enterprise——輸入價格後按 Enter 自動列印", vi: "Enterprise — nhập giá rồi Enter để tự in", th: "Enterprise — พิมพ์ราคาแล้วกด Enter เพื่อพิมพ์อัตโนมัติ", id: "Enterprise — ketik harga, lalu Enter untuk cetak otomatis" },
  rd_dash_enterprise: { en: "Enterprise", fil: "Enterprise", zh: "Enterprise", "zh-TW": "Enterprise", vi: "Enterprise", th: "Enterprise", id: "Enterprise" },
  rd_dash_1click_title: { en: "1-Click — auto-print order now", fil: "1-Click — auto-print ang order ngayon", zh: "1-Click——立即自动打印订单", "zh-TW": "1-Click——立即自動列印訂單", vi: "1-Click — tự in đơn ngay", th: "1-Click — พิมพ์ออเดอร์อัตโนมัติทันที", id: "1-Click — cetak pesanan otomatis sekarang" },
  rd_dash_1click: { en: "1-Click", fil: "1-Click", zh: "1-Click", "zh-TW": "1-Click", vi: "1-Click", th: "1-Click", id: "1-Click" },

  // ════ Shared (settings group) ════
  rd_back: { en: "‹ Back", fil: "‹ Bumalik", zh: "‹ 返回", "zh-TW": "‹ 返回", vi: "‹ Quay lại", th: "‹ กลับ", id: "‹ Kembali" },

  // ════ Settings hub ════
  rd_sh_sub: { en: "Shop tools & account", fil: "Mga tool ng shop at account", zh: "店铺工具和账户", "zh-TW": "賣場工具與帳號", vi: "Công cụ cửa hàng & tài khoản", th: "เครื่องมือร้านและบัญชี", id: "Alat toko & akun" },
  rd_sh_general: { en: "General Settings", fil: "Pangkalahatang Settings", zh: "通用设置", "zh-TW": "一般設定", vi: "Cài đặt chung", th: "การตั้งค่าทั่วไป", id: "Pengaturan umum" },
  rd_sh_admin: { en: "Admin", fil: "Admin", zh: "管理", "zh-TW": "管理", vi: "Quản trị", th: "ผู้ดูแล", id: "Admin" },
  rd_sh_sales: { en: "Sales Report", fil: "Sales Report", zh: "销售报表", "zh-TW": "銷售報表", vi: "Báo cáo doanh số", th: "รายงานยอดขาย", id: "Laporan penjualan" },
  rd_sh_shipping: { en: "Shipping", fil: "Shipping", zh: "发货", "zh-TW": "出貨", vi: "Giao hàng", th: "การจัดส่ง", id: "Pengiriman" },
  rd_sh_customer_data: { en: "Customer Data", fil: "Datos ng Customer", zh: "客户数据", "zh-TW": "客戶資料", vi: "Dữ liệu khách hàng", th: "ข้อมูลลูกค้า", id: "Data pelanggan" },
  rd_sh_delete: { en: "Delete Account", fil: "Burahin ang Account", zh: "删除账户", "zh-TW": "刪除帳號", vi: "Xóa tài khoản", th: "ลบบัญชี", id: "Hapus akun" },
  rd_sh_logout: { en: "Log out", fil: "Mag-log out", zh: "退出登录", "zh-TW": "登出", vi: "Đăng xuất", th: "ออกจากระบบ", id: "Keluar" },

  // ════ General settings ════
  rd_set_title: { en: "Settings", fil: "Settings", zh: "设置", "zh-TW": "設定", vi: "Cài đặt", th: "การตั้งค่า", id: "Pengaturan" },
  rd_set_close: { en: "Close", fil: "Isara", zh: "关闭", "zh-TW": "關閉", vi: "Đóng", th: "ปิด", id: "Tutup" },
  rd_set_edit: { en: "Edit", fil: "I-edit", zh: "编辑", "zh-TW": "編輯", vi: "Sửa", th: "แก้ไข", id: "Edit" },
  rd_set_basic_info: { en: "BASIC INFORMATION", fil: "PANGUNAHING IMPORMASYON", zh: "基本信息", "zh-TW": "基本資訊", vi: "THÔNG TIN CƠ BẢN", th: "ข้อมูลพื้นฐาน", id: "INFORMASI DASAR" },
  rd_set_shop_name: { en: "Shop name", fil: "Pangalan ng shop", zh: "店铺名称", "zh-TW": "賣場名稱", vi: "Tên cửa hàng", th: "ชื่อร้าน", id: "Nama toko" },
  rd_set_owner_name: { en: "Owner name", fil: "Pangalan ng may-ari", zh: "店主姓名", "zh-TW": "店主姓名", vi: "Tên chủ", th: "ชื่อเจ้าของ", id: "Nama pemilik" },
  rd_set_phone: { en: "Phone", fil: "Telepono", zh: "电话", "zh-TW": "電話", vi: "Điện thoại", th: "โทรศัพท์", id: "Telepon" },
  rd_set_email: { en: "Email", fil: "Email", zh: "邮箱", "zh-TW": "電子郵件", vi: "Email", th: "อีเมล", id: "Email" },
  rd_set_err_required: { en: "Owner name and shop name are required.", fil: "Kailangan ang pangalan ng may-ari at pangalan ng shop.", zh: "店主姓名和店铺名称为必填项。", "zh-TW": "店主姓名與賣場名稱為必填。", vi: "Tên chủ và tên cửa hàng là bắt buộc.", th: "ต้องระบุชื่อเจ้าของและชื่อร้าน", id: "Nama pemilik dan nama toko wajib diisi." },
  rd_set_err_save_failed: { en: "Save failed.", fil: "Nabigo ang pag-save.", zh: "保存失败。", "zh-TW": "儲存失敗。", vi: "Lưu thất bại.", th: "บันทึกไม่สำเร็จ", id: "Gagal menyimpan." },
  rd_set_saved: { en: "✓ Saved", fil: "✓ Na-save", zh: "✓ 已保存", "zh-TW": "✓ 已儲存", vi: "✓ Đã lưu", th: "✓ บันทึกแล้ว", id: "✓ Tersimpan" },
  rd_set_saving: { en: "Saving…", fil: "Sine-save…", zh: "正在保存…", "zh-TW": "正在儲存…", vi: "Đang lưu…", th: "กำลังบันทึก…", id: "Menyimpan…" },
  rd_set_save_changes: { en: "Save changes", fil: "I-save ang mga pagbabago", zh: "保存更改", "zh-TW": "儲存變更", vi: "Lưu thay đổi", th: "บันทึกการเปลี่ยนแปลง", id: "Simpan perubahan" },
  rd_set_live_session: { en: "LIVE SESSION", fil: "LIVE SESSION", zh: "直播场次", "zh-TW": "直播場次", vi: "PHIÊN LIVE", th: "รอบไลฟ์", id: "SESI LIVE" },
  rd_set_auto_mode: { en: "Auto mode", fil: "Auto mode", zh: "自动模式", "zh-TW": "自動模式", vi: "Chế độ tự động", th: "โหมดอัตโนมัติ", id: "Mode otomatis" },
  rd_set_auto_desc: { en: "Auto-detect “mine” comments and tag claims. Not wired yet — keep using 1-Click / Enterprise to capture orders. Tap to preview trigger word sets.", fil: "Awtomatikong tukuyin ang mga komentong “mine” at i-tag ang mga claim. Hindi pa nakakabit — gamitin pa rin ang 1-Click / Enterprise para kunin ang mga order. I-tap para i-preview ang mga trigger word set.", zh: "自动识别「mine」评论并标记认领。尚未启用——请继续使用 1-Click / Enterprise 来记录订单。点击预览触发词集。", "zh-TW": "自動辨識「mine」留言並標記認領。尚未啟用——請繼續使用 1-Click / Enterprise 來記錄訂單。點擊預覽觸發詞組。", vi: "Tự động phát hiện bình luận “mine” và gắn thẻ. Chưa kích hoạt — hãy tiếp tục dùng 1-Click / Enterprise để ghi đơn. Chạm để xem trước bộ từ kích hoạt.", th: "ตรวจจับคอมเมนต์ “mine” อัตโนมัติและแท็กการอ้างสิทธิ์ ยังไม่เปิดใช้ — โปรดใช้ 1-Click / Enterprise เพื่อบันทึกออเดอร์ แตะเพื่อดูชุดคำกระตุ้น", id: "Deteksi otomatis komentar “mine” dan tandai klaim. Belum aktif — tetap gunakan 1-Click / Enterprise untuk menangkap pesanan. Ketuk untuk pratinjau set kata pemicu." },
  rd_set_trigger_sets: { en: "Trigger word sets", fil: "Mga trigger word set", zh: "触发词集", "zh-TW": "觸發詞組", vi: "Bộ từ kích hoạt", th: "ชุดคำกระตุ้น", id: "Set kata pemicu" },
  rd_set_auto_help_pre: { en: "When Auto-detect is ON, any comment containing a trigger word auto-prints an order at its price. e.g. ", fil: "Kapag naka-ON ang Auto-detect, anumang komentong may trigger word ay awtomatikong magpi-print ng order sa presyo nito. hal. ", zh: "当自动识别开启时，任何包含触发词的评论都会按其价格自动打印订单。例如 ", "zh-TW": "當自動辨識開啟時，任何包含觸發詞的留言都會依其價格自動列印訂單。例如 ", vi: "Khi Tự động phát hiện BẬT, bất kỳ bình luận nào chứa từ kích hoạt sẽ tự in đơn theo giá của nó. ví dụ ", th: "เมื่อเปิดการตรวจจับอัตโนมัติ คอมเมนต์ใดที่มีคำกระตุ้นจะพิมพ์ออเดอร์ตามราคาโดยอัตโนมัติ เช่น ", id: "Saat Deteksi otomatis AKTIF, komentar apa pun yang berisi kata pemicu akan otomatis mencetak pesanan sesuai harganya. mis. " },
  rd_set_auto_help_eg: { en: "hello = 150", fil: "hello = 150", zh: "hello = 150", "zh-TW": "hello = 150", vi: "hello = 150", th: "hello = 150", id: "hello = 150" },
  rd_set_auto_help_post: { en: " → prints {cur}150.", fil: " → magpi-print ng {cur}150.", zh: " → 打印 {cur}150。", "zh-TW": " → 列印 {cur}150。", vi: " → in {cur}150.", th: " → พิมพ์ {cur}150", id: " → mencetak {cur}150." },
  rd_set_remove: { en: "Remove", fil: "Alisin", zh: "移除", "zh-TW": "移除", vi: "Xóa", th: "ลบ", id: "Hapus" },
  rd_set_word_ph: { en: "word = price, e.g. hello=150", fil: "salita = presyo, hal. hello=150", zh: "词 = 价格，例如 hello=150", "zh-TW": "詞 = 價格，例如 hello=150", vi: "từ = giá, ví dụ hello=150", th: "คำ = ราคา เช่น hello=150", id: "kata = harga, mis. hello=150" },
  rd_set_auto_detect: { en: "Auto-detect", fil: "Auto-detect", zh: "自动识别", "zh-TW": "自動辨識", vi: "Tự động phát hiện", th: "ตรวจจับอัตโนมัติ", id: "Deteksi otomatis" },
  rd_set_manual_mode: { en: "Manual mode", fil: "Manual mode", zh: "手动模式", "zh-TW": "手動模式", vi: "Chế độ thủ công", th: "โหมดแมนนวล", id: "Mode manual" },
  rd_set_currently_active: { en: "currently active", fil: "kasalukuyang aktibo", zh: "当前启用", "zh-TW": "目前啟用", vi: "đang hoạt động", th: "กำลังใช้งาน", id: "sedang aktif" },
  rd_set_appearance: { en: "APPEARANCE", fil: "ITSURA", zh: "外观", "zh-TW": "外觀", vi: "GIAO DIỆN", th: "ลักษณะ", id: "TAMPILAN" },
  rd_set_theme: { en: "Theme", fil: "Tema", zh: "主题", "zh-TW": "主題", vi: "Giao diện", th: "ธีม", id: "Tema" },
  rd_set_light: { en: "☀ Light", fil: "☀ Maliwanag", zh: "☀ 浅色", "zh-TW": "☀ 淺色", vi: "☀ Sáng", th: "☀ สว่าง", id: "☀ Terang" },
  rd_set_dark: { en: "☾ Dark", fil: "☾ Madilim", zh: "☾ 深色", "zh-TW": "☾ 深色", vi: "☾ Tối", th: "☾ มืด", id: "☾ Gelap" },
  rd_set_accent_color: { en: "Accent color", fil: "Accent na kulay", zh: "强调色", "zh-TW": "強調色", vi: "Màu nhấn", th: "สีเน้น", id: "Warna aksen" },
  rd_set_readable: { en: "Readable @handles", fil: "Nababasang @handles", zh: "易读的 @用户名", "zh-TW": "易讀的 @使用者名稱", vi: "@handle dễ đọc", th: "@handle ที่อ่านง่าย", id: "@handle yang mudah dibaca" },
  rd_set_readable_sub_pre: { en: "High-contrast usernames — ", fil: "High-contrast na username — ", zh: "高对比度用户名 — ", "zh-TW": "高對比使用者名稱 — ", vi: "Tên người dùng tương phản cao — ", th: "ชื่อผู้ใช้คอนทราสต์สูง — ", id: "Nama pengguna kontras tinggi — " },
  rd_set_language: { en: "Language", fil: "Wika", zh: "语言", "zh-TW": "語言", vi: "Ngôn ngữ", th: "ภาษา", id: "Bahasa" },
  rd_set_currency: { en: "Currency", fil: "Pera", zh: "货币", "zh-TW": "貨幣", vi: "Tiền tệ", th: "สกุลเงิน", id: "Mata uang" },
  rd_set_currency_sub: { en: "Applies to all prices", fil: "Para sa lahat ng presyo", zh: "适用于所有价格", "zh-TW": "適用於所有價格", vi: "Áp dụng cho mọi giá", th: "ใช้กับทุกราคา", id: "Berlaku untuk semua harga" },
  rd_set_channels: { en: "CHANNELS", fil: "MGA CHANNEL", zh: "频道", "zh-TW": "頻道", vi: "KÊNH", th: "ช่อง", id: "SALURAN" },
  rd_set_printer_display: { en: "PRINTER & DISPLAY", fil: "PRINTER AT DISPLAY", zh: "打印机和显示", "zh-TW": "印表機與顯示", vi: "MÁY IN & HIỂN THỊ", th: "เครื่องพิมพ์และการแสดงผล", id: "PRINTER & TAMPILAN" },
  rd_set_printer: { en: "Printer", fil: "Printer", zh: "打印机", "zh-TW": "印表機", vi: "Máy in", th: "เครื่องพิมพ์", id: "Printer" },
  rd_set_choose_printer: { en: "CHOOSE PRINTER", fil: "PUMILI NG PRINTER", zh: "选择打印机", "zh-TW": "選擇印表機", vi: "CHỌN MÁY IN", th: "เลือกเครื่องพิมพ์", id: "PILIH PRINTER" },
  rd_set_live_pattern: { en: "LIVE print pattern", fil: "LIVE print pattern", zh: "LIVE 打印格式", "zh-TW": "LIVE 列印格式", vi: "Mẫu in LIVE", th: "รูปแบบพิมพ์ LIVE", id: "Pola cetak LIVE" },
  rd_set_pattern_sub: { en: "What prints on each slip · sizes", fil: "Ano ang nakaprint sa bawat slip · sukat", zh: "每张单据打印的内容 · 尺寸", "zh-TW": "每張單據列印的內容 · 尺寸", vi: "Nội dung in trên mỗi phiếu · kích thước", th: "สิ่งที่พิมพ์บนแต่ละใบ · ขนาด", id: "Yang dicetak di setiap slip · ukuran" },
  rd_set_account: { en: "ACCOUNT", fil: "ACCOUNT", zh: "账户", "zh-TW": "帳號", vi: "TÀI KHOẢN", th: "บัญชี", id: "AKUN" },
  rd_set_support_guide: { en: "Support & user guide", fil: "Suporta at gabay", zh: "支持与用户指南", "zh-TW": "支援與使用者指南", vi: "Hỗ trợ & hướng dẫn", th: "ฝ่ายสนับสนุนและคู่มือ", id: "Dukungan & panduan" },

  // ════ Print pattern ════
  rd_pp_printer_test: { en: "Printer Test", fil: "Test ng Printer", zh: "打印机测试", "zh-TW": "印表機測試", vi: "In thử", th: "ทดสอบเครื่องพิมพ์", id: "Tes printer" },
  rd_pp_date_time: { en: "Date & time", fil: "Petsa at oras", zh: "日期和时间", "zh-TW": "日期與時間", vi: "Ngày & giờ", th: "วันที่และเวลา", id: "Tanggal & waktu" },
  rd_pp_buyer_num: { en: "Buyer #", fil: "Buyer #", zh: "买家编号", "zh-TW": "買家編號", vi: "Số người mua", th: "หมายเลขผู้ซื้อ", id: "No. pembeli" },
  rd_pp_tiktok_name: { en: "TikTok name", fil: "TikTok name", zh: "TikTok 名称", "zh-TW": "TikTok 名稱", vi: "Tên TikTok", th: "ชื่อ TikTok", id: "Nama TikTok" },
  rd_pp_tiktok_user: { en: "TikTok username", fil: "TikTok username", zh: "TikTok 用户名", "zh-TW": "TikTok 使用者名稱", vi: "Tên người dùng TikTok", th: "ชื่อผู้ใช้ TikTok", id: "Username TikTok" },
  rd_pp_comment_center: { en: "Comment (center)", fil: "Komento (gitna)", zh: "评论（居中）", "zh-TW": "留言（置中）", vi: "Bình luận (giữa)", th: "คอมเมนต์ (กึ่งกลาง)", id: "Komentar (tengah)" },
  rd_pp_logo: { en: "SellerFlowLive logo", fil: "SellerFlowLive logo", zh: "SellerFlowLive 标志", "zh-TW": "SellerFlowLive 標誌", vi: "Logo SellerFlowLive", th: "โลโก้ SellerFlowLive", id: "Logo SellerFlowLive" },
  rd_pp_fixed_size: { en: "Fixed default size", fil: "Nakatakdang default na sukat", zh: "固定默认尺寸", "zh-TW": "固定預設尺寸", vi: "Kích thước mặc định cố định", th: "ขนาดเริ่มต้นคงที่", id: "Ukuran default tetap" },
  rd_pp_save_settings: { en: "Save settings", fil: "I-save ang settings", zh: "保存设置", "zh-TW": "儲存設定", vi: "Lưu cài đặt", th: "บันทึกการตั้งค่า", id: "Simpan pengaturan" },

  // ════ Printer settings ════
  rd_ps_title: { en: "Printer settings", fil: "Settings ng printer", zh: "打印机设置", "zh-TW": "印表機設定", vi: "Cài đặt máy in", th: "ตั้งค่าเครื่องพิมพ์", id: "Pengaturan printer" },
  rd_ps_tap_find: { en: "Tap Find to check the saved printer.", fil: "I-tap ang Find para tingnan ang naka-save na printer.", zh: "点击「查找」检查已保存的打印机。", "zh-TW": "點擊「查找」檢查已儲存的印表機。", vi: "Chạm Tìm để kiểm tra máy in đã lưu.", th: "แตะ ค้นหา เพื่อตรวจสอบเครื่องพิมพ์ที่บันทึกไว้", id: "Ketuk Cari untuk memeriksa printer tersimpan." },
  rd_ps_open_app_connect: { en: "Open the SellerFlow app on your phone to connect a printer.", fil: "Buksan ang SellerFlow app sa iyong telepono para ikonekta ang printer.", zh: "在手机上打开 SellerFlow 应用以连接打印机。", "zh-TW": "在手機上開啟 SellerFlow 應用程式以連接印表機。", vi: "Mở ứng dụng SellerFlow trên điện thoại để kết nối máy in.", th: "เปิดแอป SellerFlow บนโทรศัพท์เพื่อเชื่อมต่อเครื่องพิมพ์", id: "Buka aplikasi SellerFlow di ponsel Anda untuk menghubungkan printer." },
  rd_ps_wifi_printer: { en: "WiFi printer", fil: "WiFi printer", zh: "WiFi 打印机", "zh-TW": "WiFi 印表機", vi: "Máy in WiFi", th: "เครื่องพิมพ์ WiFi", id: "Printer WiFi" },
  rd_ps_bt_printer: { en: "Bluetooth sticker printer", fil: "Bluetooth sticker printer", zh: "蓝牙贴纸打印机", "zh-TW": "藍牙貼紙印表機", vi: "Máy in sticker Bluetooth", th: "เครื่องพิมพ์สติกเกอร์ Bluetooth", id: "Printer stiker Bluetooth" },
  rd_ps_not_connected: { en: "Not connected", fil: "Hindi nakakonekta", zh: "未连接", "zh-TW": "未連接", vi: "Chưa kết nối", th: "ยังไม่เชื่อมต่อ", id: "Tidak terhubung" },
  rd_ps_aimo: { en: "AIMO D520BT (TSPL, 100×60mm)", fil: "AIMO D520BT (TSPL, 100×60mm)", zh: "AIMO D520BT (TSPL, 100×60mm)", "zh-TW": "AIMO D520BT (TSPL, 100×60mm)", vi: "AIMO D520BT (TSPL, 100×60mm)", th: "AIMO D520BT (TSPL, 100×60mm)", id: "AIMO D520BT (TSPL, 100×60mm)" },
  rd_ps_native_note: { en: "Printer connection runs in the SellerFlow app — these controls work on your phone, not in the web preview.", fil: "Tumatakbo sa SellerFlow app ang koneksyon ng printer — gumagana ang mga kontrol na ito sa iyong telepono, hindi sa web preview.", zh: "打印机连接在 SellerFlow 应用中运行——这些控件在手机上有效，而非网页预览。", "zh-TW": "印表機連線在 SellerFlow 應用程式中執行——這些控制項在手機上有效，而非網頁預覽。", vi: "Kết nối máy in chạy trong ứng dụng SellerFlow — các điều khiển này hoạt động trên điện thoại, không phải bản xem trước web.", th: "การเชื่อมต่อเครื่องพิมพ์ทำงานในแอป SellerFlow — ตัวควบคุมเหล่านี้ใช้งานบนโทรศัพท์ ไม่ใช่ในเว็บพรีวิว", id: "Koneksi printer berjalan di aplikasi SellerFlow — kontrol ini bekerja di ponsel Anda, bukan di pratinjau web." },
  rd_ps_output_format: { en: "OUTPUT FORMAT", fil: "OUTPUT FORMAT", zh: "输出格式", "zh-TW": "輸出格式", vi: "ĐỊNH DẠNG XUẤT", th: "รูปแบบเอาต์พุต", id: "FORMAT OUTPUT" },
  rd_ps_receipt: { en: "Receipt", fil: "Resibo", zh: "收据", "zh-TW": "收據", vi: "Biên lai", th: "ใบเสร็จ", id: "Struk" },
  rd_ps_sticker: { en: "Sticker", fil: "Sticker", zh: "贴纸", "zh-TW": "貼紙", vi: "Sticker", th: "สติกเกอร์", id: "Stiker" },
  rd_ps_ip: { en: "Printer IP address", fil: "IP address ng printer", zh: "打印机 IP 地址", "zh-TW": "印表機 IP 位址", vi: "Địa chỉ IP máy in", th: "ที่อยู่ IP เครื่องพิมพ์", id: "Alamat IP printer" },
  rd_ps_port: { en: "Port", fil: "Port", zh: "端口", "zh-TW": "連接埠", vi: "Cổng", th: "พอร์ต", id: "Port" },
  rd_ps_find: { en: "Find", fil: "Hanapin", zh: "查找", "zh-TW": "查找", vi: "Tìm", th: "ค้นหา", id: "Cari" },
  rd_ps_test_conn: { en: "Test Connection", fil: "Test ng Koneksyon", zh: "测试连接", "zh-TW": "測試連線", vi: "Kiểm tra kết nối", th: "ทดสอบการเชื่อมต่อ", id: "Tes koneksi" },
  rd_ps_test_print: { en: "Test Print", fil: "Test Print", zh: "测试打印", "zh-TW": "測試列印", vi: "In thử", th: "ทดสอบพิมพ์", id: "Tes cetak" },
  rd_ps_sticker_size: { en: "Sticker size", fil: "Sukat ng sticker", zh: "贴纸尺寸", "zh-TW": "貼紙尺寸", vi: "Kích thước sticker", th: "ขนาดสติกเกอร์", id: "Ukuran stiker" },
  rd_ps_clear: { en: "Clear", fil: "I-clear", zh: "清除", "zh-TW": "清除", vi: "Xóa", th: "ล้าง", id: "Hapus" },
  rd_ps_scan: { en: "Scan", fil: "I-scan", zh: "扫描", "zh-TW": "掃描", vi: "Quét", th: "สแกน", id: "Pindai" },
  rd_ps_scanning: { en: "Scanning…", fil: "Nagsa-scan…", zh: "正在扫描…", "zh-TW": "正在掃描…", vi: "Đang quét…", th: "กำลังสแกน…", id: "Memindai…" },
  rd_ps_open_app_scan: { en: "Open the SellerFlow app on your phone to scan Bluetooth printers.", fil: "Buksan ang SellerFlow app sa iyong telepono para mag-scan ng Bluetooth printer.", zh: "在手机上打开 SellerFlow 应用以扫描蓝牙打印机。", "zh-TW": "在手機上開啟 SellerFlow 應用程式以掃描藍牙印表機。", vi: "Mở ứng dụng SellerFlow trên điện thoại để quét máy in Bluetooth.", th: "เปิดแอป SellerFlow บนโทรศัพท์เพื่อสแกนเครื่องพิมพ์ Bluetooth", id: "Buka aplikasi SellerFlow di ponsel untuk memindai printer Bluetooth." },
  rd_ps_scan_unavail: { en: "Bluetooth scan unavailable.", fil: "Hindi available ang Bluetooth scan.", zh: "蓝牙扫描不可用。", "zh-TW": "藍牙掃描無法使用。", vi: "Không thể quét Bluetooth.", th: "ไม่สามารถสแกน Bluetooth ได้", id: "Pindai Bluetooth tidak tersedia." },
  rd_ps_bt_saved: { en: "Bluetooth printer saved.", fil: "Na-save ang Bluetooth printer.", zh: "蓝牙打印机已保存。", "zh-TW": "藍牙印表機已儲存。", vi: "Đã lưu máy in Bluetooth.", th: "บันทึกเครื่องพิมพ์ Bluetooth แล้ว", id: "Printer Bluetooth tersimpan." },
  rd_ps_bt_cleared: { en: "Bluetooth printer cleared.", fil: "Na-clear ang Bluetooth printer.", zh: "蓝牙打印机已清除。", "zh-TW": "藍牙印表機已清除。", vi: "Đã xóa máy in Bluetooth.", th: "ล้างเครื่องพิมพ์ Bluetooth แล้ว", id: "Printer Bluetooth dihapus." },
  rd_ps_open_app_test: { en: "Open the SellerFlow app on your phone to test-print.", fil: "Buksan ang SellerFlow app sa iyong telepono para mag-test-print.", zh: "在手机上打开 SellerFlow 应用以测试打印。", "zh-TW": "在手機上開啟 SellerFlow 應用程式以測試列印。", vi: "Mở ứng dụng SellerFlow trên điện thoại để in thử.", th: "เปิดแอป SellerFlow บนโทรศัพท์เพื่อทดสอบพิมพ์", id: "Buka aplikasi SellerFlow di ponsel untuk tes cetak." },
  rd_ps_sending_test: { en: "Sending test sticker…", fil: "Nagpapadala ng test sticker…", zh: "正在发送测试贴纸…", "zh-TW": "正在傳送測試貼紙…", vi: "Đang gửi sticker thử…", th: "กำลังส่งสติกเกอร์ทดสอบ…", id: "Mengirim stiker uji…" },
  rd_ps_test_sent: { en: "Test sticker sent.", fil: "Naipadala ang test sticker.", zh: "测试贴纸已发送。", "zh-TW": "測試貼紙已傳送。", vi: "Đã gửi sticker thử.", th: "ส่งสติกเกอร์ทดสอบแล้ว", id: "Stiker uji terkirim." },
  rd_ps_test_failed: { en: "Test sticker failed — check pairing.", fil: "Nabigo ang test sticker — tingnan ang pairing.", zh: "测试贴纸失败——请检查配对。", "zh-TW": "測試貼紙失敗——請檢查配對。", vi: "Sticker thử thất bại — kiểm tra ghép nối.", th: "สติกเกอร์ทดสอบล้มเหลว — ตรวจสอบการจับคู่", id: "Stiker uji gagal — periksa pemasangan." },
  rd_ps_bt_device: { en: "Bluetooth printer", fil: "Bluetooth printer", zh: "蓝牙打印机", "zh-TW": "藍牙印表機", vi: "Máy in Bluetooth", th: "เครื่องพิมพ์ Bluetooth", id: "Printer Bluetooth" },
  rd_ps_paired: { en: "Paired", fil: "Naka-pair", zh: "已配对", "zh-TW": "已配對", vi: "Đã ghép nối", th: "จับคู่แล้ว", id: "Terpasang" },
  rd_ps_nearby: { en: "Nearby", fil: "Malapit", zh: "附近", "zh-TW": "附近", vi: "Gần đây", th: "ใกล้เคียง", id: "Terdekat" },
  rd_ps_done: { en: "Done", fil: "Tapos", zh: "完成", "zh-TW": "完成", vi: "Xong", th: "เสร็จ", id: "Selesai" },

  // ════ Connect modal ════
  rd_cm_title: { en: "Connect live account", fil: "Ikonekta ang live account", zh: "连接直播账户", "zh-TW": "連接直播帳號", vi: "Kết nối tài khoản live", th: "เชื่อมต่อบัญชีไลฟ์", id: "Hubungkan akun live" },
  rd_cm_limit: { en: "⚠ Your plan's account limit is reached. Upgrade to add more.", fil: "⚠ Naabot na ang limitasyon ng account ng iyong plan. Mag-upgrade para magdagdag.", zh: "⚠ 已达到你套餐的账户上限。升级以添加更多。", "zh-TW": "⚠ 已達到你方案的帳號上限。升級以新增更多。", vi: "⚠ Đã đạt giới hạn tài khoản của gói. Nâng cấp để thêm.", th: "⚠ ถึงขีดจำกัดบัญชีของแผนคุณแล้ว อัปเกรดเพื่อเพิ่ม", id: "⚠ Batas akun paket Anda tercapai. Upgrade untuk menambah." },
  rd_cm_choose: { en: "Choose a registered {tab} account:", fil: "Pumili ng nakarehistrong {tab} account:", zh: "选择已注册的 {tab} 账户：", "zh-TW": "選擇已註冊的 {tab} 帳號：", vi: "Chọn tài khoản {tab} đã đăng ký:", th: "เลือกบัญชี {tab} ที่ลงทะเบียนไว้:", id: "Pilih akun {tab} terdaftar:" },
  rd_cm_add_tt: { en: "…or add a new TikTok username", fil: "…o magdagdag ng bagong TikTok username", zh: "…或添加新的 TikTok 用户名", "zh-TW": "…或新增新的 TikTok 使用者名稱", vi: "…hoặc thêm tên người dùng TikTok mới", th: "…หรือเพิ่มชื่อผู้ใช้ TikTok ใหม่", id: "…atau tambah username TikTok baru" },
  rd_cm_add_fb: { en: "…or add a new Facebook live video ID", fil: "…o magdagdag ng bagong Facebook live video ID", zh: "…或添加新的 Facebook 直播视频 ID", "zh-TW": "…或新增新的 Facebook 直播影片 ID", vi: "…hoặc thêm ID video live Facebook mới", th: "…หรือเพิ่ม ID วิดีโอไลฟ์ Facebook ใหม่", id: "…atau tambah ID video live Facebook baru" },
  rd_cm_tt_ph: { en: "e.g. duonglily_0708", fil: "e.g. duonglily_0708", zh: "e.g. duonglily_0708", "zh-TW": "e.g. duonglily_0708", vi: "e.g. duonglily_0708", th: "e.g. duonglily_0708", id: "e.g. duonglily_0708" },
  rd_cm_tt_warn: { en: "⚠ Use the exact TikTok username that is going live.", fil: "⚠ Gamitin ang eksaktong TikTok username na magli-live.", zh: "⚠ 使用正在直播的确切 TikTok 用户名。", "zh-TW": "⚠ 使用正在直播的確切 TikTok 使用者名稱。", vi: "⚠ Dùng đúng tên người dùng TikTok đang phát live.", th: "⚠ ใช้ชื่อผู้ใช้ TikTok ที่กำลังไลฟ์ให้ถูกต้อง", id: "⚠ Gunakan username TikTok yang sedang live." },
  rd_cm_fb_id: { en: "Facebook live video ID", fil: "Facebook live video ID", zh: "Facebook 直播视频 ID", "zh-TW": "Facebook 直播影片 ID", vi: "ID video live Facebook", th: "ID วิดีโอไลฟ์ Facebook", id: "ID video live Facebook" },
  rd_cm_access_token: { en: "Access token", fil: "Access token", zh: "访问令牌", "zh-TW": "存取權杖", vi: "Access token", th: "โทเค็นการเข้าถึง", id: "Token akses" },
  rd_cm_conn_failed: { en: "Connection failed.", fil: "Nabigo ang koneksyon.", zh: "连接失败。", "zh-TW": "連線失敗。", vi: "Kết nối thất bại.", th: "เชื่อมต่อไม่สำเร็จ", id: "Koneksi gagal." },
  rd_cm_connecting: { en: "Connecting…", fil: "Kumokonekta…", zh: "正在连接…", "zh-TW": "正在連線…", vi: "Đang kết nối…", th: "กำลังเชื่อมต่อ…", id: "Menghubungkan…" },
  rd_cm_connect_x: { en: "Connect {tab}", fil: "Ikonekta ang {tab}", zh: "连接 {tab}", "zh-TW": "連接 {tab}", vi: "Kết nối {tab}", th: "เชื่อมต่อ {tab}", id: "Hubungkan {tab}" },
  rd_cm_footer: { en: "Live connection runs on the SellerFlow server — only active in the published app, not this preview.", fil: "Tumatakbo sa SellerFlow server ang live connection — aktibo lang sa published app, hindi sa preview na ito.", zh: "直播连接在 SellerFlow 服务器上运行——仅在已发布的应用中有效，而非此预览。", "zh-TW": "直播連線在 SellerFlow 伺服器上執行——僅在已發布的應用程式中有效，而非此預覽。", vi: "Kết nối live chạy trên máy chủ SellerFlow — chỉ hoạt động trong ứng dụng đã phát hành, không phải bản xem trước này.", th: "การเชื่อมต่อไลฟ์ทำงานบนเซิร์ฟเวอร์ SellerFlow — ใช้งานได้เฉพาะในแอปที่เผยแพร่แล้ว ไม่ใช่พรีวิวนี้", id: "Koneksi live berjalan di server SellerFlow — hanya aktif di aplikasi yang dipublikasikan, bukan pratinjau ini." },

  // ════ Print (buyers) ════
  rd_pr_title: { en: "Print", fil: "Mag-print", zh: "打印", "zh-TW": "列印", vi: "In", th: "พิมพ์", id: "Cetak" },
  rd_pr_print_all: { en: "🖨 Print all ({n})", fil: "🖨 I-print lahat ({n})", zh: "🖨 全部打印（{n}）", "zh-TW": "🖨 全部列印（{n}）", vi: "🖨 In tất cả ({n})", th: "🖨 พิมพ์ทั้งหมด ({n})", id: "🖨 Cetak semua ({n})" },
  rd_pr_sent: { en: "Sent to printer ({via}).", fil: "Naipadala sa printer ({via}).", zh: "已发送到打印机（{via}）。", "zh-TW": "已傳送到印表機（{via}）。", vi: "Đã gửi đến máy in ({via}).", th: "ส่งไปยังเครื่องพิมพ์แล้ว ({via})", id: "Terkirim ke printer ({via})." },
  rd_pr_native_note: { en: "Printing runs in the SellerFlow app — open it on your phone to print.", fil: "Tumatakbo sa SellerFlow app ang pag-print — buksan ito sa iyong telepono para mag-print.", zh: "打印在 SellerFlow 应用中运行——在手机上打开它以打印。", "zh-TW": "列印在 SellerFlow 應用程式中執行——在手機上開啟以列印。", vi: "In chạy trong ứng dụng SellerFlow — mở trên điện thoại để in.", th: "การพิมพ์ทำงานในแอป SellerFlow — เปิดบนโทรศัพท์เพื่อพิมพ์", id: "Pencetakan berjalan di aplikasi SellerFlow — buka di ponsel untuk mencetak." },
  rd_pr_empty: { en: "No buyers to print yet.", fil: "Wala pang mamimili na ipi-print.", zh: "还没有要打印的买家。", "zh-TW": "還沒有要列印的買家。", vi: "Chưa có người mua để in.", th: "ยังไม่มีผู้ซื้อให้พิมพ์", id: "Belum ada pembeli untuk dicetak." },
  rd_pr_print_btn: { en: "🖨 Print", fil: "🖨 I-print", zh: "🖨 打印", "zh-TW": "🖨 列印", vi: "🖨 In", th: "🖨 พิมพ์", id: "🖨 Cetak" },

  // ════ Shipping ════
  rd_ship_export: { en: "⬇ Export 7-11", fil: "⬇ I-export 7-11", zh: "⬇ 导出 7-11", "zh-TW": "⬇ 匯出 7-11", vi: "⬇ Xuất 7-11", th: "⬇ ส่งออก 7-11", id: "⬇ Ekspor 7-11" },
  rd_ship_sub: { en: "Today's shipments · 7-ELEVEN MyShip export", fil: "Mga shipment ngayon · 7-ELEVEN MyShip export", zh: "今天的发货 · 7-ELEVEN MyShip 导出", "zh-TW": "今天的出貨 · 7-ELEVEN MyShip 匯出", vi: "Lô hàng hôm nay · Xuất 7-ELEVEN MyShip", th: "การจัดส่งวันนี้ · ส่งออก 7-ELEVEN MyShip", id: "Pengiriman hari ini · Ekspor 7-ELEVEN MyShip" },
  rd_ship_open: { en: "Open", fil: "Bukas", zh: "未结", "zh-TW": "未結", vi: "Đang mở", th: "เปิดอยู่", id: "Terbuka" },
  rd_ship_next: { en: "Next #", fil: "Susunod #", zh: "下一个 #", "zh-TW": "下一個 #", vi: "Tiếp #", th: "ถัดไป #", id: "Berikutnya #" },
  rd_ship_remaining: { en: "Remaining", fil: "Natitira", zh: "剩余", "zh-TW": "剩餘", vi: "Còn lại", th: "คงเหลือ", id: "Sisa" },
  rd_ship_no_customers: { en: "No registered customers yet. Customers with a name, phone and 6-digit 7-ELEVEN store code appear here for shipping.", fil: "Wala pang nakarehistrong customer. Lumalabas dito para sa shipping ang mga customer na may pangalan, telepono at 6-digit na 7-ELEVEN store code.", zh: "还没有已注册的客户。拥有姓名、电话和 6 位 7-ELEVEN 门店代码的客户会显示在此处以供发货。", "zh-TW": "還沒有已註冊的客戶。擁有姓名、電話與 6 位 7-ELEVEN 門市代碼的客戶會顯示在此處以供出貨。", vi: "Chưa có khách hàng đăng ký. Khách hàng có tên, số điện thoại và mã cửa hàng 7-ELEVEN 6 chữ số sẽ xuất hiện ở đây để giao hàng.", th: "ยังไม่มีลูกค้าที่ลงทะเบียน ลูกค้าที่มีชื่อ เบอร์โทร และรหัสร้าน 7-ELEVEN 6 หลักจะแสดงที่นี่เพื่อจัดส่ง", id: "Belum ada pelanggan terdaftar. Pelanggan dengan nama, telepon, dan kode toko 7-ELEVEN 6 digit muncul di sini untuk pengiriman." },
  rd_ship_customer: { en: "Customer", fil: "Customer", zh: "客户", "zh-TW": "客戶", vi: "Khách hàng", th: "ลูกค้า", id: "Pelanggan" },
  rd_ship_select_customer: { en: "Select customer…", fil: "Pumili ng customer…", zh: "选择客户…", "zh-TW": "選擇客戶…", vi: "Chọn khách hàng…", th: "เลือกลูกค้า…", id: "Pilih pelanggan…" },
  rd_ship_product: { en: "Product", fil: "Produkto", zh: "产品", "zh-TW": "產品", vi: "Sản phẩm", th: "สินค้า", id: "Produk" },
  rd_ship_product_ph: { en: "CLOTHING", fil: "CLOTHING", zh: "CLOTHING", "zh-TW": "CLOTHING", vi: "CLOTHING", th: "CLOTHING", id: "CLOTHING" },
  rd_ship_amount: { en: "Amount ({cur})", fil: "Halaga ({cur})", zh: "金额（{cur}）", "zh-TW": "金額（{cur}）", vi: "Số tiền ({cur})", th: "จำนวนเงิน ({cur})", id: "Jumlah ({cur})" },
  rd_ship_will_add: { en: "Will add to open shipment #{num}.", fil: "Idaragdag sa bukas na shipment #{num}.", zh: "将添加到未结发货 #{num}。", "zh-TW": "將新增到未結出貨 #{num}。", vi: "Sẽ thêm vào lô hàng đang mở #{num}.", th: "จะเพิ่มเข้าการจัดส่งที่เปิดอยู่ #{num}", id: "Akan ditambahkan ke pengiriman terbuka #{num}." },
  rd_ship_will_create: { en: "Will create a new shipment.", fil: "Gagawa ng bagong shipment.", zh: "将创建新的发货。", "zh-TW": "將建立新的出貨。", vi: "Sẽ tạo lô hàng mới.", th: "จะสร้างการจัดส่งใหม่", id: "Akan membuat pengiriman baru." },
  rd_ship_add_order: { en: "+ Add order", fil: "+ Magdagdag ng order", zh: "+ 添加订单", "zh-TW": "+ 新增訂單", vi: "+ Thêm đơn", th: "+ เพิ่มออเดอร์", id: "+ Tambah pesanan" },
  rd_ship_err_select: { en: "Select a registered customer first.", fil: "Pumili muna ng nakarehistrong customer.", zh: "请先选择已注册的客户。", "zh-TW": "請先選擇已註冊的客戶。", vi: "Hãy chọn khách hàng đã đăng ký trước.", th: "กรุณาเลือกลูกค้าที่ลงทะเบียนก่อน", id: "Pilih pelanggan terdaftar dulu." },
  rd_ship_err_product: { en: "Product is required.", fil: "Kailangan ang produkto.", zh: "产品为必填项。", "zh-TW": "產品為必填。", vi: "Sản phẩm là bắt buộc.", th: "ต้องระบุสินค้า", id: "Produk wajib diisi." },
  rd_ship_err_price: { en: "Enter a valid price.", fil: "Maglagay ng wastong presyo.", zh: "请输入有效价格。", "zh-TW": "請輸入有效價格。", vi: "Nhập giá hợp lệ.", th: "กรอกราคาที่ถูกต้อง", id: "Masukkan harga yang valid." },
  rd_ship_err_limit: { en: "Daily shipment limit reached ({max}).", fil: "Naabot ang daily shipment limit ({max}).", zh: "已达到每日发货上限（{max}）。", "zh-TW": "已達到每日出貨上限（{max}）。", vi: "Đã đạt giới hạn lô hàng hàng ngày ({max}).", th: "ถึงขีดจำกัดการจัดส่งรายวันแล้ว ({max})", id: "Batas pengiriman harian tercapai ({max})." },
  rd_ship_added_existing: { en: "Added to existing #{num} {name}.", fil: "Naidagdag sa umiiral na #{num} {name}.", zh: "已添加到现有 #{num} {name}。", "zh-TW": "已新增到現有 #{num} {name}。", vi: "Đã thêm vào #{num} {name} hiện có.", th: "เพิ่มเข้า #{num} {name} ที่มีอยู่แล้ว", id: "Ditambahkan ke #{num} {name} yang ada." },
  rd_ship_created_new: { en: "Created new #{num} {name}.", fil: "Gumawa ng bagong #{num} {name}.", zh: "已创建新的 #{num} {name}。", "zh-TW": "已建立新的 #{num} {name}。", vi: "Đã tạo mới #{num} {name}.", th: "สร้างใหม่ #{num} {name}", id: "Membuat baru #{num} {name}." },
  rd_ship_confirm_remove: { en: "Remove this order?", fil: "Alisin ang order na ito?", zh: "移除此订单？", "zh-TW": "移除此訂單？", vi: "Xóa đơn này?", th: "ลบออเดอร์นี้?", id: "Hapus pesanan ini?" },
  rd_ship_amount_updated: { en: "Amount updated.", fil: "Na-update ang halaga.", zh: "金额已更新。", "zh-TW": "金額已更新。", vi: "Đã cập nhật số tiền.", th: "อัปเดตจำนวนเงินแล้ว", id: "Jumlah diperbarui." },
  rd_ship_no_open: { en: "No open shipments to export.", fil: "Walang bukas na shipment na ie-export.", zh: "没有可导出的未结发货。", "zh-TW": "沒有可匯出的未結出貨。", vi: "Không có lô hàng đang mở để xuất.", th: "ไม่มีการจัดส่งที่เปิดอยู่ให้ส่งออก", id: "Tidak ada pengiriman terbuka untuk diekspor." },
  rd_ship_missing_name: { en: "A shipment is missing a customer name.", fil: "May shipment na walang pangalan ng customer.", zh: "有一个发货缺少客户姓名。", "zh-TW": "有一個出貨缺少客戶姓名。", vi: "Một lô hàng thiếu tên khách hàng.", th: "มีการจัดส่งที่ขาดชื่อลูกค้า", id: "Sebuah pengiriman tidak memiliki nama pelanggan." },
  rd_ship_exported_one: { en: "Exported {n} buyer.", fil: "Na-export ang {n} mamimili.", zh: "已导出 {n} 位买家。", "zh-TW": "已匯出 {n} 位買家。", vi: "Đã xuất {n} người mua.", th: "ส่งออก {n} ผู้ซื้อแล้ว", id: "Mengekspor {n} pembeli." },
  rd_ship_exported_many: { en: "Exported {n} buyers.", fil: "Na-export ang {n} mamimili.", zh: "已导出 {n} 位买家。", "zh-TW": "已匯出 {n} 位買家。", vi: "Đã xuất {n} người mua.", th: "ส่งออก {n} ผู้ซื้อแล้ว", id: "Mengekspor {n} pembeli." },
  rd_ship_export_failed: { en: "Export failed: {msg}", fil: "Nabigo ang pag-export: {msg}", zh: "导出失败：{msg}", "zh-TW": "匯出失敗：{msg}", vi: "Xuất thất bại: {msg}", th: "ส่งออกไม่สำเร็จ: {msg}", id: "Ekspor gagal: {msg}" },
  rd_ship_empty: { en: "No shipments yet today.", fil: "Wala pang shipment ngayon.", zh: "今天还没有发货。", "zh-TW": "今天還沒有出貨。", vi: "Chưa có lô hàng nào hôm nay.", th: "ยังไม่มีการจัดส่งวันนี้", id: "Belum ada pengiriman hari ini." },
  rd_ship_shipped_badge: { en: "SHIPPED", fil: "NAIPADALA", zh: "已发货", "zh-TW": "已出貨", vi: "ĐÃ GIAO", th: "จัดส่งแล้ว", id: "DIKIRIM" },
  rd_ship_edit: { en: "edit", fil: "i-edit", zh: "编辑", "zh-TW": "編輯", vi: "sửa", th: "แก้ไข", id: "edit" },
  rd_ship_del: { en: "del", fil: "burahin", zh: "删除", "zh-TW": "刪除", vi: "xóa", th: "ลบ", id: "hapus" },
  rd_ship_subtotal: { en: "Subtotal", fil: "Subtotal", zh: "小计", "zh-TW": "小計", vi: "Tạm tính", th: "ยอดรวมย่อย", id: "Subtotal" },
  rd_ship_fee: { en: "Fee", fil: "Bayad", zh: "费用", "zh-TW": "費用", vi: "Phí", th: "ค่าธรรมเนียม", id: "Biaya" },

  // ════ Admin — main screen ════
  rd_adm_title: { en: "Admin panel", fil: "Admin panel", zh: "管理面板", "zh-TW": "管理面板", vi: "Bảng quản trị", th: "แผงผู้ดูแล", id: "Panel admin" },
  rd_adm_subtitle: { en: "Owner control center", fil: "Owner control center", zh: "店主控制中心", "zh-TW": "店主控制中心", vi: "Trung tâm điều khiển của chủ", th: "ศูนย์ควบคุมของเจ้าของ", id: "Pusat kontrol pemilik" },
  rd_adm_revenue_sample: { en: "Revenue: sample", fil: "Revenue: sample", zh: "营收：示例", "zh-TW": "營收：範例", vi: "Doanh thu: mẫu", th: "รายได้: ตัวอย่าง", id: "Pendapatan: sampel" },
  rd_adm_notifications: { en: "Notifications", fil: "Mga abiso", zh: "通知", "zh-TW": "通知", vi: "Thông báo", th: "การแจ้งเตือน", id: "Notifikasi" },
  rd_adm_systems_ok: { en: "Systems OK", fil: "Systems OK", zh: "系统正常", "zh-TW": "系統正常", vi: "Hệ thống OK", th: "ระบบปกติ", id: "Sistem OK" },
  rd_adm_platform_owner: { en: "Platform owner", fil: "May-ari ng platform", zh: "平台所有者", "zh-TW": "平台擁有者", vi: "Chủ nền tảng", th: "เจ้าของแพลตฟอร์ม", id: "Pemilik platform" },
  rd_adm_super_admin: { en: "SUPER ADMIN", fil: "SUPER ADMIN", zh: "超级管理员", "zh-TW": "超級管理員", vi: "SIÊU QUẢN TRỊ", th: "ซูเปอร์แอดมิน", id: "SUPER ADMIN" },
  rd_adm_monthly_revenue: { en: "Monthly revenue", fil: "Buwanang kita", zh: "月营收", "zh-TW": "月營收", vi: "Doanh thu tháng", th: "รายได้ต่อเดือน", id: "Pendapatan bulanan" },
  rd_adm_mom: { en: "▲ 12% MoM ›", fil: "▲ 12% MoM ›", zh: "▲ 环比 12% ›", "zh-TW": "▲ 環比 12% ›", vi: "▲ 12% so tháng trước ›", th: "▲ 12% เทียบเดือนก่อน ›", id: "▲ 12% MoM ›" },
  rd_adm_user_base: { en: "User base", fil: "User base", zh: "用户群", "zh-TW": "用戶群", vi: "Cơ sở người dùng", th: "ฐานผู้ใช้", id: "Basis pengguna" },
  rd_adm_paying_free: { en: "paying · {free} free ›", fil: "nagbabayad · {free} libre ›", zh: "付费 · {free} 免费 ›", "zh-TW": "付費 · {free} 免費 ›", vi: "trả phí · {free} miễn phí ›", th: "จ่ายเงิน · {free} ฟรี ›", id: "berbayar · {free} gratis ›" },
  rd_adm_paid_free_split: { en: "paid / free split ›", fil: "paid / free split ›", zh: "付费 / 免费 占比 ›", "zh-TW": "付費 / 免費 占比 ›", vi: "tỷ lệ trả phí / miễn phí ›", th: "สัดส่วนจ่าย / ฟรี ›", id: "rasio berbayar / gratis ›" },
  rd_adm_subscriptions: { en: "Subscriptions", fil: "Mga subscription", zh: "订阅", "zh-TW": "訂閱", vi: "Đăng ký", th: "การสมัครสมาชิก", id: "Langganan" },
  rd_adm_active_paid: { en: "Active paid ›", fil: "Aktibong bayad ›", zh: "有效付费 ›", "zh-TW": "有效付費 ›", vi: "Trả phí đang hoạt động ›", th: "จ่ายเงินใช้งานอยู่ ›", id: "Berbayar aktif ›" },
  rd_adm_expiring: { en: "Expiring ›", fil: "Mag-e-expire ›", zh: "即将到期 ›", "zh-TW": "即將到期 ›", vi: "Sắp hết hạn ›", th: "ใกล้หมดอายุ ›", id: "Akan kedaluwarsa ›" },
  rd_adm_free_tier: { en: "Free tier ›", fil: "Libreng tier ›", zh: "免费版 ›", "zh-TW": "免費版 ›", vi: "Gói miễn phí ›", th: "ระดับฟรี ›", id: "Tingkat gratis ›" },
  rd_adm_expired: { en: "Expired ›", fil: "Nag-expire ›", zh: "已过期 ›", "zh-TW": "已過期 ›", vi: "Hết hạn ›", th: "หมดอายุ ›", id: "Kedaluwarsa ›" },
  rd_adm_controls: { en: "Controls", fil: "Mga kontrol", zh: "控制", "zh-TW": "控制", vi: "Điều khiển", th: "การควบคุม", id: "Kontrol" },
  rd_adm_ctrl_userbase: { en: "User Base", fil: "User Base", zh: "用户群", "zh-TW": "用戶群", vi: "Người dùng", th: "ฐานผู้ใช้", id: "Basis Pengguna" },
  rd_adm_ctrl_sellers: { en: "Sellers", fil: "Mga seller", zh: "卖家", "zh-TW": "賣家", vi: "Người bán", th: "ผู้ขาย", id: "Penjual" },
  rd_adm_ctrl_plans: { en: "Plans", fil: "Mga plan", zh: "方案", "zh-TW": "方案", vi: "Gói", th: "แผน", id: "Paket" },
  rd_adm_ctrl_payments: { en: "Payments", fil: "Mga bayad", zh: "付款", "zh-TW": "付款", vi: "Thanh toán", th: "การชำระเงิน", id: "Pembayaran" },
  rd_adm_ctrl_broadcast: { en: "Broadcast", fil: "Broadcast", zh: "广播", "zh-TW": "廣播", vi: "Phát thông báo", th: "ประกาศ", id: "Siaran" },
  rd_adm_ctrl_reports: { en: "Reports", fil: "Mga ulat", zh: "报表", "zh-TW": "報表", vi: "Báo cáo", th: "รายงาน", id: "Laporan" },
  rd_adm_ctrl_system: { en: "System", fil: "System", zh: "系统", "zh-TW": "系統", vi: "Hệ thống", th: "ระบบ", id: "Sistem" },
  rd_adm_ctrl_audit: { en: "Audit Log", fil: "Audit Log", zh: "审计日志", "zh-TW": "稽核日誌", vi: "Nhật ký kiểm toán", th: "บันทึกการตรวจสอบ", id: "Log audit" },

  // ════ Admin — panel titles ════
  rd_adm_pt_sellers: { en: "Manage sellers", fil: "Pamahalaan ang mga seller", zh: "管理卖家", "zh-TW": "管理賣家", vi: "Quản lý người bán", th: "จัดการผู้ขาย", id: "Kelola penjual" },
  rd_adm_pt_plans: { en: "Subscription plans", fil: "Mga subscription plan", zh: "订阅方案", "zh-TW": "訂閱方案", vi: "Gói đăng ký", th: "แผนสมาชิก", id: "Paket langganan" },
  rd_adm_pt_reports: { en: "Platform reports", fil: "Mga ulat ng platform", zh: "平台报表", "zh-TW": "平台報表", vi: "Báo cáo nền tảng", th: "รายงานแพลตฟอร์ม", id: "Laporan platform" },
  rd_adm_pt_system: { en: "Assign plan by payment", fil: "Magtalaga ng plan ayon sa bayad", zh: "按付款分配方案", "zh-TW": "依付款分配方案", vi: "Gán gói theo thanh toán", th: "กำหนดแผนตามการชำระเงิน", id: "Tetapkan paket per pembayaran" },
  rd_adm_pt_subActive: { en: "Active paid subscriptions", fil: "Aktibong bayad na subscription", zh: "有效付费订阅", "zh-TW": "有效付費訂閱", vi: "Đăng ký trả phí đang hoạt động", th: "การสมัครจ่ายเงินที่ใช้งานอยู่", id: "Langganan berbayar aktif" },
  rd_adm_pt_subExpiring: { en: "Expiring soon", fil: "Malapit nang mag-expire", zh: "即将到期", "zh-TW": "即將到期", vi: "Sắp hết hạn", th: "ใกล้หมดอายุ", id: "Akan kedaluwarsa" },
  rd_adm_pt_subFree: { en: "Free tier", fil: "Libreng tier", zh: "免费版", "zh-TW": "免費版", vi: "Gói miễn phí", th: "ระดับฟรี", id: "Tingkat gratis" },
  rd_adm_pt_subExpired: { en: "Expired", fil: "Nag-expire", zh: "已过期", "zh-TW": "已過期", vi: "Hết hạn", th: "หมดอายุ", id: "Kedaluwarsa" },
  rd_adm_pt_revenue: { en: "App revenue", fil: "Kita ng app", zh: "应用营收", "zh-TW": "應用程式營收", vi: "Doanh thu ứng dụng", th: "รายได้แอป", id: "Pendapatan aplikasi" },
  rd_adm_pt_audit: { en: "Audit log", fil: "Audit log", zh: "审计日志", "zh-TW": "稽核日誌", vi: "Nhật ký kiểm toán", th: "บันทึกการตรวจสอบ", id: "Log audit" },

  // ════ Admin — shared/lists ════
  rd_adm_sample_note: { en: "Sample data — not wired yet", fil: "Sample data — hindi pa nakakabit", zh: "示例数据——尚未连接", "zh-TW": "範例資料——尚未連接", vi: "Dữ liệu mẫu — chưa kết nối", th: "ข้อมูลตัวอย่าง — ยังไม่เชื่อมต่อ", id: "Data sampel — belum terhubung" },
  rd_adm_none: { en: "None.", fil: "Wala.", zh: "无。", "zh-TW": "無。", vi: "Không có.", th: "ไม่มี", id: "Tidak ada." },
  rd_adm_days_left_one: { en: "{n} day left", fil: "{n} araw na natitira", zh: "剩 {n} 天", "zh-TW": "剩 {n} 天", vi: "còn {n} ngày", th: "เหลือ {n} วัน", id: "{n} hari tersisa" },
  rd_adm_days_left_many: { en: "{n} days left", fil: "{n} araw na natitira", zh: "剩 {n} 天", "zh-TW": "剩 {n} 天", vi: "còn {n} ngày", th: "เหลือ {n} วัน", id: "{n} hari tersisa" },
  rd_adm_free_shops_one: { en: "{n} free-tier shop · order usage this cycle", fil: "{n} libreng-tier na shop · paggamit ng order ngayong cycle", zh: "{n} 个免费版店铺 · 本周期订单用量", "zh-TW": "{n} 個免費版賣場 · 本週期訂單用量", vi: "{n} cửa hàng gói miễn phí · lượng đơn chu kỳ này", th: "ร้านระดับฟรี {n} ร้าน · การใช้ออเดอร์รอบนี้", id: "{n} toko tingkat gratis · penggunaan pesanan siklus ini" },
  rd_adm_free_shops_many: { en: "{n} free-tier shops · order usage this cycle", fil: "{n} libreng-tier na shop · paggamit ng order ngayong cycle", zh: "{n} 个免费版店铺 · 本周期订单用量", "zh-TW": "{n} 個免費版賣場 · 本週期訂單用量", vi: "{n} cửa hàng gói miễn phí · lượng đơn chu kỳ này", th: "ร้านระดับฟรี {n} ร้าน · การใช้ออเดอร์รอบนี้", id: "{n} toko tingkat gratis · penggunaan pesanan siklus ini" },
  rd_adm_no_free: { en: "No free-tier users.", fil: "Walang libreng-tier na user.", zh: "没有免费版用户。", "zh-TW": "沒有免費版用戶。", vi: "Không có người dùng gói miễn phí.", th: "ไม่มีผู้ใช้ระดับฟรี", id: "Tidak ada pengguna tingkat gratis." },
  rd_adm_resets_nd: { en: "resets {n}d", fil: "magre-reset {n}d", zh: "{n} 天后重置", "zh-TW": "{n} 天後重置", vi: "đặt lại {n}d", th: "รีเซ็ต {n}d", id: "reset {n}h" },

  // ════ Admin — sellers panel ════
  rd_adm_search_email: { en: "Search email or @handle", fil: "Maghanap ng email o @handle", zh: "搜索邮箱或 @handle", "zh-TW": "搜尋電子郵件或 @handle", vi: "Tìm email hoặc @handle", th: "ค้นหาอีเมลหรือ @handle", id: "Cari email atau @handle" },
  rd_adm_search_soon: { en: "Search soon", fil: "Search soon", zh: "搜索即将推出", "zh-TW": "搜尋即將推出", vi: "Tìm kiếm sắp có", th: "ค้นหาเร็วๆ นี้", id: "Pencarian segera" },
  rd_adm_users: { en: "Users", fil: "Mga user", zh: "用户", "zh-TW": "用戶", vi: "Người dùng", th: "ผู้ใช้", id: "Pengguna" },
  rd_adm_add_user: { en: "+ Add user", fil: "+ Magdagdag ng user", zh: "+ 添加用户", "zh-TW": "+ 新增用戶", vi: "+ Thêm người dùng", th: "+ เพิ่มผู้ใช้", id: "+ Tambah pengguna" },
  rd_adm_coming_soon: { en: "Coming soon", fil: "Malapit na", zh: "即将推出", "zh-TW": "即將推出", vi: "Sắp có", th: "เร็วๆ นี้", id: "Segera hadir" },
  rd_adm_loading_sellers: { en: "Loading sellers…", fil: "Nilo-load ang mga seller…", zh: "正在加载卖家…", "zh-TW": "正在載入賣家…", vi: "Đang tải người bán…", th: "กำลังโหลดผู้ขาย…", id: "Memuat penjual…" },
  rd_adm_no_sellers: { en: "No sellers found.", fil: "Walang nakitang seller.", zh: "未找到卖家。", "zh-TW": "找不到賣家。", vi: "Không tìm thấy người bán.", th: "ไม่พบผู้ขาย", id: "Tidak ada penjual ditemukan." },
  rd_adm_days: { en: "Days", fil: "Araw", zh: "天数", "zh-TW": "天數", vi: "Ngày", th: "วัน", id: "Hari" },
  rd_adm_accounts: { en: "Accounts", fil: "Mga account", zh: "账户", "zh-TW": "帳號", vi: "Tài khoản", th: "บัญชี", id: "Akun" },
  rd_adm_days_ph: { en: "days", fil: "araw", zh: "天", "zh-TW": "天", vi: "ngày", th: "วัน", id: "hari" },
  rd_adm_enter: { en: "Enter ↵", fil: "Enter ↵", zh: "回车 ↵", "zh-TW": "Enter ↵", vi: "Enter ↵", th: "Enter ↵", id: "Enter ↵" },
  rd_adm_add_days: { en: "+ Add days", fil: "+ Magdagdag ng araw", zh: "+ 增加天数", "zh-TW": "+ 增加天數", vi: "+ Thêm ngày", th: "+ เพิ่มวัน", id: "+ Tambah hari" },
  rd_adm_pw_ph: { en: "New password (≥6 chars)", fil: "Bagong password (≥6 char)", zh: "新密码（≥6 个字符）", "zh-TW": "新密碼（≥6 個字元）", vi: "Mật khẩu mới (≥6 ký tự)", th: "รหัสผ่านใหม่ (≥6 ตัว)", id: "Kata sandi baru (≥6 karakter)" },
  rd_adm_set: { en: "Set", fil: "I-set", zh: "设置", "zh-TW": "設定", vi: "Đặt", th: "ตั้ง", id: "Atur" },
  rd_adm_reset_pw: { en: "Reset PW", fil: "Reset PW", zh: "重置密码", "zh-TW": "重設密碼", vi: "Đặt lại MK", th: "รีเซ็ตรหัส", id: "Reset PW" },
  rd_adm_make_admin: { en: "Make Admin", fil: "Gawing Admin", zh: "设为管理员", "zh-TW": "設為管理員", vi: "Đặt làm Admin", th: "ตั้งเป็นแอดมิน", id: "Jadikan Admin" },
  rd_adm_remove_admin: { en: "Remove Admin", fil: "Alisin ang Admin", zh: "取消管理员", "zh-TW": "取消管理員", vi: "Gỡ Admin", th: "ลบแอดมิน", id: "Hapus Admin" },
  rd_adm_expire: { en: "Expire", fil: "I-expire", zh: "使过期", "zh-TW": "使過期", vi: "Hết hạn", th: "ทำให้หมดอายุ", id: "Kedaluwarsakan" },
  rd_adm_confirm: { en: "Admin action:\n{label}\nTarget: {email}\n\nContinue?", fil: "Admin action:\n{label}\nTarget: {email}\n\nMagpatuloy?", zh: "管理员操作：\n{label}\n目标：{email}\n\n继续？", "zh-TW": "管理員操作：\n{label}\n目標：{email}\n\n繼續？", vi: "Hành động quản trị:\n{label}\nĐối tượng: {email}\n\nTiếp tục?", th: "การดำเนินการแอดมิน:\n{label}\nเป้าหมาย: {email}\n\nดำเนินการต่อ?", id: "Aksi admin:\n{label}\nTarget: {email}\n\nLanjutkan?" },
  rd_adm_ok: { en: "✓ {label} — {email}", fil: "✓ {label} — {email}", zh: "✓ {label} — {email}", "zh-TW": "✓ {label} — {email}", vi: "✓ {label} — {email}", th: "✓ {label} — {email}", id: "✓ {label} — {email}" },
  rd_adm_failed: { en: "✗ {label} failed: {err}", fil: "✗ Nabigo ang {label}: {err}", zh: "✗ {label} 失败：{err}", "zh-TW": "✗ {label} 失敗：{err}", vi: "✗ {label} thất bại: {err}", th: "✗ {label} ล้มเหลว: {err}", id: "✗ {label} gagal: {err}" },
  rd_adm_err: { en: "error", fil: "error", zh: "错误", "zh-TW": "錯誤", vi: "lỗi", th: "ข้อผิดพลาด", id: "kesalahan" },
  rd_adm_act_setplan: { en: "Set plan → {plan}", fil: "Itakda ang plan → {plan}", zh: "设置方案 → {plan}", "zh-TW": "設定方案 → {plan}", vi: "Đặt gói → {plan}", th: "ตั้งแผน → {plan}", id: "Atur paket → {plan}" },
  rd_adm_act_adddays_one: { en: "Add {n} day", fil: "Magdagdag ng {n} araw", zh: "增加 {n} 天", "zh-TW": "增加 {n} 天", vi: "Thêm {n} ngày", th: "เพิ่ม {n} วัน", id: "Tambah {n} hari" },
  rd_adm_act_adddays_many: { en: "Add {n} days", fil: "Magdagdag ng {n} araw", zh: "增加 {n} 天", "zh-TW": "增加 {n} 天", vi: "Thêm {n} ngày", th: "เพิ่ม {n} วัน", id: "Tambah {n} hari" },
  rd_adm_act_setpw: { en: "Set password (Edge Function)", fil: "Itakda ang password (Edge Function)", zh: "设置密码（Edge Function）", "zh-TW": "設定密碼（Edge Function）", vi: "Đặt mật khẩu (Edge Function)", th: "ตั้งรหัสผ่าน (Edge Function)", id: "Atur kata sandi (Edge Function)" },
  rd_adm_act_remove_admin: { en: "Remove admin role", fil: "Alisin ang admin role", zh: "移除管理员角色", "zh-TW": "移除管理員角色", vi: "Gỡ vai trò quản trị", th: "ลบบทบาทแอดมิน", id: "Hapus peran admin" },
  rd_adm_act_make_admin: { en: "Make admin", fil: "Gawing admin", zh: "设为管理员", "zh-TW": "設為管理員", vi: "Đặt làm quản trị", th: "ตั้งเป็นแอดมิน", id: "Jadikan admin" },
  rd_adm_act_expire: { en: "Expire plan", fil: "I-expire ang plan", zh: "使方案过期", "zh-TW": "使方案過期", vi: "Hết hạn gói", th: "ทำให้แผนหมดอายุ", id: "Kedaluwarsakan paket" },
  rd_adm_act_delete: { en: "DELETE seller profile", fil: "BURAHIN ang seller profile", zh: "删除卖家资料", "zh-TW": "刪除賣家資料", vi: "XÓA hồ sơ người bán", th: "ลบโปรไฟล์ผู้ขาย", id: "HAPUS profil penjual" },

  // ════ Admin — plans / payments / reports / system / broadcast ════
  rd_adm_new_plan: { en: "+ New plan", fil: "+ Bagong plan", zh: "+ 新方案", "zh-TW": "+ 新方案", vi: "+ Gói mới", th: "+ แผนใหม่", id: "+ Paket baru" },
  rd_adm_collected_today: { en: "Collected today", fil: "Nakolekta ngayon", zh: "今日收款", "zh-TW": "今日收款", vi: "Thu hôm nay", th: "เก็บได้วันนี้", id: "Terkumpul hari ini" },
  rd_adm_pending: { en: "Pending", fil: "Nakabinbin", zh: "待处理", "zh-TW": "待處理", vi: "Đang chờ", th: "รอดำเนินการ", id: "Tertunda" },
  rd_adm_recent_tx: { en: "Recent transactions", fil: "Mga kamakailang transaksyon", zh: "最近交易", "zh-TW": "最近交易", vi: "Giao dịch gần đây", th: "ธุรกรรมล่าสุด", id: "Transaksi terbaru" },
  rd_adm_mrr: { en: "MRR", fil: "MRR", zh: "MRR", "zh-TW": "MRR", vi: "MRR", th: "MRR", id: "MRR" },
  rd_adm_growth: { en: "Growth", fil: "Paglago", zh: "增长", "zh-TW": "成長", vi: "Tăng trưởng", th: "การเติบโต", id: "Pertumbuhan" },
  rd_adm_churn: { en: "Churn", fil: "Churn", zh: "流失率", "zh-TW": "流失率", vi: "Tỷ lệ rời bỏ", th: "อัตราเลิกใช้", id: "Churn" },
  rd_adm_arpu: { en: "ARPU", fil: "ARPU", zh: "ARPU", "zh-TW": "ARPU", vi: "ARPU", th: "ARPU", id: "ARPU" },
  rd_adm_reports_h: { en: "Reports", fil: "Mga ulat", zh: "报表", "zh-TW": "報表", vi: "Báo cáo", th: "รายงาน", id: "Laporan" },
  rd_adm_rep_revplan: { en: "Revenue by plan", fil: "Kita kada plan", zh: "各方案营收", "zh-TW": "各方案營收", vi: "Doanh thu theo gói", th: "รายได้ตามแผน", id: "Pendapatan per paket" },
  rd_adm_rep_growth: { en: "Seller growth", fil: "Paglago ng seller", zh: "卖家增长", "zh-TW": "賣家成長", vi: "Tăng trưởng người bán", th: "การเติบโตของผู้ขาย", id: "Pertumbuhan penjual" },
  rd_adm_rep_churn: { en: "Churn & renewals", fil: "Churn at renewals", zh: "流失与续订", "zh-TW": "流失與續訂", vi: "Rời bỏ & gia hạn", th: "การเลิกใช้และต่ออายุ", id: "Churn & perpanjangan" },
  rd_adm_sys_desc_pre: { en: "Enter the amount a new seller paid — the matching plan is selected automatically. Granting here is coming soon; for now use the per-seller plan buttons in ", fil: "Ilagay ang halagang binayaran ng bagong seller — awtomatikong pipiliin ang tugmang plan. Malapit na ang pag-grant dito; sa ngayon gamitin ang per-seller na plan buttons sa ", zh: "输入新卖家支付的金额——系统会自动选择匹配的方案。此处的授予即将推出；目前请使用每个卖家的方案按钮，位于", "zh-TW": "輸入新賣家支付的金額——系統會自動選擇相符的方案。此處的授予即將推出；目前請使用每位賣家的方案按鈕，位於", vi: "Nhập số tiền người bán mới đã trả — gói phù hợp được chọn tự động. Cấp tại đây sắp có; hiện hãy dùng nút gói theo từng người bán trong ", th: "กรอกจำนวนเงินที่ผู้ขายใหม่จ่าย — ระบบจะเลือกแผนที่ตรงกันอัตโนมัติ การให้สิทธิ์ที่นี่กำลังจะมา ตอนนี้ใช้ปุ่มแผนรายผู้ขายใน ", id: "Masukkan jumlah yang dibayar penjual baru — paket yang cocok dipilih otomatis. Pemberian di sini segera hadir; untuk saat ini gunakan tombol paket per penjual di " },
  rd_adm_sys_desc_post: { en: ".", fil: ".", zh: "。", "zh-TW": "。", vi: ".", th: ".", id: "." },
  rd_adm_amount_paid: { en: "Amount paid", fil: "Halagang binayaran", zh: "支付金额", "zh-TW": "支付金額", vi: "Số tiền đã trả", th: "จำนวนเงินที่จ่าย", id: "Jumlah dibayar" },
  rd_adm_matched_plan: { en: "Matched plan", fil: "Tugmang plan", zh: "匹配方案", "zh-TW": "相符方案", vi: "Gói khớp", th: "แผนที่ตรงกัน", id: "Paket cocok" },
  rd_adm_assign_seller: { en: "Assign to seller", fil: "Italaga sa seller", zh: "分配给卖家", "zh-TW": "指派給賣家", vi: "Gán cho người bán", th: "กำหนดให้ผู้ขาย", id: "Tetapkan ke penjual" },
  rd_adm_select_seller: { en: "Select seller", fil: "Pumili ng seller", zh: "选择卖家", "zh-TW": "選擇賣家", vi: "Chọn người bán", th: "เลือกผู้ขาย", id: "Pilih penjual" },
  rd_adm_grant: { en: "Grant {plan} plan", fil: "Igawad ang {plan} plan", zh: "授予 {plan} 方案", "zh-TW": "授予 {plan} 方案", vi: "Cấp gói {plan}", th: "ให้แผน {plan}", id: "Berikan paket {plan}" },
  rd_adm_audience: { en: "Audience", fil: "Audience", zh: "受众", "zh-TW": "受眾", vi: "Đối tượng", th: "ผู้รับ", id: "Audiens" },
  rd_adm_all_sellers: { en: "All sellers", fil: "Lahat ng seller", zh: "所有卖家", "zh-TW": "所有賣家", vi: "Tất cả người bán", th: "ผู้ขายทั้งหมด", id: "Semua penjual" },
  rd_adm_pro_only: { en: "Pro only", fil: "Pro lang", zh: "仅 Pro", "zh-TW": "僅 Pro", vi: "Chỉ Pro", th: "เฉพาะ Pro", id: "Pro saja" },
  rd_adm_bc_expiring: { en: "Expiring", fil: "Mag-e-expire", zh: "即将到期", "zh-TW": "即將到期", vi: "Sắp hết hạn", th: "ใกล้หมดอายุ", id: "Akan kedaluwarsa" },
  rd_adm_message: { en: "Message", fil: "Mensahe", zh: "消息", "zh-TW": "訊息", vi: "Tin nhắn", th: "ข้อความ", id: "Pesan" },
  rd_adm_announce_ph: { en: "Type your announcement to sellers…", fil: "I-type ang iyong anunsyo sa mga seller…", zh: "输入要发给卖家的公告…", "zh-TW": "輸入要發給賣家的公告…", vi: "Nhập thông báo gửi người bán…", th: "พิมพ์ประกาศถึงผู้ขาย…", id: "Ketik pengumuman untuk penjual…" },
  rd_adm_send_broadcast: { en: "Send broadcast", fil: "Magpadala ng broadcast", zh: "发送广播", "zh-TW": "傳送廣播", vi: "Gửi thông báo", th: "ส่งประกาศ", id: "Kirim siaran" },

  // ════ Admin — sub-bucket notes / statuses ════
  rd_adm_st_active: { en: "Active", fil: "Aktibo", zh: "有效", "zh-TW": "有效", vi: "Hoạt động", th: "ใช้งานอยู่", id: "Aktif" },
  rd_adm_st_expiring: { en: "Expiring", fil: "Mag-e-expire", zh: "即将到期", "zh-TW": "即將到期", vi: "Sắp hết hạn", th: "ใกล้หมดอายุ", id: "Akan kedaluwarsa" },
  rd_adm_st_expired: { en: "Expired", fil: "Nag-expire", zh: "已过期", "zh-TW": "已過期", vi: "Hết hạn", th: "หมดอายุ", id: "Kedaluwarsa" },
  rd_adm_st_free: { en: "Free", fil: "Libre", zh: "免费", "zh-TW": "免費", vi: "Miễn phí", th: "ฟรี", id: "Gratis" },
  rd_adm_note_active_one: { en: "{n} active paid subscription", fil: "{n} aktibong bayad na subscription", zh: "{n} 个有效付费订阅", "zh-TW": "{n} 個有效付費訂閱", vi: "{n} đăng ký trả phí đang hoạt động", th: "การสมัครจ่ายเงินที่ใช้งานอยู่ {n} รายการ", id: "{n} langganan berbayar aktif" },
  rd_adm_note_active_many: { en: "{n} active paid subscriptions", fil: "{n} aktibong bayad na subscription", zh: "{n} 个有效付费订阅", "zh-TW": "{n} 個有效付費訂閱", vi: "{n} đăng ký trả phí đang hoạt động", th: "การสมัครจ่ายเงินที่ใช้งานอยู่ {n} รายการ", id: "{n} langganan berbayar aktif" },
  rd_adm_note_expiring: { en: "{n} expiring soon — renew or follow up", fil: "{n} malapit nang mag-expire — i-renew o i-follow up", zh: "{n} 个即将到期——续订或跟进", "zh-TW": "{n} 個即將到期——續訂或跟進", vi: "{n} sắp hết hạn — gia hạn hoặc theo dõi", th: "{n} ใกล้หมดอายุ — ต่ออายุหรือติดตาม", id: "{n} akan kedaluwarsa — perpanjang atau tindak lanjuti" },
  rd_adm_note_expired: { en: "{n} expired — not renewed / no payment", fil: "{n} nag-expire — hindi na-renew / walang bayad", zh: "{n} 个已过期——未续订 / 未付款", "zh-TW": "{n} 個已過期——未續訂 / 未付款", vi: "{n} đã hết hạn — chưa gia hạn / chưa thanh toán", th: "{n} หมดอายุ — ไม่ต่ออายุ / ไม่ชำระเงิน", id: "{n} kedaluwarsa — tidak diperpanjang / tanpa pembayaran" },
  rd_adm_note_active_sample: { en: "Active paid subscriptions · showing recent", fil: "Aktibong bayad na subscription · ipinapakita ang kamakailan", zh: "有效付费订阅 · 显示最近", "zh-TW": "有效付費訂閱 · 顯示最近", vi: "Đăng ký trả phí đang hoạt động · hiển thị gần đây", th: "การสมัครจ่ายเงินที่ใช้งานอยู่ · แสดงล่าสุด", id: "Langganan berbayar aktif · menampilkan terbaru" },
  rd_adm_note_expiring_sample: { en: "Expiring soon — renew or follow up", fil: "Malapit nang mag-expire — i-renew o i-follow up", zh: "即将到期——续订或跟进", "zh-TW": "即將到期——續訂或跟進", vi: "Sắp hết hạn — gia hạn hoặc theo dõi", th: "ใกล้หมดอายุ — ต่ออายุหรือติดตาม", id: "Akan kedaluwarsa — perpanjang atau tindak lanjuti" },
  rd_adm_note_free_sample: { en: "Free-tier shops · plan & free cycle", fil: "Mga libreng-tier na shop · plan at libreng cycle", zh: "免费版店铺 · 方案与免费周期", "zh-TW": "免費版賣場 · 方案與免費週期", vi: "Cửa hàng gói miễn phí · gói & chu kỳ miễn phí", th: "ร้านระดับฟรี · แผนและรอบฟรี", id: "Toko tingkat gratis · paket & siklus gratis" },
  rd_adm_note_expired_sample: { en: "Expired — not renewed / no payment", fil: "Nag-expire — hindi na-renew / walang bayad", zh: "已过期——未续订 / 未付款", "zh-TW": "已過期——未續訂 / 未付款", vi: "Hết hạn — chưa gia hạn / chưa thanh toán", th: "หมดอายุ — ไม่ต่ออายุ / ไม่ชำระเงิน", id: "Kedaluwarsa — tidak diperpanjang / tanpa pembayaran" },

  // ════ Admin — notifs / revenue / userbase / audit ════
  rd_adm_notif_sub: { en: "New sign-ups & subscriptions expiring within 5 days", fil: "Mga bagong sign-up at subscription na mag-e-expire sa loob ng 5 araw", zh: "新注册及 5 天内到期的订阅", "zh-TW": "新註冊及 5 天內到期的訂閱", vi: "Đăng ký mới & các gói hết hạn trong 5 ngày", th: "การสมัครใหม่และการสมัครที่หมดอายุภายใน 5 วัน", id: "Pendaftaran baru & langganan kedaluwarsa dalam 5 hari" },
  rd_adm_rev_thismonth: { en: "This month · from paid subscribers", fil: "Ngayong buwan · mula sa mga bayad na subscriber", zh: "本月 · 来自付费订阅者", "zh-TW": "本月 · 來自付費訂閱者", vi: "Tháng này · từ người đăng ký trả phí", th: "เดือนนี้ · จากสมาชิกแบบจ่ายเงิน", id: "Bulan ini · dari pelanggan berbayar" },
  rd_adm_rev_vslast: { en: "▲ 12% vs last month", fil: "▲ 12% vs nakaraang buwan", zh: "▲ 较上月 12%", "zh-TW": "▲ 較上月 12%", vi: "▲ 12% so tháng trước", th: "▲ 12% เทียบเดือนก่อน", id: "▲ 12% vs bulan lalu" },
  rd_adm_platform_fees: { en: "Platform fees", fil: "Mga bayarin sa platform", zh: "平台费用", "zh-TW": "平台費用", vi: "Phí nền tảng", th: "ค่าธรรมเนียมแพลตฟอร์ม", id: "Biaya platform" },
  rd_adm_net_profit: { en: "Net profit", fil: "Net na kita", zh: "净利润", "zh-TW": "淨利潤", vi: "Lợi nhuận ròng", th: "กำไรสุทธิ", id: "Laba bersih" },
  rd_adm_detected: { en: "Detected from plan changes", fil: "Natukoy mula sa mga pagbabago ng plan", zh: "从方案变更中检测", "zh-TW": "從方案變更中偵測", vi: "Phát hiện từ thay đổi gói", th: "ตรวจพบจากการเปลี่ยนแผน", id: "Terdeteksi dari perubahan paket" },
  rd_adm_rev_live: { en: "Live — when you upgrade a paid seller", fil: "Live — kapag nag-upgrade ka ng bayad na seller", zh: "实时——当你升级付费卖家时", "zh-TW": "即時——當你升級付費賣家時", vi: "Trực tiếp — khi bạn nâng cấp người bán trả phí", th: "เรียลไทม์ — เมื่อคุณอัปเกรดผู้ขายแบบจ่ายเงิน", id: "Langsung — saat Anda upgrade penjual berbayar" },
  rd_adm_rev_by_plan: { en: "Revenue by plan", fil: "Kita kada plan", zh: "各方案营收", "zh-TW": "各方案營收", vi: "Doanh thu theo gói", th: "รายได้ตามแผน", id: "Pendapatan per paket" },
  rd_adm_subscribers: { en: "subscribers", fil: "subscriber", zh: "订阅者", "zh-TW": "訂閱者", vi: "người đăng ký", th: "สมาชิก", id: "pelanggan" },
  rd_adm_export_rev: { en: "Export revenue report", fil: "I-export ang revenue report", zh: "导出营收报表", "zh-TW": "匯出營收報表", vi: "Xuất báo cáo doanh thu", th: "ส่งออกรายงานรายได้", id: "Ekspor laporan pendapatan" },
  rd_adm_paid_plans: { en: "Paid plans", fil: "Mga bayad na plan", zh: "付费方案", "zh-TW": "付費方案", vi: "Gói trả phí", th: "แผนแบบจ่ายเงิน", id: "Paket berbayar" },
  rd_adm_paying_plus_one: { en: "{n} paying seller + you", fil: "{n} nagbabayad na seller + ikaw", zh: "{n} 位付费卖家 + 你", "zh-TW": "{n} 位付費賣家 + 你", vi: "{n} người bán trả phí + bạn", th: "ผู้ขายแบบจ่ายเงิน {n} ราย + คุณ", id: "{n} penjual berbayar + Anda" },
  rd_adm_paying_plus_many: { en: "{n} paying sellers + you", fil: "{n} nagbabayad na seller + ikaw", zh: "{n} 位付费卖家 + 你", "zh-TW": "{n} 位付費賣家 + 你", vi: "{n} người bán trả phí + bạn", th: "ผู้ขายแบบจ่ายเงิน {n} ราย + คุณ", id: "{n} penjual berbayar + Anda" },
  rd_adm_accounts_total: { en: "{n} accounts total", fil: "{n} account sa kabuuan", zh: "共 {n} 个账户", "zh-TW": "共 {n} 個帳號", vi: "tổng {n} tài khoản", th: "บัญชีทั้งหมด {n}", id: "total {n} akun" },
  rd_adm_paid_by_tier: { en: "Paid plans by tier", fil: "Mga bayad na plan kada tier", zh: "各级别付费方案", "zh-TW": "各級別付費方案", vi: "Gói trả phí theo cấp", th: "แผนแบบจ่ายเงินตามระดับ", id: "Paket berbayar per tingkat" },
  rd_adm_incl_you: { en: " (incl. you)", fil: " (kasama ka)", zh: "（含你）", "zh-TW": "（含你）", vi: " (gồm bạn)", th: " (รวมคุณ)", id: " (termasuk Anda)" },
  rd_adm_trial: { en: "Trial:", fil: "Trial:", zh: "试用：", "zh-TW": "試用：", vi: "Dùng thử:", th: "ทดลอง:", id: "Uji coba:" },
  rd_adm_paid_status: { en: "Paid status", fil: "Status ng bayad", zh: "付费状态", "zh-TW": "付費狀態", vi: "Trạng thái trả phí", th: "สถานะการจ่ายเงิน", id: "Status berbayar" },
  rd_adm_expiring_1d: { en: "Expiring ≤1d", fil: "Mag-e-expire ≤1d", zh: "≤1 天到期", "zh-TW": "≤1 天到期", vi: "Hết hạn ≤1 ngày", th: "หมดอายุ ≤1 วัน", id: "Kedaluwarsa ≤1h" },
  rd_adm_free_cap_usage: { en: "Free tier — cap usage", fil: "Libreng tier — paggamit ng cap", zh: "免费版 — 上限用量", "zh-TW": "免費版 — 上限用量", vi: "Gói miễn phí — mức dùng giới hạn", th: "ระดับฟรี — การใช้ตามขีดจำกัด", id: "Tingkat gratis — penggunaan batas" },
  rd_adm_view: { en: "View ›", fil: "Tingnan ›", zh: "查看 ›", "zh-TW": "查看 ›", vi: "Xem ›", th: "ดู ›", id: "Lihat ›" },
  rd_adm_free_users: { en: "Free users", fil: "Mga libreng user", zh: "免费用户", "zh-TW": "免費用戶", vi: "Người dùng miễn phí", th: "ผู้ใช้ฟรี", id: "Pengguna gratis" },
  rd_adm_near_cap: { en: "Near cap", fil: "Malapit sa cap", zh: "接近上限", "zh-TW": "接近上限", vi: "Gần giới hạn", th: "ใกล้ขีดจำกัด", id: "Hampir batas" },
  rd_adm_capped: { en: "Capped", fil: "Naabot ang cap", zh: "已达上限", "zh-TW": "已達上限", vi: "Đã đạt giới hạn", th: "ถึงขีดจำกัด", id: "Mencapai batas" },
  rd_adm_free_loads: { en: "Free-tier usage loads for the signed-in admin (cap {cap}/cycle).", fil: "Naglo-load ang paggamit ng libreng-tier para sa naka-sign-in na admin (cap {cap}/cycle).", zh: "免费版用量为已登录的管理员加载（上限 {cap}/周期）。", "zh-TW": "免費版用量為已登入的管理員載入（上限 {cap}/週期）。", vi: "Mức dùng gói miễn phí tải cho admin đã đăng nhập (giới hạn {cap}/chu kỳ).", th: "การใช้ระดับฟรีโหลดสำหรับแอดมินที่ลงชื่อเข้าใช้ (ขีดจำกัด {cap}/รอบ)", id: "Penggunaan tingkat gratis dimuat untuk admin yang masuk (batas {cap}/siklus)." },
  rd_adm_audit_search: { en: "Search admin, action, target…", fil: "Maghanap ng admin, action, target…", zh: "搜索管理员、操作、目标…", "zh-TW": "搜尋管理員、操作、目標…", vi: "Tìm admin, hành động, đối tượng…", th: "ค้นหาแอดมิน การกระทำ เป้าหมาย…", id: "Cari admin, aksi, target…" },
  rd_adm_csv: { en: "⬇ CSV", fil: "⬇ CSV", zh: "⬇ CSV", "zh-TW": "⬇ CSV", vi: "⬇ CSV", th: "⬇ CSV", id: "⬇ CSV" },
  rd_adm_loading_audit: { en: "Loading audit log…", fil: "Nilo-load ang audit log…", zh: "正在加载审计日志…", "zh-TW": "正在載入稽核日誌…", vi: "Đang tải nhật ký kiểm toán…", th: "กำลังโหลดบันทึกการตรวจสอบ…", id: "Memuat log audit…" },
  rd_adm_no_activity: { en: "No admin activity yet.", fil: "Wala pang aktibidad ng admin.", zh: "暂无管理员活动。", "zh-TW": "尚無管理員活動。", vi: "Chưa có hoạt động quản trị.", th: "ยังไม่มีกิจกรรมของแอดมิน", id: "Belum ada aktivitas admin." },
  rd_adm_no_records: { en: "No audit records found.", fil: "Walang nakitang audit record.", zh: "未找到审计记录。", "zh-TW": "找不到稽核紀錄。", vi: "Không tìm thấy bản ghi kiểm toán.", th: "ไม่พบบันทึกการตรวจสอบ", id: "Tidak ada catatan audit ditemukan." },

  // ════ Shared (auth) ════
  rd_terms: { en: "Terms", fil: "Mga Tuntunin", zh: "条款", "zh-TW": "條款", vi: "Điều khoản", th: "ข้อกำหนด", id: "Ketentuan" },

  // ════ Login ════
  rd_login_hero_title: { en: "Turn every live comment into a paid order.", fil: "Gawing bayad na order ang bawat live na komento.", zh: "把每条直播评论变成付费订单。", "zh-TW": "把每則直播留言變成付費訂單。", vi: "Biến mọi bình luận live thành đơn hàng trả tiền.", th: "เปลี่ยนทุกคอมเมนต์สดให้เป็นออเดอร์ที่จ่ายเงิน", id: "Ubah setiap komentar live menjadi pesanan berbayar." },
  rd_login_hero_sub: { en: 'Auto-capture "mine" claims from TikTok & Facebook live, build order slips instantly, and print to ship.', fil: 'Awtomatikong kunin ang mga "mine" claim mula sa TikTok at Facebook live, gumawa agad ng order slip, at i-print para i-ship.', zh: '自动捕捉 TikTok 和 Facebook 直播中的「mine」认领，即时生成订单单据，并打印发货。', "zh-TW": "自動擷取 TikTok 與 Facebook 直播中的「mine」認領，即時產生訂單單據，並列印出貨。", vi: 'Tự động ghi nhận "mine" từ live TikTok & Facebook, tạo phiếu đơn tức thì và in để giao.', th: 'จับ "mine" จากไลฟ์ TikTok และ Facebook อัตโนมัติ สร้างใบออเดอร์ทันที และพิมพ์เพื่อจัดส่ง', id: 'Tangkap otomatis klaim "mine" dari live TikTok & Facebook, buat slip pesanan instan, dan cetak untuk dikirim.' },
  rd_login_stat_sellers: { en: "sellers", fil: "seller", zh: "卖家", "zh-TW": "賣家", vi: "người bán", th: "ผู้ขาย", id: "penjual" },
  rd_login_stat_orders: { en: "orders", fil: "order", zh: "订单", "zh-TW": "訂單", vi: "đơn hàng", th: "ออเดอร์", id: "pesanan" },
  rd_login_stat_rating: { en: "rating", fil: "rating", zh: "评分", "zh-TW": "評分", vi: "đánh giá", th: "คะแนน", id: "rating" },
  rd_login_welcome: { en: "Welcome back", fil: "Maligayang pagbabalik", zh: "欢迎回来", "zh-TW": "歡迎回來", vi: "Chào mừng trở lại", th: "ยินดีต้อนรับกลับ", id: "Selamat datang kembali" },
  rd_login_phone_email: { en: "Phone or email", fil: "Telepono o email", zh: "电话或邮箱", "zh-TW": "電話或電子郵件", vi: "Điện thoại hoặc email", th: "โทรศัพท์หรืออีเมล", id: "Telepon atau email" },
  rd_login_email_ph: { en: "you@example.com", fil: "you@example.com", zh: "you@example.com", "zh-TW": "you@example.com", vi: "you@example.com", th: "you@example.com", id: "you@example.com" },
  rd_login_password: { en: "Password", fil: "Password", zh: "密码", "zh-TW": "密碼", vi: "Mật khẩu", th: "รหัสผ่าน", id: "Kata sandi" },
  rd_login_password_ph: { en: "Your password", fil: "Iyong password", zh: "你的密码", "zh-TW": "你的密碼", vi: "Mật khẩu của bạn", th: "รหัสผ่านของคุณ", id: "Kata sandi Anda" },
  rd_login_forgot: { en: "Forgot password?", fil: "Nakalimutan ang password?", zh: "忘记密码？", "zh-TW": "忘記密碼？", vi: "Quên mật khẩu?", th: "ลืมรหัสผ่าน?", id: "Lupa kata sandi?" },
  rd_login_err_empty: { en: "Enter your email and password.", fil: "Ilagay ang iyong email at password.", zh: "请输入邮箱和密码。", "zh-TW": "請輸入電子郵件與密碼。", vi: "Nhập email và mật khẩu của bạn.", th: "กรอกอีเมลและรหัสผ่านของคุณ", id: "Masukkan email dan kata sandi Anda." },
  rd_login_err_failed: { en: "Sign-in failed. Check your details and try again.", fil: "Nabigo ang pag-sign-in. Suriin ang iyong detalye at subukan ulit.", zh: "登录失败。请检查信息后重试。", "zh-TW": "登入失敗。請檢查資料後重試。", vi: "Đăng nhập thất bại. Kiểm tra thông tin và thử lại.", th: "เข้าสู่ระบบไม่สำเร็จ ตรวจสอบข้อมูลแล้วลองใหม่", id: "Gagal masuk. Periksa detail Anda dan coba lagi." },
  rd_login_unavailable: { en: "Sign-in is unavailable in this preview (Supabase not configured).", fil: "Hindi available ang sign-in sa preview na ito (hindi naka-configure ang Supabase).", zh: "此预览中无法登录（Supabase 未配置）。", "zh-TW": "此預覽中無法登入（Supabase 未設定）。", vi: "Đăng nhập không khả dụng trong bản xem trước này (Supabase chưa cấu hình).", th: "เข้าสู่ระบบไม่ได้ในพรีวิวนี้ (ยังไม่ตั้งค่า Supabase)", id: "Masuk tidak tersedia di pratinjau ini (Supabase belum dikonfigurasi)." },
  rd_login_logging_in: { en: "Logging in…", fil: "Naglo-log in…", zh: "正在登录…", "zh-TW": "正在登入…", vi: "Đang đăng nhập…", th: "กำลังเข้าสู่ระบบ…", id: "Masuk…" },
  rd_login_login_btn: { en: "Log in", fil: "Mag-log in", zh: "登录", "zh-TW": "登入", vi: "Đăng nhập", th: "เข้าสู่ระบบ", id: "Masuk" },
  rd_login_new_here: { en: "New here?", fil: "Bago dito?", zh: "第一次来？", "zh-TW": "第一次來？", vi: "Mới ở đây?", th: "เพิ่งมาใหม่?", id: "Baru di sini?" },
  rd_login_create_account: { en: "Create account", fil: "Gumawa ng account", zh: "创建账户", "zh-TW": "建立帳號", vi: "Tạo tài khoản", th: "สร้างบัญชี", id: "Buat akun" },
  rd_login_need_help: { en: "Need help?", fil: "Kailangan ng tulong?", zh: "需要帮助？", "zh-TW": "需要協助？", vi: "Cần trợ giúp?", th: "ต้องการความช่วยเหลือ?", id: "Butuh bantuan?" },
  rd_login_terms_pre: { en: "By continuing you agree to our ", fil: "Sa pagpapatuloy sumasang-ayon ka sa aming ", zh: "继续即表示你同意我们的", "zh-TW": "繼續即表示你同意我們的", vi: "Khi tiếp tục, bạn đồng ý với ", th: "การดำเนินการต่อแสดงว่าคุณยอมรับ", id: "Dengan melanjutkan Anda menyetujui " },
  rd_login_reset_title: { en: "Reset your password", fil: "I-reset ang iyong password", zh: "重置你的密码", "zh-TW": "重設你的密碼", vi: "Đặt lại mật khẩu của bạn", th: "รีเซ็ตรหัสผ่านของคุณ", id: "Setel ulang kata sandi Anda" },
  rd_login_reset_desc: { en: "For your security, passwords can only be reset by an admin. Message us on Telegram and we’ll help you create a new password right away.", fil: "Para sa iyong seguridad, ang password ay maaari lang i-reset ng admin. Mag-message sa amin sa Telegram at tutulungan ka naming gumawa ng bagong password agad.", zh: "为了你的安全，密码只能由管理员重置。在 Telegram 上联系我们，我们会立即帮你创建新密码。", "zh-TW": "為了你的安全，密碼只能由管理員重設。在 Telegram 上聯絡我們，我們會立即協助你建立新密碼。", vi: "Vì sự an toàn của bạn, mật khẩu chỉ có thể được đặt lại bởi admin. Nhắn cho chúng tôi trên Telegram và chúng tôi sẽ giúp bạn tạo mật khẩu mới ngay.", th: "เพื่อความปลอดภัยของคุณ รหัสผ่านสามารถรีเซ็ตได้โดยแอดมินเท่านั้น ส่งข้อความหาเราทาง Telegram แล้วเราจะช่วยคุณสร้างรหัสผ่านใหม่ทันที", id: "Demi keamanan Anda, kata sandi hanya dapat disetel ulang oleh admin. Kirim pesan ke kami di Telegram dan kami akan membantu Anda membuat kata sandi baru segera." },
  rd_login_maybe_next: { en: "Maybe next time", fil: "Sa susunod na lang", zh: "下次再说", "zh-TW": "下次再說", vi: "Để lần sau", th: "ไว้คราวหน้า", id: "Mungkin lain kali" },
  rd_login_next: { en: "Next", fil: "Susunod", zh: "下一步", "zh-TW": "下一步", vi: "Tiếp", th: "ถัดไป", id: "Berikutnya" },

  // ════ Signup ════
  rd_su_subtitle: { en: "Set up your shop — start capturing live orders.", fil: "I-set up ang iyong shop — simulan ang pagkuha ng live orders.", zh: "设置你的店铺——开始捕捉直播订单。", "zh-TW": "設定你的賣場——開始擷取直播訂單。", vi: "Thiết lập cửa hàng — bắt đầu ghi đơn hàng live.", th: "ตั้งค่าร้านของคุณ — เริ่มจับออเดอร์สด", id: "Siapkan toko Anda — mulai menangkap pesanan live." },
  rd_su_shop_profile: { en: "SHOP PROFILE", fil: "SHOP PROFILE", zh: "店铺资料", "zh-TW": "賣場資料", vi: "HỒ SƠ CỬA HÀNG", th: "โปรไฟล์ร้าน", id: "PROFIL TOKO" },
  rd_su_shop_ph: { en: "e.g. Maria's Live Shop", fil: "hal. Maria's Live Shop", zh: "例如 Maria's Live Shop", "zh-TW": "例如 Maria's Live Shop", vi: "ví dụ Maria's Live Shop", th: "เช่น Maria's Live Shop", id: "mis. Maria's Live Shop" },
  rd_su_fullname_ph: { en: "Full name", fil: "Buong pangalan", zh: "全名", "zh-TW": "全名", vi: "Họ và tên", th: "ชื่อเต็ม", id: "Nama lengkap" },
  rd_su_phone_ph: { en: "0917 000 0000", fil: "0917 000 0000", zh: "0917 000 0000", "zh-TW": "0917 000 0000", vi: "0917 000 0000", th: "0917 000 0000", id: "0917 000 0000" },
  rd_su_email_ph: { en: "you@email.com", fil: "you@email.com", zh: "you@email.com", "zh-TW": "you@email.com", vi: "you@email.com", th: "you@email.com", id: "you@email.com" },
  rd_su_password_h: { en: "PASSWORD", fil: "PASSWORD", zh: "密码", "zh-TW": "密碼", vi: "MẬT KHẨU", th: "รหัสผ่าน", id: "KATA SANDI" },
  rd_su_pw_ph: { en: "Create a password (≥6 chars)", fil: "Gumawa ng password (≥6 char)", zh: "创建密码（≥6 个字符）", "zh-TW": "建立密碼（≥6 個字元）", vi: "Tạo mật khẩu (≥6 ký tự)", th: "สร้างรหัสผ่าน (≥6 ตัว)", id: "Buat kata sandi (≥6 karakter)" },
  rd_su_confirm: { en: "Confirm password", fil: "Kumpirmahin ang password", zh: "确认密码", "zh-TW": "確認密碼", vi: "Xác nhận mật khẩu", th: "ยืนยันรหัสผ่าน", id: "Konfirmasi kata sandi" },
  rd_su_confirm_ph: { en: "Re-enter password", fil: "Ilagay ulit ang password", zh: "再次输入密码", "zh-TW": "再次輸入密碼", vi: "Nhập lại mật khẩu", th: "กรอกรหัสผ่านอีกครั้ง", id: "Masukkan ulang kata sandi" },
  rd_su_ok_confirm: { en: "Account created — check your email to confirm, then log in.", fil: "Nagawa ang account — tingnan ang iyong email para kumpirmahin, tapos mag-log in.", zh: "账户已创建——查看邮箱确认后再登录。", "zh-TW": "帳號已建立——查看電子郵件確認後再登入。", vi: "Đã tạo tài khoản — kiểm tra email để xác nhận, rồi đăng nhập.", th: "สร้างบัญชีแล้ว — ตรวจอีเมลเพื่อยืนยัน แล้วเข้าสู่ระบบ", id: "Akun dibuat — periksa email untuk konfirmasi, lalu masuk." },
  rd_su_err: { en: "Could not create your account.", fil: "Hindi nagawa ang iyong account.", zh: "无法创建你的账户。", "zh-TW": "無法建立你的帳號。", vi: "Không thể tạo tài khoản của bạn.", th: "ไม่สามารถสร้างบัญชีของคุณได้", id: "Tidak dapat membuat akun Anda." },
  rd_su_creating: { en: "Creating…", fil: "Ginagawa…", zh: "正在创建…", "zh-TW": "正在建立…", vi: "Đang tạo…", th: "กำลังสร้าง…", id: "Membuat…" },
  rd_su_terms_pre: { en: "By creating an account you agree to our ", fil: "Sa paggawa ng account sumasang-ayon ka sa aming ", zh: "创建账户即表示你同意我们的", "zh-TW": "建立帳號即表示你同意我們的", vi: "Khi tạo tài khoản, bạn đồng ý với ", th: "การสร้างบัญชีแสดงว่าคุณยอมรับ", id: "Dengan membuat akun Anda menyetujui " },
  rd_su_have_account: { en: "Already have an account?", fil: "May account na?", zh: "已有账户？", "zh-TW": "已有帳號？", vi: "Đã có tài khoản?", th: "มีบัญชีอยู่แล้ว?", id: "Sudah punya akun?" },

  // ════ Channels editor (plan-capped account slots) — mapped keys reuse production
  //     set_* values verbatim (en + native-verified zh-TW). ════
  rd_ch_banner: { en: "Accounts you've saved are locked — message us to change them. Empty slots up to your plan limit are editable.", fil: "Naka-lock ang mga naka-save nang account — mag-message para mapalitan. Editable ang mga walang laman na slot hanggang sa limit ng plano mo.", zh: "已保存的账号已锁定——如需更改请联系我们。在套餐上限内的空白栏位可以编辑。", "zh-TW": "已儲存的帳號已鎖定——如需更改請聯絡我們。在方案上限內的空白欄位可以編輯。", vi: "Các tài khoản đã lưu sẽ bị khóa — hãy nhắn tin cho chúng tôi để thay đổi. Các ô trống trong giới hạn gói của bạn có thể chỉnh sửa.", th: "บัญชีที่บันทึกไว้แล้วจะถูกล็อก — ติดต่อเราเพื่อเปลี่ยนแปลง ช่องว่างภายในขีดจำกัดแพ็กเกจของคุณสามารถแก้ไขได้", id: "Akun yang sudah disimpan terkunci — hubungi kami untuk mengubahnya. Slot kosong dalam batas paket Anda dapat diedit." },
  rd_ch_tiktok_account: { en: "TikTok account", fil: "TikTok account", zh: "TikTok 账号", "zh-TW": "TikTok 帳號", vi: "Tài khoản TikTok", th: "บัญชี TikTok", id: "Akun TikTok" },
  rd_ch_facebook_page: { en: "Facebook page", fil: "Facebook page", zh: "Facebook 主页", "zh-TW": "Facebook 粉絲專頁", vi: "Trang Facebook", th: "เพจ Facebook", id: "Halaman Facebook" },
  rd_ch_locked_note: { en: "Locked. Admin can change this account.", fil: "Naka-lock. Ang admin lang ang makakapagpalit ng account na ito.", zh: "已锁定。仅管理员可更改此账号。", "zh-TW": "已鎖定。僅管理員可變更此帳號。", vi: "Đã khoá. Chỉ admin có thể thay đổi tài khoản này.", th: "ล็อกอยู่ เฉพาะแอดมินเท่านั้นที่เปลี่ยนบัญชีนี้ได้", id: "Terkunci. Hanya admin yang dapat mengubah akun ini." },
  rd_ch_limit_reached: { en: "Plan account limit reached", fil: "Naabot na ang limit ng account sa plan", zh: "已达到套餐账号上限", "zh-TW": "已達方案帳號上限", vi: "Đã đạt giới hạn tài khoản của gói", th: "ถึงขีดจำกัดบัญชีของแพ็กเกจแล้ว", id: "Batas akun paket tercapai" },
  rd_ch_save: { en: "Save profile", fil: "I-save ang profile", zh: "保存个人信息", "zh-TW": "儲存個人資料", vi: "Lưu hồ sơ", th: "บันทึกโปรไฟล์", id: "Simpan profil" },
  rd_ch_add_tiktok: { en: "Add TikTok account", fil: "Magdagdag ng TikTok account", zh: "添加 TikTok 账号", "zh-TW": "新增 TikTok 帳號", vi: "Thêm tài khoản TikTok", th: "เพิ่มบัญชี TikTok", id: "Tambah akun TikTok" },
  rd_ch_add_facebook: { en: "Add Facebook page", fil: "Magdagdag ng Facebook page", zh: "添加 Facebook 主页", "zh-TW": "新增 Facebook 粉絲專頁", vi: "Thêm trang Facebook", th: "เพิ่มเพจ Facebook", id: "Tambah halaman Facebook" },
  rd_ch_add_cta: { en: "Open Telegram", fil: "Buksan ang Telegram", zh: "打开 Telegram", "zh-TW": "開啟 Telegram", vi: "Mở Telegram", th: "เปิด Telegram", id: "Buka Telegram" },
  rd_ch_add_cancel: { en: "Not now", fil: "Hindi muna", zh: "暂不", "zh-TW": "暫不", vi: "Để sau", th: "ไว้ก่อน", id: "Nanti saja" },
  rd_ch_ph: { en: "@yourusername", fil: "@yourusername", zh: "@yourusername", "zh-TW": "@yourusername", vi: "@yourusername", th: "@yourusername", id: "@yourusername" },
  // NET-NEW (no production mapping) — en authored; ⚠️ zh-TW/th/id AI drafts (NOT native-verified).
  rd_ch_validation: { en: "Username can only contain lowercase letters, numbers, underscores and periods.", fil: "Ang username ay maaari lang maglaman ng maliliit na titik, numero, underscore at tuldok.", zh: "用户名只能包含小写字母、数字、下划线和句点。", "zh-TW": "使用者名稱只能包含小寫字母、數字、底線與句點。", vi: "Tên người dùng chỉ được chứa chữ thường, số, dấu gạch dưới và dấu chấm.", th: "ชื่อผู้ใช้ใช้ได้เฉพาะตัวพิมพ์เล็ก ตัวเลข ขีดล่าง และจุดเท่านั้น", id: "Nama pengguna hanya boleh berisi huruf kecil, angka, garis bawah, dan titik." },
  rd_ch_pop_title_tt: { en: "Add TikTok ID — LIVE Multi Account!", fil: "Magdagdag ng TikTok ID — LIVE Multi Account!", zh: "添加 TikTok ID——多账号直播！", "zh-TW": "新增 TikTok ID——多帳號直播！", vi: "Thêm TikTok ID — LIVE Đa tài khoản!", th: "เพิ่ม TikTok ID — LIVE หลายบัญชี!", id: "Tambah TikTok ID — LIVE Multi Akun!" },
  rd_ch_pop_title_fb: { en: "Add Facebook ID — LIVE Multi Account!", fil: "Magdagdag ng Facebook ID — LIVE Multi Account!", zh: "添加 Facebook ID——多账号直播！", "zh-TW": "新增 Facebook ID——多帳號直播！", vi: "Thêm Facebook ID — LIVE Đa tài khoản!", th: "เพิ่ม Facebook ID — LIVE หลายบัญชี!", id: "Tambah Facebook ID — LIVE Multi Akun!" },
  rd_ch_pop_body: { en: "Multi-account LIVE is set up by our team. Message us on Telegram and we'll add or change your account.", fil: "Ang multi-account LIVE ay sino-set up ng aming team. Mag-message sa amin sa Telegram at idadagdag o papalitan namin ang iyong account.", zh: "多账号直播由我们的团队设置。请在 Telegram 上联系我们，我们会为你添加或更改账号。", "zh-TW": "多帳號直播由我們的團隊設定。請在 Telegram 上聯絡我們，我們會為你新增或變更帳號。", vi: "LIVE đa tài khoản do đội ngũ của chúng tôi thiết lập. Hãy nhắn tin cho chúng tôi trên Telegram và chúng tôi sẽ thêm hoặc thay đổi tài khoản cho bạn.", th: "การไลฟ์หลายบัญชีตั้งค่าโดยทีมงานของเรา ติดต่อเราทาง Telegram แล้วเราจะเพิ่มหรือเปลี่ยนบัญชีให้คุณ", id: "LIVE multi-akun diatur oleh tim kami. Hubungi kami di Telegram dan kami akan menambahkan atau mengubah akun Anda." },
};

// Transpose RAW (key→langs) into REDESIGN_STRINGS (lang→keys).
export const REDESIGN_STRINGS: RedesignStrings = (() => {
  const out: RedesignStrings = { en: {}, fil: {}, zh: {}, "zh-TW": {}, vi: {}, th: {}, id: {} };
  for (const [key, row] of Object.entries(RAW)) {
    for (const lang of VALID_LANGS) out[lang][key] = row[lang];
  }
  return out;
})();

// Exposed for verification scripts/tests: the raw key→langs map + the lang list.
export const RAW_KEYS = RAW;
export const LANGS_ALL = VALID_LANGS;

// Pure merge — supplement (new keys) wins over the production base. Exposed for tests.
export function applySupplement(base: T, supp: Record<string, string>): RedesignT {
  return { ...base, ...supp } as RedesignT;
}

export function buildT(lang: string, supplement: RedesignStrings = REDESIGN_STRINGS): RedesignT {
  const norm = normalizeLang(lang);
  return applySupplement(TRANSLATIONS[norm], supplement[norm] || {});
}

const TContext = createContext<RedesignT | null>(null);
export function TProvider({ lang, children }: { lang: string; children: ReactNode }) {
  const value = useMemo(() => buildT(lang), [lang]);
  return <TContext.Provider value={value}>{children}</TContext.Provider>;
}
export function useT(): RedesignT {
  const ctx = useContext(TContext);
  if (!ctx) throw new Error("useT must be used within <TProvider>");
  return ctx;
}
