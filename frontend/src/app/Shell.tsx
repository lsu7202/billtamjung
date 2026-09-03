import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { creditsApi } from "../shared/api/endpoints";
import { useAuth } from "../shared/store/auth";
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
 *  크레딧·마이페이지·로그아웃은 하루에 한 번 보는 자리라 반대쪽 끝으로 보냈다.
 */
export function Shell() {
  const nav = useNavigate();
  const clear = useAuth((s) => s.clear);
  const credits = useQuery({ queryKey: ["credits"], queryFn: creditsApi.balance });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <header className="appbar">
        <Logo markSize={22} />
        <nav className="gnb">
          <NavLink to="/search" className={({ isActive }) => (isActive ? "on" : "")}>건물 검색</NavLink>
          <NavLink to="/sales" className={({ isActive }) => (isActive ? "on" : "")}>업무</NavLink>
        </nav>
        <span className="sp" />
        <span className="credit">크레딧<b>{credits.data?.total ?? "…"}</b></span>
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
