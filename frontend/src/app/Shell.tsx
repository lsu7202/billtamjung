import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth, useIsBroker, useIsGuest } from "../shared/store/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi, inquiriesApi, teamApi } from "../shared/api/endpoints";
import { BrandMark } from "../shared/ui/Brand";
import { Face, useMyPhoto } from "../shared/ui/Face";
import { Icon, type IconName } from "../shared/ui/Icon";
import { chats } from "../features/assistant/api";

/** 공통 셸 — 왼쪽 고정 레일 + 펼친 판(2026-09-30 개편, 유튜브 결).
 *
 *  빌탐정의 ㅂ 자체가 AI 다(투자 전문 AI). 로고 = AI 어시스턴트 입구이고, 로그인하면 첫 화면이 그것이다.
 *  레일: 위 = ☰ · 빌탐정 · 매물 찾기 · 구해요 / 아래 = 매물 탐색(S08) · 매물관리 · 고객관리 · 일정 · 프로필.
 *  매물 찾기(옛 탐색)와 구해요(S06)는 필터 하나를 같이 쓰는 두 화면이다(09-30).
 *  ☰ 를 누르면 왼쪽에서 넓은 판이 덮는다(화면을 밀지 않는다). 로그아웃은 그 판 맨 아래.
 *  소식은 레일에서 뺐다 — 탐색 지도의 「소식」 판 머리 「전체보기 ›」로 간다.
 *  어시스턴트는 아직 중개사만이라 고객은 로고가 매물 찾기로 간다.
 */
export function Shell() {
  const nav = useNavigate();
  const loc = useLocation();
  const clear = useAuth((s) => s.clear);
  const broker = useIsBroker();
  const guest = useIsGuest();
  // 미확인 문의 수 — 고객관리 아이콘 모서리 숫자 점(S05). 1분마다 다시 센다
  const inq = useQuery({ queryKey: ["inq-count"], queryFn: inquiriesApi.count, enabled: broker, refetchInterval: 60_000 });
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me, enabled: !guest });
  const unread = inq.data?.unread ?? 0;
  // 받은 팀 초대(0221) — 프로필 · 내 중개사무소에 빨간 점
  const recv = useQuery({ queryKey: ["teamReceived"], queryFn: teamApi.received, enabled: broker, refetchInterval: 60_000 });
  const recvN = recv.data?.length ?? 0;
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
  const myPhoto = useMyPhoto();
  const meTo = "/mypage";   // 알림은 걷었다(0205) — 구해요 제안 알림을 만들 때 다시 세운다
  const dot = (n: number) => (n ? <b className="srail-dot num">{n > 99 ? "99+" : n}</b> : null);

  /** 레일 한 칸 — 아이콘 위 · 글자 아래 */
  const item = (to: string, icon: IconName, label: string, n = 0) => (
    <NavLink to={to} className={({ isActive }) => `srail-a ${isActive ? "on" : ""}`}>
      <i><Icon name={icon} size={21} />{dot(n)}</i>
      <span>{label}</span>
    </NavLink>
  );
  /** 글자가 곧 아이콘인 칸(대표 09-30) — 매물 찾기 = 빨간 네모, 구해요 = 초록 네모. 색이 지도 핀 색과 같다 */
  const word = (to: string, lines: string[], tone: "sale" | "seek") => (
    <NavLink to={to} className={({ isActive }) => `srail-a srail-w ${isActive ? "on" : ""}`} title={lines.join("")}>
      <i className={`srail-word ${tone}`}>{lines.map((l) => <b key={l}>{l}</b>)}</i>
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
          {/* 고객은 로고가 탐색으로 간다 — 매물 찾기 칸과 같이 불이 들어오지 않게 로고엔 켜짐을 안 준다 */}
          <NavLink to={home} className={({ isActive }) => `srail-a srail-brand ${isActive && broker ? "on" : ""}`} title="빌탐정">
            <i><BrandMark size={24} /></i><span>빌탐정</span>
          </NavLink>
          {word("/search", ["매물", "찾기"], "sale")}
          {word("/seek", ["구해요"], "seek")}
        </nav>
        <span className="sp" />
        <nav className="srail-nav">
          {broker && <>
            {item("/explore", "search", "매물 탐색")}
            {item("/sales", "building", "매물관리")}
            {item("/customers", "team", "고객관리", unread)}
            {item("/schedule", "calendar", "일정")}
          </>}
          {guest
            ? <NavLink to="/login" state={{ from: loc.pathname + loc.search }} className="srail-a" title="로그인">
                <i><Icon name="leave" size={21} /></i><span>로그인</span></NavLink>
            : <NavLink to={meTo} className={({ isActive }) => `srail-a ${isActive ? "on" : ""}`} title="프로필">
                <i><Face name={initial} photo={myPhoto} className="srail-me" />{dot(recvN)}</i><span>프로필</span>
              </NavLink>}
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
            {/* 순서(대표 09-30): 빌탐정 AI → 최근 대화 → 매물 찾기 · 구해요. 빌탐정 AI 를 누르면 새 대화 */}
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
              {row("/search", <span className="sdraw-sq sale" />, "매물 찾기")}
              {row("/seek", <span className="sdraw-sq seek" />, "구해요")}
            </nav>
            {broker && (
              <nav className="sdraw-grp">
                {row("/explore", <Icon name="search" size={20} />, "매물 탐색")}
                {row("/sales", <Icon name="building" size={20} />, "매물관리")}
                {row("/customers", <Icon name="team" size={20} />, "고객관리", unread)}
                {row("/schedule", <Icon name="calendar" size={20} />, "일정")}
              </nav>
            )}
            {/* 내 페이지(S09 · 10-04) — 유튜브 「내 페이지 ›」 결. 머리 = 프로필 전체, 줄 = 그 묶음 하나 */}
            {!guest && (
              <nav className="sdraw-grp">
                <NavLink to="/mypage" end className={({ isActive }) => `sdraw-h link ${isActive ? "on" : ""}`}>내 페이지<Icon name="back" size={14} /></NavLink>
                {(broker
                  ? [["office", "building", "내 중개사무소"], ["saves", "star", "관심 매물"], ["account", "settings", "계정"]]
                  : [["invest", "trend", "내 투자"], ["recent", "eye", "최근 본 매물"], ["saves", "star", "관심 매물"],
                     ["seeks", "megaphone", "구해요"], ["inquiries", "comment", "보낸 문의"], ["account", "settings", "계정"]]
                ).map(([k, ic, l]) => <span key={k}>{row(`/mypage/${k}`, <Icon name={ic as IconName} size={20} />, l, k === "office" ? recvN : 0)}</span>)}
              </nav>
            )}
            <span className="sp" />
            <nav className="sdraw-grp last">
              {guest
                ? <button className="sdraw-a" onClick={() => nav("/login", { state: { from: loc.pathname + loc.search } })}>
                    <i><Icon name="leave" size={20} /></i><span>로그인</span></button>
                : <>
                  {row(meTo, <Face name={initial} photo={myPhoto} className="srail-me sm" />, "프로필")}
                  <button className="sdraw-a" onClick={async () => {
                    // 서버가 로그인 유지 쿠키(refresh)를 지워야 한다 — 메모리 토큰만 지우면 새로고침 때 쿠키로 다시 들어온다
                    await authApi.logout().catch(() => {});
                    clear(); qc.clear(); nav("/search");   // 로그아웃하면 손님으로 매물 찾기(10-01)
                  }}>
                    <i><Icon name="leave" size={20} /></i><span>로그아웃</span></button>
                </>}
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
