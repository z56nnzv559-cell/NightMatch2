import React, { useEffect, useState } from "react";

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
  if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
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

  const refreshSession = async () => {
    try {
      const me = await api("/api/me");
      setSession(me?.session || null);
      return me?.session || null;
    } catch {
      return null;
    }
  };

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
  }, []);

  const openEditor = async () => {
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
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
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
      setProfile(result.profile);
      if (result.requiresReverification) {
        alert("プロフィールを保存しました。エリアまたは業種を変更したため、店舗確認が再度必要です。デモ環境ではデモ店舗確認をもう一度実行できます。");
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
      <button
        type="button"
        onClick={openEditor}
        disabled={loading}
        style={{
          position: "fixed",
          right: 14,
          top: 78,
          zIndex: 80,
          border: `1px solid ${COLORS.gold}`,
          borderRadius: 999,
          padding: "9px 13px",
          background: "rgba(27,22,32,.96)",
          color: COLORS.gold,
          fontSize: 12,
          fontWeight: 700,
          boxShadow: "0 8px 24px rgba(0,0,0,.25)",
        }}
      >
        {loading ? "読込中…" : "プロフィール編集"}
      </button>

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
