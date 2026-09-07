import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { contactsApi, salesApi, schedulesApi,
  type TodayFeed, type TodaySched } from "../../../shared/api/endpoints";
import { SchedModal, type SchedFinal } from "../SchedModal";
import { SchedCalWhere, calTone } from "./SchedCal";
import { Loading } from "../../../shared/ui/Spinner";
import { Segmented } from "../../../shared/ui/Segmented";
import { dongAddr } from "../../../shared/format";
import "./todaytab.css";

/** 오늘 — 구획 셋(2026-08-25 확정).
 *
 *  **오늘 할일** 은 캘린더의 오늘을 그대로 보여주는 곳이다. 우리가 할 일을 정의하지 않는다 —
 *  사용자가 캘린더에 넣은 것이 곧 오늘의 할 일이고, 체크하면 사라진다.
 *  **다가오는 일정** 은 앞으로 올 큰 날. **혹시 잊으셨나요** 는 밀린 약속과 방치된 영업.
 *
 *  보는 법 둘(순서·시간)은 한 화면에 같이 서지 않는다. 절반 규칙으로 열고, 손 선택이 이긴다.
 *  보기를 바꾼다고 시각이 생기거나 지워지지 않는다 — 화면이 데이터를 바꾸지 않는다. */

const VIEW_KEY = "bt.today.view";
type View = "order" | "time";

/** 잊고 있던 것 한 줄 — 태그는 기한만 빨강(경고), 나머지는 회색이다 */
interface Forgot {
  tag: string; red?: boolean; t: string; s: string;
  sid?: number;                       // 이미 일정이면 소화·삭제가 붙고, 누르면 일정 창이 열린다
  row?: TodaySched;
  /** 아직 일정이 아니면 — 일정 창을 열 씨앗(사람이 창에서 정한다) */
  seed?: { title: string; pk?: string; buyer_id?: number; label?: string };
  go: () => void;
}

/** 서버가 말하는 성격을 화면 낱말로 — 판단 문구가 아니라 사실의 분류다 */
const TAG: Record<string, string> = {
  살건지묻기: "답 없음", 식은매수자: "답 없음",   // 물어봤는데 답이 없다
  브리핑하기: "막힘",                              // 담아만 두고 안 보여줬다
  재통화: "연락", 첫전화: "연락",
  검토중: "신호", 매도신호: "신호",
};
/** 아직 일정이 아닌 것의 기본 제목 — 사람이 창에서 고친다 */
const SEED_TITLE: Record<string, string> = { "답 없음": "전화", 연락: "전화", 막힘: "확인", 신호: "전화" };

const hm = (t: string) => t.slice(0, 5);
const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const who1 = (x: TodaySched) =>
  x.people?.length > 1 ? `${x.people[0]} 외 ${x.people.length - 1}`
    : (x.people?.[0] ?? x.who ?? "");
/** 부제 — 누가 · 어디. 없는 조각은 빼고 가운뎃점으로 잇는다 */
const sub = (x: TodaySched) =>
  [who1(x), x.place ?? (x.addr ? dongAddr(x.addr) : "")].filter(Boolean).join(" · ");

export function TodayTab({ onBuyer, onSeller }: {
  onBuyer: (id: number) => void; onSeller: (pk: string) => void;
}) {
  const qc = useQueryClient();
  const [mine, setMine] = useState(true);
  const q = useQuery({ queryKey: ["sales-today", mine], queryFn: () => salesApi.today(mine) });

  // 시각이 지나면 「지금」 선이 저절로 내려가야 한다 — 1분마다 다시 그린다
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60_000); return () => clearInterval(t); }, []);

  const [picked, setPicked] = useState<View | null>(
    () => (localStorage.getItem(VIEW_KEY) as View | null) ?? null);
  const pick = (v: View) => { setPicked(v); localStorage.setItem(VIEW_KEY, v); };

  const done = async (sid: number) => {
    await schedulesApi.patch(sid, { state: "완료" });
    qc.invalidateQueries({ queryKey: ["sales-today"] });
  };
  const drop = async (x: TodaySched) => {
    // 일정과 그 근거 기록은 한 몸이다 — 캘린더와 같은 말로 묻는다
    if (!confirm(`「${x.title}」 일정과 이 일정을 만든 기록을 함께 지울까요?`)) return;
    await schedulesApi.remove(x.id);
    qc.invalidateQueries({ queryKey: ["sales-today"] });
  };
  /** 밀린 약속을 눌렀을 때 — 캘린더와 같은 창에서 본다.
   *  참석자는 이 응답에 이름만 있어 되보낼 수 없다. 그래서 사람은 건드리지 않는다. */
  const [openRow, setOpenRow] = useState<TodaySched | null>(null);
  const patchRow = async (sf: SchedFinal) => {
    const x = openRow; setOpenRow(null);
    if (!x) return;
    await schedulesApi.patch(x.id, { on_date: sf.on, at_time: sf.at ?? "", title: sf.title,
      place: sf.place ?? "", category: sf.category });
    qc.invalidateQueries({ queryKey: ["sales-today"] });
  };
  /** 이미 일정인 것은 날짜만 오늘로 민다 — 새로 만들지 않는다 */
  const moveToday = async (sid: number) => {
    await schedulesApi.patch(sid, { on_date: isoDay(new Date()) });
    qc.invalidateQueries({ queryKey: ["sales-today"] });
  };
  /** 반대 방향 — 오늘 할일을 「잊으셨나요」로 끌면 내일로 민다(2026-08-28).
   *  끌어 올릴 수만 있고 내릴 수 없으면 손이 한쪽으로만 움직인다. */
  const putOff = async (sid: number) => {
    const t = new Date(); t.setDate(t.getDate() + 1);
    await schedulesApi.patch(sid, { on_date: isoDay(t) });
    qc.invalidateQueries({ queryKey: ["sales-today"] });
  };
  /** 아직 일정이 아닌 것 — 창에서 사람이 정한 값으로 만든다(장부 문장은 안 지어낸다) */
  const [seed, setSeed] = useState<Forgot["seed"] | null>(null);
  const create = async (sf: SchedFinal) => {
    const t = seed;
    setSeed(null);
    if (!t) return;
    const target = t.buyer_id != null
      ? { target_type: "buyer", target_id: String(t.buyer_id) }
      : { target_type: "listing", target_id: String(t.pk) };
    await contactsApi.create({
      ...target,
      schedule: { title: sf.title || t.title, on: sf.on, at: sf.at ?? null,
        place: sf.place ?? null, people: sf.people, category: sf.category,
        assignee_account_id: sf.assignee_account_id, method: sf.method },
    });
    qc.invalidateQueries({ queryKey: ["sales-today"] });
  };

  if (q.isLoading) return <Loading label="불러오는 중" minHeight="40vh" />;
  const d = q.data;
  if (!d) return null;

  return (
    <>
      <Board d={d} now={now} mine={mine} setMine={setMine}
        picked={picked} pick={pick} done={done} moveToday={moveToday} putOff={putOff} drop={drop}
        onOpenRow={setOpenRow} onSeed={setSeed} onBuyer={onBuyer} onSeller={onSeller} />
      {openRow && (
        <SchedModal
          init={{ title: openRow.title, on: openRow.on_date.slice(0, 10),
                  at: openRow.at_time ? openRow.at_time.slice(0, 5) : null,
                  place: openRow.place, hint: "", category: openRow.category ?? "일반" } as never}
          base={null} addr={openRow.addr ? dongAddr(openRow.addr) : null}
          buildingPk={openRow.building_pk}
          onCancel={() => setOpenRow(null)} onSkip={() => setOpenRow(null)} onDone={patchRow}
          onFinish={() => { const x = openRow; setOpenRow(null); if (x) done(x.id); }}
          onRemove={() => { const x = openRow; setOpenRow(null); if (x) drop(x); }} />
      )}
      {seed && (
        <SchedModal
          init={{ title: seed.title, on: isoDay(new Date()), at: null, place: null, hint: "",
                  category: "일반" } as never}
          base={seed.buyer_id != null
            ? { kind: "buyer", ref_id: seed.buyer_id, label: seed.label ?? "" } : null}
          addr={null} buildingPk={seed.pk ?? null}
          onCancel={() => setSeed(null)} onSkip={() => setSeed(null)} onDone={create} />
      )}
    </>
  );
}

function Board({ d, now, mine, setMine, picked, pick, done, moveToday, putOff, drop, onOpenRow,
                onSeed, onBuyer, onSeller }: {
  d: TodayFeed; now: Date; mine: boolean; setMine: (b: boolean) => void;
  picked: View | null; pick: (v: View) => void;
  done: (sid: number) => void;
  moveToday: (sid: number) => void;
  putOff: (sid: number) => void;
  drop: (x: TodaySched) => void;
  onOpenRow: (x: TodaySched) => void;
  onSeed: (s: Forgot["seed"]) => void;
  onBuyer: (id: number) => void; onSeller: (pk: string) => void;
}) {
  const go = (x: TodaySched) =>
    x.side === "buy" && x.buyer_id ? onBuyer(x.buyer_id) : onSeller(x.building_pk);
  // 밀린 약속을 「오늘 할일」 카드로 끌어다 놓기(2026-08-28)
  const [dragId, setDragId] = useState<number | null>(null);
  /** 어느 카드에서 집었나. **놓은 곳이 집은 곳이면 아무것도 안 한다.**
   *
   *  두 카드가 각자 드롭 영역인데(오늘 할일=오늘로, 혹시 잊으셨나요=내일로),
   *  「혹시 잊으셨나요」 안의 줄을 끌다가 그 카드 안에 놓으면 **약속이 조용히 내일로 밀렸다**
   *  (2026-09-05 지적). 손이 빗나간 것을 미루기로 읽으면 안 된다. */
  const [dragFrom, setDragFrom] = useState<"today" | "forgot" | null>(null);
  const [dropOn, setDropOn] = useState(false);     // 오늘 할일이 받을 때
  const [dropOff, setDropOff] = useState(false);   // 잊으셨나요가 받을 때(= 내일로)

  const cur = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  // 체크하면 사라진다 — 끝낸 것을 회색으로 남겨 두지 않는다(2026-08-25)
  const all = d.today_sched.filter((x) => x.state !== "완료");
  const timed = all.filter((x) => x.at_time);
  const untimed = all.filter((x) => !x.at_time);

  /** 순서 — 시각 있는 것이 시각순으로 먼저, 시각 없는 것이 뒤 */
  const order = useMemo(() => [...all].sort((a, b) =>
    (a.at_time ? 0 : 1) - (b.at_time ? 0 : 1)
    || (a.at_time ?? "").localeCompare(b.at_time ?? "")), [all]);

  // 절반 규칙 + 손 선택 우선
  const auto: View = all.length && timed.length * 2 > all.length ? "time" : "order";
  const view: View = all.length ? (picked ?? auto) : "order";

  /** 잊고 있던 것 — 밀린 약속이 먼저, 그다음 서버가 셈한 방치 */
  const forgot: Forgot[] = [
    ...d.overdue.map((x) => ({
      tag: "밀림", red: true, sid: x.id, row: x,
      t: `${x.title} 약속이 ${-x.in_days}일 지났습니다`,
      s: sub(x) || "—",
      go: () => onOpenRow(x),
    })),
    ...d.my_turn.map((x) => ({
      tag: TAG[x.kind] ?? x.kind,
      t: x.why,
      s: [x.buyer_name ?? x.owner_name, x.addr ? dongAddr(x.addr) : ""].filter(Boolean).join(" · ") || "—",
      seed: { title: SEED_TITLE[TAG[x.kind] ?? ""] ?? "확인", pk: x.building_pk,
              buyer_id: x.buyer_id, label: x.buyer_name ?? x.owner_name ?? "" },
      go: () => (x.buyer_id ? onBuyer(x.buyer_id) : x.building_pk && onSeller(x.building_pk)),
    })),
  ].slice(0, 6);

  const soon = (d.upcoming ?? []).slice(0, 6);

  return (
    <div className="td">
      <div className="td-head">
        <h2>{now.getMonth() + 1}월 {now.getDate()}일 <span>{"일월화수목금토"[now.getDay()]}요일</span></h2>
        {all.length > 0 && <span className="td-cnt">{all.length}</span>}
        <span className="sp" />
        <Segmented value={mine ? "mine" : "team"} onChange={(v) => setMine(v === "mine")}
          options={[{ value: "mine", label: "내 담당" }, { value: "team", label: "팀 전체" }]} />
      </div>
      {/* 파이프라인 요약줄(매물 4 · 합의 1건 128억 · 계약 3 685억)은 뺐다(2026-08-29).
          대시보드는 「오늘 뭘 하지」를 보는 자리인데 저 줄은 아무 할 일도 가리키지 않는다.
          건수와 총액은 매물·매수자 탭이 각자 세고 있어, 여기선 날짜 아래 곁말로만 떠 있었다. */}

      {/* ── 오늘 할일 ── 캘린더의 오늘 그대로.
           밀린 약속을 여기로 끌어다 놓으면 날짜만 오늘로 민다(2026-08-28).
           「오늘로」 글자를 찾아 누르는 것보다 끌어다 놓는 쪽이 짧다. */}
      <div className={`td-card${dropOn ? " drop" : ""}`}
        onDragOver={(e) => { if (dragId != null && dragFrom !== "today") { e.preventDefault(); setDropOn(true); } }}
        onDragLeave={() => setDropOn(false)}
        onDrop={(e) => { e.preventDefault(); setDropOn(false);
          if (dragId != null && dragFrom !== "today") moveToday(dragId);
          setDragId(null); setDragFrom(null); }}>
        <div className="td-sw">
          <span className="td-h">오늘 할일</span>
          <span className="sp" />
          {all.length > 0 && (
            <Segmented value={view} onChange={(v) => pick(v as View)}
              options={[{ value: "order", label: "순서" }, { value: "time", label: "시간" }]} />
          )}
        </div>

        {!all.length ? (
          <div className="td-none">오늘 할 일이 없습니다
            </div>
        ) : view === "order" ? (
          <Order rows={order} now={now} go={go} done={done}
                 onDrag={(id) => { setDragId(id); setDragFrom(id == null ? null : "today"); }} />
        ) : (
          <Time timed={timed} untimed={untimed} now={now} cur={cur} go={go} done={done}
                onDrag={(id) => { setDragId(id); setDragFrom(id == null ? null : "today"); }} />
        )}
      </div>

      {/* ── 혹시 잊으셨나요 ── 밀린 약속과 방치된 영업 */}
      {forgot.length > 0 && (
        <div className={`td-card${dropOff ? " drop" : ""}`}
          onDragOver={(e) => { if (dragId != null && dragFrom !== "forgot") { e.preventDefault(); setDropOff(true); } }}
          onDragLeave={() => setDropOff(false)}
          onDrop={(e) => { e.preventDefault(); setDropOff(false);
            if (dragId != null && dragFrom !== "forgot") putOff(dragId);
            setDragId(null); setDragFrom(null); }}>
          <div className="td-sw"><span className="td-h">혹시 잊으셨나요</span></div>
          {forgot.map((f, i) => (
            <button className="td-f" key={`f${i}`} onClick={f.go}
              draggable={!!f.row}
              onDragStart={() => { if (f.row) { setDragId(f.row.id); setDragFrom("forgot"); } }}
              onDragEnd={() => { setDragId(null); setDragFrom(null); setDropOn(false); }}>
              <span className={`td-tag${f.red ? " r" : ""}`}>{f.tag}</span>
              <span className="tx"><b className="t">{f.t}</b><span className="s">{f.s}</span></span>
              {f.row ? (
                <span className="td-acts" onClick={(e) => e.stopPropagation()}>
                  <span className="td-add" role="button" onClick={() => moveToday(f.row!.id)}>오늘로</span>
                  <button className="td-ck" title="끝냄" onClick={() => done(f.row!.id)}><Check /></button>
                  <button className="td-ck del" title="삭제" onClick={() => drop(f.row!)}><Trash /></button>
                </span>
              ) : f.seed && (f.seed.pk || f.seed.buyer_id != null) ? (
                <span className="td-add" role="button"
                  onClick={(e) => { e.stopPropagation(); onSeed(f.seed); }}>일정 잡기 ＋</span>
              ) : null}
            </button>
          ))}
        </div>
      )}
      {/* ── 다가오는 일정 ── 앞으로 올 큰 날. 할 일이 아니라 일정이라
           매물 판과 **같은 달력 카드**를 쓴다 — 같은 것은 같게 생겨야 한다 */}
      {soon.length > 0 && (
        <div className="td-soon">
          <span className="td-h">다가오는 일정</span>
          <div className="scals">
            {soon.map((x) => (
              <SchedCalWhere key={`u${x.id}`} name={x.title} on={x.on_date.slice(0, 10)} at={x.at_time}
                where={dongAddr(x.addr) || x.who}
                tone={calTone(x.on_date.slice(0, 10), x.state, (x.category ?? "") === "계약")}
                onClick={() => go(x)} />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

/* ── 순서 보기 ── 시각은 아예 안 쓴다. 하루에서 제일 큰 글자가 「지금 할 일」 하나 */
function Order({ rows, now, go, done, onDrag }: {
  rows: TodaySched[]; now: Date; go: (x: TodaySched) => void; done: (sid: number) => void;
  /** 「잊으셨나요」로 끌어 내리면 내일로 민다(2026-08-28) */
  onDrag?: (id: number | null) => void;
}) {
  const head = rows[0] ?? null;
  const rest = rows.slice(1);

  /** 왜 지금인가 — 판단이 아니라 시각과 지금의 차이다 */
  const why = (x: TodaySched) => {
    if (!x.at_time) return null;
    const m = Math.round(
      (new Date(`${x.on_date.slice(0, 10)}T${x.at_time}`).getTime() - now.getTime()) / 60000);
    if (m < 0) return { late: true, s: `${hm(x.at_time)} 약속이 지났습니다` };
    return { late: false, s: m < 60 ? `${m}분 뒤입니다` : `${Math.floor(m / 60)}시간 뒤입니다` };
  };
  const w = head ? why(head) : null;

  return (
    <div className="td-one">
      <div>
        <span className="td-k">지금 할 일</span>
        {head && (
          <div className="td-nowrap">
            <button className="td-now" onClick={() => go(head)}
              draggable onDragStart={() => onDrag?.(head.id)} onDragEnd={() => onDrag?.(null)}>
              <span className="huge">{head.title}</span>
              <span className="where">{sub(head) || "—"}</span>
              {w && <span className={`why${w.late ? " late" : ""}`}>{w.s}</span>}
            </button>
            <button className="td-ck big" title="끝냄" onClick={() => done(head.id)}><Check /></button>
          </div>
        )}
      </div>
      {rest.length > 0 && (
        <div>
          <span className="td-k">그다음</span>
          <div className="td-rest">
            {rest.map((x, i) => (
              <div className="td-r" key={x.id}>
                <button className="tr" onClick={() => go(x)}
                  draggable onDragStart={() => onDrag?.(x.id)} onDragEnd={() => onDrag?.(null)}>
                  <span className="n">{i + 2}</span>
                  <span className="tx"><b className="t">{x.title}</b>
                    <span className="s">{sub(x) || "—"}</span></span>
                </button>
                <button className="td-ck" title="끝냄" onClick={() => done(x.id)}><Check /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 시간 보기 ── 축 위에 놓인다. 「지금」은 빨간 가로선 하나 */
const SLOT = 54;
function Time({ timed, untimed, now, cur, go, done, onDrag }: {
  timed: TodaySched[]; untimed: TodaySched[]; now: Date; cur: string;
  go: (x: TodaySched) => void; done: (sid: number) => void;
  onDrag?: (id: number | null) => void;
}) {
  // 축 범위는 약속에 맞춰 자란다 — 빈 시간대를 열 줄씩 세워 두지 않는다
  const hs = timed.map((x) => Number(x.at_time!.slice(0, 2)));
  const nowH = now.getHours();
  const lo = Math.max(0, Math.min(9, ...hs, nowH));
  const hi = Math.min(23, Math.max(18, ...hs.map((h) => h + 1), nowH));
  const hours = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);

  const top = (t: string) =>
    (Number(t.slice(0, 2)) - lo) * SLOT + (Number(t.slice(3, 5)) / 60) * SLOT;
  const nowTop = (now.getHours() - lo) * SLOT + (now.getMinutes() / 60) * SLOT;
  const inRange = now.getHours() >= lo && now.getHours() <= hi;

  return (
    <>
      <div className="td-grid">
        {hours.map((h) => (
          <Fragment key={h}><div className="h">{h}</div><div className="s" /></Fragment>
        ))}
        <div className="td-ovl">
          {timed.map((x) => (
            <button className={`td-ev${hm(x.at_time!) >= cur ? " on" : ""}`} key={x.id}
              style={{ top: top(x.at_time!) + 3, height: SLOT - 8 }} onClick={() => go(x)}
              draggable onDragStart={() => onDrag?.(x.id)} onDragEnd={() => onDrag?.(null)}>
              <b>{x.title}</b><small>{sub(x) || "—"}</small>
            </button>
          ))}
          {inRange && <span className="td-nowline" style={{ top: nowTop }} />}
        </div>
      </div>

      {untimed.length > 0 && (
        <div className="td-any">
          <span className="td-k">시각 없이 오늘 안에</span>
          {untimed.map((x) => (
            <button className="td-f" key={x.id} onClick={() => go(x)}
              draggable onDragStart={() => onDrag?.(x.id)} onDragEnd={() => onDrag?.(null)}>
              <span className="td-ck" role="button" title="끝냄"
                onClick={(e) => { e.stopPropagation(); done(x.id); }}><Check /></span>
              <span className="tx"><b className="t">{x.title}</b>
                <span className="s">{sub(x) || "—"}</span></span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

const Trash = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" /></svg>
);

const Check = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 12.5 9.5 18 20 6.5" /></svg>
);
