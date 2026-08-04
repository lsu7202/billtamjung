import { useEffect, useRef, useState, type CSSProperties } from "react";
import "./login.css";
import { useNavigate, useLocation } from "react-router-dom";
import { authApi } from "../../shared/api/endpoints";
import { useAuth } from "../../shared/store/auth";
import { TermsModal } from "./Terms";

/** S00 로그인/가입 — 몰입형(살아있는 스카이라인 + 스캔 광선 + ㅂ마크 조립 등장).
 * 가입 수집: 직군(칩)·가입경로·관심지역(분석용) + 동의 3종(약관·개인정보=필수, 마케팅=선택). */

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

  // 소셜 버튼 숨김 중이라 미사용 — 심사 후 원복 시 사용(빌드 경고 방지용 void)
  const social = (provider: "kakao" | "naver", label: string, bg: string, fg: string) => (
    <button type="button"
      onClick={() => { window.location.href = `/api/auth/social/${provider}/start${agree.marketing ? "?marketing=1" : ""}`; }}
      style={{ padding: 11, border: 0, borderRadius: 8, background: bg, color: fg, fontWeight: 700, fontSize: 13, cursor: "pointer" }}>
      {label}
    </button>
  );

  void social;
  const inp: CSSProperties = { width: "100%", minWidth: 0 };

  return (
    <div className="s00">
      <div className="s00-dawn" />
      <CityCanvas />
      <div className="s00-scan" />
      <div className="s00-stage">
        {/* ㅂ 마크 조립 등장 — 개별 막대 애니메이션을 위해 인라인 */}
        <svg className="s00-mark" width={92} height={92} viewBox="0 0 48 48">
          <rect className="b1" x="11.5" y="8" width="8" height="32" rx="2.6" fill="var(--terra)" />
          <rect className="b2" x="28.5" y="8" width="8" height="32" rx="2.6" fill="var(--terra)" />
          <rect className="b3" x="11.5" y="20.5" width="25" height="7" rx="2.6" fill="var(--terra)" />
          <rect className="b4" x="11.5" y="33" width="25" height="7" rx="2.6" fill="var(--terra)" />
          <rect className="win" x="13.6" y="11.5" width="3.8" height="3.8" rx="1" fill="var(--gold)" />
        </svg>
        <div className="s00-word">빌탐정<span className="dot">.</span></div>
        <div className="s00-tagline">서울 모든 건물의 가치를 <b>데이터로 증명</b>합니다</div>
        <form onSubmit={submit} className="s00-card">
          {Boolean((loc.state as { from?: string } | null)?.from) && (
            <div style={{ background: "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 8, padding: "9px 12px", fontSize: 12.5, color: "var(--ink-2)", marginBottom: 13, display: "flex", gap: 7, alignItems: "center" }}>
              <svg width={15} height={15} style={{ flex: "0 0 auto" }}><use href="#bt-lock" /></svg>
              로그인이 필요한 화면이에요 — 로그인하면 보던 화면으로 바로 이동합니다
            </div>
          )}
          {/* 탭 — 슬라이딩 언더라인 */}
          <div className="bt-tabs" style={{ "--tab-n": 2, "--tab-i": tab === "login" ? 0 : 1, marginBottom: 16 } as CSSProperties}>
            <button type="button" className={tab === "login" ? "on" : ""} onClick={() => setTab("login")}>로그인</button>
            <button type="button" className={tab === "signup" ? "on" : ""} onClick={() => setTab("signup")}>회원가입</button>
            <span className="bt-tabs-ink" aria-hidden />
          </div>

          <div style={{ display: "grid", gap: 9 }}>
            {tab === "signup" && (<>
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
            </>)}
            <input className="input" type="email" placeholder="이메일" value={form.email} onChange={on("email")} required />
            <input className="input" type="password" placeholder="비밀번호 (8자 이상)" value={form.password} onChange={on("password")} required minLength={8} />
          </div>

          {tab === "login" && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13, margin: "10px 0 2px" }}>
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

          {tab === "signup" && (<>
            {/* 동의 — 전체동의 + 3종 */}
            <div style={{ border: "1px solid var(--line)", borderRadius: 9, padding: "11px 13px", margin: "6px 0 4px", fontSize: 13 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, paddingBottom: 9, borderBottom: "1px solid var(--line)", marginBottom: 8, cursor: "pointer" }}>
                <input type="checkbox" checked={allAgreed} onChange={(e) => setAll(e.target.checked)} /> 전체 동의
              </label>
              {([["terms", "이용약관 동의", true], ["privacy", "개인정보 수집·이용 동의", true], ["marketing", "혜택·소식 메일 수신", false]] as const).map(([k, label, req]) => (
                <label key={k} style={{ display: "flex", alignItems: "center", gap: 8, padding: "3.5px 0", color: "var(--ink-2)", cursor: "pointer" }}>
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
          </>)}

          {err && <div style={{ color: "var(--up)", fontSize: 13, marginTop: 6 }}>{err}</div>}
          <button className="btn primary" style={{ width: "100%", padding: 13, fontSize: 14.5, marginTop: 8 }}
            disabled={busy || (tab === "signup" && (!agree.terms || !agree.privacy))}>
            {tab === "login" ? "로그인" : "가입하고 시작하기"}
          </button>

          {/* 소셜 로그인 — 카카오 이메일 동의항목=비즈앱 심사 필요라 베타는 숨김(2026-08-04).
              백엔드·social()은 유지 — 심사 후 이 블록만 원복하면 됨. */}
          {tab === "signup" && (
            <p style={{ fontSize: 11.5, color: "var(--muted)", textAlign: "center", marginTop: 11 }}>
              가입 즉시 체험판 1개월 · 검색 무제한 + <b style={{ color: "var(--gold-ink)" }}>크레딧 60</b>
            </p>
          )}
        </form>

      </div>

      {reset && <ResetModal onClose={() => setReset(false)} />}
      {doc && <TermsModal doc={doc} onClose={() => setDoc(null)} />}
    </div>
  );
}

/** 살아있는 스카이라인 — 창문이 골드로 깜빡이는 서울의 밤(캔버스 1장·DOM 부하 없음). */
export function CityCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current!;
    const cx = cv.getContext("2d")!;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, raf = 0;
    type Win = { x: number; y: number; on: boolean; t: number };
    let blds: { x: number; w: number; h: number; win: Win[] }[] = [];
    const dpr = devicePixelRatio || 1;
    function build() {
      W = cv.width = innerWidth * dpr;
      H = cv.height = innerHeight * 0.38 * dpr;
      blds = [];
      let x = 0;
      while (x < W) {
        const w = (18 + Math.random() * 40) * dpr, h = Math.min((30 + Math.random() * 0.75 * (H / dpr)) * dpr, H - 6 * dpr);
        const win: Win[] = [];
        for (let wy = H - h + 8 * dpr; wy < H - 8 * dpr; wy += 9 * dpr)
          for (let wx = x + 4 * dpr; wx < x + w - 6 * dpr; wx += 8 * dpr)
            if (Math.random() < 0.5) win.push({ x: wx, y: wy, on: Math.random() < 0.22, t: Math.random() * 9000 });
        blds.push({ x, w, h, win });
        x += w + (2 + Math.random() * 8) * dpr;
      }
    }
    function draw(ts: number) {
      cx.clearRect(0, 0, W, H);
      for (const b of blds) {
        cx.fillStyle = "rgba(12,10,8,.92)";
        cx.fillRect(b.x, H - b.h, b.w, b.h);
        for (const w of b.win) {
          if (!reduced && ts > w.t) { w.on = Math.random() < 0.3; w.t = ts + 3000 + Math.random() * 9000; }
          cx.fillStyle = w.on ? "rgba(231,200,118,.75)" : "rgba(255,255,255,.05)";
          cx.fillRect(w.x, w.y, 3.5 * dpr, 4.5 * dpr);
        }
      }
      raf = requestAnimationFrame(draw);
    }
    build();
    raf = requestAnimationFrame(draw);
    addEventListener("resize", build);
    return () => { cancelAnimationFrame(raf); removeEventListener("resize", build); };
  }, []);
  return <canvas ref={ref} className="s00-city" />;
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
