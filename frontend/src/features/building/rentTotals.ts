import { useQuery } from "@tanstack/react-query";
import { rentsApi, listingsApi } from "../../shared/api/endpoints";

/** 임대 총계의 **정본**(0134) — 수익률의 분자는 여기서만 나온다.
 *
 *  채우는 길은 둘이고, 둘 다 있으면 **층별이 이긴다**:
 *    ① 층별 실측이 있으면 그 합계(일부만 넣었으면 그 일부의 합)
 *    ② 층별이 없으면 팀이 직접 적은 총액(app.listings.total_*)
 *
 *  예전엔 「팀 입력 + 미입력층 대장 추정」을 섞은 하이브리드(0030)를 썼다. 한 층만 넣어도
 *  나머지가 추정으로 채워져 수익률이 섰고, 그 값은 실측도 추정도 아니었다. 층별 임대시세를
 *  미리 안 채워두는 원칙과 같은 이유로 총계도 지어내지 않는다 — 없으면 없다고 한다.
 *  추정 임대는 임대 탭에서 「추정」 배지를 달고 따로 선다. 섞이지 않는다.
 */
export function useRentTotals(pk: string) {
  const rents = useQuery({ queryKey: ["rents", pk], queryFn: () => rentsApi.list(pk) });
  const listing = useQuery({ queryKey: ["listing", pk], queryFn: () => listingsApi.get(pk) });
  const l = (listing.data ?? {}) as Record<string, unknown>;
  // 매물 줄의 총액이 정본이다(0173) — 호실 줄에 돈이 적혀 있으면 서버가 이미 그 합으로 접어 둔다.
  // 원장에서 복사한 업체 줄(0185)은 돈 칸이 비어 있어 「층별에서 왔다」로 세지 않는다
  // 「층별에서 왔다」= 임대중 호실 전부에 월임대가 적혀 있다 — 서버가 그때만 호실 합으로 총액을 덮는다(2026-09-27 (다)안)
  const occ = (rents.data?.items ?? []).filter((x) => x.occupied);
  const floorRows = occ.length;
  const fromFloors = occ.length > 0 && occ.every((x) => (x.rent ?? 0) > 0);
  const n = (x: unknown) => (x != null && x !== "" ? Number(x) : null);
  const rent = n(l.total_rent);
  const deposit = n(l.total_deposit);
  const mgmt = n(l.total_mgmt);
  return {
    rent, deposit, mgmt, fromFloors, floorRows,
    /** 연 임대료(원) — 수익률의 분자. 총임대료가 없으면 null 이고, 그러면 수익률도 안 선다 */
    yearRent: rent ? rent * 12 : null,
    loading: rents.isLoading || listing.isLoading,
  };
}
