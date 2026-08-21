import React from "react";
import { createRoot } from "react-dom/client";
import App from "./AppV2.jsx";
import DemoKycHelper from "./DemoKycHelper.jsx";
import FallbackInbox from "./FallbackInbox.jsx";
import ProfileEditor from "./ProfileEditor.jsx";
import JobFormFix from "./JobFormFix.jsx";
import MarketplaceGallery from "./MarketplaceGallery.jsx";
import "./styles.css";

/* 受信側が無いとWeb Pushが成功しても画面には何も出ない。
   登録だけは常に行い、通知権限の要求と購読作成は利用者の操作に任せる。 */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.error("NightMatch service worker registration failed", error);
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <FallbackInbox />
    <App />
    <ProfileEditor />
    <JobFormFix />
    <MarketplaceGallery />
    <DemoKycHelper />
  </React.StrictMode>
);
