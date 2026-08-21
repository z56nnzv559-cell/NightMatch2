import { useEffect } from "react";

const PERKS = ["体入OK", "送迎あり", "ノルマなし", "日払い", "未経験歓迎", "週1〜OK"];

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !(options.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const res = await fetch(path, { credentials: "same-origin", ...options, headers });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!res.ok) throw new Error(body.error || `request_failed_${res.status}`);
  return body;
}

function findJobForm(node = document) {
  return Array.from(node.querySelectorAll?.("form") || []).find((form) =>
    Array.from(form.querySelectorAll("button")).some((button) =>
      String(button.textContent || "").includes("求人を掲載する")
    )
  ) || null;
}

function setNativeValue(input, value) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  if (descriptor?.set) descriptor.set.call(input, value);
  else input.value = value;
  input.setAttribute("value", value);
}

export default function JobFormFix() {
  useEffect(() => {
    let cancelled = false;
    let businessType = "";

    const decorate = async () => {
      const form = findJobForm();
      if (!form) return;
      const input = form.querySelector('input[name="businessType"]');
      if (!input) return;

      input.autocomplete = "off";
      input.setAttribute("autocomplete", "off");
      input.setAttribute("aria-readonly", "true");
      input.readOnly = true;
      input.tabIndex = -1;
      input.placeholder = "店舗プロフィールから自動入力";

      if (!businessType) {
        try {
          const data = await api("/api/profile");
          businessType = String(data?.profile?.businessType || "").trim();
        } catch {
          return;
        }
      }
      if (!cancelled && businessType && input.value !== businessType) {
        setNativeValue(input, businessType);
      }
    };

    const onSubmit = async (event) => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || form !== findJobForm()) return;

      event.preventDefault();
      event.stopPropagation();
      if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();

      const submitButton = Array.from(form.querySelectorAll("button")).find((button) =>
        String(button.textContent || "").includes("求人を掲載する")
      );
      if (submitButton) submitButton.disabled = true;

      try {
        const profileData = await api("/api/profile");
        const profileBusinessType = String(profileData?.profile?.businessType || "").trim();
        const data = Object.fromEntries(new FormData(form));
        const resolvedBusinessType = profileBusinessType || String(data.businessType || "").trim();

        if (!resolvedBusinessType) {
          throw new Error("店舗プロフィールの業種が未設定です。プロフィール編集から業種を設定してください。");
        }

        await api("/api/jobs", {
          method: "POST",
          body: JSON.stringify({
            area: data.area,
            businessType: resolvedBusinessType,
            trialPay: Number(data.trialPay),
            hourlyMin: Number(data.hourlyMin),
            hourlyMax: Number(data.hourlyMax),
            hours: data.hours,
            body: data.body,
            perks: PERKS.filter((perk) => data[`perk:${perk}`] === "on"),
          }),
        });

        alert("求人を掲載しました。");
        window.location.reload();
      } catch (error) {
        alert(`求人を作成できませんでした: ${error?.message || error}`);
        if (submitButton) submitButton.disabled = false;
      }
    };

    decorate();
    const observer = new MutationObserver(() => decorate());
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener("submit", onSubmit, true);

    return () => {
      cancelled = true;
      observer.disconnect();
      document.removeEventListener("submit", onSubmit, true);
    };
  }, []);

  return null;
}
