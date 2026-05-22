import { saveOrderToDatabase, saveCustomerToDatabase } from "./db";
import {
  type AccountAuditLog,
  deleteSupportMessagesForEmail,
  deleteUser,
  findUser,
  listAuditLogs,
  listSupportMessages,
  listUsers,
  saveAuditLog,
  saveSupportMessage,
  updateSupportReply,
  updateSupportStatus,
  upsertUser,
} from "./accountDb";

import { useState, useEffect, useRef } from "react";
import { io } from "socket.io-client";
import "./App.css";
import { TRANSLATIONS, type Lang, type T } from "./translations";

// ─── Types ────────────────────────────────────────────────────────────────────
type Plan = "trial" | "basic" | "pro" | "master";
type PlanStatus = "active" | "expired" | "pending";
type Page = "dashboard"|"miners"|"orders"|"products"|"customers"|"customerData"|"print"|"sales"|"settings"|"subscription"|"support"|"admin"|"privacy"|"terms"|"deleteAccount";

interface Profile { fullName:string; storeName:string; phone:string; tiktok:string; facebook:string; }
interface User { email:string; password:string; profile:Profile; plan:Plan; planStatus:PlanStatus; planExpiry:string; trialStartedAt?:string; connectedAccounts:string[]; }
interface LiveOrder { orderNum:number; item:string; qty:number; price:number; total:number; time:string; handle:string; name:string; bNum:number; platform:string; status:string; date:string; }
interface Buyer { handle:string; name:string; platform:string; num:number; orders:LiveOrder[]; totalSpent:number; totalOrders:number; }
interface Comment { handle:string; name:string; comment:string; platform:"TikTok"|"Facebook"; isBuy:boolean; buyerNum:number|null; buyerData:Buyer|null; time:string; avatar?:string; timestamp?:string; sellerId?:string; sessionId?:string; sourceUsername?:string; }
interface Product { id:number; name:string; sku:string; price:number; stock:number; platform:string; status:string; }
type ShippingStatus = "Pending"|"Ready"|"Shipped"|"Delivered"|"Returned";
interface ShippingCustomer { username:string; name:string; phone:string; sevenCode:string; note:string; lastComment:string; firstSeen:string; status:ShippingStatus; isNew:boolean; }
interface Settings { autoprint:boolean; soundAlert:boolean; stockAlert:boolean; dailyEmail:boolean; keywords:string; currency:string; paperSize:string; printerType:"usb"|"bluetooth"; stickerSize:string; printStoreName:boolean; printBuyerNumber:boolean; printBuyerUsername:boolean; printOrderItems:boolean; printTotal:boolean; printAutoClose:boolean; printLabelScale:number; printStoreScale:number; printBuyerNumberScale:number; printBuyerNameScale:number; printUsernameScale:number; printOrderScale:number; printCommentScale:number; printTotalScale:number; printStoreX:number; printStoreY:number; printBuyerLabelX:number; printBuyerLabelY:number; printBuyerNumberX:number; printBuyerNumberY:number; printBuyerNameX:number; printBuyerNameY:number; printUsernameX:number; printUsernameY:number; printSessionX:number; printSessionY:number; printOrderX:number; printOrderY:number; printTotalX:number; printTotalY:number; }
type NumberSettingKey = {[K in keyof Settings]: Settings[K] extends number ? K : never}[keyof Settings];
interface SupportMsg { id:string; name:string; email:string; subject:string; message:string; hasProof:boolean; proofImage?:string; timestamp:string; status:"pending"|"approved"|"rejected"|"resolved"; adminReply?:string; repliedAt?:string; }
interface NativePrinterPayload { type:"sellerflow.printSlip"; buyer:Buyer; currency:string; storeName:string; settings:Settings; sessionDate:string; createdAt:string; }

declare global {
  interface Window {
    SellerFlowPrinter?: { printSlip?: (payload:NativePrinterPayload)=>void|string|Promise<void|string>; status?: ()=>string|Promise<string>; };
    ReactNativeWebView?: { postMessage:(message:string)=>void };
    Capacitor?: { Plugins?: { SellerFlowPrinter?: { printSlip:(payload:NativePrinterPayload)=>Promise<void|string> } } };
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
const cleanComments=(list:unknown)=>Array.isArray(list)?list.map((c,i)=>normalizeComment(c,i)).filter((c):c is Comment=>!!c):[];
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
const sellerLiveDataKey=(base:string,email:string,sessionId:string)=>email?`${base}:${sellerIdOf(email)}:${sessionId}`:base;
const liveDayId=()=>{
  const d=new Date();
  const y=d.getFullYear();
  const m=String(d.getMonth()+1).padStart(2,"0");
  const day=String(d.getDate()).padStart(2,"0");
  return `${y}-${m}-${day}`;
};
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

const SERVER = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
const DEF_SETTINGS: Settings = { autoprint:true, soundAlert:true, stockAlert:true, dailyEmail:false, keywords:"", currency:"₱", paperSize:"100x60mm", printerType:"usb", stickerSize:"100x60mm", printStoreName:true, printBuyerNumber:true, printBuyerUsername:true, printOrderItems:true, printTotal:true, printAutoClose:true, printLabelScale:100, printStoreScale:100, printBuyerNumberScale:120, printBuyerNameScale:100, printUsernameScale:100, printOrderScale:100, printCommentScale:100, printTotalScale:100, printStoreX:0, printStoreY:0, printBuyerLabelX:0, printBuyerLabelY:0, printBuyerNumberX:0, printBuyerNumberY:0, printBuyerNameX:0, printBuyerNameY:0, printUsernameX:0, printUsernameY:0, printSessionX:0, printSessionY:0, printOrderX:0, printOrderY:0, printTotalX:0, printTotalY:0 };
const LANG_OPTS: {code:Lang;label:string}[] = [{code:"en",label:"🇺🇸 EN"},{code:"fil",label:"🇵🇭 FIL"},{code:"zh",label:"🇨🇳 中文"},{code:"vi",label:"🇻🇳 VI"},{code:"th",label:"🇹🇭 TH"},{code:"id",label:"🇮🇩 ID"}];
const CURRENCIES = [{v:"₱",l:"₱ PHP"},{v:"$",l:"$ USD"},{v:"NT$",l:"NT$ NTD"},{v:"¥",l:"¥ CNY"},{v:"฿",l:"฿ THB"},{v:"₫",l:"₫ VND"}];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const safeLang=(value:unknown):Lang=>LANG_OPTS.some(l=>l.code===value)?value as Lang:"en";
const safeProfile=(p:Partial<Profile>|undefined):Profile=>({
  fullName:String(p?.fullName||""),
  storeName:String(p?.storeName||""),
  phone:String(p?.phone||""),
  tiktok:String(p?.tiktok||""),
  facebook:String(p?.facebook||""),
});
const safeUser=(raw:unknown):User|null=>{
  if(!raw||typeof raw!=="object")return null;
  const u=raw as Partial<User>;
  const email=String(u.email||"").trim().toLowerCase();
  if(!email)return null;
  const plan:Plan=["trial","basic","pro","master"].includes(String(u.plan))?u.plan as Plan:"trial";
  const planStatus:PlanStatus=["active","expired","pending"].includes(String(u.planStatus))?u.planStatus as PlanStatus:"active";
  return {
    email,
    password:String(u.password||""),
    profile:safeProfile(u.profile),
    plan,
    planStatus,
    planExpiry:String(u.planExpiry||addDays(plan==="trial"?7:31)),
    trialStartedAt:typeof u.trialStartedAt==="string"?u.trialStartedAt:"",
    connectedAccounts:Array.isArray(u.connectedAccounts)?u.connectedAccounts.map(String):[],
  };
};
const cleanUsers=(list:unknown)=>Array.isArray(list)?list.map(safeUser).filter((u):u is User=>!!u):[];
const nc=(n:number)=>n===1?"#26215C":n<=3?"#534AB7":"#7F77DD";
const ini=(s:string)=>s.split(/[\s_]/g).slice(0,2).map(w=>w[0]?.toUpperCase()).join("")||"??";
const abg=(h:string)=>{const c=["#7F77DD","#1D9E75","#D85A30","#D4537E","#378ADD","#BA7517"];let x=0;for(const ch of h)x=(x*31+ch.charCodeAt(0))%c.length;return c[Math.abs(x)];};
const addDays=(n:number)=>{const d=new Date();d.setDate(d.getDate()+n);return d.toISOString();};
const addMonths=(n:number)=>addDays(Math.max(1,n)*30);
const dLeft=(e:string,now=Date.now())=>Math.max(0,Math.ceil((new Date(e).getTime()-now)/86400000));
const normalizePhone=(value:string)=>String(value||"").replace(/\D/g,"");
const phoneDisplay=(value:string)=>String(value||"").trim();
const phoneAlreadyRegistered=(phone:string,users:User[])=>{
  const normalized=normalizePhone(phone);
  if(normalized.length<8)return false;
  return users.some(u=>normalizePhone(u.profile.phone)===normalized);
};
const maxAcc=(p:Plan)=>({trial:1,basic:1,pro:3,master:5}[p]);
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
const ENV_ADMIN_EMAILS=(import.meta.env.VITE_ADMIN_EMAILS||OWNER_EMAIL).split(",").map((e:string)=>e.trim().toLowerCase()).filter(Boolean);
const adminEmails=()=>Array.from(new Set([OWNER_EMAIL,...ENV_ADMIN_EMAILS,...arrLS<string>("sf_admin_emails").map(e=>e.trim().toLowerCase())].filter(Boolean)));
const isAdminEmail=(email:string)=>adminEmails().includes(email.trim().toLowerCase());
const rememberAdminEmail=(email:string)=>LS.set("sf_admin_emails",Array.from(new Set([...arrLS<string>("sf_admin_emails"),email.trim().toLowerCase()].filter(Boolean))));
const forgetAdminEmail=(email:string)=>LS.set("sf_admin_emails",arrLS<string>("sf_admin_emails").filter(e=>e.trim().toLowerCase()!==email.trim().toLowerCase()));
const supportReadKey=(email:string)=>`sf_support_read_${email.trim().toLowerCase()}`;
const isAdminUser=(u:User|null)=>!!u&&isAdminEmail(u.email);
const canConnectMore=(u:User)=>isAdminUser(u)||registeredAccountCount(u)<maxAcc(u.plan);
const asAdminPlan=(u:User)=>isAdminUser(u)?{...u,plan:"master" as Plan,planStatus:"active" as PlanStatus,planExpiry:addMonths(120)}:u;
const pName=(p:Plan,t:T)=>({trial:t.plan_trial,basic:t.plan_basic,pro:t.plan_pro,master:t.plan_master}[p]);
const pColor=(p:Plan)=>({trial:"gray",basic:"green",pro:"purple",master:"amber"}[p] as "gray"|"green"|"purple"|"amber");
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

function readProofImage(file:File|null):Promise<string>{
  return new Promise((resolve,reject)=>{
    if(!file){resolve("");return;}
    const img=new Image();
    const url=URL.createObjectURL(file);
    img.onload=()=>{
      const maxSize=1200;
      const scale=Math.min(1,maxSize/Math.max(img.width,img.height));
      const canvas=document.createElement("canvas");
      canvas.width=Math.max(1,Math.round(img.width*scale));
      canvas.height=Math.max(1,Math.round(img.height*scale));
      const ctx=canvas.getContext("2d");
      if(!ctx){URL.revokeObjectURL(url);reject(new Error("Cannot prepare proof image"));return;}
      ctx.drawImage(img,0,0,canvas.width,canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg",0.78));
    };
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error("Cannot read proof image"));};
    img.src=url;
  });
}

function hasNativeMobilePrinter(){
  if(typeof window==="undefined")return false;
  return !!(
    window.SellerFlowPrinter?.printSlip ||
    window.Capacitor?.Plugins?.SellerFlowPrinter?.printSlip ||
    window.ReactNativeWebView?.postMessage
  );
}

function sendSlipToNativePrinter(payload:NativePrinterPayload){
  if(typeof window==="undefined")return false;
  const showNativePrinterResult=(result:void|string|Promise<void|string>)=>{
    void Promise.resolve(result).then(msg=>{
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

function printSlip(buyer:Buyer,cur:string,storeName:string,printSettings:Settings|string){
  const cfg:Settings=typeof printSettings==="string"?{...DEF_SETTINGS,stickerSize:printSettings}:printSettings;
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
  const commentOnlyHtml=buyer.orders.map(o=>`<div class="order-entry"><div class="order-time">${o.time}</div><div class="order-comment">${o.item}</div></div>`).join("");
  const scaledOrderHtml=commentOnlyHtml;
  const frame=document.createElement("iframe");
  frame.title=`Slip #${buyer.num}`;
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
  doc.write(`<!DOCTYPE html><html><head><title>Slip #${buyer.num}</title><style>@page{size:${size.replace("x","mm ")}mm;margin:3mm}*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;width:${w}mm;color:#000}.head{display:flex;align-items:flex-start;justify-content:space-between;gap:3mm;margin-bottom:2.5mm}.brand{font-size:${14*storeScale}px;font-weight:800;transform:translate(${pos(cfg.printStoreX)}mm,${pos(cfg.printStoreY)}mm)}.brand span{color:#7F77DD}.session{font-size:${12*totalScale}px;font-weight:800;text-align:right;transform:translate(${pos(cfg.printSessionX)}mm,${pos(cfg.printSessionY)}mm)}.grid{display:grid;grid-template-columns:52% 48%;gap:3mm;align-items:start}.left{display:flex;flex-direction:column;gap:1.5mm;padding-top:1mm}.seller{font-size:${13*storeScale}px;font-weight:800;line-height:1.1;transform:translate(${pos(cfg.printStoreX)}mm,${pos(cfg.printStoreY)}mm)}.line{font-size:${13*buyerNameScale}px;font-weight:800;line-height:1.1}.muted{font-size:${10*usernameScale}px;font-weight:700;color:#333}.buyer-num{font-size:${13*buyerNumberScale}px;color:${color};font-weight:900;transform:translate(${pos(cfg.printBuyerNumberX)}mm,${pos(cfg.printBuyerNumberY)}mm)}.buyer-name{transform:translate(${pos(cfg.printBuyerNameX)}mm,${pos(cfg.printBuyerNameY)}mm)}.username{transform:translate(${pos(cfg.printUsernameX)}mm,${pos(cfg.printUsernameY)}mm)}.order-box{min-height:38mm;padding:0;transform:translate(${pos(cfg.printOrderX)}mm,${pos(cfg.printOrderY)}mm)}.order-title{font-size:${15*orderScale}px;font-weight:900;margin-bottom:2mm}.order-entry{border-left:2px solid #000;padding-left:2mm;margin-bottom:2mm}.order-time{font-size:${9*orderScale}px;color:#111;font-weight:500;line-height:1.1}.order-comment{font-size:${10*commentScale}px;font-weight:800;line-height:1.1;margin-top:.8mm}.total{border-top:1px dashed #777;margin-top:2mm;padding-top:1.5mm;display:flex;justify-content:space-between;gap:2mm;font-size:${11*totalScale}px;font-weight:800;transform:translate(${pos(cfg.printTotalX)}mm,${pos(cfg.printTotalY)}mm)}@media print{body{margin:0}}</style></head><body>
  <div class="head"><div class="brand">Seller<span>FlowLive</span></div><div class="session">Session: ${sess}</div></div>
  <div class="grid"><div class="left">
  ${cfg.printStoreName?`<div class="seller">${storeName}</div>`:""}
  ${cfg.printBuyerNumber?`<div class="line buyer-num">Buyer #${buyer.num}</div>`:""}
  <div class="line buyer-name">${buyer.name}</div>
  ${cfg.printBuyerUsername?`<div class="muted username">@${buyer.handle}</div>`:""}
  </div>
  ${cfg.printOrderItems?`<div class="order-box"><div class="order-title">Order here</div>${scaledOrderHtml}${cfg.printTotal?`<div class="total"><span>Total</span><span>${buyer.totalSpent>0?`${cur}${buyer.totalSpent.toLocaleString()}`:""}</span></div>`:""}</div>`:""}
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
// AUTH
// ═══════════════════════════════════════════════════════════════════
function Auth({onLogin,t,lang,setLang}:{onLogin:(u:User)=>void;t:T;lang:Lang;setLang:(l:Lang)=>void}){
  const [mode,setMode]=useState<"login"|"reg"|"forgot">("login");
  const [email,setEmail]=useState("");const [pw,setPw]=useState("");const [cpw,setCpw]=useState("");
  const [fn,setFn]=useState("");const [sn,setSn]=useState("");
  const [showPw,setShowPw]=useState(false);const [err,setErr]=useState("");const [ok,setOk]=useState("");const [busy,setBusy]=useState(false);
  async function login(e:React.FormEvent){e.preventDefault();setErr("");setBusy(true);
    const u=await findUser(email);
    if(!u){setErr(t.err_no_account);setBusy(false);return;}
    if(u.password!==pw){setErr(t.err_wrong_pw);setBusy(false);return;}
    LS.set("sf_session",u.email);onLogin(u);setBusy(false);
  }
  async function reg(e:React.FormEvent){e.preventDefault();setErr("");setBusy(true);
    if(!fn.trim()||!sn.trim()||!email.trim()||!pw){setErr(t.err_fill_all);setBusy(false);return;}
    if(pw.length<6){setErr(t.err_pw_short);setBusy(false);return;}
    if(pw!==cpw){setErr(t.err_pw_mismatch);setBusy(false);return;}
    const users=await listUsers();
    if(await findUser(email)){setErr(t.err_email_exists);setBusy(false);return;}
    const isFirstAccount=users.length===0;
    const nu:User={email:email.trim().toLowerCase(),password:pw,profile:{fullName:fn.trim(),storeName:sn.trim(),phone:"",tiktok:"",facebook:""},plan:isFirstAccount?"master":"trial",planStatus:"active",planExpiry:isFirstAccount?addMonths(120):addDays(7),connectedAccounts:[]};
    await upsertUser(nu);
    if(isFirstAccount)rememberAdminEmail(email);
    LS.set("sf_session",nu.email);onLogin(nu);setBusy(false);
  }
  async function forgot(e:React.FormEvent){e.preventDefault();setErr("");setBusy(true);
    const u=await findUser(email);
    if(!u){setErr(t.err_no_account);setBusy(false);return;}
    setOk(`${t.reset_sent} ${email}`);setBusy(false);
  }
  const go=(m:"login"|"reg"|"forgot")=>{setMode(m);setErr("");setOk("");};
  return(
    <div className="auth-bg">
      <div className="auth-left">
        <div className="auth-brand"><div className="auth-logo-ic"><svg width="26" height="26" viewBox="0 0 18 18"><path d="M4 6 Q4 3 7 3 L11 3 Q14 3 14 6 Q14 9 11 9.5 L7 10.5 Q4 10.5 4 13 Q4 15 7 15 L11 15 Q14 15 14 13" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg></div><span className="auth-brand-name">Seller<span>FlowLive</span></span></div>
        <div className="auth-hero"><h1 style={{whiteSpace:"pre-line"}}>{t.hero_title}</h1><p>{t.hero_sub}</p>
          <div className="auth-feats">{(t.hero_features as string[]).map(f=><div key={f} className="auth-feat"><span>✓</span>{f}</div>)}</div>
        </div>
        <div className="auth-lang-btns">{LANG_OPTS.map(l=><button key={l.code} onClick={()=>setLang(l.code)} className={`auth-lang-btn ${lang===l.code?"active":""}`}>{l.label}</button>)}</div>
      </div>
      <div className="auth-right">
        <div className="auth-card">
          {mode==="login"&&<>
            <h2>{t.login_title}</h2><p className="auth-sub">{t.login_sub}</p>
            <form onSubmit={login} className="auth-form">
              {err&&<div className="auth-err">⚠ {err}</div>}
              <Fg label={t.email_field}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@email.com" required autoFocus/></Fg>
              <Fg label={t.pw_field}><div className="pw-wrap"><input type={showPw?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)} placeholder="••••••••" required/><button type="button" onClick={()=>setShowPw(p=>!p)} className="pw-eye">{showPw?"🙈":"👁"}</button></div></Fg>
              <div style={{textAlign:"right",marginBottom:4}}><button type="button" className="auth-link" onClick={()=>go("forgot")}>{t.forgot_link}</button></div>
              <button type="submit" className="auth-btn" disabled={busy}>{busy?t.signing_in:t.sign_in_btn}</button>
            </form>
            <div className="auth-sw">{t.no_account} <button className="auth-link" onClick={()=>go("reg")}>{t.create_account} →</button></div>
          </>}
          {mode==="reg"&&<>
            <h2>{t.register_title}</h2><p className="auth-sub">{t.register_sub}</p>
            <form onSubmit={reg} className="auth-form">
              {err&&<div className="auth-err">⚠ {err}</div>}
              <div className="auth-row2">
                <Fg label={t.fname_field}><input value={fn} onChange={e=>setFn(e.target.value)} placeholder="Maria Reyes" required/></Fg>
                <Fg label={t.sname_field}><input value={sn} onChange={e=>setSn(e.target.value)} placeholder="Maria's Shop" required/></Fg>
              </div>
              <Fg label={t.email_field}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@email.com" required/></Fg>
              <Fg label={t.pw_field}><div className="pw-wrap"><input type={showPw?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)} placeholder="Min 6 chars" required/><button type="button" onClick={()=>setShowPw(p=>!p)} className="pw-eye">{showPw?"🙈":"👁"}</button></div></Fg>
              <Fg label={t.confirm_field}><input type="password" value={cpw} onChange={e=>setCpw(e.target.value)} placeholder="••••••••" required/></Fg>
              <button type="submit" className="auth-btn" disabled={busy}>{busy?t.creating:t.start_trial_btn}</button>
              <a className="printer-shortcut-link" href="/sellerflow-printer-shortcut.bat?v=6" download>Printer Shortcut</a>
              <p className="auth-terms">{t.terms_text}</p>
            </form>
            <div className="auth-sw">{t.have_account} <button className="auth-link" onClick={()=>go("login")}>{t.sign_in_btn} →</button></div>
          </>}
          {mode==="forgot"&&<>
            <h2>{t.forgot_title}</h2><p className="auth-sub">{t.forgot_sub}</p>
            <form onSubmit={forgot} className="auth-form">
              {err&&<div className="auth-err">⚠ {err}</div>}
              {ok&&<div className="auth-ok">✓ {ok}</div>}
              <Fg label={t.email_field}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@email.com" required autoFocus/></Fg>
              <button type="submit" className="auth-btn" disabled={busy}>{busy?t.sending:t.send_reset}</button>
            </form>
            <div className="auth-sw"><button className="auth-link" onClick={()=>go("login")}>← {t.back_login}</button></div>
          </>}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// TRIAL EXPIRED WALL
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
  const [publicPlanMonths,setPublicPlanMonths]=useState<Record<Exclude<Plan,"trial">,number>>({basic:1,pro:1,master:1});
  const [publicLegal,setPublicLegal]=useState<""|"privacy"|"terms">(()=>{
    if(typeof window==="undefined")return "";
    return window.location.hash==="#privacy"?"privacy":window.location.hash==="#terms"?"terms":"";
  });
  async function login(e:React.FormEvent){e.preventDefault();setErr("");setBusy(true);
    const u=await findUser(email);
    if(!u){setErr(t.err_no_account);setBusy(false);return;}
    if(u.password!==pw){setErr(t.err_wrong_pw);setBusy(false);return;}
    LS.set("sf_session",u.email);onLogin(u);setBusy(false);
  }
  async function reg(e:React.FormEvent){e.preventDefault();setErr("");setOk("");setBusy(true);
    if(!fn.trim()||!sn.trim()||!email.trim()||!pw){setErr(t.err_fill_all);setBusy(false);return;}
    if(normalizePhone(phone).length<8){setErr("Enter a valid phone number for admin review.");setBusy(false);return;}
    if(pw.length<6){setErr(t.err_pw_short);setBusy(false);return;}
    if(pw!==cpw){setErr(t.err_pw_mismatch);setBusy(false);return;}
    const users=await listUsers();
    if(await findUser(email)){setErr(t.err_email_exists);setBusy(false);return;}
    const isFirstAccount=users.length===0;
    if(!isFirstAccount&&phoneAlreadyRegistered(phone,users)){setErr("This phone number is already registered. Please log in or contact support.");setBusy(false);return;}
    const now=new Date().toISOString();
    const nu:User={
      email:email.trim().toLowerCase(),
      password:pw,
      profile:{fullName:fn.trim(),storeName:sn.trim(),phone:phoneDisplay(phone),tiktok:"",facebook:""},
      plan:isFirstAccount?"master":"trial",
      planStatus:isFirstAccount?"active":"pending",
      planExpiry:isFirstAccount?addMonths(120):now,
      trialStartedAt:isFirstAccount?now:"",
      connectedAccounts:[],
    };
    await upsertUser(nu);
    if(isFirstAccount)rememberAdminEmail(email);
    LS.set("sf_session",nu.email);onLogin(nu);setBusy(false);
  }
  async function forgot(e:React.FormEvent){e.preventDefault();setErr("");setBusy(true);
    const u=await findUser(email);
    if(!u){setErr(t.err_no_account);setBusy(false);return;}
    setOk(`${t.reset_sent} ${email}`);setBusy(false);
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
    {title:"1-Click Print",body:"Turn any live comment into a buyer slip instantly, with a print-ready layout for fast packing."},
    {title:"Live Comment Capture",body:"Keep TikTok and Facebook live comments organized as they arrive, with buyer names and usernames visible."},
    {title:"Order Management",body:"Create, review, and track live orders without jumping between spreadsheets, chats, and paper notes."},
    {title:"Customer Database",body:"Remember repeat buyers, order history, usernames, and searchable customer details."},
    {title:"Bluetooth Printer Support",body:"Prepare mobile sellers for direct Bluetooth receipt printing from the app workflow."},
    {title:"Sales Analytics",body:"See daily orders, buyers, revenue, and seller activity in a clean dashboard view."},
  ];
  const flowItems=[
    {title:"Admin",label:"Control plans and sellers",body:"Admin creates or edits sellers, approves payment proof, changes plans, resets passwords, locks registered platform accounts, and reviews audit logs."},
    {title:"Live",label:"Capture buyer comments",body:"Seller connects TikTok or Facebook Live, then SellerFlowLive keeps every comment readable with time, username, platform, cart count, and 1-click action."},
    {title:"Computer",label:"Work from one dashboard",body:"The dashboard keeps comments, buyer numbers, slip preview, miners list, sales, customers, and support in one compact workspace."},
    {title:"Payment",label:"Proof and support chat",body:"Sellers send proof of payment or complaints. Admin sees each seller as a message bubble and can reply, approve, reject, or resolve."},
    {title:"Full screen",label:"Readable during live selling",body:"The live feed uses compact rows for laptop or desktop so more comments fit on screen while keeping buttons readable."},
    {title:"Big box",label:"Main order workspace",body:"The main center area is for fast work: search, create orders, print slips, reprint if printer fails, and keep buyer history saved."},
  ];
  const howSteps=[
    "Create a seller account or let the admin create one.",
    "Register the TikTok account or Facebook page allowed by the seller plan.",
    "Connect live stream from the top bar when selling starts.",
    "Click 1-click on any buyer comment to create and print the order slip.",
    "Use Customers, Orders, Print, Sales, and Support to review everything after the live.",
  ];
  const faqItems=[
    ["Can sellers change their TikTok or Facebook account?","They can register the allowed account slots once. After saving, those accounts are locked and only admin can change them."],
    ["What happens when a plan expires?","The seller can still open Support and Subscription, but selling tools are blocked until admin approves or upgrades the plan."],
    ["Can I print without extra popups?","Yes. Turn on auto-print in Settings, adjust the printer output, then 1-click orders will print directly through the browser print flow."],
    ["Where do payment proofs show?","Proof images appear inside the admin and seller support conversation bubbles so you can approve faster."],
    ["Is the customer list searchable?","Yes. SellerFlowLive saves buyer/customer memory so sellers can search names, usernames, buyer numbers, orders, and totals."],
    ["Who controls seller limits?","Admin controls plan, expiry, locked accounts, seller edits, password resets, and support approvals."],
  ];
  const monthOptions=Array.from({length:12},(_,i)=>i+1);
  const publicPlans=[
    {id:"trial" as Plan,name:"Free Trial",basePrice:0,period:"7 Days",desc:"Perfect for new live sellers starting online selling.",features:["1 TikTok or Facebook Page","Live comment detection","Auto order capture","Basic order printing","Real-time customer comments","Easy setup in minutes"],bestFor:"New live sellers",action:"Start Free Trial"},
    {id:"basic" as Plan,name:"Basic",basePrice:15,period:"month",desc:"Best for solo live sellers who want faster order processing.",features:["1 TikTok or Facebook Page","Fast live comment detection","1-click order creation","Auto customer information capture","Instant printing support","Sales tracking dashboard","Order history storage","Basic customer support","Mobile & desktop friendly"],bestFor:"Small sellers & beginners",action:"Select Basic Plan"},
    {id:"pro" as Plan,name:"Pro",basePrice:25,period:"month",desc:"For growing sellers managing multiple live pages.",features:["3 TikTok/Facebook Pages","Multi-page live streaming support","Can livestream all pages at once","Unlimited orders","Faster comment grabbing","Advanced sales analytics","Priority printing system","Customer management tools","Messenger-like support panel","Faster support response","Export reports","Smart live order workflow"],bestFor:"Full-time live sellers",action:"Upgrade to Pro",popular:true},
    {id:"master" as Plan,name:"Master",basePrice:40,period:"month",desc:"Built for teams, agencies, and large live-selling businesses.",features:["5 TikTok/Facebook Pages","Simultaneous multi-live support","Unlimited orders","Ultra-fast comment detection","Team/admin management","Priority customer support","Advanced reporting dashboard","Staff access control","Dedicated seller tools","Faster live processing","Premium support","Future feature access","Scalable for large operations"],bestFor:"Teams & high-volume sellers",action:"Go Master"},
  ];
  const accountForm=(
    <div className="auth-card public-auth-card">
      {mode==="login"&&<>
        <h2>{t.login_title}</h2><p className="auth-sub">{t.login_sub}</p>
        <form onSubmit={login} className="auth-form">
          {err&&<div className="auth-err">Warning: {err}</div>}
          <Fg label={t.email_field}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@email.com" required autoFocus/></Fg>
          <Fg label={t.pw_field}><div className="pw-wrap"><input type={showPw?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)} placeholder="Password" required/><button type="button" onClick={()=>setShowPw(p=>!p)} className="pw-eye">{showPw?"Hide":"Show"}</button></div></Fg>
          <div style={{textAlign:"right",marginBottom:4}}><button type="button" className="auth-link" onClick={()=>go("forgot")}>{t.forgot_link}</button></div>
          <button type="submit" className="auth-btn" disabled={busy}>{busy?t.signing_in:t.sign_in_btn}</button>
        </form>
        <div className="auth-sw">{t.no_account} <button className="auth-link" onClick={()=>go("reg")}>{t.create_account}</button></div>
      </>}
      {mode==="reg"&&<>
        <h2>{t.register_title}</h2><p className="auth-sub">{t.register_sub}</p>
        <form onSubmit={reg} className="auth-form">
          {err&&<div className="auth-err">Warning: {err}</div>}
          {ok&&<div className="auth-ok">Done: {ok}</div>}
          <div className="auth-row2">
            <Fg label={t.fname_field}><input value={fn} onChange={e=>setFn(e.target.value)} placeholder="Maria Reyes" required/></Fg>
            <Fg label={t.sname_field}><input value={sn} onChange={e=>setSn(e.target.value)} placeholder="Maria's Shop" required/></Fg>
          </div>
          <Fg label={t.email_field}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@email.com" required/></Fg>
          <Fg label="Phone number"><input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+63 912 345 6789" inputMode="tel" required/></Fg>
          <Fg label={t.pw_field}><div className="pw-wrap"><input type={showPw?"text":"password"} value={pw} onChange={e=>setPw(e.target.value)} placeholder="Min 6 chars" required/><button type="button" onClick={()=>setShowPw(p=>!p)} className="pw-eye">{showPw?"Hide":"Show"}</button></div></Fg>
          <Fg label={t.confirm_field}><input type="password" value={cpw} onChange={e=>setCpw(e.target.value)} placeholder="Confirm password" required/></Fg>
          <button type="submit" className="auth-btn" disabled={busy}>{busy?"Submitting...":"Submit for admin approval"}</button>
          <a className="printer-shortcut-link" href="/sellerflow-printer-shortcut.bat?v=6" download>Printer Shortcut</a>
          <p className="auth-terms">Your free trial starts only after admin approval.</p>
          <p className="auth-terms">By creating an account, you agree to SellerFlowLive <button type="button" className="inline-link" onClick={()=>openLegal("terms")}>Terms</button> and <button type="button" className="inline-link" onClick={()=>openLegal("privacy")}>Privacy Policy</button>.</p>
        </form>
        <div className="auth-sw">{t.have_account} <button className="auth-link" onClick={()=>go("login")}>{t.sign_in_btn}</button></div>
      </>}
      {mode==="forgot"&&<>
        <h2>{t.forgot_title}</h2><p className="auth-sub">{t.forgot_sub}</p>
        <form onSubmit={forgot} className="auth-form">
          {err&&<div className="auth-err">Warning: {err}</div>}
          {ok&&<div className="auth-ok">Done: {ok}</div>}
          <Fg label={t.email_field}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@email.com" required autoFocus/></Fg>
          <button type="submit" className="auth-btn" disabled={busy}>{busy?t.sending:t.send_reset}</button>
        </form>
        <div className="auth-sw"><button className="auth-link" onClick={()=>go("login")}>{t.back_login}</button></div>
      </>}
    </div>
  );
  return(
    <div className="public-page">
      <header className="public-nav">
        <button className="public-brand" onClick={()=>jump("home")}><span className="public-logo">S</span><span>Seller<span>FlowLive</span></span></button>
        <nav><button onClick={()=>jump("features")}>Features</button><button onClick={()=>jump("pricing")}>Price list</button><button onClick={()=>jump("instructions")}>How to use</button><button onClick={()=>jump("support-info")}>Support</button><button onClick={()=>jump("faq")}>FAQ</button></nav>
        <div className="public-nav-actions"><select value={lang} onChange={e=>setLang(e.target.value as Lang)}>{LANG_OPTS.map(l=><option key={l.code} value={l.code}>{l.label}</option>)}</select><button onClick={()=>{go("login");jump("account")}}>Log in</button><button className="public-primary" onClick={()=>{go("reg");jump("account")}}>Register</button></div>
      </header>
      <section id="home" className="public-hero">
        <div className="public-hero-copy"><span className="public-kicker">Premium live selling workspace</span><h1>Stop typing. Start selling.</h1><p>Capture live orders, manage buyers, and print receipts in one click.</p><div className="public-hero-actions"><button className="public-primary" onClick={()=>{go("reg");jump("account")}}>Try free trial</button><button onClick={()=>jump("instructions")}>See how it works</button></div><div className="public-metrics"><div><b>1-click</b><span>receipt printing</span></div><div><b>Live</b><span>comment capture</span></div><div><b>Smart</b><span>buyer database</span></div></div></div>
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
        <div className="public-section-head"><span>System map</span><h2>Everything connects in one selling workflow</h2><p>Click each area to learn what it does inside SellerFlowLive.</p></div>
        <div className="workflow-board">
          <div className="workflow-left">
            {flowItems.slice(0,3).map((item,i)=><button key={item.title} className={activeFlow===i?"active":""} onClick={()=>setActiveFlow(i)}><strong>{item.title}</strong><span>{item.label}</span></button>)}
          </div>
          <button className="workflow-center" onClick={()=>setActiveFlow(5)}>
            <span>SellerFlowLive workspace</span>
            <strong>Live comments, orders, print slips, customers, sales, support</strong>
            <em>Click to see the main order box</em>
          </button>
          <div className="workflow-right">
            {flowItems.slice(3).map((item,i)=><button key={item.title} className={activeFlow===i+3?"active":""} onClick={()=>setActiveFlow(i+3)}><strong>{item.title}</strong><span>{item.label}</span></button>)}
          </div>
        </div>
        <div className="workflow-detail">
          <small>{flowItems[activeFlow].title}</small>
          <h3>{flowItems[activeFlow].label}</h3>
          <p>{flowItems[activeFlow].body}</p>
          <button onClick={()=>jump(activeFlow===3?"support-info":activeFlow===0?"account":"features")}>Open related section</button>
        </div>
      </section>
      <section id="features" className="public-section public-feature-band"><div className="public-section-head"><span>Features</span><h2>Everything live sellers need in one sharp workspace</h2><p>Clear tools for capturing comments, creating orders, printing slips, and tracking buyers without slowing down the live.</p></div><div className="public-feature-cards">{featureItems.map((f,i)=><button key={f.title} className={activeFeature===i?"active":""} onClick={()=>setActiveFeature(i)}><span>{String(i+1).padStart(2,"0")}</span><strong>{f.title}</strong><p>{f.body}</p></button>)}</div><div className="public-feature-detail premium"><small>Selected feature</small><h3>{featureItems[activeFeature].title}</h3><p>{featureItems[activeFeature].body}</p><button onClick={()=>jump("account")}>Try this workflow</button></div></section>
      <section id="instructions" className="public-section public-instructions"><div className="public-section-head"><span>Instructions</span><h2>How to use SellerFlowLive</h2><p>Simple daily workflow for sellers and admins.</p></div><div className="public-steps">{howSteps.map((step,i)=><button key={step} onClick={()=>i<2?jump("account"):jump("features")}><b>{i+1}</b><span>{step}</span></button>)}</div></section>
      <section id="pricing" className="public-section public-pricing-section"><div className="public-section-head"><span>Price list</span><h2>Choose the plan that fits the seller</h2><p>Simple plans for live sellers, from first stream to full team operations.</p></div><div className="public-pricing">{publicPlans.map((p,i)=>{const paid=p.id!=="trial";const months=paid?publicPlanMonths[p.id]:1;const price=paid?p.basePrice*months:p.basePrice;return <button key={p.name} className={p.popular?"popular":""} onClick={()=>{go(i===0?"reg":"login");jump("account")}}>{p.popular&&<small>Most popular</small>}<span className="pricing-icon">{i+1}</span><strong>{p.name}</strong><b>${price}</b><span className="pricing-period">/{paid?`${months} ${months===1?"month":"months"}`:p.period}</span>{paid&&<div className="public-plan-duration" onClick={e=>e.stopPropagation()}><span>Duration</span><select value={months} onChange={e=>setPublicPlanMonths(current=>({...current,[p.id]:Number(e.target.value)}))}>{monthOptions.map(month=><option key={month} value={month}>{month} {month===1?"month":"months"}</option>)}</select><em>${p.basePrice}/month</em></div>}<p>{p.desc}</p><ul>{p.features.map(f=><li key={f}>{f}</li>)}</ul><div className="pricing-best"><span>Best For</span><b>{p.bestFor}</b></div><em>{p.action}</em></button>})}</div></section>
      <section id="support-info" className="public-section public-support-band"><div><span>Support</span><h2>Handle seller complaints like Messenger</h2><p>Every seller can send a payment proof or support issue. Admin receives a compact chat thread, can approve, reject, resolve, reply, and see unread notifications.</p></div><button onClick={()=>{go("login");jump("account")}}>Open seller account</button></section>
      <section id="faq" className="public-section"><div className="public-section-head"><span>FAQ</span><h2>Frequently asked questions</h2><p>Click a question to expand the answer.</p></div><div className="public-faq">{faqItems.map((item,i)=><button key={item[0]} className={openFaq===i?"open":""} onClick={()=>setOpenFaq(openFaq===i?-1:i)}><div><span>{i+1}</span><strong>{item[0]}</strong><b>{openFaq===i?"-":"+"}</b></div>{openFaq===i&&<p>{item[1]}</p>}</button>)}</div></section>
      <section id="account" className="public-account"><div className="public-account-copy"><span>Account access</span><h2>Start using SellerFlowLive</h2><p>Login if you already have a seller account. Register only if you are creating a new shop account.</p></div>{accountForm}</section>
      <footer className="public-footer"><div><strong>SellerFlowLive</strong><p>Live selling order system for TikTok and Facebook sellers.</p></div><div><button onClick={()=>jump("features")}>Features</button><button onClick={()=>jump("instructions")}>Instructions</button><button onClick={()=>jump("pricing")}>Price list</button><button onClick={()=>openLegal("privacy")}>Privacy</button><button onClick={()=>openLegal("terms")}>Terms</button><button onClick={()=>jump("account")}>Login</button></div></footer>
    </div>
  );
}

void Auth;

function AccountGate({user,onContinue,onSwitch}:{user:User;onContinue:()=>void;onSwitch:()=>void}){
  return(
    <div className="auth-page">
      <div className="auth-card" style={{maxWidth:460}}>
        <div className="auth-brand">
          <div className="logo-ic"><svg width="16" height="16" viewBox="0 0 18 18"><path d="M4 6 Q4 3 7 3 L11 3 Q14 3 14 6 Q14 9 11 9.5 L7 10.5 Q4 10.5 4 13 Q4 15 7 15 L11 15 Q14 15 14 13" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg></div>
          <span>Seller<span>FlowLive</span></span>
        </div>
        <h2>Choose account</h2>
        <p className="auth-sub">This browser remembers the last SellerFlowLive login. Confirm it first so Chrome or Edge will not open the wrong seller.</p>
        <div className="pd-hd" style={{border:"1px solid #E4DED2",borderRadius:8,margin:"14px 0",padding:12}}>
          <div className="pd-av">{ini(user.profile.fullName||user.email)}</div>
          <div>
            <div className="pd-name">{user.profile.fullName||user.email}</div>
            <div className="pd-role">{user.email} · {pName(user.plan,TRANSLATIONS.en)}</div>
          </div>
        </div>
        <button type="button" className="auth-btn" onClick={onContinue}>Continue as this account</button>
        <button type="button" className="auth-link" style={{width:"100%",marginTop:14,textAlign:"center"}} onClick={onSwitch}>Use another account</button>
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

function PendingApprovalWall({user,onLogout}:{user:User;onLogout:()=>void}){
  return(
    <div className="pending-approval">
      <div className="pending-card">
        <h2>Waiting for admin approval</h2>
        <p>Your account was submitted successfully. The app will stay locked until admin approves your free trial.</p>
        <p><strong>Trial countdown has not started yet.</strong> It starts only after approval.</p>
        <p>{user.email}<br/>{user.profile.phone}</p>
        <div className="pending-actions">
          <button className="btn-out" onClick={onLogout}>Sign out</button>
          <button className="auth-btn" onClick={()=>window.location.reload()}>Refresh status</button>
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

function SubPage({user,onActivate,t}:{user:User;onActivate:(plan:Plan,status:PlanStatus,expiry:string)=>void;t:T}){
  const [sel,setSel]=useState<Plan|null>(null);
  const [showPay,setShowPay]=useState(false);
  const [done,setDone]=useState(false);
  const [planMonths,setPlanMonths]=useState<Record<Exclude<Plan,"trial">,number>>({basic:1,pro:1,master:1});
  const days=dLeft(user.planExpiry);
  const paidPlanPrices:Record<Exclude<Plan,"trial">,number>={basic:15,pro:25,master:40};
  const monthOptions=Array.from({length:12},(_,i)=>i+1);
  const plans=[
    {id:"trial" as Plan,name:t.plan_trial,basePrice:0,period:"7 Days",color:"#A855F7",desc:"Perfect for new live sellers starting online selling.",features:["1 TikTok or Facebook Page","Live comment detection","Auto order capture","Basic order printing","Real-time customer comments","Easy setup in minutes"],bestFor:"New live sellers",action:"Start Free Trial"},
    {id:"basic" as Plan,name:t.plan_basic,basePrice:15,period:t.plan_month,color:"#A855F7",desc:"Best for solo live sellers who want faster order processing.",features:["1 TikTok or Facebook Page","Fast live comment detection","1-click order creation","Auto customer information capture","Instant printing support","Sales tracking dashboard","Order history storage","Basic customer support","Mobile & desktop friendly"],bestFor:"Small sellers & beginners",action:"Select Basic Plan"},
    {id:"pro" as Plan,name:t.plan_pro,basePrice:25,period:t.plan_month,color:"#A855F7",badge:t.plan_popular,desc:"For growing sellers managing multiple live pages.",features:["3 TikTok/Facebook Pages","Multi-page live streaming support","Can livestream all pages at once","Unlimited orders","Faster comment grabbing","Advanced sales analytics","Priority printing system","Customer management tools","Messenger-like support panel","Faster support response","Export reports","Smart live order workflow"],bestFor:"Full-time live sellers",action:"Upgrade to Pro"},
    {id:"master" as Plan,name:t.plan_master,basePrice:40,period:t.plan_month,color:"#A855F7",desc:"Built for teams, agencies, and large live-selling businesses.",features:["5 TikTok/Facebook Pages","Simultaneous multi-live support","Unlimited orders","Ultra-fast comment detection","Team/admin management","Priority customer support","Advanced reporting dashboard","Staff access control","Dedicated seller tools","Faster live processing","Premium support","Future feature access","Scalable for large operations"],bestFor:"Teams & high-volume sellers",action:"Go Master"},
  ] as const;
  const selectedPaidPlan=sel&&sel!=="trial"?sel:null;
  const selectedMonths=selectedPaidPlan?planMonths[selectedPaidPlan]:1;
  const selectedTotal=selectedPaidPlan?paidPlanPrices[selectedPaidPlan]*selectedMonths:0;
  const updateMonths=(plan:Exclude<Plan,"trial">,months:number)=>setPlanMonths(current=>({...current,[plan]:months}));

  function handleSelect(plan:Plan){
    setSel(plan);setDone(false);
    if(plan==="trial"){
      onActivate("trial","active",addDays(7));
      setDone(true);
    } else {
      setShowPay(true);
    }
  }
  return(
    <div className="subpage">
      <div className="subpage-hd"><div><h2>Subscription Plans</h2><p>{t.plan_current}: <Badge label={pName(user.plan,t)} color={pColor(user.plan)}/> · {days>0?`${days} ${t.days_remaining}`:t.expired_label}</p></div></div>
      {done&&<div className="auth-ok" style={{marginBottom:8}}>✓ {t.plan_activated}</div>}

      <div className="plans-grid">
        {plans.map(p=>(
          <div key={p.id} className={`plan-card ${sel===p.id?"sel":""} ${user.plan===p.id?"cur":""}`} onClick={()=>handleSelect(p.id)}>
            {"badge" in p&&p.badge&&<div className="plan-badge">{p.badge}</div>}
            {user.plan===p.id&&<div className="plan-cur-badge">{t.plan_current}</div>}
            <div className="plan-name">{p.name}</div>
            <div className="plan-price">
              <span className="plan-amt">{p.id==="trial"?"$0":`$${p.basePrice*planMonths[p.id]}`}</span>
              <span className="plan-period">{p.id==="trial"?p.period:`/${planMonths[p.id]} ${planMonths[p.id]===1?"month":"months"}`}</span>
            </div>
            {p.id!=="trial"&&(
              <div className="plan-duration" onClick={e=>e.stopPropagation()}>
                <label>Duration</label>
                <select value={planMonths[p.id as Exclude<Plan,"trial">]} onChange={e=>updateMonths(p.id as Exclude<Plan,"trial">,Number(e.target.value))}>
                  {monthOptions.map(month=><option key={month} value={month}>{month} {month===1?"month":"months"}</option>)}
                </select>
                <span>${p.basePrice}/month</span>
              </div>
            )}
            <div className="plan-desc minimal">{p.desc}</div>
            <ul className="plan-feature-list">{p.features.map(f=><li key={f}>{f}</li>)}</ul>
            <div className="plan-best"><span>Best For</span><b>{p.bestFor}</b></div>
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
                  <strong>{pName(sel,t)} - {selectedMonths} {selectedMonths===1?"month":"months"}</strong>
                  <span>Total to pay: ${selectedTotal}</span>
                </div>
                <div className="payment-detail"><span>👤</span><span>{t.payment_account}</span></div>
                <div className="payment-detail"><span>🔢</span><span>{t.payment_number}</span></div>
                <div className="payment-detail"><span>🏦</span><span>{t.payment_bank}</span></div>
                <div className="payment-detail"><span>🏛</span><span>{t.payment_name}</span></div>
                <div style={{marginTop:10,padding:"8px 12px",background:"#FFF8E1",borderRadius:8,fontSize:12,color:"#633806",lineHeight:1.5}}>{t.payment_note}</div>
              </div>
              <button onClick={()=>{setShowPay(false);}} className="btn-purple" style={{width:"100%",padding:"10px 0"}}>{t.payment_btn}</button>
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
                <td><Badge label={p.status} color={p.status==="Active"?"green":p.status==="Low stock"?"amber":"red"}/></td>
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
        <input placeholder="Search..." value={q} onChange={e=>setQ(e.target.value)} className="search-inp" style={{marginLeft:"auto",maxWidth:180}}/>
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
                <td><select value={o.status} onChange={e=>upStat(i,e.target.value)} className="stat-sel" style={{background:o.status==="Printed"?"#E1F5EE":o.status==="New"?"#EEEDFE":"#FAEEDA"}}><option>New</option><option>Printed</option><option>Waiting</option></select></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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
function CustomerDataPage({comments,onRefresh}:{comments:Comment[];onRefresh:()=>void}){
  const storageKey="sf_shipping_customer_data";
  const [records,setRecords]=useState<ShippingCustomer[]>(()=>arrLS<ShippingCustomer>(storageKey));
  const [query,setQuery]=useState("");
  const [columnFilters,setColumnFilters]=useState({username:"All",name:"All",phone:"All",sevenCode:"All"});
  const [statusFilter,setStatusFilter]=useState<"All"|ShippingStatus>("All");
  const [sortKey,setSortKey]=useState<"newest"|"username"|"status">("newest");
  const [page,setPage]=useState(1);
  const [rowsPerPage,setRowsPerPage]=useState(10);
  const [savedAt,setSavedAt]=useState("Saved");
  const esc=(v:string)=>String(v||"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[ch]||ch));
  const readyStatus=(r:ShippingCustomer):ShippingStatus=>r.name.trim()&&r.phone.trim()&&r.sevenCode.trim()?"Ready":"Pending";
  const persist=(next:ShippingCustomer[])=>{
    const normalized=next.map(r=>{
      const auto=readyStatus(r);
      const locked=["Shipped","Delivered","Returned"].includes(r.status);
      const status:ShippingStatus=locked?r.status:auto;
      return {...r,status};
    });
    setRecords(normalized);
    LS.set(storageKey,normalized);
    setSavedAt(`Saved ${new Date().toLocaleTimeString()}`);
  };
  useEffect(()=>{
    const tiktok=comments.filter(c=>c.platform==="TikTok"&&c.handle.trim());
    if(!tiktok.length)return;
    const timer=window.setTimeout(()=>setRecords(current=>{
      const byUser=new Map(current.map(r=>[r.username.toLowerCase(),r]));
      let changed=false;
      for(const c of tiktok){
        const username=c.handle.trim().replace(/^@/,"");
        const key=username.toLowerCase();
        if(byUser.has(key))continue;
        byUser.set(key,{username,name:c.name||username,phone:"",sevenCode:"",note:"",lastComment:c.comment||"",firstSeen:c.timestamp||new Date().toISOString(),status:"Pending",isNew:true});
        changed=true;
      }
      if(!changed)return current;
      const next=Array.from(byUser.values()).sort((a,b)=>new Date(b.firstSeen).getTime()-new Date(a.firstSeen).getTime());
      LS.set(storageKey,next);
      setSavedAt(`Synced ${new Date().toLocaleTimeString()}`);
      return next;
    }),0);
    return()=>window.clearTimeout(timer);
  },[comments]);
  const update=(username:string,patch:Partial<ShippingCustomer>)=>persist(records.map(r=>r.username===username?{...r,...patch,isNew:false}:r));
  const copy=(text:string)=>navigator.clipboard?.writeText(text);
  const printOne=(r:ShippingCustomer)=>{
    const frame=document.createElement("iframe");
    frame.style.position="fixed";frame.style.right="0";frame.style.bottom="0";frame.style.width="0";frame.style.height="0";frame.style.border="0";frame.style.opacity="0";
    document.body.appendChild(frame);
    const win=frame.contentWindow;if(!win){frame.remove();return;}
    const doc=win.document;doc.open();
    doc.write(`<!DOCTYPE html><html><head><title>${esc(r.username)} shipping</title><style>@page{size:100mm 60mm;margin:4mm}body{font-family:Arial,sans-serif;color:#000;margin:0}.brand{font-size:18px;font-weight:900;margin-bottom:4mm}.line{font-size:13px;margin:1.5mm 0}.label{font-size:10px;font-weight:900;text-transform:uppercase}.value{font-weight:900}.addr{font-size:17px;font-weight:900;line-height:1.15;margin-top:2mm}</style></head><body><div class="brand">SellerFlowLive Shipping</div><div class="line"><span class="label">Name</span><br/><span class="value">${esc(r.name)}</span></div><div class="line"><span class="label">Phone</span><br/><span class="value">${esc(r.phone)}</span></div><div class="line"><span class="label">7/11 Code</span><br/><span class="value">${esc(r.sevenCode)}</span></div><div class="line"><span class="label">TikTok</span><br/><span class="value">@${esc(r.username)}</span></div><div class="addr">${esc(r.note)}</div></body></html>`);
    doc.close();setTimeout(()=>{win.focus();win.print();setTimeout(()=>frame.remove(),8000);},100);
  };
  const bulkPrint=()=>filtered.filter(r=>r.status==="Ready").forEach(printOne);
  const exportRows=()=>csvDL(`shipping-customers-${new Date().toISOString().slice(0,10)}.csv`,["Username","Name","Phone","7/11 Code","Status","Last Comment","Note"],records.map(r=>[r.username,r.name,r.phone,r.sevenCode,r.status,r.lastComment,r.note]));
  const uniqueValues=(field:keyof Pick<ShippingCustomer,"username"|"name"|"phone"|"sevenCode">)=>["All",...Array.from(new Set(records.map(r=>r[field]).filter(Boolean))).sort()];
  const resetFilters=()=>{setQuery("");setStatusFilter("All");setColumnFilters({username:"All",name:"All",phone:"All",sevenCode:"All"});setSortKey("newest");setPage(1);};
  const filtered=records.filter(r=>{
    const q=query.toLowerCase();
    const matches=!q||[r.username,r.name,r.phone,r.sevenCode,r.lastComment,r.note].some(v=>v.toLowerCase().includes(q));
    const columnMatch=(columnFilters.username==="All"||r.username===columnFilters.username)
      &&(columnFilters.name==="All"||r.name===columnFilters.name)
      &&(columnFilters.phone==="All"||r.phone===columnFilters.phone)
      &&(columnFilters.sevenCode==="All"||r.sevenCode===columnFilters.sevenCode);
    return matches&&columnMatch&&(statusFilter==="All"||r.status===statusFilter);
  }).sort((a,b)=>sortKey==="username"?a.username.localeCompare(b.username):sortKey==="status"?a.status.localeCompare(b.status):new Date(b.firstSeen).getTime()-new Date(a.firstSeen).getTime());
  const pages=Math.max(1,Math.ceil(filtered.length/rowsPerPage));
  const currentPage=Math.min(page,pages);
  const pageRows=filtered.slice((currentPage-1)*rowsPerPage,currentPage*rowsPerPage);
  const firstRow=filtered.length?(currentPage-1)*rowsPerPage+1:0;
  const lastRow=Math.min(currentPage*rowsPerPage,filtered.length);
  const activeFilterCount=(query?1:0)+(statusFilter!=="All"?1:0)+Object.values(columnFilters).filter(v=>v!=="All").length;
  return(
    <div className="subpage">
      <div className="subpage-hd"><div><h2>Customer Data</h2><p>Collect shipping details, then print a shipping label fast.</p></div></div>
      <div className="customer-data-black-panel">
        <div className="cd-topbar">
          <div className="cd-search"><span>Search</span><input value={query} onChange={e=>{setQuery(e.target.value);setPage(1);}} placeholder="Search TikTok username, name, phone, 7/11 code..."/>{query&&<button onClick={()=>setQuery("")}>x</button>}</div>
          <button className="cd-tool-btn">Filters <b>{activeFilterCount}</b></button>
          <span className="cd-spacer"/>
          <button className="cd-tool-btn" onClick={resetFilters}>Reset Filters</button>
          <button className="cd-tool-btn" onClick={()=>setSavedAt("Columns saved")}>Columns</button>
          <button className="cd-tool-btn" onClick={()=>setSortKey(sortKey==="newest"?"username":sortKey==="username"?"status":"newest")}>Sort</button>
          <button className="cd-tool-btn" onClick={()=>setSavedAt(`View saved ${new Date().toLocaleTimeString()}`)}>Save View</button>
        </div>
        <div className="cd-filter-row">
          <label>TikTok Username<select value={columnFilters.username} onChange={e=>{setColumnFilters(f=>({...f,username:e.target.value}));setPage(1);}}>{uniqueValues("username").map(v=><option key={v}>{v}</option>)}</select></label>
          <label>Name<select value={columnFilters.name} onChange={e=>{setColumnFilters(f=>({...f,name:e.target.value}));setPage(1);}}>{uniqueValues("name").map(v=><option key={v}>{v}</option>)}</select></label>
          <label>Phone Number<select value={columnFilters.phone} onChange={e=>{setColumnFilters(f=>({...f,phone:e.target.value}));setPage(1);}}>{uniqueValues("phone").map(v=><option key={v}>{v}</option>)}</select></label>
          <label>7/11 Code<select value={columnFilters.sevenCode} onChange={e=>{setColumnFilters(f=>({...f,sevenCode:e.target.value}));setPage(1);}}>{uniqueValues("sevenCode").map(v=><option key={v}>{v}</option>)}</select></label>
          <label>Status<select value={statusFilter} onChange={e=>{setStatusFilter(e.target.value as "All"|ShippingStatus);setPage(1);}}><option>All</option><option>Pending</option><option>Ready</option><option>Shipped</option><option>Delivered</option><option>Returned</option></select></label>
          <label>Date Added<button type="button" className="cd-date-btn">Select date range</button></label>
          <span className="cd-save-state">{savedAt}</span>
        </div>
        <div className="cd-table-wrap">
          <table className="cd-table"><thead><tr><th>TikTok Username</th><th>Name</th><th>Phone Number</th><th>7/11 Code</th><th>Status</th><th>Date Added</th><th>Actions</th></tr></thead><tbody>
            {pageRows.length===0&&<tr><td colSpan={7} className="cd-empty">No new TikTok usernames yet</td></tr>}
            {pageRows.map(r=><tr key={r.username}>
              <td><strong>@{r.username}</strong>{r.isNew&&<b className="cd-new">New Buyer</b>}<small>{r.lastComment}</small></td>
              <td><input value={r.name} onChange={e=>update(r.username,{name:e.target.value})}/></td>
              <td><input value={r.phone} onChange={e=>update(r.username,{phone:e.target.value})} placeholder="Phone"/></td>
              <td><input value={r.sevenCode} onChange={e=>update(r.username,{sevenCode:e.target.value})} placeholder="7/11 code"/></td>
              <td><select className={`cd-status ${r.status.toLowerCase()}`} value={r.status} onChange={e=>update(r.username,{status:e.target.value as ShippingStatus})}><option>Pending</option><option>Ready</option><option>Shipped</option><option>Delivered</option><option>Returned</option></select></td>
              <td>{new Date(r.firstSeen).toLocaleString()}</td>
              <td><div className="cd-actions"><button onClick={()=>update(r.username,{isNew:false})}>Save</button><button onClick={()=>copy(r.phone)}>Copy phone</button><button onClick={()=>copy(r.sevenCode)}>Copy 7/11</button><button onClick={()=>printOne(r)}>Open shipping</button><button onClick={()=>update(r.username,{status:"Shipped"})}>Mark shipped</button></div></td>
            </tr>)}
          </tbody></table>
        </div>
        <div className="cd-pager"><span>Showing {firstRow} to {lastRow} of {filtered.length} customers</span><label>Rows per page:<select value={rowsPerPage} onChange={e=>{setRowsPerPage(Number(e.target.value));setPage(1);}}><option>10</option><option>25</option><option>50</option></select></label><button disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Prev</button>{Array.from({length:Math.min(5,pages)},(_,i)=>i+1).map(n=><button key={n} className={currentPage===n?"active":""} onClick={()=>setPage(n)}>{n}</button>)}{pages>5&&<span>...</span>}<button disabled={page>=pages} onClick={()=>setPage(p=>p+1)}>Next</button></div>
        <div className="cd-floating-tools"><button onClick={exportRows}>Export CSV</button><button onClick={()=>setSavedAt(`Synced ${new Date().toLocaleTimeString()}`)}>Sync Shipping</button><button onClick={onRefresh}>Refresh TikTok comments</button><button onClick={bulkPrint}>Open Printer Queue</button></div>
      </div>
    </div>
  );
}

function CommentArchive({comments}:{comments:Comment[]}){
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
        <span>Comment archive ({comments.length})</span>
        <input className="search-inp" style={{maxWidth:220}} value={q} onChange={e=>setQ(e.target.value)} placeholder="Search old comments..."/>
      </div>
      <table className="tbl">
        <thead><tr><th>Name</th><th>Username</th><th>Platform</th><th>Comment</th><th>Time</th></tr></thead>
        <tbody>
          {filtered.length===0&&<tr><td colSpan={5} style={{textAlign:"center",padding:24,color:"#888"}}>No archived comments yet</td></tr>}
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
        {settings.printerType==="bluetooth"?"Bluetooth printer: pair it in Windows or phone settings first. On laptop/desktop, make sure it appears as a normal printer and choose it in the print dialog or set it as default for direct print.":t.printer_usb_note}
        &nbsp;· Sticker: {settings.stickerSize}mm
      </div>
      <div className="grid4" style={{gridTemplateColumns:"repeat(3,1fr)"}}>
        <div className="mstat"><div className="ms-l">{t.buyers_stat}</div><div className="ms-v">{buyers.length}</div></div>
        <div className="mstat"><div className="ms-l">{t.orders_stat}</div><div className="ms-v" style={{color:"#534AB7"}}>{buyers.reduce((s,b)=>s+b.totalOrders,0)}</div></div>
        <div className="mstat"><div className="ms-l">{t.revenue_stat}</div><div className="ms-v" style={{color:"#1D9E75"}}>{cur}{buyers.reduce((s,b)=>s+b.totalSpent,0).toLocaleString()}</div></div>
      </div>
      <div className="table-card">
        <table className="tbl">
          <thead><tr><th>#</th><th>Name</th><th>Username</th><th>{t.orders_col}</th><th>Total</th><th>Platform</th><th></th></tr></thead>
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
        <button className="btn-out" onClick={()=>csvDL(`sales-${new Date().toISOString().slice(0,10)}.csv`,[t.order_num,"Buyer",t.item_col,t.qty_col,t.total_col,t.platform_label,t.time_col],orders.map(o=>[`#SF${o.orderNum}`,o.name,o.item,o.qty,`${cur}${o.total}`,o.platform,o.time]))}>⬇ {t.export_csv}</button>
      </div>
      <div className="grid4">
        <div className="mstat"><div className="ms-l">{t.revenue_stat}</div><div className="ms-v" style={{fontSize:22,color:"#1D9E75"}}>{cur}{tot.toLocaleString()}</div></div>
        <div className="mstat"><div className="ms-l">{t.orders_stat}</div><div className="ms-v">{orders.length}</div></div>
        <div className="mstat"><div className="ms-l">{t.buyers_stat}</div><div className="ms-v" style={{color:"#534AB7"}}>{buyers.length}</div></div>
        <div className="mstat"><div className="ms-l">{t.avg_order}</div><div className="ms-v" style={{fontSize:18}}>{cur}{orders.length?Math.round(tot/orders.length).toLocaleString():0}</div></div>
      </div>
      <div className="grid2">
        <div className="table-card"><div className="table-title">{t.top_products}</div>
          <table className="tbl"><thead><tr><th>Item</th><th>{t.units_sold}</th><th>{t.revenue_stat}</th></tr></thead>
            <tbody>{top.length===0&&<tr><td colSpan={3} style={{textAlign:"center",padding:24,color:"#888"}}>{t.no_sales}</td></tr>}{top.map(([item,d])=><tr key={item}><td><strong>{item}</strong></td><td>{d.qty}</td><td><strong style={{color:"#1D9E75"}}>{cur}{d.rev.toLocaleString()}</strong></td></tr>)}</tbody>
          </table>
        </div>
        <div className="table-card"><div className="table-title">{t.revenue_platform}</div>
          <table className="tbl"><thead><tr><th>Platform</th><th>Orders</th><th>{t.revenue_stat}</th><th>{t.share_col}</th></tr></thead>
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
function SettingsPage({user,settings,onSaveProfile,onSaveSettings,onSavePw,onExportBackup,onClearLiveComments,t}:{user:User;settings:Settings;onSaveProfile:(p:Profile)=>void;onSaveSettings:(s:Settings)=>void;onSavePw:(o:string,n:string)=>string;onExportBackup:()=>void;onClearLiveComments:()=>void;t:T}){
  const [prof,setProf]=useState<Profile>({...user.profile});
  const [sets,setSets]=useState<Settings>({...settings});
  const [op,setOp]=useState("");const [np,setNp]=useState("");const [cp,setCp]=useState("");
  const [toast,setToast]=useState("");const [pwErr,setPwErr]=useState("");
  const [expandedSettingsBox,setExpandedSettingsBox]=useState<""|"profile"|"password"|"display"|"printer"|"mobilePrinter">("");
  const directPrintParam=new URLSearchParams(window.location.search).get("directPrint")==="1";
  const [directPrintMode,setDirectPrintMode]=useState(()=>directPrintParam||LS.get<boolean>("sf_direct_print_mode",false));
  const settingsDirty=JSON.stringify(sets)!==JSON.stringify(settings);
  const settingsTitles={"":"Settings",profile:"Profile Information",password:"Change Password",display:"Display & Printing",printer:"Printer Settings",mobilePrinter:"Mobile Bluetooth Printer"};
  const previewScale=(v:number|undefined,fallback=100)=>Math.max(60,Math.min(180,v||fallback))/100;
  const storePreview=previewScale(sets.printStoreScale,sets.printLabelScale);
  const buyerNumberPreview=previewScale(sets.printBuyerNumberScale,120);
  const buyerNamePreview=previewScale(sets.printBuyerNameScale,sets.printLabelScale);
  const usernamePreview=previewScale(sets.printUsernameScale,sets.printLabelScale);
  const orderPreview=previewScale(sets.printOrderScale,sets.printLabelScale);
  const commentPreview=previewScale(sets.printCommentScale,sets.printLabelScale);
  const totalPreview=previewScale(sets.printTotalScale,sets.printLabelScale);
  const nativePrinterReady=hasNativeMobilePrinter();
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
              placeholder={limitReached?"Plan account limit reached":placeholder}
              disabled={locked||limitReached}
              className={locked?"locked-account-input":""}
            />
            {locked&&<div className="locked-account-note">Locked. Admin can change this account.</div>}
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
    setToast("Printer test sent");
  }
  function openMobileBluetoothGuide(){
    setToast("Open phone Bluetooth settings, pair printer, then come back to SellerFlowLive");
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
    setToast("Printer layout reset");
  }
  function savePw(e:React.FormEvent){
    e.preventDefault();setPwErr("");
    if(np.length<6){setPwErr(t.pw_short);return;}
    if(np!==cp){setPwErr(t.pw_mismatch);return;}
    const err=onSavePw(op,np);
    if(err){setPwErr(err);return;}
    setOp("");setNp("");setCp("");setToast(t.pw_changed);
  }
  return(
    <div className="subpage">
      {toast&&<Toast msg={toast} onDone={()=>setToast("")}/>}
      <div className="subpage-hd"><div><h2>{t.nav_settings}</h2><p>{t.settings_sub}</p></div></div>
      <div className="settings-quick-grid">
        <button className="admin-action-card" onDoubleClick={()=>setExpandedSettingsBox("profile")}>
          <div className="ms-l">Profile</div><div className="ms-v">1</div><span>Name, store, TikTok and Facebook accounts</span>
        </button>
        <button className="admin-action-card" onDoubleClick={()=>setExpandedSettingsBox("password")}>
          <div className="ms-l">Password</div><div className="ms-v">PW</div><span>Change seller login password</span>
        </button>
        <button className="admin-action-card" onDoubleClick={()=>setExpandedSettingsBox("display")}>
          <div className="ms-l">Display</div><div className="ms-v">{sets.currency}</div><span>Currency, paper, notifications</span>
        </button>
        <button className="admin-action-card" onDoubleClick={()=>setExpandedSettingsBox("printer")}>
          <div className="ms-l">Printer</div><div className="ms-v">{settingsDirty?"!":"OK"}</div><span>{settingsDirty?"Changes not saved":"Saved"} - output tools</span>
        </button>
        <button className="admin-action-card mobile-bluetooth-card" onDoubleClick={()=>setExpandedSettingsBox("mobilePrinter")}>
          <div className="ms-l">Mobile Printer</div><div className="ms-v">BT</div><span>Bluetooth printer setup for phone app</span>
        </button>
      </div>
      {expandedSettingsBox&&(
        <div className="admin-fullscreen-panel">
          <div className="admin-fullscreen-head">
            <button className="btn-out" onClick={()=>setExpandedSettingsBox("")}>Back</button>
            <div><h2>{settingsTitles[expandedSettingsBox]}</h2><p>Full settings page</p></div>
          </div>
          <div className={`grid2 settings-expanded settings-show-${expandedSettingsBox}`}>
        <form onSubmit={saveProf} className="scard settings-section settings-section-profile">
          <div className="scard-title">{t.profile_section}</div>
          <Fg label={t.full_name}><input value={prof.fullName} onChange={e=>setProf(p=>({...p,fullName:e.target.value}))} required/></Fg>
          <Fg label={t.store_name}><input value={prof.storeName} onChange={e=>setProf(p=>({...p,storeName:e.target.value}))} required/></Fg>
          <Fg label={t.email_label}><input value={user.email} disabled style={{background:"#F5F5F2",color:"#888"}}/></Fg>
          <Fg label={t.phone_label}><input value={prof.phone} onChange={e=>setProf(p=>({...p,phone:e.target.value}))} placeholder="+63 912 345 6789"/></Fg>
          {renderAccountSlots("tiktok","TikTok account","@yourusername",profTikTok,originalTikTok)}
          {renderAccountSlots("facebook","Facebook page","Your Facebook Page",profFacebook,originalFacebook)}
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
          <div className="scard-title" style={{marginTop:10}}>Backup & recovery</div>
          <div className="backup-actions">
            <button type="button" className="btn-out" onClick={onExportBackup}>Export Seller Backup</button>
            <button type="button" className="btn-out danger-lite" onClick={onClearLiveComments}>Clear Live Comments Only</button>
          </div>
          <div className="backup-note">Clear live comments keeps orders, customers, sales, and comment history archive.</div>
          <button type="submit" className="btn-purple" style={{marginTop:6}}>{t.save_settings}</button>
        </form>
        <form onSubmit={saveSets} className="scard settings-section settings-section-printer">
          <div className="scard-title" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
            <span>{t.printer_section}</span>
            <span style={{fontSize:11,fontWeight:600,color:settingsDirty?"#B45309":"#0F6E56",background:settingsDirty?"#FFF3CD":"#E1F5EE",borderRadius:999,padding:"3px 8px"}}>
              {settingsDirty?"Not saved":"Saved"}
            </span>
          </div>
          <div className="printer-tools-row">
            <div className={`printer-direct-status ${directPrintMode?"active":"inactive"}`}>
              <div>
                <strong>{directPrintMode?"Direct Print Active":"Direct Print Not Active"}</strong>
                <span>{directPrintMode?"You opened SellerFlowLive with the desktop shortcut. 1-click can print directly.":"Open SellerFlowLive using the desktop shortcut to enable kiosk direct print."}</span>
              </div>
              <Badge label={directPrintMode?"Ready":"Shortcut needed"} color={directPrintMode?"green":"amber"}/>
            </div>
            <a className="printer-shortcut-link" href="/sellerflow-printer-shortcut.bat?v=6" download>Printer Shortcut</a>
            <button type="button" className="printer-test-btn" onClick={testPrinter}>Printer Test</button>
            <div className="printer-troubleshoot">
              <strong>Quick setup</strong>
              <ol>
                <li>Click Printer Shortcut and run it once.</li>
                <li>Close normal Chrome/Edge tabs.</li>
                <li>Open SellerFlowLive from the new SellerFlowLive Direct Print icon on the desktop.</li>
                <li>Choose the printer once. After that, 1-click prints automatically.</li>
              </ol>
              <p>If it opens the wrong admin or seller account, open SellerFlowLive Switch Account once, then login again. If the print screen stays open, you are probably using a normal browser tab or an old shortcut.</p>
            </div>
          </div>
          <Fg label={t.printer_type}>
            <select value={sets.printerType} onChange={e=>setSets(s=>({...s,printerType:e.target.value as Settings["printerType"]}))}>
              <option value="usb">{t.printer_usb}</option>
              <option value="bluetooth">{t.printer_bt}</option>
            </select>
          </Fg>
          <Fg label={t.printer_size}>
            <select value={sets.stickerSize} onChange={e=>setSets(s=>({...s,stickerSize:e.target.value}))}>
              <option value="100x60">100x60mm (Standard)</option>
              <option value="80x50">80x50mm</option>
              <option value="60x40">60x40mm</option>
            </select>
          </Fg>
          <div className="printer-preview-box">
            <div className="printer-preview-title">Print output preview</div>
            <div className="printer-preview-slip">
              <div className="printer-preview-head">
                <div className="printer-preview-brand"><span className="printer-preview-logo">S</span><strong>Seller<span>FlowLive</span></strong></div>
                <div className="printer-preview-session" style={previewMove(sets.printSessionX,sets.printSessionY)}>Session: May 22, 2026</div>
              </div>
              <div className="printer-preview-grid">
                <div className="printer-preview-left">
                  {sets.printStoreName&&<strong style={{fontSize:`${13*storePreview}px`,...previewMove(sets.printStoreX,sets.printStoreY)}}>{user.profile.storeName||"Seller name"}</strong>}
                  {sets.printBuyerNumber&&<b style={{fontSize:`${13*buyerNumberPreview}px`,...previewMove(sets.printBuyerNumberX,sets.printBuyerNumberY)}}>Buyer #12</b>}
                  <b style={{fontSize:`${13*buyerNamePreview}px`,...previewMove(sets.printBuyerNameX,sets.printBuyerNameY)}}>Maria Santos</b>
                  {sets.printBuyerUsername&&<em style={{fontSize:`${10*usernamePreview}px`,...previewMove(sets.printUsernameX,sets.printUsernameY)}}>@maria_live</em>}
                </div>
                {sets.printOrderItems&&<div className="printer-preview-order-box" style={previewMove(sets.printOrderX,sets.printOrderY)}>
                  <strong>Order here</strong>
                  <div><span style={{fontSize:`${9*orderPreview}px`}}>12:21 PM</span><b style={{fontSize:`${10*commentPreview}px`}}>620</b></div>
                  <div><span style={{fontSize:`${9*orderPreview}px`}}>12:22 PM</span><b style={{fontSize:`${10*commentPreview}px`}}>150</b></div>
                  {sets.printTotal&&<div className="printer-preview-total" style={{fontSize:`${10*totalPreview}px`,...previewMove(sets.printTotalX,sets.printTotalY)}}><span>Total</span><b>{sets.currency}1,240</b></div>}
                </div>}
              </div>
            </div>
            <button type="button" className="printer-reset-btn" onClick={resetPrinterLayout}>Reset Printer Layout</button>
          </div>
          {([
            ["printStoreScale","Store name"],
            ["printBuyerNumberScale","Buyer number"],
            ["printBuyerNameScale","Buyer name"],
            ["printUsernameScale","TikTok / username"],
            ["printOrderScale","Order time"],
            ["printCommentScale","Customer comment"],
            ["printTotalScale","Total amount"],
          ] as [NumberSettingKey,string][]).map(([k,label])=>sizeStep(k,`${label} size`))}
          <div className="scard-title" style={{marginTop:10}}>Label position tools</div>
          <div className="position-step-grid">
            {([
              ["printStoreX","Seller name left / right"],
              ["printStoreY","Seller name up / down"],
              ["printBuyerLabelX","Buyer label left / right"],
              ["printBuyerLabelY","Buyer label up / down"],
              ["printBuyerNumberX","Buyer number left / right"],
              ["printBuyerNumberY","Buyer number up / down"],
              ["printBuyerNameX","Buyer name left / right"],
              ["printBuyerNameY","Buyer name up / down"],
              ["printUsernameX","Username left / right"],
              ["printUsernameY","Username up / down"],
              ["printSessionX","Date/session left / right"],
              ["printSessionY","Date/session up / down"],
              ["printOrderX","Order items left / right"],
              ["printOrderY","Order items up / down"],
            ] as [NumberSettingKey,string][]).map(([k,label])=>positionStep(k,label))}
          </div>
          <div className="scard-title" style={{marginTop:10}}>Printer output</div>
          {([
            ["printStoreName","Store name"],
            ["printBuyerNumber","Buyer number"],
            ["printBuyerUsername","TikTok / username"],
            ["printOrderItems","Order items"],
            ["printTotal","Total amount"],
            ["printAutoClose","Close print tab after printing"],
          ] as [keyof Settings,string][]).map(([k,label])=>(
            <div key={k} className="tog-row"><span>{label}</span><div onClick={()=>setSets(s=>({...s,[k]:!s[k]}))} className={`tog ${sets[k]?"on":""}`}/></div>
          ))}
          <div style={{padding:"8px 10px",background:"#F5F4FF",borderRadius:8,fontSize:12,color:"#534AB7",lineHeight:1.5,marginTop:4}}>
            {sets.printerType==="bluetooth"
              ?"Laptop/Desktop Bluetooth uses the same print system as USB: pair the printer in Windows Bluetooth settings, add it under Printers, then choose it in the print dialog or make it the default printer for direct print. Phone Bluetooth uses the mobile bridge."
              :t.printer_usb_note}
          </div>
          <button type="submit" className="btn-purple" style={{marginTop:10,width:"100%"}}>
            Save printer settings
          </button>
          <div className="scard-title" style={{marginTop:10}}>{t.platform_section}</div>
          <div style={{fontSize:12,color:"#888",marginBottom:8}}>{t.platform_hint}</div>
          <div className="tog-row"><div><div style={{fontWeight:500}}>TikTok Live</div><div style={{fontSize:11,color:"#888",whiteSpace:"pre-wrap"}}>{accountList(user.profile.tiktok).join(", ")||t.not_set}</div></div><Badge label={user.connectedAccounts.includes("TikTok")?t.connected_label:t.not_connected} color={user.connectedAccounts.includes("TikTok")?"green":"gray"}/></div>
          <div className="tog-row" style={{borderBottom:"none"}}><div><div style={{fontWeight:500}}>Facebook Live</div><div style={{fontSize:11,color:"#888",whiteSpace:"pre-wrap"}}>{accountList(user.profile.facebook).join(", ")||t.not_set}</div></div><Badge label={user.connectedAccounts.includes("Facebook")?t.connected_label:t.not_connected} color={user.connectedAccounts.includes("Facebook")?"green":"gray"}/></div>
        </form>
        <form onSubmit={saveSets} className="scard settings-section settings-section-mobile-printer">
          <div className="scard-title">Mobile Bluetooth Printer</div>
          <div className="mobile-bt-layout">
            <div className="mobile-bt-copy">
              <div className="printer-direct-status active">
                <div>
                  <strong>{nativePrinterReady?"Bluetooth Direct Print Ready":"Mobile App Printer Flow"}</strong>
                  <span>{nativePrinterReady?"Native printer bridge detected. 1-click can send slips to the phone app Bluetooth printer.":"Bluetooth printer tools will show on phone app only. Desktop website stays USB/Wired."}</span>
                </div>
                <Badge label={nativePrinterReady?"Bridge ready":"Mobile only"} color={nativePrinterReady?"green":"amber"}/>
              </div>
              <div className="mobile-bt-steps">
                <strong>How seller will use it on phone</strong>
                <ol>
                  <li>Turn on the Bluetooth printer and pairing mode.</li>
                  <li>Pair the printer in phone Bluetooth settings.</li>
                  <li>Return to SellerFlowLive mobile app.</li>
                  <li>Tap Test Print, then use 1-click during live selling.</li>
                </ol>
              </div>
              <div className="mobile-bt-actions">
                <button type="button" className="btn-out" onClick={openMobileBluetoothGuide}>Pair Printer Guide</button>
                <button type="button" className="printer-test-btn" onClick={testPrinter}>Test Mobile Print</button>
              </div>
              <div className="backup-note">Silent Bluetooth printing is now wired to the mobile app bridge. If this page is opened in normal browser, it will safely keep using browser print.</div>
            </div>
            <div className="mobile-bt-preview">
              <div className="mobile-bt-phone">
                <div className="mobile-bt-top"/>
                <div className="mobile-bt-card">
                  <b>Bluetooth Printer</b>
                  <span>Phone app mode</span>
                  <em>Ready after phone pairing</em>
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
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// SUPPORT
// ═══════════════════════════════════════════════════════════════════
function Support({user,t}:{user:User;t:T}){
  const [name,setName]=useState(user.profile.fullName);
  const [email,setEmail]=useState(user.email);
  const [subject,setSubject]=useState(t.support_subject_payment);
  const [msg,setMsg]=useState("");
  const [file,setFile]=useState<File|null>(null);
  const [sent,setSent]=useState(false);
  const [supportError,setSupportError]=useState("");
  const [selectedMsgId,setSelectedMsgId]=useState("");
  const [readIds,setReadIds]=useState<string[]>(()=>arrLS<string>(supportReadKey(user.email)));
  async function send(e:React.FormEvent){
    e.preventDefault();
    try{
      const proofImage=await readProofImage(file);
      const sm:SupportMsg={id:Date.now().toString(),name,email,subject,message:msg,hasProof:!!proofImage,proofImage,timestamp:new Date().toISOString(),status:"pending"};
      await saveSupportMessage(sm);
      setSupportError("");
      setSent(true);setMsg("");setFile(null);
    }catch(error){
      setSupportError(`Support message was not saved: ${error instanceof Error?error.message:"Unknown error"}`);
    }
  }
  const [prev,setPrev]=useState<SupportMsg[]>(()=>arrLS<SupportMsg>("sf_support").filter(m=>m.email.toLowerCase()===user.email.toLowerCase()));
  useEffect(()=>{
    const refreshSupport=()=>void listSupportMessages().then(ms=>setPrev(ms.filter(m=>m.email.toLowerCase()===user.email.toLowerCase())));
    refreshSupport();
    const timer=window.setInterval(refreshSupport,10000);
    return()=>window.clearInterval(timer);
  },[user.email,sent]);
  const sellerMessages=[...prev].sort((a,b)=>{
    const au=a.status!=="resolved"&&a.adminReply&&!readIds.includes(a.id)?1:0;
    const bu=b.status!=="resolved"&&b.adminReply&&!readIds.includes(b.id)?1:0;
    if(au!==bu)return bu-au;
    if((a.status==="resolved")!==(b.status==="resolved"))return a.status==="resolved"?1:-1;
    return new Date(b.timestamp).getTime()-new Date(a.timestamp).getTime();
  });
  const selectedMsg=sellerMessages.find(m=>m.id===selectedMsgId);
  const unreadReplies=sellerMessages.filter(m=>m.status!=="resolved"&&m.adminReply&&!readIds.includes(m.id)).length;
  function openSellerMessage(m:SupportMsg){
    setSelectedMsgId(m.id);
    if(m.status!=="resolved"&&m.adminReply&&!readIds.includes(m.id)){
      const next=[...readIds,m.id];
      setReadIds(next);
      LS.set(supportReadKey(user.email),next);
    }
  }
  return(
    <div className="subpage support-page">
      <div className="subpage-hd"><div><h2>{t.support_title}</h2><p>{t.support_sub}</p></div></div>
      <div className="grid2 support-mobile-grid">
        <div className="scard support-payment-card">
          <div className="scard-title">{t.payment_title}</div>
          <div className="payment-box" style={{marginBottom:12}}>
            <p style={{color:"#5F5E5A",fontSize:12,marginBottom:8}}>{t.payment_info}</p>
            {[t.payment_account,t.payment_number,t.payment_bank,t.payment_name].map((d,i)=>(
              <div key={i} className="payment-detail"><span>{"👤🔢🏦🏛"[i]}</span><span>{d}</span></div>
            ))}
            <div style={{marginTop:8,padding:"8px 12px",background:"#FFF8E1",borderRadius:8,fontSize:12,color:"#633806",lineHeight:1.5}}>{t.payment_note}</div>
          </div>
          {sent?<div className="auth-ok">{t.support_sent}</div>:(
            <form onSubmit={send} style={{display:"flex",flexDirection:"column",gap:10}}>
              <div className="auth-row2">
                <Fg label={t.support_name}><input value={name} onChange={e=>setName(e.target.value)} required/></Fg>
                <Fg label={t.support_email}><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></Fg>
              </div>
              <Fg label={t.support_subject}>
                <select value={subject} onChange={e=>setSubject(e.target.value)}>
                  <option>{t.support_subject_payment}</option>
                  <option>{t.support_subject_general}</option>
                  <option>{t.support_subject_bug}</option>
                </select>
              </Fg>
              <Fg label={t.support_msg}><textarea value={msg} onChange={e=>setMsg(e.target.value)} rows={4} required style={{resize:"vertical"}}/></Fg>
              <Fg label={t.support_attach}>
                <input type="file" accept="image/*" onChange={e=>setFile(e.target.files?.[0]||null)} style={{fontSize:12}}/>
                {file&&<div className="support-proof-preview">Proof selected: {file.name}</div>}
              </Fg>
              {supportError&&<div className="auth-err">{supportError}</div>}
              <button type="submit" className="btn-purple">{t.support_send}</button>
            </form>
          )}
        </div>
        <div className="scard support-messages-card">
          <div className="scard-title support-title"><span>My messages ({prev.length})</span>{unreadReplies>0&&<span className="support-new-badge">{unreadReplies>9?"9+":unreadReplies} new</span>}</div>
          {prev.length>0&&(
            <div className="seller-support-box">
              {!selectedMsg&&sellerMessages.map(m=>{
                const unread=!!m.adminReply&&!readIds.includes(m.id);
                return <button key={m.id} className={`seller-message-row ${unread?"has-new":""}`} onClick={()=>openSellerMessage(m)}>
                  <div className="support-avatar">{ini(m.subject)}</div>
                  <div className="support-convo-meta">
                    <div className="support-convo-top"><strong>{m.subject}</strong><span>{new Date(m.timestamp).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</span></div>
                    <div className="support-convo-sub"><span>{m.adminReply?`Admin: ${m.adminReply}`:m.message}</span>{unread&&<b>new reply</b>}</div>
                  </div>
                  <Badge label={m.status==="approved"?"Approved":m.status==="rejected"?"Rejected":m.status==="resolved"?"Resolved":"Pending"} color={m.status==="approved"?"green":m.status==="rejected"?"red":m.status==="resolved"?"gray":"amber"}/>
                  {unread&&<span className="support-unread-dot"/>}
                </button>;
              })}
              {selectedMsg&&(
                <div className="support-thread chat-open">
                  <button className="tbl-btn ed support-back-btn" onClick={()=>setSelectedMsgId("")}>Back to messages</button>
                  <div className="support-chat-row seller">
                    <div className="support-avatar">{ini(user.profile.fullName||user.email)}</div>
                    <div className="support-bubble seller">
                      <strong>{selectedMsg.subject}</strong>
                      <p>{selectedMsg.message}</p>
                      {selectedMsg.proofImage&&<a href={selectedMsg.proofImage} target="_blank" rel="noreferrer"><img className="support-proof-img" src={selectedMsg.proofImage} alt="Payment proof" /></a>}
                      <span>{new Date(selectedMsg.timestamp).toLocaleString()} {selectedMsg.hasProof?" - Proof attached":""}</span>
                    </div>
                  </div>
                  {selectedMsg.adminReply&&(
                    <div className="support-chat-row admin">
                      <div className="support-bubble admin">
                        <strong>Admin reply</strong>
                        <p>{selectedMsg.adminReply}</p>
                        {selectedMsg.repliedAt&&<span>{new Date(selectedMsg.repliedAt).toLocaleString()}</span>}
                      </div>
                    </div>
                  )}
                  <div className="support-actions"><Badge label={selectedMsg.status==="approved"?"Approved":selectedMsg.status==="rejected"?"Rejected":selectedMsg.status==="resolved"?"Resolved":"Pending"} color={selectedMsg.status==="approved"?"green":selectedMsg.status==="rejected"?"red":selectedMsg.status==="resolved"?"gray":"amber"}/></div>
                </div>
              )}
            </div>
          )}
          {prev.length===0?<div style={{color:"#888",fontSize:12,padding:"20px 0"}}>No messages sent yet.</div>:(
            <div style={{display:"none",flexDirection:"column",gap:8}}>
              {[...prev].reverse().map(m=>(
                <div key={m.id} style={{background:"var(--color-background-secondary,#F9F9F7)",borderRadius:8,padding:10,border:"0.5px solid #E4E2DC"}}>
                  <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                    <strong style={{fontSize:12}}>{m.subject}</strong>
                    <Badge label={m.status==="approved"?"Approved":m.status==="rejected"?"Rejected":m.status==="resolved"?"Resolved":"Pending"} color={m.status==="approved"?"green":m.status==="rejected"?"red":m.status==="resolved"?"gray":"amber"}/>
                  </div>
                  <div style={{fontSize:11,color:"#888",marginBottom:4}}>{new Date(m.timestamp).toLocaleDateString()} {m.hasProof?"📎 Proof attached":""}</div>
                  <div style={{fontSize:12,color:"#5F5E5A"}}>{m.message.slice(0,120)}{m.message.length>120?"...":""}</div>
                  {m.adminReply&&(
                    <div className="support-admin-reply">
                      <strong>Admin reply</strong>
                      <div>{m.adminReply}</div>
                      {m.repliedAt&&<span>{new Date(m.repliedAt).toLocaleString()}</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// CONNECT MODAL
// ═══════════════════════════════════════════════════════════════════
function AdminPage({currentUser,onApprove,orders,t}:{currentUser:User;onApprove:(email:string,plan:Plan,months?:number)=>void;orders:LiveOrder[];t:T}){
  const normalizeAdminUsers=(list:User[])=>list.map(u=>isAdminEmail(u.email)?asAdminPlan(u):u);
  const [users,setUsers]=useState<User[]>(()=>normalizeAdminUsers(cleanUsers(arrLS<unknown>("sf_users"))));
  const [msgs,setMsgs]=useState<SupportMsg[]>(()=>arrLS<SupportMsg>("sf_support"));
  const [auditLogs,setAuditLogs]=useState<AccountAuditLog[]>(()=>arrLS<AccountAuditLog>("sf_audit_logs"));
  const [admins,setAdmins]=useState<string[]>(()=>adminEmails());
  const [newSeller,setNewSeller]=useState({email:"",password:"123456",fullName:"",storeName:""});
  const [editOriginalEmail,setEditOriginalEmail]=useState("");
  const [editSeller,setEditSeller]=useState({email:"",newPassword:"",fullName:"",storeName:"",phone:"",tiktok:"",facebook:""});
  const [adminSearch,setAdminSearch]=useState("");
  const [replyDrafts,setReplyDrafts]=useState<Record<string,string>>({});
  const [selectedSupportEmail,setSelectedSupportEmail]=useState("");
  const [expandedAdminBox,setExpandedAdminBox]=useState<""|"overview"|"create"|"users"|"payments">("");
  const [adminUserPlanMonths,setAdminUserPlanMonths]=useState<Record<string,number>>({});
  const [copied,setCopied]=useState("");
  const usersTableRef=useRef<HTMLDivElement>(null);
  const paymentsTableRef=useRef<HTMLDivElement>(null);
  const auditTableRef=useRef<HTMLDivElement>(null);
  const adminPageRef=useRef<HTMLDivElement>(null);

  async function refresh(){
    const freshUsers=normalizeAdminUsers(await listUsers());
    setUsers(freshUsers);
    await sendAutomaticPlanNotices(freshUsers);
    setMsgs(await listSupportMessages());
    setAuditLogs(await listAuditLogs());
    setAdmins(adminEmails());
  }

  async function sendAutomaticPlanNotices(sourceUsers:User[]){
    const sentKeys=arrLS<string>("sf_plan_notice_sent");
    const nextSent=new Set(sentKeys);
    const todayKey=new Date().toISOString().slice(0,10);
    const notices:SupportMsg[]=[];
    for(const seller of sourceUsers){
      if(isAdminEmail(seller.email))continue;
      const days=dLeft(seller.planExpiry);
      const warnDays=seller.plan==="trial"?3:5;
      const noticeType=seller.planStatus==="expired"||days===0?"expired":days===warnDays?"warning":"";
      if(!noticeType)continue;
      const key=`${seller.email.toLowerCase()}|${seller.plan}|${seller.planExpiry}|${noticeType}`;
      if(nextSent.has(key))continue;
      nextSent.add(key);
      const planLabel=pName(seller.plan,t);
      const expiryDate=new Date(seller.planExpiry).toLocaleDateString();
      const adminReply=noticeType==="warning"
        ? `Automatic message from SellerFlowLive Admin: Your ${planLabel} plan will expire in ${days} day${days===1?"":"s"} on ${expiryDate}. Please send payment proof or upgrade before it expires.`
        : `Automatic message from SellerFlowLive Admin: Your ${planLabel} plan expired today. Please upgrade or send payment proof to continue using SellerFlowLive.`;
      notices.push({
        id:`plan-${noticeType}-${seller.email}-${todayKey}`,
        name:seller.profile.fullName||seller.profile.storeName||seller.email,
        email:seller.email,
        subject:noticeType==="warning"?"Plan expiration reminder":"Plan expired notice",
        message:"Automatic plan notice",
        hasProof:false,
        timestamp:new Date().toISOString(),
        status:"approved",
        adminReply,
        repliedAt:new Date().toISOString(),
      });
    }
    if(!notices.length)return;
    LS.set("sf_plan_notice_sent",Array.from(nextSent));
    await Promise.all(notices.map(n=>saveSupportMessage(n).catch(error=>console.error("Auto plan notice failed:",error))));
    setCopied(`${notices.length} automatic plan message${notices.length===1?"":"s"} sent`);
  }

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(()=>{
    void refresh();
    const timer=window.setInterval(()=>{void refresh();},10000);
    return()=>window.clearInterval(timer);
  },[]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  async function updateMsg(id:string,status:SupportMsg["status"]){
    const next=msgs.map(m=>m.id===id?{...m,status}:m);
    setMsgs(next);
    await updateSupportStatus(id,status);
    const msg=msgs.find(m=>m.id===id);
    if(msg)await logAction(status==="approved"?"approved payment/support":status==="resolved"?"resolved support":"rejected payment/support",msg.email,msg.subject);
  }

  async function replyToSeller(message:SupportMsg){
    const reply=(replyDrafts[message.id] ?? message.adminReply ?? "").trim();
    if(!reply){setCopied("Write a reply first");return;}
    const repliedAt=new Date().toISOString();
    const next=msgs.map(m=>m.id===message.id?{...m,adminReply:reply,repliedAt}:m);
    setMsgs(next);
    try{
      await updateSupportReply(message.id,reply);
      await logAction("replied to support",message.email,message.subject);
      setCopied("Reply sent to seller");
    }catch(error){
      setCopied(`Reply failed: ${error instanceof Error?error.message:"Unknown error"}`);
    }
  }

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
    const expiry=status==="expired"?addDays(-1):status==="pending"?new Date().toISOString():plan==="trial"?addDays(7):addMonths(months);
    const trialStartedAt=status==="active"&&plan==="trial"?new Date().toISOString():"";
    const next=users.map(u=>u.email.toLowerCase()===email.toLowerCase()?{...u,plan,planStatus:status,planExpiry:expiry,trialStartedAt}:u);
    LS.set("sf_users",next);
    setUsers(next);
    const updated=next.find(u=>u.email.toLowerCase()===email.toLowerCase());
    if(updated){
      await upsertUser(updated);
      await logAction(status==="expired"?"expired seller":"changed plan",email,`Plan ${plan}, status ${status}, duration ${plan==="trial"?7:`${months} month${months===1?"":"s"}`}`);
    }
  }

  async function createSeller(){
    const email=newSeller.email.trim().toLowerCase();
    if(!email||!newSeller.password||!newSeller.fullName.trim()||!newSeller.storeName.trim()){
      setCopied("Fill seller email, password, name, and store");
      return;
    }
    if(newSeller.password.length<6){
      setCopied("Password must be at least 6 characters");
      return;
    }
    if(users.some(u=>u.email.toLowerCase()===email)){
      setCopied("Seller email already exists");
      return;
    }
    const seller:User={
      email,
      password:newSeller.password,
      profile:{fullName:newSeller.fullName.trim(),storeName:newSeller.storeName.trim(),phone:"",tiktok:"",facebook:""},
      plan:"trial",
      planStatus:"active",
      planExpiry:addDays(7),
      connectedAccounts:[],
    };
    const next=[...users,seller];
    LS.set("sf_users",next);
    setUsers(next);
    try{
      await upsertUser(seller);
      await logAction("created seller",email,`Store: ${seller.profile.storeName}`);
      setNewSeller({email:"",password:"123456",fullName:"",storeName:""});
      setCopied("Seller account created");
    }catch(error){
      setCopied(`Supabase save failed: ${error instanceof Error?error.message:"Unknown error"}`);
    }
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
    const email=editSeller.email.trim().toLowerCase();
    const current=users.find(u=>u.email.toLowerCase()===oldEmail);
    if(!current){
      setCopied("Seller not found");
      return;
    }
    if(!email||!editSeller.fullName.trim()||!editSeller.storeName.trim()){
      setCopied("Fill seller email, name, and store");
      return;
    }
    const newPassword=editSeller.newPassword.trim();
    if(newPassword&&newPassword.length<6){
      setCopied("New password must be at least 6 characters");
      return;
    }
    if(email!==oldEmail&&users.some(u=>u.email.toLowerCase()===email)){
      setCopied("Seller email already exists");
      return;
    }
    const editLimit=maxAcc(current.plan);
    const editTikTok=accountList(editSeller.tiktok).slice(0,editLimit);
    const editFacebook=accountList(editSeller.facebook).slice(0,Math.max(0,editLimit-editTikTok.length));
    const updated:User={
      ...current,
      email,
      password:newPassword||current.password,
      profile:{
        fullName:editSeller.fullName.trim(),
        storeName:editSeller.storeName.trim(),
        phone:editSeller.phone.trim(),
        tiktok:accountText(editTikTok),
        facebook:accountText(editFacebook),
      },
    };
    const next=users.map(u=>u.email.toLowerCase()===oldEmail?updated:u);
    LS.set("sf_users",next);
    setUsers(next);
    try{
      await upsertUser(updated);
      if(email!==oldEmail)await deleteUser(oldEmail);
      await logAction("edited seller",email,`${oldEmail!==email?`Email changed from ${oldEmail}. `:""}${newPassword?"Password changed. ":""}Profile updated.`);
      setEditOriginalEmail("");
      setCopied("Seller updated");
    }catch(error){
      setCopied(`Supabase save failed: ${error instanceof Error?error.message:"Unknown error"}`);
    }
  }

  async function resetPassword(email:string){
    if(!window.confirm(`Reset password for ${email} to 123456?`))return;
    const next=users.map(u=>u.email.toLowerCase()===email.toLowerCase()?{...u,password:"123456"}:u);
    LS.set("sf_users",next);
    setUsers(next);
    const updated=next.find(u=>u.email.toLowerCase()===email.toLowerCase());
    try{
      if(updated)await upsertUser(updated);
      await logAction("reset password",email,"Temporary password set to 123456");
      setCopied("Password reset to 123456");
    }catch(error){
      setCopied(`Supabase save failed: ${error instanceof Error?error.message:"Unknown error"}`);
    }
  }

  async function removeSeller(email:string){
    const cleanEmail=email.toLowerCase();
    if(cleanEmail===OWNER_EMAIL){setCopied("Owner admin cannot be deleted");return;}
    if(cleanEmail===currentUser.email.toLowerCase()){setCopied("You cannot delete yourself");return;}
    if(isAdminEmail(email)){setCopied("Remove admin first before deleting");return;}
    if(!window.confirm(`Delete seller ${email}? This cannot be undone.`))return;
    const next=users.filter(u=>u.email.toLowerCase()!==cleanEmail);
    LS.set("sf_users",next);
    setUsers(next);
    try{
      await deleteUser(email);
      await logAction("deleted seller",email,"Seller account deleted");
      setCopied("Seller deleted");
    }catch(error){
      setCopied(`Supabase delete failed: ${error instanceof Error?error.message:"Unknown error"}`);
    }
  }

  async function makeAdmin(email:string){
    rememberAdminEmail(email);
    const next=users.map(u=>u.email.toLowerCase()===email.toLowerCase()?asAdminPlan(u):u);
    LS.set("sf_users",next);
    setUsers(next);
    setAdmins(adminEmails());
    const updated=next.find(u=>u.email.toLowerCase()===email.toLowerCase());
    if(updated)await upsertUser(updated);
    await logAction("made admin",email,"Seller promoted to admin");
  }

  async function removeAdmin(email:string){
    if(email.toLowerCase()===OWNER_EMAIL){setCopied("Owner admin cannot be removed");return;}
    if(email.toLowerCase()===currentUser.email.toLowerCase()){setCopied("You cannot remove yourself");return;}
    forgetAdminEmail(email);
    setAdmins(adminEmails());
    await logAction("removed admin",email,"Admin access removed");
  }

  function copy(value:string,label:string){
    navigator.clipboard?.writeText(value);
    setCopied(`${label} copied`);
    setTimeout(()=>setCopied(""),1800);
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
    u.email,u.profile.fullName,u.profile.storeName,u.profile.phone,u.profile.tiktok,u.profile.facebook,u.plan,isAdminEmail(u.email)?"admin":"seller"
  ].some(v=>String(v||"").toLowerCase().includes(q)));
  const filteredMsgs=msgs.filter(m=>!q||[
    m.name,m.email,m.subject,m.message,m.status
  ].some(v=>String(v||"").toLowerCase().includes(q)));
  const supportConversations=Object.values(filteredMsgs.reduce<Record<string,{email:string;name:string;messages:SupportMsg[];latest:SupportMsg;unread:number}>>((acc,m)=>{
    const key=m.email.toLowerCase();
    const isUnread=m.status==="pending"&&!m.adminReply;
    if(!acc[key]){
      acc[key]={email:m.email,name:m.name,messages:[m],latest:m,unread:isUnread?1:0};
      return acc;
    }
    acc[key].messages.push(m);
    acc[key].unread+=isUnread?1:0;
    if(new Date(m.timestamp).getTime()>new Date(acc[key].latest.timestamp).getTime())acc[key].latest=m;
    return acc;
  },{})).map(c=>({
    ...c,
    messages:[...c.messages].sort((a,b)=>new Date(a.timestamp).getTime()-new Date(b.timestamp).getTime()),
    active:c.messages.some(m=>m.status!=="resolved"),
  })).sort((a,b)=>{
    if(a.unread!==b.unread)return b.unread-a.unread;
    if(a.active!==b.active)return a.active?-1:1;
    return new Date(b.latest.timestamp).getTime()-new Date(a.latest.timestamp).getTime();
  });
  const unreadSupportCount=supportConversations.reduce((sum,c)=>sum+c.unread,0);
  const filteredAuditLogs=auditLogs.filter(log=>!q||[
    log.actorEmail,log.action,log.targetEmail,log.details,log.timestamp
  ].some(v=>String(v||"").toLowerCase().includes(q)));
  const sellerUsers=users.filter(u=>!isAdminEmail(u.email));
  const activeSellers=sellerUsers.filter(u=>u.planStatus==="active"&&dLeft(u.planExpiry)>0);
  const expiredSellers=sellerUsers.filter(u=>u.planStatus==="expired"||dLeft(u.planExpiry)===0);
  const planMonitorUsers=sellerUsers
    .filter(u=>u.planStatus==="expired"||dLeft(u.planExpiry)<=(u.plan==="trial"?3:5))
    .sort((a,b)=>dLeft(a.planExpiry)-dLeft(b.planExpiry));
  const pendingPayments=msgs.filter(m=>m.status==="pending");
  const todayIso=new Date().toISOString().slice(0,10);
  const todayOrders=orders.filter(o=>o.date===todayIso);
  const allStoredOrders=orders;
  const dayStamp=new Date().toISOString().slice(0,10);
  const expandedTitles={"":"Admin",overview:"Overview",create:"Create Seller",users:"Users",payments:"Payment / Support"};

  function exportUsers(){
    csvDL(`sellerflow-users-${dayStamp}.csv`,["Email","Role","Plan","Plan Status","Days Left","Connected Accounts","Full Name","Store Name","Phone","TikTok","Facebook"],filteredUsers.map(u=>[
      u.email,isAdminEmail(u.email)?"Admin":"Seller",pName(u.plan,t),u.planStatus,dLeft(u.planExpiry),registeredAccountCount(u),u.profile.fullName,u.profile.storeName,u.profile.phone,u.profile.tiktok,u.profile.facebook
    ]));
  }
  function exportPayments(){
    csvDL(`sellerflow-payments-support-${dayStamp}.csv`,["Name","Email","Subject","Message","Admin Reply","Proof","Status","Timestamp","Replied At"],filteredMsgs.map(m=>[
      m.name,m.email,m.subject,m.message,m.adminReply||"",m.hasProof?"yes":"no",m.status,m.timestamp,m.repliedAt||""
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
      supportMessages:msgs,
      auditLogs,
      orders:allStoredOrders,
      summary:{
        sellers:sellerUsers.length,
        active:activeSellers.length,
        expired:expiredSellers.length,
        pendingPayments:pendingPayments.length,
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
          <p>Owner: {OWNER_EMAIL} · Admins: {admins.length}</p>
        </div>
        <div className="admin-refresh-group">
          <span>Auto refresh: 10s</span>
          <button className="btn-out" onClick={refresh}>Refresh</button>
        </div>
      </div>

      <div className="admin-searchbar">
        <span className="admin-search-ic">⌕</span>
        <input value={adminSearch} onChange={e=>setAdminSearch(e.target.value)} placeholder="Search users, payments, audit log"/>
        {adminSearch&&<button className="admin-search-clear" onClick={()=>setAdminSearch("")}>Clear</button>}
      </div>

      <div className="admin-exportbar admin-compact">
        <button className="btn-out" onClick={exportUsers}>Export Users CSV</button>
        <button className="btn-out" onClick={exportPayments}>Export Payments CSV</button>
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
        <button className="admin-action-card" onDoubleClick={()=>setExpandedAdminBox("users")}>
          <div className="ms-l">Users</div><div className="ms-v">{filteredUsers.length}</div><span>Plans, accounts, admin tools</span>
        </button>
        <button className="admin-action-card" onDoubleClick={()=>setExpandedAdminBox("payments")}>
          <div className="ms-l">Payments</div><div className="ms-v" style={{color:"#BA7517"}}>{pendingPayments.length}</div><span>{unreadSupportCount} new support messages</span>
        </button>
      </div>

      <div className="table-card admin-compact-card" style={{marginBottom:12}} onDoubleClick={()=>setExpandedAdminBox("overview")}>
        <div className="table-title">Plan Monitoring ({planMonitorUsers.length})</div>
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

      <div className="grid2 admin-box-grid">
        <div className="table-card admin-compact-card" onDoubleClick={()=>setExpandedAdminBox("users")}>
          <div className="table-title">Users ({users.length})</div>
          <div className="admin-table-wrap">
            <div className="admin-table-scroll" ref={usersTableRef}>
              <table className="tbl">
                <thead><tr><th>Email</th><th>Role</th><th>Plan</th><th>Days</th><th>Months</th><th>Accounts</th><th></th></tr></thead>
                <tbody>
                  {filteredUsers.length===0&&<tr><td colSpan={7} style={{textAlign:"center",padding:24,color:"#888"}}>{users.length===0?"No users yet.":"No users found."}</td></tr>}
                  {filteredUsers.map(u=>(
                    <tr key={u.email}>
                      <td><strong>{u.email}</strong><div className="muted" style={{fontSize:11}}>{u.profile.storeName||u.profile.fullName}</div></td>
                      <td><Badge label={isAdminEmail(u.email)?"Admin":"Seller"} color={isAdminEmail(u.email)?"amber":"gray"}/></td>
                      <td><Badge label={pName(u.plan,t)} color={pColor(u.plan)}/></td>
                      <td>{dLeft(u.planExpiry)}</td>
                      <td>{renderUserMonthsSelect(u)}</td>
                      <td>{registeredAccountCount(u)} / {maxAcc(u.plan)}</td>
                      <td>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          <button className="tbl-btn ed" onClick={()=>openEditSeller(u)}>Edit</button>
                          <button className="tbl-btn ed" onClick={()=>resetPassword(u.email)}>Reset PW</button>
                          <button className="tbl-btn ed" onClick={()=>setPlan(u.email,"trial")}>Trial</button>
                          <button className="tbl-btn ed" onClick={()=>setPlan(u.email,"basic","active",monthsForUser(u))}>Basic</button>
                          <button className="tbl-btn ed" onClick={()=>approve(u.email,"pro",monthsForUser(u))}>Pro</button>
                          <button className="tbl-btn ed" onClick={()=>approve(u.email,"master",monthsForUser(u))}>Master</button>
                          <button className="tbl-btn dl" onClick={()=>setPlan(u.email,u.plan,"expired")}>Expire</button>
                          {!isAdminEmail(u.email)
                            ? <><button className="tbl-btn ed" onClick={()=>makeAdmin(u.email)}>Make Admin</button><button className="tbl-btn dl" onClick={()=>removeSeller(u.email)}>Delete</button></>
                            : <button className="tbl-btn dl" onClick={()=>removeAdmin(u.email)}>Remove Admin</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="admin-scroll-tools"><button onClick={()=>scrollBox(usersTableRef.current,"up")}>^</button><button onClick={()=>scrollBox(usersTableRef.current,"down")}>v</button></div>
          </div>
        </div>

        <div className="table-card admin-compact-card" onDoubleClick={()=>setExpandedAdminBox("payments")}>
          <div className="table-title support-title">
            <span>Payment / Support Messages ({msgs.length})</span>
            {unreadSupportCount>0&&<span className="support-new-badge">{unreadSupportCount>9?"9+":unreadSupportCount} new</span>}
          </div>
          <div className="admin-table-wrap">
            <div className="admin-table-scroll support-chat-scroll" ref={paymentsTableRef}>
              {filteredMsgs.length===0&&<div style={{textAlign:"center",padding:24,color:"#888"}}>{msgs.length===0?"No messages yet.":"No messages found."}</div>}
              {supportConversations.filter(c=>!selectedSupportEmail||c.email.toLowerCase()===selectedSupportEmail.toLowerCase()).map(c=>(
                <div key={c.email} className={`support-thread ${c.unread>0?"has-new":""} ${selectedSupportEmail?"chat-open":"list-only"}`}>
                  {selectedSupportEmail&&<button className="tbl-btn ed support-back-btn" onClick={()=>setSelectedSupportEmail("")}>Back to messages</button>}
                  <button className="support-thread-head messenger-thread-head" onClick={()=>!selectedSupportEmail&&setSelectedSupportEmail(c.email)}>
                    <div className="support-avatar big">{ini(c.name||c.email)}</div>
                    <div className="support-convo-meta">
                      <div className="support-convo-top">
                        <strong>{c.name||c.email}</strong>
                        <span>{new Date(c.latest.timestamp).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</span>
                      </div>
                      <div className="support-convo-sub">
                        <span>{c.latest.adminReply?`You: ${c.latest.adminReply}`:c.latest.message}</span>
                        {c.unread>0&&<b>{c.unread>9?"9+":c.unread} new message{c.unread>1?"s":""}</b>}
                      </div>
                      <div className="muted" style={{fontSize:10}}>{c.email}</div>
                    </div>
                    {c.unread>0&&<span className="support-unread-dot"/>}
                  </button>
                  {selectedSupportEmail&&<div className="support-conversation-body">
                    {c.messages.map(m=>(
                      <div key={m.id} className="support-message-block">
                        <div className="support-chat-row seller">
                          <div className="support-avatar">{ini(m.name||m.email)}</div>
                          <div className="support-bubble seller">
                            <strong>{m.subject}</strong>
                            <p>{m.message}</p>
                            {m.proofImage&&<a href={m.proofImage} target="_blank" rel="noreferrer"><img className="support-proof-img" src={m.proofImage} alt="Payment proof" /></a>}
                            <span>{new Date(m.timestamp).toLocaleString()} {m.hasProof?" - Proof attached":""}</span>
                          </div>
                        </div>
                        {m.adminReply&&(
                          <div className="support-chat-row admin">
                            <div className="support-bubble admin">
                              <strong>Admin reply</strong>
                              <p>{m.adminReply}</p>
                              {m.repliedAt&&<span>{new Date(m.repliedAt).toLocaleString()}</span>}
                            </div>
                          </div>
                        )}
                        <div className="support-actions">
                          <Badge label={m.status==="resolved"?"resolved":m.status} color={m.status==="approved"?"green":m.status==="rejected"?"red":m.status==="resolved"?"gray":"amber"}/>
                          <button className="tbl-btn ed" onClick={()=>{updateMsg(m.id,"approved");approve(m.email,"pro");}}>Approve</button>
                          <button className="tbl-btn dl" onClick={()=>updateMsg(m.id,"rejected")}>Reject</button>
                          <button className="tbl-btn ed" onClick={()=>updateMsg(m.id,"resolved")}>Resolve</button>
                          <button className="tbl-btn ed" onClick={()=>copy(m.email,"Email")}>Copy email</button>
                        </div>
                        <div className="messenger-reply">
                          <textarea rows={2} value={replyDrafts[m.id] ?? m.adminReply ?? ""} onChange={e=>setReplyDrafts(s=>({...s,[m.id]:e.target.value}))} placeholder="Type a reply like Messenger..."/>
                          <button className="tbl-btn ed" onClick={()=>replyToSeller(m)}>{m.adminReply?"Update reply":"Send reply"}</button>
                        </div>
                      </div>
                    ))}
                  </div>}
                </div>
              ))}
            </div>
            <div className="admin-scroll-tools"><button onClick={()=>scrollBox(paymentsTableRef.current,"up")}>^</button><button onClick={()=>scrollBox(paymentsTableRef.current,"down")}>v</button></div>
          </div>
        </div>
      </div>
      <div className="table-card">
        <div className="table-title">Audit Log ({auditLogs.length})</div>
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
              <table className="tbl"><thead><tr><th>Email</th><th>Role</th><th>Plan</th><th>Days</th><th>Months</th><th>Accounts</th><th>Actions</th></tr></thead><tbody>
                {filteredUsers.map(u=><tr key={"expanded-"+u.email}>
                  <td><strong>{u.email}</strong><div className="muted" style={{fontSize:11}}>{u.profile.storeName||u.profile.fullName}</div></td>
                  <td><Badge label={isAdminEmail(u.email)?"Admin":"Seller"} color={isAdminEmail(u.email)?"amber":"gray"}/></td>
                  <td><Badge label={pName(u.plan,t)} color={pColor(u.plan)}/></td>
                  <td>{dLeft(u.planExpiry)}</td>
                  <td>{renderUserMonthsSelect(u)}</td>
                  <td>{registeredAccountCount(u)} / {maxAcc(u.plan)}</td>
                  <td>
                    <div className="admin-row-actions">
                      <button className="tbl-btn ed" onClick={()=>openEditSeller(u)}>Edit</button>
                      <button className="tbl-btn ed" onClick={()=>resetPassword(u.email)}>Reset PW</button>
                      <button className="tbl-btn ed" onClick={()=>setPlan(u.email,"trial")}>Trial</button>
                      <button className="tbl-btn ed" onClick={()=>setPlan(u.email,"basic","active",monthsForUser(u))}>Basic</button>
                      <button className="tbl-btn ed" onClick={()=>approve(u.email,"pro",monthsForUser(u))}>Pro</button>
                      <button className="tbl-btn ed" onClick={()=>approve(u.email,"master",monthsForUser(u))}>Master</button>
                      <button className="tbl-btn dl" onClick={()=>setPlan(u.email,u.plan,"expired")}>Expire</button>
                      {!isAdminEmail(u.email)
                        ? <><button className="tbl-btn ed" onClick={()=>makeAdmin(u.email)}>Make Admin</button><button className="tbl-btn dl" onClick={()=>removeSeller(u.email)}>Delete</button></>
                        : <button className="tbl-btn dl" onClick={()=>removeAdmin(u.email)}>Remove Admin</button>}
                    </div>
                  </td>
                </tr>)}
              </tbody></table>
            </div>}
            {expandedAdminBox==="payments"&&<div className="admin-fullscreen-messages">
              {supportConversations.map(c=><button key={"expanded-support-"+c.email} className={"support-thread messenger-thread-head "+(c.unread>0?"has-new":"")} onClick={()=>setSelectedSupportEmail(c.email)}>
                <div className="support-avatar big">{ini(c.name||c.email)}</div>
                <div className="support-convo-meta"><div className="support-convo-top"><strong>{c.name||c.email}</strong><span>{new Date(c.latest.timestamp).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}</span></div><div className="support-convo-sub"><span>{c.latest.adminReply?"You: "+c.latest.adminReply:c.latest.message}</span>{c.unread>0&&<b>{c.unread>9?"9+":c.unread} new</b>}</div><div className="muted" style={{fontSize:10}}>{c.email}</div></div>
                {c.unread>0&&<span className="support-unread-dot"/>}
              </button>)}
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
                Select the registered {tab==="TikTok"?"TikTok account":"Facebook page"} for this live.
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
          ):tab==="TikTok"?(<><div className="notice-box" style={{background:"#FFF8E1",border:"1px solid #F5DDA0",color:"#633806"}}>??{t.tt_warning}</div><Fg label="TikTok username (without @)"><input value={tiktokValue} onChange={e=>setTtu(e.target.value)} placeholder="e.g. duonglily_0708" disabled={!canAdd}/></Fg></>):(<><div className="notice-box" style={{background:"#E1F5EE",border:"1px solid #9FE1CB",color:"#0F6E56"}}>{t.fb_hint}</div><Fg label={t.fb_video_id}><input value={facebookValue} onChange={e=>setFbId(e.target.value)} disabled={!canAdd}/></Fg><Fg label={t.fb_token}><input value={fbTok} onChange={e=>setFbTok(e.target.value)} type="password" disabled={!canConnect}/></Fg></>)}
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
  const [user,setUser]=useState<User|null>(()=>{if(forceLogin)return null;const e=LS.get<string>("sf_session","");if(!e)return null;const u=cleanUsers(arrLS<unknown>("sf_users")).find(u=>u.email===e)||null;return u?asAdminPlan(u):null;});
  const [accountGate,setAccountGate]=useState(()=>{
    if(forceLogin||typeof window==="undefined")return false;
    const saved=LS.get<string>("sf_session","");
    if(!saved)return false;
    const params=new URLSearchParams(window.location.search);
    const directMode=params.get("directPrint")==="1"||LS.get<boolean>("sf_direct_print_mode",false);
    const confirmed=window.sessionStorage.getItem("sf_account_gate_ok")===saved;
    return directMode&&!confirmed;
  });
  const [settings,setSettingsState]=useState<Settings>(()=>({...DEF_SETTINGS,...LS.get<Partial<Settings>>("sf_settings",{})}));
  const [page,setPage]=useState<Page>("dashboard");
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
  const [supportUnreadCount,setSupportUnreadCount]=useState(0);
  const [toast,setToast]=useState("");
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

  // Check trial expiry
  const accountLocked=!!user&&!isAdminUser(user)&&(user.planStatus==="expired"||dLeft(user.planExpiry,nowTick)===0);
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
    const s = io(SERVER);
    const sellerId=sellerIdOf(user.email);
    const sessionId=currentSessionId;
    const commentsKey=sellerLiveDataKey("sf_comments",user.email,currentSessionId);
    const joinRoom=()=>s.emit("join_live_room",{sellerId,sessionId});
    s.on("connect",joinRoom);
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
        const merged=sortCommentsNewest([comment,...cleanComments(p)]);
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

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(()=>{
    if(!user)return;
    const commentsKey=sellerLiveDataKey("sf_comments",user.email,currentSessionId);
    const refreshComments=()=>{
      const stored=sortCommentsNewest(cleanComments(LS.get<unknown[]>(commentsKey,[]))).slice(0,LIVE_COMMENT_LIMIT);
      setComments(prev=>{
        const same=prev.length===stored.length&&commentKey(prev[0])===commentKey(stored[0])&&commentKey(prev[prev.length-1])===commentKey(stored[stored.length-1]);
        return same?prev:stored;
      });
    };
    refreshComments();
    const timer=window.setInterval(refreshComments,3000);
    return()=>window.clearInterval(timer);
  },[user]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(()=>{
    const refreshSession=()=>{
      const email=LS.get<string>("sf_session","");
      if(!email)return;
      void findUser(email).then(u=>{
        if(LS.get<string>("sf_session","")!==email)return;
        const safe=safeUser(u);
        if(safe)setUser(asAdminPlan(safe));
      });
    };
    refreshSession();
    const timer=window.setInterval(refreshSession,10000);
    return()=>window.clearInterval(timer);
  },[]);

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(()=>{
    if(!user){setSupportUnreadCount(0);return;}
    const refreshSupportBadge=()=>void listSupportMessages().then(ms=>{
      if(isAdminUser(user)){
        setSupportUnreadCount(ms.filter(m=>m.status==="pending"&&!m.adminReply).length);
        return;
      }
      const read=arrLS<string>(supportReadKey(user.email));
      setSupportUnreadCount(ms.filter(m=>m.email.toLowerCase()===user.email.toLowerCase()&&m.adminReply&&!read.includes(m.id)).length);
    });
    refreshSupportBadge();
    const timer=window.setInterval(refreshSupportBadge,10000);
    return()=>window.clearInterval(timer);
  },[user?.email]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  function saveUser(u:User){
    const next=asAdminPlan(u);
    setUser(next);
    LS.set("sf_users",cleanUsers(arrLS<unknown>("sf_users")).map(x=>x.email===next.email?next:x));
    void upsertUser(next);
  }
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(()=>{
    if(!user||isAdminUser(user)||user.planStatus==="expired")return;
    if(dLeft(user.planExpiry,nowTick)>0)return;
    saveUser({...user,planStatus:"expired"});
    setPage("subscription");
  },[user,nowTick]);
  /* eslint-enable react-hooks/set-state-in-effect */
  function handleLogin(u:User){const safe=safeUser(u);if(safe){setUser(asAdminPlan(safe));setPage("dashboard");}}
  function handleLogout(){LS.del("sf_session");if(typeof window!=="undefined")window.sessionStorage.removeItem("sf_account_gate_ok");setUser(null);setComments([]);setBuyers([]);setAllOrders([]);setPrinted(new Set());setTotOrd(0);setTotRev(0);setSelBuyer(null);}
  async function handleDeleteAccount(){
    if(!user)return;
    const email=user.email;
    await deleteSupportMessagesForEmail(email);
    await deleteUser(email);
    ["sf_session","sf_comments","sf_comment_archive","sf_buyers","sf_orders",sellerDataKey("sf_comments",email),sellerDataKey("sf_comment_archive",email),sellerDataKey("sf_buyers",email),sellerDataKey("sf_orders",email),sellerDataKey("sf_printed",email),supportReadKey(email)].forEach(k=>LS.del(k));
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
  function handleSaveSettings(s:Settings){setSettingsState(s);LS.set("sf_settings",s);}
  function handleSavePw(op:string,np:string):string{if(!user)return"No user";if(user.password!==op)return t.wrong_pw;saveUser({...user,password:np});return"";}
  function handleAdminApprove(email:string,plan:Plan,months=1){
    const users=cleanUsers(arrLS<unknown>("sf_users"));
    const now=new Date().toISOString();
    const nextUsers=users.map(u=>u.email.toLowerCase()===email.toLowerCase()?{...u,plan,planStatus:"active" as PlanStatus,planExpiry:plan==="trial"?addDays(7):addMonths(months),trialStartedAt:plan==="trial"?now:u.trialStartedAt}:u);
    LS.set("sf_users",nextUsers);
    const updated=nextUsers.find(u=>u.email.toLowerCase()===email.toLowerCase());
    if(updated)void upsertUser(updated);
    if(updated&&user?.email.toLowerCase()===email.toLowerCase())setUser(asAdminPlan(updated));
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
    try{
      const r=await fetch(`${SERVER}${ep}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const j=await r.json();
      if(!j.success)setToast(`${t.conn_failed}: ${j.error}`);
      else{
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
    }catch{setToast(t.cant_reach);}
  }
  async function createOrderFromComment(c:Comment,{print=true,price=0}:{print?:boolean;price?:number}={}){
    const existing=buyers.find(b=>b.handle===c.handle&&b.platform===c.platform);
    const buyerNum=existing?.num||buyers.length+1;
    const order:LiveOrder={
      orderNum:Date.now(),
      item:c.comment||"Live comment order",
      qty:1,
      price,
      total:price,
      time:c.time||new Date().toLocaleTimeString(),
      handle:c.handle,
      name:c.name||c.handle,
      bNum:buyerNum,
      platform:c.platform,
      status:"New",
      date:new Date().toISOString().slice(0,10),
    };
    const nextBuyer:Buyer=existing
      ? {...existing,name:c.name||existing.name,orders:[...existing.orders,order],totalOrders:existing.totalOrders+1,totalSpent:existing.totalSpent+order.total}
      : {handle:c.handle,name:c.name||c.handle,platform:c.platform,num:buyerNum,orders:[order],totalOrders:1,totalSpent:order.total};
    const singleOrderBuyer:Buyer={...nextBuyer,orders:[order],totalOrders:1,totalSpent:order.total};

    const nextBuyers=existing?buyers.map(b=>b.handle===c.handle&&b.platform===c.platform?nextBuyer:b):[...buyers,nextBuyer];
    saveBuyerMemory(nextBuyers);
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
        product:c.comment||"Live comment order",
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
    ]).catch(err=>console.warn("Background database save failed",err));
  }
  function reprintLatestForComment(c:Comment){
    const b=buyers.find(x=>x.handle===c.handle&&x.platform===c.platform);
    if(!b){void createOrderFromComment(c,{print:true});return;}
    const matchingOrder=[...b.orders].reverse().find(o=>o.item===(c.comment||"Live comment order")&&(o.time===c.time||!c.time))||b.orders[b.orders.length-1];
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
  function commentKey(c:Comment|null|undefined){
    if(!c)return "missing-comment";
    return `${c.platform||"TikTok"}|${c.sourceUsername||""}|${c.sessionId||""}|${c.handle||"buyer"}|${c.timestamp||c.time||""}|${c.comment||""}`;
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
  function oneClick(c:Comment,price=0){
    setPrinted(p=>{
      const next=new Set(p);
      next.add(commentKey(c));
      LS.set(sellerMemoryKey("sf_printed"),Array.from(next));
      return next;
    });
    void createOrderFromComment(c,{print:true,price});
  }
  function submitCommentPrice(c:Comment){
    const key=commentKey(c);
    const price=Number(commentPrices[key]||0)||0;
    oneClick(c,price);
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

  if(!user)return <PublicAuth onLogin={handleLogin} t={t} lang={lang} setLang={setLang}/>;
  if(!isAdminUser(user)&&user.planStatus==="pending")return <PendingApprovalWall user={user} onLogout={handleLogout}/>;
  if(accountGate)return <AccountGate user={user} onContinue={continueSavedAccount} onSwitch={switchAccount}/>;

  const isLive=ttOn||fbOn;
  const platformButtonLabel=(platform:"TikTok"|"Facebook",connected:boolean)=>{
    const account=activeLiveAccounts[platform];
    return connected&&account?account:platform;
  };
  const days=dLeft(user.planExpiry);
  const showMobileBack=["settings","subscription","support","admin","privacy","terms","deleteAccount"].includes(page);
  const navItems:[Page,string,string][]=[
    ["dashboard","⚡",t.nav_live],["miners","🏅",t.nav_miners],["orders","🛒",t.nav_orders],
    ["products","📦",t.nav_products],["customers","👥",t.nav_customers],["customerData","📋","Customer Data"],["print","🖨️",t.nav_print],["sales","📊",t.nav_sales],
  ];
  const navClass=(id:Page)=>`nav-it ${page===id?"on":""}`;

  return(
    <div className="app" onClick={()=>{setShowProf(false);setOpenCommentMenu(null);}}>
      {toast&&<Toast msg={toast} onDone={()=>setToast("")}/>}
      {showAccountLock&&<TrialExpiredWall t={t} onUpgrade={()=>{setPage("subscription");}}/>}

      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sb-logo"><div className="logo-ic"><svg width="16" height="16" viewBox="0 0 18 18"><path d="M4 6 Q4 3 7 3 L11 3 Q14 3 14 6 Q14 9 11 9.5 L7 10.5 Q4 10.5 4 13 Q4 15 7 15 L11 15 Q14 15 14 13" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg></div><span className="logo-tx">Seller<span>FlowLive</span></span></div>
        <div className="nav-sec-lbl">{t.nav_live_section}</div>
        {navItems.slice(0,3).map(([id,ic,lb])=><button key={id} onClick={()=>setPage(id)} className={navClass(id)}><span className="nav-ic">{ic}</span><span className="nav-lb">{lb}</span></button>)}
        <div className="nav-sec-lbl">{t.nav_manage}</div>
        {navItems.slice(3,7).map(([id,ic,lb])=><button key={id} onClick={()=>setPage(id)} className={navClass(id)}><span className="nav-ic">{ic}</span><span className="nav-lb">{lb}</span></button>)}
        <div className="nav-sec-lbl">{t.nav_analytics}</div>
        {navItems.slice(7).map(([id,ic,lb])=><button key={id} onClick={()=>setPage(id)} className={navClass(id)}><span className="nav-ic">{ic}</span><span className="nav-lb">{lb}</span></button>)}
        <button onClick={()=>setPage("support")} className={`nav-it ${page==="support"?"on":""}`}><span className="nav-ic">💬</span><span className="nav-lb">Support</span>{supportUnreadCount>0&&<span className="nav-alert-badge">{supportUnreadCount>9?"9+":supportUnreadCount}</span>}</button>
        {isAdminUser(user)&&<button onClick={()=>setPage("admin")} className={`nav-it ${page==="admin"?"on":""}`}><span className="nav-ic">👑</span><span className="nav-lb">Admin</span>{supportUnreadCount>0&&<span className="nav-alert-badge">{supportUnreadCount>9?"9+":supportUnreadCount}</span>}</button>}
        <button onClick={()=>setPage("settings")} className={navClass("settings")} style={{marginTop:"auto"}}><span className="nav-ic">⚙️</span><span className="nav-lb">{t.nav_settings}</span></button>
        <div className="trial-box">
          <div className="trial-row"><span className="trial-pill">{pName(user.plan,t)}</span><span className="trial-exp">{days}d {t.days_remaining}</span></div>
          <div className="trial-cd" style={{color:days<=2?"#A32D2D":"#26215C"}}>{days===0?t.expired_label:`${days} ${t.days_remaining}`}</div>
          <button className="upgrade-btn" onClick={()=>setPage("subscription")}>{t.upgrade_btn}</button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        <header className={`topbar ${showMobileBack?"has-mobile-back":""}`}>
          {showMobileBack&&<button className="mobile-page-back" onClick={()=>setPage("dashboard")}>Back</button>}
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
                <div className="pd-row pd-cl" onClick={()=>{setPage("subscription");setShowProf(false);}}><span>💎</span><span>Subscription</span></div>
                <div className="pd-row pd-cl" onClick={()=>{setPage("support");setShowProf(false);}}><span>💬</span><span>Support</span></div>
                <div className="pd-row pd-cl" onClick={()=>{setPage("privacy");setShowProf(false);}}><span>Privacy</span><span>Privacy Policy</span></div>
                <div className="pd-row pd-cl" onClick={()=>{setPage("terms");setShowProf(false);}}><span>Terms</span><span>Terms of Service</span></div>
                <div className="pd-row pd-cl" onClick={()=>{setPage("deleteAccount");setShowProf(false);}}><span>Delete</span><span>Delete Account</span></div>
                {isAdminUser(user)&&<div className="pd-row pd-cl" onClick={()=>{setPage("admin");setShowProf(false);}}><span>ADMIN</span><span>Admin</span></div>}
                <div className="pd-row pd-cl" onClick={()=>{setShowProf(false);switchAccount();}}><span>Switch</span><span>Switch account</span></div>
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
                          <div className="msg-tx buy">{c.comment||"Live comment"}</div>
                          <div className="msg-meta">
                            <span>{commentStamp(c)}</span>
                          </div>
                        </div>
                        <div className="msg-actions" onClick={e=>e.stopPropagation()}>
                          <button className="comment-menu-btn" aria-label="Comment tools" onClick={()=>setOpenCommentMenu(openCommentMenu===i?null:i)}>...</button>
                          {openCommentMenu===i&&(
                            <div className="comment-menu">
                              <button onClick={()=>{setOpenCommentMenu(null);void createOrderFromComment(c,{print:true});}}>Create order + print</button>
                              <button onClick={()=>{setOpenCommentMenu(null);void createOrderFromComment(c,{print:false});}}>Create order only</button>
                              <button onClick={()=>{setOpenCommentMenu(null);reprintLatestForComment(c);}}>Reprint latest slip</button>
                              <button onClick={()=>{setOpenCommentMenu(null);showBuyerFromComment(c);}}>View buyer orders</button>
                              <button onClick={()=>{setOpenCommentMenu(null);copyText(`@${c.handle}`,"Username");}}>Copy username</button>
                              <button onClick={()=>{setOpenCommentMenu(null);copyText(c.comment,"Comment");}}>Copy comment</button>
                            </div>
                          )}
                          <div className="order-count" title="Orders created from this buyer">🛒 <span>({orderCount})</span></div>
                          <input
                            ref={el=>{priceInputRefs.current[cKey]=el;}}
                            className="comment-price-input"
                            inputMode="decimal"
                            placeholder="Enter Price"
                            value={commentPrices[cKey]||""}
                            onChange={e=>setCommentPrices(p=>({...p,[cKey]:e.target.value.replace(/[^\d.]/g,"")}))}
                            onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();submitCommentPrice(c);}}}
                          />
                          <button className={`one-btn ${printed.has(cKey)?"done":""}`} onClick={()=>submitCommentPrice(c)}>1-click</button>
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
              <div className="col-lbl">Stats</div>
              <div className="mobile-summary-grid">
                <div className="stat-c"><div className="stat-l">{t.orders_stat}</div><div className="stat-v">{totOrd}</div></div>
                <div className="stat-c"><div className="stat-l">{t.revenue_stat}</div><div className="stat-v" style={{color:"#1D9E75"}}>{settings.currency}{totRev.toLocaleString()}</div></div>
                <div className="stat-c"><div className="stat-l">{t.buyers_stat}</div><div className="stat-v" style={{color:"#534AB7"}}>{buyers.length}</div></div>
              </div>
              <div className="mobile-swipe-hint">Swipe right: stats, buyer numbers, slip preview</div>
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
              <div className="col-lbl">Business tools</div>
              <div className="mobile-tool-grid">
                <button className="mobile-tool-card" onClick={()=>setPage("orders")}>
                  <span>🛒</span><b>{t.nav_orders}</b><em>{totOrd} today</em>
                </button>
                <button className="mobile-tool-card" onClick={()=>setPage("products")}>
                  <span>📦</span><b>{t.nav_products}</b><em>Manage items</em>
                </button>
                <button className="mobile-tool-card" onClick={()=>setPage("sales")}>
                  <span>📊</span><b>{t.nav_sales}</b><em>{settings.currency}{totRev.toLocaleString()}</em>
                </button>
              </div>
              <div className="mobile-swipe-hint">Use profile menu for account, subscription, support, and admin tools.</div>
            </section>
          </div>
        )}

        {/* MINERS PAGE */}
        {page==="miners"&&(
          <div className="subpage">
            <div className="subpage-hd"><div><h2>{t.nav_miners}</h2><p>All buyers with permanent numbers</p></div>
              <button className="btn-out" onClick={()=>csvDL("miners.csv",["#","Name","Username","Platform","Orders","Total"],buyers.map(b=>[b.num,b.name,`@${b.handle}`,b.platform,b.totalOrders,`${settings.currency}${b.totalSpent}`]))}>⬇ {t.export_csv}</button>
            </div>
            <div className="table-card">
              <table className="tbl">
                <thead><tr><th>#</th><th>Name</th><th>Username</th><th>Platform</th><th>Orders</th><th>Total</th><th></th></tr></thead>
                <tbody>
                  {buyers.length===0&&<tr><td colSpan={7} style={{textAlign:"center",padding:40,color:"#888"}}>No buyers yet</td></tr>}
                  {buyers.map(b=>(
                    <tr key={b.handle}>
                      <td><div style={{width:28,height:28,borderRadius:"50%",background:nc(b.num),color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:700}}>{b.num}</div></td>
                      <td><div style={{display:"flex",alignItems:"center",gap:8}}><Av name={b.name} size={28}/><strong>{b.name}</strong></div></td>
                      <td className="mono" style={{color:"#7F77DD"}}>@{b.handle}</td>
                      <td><Badge label={b.platform} color={b.platform==="TikTok"?"purple":"green"}/></td>
                      <td>{b.totalOrders}</td>
                      <td><strong style={{color:"#534AB7"}}>{b.totalSpent>0?`${settings.currency}${b.totalSpent.toLocaleString()}`:""}</strong></td>
                      <td><button onClick={()=>{setSelBuyer(b);setPage("dashboard");printSlip(b,settings.currency,user.profile.storeName||"SellerFlowLive",settings);}} style={{padding:"5px 12px",background:"#7F77DD",color:"#fff",border:"none",borderRadius:7,fontSize:11,cursor:"pointer"}}>🖨 Print</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {page==="orders"&&<Orders orders={allOrders} setOrders={setAllOrders} onPersist={orders=>LS.set(sellerMemoryKey("sf_orders"),orders)} cur={settings.currency} t={t}/>}
        {page==="products"&&<Products cur={settings.currency} t={t}/>}
        {page==="customers"&&<><Customers buyers={buyers} cur={settings.currency} t={t}/><CommentArchive comments={archivedComments}/></>}
        {page==="customerData"&&<CustomerDataPage comments={[...comments,...archivedComments]} onRefresh={()=>setCurrentLiveDayId(liveDayId())}/>}
        {page==="print"&&<PrintPage buyers={buyers} cur={settings.currency} storeName={user.profile.storeName||"SellerFlowLive"} settings={settings} t={t}/>}
        {page==="sales"&&<Sales orders={allOrders} buyers={buyers} cur={settings.currency} t={t}/>}
        {page==="settings"&&<SettingsPage user={user} settings={settings} onSaveProfile={handleSaveProfile} onSaveSettings={handleSaveSettings} onSavePw={handleSavePw} onExportBackup={exportSellerBackup} onClearLiveComments={clearLiveCommentsOnly} t={t}/>}
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
            <span style={{fontSize:22}}>💬</span>
            <span>Comments</span>
          </button>
          <button className={page==="orders"?"active":""} onClick={()=>setPage("orders")}>
            <span style={{fontSize:22}}>🛒</span>
            <span>Orders</span>
          </button>
          <button className={page==="sales"?"active":""} onClick={()=>setPage("sales")}>
            <span style={{fontSize:22}}>📊</span>
            <span>Sales</span>
          </button>
          <button className={page==="settings"?"active":""} onClick={()=>setPage("settings")}>
            <span style={{fontSize:22}}>⚙️</span>
            <span>Settings</span>
            {supportUnreadCount>0&&<span className="mobile-nav-badge">{supportUnreadCount>9?"9+":supportUnreadCount}</span>}
          </button>
        </nav>
      )}

      {showConn&&<ConnectModal onClose={()=>setShowConn(false)} onConnect={connectPlatform} user={user} t={t} initialTab={connectTab}/>}
    </div>
  );
}
