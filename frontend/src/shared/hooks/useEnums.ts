import { useQuery } from "@tanstack/react-query";
import { metaApi, EnumOpt } from "../api/endpoints";

/** enum 레지스트리 — 드롭다운 옵션 + 코드↔라벨 매핑(전역 캐시). */
export function useEnums() {
  // Infinity였다가 5분으로 — 마이그레이션으로 enum이 늘면 새로고침 없이도 따라와야 한다(0049 사고)
  const q = useQuery({ queryKey: ["enums"], queryFn: metaApi.enums, staleTime: 5 * 60_000 });
  const map = q.data ?? {};
  return {
    options: (key: string): EnumOpt[] => map[key] ?? [],
    label: (key: string, code?: string | null): string => {
      if (!code) return "미지정";
      return map[key]?.find((o) => o.code === code)?.label ?? code;
    },
  };
}
