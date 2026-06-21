import { saveOrderToDatabase, saveCustomerToDatabase } from "./db";
import { supabase } from "./supabase";
import {
  type AccountAuditLog,
  adminUpdateContactNote,
  adminUpdatePlan,
  createMyProfile,
  deleteUser,
  getMyProfile,
  listAuditLogs,
  listUsers,
  saveAuditLog,
  upsertUser,
} from "./accountDb";

import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";
import posthog from "posthog-js";
import { TRANSLATIONS, type Lang, type T } from "./translations";
import { liveDayId, taipeiDayId } from "./lib/dateHelpers";
import type { LiveOrder, Buyer, Comment } from "./lib/orderTypes";
import { buildOrderFromComment } from "./lib/orderLogic";
import { sellerExpiryState } from "./lib/sellerExpiry";
import { shouldUseBluetoothSticker, shouldUseLanSticker } from "./lib/printerRouting";

// ─── Types ────────────────────────────────────────────────────────────────────
type Plan = "free" | "trial" | "basic" | "pro" | "master";
type PlanStatus = "active" | "expired" | "pending";
type Page = "dashboard"|"miners"|"orders"|"products"|"customers"|"customerData"|"print"|"sales"|"shipping"|"settings"|"subscription"|"support"|"admin"|"privacy"|"terms"|"deleteAccount";

interface Profile { fullName:string; storeName:string; phone:string; tiktok:string; facebook:string; adminContactNote:string; }
type Role = "seller" | "admin";
interface User { authUserId?:string; email:string; profile:Profile; plan:Plan; planStatus:PlanStatus; planExpiry:string; trialStartedAt?:string; connectedAccounts:string[]; role?:Role; }
interface Product { id:number; name:string; sku:string; price:number; stock:number; platform:string; status:string; }
type ShippingStatus = "Pending"|"Ready"|"Shipped"|"Delivered"|"Returned";
interface ShippingCustomer { username:string; name:string; phone:string; sevenCode:string; note:string; lastComment:string; firstSeen:string; status:ShippingStatus; isNew:boolean; num?:number; }
interface Settings { darkMode:boolean; autoprint:boolean; soundAlert:boolean; stockAlert:boolean; dailyEmail:boolean; keywords:string; currency:string; paperSize:string; printerType:"auto"|"usb"|"bluetooth"|"lan"; lanFormat:"receipt"|"sticker"; stickerSize:string; printStoreName:boolean; printBuyerNumber:boolean; printBuyerUsername:boolean; printOrderItems:boolean; printTotal:boolean; printAutoClose:boolean; printLabelScale:number; printStoreScale:number; printBuyerNumberScale:number; printBuyerNameScale:number; printUsernameScale:number; printOrderScale:number; printCommentScale:number; printTotalScale:number; printStoreX:number; printStoreY:number; printBuyerLabelX:number; printBuyerLabelY:number; printBuyerNumberX:number; printBuyerNumberY:number; printBuyerNameX:number; printBuyerNameY:number; printUsernameX:number; printUsernameY:number; printSessionX:number; printSessionY:number; printOrderX:number; printOrderY:number; printTotalX:number; printTotalY:number; }
interface MobilePrinterDevice { id:string; type:"bluetooth"|"lan"; name:string; address?:string; host?:string; port?:number; paired?:boolean; online?:boolean; signal?:number; distance?:string; hint?:string; }
interface MobilePrinterResult { ok?:boolean; message?:string; online?:boolean; host?:string; port?:number; savedPrinter?:MobilePrinterDevice|null; printers?:MobilePrinterDevice[]; }
interface PrinterLanConfig { host:string; port?:number; }
type PrinterBridgeReturn = void|string|MobilePrinterResult;
// Bluetooth sticker printer (TSPL/AIMO-style). Frontend stages the UI + bitmap
// pipeline; the native Android bridge (separate phase) implements scan/connect/
// printSticker over Classic Bluetooth SPP and decodes the base64 bitmap into a
// TSPL BITMAP command stream.
interface BluetoothPrinterDevice { id:string; address:string; name:string; paired?:boolean; signal?:number; }
interface BluetoothScanResult { ok?:boolean; message?:string; printers?:BluetoothPrinterDevice[]; savedPrinter?:BluetoothPrinterDevice|null; }
// Native TEXT+BAR sticker payload — the AIMO D520BT firmware ignores TSPL
// BITMAP commands, so the native plugin builds the layout from structured
// slip data using TEXT and BAR primitives only. Mirrors the existing slip
// shape so we can pass straight through from printSlip.
interface NativeStickerPayload { storeName:string; sessionDate:string; currency:string; buyer:Buyer; settings:Pick<Settings,"printStoreName"|"printBuyerNumber"|"printBuyerUsername"|"printOrderItems"|"printTotal">; }
interface StickerPrintResult { ok?:boolean; message?:string; }
type NumberSettingKey = {[K in keyof Settings]: Settings[K] extends number ? K : never}[keyof Settings];
interface NativePrinterPayload { type:"sellerflow.printSlip"; buyer:Buyer; currency:string; storeName:string; settings:Settings; sessionDate:string; createdAt:string; }
// Free-tier usage status from the Supabase RPC free_tier_status_for_user.
interface FreeStatus { is_free:boolean; count?:number; cap?:number; near_cap_threshold?:number; near_cap?:boolean; capped?:boolean; cycle_resets_in_days?:number; warning_shown?:boolean; }
// One row from the admin RPC list_free_users_status (free users + cycle usage).
interface FreeUserRow { email:string; store_name:string; full_name:string; count:number; cap:number; near_cap:boolean; capped:boolean; cycle_resets_in_days:number; }
// Fill {placeholders} in a translation string, e.g. tpl(t.free_orders_progress,{count:5,cap:200}).
const tpl=(text:string,vars:Record<string,string|number>)=>String(text||"").replace(/\{(\w+)\}/g,(m,k)=>k in vars?String(vars[k]):m);

declare global {
  interface Window {
    SellerFlowPrinter?: { printSlip?: (payload:NativePrinterPayload)=>PrinterBridgeReturn|Promise<PrinterBridgeReturn>; setPrinter?: (config:PrinterLanConfig)=>Promise<MobilePrinterResult>; getPrinter?: ()=>Promise<MobilePrinterResult>; testConnection?: (config:PrinterLanConfig)=>Promise<MobilePrinterResult>; status?: ()=>string|Promise<string>; printerStatus?: ()=>string|Promise<string|MobilePrinterResult>; scanPrinters?: ()=>string|Promise<string|MobilePrinterResult>; connectPrinter?: (printer:MobilePrinterDevice|string)=>string|Promise<string|MobilePrinterResult>; testPrint?: ()=>string|Promise<string|MobilePrinterResult>; scanBluetoothLabelPrinters?: ()=>Promise<BluetoothScanResult>; getBluetoothLabelPrinter?: ()=>Promise<BluetoothScanResult>; setBluetoothLabelPrinter?: (printer:{address:string;name:string})=>Promise<BluetoothScanResult>; clearBluetoothLabelPrinter?: ()=>Promise<BluetoothScanResult>; testStickerPrint?: ()=>Promise<StickerPrintResult>; printStickerNative?: (payload:NativeStickerPayload)=>Promise<StickerPrintResult>; printStickerLan?: (payload:NativeStickerPayload)=>Promise<StickerPrintResult>; };
    ReactNativeWebView?: { postMessage:(message:string)=>void };
    Capacitor?: { Plugins?: { SellerFlowPrinter?: { printSlip:(payload:NativePrinterPayload)=>Promise<PrinterBridgeReturn>; setPrinter?:(config:PrinterLanConfig)=>Promise<MobilePrinterResult>; getPrinter?:()=>Promise<MobilePrinterResult>; testConnection?:(config:PrinterLanConfig)=>Promise<MobilePrinterResult> } } };
  }
}
const normalizeComment=(raw:unknown,index=0):Comment|null=>{
  if(!raw||typeof raw!=="object")return null;
  const c=raw as Partial<Comment>;
  let handle=String(c.handle||c.name||`buyer-${index}`).trim();
  if(!handle)return null;
  let name=String(c.name||handle).trim();
  let comment=String(c.comment||"").trim();
  const orderLike=(value:string)=>{
    const lower=value.trim().toLowerCase();
    return /^\d{1,8}$/.test(lower)||["free","hm","how much","mine","order","avail","available","kuha","get","price","size","cod"].some(word=>lower===word||lower.startsWith(`${word} `));
  };
  if(orderLike(name)&&!orderLike(comment)&&/[\p{L}_]/u.test(comment)){
    const realName=comment;
    comment=name;
    name=realName;
    handle=/^[a-zA-Z0-9._-]{2,32}$/.test(realName)?realName:realName.replace(/\s+/g,"_").slice(0,32);
  }
  const joined=`${handle} ${name} ${comment}`.toLowerCase();
  if(joined.includes("tiktok viewer")||/^(viewer|tiktok viewer)$/i.test(handle)||/^(viewer|tiktok viewer)$/i.test(name))return null;
  if(/\bx\s*\d{1,3}\b/i.test(`${handle} ${name} ${comment}`)||/\bmost\s+sent\b/i.test(comment)||/\bsent\d+\b/i.test(comment)||joined.includes("shared the live")||joined.includes("sent a gift")||joined.includes("gift"))return null;
  if(/^\d{1,8}$/.test(handle)||/^\d{1,8}$/.test(name)||/^(new|viewers|comments)$/i.test(handle)||/^(new|viewers|comments)$/i.test(name))return null;
  if(/^\d{1,8}$/.test(comment)&&(!/[a-zA-Z_]/.test(handle)&&!/[a-zA-Z_]/.test(name)))return null;
  if(!comment)return null;
  const platform=c.platform==="Facebook"?"Facebook":"TikTok";
  return {
    handle,
    name,
    comment,
    platform,
    isBuy:!!c.isBuy,
    buyerNum:typeof c.buyerNum==="number"?c.buyerNum:null,
    buyerData:c.buyerData||null,
    time:String(c.time||new Date().toLocaleTimeString()),
    avatar:typeof c.avatar==="string"?c.avatar:undefined,
    timestamp:typeof c.timestamp==="string"&&c.timestamp?c.timestamp:undefined,
    sellerId:typeof c.sellerId==="string"?c.sellerId.toLowerCase():undefined,
    sessionId:typeof c.sessionId==="string"?c.sessionId:undefined,
    sourceUsername:typeof c.sourceUsername==="string"?c.sourceUsername:undefined,
  };
};
const commentKey=(c:Comment|null|undefined)=>{
  if(!c)return "missing-comment";
  return `${c.platform||"TikTok"}|${c.sourceUsername||""}|${c.sessionId||""}|${c.handle||"buyer"}|${c.timestamp||c.time||""}|${c.comment||""}`;
};
const cleanComments=(list:unknown)=>{
  if(!Array.isArray(list))return [];
  const seen=new Set<string>();
  return list.map((c,i)=>normalizeComment(c,i)).filter((c):c is Comment=>{
    if(!c)return false;
    const key=commentKey(c);
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
};
const commentMs=(c:Comment)=>{const t=Date.parse(c?.timestamp||"");return Number.isFinite(t)?t:0;};
const sortCommentsNewest=(list:Comment[])=>[...list].sort((a,b)=>commentMs(b)-commentMs(a));

// ─── Storage ──────────────────────────────────────────────────────────────────
const LS = {
  get:<X,>(k:string,d:X):X=>{try{const v=localStorage.getItem(k);return v!==null?JSON.parse(v):d;}catch{return d;}},
  set:(k:string,v:unknown)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{return;}},
  del:(k:string)=>{try{localStorage.removeItem(k);}catch{return;}},
};
const FORCE_LOGIN_PARAMS=["sellerLogin","switchAccount","login"];
const consumeForceLoginParam=()=>{
  if(typeof window==="undefined")return false;
  const url=new URL(window.location.href);
  const shouldForce=FORCE_LOGIN_PARAMS.some(k=>url.searchParams.get(k)==="1"||url.searchParams.has(k));
  if(!shouldForce)return false;
  LS.del("sf_session");
  FORCE_LOGIN_PARAMS.forEach(k=>url.searchParams.delete(k));
  window.history.replaceState({},document.title,url.pathname+(url.search?url.search:"")+url.hash);
  return true;
};
const arrLS=<X,>(key:string):X[]=>{const value=LS.get<unknown>(key,[]);return Array.isArray(value)?value as X[]:[];};
const browserSessionId=()=>{
  const existing=LS.get<string>("sf_browser_session","");
  if(existing)return existing;
  const next=`sf-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  LS.set("sf_browser_session",next);
  return next;
};
const sellerIdOf=(email:string)=>email.trim().toLowerCase();
const sellerDataKey=(base:string,email:string)=>email?`${base}:${sellerIdOf(email)}`:base;
const custDataKey=(email:string)=>sellerDataKey("sf_shipping_customer_data",email);
const sellerLiveDataKey=(base:string,email:string,sessionId:string)=>email?`${base}:${sellerIdOf(email)}:${sessionId}`:base;
const sellerDailyDataKey=(base:string,email:string,dayId:string)=>email?`${base}:${sellerIdOf(email)}:${dayId}`:base;
const cleanLiveAccount=(value:string)=>String(value||"").trim().replace(/^@+/,"").toLowerCase();
const sellerDayOrSessionArray=<X,>(base:string,email:string,dayId:string,sessionId:string):X[]=>{
  const dailyKey=sellerDailyDataKey(base,email,dayId);
  const daily=arrLS<X>(dailyKey);
  if(daily.length)return daily;
  const legacy=arrLS<X>(sellerLiveDataKey(base,email,sessionId));
  if(legacy.length)LS.set(dailyKey,legacy);
  return legacy;
};

const DEFAULT_SERVER =
  typeof window !== "undefined" && ["localhost","127.0.0.1"].includes(window.location.hostname)
    ? "http://localhost:3001"
    : "https://sellerflow-live-server.onrender.com";
const SERVER = String(import.meta.env.VITE_SERVER_URL || DEFAULT_SERVER).replace(/\/$/,"");
const DEBUG_SOCKET = import.meta.env.DEV || import.meta.env.VITE_DEBUG_SOCKET === "true";
const DEF_SETTINGS: Settings = { darkMode:true, autoprint:true, soundAlert:true, stockAlert:true, dailyEmail:false, keywords:"", currency:"", paperSize:"100x60mm", printerType:"auto", lanFormat:"receipt", stickerSize:"100x60mm", printStoreName:true, printBuyerNumber:true, printBuyerUsername:true, printOrderItems:true, printTotal:true, printAutoClose:true, printLabelScale:100, printStoreScale:100, printBuyerNumberScale:120, printBuyerNameScale:100, printUsernameScale:100, printOrderScale:100, printCommentScale:100, printTotalScale:100, printStoreX:0, printStoreY:0, printBuyerLabelX:0, printBuyerLabelY:0, printBuyerNumberX:0, printBuyerNumberY:0, printBuyerNameX:0, printBuyerNameY:0, printUsernameX:0, printUsernameY:0, printSessionX:0, printSessionY:0, printOrderX:0, printOrderY:0, printTotalX:0, printTotalY:0 };
const LANG_OPTS: {code:Lang;label:string}[] = [{code:"en",label:"🇺🇸 EN"},{code:"fil",label:"🇵🇭 FIL"},{code:"zh",label:"🇨🇳 中文"},{code:"zh-TW",label:"🇹🇼 繁體"},{code:"vi",label:"🇻🇳 VI"},{code:"th",label:"🇹🇭 TH"},{code:"id",label:"🇮🇩 ID"}];
const CURRENCIES = [{v:"",l:"No symbol"},{v:"$",l:"$ USD"},{v:"NT$",l:"NT$ NTD"}];
const cleanCurrency=(value:unknown)=>{
  const currency=String(value||"").trim();
  return currency.length===1&&currency.charCodeAt(0)===8369?"":currency;
};
const esc=(value:unknown)=>String(value ?? "").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]||ch));

// ─── Helpers ──────────────────────────────────────────────────────────────────
const safeLang=(value:unknown):Lang=>LANG_OPTS.some(l=>l.code===value)?value as Lang:"en";
const safeProfile=(p:Partial<Profile>|undefined):Profile=>({
  fullName:String(p?.fullName||""),
  storeName:String(p?.storeName||""),
  phone:String(p?.phone||""),
  tiktok:String(p?.tiktok||""),
  facebook:String(p?.facebook||""),
  adminContactNote:String(p?.adminContactNote||""),
});
const safeUser=(raw:unknown):User|null=>{
  if(!raw||typeof raw!=="object")return null;
  const u=raw as Partial<User>;
  const email=String(u.email||"").trim().toLowerCase();
  if(!email)return null;
  const plan:Plan=["free","trial","basic","pro","master"].includes(String(u.plan))?u.plan as Plan:"free";
  const planStatus:PlanStatus=["active","expired","pending"].includes(String(u.planStatus))?u.planStatus as PlanStatus:"active";
  return {
    authUserId:typeof u.authUserId==="string"?u.authUserId:undefined,
    email,
    profile:safeProfile(u.profile),
    plan,
    planStatus,
    planExpiry:String(u.planExpiry||addDays(plan==="trial"?7:31)),
    trialStartedAt:typeof u.trialStartedAt==="string"?u.trialStartedAt:"",
    connectedAccounts:Array.isArray(u.connectedAccounts)?u.connectedAccounts.map(String):[],
    role:u.role==="admin"?"admin":"seller",
  };
};
const nc=(n:number)=>n===1?"#26215C":n<=3?"#534AB7":"#7F77DD";
const ini=(s:string)=>s.split(/[\s_]/g).slice(0,2).map(w=>w[0]?.toUpperCase()).join("")||"??";
const abg=(h:string)=>{const c=["#7F77DD","#1D9E75","#D85A30","#D4537E","#378ADD","#BA7517"];let x=0;for(const ch of h)x=(x*31+ch.charCodeAt(0))%c.length;return c[Math.abs(x)];};
const addDays=(n:number)=>{const d=new Date();d.setDate(d.getDate()+n);return d.toISOString();};
const addMonths=(n:number)=>addDays(Math.max(1,n)*30);
// Single source of truth for the support/renewal Telegram contact.
const TELEGRAM_URL="https://t.me/SELLERFLOWLIVE1995";
const dLeft=(e:string,now=Date.now())=>Math.max(0,Math.ceil((new Date(e).getTime()-now)/86400000));
// Value-only renewal that ADDS to remaining time instead of resetting from now.
// Active+days-left → current expiry + n*30d; otherwise (expired) from now + n*30d.
// Module-scope so the impure Date reads stay out of the component render path
// (mirrors addDays/addMonths above).
const addMonthsToExpiry=(planExpiry:string,planStatus:string,n:number)=>{
  const active=planStatus==="active"&&dLeft(planExpiry)>0;
  const base=active?new Date(planExpiry).getTime():Date.now();
  return new Date(base+Math.max(1,n)*30*86400000).toISOString();
};
// Background highlight for the admin Users table DAYS cell. dLeft clamps at 0
// so expired plans land in the strongest red. 8+ days → no highlight (returns
// undefined so React drops the style attribute entirely).
const daysCellStyle=(days:number):React.CSSProperties|undefined=>{
  if(days<=0)return {background:"#FCA5A5",color:"#7F1D1D",fontWeight:700};
  if(days<=2)return {background:"#FEE2E2",color:"#991B1B",fontWeight:700};
  if(days<=5)return {background:"#FED7AA",color:"#9A3412"};
  if(days<=7)return {background:"#FEF3C7",color:"#92400E"};
  return undefined;
};
const normalizePhone=(value:string)=>String(value||"").replace(/\D/g,"");
const phoneDisplay=(value:string)=>String(value||"").trim();
const maxAcc=(p:Plan)=>({free:1,trial:1,basic:1,pro:3,master:5}[p]);
const LIVE_COMMENT_LIMIT=5000;
const COMMENT_ARCHIVE_LIMIT=5000;
const accountList=(value:string)=>Array.from(new Set((value||"").split(/[,\n]/).map(v=>v.trim()).filter(Boolean)));
const accountText=(values:string[])=>values.map(v=>v.trim()).filter(Boolean).join("\n");
const accountSlots=(value:string,limit:number)=>{const slots=(value||"").split(/[,\n]/).map(v=>v.trim()).filter(Boolean).slice(0,limit);while(slots.length<limit)slots.push("");return slots;};
const registeredAccountCount=(u:User)=>accountList(u.profile.tiktok).length+accountList(u.profile.facebook).length;
const keepLockedAccounts=(original:string,next:string,limit:number)=>accountText(accountSlots(next,limit).map((value,index)=>accountSlots(original,limit)[index]||value));
const fitProfileAccounts=(original:Profile,next:Profile,limit:number):Profile=>{
  const lockedTikTok=accountList(original.tiktok);
  const lockedFacebook=accountList(original.facebook);
  const resultTikTok=[...lockedTikTok];
  const resultFacebook=[...lockedFacebook];
  let remaining=Math.max(0,limit-resultTikTok.length-resultFacebook.length);
  for(const account of accountList(next.tiktok))if(remaining>0&&!resultTikTok.includes(account)){resultTikTok.push(account);remaining--;}
  for(const account of accountList(next.facebook))if(remaining>0&&!resultFacebook.includes(account)){resultFacebook.push(account);remaining--;}
  return {...next,tiktok:accountText(resultTikTok),facebook:accountText(resultFacebook)};
};
const OWNER_EMAIL=(import.meta.env.VITE_OWNER_EMAIL||"admin@sellerflow.app").trim().toLowerCase();
const isAdminUser=(u:User|null)=>!!u&&u.role==="admin";
const canConnectMore=(u:User)=>isAdminUser(u)||registeredAccountCount(u)<maxAcc(u.plan);
const asAdminPlan=(u:User)=>isAdminUser(u)?{...u,plan:"master" as Plan,planStatus:"active" as PlanStatus,planExpiry:addMonths(120)}:u;
const pName=(p:Plan,t:T)=>({free:t.plan_free,trial:t.plan_free,basic:t.plan_basic,pro:t.plan_pro,master:t.plan_master}[p]);
const pColor=(p:Plan)=>({free:"blue",trial:"gray",basic:"green",pro:"purple",master:"amber"}[p] as "gray"|"green"|"purple"|"amber"|"blue");
const csvDL=(filename:string,headers:string[],rows:(string|number)[][])=>{
  const csv=[headers,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=filename;a.click();
};
const jsonDL=(filename:string,data:unknown)=>{
  const a=document.createElement("a");
  a.href=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:"application/json"}));
  a.download=filename;
  a.click();
};

function Av({name,size=32,image}:{name:string;size?:number;image?:string}){
  return <div style={{width:size,height:size,borderRadius:"50%",background:abg(name),color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.32,fontWeight:600,flexShrink:0,overflow:"hidden"}}>
    {image?<img src={image} alt="" style={{width:"100%",height:"100%",objectFit:"cover"}}/>:ini(name)}
  </div>;
}
function Badge({label,color}:{label:string;color:"purple"|"green"|"amber"|"red"|"blue"|"gray"}){
  const m:{[k:string]:[string,string]}={purple:["#EEEDFE","#534AB7"],green:["#E1F5EE","#0F6E56"],amber:["#FAEEDA","#633806"],red:["#FCEBEB","#A32D2D"],blue:["#E6F1FB","#185FA5"],gray:["#F1EFE8","#5F5E5A"]};
  const [bg,fg]=m[color];
  return <span style={{background:bg,color:fg,fontSize:10,padding:"2px 8px",borderRadius:20,fontWeight:500,whiteSpace:"nowrap"}}>{label}</span>;
}
function Toast({msg,onDone}:{msg:string;onDone:()=>void}){
  useEffect(()=>{const t=setTimeout(onDone,2500);return()=>clearTimeout(t);},[onDone]);
  return <div className="toast">{msg}</div>;
}
function Fg({label,children}:{label:string;children:React.ReactNode}){
  return <div className="fg"><label>{label}</label>{children}</div>;
}

// Password-visibility toggle icons for the .pw-eye button on the login /
// signup forms. stroke="currentColor" so the .pw-eye color rule themes them
// (dark gray on white, light gray on the mobile dark input). Lucide-style
// minimal paths so no icon library is needed.
const PwEyeIcon=(
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/>
    <circle cx="12" cy="12" r="3"/>
  </svg>
);
const PwEyeOffIcon=(
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"/>
    <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7c1.66 0 3.21-.39 4.61-1.07"/>
    <path d="M14.12 14.12A3 3 0 1 1 9.88 9.88"/>
    <path d="M1 1l22 22"/>
  </svg>
);

// admin_contact_note structured value: "<platform>:<name>" where platform is
// one of CONTACT_PLATFORMS. Anything else (legacy plain text from before this
// feature, or notes with an unrecognized prefix) is preserved and displayed
// as-is so no existing data is lost.
const CONTACT_PLATFORMS=["fb","telegram","line"] as const;
type ContactPlatform=typeof CONTACT_PLATFORMS[number];
const CONTACT_THEME:Record<ContactPlatform,{label:string;fg:string;bg:string}>={
  fb:      {label:"Facebook",fg:"#0C447C",bg:"#E6F1FB"},
  telegram:{label:"Telegram",fg:"#0F6E56",bg:"#E1F5EE"},
  line:    {label:"Line",    fg:"#854F0B",bg:"#FAEEDA"},
};
const ContactIcons:Record<ContactPlatform,React.ReactNode>={
  fb:<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M14 8.5V6.8c0-.7.4-1.1 1.1-1.1H17V3h-2.9c-2.2 0-3.6 1.4-3.6 3.7v1.8H8v3h2.5V21h3.4v-9.5h2.4l.3-3H14z"/></svg>,
  telegram:<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 3L2 11.4l5.8 2 9.2-6.4-7.3 8.6 1.7 5.6 3-3.1 4.6 3.4L22 3z"/></svg>,
  line:<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3.2C6.5 3.2 2 6.9 2 11.4c0 4 3.5 7.4 8.3 8.1.3.1.7.2.8.5.1.3.1.7 0 1l-.1.7c0 .2.1.4.4.4.4 0 6.4-3.8 8.7-6.5 1.6-1.9 2.1-3.8 2.1-5.4 0-4.5-4.5-8.2-10-8.2zM8 13.5H6V8.7h.9v4H8v.8zm1.9 0h-.9V8.7h.9v4.8zm5.5 0h-.9l-2-3v3h-.9V8.7h.9l2 3v-3h.9v4.8zm3.3-3.7H17v.9h1.6v.8H17v1h1.6v.8h-2.4V8.7h2.4v.9z"/></svg>,
};

function parseContact(raw:string):{platform:ContactPlatform|"";name:string;legacy:boolean}{
  if(!raw)return{platform:"",name:"",legacy:false};
  const i=raw.indexOf(":");
  if(i>0){
    const prefix=raw.slice(0,i).trim().toLowerCase();
    if((CONTACT_PLATFORMS as readonly string[]).includes(prefix)){
      return{platform:prefix as ContactPlatform,name:raw.slice(i+1).trim(),legacy:false};
    }
  }
  return{platform:"",name:raw.trim(),legacy:true};
}

function formatContact(platform:ContactPlatform|"",name:string):string{
  const trimmed=name.trim();
  if(!trimmed)return "";
  return platform?`${platform}:${trimmed}`:trimmed;
}

function ContactDisplay({note}:{note:string}){
  if(!note)return <span className="muted">add note…</span>;
  const p=parseContact(note);
  if(p.platform){
    const theme=CONTACT_THEME[p.platform];
    return(
      <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:10,color:theme.fg,background:theme.bg,fontSize:11,fontWeight:600,lineHeight:"16px"}}>
        {ContactIcons[p.platform]}
        <span>{p.name||theme.label}</span>
      </span>
    );
  }
  return <span style={{color:"#5a574e",fontSize:11}}>{p.name}</span>;
}

// Inline editor wrapper. Uses a focus-trap pattern: container onBlur only
// fires when focus exits the editor entirely (relatedTarget outside), so
// platform-button clicks don't trigger save. Buttons preventDefault on
// mousedown so they never take focus from the name input — Enter still
// works to commit from any moment.
function ContactEditor({platform,name,setPlatform,setName,inputRef,onSave,onCancel,minWidth}:{
  platform:ContactPlatform|"";
  name:string;
  setPlatform:(p:ContactPlatform|"")=>void;
  setName:(n:string)=>void;
  inputRef:React.RefObject<HTMLInputElement|null>;
  onSave:()=>void;
  onCancel:()=>void;
  minWidth:number;
}){
  return(
    <div
      onClick={e=>e.stopPropagation()}
      onBlur={e=>{
        // relatedTarget is the next focus target. Still inside the wrapper
        // (e.g. switching between input and a button) → not a real exit.
        if(e.currentTarget.contains(e.relatedTarget as Node|null))return;
        onSave();
      }}
      onKeyDown={e=>{
        if(e.key==="Enter"){e.preventDefault();onSave();}
        else if(e.key==="Escape"){e.preventDefault();onCancel();}
      }}
      style={{display:"flex",flexDirection:"column",gap:4,minWidth}}
    >
      <div style={{display:"flex",gap:3}}>
        {CONTACT_PLATFORMS.map(p=>{
          const theme=CONTACT_THEME[p];
          const selected=platform===p;
          return(
            <button key={p} type="button" title={theme.label}
              onMouseDown={e=>e.preventDefault()}
              onClick={e=>{e.stopPropagation();setPlatform(selected?"":p);inputRef.current?.focus();}}
              style={{
                width:24,height:22,
                display:"inline-flex",alignItems:"center",justifyContent:"center",
                padding:0,
                border:selected?`2px solid ${theme.fg}`:"1px solid #D9D6CC",
                borderRadius:6,
                background:selected?theme.bg:"#fff",
                color:theme.fg,
                cursor:"pointer",
                lineHeight:0,
              }}
            >{ContactIcons[p]}</button>
          );
        })}
      </div>
      <input
        ref={inputRef}
        autoFocus
        value={name}
        maxLength={80}
        placeholder={platform?"name / handle":"plain note (no platform)"}
        onChange={e=>setName(e.target.value)}
        onClick={e=>e.stopPropagation()}
        style={{width:"100%",fontSize:12,padding:"2px 4px"}}
      />
    </div>
  );
}

function hasNativeMobilePrinter(){
  if(typeof window==="undefined")return false;
  return !!(
    window.SellerFlowPrinter?.printSlip ||
    window.Capacitor?.Plugins?.SellerFlowPrinter?.printSlip ||
    window.ReactNativeWebView?.postMessage
  );
}

async function callMobilePrinterBridge(action:"scanPrinters"|"printerStatus"|"testPrint"|"connectPrinter"|"setPrinter"|"getPrinter"|"testConnection",printer?:MobilePrinterDevice|PrinterLanConfig):Promise<MobilePrinterResult>{
  if(typeof window==="undefined"||!window.SellerFlowPrinter)return {ok:false,message:"Open this inside the SellerFlow mobile app to use phone printer scanning."};
  const bridge=window.SellerFlowPrinter;
  try{
    let raw:unknown;
    if(action==="setPrinter")raw=await bridge.setPrinter?.(printer as PrinterLanConfig);
    else if(action==="getPrinter")raw=await bridge.getPrinter?.();
    else if(action==="testConnection")raw=await bridge.testConnection?.(printer as PrinterLanConfig);
    else if(action==="connectPrinter")raw=await bridge.connectPrinter?.(printer?JSON.stringify(printer):"");
    else raw=await bridge[action]?.();
    if(typeof raw==="string"){
      try{return JSON.parse(raw) as MobilePrinterResult;}catch{return {ok:/printed|ready|online|connected/i.test(raw),message:raw};}
    }
    if(raw&&typeof raw==="object")return raw as MobilePrinterResult;
    return {ok:true,message:"Printer command sent"};
  }catch(err){
    const e=err as {message?:string};
    return {ok:false,message:e?.message||String(err)||"Printer bridge failed"};
  }
}

function sendSlipToNativePrinter(payload:NativePrinterPayload){
  if(typeof window==="undefined")return false;
  const showNativePrinterResult=(result:PrinterBridgeReturn|Promise<PrinterBridgeReturn>)=>{
    void Promise.resolve(result).then(msg=>{
      if(msg&&typeof msg==="object"){
        if(msg.ok)return;
        const text=msg.message||"Native printer failed.";
        console.warn(text);
        window.alert(text);
        return;
      }
      if(typeof msg!=="string"||!msg.trim())return;
      if(/printed to/i.test(msg))return;
      console.warn(msg);
      window.alert(msg);
    }).catch(err=>console.warn("Native printer bridge failed.",err));
  };
  try{
    if(window.SellerFlowPrinter?.printSlip){
      showNativePrinterResult(window.SellerFlowPrinter.printSlip(payload));
      return true;
    }
    if(window.Capacitor?.Plugins?.SellerFlowPrinter?.printSlip){
      showNativePrinterResult(window.Capacitor.Plugins.SellerFlowPrinter.printSlip(payload));
      return true;
    }
    if(window.ReactNativeWebView?.postMessage){
      window.ReactNativeWebView.postMessage(JSON.stringify(payload));
      return true;
    }
  }catch(err){
    console.warn("Native printer bridge failed; falling back to browser print.",err);
  }
  return false;
}


// Build the native-sticker payload the printStickerNative plugin method
// consumes. Mirrors the existing slip shape so this is a flat pass-through.
function buildNativeStickerPayload(buyer:Buyer,cur:string,storeName:string,cfg:Settings):NativeStickerPayload{
  const sessionDate=new Date().toLocaleDateString("en-PH",{month:"long",day:"numeric",year:"numeric"});
  // Re-derive each order's time from its orderNum (epoch ms set at order
  // creation) in the device's LOCAL timezone, formatted "HH:MM" (24h, no
  // seconds). The server-emitted order.time is UTC because Render runs in
  // UTC, which printed as 6:02 instead of the seller's Taiwan 14:02; and
  // "HH:MM:SS PM" used to overflow the time column into the item column.
  // Both issues go away by reformatting here. orderNum is checked > 1e12
  // (~year 2001) to skip values that are sequence numbers rather than
  // real epochs — those fall back to the original string.
  const localizedOrders=buyer.orders.map(o=>{
    const ts=typeof o.orderNum==="number"?o.orderNum:0;
    const time=ts>1e12
      ?new Date(ts).toLocaleTimeString("en-GB",{hour:"2-digit",minute:"2-digit"})
      :o.time;
    return {...o,time};
  });
  return {
    storeName,
    sessionDate,
    currency:cur,
    buyer:{...buyer,orders:localizedOrders},
    settings:{
      printStoreName:cfg.printStoreName,
      printBuyerNumber:cfg.printBuyerNumber,
      printBuyerUsername:cfg.printBuyerUsername,
      printOrderItems:cfg.printOrderItems,
      printTotal:cfg.printTotal,
    },
  };
}

// 1-click Bluetooth sticker print. AIMO D520BT (and other TSPL clones we've
// tested) accept TEXT + BAR commands but ignore BITMAP, so we send the
// printSlip payload to the native TEXT+BAR builder. The older BITMAP path
// (printSticker) is kept dormant for future printers that DO support it.
async function printStickerViaBluetooth(buyer:Buyer,cur:string,storeName:string,cfg:Settings):Promise<boolean>{
  const bridge=typeof window!=="undefined"?window.SellerFlowPrinter:undefined;
  if(!bridge?.printStickerNative)return false;
  try{
    const result=await bridge.printStickerNative(buildNativeStickerPayload(buyer,cur,storeName,cfg));
    return !!result?.ok;
  }catch(err){
    console.warn("printStickerNative bridge call failed:",err);
    return false;
  }
}

// 1-click WiFi/LAN sticker print (iOS). Same TSPL TEXT+BAR slip data as the
// Bluetooth path, but shipped over raw TCP 9100 by the iOS plugin's
// printStickerLan method (iOS BLE printing is MFi-gated, so WiFi is the only
// native sticker transport on iPhone). printStickerLan is injected ONLY by the
// iOS plugin, so this never fires on Android.
async function printStickerViaLan(buyer:Buyer,cur:string,storeName:string,cfg:Settings):Promise<boolean>{
  const bridge=typeof window!=="undefined"?window.SellerFlowPrinter:undefined;
  if(!bridge?.printStickerLan)return false;
  try{
    const result=await bridge.printStickerLan(buildNativeStickerPayload(buyer,cur,storeName,cfg));
    return !!result?.ok;
  }catch(err){
    console.warn("printStickerLan bridge call failed:",err);
    return false;
  }
}

function printSlip(buyer:Buyer,cur:string,storeName:string,printSettings:Settings|string){
  const cfg:Settings=typeof printSettings==="string"?{...DEF_SETTINGS,stickerSize:printSettings}:printSettings;
  // 🅱️ Bluetooth sticker (TSPL) path — additive, opt-in. Triggers ONLY when
  // the seller explicitly picked "bluetooth" AND the native bridge has the
  // printSticker method (Android APK with BT plugin). Otherwise we fall
  // straight through to the existing WiFi/LAN + browser-print flow below,
  // byte-identical to before this feature.
  const nativePrinter=typeof window!=="undefined"?window.SellerFlowPrinter:undefined;
  if(shouldUseBluetoothSticker(cfg.printerType,!!nativePrinter?.printStickerNative)){
    void printStickerViaBluetooth(buyer,cur,storeName,cfg).then(ok=>{
      if(!ok)console.warn("[BT sticker] print failed — check Bluetooth printer pairing and selection in Settings.");
    });
    return;
  }
  // 📶 iOS WiFi/LAN sticker (TSPL over TCP 9100) — additive, opt-in. Triggers
  // ONLY when the seller EXPLICITLY chose Output: Sticker (cfg.lanFormat==="sticker")
  // AND picked "lan" AND the iOS-exclusive printStickerLan bridge method exists.
  // Default lanFormat is "receipt", so WiFi/LAN keeps using the ESC/POS receipt
  // path below unless the seller opts into stickers. On Android (no
  // printStickerLan) this is always skipped.
  if(shouldUseLanSticker(cfg.printerType,cfg.lanFormat,!!nativePrinter?.printStickerLan)){
    void printStickerViaLan(buyer,cur,storeName,cfg).then(ok=>{
      if(!ok)console.warn("[LAN sticker] print failed — check WiFi printer IP in Settings.");
    });
    return;
  }
  const size=cfg.stickerSize;
  const scale=(v:number|undefined,fallback=100)=>Math.max(60,Math.min(180,v||fallback))/100;
  const storeScale=scale(cfg.printStoreScale,cfg.printLabelScale);
  const buyerNumberScale=scale(cfg.printBuyerNumberScale,120);
  const buyerNameScale=scale(cfg.printBuyerNameScale,cfg.printLabelScale);
  const usernameScale=scale(cfg.printUsernameScale,cfg.printLabelScale);
  const orderScale=scale(cfg.printOrderScale,cfg.printLabelScale);
  const commentScale=scale(cfg.printCommentScale,cfg.printLabelScale);
  const totalScale=scale(cfg.printTotalScale,cfg.printLabelScale);
  const pos=(v:number|undefined)=>Math.max(-40,Math.min(40,v||0));
  const sess=new Date().toLocaleDateString("en-PH",{month:"long",day:"numeric",year:"numeric"});
  const nativePayload:NativePrinterPayload={type:"sellerflow.printSlip",buyer,currency:cur,storeName,settings:cfg,sessionDate:sess,createdAt:new Date().toISOString()};
  if(hasNativeMobilePrinter()&&sendSlipToNativePrinter(nativePayload))return;
  const color=nc(buyer.num);
  const [w]=size.split("x").map(Number);
  const safeSess=esc(sess);
  const safeStoreName=esc(storeName);
  const safeBuyerNum=esc(buyer.num);
  const safeBuyerName=esc(buyer.name);
  const safeBuyerHandle=esc(buyer.handle);
  const safeCurrency=esc(cur);
  const safeTotal=buyer.totalSpent>0?`${safeCurrency}${esc(buyer.totalSpent.toLocaleString())}`:"";
  const commentOnlyHtml=buyer.orders.map(o=>`<div class="order-entry"><div class="order-time">${esc(o.time)}</div><div class="order-comment">${esc(o.item)}</div></div>`).join("");
  const scaledOrderHtml=commentOnlyHtml;
  const frame=document.createElement("iframe");
  frame.title=`Slip #${safeBuyerNum}`;
  frame.style.position="fixed";
  frame.style.right="0";
  frame.style.bottom="0";
  frame.style.width="0";
  frame.style.height="0";
  frame.style.border="0";
  frame.style.opacity="0";
  document.body.appendChild(frame);
  const win=frame.contentWindow;
  if(!win){frame.remove();console.warn("Printer was not ready. Try again.");return;}
  win.onafterprint=()=>setTimeout(()=>frame.remove(),50);
  const doc=win.document;
  doc.open();
  doc.write(`<!DOCTYPE html><html><head><title>Slip #${safeBuyerNum}</title><style>@page{size:${size.replace("x","mm ")}mm;margin:3mm}*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;width:${w}mm;color:#000}.head{display:flex;align-items:flex-start;justify-content:space-between;gap:3mm;margin-bottom:2.5mm}.brand{font-size:${14*storeScale}px;font-weight:800;transform:translate(${pos(cfg.printStoreX)}mm,${pos(cfg.printStoreY)}mm)}.brand span{color:#7F77DD}.session{font-size:${12*totalScale}px;font-weight:800;text-align:right;transform:translate(${pos(cfg.printSessionX)}mm,${pos(cfg.printSessionY)}mm)}.grid{display:grid;grid-template-columns:52% 48%;gap:3mm;align-items:start}.left{display:flex;flex-direction:column;gap:1.5mm;padding-top:1mm}.seller{font-size:${13*storeScale}px;font-weight:800;line-height:1.1;transform:translate(${pos(cfg.printStoreX)}mm,${pos(cfg.printStoreY)}mm)}.line{font-size:${13*buyerNameScale}px;font-weight:800;line-height:1.1}.muted{font-size:${10*usernameScale}px;font-weight:700;color:#333}.buyer-num{font-size:${13*buyerNumberScale}px;color:${color};font-weight:900;transform:translate(${pos(cfg.printBuyerNumberX)}mm,${pos(cfg.printBuyerNumberY)}mm)}.buyer-name{transform:translate(${pos(cfg.printBuyerNameX)}mm,${pos(cfg.printBuyerNameY)}mm)}.username{transform:translate(${pos(cfg.printUsernameX)}mm,${pos(cfg.printUsernameY)}mm)}.order-box{min-height:38mm;padding:0;transform:translate(${pos(cfg.printOrderX)}mm,${pos(cfg.printOrderY)}mm)}.order-title{font-size:${15*orderScale}px;font-weight:900;margin-bottom:2mm}.order-entry{border-left:2px solid #000;padding-left:2mm;margin-bottom:2mm}.order-time{font-size:${9*orderScale}px;color:#111;font-weight:500;line-height:1.1}.order-comment{font-size:${10*commentScale}px;font-weight:800;line-height:1.1;margin-top:.8mm}.total{border-top:1px dashed #777;margin-top:2mm;padding-top:1.5mm;display:flex;justify-content:space-between;gap:2mm;font-size:${11*totalScale}px;font-weight:800;transform:translate(${pos(cfg.printTotalX)}mm,${pos(cfg.printTotalY)}mm)}@media print{body{margin:0}}</style></head><body>
  <div class="head"><div class="brand">Seller<span>FlowLive</span></div><div class="session">Session: ${safeSess}</div></div>
  <div class="grid"><div class="left">
  ${cfg.printStoreName?`<div class="seller">${safeStoreName}</div>`:""}
  ${cfg.printBuyerNumber?`<div class="line buyer-num">Buyer #${safeBuyerNum}</div>`:""}
  <div class="line buyer-name">${safeBuyerName}</div>
  ${cfg.printBuyerUsername?`<div class="muted username">@${safeBuyerHandle}</div>`:""}
  </div>
  ${cfg.printOrderItems?`<div class="order-box"><div class="order-title">Order here</div>${scaledOrderHtml}${cfg.printTotal?`<div class="total"><span>Total</span><span>${safeTotal}</span></div>`:""}</div>`:""}
  </div>
  </body></html>`);
  doc.close();
  setTimeout(()=>{
    win.focus();
    win.print();
    if(cfg.printAutoClose)window.setTimeout(()=>frame.remove(),8000);
  },120);
}

// ═══════════════════════════════════════════════════════════════════
// AUTH (public landing + login / register / forgot via Supabase Auth)
// ═══════════════════════════════════════════════════════════════════
function PublicAuth({onLogin,t,lang,setLang}:{onLogin:(u:User)=>void;t:T;lang:Lang;setLang:(l:Lang)=>void}){
  const [mode,setMode]=useState<"login"|"reg"|"forgot">("login");
  const [email,setEmail]=useState("");const [pw,setPw]=useState("");const [cpw,setCpw]=useState("");
  const [fn,setFn]=useState("");const [sn,setSn]=useState("");
  const [phone,setPhone]=useState("");
  const [showPw,setShowPw]=useState(false);const [err,setErr]=useState("");const [ok,setOk]=useState("");const [busy,setBusy]=useState(false);
  const [activeFeature,setActiveFeature]=useState(0);
  const [activeFlow,setActiveFlow]=useState(0);
  const [openFaq,setOpenFaq]=useState(0);
  const [publicPlanMonths,setPublicPlanMonths]=useState<Record<Exclude<Plan,"free"|"trial">,number>>({basic:1,pro:1,master:1});
  const [publicLegal,setPublicLegal]=useState<""|"privacy"|"terms">(()=>{
    if(typeof window==="undefined")return "";
    return window.location.hash==="#privacy"?"privacy":window.location.hash==="#terms"?"terms":"";
  });
  async function login(e:React.FormEvent){e.preventDefault();setErr("");setBusy(true);
    if(!supabase){setErr(t.err_service_unavailable);setBusy(false);return;}
    const cleanEmail=email.trim().toLowerCase();
    const {data,error}=await supabase.auth.signInWithPassword({email:cleanEmail,password:pw});
    if(error||!data.user){setErr(t.err_wrong_pw);setBusy(false);return;}
    let profile=await getMyProfile(data.user.id);
    if(!profile){
      // Auth account exists but has no profile row yet — create a minimal one.
      try{profile=await createMyProfile(data.user.id,cleanEmail,{fullName:"",storeName:"",phone:"",tiktok:"",facebook:"",adminContactNote:""});}
      catch{setErr(t.err_profile_load);setBusy(false);return;}
    }
    if(!profile){setErr(t.err_profile_load);setBusy(false);return;}
    posthog.identify(profile.email,{plan:profile.plan,store_name:profile.profile.storeName,role:profile.role||"seller"});
    onLogin(profile);setBusy(false);
  }
  async function reg(e:React.FormEvent){e.preventDefault();setErr("");setOk("");setBusy(true);
    if(!fn.trim()||!sn.trim()||!email.trim()||!pw){setErr(t.err_fill_all);setBusy(false);return;}
    if(normalizePhone(phone).length<8){setErr(t.err_phone_invalid);setBusy(false);return;}
    if(pw.length<6){setErr(t.err_pw_short);setBusy(false);return;}
    if(pw!==cpw){setErr(t.err_pw_mismatch);setBusy(false);return;}
    if(!supabase){setErr(t.err_service_unavailable);setBusy(false);return;}
    const cleanEmail=email.trim().toLowerCase();
    const {data,error}=await supabase.auth.signUp({email:cleanEmail,password:pw});
    if(error){setErr(/already|registered|exists/i.test(error.message)?t.err_email_exists:t.err_generic);setBusy(false);return;}
    if(!data.user){setErr(t.err_register_failed);setBusy(false);return;}
    if(!data.session){
      // Email confirmation is enabled: no session yet, so we can't create the
      // profile row (RLS needs auth.uid()). Ask the user to confirm + log in.
      setOk(t.reg_check_email);setMode("login");setBusy(false);return;
    }
    let profile;
    try{profile=await createMyProfile(data.user.id,cleanEmail,{fullName:fn.trim(),storeName:sn.trim(),phone:phoneDisplay(phone),tiktok:"",facebook:"",adminContactNote:""});}
    catch{setErr(t.err_profile_create);setBusy(false);return;}
    if(!profile){setErr(t.err_profile_create);setBusy(false);return;}
    posthog.identify(profile.email,{plan:profile.plan,store_name:profile.profile.storeName,role:profile.role||"seller"});
    onLogin(profile);setBusy(false);
  }
  async function forgot(e:React.FormEvent){e.preventDefault();setErr("");setOk("");setBusy(true);
    if(!supabase){setErr(t.err_service_unavailable);setBusy(false);return;}
    const cleanEmail=email.trim().toLowerCase();
    const redirectTo=typeof window!=="undefined"?`${window.location.origin}/`:undefined;
    const {error}=await supabase.auth.resetPasswordForEmail(cleanEmail,redirectTo?{redirectTo}:undefined);
    if(error){setErr(t.err_generic);setBusy(false);return;}
    setOk(`${t.reset_sent} ${cleanEmail}`);setBusy(false);
  }
  const go=(m:"login"|"reg"|"forgot")=>{setMode(m);setErr("");setOk("");};
  const jump=(id:string)=>document.getElementById(id)?.scrollIntoView({behavior:"smooth",block:"start"});
  const openLegal=(kind:"privacy"|"terms")=>{window.location.hash=kind;setPublicLegal(kind);};
  const closeLegal=()=>{
    window.history.pushState("",document.title,window.location.pathname+window.location.search);
    setPublicLegal("");
  };
  if(publicLegal)return <LegalPage kind={publicLegal} onBack={closeLegal}/>;
  const featureItems=[
    {title:t.lp_feat_print_t,body:t.lp_feat_print_b},
    {title:t.lp_feat_capture_t,body:t.lp_feat_capture_b},
    {title:t.lp_feat_orders_t,body:t.lp_feat_orders_b},
    {title:t.lp_feat_db_t,body:t.lp_feat_db_b},
    {title:t.lp_feat_bt_t,body:t.lp_feat_bt_b},
    {title:t.lp_feat_analytics_t,body:t.lp_feat_analytics_b},
  ];
  const flowItems=[
    {title:t.lp_flow_admin_t,label:t.lp_flow_admin_l,body:t.lp_flow_admin_b},
    {title:t.lp_flow_live_t,label:t.lp_flow_live_l,body:t.lp_flow_live_b},
    {title:t.lp_flow_computer_t,label:t.lp_flow_computer_l,body:t.lp_flow_computer_b},
    {title:t.lp_flow_payment_t,label:t.lp_flow_payment_l,body:t.lp_flow_payment_b},
    {title:t.lp_flow_fullscreen_t,label:t.lp_flow_fullscreen_l,body:t.lp_flow_fullscreen_b},
    {title:t.lp_flow_bigbox_t,label:t.lp_flow_bigbox_l,body:t.lp_flow_bigbox_b},
  ];
  const howSteps=[
    t.lp_inst_step1,
    t.lp_inst_step2,
    t.lp_inst_step3,
    t.lp_inst_step4,
    t.lp_inst_step5,
  ];
  const faqItems=[
    [t.lp_faq_q1,t.lp_faq_a1],
    [t.lp_faq_q2,t.lp_faq_a2],
    [t.lp_faq_q3,t.lp_faq_a3],
    [t.lp_faq_q4,t.lp_faq_a4],
    [t.lp_faq_q5,t.lp_faq_a5],
    [t.lp_faq_q6,t.lp_faq_a6],
  ];
  const monthOptions=Array.from({length:12},(_,i)=>i+1);
  const publicPlans=[
    {id:"free" as Plan,name:t.plan_free,basePrice:0,period:t.lp_price_forever,desc:t.lp_free_desc,features:t.lp_free_features,bestFor:t.lp_free_best,action:t.start_trial_btn},
    {id:"basic" as Plan,name:t.plan_basic,basePrice:15,period:t.sub_month,desc:t.sub_basic_desc,features:t.sub_basic_features,bestFor:t.sub_basic_best,action:t.sub_basic_action},
    {id:"pro" as Plan,name:t.plan_pro,basePrice:25,period:t.sub_month,desc:t.sub_pro_desc,features:t.sub_pro_features,bestFor:t.sub_pro_best,action:t.sub_pro_action,popular:true},
    {id:"master" as Plan,name:t.plan_master,basePrice:40,period:t.sub_month,desc:t.sub_master_desc,features:t.sub_master_features,bestFor:t.sub_master_best,action:t.sub_master_action},
  ];
  const accountForm=(
    <div className="auth-card public-auth-card">
      {mode==="login"&&<>
        <h2>{t.login_title}</h2><p className="auth-sub">{t.login_sub}</p>
        <form onSubmit={login} className="auth-form">
          {err&&<div className="auth-err">{t.warning_prefix} {err}</div>}
          <Fg label={t.email_field}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@email.com" required autoFocus/></Fg>
          <Fg label={t.pw_field}><div className="pw-wrap"><input type={showPw?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)} placeholder={t.ph_password} required/><button type="button" onClick={()=>setShowPw(p=>!p)} className="pw-eye" aria-label={showPw?t.hide_pw:t.show_pw} title={showPw?t.hide_pw:t.show_pw}>{showPw?PwEyeOffIcon:PwEyeIcon}</button></div></Fg>
          <div style={{textAlign:"right",marginBottom:4}}><button type="button" className="auth-link" onClick={()=>go("forgot")}>{t.forgot_link}</button></div>
          <button type="submit" className="auth-btn" disabled={busy}>{busy?t.signing_in:t.sign_in_btn}</button>
        </form>
        <div className="auth-sw">{t.no_account} <button className="auth-link" onClick={()=>go("reg")}>{t.create_account}</button></div>
      </>}
      {mode==="reg"&&<>
        <h2>{t.register_title}</h2><p className="auth-sub">{t.register_sub}</p>
        <form onSubmit={reg} className="auth-form">
          {err&&<div className="auth-err">{t.warning_prefix} {err}</div>}
          {ok&&<div className="auth-ok">{t.done_prefix} {ok}</div>}
          <div className="auth-row2">
            <Fg label={t.fname_field}><input value={fn} onChange={e=>setFn(e.target.value)} placeholder="Maria Reyes" required/></Fg>
            <Fg label={t.sname_field}><input value={sn} onChange={e=>setSn(e.target.value)} placeholder="Maria's Shop" required/></Fg>
          </div>
          <Fg label={t.email_field}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@email.com" required/></Fg>
          <Fg label={t.phone_label}><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+63 912 345 6789" inputMode="tel" required/></Fg>
          <Fg label={t.pw_field}><div className="pw-wrap"><input type={showPw?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)} placeholder={t.ph_min6} required/><button type="button" onClick={()=>setShowPw(p=>!p)} className="pw-eye" aria-label={showPw?t.hide_pw:t.show_pw} title={showPw?t.hide_pw:t.show_pw}>{showPw?PwEyeOffIcon:PwEyeIcon}</button></div></Fg>
          <Fg label={t.confirm_field}><input type="password" value={cpw} onChange={e=>setCpw(e.target.value)} placeholder={t.ph_confirm} required/></Fg>
          <button type="submit" className="auth-btn" disabled={busy}>{busy?t.submitting:t.submit_approval}</button>
          <a className="printer-shortcut-link" href="/sellerflow-printer-shortcut.bat?v=6" download>{t.printer_shortcut}</a>
          <p className="auth-terms">{t.free_after_approval}</p>
          <p className="auth-terms">{t.terms_agree} <button type="button" className="inline-link" onClick={()=>openLegal("terms")}>{t.terms_label}</button> · <button type="button" className="inline-link" onClick={()=>openLegal("privacy")}>{t.privacy_label}</button></p>
        </form>
        <div className="auth-sw">{t.have_account} <button className="auth-link" onClick={()=>go("login")}>{t.sign_in_btn}</button></div>
      </>}
      {mode==="forgot"&&<>
        <h2>{t.forgot_title}</h2><p className="auth-sub">{t.forgot_sub}</p>
        <form onSubmit={forgot} className="auth-form">
          {err&&<div className="auth-err">{t.warning_prefix} {err}</div>}
          {ok&&<div className="auth-ok">{t.done_prefix} {ok}</div>}
          <Fg label={t.email_field}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@email.com" required autoFocus/></Fg>
          <button type="submit" className="auth-btn" disabled={busy}>{busy?t.sending:t.send_reset}</button>
        </form>
        <div className="auth-sw"><button className="auth-link" onClick={()=>go("login")}>{t.back_login}</button></div>
      </>}
      {/* Footer tools — shared across all auth modes: Support (Telegram) on the
          left, language switcher on the right (moved here from the top nav). */}
      <div className="auth-foot-tools">
        <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" className="auth-foot-support">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M22 3L2 11.4l5.8 2 9.2-6.4-7.3 8.6 1.7 5.6 3-3.1 4.6 3.4L22 3z"/></svg>
          {t.support_label}
        </a>
        <select value={lang} onChange={e=>setLang(e.target.value as Lang)} className="auth-foot-lang" aria-label="Language">
          {LANG_OPTS.map(l=><option key={l.code} value={l.code}>{l.label}</option>)}
        </select>
      </div>
    </div>
  );
  return(
    <div className="public-page">
      <header className="public-nav">
        <button className="public-brand" onClick={()=>jump("home")}><span className="public-logo">S</span><span>Seller<span>FlowLive</span></span></button>
        <nav><button onClick={()=>jump("features")}>{t.lp_nav_features}</button><button onClick={()=>jump("pricing")}>{t.lp_nav_pricing}</button><button onClick={()=>jump("instructions")}>{t.lp_nav_howto}</button><button onClick={()=>jump("support-info")}>{t.support_label}</button><button onClick={()=>jump("faq")}>{t.lp_nav_faq}</button></nav>
        <div className="public-nav-actions"><button onClick={()=>{go("login");jump("account")}}>{t.lp_login}</button><button className="public-primary" onClick={()=>{go("reg");jump("account")}}>{t.lp_register}</button></div>
      </header>
      <section id="home" className="public-hero">
        <div className="public-hero-copy"><span className="public-kicker">{t.lp_hero_kicker}</span><h1>{t.lp_hero_title}</h1><p>{t.lp_hero_sub}</p><div className="public-hero-actions"><button className="public-primary" onClick={()=>{go("reg");jump("account")}}>{t.start_trial_btn}</button><button onClick={()=>jump("instructions")}>{t.lp_hero_how}</button></div><div className="public-metrics"><div><b>{t.lp_metric_oneclick_b}</b><span>{t.lp_metric_oneclick_l}</span></div><div><b>{t.lp_metric_live_b}</b><span>{t.lp_metric_live_l}</span></div><div><b>{t.lp_metric_smart_b}</b><span>{t.lp_metric_smart_l}</span></div></div></div>
        <div className="public-device" aria-label="SellerFlowLive dashboard preview">
          <div className="device-top"><span/><span/><span/><em>SellerFlowLive dashboard</em></div>
          <div className="device-grid">
            <div className="device-sidebar"><b>SellerFlowLive</b><span>Live feed</span><span>Orders</span><span>Customers</span><span>Analytics</span><span>Support</span></div>
            <div className="device-main">
              <div className="device-command"><span>AI order desk</span><strong>Live comments become printable slips</strong><button>1-click print</button></div>
              <div className="device-stats"><span><b>94</b>Orders</span><span><b>28</b>Buyers</span><span><b>Fast</b>Print flow</span></div>
              <div className="device-comment hot"><b>Maria Santos - @maria_live</b><em>1-click</em><p>blue dress +1, size M</p></div>
              <div className="device-comment"><b>Hazel Shop - @hazelshop</b><em>saved</em><p>crop top mine, repeat buyer</p></div>
              <div className="device-panels"><div className="device-slip"><small>PRINT PREVIEW</small><strong>BUYER #12</strong><span>ready for Xprinter label</span></div><div className="device-chart"><span/><span/><span/><span/></div></div>
            </div>
          </div>
        </div>
      </section>
      <section id="workflow" className="public-section public-workflow">
        <div className="public-section-head"><span>{t.lp_wf_kicker}</span><h2>{t.lp_wf_title}</h2><p>{t.lp_wf_sub}</p></div>
        <div className="workflow-board">
          <div className="workflow-left">
            {flowItems.slice(0,3).map((item,i)=><button key={item.title} className={activeFlow===i?"active":""} onClick={()=>setActiveFlow(i)}><strong>{item.title}</strong><span>{item.label}</span></button>)}
          </div>
          <button className="workflow-center" onClick={()=>setActiveFlow(5)}>
            <span>{t.lp_wf_center_label}</span>
            <strong>{t.lp_wf_center_title}</strong>
            <em>{t.lp_wf_center_hint}</em>
          </button>
          <div className="workflow-right">
            {flowItems.slice(3).map((item,i)=><button key={item.title} className={activeFlow===i+3?"active":""} onClick={()=>setActiveFlow(i+3)}><strong>{item.title}</strong><span>{item.label}</span></button>)}
          </div>
        </div>
        <div className="workflow-detail">
          <small>{flowItems[activeFlow].title}</small>
          <h3>{flowItems[activeFlow].label}</h3>
          <p>{flowItems[activeFlow].body}</p>
          <button onClick={()=>jump(activeFlow===3?"support-info":activeFlow===0?"account":"features")}>{t.lp_wf_open_related}</button>
        </div>
      </section>
      <section id="features" className="public-section public-feature-band"><div className="public-section-head"><span>{t.lp_nav_features}</span><h2>{t.lp_feat_title}</h2><p>{t.lp_feat_sub}</p></div><div className="public-feature-cards">{featureItems.map((f,i)=><button key={f.title} className={activeFeature===i?"active":""} onClick={()=>setActiveFeature(i)}><span>{String(i+1).padStart(2,"0")}</span><strong>{f.title}</strong><p>{f.body}</p></button>)}</div><div className="public-feature-detail premium"><small>{t.lp_feat_selected}</small><h3>{featureItems[activeFeature].title}</h3><p>{featureItems[activeFeature].body}</p><button onClick={()=>jump("account")}>{t.lp_feat_try}</button></div></section>
      <section id="instructions" className="public-section public-instructions"><div className="public-section-head"><span>{t.lp_nav_instructions}</span><h2>{t.lp_inst_title}</h2><p>{t.lp_inst_sub}</p></div><div className="public-steps">{howSteps.map((step,i)=><button key={step} onClick={()=>i<2?jump("account"):jump("features")}><b>{i+1}</b><span>{step}</span></button>)}</div></section>
      <section id="pricing" className="public-section public-pricing-section"><div className="public-section-head"><span>{t.lp_nav_pricing}</span><h2>{t.lp_price_title}</h2><p>{t.lp_price_sub}</p></div><div className="public-pricing">{publicPlans.map((p,i)=>{const paid=p.basePrice>0;const months=paid?publicPlanMonths[p.id as Exclude<Plan,"free"|"trial">]:1;const price=paid?p.basePrice*months:p.basePrice;return <button key={p.name} className={p.popular?"popular":""} onClick={()=>{go(i===0?"reg":"login");jump("account")}}>{p.popular&&<small>{t.lp_price_popular}</small>}<span className="pricing-icon">{i+1}</span><strong>{p.name}</strong><b>${price}</b><span className="pricing-period">/{paid?`${months} ${months===1?t.sub_month:t.sub_months}`:p.period}</span>{paid&&<div className="public-plan-duration" onClick={e=>e.stopPropagation()}><span>{t.sub_duration}</span><select value={months} onChange={e=>setPublicPlanMonths(current=>({...current,[p.id]:Number(e.target.value)}))}>{monthOptions.map(month=><option key={month} value={month}>{month} {month===1?t.sub_month:t.sub_months}</option>)}</select><em>${p.basePrice}{t.plan_month}</em></div>}<p>{p.desc}</p><ul>{p.features.map(f=><li key={f}>{f}</li>)}</ul><div className="pricing-best"><span>{t.sub_best_for}</span><b>{p.bestFor}</b></div><em>{p.action}</em></button>})}</div></section>
      <section id="support-info" className="public-section public-support-band"><div><span>{t.support_label}</span><h2>{t.lp_support_title}</h2><p>{t.lp_support_sub}</p></div><button onClick={()=>{go("login");jump("account")}}>{t.lp_support_cta}</button></section>
      <section id="faq" className="public-section"><div className="public-section-head"><span>{t.lp_nav_faq}</span><h2>{t.lp_faq_title}</h2><p>{t.lp_faq_sub}</p></div><div className="public-faq">{faqItems.map((item,i)=><button key={item[0]} className={openFaq===i?"open":""} onClick={()=>setOpenFaq(openFaq===i?-1:i)}><div><span>{i+1}</span><strong>{item[0]}</strong><b>{openFaq===i?"-":"+"}</b></div>{openFaq===i&&<p>{item[1]}</p>}</button>)}</div></section>
      <section id="account" className="public-account"><div className="public-account-copy"><span>{t.lp_account_badge}</span><h2>{t.lp_account_title}</h2><p>{t.lp_account_sub}</p></div>{accountForm}</section>
      <footer className="public-footer"><div><strong>SellerFlowLive</strong><p>{t.lp_footer_tagline}</p></div><div><button onClick={()=>jump("features")}>{t.lp_nav_features}</button><button onClick={()=>jump("instructions")}>{t.lp_nav_instructions}</button><button onClick={()=>jump("pricing")}>{t.lp_nav_pricing}</button><button onClick={()=>openLegal("privacy")}>{t.lp_footer_privacy}</button><button onClick={()=>openLegal("terms")}>{t.terms_label}</button><button onClick={()=>jump("account")}>{t.lp_login}</button></div></footer>
    </div>
  );
}

// Password-recovery "Set New Password" screen. Shown only when a Supabase
// PASSWORD_RECOVERY session is active (link clicked from the reset email). The
// recovery session already authenticates the user, so updateUser() needs NO
// old password — this is deliberately different from handleSavePw (settings),
// which still requires the current password.
function ResetPasswordPage({onDone}:{onDone:()=>void}){
  const MIN_PW=8;
  const [pw,setPw]=useState("");
  const [cpw,setCpw]=useState("");
  const [showPw,setShowPw]=useState(false);
  const [showCpw,setShowCpw]=useState(false);
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState(false);
  const [done,setDone]=useState(false);
  // Strip the recovery token (#access_token=...&type=recovery) from the address
  // bar as soon as the form mounts so it isn't shoulder-surfed or bookmarked.
  useEffect(()=>{
    if(typeof window!=="undefined"&&window.location.hash){
      window.history.replaceState(null,document.title,window.location.pathname+window.location.search);
    }
  },[]);
  const tooShort=pw.length<MIN_PW;
  const mismatch=cpw.length>0&&pw!==cpw;
  const canSubmit=!busy&&!tooShort&&cpw.length>0&&pw===cpw;
  async function submit(e:React.FormEvent){
    e.preventDefault();
    setErr("");
    if(!supabase){setErr(t.err_service_unavailable);return;}
    if(tooShort){setErr(`Password must be at least ${MIN_PW} characters.`);return;}
    if(pw!==cpw){setErr("Passwords do not match.");return;}
    setBusy(true);
    const {error}=await supabase.auth.updateUser({password:pw});
    if(error){setBusy(false);setErr(error.message);return;}
    // Recovery session has served its purpose — sign out so the seller logs in
    // fresh with the new password.
    await supabase.auth.signOut();
    setBusy(false);
    setDone(true);
  }
  return(
    <div className="auth-page">
      <div className="auth-card" style={{maxWidth:460}}>
        <h2>Set New Password</h2>
        {done?(<>
          <div className="auth-ok">Password updated! Please log in.</div>
          <button type="button" className="auth-btn" style={{marginTop:12}} onClick={onDone}>Go to login</button>
        </>):(<>
          <p className="auth-sub">Choose a new password for your SellerFlowLive account.</p>
          <form onSubmit={submit} className="auth-form">
            {err&&<div className="auth-err">Warning: {err}</div>}
            <Fg label="Set New Password"><div className="pw-wrap"><input type={showPw?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)} placeholder={`At least ${MIN_PW} characters`} autoFocus autoComplete="new-password"/><button type="button" onClick={()=>setShowPw(p=>!p)} className="pw-eye" aria-label={showPw?"Hide password":"Show password"} title={showPw?"Hide password":"Show password"}>{showPw?PwEyeOffIcon:PwEyeIcon}</button></div></Fg>
            <Fg label="Confirm New Password"><div className="pw-wrap"><input type={showCpw?"text":"password"} value={cpw} onChange={e=>setCpw(e.target.value)} placeholder="Re-enter new password" autoComplete="new-password"/><button type="button" onClick={()=>setShowCpw(p=>!p)} className="pw-eye" aria-label={showCpw?"Hide password":"Show password"} title={showCpw?"Hide password":"Show password"}>{showCpw?PwEyeOffIcon:PwEyeIcon}</button></div></Fg>
            {mismatch&&<div className="auth-err">Passwords do not match.</div>}
            <button type="submit" className="auth-btn" disabled={!canSubmit}>{busy?"Updating...":"Update Password"}</button>
          </form>
        </>)}
      </div>
    </div>
  );
}

function AccountGate({user,onContinue,onSwitch,t}:{user:User;onContinue:()=>void;onSwitch:()=>void;t:T}){
  return(
    <div className="auth-page">
      <div className="auth-card" style={{maxWidth:460}}>
        <div className="auth-brand">
          <div className="logo-ic"><svg width="16" height="16" viewBox="0 0 18 18"><path d="M4 6 Q4 3 7 3 L11 3 Q14 3 14 6 Q14 9 11 9.5 L7 10.5 Q4 10.5 4 13 Q4 15 7 15 L11 15 Q14 15 14 13" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg></div>
          <span>Seller<span>FlowLive</span></span>
        </div>
        <h2>{t.gate_choose_account}</h2>
        <p className="auth-sub">{t.gate_choose_sub}</p>
        <div className="pd-hd" style={{border:"1px solid #E4DED2",borderRadius:8,margin:"14px 0",padding:12}}>
          <div className="pd-av">{ini(user.profile.fullName||user.email)}</div>
          <div>
            <div className="pd-name">{user.profile.fullName||user.email}</div>
            <div className="pd-role">{user.email} · {pName(user.plan,TRANSLATIONS.en)}</div>
          </div>
        </div>
        <button type="button" className="auth-btn" onClick={onContinue}>{t.gate_continue}</button>
        <button type="button" className="auth-link" style={{width:"100%",marginTop:14,textAlign:"center"}} onClick={onSwitch}>{t.gate_use_another}</button>
      </div>
    </div>
  );
}

function TrialExpiredWall({t,onUpgrade}:{t:T;onUpgrade:()=>void}){
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(30,20,80,0.95)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999,flexDirection:"column",gap:20,padding:24}}>
      <div style={{fontSize:56}}>⏰</div>
      <h2 style={{color:"#fff",fontSize:24,textAlign:"center"}}>{t.trial_expired_title}</h2>
      <p style={{color:"rgba(255,255,255,0.75)",textAlign:"center",maxWidth:400,lineHeight:1.6}}>{t.trial_expired_msg}</p>
      <button onClick={onUpgrade} style={{padding:"14px 32px",background:"#7F77DD",color:"#fff",border:"none",borderRadius:10,fontSize:16,cursor:"pointer",fontWeight:600}}>{t.upgrade_btn}</button>
    </div>
  );
}

function PendingApprovalWall({user,onLogout,t}:{user:User;onLogout:()=>void;t:T}){
  return(
    <div className="pending-approval">
      <div className="pending-card">
        <h2>{t.pending_title}</h2>
        <p>{t.pending_msg1}</p>
        <p><strong>{t.pending_almost_ready}</strong> {t.pending_access_after}</p>
        <p>{user.email}<br/>{user.profile.phone}</p>
        <div className="pending-actions">
          <button className="btn-out" onClick={onLogout}>{t.sign_out}</button>
          <button className="auth-btn" onClick={()=>window.location.reload()}>{t.pending_refresh}</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SUBSCRIPTION PAGE
// ═══════════════════════════════════════════════════════════════════
function LegalPage({kind,onBack}:{kind:"privacy"|"terms";onBack:()=>void}){
  const isPrivacy=kind==="privacy";
  const title=isPrivacy?"Privacy Policy":"Terms of Service";
  const subtitle=isPrivacy
    ?"How SellerFlowLive collects, uses, protects, and deletes account information."
    :"The rules for using SellerFlowLive as a live selling order and printing system.";
  const sections=isPrivacy?[
    {h:"Information we collect",p:"SellerFlowLive stores account details, shop profile, registered TikTok or Facebook accounts, settings, live comments, buyer/customer records, orders, support messages, and payment proof files you submit."},
    {h:"How we use information",p:"We use this data to run the live comment feed, create orders, print slips, remember customers, manage subscriptions, answer support messages, and help admins protect seller accounts."},
    {h:"Storage and service providers",p:"Data may be saved in the browser on the seller device and in our Supabase database. Hosting, database, live connection, and printing tools may process data only to provide SellerFlowLive."},
    {h:"Sharing",p:"We do not sell seller or buyer data. We only share data when needed to operate the app, comply with law, prevent abuse, or support a seller request."},
    {h:"Seller responsibility",p:"Sellers should only enter buyer information needed for orders and should follow their local privacy, tax, and selling rules."},
    {h:"Delete account",p:"You can request deletion inside SellerFlowLive from Profile > Delete Account. Deleting removes the seller login and support messages for that email where possible. Some order or payment records may be retained when required for business, security, or legal reasons."},
    {h:"Contact",p:"For privacy requests, contact SellerFlowLive through sellerflowlive.com."},
  ]:[
    {h:"Service purpose",p:"SellerFlowLive helps live sellers collect comments, create buyer numbers, manage orders, print slips, track customers, and communicate with admin support."},
    {h:"Account rules",p:"You are responsible for keeping your login private. Registered TikTok and Facebook accounts may be locked based on your plan and can be changed by admin when needed."},
    {h:"Subscriptions",p:"Plan access, expiry dates, account limits, payment approval, and support handling are managed by the SellerFlowLive admin account."},
    {h:"Printing and live connections",p:"SellerFlowLive provides printing and live comment tools, but browser, printer, network, TikTok, and Facebook changes can affect availability. Sellers should test the printer before selling."},
    {h:"Seller responsibility",p:"Sellers are responsible for products, prices, order accuracy, customer communication, refunds, taxes, and following platform rules."},
    {h:"Acceptable use",p:"Do not use SellerFlowLive for fraud, spam, illegal products, abuse, unauthorized data collection, or attempts to break the app or other seller accounts."},
    {h:"Changes and contact",p:"We may update these terms as SellerFlowLive improves. Questions can be sent through sellerflowlive.com."},
  ];
  return(
    <div className="subpage legal-page">
      <div className="subpage-hd legal-hd">
        <button className="btn-out" onClick={onBack}>Back</button>
        <div><h2>{title}</h2><p>Last updated: May 18, 2026</p></div>
      </div>
      <div className="scard legal-card">
        <h3>{title}</h3>
        <p className="legal-lead">{subtitle}</p>
        {sections.map(s=>(
          <section key={s.h} className="legal-section">
            <h4>{s.h}</h4>
            <p>{s.p}</p>
          </section>
        ))}
      </div>
    </div>
  );
}

function DeleteAccountPage({user,onDelete,onCancel}:{user:User;onDelete:()=>Promise<void>;onCancel:()=>void}){
  const [confirm,setConfirm]=useState("");
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const canDelete=confirm.trim().toLowerCase()===user.email.toLowerCase();
  async function submit(e:React.FormEvent){
    e.preventDefault();
    if(!canDelete)return;
    setBusy(true);setErr("");
    try{await onDelete();}
    catch(error){setErr(error instanceof Error?error.message:"Delete failed. Please try again.");setBusy(false);}
  }
  return(
    <div className="subpage delete-page">
      <div className="subpage-hd legal-hd">
        <button className="btn-out" onClick={onCancel}>Back</button>
        <div><h2>Delete Account</h2><p>Remove this seller login from SellerFlowLive.</p></div>
      </div>
      <form className="scard delete-card" onSubmit={submit}>
        <h3>Before deleting</h3>
        <p>This will delete the seller account for <b>{user.email}</b>, sign out this browser, and remove support messages for this email where possible.</p>
        <p>Order, buyer, payment, audit, or legal records may be kept if needed for business history, security, or law.</p>
        <label className="danger-label">Type your email to confirm</label>
        <input className="danger-input" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder={user.email}/>
        {err&&<div className="auth-err">Warning: {err}</div>}
        <div className="delete-actions">
          <button type="button" className="btn-out" onClick={onCancel}>Cancel</button>
          <button type="submit" className="danger-btn" disabled={!canDelete||busy}>{busy?"Deleting...":"Delete my account"}</button>
        </div>
      </form>
    </div>
  );
}

function SubPage({user,t}:{user:User;onActivate:(plan:Plan,status:PlanStatus,expiry:string)=>void;t:T}){
  const [sel,setSel]=useState<Plan|null>(null);
  const [showPay,setShowPay]=useState(false);
  const [done,setDone]=useState(false);
  const [planMonths,setPlanMonths]=useState<Record<Exclude<Plan,"free"|"trial">,number>>({basic:1,pro:1,master:1});
  const days=dLeft(user.planExpiry);
  const paidPlanPrices:Record<Exclude<Plan,"free"|"trial">,number>={basic:15,pro:25,master:40};
  const monthOptions=Array.from({length:12},(_,i)=>i+1);
  const plans=[
    {id:"basic" as Plan,name:t.plan_basic,basePrice:15,period:t.plan_month,color:"#A855F7",desc:t.sub_basic_desc,features:t.sub_basic_features,bestFor:t.sub_basic_best,action:t.sub_basic_action},
    {id:"pro" as Plan,name:t.plan_pro,basePrice:25,period:t.plan_month,color:"#A855F7",badge:t.plan_popular,desc:t.sub_pro_desc,features:t.sub_pro_features,bestFor:t.sub_pro_best,action:t.sub_pro_action},
    {id:"master" as Plan,name:t.plan_master,basePrice:40,period:t.plan_month,color:"#A855F7",desc:t.sub_master_desc,features:t.sub_master_features,bestFor:t.sub_master_best,action:t.sub_master_action},
  ] as const;
  const selectedPaidPlan=sel&&sel!=="trial"?sel:null;
  const selectedMonths=selectedPaidPlan?planMonths[selectedPaidPlan]:1;
  const selectedTotal=selectedPaidPlan?paidPlanPrices[selectedPaidPlan]*selectedMonths:0;
  const updateMonths=(plan:Exclude<Plan,"free"|"trial">,months:number)=>setPlanMonths(current=>({...current,[plan]:months}));

  function handleSelect(plan:Plan){
    setSel(plan);setDone(false);
    // Only paid plans are selectable here; Free is the default tier (no purchase).
    setShowPay(true);
  }
  return(
    <div className="subpage">
      <div className="subpage-hd"><div><h2>{t.sub_plans_title}</h2><p>{t.plan_current}: <Badge label={pName(user.plan,t)} color={pColor(user.plan)}/> · {days>0?`${days} ${t.days_remaining}`:t.expired_label}</p></div></div>
      {done&&<div className="auth-ok" style={{marginBottom:8}}>✓ {t.plan_activated}</div>}

      <div className="plans-grid">
        {plans.map(p=>(
          <div key={p.id} className={`plan-card ${sel===p.id?"sel":""} ${user.plan===p.id?"cur":""}`} onClick={()=>handleSelect(p.id)}>
            {"badge" in p&&p.badge&&<div className="plan-badge">{p.badge}</div>}
            {user.plan===p.id&&<div className="plan-cur-badge">{t.plan_current}</div>}
            <div className="plan-name">{p.name}</div>
            <div className="plan-price">
              <span className="plan-amt">{p.id==="trial"?"$0":`$${p.basePrice*planMonths[p.id]}`}</span>
              <span className="plan-period">{p.id==="trial"?p.period:`/${planMonths[p.id]} ${planMonths[p.id]===1?t.sub_month:t.sub_months}`}</span>
            </div>
            {p.id!=="trial"&&(
              <div className="plan-duration" onClick={e=>e.stopPropagation()}>
                <label>{t.sub_duration}</label>
                <select value={planMonths[p.id as Exclude<Plan,"free"|"trial">]} onChange={e=>updateMonths(p.id as Exclude<Plan,"free"|"trial">,Number(e.target.value))}>
                  {monthOptions.map(month=><option key={month} value={month}>{month} {month===1?t.sub_month:t.sub_months}</option>)}
                </select>
                <span>${p.basePrice}{t.plan_month}</span>
              </div>
            )}
            <div className="plan-desc minimal">{p.desc}</div>
            <ul className="plan-feature-list">{p.features.map(f=><li key={f}>{f}</li>)}</ul>
            <div className="plan-best"><span>{t.sub_best_for}</span><b>{p.bestFor}</b></div>
            <div className="plan-sel-btn" style={sel===p.id&&user.plan!==p.id?{background:p.color,borderColor:p.color,color:"#fff"}:{borderColor:p.color,color:p.color}}>
              {user.plan===p.id?t.plan_current:sel===p.id?t.plan_selected:p.action}
            </div>
          </div>
        ))}
      </div>

      {showPay&&sel&&sel!=="trial"&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShowPay(false)}>
          <div className="modal" style={{maxWidth:480}}>
            <div className="modal-hd"><span>{t.payment_title}</span><button onClick={()=>setShowPay(false)} className="modal-x">×</button></div>
            <div className="modal-body" style={{gap:10}}>
              <div className="payment-box">
                <p style={{marginBottom:10,color:"#5F5E5A"}}>{t.payment_info}</p>
                <div className="payment-summary">
                  <strong>{pName(sel,t)} - {selectedMonths} {selectedMonths===1?t.sub_month:t.sub_months}</strong>
                  <span>{t.sub_total_to_pay} ${selectedTotal}</span>
                </div>
                <div className="payment-detail"><span>👤</span><span>{t.payment_account}</span></div>
                <div className="payment-detail"><span>🔢</span><span>{t.payment_number}</span></div>
                <div className="payment-detail"><span>🏦</span><span>{t.payment_bank}</span></div>
                <div className="payment-detail"><span>🏛</span><span>{t.payment_name}</span></div>
                <div style={{marginTop:10,padding:"8px 12px",background:"#FFF8E1",borderRadius:8,fontSize:12,color:"#633806",lineHeight:1.5}}>{t.payment_note}</div>
              </div>
              <a
                href={TELEGRAM_URL}
                target="_blank"
                rel="noreferrer noopener"
                onClick={()=>setShowPay(false)}
                className="btn-purple"
                style={{width:"100%",padding:"10px 0",display:"block",textAlign:"center",textDecoration:"none",boxSizing:"border-box"}}
              >{t.payment_btn}</a>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════════════
function Products({cur,t}:{cur:string;t:T}){
  const def=[{id:1,name:"Red dress, size M",sku:"RD-M-001",price:350,stock:24,platform:"TikTok / FB",status:"Active"},{id:2,name:"Blue blouse, size XL",sku:"BB-XL-003",price:380,stock:8,platform:"TikTok",status:"Active"},{id:3,name:"Green top, size S",sku:"GT-S-007",price:250,stock:3,platform:"FB Live",status:"Low stock"},{id:4,name:"White sneakers sz 38",sku:"WS-38-012",price:890,stock:0,platform:"TikTok",status:"Out of stock"},{id:5,name:"Floral skirt, size L",sku:"FS-L-009",price:420,stock:15,platform:"TikTok / FB",status:"Active"}];
  const [prods,setProds]=useState<Product[]>(()=>LS.get("sf_prods",def));
  const [show,setShow]=useState(false);const [eid,setEid]=useState<number|null>(null);
  const [form,setForm]=useState({name:"",sku:"",price:"",stock:"",platform:"TikTok"});
  const [toast,setToast]=useState("");const [q,setQ]=useState("");
  const save=(p:Product[])=>{setProds(p);LS.set("sf_prods",p);};
  const stat=(s:number)=>s===0?"Out of stock":s<=5?"Low stock":"Active";
  const statusLabel=(s:string):string=>s==="Active"?t.in_stock:s==="Low stock"?t.low_stock:t.out_of_stock;
  const openAdd=()=>{setForm({name:"",sku:"",price:"",stock:"",platform:"TikTok"});setEid(null);setShow(true);};
  const openEdit=(p:Product)=>{setForm({name:p.name,sku:p.sku,price:String(p.price),stock:String(p.stock),platform:p.platform});setEid(p.id);setShow(true);};
  const del=(id:number)=>{if(!confirm(t.confirm_delete))return;save(prods.filter(p=>p.id!==id));setToast(t.product_deleted);};
  const submit=(e:React.FormEvent)=>{
    e.preventDefault();
    const price=parseFloat(form.price)||0,stock=parseInt(form.stock)||0,status=stat(stock);
    if(eid!==null){save(prods.map(p=>p.id===eid?{...p,name:form.name,sku:form.sku,price,stock,platform:form.platform,status}:p));setToast(t.product_updated);}
    else{save([...prods,{id:Date.now(),name:form.name,sku:form.sku,price,stock,platform:form.platform,status}]);setToast(t.product_added);}
    setShow(false);
  };
  const filtered=prods.filter(p=>p.name.toLowerCase().includes(q.toLowerCase())||p.sku.toLowerCase().includes(q.toLowerCase()));
  return(
    <div className="subpage">
      {toast&&<Toast msg={toast} onDone={()=>setToast("")}/>}
      <div className="subpage-hd">
        <div><h2>{t.nav_products}</h2><p>{t.products_sub}</p></div>
        <div style={{display:"flex",gap:8}}>
          <button className="btn-out" onClick={()=>csvDL("products.csv",[t.product_name,t.sku_label,t.price_label,t.stock_label,t.platform_label,t.status_col],prods.map(p=>[p.name,p.sku,p.price,p.stock,p.platform,p.status]))}>⬇ {t.export_csv}</button>
          <button className="btn-purple" onClick={openAdd}>+ {t.add_product}</button>
        </div>
      </div>
      <div className="grid4">
        <div className="mstat"><div className="ms-l">{t.total_label}</div><div className="ms-v">{prods.length}</div></div>
        <div className="mstat"><div className="ms-l">{t.in_stock}</div><div className="ms-v" style={{color:"#1D9E75"}}>{prods.filter(p=>p.status==="Active").length}</div></div>
        <div className="mstat"><div className="ms-l">{t.low_stock}</div><div className="ms-v" style={{color:"#BA7517"}}>{prods.filter(p=>p.status==="Low stock").length}</div></div>
        <div className="mstat"><div className="ms-l">{t.out_of_stock}</div><div className="ms-v" style={{color:"#A32D2D"}}>{prods.filter(p=>p.status==="Out of stock").length}</div></div>
      </div>
      <input placeholder={t.search_products} value={q} onChange={e=>setQ(e.target.value)} className="search-inp" style={{maxWidth:280}}/>
      {show&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setShow(false)}>
          <div className="modal" style={{maxWidth:480}}>
            <div className="modal-hd"><span>{eid!==null?t.edit_product:t.add_product}</span><button onClick={()=>setShow(false)} className="modal-x">×</button></div>
            <form onSubmit={submit} className="modal-body">
              <div className="auth-row2">
                <Fg label={t.product_name}><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} required/></Fg>
                <Fg label={t.sku_label}><input value={form.sku} onChange={e=>setForm(f=>({...f,sku:e.target.value}))}/></Fg>
              </div>
              <div className="auth-row2">
                <Fg label={`${t.price_label} (${cur})`}><input type="number" value={form.price} onChange={e=>setForm(f=>({...f,price:e.target.value}))} min="0" required/></Fg>
                <Fg label={t.stock_label}><input type="number" value={form.stock} onChange={e=>setForm(f=>({...f,stock:e.target.value}))} min="0" required/></Fg>
              </div>
              <Fg label={t.platform_label}><select value={form.platform} onChange={e=>setForm(f=>({...f,platform:e.target.value}))}><option>TikTok</option><option>Facebook</option><option>TikTok / FB</option></select></Fg>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
                <button type="button" className="btn-out" onClick={()=>setShow(false)}>{t.cancel_btn}</button>
                <button type="submit" className="btn-purple">{t.save_btn}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      <div className="table-card">
        <table className="tbl">
          <thead><tr><th>{t.product_name}</th><th>{t.sku_label}</th><th>{t.price_label}</th><th>{t.stock_label}</th><th>{t.platform_label}</th><th>{t.status_col}</th><th></th></tr></thead>
          <tbody>
            {filtered.length===0&&<tr><td colSpan={7} style={{textAlign:"center",padding:32,color:"#888"}}>{t.no_products}</td></tr>}
            {filtered.map(p=>(
              <tr key={p.id}>
                <td><strong>{p.name}</strong></td>
                <td className="mono muted">{p.sku}</td>
                <td>{cur}{p.price.toLocaleString()}</td>
                <td style={{color:p.stock===0?"#A32D2D":p.stock<=5?"#BA7517":"inherit",fontWeight:p.stock===0?700:400}}>{p.stock}</td>
                <td>{p.platform}</td>
                <td><Badge label={statusLabel(p.status)} color={p.status==="Active"?"green":p.status==="Low stock"?"amber":"red"}/></td>
                <td><div style={{display:"flex",gap:5}}><button onClick={()=>openEdit(p)} className="tbl-btn ed">{t.edit_btn}</button><button onClick={()=>del(p.id)} className="tbl-btn dl">{t.delete_btn}</button></div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════════════════════════
function Orders({orders,setOrders,onPersist,cur,t}:{orders:LiveOrder[];setOrders:(o:LiveOrder[])=>void;onPersist?:(orders:LiveOrder[])=>void;cur:string;t:T}){
  const [filt,setFilt]=useState("all");const [q,setQ]=useState("");
  const filtered=orders.filter(o=>(filt==="all"||o.status.toLowerCase()===filt)&&(o.handle.includes(q)||o.item.toLowerCase().includes(q.toLowerCase())||o.name.toLowerCase().includes(q.toLowerCase())));
  const upStat=(i:number,s:string)=>{const u=orders.map((o,idx)=>idx===i?{...o,status:s}:o);setOrders(u);onPersist?.(u);};
  const c={all:orders.length,new:orders.filter(o=>o.status==="New").length,printed:orders.filter(o=>o.status==="Printed").length,waiting:orders.filter(o=>o.status==="Waiting").length};
  return(
    <div className="subpage">
      <div className="subpage-hd">
        <div><h2>{t.nav_orders}</h2><p>{t.orders_sub}</p></div>
        <button className="btn-out" onClick={()=>csvDL(`orders-${new Date().toISOString().slice(0,10)}.csv`,[t.order_num,"#",t.customer_col,t.item_col,t.qty_col,t.total_col,t.platform_label,t.time_col,t.status_col],filtered.map(o=>[`#SF${o.orderNum}`,o.bNum,`@${o.handle}`,o.item,o.qty,`${cur}${o.total}`,o.platform,o.time,o.status]))}>⬇ {t.export_csv}</button>
      </div>
      <div className="grid4">
        <div className="mstat"><div className="ms-l">{t.orders_stat}</div><div className="ms-v">{c.all}</div></div>
        <div className="mstat"><div className="ms-l">{t.filter_new}</div><div className="ms-v" style={{color:"#534AB7"}}>{c.new}</div></div>
        <div className="mstat"><div className="ms-l">{t.filter_printed}</div><div className="ms-v" style={{color:"#1D9E75"}}>{c.printed}</div></div>
        <div className="mstat"><div className="ms-l">{t.revenue_stat}</div><div className="ms-v" style={{fontSize:18,color:"#1D9E75"}}>{cur}{orders.reduce((s,o)=>s+o.total,0).toLocaleString()}</div></div>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
        <div className="filter-tabs">
          {([["all",t.filter_all],[""+ c.new,t.filter_new],["printed",t.filter_printed],["waiting",t.filter_waiting]] as [string,string][]).map(([,l],i)=>{
            const key=["all","new","printed","waiting"][i];
            return <button key={key} onClick={()=>setFilt(key)} className={`ftab ${filt===key?"on":""}`}>{l} ({c[key as keyof typeof c]??c.all})</button>;
          })}
        </div>
        <input placeholder={t.orders_search_ph} value={q} onChange={e=>setQ(e.target.value)} className="search-inp" style={{marginLeft:"auto",maxWidth:180}}/>
      </div>
      <div className="table-card">
        <table className="tbl">
          <thead><tr><th>{t.order_num}</th><th>#</th><th>{t.customer_col}</th><th>{t.item_col}</th><th>{t.qty_col}</th><th>{t.total_col}</th><th>{t.platform_label}</th><th>{t.time_col}</th><th>{t.status_col}</th></tr></thead>
          <tbody>
            {filtered.length===0&&<tr><td colSpan={9} style={{textAlign:"center",padding:32,color:"#888"}}>{t.no_orders_table}</td></tr>}
            {filtered.map((o,i)=>(
              <tr key={i}>
                <td className="mono muted">#SF{o.orderNum}</td>
                <td><div style={{width:24,height:24,borderRadius:"50%",background:nc(o.bNum),color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:700}}>{o.bNum}</div></td>
                <td><div style={{fontWeight:500}}>{o.name}</div><div style={{fontSize:10,color:"#7F77DD"}}>@{o.handle}</div></td>
                <td><strong>{o.item}</strong></td><td>{o.qty}</td>
                <td><strong>{cur}{o.total.toLocaleString()}</strong></td>
                <td><Badge label={o.platform} color={o.platform==="TikTok"?"purple":"green"}/></td>
                <td className="muted" style={{fontSize:11}}>{o.time}</td>
                <td><select value={o.status} onChange={e=>upStat(i,e.target.value)} className="stat-sel" style={{background:o.status==="Printed"?"#E1F5EE":o.status==="New"?"#EEEDFE":"#FAEEDA"}}><option value="New">{t.filter_new}</option><option value="Printed">{t.filter_printed}</option><option value="Waiting">{t.filter_waiting}</option></select></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SHIPPING — 7-ELEVEN MyShip, grouped per buyer with daily numbering
// ═══════════════════════════════════════════════════════════════════
// Each buyer = ONE shipment per day. Multiple orders for the same buyer in
// the same day land in the same shipment card and share one shipping fee.
// "Day" is Asia/Taipei calendar day (hardcoded TZ so midnight resets are
// consistent regardless of seller's device clock). After Export, today's
// open shipments auto-close; a same-day repeat buyer afterwards starts a
// new shipment with the next daily number (gaps in numbering are fine).
interface ShipOrder { id:string; product:string; price:string; }
interface Shipment {
  id:string;
  buyerUsername:string;
  dayId:string;
  num:number;
  name:string;
  phone:string;
  store:string;
  fee:string;
  status:"open"|"shipped";
  createdAt:string;
  orders:ShipOrder[];
}
const SHIP_MAX=500;
const SHIP_TEMP="常溫";
const SHIP_DEFAULT_FEE="38";
// Official 7-ELEVEN MyShip "Order Import Validation" header row, columns A–J.
// IMPORTANT: this must match the official template EXACTLY or 7-11 rejects the file.
const MYSHIP_HEADERS=["取件人姓名","取件人手機","取件門市","溫層","商品","訂單金額","運費金額","買家下訂日期","商品備註","其他資訊 (FB/LINE/IG帳號)"];


const shipmentsKey=(email:string)=>sellerDataKey("sf_shipments",email);
const shipmentsMigrationFlagKey=(email:string)=>sellerDataKey("sf_shipments_migrated",email);
// Legacy ephemeral key `sf_shipping:{email}` from the pre-redesign flat list
// is intentionally left untouched in localStorage as a recovery backup.

function nextDailyNum(list:Shipment[],dayId:string){
  return list.reduce((m,s)=>s.dayId===dayId&&s.num>m?s.num:m,0)+1;
}
function findOpenShipment(list:Shipment[],username:string,dayId:string){
  const u=username.trim().toLowerCase();
  return list.find(s=>s.dayId===dayId&&s.status==="open"&&s.buyerUsername.toLowerCase()===u)||null;
}
function shipmentSubtotal(s:Shipment){return s.orders.reduce((sum,o)=>sum+(Number(o.price)||0),0);}
function shipmentGrandTotal(s:Shipment){return shipmentSubtotal(s)+(Number(s.fee)||0);}

// One-time migration helper. SAFETY: auto-import is intentionally disabled —
// the legacy `sf_shipping:{email}` ephemeral list could surface unexpected
// rows as TODAY's shipments for an active user, which would confuse them.
// The legacy key is preserved untouched as a backup; if a user needs to
// recover pending pre-merge work, read `sf_shipping:{seller}` in DevTools
// and re-enter manually. Setting the flag here prevents any future
// auto-import attempt even if this function is re-enabled later.
function migrateLegacyShipping(email:string):Shipment[]{
  try{
    const flagKey=shipmentsMigrationFlagKey(email);
    if(!LS.get<boolean>(flagKey,false))LS.set(flagKey,true);
  }catch{/* localStorage unavailable — fail silent, defaults still work */}
  return [];
}

// Defensive shape check: silently skip any corrupted localStorage rows
// (partial writes, manual edits, stale schemas) instead of crashing the page.
function isValidShipment(s:unknown):s is Shipment{
  if(!s||typeof s!=="object")return false;
  const r=s as Partial<Shipment>;
  return typeof r.id==="string"
    && typeof r.buyerUsername==="string"
    && typeof r.dayId==="string"
    && typeof r.num==="number"
    && typeof r.name==="string"
    && typeof r.phone==="string"
    && typeof r.store==="string"
    && typeof r.fee==="string"
    && (r.status==="open"||r.status==="shipped")
    && Array.isArray(r.orders);
}

function Shipping({user,t}:{user:User;t:T}){
  const sKey=shipmentsKey(user.email);
  const [shipments,setShipments]=useState<Shipment[]>(()=>{
    try{
      migrateLegacyShipping(user.email);
      return arrLS<Shipment>(sKey).filter(isValidShipment);
    }catch(e){
      console.warn("[Shipping] init failed, starting empty:",e);
      return [];
    }
  });
  const [customers]=useState<ShippingCustomer[]>(()=>arrLS<ShippingCustomer>(custDataKey(user.email)).filter(c=>c.name.trim()&&c.phone.trim()&&/^\d{6}$/.test(c.sevenCode.trim())));
  const [sel,setSel]=useState("");
  const [product,setProduct]=useState("CLOTHING");
  const [price,setPrice]=useState("");
  const [err,setErr]=useState("");
  const [msg,setMsg]=useState("");
  const [editing,setEditing]=useState<{shipmentId:string;orderId:string;value:string}|null>(null);
  const today=taipeiDayId();

  const todayShipments=shipments.filter(s=>s.dayId===today);
  const openToday=todayShipments.filter(s=>s.status==="open");
  const shippedToday=todayShipments.filter(s=>s.status==="shipped");
  const selected=customers.find(c=>c.username===sel)||null;
  const existingForSelected=selected?findOpenShipment(shipments,selected.username,today):null;

  const persist=(next:Shipment[])=>{setShipments(next);LS.set(sKey,next);};

  function addOrder(e:React.FormEvent){
    e.preventDefault();
    setErr("");setMsg("");
    if(!selected){setErr(t.ship_select_customer_first);return;}
    const pr=product.trim(),pc=price.trim();
    if(!pr){setErr(t.ship_product_required);return;}
    if(pc===""||isNaN(Number(pc))||Number(pc)<0){setErr(t.ship_invalid_price);return;}
    const existing=findOpenShipment(shipments,selected.username,today);
    if(!existing && openToday.length>=SHIP_MAX){
      setErr(`${t.ship_limit_reached} (${SHIP_MAX})`);return;
    }
    let next:Shipment[];
    if(existing){
      next=shipments.map(s=>s.id===existing.id
        ? {...s,
           name:selected.name,phone:selected.phone,store:selected.sevenCode,
           orders:[...s.orders,{id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,product:pr,price:pc}]}
        : s);
      setMsg(`${t.ship_added_to_existing} #${existing.num} ${selected.name}.`);
    }else{
      const num=nextDailyNum(shipments,today);
      const newShipment:Shipment={
        id:`${Date.now()}-${Math.random().toString(36).slice(2,7)}`,
        buyerUsername:selected.username,
        dayId:today,num,
        name:selected.name,phone:selected.phone,store:selected.sevenCode,
        fee:SHIP_DEFAULT_FEE,status:"open",
        createdAt:new Date().toISOString(),
        orders:[{id:`${Date.now()+1}-${Math.random().toString(36).slice(2,7)}`,product:pr,price:pc}],
      };
      next=[...shipments,newShipment];
      setMsg(`${t.ship_created_new} #${num} ${selected.name}.`);
    }
    persist(next);
    setSel("");setPrice("");
  }

  function deleteOrder(shipmentId:string,orderId:string){
    if(!window.confirm(t.ship_delete_confirm))return;
    let next=shipments.map(s=>s.id===shipmentId?{...s,orders:s.orders.filter(o=>o.id!==orderId)}:s);
    // Auto-remove the whole shipment if its last order was deleted (Q4).
    // Daily number stays consumed — gaps in numbering are intentional and fine.
    next=next.filter(s=>!(s.id===shipmentId&&s.orders.length===0));
    persist(next);
    setMsg("");setErr("");
  }

  function startEdit(shipmentId:string,orderId:string,current:string){
    setEditing({shipmentId,orderId,value:current});
    setErr("");
  }
  function saveEdit(){
    if(!editing)return;
    const v=editing.value.trim();
    if(v===""||isNaN(Number(v))||Number(v)<0){setErr(t.ship_invalid_price);return;}
    const next=shipments.map(s=>s.id===editing.shipmentId?{...s,orders:s.orders.map(o=>o.id===editing.orderId?{...o,price:v}:o)}:s);
    persist(next);
    setEditing(null);
    setMsg(t.ship_amount_updated);
    setErr("");
  }
  function cancelEdit(){setEditing(null);setErr("");}

  function updateFee(shipmentId:string,fee:string){
    const cleaned=fee.replace(/[^\d.]/g,"");
    persist(shipments.map(s=>s.id===shipmentId?{...s,fee:cleaned}:s));
  }

  async function exportXlsx(){
    setErr("");setMsg("");
    if(!openToday.length){setErr(t.ship_no_open_to_export);return;}
    if(openToday.some(s=>!s.name.trim())){setErr(t.ship_export_no_name);return;}
    try{
      const XLSX=await import("xlsx");
      // One row per shipment: summed product price + single shipping fee.
      // Product column joins multiple product names with " / " (manual review possible before send).
      const rows=openToday.map(s=>[
        s.name,
        s.phone,
        s.store,
        SHIP_TEMP,
        s.orders.map(o=>o.product).filter(Boolean).join(" / ")||s.orders[0]?.product||"",
        shipmentSubtotal(s),
        Number(s.fee)||0,
        "","",""
      ]);
      const ws=XLSX.utils.aoa_to_sheet([MYSHIP_HEADERS,...rows]);
      const wb=XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb,ws,"Sheet1");
      XLSX.writeFile(wb,`myship-${today}.xlsx`);
      // Auto-close (Q3): all of today's OPEN shipments become "shipped".
      // Any same-buyer order after this gets a fresh shipment + new daily #.
      const ids=new Set(openToday.map(s=>s.id));
      persist(shipments.map(s=>ids.has(s.id)?{...s,status:"shipped" as const}:s));
      setMsg(`${t.ship_exported} ${openToday.length} ${openToday.length===1?t.ship_buyer_singular:t.ship_buyer_plural}.`);
    }catch(error){
      setErr(`${t.ship_export_failed} ${error instanceof Error?error.message:t.ship_unknown_error}`);
    }
  }

  const moneyFmt=(n:number)=>`NT$${(n||0).toLocaleString()}`;
  const sortedToday=[...todayShipments].sort((a,b)=>a.num-b.num);

  return(
    <div className="subpage">
      <div className="subpage-hd">
        <div>
          <h2>{t.nav_shipping}</h2>
          <p>{t.ship_subtitle}</p>
        </div>
        <button className="btn-out" onClick={exportXlsx} disabled={!openToday.length}>⬇ {t.ship_export_excel}</button>
      </div>
      <div className="grid4">
        <div className="mstat"><div className="ms-l">{t.ship_open_shipments}</div><div className="ms-v">{openToday.length}</div></div>
        <div className="mstat"><div className="ms-l">{t.ship_shipped_today}</div><div className="ms-v" style={{color:"#1D9E75"}}>{shippedToday.length}</div></div>
        <div className="mstat"><div className="ms-l">{t.ship_next_num}</div><div className="ms-v">#{nextDailyNum(shipments,today)}</div></div>
        <div className="mstat"><div className="ms-l">{t.ship_remaining}</div><div className="ms-v" style={{color:openToday.length>=SHIP_MAX?"#A32D2D":"#1D9E75"}}>{SHIP_MAX-openToday.length}</div></div>
      </div>

      <div className="table-card" style={{padding:16,marginTop:12}}>
        {customers.length===0?(
          <p style={{margin:0,color:"#888",fontSize:13}}>{t.ship_no_registered_customers}</p>
        ):(
        <form onSubmit={addOrder}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:12}}>
            <Fg label={`${t.ship_customer_field} *`}>
              <select value={sel} onChange={e=>{setSel(e.target.value);setMsg("");setErr("");}}>
                <option value="">{t.ship_select_customer_placeholder}</option>
                {customers.map(c=><option key={c.username} value={c.username}>@{c.username} — {c.name}</option>)}
              </select>
            </Fg>
            <Fg label={`${t.ship_product_field} 商品 *`}><input value={product} onChange={e=>setProduct(e.target.value)} placeholder="CLOTHING"/></Fg>
            <Fg label={`${t.ship_amount_field} 訂單金額 *`}><input value={price} onChange={e=>setPrice(e.target.value.replace(/[^\d.]/g,""))} inputMode="decimal" placeholder="0"/></Fg>
          </div>
          {selected && (existingForSelected
            ? <div style={{marginTop:10,fontSize:12,color:"#1D9E75"}}>+ {t.ship_will_append} #{existingForSelected.num} ({existingForSelected.orders.length} {existingForSelected.orders.length===1?t.ship_order_singular:t.ship_order_plural})</div>
            : <div style={{marginTop:10,fontSize:12,color:"#666"}}>{t.ship_will_create} #{nextDailyNum(shipments,today)} — <strong>{selected.name}</strong> · {selected.phone} · 7/11 {selected.sevenCode}</div>
          )}
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:12,flexWrap:"wrap"}}>
            <button type="submit" className="btn-purple">+ {t.ship_add_order_btn}</button>
            <span style={{fontSize:11,color:"#888"}}>{t.ship_form_hint}</span>
          </div>
        </form>
        )}
        {err&&<p style={{color:"#A32D2D",fontSize:13,marginTop:10,marginBottom:0}}>{err}</p>}
        {msg&&!err&&<p style={{color:"#1D9E75",fontSize:13,marginTop:10,marginBottom:0}}>{msg}</p>}
      </div>

      <div style={{display:"flex",alignItems:"center",gap:8,marginTop:14}}>
        <strong style={{fontSize:13}}>{t.ship_today_label} ({todayShipments.length})</strong>
        <span style={{fontSize:11,color:"#888"}}>{today} · 溫層 {SHIP_TEMP}</span>
      </div>

      {todayShipments.length===0
        ? <div className="table-card" style={{padding:32,textAlign:"center",color:"#888",fontSize:13}}>{t.ship_no_open_shipments}</div>
        : (
          <div style={{display:"flex",flexDirection:"column",gap:10}}>
            {sortedToday.map(s=>{
              const isShipped=s.status==="shipped";
              return (
                <div key={s.id} className="table-card" style={{padding:14,opacity:isShipped?0.78:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
                    <div style={{fontSize:22,fontWeight:700,color:"#534AB7",minWidth:50,lineHeight:1}}>#{s.num}</div>
                    <div style={{flex:1,minWidth:200}}>
                      <div style={{fontWeight:600,fontSize:14}}>{s.name}</div>
                      <div style={{fontSize:11,color:"#888",fontFamily:"monospace",marginTop:2}}>{s.phone} · 7/11 {s.store}</div>
                    </div>
                    {isShipped && <span style={{background:"#E0E7FF",color:"#3730A3",padding:"3px 10px",borderRadius:999,fontSize:10,fontWeight:700,letterSpacing:.04}}>{t.ship_shipped_badge}</span>}
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:10,color:"#888",textTransform:"uppercase",letterSpacing:.04}}>{t.ship_total}</div>
                      <div style={{fontSize:17,fontWeight:700,color:"#1D9E75"}}>{moneyFmt(shipmentGrandTotal(s))}</div>
                    </div>
                  </div>

                  <div style={{marginTop:12,paddingTop:10,borderTop:"0.5px solid #E4E2DC"}}>
                    {s.orders.map((o,i)=>{
                      const isEditing=!isShipped && editing?.shipmentId===s.id && editing?.orderId===o.id;
                      return (
                        <div key={o.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 0",borderBottom:i<s.orders.length-1?"0.5px dashed #F0EFE9":"none",flexWrap:"wrap"}}>
                          <span style={{minWidth:18,color:"#888",fontSize:11}}>{i+1}.</span>
                          <span style={{flex:1,minWidth:120,fontSize:13}}>{o.product}</span>
                          {isEditing
                            ? <>
                                <input value={editing.value} onChange={e=>setEditing({...editing,value:e.target.value.replace(/[^\d.]/g,"")})} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();saveEdit();}if(e.key==="Escape"){cancelEdit();}}} inputMode="decimal" placeholder="0" style={{width:90,padding:"5px 8px",border:"1px solid #7F77DD",borderRadius:6,fontSize:13,textAlign:"right"}} autoFocus/>
                                <button type="button" className="tbl-btn ed" onClick={saveEdit}>{t.save_btn}</button>
                                <button type="button" className="tbl-btn" onClick={cancelEdit} style={{background:"#F5F5F2",color:"#666"}}>{t.cancel_btn}</button>
                              </>
                            : <>
                                <span style={{minWidth:80,textAlign:"right",fontSize:13,fontWeight:600,color:"#26215C"}}>{moneyFmt(Number(o.price)||0)}</span>
                                {!isShipped && <>
                                  <button type="button" className="tbl-btn ed" onClick={()=>startEdit(s.id,o.id,o.price)} title={t.ship_edit_amount}>✏️ {t.edit_btn}</button>
                                  <button type="button" className="tbl-btn dl" onClick={()=>deleteOrder(s.id,o.id)} title={t.delete_btn}>🗑 {t.delete_btn}</button>
                                </>}
                              </>
                          }
                        </div>
                      );
                    })}
                  </div>

                  <div style={{marginTop:10,paddingTop:8,borderTop:"0.5px solid #E4E2DC",display:"flex",alignItems:"center",justifyContent:"flex-end",gap:18,fontSize:12,color:"#666",flexWrap:"wrap"}}>
                    <div>{t.ship_subtotal}: <strong style={{color:"#26215C"}}>{moneyFmt(shipmentSubtotal(s))}</strong></div>
                    <div style={{display:"flex",alignItems:"center",gap:6}}>
                      {t.ship_fee} 運費:
                      {isShipped
                        ? <strong style={{color:"#26215C"}}>NT${s.fee||0}</strong>
                        : <input value={s.fee} onChange={e=>updateFee(s.id,e.target.value)} inputMode="decimal" placeholder="0" style={{width:70,padding:"4px 7px",border:"0.5px solid #D3D1C7",borderRadius:6,fontSize:12,textAlign:"right",background:"#fff",color:"#26215C"}}/>
                      }
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      }
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CUSTOMERS
// ═══════════════════════════════════════════════════════════════════
function Customers({buyers,cur,t}:{buyers:Buyer[];cur:string;t:T}){
  const [q,setQ]=useState("");
  const query=q.trim().toLowerCase();
  const filtered=buyers.filter(b=>{
    if(!query)return true;
    return b.name.toLowerCase().includes(query)
      || b.handle.toLowerCase().includes(query)
      || b.platform.toLowerCase().includes(query)
      || String(b.num).includes(query)
      || b.orders.some(o=>o.item.toLowerCase().includes(query)||o.time.toLowerCase().includes(query)||String(o.orderNum).includes(query));
  });
  return(
    <div className="subpage">
      <div className="subpage-hd">
        <div><h2>{t.nav_customers}</h2><p>{t.customers_sub}</p></div>
        <div style={{display:"flex",gap:8}}>
          <input placeholder={t.search_customers} value={q} onChange={e=>setQ(e.target.value)} className="search-inp" style={{maxWidth:200}}/>
          <button className="btn-out" onClick={()=>csvDL(`customers-${new Date().toISOString().slice(0,10)}.csv`,["#","Name","Username","Platform","Orders",`Total`],buyers.map(b=>[b.num,b.name,`@${b.handle}`,b.platform,b.totalOrders,`${cur}${b.totalSpent}`]))}>⬇ {t.export_csv}</button>
        </div>
      </div>
      <div className="grid4">
        <div className="mstat"><div className="ms-l">{t.buyers_stat}</div><div className="ms-v">{buyers.length}</div></div>
        <div className="mstat"><div className="ms-l">{t.tiktok_buyers}</div><div className="ms-v" style={{color:"#534AB7"}}>{buyers.filter(b=>b.platform==="TikTok").length}</div></div>
        <div className="mstat"><div className="ms-l">{t.fb_buyers}</div><div className="ms-v" style={{color:"#1D9E75"}}>{buyers.filter(b=>b.platform==="Facebook").length}</div></div>
        <div className="mstat"><div className="ms-l">{t.revenue_stat}</div><div className="ms-v" style={{fontSize:18,color:"#1D9E75"}}>{cur}{buyers.reduce((s,b)=>s+b.totalSpent,0).toLocaleString()}</div></div>
      </div>
      <div className="table-card">
        <table className="tbl">
          <thead><tr><th>#</th><th>Name</th><th>{t.username_col}</th><th>Platform</th><th>Orders</th><th>{t.total_spent}</th><th>{t.last_order}</th></tr></thead>
          <tbody>
            {filtered.length===0&&<tr><td colSpan={7} style={{textAlign:"center",padding:32,color:"#888"}}>{t.no_customers}</td></tr>}
            {filtered.map(b=>(
              <tr key={b.handle}>
                <td><div style={{width:26,height:26,borderRadius:"50%",background:nc(b.num),color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700}}>{b.num}</div></td>
                <td><div style={{display:"flex",alignItems:"center",gap:8}}><Av name={b.name} size={28}/><strong>{b.name}</strong></div></td>
                <td className="mono" style={{color:"#7F77DD"}}>@{b.handle}</td>
                <td><Badge label={b.platform} color={b.platform==="TikTok"?"purple":"green"}/></td>
                <td>{b.totalOrders}</td>
                <td><strong style={{color:"#534AB7"}}>{cur}{b.totalSpent.toLocaleString()}</strong></td>
                <td className="muted">{b.orders[0]?.time||"—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// PRINT
// ═══════════════════════════════════════════════════════════════════
function CustomerDataPage({user,t}:{user:User;t:T}){
  const key=custDataKey(user.email);
  const [records,setRecords]=useState<ShippingCustomer[]>(()=>arrLS<ShippingCustomer>(key));
  const [query,setQuery]=useState("");
  const [editUser,setEditUser]=useState<string|null>(null);
  const [form,setForm]=useState({username:"",name:"",phone:"",sevenCode:""});
  const [err,setErr]=useState("");
  const persist=(next:ShippingCustomer[])=>{setRecords(next);LS.set(key,next);};
  const regStatus=(r:ShippingCustomer):"Registered"|"Pending"|"Not Registered"=>
    (r.name.trim()&&r.phone.trim()&&/^\d{6}$/.test(r.sevenCode.trim()))?"Registered":(r.phone.trim()||r.sevenCode.trim())?"Pending":"Not Registered";
  const statusColor=(s:string):"green"|"amber"|"gray"=>s==="Registered"?"green":s==="Pending"?"amber":"gray";
  const statusLabel=(s:string):string=>s==="Registered"?t.cust_status_registered:s==="Pending"?t.cust_status_pending:t.cust_status_not_registered;
  const openEncode=(r:ShippingCustomer)=>{setEditUser(r.username);setForm({username:r.username,name:r.name,phone:r.phone,sevenCode:r.sevenCode});setErr("");};
  function saveEncode(e:React.FormEvent){
    e.preventDefault();
    const username=form.username.trim().replace(/^@/,""),name=form.name.trim(),phone=form.phone.trim(),sevenCode=form.sevenCode.trim();
    if(!username){setErr(t.cust_err_username_required);return;}
    if(records.some(r=>r.username!==editUser&&r.username.toLowerCase()===username.toLowerCase())){setErr(t.cust_err_username_dup);return;}
    if(!name){setErr(t.cust_err_name_required);return;}
    if(!phone){setErr(t.cust_err_phone_required);return;}
    if(!/^\d{6}$/.test(sevenCode)){setErr(t.cust_err_seven_code);return;}
    persist(records.map(r=>r.username===editUser?{...r,username,name,phone,sevenCode,isNew:false}:r));
    setEditUser(null);
  }
  const q=query.trim().toLowerCase();
  const filtered=records
    .filter(r=>!q||[r.username,r.name,r.phone,r.sevenCode].some(v=>v.toLowerCase().includes(q)))
    .sort((a,b)=>(a.num||0)-(b.num||0));
  const total=records.length;
  const registered=records.filter(r=>regStatus(r)==="Registered").length;
  const pending=records.filter(r=>regStatus(r)==="Pending").length;
  const needEncoding=records.filter(r=>regStatus(r)==="Not Registered").length;
  const editing=records.find(r=>r.username===editUser)||null;
  return(
    <div className="subpage">
      <div className="subpage-hd">
        <div><h2>{t.cust_data_title}</h2><p>{t.cust_data_sub}</p></div>
      </div>
      <div className="grid4">
        <div className="mstat"><div className="ms-l">{t.cust_total}</div><div className="ms-v">{total}</div></div>
        <div className="mstat"><div className="ms-l">{t.cust_unique_registered}</div><div className="ms-v" style={{color:"#1D9E75"}}>{registered}</div></div>
        <div className="mstat"><div className="ms-l">{t.cust_status_pending}</div><div className="ms-v" style={{color:"#BA7517"}}>{pending}</div></div>
        <div className="mstat"><div className="ms-l">{t.cust_need_encoding}</div><div className="ms-v" style={{color:"#A32D2D"}}>{needEncoding}</div></div>
      </div>
      <input placeholder={t.cust_search_ph} value={query} onChange={e=>setQuery(e.target.value)} className="search-inp" style={{maxWidth:320}}/>
      <div className="table-card">
        <table className="tbl">
          <thead><tr><th>#</th><th>{t.cust_col_username}</th><th>{t.name_col}</th><th>{t.phone_label}</th><th>{t.cust_col_seven}</th><th>{t.status_col}</th></tr></thead>
          <tbody>
            {filtered.length===0&&<tr><td colSpan={6} style={{textAlign:"center",padding:32,color:"#888"}}>{t.cust_empty}</td></tr>}
            {filtered.map((r,i)=>{const s=regStatus(r);return(
              <tr key={r.username}>
                <td className="muted">{r.num??i+1}</td>
                <td><button type="button" className="inline-link" onClick={()=>openEncode(r)}>@{r.username}</button>{r.isNew&&s==="Not Registered"&&<>{" "}<Badge label={t.cust_badge_new} color="purple"/></>}</td>
                <td>{r.name||<span className="muted">—</span>}</td>
                <td className="mono">{r.phone||<span className="muted">—</span>}</td>
                <td className="mono">{r.sevenCode||<span className="muted">—</span>}</td>
                <td><Badge label={statusLabel(s)} color={statusColor(s)}/></td>
              </tr>
            );})}
          </tbody>
        </table>
      </div>
      {editing&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setEditUser(null)}>
          <div className="modal" style={{maxWidth:420}}>
            <div className="modal-hd"><span>{t.cust_encode_title} · @{editing.username}</span><button onClick={()=>setEditUser(null)} className="modal-x">×</button></div>
            <form onSubmit={saveEncode} className="modal-body">
              <Fg label={t.cust_field_username}><input value={form.username} onChange={e=>setForm(f=>({...f,username:e.target.value}))} placeholder="mine301520"/></Fg>
              <Fg label={t.cust_field_name}><input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="錢蘭 / Maria Santos" autoFocus/></Fg>
              <Fg label={t.cust_field_phone}><input value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value.replace(/[^\d]/g,"")}))} inputMode="numeric" placeholder="09xxxxxxxx"/></Fg>
              <Fg label={t.cust_field_seven}><input value={form.sevenCode} onChange={e=>setForm(f=>({...f,sevenCode:e.target.value.replace(/[^\d]/g,"").slice(0,6)}))} inputMode="numeric" placeholder="123456"/></Fg>
              {err&&<p style={{color:"#A32D2D",fontSize:13,margin:"4px 0 0"}}>{err}</p>}
              <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
                <button type="button" className="btn-out" onClick={()=>setEditUser(null)}>{t.cancel_btn}</button>
                <button type="submit" className="btn-purple">{t.save_btn}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function CommentArchive({comments,t}:{comments:Comment[];t:T}){
  const [q,setQ]=useState("");
  const query=q.trim().toLowerCase();
  const filtered=comments.filter(c=>{
    if(!query)return true;
    return c.name.toLowerCase().includes(query)
      || c.handle.toLowerCase().includes(query)
      || c.comment.toLowerCase().includes(query)
      || c.platform.toLowerCase().includes(query)
      || c.time.toLowerCase().includes(query);
  }).slice(0,80);
  return(
    <div className="table-card">
      <div className="table-title" style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:10}}>
        <span>{t.arch_title} ({comments.length})</span>
        <input className="search-inp" style={{maxWidth:220}} value={q} onChange={e=>setQ(e.target.value)} placeholder={t.arch_search_ph}/>
      </div>
      <table className="tbl">
        <thead><tr><th>{t.name_col}</th><th>{t.username_col}</th><th>{t.platform_label}</th><th>{t.comment_label}</th><th>{t.time_col}</th></tr></thead>
        <tbody>
          {filtered.length===0&&<tr><td colSpan={5} style={{textAlign:"center",padding:24,color:"#888"}}>{t.arch_empty}</td></tr>}
          {filtered.map(c=>(
            <tr key={`${c.platform}-${c.handle}-${c.timestamp||c.time}-${c.comment}`}>
              <td><div style={{display:"flex",alignItems:"center",gap:8}}><Av name={c.name} size={26}/><strong>{c.name}</strong></div></td>
              <td className="mono" style={{color:"#7F77DD"}}>@{c.handle}</td>
              <td><Badge label={c.platform} color={c.platform==="TikTok"?"purple":"green"}/></td>
              <td>{c.comment}</td>
              <td className="muted">{c.timestamp?new Date(c.timestamp).toLocaleString():c.time}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PrintPage({buyers,cur,storeName,settings,t}:{buyers:Buyer[];cur:string;storeName:string;settings:Settings;t:T}){
  const [toast,setToast]=useState("");
  function doPrint(b:Buyer){printSlip(b,cur,storeName,settings);}
  return(
    <div className="subpage">
      {toast&&<Toast msg={toast} onDone={()=>setToast("")}/>}
      <div className="subpage-hd">
        <div><h2>{t.nav_print}</h2><p>{t.print_sub}</p></div>
        <button className="btn-purple" onClick={()=>buyers.forEach(b=>doPrint(b))}>🖨 {t.print_all} ({buyers.length})</button>
      </div>
      <div className="notice-box" style={{background:"#EEF",border:"1px solid #AFA9EC",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#534AB7",marginBottom:4}}>
        {settings.printerType==="bluetooth"?t.print_bt_note:t.printer_usb_note}
        &nbsp;· {t.set_format_sticker}: {settings.stickerSize}mm
      </div>
      <div className="grid4" style={{gridTemplateColumns:"repeat(3,1fr)"}}>
        <div className="mstat"><div className="ms-l">{t.buyers_stat}</div><div className="ms-v">{buyers.length}</div></div>
        <div className="mstat"><div className="ms-l">{t.orders_stat}</div><div className="ms-v" style={{color:"#534AB7"}}>{buyers.reduce((s,b)=>s+b.totalOrders,0)}</div></div>
        <div className="mstat"><div className="ms-l">{t.revenue_stat}</div><div className="ms-v" style={{color:"#1D9E75"}}>{cur}{buyers.reduce((s,b)=>s+b.totalSpent,0).toLocaleString()}</div></div>
      </div>
      <div className="table-card">
        <table className="tbl">
          <thead><tr><th>#</th><th>{t.name_col}</th><th>{t.username_col}</th><th>{t.orders_col}</th><th>{t.total_label}</th><th>{t.platform_label}</th><th></th></tr></thead>
          <tbody>
            {buyers.length===0&&<tr><td colSpan={7} style={{textAlign:"center",padding:32,color:"#888"}}>{t.no_buyers_print}</td></tr>}
            {buyers.map(b=>(
              <tr key={b.handle}>
                <td><div style={{width:26,height:26,borderRadius:"50%",background:nc(b.num),color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>{b.num}</div></td>
                <td><div style={{display:"flex",alignItems:"center",gap:8}}><Av name={b.name} size={28}/><strong>{b.name}</strong></div></td>
                <td className="mono" style={{color:"#7F77DD"}}>@{b.handle}</td>
                <td>{b.totalOrders} {t.orders_col}</td>
                <td><strong style={{color:"#534AB7"}}>{cur}{b.totalSpent.toLocaleString()}</strong></td>
                <td><Badge label={b.platform} color={b.platform==="TikTok"?"purple":"green"}/></td>
                <td><button onClick={()=>doPrint(b)} style={{padding:"5px 14px",background:"#7F77DD",color:"#fff",border:"none",borderRadius:7,fontSize:12,cursor:"pointer",fontWeight:500}}>{t.print_slip_btn}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SALES
// ═══════════════════════════════════════════════════════════════════
function Sales({orders,buyers,cur,t}:{orders:LiveOrder[];buyers:Buyer[];cur:string;t:T}){
  const tot=orders.reduce((s,o)=>s+o.total,0);
  const ttR=orders.filter(o=>o.platform==="TikTok").reduce((s,o)=>s+o.total,0);
  const fbR=orders.filter(o=>o.platform==="Facebook").reduce((s,o)=>s+o.total,0);
  const im:{[k:string]:{qty:number;rev:number}}={};
  orders.forEach(o=>{if(!im[o.item])im[o.item]={qty:0,rev:0};im[o.item].qty+=o.qty;im[o.item].rev+=o.total;});
  const top=Object.entries(im).sort((a,b)=>b[1].rev-a[1].rev).slice(0,8);
  return(
    <div className="subpage">
      <div className="subpage-hd">
        <div><h2>{t.nav_sales}</h2><p>{t.sales_sub}</p></div>
        <button className="btn-out" onClick={()=>csvDL(`sales-${new Date().toISOString().slice(0,10)}.csv`,[t.order_num,t.sales_csv_buyer,t.item_col,t.qty_col,t.total_col,t.platform_label,t.time_col],orders.map(o=>[`#SF${o.orderNum}`,o.name,o.item,o.qty,`${cur}${o.total}`,o.platform,o.time]))}>⬇ {t.export_csv}</button>
      </div>
      <div className="grid4">
        <div className="mstat"><div className="ms-l">{t.revenue_stat}</div><div className="ms-v" style={{fontSize:22,color:"#1D9E75"}}>{cur}{tot.toLocaleString()}</div></div>
        <div className="mstat"><div className="ms-l">{t.orders_stat}</div><div className="ms-v">{orders.length}</div></div>
        <div className="mstat"><div className="ms-l">{t.buyers_stat}</div><div className="ms-v" style={{color:"#534AB7"}}>{buyers.length}</div></div>
        <div className="mstat"><div className="ms-l">{t.avg_order}</div><div className="ms-v" style={{fontSize:18}}>{cur}{orders.length?Math.round(tot/orders.length).toLocaleString():0}</div></div>
      </div>
      <div className="grid2">
        <div className="table-card"><div className="table-title">{t.top_products}</div>
          <table className="tbl"><thead><tr><th>{t.item_col}</th><th>{t.units_sold}</th><th>{t.revenue_stat}</th></tr></thead>
            <tbody>{top.length===0&&<tr><td colSpan={3} style={{textAlign:"center",padding:24,color:"#888"}}>{t.no_sales}</td></tr>}{top.map(([item,d])=><tr key={item}><td><strong>{item}</strong></td><td>{d.qty}</td><td><strong style={{color:"#1D9E75"}}>{cur}{d.rev.toLocaleString()}</strong></td></tr>)}</tbody>
          </table>
        </div>
        <div className="table-card"><div className="table-title">{t.revenue_platform}</div>
          <table className="tbl"><thead><tr><th>{t.platform_label}</th><th>{t.orders_col}</th><th>{t.revenue_stat}</th><th>{t.share_col}</th></tr></thead>
            <tbody>
              <tr><td><Badge label="TikTok" color="purple"/></td><td>{orders.filter(o=>o.platform==="TikTok").length}</td><td><strong>{cur}{ttR.toLocaleString()}</strong></td><td>{tot?Math.round(ttR/tot*100):0}%</td></tr>
              <tr><td><Badge label="Facebook" color="green"/></td><td>{orders.filter(o=>o.platform==="Facebook").length}</td><td><strong>{cur}{fbR.toLocaleString()}</strong></td><td>{tot?Math.round(fbR/tot*100):0}%</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════════════
function SettingsPage({user,settings,onSaveProfile,onSaveSettings,onSavePw,onExportBackup,onClearLiveComments,onResetBuyerCounter,t}:{user:User;settings:Settings;onSaveProfile:(p:Profile)=>void;onSaveSettings:(s:Settings)=>void;onSavePw:(o:string,n:string)=>Promise<string>;onExportBackup:()=>void;onClearLiveComments:()=>void;onResetBuyerCounter:()=>void;t:T}){
  const [prof,setProf]=useState<Profile>({...user.profile});
  const [sets,setSets]=useState<Settings>({...settings});
  const [op,setOp]=useState("");const [np,setNp]=useState("");const [cp,setCp]=useState("");
  const [toast,setToast]=useState("");const [pwErr,setPwErr]=useState("");
  const [expandedSettingsBox,setExpandedSettingsBox]=useState<""|"profile"|"password"|"display"|"printer"|"mobilePrinter">("");
  const directPrintParam=new URLSearchParams(window.location.search).get("directPrint")==="1";
  const [directPrintMode,setDirectPrintMode]=useState(()=>directPrintParam||LS.get<boolean>("sf_direct_print_mode",false));
  const settingsDirty=JSON.stringify(sets)!==JSON.stringify(settings);
  const settingsTitles={"":t.nav_settings,profile:t.profile_section,password:t.pw_section,display:t.display_section,printer:t.printer_section,mobilePrinter:t.set_title_mobile_printer};
  const previewScale=(v:number|undefined,fallback=100)=>Math.max(60,Math.min(180,v||fallback))/100;
  const storePreview=previewScale(sets.printStoreScale,sets.printLabelScale);
  const buyerNumberPreview=previewScale(sets.printBuyerNumberScale,120);
  const buyerNamePreview=previewScale(sets.printBuyerNameScale,sets.printLabelScale);
  const usernamePreview=previewScale(sets.printUsernameScale,sets.printLabelScale);
  const orderPreview=previewScale(sets.printOrderScale,sets.printLabelScale);
  const commentPreview=previewScale(sets.printCommentScale,sets.printLabelScale);
  const totalPreview=previewScale(sets.printTotalScale,sets.printLabelScale);
  const nativePrinterReady=hasNativeMobilePrinter();
  const [mobilePrinterStatus,setMobilePrinterStatus]=useState<MobilePrinterResult>({ok:false,message:nativePrinterReady?t.set_toast_check_status:t.set_toast_open_app_scan});
  const [mobilePrinters,setMobilePrinters]=useState<MobilePrinterDevice[]>([]);
  const [lanPrinterHost,setLanPrinterHost]=useState("");
  const [lanPrinterPort,setLanPrinterPort]=useState("9100");
  // ── Bluetooth sticker printer (additive — Settings UI only; native phase implements scan/print)
  const [btScanning,setBtScanning]=useState(false);
  const [btPrinters,setBtPrinters]=useState<BluetoothPrinterDevice[]>([]);
  const [btSavedPrinter,setBtSavedPrinter]=useState<BluetoothPrinterDevice|null>(null);
  const [btStatusMsg,setBtStatusMsg]=useState<string>("");
  const isBtMode=sets.printerType==="bluetooth";
  const bridgeHasBt=typeof window!=="undefined"&&!!window.SellerFlowPrinter?.scanBluetoothLabelPrinters;
  async function btCall<T>(action:"scanBluetoothLabelPrinters"|"getBluetoothLabelPrinter"|"setBluetoothLabelPrinter"|"clearBluetoothLabelPrinter"|"testStickerPrint"|"printStickerNative",arg?:unknown):Promise<T|null>{
    if(typeof window==="undefined")return null;
    const bridge=window.SellerFlowPrinter;
    const fn=bridge?.[action] as ((a?:unknown)=>Promise<T>)|undefined;
    if(typeof fn!=="function"){setBtStatusMsg(t.set_bt_open_app);return null;}
    try{return arg===undefined?await fn():await fn(arg);}catch(err){setBtStatusMsg(`Bluetooth error: ${err instanceof Error?err.message:String(err)}`);return null;}
  }
  async function scanBtPrinters(){
    // Bridge-missing path: fire a visible toast and bail. The button stays
    // visible and clickable — we never gate the button itself on bridge
    // presence, so the seller is never stuck staring at a missing control.
    if(!bridgeHasBt){
      setToast(t.set_bt_scan_need_app);
      setBtStatusMsg(t.set_bt_scan_need_app_short);
      return;
    }
    setBtScanning(true);setBtStatusMsg("");
    const result=await btCall<BluetoothScanResult>("scanBluetoothLabelPrinters");
    setBtScanning(false);
    if(result){setBtPrinters(result.printers||[]);if(result.savedPrinter)setBtSavedPrinter(result.savedPrinter);setBtStatusMsg(result.message||"");}
  }
  async function selectBtPrinter(printer:BluetoothPrinterDevice){
    const result=await btCall<BluetoothScanResult>("setBluetoothLabelPrinter",{address:printer.address,name:printer.name});
    if(result?.savedPrinter)setBtSavedPrinter(result.savedPrinter);
    else setBtSavedPrinter(printer);
    setBtStatusMsg(result?.message||t.set_toast_bt_saved);
  }
  async function clearBtPrinter(){
    await btCall<BluetoothScanResult>("clearBluetoothLabelPrinter");
    setBtSavedPrinter(null);
    setBtStatusMsg(t.set_toast_bt_cleared);
  }
  async function testBtSticker(){
    if(!bridgeHasBt){setBtStatusMsg(t.set_bt_open_app_print);return;}
    setBtStatusMsg("Sending TEXT+BAR sticker...");
    const testBuyer:Buyer={handle:"sellerflow",name:"Test Print",platform:"TikTok",num:88,orders:[{orderNum:1,item:"SellerFlowLive sticker test",qty:1,price:350,total:350,time:new Date().toLocaleTimeString(),handle:"sellerflow",name:"Test Print",bNum:88,platform:"TikTok",status:"New",date:new Date().toISOString().slice(0,10)}],totalSpent:350,totalOrders:1};
    const payload=buildNativeStickerPayload(testBuyer,sets.currency||"NT$",user.profile.storeName||"SellerFlowLive",sets);
    const result=await btCall<StickerPrintResult>("printStickerNative",payload);
    const printMsg=result?.ok?(result.message||t.set_bt_test_sticker_printed):(result?.message||t.set_bt_test_sticker_failed);
    setBtStatusMsg(`${printMsg} | sticker=TEXT+BAR, buyer #${testBuyer.num}, total ${sets.currency||"NT$"}${testBuyer.totalSpent}`);
  }
  // Pure TSPL TEXT test page (no bitmap). Isolates bitmap-encoding bugs from
  // command/connection issues: if THIS prints but the bitmap test doesn't,
  // the problem is in the bitmap rendering/packing. If neither prints, the
  // problem is at the TSPL command or BT connection layer.
  async function testBtTextOnly(){
    if(!bridgeHasBt){setBtStatusMsg(t.set_bt_open_app_text);return;}
    setBtStatusMsg("Sending TSPL text-only test...");
    const result=await btCall<StickerPrintResult>("testStickerPrint",{storeName:user.profile.storeName||"SellerFlowLive"});
    setBtStatusMsg(result?.ok?(result.message||t.set_bt_text_test_sent):(result?.message||t.set_bt_text_test_failed));
  }
  useEffect(()=>{
    if(!bridgeHasBt)return;
    void btCall<BluetoothScanResult>("getBluetoothLabelPrinter").then(r=>{if(r?.savedPrinter)setBtSavedPrinter(r.savedPrinter);});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[bridgeHasBt]);
  // Hide the receipt size + position tuning UI on iOS: the iOS native ESC/POS
  // print uses fixed sizes (verified), so these controls never affect the actual
  // printout there. Reuses main.tsx's body.platform-ios hook (Capacitor iOS app
  // or ?ios dev param); Android and web keep the controls (class never set).
  const isIOSPlatform = typeof document!=="undefined" && document.body.classList.contains("platform-ios");
  // Android APK marker (set in main.tsx). The Android APK prints slips through
  // the native ESC/POS bridge (window.SellerFlowPrinter.printSlip), which uses
  // fixed 1x/2x sizing byte-identical to iOS and ignores the per-field scale +
  // position settings — so those controls are inert on-device, exactly like iOS.
  // Hide them here so the Android Settings match iOS. Desktop web (class never
  // set) keeps them: its browser-print iframe path actually honors the scales.
  const isAndroidPlatform = typeof document!=="undefined" && document.body.classList.contains("platform-android");
  // Sticker output (BT TSPL or LAN sticker) prints fixed TSPL fonts/coords —
  // the size dropdown + per-field size/position tuning don't reach it (only
  // the on/off "Printer output" toggles do). Hide those inert controls in
  // sticker mode (same rationale as the iOS fixed-size hide); the receipt /
  // browser-print path keeps them.
  const isStickerOutput = sets.printerType==="bluetooth" || sets.lanFormat==="sticker";
  const previewMove=(x:number|undefined,y:number|undefined)=>({transform:`translate(${(x||0)*1.8}px,${(y||0)*1.8}px)`});
  const stepSetting=(key:NumberSettingKey,delta:number)=>setSets(s=>({...s,[key]:Math.max(-40,Math.min(40,Number(s[key]||0)+delta))}));
  const stepSize=(key:NumberSettingKey,delta:number)=>setSets(s=>({...s,[key]:Math.max(60,Math.min(180,Number(s[key]||100)+delta))}));
  const sizeStep=(key:NumberSettingKey,label:string)=>(
    <div key={key} className="position-step-row">
      <span>{label}</span>
      <div className="position-step-controls">
        <button type="button" onClick={()=>stepSize(key,-5)}>-</button>
        <b>{Number(sets[key]||100)}%</b>
        <button type="button" onClick={()=>stepSize(key,5)}>+</button>
      </div>
    </div>
  );
  const positionStep=(key:NumberSettingKey,label:string)=>(
    <div key={key} className="position-step-row">
      <span>{label}</span>
      <div className="position-step-controls">
        <button type="button" onClick={()=>stepSetting(key,-1)}>-</button>
        <b>{Number(sets[key]||0)}mm</b>
        <button type="button" onClick={()=>stepSetting(key,1)}>+</button>
      </div>
    </div>
  );
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(()=>{setProf({...user.profile});},[user]);
  useEffect(()=>{setSets({...settings});},[settings]);
  useEffect(()=>{if(directPrintParam){LS.set("sf_direct_print_mode",true);setDirectPrintMode(true);}},[directPrintParam]);
  useEffect(()=>{if(nativePrinterReady){void refreshMobilePrinterStatus();}},[nativePrinterReady]);
  /* eslint-enable react-hooks/set-state-in-effect */
  const accountLimit=maxAcc(user.plan);
  const originalTikTok=accountSlots(user.profile.tiktok,accountLimit);
  const originalFacebook=accountSlots(user.profile.facebook,accountLimit);
  const profTikTok=accountSlots(prof.tiktok,accountLimit);
  const profFacebook=accountSlots(prof.facebook,accountLimit);
  const currentTotal=accountList(prof.tiktok).length+accountList(prof.facebook).length;
  const changeAccount=(platform:"tiktok"|"facebook",index:number,value:string)=>{
    const field=platform;
    const slots=accountSlots(prof[field],accountLimit);
    slots[index]=value;
    setProf(p=>({...p,[field]:accountText(slots)}));
  };
  const renderAccountSlots=(platform:"tiktok"|"facebook",label:string,placeholder:string,values:string[],original:string[])=>(
    <div className="locked-account-group">
      <div className="locked-account-title">{label}</div>
      {values.map((value,index)=>{
        const locked=Boolean(original[index]);
        const limitReached=!value&&!locked&&currentTotal>=accountLimit;
        return(
          <Fg key={`${platform}-${index}`} label={`${label} ${index+1}`}>
            <input
              value={value}
              onChange={e=>changeAccount(platform,index,e.target.value)}
              placeholder={limitReached?t.set_account_limit_reached:placeholder}
              disabled={locked||limitReached}
              className={locked?"locked-account-input":""}
            />
            {locked&&<div className="locked-account-note">{t.set_account_locked_note}</div>}
          </Fg>
        );
      })}
    </div>
  );
  function saveProf(e:React.FormEvent){e.preventDefault();onSaveProfile(prof);setToast(t.profile_saved);}
  function saveSets(e:React.FormEvent){e.preventDefault();onSaveSettings(sets);setToast(t.settings_saved);}
  const samplePrinterBuyer=():Buyer=>({
    handle:"sellerflow_test",
    name:"Test Buyer",
    platform:"TikTok",
    num:1,
    totalOrders:2,
    totalSpent:1240,
    orders:[
      {orderNum:1001,item:"Sample item",qty:1,price:620,total:620,time:new Date().toLocaleTimeString(),handle:"sellerflow_test",name:"Test Buyer",bNum:1,platform:"TikTok",status:"New",date:new Date().toISOString().slice(0,10)},
      {orderNum:1002,item:"Printer check",qty:1,price:620,total:620,time:new Date().toLocaleTimeString(),handle:"sellerflow_test",name:"Test Buyer",bNum:1,platform:"TikTok",status:"New",date:new Date().toISOString().slice(0,10)},
    ],
  });
  function testPrinter(){
    const testBuyer=samplePrinterBuyer();
    printSlip(testBuyer,sets.currency,user.profile.storeName||"SellerFlowLive",sets);
    setToast(t.set_toast_printer_test_sent);
  }
  async function refreshMobilePrinterStatus(){
    const result=await callMobilePrinterBridge("getPrinter");
    setMobilePrinterStatus(result);
    const saved=result.savedPrinter;
    if(result.host||saved?.host)setLanPrinterHost(result.host||saved?.host||"");
    if(result.port||saved?.port)setLanPrinterPort(String(result.port||saved?.port||9100));
    return result;
  }
  async function connectMobilePrinter(printer:MobilePrinterDevice){
    const result=await callMobilePrinterBridge("setPrinter",{host:printer.host||"",port:printer.port||9100});
    setMobilePrinterStatus(result);
    if(result.savedPrinter)setMobilePrinters(list=>[result.savedPrinter as MobilePrinterDevice,...list.filter(p=>p.id!==result.savedPrinter?.id)]);
    setToast(result.message||t.set_toast_printer_saved);
  }
  async function saveLanPrinter(){
    const port=Math.max(1,Math.min(65535,Number(lanPrinterPort)||9100));
    const result=await callMobilePrinterBridge("setPrinter",{host:lanPrinterHost.trim(),port});
    setMobilePrinterStatus(result);
    if(result.savedPrinter)setMobilePrinters([result.savedPrinter]);
    setToast(result.message||t.set_toast_wifi_saved);
  }
  async function testLanPrinterConnection(){
    const port=Math.max(1,Math.min(65535,Number(lanPrinterPort)||9100));
    const result=await callMobilePrinterBridge("testConnection",{host:lanPrinterHost.trim(),port});
    setMobilePrinterStatus(result);
    if(result.ok)await saveLanPrinter();
    else setToast(result.message||t.set_toast_conn_failed);
  }
  async function testMobilePrinter(){
    const result=await callMobilePrinterBridge("testPrint");
    setMobilePrinterStatus(result);
    setToast(result.ok?result.message||t.set_toast_test_printed:result.message||t.set_toast_test_failed);
  }
  function openMobileBluetoothGuide(){
    setToast(t.set_toast_setup_help);
  }
  function resetPrinterLayout(){
    setSets(s=>({
      ...s,
      printStoreName:DEF_SETTINGS.printStoreName,
      printBuyerNumber:DEF_SETTINGS.printBuyerNumber,
      printBuyerUsername:DEF_SETTINGS.printBuyerUsername,
      printOrderItems:DEF_SETTINGS.printOrderItems,
      printTotal:DEF_SETTINGS.printTotal,
      printStoreScale:DEF_SETTINGS.printStoreScale,
      printBuyerNumberScale:DEF_SETTINGS.printBuyerNumberScale,
      printBuyerNameScale:DEF_SETTINGS.printBuyerNameScale,
      printUsernameScale:DEF_SETTINGS.printUsernameScale,
      printOrderScale:DEF_SETTINGS.printOrderScale,
      printCommentScale:DEF_SETTINGS.printCommentScale,
      printTotalScale:DEF_SETTINGS.printTotalScale,
      printStoreX:DEF_SETTINGS.printStoreX,
      printStoreY:DEF_SETTINGS.printStoreY,
      printBuyerLabelX:DEF_SETTINGS.printBuyerLabelX,
      printBuyerLabelY:DEF_SETTINGS.printBuyerLabelY,
      printBuyerNumberX:DEF_SETTINGS.printBuyerNumberX,
      printBuyerNumberY:DEF_SETTINGS.printBuyerNumberY,
      printBuyerNameX:DEF_SETTINGS.printBuyerNameX,
      printBuyerNameY:DEF_SETTINGS.printBuyerNameY,
      printUsernameX:DEF_SETTINGS.printUsernameX,
      printUsernameY:DEF_SETTINGS.printUsernameY,
      printSessionX:DEF_SETTINGS.printSessionX,
      printSessionY:DEF_SETTINGS.printSessionY,
      printOrderX:DEF_SETTINGS.printOrderX,
      printOrderY:DEF_SETTINGS.printOrderY,
      printTotalX:DEF_SETTINGS.printTotalX,
      printTotalY:DEF_SETTINGS.printTotalY,
    }));
    setToast(t.set_toast_layout_reset);
  }
  async function savePw(e:React.FormEvent){
    e.preventDefault();setPwErr("");
    if(np.length<6){setPwErr(t.pw_short);return;}
    if(np!==cp){setPwErr(t.pw_mismatch);return;}
    const err=await onSavePw(op,np);
    if(err){setPwErr(err);return;}
    setOp("");setNp("");setCp("");setToast(t.pw_changed);
  }
  return(
    <div className="subpage">
      {toast&&<Toast msg={toast} onDone={()=>setToast("")}/>}
      <div className="subpage-hd"><div><h2>{t.nav_settings}</h2><p>{t.settings_sub}</p></div></div>
      <div className="settings-quick-grid">
        <button className="admin-action-card" onDoubleClick={()=>setExpandedSettingsBox("profile")}>
          <div className="ms-l">{t.set_card_profile}</div><div className="ms-v">1</div><span>{t.set_card_profile_desc}</span>
        </button>
        <button className="admin-action-card" onDoubleClick={()=>setExpandedSettingsBox("password")}>
          <div className="ms-l">{t.set_card_password}</div><div className="ms-v">PW</div><span>{t.set_card_password_desc}</span>
        </button>
        <button className="admin-action-card" onDoubleClick={()=>setExpandedSettingsBox("display")}>
          <div className="ms-l">{t.set_card_display}</div><div className="ms-v">{sets.currency}</div><span>{t.set_card_display_desc}</span>
        </button>
        <button className="admin-action-card" onDoubleClick={()=>setExpandedSettingsBox("printer")}>
          <div className="ms-l">{t.set_card_printer}</div><div className="ms-v">{settingsDirty?"!":"OK"}</div><span>{settingsDirty?t.set_card_changes_unsaved:t.set_card_saved} - {t.set_card_output_tools}</span>
        </button>
        <button className="admin-action-card mobile-bluetooth-card" onDoubleClick={()=>setExpandedSettingsBox("mobilePrinter")}>
          <div className="ms-l">{t.set_card_mobile_printer}</div><div className="ms-v">LAN</div><span>{t.set_card_mobile_printer_desc}</span>
        </button>
      </div>
      {expandedSettingsBox&&(
        <div className="admin-fullscreen-panel">
          <div className="admin-fullscreen-head">
            <button className="btn-out" onClick={()=>setExpandedSettingsBox("")}>{t.back_btn}</button>
            <div><h2>{settingsTitles[expandedSettingsBox]}</h2><p>{t.set_full_page}</p></div>
          </div>
          <div className={`grid2 settings-expanded settings-show-${expandedSettingsBox}`}>
        <form onSubmit={saveProf} className="scard settings-section settings-section-profile">
          <div className="scard-title">{t.profile_section}</div>
          <Fg label={t.full_name}><input value={prof.fullName} onChange={e=>setProf(p=>({...p,fullName:e.target.value}))} required/></Fg>
          <Fg label={t.store_name}><input value={prof.storeName} onChange={e=>setProf(p=>({...p,storeName:e.target.value}))} required/></Fg>
          <Fg label={t.email_label}><input value={user.email} disabled style={{background:"#F5F5F2",color:"#888"}}/></Fg>
          <Fg label={t.phone_label}><input value={prof.phone} onChange={e=>setProf(p=>({...p,phone:e.target.value}))} placeholder="+63 912 345 6789"/></Fg>
          {renderAccountSlots("tiktok",t.set_tiktok_account,t.set_tiktok_ph,profTikTok,originalTikTok)}
          {renderAccountSlots("facebook",t.set_facebook_page,t.set_facebook_ph,profFacebook,originalFacebook)}
          <button type="submit" className="btn-purple">{t.save_profile}</button>
        </form>
        <form onSubmit={savePw} className="scard settings-section settings-section-password">
          <div className="scard-title">{t.pw_section}</div>
          {pwErr&&<div className="auth-err">⚠ {pwErr}</div>}
          <Fg label={t.current_pw}><input type="password" value={op} onChange={e=>setOp(e.target.value)} required/></Fg>
          <Fg label={t.new_pw}><input type="password" value={np} onChange={e=>setNp(e.target.value)} required/></Fg>
          <Fg label={t.confirm_pw}><input type="password" value={cp} onChange={e=>setCp(e.target.value)} required/></Fg>
          <button type="submit" className="btn-purple">{t.update_pw}</button>
        </form>
        <form onSubmit={saveSets} className="scard settings-section settings-section-display">
          <div className="scard-title">{t.display_section}</div>
          <div className="tog-row theme-mode-toggle">
            <span>
              <strong>{t.set_dark_mode}</strong>
              <small>{sets.darkMode?t.set_dark_mode_on:t.set_dark_mode_off}</small>
            </span>
            <div onClick={()=>setSets(s=>({...s,darkMode:!s.darkMode}))} className={`tog ${sets.darkMode?"on":""}`}/>
          </div>
          <Fg label={t.currency_label}>
            <select value={sets.currency} onChange={e=>setSets(s=>({...s,currency:e.target.value}))}>
              {CURRENCIES.map(c=><option key={c.v} value={c.v}>{c.l}</option>)}
            </select>
          </Fg>
          <Fg label={t.paper_size}>
            <select value={sets.paperSize} onChange={e=>setSets(s=>({...s,paperSize:e.target.value}))}><option>100x60mm</option><option>80x60mm</option><option>58mm</option><option>80mm</option></select>
          </Fg>
          <div className="scard-title" style={{marginTop:10}}>{t.notif_section}</div>
          {([["autoprint",t.auto_print],["soundAlert",t.sound_alert],["stockAlert",t.stock_alert],["dailyEmail",t.daily_email]] as [keyof Settings,string][]).map(([k,label])=>(
            <div key={k} className="tog-row"><span>{label}</span><div onClick={()=>setSets(s=>({...s,[k]:!s[k]}))} className={`tog ${sets[k]?"on":""}`}/></div>
          ))}
          <div className="scard-title" style={{marginTop:10}}>{t.set_backup_section}</div>
          <div className="backup-actions">
            <button type="button" className="btn-out" onClick={onExportBackup}>{t.set_export_backup}</button>
            <button type="button" className="btn-out danger-lite" onClick={onClearLiveComments}>{t.set_clear_comments}</button>
            <button type="button" className="btn-out danger-lite" onClick={onResetBuyerCounter}>{t.reset_buyer_btn}</button>
          </div>
          <div className="backup-note">{t.set_backup_note}</div>
          <button type="submit" className="btn-purple" style={{marginTop:6}}>{t.save_settings}</button>
        </form>
        <form onSubmit={saveSets} className="scard settings-section settings-section-printer">
          <div className="scard-title" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
            <span>{t.printer_section}</span>
            <span style={{fontSize:11,fontWeight:600,color:settingsDirty?"#B45309":"#0F6E56",background:settingsDirty?"#FFF3CD":"#E1F5EE",borderRadius:999,padding:"3px 8px"}}>
              {settingsDirty?t.set_not_saved:t.set_card_saved}
            </span>
          </div>
          <div className="printer-tools-row">
            <div className={`printer-direct-status ${directPrintMode?"active":"inactive"}`}>
              <div>
                <strong>{directPrintMode?t.set_direct_active:t.set_direct_inactive}</strong>
                <span>{directPrintMode?t.set_direct_active_desc:t.set_direct_inactive_desc}</span>
              </div>
              <Badge label={directPrintMode?t.set_ready:t.set_shortcut_needed} color={directPrintMode?"green":"amber"}/>
            </div>
            <a className="printer-shortcut-link" href="/sellerflow-printer-shortcut.bat?v=6" download>{t.printer_shortcut}</a>
            <button type="button" className="printer-test-btn" onClick={testPrinter}>{t.set_printer_test}</button>
            <div className="printer-troubleshoot">
              <strong>{t.set_quick_setup}</strong>
              <ol>
                <li>{t.set_quick_step1}</li>
                <li>{t.set_quick_step2}</li>
                <li>{t.set_quick_step3}</li>
                <li>{t.set_quick_step4}</li>
              </ol>
              <p>{t.set_quick_note}</p>
            </div>
          </div>
          {/* Print mode — 2-card selector (WiFi/LAN default, Bluetooth additive). */}
          <div className="printer-mode-section">
            <div className="printer-mode-label">{t.printer_mode_title}</div>
            <div className="printer-mode-cards">
              <button type="button" className={`printer-mode-card ${!isBtMode?"on":""}`} onClick={()=>setSets(s=>({...s,printerType:"lan"}))}>
                <div className="pm-card-head"><span className="pm-card-radio">{!isBtMode?"●":"○"}</span><strong>{t.printer_mode_wifi}</strong></div>
                <div className="pm-card-rec">{t.printer_mode_wifi_rec}</div>
                <div className="pm-card-desc">{t.printer_mode_wifi_desc}</div>
              </button>
              <button type="button" className={`printer-mode-card ${isBtMode?"on":""}`} onClick={()=>setSets(s=>({...s,printerType:"bluetooth"}))}>
                <div className="pm-card-head"><span className="pm-card-radio">{isBtMode?"●":"○"}</span><strong>{t.printer_mode_bt}</strong></div>
                <div className="pm-card-rec">{t.printer_mode_bt_rec}</div>
                <div className="pm-card-desc">{t.printer_mode_bt_desc}</div>
              </button>
            </div>
          </div>
          {/* WiFi/LAN output format — Receipt (ESC/POS) vs Sticker (TSPL).
              Additive, explicit choice; default "receipt" keeps the existing
              ESC/POS behavior. Only shown for WiFi/LAN mode — Bluetooth always
              prints TSPL stickers, so the toggle would be meaningless there. */}
          {!isBtMode&&(
          <div className="printer-mode-section">
            <div className="printer-mode-label">{t.set_output_format}</div>
            <div className="printer-mode-cards">
              <button type="button" className={`printer-mode-card ${sets.lanFormat!=="sticker"?"on":""}`} onClick={()=>setSets(s=>({...s,lanFormat:"receipt"}))}>
                <div className="pm-card-head"><span className="pm-card-radio">{sets.lanFormat!=="sticker"?"●":"○"}</span><strong>{t.set_format_receipt}</strong></div>
                <div className="pm-card-rec">{t.set_format_default}</div>
                <div className="pm-card-desc">{t.set_format_receipt_desc}</div>
              </button>
              <button type="button" className={`printer-mode-card ${sets.lanFormat==="sticker"?"on":""}`} onClick={()=>setSets(s=>({...s,lanFormat:"sticker"}))}>
                <div className="pm-card-head"><span className="pm-card-radio">{sets.lanFormat==="sticker"?"●":"○"}</span><strong>{t.set_format_sticker}</strong></div>
                <div className="pm-card-rec">{t.set_format_sticker_rec}</div>
                <div className="pm-card-desc">{t.set_format_sticker_desc}</div>
              </button>
            </div>
          </div>
          )}
          {!isStickerOutput && !isIOSPlatform && !isAndroidPlatform && (
          <Fg label={t.printer_size}>
            <select value={sets.stickerSize} onChange={e=>setSets(s=>({...s,stickerSize:e.target.value}))}>
              <option value="100x60">{t.set_size_standard}</option>
              <option value="80x50">80x50mm</option>
              <option value="60x40">60x40mm</option>
            </select>
          </Fg>
          )}
          {!isIOSPlatform && !isAndroidPlatform && !isStickerOutput && <>
          <div className="printer-preview-box">
            <div className="printer-preview-title">{t.set_preview_title}</div>
            <div className="printer-preview-slip">
              <div className="printer-preview-head">
                <div className="printer-preview-brand"><span className="printer-preview-logo">S</span><strong>Seller<span>FlowLive</span></strong></div>
                <div className="printer-preview-session" style={previewMove(sets.printSessionX,sets.printSessionY)}>Session: May 22, 2026</div>
              </div>
              <div className="printer-preview-grid">
                <div className="printer-preview-left">
                  {sets.printStoreName&&<strong style={{fontSize:`${13*storePreview}px`,...previewMove(sets.printStoreX,sets.printStoreY)}}>{user.profile.storeName||t.set_preview_seller_name}</strong>}
                  {sets.printBuyerNumber&&<b style={{fontSize:`${13*buyerNumberPreview}px`,...previewMove(sets.printBuyerNumberX,sets.printBuyerNumberY)}}>Buyer #12</b>}
                  <b style={{fontSize:`${13*buyerNamePreview}px`,...previewMove(sets.printBuyerNameX,sets.printBuyerNameY)}}>Maria Santos</b>
                  {sets.printBuyerUsername&&<em style={{fontSize:`${10*usernamePreview}px`,...previewMove(sets.printUsernameX,sets.printUsernameY)}}>@maria_live</em>}
                </div>
                {sets.printOrderItems&&<div className="printer-preview-order-box" style={previewMove(sets.printOrderX,sets.printOrderY)}>
                  <strong>{t.set_preview_order_here}</strong>
                  <div><span style={{fontSize:`${9*orderPreview}px`}}>12:21 PM</span><b style={{fontSize:`${10*commentPreview}px`}}>620</b></div>
                  <div><span style={{fontSize:`${9*orderPreview}px`}}>12:22 PM</span><b style={{fontSize:`${10*commentPreview}px`}}>150</b></div>
                  {sets.printTotal&&<div className="printer-preview-total" style={{fontSize:`${10*totalPreview}px`,...previewMove(sets.printTotalX,sets.printTotalY)}}><span>{t.total_label}</span><b>{sets.currency}1,240</b></div>}
                </div>}
              </div>
            </div>
            <button type="button" className="printer-reset-btn" onClick={resetPrinterLayout}>{t.set_reset_layout}</button>
          </div>
          {([
            ["printStoreScale",t.set_el_store_name],
            ["printBuyerNumberScale",t.set_el_buyer_number],
            ["printBuyerNameScale",t.set_el_buyer_name],
            ["printUsernameScale",t.set_el_username],
            ["printOrderScale",t.set_el_order_time],
            ["printCommentScale",t.set_el_customer_comment],
            ["printTotalScale",t.set_el_total_amount],
          ] as [NumberSettingKey,string][]).map(([k,label])=>sizeStep(k,`${label} ${t.set_size_word}`))}
          <div className="scard-title" style={{marginTop:10}}>{t.set_position_tools}</div>
          <div className="position-step-grid">
            {([
              ["printStoreX",`${t.set_preview_seller_name} ${t.set_dir_lr}`],
              ["printStoreY",`${t.set_preview_seller_name} ${t.set_dir_ud}`],
              ["printBuyerLabelX",`${t.set_posel_buyer_label} ${t.set_dir_lr}`],
              ["printBuyerLabelY",`${t.set_posel_buyer_label} ${t.set_dir_ud}`],
              ["printBuyerNumberX",`${t.set_el_buyer_number} ${t.set_dir_lr}`],
              ["printBuyerNumberY",`${t.set_el_buyer_number} ${t.set_dir_ud}`],
              ["printBuyerNameX",`${t.set_el_buyer_name} ${t.set_dir_lr}`],
              ["printBuyerNameY",`${t.set_el_buyer_name} ${t.set_dir_ud}`],
              ["printUsernameX",`${t.set_posel_username} ${t.set_dir_lr}`],
              ["printUsernameY",`${t.set_posel_username} ${t.set_dir_ud}`],
              ["printSessionX",`${t.set_posel_session} ${t.set_dir_lr}`],
              ["printSessionY",`${t.set_posel_session} ${t.set_dir_ud}`],
              ["printOrderX",`${t.set_el_order_items} ${t.set_dir_lr}`],
              ["printOrderY",`${t.set_el_order_items} ${t.set_dir_ud}`],
            ] as [NumberSettingKey,string][]).map(([k,label])=>positionStep(k,label))}
          </div>
          </>}
          <div className="scard-title" style={{marginTop:10}}>{t.set_printer_output}</div>
          {([
            ["printStoreName",t.set_el_store_name],
            ["printBuyerNumber",t.set_el_buyer_number],
            ["printBuyerUsername",t.set_el_username],
            ["printOrderItems",t.set_el_order_items],
            ["printTotal",t.set_el_total_amount],
            ["printAutoClose",t.set_el_close_tab],
          ] as [keyof Settings,string][]).map(([k,label])=>(
            <div key={k} className="tog-row"><span>{label}</span><div onClick={()=>setSets(s=>({...s,[k]:!s[k]}))} className={`tog ${sets[k]?"on":""}`}/></div>
          ))}
          <div style={{padding:"8px 10px",background:"#F5F4FF",borderRadius:8,fontSize:12,color:"#534AB7",lineHeight:1.5,marginTop:4}}>
            {sets.printerType==="bluetooth"
              ?t.set_bt_desktop_note
              :t.printer_usb_note}
          </div>
          <button type="submit" className="btn-purple" style={{marginTop:10,width:"100%"}}>
            {t.set_save_printer_settings}
          </button>
          <div className="scard-title" style={{marginTop:10}}>{t.platform_section}</div>
          <div style={{fontSize:12,color:"#888",marginBottom:8}}>{t.platform_hint}</div>
          <div className="tog-row"><div><div style={{fontWeight:500}}>{t.set_tiktok_live}</div><div style={{fontSize:11,color:"#888",whiteSpace:"pre-wrap"}}>{accountList(user.profile.tiktok).join(", ")||t.not_set}</div></div><Badge label={user.connectedAccounts.includes("TikTok")?t.connected_label:t.not_connected} color={user.connectedAccounts.includes("TikTok")?"green":"gray"}/></div>
          <div className="tog-row" style={{borderBottom:"none"}}><div><div style={{fontWeight:500}}>{t.set_facebook_live}</div><div style={{fontSize:11,color:"#888",whiteSpace:"pre-wrap"}}>{accountList(user.profile.facebook).join(", ")||t.not_set}</div></div><Badge label={user.connectedAccounts.includes("Facebook")?t.connected_label:t.not_connected} color={user.connectedAccounts.includes("Facebook")?"green":"gray"}/></div>
        </form>
        <form onSubmit={saveSets} className="scard settings-section settings-section-mobile-printer" style={isBtMode?{display:"none"}:undefined}>
          <div className="scard-title">{t.printer_wifi_card_title}</div>
          <div className="mobile-bt-layout">
            <div className="mobile-bt-copy">
              <div className={`printer-direct-status ${mobilePrinterStatus.online?"active":"inactive"}`}>
                <div>
                  <strong>{mobilePrinterStatus.online?t.set_printer_online:nativePrinterReady?t.set_ready_wifi:t.set_app_needed}</strong>
                  <span>{mobilePrinterStatus.message||t.set_wifi_default_msg}</span>
                </div>
                <Badge label={mobilePrinterStatus.online?t.set_status_online:nativePrinterReady?t.set_status_wifi:t.set_status_mobile_only} color={mobilePrinterStatus.online?"green":"amber"}/>
              </div>
              {mobilePrinterStatus.savedPrinter&&(
                <div className="mobile-printer-saved">
                  <span>{t.printer_bt_saved}</span>
                  <strong>{mobilePrinterStatus.savedPrinter.name}</strong>
                  <small>WiFi/LAN {mobilePrinterStatus.savedPrinter.host||""}:{mobilePrinterStatus.savedPrinter.port||9100}</small>
                </div>
              )}
              <div className="mobile-printer-lan-config">
                <Fg label={t.set_printer_ip}>
                  <input value={lanPrinterHost} onChange={e=>setLanPrinterHost(e.target.value)} placeholder="192.168.18.234" inputMode="decimal"/>
                </Fg>
                <Fg label={t.set_port}>
                  <input value={lanPrinterPort} onChange={e=>setLanPrinterPort(e.target.value.replace(/[^\d]/g,""))} placeholder="9100" inputMode="numeric"/>
                </Fg>
              </div>
              <div className="mobile-printer-actions">
                <button type="button" className="printer-test-btn" onClick={testLanPrinterConnection}>{t.set_test_connection}</button>
                <button type="button" className="btn-out" onClick={saveLanPrinter}>{t.set_save_printer_btn}</button>
                <button type="button" className="btn-out" onClick={refreshMobilePrinterStatus}>{t.set_check_status}</button>
                <button type="button" className="printer-test-btn" onClick={testMobilePrinter}>{t.set_test_print}</button>
              </div>
              <div className="mobile-printer-list">
                {mobilePrinters.length===0&&<div className="mobile-printer-empty">{t.set_no_wifi_saved}</div>}
                {mobilePrinters.map(printer=>(
                  <button type="button" key={printer.id} className="mobile-printer-option" onClick={()=>connectMobilePrinter(printer)}>
                    <div className={`mobile-printer-type ${printer.type}`}>{t.set_status_wifi}</div>
                    <div>
                      <strong>{printer.name}</strong>
                      <span>{printer.hint||t.set_raw_tcp_hint}</span>
                      <small>{printer.host}:{printer.port||9100}</small>
                    </div>
                    <Badge label={printer.online||printer.paired?t.set_ready:t.printer_bt_nearby} color={printer.online||printer.paired?"green":"purple"}/>
                  </button>
                ))}
              </div>
              <div className="mobile-bt-steps">
                <strong>{t.set_simple_setup}</strong>
                <ol>
                  <li>{t.set_simple_step1}</li>
                  <li>{t.set_simple_step2}</li>
                  <li>{t.set_simple_step3}</li>
                  <li>{t.set_simple_step4}</li>
                </ol>
              </div>
              <div className="mobile-bt-actions">
                <button type="button" className="btn-out" onClick={openMobileBluetoothGuide}>{t.set_setup_help}</button>
                <button type="button" className="btn-out" onClick={testPrinter}>{t.set_browser_fallback}</button>
              </div>
              <div className="backup-note">{t.set_wifi_note}</div>
            </div>
            <div className="mobile-bt-preview">
              <div className="mobile-bt-phone">
                <div className="mobile-bt-top"/>
                <div className="mobile-bt-card">
                  <b>{t.set_auto_printer}</b>
                  <span>{t.set_wifi_lan_tcp}</span>
                  <em>{mobilePrinterStatus.online?t.set_status_online:t.set_scan_to_connect}</em>
                </div>
                <div className="mobile-bt-slip">
                  <strong>BUYER #12</strong>
                  <span>Maria Santos</span>
                  <small>@maria_live</small>
                </div>
              </div>
            </div>
          </div>
        </form>
        {/* ── BLUETOOTH STICKER PRINTER (additive — Settings UI for AIMO-class TSPL printers) ── */}
        {isBtMode&&(
          <div className="scard settings-section settings-section-bt-printer">
            <div className="scard-title">{t.printer_bt_card_title}</div>
            <div className="bt-printer-rec">{t.printer_mode_bt_rec}</div>
            <div className="bt-printer-pair-hint">{t.printer_bt_pair_hint}</div>
            {btSavedPrinter?(
              <div className="bt-printer-saved">
                <div>
                  <span className="bt-printer-saved-label">{t.printer_bt_saved}</span>
                  <strong>{btSavedPrinter.name}</strong>
                  <small className="mono">{btSavedPrinter.address}</small>
                </div>
                <button type="button" className="btn-out" onClick={clearBtPrinter}>{t.printer_bt_clear}</button>
              </div>
            ):(
              <div className="bt-printer-empty">{t.printer_bt_no_saved}</div>
            )}
            <div className="bt-printer-actions bt-printer-scan-block">
              <button
                type="button"
                className="btn-purple bt-printer-scan-btn"
                onClick={scanBtPrinters}
                disabled={btScanning}
              >
                🔍 {btScanning?(t.printer_bt_scanning||"Scanning…"):(t.printer_bt_scan||"Scan paired Bluetooth printers")}
              </button>
              {btSavedPrinter&&(
                <button
                  type="button"
                  className="btn-out bt-printer-test-btn"
                  onClick={testBtTextOnly}
                  style={{borderColor:"#7F77DD"}}
                >
                  📝 {t.set_bt_test_text}
                </button>
              )}
              {btSavedPrinter&&(
                <button
                  type="button"
                  className="btn-out bt-printer-test-btn"
                  onClick={testBtSticker}
                >
                  🖨️ {t.printer_bt_test||"Test print sticker"}
                </button>
              )}
            </div>
            {btPrinters.length>0&&(
              <div className="bt-printer-list">
                <div className="bt-printer-list-title">{t.printer_bt_paired_found}</div>
                {btPrinters.map(p=>(
                  <button type="button" key={p.id||p.address} className="bt-printer-option" onClick={()=>selectBtPrinter(p)}>
                    <div className="bt-printer-option-name"><strong>{p.name||"Bluetooth printer"}</strong><small className="mono">{p.address}</small></div>
                    <Badge label={p.paired?t.printer_bt_paired:t.printer_bt_nearby} color={p.paired?"green":"purple"}/>
                  </button>
                ))}
              </div>
            )}
            {btStatusMsg&&<div className="bt-printer-status">{btStatusMsg}</div>}
            {!bridgeHasBt&&<div className="bt-printer-no-bridge">{t.printer_bt_no_bridge}</div>}
          </div>
        )}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SUPPORT
// ═══════════════════════════════════════════════════════════════════
// In-app chat replaced with a static Telegram contact link. No state, no
// effects, no Supabase fetches — the only egress is one click out to t.me.
// user prop kept (TS), referenced as void so the signature stays stable
// with the call site at <Support user=... t=...>.
function Support({user,t}:{user:User;t:T}){
  void user;
  return(
    <div className="subpage support-page">
      <div className="subpage-hd"><div><h2>{t.support_title}</h2><p>{t.support_sub}</p></div></div>
      <div className="scard" style={{maxWidth:520,margin:"0 auto",textAlign:"center",padding:"32px 24px"}}>
        <div style={{fontSize:48,marginBottom:12,lineHeight:1}} aria-hidden="true">💬</div>
        <p style={{fontSize:16,lineHeight:1.55,marginBottom:20,color:"#26215C"}}>{t.support_telegram_intro}</p>
        <a
          href={TELEGRAM_URL}
          target="_blank"
          rel="noreferrer noopener"
          className="btn-purple"
          style={{display:"inline-block",textDecoration:"none",padding:"12px 24px"}}
        >
          {t.support_telegram_button}
        </a>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CONNECT MODAL
// ═══════════════════════════════════════════════════════════════════
function AdminPage({currentUser,onApprove,orders,t}:{currentUser:User;onApprove:(email:string,plan:Plan,months?:number)=>void;orders:LiveOrder[];t:T}){
  const normalizeAdminUsers=(list:User[])=>list.map(u=>u.role==="admin"?asAdminPlan(u):u);
  const [users,setUsers]=useState<User[]>([]);
  const [auditLogs,setAuditLogs]=useState<AccountAuditLog[]>(()=>arrLS<AccountAuditLog>("sf_audit_logs"));
  const [freeUsers,setFreeUsers]=useState<FreeUserRow[]>([]);
  const [admins,setAdmins]=useState<string[]>([]);
  const [newSeller,setNewSeller]=useState({email:"",password:"",fullName:"",storeName:""});
  const [editOriginalEmail,setEditOriginalEmail]=useState("");
  const [editSeller,setEditSeller]=useState({email:"",newPassword:"",fullName:"",storeName:"",phone:"",tiktok:"",facebook:""});
  const [adminSearch,setAdminSearch]=useState("");
  const [expandedAdminBox,setExpandedAdminBox]=useState<""|"overview"|"create"|"users"|"planmonitor"|"freeusers"|"audit">("");
  const [adminUserPlanMonths,setAdminUserPlanMonths]=useState<Record<string,number>>({});
  // Separate per-user state for the additive "Add months" control. Kept apart
  // from adminUserPlanMonths so the existing "set from now" dropdown is untouched.
  const [adminUserAddMonths,setAdminUserAddMonths]=useState<Record<string,number>>({});
  // Inline contact-note editor: only one row is in edit mode at a time so a
  // single email + draft pair is enough (no per-row useState explosion). The
  // draft is split into platform + name so the picker buttons can update one
  // dimension without re-parsing/re-formatting the combined string on every
  // keystroke.
  const [editingContactEmail,setEditingContactEmail]=useState("");
  const [contactDraftPlatform,setContactDraftPlatform]=useState<ContactPlatform|"">("");
  const [contactDraftName,setContactDraftName]=useState("");
  const contactInputRef=useRef<HTMLInputElement>(null);
  const [copied,setCopied]=useState("");
  const usersTableRef=useRef<HTMLDivElement>(null);
  const auditTableRef=useRef<HTMLDivElement>(null);
  const adminPageRef=useRef<HTMLDivElement>(null);

  async function refresh(){
    const freshUsers=normalizeAdminUsers(await listUsers());
    setUsers(freshUsers);
    setAdmins(freshUsers.filter(u=>u.role==="admin").map(u=>u.email));
    setAuditLogs(await listAuditLogs());
    if(supabase){
      try{
        const {data}=await supabase.rpc("list_free_users_status");
        setFreeUsers((data as FreeUserRow[])||[]);
      }catch(err){console.warn("list_free_users_status failed:",err);}
    }
  }

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(()=>{
    void refresh();
    // Admin polls users + audit_logs + free-tier RPC. 30s + visibility guard
    // keeps backgrounded tabs from polling at all. (Chat polling removed
    // entirely — sellers contact via Telegram now.)
    const tick=()=>{if(document.visibilityState==="visible")void refresh();};
    const onVis=()=>{if(document.visibilityState==="visible")void refresh();};
    document.addEventListener("visibilitychange",onVis);
    const timer=window.setInterval(tick,30000);
    return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",onVis);};
  },[]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  function approve(email:string,plan:Plan,months=1){
    onApprove(email,plan,months);
    void logAction("approved plan",email,`Plan changed to ${plan} for ${plan==="trial"?7:`${months} month${months===1?"":"s"}`}`);
    setTimeout(refresh,50);
  }

  function defaultMonthsForUser(user:User){
    if(user.plan==="trial")return 1;
    return Math.min(12,Math.max(1,Math.round(dLeft(user.planExpiry)/30)));
  }

  function monthsForUser(user:User){
    return adminUserPlanMonths[user.email.toLowerCase()] ?? defaultMonthsForUser(user);
  }

  function setMonthsForUser(email:string,months:number){
    setAdminUserPlanMonths(current=>({...current,[email.toLowerCase()]:months}));
  }

  function applyMonthsForUser(user:User,months:number){
    setMonthsForUser(user.email,months);
    if(user.plan!=="trial"&&user.planStatus==="active")void setPlan(user.email,user.plan,"active",months);
  }

  function renderUserMonthsSelect(user:User){
    const months=monthsForUser(user);
    return(
      <select
        className="admin-user-month-select"
        value={months}
        onChange={e=>applyMonthsForUser(user,Number(e.target.value))}
        onClick={e=>e.stopPropagation()}
        onDoubleClick={e=>e.stopPropagation()}
      >
        {Array.from({length:12},(_,i)=>i+1).map(month=><option key={month} value={month}>{month} {month===1?"month":"months"}</option>)}
      </select>
    );
  }

  async function logAction(action:string,targetEmail:string,details:string){
    const log={actorEmail:currentUser.email,action,targetEmail,details};
    await saveAuditLog(log);
    setAuditLogs(prev=>[{...log,id:Date.now().toString(),timestamp:new Date().toISOString()},...prev].slice(0,80));
  }

  async function setPlan(email:string,plan:Plan,status:PlanStatus="active",months=1){
    const expiry=status==="expired"?addDays(-1):status==="pending"?new Date().toISOString():plan==="trial"?addDays(7):plan==="free"?addMonths(120):addMonths(months);
    const trialStartedAt=status==="active"&&plan==="trial"?new Date().toISOString():null;
    try{
      await adminUpdatePlan(email,{plan,planStatus:status,planExpiry:expiry,trialStartedAt});
      setUsers(prev=>prev.map(u=>u.email.toLowerCase()===email.toLowerCase()?{...u,plan,planStatus:status,planExpiry:expiry,trialStartedAt:trialStartedAt||""}:u));
      await logAction(status==="expired"?"expired seller":"changed plan",email,`Plan ${plan}, status ${status}, duration ${plan==="trial"?7:`${months} month${months===1?"":"s"}`}`);
    }catch(error){
      setCopied(`Update failed: ${error instanceof Error?error.message:"Unknown error"}`);
    }
  }

  // Additive "Add months" control: reads its own per-user selection (default 1),
  // independent of the existing "set from now" month dropdown.
  function addMonthsForUser(user:User){
    return adminUserAddMonths[user.email.toLowerCase()] ?? 1;
  }
  function setAddMonthsForUser(email:string,months:number){
    setAdminUserAddMonths(current=>({...current,[email.toLowerCase()]:months}));
  }

  // Value-only renewal that ADDS to whatever the seller has left instead of
  // resetting from now(). Active+remaining → current expiry + N*30d; expired →
  // now() + N*30d (reactivated). Keeps the current paid tier; never touches the
  // plan column. Trial/free are left to the existing set buttons.
  async function addMonthsToRemaining(user:User,months:number){
    if(user.plan==="trial"||user.plan==="free")return;
    const add=Math.max(1,months);
    const active=user.planStatus==="active"&&dLeft(user.planExpiry)>0;
    const expiry=addMonthsToExpiry(user.planExpiry,user.planStatus,add);
    try{
      await adminUpdatePlan(user.email,{plan:user.plan,planStatus:"active",planExpiry:expiry});
      setUsers(prev=>prev.map(u=>u.email.toLowerCase()===user.email.toLowerCase()?{...u,plan:user.plan,planStatus:"active" as PlanStatus,planExpiry:expiry}:u));
      await logAction("added months",user.email,`Added ${add} month${add===1?"":"s"} to ${active?"remaining":"expired"} ${user.plan} (new expiry ${expiry})`);
    }catch(error){
      setCopied(`Add months failed: ${error instanceof Error?error.message:"Unknown error"}`);
    }
  }

  // Renders the additive Add-months dropdown + Add button for a seller row.
  // Paid sellers only (matches addMonthsToRemaining's guard).
  function renderAddMonthsControl(user:User){
    if(user.plan==="trial"||user.plan==="free")return null;
    const months=addMonthsForUser(user);
    return(
      <span className="admin-add-months" onClick={e=>e.stopPropagation()}>
        <select
          className="admin-add-month-select"
          value={months}
          onChange={e=>setAddMonthsForUser(user.email,Number(e.target.value))}
          onClick={e=>e.stopPropagation()}
          onDoubleClick={e=>e.stopPropagation()}
        >
          {Array.from({length:12},(_,i)=>i+1).map(month=><option key={month} value={month}>{month} {month===1?"month":"months"}</option>)}
        </select>
        <button className="tbl-btn ed admin-add-months-btn" onClick={()=>void addMonthsToRemaining(user,months)}>Add</button>
      </span>
    );
  }

  // Seed the editor state from the row's current note so the platform picker
  // pre-selects and the input pre-fills. Legacy plain-text notes (no platform
  // prefix) land in the name field with no platform selected, so a save
  // without picking one preserves the legacy value byte-for-byte.
  function beginEditingContact(u:User){
    const parsed=parseContact(u.profile.adminContactNote);
    setEditingContactEmail(u.email);
    setContactDraftPlatform(parsed.platform);
    setContactDraftName(parsed.name);
  }

  function cancelEditingContact(){
    setEditingContactEmail("");
    setContactDraftPlatform("");
    setContactDraftName("");
  }

  // Optimistic save for the inline Contact note. We snapshot the previous value
  // up front so an RLS/network failure can revert the cell without a full
  // listUsers() round-trip. setEditingContactEmail("") fires first as
  // defense-in-depth against the blur-race that the dual-mount gate already
  // prevents.
  async function saveContactNote(email:string,nextNote:string){
    const key=email.toLowerCase();
    const trimmed=nextNote.trim();
    const previous=users.find(u=>u.email.toLowerCase()===key)?.profile.adminContactNote||"";
    setEditingContactEmail("");
    setContactDraftPlatform("");
    setContactDraftName("");
    if(trimmed===previous)return;
    setUsers(prev=>prev.map(u=>u.email.toLowerCase()===key?{...u,profile:{...u.profile,adminContactNote:trimmed}}:u));
    try{
      await adminUpdateContactNote(email,trimmed);
      await logAction("updated contact note",email,trimmed?`Contact note set: ${trimmed}`:"Contact note cleared");
    }catch(error){
      setUsers(prev=>prev.map(u=>u.email.toLowerCase()===key?{...u,profile:{...u.profile,adminContactNote:previous}}:u));
      setCopied(`Contact note save failed: ${error instanceof Error?error.message:"Unknown error"}`);
    }
  }

  // Admin-created accounts require a server-side service_role call (a Supabase
  // Auth user cannot be created with the public anon key). This is wired up in
  // the backend step; for now sellers register themselves.
  function createSeller(){
    setCopied("Creating accounts here needs the secure server step (coming next). For now, ask the seller to register on the login page.");
  }

  function openEditSeller(user:User){
    setEditOriginalEmail(user.email);
    setEditSeller({
      email:user.email,
      newPassword:"",
      fullName:user.profile.fullName,
      storeName:user.profile.storeName,
      phone:user.profile.phone,
      tiktok:user.profile.tiktok,
      facebook:user.profile.facebook,
    });
  }

  async function saveEditSeller(){
    const oldEmail=editOriginalEmail.trim().toLowerCase();
    const current=users.find(u=>u.email.toLowerCase()===oldEmail);
    if(!current){
      setCopied("Seller not found");
      return;
    }
    if(!editSeller.fullName.trim()||!editSeller.storeName.trim()){
      setCopied("Fill seller name and store");
      return;
    }
    if(editSeller.email.trim().toLowerCase()!==oldEmail){
      setCopied("Changing a seller's email needs the secure server step (coming next).");
      return;
    }
    if(editSeller.newPassword.trim()){
      setCopied('Use "Send reset email" to change a seller\'s password.');
      return;
    }
    const editLimit=maxAcc(current.plan);
    const editTikTok=accountList(editSeller.tiktok).slice(0,editLimit);
    const editFacebook=accountList(editSeller.facebook).slice(0,Math.max(0,editLimit-editTikTok.length));
    const updated:User={
      ...current,
      profile:{
        fullName:editSeller.fullName.trim(),
        storeName:editSeller.storeName.trim(),
        phone:editSeller.phone.trim(),
        tiktok:accountText(editTikTok),
        facebook:accountText(editFacebook),
      },
    };
    try{
      await upsertUser(updated);
      setUsers(prev=>prev.map(u=>u.email.toLowerCase()===oldEmail?updated:u));
      await logAction("edited seller",oldEmail,"Profile updated.");
      setEditOriginalEmail("");
      setCopied("Seller updated");
    }catch(error){
      setCopied(`Supabase save failed: ${error instanceof Error?error.message:"Unknown error"}`);
    }
  }

  async function resetPassword(email:string){
    if(!supabase){setCopied("Service unavailable");return;}
    if(!window.confirm(`Send a password reset email to ${email}?`))return;
    const redirectTo=typeof window!=="undefined"?`${window.location.origin}/`:undefined;
    const {error}=await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(),redirectTo?{redirectTo}:undefined);
    if(error){setCopied(`Reset failed: ${error.message}`);return;}
    await logAction("reset password",email,"Password reset email sent");
    setCopied("Password reset email sent");
  }

  async function removeSeller(email:string){
    const cleanEmail=email.toLowerCase();
    if(cleanEmail===currentUser.email.toLowerCase()){setCopied("You cannot delete yourself");return;}
    const target=users.find(u=>u.email.toLowerCase()===cleanEmail);
    if(target?.role==="admin"){setCopied("Remove admin role first before deleting");return;}
    if(!window.confirm(`Delete seller ${email}? This removes their profile and access.`))return;
    try{
      await deleteUser(email);
      setUsers(prev=>prev.filter(u=>u.email.toLowerCase()!==cleanEmail));
      await logAction("deleted seller",email,"Seller profile deleted");
      setCopied("Seller deleted");
    }catch(error){
      setCopied(`Supabase delete failed: ${error instanceof Error?error.message:"Unknown error"}`);
    }
  }

  async function makeAdmin(email:string){
    if(!window.confirm(`Promote ${email} to admin? They will be able to manage all sellers.`))return;
    try{
      await adminUpdatePlan(email,{role:"admin",plan:"master",planStatus:"active",planExpiry:addMonths(120)});
      setUsers(prev=>prev.map(u=>u.email.toLowerCase()===email.toLowerCase()?{...u,role:"admin" as Role,plan:"master" as Plan,planStatus:"active" as PlanStatus,planExpiry:addMonths(120)}:u));
      setAdmins(prev=>Array.from(new Set([...prev,email.toLowerCase()])));
      await logAction("made admin",email,"Seller promoted to admin");
      setCopied("Seller promoted to admin");
    }catch(error){
      setCopied(`Update failed: ${error instanceof Error?error.message:"Unknown error"}`);
    }
  }

  async function removeAdmin(email:string){
    if(email.toLowerCase()===currentUser.email.toLowerCase()){setCopied("You cannot remove yourself");return;}
    try{
      await adminUpdatePlan(email,{role:"seller"});
      setUsers(prev=>prev.map(u=>u.email.toLowerCase()===email.toLowerCase()?{...u,role:"seller" as Role}:u));
      setAdmins(prev=>prev.filter(e=>e!==email.toLowerCase()));
      await logAction("removed admin",email,"Admin access removed");
      setCopied("Admin access removed");
    }catch(error){
      setCopied(`Update failed: ${error instanceof Error?error.message:"Unknown error"}`);
    }
  }


  function scrollBox(el:HTMLDivElement|null,dir:"up"|"down"){
    el?.scrollBy({top:dir==="up"?-220:220,behavior:"smooth"});
  }

  function scrollAdminPage(dir:"up"|"down"){
    const el=adminPageRef.current;
    if(!el)return;
    el.scrollTo({top:dir==="up"?0:el.scrollHeight,behavior:"smooth"});
  }

  const q=adminSearch.trim().toLowerCase();
  const filteredUsers=users.filter(u=>!q||[
    u.email,u.profile.fullName,u.profile.storeName,u.profile.phone,u.profile.tiktok,u.profile.facebook,u.plan,(u.role==="admin")?"admin":"seller"
  ].some(v=>String(v||"").toLowerCase().includes(q)));
  const filteredAuditLogs=auditLogs.filter(log=>!q||[
    log.actorEmail,log.action,log.targetEmail,log.details,log.timestamp
  ].some(v=>String(v||"").toLowerCase().includes(q)));
  const sellerUsers=users.filter(u=>!(u.role==="admin"));
  const pendingApprovalUsers=sellerUsers.filter(u=>u.planStatus==="pending");
  const activeSellers=sellerUsers.filter(u=>u.planStatus==="active"&&dLeft(u.planExpiry)>0);
  const expiredSellers=sellerUsers.filter(u=>u.planStatus==="expired"||dLeft(u.planExpiry)===0);
  const planMonitorUsers=sellerUsers
    .filter(u=>u.planStatus==="expired"||dLeft(u.planExpiry)<=(u.plan==="trial"?3:5))
    .sort((a,b)=>dLeft(a.planExpiry)-dLeft(b.planExpiry));
  // 1-day / already-expired urgency feed for the top-of-page banner. Pure
  // derivation from the existing `users` state — zero new Supabase queries.
  // Excludes admin (already filtered by sellerUsers), free (cap-limited not
  // time-limited), and pending (different flow — they appear in Pending
  // Approvals). Sorted most-urgent first.
  const expiringSoonSellers=sellerUsers
    .filter(u=>u.plan!=="free"&&u.planStatus!=="pending"&&(u.planStatus==="expired"||dLeft(u.planExpiry)<=1))
    .sort((a,b)=>dLeft(a.planExpiry)-dLeft(b.planExpiry));
  // Free-tier monitoring (from list_free_users_status RPC).
  const q2=adminSearch.trim().toLowerCase();
  const freeUsersFiltered=freeUsers.filter(f=>!q2||[f.email,f.store_name,f.full_name].some(v=>String(v||"").toLowerCase().includes(q2)));
  const freeNearCap=freeUsersFiltered.filter(f=>f.near_cap&&!f.capped);
  const freeCappedUsers=freeUsersFiltered.filter(f=>f.capped);
  const freeMonitorUsers=[...freeUsersFiltered].filter(f=>f.near_cap||f.capped).sort((a,b)=>b.count-a.count);
  const freeByEmail=new Map(freeUsers.map(f=>[f.email.toLowerCase(),f]));
  const todayIso=new Date().toISOString().slice(0,10);
  const todayOrders=orders.filter(o=>o.date===todayIso);
  const allStoredOrders=orders;
  const dayStamp=new Date().toISOString().slice(0,10);
  const expandedTitles={"":"Admin",overview:"Overview",create:"Create Seller",users:"Users",planmonitor:"Plan Monitoring",freeusers:"Free Users — Usage Monitor",audit:"Audit Log"};

  function exportUsers(){
    csvDL(`sellerflow-users-${dayStamp}.csv`,["Email","Role","Plan","Plan Status","Days Left","Connected Accounts","Full Name","Store Name","Phone","TikTok","Facebook"],filteredUsers.map(u=>[
      u.email,(u.role==="admin")?"Admin":"Seller",pName(u.plan,t),u.planStatus,dLeft(u.planExpiry),registeredAccountCount(u),u.profile.fullName,u.profile.storeName,u.profile.phone,u.profile.tiktok,u.profile.facebook
    ]));
  }
  function exportAudit(){
    csvDL(`sellerflow-audit-log-${dayStamp}.csv`,["Time","Admin","Action","Target","Details"],filteredAuditLogs.map(log=>[
      log.timestamp,log.actorEmail,log.action,log.targetEmail,log.details
    ]));
  }
  function exportOrders(){
    csvDL(`sellerflow-orders-${dayStamp}.csv`,["Order","Buyer #","Name","Username","Item","Qty","Price","Total","Platform","Status","Date","Time"],allStoredOrders.map(o=>[
      `#SF${o.orderNum}`,o.bNum,o.name,o.handle,o.item,o.qty,o.price,o.total,o.platform,o.status,o.date,o.time
    ]));
  }
  function exportAdminBackup(){
    jsonDL(`sellerflow-admin-backup-${dayStamp}.json`,{
      exportedAt:new Date().toISOString(),
      owner:OWNER_EMAIL,
      users,
      auditLogs,
      orders:allStoredOrders,
      summary:{
        sellers:sellerUsers.length,
        active:activeSellers.length,
        expired:expiredSellers.length,
        todayOrders:todayOrders.length,
      },
    });
  }

  if(!isAdminUser(currentUser)){
    return <div className="subpage"><div className="auth-err">Admin only.</div></div>;
  }

  return(
    <div className="subpage admin-page" ref={adminPageRef}>
      {copied&&<Toast msg={copied} onDone={()=>setCopied("")}/>}
      <div className="admin-page-scroll-tools">
        <button onClick={()=>scrollAdminPage("up")} title="Go to top">^</button>
        <button onClick={()=>scrollAdminPage("down")} title="Go to bottom">v</button>
      </div>
      <div className="subpage-hd">
        <div>
          <h2>Admin</h2>
          <p>Owner: (you) · Admins: {admins.length}</p>
        </div>
        <div className="admin-refresh-group">
          <span>Auto refresh: 10s</span>
          <button className="btn-out" onClick={refresh}>Refresh</button>
        </div>
      </div>

      {expiringSoonSellers.length>0&&(
        <div className="notice-box" style={{background:"#FEE2E2",border:"1px solid #FCA5A5",borderRadius:8,padding:"12px 16px",fontSize:13,color:"#991B1B",marginBottom:8,fontWeight:600}}>
          ⚠️ {expiringSoonSellers.length} {expiringSoonSellers.length===1?t.expiry_banner_one:t.expiry_banner_many}
          <span style={{fontWeight:400}}> — {expiringSoonSellers.slice(0,5).map(u=>u.profile.storeName||u.email).join(", ")}{expiringSoonSellers.length>5?` +${expiringSoonSellers.length-5}`:""}</span>
        </div>
      )}

      <div className="admin-searchbar">
        <span className="admin-search-ic">⌕</span>
        <input value={adminSearch} onChange={e=>setAdminSearch(e.target.value)} placeholder="Search users, payments, audit log"/>
        {adminSearch&&<button className="admin-search-clear" onClick={()=>setAdminSearch("")}>Clear</button>}
      </div>

      <div className="admin-exportbar admin-compact">
        <button className="btn-out" onClick={exportUsers}>Export Users CSV</button>
        <button className="btn-out" onClick={exportAudit}>Export Audit CSV</button>
        <button className="btn-out" onClick={exportOrders}>Export Orders CSV</button>
        <button className="btn-out" onClick={exportAdminBackup}>Export Admin Backup</button>
      </div>

      <div className="admin-quick-grid">
        <button className="admin-action-card" onDoubleClick={()=>setExpandedAdminBox("overview")}>
          <div className="ms-l">Overview</div><div className="ms-v">{sellerUsers.length}</div><span>{activeSellers.length} active, {expiredSellers.length} expired</span>
        </button>
        <button className="admin-action-card" onDoubleClick={()=>setExpandedAdminBox("create")}>
          <div className="ms-l">Create Seller</div><div className="ms-v">+</div><span>Add a seller account fast</span>
        </button>
        <button className={`admin-action-card ${pendingApprovalUsers.length>0?"has-pending":""}`} onDoubleClick={()=>setExpandedAdminBox("users")}>
          <div className="ms-l">Pending Approvals</div><div className="ms-v" style={pendingApprovalUsers.length>0?{color:"#BA7517"}:undefined}>{pendingApprovalUsers.length}</div><span>{pendingApprovalUsers.length>0?"New sign-ups waiting — double-click to review":"No sign-ups waiting"}</span>
        </button>
      </div>

      <div className="table-card admin-compact-card" style={{marginBottom:12}} onDoubleClick={()=>setExpandedAdminBox("users")}>
          <div className="table-title admin-expandable-title">Users ({users.length})<span className="expand-hint">⤢ double-click to expand</span></div>
          <div className="admin-table-wrap">
            <div className="admin-table-scroll" ref={usersTableRef}>
              <table className="tbl">
                <thead><tr><th>Email</th><th>Contact</th><th>Role</th><th>Plan</th><th>Free Cycle</th><th>Days</th><th>Months</th><th>Add</th><th>Accounts</th><th></th></tr></thead>
                <tbody>
                  {filteredUsers.length===0&&<tr><td colSpan={10} style={{textAlign:"center",padding:24,color:"#888"}}>{users.length===0?"No users yet.":"No users found."}</td></tr>}
                  {filteredUsers.map(u=>{const fr=freeByEmail.get(u.email.toLowerCase());return(
                    <tr key={u.email} className={u.planStatus==="pending"?"row-pending":undefined}>
                      <td><strong>{u.email}</strong><div className="muted" style={{fontSize:11}}>{u.profile.storeName||u.profile.fullName}</div>{u.planStatus==="pending"&&<div style={{marginTop:3}}><Badge label="Pending Approval" color="amber"/></div>}</td>
                      {(() => {
                        // Editing is "live" in this view only when the expanded
                        // panel isn't covering it. Otherwise both this <input>
                        // and the expanded one would mount with autoFocus, the
                        // later mount would steal focus, and the resulting blur
                        // here would clear editingContactEmail and instantly
                        // unmount both editors.
                        const isEditingHere=editingContactEmail===u.email&&expandedAdminBox!=="users";
                        return(
                        <td
                          onClick={e=>{e.stopPropagation();if(isEditingHere)return;beginEditingContact(u);}}
                          onDoubleClick={e=>e.stopPropagation()}
                          title={isEditingHere?undefined:"Click to edit"}
                          style={{cursor:isEditingHere?"default":"pointer",userSelect:"none"}}
                        >{isEditingHere
                          ? <ContactEditor
                              platform={contactDraftPlatform}
                              name={contactDraftName}
                              setPlatform={setContactDraftPlatform}
                              setName={setContactDraftName}
                              inputRef={contactInputRef}
                              onSave={()=>saveContactNote(u.email,formatContact(contactDraftPlatform,contactDraftName))}
                              onCancel={cancelEditingContact}
                              minWidth={140}/>
                          : <ContactDisplay note={u.profile.adminContactNote}/>}</td>
                        );
                      })()}
                      <td><Badge label={(u.role==="admin")?"Admin":"Seller"} color={(u.role==="admin")?"amber":"gray"}/></td>
                      <td><Badge label={pName(u.plan,t)} color={pColor(u.plan)}/></td>
                      <td>{u.plan==="free"&&fr?<span style={{color:fr.capped?"#A32D2D":fr.near_cap?"#BA7517":"#1D9E75",fontWeight:600}}>{fr.count}/{fr.cap} · {fr.cycle_resets_in_days}d</span>:<span className="muted">—</span>}</td>
                      <td style={u.plan==="free"?undefined:daysCellStyle(dLeft(u.planExpiry))}>{dLeft(u.planExpiry)}</td>
                      <td>{renderUserMonthsSelect(u)}</td>
                      <td>{renderAddMonthsControl(u)}</td>
                      <td>{registeredAccountCount(u)} / {maxAcc(u.plan)}</td>
                      <td>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          <button className="tbl-btn ed" onClick={()=>openEditSeller(u)}>Edit</button>
                          <button className="tbl-btn ed" onClick={()=>resetPassword(u.email)}>Reset PW</button>
                          <button className="tbl-btn ed" onClick={()=>setPlan(u.email,"free")}>Free</button>
                          <button className="tbl-btn ed" onClick={()=>setPlan(u.email,"basic","active",monthsForUser(u))}>Basic</button>
                          <button className="tbl-btn ed" onClick={()=>approve(u.email,"pro",monthsForUser(u))}>Pro</button>
                          <button className="tbl-btn ed" onClick={()=>approve(u.email,"master",monthsForUser(u))}>Master</button>
                          <button className="tbl-btn dl" onClick={()=>setPlan(u.email,u.plan,"expired")}>Expire</button>
                          {!(u.role==="admin")
                            ? <><button className="tbl-btn ed" onClick={()=>makeAdmin(u.email)}>Make Admin</button><button className="tbl-btn dl" onClick={()=>removeSeller(u.email)}>Delete</button></>
                            : <button className="tbl-btn dl" onClick={()=>removeAdmin(u.email)}>Remove Admin</button>}
                        </div>
                      </td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
            <div className="admin-scroll-tools"><button onClick={()=>scrollBox(usersTableRef.current,"up")}>^</button><button onClick={()=>scrollBox(usersTableRef.current,"down")}>v</button></div>
          </div>
        </div>

      <div className="table-card admin-compact-card" style={{marginBottom:12}} onDoubleClick={()=>setExpandedAdminBox("planmonitor")}>
        <div className="table-title admin-expandable-title">Plan Monitoring ({planMonitorUsers.length})<span className="expand-hint">⤢ double-click to expand</span></div>
        <div className="admin-table-wrap">
          <div className="admin-table-scroll">
            <table className="tbl">
              <thead><tr><th>Seller</th><th>Plan</th><th>Days</th><th>Status</th><th>Auto message</th><th></th></tr></thead>
              <tbody>
                {planMonitorUsers.length===0&&<tr><td colSpan={6} style={{textAlign:"center",padding:24,color:"#888"}}>No sellers expiring soon.</td></tr>}
                {planMonitorUsers.map(u=>{
                  const days=dLeft(u.planExpiry);
                  const expired=u.planStatus==="expired"||days===0;
                  const warnDays=u.plan==="trial"?3:5;
                  return(
                    <tr key={`monitor-${u.email}`}>
                      <td><strong>{u.email}</strong><div className="muted" style={{fontSize:11}}>{u.profile.storeName||u.profile.fullName}</div></td>
                      <td><Badge label={pName(u.plan,t)} color={pColor(u.plan)}/></td>
                      <td>{days}</td>
                      <td><Badge label={expired?"Expired":"Expiring"} color={expired?"red":"amber"}/></td>
                      <td className="muted">{expired?"Sent on expiry day":`Sends ${warnDays} days before expiry`}</td>
                      <td><button className="tbl-btn ed" onClick={()=>approve(u.email,u.plan==="trial"?"basic":u.plan,monthsForUser(u))}>Extend / approve</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="table-card admin-compact-card" style={{marginBottom:12}} onDoubleClick={()=>setExpandedAdminBox("freeusers")}>
        <div className="table-title admin-expandable-title">
          <span>Free Users — Usage Monitor ({freeUsersFiltered.length})</span>
          {freeNearCap.length>0&&<Badge label={`${freeNearCap.length} near cap`} color="amber"/>}
          {freeCappedUsers.length>0&&<Badge label={`${freeCappedUsers.length} capped`} color="red"/>}
          <span className="expand-hint">⤢ double-click to expand</span>
        </div>
        <div className="admin-table-wrap">
          <div className="admin-table-scroll">
            <table className="tbl">
              <thead><tr><th>Seller</th><th>Orders this cycle</th><th>Status</th><th>Resets in</th><th></th></tr></thead>
              <tbody>
                {freeUsersFiltered.length===0&&<tr><td colSpan={5} style={{textAlign:"center",padding:24,color:"#888"}}>No free users yet.</td></tr>}
                {freeUsersFiltered.length>0&&freeMonitorUsers.length===0&&<tr><td colSpan={5} style={{textAlign:"center",padding:24,color:"#888"}}>No free users near the cap. ({freeUsersFiltered.length} free user{freeUsersFiltered.length===1?"":"s"} tracked.)</td></tr>}
                {freeMonitorUsers.map(f=>(
                  <tr key={`free-${f.email}`}>
                    <td><strong>{f.email}</strong><div className="muted" style={{fontSize:11}}>{f.store_name||f.full_name}</div></td>
                    <td><strong style={{color:f.capped?"#A32D2D":f.near_cap?"#BA7517":"#1D9E75"}}>{f.count}</strong> / {f.cap}</td>
                    <td><Badge label={f.capped?"Capped":"Near cap"} color={f.capped?"red":"amber"}/></td>
                    <td>{f.cycle_resets_in_days}d</td>
                    <td><button className="tbl-btn ed" onClick={()=>approve(f.email,"basic",monthsForUser(users.find(u=>u.email.toLowerCase()===f.email.toLowerCase())||currentUser))}>Promote to Basic</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="table-card admin-compact-card" onDoubleClick={()=>setExpandedAdminBox("audit")}>
        <div className="table-title admin-expandable-title">Audit Log ({auditLogs.length})<span className="expand-hint">⤢ double-click to expand</span></div>
        <div className="admin-table-wrap">
          <div className="admin-table-scroll audit" ref={auditTableRef}>
            <table className="tbl">
              <thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
              <tbody>
                {filteredAuditLogs.length===0&&<tr><td colSpan={5} style={{textAlign:"center",padding:24,color:"#888"}}>{auditLogs.length===0?"No admin activity yet.":"No audit records found."}</td></tr>}
                {filteredAuditLogs.map(log=>(
                  <tr key={log.id}>
                    <td className="muted" style={{whiteSpace:"nowrap"}}>{new Date(log.timestamp).toLocaleString()}</td>
                    <td><strong>{log.actorEmail}</strong></td>
                    <td><Badge label={log.action} color={log.action.includes("delete")||log.action.includes("reject")?"red":log.action.includes("approve")||log.action.includes("created")?"green":"purple"}/></td>
                    <td>{log.targetEmail}</td>
                    <td className="muted">{log.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="admin-scroll-tools"><button onClick={()=>scrollBox(auditTableRef.current,"up")}>^</button><button onClick={()=>scrollBox(auditTableRef.current,"down")}>v</button></div>
        </div>
      </div>
      {expandedAdminBox&&(
        <div className="admin-fullscreen-panel">
          <div className="admin-fullscreen-head">
            <button className="btn-out" onClick={()=>setExpandedAdminBox("")}>Back</button>
            <div><h2>{expandedTitles[expandedAdminBox]}</h2><p>Double-click opened this admin box.</p></div>
          </div>
          <div className="admin-fullscreen-body">
            {expandedAdminBox==="overview"&&<div className="admin-fullscreen-grid">
              <div className="mstat"><div className="ms-l">Sellers</div><div className="ms-v">{sellerUsers.length}</div></div>
              <div className="mstat"><div className="ms-l">Active</div><div className="ms-v" style={{color:"#14966F"}}>{activeSellers.length}</div></div>
              <div className="mstat"><div className="ms-l">Expired</div><div className="ms-v" style={{color:"#A32D2D"}}>{expiredSellers.length}</div></div>
              <div className="mstat"><div className="ms-l">Today Orders</div><div className="ms-v">{todayOrders.length}</div></div>
            </div>}
            {expandedAdminBox==="create"&&<div className="scard admin-fullscreen-create">
              <div className="scard-title">Create Seller Account</div>
              <div className="grid4">
                <Fg label="Email"><input value={newSeller.email} onChange={e=>setNewSeller(s=>({...s,email:e.target.value}))} placeholder="seller@email.com"/></Fg>
                <Fg label="Temporary password"><input type="password" value={newSeller.password} onChange={e=>setNewSeller(s=>({...s,password:e.target.value}))} placeholder="Minimum 6 chars"/></Fg>
                <Fg label="Full name"><input value={newSeller.fullName} onChange={e=>setNewSeller(s=>({...s,fullName:e.target.value}))} placeholder="Seller name"/></Fg>
                <Fg label="Store name"><input value={newSeller.storeName} onChange={e=>setNewSeller(s=>({...s,storeName:e.target.value}))} placeholder="Store name"/></Fg>
              </div>
              <button className="btn-purple" onClick={createSeller}>Create seller</button>
            </div>}
            {expandedAdminBox==="users"&&<div className="table-card admin-fullscreen-table">
              <div className="table-title">Users ({filteredUsers.length})</div>
              <table className="tbl"><thead><tr><th>Email</th><th>Contact</th><th>Role</th><th>Plan</th><th>Free Cycle</th><th>Days</th><th>Months</th><th>Add</th><th>Accounts</th><th>Actions</th></tr></thead><tbody>
                {filteredUsers.map(u=>{const fr=freeByEmail.get(u.email.toLowerCase());return(
                <tr key={"expanded-"+u.email} className={u.planStatus==="pending"?"row-pending":undefined}>
                  <td><strong>{u.email}</strong><div className="muted" style={{fontSize:11}}>{u.profile.storeName||u.profile.fullName}</div>{u.planStatus==="pending"&&<div style={{marginTop:3}}><Badge label="Pending Approval" color="amber"/></div>}</td>
                  <td
                    onClick={e=>{e.stopPropagation();if(editingContactEmail===u.email)return;beginEditingContact(u);}}
                    title={editingContactEmail===u.email?undefined:"Click to edit"}
                    style={{cursor:editingContactEmail===u.email?"default":"pointer",userSelect:"none"}}
                  >{editingContactEmail===u.email
                    ? <ContactEditor
                        platform={contactDraftPlatform}
                        name={contactDraftName}
                        setPlatform={setContactDraftPlatform}
                        setName={setContactDraftName}
                        inputRef={contactInputRef}
                        onSave={()=>saveContactNote(u.email,formatContact(contactDraftPlatform,contactDraftName))}
                        onCancel={cancelEditingContact}
                        minWidth={170}/>
                    : <ContactDisplay note={u.profile.adminContactNote}/>}</td>
                  <td><Badge label={(u.role==="admin")?"Admin":"Seller"} color={(u.role==="admin")?"amber":"gray"}/></td>
                  <td><Badge label={pName(u.plan,t)} color={pColor(u.plan)}/></td>
                  <td>{u.plan==="free"&&fr?<span style={{color:fr.capped?"#A32D2D":fr.near_cap?"#BA7517":"#1D9E75",fontWeight:600}}>{fr.count}/{fr.cap} · {fr.cycle_resets_in_days}d</span>:<span className="muted">—</span>}</td>
                  <td style={u.plan==="free"?undefined:daysCellStyle(dLeft(u.planExpiry))}>{dLeft(u.planExpiry)}</td>
                  <td>{renderUserMonthsSelect(u)}</td>
                  <td>{renderAddMonthsControl(u)}</td>
                  <td>{registeredAccountCount(u)} / {maxAcc(u.plan)}</td>
                  <td>
                    <div className="admin-row-actions">
                      <button className="tbl-btn ed" onClick={()=>openEditSeller(u)}>Edit</button>
                      <button className="tbl-btn ed" onClick={()=>resetPassword(u.email)}>Reset PW</button>
                      <button className="tbl-btn ed" onClick={()=>setPlan(u.email,"free")}>Free</button>
                      <button className="tbl-btn ed" onClick={()=>setPlan(u.email,"basic","active",monthsForUser(u))}>Basic</button>
                      <button className="tbl-btn ed" onClick={()=>approve(u.email,"pro",monthsForUser(u))}>Pro</button>
                      <button className="tbl-btn ed" onClick={()=>approve(u.email,"master",monthsForUser(u))}>Master</button>
                      <button className="tbl-btn dl" onClick={()=>setPlan(u.email,u.plan,"expired")}>Expire</button>
                      {!(u.role==="admin")
                        ? <><button className="tbl-btn ed" onClick={()=>makeAdmin(u.email)}>Make Admin</button><button className="tbl-btn dl" onClick={()=>removeSeller(u.email)}>Delete</button></>
                        : <button className="tbl-btn dl" onClick={()=>removeAdmin(u.email)}>Remove Admin</button>}
                    </div>
                  </td>
                </tr>
                );})}
              </tbody></table>
            </div>}
            {expandedAdminBox==="planmonitor"&&<div className="table-card admin-fullscreen-table">
              <div className="table-title">Plan Monitoring ({planMonitorUsers.length})</div>
              <table className="tbl"><thead><tr><th>Seller</th><th>Plan</th><th>Days</th><th>Status</th><th>Auto message</th><th></th></tr></thead><tbody>
                {planMonitorUsers.length===0&&<tr><td colSpan={6} style={{textAlign:"center",padding:24,color:"#888"}}>No sellers expiring soon.</td></tr>}
                {planMonitorUsers.map(u=>{
                  const days=dLeft(u.planExpiry);
                  const expired=u.planStatus==="expired"||days===0;
                  const warnDays=u.plan==="trial"?3:5;
                  return(
                    <tr key={`expanded-monitor-${u.email}`}>
                      <td><strong>{u.email}</strong><div className="muted" style={{fontSize:11}}>{u.profile.storeName||u.profile.fullName}</div></td>
                      <td><Badge label={pName(u.plan,t)} color={pColor(u.plan)}/></td>
                      <td>{days}</td>
                      <td><Badge label={expired?"Expired":"Expiring"} color={expired?"red":"amber"}/></td>
                      <td className="muted">{expired?"Sent on expiry day":`Sends ${warnDays} days before expiry`}</td>
                      <td><button className="tbl-btn ed" onClick={()=>approve(u.email,u.plan==="trial"?"basic":u.plan,monthsForUser(u))}>Extend / approve</button></td>
                    </tr>
                  );
                })}
              </tbody></table>
            </div>}
            {expandedAdminBox==="freeusers"&&<div className="table-card admin-fullscreen-table">
              <div className="table-title">
                <span>Free Users — Usage Monitor ({freeUsersFiltered.length})</span>
                {freeNearCap.length>0&&<Badge label={`${freeNearCap.length} near cap`} color="amber"/>}
                {freeCappedUsers.length>0&&<Badge label={`${freeCappedUsers.length} capped`} color="red"/>}
              </div>
              <table className="tbl"><thead><tr><th>Seller</th><th>Orders this cycle</th><th>Status</th><th>Resets in</th><th></th></tr></thead><tbody>
                {freeUsersFiltered.length===0&&<tr><td colSpan={5} style={{textAlign:"center",padding:24,color:"#888"}}>No free users yet.</td></tr>}
                {freeUsersFiltered.map(f=>(
                  <tr key={`expanded-free-${f.email}`}>
                    <td><strong>{f.email}</strong><div className="muted" style={{fontSize:11}}>{f.store_name||f.full_name}</div></td>
                    <td><strong style={{color:f.capped?"#A32D2D":f.near_cap?"#BA7517":"#1D9E75"}}>{f.count}</strong> / {f.cap}</td>
                    <td><Badge label={f.capped?"Capped":f.near_cap?"Near cap":"OK"} color={f.capped?"red":f.near_cap?"amber":"green"}/></td>
                    <td>{f.cycle_resets_in_days}d</td>
                    <td><button className="tbl-btn ed" onClick={()=>approve(f.email,"basic",monthsForUser(users.find(u=>u.email.toLowerCase()===f.email.toLowerCase())||currentUser))}>Promote to Basic</button></td>
                  </tr>
                ))}
              </tbody></table>
            </div>}
            {expandedAdminBox==="audit"&&<div className="table-card admin-fullscreen-table">
              <div className="table-title">Audit Log ({auditLogs.length})</div>
              <table className="tbl"><thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th></tr></thead><tbody>
                {filteredAuditLogs.length===0&&<tr><td colSpan={5} style={{textAlign:"center",padding:24,color:"#888"}}>{auditLogs.length===0?"No admin activity yet.":"No audit records found."}</td></tr>}
                {filteredAuditLogs.map(log=>(
                  <tr key={"expanded-"+log.id}>
                    <td className="muted" style={{whiteSpace:"nowrap"}}>{new Date(log.timestamp).toLocaleString()}</td>
                    <td><strong>{log.actorEmail}</strong></td>
                    <td><Badge label={log.action} color={log.action.includes("delete")||log.action.includes("reject")?"red":log.action.includes("approve")||log.action.includes("created")?"green":"purple"}/></td>
                    <td>{log.targetEmail}</td>
                    <td className="muted">{log.details}</td>
                  </tr>
                ))}
              </tbody></table>
            </div>}
          </div>
        </div>
      )}
      {editOriginalEmail&&(
        <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&setEditOriginalEmail("")}>
          <div className="modal" style={{maxWidth:620}}>
            <div className="modal-hd"><span>Edit Seller</span><button onClick={()=>setEditOriginalEmail("")} className="modal-x">?</button></div>
            <div className="modal-body">
              <div className="grid2">
                <Fg label="Email"><input value={editSeller.email} onChange={e=>setEditSeller(s=>({...s,email:e.target.value}))}/></Fg>
                <Fg label="New password (optional)"><input type="password" value={editSeller.newPassword} onChange={e=>setEditSeller(s=>({...s,newPassword:e.target.value}))} placeholder="Leave blank to keep current password"/></Fg>
                <Fg label="Full name"><input value={editSeller.fullName} onChange={e=>setEditSeller(s=>({...s,fullName:e.target.value}))}/></Fg>
                <Fg label="Store name"><input value={editSeller.storeName} onChange={e=>setEditSeller(s=>({...s,storeName:e.target.value}))}/></Fg>
                <Fg label="Phone"><input value={editSeller.phone} onChange={e=>setEditSeller(s=>({...s,phone:e.target.value}))}/></Fg>
                <Fg label="TikTok accounts"><textarea rows={3} value={editSeller.tiktok} onChange={e=>setEditSeller(s=>({...s,tiktok:e.target.value}))} placeholder="One account per line"/></Fg>
                <Fg label="Facebook pages"><textarea rows={3} value={editSeller.facebook} onChange={e=>setEditSeller(s=>({...s,facebook:e.target.value}))} placeholder="One page per line"/></Fg>
              </div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:8}}>
                <button className="btn-out" onClick={()=>setEditOriginalEmail("")}>Cancel</button>
                <button className="btn-purple" onClick={saveEditSeller}>Save seller</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ConnectModal({onClose,onConnect,user,t,initialTab="TikTok"}:{onClose:()=>void;onConnect:(p:"TikTok"|"Facebook",d:Record<string,string>)=>Promise<void>|void;user:User;t:T;initialTab?:"TikTok"|"Facebook"}){
  const [tab,setTab]=useState<"TikTok"|"Facebook">(initialTab);
  const [ttu,setTtu]=useState("");const [fbId,setFbId]=useState("");const [fbTok,setFbTok]=useState("");const [busy,setBusy]=useState(false);
  const registeredTikTok=accountList(user.profile.tiktok).slice(0,maxAcc(user.plan));
  const registeredFacebook=accountList(user.profile.facebook).slice(0,maxAcc(user.plan));
  const [selectedTikTok,setSelectedTikTok]=useState(registeredTikTok[0]||"");
  const [selectedFacebook,setSelectedFacebook]=useState(registeredFacebook[0]||"");
  const registered=tab==="TikTok"?registeredTikTok:registeredFacebook;
  const canAdd=canConnectMore(user);
  const canUseExisting=registered.length>0;
  const canConnect=canUseExisting||canAdd;
  const tiktokValue=selectedTikTok||ttu;
  const facebookValue=selectedFacebook||fbId;
  async function connect(){
    if(!canConnect)return;
    setBusy(true);
    try{
      if(tab==="TikTok")await onConnect("TikTok",{username:tiktokValue});
      else await onConnect("Facebook",{liveVideoId:facebookValue,accessToken:fbTok});
      onClose();
    }finally{
      setBusy(false);
    }
  }
  function chooseRegistered(value:string){
    if(tab==="TikTok")setSelectedTikTok(value);
    else setSelectedFacebook(value);
  }
  return(
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&!busy&&onClose()}>
      <div className="modal">
        <div className="modal-hd"><span>{t.connect_title}</span><button onClick={onClose} className="modal-x">×</button></div>
        {!canConnect&&<div className="auth-err" style={{margin:"10px 16px 0"}}>⚠ {t.plan_limit}</div>}
        <div className="modal-tabs">{(["TikTok","Facebook"] as const).map(tb=><button key={tb} onClick={()=>setTab(tb)} className={`mtab ${tab===tb?"on":""}`}>{tb}</button>)}</div>
        <div className="modal-body">
          {canUseExisting?(
            <div className="registered-account-picker">
              <div className="notice-box" style={{background:"#F5F4FF",border:"1px solid #D8D3FF",color:"#26215C"}}>
                {tpl(t.conn_select_registered,{kind:tab==="TikTok"?t.set_tiktok_account:t.set_facebook_page})}
              </div>
              {registered.map(account=>(
                <button
                  key={account}
                  type="button"
                  className={`registered-account-btn ${account===(tab==="TikTok"?tiktokValue:facebookValue)?"on":""}`}
                  onClick={()=>chooseRegistered(account)}
                >
                  <strong>{account}</strong>
                  <span>{tab}</span>
                </button>
              ))}
            </div>
          ):tab==="TikTok"?(<><div className="notice-box" style={{background:"#FFF8E1",border:"1px solid #F5DDA0",color:"#633806"}}>⚠ {t.tt_warning}</div><Fg label={t.conn_tiktok_username_label}><input value={tiktokValue} onChange={e=>setTtu(e.target.value)} placeholder="e.g. duonglily_0708" disabled={!canAdd}/></Fg></>):(<><div className="notice-box" style={{background:"#E1F5EE",border:"1px solid #9FE1CB",color:"#0F6E56"}}>{t.fb_hint}</div><Fg label={t.fb_video_id}><input value={facebookValue} onChange={e=>setFbId(e.target.value)} disabled={!canAdd}/></Fg><Fg label={t.fb_token}><input value={fbTok} onChange={e=>setFbTok(e.target.value)} type="password" disabled={!canConnect}/></Fg></>)}
          <button onClick={connect} disabled={busy||!canConnect} className="btn-purple" style={{width:"100%",padding:"10px 0",marginTop:4}}>{busy?t.connecting:canConnect?`${t.connect_btn} ${tab}`:t.upgrade_to_connect}</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════
export default function App(){
  const [lang,setLangState]=useState<Lang>(()=>{try{return safeLang(JSON.parse(localStorage.getItem("sf_lang")||'"en"'));}catch{return "en";}});
  const t=TRANSLATIONS[lang]||TRANSLATIONS.en;
  function setLang(l:Lang){const next=safeLang(l);setLangState(next);try{localStorage.setItem("sf_lang",JSON.stringify(next));}catch{return;}}

  const forceLogin=consumeForceLoginParam();
  // Optimistic hydration from the cached profile; the Supabase session check
  // below confirms it and logs the user out if there is no valid session.
  const [user,setUser]=useState<User|null>(()=>{if(forceLogin)return null;const cached=safeUser(LS.get<unknown>("sf_session_user",null));return cached?asAdminPlan(cached):null;});
  const [accountGate,setAccountGate]=useState(()=>{
    if(forceLogin||typeof window==="undefined")return false;
    const saved=LS.get<string>("sf_session","");
    if(!saved)return false;
    const params=new URLSearchParams(window.location.search);
    const directMode=params.get("directPrint")==="1"||LS.get<boolean>("sf_direct_print_mode",false);
    const confirmed=window.sessionStorage.getItem("sf_account_gate_ok")===saved;
    return directMode&&!confirmed;
  });
  const [settings,setSettingsState]=useState<Settings>(()=>{
    const saved=LS.get<Partial<Settings>>("sf_settings",{});
    return {...DEF_SETTINGS,...saved,currency:cleanCurrency(saved.currency)};
  });
  const [page,setPage]=useState<Page>("dashboard");
  // True while a Supabase PASSWORD_RECOVERY session is active (seller clicked the
  // reset link in their email). Gates the ResetPasswordPage ahead of login.
  // Initialized from the URL hash so the reset form shows even if detectSessionInUrl
  // consumes the #...type=recovery fragment before the auth event subscription
  // attaches; the PASSWORD_RECOVERY event below is the primary trigger.
  const [recoveryMode,setRecoveryMode]=useState(()=>typeof window!=="undefined"&&window.location.hash.includes("type=recovery"));
  const initialSellerEmail=LS.get<string>("sf_session","");
  const currentSessionId=browserSessionId();
  const [currentLiveDayId,setCurrentLiveDayId]=useState(()=>liveDayId());
  const [comments,setComments]=useState<Comment[]>(()=>sortCommentsNewest(cleanComments(LS.get<unknown[]>(sellerLiveDataKey("sf_comments",initialSellerEmail,currentSessionId),[]))).slice(0,LIVE_COMMENT_LIMIT));
  const [archivedComments,setArchivedComments]=useState<Comment[]>(()=>sortCommentsNewest(cleanComments(LS.get<unknown[]>(sellerLiveDataKey("sf_comment_archive",initialSellerEmail,currentSessionId),[]))).slice(0,COMMENT_ARCHIVE_LIMIT));
  const [buyers,setBuyers]=useState<Buyer[]>(()=>sellerDayOrSessionArray<Buyer>("sf_buyers",initialSellerEmail,currentLiveDayId,currentSessionId));
  const [allOrders,setAllOrders]=useState<LiveOrder[]>(()=>sellerDayOrSessionArray<LiveOrder>("sf_orders",initialSellerEmail,currentLiveDayId,currentSessionId));
  const [selBuyer,setSelBuyer]=useState<Buyer|null>(null);
  const [totOrd,setTotOrd]=useState(()=>{
    const storedOrders=sellerDayOrSessionArray<LiveOrder>("sf_orders",initialSellerEmail,currentLiveDayId,currentSessionId);
    return storedOrders.length||sellerDayOrSessionArray<Buyer>("sf_buyers",initialSellerEmail,currentLiveDayId,currentSessionId).reduce((s,b)=>s+b.totalOrders,0);
  });
  const [totRev,setTotRev]=useState(()=>{
    const storedOrders=sellerDayOrSessionArray<LiveOrder>("sf_orders",initialSellerEmail,currentLiveDayId,currentSessionId);
    return storedOrders.length?storedOrders.reduce((s,o)=>s+o.total,0):sellerDayOrSessionArray<Buyer>("sf_buyers",initialSellerEmail,currentLiveDayId,currentSessionId).reduce((s,b)=>s+b.totalSpent,0);
  });
  const [ttOn,setTtOn]=useState(false);const [fbOn,setFbOn]=useState(false);
  const [activeLiveAccounts,setActiveLiveAccounts]=useState<{TikTok:string;Facebook:string}>({TikTok:"",Facebook:""});
  const activeLiveAccountsRef=useRef(activeLiveAccounts);
  const [showConn,setShowConn]=useState(false);const [showProf,setShowProf]=useState(false);
  const [connectTab,setConnectTab]=useState<"TikTok"|"Facebook">("TikTok");
  const [printed,setPrinted]=useState<Set<string>>(()=>new Set(sellerDayOrSessionArray<string>("sf_printed",initialSellerEmail,currentLiveDayId,currentSessionId)));
  const [openCommentMenu,setOpenCommentMenu]=useState<number|null>(null);
  const [commentPrices,setCommentPrices]=useState<Record<string,string>>({});
  const priceInputRefs=useRef<Record<string,HTMLInputElement|null>>({});
  const [pendingUsersCount,setPendingUsersCount]=useState(0);
  const [expiringSoonCount,setExpiringSoonCount]=useState(0);
  const [mobileMinerSearch,setMobileMinerSearch]=useState("");
  const [toast,setToast]=useState("");
  // Free-tier usage state + which cap popup (if any) is open.
  const [freeStatus,setFreeStatus]=useState<FreeStatus|null>(null);
  const [capPopup,setCapPopup]=useState<""|"near"|"hard">("");
  const feedRef=useRef<HTMLDivElement>(null);
  const today=new Date().toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"});
  const [nowTick,setNowTick]=useState(()=>Date.now());
  useEffect(()=>{activeLiveAccountsRef.current=activeLiveAccounts;},[activeLiveAccounts]);
  useEffect(()=>{
    const timer=window.setInterval(()=>setNowTick(Date.now()),60000);
    return()=>window.clearInterval(timer);
  },[]);
  useEffect(()=>{
    const timer=window.setInterval(()=>{
      const next=liveDayId();
      setCurrentLiveDayId(prev=>prev===next?prev:next);
    },30000);
    return()=>window.clearInterval(timer);
  },[]);
  const sellerMemoryEmail=()=>user?.email||initialSellerEmail;
  const sellerMemoryKey=(base:string)=>sellerDailyDataKey(base,sellerMemoryEmail(),currentLiveDayId);
  function saveBuyerMemory(next:Buyer[]){
    setBuyers(next);
    LS.set(sellerMemoryKey("sf_buyers"),next);
    setTotOrd(next.reduce((s,b)=>s+b.totalOrders,0));
    setTotRev(next.reduce((s,b)=>s+b.totalSpent,0));
  }
  function archiveComments(list:Comment[]){
    const clean=sortCommentsNewest(cleanComments(list));
    if(!clean.length)return;
    const archiveKey=sellerLiveDataKey("sf_comment_archive",user?.email||initialSellerEmail,currentSessionId);
    setArchivedComments(prev=>{
      const seen=new Set<string>();
      const next=sortCommentsNewest([...clean,...prev]).filter(c=>{
        const key=commentKey(c);
        if(seen.has(key))return false;
        seen.add(key);
        return true;
      }).slice(0,COMMENT_ARCHIVE_LIMIT);
      LS.set(archiveKey,next);
      return next;
    });
  }
  function clearLiveCommentMemory(){
    const commentsKey=sellerLiveDataKey("sf_comments",user?.email||initialSellerEmail,currentSessionId);
    archiveComments(cleanComments(LS.get<unknown[]>(commentsKey,[])));
    setComments([]);
    LS.set(commentsKey,[]);
  }
  function exportSellerBackup(){
    if(!user)return;
    const email=user.email;
    jsonDL(`sellerflow-backup-${email}-${new Date().toISOString().slice(0,10)}.json`,{
      exportedAt:new Date().toISOString(),
      user,
      settings,
      liveComments:comments,
      commentArchive:archivedComments,
      buyers,
      orders:allOrders,
      printedCommentKeys:Array.from(printed),
      totals:{orders:totOrd,revenue:totRev},
    });
    setToast("Seller backup exported");
  }
  function clearLiveCommentsOnly(){
    if(!window.confirm("Clear live comments only? Orders, customers, sales, and history archive will stay saved."))return;
    clearLiveCommentMemory();
    setToast("Live comments cleared");
  }
  function resetBuyerCounterOnly(){
    if(!window.confirm(t.confirm_reset_buyer_counter))return;
    setBuyers([]);
    setSelBuyer(null);
    if(user){
      LS.set(sellerDailyDataKey("sf_buyers",user.email,currentLiveDayId),[]);
      LS.set(sellerLiveDataKey("sf_buyers",user.email,currentSessionId),[]);
    }
    setToast(t.toast_buyer_counter_reset);
  }

  // Check plan expiry
  // Free users are limited by the order cap, never by a time expiry, so they
  // are exempt from the expired/days-left lock that paid plans use.
  const accountLocked=!!user&&!isAdminUser(user)&&user.plan!=="free"&&(user.planStatus==="expired"||dLeft(user.planExpiry,nowTick)===0);
  const showAccountLock=accountLocked&&page!=="subscription"&&page!=="support";

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(()=>{
    if(!user)return;
    const commentsKey=sellerLiveDataKey("sf_comments",user.email,currentSessionId);
    const archiveKey=sellerLiveDataKey("sf_comment_archive",user.email,currentSessionId);
    const nextBuyers=sellerDayOrSessionArray<Buyer>("sf_buyers",user.email,currentLiveDayId,currentSessionId);
    const nextOrders=sellerDayOrSessionArray<LiveOrder>("sf_orders",user.email,currentLiveDayId,currentSessionId);
    setComments(sortCommentsNewest(cleanComments(LS.get<unknown[]>(commentsKey,[]))).slice(0,LIVE_COMMENT_LIMIT));
    setArchivedComments(sortCommentsNewest(cleanComments(LS.get<unknown[]>(archiveKey,[]))).slice(0,COMMENT_ARCHIVE_LIMIT));
    setBuyers(nextBuyers);
    setAllOrders(nextOrders);
    setPrinted(new Set(sellerDayOrSessionArray<string>("sf_printed",user.email,currentLiveDayId,currentSessionId)));
    setSelBuyer(null);
    setTotOrd(nextOrders.length||nextBuyers.reduce((s,b)=>s+b.totalOrders,0));
    setTotRev(nextOrders.length?nextOrders.reduce((s,o)=>s+o.total,0):nextBuyers.reduce((s,b)=>s+b.totalSpent,0));
  },[user?.email,currentLiveDayId]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(()=>{
    if(!user)return;
    const s = io(SERVER,{path:"/socket.io/",transports:["websocket"],auth:(cb:(d:{token:string})=>void)=>{
      if(!supabase){cb({token:""});return;}
      supabase.auth.getSession().then(({data})=>cb({token:data.session?.access_token||""}));
    }});
    const sellerId=sellerIdOf(user.email);
    const sessionId=currentSessionId;
    const commentsKey=sellerLiveDataKey("sf_comments",user.email,currentSessionId);
    if(DEBUG_SOCKET)console.info("[SellerFlowLive] socket server",SERVER);
    const joinRoom=()=>s.emit("join_live_room",{sellerId,sessionId});
    s.on("connect",joinRoom);
    s.on("connect_error",(err:Error)=>{if(DEBUG_SOCKET)console.warn("[SellerFlowLive] socket connect_error",{server:SERVER,message:err.message});});
    joinRoom();
    s.on("comment", (d: Comment) => {
      const incoming=normalizeComment(d);
      if(!incoming)return;
      if(incoming.sellerId&&incoming.sellerId!==sellerId)return;
      if(incoming.sessionId&&incoming.sessionId!==currentSessionId)return;
      if(incoming.sourceUsername){
        const selected=cleanLiveAccount(activeLiveAccountsRef.current[incoming.platform]);
        if(selected&&cleanLiveAccount(incoming.sourceUsername)!==selected)return;
      }
      const comment={...incoming,timestamp:incoming.timestamp||new Date().toISOString(),time:incoming.time||new Date().toLocaleTimeString()};
      setComments((p) => {
        const merged=sortCommentsNewest(cleanComments([comment,...p]));
        archiveComments(merged.slice(LIVE_COMMENT_LIMIT));
        const next=merged.slice(0,LIVE_COMMENT_LIMIT);
        LS.set(commentsKey,next);
        return next;
      });

      setTimeout(() => {
        feedRef.current?.scrollTo({
          top: 0,
          behavior: "smooth",
        });
      }, 50);
    
    });
    s.on("buyers_updated",({buyers:b,totalOrders:to,sessionId:eventSessionId}:{buyers:Buyer[];totalOrders:number;sessionId?:string})=>{
      if(eventSessionId&&eventSessionId!==currentSessionId)return;
      saveBuyerMemory(b);setTotOrd(to);
      const ords=b.flatMap(x=>x.orders.map(o=>({...o,handle:x.handle,name:x.name,bNum:x.num,platform:x.platform,status:"New",date:new Date().toISOString().slice(0,10)})));
      setAllOrders(ords);LS.set(sellerDailyDataKey("sf_orders",user.email,currentLiveDayId),ords);
    });
    s.on("platform_status",({platform:p,connected:c,reconnecting,sellerId:eventSellerId,username,sessionId:eventSessionId}:{platform:string;connected:boolean;reconnecting?:boolean;sellerId?:string;username?:string;sessionId?:string})=>{
      if(eventSellerId&&eventSellerId!==sellerId)return;
      if(eventSessionId&&eventSessionId!==currentSessionId)return;
      const visibleConnected=c&&!reconnecting;
      if(p==="TikTok"){setTtOn(visibleConnected);if(!visibleConnected)setActiveLiveAccounts(a=>({...a,TikTok:""}));}
      if(p==="Facebook"){setFbOn(visibleConnected);if(!visibleConnected)setActiveLiveAccounts(a=>({...a,Facebook:""}));}
      if(c&&p==="TikTok"&&username)setActiveLiveAccounts(a=>({...a,TikTok:username}));
      if(c&&p==="Facebook"&&username)setActiveLiveAccounts(a=>({...a,Facebook:username}));
    });
    s.on("live_session_started",({sellerId:eventSellerId,sessionId:eventSessionId}:{sellerId?:string;sessionId?:string}={})=>{if((!eventSellerId||eventSellerId===sellerId)&&(!eventSessionId||eventSessionId===currentSessionId))clearLiveCommentMemory();});
    s.on("live_session_ended",({sellerId:eventSellerId,sessionId:eventSessionId}:{sellerId?:string;sessionId?:string}={})=>{if(eventSellerId&&eventSellerId!==sellerId)return;if(eventSessionId&&eventSessionId!==currentSessionId)return;clearLiveCommentMemory();setActiveLiveAccounts({TikTok:"",Facebook:""});setTtOn(false);setFbOn(false);});
    s.on("session_state",({buyers:b,totalOrders:to,sessionId:eventSessionId}:{buyers:Buyer[];totalOrders:number;sessionId?:string})=>{
      if(eventSessionId&&eventSessionId!==currentSessionId)return;
      if(!b.length&&!to)return;
      saveBuyerMemory(b);setTotOrd(to);
      const ords=b.flatMap(x=>x.orders.map(o=>({...o,handle:x.handle,name:x.name,bNum:x.num,platform:x.platform,status:"New",date:new Date().toISOString().slice(0,10)})));
      setAllOrders(ords);LS.set(sellerDailyDataKey("sf_orders",user.email,currentLiveDayId),ords);
    });
    return()=>{s.disconnect();};
  },[user?.email,currentLiveDayId]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(()=>{
    if(!user)return;
    const commentsKey=sellerLiveDataKey("sf_comments",user.email,currentSessionId);
    const stored=sortCommentsNewest(cleanComments(LS.get<unknown[]>(commentsKey,[]))).slice(0,LIVE_COMMENT_LIMIT);
    setComments(stored);
  },[user?.email,currentSessionId]);

  useEffect(()=>{
    if(!supabase)return;
    let active=true;
    const applySession=async(session:{user?:{id:string}}|null)=>{
      if(!session?.user){
        if(active){setUser(null);LS.del("sf_session");LS.del("sf_session_user");}
        return;
      }
      const profile=await getMyProfile(session.user.id);
      if(!active||!profile)return;
      const next=asAdminPlan(profile);
      setUser(next);
      LS.set("sf_session",next.email);
      LS.set("sf_session_user",next);
    };
    if(forceLogin){
      void supabase.auth.signOut();
    }else{
      void supabase.auth.getSession().then(({data})=>{void applySession(data.session);});
    }
    const {data:authSub}=supabase.auth.onAuthStateChange((event,session)=>{
      // Recovery link clicked: show the Set New Password form instead of
      // auto-logging the seller into the dashboard. Must precede applySession.
      if(event==="PASSWORD_RECOVERY"){setRecoveryMode(true);return;}
      if(event==="SIGNED_OUT"){setUser(null);LS.del("sf_session");LS.del("sf_session_user");return;}
      void applySession(session);
    });
    return()=>{active=false;authSub.subscription.unsubscribe();};
  },[forceLogin]);

  // Support chat replaced by a Telegram contact link — no chat polling here.
  // Admin still polls pending-approval count for the admin-nav badge (kept —
  // unrelated to chat egress).
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(()=>{
    if(!user){setPendingUsersCount(0);setExpiringSoonCount(0);return;}
    const refreshPendingUsers=()=>{
      if(!isAdminUser(user)){setPendingUsersCount(0);setExpiringSoonCount(0);return;}
      if(document.visibilityState!=="visible")return;
      // Single listUsers() response → two derived counts. Same egress as
      // before, just an extra client-side filter for the expiring-soon dot.
      void listUsers().then(list=>{
        const sellers=list.filter(u=>u.role!=="admin");
        setPendingUsersCount(sellers.filter(u=>u.planStatus==="pending").length);
        setExpiringSoonCount(sellers.filter(u=>u.plan!=="free"&&u.planStatus!=="pending"&&(u.planStatus==="expired"||dLeft(u.planExpiry)<=1)).length);
      });
    };
    refreshPendingUsers();
    const onVis=()=>{if(document.visibilityState==="visible")refreshPendingUsers();};
    document.addEventListener("visibilitychange",onVis);
    const timer=window.setInterval(refreshPendingUsers,60000);
    return()=>{window.clearInterval(timer);document.removeEventListener("visibilitychange",onVis);};
  },[user?.email]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // Free-tier usage status (counter, near-cap, capped). Paid users get is_free:false.
  async function refreshFreeStatus(){
    if(!user||!supabase){setFreeStatus(null);return;}
    try{
      const {data}=await supabase.rpc("free_tier_status_for_user");
      setFreeStatus((data as FreeStatus)||null);
    }catch(err){console.warn("free_tier_status_for_user failed:",err);}
  }
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(()=>{
    if(!user){setFreeStatus(null);return;}
    void refreshFreeStatus();
    const timer=window.setInterval(()=>{void refreshFreeStatus();},30000);
    return()=>window.clearInterval(timer);
  },[user?.email]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  const isFreeUser=user?.plan==="free"&&!!freeStatus?.is_free;
  const freeCapped=isFreeUser&&!!freeStatus?.capped;

  // Near-cap (150) celebration popup — shown ONCE per cycle. The DB remembers
  // via free_warned_at (warning_shown), so it never repeats at 160/170/etc.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(()=>{
    if(!isFreeUser||!freeStatus)return;
    if(freeStatus.capped)return;                 // 200 hard-stop takes over
    if(!freeStatus.near_cap)return;              // below 150
    if(freeStatus.warning_shown)return;          // already shown this cycle
    if(capPopup)return;                          // a popup is already open
    setCapPopup("near");
    if(supabase)void supabase.rpc("free_tier_mark_warned").then(()=>refreshFreeStatus());
  },[freeStatus?.count,freeStatus?.near_cap,freeStatus?.capped,freeStatus?.warning_shown]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  function saveUser(u:User){
    const next=asAdminPlan(u);
    setUser(next);
    LS.set("sf_session",next.email);
    LS.set("sf_session_user",next);
    // Persists profile fields only; plan/role are server-controlled (triggers
    // ignore seller-side changes to them).
    void upsertUser(next);
  }
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(()=>{
    if(!user||isAdminUser(user)||user.plan==="free"||user.planStatus==="expired")return;
    if(dLeft(user.planExpiry,nowTick)>0)return;
    saveUser({...user,planStatus:"expired"});
    setPage("subscription");
  },[user,nowTick]);
  /* eslint-enable react-hooks/set-state-in-effect */
  function handleLogin(u:User){const safe=safeUser(u);if(safe){const next=asAdminPlan(safe);setUser(next);LS.set("sf_session",next.email);LS.set("sf_session_user",next);setPage("dashboard");}}
  function handleLogout(){posthog.reset();void supabase?.auth.signOut();LS.del("sf_session");LS.del("sf_session_user");if(typeof window!=="undefined")window.sessionStorage.removeItem("sf_account_gate_ok");setUser(null);setComments([]);setBuyers([]);setAllOrders([]);setPrinted(new Set());setTotOrd(0);setTotRev(0);setSelBuyer(null);}
  async function handleDeleteAccount(){
    if(!user)return;
    const email=user.email;
    try{await deleteUser(email);}catch(err){console.error("Delete profile failed:",err);}
    void supabase?.auth.signOut();
    ["sf_session","sf_session_user","sf_comments","sf_comment_archive","sf_buyers","sf_orders",sellerDataKey("sf_comments",email),sellerDataKey("sf_comment_archive",email),sellerDataKey("sf_buyers",email),sellerDataKey("sf_orders",email),sellerDataKey("sf_printed",email)].forEach(k=>LS.del(k));
    setShowProf(false);
    setPage("dashboard");
    setUser(null);
    setComments([]);
    setBuyers([]);
    setAllOrders([]);
    setPrinted(new Set());
    setTotOrd(0);
    setTotRev(0);
    setSelBuyer(null);
  }
  function handleActivate(plan:Plan,status:PlanStatus,expiry:string){
    if(!user)return;
    const u={...user,plan,planStatus:status,planExpiry:expiry};
    saveUser(u);setToast(`${pName(plan,t)} activated!`);setPage("dashboard");
  }
  function handleSaveProfile(p:Profile){
    if(!user)return;
    const limit=maxAcc(user.plan);
    const lockedProfile=isAdminUser(user)?p:fitProfileAccounts(user.profile,{
      ...p,
      tiktok:keepLockedAccounts(user.profile.tiktok,p.tiktok,limit),
      facebook:keepLockedAccounts(user.profile.facebook,p.facebook,limit),
    },limit);
    saveUser({...user,profile:lockedProfile});
  }
  function handleSaveSettings(s:Settings){
    const next={...s,currency:cleanCurrency(s.currency)};
    setSettingsState(next);
    LS.set("sf_settings",next);
  }
  async function handleSavePw(op:string,np:string):Promise<string>{
    if(!user||!supabase)return"No user";
    // Re-authenticate to confirm the current password, then update it.
    const {error:verifyError}=await supabase.auth.signInWithPassword({email:user.email,password:op});
    if(verifyError)return t.wrong_pw;
    const {error}=await supabase.auth.updateUser({password:np});
    if(error)return error.message;
    return"";
  }
  async function handleAdminApprove(email:string,plan:Plan,months=1){
    const now=new Date().toISOString();
    const planExpiry=plan==="trial"?addDays(7):addMonths(months);
    const trialStartedAt=plan==="trial"?now:undefined;
    try{
      await adminUpdatePlan(email,{plan,planStatus:"active",planExpiry,...(trialStartedAt?{trialStartedAt}:{})});
    }catch(err){
      setToast(`Approve failed: ${err instanceof Error?err.message:"error"}`);return;
    }
    if(user&&user.email.toLowerCase()===email.toLowerCase()){
      const next=asAdminPlan({...user,plan,planStatus:"active",planExpiry,trialStartedAt:trialStartedAt??user.trialStartedAt});
      setUser(next);LS.set("sf_session_user",next);
    }
    setToast(`${email} approved for ${plan}${plan==="trial"?"":` (${months} month${months===1?"":"s"})`}`);
  }
  async function connectPlatform(platform:"TikTok"|"Facebook",data:Record<string,string>){
    const ep=platform==="TikTok"?"/connect/tiktok":"/connect/facebook";
    const connectionMeta={sellerId:sellerIdOf(user.email),sessionId:browserSessionId()};
    const tiktokUsername=cleanLiveAccount(data.username||"");
    const facebookPage=(data.liveVideoId||data.username||"").trim();
    const body=platform==="TikTok"
      ? {username:tiktokUsername,...connectionMeta}
      : {username:facebookPage,pageName:facebookPage,liveVideoId:facebookPage,accessToken:data.accessToken,...connectionMeta};
    posthog.capture("connect_attempt",{platform});
    try{
      const session=supabase?(await supabase.auth.getSession()).data.session:null;
      const r=await fetch(`${SERVER}${ep}`,{
        method:"POST",
        headers:{
          "Content-Type":"application/json",
          Authorization:`Bearer ${session?.access_token||""}`,
        },
        body:JSON.stringify(body)
      });
      const j=await r.json();
      if(r.status===401){posthog.capture("connect_failed",{platform,reason:"unauthorized",error:j.error});setToast(`${t.conn_failed}: ${j.error||"Unauthorized"}`);return;}
      if(r.status===500){posthog.capture("connect_failed",{platform,reason:"server_error",error:j.error});setToast(`${t.conn_failed}: ${j.error||"Server error"}`);return;}
      if(!j.success){posthog.capture("connect_failed",{platform,reason:j.error||"unknown",status:r.status});setToast(`${t.conn_failed}: ${j.error||r.statusText||`HTTP ${r.status}`}`);}
      else{
        posthog.capture("connect_success",{platform});
        setToast(`${t.conn_success} ${platform}!`);
        clearLiveCommentMemory();
        setActiveLiveAccounts(a=>({
          ...a,
          [platform]: platform==="TikTok"?tiktokUsername:facebookPage
        }));
        if(user){
          const cleanValue=platform==="TikTok"?tiktokUsername:facebookPage;
          const field=platform==="TikTok"?"tiktok":"facebook";
          const existing=accountList(user.profile[field]);
          const nextProfile=cleanValue&&!existing.includes(cleanValue)&&registeredAccountCount(user)<maxAcc(user.plan)
            ? {...user.profile,[field]:accountText([...existing,cleanValue])}
            : user.profile;
          const u={...user,profile:nextProfile,connectedAccounts:[...user.connectedAccounts.filter(a=>a!==platform),platform]};
          saveUser(u);
        }
      }
    }catch{posthog.capture("connect_failed",{platform,reason:"network"});setToast(t.cant_reach);}
  }
  function autoRegisterCustomer(c:Comment){
    if(!user)return;
    const username=String(c.handle||"").trim().replace(/^@/,"");
    if(!username)return;
    const key=custDataKey(user.email);
    const cur=arrLS<ShippingCustomer>(key);
    if(cur.some(r=>r.username.toLowerCase()===username.toLowerCase()))return;
    const num=cur.reduce((m,r)=>Math.max(m,r.num||0),0)+1;
    // Name is left blank on purpose: 7-11/OpenPoint needs the customer's REAL name, not the TikTok/FB handle.
    // Admin encodes the real Name in Customer Data before shipping. Username keeps the handle.
    const rec:ShippingCustomer={username,name:"",phone:"",sevenCode:"",note:"",lastComment:"",firstSeen:new Date().toISOString(),status:"Pending",isNew:true,num};
    LS.set(key,[...cur,rec]);
  }
  async function createOrderFromComment(c:Comment,{print=true,price=0}:{print?:boolean;price?:number}={}){
    // Free-tier HARD STOP: at the 200-order cap, block creating new orders
    // (viewing/printing existing orders stays allowed). The DB trigger is the
    // authoritative limit; this is the friendly in-app block before we even try.
    if(freeCapped){setCapPopup("hard");return;}
    // Pure assembly extracted to src/lib/orderLogic.ts (tested). Single
    // `new Date()` feeds orderNum/time/date consistently; this runs in an
    // event handler, not render.
    const {order,singleOrderBuyer,nextBuyers}=buildOrderFromComment(c,buyers,price,new Date());
    const orderItem=order.item;
    saveBuyerMemory(nextBuyers);
    try{autoRegisterCustomer(c);}catch(autoRegErr){console.warn("autoRegisterCustomer failed (non-fatal):",autoRegErr);} // never block order creation / printing
    setSelBuyer(singleOrderBuyer);
    setAllOrders(prev=>{const next=[...prev,order];LS.set(sellerMemoryKey("sf_orders"),next);return next;});

    if(print){
      printSlip(singleOrderBuyer,settings.currency,user?.profile.storeName||"SellerFlowLive",settings);
    }else{
      setToast(`Order created for ${c.name||c.handle}`);
    }

    void Promise.all([
      saveOrderToDatabase({
        customer_name:c.name||c.handle,
        product:orderItem,
        total_amount:order.total,
        status:"Pending",
      }),
      saveCustomerToDatabase({
        name:c.name||c.handle,
        handle:c.handle,
        platform:c.platform,
        total_orders:1,
        total_spent:order.total,
      }),
    ]).catch(err=>{
      // If a race got past the soft block, the DB cap trigger rejects the
      // insert — surface the hard-stop popup and resync the counter.
      if(String(err?.message||err||"").includes("free_tier_cap_reached")){
        setCapPopup("hard");
        void refreshFreeStatus();
      }else{
        console.warn("Background database save failed",err);
      }
    });
    // Free users: resync the usage counter so the topbar + near-cap warning stay live.
    if(isFreeUser)void refreshFreeStatus();
  }
  function reprintLatestForComment(c:Comment){
    const b=buyers.find(x=>x.handle===c.handle&&x.platform===c.platform);
    if(!b){void createOrderFromComment(c,{print:true});return;}
    const matchingOrder=[...b.orders].reverse().find(o=>(o.item===(c.comment||"Live comment order")||o.item==="Manual price order")&&(o.time===c.time||!c.time))||b.orders[b.orders.length-1];
    const singleOrderBuyer:Buyer={...b,orders:matchingOrder?[matchingOrder]:[],totalOrders:matchingOrder?1:0,totalSpent:matchingOrder?.total||0};
    setSelBuyer(singleOrderBuyer);
    printSlip(singleOrderBuyer,settings.currency,user?.profile.storeName||"SellerFlowLive",settings);
  }
  function copyText(text:string,label:string){
    navigator.clipboard?.writeText(text);
    setToast(`${label} copied`);
  }
  function commentOrderCount(c:Comment){
    return buyers.find(b=>b.handle===c.handle&&b.platform===c.platform)?.totalOrders||0;
  }
  function commentStamp(c:Comment){
    const d=new Date(c.timestamp||Date.now());
    const date=d.toLocaleDateString("en-GB").replace(/\//g,".");
    const time=c.timestamp?d.toLocaleTimeString("en-GB",{hour12:false}):(c.time||d.toLocaleTimeString("en-GB",{hour12:false}));
    return `${date} ${time}`;
  }
  function showBuyerFromComment(c:Comment){
    const b=buyers.find(x=>x.handle===c.handle&&x.platform===c.platform);
    if(!b){setToast("No orders yet for this buyer");return;}
    setSelBuyer(b);
    setPage("dashboard");
    setToast(`Showing ${b.name}`);
  }
  function oneClick(c:Comment){
    setPrinted(p=>{
      const next=new Set(p);
      next.add(commentKey(c));
      LS.set(sellerMemoryKey("sf_printed"),Array.from(next));
      return next;
    });
    void createOrderFromComment(c,{print:true,price:0});
  }
  function submitCommentPrice(c:Comment){
    const key=commentKey(c);
    const price=Number(commentPrices[key]||0)||0;
    if(price<=0){setToast(t.enter_price);return;}
    void createOrderFromComment(c,{print:true,price});
    setCommentPrices(p=>({...p,[key]:""}));
    setTimeout(()=>priceInputRefs.current[key]?.focus(),0);
  }
  function continueSavedAccount(){
    if(user&&typeof window!=="undefined")window.sessionStorage.setItem("sf_account_gate_ok",user.email);
    setAccountGate(false);
  }
  function switchAccount(){
    if(typeof window!=="undefined")window.sessionStorage.removeItem("sf_account_gate_ok");
    handleLogout();
    setAccountGate(false);
  }

  // Password-recovery takes precedence over both the login screen and any
  // session that PASSWORD_RECOVERY may have established — the seller must set a
  // new password before anything else. onDone clears the flag → login screen.
  if(recoveryMode)return <ResetPasswordPage onDone={()=>setRecoveryMode(false)}/>;
  if(!user)return <PublicAuth onLogin={handleLogin} t={t} lang={lang} setLang={setLang}/>;
  if(!isAdminUser(user)&&user.planStatus==="pending")return <PendingApprovalWall user={user} onLogout={handleLogout} t={t}/>;
  if(accountGate)return <AccountGate user={user} onContinue={continueSavedAccount} onSwitch={switchAccount} t={t}/>;

  const isLive=ttOn||fbOn;
  const mobileMinerQuery=mobileMinerSearch.trim().toLowerCase();
  const mobileMinerBuyers=mobileMinerQuery
    ? buyers.filter(b=>b.name.toLowerCase().includes(mobileMinerQuery)||b.handle.toLowerCase().includes(mobileMinerQuery)||String(b.num).includes(mobileMinerQuery)||b.platform.toLowerCase().includes(mobileMinerQuery))
    : buyers;
  const platformButtonLabel=(platform:"TikTok"|"Facebook",connected:boolean)=>{
    const account=activeLiveAccounts[platform];
    return connected&&account?account:platform;
  };
  const days=dLeft(user.planExpiry);
  const showMobileBack=["settings","subscription","support","admin","privacy","terms","deleteAccount","shipping"].includes(page);
  const navItems:[Page,string,string][]=[
    ["dashboard","⚡",t.nav_live],["miners","🏅",t.nav_miners],["orders","🛒",t.nav_orders],
    ["products","📦",t.nav_products],["customers","👥",t.nav_customers],["customerData","📋",t.cust_data_title],["print","🖨️",t.nav_print],["sales","📊",t.nav_sales],
  ];
  const navClass=(id:Page)=>`nav-it ${page===id?"on":""}`;

  return(
    <div className={`app ${settings.darkMode?"theme-dark":"theme-regular"}`} onClick={()=>{setShowProf(false);setOpenCommentMenu(null);}}>
      {toast&&<Toast msg={toast} onDone={()=>setToast("")}/>}
      {showAccountLock&&<TrialExpiredWall t={t} onUpgrade={()=>{setPage("subscription");}}/>}

      {/* Free-tier popups — centered modal, responsive (reuses .modal-overlay/.modal). */}
      {capPopup&&(()=>{
        const cnt=freeStatus?.count??0,cap=freeStatus?.cap??200,resetDays=freeStatus?.cycle_resets_in_days??30;
        const left=Math.max(0,cap-cnt);
        const isHard=capPopup==="hard";
        const title=isHard?tpl(t.free_cap_reached_title,{cap}):tpl(t.free_near_cap_title,{count:cnt});
        const msg=isHard?tpl(t.free_cap_reached_msg,{cap,days:resetDays}):tpl(t.free_near_cap_msg,{left,cap,count:cnt});
        const close=()=>setCapPopup("");
        return(
          <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&close()}>
            <div className="modal free-cap-modal" style={{maxWidth:380}}>
              <div className="free-cap-body">
                <div className="free-cap-emoji" aria-hidden="true">{isHard?"🎉":"🚀"}</div>
                <h3 className="free-cap-title">{title}</h3>
                <p className="free-cap-msg">{msg}</p>
                <div className="free-cap-actions">
                  <button className="btn-purple" onClick={()=>{close();setPage("subscription");}}>{t.free_upgrade_btn}</button>
                  {isHard
                    ?<button className="btn-out" onClick={()=>{close();setPage("orders");}}>{t.free_view_orders_btn}</button>
                    :<button className="btn-out" onClick={close}>{t.free_dismiss_btn}</button>}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sb-logo"><div className="logo-ic"><svg width="16" height="16" viewBox="0 0 18 18"><path d="M4 6 Q4 3 7 3 L11 3 Q14 3 14 6 Q14 9 11 9.5 L7 10.5 Q4 10.5 4 13 Q4 15 7 15 L11 15 Q14 15 14 13" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg></div><span className="logo-tx">Seller<span>FlowLive</span></span></div>
        <div className="nav-sec-lbl">{t.nav_live_section}</div>
        {navItems.slice(0,3).map(([id,ic,lb])=><button key={id} onClick={()=>setPage(id)} className={navClass(id)}><span className="nav-ic">{ic}</span><span className="nav-lb">{lb}</span></button>)}
        <div className="nav-sec-lbl">{t.nav_manage}</div>
        {navItems.slice(3,7).filter(([id])=>isAdminUser(user)||id!=="customerData").map(([id,ic,lb])=><button key={id} onClick={()=>setPage(id)} className={navClass(id)}><span className="nav-ic">{ic}</span><span className="nav-lb">{lb}</span></button>)}
        {isAdminUser(user)&&<button onClick={()=>setPage("shipping")} className={navClass("shipping")}><span className="nav-ic">🚚</span><span className="nav-lb">{t.nav_shipping}</span></button>}
        <div className="nav-sec-lbl">{t.nav_analytics}</div>
        {navItems.slice(7).map(([id,ic,lb])=><button key={id} onClick={()=>setPage(id)} className={navClass(id)}><span className="nav-ic">{ic}</span><span className="nav-lb">{lb}</span></button>)}
        <button onClick={()=>setPage("support")} className={`nav-it ${page==="support"?"on":""}`}><span className="nav-ic">💬</span><span className="nav-lb">{t.support_label}</span></button>
        {isAdminUser(user)&&(()=>{const adminAlertCount=pendingUsersCount+expiringSoonCount;return <button onClick={()=>setPage("admin")} className={`nav-it ${page==="admin"?"on":""}`}><span className="nav-ic">👑</span><span className="nav-lb">{t.admin_label}</span>{adminAlertCount>0&&<span className="nav-alert-badge" title={`${pendingUsersCount} pending approval${pendingUsersCount===1?"":"s"}, ${expiringSoonCount} expiring within 24h`}>{adminAlertCount>9?"9+":adminAlertCount}</span>}</button>;})()}
        <button onClick={()=>setPage("settings")} className={navClass("settings")} style={{marginTop:"auto"}}><span className="nav-ic">⚙️</span><span className="nav-lb">{t.nav_settings}</span></button>
        <div className="trial-box">
          {isFreeUser?(()=>{
            const cnt=freeStatus?.count??0,cap=freeStatus?.cap??200,resetDays=freeStatus?.cycle_resets_in_days??30;
            const pct=Math.min(100,Math.round((cnt/Math.max(1,cap))*100));
            const barColor=freeStatus?.capped?"#A32D2D":freeStatus?.near_cap?"#BA7517":"#1D9E75";
            return <>
              <div className="trial-row"><span className="trial-pill">{pName("free",t)}</span><span className="trial-exp">{tpl(t.free_cycle_resets_in,{days:resetDays})}</span></div>
              <div className="trial-cd" style={{color:barColor}}>{tpl(t.free_orders_progress,{count:cnt,cap})}</div>
              <div className="free-usage-bar"><span style={{width:`${pct}%`,background:barColor}}/></div>
              <button className="upgrade-btn" onClick={()=>setPage("subscription")}>{t.free_upgrade_btn}</button>
            </>;
          })():<>
            <div className="trial-row"><span className="trial-pill">{pName(user.plan,t)}</span><span className="trial-exp">{days}d {t.days_remaining}</span></div>
            <div className="trial-cd" style={{color:days<=2?"#A32D2D":"#26215C"}}>{days===0?t.expired_label:`${days} ${t.days_remaining}`}</div>
            <button className="upgrade-btn" onClick={()=>setPage("subscription")}>{t.upgrade_btn}</button>
          </>}
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        <header className={`topbar ${showMobileBack?"has-mobile-back":""}`}>
          {showMobileBack&&<button className="mobile-page-back" onClick={()=>setPage("dashboard")}>{t.back_btn}</button>}
          <div className={`live-pill ${isLive?"live":"off"}`}><span className="live-dot"/> {isLive?t.live_status:t.offline_status}</div>
          <button onClick={()=>{setConnectTab("TikTok");setShowConn(true);}} className={`plat-btn ${ttOn?"on active-account":""}`} title={ttOn&&activeLiveAccounts.TikTok?`TikTok: ${activeLiveAccounts.TikTok}`:"TikTok"}>{platformButtonLabel("TikTok",ttOn)} {ttOn?"✓":""}</button>
          <button onClick={()=>{setConnectTab("Facebook");setShowConn(true);}} className={`plat-btn ${fbOn?"on active-account":""}`} title={fbOn&&activeLiveAccounts.Facebook?`Facebook: ${activeLiveAccounts.Facebook}`:"Facebook"}>{platformButtonLabel("Facebook",fbOn)} {fbOn?"✓":""}</button>
          <select value={lang} onChange={e=>setLang(e.target.value as Lang)} className="lang-sel">
            {LANG_OPTS.map(l=><option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
          <span className="session-txt">{t.session}: <b>{today}</b></span>
          <div style={{position:"relative"}}>
            <div className="prof-av" onClick={e=>{e.stopPropagation();setShowProf(p=>!p);}}>{ini(user.profile.fullName||user.email)}</div>
            {showProf&&(
              <div className="prof-drop" onClick={e=>e.stopPropagation()}>
                <div className="pd-hd"><div className="pd-av">{ini(user.profile.fullName||user.email)}</div><div><div className="pd-name">{user.profile.fullName||user.email}</div><div className="pd-role">{user.profile.storeName} · <Badge label={pName(user.plan,t)} color={pColor(user.plan)}/></div></div></div>
                <div className="pd-row"><span>✉️</span><span>{user.email}</span></div>
                <div className="pd-row"><span>📱</span><span>{user.profile.phone||t.no_phone}</span></div>
                <div className="pd-row"><span>🏪</span><span>{user.profile.storeName}</span></div>
                {user.profile.tiktok&&<div className="pd-row"><span>📱</span><span>{user.profile.tiktok} · TikTok</span></div>}
                {user.profile.facebook&&<div className="pd-row"><span>📘</span><span>{user.profile.facebook} · FB</span></div>}
                <div className="pd-row pd-lang-row">
                  <span>🌐</span>
                  <select value={lang} onChange={e=>setLang(e.target.value as Lang)} className="pd-lang-select">
                    {LANG_OPTS.map(l=><option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </div>
                <div className="pd-div"/>
                <div className="pd-row pd-cl" onClick={()=>{setPage("settings");setShowProf(false);}}><span>⚙️</span><span>{t.nav_settings}</span></div>
                <div className="pd-row pd-cl" onClick={()=>{setPage("subscription");setShowProf(false);}}><span>💎</span><span>{t.subscription_label}</span></div>
                {(()=>{
                  // Seller-facing expiry line — derived from the already-loaded
                  // user.planExpiry + the existing 60s nowTick (zero new egress).
                  const exp=sellerExpiryState(user,nowTick);
                  if(!exp)return null;
                  const expColor=exp.tier==="urgent"?"#991B1B":exp.tier==="warning"?"#92400E":undefined;
                  const expLine=exp.days===0?t.seller_expiry_today:exp.days===1?t.seller_expiry_tomorrow:tpl(t.seller_expiry_line,{days:exp.days});
                  return(
                    <div className="pd-row" style={expColor?{color:expColor,fontWeight:exp.tier==="urgent"?700:500}:undefined}>
                      <span>⏳</span>
                      <span>
                        {expLine}{exp.expiryDate?` · ${exp.expiryDate}`:""}
                        {exp.tier!=="normal"&&(
                          <a href={TELEGRAM_URL} target="_blank" rel="noreferrer noopener" onClick={e=>e.stopPropagation()} style={{display:"block",marginTop:4,color:"#7F77DD",fontWeight:600,textDecoration:"underline"}}>
                            {t.seller_expiry_renew_cta}
                          </a>
                        )}
                      </span>
                    </div>
                  );
                })()}
                <div className="pd-row pd-cl" onClick={()=>{setPage("support");setShowProf(false);}}><span>💬</span><span>{t.support_label}</span></div>
                {isAdminUser(user)&&<div className="pd-row pd-cl" onClick={()=>{setPage("shipping");setShowProf(false);}}><span>🚚</span><span>Shipping</span></div>}
                <div className="pd-row pd-cl" onClick={()=>{setPage("privacy");setShowProf(false);}}><span>{t.privacy_policy}</span><span>{t.privacy_policy}</span></div>
                <div className="pd-row pd-cl" onClick={()=>{setPage("terms");setShowProf(false);}}><span>{t.terms_service}</span><span>{t.terms_service}</span></div>
                <div className="pd-row pd-cl" onClick={()=>{setPage("deleteAccount");setShowProf(false);}}><span>{t.delete_account}</span><span>{t.delete_account}</span></div>
                {isAdminUser(user)&&<div className="pd-row pd-cl" onClick={()=>{setPage("admin");setShowProf(false);}}><span>ADMIN</span><span>{t.admin_label}</span></div>}
                <div className="pd-row pd-cl" onClick={()=>{setShowProf(false);switchAccount();}}><span>{t.switch_account}</span><span>{t.switch_account}</span></div>
                <div className="pd-row pd-cl" style={{color:"#A32D2D"}} onClick={()=>{setShowProf(false);handleLogout();}}><span>🚪</span><span>{t.sign_out}</span></div>
              </div>
            )}
          </div>
        </header>

        {/* DASHBOARD */}
        {page==="dashboard"&&(
          <div className="dashboard">
            <section className="feed-col">
              <div className="col-lbl"><span className="dot-pulse"/> {t.live_feed}</div>
              <div className="chat-wrap">
                <div className="chat-hd">{t.comments_label}<span className="chat-sub">{comments.length} {t.received}</span></div>
                <div className="chat-msgs" ref={feedRef}>
                  {comments.length===0&&<div className="feed-empty">{t.connect_prompt}</div>}
                  {comments.map((c,i)=>{
                    const orderCount=commentOrderCount(c);
                    const cKey=commentKey(c);
                    return(
                      <div key={cKey} className="msg-row buy" onDoubleClick={()=>submitCommentPrice(c)}>
                        <Av name={c.name||c.handle} image={c.avatar} size={42}/>
                        <div className="msg-bd">
                          <div className="msg-nm">
                            <strong>{c.name||c.handle}</strong>
                            {c.handle&&c.handle!==(c.name||c.handle)&&<>
                              <span className="msg-sep">-</span>
                              <span className="msg-handle">{c.handle}</span>
                            </>}
                            <span className={`p-tag ${c.platform.toLowerCase()}`}>{c.platform}</span>
                          </div>
                          <div className="msg-tx buy">{c.comment||t.live_comment_fallback}</div>
                          <div className="msg-meta">
                            <span>{commentStamp(c)}</span>
                          </div>
                        </div>
                        <div className="msg-actions" onClick={e=>e.stopPropagation()}>
                          <button className="comment-menu-btn" aria-label={t.comment_tools} onClick={()=>setOpenCommentMenu(openCommentMenu===i?null:i)}>...</button>
                          {openCommentMenu===i&&(
                            <div className="comment-menu">
                              <button onClick={()=>{setOpenCommentMenu(null);void createOrderFromComment(c,{print:true});}}>{t.create_order_print}</button>
                              <button onClick={()=>{setOpenCommentMenu(null);void createOrderFromComment(c,{print:false});}}>{t.create_order_only}</button>
                              <button onClick={()=>{setOpenCommentMenu(null);reprintLatestForComment(c);}}>{t.reprint_latest}</button>
                              <button onClick={()=>{setOpenCommentMenu(null);showBuyerFromComment(c);}}>{t.view_buyer_orders}</button>
                              <button onClick={()=>{setOpenCommentMenu(null);copyText(`@${c.handle}`,t.username_label);}}>{t.copy_username}</button>
                              <button onClick={()=>{setOpenCommentMenu(null);copyText(c.comment,t.comment_label);}}>{t.copy_comment}</button>
                            </div>
                          )}
                          <div className="order-count" title={t.orders_created_title}>🛒 <span>({orderCount})</span></div>
                          <input
                            ref={el=>{priceInputRefs.current[cKey]=el;}}
                            className="comment-price-input"
                            inputMode="decimal"
                            placeholder={t.enter_price}
                            value={commentPrices[cKey]||""}
                            onChange={e=>setCommentPrices(p=>({...p,[cKey]:e.target.value.replace(/[^\d.]/g,"")}))}
                            onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();submitCommentPrice(c);}}}
                          />
                          <button className={`one-btn ${printed.has(cKey)?"done":""}`} onClick={()=>oneClick(c)}>{t.btn_1click}</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="stats-row">
                <div className="stat-c"><div className="stat-l">{t.orders_stat}</div><div className="stat-v">{totOrd}</div></div>
                <div className="stat-c"><div className="stat-l">{t.revenue_stat}</div><div className="stat-v" style={{color:"#1D9E75"}}>{settings.currency}{totRev.toLocaleString()}</div></div>
                <div className="stat-c"><div className="stat-l">{t.buyers_stat}</div><div className="stat-v" style={{color:"#534AB7"}}>{buyers.length}</div></div>
              </div>
            </section>
            <section className="mobile-summary-col">
              <div className="col-lbl">{t.stats_label}</div>
              <div className="mobile-summary-grid">
                <div className="stat-c"><div className="stat-l">{t.orders_stat}</div><div className="stat-v">{totOrd}</div></div>
                <div className="stat-c"><div className="stat-l">{t.revenue_stat}</div><div className="stat-v" style={{color:"#1D9E75"}}>{settings.currency}{totRev.toLocaleString()}</div></div>
                <div className="stat-c"><div className="stat-l">{t.buyers_stat}</div><div className="stat-v" style={{color:"#534AB7"}}>{buyers.length}</div></div>
              </div>
              <div className="mobile-swipe-hint">{t.mobile_swipe_hint}</div>
            </section>
            <section className="miners-col">
              <div className="col-lbl">{t.miners_label}<span style={{marginLeft:"auto",fontSize:11,color:"#888"}}>{buyers.length} {t.buyers_stat}</span></div>
              <div className="miners-wrap">
                <div className="miners-hd"><span>{t.buyer_numbers}</span><span style={{fontSize:11,color:"#888"}}>{totOrd}</span></div>
                <div className="miners-list">
                  {buyers.length===0&&<div className="miners-empty">{t.no_orders}</div>}
                  {buyers.map(b=>(
                    <div key={b.handle} className={`buyer-row ${selBuyer?.handle===b.handle?"active":""}`} onClick={()=>setSelBuyer(b)}>
                      <div className="b-num" style={{background:nc(b.num)}}>{b.num}</div>
                      <div className="b-info"><div className="b-name">{b.name}</div><div className="b-handle">@{b.handle}</div></div>
                      <div className="b-right"><div className="b-total">{b.totalSpent>0?`${settings.currency}${b.totalSpent.toLocaleString()}`:""}</div><div className="b-ords">{b.totalOrders}</div></div>
                    </div>
                  ))}
                </div>
              </div>
            </section>
            <section className="slip-col">
              <div className="col-lbl">{t.slip_label}<span style={{marginLeft:"auto",fontSize:11,color:"#888"}}>{selBuyer?t.btn_printed:t.no_order_yet}</span></div>
              <div className="slip-wrap">
                {!selBuyer?<div className="slip-empty"><div style={{fontSize:36,marginBottom:12}}>🖨️</div>{t.slip_empty}</div>:(
                  <div className="slip-paper">
                    <div className="slip-logo"><div className="slip-logo-ic"><svg width="13" height="13" viewBox="0 0 18 18"><path d="M4 6 Q4 3 7 3 L11 3 Q14 3 14 6 Q14 9 11 9.5 L7 10.5 Q4 10.5 4 13 Q4 15 7 15 L11 15 Q14 15 14 13" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg></div><span className="slip-s">Seller</span><span className="slip-f">FlowLive</span></div>
                    <div className="slip-hr"/>
                    <div className="slip-nb"><div className="slip-nl">{t.buyer_number_label}</div><div className="slip-nn" style={{color:nc(selBuyer.num)}}>#{selBuyer.num}</div><div className="slip-na">{selBuyer.name}</div><div className="slip-nh">@{selBuyer.handle}</div></div>
                    <div className="slip-sess">{t.session}: {today}</div>
                    <div className="slip-ot">{t.orders_today} ({selBuyer.orders.length})</div>
                    {selBuyer.orders.map((o,i)=><div key={i} className="slip-ob"><div className="slip-ot2">{o.time} — #SF{o.orderNum}</div><div className="slip-oi">{o.item}</div><div className="slip-od">x{o.qty}{o.total>0?` — ${settings.currency}${o.total.toLocaleString()}`:""}</div></div>)}
                    <div className="slip-dash"/>
                    <div className="slip-tot"><span className="slip-tl">{t.total_today}</span><span className="slip-tv">{selBuyer.totalSpent>0?`${settings.currency}${selBuyer.totalSpent.toLocaleString()}`:""}</span></div>
                    <div className="slip-dash"/>
                    <div className="slip-ft"></div>
                  </div>
                )}
              </div>
              {selBuyer&&<button className="print-again-btn" onClick={()=>printSlip(selBuyer,settings.currency,user.profile.storeName||"SellerFlowLive",settings)}>{t.print_again}</button>}
            </section>
            <section className="mobile-tools-col">
              <div className="col-lbl">{t.business_tools}</div>
              <div className="mobile-tool-grid">
                <button className="mobile-tool-card" onClick={()=>setPage("orders")}>
                  <span>🛒</span><b>{t.nav_orders}</b><em>{totOrd} {t.today_label}</em>
                </button>
                <button className="mobile-tool-card" onClick={()=>setPage("products")}>
                  <span>📦</span><b>{t.nav_products}</b><em>{t.manage_items}</em>
                </button>
                <button className="mobile-tool-card" onClick={()=>setPage("sales")}>
                  <span>📊</span><b>{t.nav_sales}</b><em>{settings.currency}{totRev.toLocaleString()}</em>
                </button>
              </div>
              <div className="mobile-swipe-hint">{t.profile_menu_hint}</div>
            </section>
          </div>
        )}

        {/* MINERS PAGE */}
        {page==="miners"&&(
          <div className="subpage">
            <div className="subpage-hd"><div><h2>{t.nav_miners}</h2><p>{t.miners_sub}</p></div>
              <button className="btn-out" onClick={()=>csvDL("miners.csv",["#","Name","Username","Platform","Orders","Total"],buyers.map(b=>[b.num,b.name,`@${b.handle}`,b.platform,b.totalOrders,`${settings.currency}${b.totalSpent}`]))}>⬇ {t.export_csv}</button>
            </div>
            <div className="grid4 miners-page-stats">
              <div className="mstat"><div className="ms-l">{t.total_buyers}</div><div className="ms-v">{buyers.length}</div></div>
              <div className="mstat"><div className="ms-l">{t.total_orders}</div><div className="ms-v">{totOrd}</div></div>
              <div className="mstat"><div className="ms-l">{t.total_spent_label}</div><div className="ms-v">{settings.currency}{totRev.toLocaleString()}</div></div>
              <div className="mstat"><div className="ms-l">{t.platforms_label}</div><div className="ms-v">{new Set(buyers.map(b=>b.platform)).size||0}</div></div>
            </div>
            <input
              className="search-inp mobile-miner-search"
              value={mobileMinerSearch}
              onChange={e=>setMobileMinerSearch(e.target.value)}
              placeholder={t.search_buyer}
            />
            <div className="table-card">
              <table className="tbl">
                <thead><tr><th>#</th><th>{t.name_col}</th><th>{t.username_label}</th><th>{t.platform_label}</th><th>{t.orders_col}</th><th>{t.total_label}</th><th></th></tr></thead>
                <tbody>
                  {mobileMinerBuyers.length===0&&<tr><td colSpan={7} style={{textAlign:"center",padding:40,color:"#888"}}>{t.no_buyers_yet}</td></tr>}
                  {mobileMinerBuyers.map(b=>(
                    <tr key={b.handle}>
                      <td><div style={{width:28,height:28,borderRadius:"50%",background:nc(b.num),color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>{b.num}</div></td>
                      <td><div style={{display:"flex",alignItems:"center",gap:8}}><Av name={b.name} size={28}/><strong>{b.name}</strong></div></td>
                      <td className="mono" style={{color:"#7F77DD"}}>@{b.handle}</td>
                      <td><Badge label={b.platform} color={b.platform==="TikTok"?"purple":"green"}/></td>
                      <td>{b.totalOrders}</td>
                      <td><strong style={{color:"#534AB7"}}>{b.totalSpent>0?`${settings.currency}${b.totalSpent.toLocaleString()}`:""}</strong></td>
                      <td><button onClick={()=>{setSelBuyer(b);setPage("dashboard");printSlip(b,settings.currency,user.profile.storeName||"SellerFlowLive",settings);}} style={{padding:"5px 12px",background:"#7F77DD",color:"#fff",border:"none",borderRadius:7,fontSize:11,cursor:"pointer"}}>🖨 {t.print_label}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {page==="orders"&&<Orders orders={allOrders} setOrders={setAllOrders} onPersist={orders=>LS.set(sellerMemoryKey("sf_orders"),orders)} cur={settings.currency} t={t}/>}
        {page==="products"&&<Products cur={settings.currency} t={t}/>}
        {page==="customers"&&<><Customers buyers={buyers} cur={settings.currency} t={t}/><CommentArchive comments={archivedComments} t={t}/></>}
        {page==="customerData"&&isAdminUser(user)&&<CustomerDataPage user={user} t={t}/>}
        {page==="print"&&<PrintPage buyers={buyers} cur={settings.currency} storeName={user.profile.storeName||"SellerFlowLive"} settings={settings} t={t}/>}
        {page==="sales"&&<Sales orders={allOrders} buyers={buyers} cur={settings.currency} t={t}/>}
        {page==="shipping"&&isAdminUser(user)&&<Shipping user={user} t={t}/>}
        {page==="settings"&&<SettingsPage user={user} settings={settings} onSaveProfile={handleSaveProfile} onSaveSettings={handleSaveSettings} onSavePw={handleSavePw} onExportBackup={exportSellerBackup} onClearLiveComments={clearLiveCommentsOnly} onResetBuyerCounter={resetBuyerCounterOnly} t={t}/>}
        {page==="subscription"&&<SubPage user={user} onActivate={handleActivate} t={t}/>}
        {page==="support"&&<Support user={user} t={t}/>}
        {page==="admin"&&<AdminPage currentUser={user} onApprove={handleAdminApprove} orders={allOrders} t={t}/>}
        {page==="privacy"&&<LegalPage kind="privacy" onBack={()=>setPage("settings")}/>}
        {page==="terms"&&<LegalPage kind="terms" onBack={()=>setPage("settings")}/>}
        {page==="deleteAccount"&&<DeleteAccountPage user={user} onDelete={handleDeleteAccount} onCancel={()=>setPage("settings")}/>}
      </main>

      {user&&(
        <nav className="mobile-bottom-nav">
          <button className={page==="dashboard"?"active":""} onClick={()=>setPage("dashboard")}>
            <span style={{fontSize:22}}>⌂</span>
            <span>{t.nav_live}</span>
          </button>
          <button className={page==="miners"?"active":""} onClick={()=>setPage("miners")}>
            <span style={{fontSize:22}}>♙</span>
            <span>{t.nav_miners}</span>
          </button>
          <button className={page==="orders"?"active":""} onClick={()=>setPage("orders")}>
            <span style={{fontSize:22}}>▤</span>
            <span>{t.nav_orders}</span>
          </button>
          <button className={page==="products"?"active":""} onClick={()=>setPage("products")}>
            <span style={{fontSize:22}}>▣</span>
            <span>{t.nav_products}</span>
          </button>
          <button
            className={!["dashboard","miners","orders","products"].includes(page)?"active":""}
            onClick={e=>{e.stopPropagation();setShowProf(p=>!p);}}
          >
            <span style={{fontSize:22}}>•••</span>
            <span>{t.more_label}</span>
            {(()=>{const moreBadge=isAdminUser(user)?pendingUsersCount+expiringSoonCount:0;return moreBadge>0&&<span className="mobile-nav-badge">{moreBadge>9?"9+":moreBadge}</span>;})()}
          </button>
        </nav>
      )}

      {showConn&&<ConnectModal onClose={()=>setShowConn(false)} onConnect={connectPlatform} user={user} t={t} initialTab={connectTab}/>}
    </div>
  );
}
