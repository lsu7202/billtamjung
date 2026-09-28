import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth, useIsBroker } from "../shared/store/auth";
import { Logo } from "../shared/ui/Brand";
import { Icon } from "../shared/ui/Icon";

/** 공통 GNB 셸.
 *
 *  2026-08-28 개편. 검은 바에 금색 밑줄이던 헤더를 흰 바에 파란 밑줄로 바꿨다.
 *  아래가 전부 「회색 바탕 위 흰 카드」인데 머리만 검어서 화면이 두 판으로 갈렸고,
 *  금색은 로고에만 남기기로 한 브랜드 색이라 선택 표시로 쓰면 뜻이 겹쳤다.
 *
 *  배치도 성격으로 갈랐다 — **왼쪽은 일, 오른쪽은 나.**
 *  건물 검색·업무는 하루 종일 오가는 자리라 로고 옆에 붙이고,
 *  마이페이지·로그아웃은 하루에 한 번 보는 자리라 반대쪽 끝으로 보냈다.
 */
export function Shell() {
  const nav = useNavigate();
  const clear = useAuth((s) => s.clear);
  // 화면은 하나, 기능은 계정 종류로(S05 §1) — 고객에겐 매물관리 · 고객관리 · 일정이 없다.
  // 어시스턴트는 도구가 팀 값을 읽어서 고객용 도구 묶음(④) 전까지 중개사만.
  const broker = useIsBroker();

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header className="appbar">
        <Logo markSize={22} />
        <nav className="gnb">
          <NavLink to="/search" className={({ isActive }) => (isActive ? "on" : "")}>탐색</NavLink>
          {broker && <>
            <NavLink to="/sales" className={({ isActive }) => (isActive ? "on" : "")}>매물관리</NavLink>
            <NavLink to="/customers" className={({ isActive }) => (isActive ? "on" : "")}>고객관리</NavLink>
            <NavLink to="/schedule" className={({ isActive }) => (isActive ? "on" : "")}>일정</NavLink>
          </>}
          {/* 소식 — 서울 전체의 고시·공고·인허가·보도자료. 건물 상세의 「주변 소식」과 같은 자료를
              자리로 안 자르고 늘어놓은 자리다(2026-09-06) */}
          {broker && <NavLink to="/assistant" className={({ isActive }) => (isActive ? "on" : "")}>어시스턴트</NavLink>}
          <NavLink to="/news" className={({ isActive }) => (isActive ? "on" : "")}>소식</NavLink>
        </nav>
        <span className="sp" />
        <nav className="gnb me">
          <NavLink to="/mypage" className={({ isActive }) => (isActive ? "on" : "")}>마이페이지</NavLink>
        </nav>
        <button className="gnb-out" title="로그아웃"
          onClick={() => { clear(); nav("/login"); }}><Icon name="leave" size={16} /></button>
      </header>
      <main style={{ flex: 1, minHeight: 0, padding: 0, overflow: "auto" }}>
        <Outlet />
      </main>
    </div>
  );
}
