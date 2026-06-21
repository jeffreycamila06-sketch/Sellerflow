import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import posthog from "posthog-js";
import "./index.css";
import App from "./App.tsx";

// PostHog analytics initialization. Reads env vars at build time via Vite.
// Silently skips init if the key is missing (e.g. local dev without .env)
// so the app never crashes due to missing analytics config.
const POSTHOG_KEY = import.meta.env.VITE_PUBLIC_POSTHOG_KEY;
const POSTHOG_HOST = import.meta.env.VITE_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";
if (typeof window !== "undefined" && POSTHOG_KEY) {
  posthog.init(POSTHOG_KEY, {
    api_host: POSTHOG_HOST,
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
  });
}

// Platform styling/behavior hooks. Sets body.platform-ios / body.platform-android
// so platform-scoped CSS and UI gating can match the running container:
//   - body.platform-ios     -> Capacitor iOS app, or ?ios=1 (dev testing)
//   - body.platform-android  -> Capacitor Android app, or ?android=1 (dev testing)
// Desktop web and regular mobile browsers get neither class (no Capacitor),
// so platform-scoped CSS rules and gates don't apply there.
//
// The android marker exists so SettingsPage can hide the slip size/position
// controls on the Android APK: it prints slips via the native ESC/POS bridge
// (window.SellerFlowPrinter.printSlip, MainActivity.java) using fixed 1x/2x
// sizing byte-identical to iOS, so those controls are inert on-device — same
// as iOS. Desktop web keeps them, since its browser-print iframe honors them.
if (typeof window !== "undefined" && typeof document !== "undefined" && document.body) {
  const cap = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const params = new URLSearchParams(window.location.search);
  const platform = cap?.getPlatform?.();
  if (platform === "ios" || params.has("ios")) {
    document.body.classList.add("platform-ios");
  }
  if (platform === "android" || params.has("android")) {
    document.body.classList.add("platform-android");
  }
}

class AppErrorBoundary extends Component<{children:ReactNode},{hasError:boolean;message:string}> {
  state={hasError:false,message:""};
  static getDerivedStateFromError(error:unknown){
    return {hasError:true,message:error instanceof Error?error.message:"SellerFlowLive could not load."};
  }
  render(){
    if(!this.state.hasError)return this.props.children;
    return (
      <div style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#F6F3ED",padding:20,fontFamily:"Arial, sans-serif"}}>
        <div style={{maxWidth:460,width:"100%",background:"#fff",border:"1px solid #E3DAC8",borderRadius:14,padding:22,boxShadow:"0 16px 40px rgba(38,33,92,.12)"}}>
          <h1 style={{margin:"0 0 8px",color:"#26215C",fontSize:24}}>SellerFlowLive needs refresh</h1>
          <p style={{color:"#666",lineHeight:1.5}}>Old saved browser data blocked this page from opening. Use the reset button below to clear only SellerFlowLive data on this browser, then sign in again.</p>
          <pre style={{whiteSpace:"pre-wrap",background:"#FAF9F5",border:"1px solid #EEE8DC",borderRadius:8,padding:10,color:"#8A5A00",fontSize:12}}>{this.state.message}</pre>
          <button
            style={{width:"100%",border:0,borderRadius:10,background:"#7F77DD",color:"#fff",padding:"12px 14px",fontWeight:700,cursor:"pointer"}}
            onClick={()=>{localStorage.clear();location.reload();}}
          >
            Reset SellerFlowLive on this browser
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(<AppErrorBoundary><App /></AppErrorBoundary>);
