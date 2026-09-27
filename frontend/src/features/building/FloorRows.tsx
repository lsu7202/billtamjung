import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { rentsApi, type FloorGroup, type LedgerRoom, type Tenant } from "../../shared/api/endpoints";

/** 층별 정보(건물 상세) — 대장과 업체 원장만 읽는다(2026-09-26 나눔).
 *
 *  업체는 지금 있는 업체(카카오 장소 크롤링, master.biz)다. 링크는 걸지 않는다(스펙 11 §9).
 *  팀 값(호실·임대료·공실)은 여기 없다. 그건 매물의 「임대 내역」에만 있다 — 누구나 보는 건물 상세와
 *  우리 팀이 확인한 기록을 섞지 않는다. 내 매물이면 머리에 「임대 내역 →」 한 줄로 그리로 간다.
 *
 *  왼쪽은 훑는 곳(층 · 업체), 오른쪽은 고른 층 하나 — 업체(이름 · 업종 나무)가 위, 대장 값(용도 · 바닥면적 · 전유부)이 아래.
 *  **전유부는 참조다.** 대장 호실은 등기 단위라 실제 칸과 다르다. 중개사가 말하는 호실은 업체 단위다.
 */

const P = 3.305785;

/** 업체 한 줄 — 이름 · 업종 나무(오른쪽, 「음식점 › 중식」) · 영업장면적(원장으로 대신했을 때만) */
function TenantLine({ t, areaTxt }: { t: Tenant; areaTxt: (m2?: number | null) => string | null }) {
  return (
    <div className="fl2-ti">
      <b>{t.name}</b>
      {areaTxt(t.area) && <span>{areaTxt(t.area)}</span>}
      {t.cat_nodes?.length ? <i className="cat">{t.cat_nodes.join(" › ")}</i> : null}
    </div>
  );
}

export function FloorRows({ pk, unit, onLedger }: {
  pk: string; unit: "py" | "m2";
  /** 있으면 머리에 「임대 내역 →」 — 내 매물일 때만 부모가 준다 */
  onLedger?: () => void;
}) {
  const fq = useQuery({ queryKey: ["floor-info", pk], queryFn: () => rentsApi.info(pk) });
  const floors: FloorGroup[] = fq.data?.floors ?? [];
  const unknown: Tenant[] = fq.data?.unknown ?? [];
  const areaTxt = (m2?: number | null) =>
    m2 == null ? null : `${(unit === "py" ? m2 / P : m2).toFixed(1)}${unit === "py" ? "평" : "㎡"}`;

  const [pick, setPick] = useState<string | null>(null);        // 층 이름 · 「?」 = 층 미상
  const curUn = pick === "?" && unknown.length > 0;
  const cur = curUn ? null : floors.find((g) => g.floor === pick) ?? floors[0] ?? null;
  const [roomsOpen, setRoomsOpen] = useState(false);
  const rooms: LedgerRoom[] = cur?.rooms ?? [];

  const kv = (label: string, node: React.ReactNode) => (
    <><span className="dk">{label}</span><span className="dv">{node}</span></>
  );

  return (
    <div className="bg-card">
      <div className="bg-ttl">층별 정보
        {onLedger && <button className="rst add" onClick={onLedger}>임대 내역 →</button>}
      </div>

      <div className="fl2">
        <div className="fl2-l">
          <div className="fl2-lh"><span>층</span><span>업체</span></div>
          {unknown.length > 0 && (
            <button className={`fl2-i ${curUn ? "on" : ""}`} onClick={() => setPick("?")}>
              <b className="off">—</b>
              <span className="nm">{unknown[0].name}{unknown.length > 1 ? ` 외 ${unknown.length - 1}` : ""}</span>
              <span className="bz">{unknown.length}곳</span>
            </button>
          )}
          {/* 업체마다 한 줄(층 이름은 되풀이). 업체를 모르는 층은 한 줄에 대장 용도를 흐리게 */}
          {floors.flatMap((g) => (g.ledger.length ? g.ledger.map((t) => t.name) : [null]).map((nm, i) => (
            <button key={`${g.floor}-${nm ?? i}`} className={`fl2-i ${!curUn && cur?.floor === g.floor ? "on" : ""}`}
              onClick={() => { setPick(g.floor); setRoomsOpen(false); }}>
              <b>{g.floor}</b>
              <span className="nm">{nm ?? <i className="off">{g.uses.length ? g.uses.join(" · ") : "—"}</i>}</span>
            </button>
          )))}
        </div>

        <div className="fl2-r">
          {curUn && (
            <>
              <div className="fl2-rh"><b className="off">층 미상</b><span>{unknown.length}곳</span></div>
              <div className="fl2-t">
                {unknown.map((t) => <TenantLine key={t.name} t={t} areaTxt={areaTxt} />)}
              </div>
            </>
          )}
          {cur && (
            <>
              <div className="fl2-rh"><b>{cur.floor}</b></div>
              {/* 업체가 먼저(2026-09-27 대표) — 지금 누가 있나가 이 화면의 물음이다. 대장 값은 그 아래 */}
              <div className="fl2-sec">업체</div>
              {cur.ledger.length ? (
                <div className="fl2-t">
                  {cur.ledger.map((t) => <TenantLine key={t.name} t={t} areaTxt={areaTxt} />)}
                </div>
              ) : <div className="fl2-none">—</div>}
              <div className="fl2-g fl2-fi fl2-spec">
                {kv("용도", <span className="ro">{cur.uses.length ? cur.uses.join(" · ") : "—"}</span>)}
                {kv("바닥면적", <span className="ro">{areaTxt(cur.floor_area) ?? "—"}</span>)}
                {rooms.length > 0 && kv("전유부", (
                  <button className={`fx ${roomsOpen ? "on" : ""}`} onClick={() => setRoomsOpen(!roomsOpen)}>
                    {rooms.length}개<i>›</i></button>
                ))}
                {rooms.length > 0 && roomsOpen && (
                  <div className="fl2-ex">
                    {rooms.map((r, i) => (
                      <div key={i}><span>전용 {areaTxt(r.excl_area)}</span>
                        {r.common_area != null && <span>공용 {areaTxt(r.common_area)}</span>}</div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
