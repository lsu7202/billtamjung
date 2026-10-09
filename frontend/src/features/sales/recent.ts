/** 최근 들락날락한 매물(2026-08-25).
 *
 *  일정 창에서 매물을 붙일 때 「이름을 몰라 못 찾는」 일이 잦다. 그래서 검색을 치기 전에
 *  **최근 연 순서**로 먼저 보여 준다. 기준은 이 창이 아니라 **사용자가 매물을 연 차례**다 —
 *  방금 보던 매물이 맨 위에 있어야 손이 멈추지 않는다.
 *
 *  서버에 안 남긴다. 「어느 매물을 언제 봤나」는 팀이 알아야 할 사실이 아니라 이 사람의
 *  손버릇이다. 브라우저를 옮기면 초기화되고, 그때는 그냥 최근 등록순으로 보인다.
 */
const KEY = "bt.recentListing";   // 매물 번호(0255). 옛 열쇠(bt.recentPk)는 건물 번호라 버린다
const CAP = 20;

export function recentListings(): number[] {
  try {
    const raw = localStorage.getItem(KEY);
    const a = raw ? JSON.parse(raw) : [];
    return Array.isArray(a) ? a.filter((x) => typeof x === "number") : [];
  } catch { return []; }
}

/** 매물을 열었다 — 맨 앞으로 올린다 */
export function touchListing(lid: number | null | undefined) {
  if (lid == null) return;
  try {
    const next = [lid, ...recentListings().filter((x) => x !== lid)].slice(0, CAP);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch { /* 저장이 막힌 브라우저 — 최근순이 없을 뿐 화면은 그대로 선다 */ }
}
