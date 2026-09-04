/** 나란한 두 값 — 막대는 이 건물, 눈금이 주변. 값 옆에 차이만 적는다.
 *
 *  임대료·보증금·수익률·실거래가 같은 문법을 쓴다(2026-08-26 공용화).
 *  차이는 **금액과 백분율을 같이** 낸다: 「+692만 +14%」. 돈만 적으면 큰 값에서 감이 안 오고
 *  (5,123만에 +692만이 큰지 작은지), %만 적으면 작은 값에서 부풀어 보인다(120만에 +30%).
 *  수익률처럼 이미 비율인 값은 dFmt 를 주면 그것만 쓴다 — %의 % 는 뜻이 없다.
 */
export function Pair({ a, b, fmt, side, eps = 1e4, dFmt }: {
  a: number | null; b: number | null; fmt: (v: number) => string;
  /** 값 옆에 작게 붙는 곁말 — 평당처럼 같은 값을 다른 단위로 볼 때 */
  side?: string | null;
  /** 이보다 작은 차이는 안 적는다 — 돈은 1만, 수익률은 0.01 */
  eps?: number;
  /** 차이의 표기 — 수익률 차이도 % 로 적는다. %p 는 쓰지 않는다(2026-09-04 규칙) */
  dFmt?: (v: number) => string;
}) {
  const max = Math.max(a ?? 0, b ?? 0) * 1.06 || 1;
  const d = a != null && b != null ? a - b : null;
  return (
    <div className="rv-pair">
      <div className="rv-pv">{a != null ? fmt(a) : "—"}
        {d != null && Math.abs(d) >= eps && (
          <small className={d >= 0 ? "up" : ""}>
            {d >= 0 ? "+" : "−"}{(dFmt ?? fmt)(Math.abs(d))}
            {!dFmt && b ? <em>{d >= 0 ? "+" : "−"}{Math.round(Math.abs(d / b) * 100)}%</em> : null}
          </small>)}
        {side && <span className="side">{side}</span>}
      </div>
      <div className="rv-pg">
        <i style={{ width: `${Math.max(2, (a ?? 0) / max * 100)}%` }} />
        {b ? <u style={{ left: `${Math.min(99, b / max * 100)}%` }} /> : null}
      </div>
      <div className="rv-pn">주변 {b != null ? fmt(b) : "—"}</div>
    </div>
  );
}
