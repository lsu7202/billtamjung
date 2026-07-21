import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { creditsApi } from "../shared/api/endpoints";
import { useAuth } from "../shared/store/auth";

/** 공통 GNB 셸(S02·S0M 목업 appbar 이식) */
export function Shell() {
  const nav = useNavigate();
  const clear = useAuth((s) => s.clear);
  const credits = useQuery({ queryKey: ["credits"], queryFn: creditsApi.balance });

  return (
    <>
      <header className="appbar">
        <div className="logo">빌탐정</div>
        <nav>
          <NavLink to="/search" className={({ isActive }) => (isActive ? "on" : "")}>매물 검색</NavLink>
          <NavLink to="/mypage" className={({ isActive }) => (isActive ? "on" : "")}>내 산출물</NavLink>
        </nav>
        <span className="credit">크레딧<b>{credits.data?.total ?? "…"}</b></span>
        <button
          className="btn"
          style={{ background: "transparent", color: "#9fb0cc", borderColor: "rgba(255,255,255,.2)" }}
          onClick={() => { clear(); nav("/login"); }}
        >
          로그아웃
        </button>
      </header>
      <main style={{ maxWidth: 1304, margin: "18px auto", padding: "0 18px" }}>
        <Outlet />
      </main>
    </>
  );
}
