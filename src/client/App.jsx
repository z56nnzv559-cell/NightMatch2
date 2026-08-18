import React, { useState, useMemo, useEffect } from "react";

/* ==================================================================
   灯 -AKARI-  ／ 夜職マッチング（成果報酬型）
   改訂点
   A 情報の整理  : カード内の金額を1つに絞り、他を従属させた
   B 世界観      : 明朝をWebフォントで確定、灯りの演出、金一色に統一
   C 役割で色分け: 働く人=シャンパン／お店=銅青のダッシュボード
   D 写真スワイプ: 店舗側で「一覧 / スワイプ」を切替
================================================================== */

const THEMES = {
  girl: {
    bg: "#14101A",
    surf: "#1F1826",
    alt: "#261E2F",
    line: "#372C42",
    text: "#EDE6F0",
    sub: "#A395AD",
    accent: "#D9B26A",
    ink: "#1A1320",
    glow: "217,178,106",
  },
  shop: {
    bg: "#0E1416",
    surf: "#17201F",
    alt: "#1D2827",
    line: "#2C3A38",
    text: "#E4EDEB",
    sub: "#8FA3A0",
    accent: "#7FC7B5",
    ink: "#0B1413",
    glow: "127,199,181",
  },
};

const mincho =
  '"Shippori Mincho", "Hiragino Mincho ProN", "Yu Mincho", YuMincho, serif';
const gothic =
  '"Zen Kaku Gothic New", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';

const AREAS = ["新宿", "渋谷", "六本木", "銀座", "池袋", "恵比寿"];
const TYPES = ["キャバクラ", "ラウンジ", "ガールズバー", "スナック", "コンカフェ"];
const PERKS = [
  "体入OK",
  "送迎あり",
  "ノルマなし",
  "日払い",
  "未経験歓迎",
  "週1〜OK",
  "ドレス貸出",
  "託児サポート",
];

/* ---- 成果報酬モデル : 掲載無料。体入の実施と本入店の2点のみ課金 ---- */
const GUARANTEE_DAYS = 14;

const FEE = {
  キャバクラ: { trial: 3000, hire: 60000, celebTrial: 3000, celebHire: 25000 },
  ラウンジ: { trial: 3000, hire: 45000, celebTrial: 3000, celebHire: 20000 },
  ガールズバー: { trial: 1500, hire: 18000, celebTrial: 1500, celebHire: 8000 },
  スナック: { trial: 1500, hire: 15000, celebTrial: 1500, celebHire: 7000 },
  コンカフェ: { trial: 1500, hire: 15000, celebTrial: 1500, celebHire: 7000 },
};

const STAGES = [
  { label: "返信待ち", fee: "課金なし" },
  { label: "体入日 確定", fee: "課金なし" },
  { label: "体入 実施済み", fee: "体入報酬 確定" },
  { label: "本入店", fee: "本入店報酬 仮計上" },
  { label: `${GUARANTEE_DAYS}日勤務 達成`, fee: "本入店報酬 確定" },
];

const feeOf = (type) => FEE[type] || FEE["スナック"];
const code6 = () => String(Math.floor(100000 + Math.random() * 900000));
const yen = (n) => "¥" + n.toLocaleString("ja-JP");

const JOBS = [
  {
    id: 1,
    shop: "Lounge 灯月",
    area: "銀座",
    type: "ラウンジ",
    station: "銀座一丁目 徒歩3分",
    trial: 12000,
    min: 6000,
    max: 9000,
    hours: "20:00 – 翌1:00",
    perks: ["体入OK", "ノルマなし", "日払い", "ドレス貸出"],
    note: "客層は40代以上の常連が中心。会話メインで、無理な同伴営業はありません。",
    verified: true,
    posted: "本日",
    hue: 34,
  },
  {
    id: 2,
    shop: "CLUB Verre",
    area: "六本木",
    type: "キャバクラ",
    station: "六本木 徒歩1分",
    trial: 15000,
    min: 7000,
    max: 13000,
    hours: "20:00 – 翌2:00",
    perks: ["体入OK", "送迎あり", "日払い", "週1〜OK"],
    note: "在籍40名の大箱。指名バックは別途、給与明細は毎回発行しています。",
    verified: true,
    posted: "1日前",
    hue: 288,
  },
  {
    id: 3,
    shop: "girls bar Nue",
    area: "渋谷",
    type: "ガールズバー",
    station: "渋谷 徒歩5分",
    trial: 4000,
    min: 1800,
    max: 3000,
    hours: "19:00 – 翌0:00",
    perks: ["体入OK", "未経験歓迎", "週1〜OK", "ノルマなし"],
    note: "カウンター8席の小箱。学生・掛け持ちの方が半数です。",
    verified: false,
    posted: "2日前",
    hue: 200,
  },
  {
    id: 4,
    shop: "SNACK もみじ",
    area: "池袋",
    type: "スナック",
    station: "池袋 徒歩7分",
    trial: 5000,
    min: 2000,
    max: 3500,
    hours: "19:00 – 翌0:00",
    perks: ["未経験歓迎", "ノルマなし", "託児サポート", "週1〜OK"],
    note: "ママと2人体制。30代以上の在籍が多く、落ち着いて働けます。",
    verified: true,
    posted: "3日前",
    hue: 14,
  },
  {
    id: 5,
    shop: "Lounge Aoi",
    area: "新宿",
    type: "ラウンジ",
    station: "西武新宿 徒歩4分",
    trial: 10000,
    min: 5000,
    max: 8000,
    hours: "20:00 – 翌1:00",
    perks: ["体入OK", "送迎あり", "ノルマなし", "ドレス貸出"],
    note: "私服可。アフター・同伴の強制は一切ありません。",
    verified: true,
    posted: "本日",
    hue: 250,
  },
  {
    id: 6,
    shop: "CLUB 藍",
    area: "新宿",
    type: "キャバクラ",
    station: "新宿三丁目 徒歩2分",
    trial: 13000,
    min: 6500,
    max: 12000,
    hours: "20:00 – 翌1:30",
    perks: ["体入OK", "日払い", "送迎あり", "未経験歓迎"],
    note: "体入当日に現金でお支払い。在籍スタッフが同席してフォローします。",
    verified: false,
    posted: "4日前",
    hue: 222,
  },
  {
    id: 7,
    shop: "Bar Ondine",
    area: "恵比寿",
    type: "コンカフェ",
    station: "恵比寿 徒歩3分",
    trial: 3500,
    min: 1500,
    max: 2400,
    hours: "18:00 – 23:00",
    perks: ["未経験歓迎", "週1〜OK", "ノルマなし", "ドレス貸出"],
    note: "衣装貸出あり。終電前に上がれるシフトが基本です。",
    verified: true,
    posted: "1日前",
    hue: 172,
  },
  {
    id: 8,
    shop: "Lounge 白鷺",
    area: "銀座",
    type: "ラウンジ",
    station: "新橋 徒歩5分",
    trial: 11000,
    min: 5500,
    max: 9500,
    hours: "19:30 – 翌0:30",
    perks: ["体入OK", "ノルマなし", "託児サポート"],
    note: "早番シフトあり。お子さんのいる方の在籍が3名います。",
    verified: true,
    posted: "5日前",
    hue: 45,
  },
];

/* face : 本人が選んだ写真の公開範囲 */
const FACE_LABEL = {
  open: "顔出しOK",
  eyes: "目線カット",
  blur: "ぼかし",
  none: "体入承諾後に公開",
};

const GIRLS = [
  {
    id: 1,
    nick: "あおい",
    age: 22,
    exp: "ラウンジ 1年",
    areas: ["新宿", "渋谷"],
    hope: 6000,
    days: ["火", "木", "金"],
    note: "昼職と掛け持ちなので、週3・24時上がりを希望しています。",
    updated: "30分前",
    face: "open",
    hue: 320,
  },
  {
    id: 2,
    nick: "もも",
    age: 24,
    exp: "キャバクラ 3年",
    areas: ["六本木", "銀座"],
    hope: 9000,
    days: ["月", "水", "金", "土"],
    note: "指名は前店で月平均40本。体入を2〜3店舗まわって決めたいです。",
    updated: "2時間前",
    face: "open",
    hue: 32,
  },
  {
    id: 3,
    nick: "ゆき",
    age: 20,
    exp: "未経験",
    areas: ["渋谷", "恵比寿"],
    hope: 2000,
    days: ["土", "日"],
    note: "はじめてなので、研修とスタッフのフォローがある所を探しています。",
    updated: "本日",
    face: "eyes",
    hue: 265,
  },
  {
    id: 4,
    nick: "れい",
    age: 27,
    exp: "スナック 4年",
    areas: ["池袋", "新宿"],
    hope: 3000,
    days: ["月", "火", "水", "木"],
    note: "子どもがいるため19時〜24時、日曜はお休みを希望します。",
    updated: "昨日",
    face: "blur",
    hue: 200,
  },
  {
    id: 5,
    nick: "さな",
    age: 21,
    exp: "ガールズバー 半年",
    areas: ["新宿"],
    hope: 4500,
    days: ["水", "木", "金", "土"],
    note: "接客は好きです。ノルマのないお店に移りたいと思っています。",
    updated: "3時間前",
    face: "open",
    hue: 348,
  },
  {
    id: 6,
    nick: "あおと",
    age: 25,
    exp: "ラウンジ 2年",
    areas: ["銀座", "六本木"],
    hope: 8000,
    days: ["火", "水", "木", "金"],
    note: "落ち着いた客層のお店を希望。日本語・英語での接客ができます。",
    updated: "昨日",
    face: "none",
    hue: 155,
  },
];

/* ============================== atoms ============================= */

function Chip({ active, onClick, children, t }) {
  return (
    <button
      onClick={onClick}
      className="shrink-0 rounded-full px-3 py-1.5 text-xs transition-colors"
      style={{
        fontFamily: gothic,
        border: `1px solid ${active ? t.accent : t.line}`,
        background: active ? `rgba(${t.glow},0.12)` : "transparent",
        color: active ? t.accent : t.sub,
      }}
    >
      {children}
    </button>
  );
}

function Tag({ children, t }) {
  return (
    <span
      className="rounded-sm px-1.5 py-0.5 text-[11px]"
      style={{ fontFamily: gothic, color: t.sub, border: `1px solid ${t.line}` }}
    >
      {children}
    </span>
  );
}

function Rule({ t }) {
  return <div className="my-3 h-px" style={{ background: t.line }} />;
}

/* 主役の金額。カード内でこれ以外に大きな数字は置かない。 */
function Lead({ label, value, sub, t }) {
  return (
    <div>
      <p
        className="text-[10px]"
        style={{ fontFamily: gothic, color: t.sub, letterSpacing: "0.08em" }}
      >
        {label}
      </p>
      <p
        className="leading-none"
        style={{ fontFamily: mincho, color: t.accent, fontSize: 30 }}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-1.5 text-[11px]" style={{ fontFamily: gothic, color: t.sub }}>
          {sub}
        </p>
      )}
    </div>
  );
}

function Stepper({ stage, t }) {
  return (
    <div className="mt-3">
      <div className="flex gap-1">
        {STAGES.map((s, i) => (
          <div
            key={i}
            className="h-1 flex-1 rounded-full"
            style={{ background: i <= stage ? (i >= 2 ? t.accent : t.sub) : t.line }}
          />
        ))}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-[12px]" style={{ fontFamily: gothic, color: t.text }}>
          {STAGES[stage].label}
        </span>
        <span
          className="text-[10px]"
          style={{ fontFamily: gothic, color: stage >= 2 ? t.accent : t.sub }}
        >
          {STAGES[stage].fee}
        </span>
      </div>
    </div>
  );
}

function TrialCode({ code, t }) {
  return (
    <div
      className="mt-3 flex items-center justify-between rounded px-3 py-2"
      style={{ background: t.alt, border: `1px solid ${t.line}` }}
    >
      <span className="text-[11px]" style={{ fontFamily: gothic, color: t.sub }}>
        体入コード
      </span>
      <span
        style={{
          fontFamily: mincho,
          color: t.accent,
          fontSize: 17,
          letterSpacing: "0.22em",
        }}
      >
        {code}
      </span>
    </div>
  );
}

function Sheet({ open, onClose, children, t }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center"
      style={{ background: "rgba(8,6,10,0.72)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="ak-sheet max-h-[86vh] w-full max-w-md overflow-y-auto rounded-t-2xl p-5"
        style={{ background: t.surf, borderTop: `1px solid ${t.line}` }}
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full" style={{ background: t.line }} />
        {children}
      </div>
    </div>
  );
}

function Cta({ children, onClick, disabled, t, quiet }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full rounded py-2.5 text-[13px]"
      style={{
        fontFamily: gothic,
        background: quiet || disabled ? "transparent" : t.accent,
        color: quiet || disabled ? t.sub : t.ink,
        border: `1px solid ${quiet || disabled ? t.line : t.accent}`,
      }}
    >
      {children}
    </button>
  );
}

/* ---- 店内の灯り。実データでは店舗写真に差し替える ---- */
function Interior({ job, t }) {
  const lamps = [
    [20, 40, 30],
    [50, 30, 22],
    [80, 44, 26],
  ];
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        aspectRatio: "16 / 9",
        background: `linear-gradient(175deg, hsl(${job.hue} 20% 17%), hsl(${job.hue} 24% 7%))`,
      }}
    >
      <svg viewBox="0 0 100 56" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <defs>
          <radialGradient id={`lamp${job.id}`}>
            <stop offset="0%" stopColor="rgba(255,224,170,0.85)" />
            <stop offset="45%" stopColor="rgba(255,214,150,0.20)" />
            <stop offset="100%" stopColor="rgba(255,210,140,0)" />
          </radialGradient>
        </defs>
        {lamps.map(([x, y, r], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={r} fill={`url(#lamp${job.id})`} />
            <circle cx={x} cy={y - r * 0.55} r="0.7" fill="rgba(255,236,200,0.9)" />
            <line
              x1={x}
              y1="0"
              x2={x}
              y2={y - r * 0.55}
              stroke="rgba(255,236,200,0.18)"
              strokeWidth="0.25"
            />
          </g>
        ))}
        <rect x="0" y="46" width="100" height="0.3" fill="rgba(255,236,200,0.16)" />
      </svg>
      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          height: "70%",
          background: `linear-gradient(180deg, transparent, ${t.surf}D9 60%, ${t.surf})`,
        }}
      />
    </div>
  );
}

function Portrait({ girl, t, ratio = "3 / 4" }) {
  const hidden = girl.face === "none";
  return (
    <div
      className="relative w-full overflow-hidden"
      style={{
        aspectRatio: ratio,
        background: `linear-gradient(165deg, hsl(${girl.hue} 24% 30%), hsl(${
          girl.hue + 25
        } 20% 11%))`,
      }}
    >
      <svg
        viewBox="0 0 100 133"
        preserveAspectRatio="xMidYMax slice"
        className="absolute inset-0 h-full w-full"
        style={{
          filter: girl.face === "blur" ? "blur(16px)" : "none",
          opacity: hidden ? 0.16 : 0.9,
        }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`pt${girl.id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={`hsl(${girl.hue} 18% 76%)`} />
            <stop offset="100%" stopColor={`hsl(${girl.hue} 16% 42%)`} />
          </linearGradient>
        </defs>
        <ellipse cx="50" cy="48" rx="21" ry="26" fill={`url(#pt${girl.id})`} />
        <path
          d="M50 76c22 0 36 16 39 40 1 8 1 12 1 17H10c0-5 0-9 1-17 3-24 17-40 39-40z"
          fill={`url(#pt${girl.id})`}
        />
      </svg>

      {girl.face === "eyes" && (
        <div
          className="absolute"
          style={{
            left: "27%",
            width: "46%",
            top: "31%",
            height: "6.5%",
            background: t.bg,
            borderRadius: 2,
          }}
        />
      )}

      {hidden && (
        <div className="absolute inset-0 flex items-center justify-center">
          <span style={{ fontFamily: mincho, color: t.accent, fontSize: 36 }}>
            {girl.nick.slice(0, 1)}
          </span>
        </div>
      )}

      <div
        className="absolute inset-x-0 bottom-0"
        style={{
          height: "55%",
          background: `linear-gradient(180deg, transparent, ${t.surf}CC 55%, ${t.surf})`,
        }}
      />
      <span
        className="absolute right-2 top-2 rounded-full px-2 py-0.5 text-[10px]"
        style={{
          fontFamily: gothic,
          background: "rgba(10,8,12,0.66)",
          color: girl.face === "open" ? t.accent : t.sub,
          border: `1px solid ${girl.face === "open" ? t.accent : t.line}`,
        }}
      >
        {FACE_LABEL[girl.face]}
      </span>
    </div>
  );
}

/* ============================== cards ============================= */

function JobCard({ job, t, onOpen, saved, onSave, applied, delay = 0 }) {
  const f = feeOf(job.type);
  return (
    <article
      className="ak-rise overflow-hidden rounded-lg"
      style={{
        background: t.surf,
        border: `1px solid ${t.line}`,
        animationDelay: `${delay}ms`,
      }}
    >
      <div className="relative">
        <Interior job={job} t={t} />
        <button
          onClick={() => onSave(job.id)}
          aria-label={saved ? "気になるから外す" : "気になるに入れる"}
          className="absolute right-2 top-2 rounded-full px-2 py-1 text-base leading-none"
          style={{
            background: "rgba(10,8,12,0.55)",
            color: saved ? t.accent : "rgba(255,255,255,0.6)",
          }}
        >
          {saved ? "♥" : "♡"}
        </button>
        <div className="absolute inset-x-0 bottom-0 px-4 pb-2">
          <h3 style={{ fontFamily: mincho, color: t.text, fontSize: 21 }}>
            {job.shop}
            {job.verified && (
              <span
                className="ml-2 align-middle text-[10px]"
                style={{ fontFamily: gothic, color: t.accent }}
                title="所在地と許可番号を確認した店舗"
              >
                ✓確認済
              </span>
            )}
          </h3>
          <p className="text-[11px]" style={{ fontFamily: gothic, color: t.sub }}>
            {job.area}・{job.type}／{job.station}
          </p>
        </div>
      </div>

      <div className="px-4 pb-4 pt-3">
        <Lead
          t={t}
          label="体入時給"
          value={yen(job.trial)}
          sub={`本入店後 ${yen(job.min)}–${yen(job.max)} / 時 ・ ${job.hours}`}
        />

        <Rule t={t} />

        <div className="flex flex-wrap gap-1.5">
          {job.perks.slice(0, 3).map((p) => (
            <Tag key={p} t={t}>
              {p}
            </Tag>
          ))}
        </div>

        <p className="mt-3 text-[11px]" style={{ fontFamily: gothic, color: t.sub }}>
          入店お祝い金 {yen(f.celebHire)}（{GUARANTEE_DAYS}日勤務で確定）／体入で{" "}
          {yen(f.celebTrial)}
        </p>

        <div className="mt-3">
          <Cta t={t} quiet={applied} onClick={() => onOpen(job)}>
            {applied ? "申込み済み" : "体入を申し込む"}
          </Cta>
        </div>
      </div>
    </article>
  );
}

function GirlCard({ girl, t, onOpen, scouted, delay = 0 }) {
  return (
    <article
      className="ak-rise overflow-hidden rounded-lg"
      style={{
        background: t.surf,
        border: `1px solid ${t.line}`,
        animationDelay: `${delay}ms`,
      }}
    >
      <button
        onClick={() => onOpen(girl)}
        className="relative block w-full text-left"
        aria-label={`${girl.nick}さんのプロフィールを開く`}
      >
        <Portrait girl={girl} t={t} />
        <div className="absolute inset-x-0 bottom-0 px-4 pb-2">
          <h3 style={{ fontFamily: mincho, color: t.text, fontSize: 24 }}>
            {girl.nick}
          </h3>
          <p className="text-[11px]" style={{ fontFamily: gothic, color: t.sub }}>
            {girl.age}歳・{girl.exp}／最終ログイン {girl.updated}
          </p>
        </div>
      </button>

      <div className="px-4 pb-4 pt-3">
        <Lead
          t={t}
          label="希望時給"
          value={yen(girl.hope) + "〜"}
          sub={`${girl.areas.join("・")} ／ ${girl.days.join("")}`}
        />
        <Rule t={t} />
        <p
          className="text-[12px] leading-relaxed"
          style={{ fontFamily: gothic, color: t.sub }}
        >
          {girl.note}
        </p>
        <div className="mt-3">
          <Cta t={t} quiet={scouted} onClick={() => onOpen(girl)}>
            {scouted ? "スカウト送信済み" : "スカウトを送る"}
          </Cta>
        </div>
      </div>
    </article>
  );
}

/* ---- D : スワイプ。一覧の代替ではなく、量をこなすための第2モード ---- */
function SwipeDeck({ girls, t, onScout }) {
  const [i, setI] = useState(0);
  const [dx, setDx] = useState(0);
  const [start, setStart] = useState(null);
  const girl = girls[i];

  const decide = (dir) => {
    if (dir === "right" && girl) onScout(girl);
    setDx(0);
    setStart(null);
    setI((n) => n + 1);
  };

  if (!girl) {
    return (
      <div className="px-4 pt-10 text-center">
        <p className="text-[13px]" style={{ fontFamily: gothic, color: t.sub }}>
          今日の候補は見終わりました。条件を変えるか、時間をおいて戻ってきてください。
        </p>
        <div className="mx-auto mt-4 max-w-[200px]">
          <Cta t={t} quiet onClick={() => setI(0)}>
            もう一度見る
          </Cta>
        </div>
      </div>
    );
  }

  const rot = dx / 22;
  const intent = dx > 60 ? "scout" : dx < -60 ? "pass" : null;

  return (
    <div className="px-4 pt-4">
      <div className="relative">
        <div
          className="overflow-hidden rounded-lg"
          style={{
            background: t.surf,
            border: `1px solid ${intent === "scout" ? t.accent : t.line}`,
            transform: `translateX(${dx}px) rotate(${rot}deg)`,
            transition: start ? "none" : "transform .25s ease",
            touchAction: "pan-y",
          }}
          onPointerDown={(e) => setStart(e.clientX)}
          onPointerMove={(e) => start !== null && setDx(e.clientX - start)}
          onPointerUp={() => {
            if (dx > 90) decide("right");
            else if (dx < -90) decide("left");
            else {
              setDx(0);
              setStart(null);
            }
          }}
          onPointerCancel={() => {
            setDx(0);
            setStart(null);
          }}
        >
          <div className="relative">
            <Portrait girl={girl} t={t} ratio="4 / 5" />
            <div className="absolute inset-x-0 bottom-0 px-4 pb-3">
              <h3 style={{ fontFamily: mincho, color: t.text, fontSize: 28 }}>
                {girl.nick}
              </h3>
              <p className="text-[12px]" style={{ fontFamily: gothic, color: t.sub }}>
                {girl.age}歳・{girl.exp}
              </p>
            </div>
            {intent && (
              <span
                className="absolute left-3 top-3 rounded px-2 py-1 text-[12px]"
                style={{
                  fontFamily: gothic,
                  color: intent === "scout" ? t.ink : t.text,
                  background: intent === "scout" ? t.accent : "rgba(10,8,12,0.7)",
                }}
              >
                {intent === "scout" ? "スカウト" : "見送る"}
              </span>
            )}
          </div>

          <div className="px-4 pb-4 pt-3">
            <Lead
              t={t}
              label="希望時給"
              value={yen(girl.hope) + "〜"}
              sub={`${girl.areas.join("・")} ／ ${girl.days.join("")}`}
            />
            <Rule t={t} />
            <p
              className="text-[12px] leading-relaxed"
              style={{ fontFamily: gothic, color: t.sub }}
            >
              {girl.note}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex gap-3">
        <button
          onClick={() => decide("left")}
          className="flex-1 rounded py-3 text-[13px]"
          style={{ fontFamily: gothic, color: t.sub, border: `1px solid ${t.line}` }}
        >
          見送る
        </button>
        <button
          onClick={() => decide("right")}
          className="flex-1 rounded py-3 text-[13px]"
          style={{ fontFamily: gothic, background: t.accent, color: t.ink }}
        >
          スカウト
        </button>
      </div>
      <p
        className="mt-3 text-center text-[11px]"
        style={{ fontFamily: gothic, color: t.sub }}
      >
        左右にドラッグでも操作できます（{i + 1} / {girls.length}）
      </p>
    </div>
  );
}

/* =============================== app ============================== */

export default function Akari() {
  const [ageOk, setAgeOk] = useState(false);
  const [role, setRole] = useState("girl");
  const [tab, setTab] = useState("search");
  const t = THEMES[role];

  const [area, setArea] = useState("すべて");
  const [type, setType] = useState("すべて");
  const [perks, setPerks] = useState([]);
  const [sort, setSort] = useState("new");
  const [view, setView] = useState("list"); // list | swipe

  const [saved, setSaved] = useState([]);
  const [applied, setApplied] = useState([]);
  const [scouted, setScouted] = useState([]);

  const [openJob, setOpenJob] = useState(null);
  const [openGirl, setOpenGirl] = useState(null);
  const [trialDay, setTrialDay] = useState("今夜");
  const [scoutMsg, setScoutMsg] = useState(0);

  const [deals, setDeals] = useState([
    { id: "d1", side: "girl", jobId: 5, stage: 2, code: "418203", day: "今夜", worked: 0 },
    { id: "d2", side: "girl", jobId: 1, stage: 4, code: "770914", day: "先週", worked: 16 },
    { id: "d3", side: "shop", girlId: 2, stage: 3, code: "203551", day: "3日前", worked: 5 },
    { id: "d4", side: "shop", girlId: 5, stage: 4, code: "118840", day: "先月", worked: 22 },
    { id: "d5", side: "shop", girlId: 3, stage: 1, code: "965012", day: "明日", worked: 0 },
  ]);

  /* B : 明朝を端末フォント任せにせず確定させる */
  useEffect(() => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href =
      "https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@400;600&family=Zen+Kaku+Gothic+New:wght@400;500&display=swap";
    document.head.appendChild(l);
    return () => document.head.removeChild(l);
  }, []);

  const advance = (id) =>
    setDeals((s) =>
      s.map((d) =>
        d.id === id
          ? {
              ...d,
              stage: Math.min(4, d.stage + 1),
              worked: d.stage + 1 === 4 ? GUARANTEE_DAYS : d.worked,
            }
          : d
      )
    );

  const togglePerk = (p) =>
    setPerks((s) => (s.includes(p) ? s.filter((x) => x !== p) : [...s, p]));

  const jobs = useMemo(() => {
    let r = JOBS.filter(
      (j) =>
        (area === "すべて" || j.area === area) &&
        (type === "すべて" || j.type === type) &&
        perks.every((p) => j.perks.includes(p))
    );
    if (sort === "pay") r = [...r].sort((a, b) => b.max - a.max);
    if (sort === "trial") r = [...r].sort((a, b) => b.trial - a.trial);
    return r;
  }, [area, type, perks, sort]);

  const styles = `
    @keyframes akRise { from { opacity:0; transform: translateY(16px) } to { opacity:1; transform:none } }
    @keyframes akSheet { from { opacity:0; transform: translateY(24px) } to { opacity:1; transform:none } }
    .ak-rise { animation: akRise .55s cubic-bezier(.2,.7,.3,1) both }
    .ak-sheet { animation: akSheet .28s cubic-bezier(.2,.7,.3,1) both }
    @media (prefers-reduced-motion: reduce) {
      .ak-rise, .ak-sheet { animation: none }
    }
    *:focus-visible { outline: 2px solid currentColor; outline-offset: 2px }
  `;

  /* ---------------------------- 年齢確認 ---------------------------- */
  if (!ageOk) {
    return (
      <div
        className="flex min-h-screen items-center justify-center p-6"
        style={{ background: THEMES.girl.bg }}
      >
        <style>{styles}</style>
        <div className="ak-rise w-full max-w-sm text-center">
          <div
            className="mx-auto mb-7 h-16 w-px"
            style={{
              background: `linear-gradient(180deg, transparent, ${THEMES.girl.accent})`,
            }}
          />
          <h1
            style={{
              fontFamily: mincho,
              color: THEMES.girl.text,
              fontSize: 34,
              letterSpacing: "0.2em",
            }}
          >
            灯
          </h1>
          <p
            className="mt-3 text-[11px]"
            style={{ fontFamily: gothic, color: THEMES.girl.sub, letterSpacing: "0.22em" }}
          >
            AKARI ／ 夜職マッチング
          </p>
          <p
            className="mt-9 text-[13px] leading-relaxed"
            style={{ fontFamily: gothic, color: THEMES.girl.sub }}
          >
            18歳未満の方、および高校生の方はご利用いただけません。
            登録には年齢確認書類の提出が必要です。
          </p>
          <button
            onClick={() => setAgeOk(true)}
            className="mt-7 w-full rounded py-3 text-sm"
            style={{
              fontFamily: gothic,
              background: THEMES.girl.accent,
              color: THEMES.girl.ink,
            }}
          >
            18歳以上です（高校生ではありません）
          </button>
          <button
            className="mt-3 w-full rounded py-3 text-sm"
            style={{
              fontFamily: gothic,
              color: THEMES.girl.sub,
              border: `1px solid ${THEMES.girl.line}`,
            }}
          >
            18歳未満です
          </button>
        </div>
      </div>
    );
  }

  const savedJobs = JOBS.filter((j) => saved.includes(j.id));
  const girlDeals = deals.filter((d) => d.side === "girl");
  const shopDeals = deals.filter((d) => d.side === "shop");

  const celebFixed = girlDeals.reduce((sum, d) => {
    const j = JOBS.find((x) => x.id === d.jobId);
    if (!j) return sum;
    const f = feeOf(j.type);
    return sum + (d.stage >= 2 ? f.celebTrial : 0) + (d.stage >= 4 ? f.celebHire : 0);
  }, 0);
  const celebPending = girlDeals.reduce((sum, d) => {
    const j = JOBS.find((x) => x.id === d.jobId);
    return sum + (j && d.stage === 3 ? feeOf(j.type).celebHire : 0);
  }, 0);

  const MY_SHOP_TYPE = "ラウンジ";
  const sf = feeOf(MY_SHOP_TYPE);
  const feeFixed = shopDeals.reduce(
    (s, d) => s + (d.stage >= 2 ? sf.trial : 0) + (d.stage >= 4 ? sf.hire : 0),
    0
  );
  const feePending = shopDeals.reduce((s, d) => s + (d.stage === 3 ? sf.hire : 0), 0);

  return (
    <div className="min-h-screen pb-24" style={{ background: t.bg }}>
      <style>{styles}</style>

      {/* ヘッダー */}
      <header
        className="sticky top-0 z-40 px-4 pt-4 pb-3"
        style={{
          background: t.bg,
          borderBottom: `1px solid ${t.line}`,
          backgroundImage: `radial-gradient(130% 90% at 50% -10%, rgba(${t.glow},0.10), transparent 62%)`,
        }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-baseline gap-2">
            <span
              style={{
                fontFamily: mincho,
                color: t.text,
                fontSize: 21,
                letterSpacing: "0.16em",
              }}
            >
              灯
            </span>
            <span
              className="text-[10px]"
              style={{ fontFamily: gothic, color: t.sub, letterSpacing: "0.18em" }}
            >
              {role === "girl" ? "AKARI" : "AKARI for SHOP"}
            </span>
          </div>
          <div className="flex rounded-full p-0.5" style={{ border: `1px solid ${t.line}` }}>
            {[
              ["girl", "働く人"],
              ["shop", "お店"],
            ].map(([k, label]) => (
              <button
                key={k}
                onClick={() => {
                  setRole(k);
                  setTab("search");
                }}
                className="rounded-full px-3 py-1 text-[11px]"
                style={{
                  fontFamily: gothic,
                  background: role === k ? THEMES[k].accent : "transparent",
                  color: role === k ? THEMES[k].ink : t.sub,
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* ============================ 働く人 ============================ */}
      {role === "girl" && (
        <>
          {tab === "search" && (
            <>
              <div className="space-y-2 px-4 pt-4">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {["すべて", ...AREAS].map((a) => (
                    <Chip key={a} t={t} active={area === a} onClick={() => setArea(a)}>
                      {a}
                    </Chip>
                  ))}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {["すべて", ...TYPES].map((x) => (
                    <Chip key={x} t={t} active={type === x} onClick={() => setType(x)}>
                      {x}
                    </Chip>
                  ))}
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {PERKS.map((p) => (
                    <Chip
                      key={p}
                      t={t}
                      active={perks.includes(p)}
                      onClick={() => togglePerk(p)}
                    >
                      {p}
                    </Chip>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between px-4 pt-3 pb-2">
                <span className="text-[12px]" style={{ fontFamily: gothic, color: t.sub }}>
                  {jobs.length}件
                </span>
                <div className="flex gap-3">
                  {[
                    ["new", "新着"],
                    ["trial", "体入額"],
                    ["pay", "時給"],
                  ].map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setSort(k)}
                      className="text-[12px]"
                      style={{
                        fontFamily: gothic,
                        color: sort === k ? t.accent : t.sub,
                        borderBottom: `1px solid ${sort === k ? t.accent : "transparent"}`,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-4 px-4">
                {jobs.length === 0 ? (
                  <p
                    className="rounded-lg p-6 text-center text-[13px]"
                    style={{ fontFamily: gothic, color: t.sub, border: `1px dashed ${t.line}` }}
                  >
                    条件に合うお店がありません。こだわり条件を減らすと見つかります。
                  </p>
                ) : (
                  jobs.map((j, idx) => (
                    <JobCard
                      key={j.id}
                      job={j}
                      t={t}
                      delay={idx * 70}
                      onOpen={setOpenJob}
                      saved={saved.includes(j.id)}
                      applied={applied.includes(j.id)}
                      onSave={(id) =>
                        setSaved((s) =>
                          s.includes(id) ? s.filter((x) => x !== id) : [...s, id]
                        )
                      }
                    />
                  ))
                )}
              </div>
            </>
          )}

          {tab === "saved" && (
            <div className="space-y-4 px-4 pt-4">
              {savedJobs.length === 0 ? (
                <p
                  className="rounded-lg p-6 text-center text-[13px]"
                  style={{ fontFamily: gothic, color: t.sub, border: `1px dashed ${t.line}` }}
                >
                  気になるお店はまだありません。♡を押すとここに残ります。
                </p>
              ) : (
                savedJobs.map((j, idx) => (
                  <JobCard
                    key={j.id}
                    job={j}
                    t={t}
                    delay={idx * 70}
                    onOpen={setOpenJob}
                    saved
                    applied={applied.includes(j.id)}
                    onSave={(id) => setSaved((s) => s.filter((x) => x !== id))}
                  />
                ))
              )}
            </div>
          )}

          {tab === "status" && (
            <div className="space-y-3 px-4 pt-4">
              <div
                className="ak-rise rounded-lg p-4"
                style={{ background: t.surf, border: `1px solid ${t.line}` }}
              >
                <Lead
                  t={t}
                  label="受け取ったお祝い金"
                  value={yen(celebFixed)}
                  sub={
                    celebPending > 0
                      ? `${yen(celebPending)} は${GUARANTEE_DAYS}日勤務の達成後に確定します`
                      : "利用料はかかりません"
                  }
                />
              </div>

              {girlDeals.map((d, idx) => {
                const j = JOBS.find((x) => x.id === d.jobId);
                if (!j) return null;
                const f = feeOf(j.type);
                const next = [
                  null,
                  "体入に行ったと報告する",
                  "本入店したと報告する",
                  `${GUARANTEE_DAYS}日勤務を報告する`,
                  null,
                ][d.stage];
                return (
                  <div
                    key={d.id}
                    className="ak-rise rounded-lg p-4"
                    style={{
                      background: t.surf,
                      border: `1px solid ${t.line}`,
                      animationDelay: `${idx * 70}ms`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h3 style={{ fontFamily: mincho, color: t.text, fontSize: 17 }}>
                        {j.shop}
                      </h3>
                      <span
                        className="shrink-0 text-[11px]"
                        style={{ fontFamily: gothic, color: t.sub }}
                      >
                        体入 {d.day}
                      </span>
                    </div>
                    <p className="mt-1 text-[12px]" style={{ fontFamily: gothic, color: t.sub }}>
                      {j.area}・{j.type}／体入給 {yen(j.trial)}
                    </p>

                    <Stepper stage={d.stage} t={t} />
                    {d.stage >= 1 && d.stage < 3 && <TrialCode code={d.code} t={t} />}

                    <p className="mt-3 text-[11px]" style={{ fontFamily: gothic, color: t.sub }}>
                      お祝い金 体入 {yen(f.celebTrial)}
                      {d.stage >= 2 ? "（受取済）" : "（未）"}／入店 {yen(f.celebHire)}
                      {d.stage >= 4 ? "（受取済）" : "（未）"}
                    </p>

                    {d.stage === 3 && (
                      <p className="mt-1 text-[11px]" style={{ fontFamily: gothic, color: t.sub }}>
                        勤務 {d.worked}/{GUARANTEE_DAYS}日。あと{GUARANTEE_DAYS - d.worked}
                        日で確定します。
                      </p>
                    )}

                    {next && (
                      <div className="mt-3">
                        <Cta t={t} onClick={() => advance(d.id)}>
                          {next}
                        </Cta>
                      </div>
                    )}
                    {d.stage === 4 && (
                      <p className="mt-3 text-[11px]" style={{ fontFamily: gothic, color: t.accent }}>
                        お祝い金は翌週金曜に振込まれます。
                      </p>
                    )}
                  </div>
                );
              })}

              <p
                className="px-1 text-[11px] leading-relaxed"
                style={{ fontFamily: gothic, color: t.sub }}
              >
                報告は店舗側の報告と照合されます。体入コードが一致しない場合、お祝い金は保留になります。
              </p>
            </div>
          )}
        </>
      )}

      {/* ============================= お店 ============================= */}
      {role === "shop" && (
        <>
          {tab === "search" && (
            <>
              <div className="flex items-center justify-between px-4 pt-4">
                <p className="text-[12px]" style={{ fontFamily: gothic, color: t.sub }}>
                  在籍希望 {GIRLS.length}名
                </p>
                <div className="flex rounded-full p-0.5" style={{ border: `1px solid ${t.line}` }}>
                  {[
                    ["list", "一覧"],
                    ["swipe", "スワイプ"],
                  ].map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setView(k)}
                      className="rounded-full px-3 py-1 text-[11px]"
                      style={{
                        fontFamily: gothic,
                        background: view === k ? t.accent : "transparent",
                        color: view === k ? t.ink : t.sub,
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {view === "list" ? (
                <>
                  <p
                    className="px-4 pt-3 text-[11px] leading-relaxed"
                    style={{ fontFamily: gothic, color: t.sub }}
                  >
                    写真の見せ方は本人が選んでいます。スクリーンショットは記録され、店舗アカウントに通知されます。
                  </p>
                  <div className="space-y-4 px-4 pt-3">
                    {GIRLS.map((g, idx) => (
                      <GirlCard
                        key={g.id}
                        girl={g}
                        t={t}
                        delay={idx * 70}
                        onOpen={setOpenGirl}
                        scouted={scouted.includes(g.id)}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <SwipeDeck girls={GIRLS} t={t} onScout={(g) => setOpenGirl(g)} />
              )}
            </>
          )}

          {tab === "reward" && (
            <div className="space-y-3 px-4 pt-4">
              <div
                className="ak-rise rounded-lg p-4"
                style={{ background: t.surf, border: `1px solid ${t.line}` }}
              >
                <div className="flex items-end justify-between">
                  <Lead t={t} label="今月の確定額" value={yen(feeFixed)} />
                  <div className="text-right">
                    <p className="text-[10px]" style={{ fontFamily: gothic, color: t.sub }}>
                      仮計上
                    </p>
                    <p style={{ fontFamily: mincho, color: t.sub, fontSize: 20 }}>
                      {yen(feePending)}
                    </p>
                  </div>
                </div>
                <Rule t={t} />
                <p
                  className="text-[11px] leading-relaxed"
                  style={{ fontFamily: gothic, color: t.sub }}
                >
                  掲載料・スカウト送信料は無料。体入の実施（{yen(sf.trial)}）と、本入店から
                  {GUARANTEE_DAYS}日の勤務（{yen(sf.hire)}）にのみ課金します。
                  {GUARANTEE_DAYS}日未満で退店した場合、本入店分は請求しません。
                </p>
              </div>

              <div
                className="ak-rise rounded-lg p-4"
                style={{ background: t.surf, border: `1px solid ${t.line}`, animationDelay: "70ms" }}
              >
                <p className="text-[12px]" style={{ fontFamily: gothic, color: t.text }}>
                  今月の流入
                </p>
                <div className="mt-3 space-y-2">
                  {[
                    ["スカウト送信", shopDeals.length + scouted.length],
                    ["体入 確定", shopDeals.filter((d) => d.stage >= 1).length],
                    ["体入 実施", shopDeals.filter((d) => d.stage >= 2).length],
                    ["本入店", shopDeals.filter((d) => d.stage >= 3).length],
                    [`${GUARANTEE_DAYS}日 定着`, shopDeals.filter((d) => d.stage >= 4).length],
                  ].map(([label, n], idx, arr) => {
                    const max = Math.max(1, arr[0][1]);
                    return (
                      <div key={label} className="flex items-center gap-3">
                        <span
                          className="w-24 shrink-0 text-[11px]"
                          style={{ fontFamily: gothic, color: t.sub }}
                        >
                          {label}
                        </span>
                        <div className="h-4 flex-1" style={{ background: t.alt }}>
                          <div
                            className="h-full"
                            style={{
                              width: `${(n / max) * 100}%`,
                              background: t.accent,
                              opacity: idx >= 2 ? 0.9 : 0.4,
                            }}
                          />
                        </div>
                        <span
                          className="w-6 shrink-0 text-right text-[12px]"
                          style={{ fontFamily: mincho, color: t.text }}
                        >
                          {n}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {shopDeals.map((d, idx) => {
                const g = GIRLS.find((x) => x.id === d.girlId);
                if (!g) return null;
                const next = [
                  "体入日を確定する",
                  "体入コードを照合して確定",
                  "本入店を登録する",
                  `${GUARANTEE_DAYS}日勤務を承認する`,
                  null,
                ][d.stage];
                const charge = (d.stage >= 2 ? sf.trial : 0) + (d.stage >= 4 ? sf.hire : 0);
                return (
                  <div
                    key={d.id}
                    className="ak-rise rounded-lg p-4"
                    style={{
                      background: t.surf,
                      border: `1px solid ${t.line}`,
                      animationDelay: `${140 + idx * 70}ms`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <h3 style={{ fontFamily: mincho, color: t.text, fontSize: 17 }}>
                        {g.nick}
                        <span
                          className="ml-2 text-[11px]"
                          style={{ fontFamily: gothic, color: t.sub }}
                        >
                          {g.age}歳・{g.exp}
                        </span>
                      </h3>
                      <span
                        style={{ fontFamily: mincho, color: charge ? t.accent : t.sub, fontSize: 15 }}
                      >
                        {yen(charge)}
                      </span>
                    </div>

                    <Stepper stage={d.stage} t={t} />
                    {d.stage >= 1 && d.stage < 3 && <TrialCode code={d.code} t={t} />}

                    {d.stage === 3 && (
                      <p className="mt-2 text-[11px]" style={{ fontFamily: gothic, color: t.sub }}>
                        勤務 {d.worked}/{GUARANTEE_DAYS}日。ここで退店した場合、{yen(sf.hire)}{" "}
                        は請求されません。
                      </p>
                    )}

                    {next && (
                      <div className="mt-3">
                        <Cta t={t} onClick={() => advance(d.id)}>
                          {next}
                        </Cta>
                      </div>
                    )}
                  </div>
                );
              })}

              <p
                className="px-1 pb-2 text-[11px] leading-relaxed"
                style={{ fontFamily: gothic, color: t.sub }}
              >
                成果報酬の{yen(sf.celebHire)}相当は、お祝い金として本人に還元されます。
                アプリ外での直接契約が確認された場合、以降の紹介を停止します。
              </p>
            </div>
          )}

          {tab === "sent" && (
            <div className="space-y-3 px-4 pt-4">
              {scouted.length === 0 ? (
                <p
                  className="rounded-lg p-6 text-center text-[13px]"
                  style={{ fontFamily: gothic, color: t.sub, border: `1px dashed ${t.line}` }}
                >
                  送信したスカウトがここに並びます。
                </p>
              ) : (
                GIRLS.filter((g) => scouted.includes(g.id)).map((g, idx) => (
                  <div
                    key={g.id}
                    className="ak-rise rounded-lg p-4"
                    style={{
                      background: t.surf,
                      border: `1px solid ${t.line}`,
                      animationDelay: `${idx * 70}ms`,
                    }}
                  >
                    <div className="flex items-center justify-between">
                      <h3 style={{ fontFamily: mincho, color: t.text, fontSize: 17 }}>
                        {g.nick}
                      </h3>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px]"
                        style={{ fontFamily: gothic, color: t.accent, border: `1px solid ${t.accent}` }}
                      >
                        既読
                      </span>
                    </div>
                    <p className="mt-1.5 text-[12px]" style={{ fontFamily: gothic, color: t.sub }}>
                      希望 {yen(g.hope)}〜／{g.areas.join("・")}／{g.days.join("")}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      {/* 下部ナビ */}
      <nav
        className="fixed bottom-0 left-0 right-0 z-40 flex"
        style={{ background: t.bg, borderTop: `1px solid ${t.line}` }}
      >
        {(role === "girl"
          ? [
              ["search", "さがす"],
              ["saved", `気になる${saved.length ? " " + saved.length : ""}`],
              ["status", `進行中・お祝い金${applied.length ? " " + applied.length : ""}`],
            ]
          : [
              ["search", "さがす"],
              ["sent", `送信済み${scouted.length ? " " + scouted.length : ""}`],
              ["reward", "成果報酬"],
            ]
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className="flex-1 py-4 text-[12px]"
            style={{
              fontFamily: gothic,
              color: tab === k ? t.accent : t.sub,
              borderTop: `2px solid ${tab === k ? t.accent : "transparent"}`,
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* 体入申込 */}
      <Sheet open={!!openJob} onClose={() => setOpenJob(null)} t={t}>
        {openJob && (
          <div>
            <h2 style={{ fontFamily: mincho, color: t.text, fontSize: 22 }}>
              {openJob.shop}
            </h2>
            <p className="mt-1 text-[12px]" style={{ fontFamily: gothic, color: t.sub }}>
              {openJob.area}・{openJob.type}／{openJob.station}／{openJob.hours}
            </p>

            <div className="mt-4">
              <Lead
                t={t}
                label="体入時給"
                value={yen(openJob.trial)}
                sub={`本入店後 ${yen(openJob.min)}–${yen(openJob.max)} / 時`}
              />
            </div>

            <Rule t={t} />
            <p className="text-[13px] leading-relaxed" style={{ fontFamily: gothic, color: t.text }}>
              {openJob.note}
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {openJob.perks.map((p) => (
                <Tag key={p} t={t}>
                  {p}
                </Tag>
              ))}
            </div>

            <p className="mt-5 text-[12px]" style={{ fontFamily: gothic, color: t.sub }}>
              体入の希望日
            </p>
            <div className="mt-2 flex gap-2 overflow-x-auto">
              {["今夜", "明日", "今週末", "相談したい"].map((d) => (
                <Chip key={d} t={t} active={trialDay === d} onClick={() => setTrialDay(d)}>
                  {d}
                </Chip>
              ))}
            </div>

            <div className="mt-5">
              <Cta
                t={t}
                disabled={applied.includes(openJob.id)}
                onClick={() => {
                  setApplied((s) => [...new Set([...s, openJob.id])]);
                  setDeals((s) => [
                    {
                      id: "d" + Date.now(),
                      side: "girl",
                      jobId: openJob.id,
                      stage: 0,
                      code: code6(),
                      day: trialDay,
                      worked: 0,
                    },
                    ...s,
                  ]);
                  setOpenJob(null);
                  setTab("status");
                }}
              >
                {applied.includes(openJob.id) ? "申込み済み" : "この内容で体入を申し込む"}
              </Cta>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed" style={{ fontFamily: gothic, color: t.sub }}>
              申し込むと、ニックネーム・希望条件のみが店舗に送られます。条件が違った場合は当日でも辞退できます。
              お祝い金は体入の実施で {yen(feeOf(openJob.type).celebTrial)}、本入店から
              {GUARANTEE_DAYS}日の勤務で {yen(feeOf(openJob.type).celebHire)}。利用料はかかりません。
            </p>
          </div>
        )}
      </Sheet>

      {/* スカウト */}
      <Sheet open={!!openGirl} onClose={() => setOpenGirl(null)} t={t}>
        {openGirl && (
          <div>
            <div className="mb-4 overflow-hidden rounded-lg">
              <Portrait girl={openGirl} t={t} ratio="1 / 1" />
            </div>
            <h2 style={{ fontFamily: mincho, color: t.text, fontSize: 22 }}>
              {openGirl.nick}さんにスカウト
            </h2>
            <p className="mt-1 text-[12px]" style={{ fontFamily: gothic, color: t.sub }}>
              {openGirl.age}歳・{openGirl.exp}／希望 {yen(openGirl.hope)}〜／
              {openGirl.days.join("")}
            </p>

            <p className="mt-5 text-[12px]" style={{ fontFamily: gothic, color: t.sub }}>
              送る文面
            </p>
            <div className="mt-2 space-y-2">
              {[
                `${openGirl.nick}さん、はじめまして。ご希望の${openGirl.areas[0]}で、時給${yen(
                  openGirl.hope
                )}スタート・ノルマなしでご案内できます。まず体入だけでもいかがでしょうか。`,
                `${openGirl.nick}さんの「${openGirl.note}」を読んでご連絡しました。同じ条件の方が在籍しているので、シフトの相談がしやすいと思います。`,
                `${openGirl.nick}さん、条件面のご相談だけでも歓迎です。体入前に一度、店内をご覧いただくこともできます。`,
              ].map((x, i) => (
                <button
                  key={i}
                  onClick={() => setScoutMsg(i)}
                  className="w-full rounded-lg p-3 text-left text-[12px] leading-relaxed"
                  style={{
                    fontFamily: gothic,
                    background: t.alt,
                    color: scoutMsg === i ? t.text : t.sub,
                    border: `1px solid ${scoutMsg === i ? t.accent : t.line}`,
                  }}
                >
                  {x}
                </button>
              ))}
            </div>

            <div className="mt-5">
              <Cta
                t={t}
                disabled={scouted.includes(openGirl.id)}
                onClick={() => {
                  setScouted((s) => [...new Set([...s, openGirl.id])]);
                  setDeals((s) => [
                    {
                      id: "s" + Date.now(),
                      side: "shop",
                      girlId: openGirl.id,
                      stage: 0,
                      code: code6(),
                      day: "未定",
                      worked: 0,
                    },
                    ...s,
                  ]);
                  setOpenGirl(null);
                  setTab("reward");
                }}
              >
                {scouted.includes(openGirl.id) ? "送信済み" : "スカウトを送る"}
              </Cta>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed" style={{ fontFamily: gothic, color: t.sub }}>
              募集条件と異なる金額・業務内容の提示は、掲載停止の対象になります。
              送信は無料。課金は体入の実施（{yen(sf.trial)}）と、本入店から{GUARANTEE_DAYS}
              日の勤務（{yen(sf.hire)}）の時点のみ。
            </p>
          </div>
        )}
      </Sheet>
    </div>
  );
}
