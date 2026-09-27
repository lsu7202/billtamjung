/** 답 한 통 — 조각 목록을 그린다. 정본 10-AI-어시스턴트 §8-1 · §12 · §13
 *
 *  글은 글대로, 부품은 우리 부품으로, 되물음은 칩으로. 모델이 부품 코드를 쓰지 않는다 —
 *  이름과 인자만 내고 여기서 진짜 부품을 그린다(§12-1). 선언 없는 이름은 안 그린다.
 *
 *  도구 흔적은 접힌 한 줄이다. 「자료를 읽었다」는 사실만 보이고, 누르면 무엇을 불렀는지 편다.
 *  기다리는 동안 무슨 도구를 부르는지 보이는 것만으로 체감이 다르다(§7 · 스펙 ⑦). */
import { Fragment, useState } from "react";

import type { Piece, Pin, ToolLog } from "./api";
import { Markdown } from "./Markdown";
import { BuildingHit, mentions } from "./pieces/BuildingHit";

/** 답은 **글**이다. 모델이 부품을 지목하지 않는다 — 규격을 씌우면 답이 이상해져 걷어 냈다
 *  (2026-09-21 대표). 화면이 글을 읽고 건물 카드만 끼운다. 옛 대화에 남은 다른 조각(ui·ask)은
 *  그리지 않고 지나간다. */
export function Pieces({ pieces, live, pins, onFocus }: {
  pieces: Piece[]; live?: boolean;
  /** 이 답이 돌려준 건물들. 글이 그 주소를 부르는 문단 앞에 카드가 선다 */
  pins?: Pin[];
  /** 카드의 로드뷰를 누르면 — 오른쪽 지도가 그 건물로 간다 */
  onFocus?: (pin: Pin) => void;
}) {
  // 같은 건물은 한 번만. 답 한 통 안에서 센다
  const used = new Set<string>();
  return (
    <>
      {pieces.map((p, i) => {
        if (p.t === "text") {
          const v = p.v.trim();
          if (!v) return null;
          if (!pins?.length) return <div className="as-m assistant md" key={i}><Markdown text={v} /></div>;
          // 문단 단위로 가른다. 표·목록은 빈 줄을 안 넘으니 따로 그려도 같다
          return (
            <div className="as-m assistant md" key={i}>
              {v.split(/\n{2,}/).map((c, j) => {
                const hit = pins.find((pn) => !used.has(pn.pk) && mentions(c, pn.addr));
                if (hit) used.add(hit.pk);
                return <Fragment key={j}>{hit && <BuildingHit pin={hit} onFocus={onFocus} />}<Markdown text={c} /></Fragment>;
              })}
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
/** 모델이 무엇을 보냈나. **경로만 보이면 모자란다** — /search 는 경로가 늘 같고
 *  본문이 다르다. 「무엇을 물었길래 이 답이 나왔나」가 화면에서 보여야 한다(2026-09-09 대표). */
const short = (o: Record<string, unknown>) => {
  const parts: string[] = [];
  if (o.path) parts.push(String(o.path));
  if (o.query && Object.keys(o.query as object).length) parts.push(JSON.stringify(o.query));
  if (o.body) parts.push(JSON.stringify((o.body as Record<string, unknown>).filters ?? o.body));
  if (o.sql) parts.push(String(o.sql));
  if (!parts.length) parts.push(JSON.stringify(o));
  return parts.join(" ").replace(/\s+/g, " ").slice(0, 220);
};
