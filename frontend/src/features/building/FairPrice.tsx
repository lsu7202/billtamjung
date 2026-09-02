import { useQuery } from "@tanstack/react-query";
import { buildingsApi } from "../../shared/api/endpoints";
import { useReportModel } from "./reportModel";
import { useRentTotals } from "./rentTotals";

/** 머리줄에 서는 빌탐정 추정가 · 추정 수익률(2026-08-26).
 *
 *  탭 안 카드로 두면 그 탭을 열 때만 보인다. 그런데 이 값은 **어느 탭을 보고 있든**
 *  옆에 있어야 하는 값이다 — 임대료를 보면서도, 대장을 보면서도 「이 건물 얼마짜리더라」가
 *  기준이 된다. 매매가 칸 바로 옆이 제자리다: 실제 값이 없으면 그 자리를 추정이 메운다.
 *
 *  머리줄은 **추정 짝과 실측 짝을 갈라서** 낸다(2026-08-27).
 *    추정 짝 = 빌탐정 추정가 · 추정 수익률(추정임대 ÷ 추정가)   — 실측과 무관하게 늘 선다
 *    실측 짝 = 매매가 · 수익률(총임대료 ÷ 매매가)               — 둘 중 하나만 없어도 빈다
 *  분자·분모를 같은 출신끼리 짝지어야 두 숫자가 다를 때 「빌탐정은 이렇게 보는데 실제는
 *  이렇다」로 읽힌다. 섞으면 그 대비가 안 나오고, 무엇이 추정인지도 흐려진다.
 */
export function useFairPrice(pk: string) {
  const { fair, avgPerLand, nbhdRoi, nonCommercial } = useReportModel(null, pk);
  const tot = useRentTotals(pk);
  const b = useQuery({ queryKey: ["building", pk], queryFn: () => buildingsApi.get(pk) });
  const bd = b.data as Record<string, unknown> | undefined;
  const nOr = (x: unknown) => (x != null && x !== "" ? Number(x) : null);

  // ── 추정 짝 ── 추정임대 ÷ 추정가. 둘 다 시스템이 낸 값이라 「추정」 배지 하나가 묶음을 덮는다.
  const estRent = nOr(bd?.est_annual_rent);
  const roiEst = fair && estRent ? (estRent / fair) * 100 : null;

  // ── 실측 짝 ── 총임대료 × 12 ÷ 팀 매매가. 추정으로 메우지 않는다 — 없으면 빈다.
  const salePrice = nOr(bd?.sale_price);
  const roiReal = salePrice && tot.yearRent ? (tot.yearRent / salePrice) * 100 : null;

  return { fair, roiEst, roiReal, salePrice, avgPerLand, nbhdRoi, rent: tot.rent, nonCommercial,
           fromFloors: tot.fromFloors, floorRows: tot.floorRows, hasRent: !!tot.yearRent };
}
