import { saveOrderToDatabase, saveCustomerToDatabase } from "./db";
import {
  type AccountAuditLog,
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
type Page = "dashboard"|"miners"|"orders"|"products"|"customers"|"print"|"sales"|"settings"|"subscription"|"support"|"admin";

interface Profile { fullName:string; storeName:string; phone:string; tiktok:string; facebook:string; }
interface User { email:string; password:string; profile:Profile; plan:Plan; planStatus:PlanStatus; planExpiry:string; connectedAccounts:string[]; }
interface LiveOrder { orderNum:number; item:string; qty:number; price:number; total:number; time:string; handle:string; name:string; bNum:number; platform:string; status:string; date:string; }
interface Buyer { handle:string; name:string; platform:string; num:number; orders:LiveOrder[]; totalSpent:number; totalOrders:number; }
interface Comment { handle:string; name:string; comment:string; platform:"TikTok"|"Facebook"; isBuy:boolean; buyerNum:number|null; buyerData:Buyer|null; time:string; avatar?:string; timestamp?:string; }
interface Product { id:number; name:string; sku:string; price:number; stock:number; platform:string; status:string; }
interface Settings { autoprint:boolean; soundAlert:boolean; stockAlert:boolean; dailyEmail:boolean; keywords:string; currency:string; paperSize:string; printerType:"usb"|"bluetooth"; stickerSize:string; printStoreName:boolean; printBuyerNumber:boolean; printBuyerUsername:boolean; printOrderItems:boolean; printTotal:boolean; printAutoClose:boolean; printLabelScale:number; }
interface SupportMsg { id:string; name:string; email:string; subject:string; message:string; hasProof:boolean; timestamp:string; status:"pending"|"approved"|"rejected"|"resolved"; adminReply?:string; repliedAt?:string; }

// ─── Storage ──────────────────────────────────────────────────────────────────
const LS = {
  get:<X,>(k:string,d:X):X=>{try{const v=localStorage.getItem(k);return v!==null?JSON.parse(v):d;}catch{return d;}},
  set:(k:string,v:unknown)=>{try{localStorage.setItem(k,JSON.stringify(v));}catch{}},
  del:(k:string)=>{try{localStorage.removeItem(k);}catch{}},
};

const SERVER = import.meta.env.VITE_SERVER_URL || "http://localhost:3001";
const DEF_SETTINGS: Settings = { autoprint:true, soundAlert:true, stockAlert:true, dailyEmail:false, keywords:"", currency:"₱", paperSize:"100x60mm", printerType:"usb", stickerSize:"100x60mm", printStoreName:true, printBuyerNumber:true, printBuyerUsername:true, printOrderItems:true, printTotal:true, printAutoClose:true, printLabelScale:100 };
const LANG_OPTS: {code:Lang;label:string}[] = [{code:"en",label:"🇺🇸 EN"},{code:"fil",label:"🇵🇭 FIL"},{code:"zh",label:"🇨🇳 中文"},{code:"vi",label:"🇻🇳 VI"}];
const CURRENCIES = [{v:"₱",l:"₱ PHP"},{v:"$",l:"$ USD"},{v:"NT$",l:"NT$ NTD"},{v:"¥",l:"¥ CNY"},{v:"฿",l:"฿ THB"},{v:"₫",l:"₫ VND"}];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const nc=(n:number)=>n===1?"#26215C":n<=3?"#534AB7":"#7F77DD";
const ini=(s:string)=>s.split(/[\s_]/g).slice(0,2).map(w=>w[0]?.toUpperCase()).join("")||"??";
const abg=(h:string)=>{const c=["#7F77DD","#1D9E75","#D85A30","#D4537E","#378ADD","#BA7517"];let x=0;for(const ch of h)x=(x*31+ch.charCodeAt(0))%c.length;return c[Math.abs(x)];};
const addDays=(n:number)=>{const d=new Date();d.setDate(d.getDate()+n);return d.toISOString();};
const addMonths=(n:number)=>{const d=new Date();d.setMonth(d.getMonth()+n);return d.toISOString();};
const dLeft=(e:string)=>Math.max(0,Math.ceil((new Date(e).getTime()-Date.now())/86400000));
const maxAcc=(p:Plan)=>({trial:1,basic:1,pro:3,master:5}[p]);
const OWNER_EMAIL=(import.meta.env.VITE_OWNER_EMAIL||"admin@sellerflow.app").trim().toLowerCase();
const ENV_ADMIN_EMAILS=(import.meta.env.VITE_ADMIN_EMAILS||OWNER_EMAIL).split(",").map((e:string)=>e.trim().toLowerCase()).filter(Boolean);
const adminEmails=()=>Array.from(new Set([OWNER_EMAIL,...ENV_ADMIN_EMAILS,...LS.get<string[]>("sf_admin_emails",[]).map(e=>e.trim().toLowerCase())].filter(Boolean)));
const isAdminEmail=(email:string)=>adminEmails().includes(email.trim().toLowerCase());
const rememberAdminEmail=(email:string)=>LS.set("sf_admin_emails",Array.from(new Set([...LS.get<string[]>("sf_admin_emails",[]),email.trim().toLowerCase()].filter(Boolean))));
const forgetAdminEmail=(email:string)=>LS.set("sf_admin_emails",LS.get<string[]>("sf_admin_emails",[]).filter(e=>e.trim().toLowerCase()!==email.trim().toLowerCase()));
const supportReadKey=(email:string)=>`sf_support_read_${email.trim().toLowerCase()}`;
const isAdminUser=(u:User|null)=>!!u&&isAdminEmail(u.email);
const canConnectMore=(u:User)=>isAdminUser(u)||u.connectedAccounts.length<maxAcc(u.plan);
const asAdminPlan=(u:User)=>isAdminUser(u)?{...u,plan:"master" as Plan,planStatus:"active" as PlanStatus,planExpiry:addMonths(120)}:u;
const pName=(p:Plan,t:T)=>({trial:t.plan_trial,basic:t.plan_basic,pro:t.plan_pro,master:t.plan_master}[p]);
const pColor=(p:Plan)=>({trial:"gray",basic:"green",pro:"purple",master:"amber"}[p] as "gray"|"green"|"purple"|"amber");
const csvDL=(filename:string,headers:string[],rows:(string|number)[][])=>{
  const csv=[headers,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(",")).join("\n");
  const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=filename;a.click();
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

function printSlip(buyer:Buyer,cur:string,storeName:string,printSettings:Settings|string){
  const cfg:Settings=typeof printSettings==="string"?{...DEF_SETTINGS,stickerSize:printSettings}:printSettings;
  const size=cfg.stickerSize;
  const labelScale=Math.max(80,Math.min(140,cfg.printLabelScale||100))/100;
  const sess=new Date().toLocaleDateString("en-PH",{month:"long",day:"numeric",year:"numeric"});
  const color=nc(buyer.num);
  const [w,h]=size.split("x").map(Number);
  const mmToPx=(mm:number)=>Math.round(mm*3.7795);
  const pw=mmToPx(w||100);
  const oHtml=buyer.orders.map(o=>`<div style="border-left:2px solid #7F77DD;padding-left:6px;margin-bottom:5px"><div style="font-size:9px;color:#888">${o.time} — #SF${o.orderNum}</div><div style="font-size:10px;font-weight:700">${o.item}</div><div style="font-size:9px;color:#555">x${o.qty} — ${cur}${o.total.toLocaleString()}</div></div>`).join("");
  const win=window.open("","_blank",`width=${pw+40},height=700`);
  if(!win){alert("Allow popups to print slips!");return;}
  if(cfg.printAutoClose)win.onafterprint=()=>win.close();
  win.document.write(`<!DOCTYPE html><html><head><title>Slip #${buyer.num}</title><style>@page{size:${size.replace("x","mm ")}mm;margin:4mm}*{box-sizing:border-box;margin:0;padding:0}body{font-family:monospace;width:${w}mm;font-size:${10*labelScale}px;color:#000}.logo{display:flex;align-items:center;gap:5px;justify-content:center;margin-bottom:7px}.li{width:22px;height:22px;background:#7F77DD;border-radius:5px;display:flex;align-items:center;justify-content:center}.lt{font-family:sans-serif;font-size:${13*labelScale}px}.ls{font-weight:700;color:#26215C}.lf{color:#7F77DD}hr{border:none;border-top:1.5px solid #000;margin:6px 0}.dash{border-top:1px dashed #aaa;margin:5px 0}.nb{text-align:center;background:#EEEDFE;border-radius:7px;padding:6px 0 4px;margin-bottom:7px;border:1px solid #AFA9EC}.nl{font-size:${8*labelScale}px;color:#534AB7;font-family:sans-serif;letter-spacing:.5px}.nn{font-size:${46*labelScale}px;font-weight:700;font-family:sans-serif;line-height:1;color:${color}}.na{font-size:${12*labelScale}px;font-weight:700;font-family:sans-serif;color:#26215C}.nh{font-size:${9*labelScale}px;color:#7F77DD}.sl{font-size:${8*labelScale}px;color:#888;text-align:center;margin-bottom:5px}.ot{font-size:${8*labelScale}px;font-family:sans-serif;color:#888;margin-bottom:4px}.tr{display:flex;justify-content:space-between}.tl{font-size:${9*labelScale}px;color:#888}.tv{font-family:sans-serif;font-size:${15*labelScale}px;font-weight:700}.ft{text-align:center;font-size:${8*labelScale}px;color:#aaa;margin-top:6px;line-height:1.5}@media print{body{margin:0}}</style></head><body>
  <div class="logo"><div class="li"><svg width="14" height="14" viewBox="0 0 18 18"><path d="M4 6 Q4 3 7 3 L11 3 Q14 3 14 6 Q14 9 11 9.5 L7 10.5 Q4 10.5 4 13 Q4 15 7 15 L11 15 Q14 15 14 13" fill="none" stroke="#fff" stroke-width="2.5" stroke-linecap="round"/></svg></div><div class="lt"><span class="ls">Seller</span><span class="lf">Flow</span></div></div>
  ${cfg.printStoreName?`<div style="text-align:center;font-size:${9*labelScale}px;color:#888;margin-bottom:5px">${storeName}</div>`:""}
  <hr><div class="nb">${cfg.printBuyerNumber?`<div class="nl">BUYER NUMBER</div><div class="nn">#${buyer.num}</div>`:""}<div class="na">${buyer.name}</div>${cfg.printBuyerUsername?`<div class="nh">@${buyer.handle}</div>`:""}</div>
  <div class="sl">Session: ${sess}</div>${cfg.printOrderItems?`<div class="ot">Orders today (${buyer.orders.length})</div>${oHtml}`:""}
  ${cfg.printTotal?`<div class="dash"></div><div class="tr"><span class="tl">TOTAL TODAY</span><span class="tv">${cur}${buyer.totalSpent.toLocaleString()}</span></div>`:""}
  <div class="dash"></div><div class="ft">Thank you!<br>SellerFlow · sellerflow.app</div>
  </body></html>`);
  win.document.close();
  setTimeout(()=>win.print(),600);
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
        <div className="auth-brand"><div className="auth-logo-ic"><svg width="26" height="26" viewBox="0 0 18 18"><path d="M4 6 Q4 3 7 3 L11 3 Q14 3 14 6 Q14 9 11 9.5 L7 10.5 Q4 10.5 4 13 Q4 15 7 15 L11 15 Q14 15 14 13" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg></div><span className="auth-brand-name">Seller<span>Flow</span></span></div>
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

// ═══════════════════════════════════════════════════════════════════
// SUBSCRIPTION PAGE
// ═══════════════════════════════════════════════════════════════════
function SubPage({user,onActivate,t}:{user:User;onActivate:(plan:Plan,status:PlanStatus,expiry:string)=>void;t:T}){
  const [sel,setSel]=useState<Plan|null>(null);
  const [showPay,setShowPay]=useState(false);
  const [done,setDone]=useState(false);
  const days=dLeft(user.planExpiry);
  const plans=[
    {id:"trial" as Plan,name:t.plan_trial,price:"$0",period:t.plan_7days,acc:t.plan_1acc,icon:"🎯",color:"#888780",desc:t.plan_trial_desc,features:t.plan_trial_features as string[]},
    {id:"basic" as Plan,name:t.plan_basic,price:"$10",period:t.plan_month,acc:t.plan_1acc,icon:"⚡",color:"#1D9E75",desc:t.plan_basic_desc,features:t.plan_basic_features as string[]},
    {id:"pro" as Plan,name:t.plan_pro,price:"$19",period:t.plan_month,acc:t.plan_3acc,icon:"🚀",color:"#7F77DD",badge:t.plan_popular,desc:t.plan_pro_desc,features:t.plan_pro_features as string[]},
    {id:"master" as Plan,name:t.plan_master,price:"$40",period:t.plan_month,acc:t.plan_5acc,icon:"👑",color:"#D85A30",desc:t.plan_master_desc,features:t.plan_master_features as string[]},
  ] as const;

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
            <div className="plan-icon">{p.icon}</div>
            <div className="plan-name">{p.name}</div>
            <div className="plan-price"><span className="plan-amt">{p.price}</span><span className="plan-period">{p.period}</span></div>
            <div className="plan-acc" style={{color:p.color}}>{p.acc}</div>
            <div className="plan-desc">{p.desc}</div>
            <div className="plan-feats">{p.features.map(f=><div key={f} className="plan-feat"><span style={{color:p.color}}>✓</span> {f}</div>)}</div>
            <div className="plan-sel-btn" style={sel===p.id&&user.plan!==p.id?{background:p.color,borderColor:p.color,color:"#fff"}:{borderColor:p.color,color:p.color}}>
              {user.plan===p.id?t.plan_current:sel===p.id?t.plan_selected:t.plan_select}
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
function Orders({orders,setOrders,cur,t}:{orders:LiveOrder[];setOrders:(o:LiveOrder[])=>void;cur:string;t:T}){
  const [filt,setFilt]=useState("all");const [q,setQ]=useState("");
  const filtered=orders.filter(o=>(filt==="all"||o.status.toLowerCase()===filt)&&(o.handle.includes(q)||o.item.toLowerCase().includes(q.toLowerCase())||o.name.toLowerCase().includes(q.toLowerCase())));
  const upStat=(i:number,s:string)=>{const u=orders.map((o,idx)=>idx===i?{...o,status:s}:o);setOrders(u);LS.set("sf_orders",u);};
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
          {([["all",t.filter_all],[""+ c.new,t.filter_new],["printed",t.filter_printed],["waiting",t.filter_waiting]] as [string,string][]).map(([v,l],i)=>{
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
  const filtered=buyers.filter(b=>b.name.toLowerCase().includes(q.toLowerCase())||b.handle.toLowerCase().includes(q.toLowerCase()));
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
        {settings.printerType==="bluetooth"?`📡 ${t.printer_bt_note}`:`🔌 ${t.printer_usb_note}`}
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
function SettingsPage({user,settings,onSaveProfile,onSaveSettings,onSavePw,t}:{user:User;settings:Settings;onSaveProfile:(p:Profile)=>void;onSaveSettings:(s:Settings)=>void;onSavePw:(o:string,n:string)=>string;t:T}){
  const [prof,setProf]=useState<Profile>({...user.profile});
  const [sets,setSets]=useState<Settings>({...settings});
  const [op,setOp]=useState("");const [np,setNp]=useState("");const [cp,setCp]=useState("");
  const [toast,setToast]=useState("");const [pwErr,setPwErr]=useState("");
  const settingsDirty=JSON.stringify(sets)!==JSON.stringify(settings);
  const previewScale=Math.max(80,Math.min(140,sets.printLabelScale||100))/100;
  useEffect(()=>{setProf({...user.profile});},[user]);
  useEffect(()=>{setSets({...settings});},[settings]);
  function saveProf(e:React.FormEvent){e.preventDefault();onSaveProfile(prof);setToast(t.profile_saved);}
  function saveSets(e:React.FormEvent){e.preventDefault();onSaveSettings(sets);setToast(t.settings_saved);}
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
      <div className="grid2">
        <form onSubmit={saveProf} className="scard">
          <div className="scard-title">{t.profile_section}</div>
          <Fg label={t.full_name}><input value={prof.fullName} onChange={e=>setProf(p=>({...p,fullName:e.target.value}))} required/></Fg>
          <Fg label={t.store_name}><input value={prof.storeName} onChange={e=>setProf(p=>({...p,storeName:e.target.value}))} required/></Fg>
          <Fg label={t.email_label}><input value={user.email} disabled style={{background:"#F5F5F2",color:"#888"}}/></Fg>
          <Fg label={t.phone_label}><input value={prof.phone} onChange={e=>setProf(p=>({...p,phone:e.target.value}))} placeholder="+63 912 345 6789"/></Fg>
          <Fg label={t.tiktok_user}><input value={prof.tiktok} onChange={e=>setProf(p=>({...p,tiktok:e.target.value}))} placeholder="@yourusername"/></Fg>
          <Fg label={t.fb_page}><input value={prof.facebook} onChange={e=>setProf(p=>({...p,facebook:e.target.value}))} placeholder="Your Facebook Page"/></Fg>
          <button type="submit" className="btn-purple">{t.save_profile}</button>
        </form>
        <form onSubmit={savePw} className="scard">
          <div className="scard-title">{t.pw_section}</div>
          {pwErr&&<div className="auth-err">⚠ {pwErr}</div>}
          <Fg label={t.current_pw}><input type="password" value={op} onChange={e=>setOp(e.target.value)} required/></Fg>
          <Fg label={t.new_pw}><input type="password" value={np} onChange={e=>setNp(e.target.value)} required/></Fg>
          <Fg label={t.confirm_pw}><input type="password" value={cp} onChange={e=>setCp(e.target.value)} required/></Fg>
          <button type="submit" className="btn-purple">{t.update_pw}</button>
        </form>
        <form onSubmit={saveSets} className="scard">
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
          <button type="submit" className="btn-purple" style={{marginTop:6}}>{t.save_settings}</button>
        </form>
        <form onSubmit={saveSets} className="scard">
          <div className="scard-title" style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8}}>
            <span>{t.printer_section}</span>
            <span style={{fontSize:11,fontWeight:600,color:settingsDirty?"#B45309":"#0F6E56",background:settingsDirty?"#FFF3CD":"#E1F5EE",borderRadius:999,padding:"3px 8px"}}>
              {settingsDirty?"Not saved":"Saved"}
            </span>
          </div>
          <Fg label={t.printer_type}>
            <select value={sets.printerType} onChange={e=>setSets(s=>({...s,printerType:e.target.value as "usb"|"bluetooth"}))}>
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
            <div className="printer-preview-slip" style={{fontSize:`${10*previewScale}px`}}>
              <div className="printer-preview-brand"><span className="printer-preview-logo">S</span><strong>Seller<span>Flow</span></strong></div>
              {sets.printStoreName&&<div className="printer-preview-store">{user.profile.storeName||"My Store"}</div>}
              <div className="printer-preview-line"/>
              <div className="printer-preview-buyer">
                {sets.printBuyerNumber&&<><small>BUYER NUMBER</small><b style={{fontSize:`${38*previewScale}px`}}>#12</b></>}
                <strong style={{fontSize:`${12*previewScale}px`}}>Maria Santos</strong>
                {sets.printBuyerUsername&&<em>@maria_live</em>}
              </div>
              <div className="printer-preview-session">Session: May 17, 2026</div>
              {sets.printOrderItems&&<div className="printer-preview-orders">
                <small>Orders today (2)</small>
                <div>12:21 PM - #SF1001<br/><b>Blue dress</b> x1</div>
                <div>12:22 PM - #SF1002<br/><b>Crop top</b> x2</div>
              </div>}
              {sets.printTotal&&<><div className="printer-preview-dash"/><div className="printer-preview-total"><span>TOTAL TODAY</span><b>{sets.currency}1,240</b></div></>}
            </div>
          </div>
          <Fg label={`Label word size (${sets.printLabelScale||100}%)`}>
            <input type="range" min="80" max="140" step="5" value={sets.printLabelScale||100} onChange={e=>setSets(s=>({...s,printLabelScale:Number(e.target.value)}))}/>
          </Fg>
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
            {sets.printerType==="bluetooth"?t.printer_bt_note:t.printer_usb_note}
          </div>
          <button type="submit" className="btn-purple" style={{marginTop:10,width:"100%"}}>
            Save printer settings
          </button>
          <div className="scard-title" style={{marginTop:10}}>{t.platform_section}</div>
          <div style={{fontSize:12,color:"#888",marginBottom:8}}>{t.platform_hint}</div>
          <div className="tog-row"><div><div style={{fontWeight:500}}>TikTok Live</div><div style={{fontSize:11,color:"#888"}}>{user.profile.tiktok||t.not_set}</div></div><Badge label={user.connectedAccounts.includes("TikTok")?t.connected_label:t.not_connected} color={user.connectedAccounts.includes("TikTok")?"green":"gray"}/></div>
          <div className="tog-row" style={{borderBottom:"none"}}><div><div style={{fontWeight:500}}>Facebook Live</div><div style={{fontSize:11,color:"#888"}}>{user.profile.facebook||t.not_set}</div></div><Badge label={user.connectedAccounts.includes("Facebook")?t.connected_label:t.not_connected} color={user.connectedAccounts.includes("Facebook")?"green":"gray"}/></div>
        </form>
      </div>
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
  const [selectedMsgId,setSelectedMsgId]=useState("");
  const [readIds,setReadIds]=useState<string[]>(()=>LS.get<string[]>(supportReadKey(user.email),[]));
  async function send(e:React.FormEvent){
    e.preventDefault();
    const sm:SupportMsg={id:Date.now().toString(),name,email,subject,message:msg,hasProof:!!file,timestamp:new Date().toISOString(),status:"pending"};
    try{
      await saveSupportMessage(sm);
      setSent(true);setMsg("");setFile(null);
    }catch(error){
      alert(`Support message was not saved to Supabase: ${error instanceof Error?error.message:"Unknown error"}`);
    }
  }
  const [prev,setPrev]=useState<SupportMsg[]>(()=>LS.get<SupportMsg[]>("sf_support",[]).filter(m=>m.email.toLowerCase()===user.email.toLowerCase()));
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
              </Fg>
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
function AdminPage({currentUser,onApprove,t}:{currentUser:User;onApprove:(email:string,plan:Plan)=>void;t:T}){
  const [users,setUsers]=useState<User[]>(()=>LS.get("sf_users",[]));
  const [msgs,setMsgs]=useState<SupportMsg[]>(()=>LS.get("sf_support",[]));
  const [auditLogs,setAuditLogs]=useState<AccountAuditLog[]>(()=>LS.get("sf_audit_logs",[]));
  const [admins,setAdmins]=useState<string[]>(()=>adminEmails());
  const [newSeller,setNewSeller]=useState({email:"",password:"123456",fullName:"",storeName:""});
  const [editOriginalEmail,setEditOriginalEmail]=useState("");
  const [editSeller,setEditSeller]=useState({email:"",newPassword:"",fullName:"",storeName:"",phone:"",tiktok:"",facebook:""});
  const [adminSearch,setAdminSearch]=useState("");
  const [replyDrafts,setReplyDrafts]=useState<Record<string,string>>({});
  const [selectedSupportEmail,setSelectedSupportEmail]=useState("");
  const [copied,setCopied]=useState("");
  const usersTableRef=useRef<HTMLDivElement>(null);
  const paymentsTableRef=useRef<HTMLDivElement>(null);
  const auditTableRef=useRef<HTMLDivElement>(null);
  const adminPageRef=useRef<HTMLDivElement>(null);

  async function refresh(){
    setUsers(await listUsers());
    setMsgs(await listSupportMessages());
    setAuditLogs(await listAuditLogs());
    setAdmins(adminEmails());
  }

  useEffect(()=>{
    void refresh();
    const timer=window.setInterval(()=>{void refresh();},10000);
    return()=>window.clearInterval(timer);
  },[]);

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

  function approve(email:string,plan:Plan){
    onApprove(email,plan);
    void logAction("approved plan",email,`Plan changed to ${plan}`);
    setTimeout(refresh,50);
  }

  async function logAction(action:string,targetEmail:string,details:string){
    const log={actorEmail:currentUser.email,action,targetEmail,details};
    await saveAuditLog(log);
    setAuditLogs(prev=>[{...log,id:Date.now().toString(),timestamp:new Date().toISOString()},...prev].slice(0,80));
  }

  async function setPlan(email:string,plan:Plan,status:PlanStatus="active"){
    const expiry=status==="expired"?addDays(-1):plan==="trial"?addDays(7):addMonths(1);
    const next=users.map(u=>u.email.toLowerCase()===email.toLowerCase()?{...u,plan,planStatus:status,planExpiry:expiry}:u);
    LS.set("sf_users",next);
    setUsers(next);
    const updated=next.find(u=>u.email.toLowerCase()===email.toLowerCase());
    if(updated){
      await upsertUser(updated);
      await logAction(status==="expired"?"expired seller":"changed plan",email,`Plan ${plan}, status ${status}`);
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
    const updated:User={
      ...current,
      email,
      password:newPassword||current.password,
      profile:{
        fullName:editSeller.fullName.trim(),
        storeName:editSeller.storeName.trim(),
        phone:editSeller.phone.trim(),
        tiktok:editSeller.tiktok.trim(),
        facebook:editSeller.facebook.trim(),
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
  const pendingPayments=msgs.filter(m=>m.status==="pending");
  const todayIso=new Date().toISOString().slice(0,10);
  const todayOrders=LS.get<LiveOrder[]>("sf_orders",[]).filter(o=>o.date===todayIso);
  const allStoredOrders=LS.get<LiveOrder[]>("sf_orders",[]);
  const dayStamp=new Date().toISOString().slice(0,10);

  function exportUsers(){
    csvDL(`sellerflow-users-${dayStamp}.csv`,["Email","Role","Plan","Plan Status","Days Left","Connected Accounts","Full Name","Store Name","Phone","TikTok","Facebook"],filteredUsers.map(u=>[
      u.email,isAdminEmail(u.email)?"Admin":"Seller",pName(u.plan,t),u.planStatus,dLeft(u.planExpiry),u.connectedAccounts.length,u.profile.fullName,u.profile.storeName,u.profile.phone,u.profile.tiktok,u.profile.facebook
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

      <div className="admin-exportbar">
        <button className="btn-out" onClick={exportUsers}>Export Users CSV</button>
        <button className="btn-out" onClick={exportPayments}>Export Payments CSV</button>
        <button className="btn-out" onClick={exportAudit}>Export Audit CSV</button>
        <button className="btn-out" onClick={exportOrders}>Export Orders CSV</button>
      </div>

      <div className="grid4 admin-summary-grid">
        <div className="mstat"><div className="ms-l">Sellers</div><div className="ms-v">{sellerUsers.length}</div></div>
        <div className="mstat"><div className="ms-l">Active</div><div className="ms-v" style={{color:"#1D9E75"}}>{activeSellers.length}</div></div>
        <div className="mstat"><div className="ms-l">Expired</div><div className="ms-v" style={{color:"#A32D2D"}}>{expiredSellers.length}</div></div>
        <div className="mstat"><div className="ms-l">Pending Payments</div><div className="ms-v" style={{color:"#BA7517"}}>{pendingPayments.length}</div></div>
        <div className="mstat"><div className="ms-l">Today Orders</div><div className="ms-v" style={{color:"#534AB7"}}>{todayOrders.length}</div></div>
      </div>

      <div className="scard" style={{marginBottom:16}}>
        <div className="scard-title">Create Seller Account</div>
        <div className="grid4">
          <Fg label="Email"><input value={newSeller.email} onChange={e=>setNewSeller(s=>({...s,email:e.target.value}))} placeholder="seller@email.com"/></Fg>
          <Fg label="Temporary password"><input type="password" value={newSeller.password} onChange={e=>setNewSeller(s=>({...s,password:e.target.value}))} placeholder="Minimum 6 chars"/></Fg>
          <Fg label="Full name"><input value={newSeller.fullName} onChange={e=>setNewSeller(s=>({...s,fullName:e.target.value}))} placeholder="Seller name"/></Fg>
          <Fg label="Store name"><input value={newSeller.storeName} onChange={e=>setNewSeller(s=>({...s,storeName:e.target.value}))} placeholder="Store name"/></Fg>
        </div>
        <button className="btn-purple" style={{marginTop:10}} onClick={createSeller}>Create seller</button>
      </div>

      <div className="grid2">
        <div className="table-card">
          <div className="table-title">Users ({users.length})</div>
          <div className="admin-table-wrap">
            <div className="admin-table-scroll" ref={usersTableRef}>
              <table className="tbl">
                <thead><tr><th>Email</th><th>Role</th><th>Plan</th><th>Days</th><th>Accounts</th><th></th></tr></thead>
                <tbody>
                  {filteredUsers.length===0&&<tr><td colSpan={6} style={{textAlign:"center",padding:24,color:"#888"}}>{users.length===0?"No users yet.":"No users found."}</td></tr>}
                  {filteredUsers.map(u=>(
                    <tr key={u.email}>
                      <td><strong>{u.email}</strong><div className="muted" style={{fontSize:11}}>{u.profile.storeName||u.profile.fullName}</div></td>
                      <td><Badge label={isAdminEmail(u.email)?"Admin":"Seller"} color={isAdminEmail(u.email)?"amber":"gray"}/></td>
                      <td><Badge label={pName(u.plan,t)} color={pColor(u.plan)}/></td>
                      <td>{dLeft(u.planExpiry)}</td>
                      <td>{u.connectedAccounts.length}</td>
                      <td>
                        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                          <button className="tbl-btn ed" onClick={()=>openEditSeller(u)}>Edit</button>
                          <button className="tbl-btn ed" onClick={()=>resetPassword(u.email)}>Reset PW</button>
                          <button className="tbl-btn ed" onClick={()=>setPlan(u.email,"trial")}>Trial</button>
                          <button className="tbl-btn ed" onClick={()=>setPlan(u.email,"basic")}>Basic</button>
                          <button className="tbl-btn ed" onClick={()=>approve(u.email,"pro")}>Pro</button>
                          <button className="tbl-btn ed" onClick={()=>approve(u.email,"master")}>Master</button>
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
            <div className="admin-scroll-tools"><button onClick={()=>scrollBox(usersTableRef.current,"up")}>⌃</button><button onClick={()=>scrollBox(usersTableRef.current,"down")}>⌄</button></div>
          </div>
        </div>

        <div className="table-card">
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
              {false&&[...filteredMsgs].reverse().map(m=>(
                <div key={m.id} className="support-thread">
                  <div className="support-thread-head">
                    <div>
                      <strong>{m.name}</strong>
                      <span>{m.email}</span>
                    </div>
                    <Badge label={m.status} color={m.status==="approved"?"green":m.status==="rejected"?"red":"amber"}/>
                  </div>
                  <div className="support-chat-row seller">
                    <div className="support-avatar">{ini(m.name||m.email)}</div>
                    <div className="support-bubble seller">
                      <strong>{m.subject}</strong>
                      <p>{m.message}</p>
                      <span>{new Date(m.timestamp).toLocaleString()} {m.hasProof?" · Proof attached":""}</span>
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
                    <button className="tbl-btn ed" onClick={()=>{updateMsg(m.id,"approved");approve(m.email,"pro");}}>Approve</button>
                    <button className="tbl-btn dl" onClick={()=>updateMsg(m.id,"rejected")}>Reject</button>
                    <button className="tbl-btn ed" onClick={()=>copy(m.email,"Email")}>Copy email</button>
                  </div>
                  <div className="messenger-reply">
                    <textarea rows={2} value={replyDrafts[m.id] ?? m.adminReply ?? ""} onChange={e=>setReplyDrafts(s=>({...s,[m.id]:e.target.value}))} placeholder="Type a reply like Messenger..."/>
                    <button className="tbl-btn ed" onClick={()=>replyToSeller(m)}>{m.adminReply?"Update reply":"Send reply"}</button>
                  </div>
                </div>
              ))}
            </div>
            <div className="admin-scroll-tools"><button onClick={()=>scrollBox(paymentsTableRef.current,"up")}>⌃</button><button onClick={()=>scrollBox(paymentsTableRef.current,"down")}>⌄</button></div>
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
          <div className="admin-scroll-tools"><button onClick={()=>scrollBox(auditTableRef.current,"up")}>⌃</button><button onClick={()=>scrollBox(auditTableRef.current,"down")}>⌄</button></div>
        </div>
      </div>
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
                <Fg label="TikTok"><input value={editSeller.tiktok} onChange={e=>setEditSeller(s=>({...s,tiktok:e.target.value}))}/></Fg>
                <Fg label="Facebook"><input value={editSeller.facebook} onChange={e=>setEditSeller(s=>({...s,facebook:e.target.value}))}/></Fg>
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

function ConnectModal({onClose,onConnect,user,t}:{onClose:()=>void;onConnect:(p:string,d:Record<string,string>)=>void;user:User;t:T}){
  const [tab,setTab]=useState<"TikTok"|"Facebook">("TikTok");
  const [ttu,setTtu]=useState("");const [fbId,setFbId]=useState("");const [fbTok,setFbTok]=useState("");const [busy,setBusy]=useState(false);
  const canAdd=canConnectMore(user);
  async function connect(){if(!canAdd)return;setBusy(true);if(tab==="TikTok")onConnect("TikTok",{username:ttu});else onConnect("Facebook",{liveVideoId:fbId,accessToken:fbTok});setBusy(false);onClose();}
  return(
    <div className="modal-overlay" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal">
        <div className="modal-hd"><span>{t.connect_title}</span><button onClick={onClose} className="modal-x">×</button></div>
        {!canAdd&&<div className="auth-err" style={{margin:"10px 16px 0"}}>⚠ {t.plan_limit}</div>}
        <div className="modal-tabs">{(["TikTok","Facebook"] as const).map(tb=><button key={tb} onClick={()=>setTab(tb)} className={`mtab ${tab===tb?"on":""}`}>{tb}</button>)}</div>
        <div className="modal-body">
          {tab==="TikTok"?(<><div className="notice-box" style={{background:"#FFF8E1",border:"1px solid #F5DDA0",color:"#633806"}}>⚠ {t.tt_warning}</div><Fg label="TikTok username (without @)"><input value={ttu} onChange={e=>setTtu(e.target.value)} placeholder="e.g. duonglily_0708" disabled={!canAdd}/></Fg></>):(<><div className="notice-box" style={{background:"#E1F5EE",border:"1px solid #9FE1CB",color:"#0F6E56"}}>{t.fb_hint}</div><Fg label={t.fb_video_id}><input value={fbId} onChange={e=>setFbId(e.target.value)} disabled={!canAdd}/></Fg><Fg label={t.fb_token}><input value={fbTok} onChange={e=>setFbTok(e.target.value)} type="password" disabled={!canAdd}/></Fg></>)}
          <button onClick={connect} disabled={busy||!canAdd} className="btn-purple" style={{width:"100%",padding:"10px 0",marginTop:4}}>{busy?t.connecting:canAdd?`${t.connect_btn} ${tab}`:t.upgrade_to_connect}</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════
export default function App(){
  const [lang,setLangState]=useState<Lang>(()=>{try{return JSON.parse(localStorage.getItem("sf_lang")||'"en"') as Lang;}catch{return "en";}});
  const t=TRANSLATIONS[lang];
  function setLang(l:Lang){setLangState(l);try{localStorage.setItem("sf_lang",JSON.stringify(l));}catch{}}

  const [user,setUser]=useState<User|null>(()=>{const e=LS.get<string>("sf_session","");if(!e)return null;const u=LS.get<User[]>("sf_users",[]).find(u=>u.email===e)||null;return u?asAdminPlan(u):null;});
  const [settings,setSettingsState]=useState<Settings>(()=>({...DEF_SETTINGS,...LS.get<Partial<Settings>>("sf_settings",{})}));
  const [page,setPage]=useState<Page>("dashboard");
  const [comments,setComments]=useState<Comment[]>([]);
  const [buyers,setBuyers]=useState<Buyer[]>([]);
  const [allOrders,setAllOrders]=useState<LiveOrder[]>(()=>LS.get("sf_orders",[]));
  const [selBuyer,setSelBuyer]=useState<Buyer|null>(null);
  const [totOrd,setTotOrd]=useState(0);const [totRev,setTotRev]=useState(0);
  const [ttOn,setTtOn]=useState(false);const [fbOn,setFbOn]=useState(false);
  const [showConn,setShowConn]=useState(false);const [showProf,setShowProf]=useState(false);
  const [printed,setPrinted]=useState<Set<number>>(new Set());
  const [openCommentMenu,setOpenCommentMenu]=useState<number|null>(null);
  const [supportUnreadCount,setSupportUnreadCount]=useState(0);
  const [toast,setToast]=useState("");
  const feedRef=useRef<HTMLDivElement>(null);
  const today=new Date().toLocaleDateString("en-PH",{month:"short",day:"numeric",year:"numeric"});

  // Check trial expiry
  const accountLocked=!!user&&!isAdminUser(user)&&(user.planStatus==="expired"||dLeft(user.planExpiry)===0);
  const showAccountLock=accountLocked&&page!=="subscription"&&page!=="support";

  useEffect(()=>{
    if(!user)return;
    const s = io(SERVER);
    s.on("comment", (d: Comment) => {
      setComments((p) => [...p, d]);

      setTimeout(() => {
        feedRef.current?.scrollTo({
          top: 999999,
          behavior: "smooth",
        });
      }, 50);
    
    });
    s.on("buyers_updated",({buyers:b,totalOrders:to}:{buyers:Buyer[];totalOrders:number})=>{
      setBuyers(b);setTotOrd(to);setTotRev(b.reduce((s,x)=>s+x.totalSpent,0));
      const ords=b.flatMap(x=>x.orders.map(o=>({...o,handle:x.handle,name:x.name,bNum:x.num,platform:x.platform,status:"New",date:new Date().toISOString().slice(0,10)})));
      setAllOrders(ords);LS.set("sf_orders",ords);
    });
    s.on("platform_status",({platform:p,connected:c}:{platform:string;connected:boolean})=>{if(p==="TikTok")setTtOn(c);if(p==="Facebook")setFbOn(c);});
    s.on("session_state",({buyers:b,totalOrders:to}:{buyers:Buyer[];totalOrders:number})=>{
      setBuyers(b);setTotOrd(to);setTotRev(b.reduce((s,x)=>s+x.totalSpent,0));
      const ords=b.flatMap(x=>x.orders.map(o=>({...o,handle:x.handle,name:x.name,bNum:x.num,platform:x.platform,status:"New",date:new Date().toISOString().slice(0,10)})));
      setAllOrders(ords);LS.set("sf_orders",ords);
    });
    return()=>{s.disconnect();};
  },[user]);

  useEffect(()=>{
    const email=LS.get<string>("sf_session","");
    if(!email)return;
    const refreshSession=()=>void findUser(email).then(u=>{if(u)setUser(asAdminPlan(u));});
    refreshSession();
    const timer=window.setInterval(refreshSession,10000);
    return()=>window.clearInterval(timer);
  },[]);

  useEffect(()=>{
    if(!user){setSupportUnreadCount(0);return;}
    const refreshSupportBadge=()=>void listSupportMessages().then(ms=>{
      if(isAdminUser(user)){
        setSupportUnreadCount(ms.filter(m=>m.status==="pending"&&!m.adminReply).length);
        return;
      }
      const read=LS.get<string[]>(supportReadKey(user.email),[]);
      setSupportUnreadCount(ms.filter(m=>m.email.toLowerCase()===user.email.toLowerCase()&&m.adminReply&&!read.includes(m.id)).length);
    });
    refreshSupportBadge();
    const timer=window.setInterval(refreshSupportBadge,10000);
    return()=>window.clearInterval(timer);
  },[user?.email]);

  function saveUser(u:User){
    const next=asAdminPlan(u);
    setUser(next);
    LS.set("sf_users",LS.get<User[]>("sf_users",[]).map(x=>x.email===next.email?next:x));
    void upsertUser(next);
  }
  function handleLogin(u:User){setUser(asAdminPlan(u));setPage("dashboard");}
  function handleLogout(){LS.del("sf_session");setUser(null);setComments([]);setBuyers([]);setTotOrd(0);setTotRev(0);setSelBuyer(null);}
  function handleActivate(plan:Plan,status:PlanStatus,expiry:string){
    if(!user)return;
    const u={...user,plan,planStatus:status,planExpiry:expiry};
    saveUser(u);setToast(`${pName(plan,t)} activated!`);setPage("dashboard");
  }
  function handleSaveProfile(p:Profile){if(!user)return;saveUser({...user,profile:p});}
  function handleSaveSettings(s:Settings){setSettingsState(s);LS.set("sf_settings",s);}
  function handleSavePw(op:string,np:string):string{if(!user)return"No user";if(user.password!==op)return t.wrong_pw;saveUser({...user,password:np});return"";}
  function handleAdminApprove(email:string,plan:Plan){
    const users=LS.get<User[]>("sf_users",[]);
    const nextUsers=users.map(u=>u.email.toLowerCase()===email.toLowerCase()?{...u,plan,planStatus:"active" as PlanStatus,planExpiry:addMonths(1)}:u);
    LS.set("sf_users",nextUsers);
    const updated=nextUsers.find(u=>u.email.toLowerCase()===email.toLowerCase());
    if(updated)void upsertUser(updated);
    if(updated&&user?.email.toLowerCase()===email.toLowerCase())setUser(asAdminPlan(updated));
    setToast(`${email} approved for ${plan}`);
  }
  async function connectPlatform(platform:string,data:Record<string,string>){
    const ep=platform==="TikTok"?"/connect/tiktok":"/connect/facebook";
    const body=platform==="TikTok"?{username:data.username}:{liveVideoId:data.liveVideoId,accessToken:data.accessToken};
    try{
      const r=await fetch(`${SERVER}${ep}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const j=await r.json();
      if(!j.success)setToast(`${t.conn_failed}: ${j.error}`);
      else{setToast(`${t.conn_success} ${platform}!`);if(user){const u={...user,connectedAccounts:[...user.connectedAccounts.filter(a=>a!==platform),platform]};saveUser(u);}}
    }catch{setToast(t.cant_reach);}
  }
  async function createOrderFromComment(c:Comment,{print=true}:{print?:boolean}={}){
    const existing=buyers.find(b=>b.handle===c.handle);
    const buyerNum=existing?.num||buyers.length+1;
    const order:LiveOrder={
      orderNum:Date.now(),
      item:c.comment||"Live comment order",
      qty:1,
      price:380,
      total:380,
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

    setBuyers(prev=>existing?prev.map(b=>b.handle===c.handle?nextBuyer:b):[...prev,nextBuyer]);
    setSelBuyer(nextBuyer);
    setAllOrders(prev=>{const next=[...prev,order];LS.set("sf_orders",next);return next;});
    setTotOrd(prev=>prev+1);
    setTotRev(prev=>prev+order.total);

    await saveOrderToDatabase({
      customer_name:c.name||c.handle,
      product:c.comment||"Live comment order",
      total_amount:order.total,
      status:"Pending",
    });
    await saveCustomerToDatabase({
      name:c.name||c.handle,
      handle:c.handle,
      platform:c.platform,
      total_orders:1,
      total_spent:order.total,
    });

    if(print){
      printSlip(nextBuyer,settings.currency,user?.profile.storeName||"SellerFlow",settings);
    }else{
      setToast(`Order created for ${c.name||c.handle}`);
    }
  }
  function reprintLatestForComment(c:Comment){
    const b=buyers.find(x=>x.handle===c.handle);
    if(!b){void createOrderFromComment(c,{print:true});return;}
    setSelBuyer(b);
    printSlip(b,settings.currency,user?.profile.storeName||"SellerFlow",settings);
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
    const time=c.time||d.toLocaleTimeString("en-GB",{hour12:false});
    return `${date} ${time}`;
  }
  function showBuyerFromComment(c:Comment){
    const b=buyers.find(x=>x.handle===c.handle&&x.platform===c.platform);
    if(!b){setToast("No orders yet for this buyer");return;}
    setSelBuyer(b);
    setPage("dashboard");
    setToast(`Showing ${b.name}`);
  }
  function oneClick(c:Comment,i:number){
    setPrinted(p=>new Set(p).add(i));
    void createOrderFromComment(c,{print:true});
  }

  if(!user)return <Auth onLogin={handleLogin} t={t} lang={lang} setLang={setLang}/>;

  const isLive=ttOn||fbOn;
  const days=dLeft(user.planExpiry);
  const navItems:[Page,string,string][]=[
    ["dashboard","⚡",t.nav_live],["miners","🏅",t.nav_miners],["orders","🛒",t.nav_orders],
    ["products","📦",t.nav_products],["customers","👥",t.nav_customers],["print","🖨️",t.nav_print],["sales","📊",t.nav_sales],
  ];

  return(
    <div className="app" onClick={()=>{setShowProf(false);setOpenCommentMenu(null);}}>
      {toast&&<Toast msg={toast} onDone={()=>setToast("")}/>}
      {showAccountLock&&<TrialExpiredWall t={t} onUpgrade={()=>{setPage("subscription");}}/>}

      {/* SIDEBAR */}
      <aside className="sidebar">
        <div className="sb-logo"><div className="logo-ic"><svg width="16" height="16" viewBox="0 0 18 18"><path d="M4 6 Q4 3 7 3 L11 3 Q14 3 14 6 Q14 9 11 9.5 L7 10.5 Q4 10.5 4 13 Q4 15 7 15 L11 15 Q14 15 14 13" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg></div><span className="logo-tx">Seller<span>Flow</span></span></div>
        <div className="nav-sec-lbl">{t.nav_live_section}</div>
        {navItems.slice(0,3).map(([id,ic,lb])=><button key={id} onClick={()=>setPage(id)} className={`nav-it ${page===id?"on":""}`}><span className="nav-ic">{ic}</span><span className="nav-lb">{lb}</span></button>)}
        <div className="nav-sec-lbl">{t.nav_manage}</div>
        {navItems.slice(3,6).map(([id,ic,lb])=><button key={id} onClick={()=>setPage(id)} className={`nav-it ${page===id?"on":""}`}><span className="nav-ic">{ic}</span><span className="nav-lb">{lb}</span></button>)}
        <div className="nav-sec-lbl">{t.nav_analytics}</div>
        {navItems.slice(6).map(([id,ic,lb])=><button key={id} onClick={()=>setPage(id)} className={`nav-it ${page===id?"on":""}`}><span className="nav-ic">{ic}</span><span className="nav-lb">{lb}</span></button>)}
        <button onClick={()=>setPage("support")} className={`nav-it ${page==="support"?"on":""}`}><span className="nav-ic">💬</span><span className="nav-lb">Support</span>{supportUnreadCount>0&&<span className="nav-alert-badge">{supportUnreadCount>9?"9+":supportUnreadCount}</span>}</button>
        {isAdminUser(user)&&<button onClick={()=>setPage("admin")} className={`nav-it ${page==="admin"?"on":""}`}><span className="nav-ic">👑</span><span className="nav-lb">Admin</span>{supportUnreadCount>0&&<span className="nav-alert-badge">{supportUnreadCount>9?"9+":supportUnreadCount}</span>}</button>}
        <button onClick={()=>setPage("settings")} className={`nav-it ${page==="settings"?"on":""}`} style={{marginTop:"auto"}}><span className="nav-ic">⚙️</span><span className="nav-lb">{t.nav_settings}</span></button>
        <div className="trial-box">
          <div className="trial-row"><span className="trial-pill">{pName(user.plan,t)}</span><span className="trial-exp">{days}d {t.days_remaining}</span></div>
          <div className="trial-cd" style={{color:days<=2?"#A32D2D":"#26215C"}}>{days===0?t.expired_label:`${days} ${t.days_remaining}`}</div>
          <button className="upgrade-btn" onClick={()=>setPage("subscription")}>{t.upgrade_btn}</button>
        </div>
      </aside>

      {/* MAIN */}
      <main className="main">
        <header className="topbar">
          <div className={`live-pill ${isLive?"live":"off"}`}><span className="live-dot"/> {isLive?t.live_status:t.offline_status}</div>
          <button onClick={()=>setShowConn(true)} className={`plat-btn ${ttOn?"on":""}`}>TikTok {ttOn?"✓":""}</button>
          <button onClick={()=>setShowConn(true)} className={`plat-btn ${fbOn?"on":""}`}>Facebook {fbOn?"✓":""}</button>
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
                <div className="pd-div"/>
                <div className="pd-row pd-cl" onClick={()=>{setPage("settings");setShowProf(false);}}><span>✏️</span><span>{t.edit_profile}</span></div>
                <div className="pd-row pd-cl" onClick={()=>{setPage("subscription");setShowProf(false);}}><span>💎</span><span>Subscription</span></div>
                <div className="pd-row pd-cl" onClick={()=>{setPage("support");setShowProf(false);}}><span>💬</span><span>Support</span></div>
                {isAdminUser(user)&&<div className="pd-row pd-cl" onClick={()=>{setPage("admin");setShowProf(false);}}><span>ADMIN</span><span>Admin</span></div>}
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
                    return(
                      <div key={i} className="msg-row buy" onDoubleClick={()=>oneClick(c,i)}>
                        <Av name={c.name||c.handle} image={c.avatar} size={48}/>
                        <div className="msg-bd">
                          <div className="msg-nm">
                            <strong>{c.name||c.handle}</strong>
                            <span className="msg-sep">-</span>
                            <span className="msg-handle">{c.handle}</span>
                            <span className={`p-tag ${c.platform.toLowerCase()}`}>{c.platform}</span>
                          </div>
                          <div className="msg-tx buy">{c.comment||"Live comment"}</div>
                          <div className="msg-meta">
                            <span>{commentStamp(c)}</span>
                            <button type="button" onClick={()=>setToast("Deposit note saved for this buyer")} className="deposit-link">Add deposit +</button>
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
                          <button className={`one-btn ${printed.has(i)?"done":""}`} onClick={()=>oneClick(c,i)}>Create</button>
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
                      <div className="b-right"><div className="b-total">{settings.currency}{b.totalSpent.toLocaleString()}</div><div className="b-ords">{b.totalOrders}</div></div>
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
                    <div className="slip-logo"><div className="slip-logo-ic"><svg width="13" height="13" viewBox="0 0 18 18"><path d="M4 6 Q4 3 7 3 L11 3 Q14 3 14 6 Q14 9 11 9.5 L7 10.5 Q4 10.5 4 13 Q4 15 7 15 L11 15 Q14 15 14 13" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"/></svg></div><span className="slip-s">Seller</span><span className="slip-f">Flow</span></div>
                    <div className="slip-hr"/>
                    <div className="slip-nb"><div className="slip-nl">{t.buyer_number_label}</div><div className="slip-nn" style={{color:nc(selBuyer.num)}}>#{selBuyer.num}</div><div className="slip-na">{selBuyer.name}</div><div className="slip-nh">@{selBuyer.handle}</div></div>
                    <div className="slip-sess">{t.session}: {today}</div>
                    <div className="slip-ot">{t.orders_today} ({selBuyer.orders.length})</div>
                    {selBuyer.orders.map((o,i)=><div key={i} className="slip-ob"><div className="slip-ot2">{o.time} — #SF{o.orderNum}</div><div className="slip-oi">{o.item}</div><div className="slip-od">x{o.qty} — {settings.currency}{o.total.toLocaleString()}</div></div>)}
                    <div className="slip-dash"/>
                    <div className="slip-tot"><span className="slip-tl">{t.total_today}</span><span className="slip-tv">{settings.currency}{selBuyer.totalSpent.toLocaleString()}</span></div>
                    <div className="slip-dash"/>
                    <div className="slip-ft">{t.thankyou}<br/>SellerFlow · sellerflow.app</div>
                  </div>
                )}
              </div>
              {selBuyer&&<button className="print-again-btn" onClick={()=>printSlip(selBuyer,settings.currency,user.profile.storeName||"SellerFlow",settings)}>{t.print_again}</button>}
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
                      <td><strong style={{color:"#534AB7"}}>{settings.currency}{b.totalSpent.toLocaleString()}</strong></td>
                      <td><button onClick={()=>{setSelBuyer(b);setPage("dashboard");printSlip(b,settings.currency,user.profile.storeName||"SellerFlow",settings);}} style={{padding:"5px 12px",background:"#7F77DD",color:"#fff",border:"none",borderRadius:7,fontSize:11,cursor:"pointer"}}>🖨 Print</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {page==="orders"&&<Orders orders={allOrders} setOrders={setAllOrders} cur={settings.currency} t={t}/>}
        {page==="products"&&<Products cur={settings.currency} t={t}/>}
        {page==="customers"&&<Customers buyers={buyers} cur={settings.currency} t={t}/>}
        {page==="print"&&<PrintPage buyers={buyers} cur={settings.currency} storeName={user.profile.storeName||"SellerFlow"} settings={settings} t={t}/>}
        {page==="sales"&&<Sales orders={allOrders} buyers={buyers} cur={settings.currency} t={t}/>}
        {page==="settings"&&<SettingsPage user={user} settings={settings} onSaveProfile={handleSaveProfile} onSaveSettings={handleSaveSettings} onSavePw={handleSavePw} t={t}/>}
        {page==="subscription"&&<SubPage user={user} onActivate={handleActivate} t={t}/>}
        {page==="support"&&<Support user={user} t={t}/>}
        {page==="admin"&&<AdminPage currentUser={user} onApprove={handleAdminApprove} t={t}/>}
      </main>

      {showConn&&<ConnectModal onClose={()=>setShowConn(false)} onConnect={connectPlatform} user={user} t={t}/>}
    </div>
  );
}
