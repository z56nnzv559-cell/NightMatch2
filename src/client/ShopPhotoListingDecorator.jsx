import React, { useEffect } from "react";

async function api(path) {
  const response = await fetch(path, { credentials: "same-origin" });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) throw new Error(body.error || `request_failed_${response.status}`);
  return body;
}

export default function ShopPhotoListingDecorator() {
  useEffect(() => {
    let cancelled = false;
    let photos = new Map();

    const decorate = () => {
      if (cancelled || !photos.size) return;
      document.querySelectorAll('.nm2-job').forEach((card) => {
        if (card.dataset.nmShopPhotoDecorated === "1") return;
        const name = String(card.firstElementChild?.textContent || "").trim();
        const url = photos.get(name);
        if (!url) return;
        const img = document.createElement("img");
        img.src = url;
        img.alt = `${name} 店舗写真`;
        Object.assign(img.style, {
          width: "100%",
          aspectRatio: "16 / 9",
          objectFit: "cover",
          display: "block",
          borderRadius: "13px",
          marginBottom: "13px",
          background: "#241D2A",
        });
        card.prepend(img);
        card.dataset.nmShopPhotoDecorated = "1";
      });
    };

    api("/api/me").then((me) => {
      if (cancelled || me?.session?.kind !== "worker") return null;
      return api("/api/jobs?sort=new&limit=50");
    }).then((data) => {
      if (cancelled || !data) return;
      photos = new Map((data.jobs || []).filter((job) => job.shop_photo_url).map((job) => [String(job.shop_name || "").trim(), job.shop_photo_url]));
      decorate();
    }).catch(() => {});

    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { cancelled = true; observer.disconnect(); };
  }, []);
  return null;
}
