/** 금액 표기 통일 — 원(정수) 입력. 여기 한 곳만 고치면 전 화면 일관. */

/** 한국식 정밀 금액: "1억 8,400만" · "1억" · "3,000만" · 0/null="". (표·값 기본) */
export function won(n?: number | null): string {
  if (n == null || n === 0 || Number.isNaN(n)) return "";
  const neg = n < 0;
  let eok = Math.floor(Math.abs(n) / 1e8);
  let man = Math.round((Math.abs(n) % 1e8) / 1e4);
  if (man >= 10000) { eok += 1; man -= 10000; }   // 반올림 경계(1억 10,000만 → 2억)
  const s = eok && man ? `${eok}억 ${man.toLocaleString()}만` : eok ? `${eok}억` : `${man.toLocaleString()}만`;
  return neg ? `-${s}` : s;
}

/** 컴팩트 금액(차트·좁은 셀): "1.2억" · "3,000만". */
export function wonShort(n?: number | null): string {
  if (n == null || n === 0 || Number.isNaN(n)) return "";
  const a = Math.abs(n);
  const s = a >= 1e8 ? `${(a / 1e8).toFixed(a >= 1e9 ? 0 : 1)}억` : `${Math.round(a / 1e4).toLocaleString()}만`;
  return n < 0 ? `-${s}` : s;
}

/** 평당 만원: 총액(원) ÷ 평. */
export function perPyMan(total?: number | null, areaPy?: number | null): string {
  return total && areaPy ? `${Math.round(total / areaPy / 1e4).toLocaleString()}만/평` : "";
}

/** ㎡당 만원(원/㎡ 입력): 공시지가 등. */
export function manPerM2(perM2?: number | null): string {
  return perM2 ? `${Math.round(perM2 / 1e4).toLocaleString()}만` : "";
}
