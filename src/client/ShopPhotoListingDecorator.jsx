import React, { useEffect } from "react";
import { openPhotoGallery } from "./photoGallery.js";

async function api(path) {
  const response = await fetch(path, { credentials: "same-origin" });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) throw new Error(body.error || `request_failed_${response.status}`);
  return body;
}

const MEDIA_FRAME_STYLE = {
  position: "relative",
  width: "100%",
  minHeight: "210px",
  borderRadius: "20px",
  border: "1px solid #372E40",
  background: "#241D2A",
  overflow: "hidden",
  marginBottom: "14px",
};

const MEDIA_FILL_STYLE = {
  position: "absolute",
  inset: "0",
  width: "100%",
  height: "100%",
};

export default function ShopPhotoListingDecorator() {
  useEffect(() => {
    let cancelled = false;
    let ready = false;
    let photos = new Map();

    const decorate = () => {
      if (cancelled || !ready) return;

      document.querySelectorAll(".nm2-job").forEach((card) => {
        if (card.dataset.nmShopPhotoDecorated === "1") return;

        const nameEl = card.firstElementChild;
        const metaEl = nameEl?.nextElementSibling;
        const name = String(nameEl?.textContent || "").trim();
        if (!nameEl || !name) return;

        const media = document.createElement("div");
        Object.assign(media.style, MEDIA_FRAME_STYLE);

        const entry = photos.get(name);
        const urls = entry?.urls || [];
        const url = entry?.primary || null;
        let visual;
        if (url) {
          visual = document.createElement("img");
          visual.src = url;
          visual.alt = `${name} 店舗写真`;
          Object.assign(visual.style, MEDIA_FILL_STYLE, {
            objectFit: "cover",
            display: "block",
          });

          media.setAttribute("role", "button");
          media.setAttribute("tabindex", "0");
          media.setAttribute("aria-label", `${name}の写真を見る`);
          media.style.cursor = "zoom-in";
          const open = () => openPhotoGallery({ urls: urls.length ? urls : [url], title: name });
          media.addEventListener("click", open);
          media.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              open();
            }
          });

          if (urls.length > 1) {
            const badge = document.createElement("div");
            badge.textContent = `写真 ${urls.length}枚`;
            Object.assign(badge.style, {
              position: "absolute",
              top: "12px",
              right: "12px",
              zIndex: "3",
              padding: "6px 9px",
              borderRadius: "999px",
              background: "rgba(10,8,13,.72)",
              color: "#FFFFFF",
              fontSize: "11px",
              fontWeight: "800",
              pointerEvents: "none",
            });
            media.appendChild(badge);
          }
        } else {
          visual = document.createElement("div");
          visual.setAttribute("aria-label", `${name} 店舗写真未登録`);
          visual.textContent = Array.from(name)[0] || "店";
          Object.assign(visual.style, MEDIA_FILL_STYLE, {
            display: "grid",
            placeItems: "center",
            background: "linear-gradient(135deg, #342A3C 0%, #1E1825 100%)",
            color: "#E2B968",
            fontSize: "56px",
            fontWeight: "850",
          });
        }

        const overlay = document.createElement("div");
        Object.assign(overlay.style, {
          position: "absolute",
          inset: "0",
          display: "flex",
          alignItems: "flex-end",
          padding: "18px",
          background: "linear-gradient(180deg, rgba(10,8,13,.08) 0%, rgba(10,8,13,.38) 48%, rgba(10,8,13,.92) 100%)",
          boxSizing: "border-box",
          pointerEvents: "none",
        });

        const textWrap = document.createElement("div");
        Object.assign(textWrap.style, {
          minWidth: "0",
          width: "100%",
        });

        Object.assign(nameEl.style, {
          margin: "0",
          color: "#FFFFFF",
          fontSize: "24px",
          fontWeight: "850",
          lineHeight: "1.25",
          textShadow: "0 2px 12px rgba(0,0,0,.55)",
        });

        if (metaEl) {
          Object.assign(metaEl.style, {
            marginTop: "6px",
            color: "rgba(255,255,255,.9)",
            fontSize: "14px",
            lineHeight: "1.4",
            textShadow: "0 2px 10px rgba(0,0,0,.5)",
          });
        }

        textWrap.appendChild(nameEl);
        if (metaEl) textWrap.appendChild(metaEl);
        overlay.appendChild(textWrap);
        media.appendChild(visual);
        media.appendChild(overlay);
        card.prepend(media);
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
          .map((job) => {
            const primary = job.shop_photo_url;
            const urls = Array.isArray(job.shop_photo_urls) && job.shop_photo_urls.length
              ? job.shop_photo_urls.filter(Boolean)
              : [primary];
            return [String(job.shop_name || "").trim(), { primary, urls }];
          })
      );
      ready = true;
      decorate();
    }).catch(() => {
      ready = true;
      decorate();
    });

    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { cancelled = true; observer.disconnect(); };
  }, []);
  return null;
}
