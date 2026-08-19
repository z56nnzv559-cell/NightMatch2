import React, { useEffect, useState } from "react";

const TEXT = {
  "trial.report_reminder": "体入結果の報告を確認してください",
  "trial.awaiting_counterpart": "相手側の6桁報告を待っています",
  "hire.confirm_request": "本入店の確認依頼があります",
  "payout.held": "お祝い金について運営の確認が必要です",
};

function messageFor(template) {
  return TEXT[template] || "NightMatchから確認が必要な通知があります";
}

export default function FallbackInbox() {
  const [items, setItems] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/fallback-notifications", { credentials: "same-origin" })
      .then(async (res) => {
        if (res.status === 401 || res.status === 403) return { notifications: [] };
        if (!res.ok) throw new Error(`fallback_notifications_${res.status}`);
        return res.json();
      })
      .then((body) => {
        if (!cancelled) setItems(Array.isArray(body.notifications) ? body.notifications : []);
      })
      .catch((error) => console.error("NightMatch fallback notification load failed", error));
    return () => {
      cancelled = true;
    };
  }, []);

  const acknowledge = async (id) => {
    try {
      const res = await fetch("/api/me/fallback-notifications/ack", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
      if (!res.ok) throw new Error(`fallback_ack_${res.status}`);
      setItems((current) => current.filter((item) => item.id !== id));
    } catch (error) {
      console.error("NightMatch fallback notification ack failed", error);
    }
  };

  if (!items.length) return null;

  return (
    <aside
      aria-live="polite"
      className="fixed inset-x-3 top-3 z-[100] mx-auto grid max-w-lg gap-2"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-2xl border p-4 shadow-2xl"
          style={{ background: "#1B1620", borderColor: "#E2B968", color: "#F4EEF6" }}
        >
          <div className="text-[11px] font-semibold tracking-[.12em]" style={{ color: "#E2B968" }}>
            見逃した重要通知
          </div>
          <div className="mt-1 text-sm font-semibold">{messageFor(item.template)}</div>
          <div className="mt-1 text-xs" style={{ color: "#A99CB0" }}>
            Push通知が端末に届かなかったため、ログイン時に表示しています。
          </div>
          <button
            type="button"
            onClick={() => acknowledge(item.id)}
            className="mt-3 rounded-xl px-3 py-2 text-xs font-semibold"
            style={{ background: "#E2B968", color: "#151018" }}
          >
            確認しました
          </button>
        </div>
      ))}
    </aside>
  );
}
