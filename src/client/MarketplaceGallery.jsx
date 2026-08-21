import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const TYPES = ["キャバクラ", "ラウンジ", "ガールズバー", "スナック", "コンカフェ"];
const C = { surface: "#1B1620", surface2: "#241D2A", line: "#372E40", text: "#F4EEF6", sub: "#A99CB0", gold: "#E2B968", mint: "#7DD2BB", danger: "#E57D8B" };
const yen = (n) => `¥${Number(n || 0).toLocaleString("ja-JP")}`;

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has("content-type")) headers.set("content-type", "application/json");
  const res = await fetch(path, { credentials: "same-origin", ...options, headers });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  if (!res.ok) throw new Error(body.error || `request_failed_${res.status}`);
  return body;
}

function list(value) {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

function useMarketplaceMount(role) {
  const [target, setTarget] = useState(null);
  useEffect(() => {
    let cancelled = false;
    let node = null;
    let oldSection = null;
    const place = () => {
      if (cancelled || node?.isConnected) return;
      const main = document.querySelector("main");
      if (!main) return;
      const wanted = role === "shop" ? "女性を探す" : "求人を探す";
      oldSection = Array.from(main.querySelectorAll("section")).find((section) => String(section.querySelector("h2")?.textContent || "").includes(wanted)) || null;
      node = document.createElement("section");
      node.dataset.nightmatchGallery = role;
      if (oldSection) {
        oldSection.style.display = "none";
        main.insertBefore(node, oldSection);
      } else {
        main.prepend(node);
      }
      setTarget(node);
    };
    place();
    const observer = new MutationObserver(place);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelled = true;
      observer.disconnect();
      if (oldSection) oldSection.style.display = "";
      node?.remove();
    };
  }, [role]);
  return target;
}

const galleryCss = `
.nm-gallery { color:${C.text}; display:grid; gap:14px; }
.nm-gallery-head { display:flex; align-items:end; justify-content:space-between; gap:12px; }
.nm-gallery-head h2 { margin:0; font-size:28px; letter-spacing:.01em; }
.nm-gallery-sub { margin-top:5px; color:${C.sub}; font-size:12px; }
.nm-gallery-count { color:${C.gold}; font-size:16px; white-space:nowrap; }
.nm-filter { display:grid; grid-template-columns:minmax(0,1.3fr) minmax(120px,.7fr); gap:9px; }
.nm-filter input,.nm-filter select { width:100%; box-sizing:border-box; border:1px solid ${C.line}; background:${C.surface}; color:${C.text}; border-radius:13px; padding:12px; font-size:14px; outline:none; }
.nm-people-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7px; }
.nm-person { position:relative; border:0; padding:0; overflow:hidden; background:${C.surface}; border-radius:10px; aspect-ratio: .84; text-align:left; cursor:pointer; box-shadow:inset 0 0 0 1px ${C.line}; }
.nm-person img { width:100%; height:100%; object-fit:cover; display:block; }
.nm-person-placeholder { width:100%; height:100%; display:grid; place-items:center; background:radial-gradient(circle at 55% 28%, #4c3b59 0, #30263a 32%, #17121c 72%); }
.nm-person-placeholder span { width:72px; height:72px; border-radius:50%; display:grid; place-items:center; background:rgba(255,255,255,.08); color:rgba(255,255,255,.72); font-size:30px; font-weight:800; }
.nm-person-shade { position:absolute; inset:auto 0 0; padding:48px 12px 11px; background:linear-gradient(transparent,rgba(6,5,8,.93)); }
.nm-person-name { font-size:17px; font-weight:850; color:#fff; line-height:1.2; }
.nm-person-meta { margin-top:4px; font-size:12px; color:rgba(255,255,255,.82); line-height:1.35; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.nm-person-pay { position:absolute; top:9px; right:9px; padding:5px 8px; border-radius:999px; background:rgba(10,8,12,.68); backdrop-filter:blur(8px); color:${C.gold}; font-size:11px; font-weight:800; }
.nm-notice { border:1px solid ${C.gold}; border-radius:13px; padding:11px 13px; color:${C.gold}; font-size:13px; line-height:1.6; }
.nm-notice.danger { border-color:${C.danger}; color:${C.danger}; }
.nm-modal-backdrop { position:fixed; inset:0; z-index:350; background:rgba(0,0,0,.74); display:flex; align-items:flex-end; justify-content:center; padding:0; }
.nm-modal { width:min(100%,620px); max-height:88vh; overflow:auto; border-radius:22px 22px 0 0; background:#16121b; border:1px solid ${C.line}; color:${C.text}; padding:16px 16px calc(22px + env(safe-area-inset-bottom)); box-sizing:border-box; }
.nm-modal-photo { width:100%; aspect-ratio:1.35; object-fit:cover; border-radius:16px; background:${C.surface2}; }
.nm-modal-placeholder { width:100%; aspect-ratio:1.35; border-radius:16px; display:grid; place-items:center; background:radial-gradient(circle at 55% 25%, #4c3b59 0, #30263a 32%, #17121c 72%); color:${C.sub}; }
.nm-modal-top { margin-top:14px; display:flex; justify-content:space-between; gap:12px; align-items:start; }
.nm-modal-name { font-size:23px; font-weight:850; }
.nm-modal-pay { color:${C.gold}; font-size:16px; font-weight:800; white-space:nowrap; }
.nm-tags { display:flex; gap:6px; flex-wrap:wrap; margin-top:10px; }
.nm-tag { border:1px solid ${C.line}; border-radius:999px; padding:5px 9px; color:${C.sub}; font-size:11px; }
.nm-bio { margin-top:13px; color:#ddd4e1; font-size:13px; line-height:1.7; }
.nm-modal-actions { display:grid; gap:9px; margin-top:16px; }
.nm-btn { border:0; border-radius:13px; padding:13px 14px; font-size:15px; font-weight:850; background:${C.mint}; color:#151018; }
.nm-btn.secondary { background:${C.surface2}; color:${C.text}; }
.nm-btn:disabled { opacity:.45; }
.nm-scout-box { margin-top:14px; display:grid; gap:10px; padding:13px; border-radius:15px; border:1px solid ${C.line}; background:${C.surface}; }
.nm-scout-box select,.nm-scout-box textarea { width:100%; box-sizing:border-box; border:1px solid ${C.line}; background:${C.surface2}; color:${C.text}; border-radius:11px; padding:11px; font-size:14px; }
.nm-jobs { display:grid; gap:11px; grid-template-columns:repeat(auto-fit,minmax(250px,1fr)); }
.nm-job { border:1px solid ${C.line}; border-radius:17px; background:${C.surface}; padding:15px; }
@media (min-width:720px){ .nm-people-grid{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.nm-person{border-radius:12px}.nm-modal-backdrop{align-items:center;padding:24px}.nm-modal{border-radius:22px;max-height:90vh}.nm-filter{max-width:680px} }
`;

function WorkerPanel() {
  const target = useMarketplaceMount("worker");
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [type, setType] = useState("");
  const [sort, setSort] = useState("new");

  const load = async () => {
    setLoading(true); setError("");
    const q = new URLSearchParams({ sort, limit: "50" });
    if (type) q.set("type", type);
    try { const data = await api(`/api/jobs?${q.toString()}`); setJobs(data.jobs || []); }
    catch (err) { setError(String(err.message || err)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [type, sort]);

  const displayJobs = useMemo(() => {
    const seen = new Set();
    return jobs.filter((job) => {
      const key = String(job.shop_id || job.shop_name || job.id || "");
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [jobs]);

  const apply = async (jobId) => {
    const trialDate = prompt("希望する体入日があれば YYYY-MM-DD で入力してください（未定なら空欄）");
    try { await api("/api/deals/apply", { method: "POST", body: JSON.stringify({ jobId, trialDate: trialDate || undefined }) }); alert("応募しました。店舗からの返信をお待ちください。"); }
    catch (err) { alert(`応募できませんでした: ${err.message}`); }
  };

  if (!target) return null;
  return createPortal(<><style>{galleryCss}</style><div className="nm-gallery">
    <div className="nm-gallery-head"><div><h2>求人を探す</h2><div className="nm-gallery-sub">掲載中の店舗求人から探せます</div></div><div className="nm-gallery-count">{displayJobs.length}件</div></div>
    <div className="nm-filter"><select value={type} onChange={(e) => setType(e.target.value)}><option value="">すべての業種</option>{TYPES.map((t)=><option key={t}>{t}</option>)}</select><select value={sort} onChange={(e)=>setSort(e.target.value)}><option value="new">新着順</option><option value="pay">時給順</option><option value="trial">体入支給順</option></select></div>
    {loading && <div className="nm-notice">求人を読み込んでいます…</div>}
    {error && <div className="nm-notice danger">求人一覧を取得できませんでした：{error}</div>}
    <div className="nm-jobs">{displayJobs.map((job)=><div className="nm-job" key={job.id}><div style={{fontSize:19,fontWeight:850}}>{job.shop_name}</div><div style={{marginTop:4,color:C.sub,fontSize:12}}>{job.area} · {job.business_type}</div><div style={{marginTop:12,color:C.gold,fontSize:24,fontWeight:850}}>{yen(job.trial_pay)} <span style={{fontSize:11,color:C.sub,fontWeight:400}}>体入支給</span></div><div style={{marginTop:4}}>時給 {yen(job.hourly_min)}〜{yen(job.hourly_max)}</div><div className="nm-tags">{list(job.perks).map((p)=><span className="nm-tag" key={p}>{p}</span>)}</div><button className="nm-btn" style={{width:"100%",marginTop:13}} onClick={()=>apply(job.id)}>この求人に応募</button></div>)}</div>
  </div></>, target);
}

function ShopPanel() {
  const target = useMarketplaceMount("shop");
  const [workers, setWorkers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [workerError, setWorkerError] = useState("");
  const [jobError, setJobError] = useState("");
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [type, setType] = useState("");
  const [selected, setSelected] = useState(null);
  const [scout, setScout] = useState(null);

  const load = async () => {
    setLoading(true);
    const results = await Promise.allSettled([api("/api/workers?limit=50"), api("/api/shop/jobs")]);
    if (results[0].status === "fulfilled") { setWorkers(results[0].value.workers || []); setWorkerError(""); } else setWorkerError(String(results[0].reason?.message || results[0].reason));
    if (results[1].status === "fulfilled") { setJobs(results[1].value.jobs || []); setJobError(""); } else setJobError(String(results[1].reason?.message || results[1].reason));
    setLoading(false);
  };
  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    const timer = setInterval(load, 10000);
    return () => { clearInterval(timer); window.removeEventListener("focus", onFocus); window.removeEventListener("pageshow", onFocus); };
  }, []);

  const openJobs = jobs.filter((j) => j.is_open);
  const visible = useMemo(() => workers.filter((w) => {
    const q = search.trim().toLowerCase();
    const text = [w.nickname, ...(w.hopeAreas || []), ...(w.availableDays || []), w.bio || ""].join(" ").toLowerCase();
    return (!q || text.includes(q)) && (!type || (w.hopeTypes || []).includes(type));
  }), [workers, search, type]);

  const openDetail = (worker) => { setSelected(worker); setScout(null); };
  const closeDetail = () => { setSelected(null); setScout(null); };
  const beginScout = () => {
    if (!selected || !openJobs.length) return;
    setScout({ workerId: selected.id, jobId: openJobs[0].id, message: "" });
  };
  const sendScout = async () => {
    if (!scout?.workerId || !scout?.jobId || !scout?.message?.trim()) return;
    try { await api("/api/deals/scout", { method: "POST", body: JSON.stringify(scout) }); alert("スカウトを送りました"); closeDetail(); }
    catch (err) { alert(`スカウトできませんでした: ${err.message}`); }
  };

  if (!target) return null;
  return createPortal(<><style>{galleryCss}</style><div className="nm-gallery">
    <div className="nm-gallery-head"><div><h2>女性を探す</h2><div className="nm-gallery-sub">写真をタップしてプロフィールを確認できます</div></div><div className="nm-gallery-count">{visible.length}人</div></div>
    <div className="nm-filter"><input value={search} onChange={(e)=>setSearch(e.target.value)} placeholder="名前・エリア・曜日で検索"/><select value={type} onChange={(e)=>setType(e.target.value)}><option value="">すべての業種</option>{TYPES.map((t)=><option key={t}>{t}</option>)}</select></div>
    {openJobs.length === 0 && !jobError && <div className="nm-notice">一覧は閲覧できます。スカウトするには求人を1件掲載してください。</div>}
    {loading && <div className="nm-notice">女性プロフィールを読み込んでいます…</div>}
    {workerError && <div className="nm-notice danger">女性一覧を取得できませんでした：{workerError}</div>}
    {jobError && <div className="nm-notice danger">自店求人を取得できませんでした：{jobError}</div>}
    {!loading && !workerError && visible.length === 0 && <div className="nm-notice">条件に合う女性プロフィールはありません。</div>}

    <div className="nm-people-grid">
      {visible.map((w) => {
        const area = (w.hopeAreas || [])[0] || "エリア相談";
        return <button className="nm-person" key={w.id} onClick={()=>openDetail(w)} aria-label={`${w.nickname}のプロフィールを見る`}>
          {w.photoUrl ? <img src={w.photoUrl} alt=""/> : <div className="nm-person-placeholder"><span>{String(w.nickname || "?").slice(0,1)}</span></div>}
          <div className="nm-person-pay">{w.hopeHourly ? `${yen(w.hopeHourly)}/h` : "時給相談"}</div>
          <div className="nm-person-shade"><div className="nm-person-name">{w.nickname}</div><div className="nm-person-meta">{area} / {w.age ?? "?"}歳</div></div>
        </button>;
      })}
    </div>

    {selected && <div className="nm-modal-backdrop" onClick={(e)=>{ if(e.target===e.currentTarget) closeDetail(); }}>
      <div className="nm-modal">
        {selected.photoUrl ? <img className="nm-modal-photo" src={selected.photoUrl} alt=""/> : <div className="nm-modal-placeholder">写真は非公開</div>}
        <div className="nm-modal-top"><div><div className="nm-modal-name">{selected.nickname} · {selected.age ?? "?"}歳</div><div style={{marginTop:4,color:C.sub,fontSize:13}}>{(selected.hopeAreas || []).join(" / ") || "エリア相談"}</div></div><div className="nm-modal-pay">{selected.hopeHourly ? `${yen(selected.hopeHourly)}/h` : "応相談"}</div></div>
        <div className="nm-tags">{(selected.hopeTypes || []).map((t)=><span className="nm-tag" key={t}>{t}</span>)}</div>
        <div style={{marginTop:11,color:C.sub,fontSize:13}}>出勤希望：{(selected.availableDays || []).join("・") || "相談"}</div>
        {selected.bio && <div className="nm-bio">{selected.bio}</div>}
        {!scout && <div className="nm-modal-actions"><button className="nm-btn" disabled={!openJobs.length} onClick={beginScout}>この女性にスカウト</button><button className="nm-btn secondary" onClick={closeDetail}>閉じる</button></div>}
        {scout && <div className="nm-scout-box"><div style={{fontWeight:800}}>スカウトを送る</div><select value={scout.jobId} onChange={(e)=>setScout({...scout,jobId:e.target.value})}>{openJobs.map((j)=><option key={j.id} value={j.id}>{j.area} · {j.business_type} · {yen(j.hourly_max)}</option>)}</select><textarea rows={4} value={scout.message} onChange={(e)=>setScout({...scout,message:e.target.value})} placeholder="体入条件や希望日などを入力"/><button className="nm-btn" disabled={!scout.message.trim()} onClick={sendScout}>スカウトを送信</button><button className="nm-btn secondary" onClick={()=>setScout(null)}>戻る</button></div>}
      </div>
    </div>}
  </div></>, target);
}

export default function MarketplaceGallery() {
  const [me, setMe] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => api("/api/me").then((value)=>{ if(!cancelled) setMe(value); }).catch(()=>{ if(!cancelled) setMe(null); });
    const onClick = (event) => {
      const button = event.target?.closest?.("button");
      if (button && String(button.textContent || "").includes("ログアウト")) setMe(null);
    };
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    document.addEventListener("click", onClick, true);
    const timer = setInterval(load, 1500);
    return () => { cancelled=true; clearInterval(timer); window.removeEventListener("focus",onFocus); window.removeEventListener("pageshow",onFocus); document.removeEventListener("click",onClick,true); };
  }, []);
  if (!me?.session) return null;
  if (me.session.kind === "worker") return me.ageVerified ? <WorkerPanel/> : null;
  return me.verified ? <ShopPanel/> : null;
}
