import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../shared/store/auth";
import { authApi } from "../../shared/api/endpoints";
import { CityCanvas } from "./CityCanvas";
import "../auth/login.css";
import "./landing.css";

/** 최초 진입(/) — 퍼블릭 랜딩. 몰입형 월드 위 단일 CTA.
 * 시작하기 → 스캔 플래시 전환 → 세션 있으면 /search, 없으면 /login(가치 인지 후 로그인이라 거부감 낮음). */
export function LandingPage() {
  const nav = useNavigate();
  const authed = useAuth((s) => Boolean(s.access));
  const [leaving, setLeaving] = useState(false);
  const [signupsOpen, setSignupsOpen] = useState(true);   // 베타 개시 전에는 신규 가입을 닫는다

  useEffect(() => {
    authApi.publicConfig().then((c) => setSignupsOpen(c.signups_open)).catch(() => {});
  }, []);

  function start() {
    if (leaving) return;
    setLeaving(true);
    // 스캔 플래시(560ms) 후 이동 — reduced-motion이면 즉시
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    setTimeout(() => nav(authed ? "/search" : "/login"), reduced ? 0 : 560);
  }

  return (
    <div className="s00">
      <div className="s00-dawn" />
      <CityCanvas />
      <div className="s00-scan" />

      <div className="s00-stage" style={{ paddingBottom: "24vh" }}>
        <svg className="s00-mark" width={116} height={116} viewBox="0 0 48 48">
          <rect className="b1" x="11.5" y="8" width="8" height="32" rx="2.6" fill="var(--terra)" />
          <rect className="b2" x="28.5" y="8" width="8" height="32" rx="2.6" fill="var(--terra)" />
          <rect className="b3" x="11.5" y="20.5" width="25" height="7" rx="2.6" fill="var(--terra)" />
          <rect className="b4" x="11.5" y="33" width="25" height="7" rx="2.6" fill="var(--terra)" />
          <rect className="win" x="13.6" y="11.5" width="3.8" height="3.8" rx="1" fill="var(--gold)" />
        </svg>
        <div className="s00-word" style={{ fontSize: 30 }}>빌탐정<span className="dot">.</span></div>
        <h1 className="ld-head">
          이 건물, 얼마가 적정일까?<br />
          <b>데이터가 증명합니다.</b>
        </h1>
        <p className="ld-sub">서울 모든 건물의 검색 · 가치분석 · 매물관리를 한 화면에서.</p>

        <button className="ld-cta" onClick={start}>
          빌탐정 시작하기
          <svg width={17} height={17} viewBox="0 0 24 24" aria-hidden>
            <path d="M5 12h13M13 6.5 18.5 12 13 17.5" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="ld-note">
          {authed ? "로그인되어 있어요 — 바로 이어서 시작합니다"
            : signupsOpen ? "가입 1분 · 체험 1개월 무료" : "관리자만 이용 가능합니다"}
        </div>
      </div>

      {/* 전환 연출 — 골드 스캔이 빠르게 훑고 잉크로 덮임 */}
      {leaving && (
        <div className="ld-leave" aria-hidden>
          <div className="ld-leave-beam" />
        </div>
      )}
    </div>
  );
}

// CSSProperties import 유지용(전환 스타일 확장 여지)
export type _LdStyle = CSSProperties;
