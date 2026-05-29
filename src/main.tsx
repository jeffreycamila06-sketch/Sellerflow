import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

// iOS HIG styling hook. Adds body.platform-ios when running on:
//   - Capacitor iOS app  (Capacitor.getPlatform() === "ios")
//   - Mac Safari Responsive Design Mode with ?ios=1 in URL (dev testing)
// Android, web (desktop), and regular iPhone Safari are unaffected: the
// class is never added, so the .platform-ios-scoped CSS rules in App.css
// don't match and apply nothing.
if (typeof window !== "undefined" && typeof document !== "undefined" && document.body) {
  const cap = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const forced = new URLSearchParams(window.location.search).has("ios");
  if (cap?.getPlatform?.() === "ios" || forced) {
    document.body.classList.add("platform-ios");
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
