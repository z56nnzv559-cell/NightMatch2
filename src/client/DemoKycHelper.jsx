import React, { useEffect, useRef, useState } from "react";

async function readJson(path, options) {
  const res = await fetch(path, { credentials: "same-origin", ...options });
  const text = await res.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
  if (!res.ok) {
    const error = new Error(body.error || `request_failed_${res.status}`);
    error.body = body;
    throw error;
  }
  return body;
}

const COLORS = {
  bg: "#100D14",
  surface: "#1B1620",
  surface2: "#241D2A",
  line: "#372E40",
  text: "#F4EEF6",
  sub: "#A99CB0",
  gold: "#E2B968",
  danger: "#E57D8B",
  ok: "#7DD2BB",
};

function ActionButton({ children, onClick, disabled, secondary = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        width: "100%",
        border: secondary ? `1px solid ${COLORS.line}` : 0,
        borderRadius: 12,
        padding: "13px 16px",
        fontWeight: 700,
        background: secondary ? COLORS.surface2 : COLORS.gold,
        color: secondary ? COLORS.text : "#151018",
        opacity: disabled ? .55 : 1,
      }}
    >
      {children}
    </button>
  );
}

function FilePicker({ label, capture = "environment", onChange, file }) {
  return (
    <label
      style={{
        display: "grid",
        gap: 8,
        padding: 14,
        borderRadius: 14,
        border: `1px solid ${COLORS.line}`,
        background: COLORS.surface2,
        color: COLORS.text,
        fontSize: 14,
      }}
    >
      <strong>{label}</strong>
      <input
        type="file"
        accept="image/jpeg,image/png,image/webp"
        capture={capture}
        onChange={(event) => onChange(event.target.files?.[0] || null)}
        style={{ color: COLORS.sub, fontSize: 13 }}
      />
      <span style={{ color: file ? COLORS.gold : COLORS.sub, fontSize: 12 }}>
        {file ? `選択済み：${file.name}` : "カメラで撮影、または写真を選択"}
      </span>
    </label>
  );
}

export default function DemoKycHelper() {
  const [mode, setMode] = useState(null);
  const [demoAvailable, setDemoAvailable] = useState(false);
  const [status, setStatus] = useState("not_submitted");
  const [statusNote, setStatusNote] = useState("");
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(1);
  const [documentType, setDocumentType] = useState("");
  const [frontFile, setFrontFile] = useState(null);
  const [backFile, setBackFile] = useState(null);
  const [selfieFile, setSelfieFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const launcherRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([readJson("/api/config"), readJson("/api/me")])
      .then(async ([config, me]) => {
        if (cancelled) return;
        const isDemo = Boolean(config.demoKycAvailable);
        setDemoAvailable(isDemo);

        if (
          me?.session?.kind === "worker" &&
          !me.ageVerified &&
          me.status !== "banned"
        ) {
          setMode("worker");
          try {
            const current = await readJson("/api/kyc/manual/status");
            if (!cancelled) {
              setStatus(current.status || "not_submitted");
              setStatusNote(current.note || "");
            }
          } catch {}
          return;
        }

        if (
          isDemo &&
          me?.session?.kind === "shop" &&
          !me.verified &&
          me.status !== "banned"
        ) {
          setMode("shop");
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (mode !== "worker") return undefined;

    const inject = () => {
      const heading = Array.from(document.querySelectorAll("h1")).find((node) =>
        node.textContent?.includes("求人を見る前に本人確認")
      );
      const card = heading?.closest("section");
      if (!card) return;

      if (launcherRef.current?.isConnected) launcherRef.current.remove();
      const box = document.createElement("div");
      box.dataset.nightmatchKycLauncher = "1";
      Object.assign(box.style, { display: "grid", gap: "8px", marginTop: "4px" });

      const button = document.createElement("button");
      button.type = "button";
      const pending = status === "pending";
      const failed = status === "failed";
      button.textContent = pending
        ? "本人確認書類を審査中"
        : failed
          ? "本人確認を再提出する"
          : "本人確認をはじめる";
      button.disabled = pending;
      Object.assign(button.style, {
        width: "100%",
        border: "0",
        borderRadius: "12px",
        padding: "14px 16px",
        fontWeight: "700",
        fontSize: "15px",
        background: pending ? COLORS.surface2 : COLORS.gold,
        color: pending ? COLORS.sub : "#151018",
        opacity: pending ? ".85" : "1",
      });
      if (!pending) button.addEventListener("click", () => setOpen(true));
      box.appendChild(button);

      if (pending) {
        const note = document.createElement("div");
        note.textContent = "運営が身分証とセルフィーを確認しています。承認後に求人機能が利用できます。";
        Object.assign(note.style, { color: COLORS.sub, fontSize: "12px", lineHeight: "1.6" });
        box.appendChild(note);
      } else if (failed && statusNote) {
        const note = document.createElement("div");
        note.textContent = `再提出理由：${statusNote}`;
        Object.assign(note.style, { color: COLORS.danger, fontSize: "12px", lineHeight: "1.6" });
        box.appendChild(note);
      }

      card.appendChild(box);
      launcherRef.current = box;
    };

    inject();
    const observer = new MutationObserver(inject);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      launcherRef.current?.remove();
      launcherRef.current = null;
    };
  }, [mode, status, statusNote]);

  if (!mode) return null;

  const resetFlow = () => {
    setOpen(false);
    setStep(1);
    setDocumentType("");
    setFrontFile(null);
    setBackFile(null);
    setSelfieFile(null);
    setBusy(false);
    setError("");
  };

  const submitManual = async () => {
    if (!frontFile || !selfieFile || (documentType === "license" && !backFile)) {
      setError("必要な写真をすべて選択してください");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("documentType", documentType);
      form.append("front", frontFile);
      if (documentType === "license" && backFile) form.append("back", backFile);
      form.append("selfie", selfieFile);
      await readJson("/api/kyc/manual", { method: "POST", body: form });
      setStatus("pending");
      resetFlow();
      window.location.reload();
    } catch (err) {
      const code = err?.body?.error || err?.message || "送信に失敗しました";
      setError(
        code === "invalid_or_missing_image"
          ? "画像はJPEG・PNG・WebP、1枚8MB以下で提出してください"
          : String(code)
      );
      setBusy(false);
    }
  };

  const verifyShopDemo = async () => {
    setBusy(true);
    setError("");
    try {
      await readJson("/api/kyc/demo-verify", { method: "POST" });
      window.location.reload();
    } catch (err) {
      setError(String(err?.message || err));
      setBusy(false);
    }
  };

  if (mode === "shop") {
    return (
      <div
        style={{
          position: "fixed",
          left: 16,
          right: 16,
          bottom: 104,
          zIndex: 100,
          maxWidth: 560,
          margin: "0 auto",
          padding: 16,
          borderRadius: 18,
          border: `1px solid ${COLORS.gold}`,
          background: "rgba(27,22,32,.98)",
          color: COLORS.text,
          boxShadow: "0 16px 50px rgba(0,0,0,.45)",
        }}
      >
        <div style={{ color: COLORS.gold, fontSize: 12, marginBottom: 6 }}>デモ環境</div>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
          店舗確認をテスト完了して管理画面へ進む
        </div>
        {error && <div style={{ color: COLORS.danger, fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <ActionButton onClick={verifyShopDemo} disabled={busy || !demoAvailable}>
          {busy ? "確認中…" : "デモ店舗確認を完了する"}
        </ActionButton>
      </div>
    );
  }

  return open ? (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "rgba(8,6,10,.86)",
        display: "grid",
        alignItems: "end",
        color: COLORS.text,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 620,
          maxHeight: "92vh",
          overflowY: "auto",
          margin: "0 auto",
          padding: "18px 16px calc(24px + env(safe-area-inset-bottom))",
          borderRadius: "24px 24px 0 0",
          border: `1px solid ${COLORS.line}`,
          background: COLORS.bg,
          boxShadow: "0 -18px 55px rgba(0,0,0,.5)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}>
          <div>
            <div style={{ color: COLORS.gold, fontSize: 12 }}>本人確認 {step}/4</div>
            <h2 style={{ margin: "4px 0 0", fontSize: 22 }}>本人確認を完了する</h2>
          </div>
          <button type="button" onClick={resetFlow} style={{ border: 0, background: "transparent", color: COLORS.sub, fontSize: 28 }}>×</button>
        </div>

        <div style={{ marginTop: 16, display: "grid", gap: 14 }}>
          {step === 1 && (
            <>
              <p style={{ margin: 0, color: COLORS.sub, fontSize: 14, lineHeight: 1.7 }}>
                本人確認書類とセルフィーをNightMatch運営が確認します。承認後に登録完了となります。
              </p>
              <button type="button" onClick={() => setDocumentType("mynumber")} style={{ padding: 16, borderRadius: 14, border: `1px solid ${documentType === "mynumber" ? COLORS.gold : COLORS.line}`, background: COLORS.surface, color: COLORS.text, textAlign: "left" }}>
                <strong>マイナンバーカード</strong>
                <span style={{ display: "block", marginTop: 5, color: COLORS.sub, fontSize: 12 }}>表面のみ。個人番号が記載された裏面は提出しません。</span>
              </button>
              <button type="button" onClick={() => setDocumentType("license")} style={{ padding: 16, borderRadius: 14, border: `1px solid ${documentType === "license" ? COLORS.gold : COLORS.line}`, background: COLORS.surface, color: COLORS.text, textAlign: "left" }}>
                <strong>運転免許証</strong>
                <span style={{ display: "block", marginTop: 5, color: COLORS.sub, fontSize: 12 }}>表面・裏面を撮影します。</span>
              </button>
              <ActionButton disabled={!documentType} onClick={() => setStep(2)}>次へ</ActionButton>
            </>
          )}

          {step === 2 && (
            <>
              <p style={{ margin: 0, color: COLORS.sub, fontSize: 14, lineHeight: 1.7 }}>
                文字・生年月日・顔写真がはっきり見えるように撮影してください。
              </p>
              <FilePicker label={documentType === "mynumber" ? "マイナンバーカード 表面" : "運転免許証 表面"} file={frontFile} onChange={setFrontFile} />
              {documentType === "license" && <FilePicker label="運転免許証 裏面" file={backFile} onChange={setBackFile} />}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <ActionButton secondary onClick={() => setStep(1)}>戻る</ActionButton>
                <ActionButton disabled={!frontFile || (documentType === "license" && !backFile)} onClick={() => setStep(3)}>次へ</ActionButton>
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <p style={{ margin: 0, color: COLORS.sub, fontSize: 14, lineHeight: 1.7 }}>
                本人確認書類の顔写真と照合するため、正面からセルフィーを撮影してください。
              </p>
              <FilePicker label="セルフィー" capture="user" file={selfieFile} onChange={setSelfieFile} />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <ActionButton secondary onClick={() => setStep(2)}>戻る</ActionButton>
                <ActionButton disabled={!selfieFile} onClick={() => setStep(4)}>確認へ</ActionButton>
              </div>
            </>
          )}

          {step === 4 && (
            <>
              <div style={{ padding: 14, borderRadius: 14, background: COLORS.surface, border: `1px solid ${COLORS.line}` }}>
                <div style={{ fontWeight: 700 }}>提出内容</div>
                <div style={{ marginTop: 8, color: COLORS.sub, fontSize: 13, lineHeight: 1.8 }}>
                  書類：{documentType === "mynumber" ? "マイナンバーカード（表面）" : "運転免許証（表面・裏面）"}<br />
                  セルフィー：撮影済み
                </div>
              </div>
              <div style={{ padding: 12, borderRadius: 12, border: `1px solid ${COLORS.gold}`, color: COLORS.gold, fontSize: 12, lineHeight: 1.7 }}>
                提出画像は非公開領域に保存し、運営による承認・却下後に削除します。審査が完了するまで求人・応募機能は利用できません。
              </div>
              {error && <div style={{ color: COLORS.danger, fontSize: 12 }}>{error}</div>}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <ActionButton secondary disabled={busy} onClick={() => setStep(3)}>戻る</ActionButton>
                <ActionButton disabled={busy} onClick={submitManual}>{busy ? "送信中…" : "本人確認を提出する"}</ActionButton>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  ) : null;
}
