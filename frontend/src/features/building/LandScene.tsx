import { lazy, Suspense } from "react";
import { Loading } from "../../shared/ui/Spinner";
import { num } from "./reportModel";
import { buildingsApi } from "../../shared/api/endpoints";
import { useQuery } from "@tanstack/react-query";
import "./report.css";

const ParcelScene3D = lazy(() => import("./ParcelScene3D").then((m) => ({ default: m.ParcelScene3D })));

/** 입체 지적도 — 대지 모양·접한 도로·현재 용적을 한 장면에 세운다.
 *
 *  「세로한면(가)」라는 대장 낱말을 읽고 머리로 그림을 그려야 했던 게 지금까지다.
 *  도형이 있으면 좁은 길에 붙었다는 것도, 대지가 정방형이라는 것도 보면 안다.
 *  브리핑에만 있던 그림이라(리포트를 만들어야 보였다) 아무도 못 보고 있었다.
 */
export function LandScene({ pk, b, id, fetchScene }: {
  pk: string; b: Record<string, unknown>; id?: string;
  /** 조회 함수를 밖에서 준다 — 나대지는 pnu 로 찾고, 도로도 필지 폴리곤에서 잰다(2026-08-27) */
  fetchScene?: (id: string) => Promise<{
    roads: { rn: string; road_bt: number | null; geojson: unknown }[];
    legal_bcr: number[] | null; legal_far: number[] | null;
  }>;
}) {
  const q = useQuery({ queryKey: ["scene", pk], queryFn: () => (fetchScene ?? buildingsApi.scene)(pk) });
  const parcel = b.parcel_geom;
  if (!parcel || !q.data) return null;
  // 법정값은 숫자 목록으로 온다(0153): [250] 하나이거나 [50,60] 병기.
  // 병기면 부피를 안 그린다 — 하나를 고르면 지어내는 것이다.
  const pct = (v: unknown) =>
    Array.isArray(v) && v.length === 1 && Number.isFinite(Number(v[0])) ? Number(v[0]) : null;
  return (
    <section className="rv-card" id={id}>
      <span className="rv-k">입체 지적도</span>
      <div className="rv-scene">
        <Suspense fallback={<Loading label="입체 지적도 그리는 중" minHeight={300} />}>
          <ParcelScene3D data={{
            parcel: parcel as never, roads: (q.data.roads ?? []) as never,
            landArea: num(b.land_area), totalArea: num(b.total_area),
            bcr: num(b.bcr), far: num(b.far),
            legalBcr: pct(q.data.legal_bcr), legalFar: pct(q.data.legal_far),
            useZone: String(b.use_zone ?? "") || null,
            frontRn: String(b.road_front_rn ?? "") || null,
            floorsAbove: num(b.floors_above), height: num(b.height),
            slope: String(b.slope ?? "") || null,
          }} />
        </Suspense>
      </div>
      {/* 도로접면·대지 모양·지세를 줄로 적지 않는다(2026-08-26) — 같은 탭의 건물정보·토지정보에
          이미 있는 값이라 두 번 적는 꼴이었다. 그림이 하는 말을 글로 옮길 이유가 없다. */}
    </section>
  );
}

