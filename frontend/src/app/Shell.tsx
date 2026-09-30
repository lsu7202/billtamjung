import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth, useIsBroker } from "../shared/store/auth";
import { useQuery } from "@tanstack/react-query";
import { authApi, customerApi, inquiriesApi } from "../shared/api/endpoints";
import { BrandMark } from "../shared/ui/Brand";
import { Icon, type IconName } from "../shared/ui/Icon";

/** 공통 셸 — 왼쪽 고정 레일(2026-09-28 개편).
 *
 *  위 머리(흰 바 58px)를 걷고 메뉴를 왼쪽 세로 레일로 옮겼다. 지피티 · 제미나이 결 —
 *  화면 높이를 통째로 쓰고, 탐색에선 레일 바로 옆에 사이드 판이 붙는다.
 *  메뉴는 아이콘 + 밑 글자(매물관리 · 고객관리 · 일정은 아이콘만으로 안 갈린다).
 *  위는 일(메뉴), 아래는 나(나가기 · 마이페이지).
 */
export function Shell() {
  const nav = useNavigate();
  const clear = useAuth((s) => s.clear);
  // 화면은 하나, 기능은 계정 종류로(S05 §1) — 고객에겐 매물관리 · 고객관리 · 일정이 없다.
  // 어시스턴트는 도구가 팀 값을 읽어서 고객용 도구 묶음(④) 전까지 중개사만.
  const broker = useIsBroker();
  // 미확인 문의 수 — 고객관리 아이콘 모서리 숫자 점(S05). 1분마다 다시 센다
  const inq = useQuery({ queryKey: ["inq-count"], queryFn: inquiriesApi.count, enabled: broker, refetchInterval: 60_000 });
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const unread = inq.data?.unread ?? 0;
  // 안 본 알림(저장한 건물 · 남긴 조건에 새 광고) — 아바타 모서리 빨간 점. 누구나(S05 §5)
  const alerts = useQuery({ queryKey: ["alert-count"], queryFn: customerApi.alertCount, refetchInterval: 120_000 });
  const newAlerts = alerts.data?.unread ?? 0;

  const item = (to: string, icon: IconName, label: string, dot?: number) => (
    <NavLink to={to} className={({ isActive }) => `srail-a ${isActive ? "on" : ""}`}>
      <i><Icon name={icon} size={21} />{dot ? <b className="srail-dot num">{dot > 99 ? "99+" : dot}</b> : null}</i>
      <span>{label}</span>
    </NavLink>
  );

  return (
    <div className="shell">
      <aside className="srail">
        <NavLink to="/search" className="srail-logo" title="빌탐정"><BrandMark size={26} /></NavLink>
        <nav className="srail-nav">
          {item("/search", "search", "탐색")}
          {broker && <>
            {item("/sales", "building", "매물관리")}
            {item("/customers", "team", "고객관리", unread)}
            {item("/schedule", "calendar", "일정")}
            {item("/assistant", "comment", "어시스턴트")}
          </>}
          {/* 소식 — 서울 전체의 고시 · 공고 · 인허가 · 보도자료(2026-09-06) */}
          {item("/news", "megaphone", "소식")}
        </nav>
        <span className="sp" />
        <button className="srail-out" title="로그아웃" onClick={() => { clear(); nav("/login"); }}>
          <Icon name="leave" size={19} /></button>
        <NavLink to={newAlerts ? "/mypage?tab=alerts" : "/mypage"} className={({ isActive }) => `srail-me ${isActive ? "on" : ""}`}
          title={newAlerts ? `새 알림 ${newAlerts}` : "마이페이지"}>
          {(me.data?.name ?? "나").trim().slice(0, 1)}
          {newAlerts > 0 && <b className="srail-dot num">{newAlerts > 99 ? "99+" : newAlerts}</b>}</NavLink>
      </aside>
      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
