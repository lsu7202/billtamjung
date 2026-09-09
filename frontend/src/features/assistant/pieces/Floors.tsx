/** 층별 임대 — 읽기 전용.
 *
 *  **층이 쌓이는 게 정보다.** 그래서 표가 아니라 층 더미다: 1층부터 위로, 그다음 옥탑,
 *  맨 아래가 지하(FloorRows 의 frank·sfloor 규칙 그대로 — 화면마다 층 차례가 다르면 안 된다).
 *  값은 이미 글자로 오고 우리는 계산하지 않는다. 단위도 서버가 붙여 보낸 그대로다.
 *
 *  층을 모르는 업체는 **맨 아래 한 줄로 뭉친다.** 하나씩 세우면 스무 곳짜리 건물에서
 *  진짜 층이 화면 밖으로 밀린다. 편집은 없다 — 고치는 자리는 매물 화면이다. */
import { Frame } from "./Grids";

type Row = {
  층?: string; 호?: string; 상호?: string; 업종?: string; 면적?: string;
  보증금?: string; 월세?: string; 관리비?: string; 공실?: boolean;
};

/** 같은 층인지 가르는 값(FloorRows 와 같은 규칙) — 옥탑1층이 1층과 한 층으로 묶이면 안 된다 */
const sfloor = (fl?: string): number | null => {
  if (!fl) return null;
  const n = parseInt(fl.replace(/\D/g, ""), 10);
  if (/^(옥탑|옥상|PH|RF?)/i.test(fl.trim())) return 900 + (isNaN(n) ? 1 : n);
  if (/지하|^\s*B/i.test(fl)) return isNaN(n) ? -1 : -n;
  return isNaN(n) ? null : n;
};

/** 화면 차례 — 1층부터 위로, 그다음 옥탑, 맨 아래 지하. 작을수록 위 */
const frank = (fl?: string): number => {
  const t = String(fl ?? "").trim();
  const n = Number(t.replace(/[^0-9]/g, "")) || 0;
  if (/^(옥탑|옥상|PH|RF?)/i.test(t)) return 1000 + n;
  if (/^(지하|지|B)/i.test(t)) return 2000 + n;
  return n;
};

export function Floors({ p }: { p: Record<string, any> }) {
  const rows: Row[] = Array.isArray(p.rows) ? p.rows : [];
  const unknown: string[] = (Array.isArray(p.unknown) ? p.unknown : []).filter(Boolean).map(String);
  const totals: Record<string, string> = p.총면적 && typeof p.총면적 === "object" ? p.총면적 : {};

  const groups = new Map<string, { label: string; rank: number; rows: Row[] }>();
  for (const r of rows) {
    const fl = String(r.층 ?? "").trim();
    const sf = sfloor(fl);
    const key = sf == null ? `?${fl}` : String(sf);
    const g = groups.get(key) ?? { label: fl, rank: fl ? frank(fl) : 2900, rows: [] };
    g.rows.push(r);
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) => a.rank - b.rank);
  if (!list.length && !unknown.length) return null;

  // 총면적 열쇠는 「3층」·「B1」처럼 표기가 갈릴 수 있다 — 같은 층으로 읽히는 열쇠까지 본다
  const totalOf = (label: string): string | null => {
    if (totals[label]) return totals[label];
    const sf = sfloor(label);
    if (sf == null) return null;
    const hit = Object.keys(totals).find((k) => sfloor(k) === sf);
    return hit ? totals[hit] : null;
  };

  return (
    <Frame title={p.title} foot={p.foot}>
      <div className="gd-fl">
        {list.map((g, i) => {
          const tot = totalOf(g.label);
          return (
            <div className="gd-fr" key={i}>
              <div className="f">
                <b>{g.label || "—"}</b>
                {tot && <i>{tot}</i>}
              </div>
              <div className="u">
                {g.rows.map((r, j) => (
                  <div className={`gd-fu ${r.공실 ? "vac" : ""}`} key={j}>
                    <span className="n">
                      {r.호 && <em>{r.호}</em>}
                      {r.공실 ? <b>공실</b> : r.상호 && <b>{r.상호}</b>}
                      {r.업종 && <span className="biz">{r.업종}</span>}
                    </span>
                    <span className="m">{r.면적 ?? ""}</span>
                    <span className="m">{r.보증금 ?? ""}</span>
                    <span className="m">{r.월세 ?? ""}</span>
                    <span className="m">{r.관리비 ?? ""}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        {unknown.length > 0 && <div className="gd-fx">{unknown.join(" · ")}</div>}
      </div>
    </Frame>
  );
}
