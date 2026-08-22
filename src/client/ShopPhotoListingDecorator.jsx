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

function makePlaceholder(name) {
  const visual = document.createElement("div");
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
  return visual;
}

function applyPhoto(media, entry, name) {
  const visualHost = media.querySelector('[data-nm-shop-visual="1"]');
  if (!visualHost) return;

  const urls = Array.isArray(entry?.urls) ? entry.urls.filter(Boolean) : [];
  const primary = entry?.primary || urls[0] || null;
  visualHost.replaceChildren();

  media.querySelector('[data-nm-photo-badge="1"]')?.remove();

  if (!primary) {
    visualHost.appendChild(makePlaceholder(name));
    media.removeAttribute("role");
    media.removeAttribute("tabindex");
    media.removeAttribute("aria-label");
    media.style.cursor = "default";
    media.onclick = null;
    media.onkeydown = null;
    return;
  }

  const image = document.createElement("img");
  image.src = primary;
  image.alt = `${name} 店舗写真`;
  Object.assign(image.style, MEDIA_FILL_STYLE, {
    objectFit: "cover",
    display: "block",
  });
  visualHost.appendChild(image);

  const galleryUrls = urls.length ? urls : [primary];
  const open = () => openPhotoGallery({ urls: galleryUrls, title: name });
  media.setAttribute("role", "button");
  media.setAttribute("tabindex", "0");
  media.setAttribute("aria-label", `${name}の写真を見る`);
  media.style.cursor = "zoom-in";
  media.onclick = open;
  media.onkeydown = (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      open();
    }
  };

  if (galleryUrls.length > 1) {
    const badge = document.createElement("div");
    badge.dataset.nmPhotoBadge = "1";
    badge.textContent = `写真 ${galleryUrls.length}枚`;
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
}

export default function ShopPhotoListingDecorator() {
  useEffect(() => {
    let cancelled = false;
    let photos = new Map();

    const refreshDecoratedPhotos = () => {
      document.querySelectorAll('[data-nm-shop-media="1"]').forEach((media) => {
        const name = media.dataset.nmShopName || "";
        if (name) applyPhoto(media, photos.get(name), name);
      });
    };

    const decorate = () => {
      if (cancelled) return;

      document.querySelectorAll(".nm2-job").forEach((card) => {
        if (card.dataset.nmShopPhotoDecorated === "1") return;

        const nameEl = card.firstElementChild;
        const metaEl = nameEl?.nextElementSibling;
        const name = String(nameEl?.textContent || "").trim();
        if (!nameEl || !name) return;

        const media = document.createElement("div");
        media.dataset.nmShopMedia = "1";
        media.dataset.nmShopName = name;
        Object.assign(media.style, MEDIA_FRAME_STYLE);

        const visualHost = document.createElement("div");
        visualHost.dataset.nmShopVisual = "1";
        Object.assign(visualHost.style, MEDIA_FILL_STYLE);
        visualHost.appendChild(makePlaceholder(name));

        const overlay = document.createElement("div");
        Object.assign(overlay.style, {
          position: "absolute",
          inset: "0",
          zIndex: "2",
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
        media.append(visualHost, overlay);
        card.prepend(media);
        card.dataset.nmShopPhotoDecorated = "1";

        applyPhoto(media, photos.get(name), name);
      });
    };

    const loadPhotos = () => api("/api/jobs?sort=new&limit=50")
      .then((data) => {
        if (cancelled) return;
        photos = new Map(
          (data.jobs || []).map((job) => {
            const primary = job.shop_photo_url || null;
            const urls = Array.isArray(job.shop_photo_urls) && job.shop_photo_urls.length
              ? job.shop_photo_urls.filter(Boolean)
              : primary ? [primary] : [];
            return [String(job.shop_name || "").trim(), { primary, urls }];
          })
        );
        refreshDecoratedPhotos();
        decorate();
      })
      .catch(() => {
        /* 写真APIが一時的に失敗しても、店舗カードの写真枠は必ず残す。 */
        decorate();
      });

    /* カードを先に描画する。セッション/API取得のタイミングには依存させない。 */
    decorate();
    loadPhotos();

    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    const onFocus = () => loadPhotos();
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);

    return () => {
      cancelled = true;
      observer.disconnect();
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
    };
  }, []);

  return null;
}
