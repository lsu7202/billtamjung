/** 글이 가리킨 건물 — 답 문단 앞에 서는 카드(2026-09-21, 제미나이의 장소 카드 결).
 *
 *  왼쪽 큰 네모가 로드뷰다(건물을 바라보게 맞춰진 RoadviewMini 그대로 — 제미나이의 사진
 *  자리). 오른쪽은 이름·값·용도·준공 네 줄. 옛 BuildingCard(아이콘 한 줄)는 안 쓴다 —
 *  「별로다」(2026-09-21 대표). 로드뷰가 없는 자리면 그 칸을 빼고 글만 선다.
 *  어느 건물인지는 모델이 지목하는 게 아니다. 도구가 돌려준 핀의 주소(동 지번)가 문단에
 *  나오면 그 핀이다. 값은 카드가 **지금** 읽는다 — 다시 열어도 그때 값이 아니라 지금 값.
 *  상자·테두리 없이 대화에 그대로 녹는다. 주소 글자만 누르면 상세가 새 탭으로 열리고,
 *  로드뷰를 누르면 오른쪽 지도가 그 건물 필지로 간다. */
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "../../../shared/api/client";
import { wonShort } from "../../../shared/format";
import { loadNaver } from "../../../shared/map/naver";
import { RoadviewMini } from "../../../shared/map/Roadview";
import type { Pin } from "../api";

/** 파노라마 서브모듈이 **정말** 붙었나. `loadNaver` 는 `naver.maps.Map` 이 보이면 풀리는데
 *  panorama 는 그 뒤에 따로 오는 스크립트라, 첫 로드에서 카드가 그 틈에 `new Panorama` 를
 *  하면 죽고 RoadviewMini 가 「없음」으로 굳는다(2026-09-21 실측: 찬 뒤엔 셋 다 OK, 첫 로드는
 *  셋 다 없음). 여기서 서브모듈까지 기다렸다가 붙인다. 3초 넘게 안 오면 그냥 붙인다. */
function usePanoramaReady(): boolean {
  const [ok, setOk] = useState(() => !!(window as any).naver?.maps?.Panorama);
  useEffect(() => {
    if (ok) return;
    let alive = true;
    loadNaver().then(() => {
      const t0 = Date.now();
      const tick = () => {
        if (!alive) return;
        if ((window as any).naver?.maps?.Panorama || Date.now() - t0 > 3000) setOk(true);
        else setTimeout(tick, 50);
      };
      tick();
    }).catch(() => { if (alive) setOk(true); });   // SDK 자체가 안 오면 RoadviewMini 가 제 「없음」을 그린다
    return () => { alive = false; };
  }, [ok]);
  return ok;
}

const PY = 3.305785;
const py = (m2?: number | null) => (m2 == null ? null : `${(m2 / PY).toFixed(1)}평`);
const shortAddr = (a?: string | null) => (a ?? "").replace("서울특별시 ", "").replace("번지", "");
/** 준공일은 **아는 만큼만** 쓴다(0165). 정밀도가 「연」이면 「1959년」이지 「1959.01.01」이 아니다 */
function ymd(d?: string | null, prec?: string | null): string | null {
  if (!d) return null;
  const [y, m, day] = d.slice(0, 10).split("-");
  if (prec === "연") return `${y}년`;
  if (prec === "월") return `${y}년 ${Number(m)}월`;
  return `${y}.${m}.${day}`;
}

/** 핀 주소에서 문단과 맞춰 볼 열쇠 — 「서울특별시 강남구 삼성동 160-22번지」 → 「삼성동 160-22」 */
export function addrKey(addr: string): string {
  const w = shortAddr(addr).split(" ").filter(Boolean);
  return w.slice(-2).join(" ");
}

/** 문단에 그 건물이 나오나. 「세종로 1」이 「세종로 100」에 걸리지 않게 뒤에 숫자·붙임표가
 *  이어지면 다른 지번으로 본다 */
export function mentions(text: string, addr: string): boolean {
  const k = addrKey(addr);
  if (!k) return false;
  const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`${esc}(?![\\d-])`).test(text);
}

interface Detail {
  addr: string;
  floors_above?: number | null; floors_below?: number | null;
  total_area?: number | null; land_area?: number | null;
  approval_ymd?: string | null; approval_ymd_prec?: string | null;
  main_use_name?: string | null; use_zone?: string | null; elevator?: number | null;
}

const join = (xs: (string | null | undefined)[]) => xs.filter(Boolean).join(" · ");

export function BuildingHit({ pin, onFocus }: { pin: Pin; onFocus?: (pin: Pin) => void }) {
  const [noRV, setNoRV] = useState(false);
  const ready = usePanoramaReady();
  // 지번 페이지(10-08) — 건물이면 그 동을 골라 둔다
  const to = `/parcels/${pin.pnu ?? pin.pk}${pin.vacant ? "" : `?dong=${encodeURIComponent(pin.pk)}`}`;
  const q = useQuery({
    queryKey: ["bldg", pin.pk], enabled: !pin.vacant, staleTime: 60_000,
    queryFn: () => api<Detail>(`/buildings/${pin.pk}`),
  });
  const d = q.data;
  // 지도 핀과 같은 규칙(0226) — 매물이면 1번 매물의 매매가(없으면 미정), 매물이 아니면 추정가. 섞지 않는다
  const listing = pin.col != null && pin.col !== "normal";
  const priceTxt = listing ? (pin.price != null ? wonShort(pin.price) : "미정")
    : pin.sale_est != null ? wonShort(pin.sale_est) : null;
  const lines = pin.vacant
    ? [join([py(pin.land_area) && `대지 ${py(pin.land_area)}`]), "나대지", null]
    : [
        join([priceTxt,
              (d?.land_area ?? pin.land_area) != null ? `대지 ${py(d?.land_area ?? pin.land_area)}` : null,
              (d?.total_area ?? pin.total_area) != null ? `연면적 ${py(d?.total_area ?? pin.total_area)}` : null]),
        join([d?.main_use_name, d?.use_zone,
              d?.floors_above != null ? `${d.floors_below ? `지하 ${d.floors_below}·` : ""}지상 ${d.floors_above}층` : null]),
        join([ymd(d?.approval_ymd, d?.approval_ymd_prec) && `${ymd(d?.approval_ymd, d?.approval_ymd_prec)} 준공`,
              d?.elevator ? `승강기 ${d.elevator}대` : null]),
      ];
  return (
    <div className={`as-hit${noRV ? " norv" : ""}`}>
      {/* 로드뷰는 **늘 붙여 둔다.** onNone 은 상태가 바뀔 때마다 true/false 로 불리는데,
          처음 false 가 아닌 값이 왔을 때 떼어 버리면 뒤에 오는 OK 를 받을 자리가 없어
          종로 한복판 세 채가 다 「없음」이 됐다(2026-09-21 화면 확인 두 번). 떼지 않고
          class 로만 감춘다 — 그러면 OK 가 오는 순간 다시 보인다. */}
      {/* 로드뷰를 누르면 오른쪽 지도가 열리고 이 건물 필지로 간다(2026-09-22 대표) */}
      <div className="rvw" onClick={() => onFocus?.(pin)}>
        {ready
          ? <RoadviewMini lng={pin.lng} lat={pin.lat} className="rv" onNone={setNoRV} />
          : <div className="rv" />}
      </div>
      {/* 상세는 **주소 글자만** 누르면 새 탭으로. 로드뷰도 값 줄도 누르는 자리가 아니다(2026-09-21 대표) */}
      <div className="tx">
        <a className="t" href={to} target="_blank" rel="noopener">{shortAddr(pin.addr)}</a>
        {lines[0] && <span className="v">{lines[0]}</span>}
        {lines[1] && <span className="u">{lines[1]}</span>}
        {lines[2] && <span className="d">{lines[2]}</span>}
      </div>
    </div>
  );
}
