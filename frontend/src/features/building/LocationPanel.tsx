import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { buildingsApi, type BuildingPop } from "../../shared/api/endpoints";
import { ReportMap, ZONE_COLOR } from "./ReportMap";
import { num } from "./reportModel";
import { Toc } from "./Toc";
import { Segmented } from "../../shared/ui/Segmented";
import "./report.css";

/** 입지 탭 — 이 자리가 어떤 곳인지(2026-08-26).
 *
 *  유동인구·상권·교통은 서로 다른 축이 아니라 같은 물음의 다른 면이다:
 *  얼마나 붐비나 / 무슨 동네인가 / 어디서 오나. 한 탭에 모아 둔다.
 */
export function LocationPanel({ pk, b, fetchPop }: {
  pk: string; b: Record<string, unknown>;
  /** 조회 함수를 밖에서 준다 — 나대지는 building_pk 가 아니라 pnu 로 찾는다(2026-08-27).
   *  응답 모양이 같으므로 그림은 이 컴포넌트 하나가 그대로 그린다. */
  fetchPop?: (id: string) => Promise<BuildingPop>;
}) {
  return (
    <div className="rv">
      <div className="rv-wrap">
        <Toc items={[{ id: "lc-pop", label: "유동인구" }, { id: "lc-tr", label: "교통" }]} />
        <div className="rv-body">
          <FloatPop pk={pk} lng={num(b.lng)} lat={num(b.lat)} geom={b.parcel_geom}
            fetchPop={fetchPop} id="lc-pop" />
          <Transit b={b} id="lc-tr" />
        </div>
      </div>
    </div>
  );
}

/** 유동인구 — 서울 생활인구(250m 격자) 실측. 등급 띠를 걷고 값과 그림만 남겼다(2026-08-26).
 *
 *  예전엔 (도로접면 + 역거리) ÷ 2 를 다섯 칸으로 잘라 「높음」이라 불렀다. 이름만 유동인구고
 *  실제는 접근성이었고, 그 둘은 이미 각각 별도 축이라 같은 정보를 두 번 세고 있었다.
 *
 *  그림 둘: 하루 곡선(모양이 곧 자리 성격 — 낮에 솟았다 꺼지면 업무지, 평평하면 주거지)과
 *  주변 격자 지도(색=지배 용도, 진하기=주간 인구). 등급으로는 안 보이던 것들이다.
 */
function FloatPop({ pk, lng, lat, geom, fetchPop, id }: {
  pk: string; lng: number | null; lat: number | null; geom?: unknown; id?: string;
  fetchPop?: (id: string) => Promise<BuildingPop>;
}) {
  const q = useQuery({ queryKey: ["pop", pk], queryFn: () => (fetchPop ?? buildingsApi.pop)(pk) });
  // 지도가 무엇을 칠할까 — 유동인구 농도 / 상권 지배용도(2026-08-28).
  // ★ 훅은 조건부 return 앞에 둔다 — 뒤에 두면 자료가 없을 때 훅 수가 달라져 화면이 깨진다.
  const [layer, setLayer] = useState<"pop" | "cat">("pop");
  const d = q.data;
  if (!d || d.day == null) return null;
  const hourly = d.hourly ?? [];
  const hi = hourly.length ? Math.max(...hourly) : 0;
  // 진하기는 **이 지도 안 격자들끼리만** 정한다. 서울 전체로 잡으면 강남 아닌 데는 다 하얗다.
  const pops = d.cells.map((c) => c.pop ?? 0);
  const pMax = pops.length ? Math.max(...pops) : 0;
  // 제곱근으로 편다 — 인구는 한쪽으로 크게 쏠린다(여기선 19~11,525명). 그대로 비례시키면
  // 가장 붐비는 한 칸만 진하고 나머지가 다 옅은 한 덩어리로 뭉쳐 서로 구별이 안 된다.
  // 값 자체는 카드 아래 곁말(최소~최대)에 그대로 적는다.
  const zones = d.cells.map((c) => ({
    geojson: c.geojson, count: c.n ?? 0, cat: c.cat ?? "",
    pop: pMax > 0 ? Math.sqrt((c.pop ?? 0) / pMax) : 0,
  }));
  const cats = new Set(d.cells.map((c) => c.cat).filter(Boolean) as string[]);
  // 많은 쪽부터 — 순서가 곧 「무슨 동네냐」의 답이다
  const mixRows = Object.entries(d.mix ?? {}).sort((a, b) => b[1] - a[1]);
  const mixTotal = mixRows.reduce((t, [, n]) => t + n, 0);
  const man = (v: number) => Math.round(v).toLocaleString();
  return (
    <section className="rv-card" id={id}>
      <span className="rv-k">유동인구 <em className="rv-est">서울 생활인구 · 250m 격자</em></span>
      {/* 값·곡선은 왼쪽, 지도는 오른쪽. 위아래로 세우면 지도가 판을 통째로 먹어
          정작 주인공인 숫자가 화면 밖으로 밀린다(2026-08-26). */}
      <div className="rv-pop2">
        <div>
          <div className="rv-pop">
            <div className="rv-pop-v">
              <b className="num">{man(d.day)}</b><span>낮 11~21시</span>
            </div>
            <div className="rv-pop-v off">
              <b className="num">{man(d.night ?? 0)}</b><span>밤 22~6시</span>
            </div>
            {d.peak_hour != null && (
              <div className="rv-pop-v off">
                <b className="num">{d.peak_hour}시</b><span>가장 붐빌 때</span>
              </div>
            )}
          </div>
          {/* 하루 곡선 — 진한 칸이 낮(11~21시)이라 어디를 평균 냈는지 그림이 같이 말한다 */}
          {hi > 0 && (
            <>
              <div className="rv-hrs" role="img" aria-label="시간대별 유동인구">
                {hourly.map((v, h) => (
                  <i key={h} className={h >= 11 && h <= 21 ? "on" : ""}
                    style={{ height: `${Math.max(3, (v / hi) * 100)}%` }}
                    title={`${h}시 ${man(v)}명`} />
                ))}
              </div>
              <div className="rv-hax"><span>0시</span><span>6시</span><span>12시</span><span>18시</span><span>24시</span></div>
            </>
          )}
          <p className="rv-note">
            반경 600m · 칸 하나 250m · 최근 {d.days ?? 7}일 평균
            {pMax > 0 && ` · 이 안에서 ${man(Math.min(...pops))}~${man(pMax)}명`}
          </p>

          {/* 상권 구성 — 지도의 테두리 색이 「무슨 동네냐」라면 이 막대가 그 비율이다.
              한 줄에 이어 붙인다: 넷을 따로 세우면 서로 견주는 대신 각각을 읽게 된다. */}
          {mixTotal > 0 && (
            <div className="rv-mix">
              <span className="rv-k">상권 구성</span>
              <div className="rv-mixbar">
                {mixRows.map(([k, n]) => (
                  <i key={k} style={{ width: `${(n / mixTotal) * 100}%`, background: ZONE_COLOR[k] ?? "#8891a0" }}
                    title={`${k} ${n.toLocaleString()}곳`} />
                ))}
              </div>
              <div className="rv-mixl">
                {mixRows.map(([k, n]) => (
                  <span key={k}>
                    <i style={{ background: ZONE_COLOR[k] ?? "#8891a0" }} />{k}
                    <b className="num">{Math.round((n / mixTotal) * 100)}%</b>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

        {zones.length > 0 && lng != null && (
          <div>
            <div className="rv-map">
              <ReportMap lng={lng} lat={lat} geom={geom} zones={zones as never}
                fit={false} h="360px" layer={layer} />
              {/* 두 정보를 한 지도에 겹치니 상권이 2.5px 테두리로 밀려 옆 칸과 구별이 안 됐다.
                  둘 중 하나를 고르게 한다 — 두 갈래 전환은 슬라이딩 토글(규칙, 2026-08-28). */}
              <div className="rv-maptog">
                <Segmented size="sm" value={layer} onChange={(v) => setLayer(v as "pop" | "cat")}
                  options={[{ value: "pop", label: "유동인구" }, { value: "cat", label: "상권" }]} />
              </div>
            </div>
            <div className="rv-zl">
              {layer === "pop" ? (
                <>
                  <span className="rv-ramp">유동인구 <i /></span>
                  {[...cats].map((k) => (
                    <span key={k}><b style={{ borderColor: ZONE_COLOR[k] ?? "#8891a0" }} />{k}</span>
                  ))}
                </>
              ) : (
                /* 상권 구성에 있는 것을 다 세운다. 격자에 안 나타난 것(어느 칸에서도 1등이
                   아닌 용도)은 옅게 두되 이름은 남긴다 — 먹자 16%인데 지도가 입을 다물면
                   그 16%가 어디로 갔는지 알 수 없다(2026-08-28 삼성동 78). */
                mixRows.filter(([, n]) => n > 0).map(([k]) => (
                  <span key={k} className={cats.has(k) ? "" : "off"}>
                    <b style={{ background: ZONE_COLOR[k] ?? "#8891a0", borderColor: "transparent" }} />{k}
                    {!cats.has(k) && <em>흩어짐</em>}
                  </span>
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}


/** 노선 색 — 실무에서 「9호선」은 곧 그 색이다. 앱의 파랑 하나 규칙에 얹는 예외가 아니라,
 *  노선 이름 자체가 색으로 통용되는 정보라서 쓴다(지도 타일도 같은 색으로 그린다).
 *  마스터 subway_json 에 실제로 들어 있는 27종을 다 받는다 — 「9호선(연장)」처럼
 *  꼬리가 붙은 이름은 앞에서부터 맞춰 본다. */
const LINE_COLOR: [string, string][] = [
  ["1호선", "#0052A4"], ["2호선", "#00A84D"], ["3호선", "#EF7C1C"], ["4호선", "#00A5DE"],
  ["5호선", "#996CAC"], ["6호선", "#CD7C2F"], ["7호선", "#747F00"], ["8호선", "#E6186C"],
  ["9호선", "#BDB092"], ["신분당선", "#D31145"], ["신림선", "#6789CA"], ["우이신설선", "#B7C452"],
  ["경의중앙선", "#77C4A3"], ["중앙선", "#77C4A3"], ["경춘선", "#0C8E72"], ["분당선", "#FABE00"],
  ["공항철도", "#0090D2"], ["김포골드라인", "#AD8605"], ["서해선", "#8FC31F"], ["일산선", "#00A5DE"],
  ["과천선", "#00A5DE"], ["경부선", "#0052A4"], ["경인선", "#0052A4"], ["경원선", "#0052A4"],
  ["수도권 광역급행철도", "#9A6292"],
];
const lineColor = (v: string) =>
  LINE_COLOR.find(([k]) => v.startsWith(k))?.[1] ?? "#8B95A1";

/** 교통 — 호선마다 가장 가까운 역 하나, 그리고 버스 정류소 둘. 두 줄이면 끝난다.
 *
 *  호선당 하나만 남기는 이유: 같은 호선의 둘째 역은 첫째보다 늘 멀어서, 걸어갈 곳을
 *  고를 때 쓸 일이 없다. 그렇게 줄이면 **몇 개 호선이 걸리는가**가 알약 개수로 바로 보인다 —
 *  실무에서 「9·7·2호선 물린다」가 이 자리를 설명하는 말이다.
 *
 *  버스는 뺐다가 되살렸다(2026-08-26). 「정류소는 어디에나 있다」고 봤는데, 상업용 건물에서
 *  버스 접근은 유동인구와 곧바로 이어진다 — 지하철이 먼 자리일수록 더 그렇다.
 *  정류장 이름이 길어(「봉은사역.코엑스인터컨티넨탈」) 지하철과 같은 줄에 못 섞고 아래 줄로 뺀다.
 */
function Transit({ b, id }: { b: Record<string, unknown>; id?: string }) {
  const parse = (v: unknown) => {
    try {
      const a = typeof v === "string" ? JSON.parse(v || "[]") : (v ?? []);
      return Array.isArray(a) ? a as Record<string, unknown>[] : [];
    } catch { return []; }        // 깨진 JSON 이면 아무것도 안 그린다
  };
  const subs = parse(b.subway_json);
  // 정류장 이름이 같은 곳이 방향별로 둘씩 실린다(「봉은사.코엑스북문」 190m·313m) — 이름으로 접는다
  const bus: { name: string; dist: number }[] = [];
  parse(b.bus_json).forEach((x) => {
    const name = String(x.정류장명 ?? "");
    if (!name || bus.some((v) => v.name === name) || bus.length >= 2) return;
    bus.push({ name, dist: Number(x.거리) || 0 });
  });
  if (!subs.length && !bus.length) return null;

  // 호선별 최단. subway_json 은 이미 거리순이라 처음 만난 것이 그 호선의 최단이다.
  const seen = new Map<string, { name: string; dist: number }>();
  subs.forEach((x) => {
    const line = String(x.호선 ?? "");
    if (!line || seen.has(line)) return;
    seen.set(line, { name: String(x.역명 ?? ""), dist: Number(x.거리) || 0 });
  });
  const rows = [...seen.entries()].sort((a, c) => a[1].dist - c[1].dist);

  return (
    <section className="rv-card" id={id}>
      <span className="rv-k">교통</span>
      {rows.length > 0 && (
        <div className="rv-one">
          {rows.map(([line, st], i) => (
            <span className={`u${i === 0 ? " near" : ""}`} key={line}>
              <i className="lb" style={{ background: lineColor(line) }}>{line}</i>
              <b>{st.name}</b><span className="num">{st.dist.toLocaleString()}m</span>
            </span>
          ))}
        </div>
      )}
      {bus.length > 0 && (
        // 역과 같은 문법 — 항목마다 알약이 붙는다. 앞에 하나만 두면 둘이 서로 다른 줄로 읽힌다.
        // 노선 이름이 없으니 알약은 「버스」 하나뿐이지만, 모양이 같아야 나란히 읽힌다(2026-08-26).
        <div className="rv-one bus">
          {bus.map((s) => (
            <span className="u" key={s.name}>
              <i className="lb">버스</i>
              <b>{s.name}</b><span className="num">{s.dist.toLocaleString()}m</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

