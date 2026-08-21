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

function absoluteUrl(value) {
  try { return new URL(value, window.location.origin).href; } catch { return String(value || ""); }
}

export default function WorkerPhotoGalleryDecorator() {
  useEffect(() => {
    let cancelled = false;
    let ready = false;
    let workerByPhoto = new Map();

    const decorate = () => {
      if (cancelled || !ready) return;
      document.querySelectorAll(".nm2-person img").forEach((image) => {
        if (image.dataset.nmWorkerGallery === "1") return;
        const worker = workerByPhoto.get(absoluteUrl(image.getAttribute("src")));
        if (!worker) return;

        image.dataset.nmWorkerGallery = "1";
        image.style.cursor = "zoom-in";
        image.setAttribute("title", "タップして写真を見る");
        image.addEventListener("click", async (event) => {
          event.preventDefault();
          event.stopPropagation();
          let urls = worker.photoUrl ? [worker.photoUrl] : [];
          try {
            const data = await api(`/api/workers/${encodeURIComponent(worker.id)}/photos`);
            const fetched = (data.photos || []).map((photo) => photo.url).filter(Boolean);
            if (fetched.length) urls = fetched;
          } catch {}
          openPhotoGallery({ urls, title: worker.nickname || "プロフィール写真" });
        });
      });
    };

    api("/api/me").then((me) => {
      if (cancelled || me?.session?.kind !== "shop") return null;
      return api("/api/workers?limit=50");
    }).then((data) => {
      if (cancelled || !data) return;
      workerByPhoto = new Map(
        (data.workers || [])
          .filter((worker) => worker.photoUrl)
          .map((worker) => [absoluteUrl(worker.photoUrl), worker])
      );
      ready = true;
      decorate();
    }).catch(() => {
      ready = true;
    });

    const observer = new MutationObserver(decorate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { cancelled = true; observer.disconnect(); };
  }, []);

  return null;
}
