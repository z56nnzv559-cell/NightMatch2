import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const C = { bg: "#100D14", surface: "#1B1620", surface2: "#241D2A", line: "#372E40", text: "#F4EEF6", sub: "#A99CB0", gold: "#E2B968", mint: "#7DD2BB", danger: "#E57D8B" };

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, { credentials: "same-origin", ...options, headers });
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

function ChatSheet({ session, onClose }) {
  const [deals, setDeals] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  const selected = useMemo(() => deals.find((deal) => deal.id === selectedId) || null, [deals, selectedId]);

  useEffect(() => {
    let cancelled = false;
    api("/api/deals").then((data) => {
      if (cancelled) return;
      const rows = data.deals || [];
      setDeals(rows);
      if (rows.length) setSelectedId(rows[0].id);
      setLoading(false);
    }).catch((err) => { if (!cancelled) { setError(String(err.message || err)); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!selectedId) { setMessages([]); return undefined; }
    let cancelled = false;
    const load = () => api(`/api/deals/${encodeURIComponent(selectedId)}/messages`).then((data) => {
      if (!cancelled) { setMessages(data.messages || []); setError(""); }
    }).catch((err) => { if (!cancelled) setError(String(err.message || err)); });
    load();
    const timer = setInterval(load, 2200);
    return () => { cancelled = true; clearInterval(timer); };
  }, [selectedId]);

  const send = async (event) => {
    event.preventDefault();
    const body = text.trim();
    if (!selectedId || !body || sending) return;
    setSending(true);
    try {
      await api(`/api/deals/${encodeURIComponent(selectedId)}/messages`, { method: "POST", body: JSON.stringify({ body }) });
      setText("");
      const data = await api(`/api/deals/${encodeURIComponent(selectedId)}/messages`);
      setMessages(data.messages || []);
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setSending(false);
    }
  };

  return createPortal(<div className="nm-chat-backdrop" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <section className="nm-chat-sheet" aria-label="チャット">
      <div className="nm-chat-header"><div><div className="nm-chat-kicker">NightMatch</div><h2>チャット</h2></div><button type="button" onClick={onClose}>閉じる</button></div>
      {loading && <div className="nm-chat-notice">チャットを読み込んでいます…</div>}
      {!loading && deals.length === 0 && <div className="nm-chat-notice">応募・スカウトが成立すると、ここに相手とのチャットが表示されます。</div>}
      {deals.length > 0 && <div className="nm-chat-layout">
        <div className="nm-chat-list">{deals.map((deal) => <button type="button" key={deal.id} className={deal.id === selectedId ? "selected" : ""} onClick={() => setSelectedId(deal.id)}><strong>{deal.counterpart_name}</strong><span>{deal.area} · {deal.business_type}</span></button>)}</div>
        {selected && <div className="nm-chat-room">
          <div className="nm-chat-room-title"><strong>{selected.counterpart_name}</strong><span>{selected.area} · {selected.business_type}</span></div>
          <div className="nm-messages">{messages.length === 0 ? <div className="nm-empty-message">まだメッセージはありません。</div> : messages.map((message, index) => {
            const mine = String(message.from || "").startsWith(`${session.kind}:`);
            return <div key={`${message.at || index}-${index}`} className={`nm-message ${mine ? "mine" : "theirs"}`}><div>{message.body}</div><time>{message.at ? new Date(message.at).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }) : ""}</time></div>;
          })}</div>
          <form className="nm-chat-compose" onSubmit={send}><textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} rows={2} placeholder="メッセージを入力"/><button type="submit" disabled={!text.trim() || sending}>{sending ? "送信中" : "送信"}</button></form>
        </div>}
      </div>}
      {error && <div className="nm-chat-error">{error}</div>}
    </section>
  </div>, document.body);
}

const css = `
[data-nightmatch-profile-launcher="1"]{display:none!important}
.nm-bottom-nav{position:fixed;z-index:190;left:0;right:0;bottom:0;height:calc(66px + env(safe-area-inset-bottom));padding:5px 18px env(safe-area-inset-bottom);box-sizing:border-box;display:grid;grid-template-columns:repeat(3,1fr);gap:4px;background:rgba(7,6,9,.97);border-top:1px solid ${C.line};backdrop-filter:blur(18px)}
.nm-bottom-button{border:0;background:transparent;color:${C.sub};display:grid;place-items:center;align-content:center;gap:2px;font-size:10px;min-width:0}.nm-bottom-button svg{width:27px;height:27px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}.nm-bottom-button.active{color:${C.gold}}
.nm-chat-backdrop{position:fixed;z-index:260;inset:0;background:rgba(0,0,0,.72);display:flex;align-items:flex-end;justify-content:center}.nm-chat-sheet{width:min(100%,720px);height:min(82vh,760px);background:${C.bg};color:${C.text};border:1px solid ${C.line};border-radius:22px 22px 0 0;padding:16px 14px calc(16px + env(safe-area-inset-bottom));box-sizing:border-box;display:flex;flex-direction:column;gap:12px}.nm-chat-header{display:flex;justify-content:space-between;align-items:center}.nm-chat-header h2{margin:1px 0 0;font-size:24px}.nm-chat-kicker{color:${C.gold};font-size:11px}.nm-chat-header button{border:0;background:transparent;color:${C.sub};font-size:13px}.nm-chat-notice,.nm-chat-error{border:1px solid ${C.line};border-radius:13px;padding:12px;color:${C.sub};font-size:13px}.nm-chat-error{border-color:${C.danger};color:${C.danger}}
.nm-chat-layout{display:grid;grid-template-columns:120px minmax(0,1fr);gap:9px;min-height:0;flex:1}.nm-chat-list{overflow:auto;display:grid;align-content:start;gap:6px}.nm-chat-list button{border:1px solid ${C.line};border-radius:12px;background:${C.surface};color:${C.text};padding:10px;text-align:left;display:grid;gap:4px}.nm-chat-list button.selected{border-color:${C.gold}}.nm-chat-list strong{font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nm-chat-list span{font-size:9px;color:${C.sub};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nm-chat-room{border:1px solid ${C.line};border-radius:15px;background:${C.surface};min-height:0;display:flex;flex-direction:column;overflow:hidden}.nm-chat-room-title{padding:11px 12px;border-bottom:1px solid ${C.line};display:grid;gap:2px}.nm-chat-room-title strong{font-size:14px}.nm-chat-room-title span{font-size:10px;color:${C.sub}}
.nm-messages{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:8px}.nm-empty-message{margin:auto;color:${C.sub};font-size:12px}.nm-message{max-width:82%;display:grid;gap:2px}.nm-message>div{padding:9px 11px;border-radius:14px;font-size:13px;line-height:1.5;word-break:break-word}.nm-message time{font-size:8px;color:${C.sub}}.nm-message.mine{align-self:flex-end;justify-items:end}.nm-message.mine>div{background:${C.mint};color:#151018;border-bottom-right-radius:4px}.nm-message.theirs{align-self:flex-start}.nm-message.theirs>div{background:${C.surface2};color:${C.text};border-bottom-left-radius:4px}.nm-chat-compose{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:7px;padding:9px;border-top:1px solid ${C.line}}.nm-chat-compose textarea{resize:none;border:1px solid ${C.line};background:${C.surface2};color:${C.text};border-radius:11px;padding:9px;font:inherit;font-size:13px;outline:none}.nm-chat-compose button{border:0;border-radius:11px;background:${C.gold};color:#151018;padding:0 13px;font-weight:800}.nm-chat-compose button:disabled{opacity:.45}
@media(min-width:720px){.nm-bottom-nav{left:50%;right:auto;width:520px;transform:translateX(-50%);border:1px solid ${C.line};border-bottom:0;border-radius:18px 18px 0 0}.nm-chat-backdrop{align-items:center;padding:20px}.nm-chat-sheet{border-radius:22px;height:min(78vh,720px)}.nm-chat-layout{grid-template-columns:190px minmax(0,1fr)}}
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

  const goSearch = () => {
    setChatOpen(false); setActive("search");
    const marketplace = document.querySelector('section[data-nightmatch-gallery-v2],section[data-nightmatch-gallery]');
    if (marketplace) marketplace.scrollIntoView({ behavior: "smooth", block: "start" });
    else window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const goProfile = () => {
    setChatOpen(false); setActive("profile");
    const launcher = document.querySelector('[data-nightmatch-profile-launcher="1"]');
    if (launcher) launcher.click();
  };

  return <><style>{css}</style><nav className="nm-bottom-nav" aria-label="メインメニュー">
    <BottomButton icon="search" label={session.kind === "shop" ? "女性検索" : "求人検索"} active={active === "search"} onClick={goSearch}/>
    <BottomButton icon="chat" label="チャット" active={active === "chat"} onClick={() => { setActive("chat"); setChatOpen(true); }}/>
    <BottomButton icon="profile" label="プロフィール" active={active === "profile"} onClick={goProfile}/>
  </nav>{chatOpen && <ChatSheet session={session} onClose={() => { setChatOpen(false); setActive("search"); }}/>}</>;
}
