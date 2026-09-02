import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { schedulesApi, authApi, contactsApi, type ScheduleRow } from "../../shared/api/endpoints";
import { Segmented } from "../../shared/ui/Segmented";
import { Icon } from "../../shared/ui/Icon";
import { SchedModal, type SchedFinal } from "./SchedModal";
import { useTradeCtx } from "./tradeCtx";
import { dongAddr, md, isoDate } from "../../shared/format";
import "./sales.css";

/** 캘린더 — 손수 만든 달력. 커밋이 곧 일정이라 여기엔 **새로 잡는 입력이 없다**.
 *
 *  「다음주 수에 브리핑 하기로함」을 장부나 하단 대화창에 치면 파서가 약속을 읽어 세운다(0070).
 *  사람이 캘린더에 옮겨 적는 순간 장부와 캘린더는 두 개의 진실이 된다 — 그래서 안 만든다.
 *  (이 판에 있던 한 줄 입력은 하단 대화창이 대체했다 — 2026-08-14)
 *  **날짜가 하나로 떨어지는 약속만** 선다(0071) — 「다음주 중」 같은 창은 안 올린다.
 *
 *  대신 **잡힌 뒤의 일**은 여기서 한다(0072): 끌어서 미루기 · 완료 · 삭제.
 *  취소 상태는 없다(0074) — 깨진 약속은 지운다. 무슨 일이 있었는지는 장부의 문장이 들고 있다.
 *  손댄 것은 장부에 자동으로 한 줄 남는다 — 왜 옮겨졌는지가 기록에 있어야 하니까.
 *  반대로 장부에 「브리핑 다음주로 미룸」이라고 쳐도 이 화면이 따라 움직인다.
 *
 *  일정은 한 종류다(0089) — 계약이든 잔금이든 옮기고 끝내는 규칙이 같다.
 *  장부와의 아귀는 거울이 맞춘다: 계약 일정의 ✓ 를 풀면 그 계약 기록도 함께 걷힌다.
 *
 *  팀: **보는 건 팀 전체**(누가 어디 가 있는지 서로 보여야 일정이 안 겹친다),
 *  **옮기고 끝내는 건 담당자 본인만** — 대표도 못 한다. 약속은 그 사람이 상대와 잡은
 *  시간이라, 앱에서 옮겨 봐야 상대는 모른다. 남의 약속은 읽기만 한다.
 */

const WD = ["월", "화", "수", "목", "금", "토", "일"];
/** 시각 — 없으면 안 쓴다. 「9시」로 채우면 아무도 안 한 약속이 화면에 선다(0073) */
const hm = (t: string | null) => (t ? t.slice(0, 5) : null);

/** 일정 한 건 — 약속은 「시각 + 담당자 + 용무 / 고객 / 장소 / 매물 / 커밋」이다(0075).
 *
 *  조작은 **아이콘 컨트롤**로 줄 오른쪽에 작게. 줄마다 「완료」「삭제」 네모버튼을 나열하면
 *  다섯 줄에 버튼이 열 개가 되고, 화면이 읽는 곳이 아니라 누르는 곳이 된다(CLAUDE.md UI 어법).
 *  시각·장소는 **클릭-편집** — 눌러야 입력이 열리고 벗어나면 닫힌다.
 */
function SchedItem({ row: r, canEdit, canToggle, run, onGo }: {
  row: ScheduleRow; canEdit: boolean; canToggle: boolean;
  run: (fn: () => Promise<unknown>) => void; onGo: () => void;
}) {
  // 고칠 땐 커밋 때와 **같은 창**을 쓴다 — 두 벌을 들면 언젠가 한쪽만 고쳐진다.
  // 연필 아이콘은 없앴다(2026-08-25) — 줄을 누르면 그 창이 열린다.
  const [full, setFull] = useState(false);
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className={`cd-item c-${r.category ?? "일반"} ${r.state !== "예정" ? "off" : ""}`}
      onClick={() => canEdit && setFull(true)}
      title={canEdit ? "눌러서 고치기" : undefined}>
      <div className="cd-l1">
        <span className={`cd-hm num ${hm(r.at_time) ? "" : "none"}`}>{hm(r.at_time) ?? "시각"}</span>
        <b className="cd-title">{r.title}</b>
        {r.moved_from && <span className="cd-mv num" title={`원래 ${md(r.moved_from)}`}>↷ {md(r.moved_from)}</span>}
        {r.state === "완료" && <span className="cd-st">완료</span>}

        {/* 조작 — 소화와 삭제 둘. 아이콘으로 작게, 줄 오른쪽 */}
        {canToggle && (
          <span className="cd-ic" onClick={stop}>
            <button title={r.state === "예정"
                ? (r.category === "계약" ? "완료 — 계약 체결로 적힙니다" : "완료")
                : "예정으로 되돌리기"}
              className={r.state === "완료" ? "on" : ""}
              onClick={() => run(() => schedulesApi.patch(r.id, { state: r.state === "예정" ? "완료" : "예정" }))}>
              <Icon name="check" size={14} /></button>
            {canEdit && <button title="삭제" className="del" onClick={() => {
              // 일정과 그 근거 커밋은 한 몸이다 — 한쪽만 지우면 두 진실이 생긴다
              if (confirm(`「${r.title}」 일정과 이 일정을 만든 기록을 함께 지울까요?`))
                run(() => schedulesApi.remove(r.id));
            }}><Icon name="trash" size={13} /></button>}
          </span>
        )}
      </div>

      {/* 누가 오는가 — 계약 날엔 매도자와 매수자가 같이 온다 */}
      <div className="cd-who">
        {r.people.map((pp) => (
          <span className={`cd-p ${pp.kind}`} key={pp.id}>
            {pp.label ?? pp.phone ?? "이름 모름"}
          </span>
        ))}
        {r.people.length === 0 && <span className="cd-p none">고객 없음</span>}
      </div>

      {/* 어디서 · 어느 매물 · 우리 쪽 담당 */}
      <div className="cd-l2">
        <span className={`cd-place ${r.place ? "" : "none"}`}>{r.place ?? "장소"}</span>
        <button className="cd-addr lnk" onClick={(e) => { stop(e); onGo(); }}>{dongAddr(r.addr)} →</button>
        <span className="sp" />
        {r.assignee_name && <span className={`cd-by ${canEdit ? "me" : ""}`}>{r.assignee_name}</span>}
      </div>

      {/* 근거 — 이 약속을 만든 커밋 원문 */}
      {r.src_note && (
        <blockquote className="cd-src">{r.src_note}
          <cite>{(r.src_on ?? "").slice(5).replace("-", "/")}{r.src_by ? ` · ${r.src_by}` : ""}</cite>
        </blockquote>
      )}

      {full && (
        <div onClick={stop}>
          <SchedModal
            init={{ title: r.title, on: r.on_date.slice(0, 10), at: hm(r.at_time),
                    place: r.place, hint: "", category: r.category }}
            base={r.people[0] && r.people[0].kind !== "guest"
              ? { kind: r.people[0].kind, ref_id: r.people[0].ref_id!, label: r.people[0].label ?? "" }
              : null}
            addr={dongAddr(r.addr)} buildingPk={r.building_pk}
            onCancel={() => setFull(false)}
            onSkip={() => setFull(false)}
            onFinish={canToggle ? () => {
              setFull(false);
              run(() => schedulesApi.patch(r.id, { state: r.state === "예정" ? "완료" : "예정" }));
            } : undefined}
            onRemove={canEdit ? () => {
              if (!confirm(`「${r.title}」 일정과 이 일정을 만든 기록을 함께 지울까요?`)) return;
              setFull(false);
              run(() => schedulesApi.remove(r.id));
            } : undefined}
            onDone={(sc: SchedFinal) => {
              setFull(false);
              run(() => schedulesApi.patch(r.id, {
                on_date: sc.on, at_time: sc.at ?? "", title: sc.title, place: sc.place ?? "",
                people: sc.people, assignee_account_id: sc.assignee_account_id,
                category: sc.category,
              }));
            }} />
        </div>
      )}
    </div>
  );
}

export function CalendarTab({ onBuyer, onSeller }: {
  onBuyer: (id: number) => void;
  onSeller: (pk: string) => void;
}) {
  const qc = useQueryClient();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const [ym, setYm] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [pick, setPick] = useState<string>(() => isoDate(new Date()));   // 고른 날
  // 보고 있는 날을 대화창과 나눈다 — 날짜 없는 약속의 기본값이 된다.
  // 명령(「다음주 캘린더」)으로 온 날이 있으면 짚고 비운다.
  const { setDay, navDate, setNavDate } = useTradeCtx();
  useEffect(() => { setDay(pick); return () => setDay(null); }, [pick, setDay]);
  useEffect(() => {
    if (!navDate) return;
    setPick(navDate);
    const d = new Date(navDate); setYm(new Date(d.getFullYear(), d.getMonth(), 1));
    setNavDate(null);
  }, [navDate, setNavDate]);
  const [over, setOver] = useState<string | null>(null);        // 끌고 있는 자리
  const drag = useRef<ScheduleRow | null>(null);
  const [err, setErr] = useState<string | null>(null);
  /** 새 일정 — 캘린더 앱처럼 날짜에서 바로 만든다(2026-08-25).
   *  다만 **매물이나 사람에 붙어야** 저장된다 — 장부 없는 일정은 이 제품에 자리가 없다. */
  const [adding, setAdding] = useState<string | null>(null);
  const createSched = async (sf: SchedFinal) => {
    const on = adding; setAdding(null);
    if (!on) return;
    const p = sf.people.find((x) => x.kind !== "guest" && x.ref_id);
    const target = sf.building_pk ? { target_type: "listing", target_id: sf.building_pk }
      : p ? { target_type: p.kind, target_id: String(p.ref_id) } : null;
    const sched = {
      title: sf.title, on: sf.on, at: sf.at ?? null, place: sf.place ?? null,
      people: sf.people, category: sf.category,
      assignee_account_id: sf.assignee_account_id, method: sf.method };
    // 매물이나 사람에 붙으면 그 장부에도 줄이 선다. 아무 데도 안 붙는 일(사무실 청소)은
    // 붙일 장부가 없으니 일정만 만든다(2026-08-25).
    if (target) await contactsApi.create({ ...target, schedule: sched });
    else await schedulesApi.create({ ...sched, building_pk: sf.building_pk ?? null });
    qc.invalidateQueries({ queryKey: ["cal"] });
    qc.invalidateQueries({ queryKey: ["sales-today"] });
  };
  // 기본은 **내 담당** — 캘린더를 여는 이유는 대개 내가 어디 가야 하는지다.
  // 팀 전체는 겹침을 볼 때 켠다(대시보드와 같은 기본값).
  const [mine, setMine] = useState(true);
  // 1분마다 다시 그린다 — 「지금」 선이 실제로 움직여야 의미가 있다
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);
  // 내 계정 — 화면 다른 곳과 같은 자리에서 읽는다(SalesPage 의 me 쿼리와 같은 키)
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me }).data?.account_id;
  /** 내가 손댈 수 있는 줄인가 — 담당자 본인만(서버 규칙과 같은 자) */
  const mine_ = (r: ScheduleRow) => r.assignee_account_id == null || r.assignee_account_id === me;
  const canEdit = (r: ScheduleRow) => mine_(r);
  const canToggle = canEdit;

  /* 월요일 시작 6주 판 — 어느 달이든 42칸이면 다 선다. 칸 수가 달마다 출렁이면
     눈이 요일 자리를 다시 배워야 한다. */
  const days = useMemo(() => {
    const first = new Date(ym);
    const start = new Date(first);
    start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start); d.setDate(start.getDate() + i); return d;
    });
  }, [ym]);

  const range = { start: isoDate(days[0]), end: isoDate(days[41]) };
  const q = useQuery({
    queryKey: ["schedule", range.start, mine],
    queryFn: () => schedulesApi.range(range.start, range.end, mine),
  });

  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleRow[]>();
    for (const r of q.data ?? []) {
      const k = r.on_date.slice(0, 10);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return m;
  }, [q.data]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["schedule"] });
    qc.invalidateQueries({ queryKey: ["contacts"] });      // 장부에 자동으로 한 줄 섰다
    qc.invalidateQueries({ queryKey: ["proposals"] });
  };
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try { await fn(); refresh(); }
    catch (x) { setErr(String((x as Error)?.message ?? "고치지 못했습니다")); }
  };

  const go = (r: ScheduleRow) =>
    r.side === "buy" && r.buyer_id != null ? onBuyer(r.buyer_id) : onSeller(r.building_pk);

  const move = (n: number) => setYm(new Date(ym.getFullYear(), ym.getMonth() + n, 1));

  /* 키 몇 개만 — T(오늘) · ←/→(달) · ESC(닫기). 명령 팔레트는 안 만든다:
     중개인은 파워유저가 아니고, 외워야 쓰는 기능은 안 쓰인다. */
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable) return;
      if (e.key === "ArrowLeft") move(-1);
      else if (e.key === "ArrowRight") move(1);
      else if (e.key === "t" || e.key === "T" || e.key === "ㅅ") {
        const d = new Date(); setYm(new Date(d.getFullYear(), d.getMonth(), 1)); setPick(isoDate(d));
      } else if (e.key === "Escape") setErr(null);
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [ym]);
  const isThisMonth = ym.getFullYear() === today.getFullYear() && ym.getMonth() === today.getMonth();

  const day = byDay.get(pick) ?? [];
  const pickD = new Date(pick);
  const pickLabel = `${pickD.getMonth() + 1}월 ${pickD.getDate()}일 ${"일월화수목금토"[pickD.getDay()]}요일`;

  return (
    <div className="cal">
      {err && <div className="gtl-err">{err}<button className="lnk" onClick={() => setErr(null)}>닫기</button></div>}

      <div className="cal-head">
        <button className="cal-nav" onClick={() => move(-1)} title="이전 달">‹</button>
        <h2 className="num">{ym.getFullYear()}년 {ym.getMonth() + 1}월</h2>
        <button className="cal-nav" onClick={() => move(1)} title="다음 달">›</button>
        {!isThisMonth && (
          <button className="lnk cal-today" onClick={() => setYm(new Date(today.getFullYear(), today.getMonth(), 1))}>오늘</button>
        )}
        <span style={{ flex: 1 }} />
        <Segmented value={mine ? "mine" : "team"} onChange={(v) => setMine(v === "mine")}
          options={[{ value: "mine", label: "내 담당" }, { value: "team", label: "팀 전체" }]} />
      </div>

      <div className="cal-two">
      <div className="cal-grid">
        {WD.map((w) => <div key={w} className={`cal-wd ${w === "토" || w === "일" ? "we" : ""}`}>{w}</div>)}
        {days.map((d) => {
          const k = isoDate(d);
          const rows = byDay.get(k) ?? [];
          const out = d.getMonth() !== ym.getMonth();
          const isToday = d.getTime() === today.getTime();
          return (
            <div key={k}
              className={`cal-cell ${out ? "out" : ""} ${isToday ? "today" : ""} ${d < today ? "past" : ""} ${over === k ? "drop" : ""} ${pick === k ? "pick" : ""}`}
              onClick={() => setPick(k)}
              onDoubleClick={() => setAdding(k)}
              onDragOver={(e) => { if (drag.current) { e.preventDefault(); setOver(k); } }}
              onDragLeave={() => setOver((v) => (v === k ? null : v))}
              onDrop={(e) => {
                e.preventDefault(); setOver(null);
                const r = drag.current; drag.current = null;
                if (r && r.on_date.slice(0, 10) !== k) run(() => schedulesApi.patch(r.id, { on_date: k }));
              }}>
              <span className={`cal-n num ${d.getDay() === 0 || d.getDay() === 6 ? "we" : ""}`}>{d.getDate()}</span>
              {rows.map((r) => (
                <button
                  className={`cal-ev ${r.side} st-${r.state} c-${r.category ?? "일반"}`}
                  key={r.id}
                  draggable={canEdit(r)}
                  onDragStart={() => { drag.current = r; }}
                  onDragEnd={() => { drag.current = null; setOver(null); }}
                  onClick={(e) => { e.stopPropagation(); setPick(k); }}
                  title={`${hm(r.at_time) ?? ""} ${r.title} · ${r.assignee_name ?? ""} · ${(r.people ?? []).map((x) => x.label ?? x.phone).join(", ")}`}>
                  {/* 약속 이름 = **시각 + 용무 + 담당자**(오른쪽 판과 같은 규칙).
                      고객 이름은 안 쓴다 — 계약 자리처럼 여럿이 오면 한 명만 적는 게 거짓말이 된다.
                      미뤄진 표는 글자에 붙여 쓴다(따로 요소로 두면 알약이 두 줄로 부푼다). */}
                  {hm(r.at_time) && <i className="hm num">{hm(r.at_time)}</i>}
                  <b>{r.title}</b>{r.moved_from ? " ↷" : ""}
                  {r.assignee_name && <i className="by">{r.assignee_name}</i>}
                </button>
              ))}
            </div>
          );
        })}
      </div>

      {/* 오른쪽 — 고른 날의 일정과 **그 약속을 만든 커밋 원문**.
          날짜만 봐서는 「무슨 얘기 끝에 잡힌 약속인지」를 모른다. 장부로 건너뛰지 않고
          여기서 바로 읽히게 원문을 싣는다. 손대는 것(끝냄·취소·지움)도 여기서. */}
      <aside className="cal-day panel">
        <div className="sec-head">{pickLabel}
          {day.length > 0 && <span className="tag">{day.length}</span>}
          <span style={{ flex: 1 }} />
          <button className="cd-plus" title="이 날에 일정 만들기" onClick={() => setAdding(pick)}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          </button></div>

        {day.length === 0 && <div className="cd-none">이 날 잡힌 약속이 없습니다</div>}

        {/* 시각 있는 것 먼저, 미정은 뒤로(서버 정렬). 경계선은 안 긋는다 —
            대부분이 미정이라 그 선이 화면을 두 동강 내기만 한다. */}
        {/* 지금 선 — 오늘을 보고 있을 때만. 이미 지난 것과 남은 것이 눈으로 갈린다.
            시간 미정인 약속은 선 아래(뒤)에 남는다 — 시각이 없으니 지났다고 말할 수 없다. */}
        {day.map((r, i) => {
          const hhmm = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
          const isToday = pick === isoDate(now);
          const prev = day[i - 1];
          const crossed = isToday && r.at_time != null &&
            r.at_time.slice(0, 5) >= hhmm && (!prev?.at_time || prev.at_time.slice(0, 5) < hhmm);
          return (
            <div key={r.id}>
              {crossed && <div className="cd-now"><span className="num">{hhmm}</span></div>}
              <SchedItem row={r} canEdit={canEdit(r)} canToggle={canToggle(r)} run={run} onGo={() => go(r)} />
            </div>
          );
        })}
        {/* 오늘의 마지막 약속도 지났으면 선이 맨 아래 선다 */}
        {pick === isoDate(now) && day.length > 0 &&
          day.every((r) => !r.at_time || r.at_time.slice(0, 5) <
            `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`) && (
          <div className="cd-now last"><span className="num">
            {`${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`}</span></div>
        )}
      </aside>
      </div>

      {adding && (
        <SchedModal
          init={{ title: "", on: adding, at: null, place: null, hint: "", category: "일반" } as never}
          base={null} addr={null} buildingPk={null}
          onCancel={() => setAdding(null)} onSkip={() => setAdding(null)} onDone={createSched} />
      )}
    </div>
  );
}
