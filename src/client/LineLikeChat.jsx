import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

const C = {
  bg: "#100D14",
  surface: "#1B1620",
  surface2: "#241D2A",
  line: "#372E40",
  text: "#F4EEF6",
  sub: "#A99CB0",
  gold: "#E2B968",
  mint: "#7DD2BB",
  danger: "#E57D8B",
};

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(path, { credentials: "same-origin", ...options, headers });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) throw new Error(body.error || `request_failed_${response.status}`);
  return body;
}

function dateKey(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function dateLabel(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "今日";
  if (date.toDateString() === yesterday.toDateString()) return "昨日";
  return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric", weekday: "short" });
}

function listTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" });
}

function messageTime(timestamp) {
  if (!timestamp) return "";
  return new Date(timestamp).toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" });
}

function initialOf(name) {
  return String(name || "?").trim().slice(0, 1) || "?";
}

function TalkList({ deals, summaries, loading, error, onOpen, onClose }) {
  return <section className="nm-line-sheet" aria-label="トーク一覧">
    <header className="nm-line-list-header">
      <div>
        <div className="nm-line-kicker">NightMatch</div>
        <h2>トーク</h2>
      </div>
      <button type="button" className="nm-line-close" onClick={onClose} aria-label="チャットを閉じる">閉じる</button>
    </header>

    {loading && <div className="nm-line-notice">トークを読み込んでいます…</div>}
    {error && <div className="nm-line-notice danger">{error}</div>}
    {!loading && deals.length === 0 && (
      <div className="nm-line-empty">
        <div className="nm-line-empty-icon">💬</div>
        <strong>トークはまだありません</strong>
        <span>応募またはスカウトが始まると、ここに相手とのトークが表示されます。</span>
      </div>
    )}

    <div className="nm-line-talk-list">
      {deals.map((deal) => {
        const summary = summaries[deal.id] || {};
        return <button type="button" className="nm-line-talk-row" key={deal.id} onClick={() => onOpen(deal.id)}>
          <div className="nm-line-avatar">{initialOf(deal.counterpart_name)}</div>
          <div className="nm-line-talk-main">
            <div className="nm-line-talk-top">
              <strong>{deal.counterpart_name}</strong>
              <time>{listTime(summary.at || deal.updated_at || deal.created_at)}</time>
            </div>
            <div className="nm-line-talk-preview">{summary.body || `${deal.area || ""}${deal.area && deal.business_type ? " · " : ""}${deal.business_type || ""}` || "トークを開く"}</div>
          </div>
          <svg className="nm-line-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>
        </button>;
      })}
    </div>
  </section>;
}

function TalkRoom({ session, deal, initialMessages, onMessages, onBack, onClose }) {
  const [messages, setMessages] = useState(initialMessages || []);
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const scrollerRef = useRef(null);
  const textareaRef = useRef(null);
  const lastCountRef = useRef(0);

  useEffect(() => {
    setMessages(initialMessages || []);
  }, [deal.id]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api(`/api/deals/${encodeURIComponent(deal.id)}/messages`);
        if (cancelled) return;
        const rows = data.messages || [];
        setMessages(rows);
        onMessages(deal.id, rows);
        setError("");
      } catch (err) {
        if (!cancelled) setError(String(err.message || err));
      }
    };
    load();
    const timer = setInterval(load, 1600);
    return () => { cancelled = true; clearInterval(timer); };
  }, [deal.id, onMessages]);

  useEffect(() => {
    if (!scrollerRef.current) return;
    if (messages.length !== lastCountRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
      lastCountRef.current = messages.length;
    }
  }, [messages]);

  const send = async (event) => {
    event.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await api(`/api/deals/${encodeURIComponent(deal.id)}/messages`, {
        method: "POST",
        body: JSON.stringify({ body }),
      });
      setText("");
      if (textareaRef.current) textareaRef.current.focus();
      const data = await api(`/api/deals/${encodeURIComponent(deal.id)}/messages`);
      const rows = data.messages || [];
      setMessages(rows);
      onMessages(deal.id, rows);
      setError("");
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setSending(false);
    }
  };

  const rendered = [];
  let previousDate = "";
  messages.forEach((message, index) => {
    const key = dateKey(message.at);
    if (key && key !== previousDate) {
      rendered.push(<div className="nm-line-date" key={`date-${key}-${index}`}><span>{dateLabel(message.at)}</span></div>);
      previousDate = key;
    }
    const mine = String(message.from || "").startsWith(`${session.kind}:`);
    rendered.push(
      <div className={`nm-line-message-row ${mine ? "mine" : "theirs"}`} key={`${message.at || index}-${index}`}>
        {!mine && <div className="nm-line-message-avatar">{initialOf(deal.counterpart_name)}</div>}
        <div className="nm-line-message-stack">
          <div className="nm-line-bubble">{message.body}</div>
          <time>{messageTime(message.at)}</time>
        </div>
      </div>
    );
  });

  return <section className="nm-line-sheet nm-line-room" aria-label={`${deal.counterpart_name}とのトーク`}>
    <header className="nm-line-room-header">
      <button type="button" className="nm-line-back" onClick={onBack} aria-label="トーク一覧へ戻る">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>
      </button>
      <div className="nm-line-room-person">
        <strong>{deal.counterpart_name}</strong>
        <span>{deal.area}{deal.area && deal.business_type ? " · " : ""}{deal.business_type}</span>
      </div>
      <button type="button" className="nm-line-close" onClick={onClose} aria-label="チャットを閉じる">閉じる</button>
    </header>

    <div className="nm-line-messages" ref={scrollerRef}>
      {messages.length === 0 ? <div className="nm-line-room-empty">まだメッセージはありません。<br/>下の入力欄から最初のメッセージを送れます。</div> : rendered}
    </div>

    {error && <div className="nm-line-room-error">{error}</div>}

    <form className="nm-line-compose" onSubmit={send}>
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(event) => setText(event.target.value)}
        maxLength={2000}
        rows={1}
        placeholder="メッセージを入力"
      />
      <button type="submit" disabled={!text.trim() || sending} aria-label="送信">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 4 17 8-17 8 3-8-3-8Z"/><path d="M7 12h14"/></svg>
      </button>
    </form>
  </section>;
}

const css = `
.nm-line-backdrop{position:fixed;z-index:270;inset:0;background:rgba(0,0,0,.76);display:flex;align-items:flex-end;justify-content:center}
.nm-line-sheet{width:min(100%,720px);height:min(88vh,820px);background:${C.bg};color:${C.text};border:1px solid ${C.line};border-radius:22px 22px 0 0;box-sizing:border-box;display:flex;flex-direction:column;overflow:hidden}
.nm-line-list-header,.nm-line-room-header{min-height:66px;display:flex;align-items:center;border-bottom:1px solid ${C.line};background:rgba(16,13,20,.98);padding:10px 14px;box-sizing:border-box;flex-shrink:0}
.nm-line-list-header{justify-content:space-between}.nm-line-kicker{font-size:10px;color:${C.gold};letter-spacing:.05em}.nm-line-list-header h2{margin:1px 0 0;font-size:24px}.nm-line-close{border:0;background:transparent;color:${C.sub};font-size:13px;padding:8px}
.nm-line-notice{margin:12px;border:1px solid ${C.line};border-radius:13px;padding:12px;color:${C.sub};font-size:13px}.nm-line-notice.danger{border-color:${C.danger};color:${C.danger}}
.nm-line-empty{margin:auto;max-width:280px;text-align:center;display:grid;gap:8px;color:${C.sub};padding:28px}.nm-line-empty-icon{font-size:34px}.nm-line-empty strong{color:${C.text};font-size:15px}.nm-line-empty span{font-size:12px;line-height:1.65}
.nm-line-talk-list{overflow:auto;flex:1}.nm-line-talk-row{width:100%;border:0;border-bottom:1px solid ${C.line};background:transparent;color:${C.text};padding:11px 12px;display:grid;grid-template-columns:48px minmax(0,1fr) 18px;gap:11px;align-items:center;text-align:left}.nm-line-talk-row:active{background:${C.surface}}
.nm-line-avatar,.nm-line-message-avatar{border-radius:50%;display:grid;place-items:center;background:${C.surface2};color:${C.gold};font-weight:850;border:1px solid ${C.line};flex-shrink:0}.nm-line-avatar{width:48px;height:48px;font-size:18px}.nm-line-message-avatar{width:32px;height:32px;font-size:12px;margin-top:2px}
.nm-line-talk-main{min-width:0}.nm-line-talk-top{display:flex;justify-content:space-between;align-items:center;gap:10px}.nm-line-talk-top strong{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nm-line-talk-top time{font-size:10px;color:${C.sub};white-space:nowrap}.nm-line-talk-preview{margin-top:5px;font-size:12px;color:${C.sub};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nm-line-chevron{width:17px;height:17px;fill:none;stroke:${C.sub};stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.nm-line-room-header{display:grid;grid-template-columns:42px minmax(0,1fr) 48px;gap:5px}.nm-line-back{border:0;background:transparent;color:${C.text};width:40px;height:40px;display:grid;place-items:center}.nm-line-back svg{width:27px;height:27px;fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}.nm-line-room-person{text-align:center;min-width:0;display:grid;gap:2px}.nm-line-room-person strong{font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nm-line-room-person span{font-size:9px;color:${C.sub};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.nm-line-messages{flex:1;overflow:auto;padding:14px 10px 20px;background:${C.bg};display:flex;flex-direction:column;gap:7px;overscroll-behavior:contain}.nm-line-date{text-align:center;margin:7px 0}.nm-line-date span{display:inline-block;background:${C.surface2};color:${C.sub};font-size:9px;padding:4px 9px;border-radius:999px}.nm-line-message-row{display:flex;align-items:flex-end;gap:7px;max-width:88%}.nm-line-message-row.mine{align-self:flex-end;justify-content:flex-end}.nm-line-message-row.theirs{align-self:flex-start}.nm-line-message-stack{display:grid;gap:2px;min-width:0}.nm-line-message-row.mine .nm-line-message-stack{justify-items:end}.nm-line-message-row.theirs .nm-line-message-stack{justify-items:start}.nm-line-bubble{padding:9px 12px;border-radius:17px;font-size:14px;line-height:1.5;word-break:break-word;white-space:pre-wrap}.nm-line-message-row.mine .nm-line-bubble{background:${C.mint};color:#151018;border-bottom-right-radius:5px}.nm-line-message-row.theirs .nm-line-bubble{background:${C.surface2};color:${C.text};border-bottom-left-radius:5px}.nm-line-message-stack time{font-size:8px;color:${C.sub};padding:0 3px}.nm-line-room-empty{margin:auto;text-align:center;color:${C.sub};font-size:12px;line-height:1.7}.nm-line-room-error{padding:7px 12px;color:${C.danger};font-size:10px;text-align:center;background:rgba(229,125,139,.08)}
.nm-line-compose{display:grid;grid-template-columns:minmax(0,1fr) 42px;gap:8px;align-items:end;border-top:1px solid ${C.line};padding:9px 10px calc(9px + env(safe-area-inset-bottom));background:${C.surface};flex-shrink:0}.nm-line-compose textarea{width:100%;box-sizing:border-box;max-height:100px;resize:none;border:1px solid ${C.line};background:${C.surface2};color:${C.text};border-radius:20px;padding:10px 13px;font:inherit;font-size:14px;line-height:1.4;outline:none}.nm-line-compose button{width:40px;height:40px;border:0;border-radius:50%;display:grid;place-items:center;background:${C.gold};color:#151018}.nm-line-compose button:disabled{opacity:.35}.nm-line-compose button svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
@media(min-width:720px){.nm-line-backdrop{align-items:center;padding:20px}.nm-line-sheet{height:min(80vh,760px);border-radius:22px}}
`;

export default function LineLikeChat({ session, onClose }) {
  const [deals, setDeals] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [summaries, setSummaries] = useState({});
  const [messageCache, setMessageCache] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const selected = useMemo(() => deals.find((deal) => deal.id === selectedId) || null, [deals, selectedId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const data = await api("/api/deals");
        if (cancelled) return;
        const rows = data.deals || [];
        setDeals(rows);
        setLoading(false);
        setError("");

        const results = await Promise.allSettled(rows.map(async (deal) => {
          const history = await api(`/api/deals/${encodeURIComponent(deal.id)}/messages`);
          return { id: deal.id, messages: history.messages || [] };
        }));
        if (cancelled) return;
        const nextSummaries = {};
        const nextCache = {};
        for (const result of results) {
          if (result.status !== "fulfilled") continue;
          const { id, messages } = result.value;
          nextCache[id] = messages;
          const last = messages[messages.length - 1];
          if (last) nextSummaries[id] = { body: last.body, at: last.at };
        }
        setMessageCache((current) => ({ ...current, ...nextCache }));
        setSummaries((current) => ({ ...current, ...nextSummaries }));
      } catch (err) {
        if (!cancelled) {
          setLoading(false);
          setError(String(err.message || err));
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, []);

  const updateMessages = (dealId, messages) => {
    setMessageCache((current) => ({ ...current, [dealId]: messages }));
    const last = messages[messages.length - 1];
    if (last) setSummaries((current) => ({ ...current, [dealId]: { body: last.body, at: last.at } }));
  };

  return createPortal(<><style>{css}</style><div className="nm-line-backdrop" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    {selected ? (
      <TalkRoom
        session={session}
        deal={selected}
        initialMessages={messageCache[selected.id] || []}
        onMessages={updateMessages}
        onBack={() => setSelectedId("")}
        onClose={onClose}
      />
    ) : (
      <TalkList
        deals={deals}
        summaries={summaries}
        loading={loading}
        error={error}
        onOpen={setSelectedId}
        onClose={onClose}
      />
    )}
  </div></>, document.body);
}
