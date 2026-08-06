import { useState, type CSSProperties } from "react";
import "./login.css";
import { useNavigate, useLocation } from "react-router-dom";
import { authApi } from "../../shared/api/endpoints";
import { useAuth } from "../../shared/store/auth";
import { TermsModal } from "./Terms";

/** S00 로그인/가입 — C3 확정안(2026-08-05): 좌 테라코타 시그니처 패널(마크·폼) · 우 호버 필지 도면.
 * 가입=이름(실명)·성별·이메일·비번·동의 3종 → /welcome 온보딩. 소셜 버튼은 비즈앱 심사 전 숨김. */

// 필지 도면(측량 시안) — 호버 시 테라코타 점등. index 1 = 기본 강조 필지
const PARCELS = [
  "M-20 180 220 150 240 330 30 370 Z",
  "M240 330 470 300 500 470 260 520 Z",
  "M30 370 260 520 210 740 -30 700 Z",
  "M470 300 720 280 740 460 500 470 Z",
  "M260 520 500 470 540 700 300 760 Z",
  "M220 150 470 120 470 300 240 330 Z",
  "M540 700 760 660 780 880 320 920 300 760 Z",
  "M-20 180 220 150 200 -30 -40 -10 Z",
  "M220 150 470 120 450 -40 200 -30 Z",
  "M470 120 700 90 720 280 470 300 Z",
  "M450 -40 690 -60 700 90 470 120 Z",
  "M-30 700 210 740 190 930 -50 900 Z",
  "M210 740 300 760 320 920 190 930 Z",
  "M740 460 950 440 970 640 760 660 Z",
  "M720 280 950 250 950 440 740 460 Z",
];

export function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const setAuth = useAuth((s) => s.setAuth);
  const [tab, setTab] = useState<"login" | "signup">("login");
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [gender, setGender] = useState("");
  const [agree, setAgree] = useState({ terms: false, privacy: false, marketing: false });
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [reset, setReset] = useState(false);
  const [doc, setDoc] = useState<"terms" | "privacy" | null>(null);

  const on = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });
  const allAgreed = agree.terms && agree.privacy && agree.marketing;
  const setAll = (v: boolean) => setAgree({ terms: v, privacy: v, marketing: v });

  // 딥링크 복귀: 미인증으로 튕겨온 원래 목적지로 로그인 후 복귀(없으면 /search)
  const dest = (loc.state as { from?: string } | null)?.from || "/search";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setBusy(true);
    try {
      const res = tab === "login"
        ? await authApi.login({ email: form.email, password: form.password, remember })
        : await authApi.signup({
            email: form.email, password: form.password, name: form.name,
            gender: gender || undefined,
            terms_agreed: agree.terms, privacy_agreed: agree.privacy, marketing_agreed: agree.marketing,
          });
      setAuth(res.access_token, res.tier);
      if (tab === "signup") { nav("/welcome", { replace: true }); return; }   // 가입 → 온보딩(질문 수집)
      const me = await authApi.me().catch(() => null);
      nav(me && !me.job_role ? "/welcome" : dest, { replace: true });          // 미완 프로필 → 온보딩
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  const inp: CSSProperties = { width: "100%", minWidth: 0 };

  return (
    <div className="lg">
      {/* ── 좌: 테라코타 시그니처 패널(폼) ── */}
      <div className="lg-left">
        <form onSubmit={submit} className="lg-form">
          <svg width={64} height={64} viewBox="0 0 48 48" style={{ display: "block", marginBottom: 14 }}>
            <rect x="11.5" y="8" width="8" height="32" rx="2.6" fill="#fff" />
            <rect x="28.5" y="8" width="8" height="32" rx="2.6" fill="#fff" />
            <rect x="11.5" y="20.5" width="25" height="7" rx="2.6" fill="#fff" />
            <rect x="11.5" y="33" width="25" height="7" rx="2.6" fill="#fff" />
            <rect x="13.6" y="11.5" width="3.8" height="3.8" rx="1" fill="var(--gold)" />
          </svg>
          <div className="lg-word">빌탐정<i>.</i></div>
          <div className="lg-tag">신뢰할 수 있는 부동산 가치 분석 파트너</div>

          {Boolean((loc.state as { from?: string } | null)?.from) && (
            <div className="lg-notice">
              <svg width={15} height={15} style={{ flex: "0 0 auto" }}><use href="#bt-lock" /></svg>
              로그인이 필요한 화면이에요 — 로그인하면 보던 화면으로 바로 이동합니다
            </div>
          )}

          {/* 탭 — 슬라이딩 언더라인(테라 위 골드) */}
          <div className="bt-tabs" style={{ "--tab-n": 2, "--tab-i": tab === "login" ? 0 : 1, marginBottom: 16 } as CSSProperties}>
            <button type="button" className={tab === "login" ? "on" : ""} onClick={() => setTab("login")}>로그인</button>
            <button type="button" className={tab === "signup" ? "on" : ""} onClick={() => setTab("signup")}>회원가입</button>
            <span className="bt-tabs-ink" aria-hidden />
          </div>

          <div style={{ display: "grid", gap: 9 }}>
            {tab === "signup" && (
              <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 8 }}>
                <input className="input" style={inp} placeholder="이름 (실명)" value={form.name} onChange={on("name")} required />
                <select className="input" style={{ ...inp, color: gender ? undefined : "var(--muted)" }}
                  value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="">성별 (선택)</option>
                  <option value="male">남성</option>
                  <option value="female">여성</option>
                  <option value="none">밝히지 않음</option>
                </select>
              </div>
            )}
            <input className="input" type="email" placeholder="이메일" value={form.email} onChange={on("email")} required />
            <input className="input" type="password" placeholder="비밀번호 (8자 이상)" value={form.password} onChange={on("password")} required minLength={8} />
          </div>

          {tab === "login" && (
            <div className="lg-aux" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, margin: "11px 0 2px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                로그인 유지
              </label>
              <span className="lg-gold" onClick={() => setReset(true)}>비밀번호 찾기</span>
            </div>
          )}

          {tab === "signup" && (
            <div className="lg-consent">
              <label className="all">
                <input type="checkbox" checked={allAgreed} onChange={(e) => setAll(e.target.checked)} /> 전체 동의
              </label>
              {([["terms", "이용약관 동의", true], ["privacy", "개인정보 수집·이용 동의", true], ["marketing", "혜택·소식 메일 수신", false]] as const).map(([k, label, req]) => (
                <label key={k} className="item">
                  <input type="checkbox" checked={agree[k]} onChange={(e) => setAgree({ ...agree, [k]: e.target.checked })} />
                  {label}
                  <span style={{ color: req ? "var(--terra)" : "var(--muted)", fontSize: 11.5, fontWeight: req ? 700 : 400 }}>{req ? "필수" : "선택"}</span>
                  {k !== "marketing" && (
                    <span onClick={(e) => { e.preventDefault(); setDoc(k === "terms" ? "terms" : "privacy"); }}
                      style={{ marginLeft: "auto", color: "var(--muted)", fontSize: 12, textDecoration: "underline" }}>보기</span>
                  )}
                </label>
              ))}
            </div>
          )}

          {err && <div className="lg-err" style={{ fontSize: 13, marginTop: 8 }}>{err}</div>}
          <button className="lg-cta" disabled={busy || (tab === "signup" && (!agree.terms || !agree.privacy))}>
            {tab === "login" ? "로그인" : "가입하고 시작하기"}
          </button>

          {/* 소셜 로그인 — 카카오 이메일 동의항목=비즈앱 심사 필요라 베타는 숨김(2026-08-04). 심사 후 원복. */}

          <p className="lg-aux" style={{ fontSize: 11.5, textAlign: "center", marginTop: 13 }}>
            {tab === "signup"
              ? <>가입 즉시 체험판 1개월 · 검색 무제한 + <b className="lg-gold">크레딧 60</b></>
              : <>처음이신가요? <b className="lg-gold" onClick={() => setTab("signup")}>1분 가입 · 1개월 무료 →</b></>}
          </p>
        </form>
      </div>

      {/* ── 우: 필지 도면(호버 시 테라코타 점등) ── */}
      <div className="lg-draw" aria-hidden>
        <svg viewBox="0 0 700 900" preserveAspectRatio="xMidYMid slice">
          <g>
            {PARCELS.map((d, i) => <path key={i} d={d} className={i === 1 ? "hero" : undefined} />)}
          </g>
        </svg>
      </div>

      {reset && <ResetModal onClose={() => setReset(false)} />}
      {doc && <TermsModal doc={doc} onClose={() => setDoc(null)} />}
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
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(20,17,14,.45)", display: "grid", placeItems: "center", zIndex: 50 }}>
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
