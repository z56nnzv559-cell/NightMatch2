import React, { useEffect } from "react";

async function api(path) {
  const response = await fetch(path, { credentials: "same-origin" });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) throw new Error(body.error || `request_failed_${response.status}`);
  return body;
}

const ICON_STYLE = {
  width: "54px",
  height: "54px",
  flex: "0 0 54px",
  borderRadius: "14px",
  border: "1px solid #372E40",
  background: "#241D2A",
};

export default function ShopPhotoListingDecorator() {
  useEffect(() => {
    let cancelled = false;
    let photos = new Map();

    const decorate = () => {
      if (cancelled) return;

      document.querySelectorAll(".nm2-job").forEach((card) => {
        if (card.dataset.nmShopPhotoDecorated === "1") return;

        const nameEl = card.firstElementChild;
        const metaEl = nameEl?.nextElementSibling;
        const name = String(nameEl?.textContent || "").trim();
        if (!nameEl || !name) return;

        const header = document.createElement("div");
        Object.assign(header.style, {
          display: "flex",
          alignItems: "center",
          gap: "11px",
          minWidth: "0",
        });

        const url = photos.get(name);
        let icon;
        if (url) {
          icon = document.createElement("img");
          icon.src = url;
          icon.alt = `${name} 店舗写真`;
          Object.assign(icon.style, ICON_STYLE, {
            objectFit: "cover",
            display: "block",
          });
        } else {
          icon = document.createElement("div");
          icon.setAttribute("aria-label", `${name} 店舗写真未登録`);
          icon.textContent = Array.from(name)[0] || "店";
          Object.assign(icon.style, ICON_STYLE, {
            display: "grid",
            placeItems: "center",
            color: "#E2B968",
            fontSize: "20px",
            fontWeight: "850",
          });
        }

        const text = document.createElement("div");
        Object.assign(text.style, { minWidth: "0", flex: "1" });
        text.appendChild(nameEl);
        if (metaEl) text.appendChild(metaEl);

        header.appendChild(icon);
        header.appendChild(text);
        card.prepend(header);
        card.dataset.nmShopPhotoDecorated = "1";
      });
    };

    api("/api/me").then((me) => {
      if (cancelled || me?.session?.kind !== "worker") return null;
      return api("/api/jobs?sort=new&limit=50");
    }).then((data) => {
      if (cancelled || !data) return;
      photos = new Map(
        (data.jobs || [])
          .filter((job) => job.shop_photo_url)
          .map((job) => [String(job.shop_name || "").trim(), job.shop_photo_url])
      );
      decorate();
    }).catch(() => {
      // 写真取得に失敗しても、一覧には店舗アイコンのプレースホルダーを表示する。
      decorate();
    });

    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { cancelled = true; observer.disconnect(); };
  }, []);
  return null;
}
