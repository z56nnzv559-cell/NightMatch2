const TEXT: Record<string, string> = {
  "trial.report_reminder": "体入結果の報告を確認してください",
  "trial.awaiting_counterpart": "相手側の確認を待っています",
  "hire.confirm_request": "本入店の確認依頼があります",
  "invoice.sent": "請求に関する更新があります",
  "invoice.failed": "請求に関する確認が必要です",
  "fee.hire_reversed": "案件の状態が更新されました",
  "payout.held": "お祝い金の確認が必要です",
  "shop.listing_paused": "求人掲載の状態を確認してください",
};

type FallbackNotice = {
  id: string;
  template: string;
  deal_id: string | null;
  created_at: string;
};

let running = false;
let timer: number | null = null;

function safeText(template: string) {
  return TEXT[template] ?? "NightMatchに確認が必要なお知らせがあります";
}

function container() {
  let el = document.getElementById("nightmatch-fallback-inbox");
  if (el) return el;
  el = document.createElement("div");
  el.id = "nightmatch-fallback-inbox";
  Object.assign(el.style, {
    position: "fixed",
    left: "12px",
    right: "12px",
    bottom: "calc(12px + env(safe-area-inset-bottom))",
    zIndex: "9999",
    display: "grid",
    gap: "8px",
    maxWidth: "560px",
    margin: "0 auto",
  });
  document.body.appendChild(el);
  return el;
}

async function markSeen(id: string) {
  const res = await fetch(`/api/notifications/fallbacks/${encodeURIComponent(id)}/seen`, {
    method: "POST",
    credentials: "same-origin",
  });
  return res.ok;
}

function render(notices: FallbackNotice[]) {
  const root = container();
  const active = new Set(notices.map((notice) => notice.id));

  for (const child of [...root.children]) {
    const id = (child as HTMLElement).dataset.noticeId;
    if (id && !active.has(id)) child.remove();
  }

  for (const notice of notices) {
    if (root.querySelector(`[data-notice-id="${CSS.escape(notice.id)}"]`)) continue;

    const card = document.createElement("div");
    card.dataset.noticeId = notice.id;
    Object.assign(card.style, {
      background: "#241D2A",
      border: "1px solid #E2B968",
      borderRadius: "14px",
      padding: "12px",
      color: "#F4EEF6",
      boxShadow: "0 12px 30px rgba(0,0,0,.3)",
      fontFamily: "system-ui, sans-serif",
    });

    const label = document.createElement("div");
    label.textContent = "重要なお知らせ";
    Object.assign(label.style, { color: "#E2B968", fontSize: "11px", marginBottom: "4px" });

    const body = document.createElement("div");
    body.textContent = safeText(notice.template);
    Object.assign(body.style, { fontSize: "14px", lineHeight: "1.5" });

    const button = document.createElement("button");
    button.textContent = "確認しました";
    Object.assign(button.style, {
      marginTop: "9px",
      border: "0",
      borderRadius: "10px",
      padding: "8px 10px",
      background: "#E2B968",
      color: "#151018",
      fontWeight: "700",
      cursor: "pointer",
    });
    button.addEventListener("click", async () => {
      button.disabled = true;
      if (await markSeen(notice.id)) card.remove();
      else button.disabled = false;
    });

    card.append(label, body, button);
    root.appendChild(card);
  }

  if (root.children.length === 0) root.remove();
}

async function refresh() {
  try {
    const res = await fetch("/api/notifications/fallbacks", { credentials: "same-origin" });
    if (res.status === 401) {
      document.getElementById("nightmatch-fallback-inbox")?.remove();
      return;
    }
    if (!res.ok) return;
    const data = await res.json() as { notifications?: FallbackNotice[] };
    render(data.notifications ?? []);
  } catch {
    /* オフライン中は次のfocus/intervalで再試行する */
  }
}

export function startFallbackInbox() {
  if (running) return;
  running = true;
  void refresh();
  window.addEventListener("focus", refresh);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void refresh();
  });
  timer = window.setInterval(refresh, 15_000);
  window.addEventListener("beforeunload", () => {
    if (timer !== null) window.clearInterval(timer);
  }, { once: true });
}
