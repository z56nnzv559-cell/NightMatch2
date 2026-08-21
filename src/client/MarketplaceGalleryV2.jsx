import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

const TYPES = ["キャバクラ", "ラウンジ", "ガールズバー", "スナック", "コンカフェ"];
const PREFECTURES = [
  "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県",
  "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
  "新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県",
  "滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
  "鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県",
  "福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県",
];
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

function prefectureKey(value) {
  return String(value || "").replace(/(都|府|県)$/u, "");
}

function areaMatchesPrefecture(area, prefecture) {
  if (!prefecture) return true;
  const source = String(area || "").replace(/\s/g, "");
  const full = String(prefecture).replace(/\s/g, "");
  const key = prefectureKey(full);
  return source.includes(full) || source.startsWith(key) || source.includes(`${key}・`) || source.includes(`${key} `);
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
      node.dataset.nightmatchGalleryV2 = role;
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

const css = `
.nm2{color:${C.text};display:grid;gap:14px}.nm2-head{display:flex;justify-content:space-between;align-items:end;gap:12px}.nm2-head h2{margin:0;font-size:28px}.nm2-sub{margin-top:5px;color:${C.sub};font-size:12px}.nm2-count{color:${C.gold};font-size:16px;white-space:nowrap}
.nm2-filters{display:grid;grid-template-columns:1fr 1fr;gap:8px}.nm2-filters.three{grid-template-columns:1fr 1fr 1fr}.nm2-filter{display:grid;gap:5px}.nm2-filter span{font-size:11px;color:${C.sub}}.nm2-filter select{width:100%;box-sizing:border-box;border:1px solid ${C.line};background:${C.surface};color:${C.text};border-radius:13px;padding:12px 10px;font-size:14px;outline:none}
.nm2-people{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.nm2-person{position:relative;border:0;padding:0;overflow:hidden;background:${C.surface};border-radius:10px;aspect-ratio:.84;text-align:left;cursor:pointer;box-shadow:inset 0 0 0 1px ${C.line}}.nm2-person img{width:100%;height:100%;object-fit:cover;display:block}.nm2-placeholder{width:100%;height:100%;display:grid;place-items:center;background:radial-gradient(circle at 55% 28%,#4c3b59 0,#30263a 32%,#17121c 72%)}.nm2-placeholder span{width:72px;height:72px;border-radius:50%;display:grid;place-items:center;background:rgba(255,255,255,.08);color:rgba(255,255,255,.72);font-size:30px;font-weight:800}.nm2-shade{position:absolute;inset:auto 0 0;padding:48px 12px 11px;background:linear-gradient(transparent,rgba(6,5,8,.93))}.nm2-name{font-size:17px;font-weight:850;color:#fff}.nm2-meta{margin-top:4px;font-size:12px;color:rgba(255,255,255,.82);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.nm2-pay{position:absolute;top:9px;right:9px;padding:5px 8px;border-radius:999px;background:rgba(10,8,12,.68);color:${C.gold};font-size:11px;font-weight:800}
.nm2-notice{border:1px solid ${C.gold};border-radius:13px;padding:11px 13px;color:${C.gold};font-size:13px;line-height:1.6}.nm2-notice.danger{border-color:${C.danger};color:${C.danger}}
.nm2-jobs{display:grid;gap:11px;grid-template-columns:repeat(auto-fit,minmax(250px,1fr))}.nm2-job{border:1px solid ${C.line};border-radius:17px;background:${C.surface};padding:15px}.nm2-tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.nm2-tag{border:1px solid ${C.line};border-radius:999px;padding:5px 9px;color:${C.sub};font-size:11px}.nm2-btn{border:0;border-radius:13px;padding:13px 14px;font-size:15px;font-weight:850;background:${C.mint};color:#151018}.nm2-btn.secondary{background:${C.surface2};color:${C.text}}.nm2-btn:disabled{opacity:.45}
.nm2-backdrop{position:fixed;inset:0;z-index:350;background:rgba(0,0,0,.74);display:flex;align-items:flex-end;justify-content:center}.nm2-modal{width:min(100%,620px);max-height:88vh;overflow:auto;border-radius:22px 22px 0 0;background:#16121b;border:1px solid ${C.line};padding:16px 16px calc(22px + env(safe-area-inset-bottom));box-sizing:border-box}.nm2-modal-photo{width:100%;aspect-ratio:1.35;object-fit:cover;border-radius:16px;background:${C.surface2}}.nm2-modal-placeholder{width:100%;aspect-ratio:1.35;border-radius:16px;display:grid;place-items:center;background:radial-gradient(circle at 55% 25%,#4c3b59 0,#30263a 32%,#17121c 72%);color:${C.sub}}.nm2-modal-top{margin-top:14px;display:flex;justify-content:space-between;gap:12px}.nm2-modal-name{font-size:23px;font-weight:850}.nm2-modal-pay{color:${C.gold};font-size:16px;font-weight:800;white-space:nowrap}.nm2-bio{margin-top:13px;color:#ddd4e1;font-size:13px;line-height:1.7}.nm2-actions{display:grid;gap:9px;margin-top:16px}.nm2-scout{margin-top:14px;display:grid;gap:10px;padding:13px;border-radius:15px;border:1px solid ${C.line};background:${C.surface}}.nm2-scout select,.nm2-scout textarea{width:100%;box-sizing:border-box;border:1px solid ${C.line};background:${C.surface2};color:${C.text};border-radius:11px;padding:11px;font-size:14px}
@media(max-width:430px){.nm2-filters.three{grid-template-columns:1fr 1fr}.nm2-filters.three .nm2-filter:last-child{grid-column:1/-1}}@media(min-width:720px){.nm2-people{grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.nm2-backdrop{align-items:center;padding:24px}.nm2-modal{border-radius:22px;max-height:90vh}.nm2-filters{max-width:760px}}
`;

function PrefectureSelect({ value, onChange }) {
  return <div className="nm2-filter"><span>都道府県</span><select value={value} onChange={onChange}><option value="">すべての都道府県</option>{PREFECTURES.map((p)=><option key={p} value={p}>{p}</option>)}</select></div>;
}

function TypeSelect({ value, onChange }) {
  return <div className="nm2-filter"><span>業種</span><select value={value} onChange={onChange}><option value="">すべての業種</option>{TYPES.map((t)=><option key={t} value={t}>{t}</option>)}</select></div>;
}

function WorkerPanel() {
  const target = useMarketplaceMount("worker");
  const [jobs, setJobs] = useState([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [prefecture, setPrefecture] = useState("");
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
      return areaMatchesPrefecture(job.area, prefecture);
    });
  }, [jobs, prefecture]);

  const apply = async (jobId) => {
    const trialDate = prompt("希望する体入日があれば YYYY-MM-DD で入力してください（未定なら空欄）");
    try { await api("/api/deals/apply", { method: "POST", body: JSON.stringify({ jobId, trialDate: trialDate || undefined }) }); alert("応募しました。店舗からの返信をお待ちください。"); }
    catch (err) { alert(`応募できませんでした: ${err.message}`); }
  };

  if (!target) return null;
  return createPortal(<><style>{css}</style><div className="nm2">
    <div className="nm2-head"><div><h2>求人を探す</h2><div className="nm2-sub">都道府県と業種をそれぞれ指定して探せます</div></div><div className="nm2-count">{displayJobs.length}件</div></div>
    <div className="nm2-filters three"><PrefectureSelect value={prefecture} onChange={(e)=>setPrefecture(e.target.value)}/><TypeSelect value={type} onChange={(e)=>setType(e.target.value)}/><div className="nm2-filter"><span>並び順</span><select value={sort} onChange={(e)=>setSort(e.target.value)}><option value="new">新着順</option><option value="pay">時給順</option><option value="trial">体入支給順</option></select></div></div>
    {loading && <div className="nm2-notice">求人を読み込んでいます…</div>}
    {error && <div className="nm2-notice danger">求人一覧を取得できませんでした：{error}</div>}
    {!loading && !error && displayJobs.length===0 && <div className="nm2-notice">選択した都道府県・業種に一致する求人はありません。</div>}
    <div className="nm2-jobs">{displayJobs.map((job)=><div className="nm2-job" key={job.id}><div style={{fontSize:19,fontWeight:850}}>{job.shop_name}</div><div style={{marginTop:4,color:C.sub,fontSize:12}}>{job.area} · {job.business_type}</div><div style={{marginTop:12,color:C.gold,fontSize:24,fontWeight:850}}>{yen(job.trial_pay)} <span style={{fontSize:11,color:C.sub,fontWeight:400}}>体入支給</span></div><div style={{marginTop:4}}>時給 {yen(job.hourly_min)}〜{yen(job.hourly_max)}</div><div className="nm2-tags">{list(job.perks).map((p)=><span className="nm2-tag" key={p}>{p}</span>)}</div><button className="nm2-btn" style={{width:"100%",marginTop:13}} onClick={()=>apply(job.id)}>この求人に応募</button></div>)}</div>
  </div></>, target);
}

function ShopPanel() {
  const target = useMarketplaceMount("shop");
  const [workers, setWorkers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [workerError, setWorkerError] = useState("");
  const [jobError, setJobError] = useState("");
  const [loading, setLoading] = useState(true);
  const [prefecture, setPrefecture] = useState("");
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

  const openJobs = jobs.filter((j)=>j.is_open);
  const visible = useMemo(() => workers.filter((w) => {
    const areaOk = !prefecture || (w.hopeAreas || []).some((area)=>areaMatchesPrefecture(area, prefecture));
    const typeOk = !type || (w.hopeTypes || []).includes(type);
    return areaOk && typeOk;
  }), [workers, prefecture, type]);

  const closeDetail = () => { setSelected(null); setScout(null); };
  const beginScout = () => {
    if (!selected || !openJobs.length) return;
    setScout({ workerId:selected.id, jobId:openJobs[0].id, message:"" });
  };
  const sendScout = async () => {
    if (!scout?.workerId || !scout?.jobId || !scout?.message?.trim()) return;
    try { await api("/api/deals/scout", { method:"POST", body:JSON.stringify(scout) }); alert("スカウトを送りました"); closeDetail(); }
    catch (err) { alert(`スカウトできませんでした: ${err.message}`); }
  };

  if (!target) return null;
  return createPortal(<><style>{css}</style><div className="nm2">
    <div className="nm2-head"><div><h2>女性を探す</h2><div className="nm2-sub">都道府県と希望業種をそれぞれ指定できます</div></div><div className="nm2-count">{visible.length}人</div></div>
    <div className="nm2-filters"><PrefectureSelect value={prefecture} onChange={(e)=>setPrefecture(e.target.value)}/><TypeSelect value={type} onChange={(e)=>setType(e.target.value)}/></div>
    {openJobs.length===0 && !jobError && <div className="nm2-notice">一覧は閲覧できます。スカウトするには求人を1件掲載してください。</div>}
    {loading && <div className="nm2-notice">女性プロフィールを読み込んでいます…</div>}
    {workerError && <div className="nm2-notice danger">女性一覧を取得できませんでした：{workerError}</div>}
    {jobError && <div className="nm2-notice danger">自店求人を取得できませんでした：{jobError}</div>}
    {!loading && !workerError && visible.length===0 && <div className="nm2-notice">選択した都道府県・業種に一致する女性はいません。</div>}
    <div className="nm2-people">{visible.map((w)=>{const area=(w.hopeAreas||[])[0]||"エリア相談";return <button className="nm2-person" key={w.id} onClick={()=>{setSelected(w);setScout(null)}}>
      {w.photoUrl?<img src={w.photoUrl} alt=""/>:<div className="nm2-placeholder"><span>{String(w.nickname||"?").slice(0,1)}</span></div>}
      <div className="nm2-pay">{w.hopeHourly?`${yen(w.hopeHourly)}/h`:"時給相談"}</div><div className="nm2-shade"><div className="nm2-name">{w.nickname}</div><div className="nm2-meta">{area} / {w.age??"?"}歳</div></div>
    </button>})}</div>
    {selected && <div className="nm2-backdrop" onClick={(e)=>{if(e.target===e.currentTarget)closeDetail()}}><div className="nm2-modal">
      {selected.photoUrl?<img className="nm2-modal-photo" src={selected.photoUrl} alt=""/>:<div className="nm2-modal-placeholder">写真は非公開</div>}
      <div className="nm2-modal-top"><div><div className="nm2-modal-name">{selected.nickname} · {selected.age??"?"}歳</div><div style={{marginTop:4,color:C.sub,fontSize:13}}>{(selected.hopeAreas||[]).join(" / ")||"エリア相談"}</div></div><div className="nm2-modal-pay">{selected.hopeHourly?`${yen(selected.hopeHourly)}/h`:"応相談"}</div></div>
      <div className="nm2-tags">{(selected.hopeTypes||[]).map((t)=><span className="nm2-tag" key={t}>{t}</span>)}</div><div style={{marginTop:11,color:C.sub,fontSize:13}}>出勤希望：{(selected.availableDays||[]).join("・")||"相談"}</div>{selected.bio&&<div className="nm2-bio">{selected.bio}</div>}
      {!scout?<div className="nm2-actions"><button className="nm2-btn" disabled={!openJobs.length} onClick={beginScout}>この女性にスカウト</button><button className="nm2-btn secondary" onClick={closeDetail}>閉じる</button></div>:<div className="nm2-scout"><div style={{fontWeight:800}}>スカウトを送る</div><select value={scout.jobId} onChange={(e)=>setScout({...scout,jobId:e.target.value})}>{openJobs.map((j)=><option key={j.id} value={j.id}>{j.area} · {j.business_type} · {yen(j.hourly_max)}</option>)}</select><textarea rows={4} value={scout.message} onChange={(e)=>setScout({...scout,message:e.target.value})} placeholder="体入条件や希望日などを入力"/><button className="nm2-btn" disabled={!scout.message.trim()} onClick={sendScout}>スカウトを送信</button><button className="nm2-btn secondary" onClick={()=>setScout(null)}>戻る</button></div>}
    </div></div>}
  </div></>, target);
}

export default function MarketplaceGalleryV2() {
  const [me, setMe] = useState(null);
  useEffect(()=>{
    let cancelled=false;
    const load=()=>api("/api/me").then((value)=>{if(!cancelled)setMe(value)}).catch(()=>{if(!cancelled)setMe(null)});
    const onClick=(event)=>{const button=event.target?.closest?.("button");if(button&&String(button.textContent||"").includes("ログアウト"))setMe(null)};
    load();
    const onFocus=()=>load();
    window.addEventListener("focus",onFocus);window.addEventListener("pageshow",onFocus);document.addEventListener("click",onClick,true);
    const timer=setInterval(load,1500);
    return()=>{cancelled=true;clearInterval(timer);window.removeEventListener("focus",onFocus);window.removeEventListener("pageshow",onFocus);document.removeEventListener("click",onClick,true)};
  },[]);
  if(!me?.session)return null;
  if(me.session.kind==="worker")return me.ageVerified?<WorkerPanel/>:null;
  return me.verified?<ShopPanel/>:null;
}
