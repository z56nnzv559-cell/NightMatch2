import React, { useEffect, useMemo, useRef, useState } from "react";

const COLORS = {
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

const TYPES = ["キャバクラ", "ラウンジ", "ガールズバー", "スナック", "コンカフェ"];
const PERKS = ["体入OK", "送迎あり", "ノルマなし", "日払い", "未経験歓迎", "週1〜OK"];

/* Push payloadには本文を入れない。表示文言はクライアント側で解決する。 */
export const NOTIFICATION_TEXT = {
  "deal.new_application": "新しい応募が届きました",
  "message.received": "新しいメッセージがあります",
  "trial.report_reminder": "体入結果の報告を確認してください",
  "trial.awaiting_counterpart": "相手側の6桁報告を待っています",
  "hire.confirm_request": "本入店の確認依頼があります",
  "shop.listing_paused": "返信状況により求人掲載を一時停止しました",
  "invoice.drafted": "請求書の下書きが作成されました",
  "payout.held": "お祝い金の確認が必要です",
};

const yen = (n) => `¥${Number(n || 0).toLocaleString("ja-JP")}`;

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(path, { credentials: "same-origin", ...options, headers });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) {
    const error = new Error(body.error || `request_failed_${res.status}`);
    error.status = res.status;
    error.body = body;
    throw error;
  }
  return body;
}

function Button({ children, onClick, disabled, tone = "gold", type = "button", className = "" }) {
  const color = tone === "mint" ? COLORS.mint : tone === "danger" ? COLORS.danger : COLORS.gold;
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`rounded-xl px-4 py-3 text-sm font-semibold transition active:scale-[.99] disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
      style={{ background: color, color: "#151018" }}
    >
      {children}
    </button>
  );
}

function Card({ children, className = "" }) {
  return (
    <section
      className={`rounded-2xl border p-4 ${className}`}
      style={{ background: COLORS.surface, borderColor: COLORS.line }}
    >
      {children}
    </section>
  );
}

function Field({ label, ...props }) {
  return (
    <label className="grid gap-1.5 text-xs" style={{ color: COLORS.sub }}>
      {label}
      <input
        {...props}
        className="w-full rounded-xl border px-3 py-3 text-base outline-none"
        style={{ background: COLORS.surface2, borderColor: COLORS.line, color: COLORS.text }}
      />
    </label>
  );
}

function SelectField({ label, children, ...props }) {
  return (
    <label className="grid gap-1.5 text-xs" style={{ color: COLORS.sub }}>
      {label}
      <select
        {...props}
        className="w-full rounded-xl border px-3 py-3 text-base outline-none"
        style={{ background: COLORS.surface2, borderColor: COLORS.line, color: COLORS.text }}
      >
        {children}
      </select>
    </label>
  );
}

function Notice({ children, tone = "gold" }) {
  const color = tone === "danger" ? COLORS.danger : tone === "mint" ? COLORS.mint : COLORS.gold;
  return (
    <div className="rounded-xl border px-3 py-2.5 text-sm" style={{ borderColor: color, color }}>
      {children}
    </div>
  );
}

function Loading() {
  return (
    <div className="grid min-h-screen place-items-center" style={{ background: COLORS.bg, color: COLORS.sub }}>
      NightMatchを読み込んでいます…
    </div>
  );
}

function TurnstileBox({ siteKey, onToken }) {
  const ref = useRef(null);
  const widget = useRef(null);

  useEffect(() => {
    if (!siteKey || !ref.current) return;
    let cancelled = false;

    const render = () => {
      if (cancelled || !ref.current || !window.turnstile || widget.current !== null) return;
      widget.current = window.turnstile.render(ref.current, {
        sitekey: siteKey,
        theme: "dark",
        callback: onToken,
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    };

    if (window.turnstile) {
      render();
    } else {
      let script = document.querySelector('script[data-nightmatch-turnstile="1"]');
      if (!script) {
        script = document.createElement("script");
        script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
        script.async = true;
        script.defer = true;
        script.dataset.nightmatchTurnstile = "1";
        document.head.appendChild(script);
      }
      script.addEventListener("load", render, { once: true });
    }

    return () => {
      cancelled = true;
      if (window.turnstile && widget.current !== null) {
        try { window.turnstile.remove(widget.current); } catch {}
      }
      widget.current = null;
    };
  }, [siteKey, onToken]);

  if (!siteKey) {
    return (
      <Notice tone="danger">
        Cloudflare Turnstileの公開キーが未設定です。ログイン・新規登録を使うには
        TURNSTILE_SITE_KEY を設定してください。
      </Notice>
    );
  }

  return <div ref={ref} className="min-h-16" />;
}

function Header({ subtitle, onLogout }) {
  return (
    <header className="sticky top-0 z-20 border-b backdrop-blur" style={{ background: "rgba(16,13,20,.94)", borderColor: COLORS.line }}>
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div>
          <div className="text-xl font-semibold tracking-tight" style={{ color: COLORS.gold }}>NightMatch</div>
          <div className="text-[11px]" style={{ color: COLORS.sub }}>{subtitle}</div>
        </div>
        {onLogout && (
          <button onClick={onLogout} className="text-xs" style={{ color: COLORS.sub }}>ログアウト</button>
        )}
      </div>
    </header>
  );
}

function RecoveryScreen({ code, onDone }) {
  const [checked, setChecked] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); } catch {}
  };
  return (
    <main className="mx-auto grid min-h-screen max-w-lg place-items-center p-4" style={{ background: COLORS.bg, color: COLORS.text }}>
      <Card className="w-full space-y-4">
        <div className="text-xs tracking-[.18em]" style={{ color: COLORS.gold }}>一度だけ表示されます</div>
        <h1 className="text-2xl font-semibold">合言葉を必ず控えてください</h1>
        <p className="text-sm leading-6" style={{ color: COLORS.sub }}>
          NightMatchは働く本人のメールアドレス・電話番号を保存しません。端末を変えた時やCookieが切れた時は、この合言葉だけが入り直す手段です。
        </p>
        <button onClick={copy} className="w-full rounded-xl border p-4 text-center font-mono text-xl tracking-[.18em]" style={{ borderColor: COLORS.gold, color: COLORS.gold }}>
          {code}
          <span className="mt-1 block text-[10px] tracking-normal" style={{ color: COLORS.sub }}>タップしてコピー</span>
        </button>
        <label className="flex items-start gap-2 text-sm" style={{ color: COLORS.sub }}>
          <input type="checkbox" className="mt-1" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          スクリーンショット・安全なメモなどに控えました
        </label>
        <Button disabled={!checked} onClick={onDone} className="w-full">控えました。年齢確認へ</Button>
      </Card>
    </main>
  );
}

function AuthScreen({ siteKey, onAuthenticated }) {
  const [role, setRole] = useState("worker");
  const [mode, setMode] = useState("login");
  const [token, setToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!token) return setError("セキュリティ確認を完了してください");
    setBusy(true);
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (role === "worker" && mode === "register") {
        const res = await api("/api/auth/worker/register", {
          method: "POST",
          body: JSON.stringify({ nickname: data.nickname, birthDate: data.birthDate, turnstile: token }),
        });
        setRecoveryCode(res.recoveryCode);
      } else if (role === "worker") {
        await api("/api/auth/worker/login", {
          method: "POST",
          body: JSON.stringify({ recoveryCode: data.recoveryCode, turnstile: token }),
        });
        await onAuthenticated();
      } else if (mode === "register") {
        await api("/api/auth/shop/register", {
          method: "POST",
          body: JSON.stringify({
            name: data.name,
            area: data.area,
            businessType: data.businessType,
            station: data.station,
            email: data.email,
            password: data.password,
            turnstile: token,
          }),
        });
        await onAuthenticated();
      } else {
        await api("/api/auth/shop/login", {
          method: "POST",
          body: JSON.stringify({ email: data.email, password: data.password, turnstile: token }),
        });
        await onAuthenticated();
      }
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setBusy(false);
    }
  };

  if (recoveryCode) {
    return <RecoveryScreen code={recoveryCode} onDone={onAuthenticated} />;
  }

  return (
    <div className="min-h-screen" style={{ background: COLORS.bg, color: COLORS.text }}>
      <Header subtitle="夜職の直接マッチング" />
      <main className="mx-auto max-w-lg space-y-4 p-4 pt-8">
        <div className="text-center">
          <h1 className="text-3xl font-semibold">お店と本人が、直接つながる。</h1>
          <p className="mt-2 text-sm leading-6" style={{ color: COLORS.sub }}>
            店舗から直接スカウト。応募・体入・条件確認までNightMatch内で完結します。
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 rounded-xl p-1" style={{ background: COLORS.surface }}>
          {[['worker', '働く本人'], ['shop', '店舗']].map(([value, label]) => (
            <button key={value} onClick={() => { setRole(value); setToken(""); }} className="rounded-lg py-2 text-sm" style={{ background: role === value ? COLORS.surface2 : "transparent", color: role === value ? COLORS.gold : COLORS.sub }}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex justify-center gap-5 text-sm">
          <button onClick={() => { setMode("login"); setToken(""); }} style={{ color: mode === "login" ? COLORS.gold : COLORS.sub }}>ログイン</button>
          <button onClick={() => { setMode("register"); setToken(""); }} style={{ color: mode === "register" ? COLORS.gold : COLORS.sub }}>新規登録</button>
        </div>

        <Card>
          <form className="grid gap-3" onSubmit={submit}>
            {role === "worker" ? (
              mode === "register" ? (
                <>
                  <Field name="nickname" label="ニックネーム" required placeholder="例：ゆき" />
                  <Field name="birthDate" label="生年月日" required type="date" />
                  <Notice>18歳未満・高校在学中は登録できません。登録後、年齢確認が完了するまで応募・写真公開はできません。</Notice>
                </>
              ) : (
                <Field name="recoveryCode" label="合言葉" required autoComplete="off" placeholder="控えてある合言葉" />
              )
            ) : (
              <>
                {mode === "register" && (
                  <>
                    <Field name="name" label="店舗名" required />
                    <Field name="area" label="エリア" required placeholder="例：福岡・中洲" />
                    <SelectField name="businessType" label="業種" required defaultValue="ラウンジ">
                      {TYPES.map((t) => <option key={t}>{t}</option>)}
                    </SelectField>
                    <Field name="station" label="最寄り駅（任意）" />
                  </>
                )}
                <Field name="email" label="店舗メールアドレス" required type="email" />
                <Field name="password" label="パスワード" required type="password" minLength={12} />
              </>
            )}
            <TurnstileBox key={`${role}-${mode}`} siteKey={siteKey} onToken={setToken} />
            {error && <Notice tone="danger">{error}</Notice>}
            <Button type="submit" disabled={busy || !siteKey || !token} className="w-full">
              {busy ? "処理中…" : mode === "register" ? "登録する" : "ログイン"}
            </Button>
          </form>
        </Card>
      </main>
    </div>
  );
}

function DealActions({ deal, role, reload }) {
  const [busy, setBusy] = useState(false);
  const run = async (path, body) => {
    setBusy(true);
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      await reload();
    } catch (err) {
      alert(`操作できませんでした: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {role === "shop" && deal.stage === "opened" && (
        <Button disabled={busy} tone="mint" onClick={() => {
          const trialDate = prompt("体入日を YYYY-MM-DD で入力してください");
          if (trialDate) run(`/api/deals/${deal.id}/schedule`, { trialDate });
        }}>体入日を確定</Button>
      )}
      {deal.stage === "scheduled" && (
        <Button disabled={busy} onClick={() => {
          const code = prompt("相手と確認した6桁を入力してください");
          if (code) run(`/api/deals/${deal.id}/trial-code`, { code });
        }}>6桁を報告</Button>
      )}
      {["trial_done", "hired", "retained"].includes(deal.stage) && (
        <Button disabled={busy} tone="mint" onClick={() => {
          const workDate = prompt("出勤日を YYYY-MM-DD で入力してください");
          if (workDate) run(`/api/deals/${deal.id}/shift`, { workDate });
        }}>出勤を申告</Button>
      )}
      {deal.stage === "trial_done" && (
        <Button disabled={busy} onClick={() => run(`/api/deals/${deal.id}/hire`, {})}>
          {role === "shop" ? "本入店を確定" : "本入店を申告"}
        </Button>
      )}
    </div>
  );
}

function DealsList({ deals, role, reload }) {
  if (!deals.length) return <Notice>進行中の案件はまだありません。</Notice>;
  return (
    <div className="grid gap-3">
      {deals.map((deal) => (
        <Card key={deal.id}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">{deal.counterpart_name}</div>
              <div className="mt-1 text-xs" style={{ color: COLORS.sub }}>
                {deal.area} · {deal.business_type} · {deal.origin === "scout" ? "スカウト" : "応募"}
              </div>
            </div>
            <span className="rounded-full px-2 py-1 text-[11px]" style={{ background: COLORS.surface2, color: COLORS.gold }}>{deal.stage}</span>
          </div>
          {deal.trial_date && <div className="mt-3 text-sm">体入日：{deal.trial_date}</div>}
          {deal.stage === "scheduled" && deal.trial_code && (
            <div className="mt-3 rounded-xl border p-3" style={{ borderColor: COLORS.gold }}>
              <div className="text-xs" style={{ color: COLORS.sub }}>双方が同じ6桁を報告して初めて体入成立になります</div>
              <div className="mt-1 font-mono text-2xl tracking-[.25em]" style={{ color: COLORS.gold }}>{deal.trial_code}</div>
            </div>
          )}
          <DealActions deal={deal} role={role} reload={reload} />
        </Card>
      ))}
    </div>
  );
}

function WorkerDashboard({ me, onLogout }) {
  const [jobs, setJobs] = useState([]);
  const [deals, setDeals] = useState([]);
  const [celebrations, setCelebrations] = useState({ confirmed: 0, pending: 0 });
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    if (!me.ageVerified) return setLoading(false);
    const [jobData, dealData, celebData] = await Promise.all([
      api("/api/jobs?sort=new&limit=30"),
      api("/api/deals"),
      api("/api/me/celebrations"),
    ]);
    setJobs(jobData.jobs || []);
    setDeals(dealData.deals || []);
    setCelebrations(celebData);
    setLoading(false);
  };

  useEffect(() => { reload().catch(() => setLoading(false)); }, [me.ageVerified]);

  if (!me.ageVerified) {
    return (
      <div className="min-h-screen" style={{ background: COLORS.bg, color: COLORS.text }}>
        <Header subtitle={`${me.nickname}さん · 働く本人`} onLogout={onLogout} />
        <main className="mx-auto max-w-xl p-4 pt-8">
          <Card className="space-y-4">
            <div className="text-sm" style={{ color: COLORS.gold }}>年齢確認が必要です</div>
            <h1 className="text-2xl font-semibold">求人を見る前に本人確認を完了してください</h1>
            <p className="text-sm leading-6" style={{ color: COLORS.sub }}>
              年齢確認が完了するまでは、応募・スカウト受信後の進行・写真公開を開始しません。運営のKYC案内に沿って本人確認を完了してください。
            </p>
          </Card>
        </main>
      </div>
    );
  }

  if (loading) return <Loading />;

  const apply = async (jobId) => {
    const trialDate = prompt("希望する体入日があれば YYYY-MM-DD で入力してください（未定なら空欄）");
    try {
      await api("/api/deals/apply", { method: "POST", body: JSON.stringify({ jobId, trialDate: trialDate || undefined }) });
      await reload();
      alert("応募しました。店舗からの返信をお待ちください。");
    } catch (err) {
      alert(`応募できませんでした: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen" style={{ background: COLORS.bg, color: COLORS.text }}>
      <Header subtitle={`${me.nickname}さん · 働く本人`} onLogout={onLogout} />
      <main className="mx-auto grid max-w-5xl gap-6 p-4 py-6">
        <section className="grid grid-cols-2 gap-3">
          <Card><div className="text-xs" style={{ color: COLORS.sub }}>お祝い金 確定</div><div className="mt-1 text-xl font-semibold" style={{ color: COLORS.gold }}>{yen(celebrations.confirmed)}</div></Card>
          <Card><div className="text-xs" style={{ color: COLORS.sub }}>お祝い金 予定</div><div className="mt-1 text-xl font-semibold">{yen(celebrations.pending)}</div></Card>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">進行中</h2>
          <DealsList deals={deals} role="worker" reload={reload} />
        </section>

        <section>
          <div className="mb-3 flex items-end justify-between">
            <div><h2 className="text-lg font-semibold">求人を探す</h2><p className="text-xs" style={{ color: COLORS.sub }}>店舗と直接やり取りできます</p></div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {jobs.map((job) => (
              <Card key={job.id}>
                <div className="flex justify-between gap-3">
                  <div><div className="font-semibold">{job.shop_name}</div><div className="text-xs" style={{ color: COLORS.sub }}>{job.area} · {job.business_type}</div></div>
                  {job.verified_at && <span className="text-xs" style={{ color: COLORS.mint }}>確認済み</span>}
                </div>
                <div className="mt-4 text-2xl font-semibold" style={{ color: COLORS.gold }}>{yen(job.trial_pay)}<span className="ml-1 text-xs font-normal" style={{ color: COLORS.sub }}>体入支給</span></div>
                <div className="mt-1 text-sm">時給 {yen(job.hourly_min)}〜{yen(job.hourly_max)}</div>
                <div className="mt-3 flex flex-wrap gap-1.5">{(JSON.parse(job.perks || "[]")).map((p) => <span key={p} className="rounded-full border px-2 py-1 text-[11px]" style={{ borderColor: COLORS.line, color: COLORS.sub }}>{p}</span>)}</div>
                <Button onClick={() => apply(job.id)} className="mt-4 w-full">この求人に応募</Button>
              </Card>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

function ShopDashboard({ me, onLogout }) {
  const [deals, setDeals] = useState([]);
  const [workers, setWorkers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [rewards, setRewards] = useState({ confirmed: 0, accrued: 0, funnel: {} });
  const [loading, setLoading] = useState(true);
  const [scout, setScout] = useState(null);

  const reload = async () => {
    if (!me.verified) return setLoading(false);
    const [dealData, workerData, jobData, rewardData] = await Promise.all([
      api("/api/deals"), api("/api/workers?limit=30"), api("/api/shop/jobs"), api("/api/shop/rewards"),
    ]);
    setDeals(dealData.deals || []);
    setWorkers(workerData.workers || []);
    setJobs(jobData.jobs || []);
    setRewards(rewardData);
    setLoading(false);
  };

  useEffect(() => { reload().catch(() => setLoading(false)); }, [me.verified]);

  if (!me.verified) {
    return (
      <div className="min-h-screen" style={{ background: COLORS.bg, color: COLORS.text }}>
        <Header subtitle={`${me.name} · 店舗`} onLogout={onLogout} />
        <main className="mx-auto max-w-xl p-4 pt-8">
          <Card className="space-y-4">
            <div className="text-sm" style={{ color: COLORS.gold }}>店舗確認待ち</div>
            <h1 className="text-2xl font-semibold">運営による店舗確認をお待ちください</h1>
            <p className="text-sm leading-6" style={{ color: COLORS.sub }}>
              現在は所在地・営業許可等の確認中です。確認が完了すると、求人作成・女性一覧・直接スカウトが自動的に利用可能になります。
            </p>
            <Notice>確認前の状態で機能を押してエラーになることはありません。この画面で確認完了をお待ちください。</Notice>
          </Card>
        </main>
      </div>
    );
  }

  if (loading) return <Loading />;

  const createJob = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      await api("/api/jobs", {
        method: "POST",
        body: JSON.stringify({
          area: data.area,
          businessType: data.businessType,
          trialPay: Number(data.trialPay),
          hourlyMin: Number(data.hourlyMin),
          hourlyMax: Number(data.hourlyMax),
          hours: data.hours,
          body: data.body,
          perks: PERKS.filter((p) => data[`perk:${p}`] === "on"),
        }),
      });
      e.currentTarget.reset();
      await reload();
    } catch (err) {
      alert(`求人を作成できませんでした: ${err.message}`);
    }
  };

  const sendScout = async () => {
    if (!scout?.workerId || !scout?.jobId || !scout?.message) return;
    try {
      await api("/api/deals/scout", { method: "POST", body: JSON.stringify(scout) });
      setScout(null);
      await reload();
      alert("スカウトを送りました");
    } catch (err) {
      alert(`スカウトできませんでした: ${err.message}`);
    }
  };

  const openJobs = jobs.filter((j) => j.is_open);

  return (
    <div className="min-h-screen" style={{ background: COLORS.bg, color: COLORS.text }}>
      <Header subtitle={`${me.name} · 店舗`} onLogout={onLogout} />
      <main className="mx-auto grid max-w-5xl gap-6 p-4 py-6">
        <section className="grid grid-cols-2 gap-3">
          <Card><div className="text-xs" style={{ color: COLORS.sub }}>今月の請求 確定</div><div className="mt-1 text-xl font-semibold" style={{ color: COLORS.mint }}>{yen(rewards.confirmed)}</div></Card>
          <Card><div className="text-xs" style={{ color: COLORS.sub }}>今月の請求 仮計上</div><div className="mt-1 text-xl font-semibold" style={{ color: COLORS.gold }}>{yen(rewards.accrued)}</div></Card>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">応募・スカウトの進行</h2>
          <DealsList deals={deals} role="shop" reload={reload} />
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">女性を探す</h2>
          {openJobs.length === 0 && <Notice>スカウトには掲載中の自店求人が1件必要です。下のフォームから求人を作成してください。</Notice>}
          <div className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {workers.map((worker) => (
              <Card key={worker.id}>
                {worker.photoUrl ? <img src={worker.photoUrl} alt="" className="mb-3 aspect-[4/3] w-full rounded-xl object-cover" /> : <div className="mb-3 grid aspect-[4/3] place-items-center rounded-xl" style={{ background: COLORS.surface2, color: COLORS.sub }}>写真は非公開</div>}
                <div className="flex justify-between"><div className="font-semibold">{worker.nickname} · {worker.age}歳</div><div style={{ color: COLORS.gold }}>{worker.hopeHourly ? `${yen(worker.hopeHourly)}/h` : "応相談"}</div></div>
                <div className="mt-2 text-xs leading-5" style={{ color: COLORS.sub }}>{worker.hopeAreas.join(" / ") || "エリア相談"}<br />{worker.availableDays.join("・") || "曜日相談"}</div>
                {worker.bio && <p className="mt-2 text-sm leading-5">{worker.bio}</p>}
                <Button disabled={!openJobs.length} tone="mint" className="mt-3 w-full" onClick={() => setScout({ workerId: worker.id, jobId: openJobs[0]?.id || "", message: "" })}>スカウトする</Button>
              </Card>
            ))}
          </div>
        </section>

        {scout && (
          <Card className="space-y-3 border-2" style={{ borderColor: COLORS.mint }}>
            <h3 className="font-semibold">スカウトを送る</h3>
            <SelectField label="求人" value={scout.jobId} onChange={(e) => setScout({ ...scout, jobId: e.target.value })}>
              {openJobs.map((job) => <option key={job.id} value={job.id}>{job.area} · {job.business_type} · {yen(job.hourly_max)}</option>)}
            </SelectField>
            <label className="grid gap-1.5 text-xs" style={{ color: COLORS.sub }}>メッセージ<textarea value={scout.message} onChange={(e) => setScout({ ...scout, message: e.target.value })} rows={4} className="rounded-xl border p-3 text-base" style={{ background: COLORS.surface2, borderColor: COLORS.line, color: COLORS.text }} /></label>
            <div className="flex gap-2"><Button tone="mint" disabled={!scout.message.trim()} onClick={sendScout}>送信</Button><Button tone="danger" onClick={() => setScout(null)}>閉じる</Button></div>
          </Card>
        )}

        <section>
          <h2 className="mb-3 text-lg font-semibold">求人を作成</h2>
          <Card>
            <form className="grid gap-3 md:grid-cols-2" onSubmit={createJob}>
              <Field name="area" label="エリア" required placeholder="福岡・中洲" />
              <SelectField name="businessType" label="業種" defaultValue="ラウンジ">{TYPES.map((t) => <option key={t}>{t}</option>)}</SelectField>
              <Field name="trialPay" label="体入時の女性への支給額" type="number" min="0" required />
              <Field name="hourlyMin" label="時給 下限" type="number" min="0" required />
              <Field name="hourlyMax" label="時給 上限" type="number" min="0" required />
              <Field name="hours" label="勤務時間" placeholder="20:00〜翌1:00" />
              <label className="grid gap-1.5 text-xs md:col-span-2" style={{ color: COLORS.sub }}>求人本文<textarea name="body" rows={4} className="rounded-xl border p-3 text-base" style={{ background: COLORS.surface2, borderColor: COLORS.line, color: COLORS.text }} /></label>
              <div className="md:col-span-2"><div className="mb-2 text-xs" style={{ color: COLORS.sub }}>こだわり条件</div><div className="flex flex-wrap gap-3">{PERKS.map((p) => <label key={p} className="text-sm"><input type="checkbox" name={`perk:${p}`} className="mr-1" />{p}</label>)}</div></div>
              <Button type="submit" tone="mint" className="md:col-span-2">求人を掲載する</Button>
            </form>
          </Card>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold">自店の求人</h2>
          <div className="grid gap-2">{jobs.map((job) => <Card key={job.id}><div className="flex justify-between"><div>{job.area} · {job.business_type}</div><span style={{ color: job.is_open ? COLORS.mint : COLORS.sub }}>{job.is_open ? "掲載中" : "停止中"}</span></div><div className="mt-1 text-sm" style={{ color: COLORS.sub }}>{yen(job.hourly_min)}〜{yen(job.hourly_max)} / 体入支給 {yen(job.trial_pay)}</div></Card>)}</div>
        </section>
      </main>
    </div>
  );
}

export default function AppV2() {
  const [me, setMe] = useState(null);
  const [config, setConfig] = useState({ turnstileSiteKey: "" });
  const [ready, setReady] = useState(false);

  const refreshMe = async () => {
    const value = await api("/api/me");
    setMe(value);
    setReady(true);
  };

  useEffect(() => {
    Promise.all([
      api("/api/config").then(setConfig).catch(() => {}),
      refreshMe(),
    ]).catch(() => setReady(true));
  }, []);

  const logout = async () => {
    await api("/api/auth/logout", { method: "POST" });
    setMe({ session: null });
  };

  if (!ready) return <Loading />;
  if (!me?.session) return <AuthScreen siteKey={config.turnstileSiteKey} onAuthenticated={refreshMe} />;
  if (me.session.kind === "worker") return <WorkerDashboard me={me} onLogout={logout} />;
  return <ShopDashboard me={me} onLogout={logout} />;
}
