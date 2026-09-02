import "./bldgtab.css";

/** 실거래 비교 — 건물 상세 실거래 탭과 검색 사이드카드가 **같이 쓰는** 부품(2026-08-28).
 *
 *  세 값을 가로막대로 견준다: 주변 실거래가 중앙 · 이 건물 실거래가 · 이 건물 추정가.
 *
 *  왜 이름을 다 적나: 예전엔 「이 건물」이라고만 적고 값은 추정가를 썼다. 그래서 실거래가
 *  아예 없는 건물(서울의 85.7%)에서도 숫자가 서고, 상세에 들어가면 실거래 탭이 비어 있었다.
 *  왜 막대는 평당인가: 총액으로 그리면 길이가 값이 아니라 건물 크기를 말한다.
 *  삼성동 157-11 은 총액 136억으로 주변 중앙 132억보다 큰데 평당은 그 절반이다(604평이라).
 *  차이(−48%)는 안 적는다 — 막대 길이가 이미 그 말을 한다.
 */
export interface CompareRow {
  /** 총액(원) — 없으면 「—」 */ price: number | null;
  /** 연면적 평당(원) — 막대 길이의 자 */ per: number | null;
}
const eok = (v: number | null) =>
  v == null ? null : v >= 1e8 ? `${Math.round(v / 1e8).toLocaleString()}억` : `${Math.round(v / 1e4).toLocaleString()}만`;
const manPy = (v: number | null) => (v == null ? null : `${Math.round(v / 1e4).toLocaleString()}만`);

export function TradeCompare({ near, mine, est, title = "한눈에", note }: {
  near: CompareRow; mine: CompareRow; est: CompareRow;
  title?: string; note?: string;
}) {
  const rows: [string, CompareRow, string, string][] = [
    ["주변 실거래가 중앙", near, "", "없음"],
    ["이 건물 실거래가", mine, "me", "거래된 적 없음"],
    ["이 건물 추정가", est, "est", "없음"],
  ];
  const max = Math.max(...rows.map(([, r]) => r.per ?? 0), 1);
  return (
    <div className="bg-card tc-card">
      <div className="bg-ttl">{title}
        <span className="tc-unit">{note ?? "실거래가 · 연면적 평당"}</span>
      </div>
      <div className="tc-plot">
        {rows.map(([label, r, kind, empty]) => (
          <div className="tc-b" key={label}>
            <span className={`k ${kind === "est" ? "est" : ""}`}>{label}</span>
            <span className="t">{r.per != null && (
              <i className={kind} style={{ width: `${Math.max(2, (r.per / max) * 100)}%` }} />)}</span>
            {r.per == null ? (
              <span className="v none">{empty}</span>
            ) : (
              <span className={`v ${kind === "est" ? "est" : ""}`}>
                <b>{eok(r.price) ?? "—"}</b><u>{manPy(r.per)}</u></span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
