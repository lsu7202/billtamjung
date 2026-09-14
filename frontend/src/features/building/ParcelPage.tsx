import { useState, type CSSProperties } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { buildingsApi } from "../../shared/api/endpoints";
import { Toc } from "./Toc";
import { Sidebar } from "./Sidebar";
import { LandScene } from "./LandScene";
import { LocationPanel } from "./LocationPanel";
import { GongsiCard, RegCard } from "./ParcelBlock";
import { PhotoPanel } from "../../shared/map/PhotoPanel";
import "./bldgtab.css";
import "./report.css";

/** 나대지 상세 — 건물이 없는 「대」 필지(2026-08-27).
 *
 *  건물 상세는 건물을 전제로 짜여 있다: 연면적·층수·용도·임대·실거래.
 *  나대지엔 그중 절반이 없어서, 같은 화면에 태우면 빈칸 목록이 되고
 *  「자료를 못 불러왔다」로 읽힌다. 그래서 화면을 따로 둔다.
 *
 *  여기서 답하는 물음은 하나다 — **여기 뭘 얼마나 지을 수 있나.**
 *  건물 상세가 「지어진 것」을 보여준다면 이 화면은 「지을 수 있는 것」을 보여준다.
 *  그 값은 추정이 아니라 계산이다(대지 × 법정 비율).
 *
 *  탭은 둘이다 — 토지·입지. 임대는 층이 없어서 없고, 실거래는 토지 거래라 따로다.
 *  땅의 성질(유동인구·교통)은 건물이 있든 없든 같으므로 건물 상세와 **같은 컴포넌트**가 그린다.
 */

const P = 3.305785;
const py = (m2?: number | null) => (m2 != null ? `${(m2 / P).toFixed(1)}평` : "—");
const eok = (won?: number | null) =>
  won == null ? "—"
    : won >= 1e8 ? `${Math.round(won / 1e8).toLocaleString()}억`
      : `${Math.round(won / 1e4).toLocaleString()}만`;

type Scope = "land" | "loc";
const SCOPES: [Scope, string][] = [["land", "토지"], ["loc", "입지"]];

export function ParcelPage() {
  const { pnu = "" } = useParams();
  const nav = useNavigate();
  const [scope, setScope] = useState<Scope>("land");
  const q = useQuery({ queryKey: ["vacant", pnu], queryFn: () => buildingsApi.vacant(pnu) });
  const d = q.data;

  if (q.isLoading) return <div className="bt-page"><div className="panel" style={{ padding: 30 }}>불러오는 중…</div></div>;
  if (!d) return (
    <div className="bt-page"><div className="panel" style={{ padding: 30 }}>
      그런 필지가 없습니다
      <button className="btn" style={{ marginLeft: 12 }} onClick={() => nav("/search")}>검색으로</button>
    </div></div>
  );

  const n = (v: unknown) => (v != null && v !== "" ? Number(v) : null);
  const st = (v: unknown) => (v != null && v !== "" ? String(v) : null);
  // 법정 건폐/용적은 숫자 목록으로 온다(0153): [55] 하나이거나 [50,60] 병기.
  // String() 을 그대로 쓰면 "50,60" 이 되어 % 도 없고 사이도 붙는다.
  const legalText = (v: unknown) =>
    (Array.isArray(v) && v.length ? v.map((x) => `${x}%`).join(", ") : null);
  const area = n(d.area);
  const b = (d.buildable ?? {}) as { total_area: number | null; build_area: number | null; floors: number | null };
  // 규제 — 건물 상세와 **같은 칩**(RegCard). 규제는 땅에 걸리는 것이라 건물 유무와 무관하다.
  const scopeIdx = SCOPES.findIndex(([s]) => s === scope);


  return (
    <div className="bt-page">
      {/* 머리줄 — 건물 상세와 같은 한 행: 주소 · 나대지 배지 · 알약 */}
      <div className="panel bt-hd" style={{ padding: "9px 18px", display: "flex",
        alignItems: "center", gap: 12, flexWrap: "nowrap", overflow: "hidden" }}>
          <h1 style={{ fontSize: 17, fontWeight: 800, letterSpacing: "-.03em", margin: 0,
            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 100, flex: "0 1 auto" }}>
            {String(d.addr ?? "").replace("서울특별시 ", "")}</h1>
          {/* 건물이 없다는 것은 결함이 아니라 이 필지의 성격이다 — 배지로 먼저 말한다 */}
          <span className="tag" style={{ background: "#E8F3EC", color: "#12855C", flex: "0 0 auto" }}>나대지</span>
          {/* 연파랑 = 우리가 만든 값. 여기선 「지을 수 있는 것」 — 추정이 아니라 계산이라
              「추정」 배지는 없다. 적정가·수익률은 안 세운다: 모델 입력(연면적·연식·용도)이 없다. */}
          <div className="hd-pills">
            <span className="pill hero"><i>지을 수 있는 연면적</i><b>{py(b.total_area)}</b></span>
            <span className="pill hero"><i>한 층 · 최대</i><b>{py(b.build_area)} · {b.floors ?? "—"}층</b></span>
            <span className="pill"><i>대지면적</i><b>{py(area)}</b></span>
            <span className="pill"><i>법정 건폐 · 용적</i><b>{legalText(d.legal_bcr) ?? "—"} · {legalText(d.legal_far) ?? "—"}</b></span>
            {/* 국가가 매긴 값이라 추정이 아니다. 「이 땅 얼마요」에 가장 먼저 답이 되는 값. */}
            <span className="pill"><i>공시지가 총액</i><b>{eok(n(d.gongsi_total))}</b></span>
          </div>
      </div>

      <div className="bt-cols">
        <div style={{ display: "grid", gap: 14 }}>
          {/* 탭 둘 — 임대·실거래는 없다. 층이 없으면 층별 임대가 없고,
              이 필지의 거래는 토지 거래라 건물 실거래와 다른 표에 산다. */}
          <div className="bt-tabs" style={{ "--tab-n": SCOPES.length, "--tab-i": scopeIdx } as CSSProperties}>
            {SCOPES.map(([s, label]) => (
              <button key={s} className={scope === s ? "on" : ""} onClick={() => setScope(s)}>{label}</button>
            ))}
            <span className="bt-tabs-ink" aria-hidden />
          </div>

          {scope === "land" && (
            <div className="rv rv-wrap">
              <Toc items={[
                { id: "pc-build", label: "지을 수 있는 것" },
                { id: "pc-land", label: "토지정보" },
                { id: "pc-reg", label: "규제 · 특례" },
                { id: "pc-gongsi", label: "공시지가" },
                { id: "pc-scene", label: "입체 지적도" },
              ]} />
              <div className="rv-body">
                <div className="bg-card" id="pc-build">
                  <div className="bg-ttl">지을 수 있는 것
                    <span style={{ fontSize: 11.5, fontWeight: 700, color: "var(--muted)", marginLeft: "auto" }}>
                      대지 × 법정 비율 · 계산값</span>
                  </div>
                  <div className="bg-cols">
                    {([["연면적", py(b.total_area)], ["건축면적", py(b.build_area)],
                       ["최대 층수", b.floors != null ? `${b.floors}층` : null],
                       ["한 층 넓이", py(b.build_area)]] as const).map(([k, v]) => (
                      <div className="orow" key={k} style={{ cursor: "default" }}>
                        <span className="who g">{k}</span><span className="cap" />
                        <span className={`ev ${v ? "" : "off"}`}>{v || "—"}</span>
                        <span className="okpad" />
                      </div>
                    ))}
                  </div>
                  {/* 사선제한·주차·조경은 우리가 모르는 값이라, 이 층수는 상한이지 약속이 아니다 */}
                  <p style={{ fontSize: 12, color: "var(--muted)", margin: "0 20px 16px", lineHeight: 1.6 }}>
                    층수는 용적률 ÷ 건폐율로 낸 상한입니다. 사선제한·주차·조경에 따라 낮아질 수 있습니다.</p>
                </div>

                <div className="bg-card" id="pc-land">
                  <div className="bg-ttl">토지정보</div>
                  <div className="bg-cols">
                    {([["토지면적", py(area)], ["지목", st(d.jimok)], ["용도지역", st(d.use_zone)],
                       ["토지이용상황", st(d.land_use)], ["지형/형상", st(d.shape)], ["지세", st(d.slope)],
                       ["도로접면", st(d.road_frontage)],
                       ["법정 건폐 · 용적", `${legalText(d.legal_bcr) ?? "—"} · ${legalText(d.legal_far) ?? "—"}`]] as const)
                      .map(([k, v]) => (
                        <div className="orow" key={k} style={{ cursor: "default" }}>
                          <span className="who g">{k}</span><span className="cap" />
                          <span className={`ev ${v ? "" : "off"}`}>{v || "—"}</span>
                          <span className="okpad" />
                        </div>
                      ))}
                  </div>
                </div>

                <div className="bg-card" id="pc-reg">
                  <div className="bg-ttl">규제 · 특례</div>
                  {/* 국토부 원본(0136)을 그대로 세운다 — 정본과 100% 일치하므로 손대지 않는다.
                      「포함」이 먼저, 「저촉」(경계에 걸침)이 뒤. 여덟 개까지 펴고 나머지는 접는다. */}
                  <RegCard regAll={(d.reg_all ?? []) as [string, string, string][]} />
                </div>

                <div id="pc-gongsi">
                  <GongsiCard series={(d.gongsi_series ?? []) as [number, number][]}
                    totalGongsi={n(d.gongsi_total)} landArea={area} />
                </div>

                {/* 입체 지적도 — 건물 상세와 같은 컴포넌트. 세울 건물이 없으니 대지와 도로만 선다.
                    그 자체가 이 필지의 사실이다: 「여긴 비어 있다」를 그림이 말한다. */}
                {/* 필드 이름을 건물 것으로 맞춰 넘긴다 — 필지는 area 가 곧 대지면적이고,
                    연면적·건폐율·용적률은 아직 없는 값이라 비운다(0 으로 채우면 「다 찼다」로 그려진다) */}
                <LandScene pk={pnu} id="pc-scene" fetchScene={buildingsApi.vacantScene}
                  b={{ ...d, land_area: area, total_area: null, bcr: null, far: null }} />
              </div>
            </div>
          )}

          {/* 입지는 땅의 성질이라 건물 유무와 무관하다 — 건물 상세와 같은 컴포넌트가 그린다 */}
          {scope === "loc" && <LocationPanel pk={pnu} b={d} fetchPop={buildingsApi.vacantPop} />}
        </div>

        <div className="bt-side">
          {/* 지도는 건물 상세와 같은 컴포넌트. pk 를 안 넘긴다 — 업로드 사진은 건물의 것이고
              필지엔 아직 사진 슬롯이 없다. 상권 정의(onArea)도 안 넘긴다: 주변 comp 를
              쓰는 곳(실거래·임대)이 이 화면엔 없어서 지금은 쓸 데가 없다. */}
          {n(d.lng) != null && n(d.lat) != null
            ? <PhotoPanel lng={n(d.lng)!} lat={n(d.lat)!} />
            : (
              <div className="panel" style={{ padding: 16, fontSize: 13, color: "var(--muted)" }}>
                위치 정보가 없습니다
              </div>
            )}
          {/* 땅도 팔고 사는 것이라 거래가 건물과 똑같이 돈다(2026-08-27).
              listings.building_pk 는 FK 없는 텍스트라 나대지는 'P'+pnu 를 그 자리에 쓴다 —
              담기·소유자·매수자·메모가 전부 같은 API 로 돈다. */}
          <Sidebar pk={`P${pnu}`} />
        </div>
      </div>
    </div>
  );
}
