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

function Card({ children }) {
  return <div style={{ border: `1px solid ${C.line}`, background: C.surface, borderRadius: 18, padding: 16 }}>{children}</div>;
}

function Notice({ children, danger = false }) {
  return <div style={{ border: `1px solid ${danger ? C.danger : C.gold}`, color: danger ? C.danger : C.gold, borderRadius: 14, padding: "11px 13px", fontSize: 14, lineHeight: 1.7 }}>{children}</div>;
}

function inputStyle() {
  return { width: "100%", boxSizing: "border-box", border: `1px solid ${C.line}`, background: C.surface2, color: C.text, borderRadius: 12, padding: "11px 12px", fontSize: 15, outline: "none" };
}

function Label({ title, children }) {
  return <label style={{ display: "grid", gap: 6, color: C.sub, fontSize: 12 }}><span>{title}</span>{children}</label>;
}

function Action({ children, disabled, onClick, secondary = false }) {
  return <button type="button" disabled={disabled} onClick={onClick} style={{ border: 0, borderRadius: 12, padding: "11px 14px", fontSize: 14, fontWeight: 700, background: secondary ? C.surface2 : C.mint, color: secondary ? C.text : "#151018", opacity: disabled ? .45 : 1 }}>{children}</button>;
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
      node.dataset.nightmatchMarketplaceReview = role;
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

  const apply = async (jobId) => {
    const trialDate = prompt("希望する体入日があれば YYYY-MM-DD で入力してください（未定なら空欄）");
    try { await api("/api/deals/apply", { method: "POST", body: JSON.stringify({ jobId, trialDate: trialDate || undefined }) }); alert("応募しました。店舗からの返信をお待ちください。"); }
    catch (err) { alert(`応募できませんでした: ${err.message}`); }
  };

  if (!target) return null;
  return createPortal(
    <div style={{ display: "grid", gap: 12, color: C.text }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12 }}><div><h2 style={{ margin: 0, fontSize: 24 }}>求人を探す</h2><div style={{ marginTop: 4, color: C.sub, fontSize: 12 }}>掲載中の店舗求人を一覧表示しています</div></div><div style={{ color: C.gold, fontSize: 14 }}>{jobs.length}件</div></div>
      <Card><div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}><Label title="業種"><select value={type} onChange={(e) => setType(e.target.value)} style={inputStyle()}><option value="">すべて</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></Label><Label title="並び順"><select value={sort} onChange={(e) => setSort(e.target.value)} style={inputStyle()}><option value="new">新着順</option><option value="pay">時給が高い順</option><option value="trial">体入支給額が高い順</option></select></Label></div></Card>
      {loading && <Notice>求人を読み込んでいます…</Notice>}
      {error && <Notice danger>求人一覧を取得できませんでした：{error}</Notice>}
      {!loading && !error && jobs.length === 0 && <Notice>現在この条件で掲載中の求人はありません。業種を「すべて」にすると見つかる場合があります。</Notice>}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))" }}>
        {jobs.map((job) => <Card key={job.id}><div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}><div><div style={{ fontSize: 18, fontWeight: 750 }}>{job.shop_name}</div><div style={{ marginTop: 4, color: C.sub, fontSize: 12 }}>{job.area} · {job.business_type}{job.station ? ` · ${job.station}` : ""}</div></div>{job.verified_at && <span style={{ color: C.mint, fontSize: 11 }}>確認済み</span>}</div><div style={{ marginTop: 14, color: C.gold, fontSize: 24, fontWeight: 750 }}>{yen(job.trial_pay)} <span style={{ color: C.sub, fontSize: 11, fontWeight: 400 }}>体入支給</span></div><div style={{ marginTop: 4, fontSize: 14 }}>時給 {yen(job.hourly_min)}〜{yen(job.hourly_max)}</div>{job.hours && <div style={{ marginTop: 4, color: C.sub, fontSize: 12 }}>勤務時間 {job.hours}</div>}<div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 10 }}>{list(job.perks).map((p) => <span key={p} style={{ border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 8px", color: C.sub, fontSize: 10 }}>{p}</span>)}</div><div style={{ marginTop: 12 }}><Action onClick={() => apply(job.id)}>この求人に応募する</Action></div></Card>)}
      </div>
    </div>,
    target
  );
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

  const sendScout = async () => {
    if (!scout?.workerId || !scout?.jobId || !scout?.message?.trim()) return;
    try { await api("/api/deals/scout", { method: "POST", body: JSON.stringify(scout) }); setScout(null); alert("スカウトを送りました"); }
    catch (err) { alert(`スカウトできませんでした: ${err.message}`); }
  };

  if (!target) return null;
  return createPortal(
    <div style={{ display: "grid", gap: 12, color: C.text }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 12 }}><div><h2 style={{ margin: 0, fontSize: 24 }}>女性を探す</h2><div style={{ marginTop: 4, color: C.sub, fontSize: 12 }}>年齢確認済みで公開可能な登録者を表示しています</div></div><div style={{ color: C.gold, fontSize: 14 }}>{visible.length}人</div></div>
      {openJobs.length === 0 && !jobError && <Notice>女性一覧は確認できます。スカウトを送るには、先に求人を1件以上掲載してください。</Notice>}
      <Card><div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}><Label title="名前・エリア・曜日で検索"><input value={search} onChange={(e) => setSearch(e.target.value)} style={inputStyle()} placeholder="例：中洲 / 金曜" /></Label><Label title="希望業種"><select value={type} onChange={(e) => setType(e.target.value)} style={inputStyle()}><option value="">すべて</option>{TYPES.map((t) => <option key={t}>{t}</option>)}</select></Label></div></Card>
      {loading && <Notice>女性プロフィールを読み込んでいます…</Notice>}
      {workerError && <Notice danger>女性一覧を取得できませんでした：{workerError}</Notice>}
      {jobError && <Notice danger>自店求人を取得できませんでした：{jobError}</Notice>}
      {!loading && !workerError && visible.length === 0 && <Notice>現在、条件に合う年齢確認済みの女性プロフィールはありません。女性登録があっても年齢確認前のアカウントは店舗側には表示されません。</Notice>}
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
        {visible.map((w) => <Card key={w.id}>{w.photoUrl ? <img src={w.photoUrl} alt="" style={{ width: "100%", aspectRatio: "4/3", objectFit: "cover", borderRadius: 12, marginBottom: 10 }} /> : <div style={{ width: "100%", aspectRatio: "4/3", display: "grid", placeItems: "center", background: C.surface2, color: C.sub, borderRadius: 12, marginBottom: 10 }}>写真は非公開</div>}<div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}><div><div style={{ fontWeight: 750 }}>{w.nickname} · {w.age}歳</div><div style={{ marginTop: 3, color: C.sub, fontSize: 12 }}>{(w.hopeAreas || []).join(" / ") || "エリア相談"}</div></div><div style={{ color: C.gold, fontWeight: 700, fontSize: 13 }}>{w.hopeHourly ? `${yen(w.hopeHourly)}/h` : "応相談"}</div></div><div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 8 }}>{(w.hopeTypes || []).map((t) => <span key={t} style={{ border: `1px solid ${C.line}`, borderRadius: 999, padding: "4px 8px", color: C.sub, fontSize: 10 }}>{t}</span>)}</div><div style={{ marginTop: 8, color: C.sub, fontSize: 12 }}>出勤希望：{(w.availableDays || []).join("・") || "相談"}</div>{w.bio && <div style={{ marginTop: 8, fontSize: 13, lineHeight: 1.6 }}>{w.bio}</div>}<div style={{ marginTop: 12 }}><Action disabled={!openJobs.length} onClick={() => setScout({ workerId: w.id, jobId: openJobs[0]?.id || "", message: "" })}>この女性にスカウト</Action></div></Card>)}
      </div>
      {scout && <Card><div style={{ display: "grid", gap: 10 }}><div style={{ fontWeight: 750 }}>スカウトを送る</div><Label title="送る求人"><select value={scout.jobId} onChange={(e) => setScout({ ...scout, jobId: e.target.value })} style={inputStyle()}>{openJobs.map((j) => <option key={j.id} value={j.id}>{j.area} · {j.business_type} · {yen(j.hourly_max)}</option>)}</select></Label><Label title="メッセージ"><textarea rows={4} value={scout.message} onChange={(e) => setScout({ ...scout, message: e.target.value })} style={inputStyle()} placeholder="体入条件や希望日などを入力" /></Label><div style={{ display: "flex", gap: 8 }}><Action disabled={!scout.message.trim()} onClick={sendScout}>送信</Action><Action secondary onClick={() => setScout(null)}>閉じる</Action></div></div></Card>}
    </div>,
    target
  );
}

export default function MarketplaceReview() {
  const [me, setMe] = useState(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => api("/api/me").then((value) => { if (!cancelled) setMe(value); }).catch(() => {});
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    return () => { cancelled = true; window.removeEventListener("focus", onFocus); window.removeEventListener("pageshow", onFocus); };
  }, []);
  if (!me?.session) return null;
  if (me.session.kind === "worker") return me.ageVerified ? <WorkerPanel /> : null;
  return me.verified ? <ShopPanel /> : null;
}
