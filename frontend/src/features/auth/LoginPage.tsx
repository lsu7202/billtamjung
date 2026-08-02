import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { authApi } from "../../shared/api/endpoints";
import { useAuth } from "../../shared/store/auth";

/** S00 로그인/가입 — 스플릿(좌 브랜드 · 우 폼). 약관 동의·로그인 유지·소셜·비번 찾기. */
export function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const setAuth = useAuth((s) => s.setAuth);
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [form, setForm] = useState({ email: "", password: "", name: "", office_name: "" });
  const [terms, setTerms] = useState(false);
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);

  const on = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  // 딥링크 복귀: 미인증으로 튕겨온 원래 목적지로 로그인 후 복귀(없으면 /search)
  const dest = (loc.state as { from?: string } | null)?.from || "/search";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const res = tab === "login"
        ? await authApi.login({ email: form.email, password: form.password, remember })
        : await authApi.signup({ ...form, terms_agreed: terms });
      setAuth(res.access_token, res.tier);
      nav(dest, { replace: true });
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

  const social = (provider: "kakao" | "naver", label: string, bg: string, fg: string) => (
    <button type="button" onClick={() => { window.location.href = `/api/auth/social/${provider}/start`; }}
      style={{ padding: 11, border: 0, borderRadius: "var(--radius-sm)", background: bg, color: fg, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
      {label}
    </button>
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

          {tab === "login" && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--muted)", cursor: "pointer" }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                로그인 유지
              </label>
              <button type="button" onClick={() => setReset(true)}
                style={{ border: 0, background: "none", color: "var(--signal)", fontSize: 13, cursor: "pointer", padding: 0 }}>
                비밀번호 찾기
              </button>
            </div>
          )}
          {tab === "signup" && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--muted)", cursor: "pointer" }}>
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} required />
              <span>이용약관 및 개인정보 처리방침에 동의합니다 (필수)</span>
            </label>
          )}

          {err && <div style={{ color: "var(--up)", fontSize: 13 }}>{err}</div>}
          <button className="btn primary" style={{ padding: 12 }} disabled={busy || (tab === "signup" && !terms)}>
            {tab === "login" ? "로그인" : "가입하고 시작하기"}
          </button>

          <div style={{ display: "flex", alignItems: "center", gap: 10, color: "var(--muted)", fontSize: 11, margin: "2px 0" }}>
            <span style={{ flex: 1, height: 1, background: "var(--line)" }} /> 또는 <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {social("kakao", "카카오로 계속", "#FEE500", "#191600")}
            {social("naver", "네이버로 계속", "#03C75A", "#fff")}
          </div>

          {tab === "signup" && (
            <p style={{ fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
              가입 시 체험판(1개월) 자동 시작 · 검색 무제한 + 크레딧 60
            </p>
          )}
        </form>
      </div>

      {reset && <ResetModal onClose={() => setReset(false)} />}
    </div>
  );
}

/** 비밀번호 재설정 — 베타: 메일 발송 스텁이라 콘솔/관리자에서 받은 토큰을 입력해 새 비번 설정. */
function ResetModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [token, setToken] = useState("");
  const [pw, setPw] = useState("");
  const [sent, setSent] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function request() {
    setBusy(true); setMsg(null);
    try { await authApi.resetRequest(email); setSent(true); setMsg("재설정 안내를 보냈습니다. 받은 코드로 새 비밀번호를 설정하세요."); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true); setMsg(null);
    try { await authApi.resetConfirm(token, pw); setMsg("비밀번호가 변경되었습니다. 새 비밀번호로 로그인하세요."); setSent(false); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,30,55,.4)", display: "grid", placeItems: "center", zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: 24, width: "min(360px,92vw)", display: "grid", gap: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>비밀번호 찾기</div>
        {!sent ? (<>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>가입한 이메일로 재설정 코드를 보냅니다.</p>
          <input className="input" type="email" placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn primary" disabled={busy || !email.trim()} onClick={request}>재설정 코드 받기</button>
        </>) : (<>
          <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>받은 코드와 새 비밀번호를 입력하세요.</p>
          <input className="input" placeholder="재설정 코드" value={token} onChange={(e) => setToken(e.target.value)} />
          <input className="input" type="password" placeholder="새 비밀번호 (8자 이상)" value={pw} onChange={(e) => setPw(e.target.value)} minLength={8} />
          <button className="btn primary" disabled={busy || !token.trim() || pw.length < 8} onClick={confirm}>비밀번호 변경</button>
        </>)}
        {msg && <div style={{ fontSize: 12.5, color: "var(--signal)" }}>{msg}</div>}
        <button className="btn" onClick={onClose}>닫기</button>
      </div>
    </div>
  );
}
