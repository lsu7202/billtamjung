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

/** **월 단위 금액**(월 임대료·월 관리비) — 억으로 안 끊는다.
 *  월세는 억으로 끊는 돈이 아니다. `won()` 을 쓰면 월 임대료 1억 2,000만원짜리
 *  건물이 「1억 2,000만」으로 찍혀 보증금처럼 읽힌다(2026-09-05 지적).
 *  총계처럼 큰 값도 「12,000만」으로 둔다 — 자릿수가 길어도 단위가 하나면 견줄 수 있다. */
export function wonMan(n?: number | null): string {
  if (n == null || n === 0 || Number.isNaN(n)) return "";
  const s = `${Math.round(Math.abs(n) / 1e4).toLocaleString()}만`;
  return n < 0 ? `-${s}` : s;
}

/** 컴팩트 금액(차트·좁은 셀): "1.2억" · "3,000만". */
export function wonShort(n?: number | null): string {
  if (n == null || n === 0 || Number.isNaN(n)) return "";
  const a = Math.abs(n);
  const s = a >= 1e8 ? `${(a / 1e8).toFixed(a >= 1e9 ? 0 : 1)}억` : `${Math.round(a / 1e4).toLocaleString()}만`;
  return n < 0 ? `-${s}` : s;
}

/** 정확 금액(돈 칩·계약 값) — 값이 뭉개지면 안 되는 곳. "13.5억" · "13억 1,500만" · "125억".
 *  wonShort는 차트·좁은 셀용 컴팩트 표기(10억↑ 반올림)라 계약 돈에 쓰면 13.5억이 14억으로 보인다(2026-08-24). */
export function wonAcc(n?: number | null): string {
  if (n == null || Number.isNaN(n) || n === 0) return "";
  const neg = n < 0; const a = Math.abs(n);
  const eok = Math.floor(a / 1e8);
  const man = Math.round((a - eok * 1e8) / 1e4);
  let s: string;
  if (eok === 0) s = `${man.toLocaleString()}만`;
  else if (man === 0) s = `${eok.toLocaleString()}억`;
  else if (man % 1000 === 0) s = `${eok.toLocaleString()}.${man / 1000}억`;
  else s = `${eok.toLocaleString()}억 ${man.toLocaleString()}만`;
  return neg ? `-${s}` : s;
}

/** 평당 만원: 총액(원) ÷ 평. */
export function perPyMan(total?: number | null, areaPy?: number | null): string {
  return total && areaPy ? `${Math.round(total / areaPy / 1e4).toLocaleString()}만/평` : "";
}

/** ㎡당 만원(원/㎡ 입력): 공시지가 등. */
export function manPerM2(perM2?: number | null): string {
  return perM2 ? `${Math.round(perM2 / 1e4).toLocaleString()}만` : "";
}

/* ── 주소·날짜 표기 — 거래 화면 다섯 파일이 제각각 들고 있던 것(2026-08-14 정리) ── */

/** 주소 압축(구 유지): 「강남구 삼성동 118-25」 — 매물 제목 자리. */
export const shortAddr = (a?: string | null) =>
  (a ?? "").replace("서울특별시 ", "").replace("번지", "");

/** 주소 압축(동부터): 「삼성동 118-25」 — 칩·좁은 줄. */
export const dongAddr = (a?: string | null) =>
  (a ?? "").replace("서울특별시 ", "").replace(/^(\S+구)\s*/, "").replace("번지", "");

/** ISO(YYYY-MM-DD…) → 「M/D」. */
export const md = (s: string) => `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}`;

/** Date → 로컬 기준 YYYY-MM-DD. toISOString 은 UTC 라 자정 근처에 하루가 밀린다. */
export const isoDate = (d: Date) => {
  const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return z.toISOString().slice(0, 10);
};

/** 오늘+plus 일의 로컬 YYYY-MM-DD. */
export const isoDay = (plus = 0) => {
  const d = new Date(); d.setDate(d.getDate() + plus);
  return isoDate(d);
};

/** 일정을 낳은/일정에서 난 커밋의 한 줄 표시 — 「일정이름 · 시간 · 커밋내용」(2026-08-15).
 *  매수·매도·매물 어디서든 같은 일정 id 에서 파생하므로 이름이 어긋날 수 없다.
 *  일정을 미루면 이 표시도 따라온다(저장된 문장은 원문 그대로 남는다). */
export const schedLine = (row: {
  sched_title?: string | null; sched_on?: string | null; sched_at?: string | null;
  sched_note?: string | null; note?: string | null; status?: string | null;
}): string | null => {
  if (!row.sched_title || !row.sched_on) return null;
  const when = md(row.sched_on) + (row.sched_at ? ` ${row.sched_at.slice(0, 5)}` : "");
  // 단계가 실린 줄(계약 체결 등)은 **자기 문구**가 사건의 내용이다 — 원문으로 덮지 않는다.
  const body = row.status ? (row.note ?? row.sched_note) : (row.sched_note ?? row.note);
  return `${row.sched_title} · ${when}` + (body ? ` · ${body}` : "");
};

/** 커밋이 적힌 시각 HH:MM — 소급 기록(다른 날을 말하고 적은 것)이면 null.
 *  자정(00:00)으로 세워진 소급 타임스탬프도 시각이 아니다 — 지어내지 않는다. */
export const commitTime = (ts?: string | null, day?: string | null): string | null => {
  if (!ts) return null;
  if (day && ts.slice(0, 10) !== day.slice(0, 10)) return null;
  const hm = ts.slice(11, 16);
  return hm === "00:00" ? null : hm;
};

/** 제안 칩 표기(0086) — 제안 상태는 마지막 답글에 따라 「제안수락·제안거절」로 갈려 보인다.
 *  저장된 상태는 그대로다(답글은 상태가 아니다) — 표기만 갈래를 얹는다. */
