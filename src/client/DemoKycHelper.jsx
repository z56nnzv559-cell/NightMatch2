import React, { useEffect, useState } from "react";

async function readJson(path, options) {
  const res = await fetch(path, { credentials: "same-origin", ...options });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!res.ok) throw new Error(body.error || `request_failed_${res.status}`);
  return body;
}

/*
 * workers.dev のデモ環境にだけ出す補助UI。
 * 働く本人はKYC、店舗は運営確認をデモ完了できる。
 * 本番ドメインでは /api/config が demoKycAvailable=false を返すため表示されない。
 */
export default function DemoKycHelper() {
  const [mode, setMode] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([readJson("/api/config"), readJson("/api/me")])
      .then(([config, me]) => {
        if (cancelled || !config.demoKycAvailable) return;

        if (
          me?.session?.kind === "worker" &&
          !me.ageVerified &&
          me.status !== "banned"
        ) {
          setMode("worker");
          return;
        }

        if (
          me?.session?.kind === "shop" &&
          !me.verified &&
          me.status !== "banned"
        ) {
          setMode("shop");
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  if (!mode) return null;

  const verify = async () => {
    setBusy(true);
    setError("");
    try {
      await readJson("/api/kyc/demo-verify", { method: "POST" });
      window.location.reload();
    } catch (err) {
      setError(String(err?.message || err));
      setBusy(false);
    }
  };

  const isShop = mode === "shop";

  return (
    <div
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 18,
        zIndex: 100,
        maxWidth: 560,
        margin: "0 auto",
        padding: 16,
        borderRadius: 18,
        border: "1px solid #E2B968",
        background: "rgba(27,22,32,.98)",
        color: "#F4EEF6",
        boxShadow: "0 16px 50px rgba(0,0,0,.45)",
      }}
    >
      <div style={{ color: "#E2B968", fontSize: 12, marginBottom: 6 }}>デモ環境</div>
      <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>
        {isShop
          ? "店舗確認をテスト完了して管理画面へ進む"
          : "本人確認をテスト完了して求人画面へ進む"}
      </div>
      <div style={{ color: "#A99CB0", fontSize: 12, lineHeight: 1.6, marginBottom: 12 }}>
        {isShop
          ? "このボタンは workers.dev の実機デモだけで有効です。正式公開では運営による所在地・営業許可等の確認に置き換わります。"
          : "このボタンは workers.dev の実機デモだけで有効です。正式公開では実際のKYC審査に置き換わります。"}
      </div>
      {error && <div style={{ color: "#E57D8B", fontSize: 12, marginBottom: 8 }}>{error}</div>}
      <button
        type="button"
        onClick={verify}
        disabled={busy}
        style={{
          width: "100%",
          border: 0,
          borderRadius: 12,
          padding: "13px 16px",
          fontWeight: 700,
          background: "#E2B968",
          color: "#151018",
          opacity: busy ? .6 : 1,
        }}
      >
        {busy
          ? "確認中…"
          : isShop
            ? "デモ店舗確認を完了する"
            : "デモ本人確認を完了する"}
      </button>
    </div>
  );
}
