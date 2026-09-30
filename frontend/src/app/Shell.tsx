import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth, useIsBroker } from "../shared/store/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi, customerApi, inquiriesApi } from "../shared/api/endpoints";
import { BrandMark } from "../shared/ui/Brand";
import { Icon, type IconName } from "../shared/ui/Icon";
import { chats } from "../features/assistant/api";

/** 공통 셸 — 왼쪽 고정 레일 + 펼친 판(2026-09-30 개편, 유튜브 결).
 *
 *  빌탐정의 ㅂ 자체가 AI 다(투자 전문 AI). 로고 = AI 어시스턴트 입구이고, 로그인하면 첫 화면이 그것이다.
 *  레일: 위 = ☰ · 빌탐정 · 탐색 / 아래 = 매물관리 · 고객관리 · 일정 · 프로필.
 *  ☰ 를 누르면 왼쪽에서 넓은 판이 덮는다(화면을 밀지 않는다). 로그아웃은 그 판 맨 아래.
 *  소식은 레일에서 뺐다 — 탐색 지도의 「소식」 판 머리 「전체보기 ›」로 간다.
 *  어시스턴트는 아직 중개사만이라 고객은 로고가 탐색으로 간다.
 */
export function Shell() {
  const nav = useNavigate();
  const loc = useLocation();
  const clear = useAuth((s) => s.clear);
  const broker = useIsBroker();
  // 미확인 문의 수 — 고객관리 아이콘 모서리 숫자 점(S05). 1분마다 다시 센다
  const inq = useQuery({ queryKey: ["inq-count"], queryFn: inquiriesApi.count, enabled: broker, refetchInterval: 60_000 });
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const unread = inq.data?.unread ?? 0;
  // 안 본 알림(저장한 건물 · 남긴 조건에 새 광고) — 프로필 모서리 빨간 점. 누구나(S05 §5)
  const alerts = useQuery({ queryKey: ["alert-count"], queryFn: customerApi.alertCount, refetchInterval: 120_000 });
  const newAlerts = alerts.data?.unread ?? 0;
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();
  const chatNow = loc.pathname === "/assistant" ? new URLSearchParams(loc.search).get("chat") : null;
  // 최근 대화 — 펼친 판에서 빌탐정 AI 아래(지피티 · 제미나이 결). 열 때만 부른다
  const recent = useQuery({ queryKey: ["ai-chats"], queryFn: chats.list, enabled: broker && open });
  // 메뉴로 옮기면 닫는다. 지금 있는 곳을 다시 눌러도 닫히게 key 로 본다(주소가 같아도 key 는 바뀐다)
  useEffect(() => { setOpen(false); }, [loc.key]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  const home = broker ? "/assistant" : "/search";
  const initial = (me.data?.name ?? "나").trim().slice(0, 1);
  const meTo = newAlerts ? "/mypage?tab=alerts" : "/mypage";
  const dot = (n: number) => (n ? <b className="srail-dot num">{n > 99 ? "99+" : n}</b> : null);

  /** 레일 한 칸 — 아이콘 위 · 글자 아래 */
  const item = (to: string, icon: IconName, label: string, n = 0) => (
    <NavLink to={to} className={({ isActive }) => `srail-a ${isActive ? "on" : ""}`}>
      <i><Icon name={icon} size={21} />{dot(n)}</i>
      <span>{label}</span>
    </NavLink>
  );
  /** 펼친 판 한 줄 — 아이콘 왼쪽 · 이름 오른쪽 */
  const row = (to: string, icon: React.ReactNode, label: string, n = 0) => (
    <NavLink to={to} className={({ isActive }) => `sdraw-a ${isActive ? "on" : ""}`}>
      <i>{icon}{dot(n)}</i><span>{label}</span>
    </NavLink>
  );

  return (
    <div className="shell">
      <aside className="srail">
        <button className="srail-menu" title="메뉴" onClick={() => setOpen(true)}><Icon name="menu" size={22} /></button>
        <nav className="srail-nav">
          {/* 고객은 로고가 탐색으로 간다 — 탐색 칸과 같이 불이 들어오지 않게 로고엔 켜짐을 안 준다 */}
          <NavLink to={home} className={({ isActive }) => `srail-a srail-brand ${isActive && broker ? "on" : ""}`} title="빌탐정">
            <i><BrandMark size={24} /></i><span>빌탐정</span>
          </NavLink>
          {item("/search", "search", "탐색")}
        </nav>
        <span className="sp" />
        <nav className="srail-nav">
          {broker && <>
            {item("/sales", "building", "매물관리")}
            {item("/customers", "team", "고객관리", unread)}
            {item("/schedule", "calendar", "일정")}
          </>}
          <NavLink to={meTo} className={({ isActive }) => `srail-a ${isActive ? "on" : ""}`} title={newAlerts ? `새 알림 ${newAlerts}` : "프로필"}>
            <i><span className="srail-me">{initial}</span>{dot(newAlerts)}</i><span>프로필</span>
          </NavLink>
        </nav>
      </aside>

      {/* 펼친 판 — 화면 위에 덮는다. 판 밖 · Esc · 메뉴 이동이면 닫힌다 */}
      {open && (
        <div className="sdraw-bg" onClick={() => setOpen(false)}>
          <aside className="sdraw" onClick={(e) => e.stopPropagation()}>
            <div className="sdraw-top">
              <button className="srail-menu" title="닫기" onClick={() => setOpen(false)}><Icon name="menu" size={22} /></button>
              <NavLink to={home} className="sdraw-logo"><BrandMark size={24} /><b>빌탐정</b></NavLink>
            </div>
            {/* 순서(대표 09-30): 빌탐정 AI → 최근 대화 → 탐색. 빌탐정 AI 를 누르면 새 대화 */}
            <nav className="sdraw-grp">
              {broker && <NavLink to="/assistant" end className={() => `sdraw-a ${loc.pathname === "/assistant" && !chatNow ? "on" : ""}`}>
                <i><BrandMark size={20} /></i><span>빌탐정 AI</span></NavLink>}
              {broker && (recent.data ?? []).length > 0 && <>
                <div className="sdraw-h">최근 대화</div>
                {(recent.data ?? []).slice(0, 10).map((c) => (
                  <div key={c.id} className={`sdraw-c ${chatNow === String(c.id) ? "on" : ""}`}
                    onClick={() => nav(`/assistant?chat=${c.id}`)}>
                    <span>{c.title ?? "새 대화"}</span>
                    <button title="지움" onClick={async (e) => {
                      e.stopPropagation();
                      if (!confirm("이 대화를 지울까요?")) return;
                      await chats.remove(c.id);
                      qc.invalidateQueries({ queryKey: ["ai-chats"] });
                      if (chatNow === String(c.id)) nav("/assistant");
                    }}><Icon name="trash" size={12} /></button>
                  </div>
                ))}
              </>}
              {row("/search", <Icon name="search" size={20} />, "탐색")}
            </nav>
            {broker && (
              <nav className="sdraw-grp">
                {row("/sales", <Icon name="building" size={20} />, "매물관리")}
                {row("/customers", <Icon name="team" size={20} />, "고객관리", unread)}
                {row("/schedule", <Icon name="calendar" size={20} />, "일정")}
              </nav>
            )}
            <span className="sp" />
            <nav className="sdraw-grp last">
              {row(meTo, <span className="srail-me sm">{initial}</span>, "프로필", newAlerts)}
              <button className="sdraw-a" onClick={() => { clear(); nav("/login"); }}>
                <i><Icon name="leave" size={20} /></i><span>로그아웃</span></button>
            </nav>
          </aside>
        </div>
      )}

      <main className="shell-main">
        <Outlet />
      </main>
    </div>
  );
}
