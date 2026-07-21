import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authApi } from "../../shared/api/endpoints";
import { useAuth } from "../../shared/store/auth";

/** S00 로그인/가입 — 스플릿(좌 브랜드 · 우 폼) */
export function LoginPage() {
  const nav = useNavigate();
  const setAuth = useAuth((s) => s.setAuth);
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [form, setForm] = useState({ email: "", password: "", name: "", office_name: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const on = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const res = tab === "login"
        ? await authApi.login({ email: form.email, password: form.password })
        : await authApi.signup(form);
      setAuth(res.access_token, res.tier);
      nav("/search");
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const tabBtn = (t: "login" | "signup", label: string) => (
    <button type="button" onClick={() => setTab(t)} style={{
      flex: 1, border: 0, background: "none", padding: "10px 0 11px", fontSize: 14,
      fontWeight: 700, cursor: "pointer",
      color: tab === t ? "var(--signal)" : "var(--muted)",
      borderBottom: tab === t ? "2px solid var(--signal)" : "2px solid transparent",
    }}>{label}</button>
  );

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1.05fr .95fr", minHeight: "100vh" }}>
      {/* 좌: 브랜드 패널 */}
      <div style={{ background: "var(--ink)", color: "#fff", padding: "52px 54px", display: "flex", flexDirection: "column" }}>
        <div style={{ fontSize: 26, fontWeight: 800, display: "flex", alignItems: "center", gap: 9 }}>
          <span style={{ width: 11, height: 11, borderRadius: 3, background: "var(--signal)", boxShadow: "0 0 0 4px rgba(30,90,240,.28)" }} />
          빌탐정
        </div>
        <div style={{ marginTop: "auto" }}>
          <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.32 }}>
            건물의 진짜 가치를,<br /><b style={{ color: "#7fa8ff" }}>데이터로 증명</b>합니다.
          </div>
          <p style={{ color: "#9fb0cc", fontSize: 14, lineHeight: 1.6 }}>
            서울 전 건물의 대장·토지·공시지가·매각 데이터부터<br />
            가치점수·적정매매가 분석까지 — 하나의 화면에서.
          </p>
        </div>
      </div>
      {/* 우: 폼 */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <form onSubmit={submit} style={{ width: "min(380px,100%)", display: "grid", gap: 12 }}>
          <div style={{ display: "flex", borderBottom: "1px solid var(--line)" }}>
            {tabBtn("login", "로그인")}{tabBtn("signup", "회원가입")}
          </div>
          {tab === "signup" && (<>
            <input className="input" placeholder="이름" value={form.name} onChange={on("name")} required />
            <input className="input" placeholder="중개사무소명 (선택)" value={form.office_name} onChange={on("office_name")} />
          </>)}
          <input className="input" type="email" placeholder="이메일" value={form.email} onChange={on("email")} required />
          <input className="input" type="password" placeholder="비밀번호 (8자 이상)" value={form.password} onChange={on("password")} required minLength={8} />
          {err && <div style={{ color: "var(--up)", fontSize: 13 }}>{err}</div>}
          <button className="btn primary" style={{ padding: 12 }} disabled={busy}>
            {tab === "login" ? "로그인" : "가입하고 시작하기"}
          </button>
          {tab === "signup" && (
            <p style={{ fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
              가입 시 체험판(1개월) 자동 시작 · 검색 무제한 + 크레딧 60
            </p>
          )}
        </form>
      </div>
    </div>
  );
}
