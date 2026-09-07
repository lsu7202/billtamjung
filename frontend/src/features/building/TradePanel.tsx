import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { marketApi, type SeriesPt } from "../../shared/api/endpoints";
import { wonShort } from "../../shared/format";
import { MarketArea, CompPoint, CompFilter, COMP_FILTER_DEFAULT, circleToGeoJSON, fmtArea, fmtDist, openDetail } from "../../shared/map/geo";
import { parseAmount, seedAmount } from "./KV";
import { Toc } from "./Toc";
import { TradeCompare } from "./TradeCompare";
import "./bldgtab.css";

/** 실거래 탭 — 주변 거래가 판이고 이 건물 거래는 그 안의 점이다(2026-08-26).
 *
 *  뒤집은 이유는 데이터다: 서울 건물의 85.7%는 이 건물 실거래가 아예 없고,
 *  있는 건물도 열에 일곱은 단 1건이다. 「실거래가」 카드를 먼저 세우고 선을 그리면
 *  대개 「데이터가 없습니다」만 뜬다.
 *
 *  이 탭이 답해야 하는 것은 「이 건물이 주변보다 비싼가 싼가」다.
 *  그래서 y축은 **연면적 평당가** — 61평과 300평의 총액을 나란히 두면 아무 뜻이 없다.
 */

const P = 3.305785;

/** 거래 한 건 — 이 건물과 주변을 같은 자로 담는다.
 *  산점도(SalesScatter)를 걷으면서 그쪽에 있던 타입을 여기로 옮겼다(2026-08-27).
 *  점 서른일곱 개는 보고 나서 해석을 해야 해서 곁말이 자꾸 붙었고, 그래서 카드 둘로 갈았다. */
interface SalePt {
  /** 거래 시점 "YYYY/MM" */ x: string;
  /** 연면적 평당가(원) */ y: number;
  addr: string;
  price: number;
  outlier?: boolean;
  /** 이 건물 거래 */ mine?: boolean;
  pk?: string;
}
interface SaleComp {
  building_pk: string; contract_ym: string; price: number; total_area: number | null;
  addr: string; lng: number; lat: number; dist_m: number; per_area?: number; is_outlier: boolean;
}
const NO_SALES: SaleComp[] = [];
const shortAddr = (a: string) => a.replace("서울특별시 ", "").replace("번지", "");
// 실거래가는 억 단위로 맞춘다 — 「55억 389만」처럼 만 단위 잔액이 붙으면
// 옆 줄의 「85억」과 자릿수가 어긋나 세로로 견줄 수가 없다(2026-08-26)
const eokMan = (v?: number | null) => (v ? wonShort(v) : "—");
const manPy = (v?: number | null) => (v ? `${Math.round(v / 1e4).toLocaleString()}만` : "—");

/** 억 단위 클릭-편집 — 인라인에 늘 떠 있던 입력칸 둘을 대신한다 */
function EokCell({ v, ph, onSave }: { v: number | null; ph: string; onSave: (won: number | null) => void }) {
  const [on, setOn] = useState(false);
  const [t, setT] = useState("");
  if (on) return (
    <input className="um-in" autoFocus value={t} placeholder={ph}
      style={{ width: 84, padding: "5px 10px", fontSize: 13, textAlign: "right" }}
      onChange={(e) => setT(e.target.value)}
      onBlur={() => { setOn(false); onSave(t.trim() ? parseAmount(t) : null); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setOn(false); }} />
  );
  return (
    <button className="um-vp" onClick={(e) => { e.stopPropagation(); setT(seedAmount(v)); setOn(true); }}>
      <b className={v == null ? "off" : ""} style={{ fontSize: 14 }}>{v == null ? ph : `${seedAmount(v)}억`}</b>
    </button>
  );
}

export function TradePanel({ pk, lng, lat, area, comp, onComp, onComps, mine, totalArea, landArea, saleEst }: {
  pk: string; lng: number; lat: number; area: MarketArea;
  comp: CompFilter; onComp: (c: CompFilter) => void; onComps?: (pts: CompPoint[]) => void;
  /** 이 건물 실거래(마스터 + 팀 오버레이) — 총액이라 평당으로 환산해 얹는다 */
  mine: SeriesPt[]; totalArea?: number | null;
  /** 대지면적(㎡) — 대지 평당을 같이 보여 주려고 받는다(2026-09-05) */
  landArea?: number | null;
  /** 빌탐정 추정가(배치) — 비교 막대의 셋째 줄 */
  saleEst?: number | null;
}) {
  const [all, setAll] = useState(false);
  const [condOpen, setCondOpen] = useState(false);
  const q = useQuery<{ sales: SaleComp[] }>({
    queryKey: ["nearby-sales", lng, lat, pk, area, comp],
    queryFn: () => marketApi.nearby({
      center_lat: lat, center_lng: lng, building_pk: pk, radius_m: 0,
      polygon: area.kind === "circle" ? circleToGeoJSON(area.center ?? { lng, lat }, area.radius_m) : area.geojson,
      floors: [],
      sale_years: comp.years, sale_price_min: comp.price_min, sale_price_max: comp.price_max,
    }) as unknown as Promise<{ sales: SaleComp[] }>,
  });
  const sales = q.data?.sales ?? NO_SALES;

  // 지도에 찍을 점 — 이전 MarketBlock 이 하던 일을 그대로 이어받는다
  const points = useMemo<CompPoint[]>(
    () => sales.filter((s) => s.lng != null).map((s) => ({ building_pk: s.building_pk, lng: s.lng, lat: s.lat, kind: "sale" as const })),
    [sales]);
  useEffect(() => { onComps?.(points); }, [points, onComps]);

  const py = totalArea ? totalArea / P : null;
  const landPy = landArea ? landArea / P : null;
  // 이 건물 거래 — 총액을 연면적 평당으로 환산해야 주변과 같은 자로 잰다
  const mineP: SalePt[] = py
    ? mine.map((m) => ({ x: m.x.includes("/") ? m.x : `${m.x}/06`, y: m.y / py, addr: "이 건물", price: m.y, mine: true, pk }))
    : [];
  const nearP: SalePt[] = sales.filter((s) => s.per_area).map((s) => ({
    x: `${s.contract_ym.slice(0, 4)}/${s.contract_ym.slice(4)}`, y: s.per_area!,
    addr: shortAddr(s.addr), price: s.price, outlier: s.is_outlier, pk: s.building_pk,
  }));
  // 주변 중앙 평당가 — 이상치는 뺀다
  const ok = nearP.filter((p) => !p.outlier).map((p) => p.y).sort((a, b) => a - b);
  const med = ok.length ? ok[Math.floor(ok.length / 2)] : null;
  const lo = ok.length ? ok[0] : null;
  const hi = ok.length ? ok[ok.length - 1] : null;
  // 주변 총액 중앙 — 평당과 같은 표본(이상치 제외). 건물 크기가 제각각이라 뜻은 약하지만
  // 「얼마짜리가 오가는 동네인가」는 총액으로 감이 온다.
  const okPrice = nearP.filter((p) => !p.outlier).map((p) => p.price).sort((a, b) => a - b);
  const medPrice = okPrice.length ? okPrice[Math.floor(okPrice.length / 2)] : null;
  const lastMine = mineP.length ? mineP[mineP.length - 1] : null;
  // 여러 번 팔린 건물 — 처음과 마지막 사이 상승률. 한 건뿐이면 견줄 게 없어 안 적는다.
  const first = mineP.length > 1 ? mineP[0] : null;
  const rise = first && lastMine ? ((lastMine.y - first.y) / first.y) * 100 : null;
  // 손익 금액 — 처음 산 값과 마지막 판 값의 총액 차이. 백분율 옆에 나란히 선다.
  const gain = first && lastMine ? lastMine.price - first.price : null;
  const riseYears = first && lastMine
    ? Number(lastMine.x.slice(0, 4)) - Number(first.x.slice(0, 4)) : 0;

  // 목록 — 주변만, **가까운 순**(반경이 이미 조건이라 최근 순은 그 조건과 겹친다).
  // 이상치는 뺀다: 중앙값 계산에서 이미 제외한 값을 목록에만 남기면 「왜 저건 안 셌지」가 된다.
  // 이 건물 거래는 위 카드가 쥔다 — 여기 섞으면 「주변」이라는 이름과 어긋난다
  const rows = [
    ...[...sales].filter((s) => !s.is_outlier)
      .sort((a, b) => a.dist_m - b.dist_m).map((s) => ({
      key: `${s.building_pk}-${s.contract_ym}-${s.price}`, mine: false, addr: shortAddr(s.addr),
      cap: [`${s.dist_m}m`, `${s.contract_ym.slice(0, 4)}.${s.contract_ym.slice(4)}`,
            s.total_area ? `${Math.round(s.total_area / P).toLocaleString()}평` : null]
            .filter(Boolean).join(" · "),
      price: s.price, per: s.per_area ?? null, pk: s.building_pk })),
  ];
  // 층별 임대와 같은 어법 — 처음엔 셋. 중앙값이 어디서 나왔는지 감이 오는 만큼만.
  const shown = all ? rows : rows.slice(0, 3);

  const areaBadge = area.kind === "circle" ? `반경 ${fmtDist(area.radius_m)}` : `상권 ${fmtArea(area.area_m2)}`;

  return (
    <div className="rv rv-wrap">
      {/* 다른 탭과 같은 목차 — 항목만 갈아 끼운다(Toc).
          이름은 카드 제목 그대로다: 목차에서 줄여 부르면 눌러 간 자리의 제목과 어긋난다. */}
      <Toc items={[
        { id: "tr-sum", label: "한눈에" },
        { id: "tr-mine", label: "이 건물 거래" },
        { id: "tr-near", label: "주변 거래" },
      ]} />
      <div className="rv-body">
    {/* ── 카드 1 · 한눈에 ───────────────────────────────────────
        비교를 맨 위 카드로 뺐다(2026-08-28). 예전엔 주변 카드 **안에** 있어서
        이 건물 거래가 없으면(서울의 85.7%) 막대가 통째로 사라져 화면이 두 얼굴이 됐다. */}
    <div id="tr-sum">
      <TradeCompare
        near={{ price: medPrice, per: med,
                perLand: medPrice && landPy ? medPrice / landPy : null }}
        mine={{ price: lastMine?.price ?? null, per: lastMine?.y ?? null,
                perLand: lastMine?.price && landPy ? lastMine.price / landPy : null }}
        est={{ price: saleEst ?? null, per: saleEst && py ? saleEst / py : null,
               perLand: saleEst && landPy ? saleEst / landPy : null }} />
    </div>
    {/* ── 카드 1 · 이 건물 실거래 ─────────────────────────────────
        여러 해에 걸친 시계열이라 주변(한 덩어리 값)과 성격이 다르다. 나눠 두면
        **카드마다 주인공이 하나로 고정**돼서, 거래가 있고 없고에 따라 화면이 두 얼굴이 되지 않는다.
        거래가 없어도 카드는 남는다 — 「이 건물은 거래된 적이 없다」도 중개인이 알아야 할 사실이라,
        요약 칸 구석의 「—」로 두면 자료를 못 불러온 것처럼 보인다(2026-08-26). */}
    <div className="bg-card" id="tr-mine">
      <div className="bg-ttl">이 건물 거래
        {py != null && (
          <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginLeft: "auto" }}>
            연 {py.toFixed(1)}평 · 연면적 평당</span>)}
      </div>
      <div className="pane" style={{ paddingTop: 0 }}>
        {mineP.length === 0 && (
          <div className="orow" style={{ cursor: "default" }}>
            <span className="ev off" style={{ fontSize: 15 }}>기록 없음</span>
          </div>
        )}
        {mineP.map((m, i) => (
          <div className="orow" key={m.x} style={{ cursor: "default" }}>
            <span className="who g">{m.x.replace("/", ".")}</span>
            <span className="cap" />
            <span className="fm">
              <span style={i === mineP.length - 1 ? { color: "var(--signal)" } : undefined}>{eokMan(m.price)}</span>
              <span className="u">{manPy(m.y)}</span></span>
            <span className="okpad" />
          </div>
        ))}
        {/* 여러 번 팔린 건물에선 그 사이 얼마나 올랐는지가 이 건물만의 사실이다 —
            주변 목록으로는 절대 안 보인다 */}
        {rise != null && (
          <div className="orow" style={{ cursor: "default", borderTop: "1px solid var(--line)" }}>
            <span className="who g">{riseYears}년 사이</span>
            {/* 손익 금액 — 백분율만 적으면 「그래서 얼마 벌었나」를 다시 계산해야 한다.
                두 거래의 총액 차이라 평당이 아니라 억으로 적는다(2026-08-28). */}
            <span className="cap" />
            <span className="fm">
              <span style={{ color: rise >= 0 ? "var(--up)" : "var(--down)" }}>
                {gain != null ? `${gain >= 0 ? "+" : "−"}${eokMan(Math.abs(gain))}` : "—"}</span>
              <span className="u" style={{ color: rise >= 0 ? "var(--up)" : "var(--down)" }}>
                {rise >= 0 ? "+" : "−"}{Math.abs(rise).toFixed(0)}%</span>
            </span>
            <span className="okpad" />
          </div>
        )}
      </div>
    </div>

    {/* ── 카드 2 · 주변 실거래 ────────────────────────────────────
        사례 조건이 **이 카드 안에만** 있으니, 위 카드까지 거른다는 오해가 생기지 않는다.
        산점도는 걷었다(2026-08-26): 점 서른일곱 개는 보고 나서 해석을 해야 해서 곁말이 자꾸 붙었다. */}
    <div className="bg-card" id="tr-near">
      <div className="bg-ttl">주변 거래
        <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginLeft: "auto" }}>
          {areaBadge} · {sales.length}건 · 연면적 평당</span>
      </div>
      <div className="fl-head" style={{ marginTop: 4 }}>
        <span style={{ width: 150 }}>가까운 순</span><span style={{ flex: 1 }} />
        <span className="fmh"><span>실거래가</span><span>연면적 평당</span></span>
        <span className="okpad" />
      </div>
      <div className="pane" style={{ paddingTop: 0 }}>
        {shown.map((r) => (
          <div key={r.key} className="orow tr-row"
            onClick={() => openDetail(r.pk)}>
            <span className="who">{r.addr}</span>
            <span className="cap">{r.cap}</span>
            <span className="fm"><span>{eokMan(r.price)}</span><span className="u">{manPy(r.per)}</span></span>
            <span className="okpad" />
          </div>
        ))}
        {rows.length === 0 && (
          <div className="orow" style={{ cursor: "default" }}>
            <span className="cap" style={{ textAlign: "center" }}>조건에 맞는 거래가 없습니다</span>
          </div>
        )}
      </div>
      {rows.length > 3 && (
        <button className="bg-more" onClick={() => setAll((v) => !v)}>
          {all ? "접기" : `${rows.length}건 모두 보기`}
        </button>
      )}
      <div className={`eitem ${condOpen ? "open" : ""}`} style={{ marginTop: 4 }}>
            <div className="orow has" style={{ minHeight: 40, padding: "0 10px" }} onClick={() => setCondOpen((v) => !v)}>
              {/* 요약 칸이 좁다 — nowrap 이 없으면 「사례 조건」이 한 글자씩 세로로 쪼개진다 */}
              <span className="who g"
                style={{ fontSize: 12.5, minWidth: 0, whiteSpace: "nowrap", flex: "0 0 auto" }}>사례 조건</span>
              {/* 중앙·최저·최고는 여기 붙는다 — 이 조건으로 걸러 나온 값이라 조건 옆이 제자리다.
                  예전엔 카드 머리에 따로 서 있어서 조건을 바꿔도 그 값이 왜 움직이는지 안 보였다. */}
              <span className="cap" style={{ fontSize: 11.5 }}>
                {lo != null && hi != null ? `최저 ${manPy(lo)} · 최고 ${manPy(hi)}` : ""}</span>
              <span className="ev" style={{ fontSize: 12.5 }}>
                최근 {comp.years}년
                <span style={{ margin: "0 6px", color: "#D0D6DC" }}>·</span>
                {/* 0은 「안 정함」과 같다 — 0억 하한은 뜻이 없다 */}
                {!comp.price_min && !comp.price_max
                  ? <span style={{ color: "#B0B8C1", fontWeight: 600 }}>가격 제한 없음</span>
                  : `${comp.price_min ? `${seedAmount(comp.price_min)}억` : ""} ~ ${comp.price_max ? `${seedAmount(comp.price_max)}억` : ""}`}
              </span>
              <span className="okpad" />
            </div>
            {condOpen && (
              <div className="eexp" style={{ paddingLeft: 10 }} onClick={(e) => e.stopPropagation()}>
                <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span className="bk">기간</span>
                    <span className="chips-in">
                      {[1, 2, 3, 5, 10].map((y) => (
                        <button key={y} className={comp.years === y ? "on" : ""}
                          onClick={() => onComp({ ...comp, years: y })}>{y}년</button>
                      ))}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <span className="bk">가격대</span>
                    <EokCell v={comp.price_min} ph="하한" onSave={(w) => onComp({ ...comp, price_min: w })} />
                    <span style={{ color: "#D0D6DC" }}>~</span>
                    <EokCell v={comp.price_max} ph="상한" onSave={(w) => onComp({ ...comp, price_max: w })} />
                    {(comp.years !== COMP_FILTER_DEFAULT.years || comp.price_min || comp.price_max) ? (
                      <button className="mini" title="조건 초기화" style={{ marginLeft: 4 }}
                        onClick={() => onComp(COMP_FILTER_DEFAULT)}>↺</button>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
    </div>
      </div>
    </div>
  );
}
