import { Component, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";

class AppErrorBoundary extends Component<{children:ReactNode},{hasError:boolean;message:string}> {
  state={hasError:false,message:""};
  static getDerivedStateFromError(error:unknown){
    return {hasError:true,message:error instanceof Error?error.message:"SellerFlow could not load."};
  }
  render(){
    if(!this.state.hasError)return this.props.children;
    return (
      <div style={{minHeight:"100vh",display:"grid",placeItems:"center",background:"#F6F3ED",padding:20,fontFamily:"Arial, sans-serif"}}>
        <div style={{maxWidth:460,width:"100%",background:"#fff",border:"1px solid #E3DAC8",borderRadius:14,padding:22,boxShadow:"0 16px 40px rgba(38,33,92,.12)"}}>
          <h1 style={{margin:"0 0 8px",color:"#26215C",fontSize:24}}>SellerFlow needs refresh</h1>
          <p style={{color:"#666",lineHeight:1.5}}>Old saved browser data blocked this page from opening. Use the reset button below to clear only SellerFlow data on this browser, then sign in again.</p>
          <pre style={{whiteSpace:"pre-wrap",background:"#FAF9F5",border:"1px solid #EEE8DC",borderRadius:8,padding:10,color:"#8A5A00",fontSize:12}}>{this.state.message}</pre>
          <button
            style={{width:"100%",border:0,borderRadius:10,background:"#7F77DD",color:"#fff",padding:"12px 14px",fontWeight:700,cursor:"pointer"}}
            onClick={()=>{localStorage.clear();location.reload();}}
          >
            Reset SellerFlow on this browser
          </button>
        </div>
      </div>
    );
  }
}

createRoot(document.getElementById("root")!).render(<AppErrorBoundary><App /></AppErrorBoundary>);
