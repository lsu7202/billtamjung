import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, useParams, useSearchParams } from "react-router-dom";
import { buildingsApi, marketApi, parcelsApi } from "../../shared/api/endpoints";
import { RoadviewMini, type RoadView } from "../../shared/map/Roadview";
import { PhotoPanel } from "../../shared/map/PhotoPanel";
import { Icon } from "../../shared/ui/Icon";
import { useUnit } from "../../shared/hooks/useUnit";
import { won } from "../../shared/format";
import { Transit } from "./LocationPanel";
import { AreaEvents } from "./AreaEvents";
import { FloorBiz } from "./FloorBiz";
import { TrendChart } from "./TrendChart";
import "../search/search.css";
import "./sheet.css";

/** 지번 페이지 = 땅과 그 위 동들의 사양서(S07, 대표 10-01 · 10-08 지번 열쇠). 사실만 · 고치는 곳 없음.
 *  열쇠는 지번(pnu) 하나 — 지도에서 누르는 것은 필지다. 동이 여럿이면 건물 카드 · 층별만 고른 동(?dong=)을 읽는다.
 *  나대지도 같은 화면이다 — 동 카드 대신 「지을 수 있는 규모」가 선다.
 *  화면 폭을 다 쓴다: 위 = 거리뷰 크게 + 지도 작은 창, 아래 = 칸이 붙은 격자(넓으면 3단, 좁으면 2단 · 1단).
 *  모달(탐색에서 상세보기)과 새 탭 페이지(/parcels/:pnu)가 이 하나를 같이 쓴다 */

const PY = 3.305785;
type Sale = { pnu: string; building_pk: string; contract_ym: string; price: number; total_area: number | null; land_area: number | null;
  addr: string; dist_m: number; main_use_name: string | null };
type Parcel = { role: string; pnu: string; label: string; area: number | null; jimok: string | null; land_use: string | null;
  slope: string | null; shape: string | null; road_frontage: string | null; use_zone: string | null;
  legal_bcr: number[] | null; legal_far: number[] | null; reg_all?: [string, string, string][]; geom?: unknown };
/** 이 지번의 거래(통매 · 호실 · 토지, 0246). use = 원천 건축물주용도, 없으면 실거래 유형 */
type Deal = { ym: string; price: number; total_area: number | null; land_area: number | null;
  use: string | null; trade_type: string | null; floor: string | null };

const ymL = (v: string | null | undefined) => (v && /^\d{6}$/.test(v) ? `${v.slice(2, 4)}.${v.slice(4)}` : "");
const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

/** 카드 하나 — 묶음 제목 + 내용. wide 면 두 칸 폭 */
function Card({ title, wide, children, extra, k }: { title: string; wide?: boolean; children: React.ReactNode; extra?: React.ReactNode; k?: string }) {
  return (
    <section className={`shc ${wide ? "wide" : ""} ${k ? `c-${k}` : ""}`}>
      <div className="shc-h"><h3>{title}</h3>{extra}</div>
      <div className="shc-b dc">{children}</div>
    </section>
  );
}

export function BuildingSheet({ pnu, dong, onOpen }: { pnu: string; /** 고른 동(건물 번호) — 없으면 1동(대표) */ dong?: string | null;
  /** 유사거래 줄을 누르면 그 지번 사양서로 */ onOpen?: (pnu: string) => void }) {
  const pk = pnu;   // 화면 상태를 지번마다 새로 세우는 열쇠
  const { unit, area } = useUnit();
  const bq = useQuery({ queryKey: ["parcel", pnu], queryFn: () => parcelsApi.get(pnu) });
  const parcelsQ = useQuery({ queryKey: ["lands-raw", pnu], queryFn: () => parcelsApi.lands(pnu, true) });

  const dealsQ = useQuery({ queryKey: ["trades", pnu], queryFn: () => parcelsApi.trades<Deal>(pnu) });

  const b = (bq.data ?? {}) as Record<string, unknown>;
  const n = (k: string) => (b[k] != null && b[k] !== "" ? Number(b[k]) : null);
  const s = (k: string) => (b[k] != null && b[k] !== "" ? String(b[k]) : null);
  const lng = n("lng"), lat = n("lat");
  const per = unit === "py" ? PY : 1, perName = unit === "py" ? "평" : "㎡";
  const pyl = (m2: number | null | undefined) => (m2 == null ? null : area(m2, unit === "py" && m2 / PY >= 100 ? 0 : 1));
  // 줄은 늘 세운다 — 값이 없으면 빈칸(10-01 대표, 숨기면 빠진 칸으로 읽힌다. 「—」도 안 쓴다)
  const row = (label: string, value: React.ReactNode) =>
    <div key={label} className="dc-row"><span>{label}</span><b>{value == null || value === "" ? "" : value}</b></div>;

  // 미디어 — 거리뷰 크게 · 지도 작게. ⇄ 로 바꾼다
  const [mapBig, setMapBig] = useState(false);
  // 거리뷰가 보는 자리 · 방향 — 작은 지도에 시야 부채꼴로(10-02 연동)
  const [pov, setPov] = useState<RoadView | null>(null);
  useEffect(() => { setPov(null); }, [pk]);
  useEffect(() => setMapBig(false), [pk]);
  useEffect(() => { const t = setTimeout(() => window.dispatchEvent(new Event("resize")), 60); return () => clearTimeout(t); }, [mapBig]);

  const [simOpen, setSimOpen] = useState(false);
  const [gsOpen, setGsOpen] = useState(false);     // 공시지가 연도별 표 — 눌러야 펼친다   // 주변 유사거래 — 눌러야 펼친다
  useEffect(() => { setSimOpen(false); setGsOpen(false); }, [pk]);

  // 필지 — 여럿이면 칩으로 고른다(기본 대표 필지)
  const parcels = ((parcelsQ.data as { parcels?: Parcel[] } | undefined)?.parcels ?? []);
  const road = (parcelsQ.data as { road?: { front_m?: number | null; side_m?: number | null; rear_m?: number | null } } | undefined)?.road;
  const [pIdx, setPIdx] = useState(0);
  useEffect(() => setPIdx(0), [pk]);
  const p = parcels[pIdx] ?? parcels[0];
  const regAll = parcels.flatMap((x) => x.reg_all ?? []).filter((r, i, all) => all.findIndex((y) => y[0] === r[0] && y[1] === r[1]) === i);

  // 동(0230) — 지번 위 건물이 여럿이면 건물 카드 · 층별만 고른 동을 읽는다. 나머지는 지번 단위 그대로(스펙 §5-1)
  const dongs = (b.dongs as { building_pk: string; label: string; dong_name: string | null }[] | undefined) ?? [];
  // 들어온 동을 골라 둔다(?dong= · 옛 건물 주소). 없으면 1동(대표)
  const [dIdx, setDIdx] = useState(0);
  const at = Math.max(0, dongs.findIndex((x) => x.building_pk === dong));
  useEffect(() => setDIdx(at), [pnu, at]);
  const dk = dongs[dIdx]?.building_pk ?? null;
  const dq = useQuery({ queryKey: ["building-raw", dk], queryFn: () => buildingsApi.get(dk!, true), enabled: !!dk });
  const db = (dq.data ?? {}) as Record<string, unknown>;
  const dn = (k: string) => (db[k] != null && db[k] !== "" ? Number(db[k]) : null);
  const ds = (k: string) => (db[k] != null && db[k] !== "" ? String(db[k]) : null);
  const dref = (db._ref ?? {}) as Record<string, unknown>;
  const bcr = dn("bcr"), far = dn("far"), fa = dn("floors_above"), fb = dn("floors_below");
  const approval = ds("approval_ymd");
  const age = approval && /^\d{4}/.test(approval) ? new Date().getFullYear() - Number(approval.slice(0, 4)) : null;
  const lb = p?.legal_bcr ?? [], lf = p?.legal_far ?? [];
  const over = (cur: number | null, legal: number[]) => (cur != null && legal.length === 1 ? cur - legal[0] : null);
  const ob = over(bcr, lb), of = over(far, lf);   // 법정 대비 — 고른 동의 건폐 · 용적과 이 땅의 법정치
  const zoneMix = Array.isArray(db.use_zone_mix) ? (db.use_zone_mix as { 명?: string; name?: string; 비중?: number }[]) : null;
  const zoneText = zoneMix && zoneMix.length > 1
    ? zoneMix.map((z) => `${z.명 ?? z.name}${z.비중 != null ? ` ${Math.round(z.비중 * 100)}%` : ""}`).join(" · ")
    : p?.use_zone ?? s("use_zone");

  // 공시지가 — [연도, 원/㎡]. 5 · 10년 전 대비는 그 해 값이 있을 때만(가까운 해로 대신 세지 않는다)
  const gs = ((b.gongsi_series as [number, number][]) ?? []).filter(([, v]) => v > 0);
  const gUp = (k: number) => {
    if (gs.length < 2) return null;
    const [ly, lv] = gs[gs.length - 1];
    const a = gs.find(([y]) => y === ly - k)?.[1];
    return a ? (lv - a) / a * 100 : null;
  };
  const deals = dealsQ.data ?? [];

  return (
    <div className="sheet">
      {/* 미디어 — 거리뷰 크게 + 지도 작은 창(⇄ 로 바꿈). 거리뷰는 여기서만 크게 본다(사이드바에선 뺐다, 10-01) */}
      {lng != null && lat != null && (
        <div className="sh-media">
          <div className={mapBig ? "sh-pip" : "sh-main"}><RoadviewMini className="sh-rv" lng={lng} lat={lat} controls onView={setPov} /></div>
          <div className={mapBig ? "sh-main" : "sh-pip"}><PhotoPanel lng={lng} lat={lat} pnu={pnu} noStrip noRoad pov={pov} /></div>
          <button className="sh-swap" title={mapBig ? "거리뷰 크게" : "지도 크게"} onClick={() => setMapBig(!mapBig)}>
            <Icon name="reset" size={15} /></button>
        </div>
      )}

      {/* 사양 — 칸이 붙은 격자 */}
      <div className="sh-grid">
        <Card title="실거래" wide>
          {/* 이 건물 거래(10-01) — 표 하나, 칸마다 값 하나. 최근이 위. 주변 유사거래는 아래 「보기」를 눌러야 펼친다 */}
          <div className="sh-tbl g6">
            <div className="sh-tr head"><span>거래일</span><span>용도</span><span>실거래가</span><span>대지 {perName}당</span><span>연면적 {perName}당</span><span>직전 대비</span></div>
            {/* 거래가 없으면 「거래 내역 없음」을 적는다(10-01 — 목록이 빈 것은 말로 알린다. 값 하나가 빈 칸은 빈칸 그대로) */}
            {deals.length === 0 && !dealsQ.isLoading && <div className="sh-empty">거래 내역 없음</div>}
            {deals.map((d, i) => {
              // 직전 대비는 같은 실거래 유형끼리 — 호실 값과 통건물 값을 견주지 않는다
              const prev = deals.slice(i + 1).find((x) => x.trade_type === d.trade_type);
              const ch = prev ? (d.price - prev.price) / prev.price * 100 : null;
              const pp = (a: number | null) => (a ? won(Math.round(d.price / (a / per))) : "");
              return (
                <div key={`${d.ym}${i}`} className="sh-tr">
                  <span>{ymL(d.ym)}</span><span>{d.use ?? ""}{d.floor ? ` · ${d.floor}층` : ""}</span><span>{won(d.price)}</span><span>{pp(d.land_area)}</span><span>{pp(d.total_area)}</span>
                  <span className={ch == null ? "" : ch >= 0 ? "sh-up" : "sh-down"}>{ch != null ? pct(ch) : ""}</span>
                </div>
              );
            })}
          </div>
          <button className={`sh-more ${simOpen ? "on" : ""}`} onClick={() => setSimOpen(!simOpen)}>
            {simOpen ? "비교 접기" : "유사 거래와 비교하기"} <i>{simOpen ? "▴" : "›"}</i></button>
          {simOpen && <SimilarDeals pnu={pnu} b={b} d={db} onOpen={onOpen} />}
        </Card>

        {dongs.length > 0 ? (
        <Card title="건물" extra={dongs.length > 1 ? (
          <span className="shc-chips">{dongs.map((x, i) => (
            <button key={x.building_pk} className={i === dIdx ? "on" : ""} onClick={() => setDIdx(i)}>{x.dong_name || x.label}</button>
          ))}</span>) : undefined}>
          {/* 대지면적은 대장 값 — 비어 있으면 빈칸 그대로(10-08 대표). 땅 크기는 토지 카드의 토지면적 */}
          {row("대지면적", pyl(dn("land_area")))}
          {row("연면적", pyl(dn("total_area")))}
          {row("건축면적", pyl(dn("build_area")))}
          {row("용적산정 연면적", pyl(dn("far_area")))}
          {row("지상 / 지하", fa != null ? `${fa}층 / ${fb ?? 0}층` : null)}
          {row("높이", dn("height") != null ? `${dn("height")}m` : null)}
          {row("건폐율", bcr != null ? `${bcr.toFixed(2)}%` : null)}
          {row("용적률", far != null ? `${far.toFixed(2)}%` : null)}
          {row("사용승인일", approval ? `${approval.slice(0, 10).replace(/-/g, ".")}${age != null ? ` (${age}년)` : ""}` : null)}
          {row("대수선 및 리모델링", ds("remodel_ymd")?.slice(0, 10).replace(/-/g, "."))}
          {row("주용도", ds("main_use_name"))}
          {row("기타용도", ds("etc_use"))}
          {row("구조", ds("structure"))}
          {row("주차", dn("parking") != null ? `${dn("parking")}대` : null)}
          {row("승강기", dn("elevator") != null || dref.elevator_ext != null
            ? [dn("elevator") != null ? `${dn("elevator")}대` : null, dref.elevator_ext != null ? `승강기공단 ${dref.elevator_ext}대` : null].filter(Boolean).join(" · ") : null)}
        </Card>
        ) : (
        <Card title="지을 수 있는 규모">
          {/* 나대지 — 땅 × 법정 비율. 사선 · 주차 · 조경은 못 본다 */}
          {(() => { const bd = (b.buildable ?? {}) as { total_area?: number | null; build_area?: number | null; floors?: number | null };
            return <>{row("연면적", pyl(bd.total_area ?? null))}{row("건축면적", pyl(bd.build_area ?? null))}
              {row("한 층을 채울 때 층수", bd.floors != null ? `${bd.floors}층` : null)}</>; })()}
        </Card>
        )}

        <Card title="토지" extra={parcels.length > 1 ? (
          <span className="shc-chips">{parcels.map((x, i) => (
            <button key={x.pnu} className={i === pIdx ? "on" : ""} onClick={() => setPIdx(i)}>{x.label}</button>
          ))}</span>) : undefined}>
          {row("토지면적", pyl(p?.area ?? null))}
          {row("지목", p?.jimok)}
          {row("용도지역", zoneText)}
          {row("토지이용상황", p?.land_use)}
          {row("지형/형상", p?.shape)}
          {row("지세", p?.slope)}
          {row("도로접면", p?.road_frontage)}
          {row("실측 도로폭", road && (road.front_m || road.side_m || road.rear_m)
            ? ["전", "측", "후"].map((k, i) => { const v = [road.front_m, road.side_m, road.rear_m][i]; return v ? `${k} ${v}m` : null; }).filter(Boolean).join(" · ") : null)}
          {row("법정 건폐율", lb.length ? lb.map((v) => `${v}%`).join(" · ") : null)}
          {row("법정 용적률", lf.length ? lf.map((v) => `${v}%`).join(" · ") : null)}
          {row("법정 대비 건폐율", ob != null ? <span className={ob > 0 ? "sh-over" : ""}>{pct(ob)}</span> : null)}
          {row("법정 대비 용적률", of != null ? <span className={of > 0 ? "sh-over" : ""}>{pct(of)}</span> : null)}
        </Card>

        <Card title="토지이용계획">
          {/* 디스코식(10-01) — 법률 묶음(국토계획법 · 기타 법률) 안에 포함 · 저촉 · 접함 세 줄. 이름은 쉼표로 */}
          {([["국토의 계획 및 이용에 관한 법률", true], ["기타 법률", false]] as const).map(([t, uq]) => {
            const rs = regAll.filter(([, , c]) => String(c).startsWith("UQ") === uq);
            return (
              <div key={t}>
                <div className="sh-sub">{t}</div>
                {(["포함", "저촉", "접함"] as const).map((j) =>
                  row(j, rs.filter(([, jj]) => jj === j).map(([nm]) => nm).join(", ")))}
              </div>
            );
          })}
        </Card>

        <Card title="공시지가" extra={gs.length ? <span className="shc-sub">{gs[gs.length - 1][0]}년 기준</span> : undefined}>
          {/* 공시지가(10-01) — 단가 · 총액 · 5 · 10년 전 대비, 추이 그래프, 「연도별 보기」를 누르면 표(실거래와 같은 결) */}
          {row(`${perName}당`, n("gongsi_latest") != null ? won(Math.round(n("gongsi_latest")! * per)) : null)}
          {row("총액", n("gongsi_total") != null ? won(n("gongsi_total")!) : null)}
          {row("5년 전 대비", gUp(5) != null ? <span className={gUp(5)! >= 0 ? "sh-up" : "sh-down"}>{pct(gUp(5)!)}</span> : null)}
          {row("10년 전 대비", gUp(10) != null ? <span className={gUp(10)! >= 0 ? "sh-up" : "sh-down"}>{pct(gUp(10)!)}</span> : null)}
          {gs.length > 1 && (
            <TrendChart height={150} points={gs.map(([y, v]) => ({ x: String(y), y: v * per }))}
              fmt={(v) => won(Math.round(v))} />
          )}
          {gs.length === 0 && <div className="sh-empty">공시지가 내역 없음</div>}
          {gs.length > 0 && (
            <button className={`sh-more ${gsOpen ? "on" : ""}`} onClick={() => setGsOpen(!gsOpen)}>
              {gsOpen ? "연도별 접기" : "연도별 보기"} <i>{gsOpen ? "▴" : "›"}</i></button>
          )}
          {gsOpen && (
            <div className="sh-tbl g3">
              <div className="sh-tr head"><span>연도</span><span>{perName}당</span><span>전년 대비</span></div>
              {[...gs].reverse().map(([y, v], i, arr) => {
                const prev = arr[i + 1];
                const ch = prev ? (v - prev[1]) / prev[1] * 100 : null;
                return (
                  <div key={y} className="sh-tr"><span>{y}</span><span>{won(Math.round(v * per))}</span>
                    <span className={ch == null ? "" : ch >= 0 ? "sh-up" : "sh-down"}>{ch != null ? pct(ch) : ""}</span></div>
                );
              })}
            </div>
          )}
        </Card>

        {dk && (
        <Card title="층별 현황">
          <FloorBiz pk={dk} full />
        </Card>
        )}

        <LedgerExtras b={b} dongs={dongs} />

        <Card title="교통" k="transit">
          <Transit b={b} />
        </Card>

        <Card title="주변 소식" wide>
          <AreaEvents pk={pnu} />
        </Card>
      </div>
    </div>
  );
}

/** 주변 유사거래(디스코식, 10-01) — 비슷한 건물끼리만. 기준 태그를 누르면 끄고 켠다(보는 사람 화면에서만, 저장 안 함).
 *  맨 위 줄은 이 건물. 단가는 연면적 · 대지 중 고르고, 평 · ㎡ 는 앱 전체 단위를 따른다 */
function SimilarDeals({ pnu, b, d, onOpen }: { pnu: string; b: Record<string, unknown>; /** 고른 동 */ d: Record<string, unknown>;
  onOpen?: (pnu: string) => void }) {
  const pk = pnu;
  const { unit } = useUnit();
  const lng = Number(b.lng), lat = Number(b.lat);
  const use = d.main_use_name ? (String(d.main_use_name).includes("근린") ? "근린" : String(d.main_use_name)) : null;
  const zone = (b.use_zone as string) || null, jimok = (b.jimok as string) || null;
  const [on, setOn] = useState({ use: true, zone: true, jimok: true });
  const [sort, setSort] = useState<"ym" | "dist">("ym");
  const [radius, setRadius] = useState(500);   // 반경 100 · 300 · 500m
  const [years, setYears] = useState(5);       // 기간 1 · 3 · 5년
  const q = useQuery({
    queryKey: ["similar", pk, on, use, zone, jimok, radius, years],
    queryFn: () => marketApi.nearby({ center_lat: lat, center_lng: lng, radius_m: radius, pnu, sale_years: years,
      use_like: on.use ? use : null, use_zone: on.zone ? zone : null, jimok: on.jimok ? jimok : null }),
    enabled: Number.isFinite(lng) && Number.isFinite(lat),
  });
  const rows = ((q.data?.sales ?? []) as unknown as Sale[]).slice()
    .sort((a, c) => (sort === "ym" ? c.contract_ym.localeCompare(a.contract_ym) : a.dist_m - c.dist_m));
  const per = unit === "py" ? PY : 1, perName = unit === "py" ? "평" : "㎡";
  const unitPrice = (price: number | null, a: number | null) => {
    if (price == null || !a) return "";
    return won(Math.round(price / (a / per)));   // 위 실거래 표와 같은 글꼴(「2억 8,704만」)
  };
  const ym = (v: string) => (/^\d{6}$/.test(v) ? `${v.slice(2, 4)}.${v.slice(4)}` : v);
  const tag = (k: "use" | "zone" | "jimok", label: string | null) => label && (
    <button key={k} className={on[k] ? "on" : ""} onClick={() => setOn({ ...on, [k]: !on[k] })}>#{label}</button>
  );
  return (
    <div className="sim">
      <div className="sim-tags">
        {tag("use", use)}{tag("zone", zone)}{tag("jimok", jimok)}
      </div>
      <div className="sim-bar">
        <span className="sim-seg">
          {[100, 300, 500].map((r) => <button key={r} className={radius === r ? "on" : ""} onClick={() => setRadius(r)}>{r}m</button>)}
        </span>
        <span className="sim-seg">
          {[1, 3, 5].map((y) => <button key={y} className={years === y ? "on" : ""} onClick={() => setYears(y)}>{y}년</button>)}
        </span>
        <span className="sim-seg">
          <button className={sort === "ym" ? "on" : ""} onClick={() => setSort("ym")}>최근순</button>
          <button className={sort === "dist" ? "on" : ""} onClick={() => setSort("dist")}>가까운순</button>
        </span>
      </div>
      {/* 실거래 표와 같은 격자(10-01) — 거래일 · 실거래가 · 면적 · 단가 · 거리. 이 건물은 위 실거래 표에 있어 안 넣는다 */}
      <div className="sh-tbl">
        <div className="sh-tr head"><span>거래일</span><span>실거래가</span><span>대지 {perName}당</span><span>연면적 {perName}당</span><span>거리</span></div>
        {rows.map((r) => {
          return (
            <div key={r.pnu} className="sh-tr link" onClick={() => onOpen?.(r.pnu)} title={r.addr}>
              <span>{ym(r.contract_ym)}</span><span>{won(r.price)}</span><span>{unitPrice(r.price, r.land_area)}</span>
              <span>{unitPrice(r.price, r.total_area)}</span><span className="dist">{Math.round(r.dist_m).toLocaleString()}m</span>
            </div>
          );
        })}
      </div>
      {!q.isFetching && rows.length === 0 && <div className="sh-empty">비슷한 거래 없음</div>}
    </div>
  );
}

/** 머리 — 주소 · 도로명(아래 작게) · 매매가 · 빌탐정 추정가. 매매가는 이 땅의 1번 매물 값(없으면 미정)이 먼저,
 *  추정가가 그 다음이다(10-06 대표). 매물이 아닌 땅이면 매매가 칸이 없다. 추정가가 매매가 자리를 대신하지 않는다 */
function SheetHead({ pnu }: { pnu: string }) {
  const bq = useQuery({ queryKey: ["parcel", pnu], queryFn: () => parcelsApi.get(pnu) });
  const b = (bq.data ?? {}) as Record<string, unknown>;
  const addr = String(b.addr ?? "").replace("서울특별시 ", "").replace("번지", "");
  const first = ((b.listings as { price: number | null }[] | undefined) ?? [])[0];
  return (
    <span className="sh-head">
      <span className="sh-ad"><b>{addr}</b>{b.road_addr ? <small>{String(b.road_addr)}</small> : null}</span>
      {first && <span className="sh-hp"><em>매매가</em><strong className="num">{first.price != null ? won(first.price) : "미정"}</strong></span>}
      {b.sale_est != null && <span className="sh-hp est"><em>빌탐정 추정가</em><strong className="num">{won(Number(b.sale_est))}</strong></span>}
    </span>
  );
}

/** 대장 딸림(10-07 대표) — 지역지구구역 · 정화조(동마다) · 에너지(지번 · 최근 12개월 합). 값이 없으면 카드를 안 세운다 */
function LedgerExtras({ b, dongs }: { b: Record<string, unknown>; dongs: { building_pk: string; label: string; dong_name: string | null }[] }) {
  const zones = (b.zones as { building_pk: string; use_zone: string | null; use_district: string | null; use_area: string | null }[] | undefined) ?? [];
  const septic = (b.septic as { building_pk: string; form_name: string | null; cap_person: number | null; cap_m3: number | null }[] | undefined) ?? [];
  const energy = (b.energy as { kind: string; ym: string; kwh: number | null }[] | undefined) ?? [];
  if (!zones.length && !septic.length && !energy.length) return null;
  const name = (pk: string) => { const d = dongs.find((x) => x.building_pk === pk); return dongs.length > 1 && d ? `${d.dong_name || d.label} ` : ""; };
  const yms = [...new Set(energy.map((e) => e.ym))].sort().slice(-12);
  const sum = (k: string) => energy.filter((e) => e.kind === k && yms.includes(e.ym)).reduce((a, e) => a + (e.kwh ?? 0), 0);
  const row = (label: string, value: React.ReactNode) =>
    <div key={label} className="dc-row"><span>{label}</span><b>{value == null || value === "" ? "" : value}</b></div>;
  return (
    <Card title="대장 딸림">
      {zones.map((z) => row(`${name(z.building_pk)}지역지구구역`, [z.use_zone, z.use_district, z.use_area].filter(Boolean).join(" · ")))}
      {septic.map((x, i) => row(`${name(x.building_pk)}정화조${septic.length > 1 ? ` ${i + 1}` : ""}`,
        [x.form_name, x.cap_person != null ? `${x.cap_person}인` : null, x.cap_m3 != null ? `${x.cap_m3}㎥` : null].filter(Boolean).join(" · ")))}
      {yms.length > 0 && row(`전기 (${yms[0].slice(2, 4)}.${yms[0].slice(4)}~${yms[yms.length - 1].slice(2, 4)}.${yms[yms.length - 1].slice(4)})`,
        `${Math.round(sum("elec")).toLocaleString()}kWh`)}
      {yms.length > 0 && energy.some((e) => e.kind === "gas") && row("가스", `${Math.round(sum("gas")).toLocaleString()}kWh`)}
    </Card>
  );
}

/** 모달 틀 — 사이드바를 「늘린」 판. 사이드바 오른쪽(지도 자리)을 덮는다. 머리 = 왼쪽 주소 · 오른쪽 ↗ 새 탭 · X. Esc 로 닫힌다 */
/** 평 · ㎡ 전환 버튼(10-02) — 지금 단위를 적고, 누르면 바뀐다. 앱 전체 단위(useUnit)라 사이드바 · 지도도 같이 */
export function UnitToggle() {
  const { unit, setUnit } = useUnit();
  return <button className="sheet-ic sheet-unit" title="면적 단위 바꾸기" onClick={() => setUnit(unit === "py" ? "m2" : "py")}>
    <Icon name="swap" size={14} />{unit === "py" ? "평" : "㎡"}</button>;
}

export function BuildingSheetModal({ pnu, dong, onClose, onOpen, left }: { pnu: string; dong?: string | null; onClose: () => void; onOpen: (pnu: string) => void;
  /** 왼쪽 끝(px) — 탐색에서는 사이드바 오른쪽부터 덮어 사이드바(광고)가 그대로 보이게(10-01) */
  left?: number }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="sheet-modal" style={left != null ? { left } : undefined}>
      <div className="sheet-top">
        <SheetHead pnu={pnu} />
        <span className="sp" />
        <UnitToggle />
        <button className="sheet-ic" title="새 탭으로 열기" onClick={() => window.open(`/parcels/${pnu}${dong ? `?dong=${encodeURIComponent(dong)}` : ""}`, "_blank")}>
          <Icon name="external" size={18} /></button>
        <button className="sheet-ic" title="닫기" onClick={onClose}><Icon name="close" size={20} /></button>
      </div>
      <div className="sheet-scroll"><BuildingSheet pnu={pnu} dong={dong} onOpen={onOpen} /></div>
    </div>
  );
}

/** 새 탭 페이지(/parcels/:pnu?dong=) — 같은 사양서, 화면 폭 전체 */
export function BuildingSheetPage({ pnu, dong }: { pnu: string; dong?: string | null }) {
  return <div className="sheet-page"><div className="sheet-top"><SheetHead pnu={pnu} /><span className="sp" /><UnitToggle /></div>
    <BuildingSheet pnu={pnu} dong={dong} onOpen={(p) => { window.location.href = `/parcels/${p}`; }} /></div>;
}

/** 라우트(/parcels/:pnu) */
export function ParcelSheetRoute() {
  const { pnu = "" } = useParams();
  const [sp] = useSearchParams();
  return <BuildingSheetPage pnu={pnu} dong={sp.get("dong")} />;
}

/** 옛 건물 주소(/buildings/:pk) — 그 동의 지번 페이지로 넘기기만 한다(저장된 공유 링크 · 모델 자료 링크가 있어서) */
export function BuildingRedirect() {
  const { pk = "" } = useParams();
  const q = useQuery({ queryKey: ["building-raw", pk], queryFn: () => buildingsApi.get(pk, true) });
  const pnu = q.data?.pnu as string | undefined;
  if (pnu) return <Navigate to={`/parcels/${pnu}?dong=${encodeURIComponent(pk)}`} replace />;
  if (q.isError) return <div className="sheet-page"><div className="sh-empty">건물을 찾을 수 없습니다</div></div>;
  return null;
}
