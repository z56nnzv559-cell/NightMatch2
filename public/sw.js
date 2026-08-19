/* NightMatch Push Service Worker
   Push payloadには template と dealId 以外を期待しない。
   金額・店名・会話本文はロック画面に出さない。 */

const TEXT = {
  "deal.new_application": "新しい応募が届きました",
  "message.received": "新しいメッセージがあります",
  "trial.report_reminder": "体入結果の報告を確認してください",
  "trial.awaiting_counterpart": "相手側の確認を待っています",
  "hire.confirm_request": "本入店の確認依頼があります",
  "shop.listing_paused": "求人掲載の状態を確認してください",
  "invoice.drafted": "請求の確認事項があります",
  "invoice.sent": "請求に関する更新があります",
  "invoice.failed": "請求に関する確認が必要です",
  "fee.hire_reversed": "案件の状態が更新されました",
  "payout.held": "お祝い金の確認が必要です",
};

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const template = typeof payload.template === "string" ? payload.template : "";
  const dealId = typeof payload.dealId === "string" ? payload.dealId : "";
  const body = TEXT[template] || "NightMatchに新しいお知らせがあります";

  event.waitUntil(
    self.registration.showNotification("NightMatch", {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/badge-96.png",
      tag: dealId ? `deal:${dealId}:${template}` : `notice:${template || "generic"}`,
      renotify: Boolean(dealId),
      data: { dealId },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const dealId = event.notification.data?.dealId || "";
  const target = dealId ? `/?dealId=${encodeURIComponent(dealId)}` : "/";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          if ("navigate" in client) await client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    })
  );
});
