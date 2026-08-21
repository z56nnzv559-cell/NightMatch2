import React, { useEffect, useState } from "react";
import LineLikeChat from "./LineLikeChat.jsx";

const C = { line: "#372E40", sub: "#A99CB0", gold: "#E2B968" };

async function api(path) {
  const response = await fetch(path, { credentials: "same-origin" });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) throw new Error(body.error || `request_failed_${response.status}`);
  return body;
}

function Icon({ name }) {
  if (name === "search") return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>;
  if (name === "chat") return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5h16v11H9l-5 3v-14Z"/><path d="M8 9h8M8 12.5h6"/></svg>;
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4.5 21c.6-4.2 3-6.5 7.5-6.5s6.9 2.3 7.5 6.5"/></svg>;
}

function BottomButton({ icon, label, active, onClick }) {
  return <button type="button" onClick={onClick} className={`nm-bottom-button${active ? " active" : ""}`}><Icon name={icon}/><span>{label}</span></button>;
}

const css = `
[data-nightmatch-profile-launcher="1"]{display:none!important}
.nm-bottom-nav{position:fixed;z-index:190;left:0;right:0;bottom:0;height:calc(66px + env(safe-area-inset-bottom));padding:5px 18px env(safe-area-inset-bottom);box-sizing:border-box;display:grid;grid-template-columns:repeat(3,1fr);gap:4px;background:rgba(7,6,9,.97);border-top:1px solid ${C.line};backdrop-filter:blur(18px)}
.nm-bottom-button{border:0;background:transparent;color:${C.sub};display:grid;place-items:center;align-content:center;gap:2px;font-size:10px;min-width:0}.nm-bottom-button svg{width:27px;height:27px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.nm-bottom-button.active{color:${C.gold}}
@media(min-width:720px){.nm-bottom-nav{left:50%;right:auto;width:520px;transform:translateX(-50%);border:1px solid ${C.line};border-bottom:0;border-radius:18px 18px 0 0}}
`;

export default function BottomNavigation() {
  const [session, setSession] = useState(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [active, setActive] = useState("search");

  useEffect(() => {
    let cancelled = false;
    const load = () => api("/api/me").then((me) => { if (!cancelled) setSession(me?.session || null); }).catch(() => { if (!cancelled) setSession(null); });
    load();
    const timer = setInterval(load, 2500);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  useEffect(() => {
    if (!session) return undefined;
    const old = document.body.style.paddingBottom;
    document.body.style.paddingBottom = "calc(76px + env(safe-area-inset-bottom))";
    return () => { document.body.style.paddingBottom = old; };
  }, [session]);

  if (!session) return null;

  const closeChat = () => {
    setChatOpen(false);
    setActive("search");
  };

  const goSearch = () => {
    closeChat();
    const marketplace = document.querySelector('section[data-nightmatch-gallery-v2],section[data-nightmatch-gallery]');
    if (marketplace) marketplace.scrollIntoView({ behavior: "smooth", block: "start" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const goProfile = () => {
    setChatOpen(false);
    setActive("profile");
    const launcher = document.querySelector('[data-nightmatch-profile-launcher="1"]');
    if (launcher) launcher.click();
  };

  return <>
    <style>{css}</style>
    <nav className="nm-bottom-nav" aria-label="メインメニュー">
      <BottomButton icon="search" label={session.kind === "shop" ? "女性検索" : "求人検索"} active={active === "search"} onClick={goSearch}/>
      <BottomButton icon="chat" label="チャット" active={active === "chat"} onClick={() => { setActive("chat"); setChatOpen(true); }}/>
      <BottomButton icon="profile" label="プロフィール" active={active === "profile"} onClick={goProfile}/>
    </nav>
    {chatOpen && <LineLikeChat session={session} onClose={closeChat}/>} 
  </>;
}
