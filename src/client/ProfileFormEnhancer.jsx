import React, { useEffect } from "react";

const PREFECTURES = [
  "北海道","青森県","岩手県","宮城県","秋田県","山形県","福島県",
  "茨城県","栃木県","群馬県","埼玉県","千葉県","東京都","神奈川県",
  "新潟県","富山県","石川県","福井県","山梨県","長野県","岐阜県","静岡県","愛知県","三重県",
  "滋賀県","京都府","大阪府","兵庫県","奈良県","和歌山県",
  "鳥取県","島根県","岡山県","広島県","山口県","徳島県","香川県","愛媛県","高知県",
  "福岡県","佐賀県","長崎県","熊本県","大分県","宮崎県","鹿児島県","沖縄県",
];

const C = { surface2: "#241D2A", line: "#372E40", text: "#F4EEF6", sub: "#A99CB0", gold: "#E2B968", mint: "#7DD2BB", danger: "#E57D8B" };

function prefectureKey(value) {
  return String(value || "").replace(/(都|府|県)$/u, "");
}

function parseArea(value) {
  const source = String(value || "").trim();
  const found = PREFECTURES.find((pref) => {
    const key = prefectureKey(pref);
    return source.startsWith(pref) || source.startsWith(key);
  });
  if (!found) return { prefecture: "", detail: source };
  const key = prefectureKey(found);
  const rest = source.startsWith(found) ? source.slice(found.length) : source.slice(key.length);
  return { prefecture: found, detail: rest.replace(/^[・\s/／-]+/u, "").trim() };
}

function controlStyle(node) {
  Object.assign(node.style, {
    width: "100%",
    boxSizing: "border-box",
    border: `1px solid ${C.line}`,
    background: C.surface2,
    color: C.text,
    borderRadius: "12px",
    padding: "12px 13px",
    fontSize: "16px",
    outline: "none",
  });
}

function smallLabel(text) {
  const span = document.createElement("span");
  span.textContent = text;
  Object.assign(span.style, { color: C.sub, fontSize: "11px" });
  return span;
}

function enhanceAreaInput(input, kind) {
  if (!input || input.dataset.nmPrefectureEnhanced === "1") return;
  input.dataset.nmPrefectureEnhanced = "1";

  const initial = parseArea(input.value);
  const wrap = document.createElement("div");
  wrap.dataset.nmPrefecturePicker = kind;
  Object.assign(wrap.style, { display: "grid", gridTemplateColumns: "1fr 1.15fr", gap: "8px", marginTop: "2px" });

  const prefBox = document.createElement("div");
  Object.assign(prefBox.style, { display: "grid", gap: "5px" });
  prefBox.appendChild(smallLabel("都道府県"));
  const select = document.createElement("select");
  select.required = true;
  controlStyle(select);
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "選択してください";
  select.appendChild(empty);
  for (const pref of PREFECTURES) {
    const option = document.createElement("option");
    option.value = pref;
    option.textContent = pref;
    select.appendChild(option);
  }
  select.value = initial.prefecture;
  prefBox.appendChild(select);

  const detailBox = document.createElement("div");
  Object.assign(detailBox.style, { display: "grid", gap: "5px" });
  detailBox.appendChild(smallLabel(kind === "worker" ? "希望エリア" : "市区町村・エリア"));
  const detail = document.createElement("input");
  detail.type = "text";
  detail.placeholder = kind === "worker" ? "例：中洲" : "例：中洲";
  detail.value = initial.detail;
  controlStyle(detail);
  detailBox.appendChild(detail);

  const sync = () => {
    const pref = select.value;
    const sub = detail.value.trim();
    input.value = pref ? `${pref}${sub ? `・${sub}` : ""}` : sub;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  select.addEventListener("change", sync);
  detail.addEventListener("input", sync);

  wrap.append(prefBox, detailBox);
  input.insertAdjacentElement("beforebegin", wrap);
  input.required = false;
  input.style.display = "none";
  sync();
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: "same-origin", ...options });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch {}
  if (!response.ok) throw new Error(body.error || `request_failed_${response.status}`);
  return body;
}

function injectShopPhoto(form) {
  if (!form || form.dataset.nmShopPhotoEnhanced === "1") return;
  form.dataset.nmShopPhotoEnhanced = "1";

  const box = document.createElement("div");
  Object.assign(box.style, {
    border: `1px solid ${C.line}`,
    background: C.surface2,
    borderRadius: "16px",
    padding: "14px",
    display: "grid",
    gap: "10px",
  });

  const title = document.createElement("div");
  title.textContent = "店舗写真";
  Object.assign(title.style, { color: C.text, fontWeight: "800", fontSize: "14px" });
  const hint = document.createElement("div");
  hint.textContent = "女性側の店舗プロフィールで使用するメイン写真です。JPEG・PNG・WebP、8MB以下。";
  Object.assign(hint.style, { color: C.sub, fontSize: "11px", lineHeight: "1.55" });

  const preview = document.createElement("img");
  preview.alt = "店舗プロフィール写真";
  Object.assign(preview.style, {
    display: "none",
    width: "100%",
    maxHeight: "230px",
    objectFit: "cover",
    borderRadius: "13px",
    border: `1px solid ${C.line}`,
  });

  const file = document.createElement("input");
  file.type = "file";
  file.accept = "image/jpeg,image/png,image/webp";
  controlStyle(file);
  Object.assign(file.style, { padding: "10px", fontSize: "13px" });

  const status = document.createElement("div");
  Object.assign(status.style, { color: C.sub, fontSize: "11px" });

  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "店舗写真を保存する";
  Object.assign(save.style, {
    border: 0,
    borderRadius: "12px",
    padding: "12px 14px",
    background: C.mint,
    color: "#151018",
    fontSize: "14px",
    fontWeight: "800",
  });

  let objectUrl = "";
  file.addEventListener("change", () => {
    const selected = file.files?.[0];
    if (!selected) return;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = URL.createObjectURL(selected);
    preview.src = objectUrl;
    preview.style.display = "block";
    status.textContent = "選択した写真を確認して保存してください。";
  });

  save.addEventListener("click", async () => {
    const selected = file.files?.[0];
    if (!selected) {
      status.textContent = "写真を選択してください。";
      status.style.color = C.danger;
      return;
    }
    save.disabled = true;
    save.textContent = "保存中…";
    status.style.color = C.sub;
    try {
      const fd = new FormData();
      fd.set("photo", selected);
      const result = await api("/api/shop/photo", { method: "POST", body: fd });
      preview.src = result.photoUrl;
      preview.style.display = "block";
      status.textContent = "店舗写真を保存しました。";
      status.style.color = C.mint;
    } catch (error) {
      status.textContent = `写真を保存できませんでした：${error.message}`;
      status.style.color = C.danger;
    } finally {
      save.disabled = false;
      save.textContent = "店舗写真を保存する";
    }
  });

  box.append(title, hint, preview, file, save, status);
  form.prepend(box);

  api("/api/shop/photo").then((result) => {
    if (result.photoUrl) {
      preview.src = result.photoUrl;
      preview.style.display = "block";
      status.textContent = "現在の店舗写真";
    }
  }).catch(() => {});
}

export default function ProfileFormEnhancer() {
  useEffect(() => {
    let session = null;
    let cancelled = false;

    api("/api/me").then((me) => { session = me?.session || null; scan(); }).catch(() => {});

    const scan = () => {
      if (cancelled) return;

      // 店舗の新規登録フォーム。都道府県を直接入力させない。
      document.querySelectorAll('form input[name="area"]').forEach((input) => {
        const form = input.closest("form");
        if (!form) return;
        if (form.querySelector('[name="trialPay"]')) return; // 求人作成フォームは対象外
        enhanceAreaInput(input, "shop");
      });

      // プロフィール編集画面。
      const dialog = document.querySelector('[role="dialog"]');
      const form = dialog?.querySelector("form");
      if (form) {
        const shopArea = form.querySelector('input[name="area"]');
        if (shopArea) enhanceAreaInput(shopArea, "shop");
        const workerArea = form.querySelector('input[name="hopeAreas"]');
        if (workerArea) enhanceAreaInput(workerArea, "worker");
        if (session?.kind === "shop") injectShopPhoto(form);
      }
    };

    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { cancelled = true; observer.disconnect(); };
  }, []);

  return null;
}
