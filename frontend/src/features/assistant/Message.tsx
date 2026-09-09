/** 답 한 통 — 조각 목록을 그린다. 정본 10-AI-어시스턴트 §8-1 · §12 · §13
 *
 *  글은 글대로, 부품은 우리 부품으로, 되물음은 칩으로. 모델이 부품 코드를 쓰지 않는다 —
 *  이름과 인자만 내고 여기서 진짜 부품을 그린다(§12-1). 선언 없는 이름은 안 그린다.
 *
 *  도구 흔적은 접힌 한 줄이다. 「자료를 읽었다」는 사실만 보이고, 누르면 무엇을 불렀는지 편다.
 *  기다리는 동안 무슨 도구를 부르는지 보이는 것만으로 체감이 다르다(§7 · 스펙 ⑦). */
import { useState } from "react";

import type { Piece, ToolLog } from "./api";
import { Markdown } from "./Markdown";
import { BuildingCard } from "./pieces/BuildingCard";
import { SearchResult } from "./pieces/SearchResult";
import { GRID_PIECES } from "./pieces/Panel";

/** 모델이 지목할 수 있는 부품. **여기 없으면 안 그린다** — 새 부품은 기본이 금지(§12-1) */
const PIECES: Record<string, (props: Record<string, unknown>) => JSX.Element | null> = {
  building_card: (p) => (typeof p.pk === "string" ? <BuildingCard pk={p.pk} /> : null),
  search_result: (p) => <SearchResult filters={(p.filters as Record<string, unknown>) ?? {}} polygon={p.polygon} />,
  // 그릇 열(§12-1-1) — kv · stats · table · chart · list · map · media · panel · floors · calendar.
  // 값은 서버가 채워 보낸다(여기선 그리기만 한다). 지도는 panel 이 재귀로 다시 쓰므로
  // 목록의 정본은 pieces/Panel.tsx 에 둔다 — 두 벌이면 한쪽만 늘어난다
  ...GRID_PIECES,
};

export function Pieces({ pieces, onPick, live }: {
  pieces: Piece[]; onPick?: (t: string) => void; live?: boolean;
}) {
  return (
    <>
      {pieces.map((p, i) => {
        if (p.t === "text") {
          const v = p.v.trim();
          return v ? <div className="as-m assistant md" key={i}><Markdown text={v} /></div> : null;
        }
        if (p.t === "ui") {
          const make = PIECES[p.name];
          return make ? <div className="as-piece" key={i}>{make(p.props ?? {})}</div> : null;
        }
        // 「다음 걸음」 칩은 뺐다(2026-09-09 대표). 옛 대화에 남은 조각은 그냥 지나간다
        if (p.t === "next") return null;
        if (p.t === "ask") {
          return (
            <div className="as-ask" key={i}>
              <div className="q">{p.question}</div>
              <div className="chips">
                {p.options.map((o) => (
                  <button key={o} className="chip" disabled={!onPick} onClick={() => onPick?.(o)}>{o}</button>
                ))}
              </div>
            </div>
          );
        }
        return null;
      })}
      {live && pieces.length === 0 && <div className="as-m assistant"><span className="as-dots" /></div>}
    </>
  );
}

/** 흘러오는 중의 도구 한 줄, 끝난 뒤의 접힌 기록. 둘 다 같은 부품 */
export function Tools({ log, running }: { log: ToolLog[]; running?: string | null }) {
  const [open, setOpen] = useState(false);
  if (!log.length && !running) return null;
  return (
    <div className={`as-tools ${open ? "open" : ""}`}>
      <button className="as-th" onClick={() => setOpen((v) => !v)}>
        {running
          ? <><span className="as-dots" /> {label(running)}</>
          : <>자료 {log.length}번 읽음{log.some((l) => l.error) && <i> · 오류 {log.filter((l) => l.error).length}</i>}</>}
      </button>
      {open && (
        <div className="as-tl">
          {log.map((l, i) => (
            <div key={i} className={l.error ? "bad" : ""}>
              <b>{l.name}</b>
              <span className="in">{short(l.input)}</span>
              <span className="out">{l.error ?? l.summary} · {l.ms}ms</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const LABEL: Record<string, string> = {
  call_api: "자료를 읽는 중", query: "표를 세는 중", describe: "칸을 보는 중", list_tables: "표를 보는 중",
  list_endpoints: "길을 보는 중", describe_endpoint: "길을 보는 중", result_page: "다음 줄을 읽는 중",
  codes: "코드를 보는 중", ask: "되묻는 중", web_search: "웹을 찾는 중",
};
const label = (name: string) => LABEL[name] ?? `${name} 중`;
const short = (o: Record<string, unknown>) => {
  const s = o.sql ?? o.path ?? o.table ?? o.q ?? JSON.stringify(o);
  return String(s).replace(/\s+/g, " ").slice(0, 90);
};
