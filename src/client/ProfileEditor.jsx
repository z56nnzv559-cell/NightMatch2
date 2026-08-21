import React, { useCallback, useEffect, useState } from "react";

const TYPES = ["キャバクラ", "ラウンジ", "ガールズバー", "スナック", "コンカフェ"];
const COLORS = {
  bg: "#100D14",
  surface: "#1B1620",
  surface2: "#241D2A",
  line: "#372E40",
  text: "#F4EEF6",
  sub: "#A99CB0",
  gold: "#E2B968",
  mint: "#7DD2BB",
  danger: "#E57D8B",
};

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

function splitList(value) {
  return String(value || "")
    .split(/[,、\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function messageFor(error) {
  const code = String(error?.message || error);
  if (code === "birth_date_locked_after_verification") return "本人確認済みの生年月日は変更できません。変更が必要な場合は運営確認が必要です。";
  if (code === "invalid_hope_hourly") return "希望時給を正しい金額で入力してください。";
  if (code === "invalid_business_type") return "業種を選択肢から選んでください。";
  if (code === "invalid_profile_field") return "入力内容が長すぎるか、必須項目が未入力です。";
  if (code === "fee_plan_not_found") return "この業種の料金設定が見つかりません。運営側の設定を確認してください。";
  if (code === "unsupported_image") return "写真は8MB以下のJPEG・PNG・WebPを選んでください。";
  if (code === "original_required") return "アップロードする写真を選んでください。";
  if (code === "unauthorized") return "ログイン状態が切れています。もう一度ログインしてください。";
  return `保存できませんでした: ${code}`;
}

const inputStyle = {
  width: "100%",
  boxSizing: "border-box",
  border: `1px solid ${COLORS.line}`,
  background: COLORS.surface2,
  color: COLORS.text,
  borderRadius: 12,
  padding: "12px 13px",
  fontSize: 16,
  outline: "none",
};

function Label({ title, hint, children }) {
  return (
    <label style={{ display: "grid", gap: 6, color: COLORS.sub, fontSize: 12 }}>
      <span>{title}</span>
      {children}
      {hint && <span style={{ fontSize: 11, lineHeight: 1.5 }}>{hint}</span>}
    </label>
  );
}

export default function ProfileEditor() {
  const [session, setSession] = useState(null);
  const [open, setOpen] = useState(false);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photoPreview, setPhotoPreview] = useState("");

  const refreshSession = useCallback(async () => {
    try {
      const me = await api("/api/me");
      setSession(me?.session || null);
      return me?.session || null;
    } catch {
      return null;
    }
  }, []);

  const openEditor = useCallback(async () => {
    setError("");
    setLoading(true);
    try {
      const current = await refreshSession();
      if (!current) return setSession(null);
      const data = await api("/api/profile");
      setProfile(data.profile);
      setOpen(true);
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setLoading(false);
    }
  }, [refreshSession]);

  useEffect(() => {
    let cancelled = false;
    refreshSession();
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (cancelled || tries > 8) return clearInterval(timer);
      refreshSession();
    }, 3000);
    const onFocus = () => refreshSession();
    window.addEventListener("focus", onFocus);
    window.addEventListener("pageshow", onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pageshow", onFocus);
    };
  }, [refreshSession]);

  useEffect(() => {
    if (!session) return undefined;

    let launcher = null;
    const mountLauncher = () => {
      if (launcher?.isConnected) return;
      const headerInner = document.querySelector("header > div");
      if (!headerInner) return;

      const existing = headerInner.querySelector('[data-nightmatch-profile-launcher="1"]');
      if (existing) {
        launcher = existing;
        return;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.dataset.nightmatchProfileLauncher = "1";
      button.textContent = "プロフィール編集";
      button.setAttribute("aria-label", "プロフィールを編集");
      Object.assign(button.style, {
        marginLeft: "auto",
        marginRight: "12px",
        border: `1px solid ${COLORS.gold}`,
        borderRadius: "999px",
        padding: "7px 10px",
        background: "transparent",
        color: COLORS.gold,
        fontSize: "11px",
        fontWeight: "700",
        whiteSpace: "nowrap",
        flexShrink: "0",
      });
      button.addEventListener("click", openEditor);

      const logout = Array.from(headerInner.querySelectorAll("button")).find((item) =>
        String(item.textContent || "").includes("ログアウト")
      );
      if (logout) headerInner.insertBefore(button, logout);
      else headerInner.appendChild(button);
      launcher = button;
    };

    mountLauncher();
    const observer = new MutationObserver(mountLauncher);
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      if (launcher?.dataset?.nightmatchProfileLauncher === "1") {
        launcher.removeEventListener("click", openEditor);
        launcher.remove();
      }
    };
  }, [session, openEditor]);

  useEffect(() => () => {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
  }, [photoPreview]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const data = Object.fromEntries(form);
    const selectedPhoto = form.get("photo");

    try {
      let payload;
      if (profile.role === "worker") {
        payload = {
          nickname: data.nickname,
          birthDate: data.birthDate,
          hopeHourly: data.hopeHourly,
          hopeAreas: splitList(data.hopeAreas),
          hopeTypes: TYPES.filter((type) => data[`type:${type}`] === "on"),
          availableDays: splitList(data.availableDays),
          bio: data.bio,
        };
      } else {
        payload = {
          name: data.name,
          area: data.area,
          businessType: data.businessType,
          station: data.station,
        };
      }

      const result = await api("/api/profile", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      let photoSaved = false;
      if (profile.role === "worker" && selectedPhoto instanceof File && selectedPhoto.size > 0) {
        const photoForm = new FormData();
        photoForm.set("original", selectedPhoto);
        photoForm.set("face_mode", String(data.photoFaceMode || "open"));
        photoForm.set("make_primary", "1");
        await api("/api/me/photos", { method: "POST", body: photoForm });
        photoSaved = true;
      }

      setProfile(result.profile);
      if (result.requiresReverification) {
        alert("プロフィールを保存しました。エリアまたは業種を変更したため、店舗確認が再度必要です。デモ環境ではデモ店舗確認をもう一度実行できます。");
      } else if (photoSaved) {
        alert("プロフィールと写真を保存しました。");
      } else {
        alert("プロフィールを保存しました。");
      }
      window.location.reload();
    } catch (err) {
      setError(messageFor(err));
      setSaving(false);
    }
  };

  if (!session) return null;

  return (
    <>
      {open && profile && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 220,
            background: "rgba(0,0,0,.72)",
            overflowY: "auto",
            padding: "20px 14px 40px",
          }}
        >
          <div
            style={{
              maxWidth: 560,
              margin: "20px auto",
              border: `1px solid ${COLORS.line}`,
              background: COLORS.surface,
              color: COLORS.text,
              borderRadius: 20,
              padding: 18,
              boxShadow: "0 24px 70px rgba(0,0,0,.55)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ color: COLORS.gold, fontSize: 12, marginBottom: 3 }}>{profile.role === "worker" ? "働く本人" : "店舗"}</div>
                <h2 style={{ margin: 0, fontSize: 22 }}>プロフィール編集</h2>
              </div>
              <button type="button" onClick={() => setOpen(false)} style={{ border: 0, background: "transparent", color: COLORS.sub, fontSize: 14 }}>閉じる</button>
            </div>

            <form onSubmit={save} style={{ display: "grid", gap: 14 }}>
              {profile.role === "worker" ? (
                <>
                  <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 16, padding: 14, display: "grid", gap: 10, background: COLORS.surface2 }}>
                    <div>
                      <div style={{ color: COLORS.text, fontSize: 14, fontWeight: 700 }}>プロフィール写真</div>
                      <div style={{ color: COLORS.sub, fontSize: 11, lineHeight: 1.5, marginTop: 3 }}>新しい写真を選ぶと、保存時にメイン写真として登録されます。</div>
                    </div>
                    {photoPreview && (
                      <img src={photoPreview} alt="選択したプロフィール写真" style={{ width: 112, height: 112, borderRadius: 14, objectFit: "cover", border: `1px solid ${COLORS.line}` }} />
                    )}
                    <input
                      name="photo"
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={(event) => {
                        const file = event.currentTarget.files?.[0];
                        setPhotoPreview(file ? URL.createObjectURL(file) : "");
                      }}
                      style={{ ...inputStyle, padding: "10px 11px", fontSize: 13 }}
                    />
                    <Label title="写真の公開方法" hint="顔を出したくない場合は、ぼかしまたは非公開を選べます">
                      <select name="photoFaceMode" defaultValue="open" style={inputStyle}>
                        <option value="open">顔出しで公開</option>
                        <option value="blur">強めにぼかして公開</option>
                        <option value="none">体入成立まで非公開</option>
                      </select>
                    </Label>
                  </div>

                  <Label title="ニックネーム"><input name="nickname" required maxLength={40} defaultValue={profile.nickname} style={inputStyle} /></Label>
                  <Label title="生年月日" hint={profile.ageVerified ? "本人確認済みのため変更できません" : "本人確認前のみ変更できます"}>
                    <input name="birthDate" type="date" required defaultValue={profile.birthDate} disabled={profile.ageVerified} style={{ ...inputStyle, opacity: profile.ageVerified ? .55 : 1 }} />
                    {profile.ageVerified && <input type="hidden" name="birthDate" value={profile.birthDate} />}
                  </Label>
                  <Label title="希望時給（円）" hint="未定なら空欄でOK"><input name="hopeHourly" type="number" min="0" max="100000" step="100" defaultValue={profile.hopeHourly ?? ""} style={inputStyle} /></Label>
                  <Label title="希望エリア" hint="複数ある場合は「福岡・中洲、天神」のように区切って入力"><input name="hopeAreas" defaultValue={(profile.hopeAreas || []).join("、")} style={inputStyle} /></Label>
                  <div style={{ display: "grid", gap: 8 }}>
                    <div style={{ color: COLORS.sub, fontSize: 12 }}>希望業種</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                      {TYPES.map((type) => (
                        <label key={type} style={{ fontSize: 13, color: COLORS.text }}>
                          <input type="checkbox" name={`type:${type}`} defaultChecked={(profile.hopeTypes || []).includes(type)} style={{ marginRight: 5 }} />{type}
                        </label>
                      ))}
                    </div>
                  </div>
                  <Label title="出勤可能日" hint="例：月、火、金 / 平日 / 週末など"><input name="availableDays" defaultValue={(profile.availableDays || []).join("、")} style={inputStyle} /></Label>
                  <Label title="自己紹介" hint="500文字まで">
                    <textarea name="bio" maxLength={500} rows={5} defaultValue={profile.bio || ""} style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
                  </Label>
                </>
              ) : (
                <>
                  <Label title="店舗名"><input name="name" required maxLength={80} defaultValue={profile.name} style={inputStyle} /></Label>
                  <Label title="エリア" hint="エリア変更後は店舗確認が再度必要になります"><input name="area" required maxLength={80} defaultValue={profile.area} style={inputStyle} /></Label>
                  <Label title="業種" hint="業種変更後は店舗確認が再度必要になります">
                    <select name="businessType" required defaultValue={profile.businessType} style={inputStyle}>{TYPES.map((type) => <option key={type}>{type}</option>)}</select>
                  </Label>
                  <Label title="最寄り駅"><input name="station" maxLength={80} defaultValue={profile.station || ""} style={inputStyle} /></Label>
                  <Label title="ログイン用メールアドレス" hint="ログイン情報の変更は別途対応します"><input value={profile.email || ""} readOnly style={{ ...inputStyle, opacity: .6 }} /></Label>
                  <div style={{ border: `1px solid ${profile.verified ? COLORS.mint : COLORS.gold}`, borderRadius: 12, padding: 12, color: profile.verified ? COLORS.mint : COLORS.gold, fontSize: 13 }}>
                    店舗確認：{profile.verified ? "確認済み" : "確認待ち"}
                  </div>
                </>
              )}

              {error && <div style={{ border: `1px solid ${COLORS.danger}`, borderRadius: 12, padding: 10, color: COLORS.danger, fontSize: 13 }}>{error}</div>}
              <button
                type="submit"
                disabled={saving}
                style={{
                  border: 0,
                  borderRadius: 13,
                  padding: "14px 16px",
                  background: COLORS.gold,
                  color: "#151018",
                  fontWeight: 800,
                  fontSize: 15,
                  opacity: saving ? .6 : 1,
                }}
              >
                {saving ? "保存中…" : "変更を保存する"}
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
