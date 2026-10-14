// Help bot safety rules — shared by the server (server/helpBot.js, before and after the AI)
// and the app (src/redesign/components/HelpBot.tsx, iPhone display). Pure, no imports.
// No regex lookbehind: this file also runs in older iPhone Safari.
//
// 1) FORBIDDEN on every platform: how the app works inside, building/copying an app like this,
//    competitor comparisons, bypassing TikTok/Facebook rules, instructions hidden in a question.
//    → BLOCKED answer, no AI call.
// 2) iPhone (App Store 3.1.1): questions about plans / prices / paying → PLAN answer, no AI.
//    Every iPhone answer from ANY source is checked again (hasMoneyText) before it is shown.
// App features that only sound like money ("Type price", "Same price for all items",
// "Mark paid", "Unpaid", a product's price) are removed before the money checks run.

export const PLATFORMS = ["ios", "android", "web"];
export const normPlatform = (p) => (PLATFORMS.includes(p) ? p : "web");

export const BLOCKED_ANSWERS = {
  en: "I can only help with how to use SellerFlowLive. Admin can help you with anything else on Telegram.",
  fil: "Sa paggamit lang ng SellerFlowLive ako makakatulong. Para sa iba pa, si Admin ang makakatulong sa Telegram.",
  "zh-TW": "我只能協助你使用 SellerFlowLive。其他問題請在 Telegram 聯絡 Admin。",
  zh: "我只能协助你使用 SellerFlowLive。其他问题请在 Telegram 联系 Admin。",
};
export const PLAN_ANSWERS = {
  en: "For questions about your plan, please contact support.",
  fil: "Para sa mga tanong tungkol sa iyong plan, makipag-ugnayan sa support.",
  "zh-TW": "關於你的方案的問題，請聯絡客服。",
  zh: "关于你的方案的问题，请联系客服。",
};
const pick = (map, lang) => map[lang] || map.en;
export const blockedAnswer = (lang) => pick(BLOCKED_ANSWERS, lang);
export const planAnswer = (lang) => pick(PLAN_ANSWERS, lang);

// ── forbidden (every platform) ──────────────────────────────────────────────────
const FORBIDDEN = [
  // how it works inside
  /\b(inside|internally|behind the scenes|under the hood|technically|algorithm|logic behind)\b.{0,40}\b(work|works|working|made|built|done|coded)\b/i,
  /\b(work|works|working|made|built|done|coded)\b.{0,30}\b(inside|internally|behind the scenes|under the hood|technically)\b/i,
  /\b(which|what)\b.{0,15}\b(ai|a\.i\.|llm|language model|chatbot)\b/i, /\b(ai|a\.i\.)\s+model\b/i,
  /\b(chatgpt|gpt-?\d+|openai|anthropic|claude|gemini|llm)\b/i,
  /\bsource ?code\b/i, /\b(github|repository)\b/i,
  /\b(api|apis|endpoint|webhook|database|sql|supabase|backend|scrap(e|es|er|ing))\b/i,
  /\b(what|which|where)\b.{0,12}\b(server|servers|hosting)\b/i,
  /\b(how|where)\b.{0,25}\b(you|the app|sellerflow\w*|it|system)\b.{0,20}\b(read|reads|get|gets|receive|receives|collect|collects|fetch|fetches|capture|captures|grab|grabs|pull|pulls)\b.{0,20}\bcomments?\b/i,
  /\bhow\b.{0,25}\b(you|the app|it|system|sellerflow\w*|buyer alert|pickup status|parcel check)\b.{0,15}\b(decide|decides|determine|determines|know|knows|calculate|calculates|detect|detects|count|counts)\b/i,
  /\bhow\b.{0,25}\b(parcel check|buyer alert)\b.{0,15}\bworks?\b/i,
  /\bwho\b.{0,10}\b(made|built|created|developed|owns|runs|coded)\b.{0,15}\b(this|the app|sellerflow\w*|it)\b/i,
  /\bhosted\b/i,
  /\b(paano|pano)\b.{0,20}\b(nalalaman|nalaman|nadedetect|natutukoy|nakikilala)\b/i,
  /\bhow\b.{0,25}\bparcels?\b.{0,20}\b(checked|matched|verified)\b/i,
  /\b(data source|where does the data come from|where do you get the data)\b/i,
  /\b(paano|pano)\b.{0,25}\b(gumagana|ginagawa)\b.{0,15}\bsa loob\b/i,
  /\b(anong|ano ang)\b.{0,6}\bai\b/i,
  /\b(paano|pano)\b.{0,25}\b(nakukuha|kinukuha|nababasa|binabasa)\b.{0,20}\b(comments?|komento)\b/i,
  /原始碼|源代碼|源代码|源碼|源码|程式碼|爬蟲|爬虫|演算法|資料庫|数据库|資料來源|数据来源/,
  /(什麼|什么|哪個|哪个|哪裡|哪里).{0,4}(伺服器|服务器)/,
  /(什麼|什么|哪個|哪个|哪一個|哪一个|用).{0,4}(AI|ai|人工智慧|人工智能)/,
  /(怎麼|怎么|如何).{0,6}(抓|讀取|读取|獲取|获取).{0,4}(留言|評論|评论)/,
  // build / copy an app like this, competitors
  /\b(build|make|create|code|develop|copy|clone)\b.{0,25}\b(app|system|software|tool)\b.{0,20}\b(like this|like yours|like sellerflow\w*|same as)\b/i,
  /\b(my own|our own)\b.{0,15}\b(app|version|system)\b.{0,20}\b(like|of)\b.{0,15}\b(this|sellerflow\w*)\b/i,
  /\bcompetitors?\b/i, /\b(flive|chotdon|livtag)\b/i,
  /\b(compare|comparison|better than|versus)\b.{0,25}\b(app|apps|other app|other apps)\b/i,
  /\b(gumawa|gagawa|gawa)\b.{0,20}\bapp\b.{0,20}\b(ganito|ganyan|katulad)\b/i,
  /(做|寫|写|開發|开发).{0,8}(一樣|一样|類似|类似|同樣|同样).{0,4}(app|APP|應用|应用|軟體|软件|系統|系统)/,
  /競爭對手|竞争对手|競品|竞品/,
  // bypass platform rules
  /\b(bypass|get around|circumvent|evade)\b/i,
  /\bavoid\b.{0,20}\b(tiktok|facebook|fb)\b.{0,15}\b(ban|bans|rules?|detection|limits?)\b/i,
  /\bcaptcha\b/i,
  /\b(unofficial|fake)\b.{0,10}\b(bots?|comments?|viewers?|likes?|followers?|accounts?)\b/i,
  /\bauto[- ]?(commenter|liker|follower)s?\b/i, /\bbots?\b.{0,15}\b(to )?(comment|like|follow|boost)/i,
  /\b(viewers?|followers?|likes?|comments?)\b.{0,20}\bbots?\b/i,
  /\b(iwas|iwasan|maiwasan|lusutan|lusot)\b.{0,15}\b(ban|tiktok|facebook|rules?)\b/i,
  /繞過|绕过|規避|规避|外掛|外挂|刷讚|刷赞|刷留言|刷粉|假帳號|假账号|機器人留言|机器人留言/,
  // 驗證碼 is also the sign-up / password "verification code" — forbidden only with bypass words.
  /(繞過|绕过|破解|跳過|跳过|bypass).{0,8}(驗證碼|验证码)|(驗證碼|验证码).{0,8}(繞過|绕过|破解|跳過|跳过|bypass)/i,
  // instructions hidden in the question
  /\b(ignore|forget|disregard)\b.{0,20}\b(previous|above|all|your|the)\b.{0,15}\b(rules?|instructions?|prompt)\b/i,
  /\b(system prompt|your prompt|your instructions|developer mode|jailbreak|role-?play)\b/i,
  /忽略.{0,6}(規則|规则|指令|提示)|系統提示|系统提示|角色扮演/,
];
export const isForbiddenTopic = (q) => FORBIDDEN.some((re) => re.test(String(q || "")));

// ── money (iPhone) ──────────────────────────────────────────────────────────────
// App features that only sound like money — removed before any money check.
const SAFE_PHRASES = /\b(type price|same price for all items|same price|mark(ed|ing)? (as )?(paid|unpaid|bayad)|unpaid( 24h\+?)?|paid|bayad na)\b|標記已付款|标记已付款|已付款|未付款|已付|未付|輸入價格|输入价格|同價|统一价/gi;
const clean = (s) => String(s || "").replace(SAFE_PHRASES, " ");

const MONEY_Q = [
  /\b(free|basic|plus|pro|master)\s+(plan|plans|tier|version|membership|subscription|account)\b/i,
  /\b(how much|magkano|presyo|cost|price|pricing|upgrade|buy|bilhin)\b.{0,25}\b(basic|pro|master)\b/i,
  /\b(basic|pro|master)\b.{0,25}\b(how much|magkano|presyo|cost|price|pricing|upgrade|buy)\b/i,
  /\b(subscription|subscriptions|subscribe|subscribed|upgrade|upgrading|downgrade|renew|renewal|renewing|trial|invoice|gcash|paymaya|payment|payments)\b/i,
  /\bfree\b.{0,10}\b(limit|orders?|plan|tier|version)\b/i,
  /\bpay\b/i, /\bbank\b/i, /\b(bank|money|wire)\s+transfer\b/i,
  /\b(how much|magkano)\b.{0,25}\b(app|sellerflow\w*|plan|plans|month|monthly|buwan)\b/i,
  /\b(cost|price|pricing)\s+(of|for)\s+(the\s+)?(app|sellerflow\w*|plan|plans|subscription)\b/i,
  /\b(app|sellerflow\w*)\b.{0,10}\b(cost|costs|price|pricing)\b/i,
  /\bis\b.{0,15}\b(app|sellerflow\w*)\b.{0,10}\bfree\b/i,
  /\bplans?\b.{0,20}\b(cost|price|how much|magkano|presyo|bayad)\b/i,
  /bayad|bayaran|singil/i,
  /\bmagkano\b(?!.{0,25}\b(item|items|product|products|produkto|order|orders|sticker|stickers|printer|shipping|padala|buyer)\b)/i,
  /\bpresyo ng (plan|app|sellerflow)/i,
  /方案|訂閱|订阅|付款|付費|付费|繳費|缴费|匯款|汇款|升級|升级|降級|降级|續費|续费|續約|续约|續訂|续订|發票|发票|試用|试用|信用卡|月費|月费|折扣|優惠|优惠|帳號上限|账号上限|帳號數|账号数/,
  // plan names compared / bought / asked about
  /\b(free|basic|plus|pro|master)\b.{0,30}\b(free|basic|plus|pro|master)\b/i,
  /\b(bili|bumili|bilhin|buy|get|kunin|avail)\b.{0,15}\b(plus|pro|master|basic)\b/i,
  /\b(sa|ng|yung|ung|ang|for|on)\s+(plus|pro|master|basic)\b/i,
  // account count = plan topic on iPhone
  /\bhow many\b.{0,20}\baccounts?\b/i, /\bilang\b.{0,10}\baccounts?\b/i,
  /\b(another|more|extra|additional|isa pang|dagdag)\b.{0,20}\baccounts?\b/i,
  /\b(discount|discounts|promo|promos|installment|installments|credit card|hulog|avail|mahal|plano|price ?list)\b/i,
  /\brates?\b.{0,15}\b(app|sellerflow\w*|plan|monthly|buwan)\b/i,
  /(免費|免费).{0,3}(額度|额度|方案|版|次數|次数)/,
  /專業版|专业版|高級版|高级版|基本版|大師版|大师版|會員費|会员费/,
  /(多少錢|多少钱|價格|价格|費用|费用).{0,8}(app|App|APP|軟體|软件|會員|会员|月|SellerFlow)|(app|App|APP|軟體|软件|會員|会员|SellerFlow).{0,8}(多少錢|多少钱|價格|价格|費用|费用)/,
];
// "expire" / 到期 means the plan — unless the question is about a session or a parcel.
const EXPIRE_Q = /expir|到期/i;
const NOT_PLAN_EXPIRE = /\bsession\b|場次|场次|包裹|取件|取貨|取货|寄件|門市|门市|\bparcels?\b|\bpick ?up\b/i;
// Words that make "upgrade" / "pay" about something else — unless a plan word is also there.
const PLAN_WORD = /\b(plan|plans|plano|subscription|subscribe|tier|free|basic|plus|pro|master|account|accounts)\b|方案|訂閱|订阅/i;
const APP_UPDATE = /\b(app|version|update)\b/i;
const SESSION_CTX = /\bsession\b|場次|场次/i;
const BUYER_PAY = /\b(buyer|buyers|customer|customers|mamimili|order|orders)\b/i;
export function isMoneyQuestion(q) {
  let s = clean(q);
  if (!PLAN_WORD.test(s)) {
    if (SESSION_CTX.test(s)) s = s.replace(/\b(renew|renews|renewing|renewal|renewed)\b/gi, " ");
    if (APP_UPDATE.test(s)) s = s.replace(/\b(upgrade|upgrading|update|updating)\b/gi, " ");
    if (BUYER_PAY.test(s)) s = s.replace(/\b(pay|paying|payment|payments)\b|\w*bayad\w*/gi, " ");
  }
  if (MONEY_Q.some((re) => re.test(s))) return true;
  return EXPIRE_Q.test(s) && !NOT_PLAN_EXPIRE.test(s);
}

const MONEY_OUT = [
  /\bplans?\b/i, /\btiers?\b/i,
  /\b(Free|Basic|Plus|Pro|Master)\s+(plan|plans|tier|account|users?|subscription)\b/i,
  /\b(Basic|Plus|Pro|Master)\s*(\/|,|or|and)\s*(Basic|Plus|Pro|Master)\b/,
  /\b(subscription|subscriptions|subscribe|subscribed|upgrade|upgraded|upgrading|downgrade|renew|renewal|renewed|renewing)\b/i,
  /\bpay\w*\b[^.\n]{0,40}\b(telegram|sellerflow\w*)\b/i, /\btelegram\b[^.\n]{0,40}\bpay\w*\b/i,
  /\b(pay|paying|payment)\b[^.\n]{0,40}\badmin\b/i, /\badmin\b[^.\n]{0,40}\b(to pay|how to pay|payment)\b/i,
  /\b(gcash|paymaya|bank transfer|wise|invoice|pricing)\b/i,
  /(NT\$|NTD|TWD|PHP|₱|US\$|USD|\$|₫|฿|Rp|RM)\s?\d/i, /\d\s?(NT\$|NTD|TWD|PHP|USD|元|塊)/i,
  /\b(magbayad|bayaran|pagbabayad|singil)\b/i,
  /\b(Basic|Plus|Pro|Master)\b/, // plan names, case-sensitive, anywhere
  /\b(discount|discounts|promo|promos|avail|installment|installments|credit card|hulog)\b/i,
  /\bmas mataas na (plan|plano|bersyon|version)\b/i,
  /方案|訂閱|订阅|付款|付費|付费|繳費|缴费|匯款|汇款|升級|升级|續費|续费|續約|续约|續訂|续订|發票|发票|信用卡|月費|月费|折扣|優惠|优惠/,
];
export const hasMoneyText = (text) => MONEY_OUT.some((re) => re.test(clean(text)));

// iPhone context: guide sections and saved answers that are about plans / paying.
export const IOS_EXCLUDED_SECTIONS = ["plans", "account-limit", "free-order-limit", "plan-expired", "payment"];
export const iosSafeSection = (s) => !IOS_EXCLUDED_SECTIONS.includes(s && s.id);
export const iosSafeFaq = (f) => !hasMoneyText(f && f.answer) && !hasMoneyText(f && f.question);
