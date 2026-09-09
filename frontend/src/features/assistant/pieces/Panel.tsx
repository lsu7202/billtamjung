/** 묶음 — 부품 여럿을 한 덩이로.
 *
 *  panel 은 **테두리를 안 그린다.** 안쪽 조각이 이미 카드라 겹치면 액자가 두 겹이 된다 —
 *  여기서 주는 건 제목과 간격뿐이다.
 *
 *  재귀는 여기 지도(GRID_PIECES)가 쥔다. Message 의 목록에서 끌어오면 Message ↔ Panel 이
 *  서로를 부르는 고리가 생겨서, 반대로 Message 가 이 지도를 가져다 쓴다.
 *  panel 안의 panel 은 한 겹까지 — 더 들어가면 안 그린다. 무한히 접히는 답은 답이 아니다. */
import { CalendarPiece } from "./CalendarPiece";
import { Floors } from "./Floors";
import { Chart, KV, List, Stats, Table } from "./Grids";
import { MapPiece } from "./MapPiece";
import { Media } from "./MediaPiece";

type Make = (p: Record<string, any>, depth?: number) => JSX.Element | null;

/** 모델이 지목할 수 있는 그릇 — Message 의 PIECES 도 이걸 펼쳐 쓴다 */
export const GRID_PIECES: Record<string, Make> = {
  kv: (p) => <KV p={p} />,
  stats: (p) => <Stats p={p} />,
  table: (p) => <Table p={p} />,
  chart: (p) => <Chart p={p} />,
  list: (p) => <List p={p} />,
  map: (p) => <MapPiece p={p} />,
  media: (p) => <Media p={p} />,
  floors: (p) => <Floors p={p} />,
  calendar: (p) => <CalendarPiece p={p} />,
  panel: (p, depth = 0) => <Panel p={p} depth={depth + 1} />,
};

export function Panel({ p, depth = 0 }: { p: Record<string, any>; depth?: number }) {
  if (depth > 1) return null;
  const parts: any[] = Array.isArray(p.parts) ? p.parts : [];
  const kids: JSX.Element[] = [];
  parts.forEach((pt, i) => {
    const make = pt && typeof pt.name === "string" ? GRID_PIECES[pt.name] : undefined;
    const el = make ? make((pt.props as Record<string, any>) ?? {}, depth) : null;
    if (el) kids.push(<div className="gd-pp" key={i}>{el}</div>);
  });
  if (!kids.length) return null;
  return (
    <div className={`gd-pn ${p.dir === "row" ? "row" : ""}`}>
      {p.title && <div className="gd-pt">{p.title}</div>}
      {kids}
    </div>
  );
}
