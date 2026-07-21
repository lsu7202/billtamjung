import { useQuery } from "@tanstack/react-query";
import { metaApi, EnumOpt } from "../api/endpoints";

/** enum 레지스트리 — 드롭다운 옵션 + 코드↔라벨 매핑(전역 캐시). */
export function useEnums() {
  const q = useQuery({ queryKey: ["enums"], queryFn: metaApi.enums, staleTime: Infinity });
  const map = q.data ?? {};
  return {
    options: (key: string): EnumOpt[] => map[key] ?? [],
    label: (key: string, code?: string | null): string => {
      if (!code) return "미지정";
      return map[key]?.find((o) => o.code === code)?.label ?? code;
    },
  };
}
