import React from "react";
import { createRoot } from "react-dom/client";
import App from "./AppV2.jsx";
import { startFallbackInbox } from "./fallback-notices";
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

/* Pushが届かなかった重要通知は、本人の連絡先を持たずに次回ログインで補う。 */
startFallbackInbox();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
