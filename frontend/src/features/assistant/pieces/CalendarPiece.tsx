/** 달력 한 달 — 일정이 있는 날만 표시가 선다.
 *
 *  월 격자는 **넓은 자리에서만** 그린다. 채팅 폭에서 7열은 한 칸이 손톱만 해져 날짜만 읽히고
 *  무슨 일이 있는지는 못 읽는다 — 좁으면 날짜별 세로 목록으로 떨어진다(같은 자료, 다른 배치).
 *  둘 다 그려 두고 폭이 고른다(@container). 격자는 눌러서 펴고, 목록은 이미 펴져 있다.
 *
 *  요일은 월요일부터 — 캘린더 화면(WD)과 같은 차례다. 값이 없는 날은 아무것도 안 그린다. */
import { useState } from "react";

import { Frame } from "./Grids";

type Item = { title: string; tag?: string };
type Day = { date: string; items: Item[] };

const WEEK = ["월", "화", "수", "목", "금", "토", "일"];

export function CalendarPiece({ p }: { p: Record<string, any> }) {
  const days: Day[] = (Array.isArray(p.days) ? p.days : [])
    .filter((d: any) => d && typeof d.date === "string" && Array.isArray(d.items) && d.items.length)
    .sort((a: Day, b: Day) => a.date.localeCompare(b.date));
  const [sel, setSel] = useState<string | null>(null);

  const month = typeof p.month === "string" && /^\d{4}-\d{2}/.test(p.month)
    ? p.month.slice(0, 7) : days[0]?.date.slice(0, 7);
  if (!month || !days.length) return null;
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));

  const byDate = new Map<string, Item[]>();
  for (const d of days) byDate.set(d.date, [...(byDate.get(d.date) ?? []), ...d.items]);

  const first = new Date(y, m - 1, 1);
  const lead = (first.getDay() + 6) % 7;               // 월요일 시작
  const last = new Date(y, m, 0).getDate();
  const cells: (number | null)[] = [
    ...Array(lead).fill(null),
    ...Array.from({ length: last }, (_, i) => i + 1),
  ];
  while (cells.length % 7) cells.push(null);
  const iso = (d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const open = sel ? byDate.get(sel) ?? [] : [];

  return (
    <Frame title={p.title ?? `${y}년 ${m}월`} foot={p.foot}>
      {/* 넓은 자리 — 월 격자 */}
      <div className="gd-cal">
        <div className="mo">
          {WEEK.map((w, i) => <div className={`wd ${i >= 5 ? "we" : ""}`} key={w}>{w}</div>)}
          {cells.map((d, i) => {
            const key = d ? iso(d) : null;
            const its = key ? byDate.get(key) : undefined;
            return (
              <div className={`c ${d ? "" : "out"} ${key && key === sel ? "on" : ""}`} key={i}>
                {d && (
                  its
                    ? <button onClick={() => setSel((s) => (s === key ? null : key))}>
                        <span className="n">{d}</span><span className="dot" />
                      </button>
                    : <span className="n">{d}</span>
                )}
              </div>
            );
          })}
        </div>
        {open.length > 0 && (
          <div className="gd-li">
            {open.map((it, i) => (
              <div className="gd-l" key={i}>
                {it.tag && <span className="g">{it.tag}</span>}
                <span className="t">{it.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 좁은 자리 — 날짜별 세로 목록 */}
      <div className="gd-cald">
        {days.map((d) => (
          <div className="r" key={d.date}>
            <div className="d">
              <b>{Number(d.date.slice(8, 10))}</b>
              <i>{WEEK[(new Date(`${d.date}T00:00:00`).getDay() + 6) % 7]}</i>
            </div>
            <div className="v">
              {d.items.map((it, i) => (
                <div className="gd-l" key={i}>
                  {it.tag && <span className="g">{it.tag}</span>}
                  <span className="t">{it.title}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Frame>
  );
}
