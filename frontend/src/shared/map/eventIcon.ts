import type { IconName } from "../ui/Icon";

/** 소식 하나를 지도에 어떤 아이콘으로 찍나 — 그리고 **빅 이벤트인가**(2026-09-06 대표 지시).
 *
 *  아이콘으로 말할 수 있는 것은 몇 가지 안 된다. 그래도 된다 — 학교가 선다, 공사가 잡혔다 같은
 *  큰 일만 제 아이콘을 갖고 나머지는 깃발(기타)이다. 그런데 기타가 너무 많으면 지도가 더러워진다.
 *  그래서 지도의 **기본은 빅 이벤트만**이고, 나머지는 사용자가 「전부」를 골라야 나온다.
 *  목록에는 전부 선다 — 지도만 가린다. */
export function eventIcon(e: { kind: string; name: string | null; source: string }): { icon: IconName; big: boolean } {
  const n = e.name ?? "";
  if (e.kind === "정비·개발") return { icon: "crane", big: true };
  if (e.kind === "정책 발표") return { icon: "megaphone", big: true };
  if (e.kind === "건축 인허가") return /철거|멸실/.test(n) ? { icon: "demolish", big: true } : { icon: "building", big: true };
  if (e.kind === "기반시설") {
    if (/학교|초등|중학|고등|대학|유치원/.test(n)) return { icon: "school", big: true };
    if (/철도|지하철|경전철|역사|정거장|정류장|환승|GTX|노선/.test(n)) return { icon: "subway", big: true };
    if (/공원|녹지|수목원|둘레길/.test(n)) return { icon: "tree", big: true };
    if (e.source === "나라장터") return { icon: "works", big: true };      // 공사가 잡혔다 — 발주
  }
  return { icon: "flag", big: false };                                     // 규제 · 도로 결정 · 나머지
}

/** 아이콘 아홉 — 지도 필터 칩·범례·소식 목록이 같이 쓴다. `major` 가 지도의 기본 켜짐(2026-09-06 대표).
 *  건물(신축)은 한 화면에 150개라 기본 꺼짐, 깃발(기타)도 꺼짐. */
export const EVENT_TYPES: { icon: IconName; label: string; major: boolean }[] = [
  { icon: "crane", label: "정비·개발", major: true },
  { icon: "school", label: "학교", major: true },
  { icon: "subway", label: "철도·역", major: true },
  { icon: "tree", label: "공원", major: true },
  { icon: "works", label: "공사 발주", major: true },
  { icon: "demolish", label: "철거", major: true },
  { icon: "megaphone", label: "정책 발표", major: true },
  { icon: "building", label: "신축·증축", major: false },
  { icon: "flag", label: "규제·기타", major: false },
];
export const MAJOR_TYPES: IconName[] = EVENT_TYPES.filter((t) => t.major).map((t) => t.icon);

/** 검색 지도의 기본 핀 — 주요 종류만. 강남 한 화면(줌 15)에 163개 중 152개가 신축 인허가라 건물 핀을 덮었다(2026-09-06 실측). */
export function isMajor(e: { kind: string; name: string | null; source: string }): boolean {
  return MAJOR_TYPES.includes(eventIcon(e).icon);
}
