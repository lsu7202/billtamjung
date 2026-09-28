import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { buildingsApi, marketApi, rentsApi } from "../../shared/api/endpoints";
import { RoadviewMini } from "../../shared/map/Roadview";
import type { MapPin } from "../../shared/map/MapPanel";
import { TradeCompare } from "../building/TradeCompare";
import { Icon } from "../../shared/ui/Icon";
import { transitOf, lineColor } from "../building/LocationPanel";
import { AdCards } from "./AdCards";

/** 탐색 사이드 판의 상세(S05 · 2026-09-28 대표 승인) — 목록에서 고르면 같은 판이 이것으로 바뀐다.
 *
 *  판 하나를 스크롤하고, 머리 아래 고정 탭(매물 · 시세 · 건물 · 임대 · 입지)이 그 구획으로 데려간다.
 *  큰 흐름은 부동산플래닛(가격 먼저 · 비어도 매물 칸이 선다), 칸은 우리가 가진 값으로.
 *  탭 이름은 건물 상세(새 탭)와 맞췄다 — 「상세보기」로 넘어가도 같은 자리를 찾는다. */

const PY = 3.305785;
const eok = (v: number | null | undefined) =>
  v == null ? "—" : v >= 1e8 ? `${(v / 1e8).toFixed(v >= 1e10 ? 0 : 1).replace(/\.0$/, "")}억` : `${Math.round(v / 1e4).toLocaleString()}만`;
const pyl = (m2: number | null | undefined) => (m2 == null ? "—" : `${(m2 / PY).toFixed(m2 / PY < 100 ? 1 : 0)}평`);
const ym = (s: string | null | undefined) => (s && /^\d{6}$/.test(s) ? `${s.slice(2, 4)}.${s.slice(4)}` : "");

const TABS = [["ad", "매물"], ["price", "시세"], ["bldg", "건물"], ["rent", "임대"], ["loc", "교통"]] as const;
type TabKey = typeof TABS[number][0];

export function SideDetail({ picked, broker, onBack, onDetail, onHide }: {
  picked: MapPin; broker: boolean;
  onBack: () => void; onDetail: () => void; onHide: () => void;
}) {
  const nav = useNavigate();
  const pk = picked.building_pk;
  const vacant = pk.startsWith("P");
  const bq = useQuery({
    queryKey: ["pickBldg", pk],
    queryFn: async () => {
      if (!vacant) return buildingsApi.get(pk);
      const v = await buildingsApi.vacant(pk.slice(1));
      return { ...v, land_area: v.area } as Record<string, unknown>;
    },
  });
  const crawl = useQuery({ queryKey: ["bCrawl", pk], queryFn: () => buildingsApi.crawl(pk), enabled: broker && !vacant });
  const near = useQuery({ queryKey: ["nearbySales", pk], queryFn: () => marketApi.nearbySales(pk), enabled: !vacant });
  const floors = useQuery({ queryKey: ["floor-info", pk], queryFn: () => rentsApi.info(pk), enabled: !vacant });

  const b = bq.data ?? {};
  const adsQ = useQuery({ queryKey: ["bAds", pk], queryFn: () => buildingsApi.ads(pk), enabled: !vacant });
  const adPrices = (adsQ.data ?? []).filter((a) => a.state === "노출" && a.price != null).map((a) => a.price as number);
  const salePrice = adPrices.length ? Math.min(...adPrices)
    : b.sale_price != null && b.sale_price !== "" ? Number(b.sale_price) : null;
  const n = (k: string) => (b[k] != null && b[k] !== "" ? Number(b[k]) : null);
  const land = n("land_area") ?? picked.land_area ?? null;
  const total = n("total_area") ?? picked.total_area ?? null;
  const fa = n("floors_above"), fb = n("floors_below");
  const est = n("sale_est") ?? picked.sale_est ?? null;
  const last = n("last_sale_price") ?? picked.last_sale_price ?? null;
  const lastYm = (b.last_sale_ym as string) ?? picked.last_sale_ym ?? null;
  const approval = (b.approval_ymd as string) ?? null;
  const age = approval && /^\d{4}/.test(approval) ? new Date().getFullYear() - Number(approval.slice(0, 4)) : null;
  const landPy = land ? land / PY : null;
  const totalPy = total ? total / PY : null;
  const mine = picked.kind === "mine" || picked.col === "mine";

  // 고정 탭 — 누르면 그 구획으로 스크롤. 스크롤하면 지금 구획에 불이 들어온다
  const bodyRef = useRef<HTMLDivElement>(null);
  const [cur, setCur] = useState<TabKey>("ad");
  const go = (k: TabKey) => {
    const el = bodyRef.current?.querySelector(`[data-sec="${k}"]`) as HTMLElement | null;
    if (el && bodyRef.current) bodyRef.current.scrollTo({ top: el.offsetTop - 44, behavior: "smooth" });
    setCur(k);
  };
  const onScroll = () => {
    const box = bodyRef.current; if (!box) return;
    let now: TabKey = "ad";
    for (const [k] of TABS) {
      const el = box.querySelector(`[data-sec="${k}"]`) as HTMLElement | null;
      if (el && el.offsetTop - 60 <= box.scrollTop) now = k;
    }
    if (now !== cur) setCur(now);
  };

  const cell = (label: string, value: React.ReactNode) => (
    <div className="sd-c"><i>{label}</i><b>{value}</b></div>
  );

  const flist = floors.data?.floors ?? [];
  return (
    <div className="sd">
      <div className="sd-head">
        <button className="mo-back" onClick={onBack}>‹ 목록</button>
        <div className="sd-addr">{picked.addr.replace("서울특별시 ", "").replace("번지", "")}
          {mine && <span className="ml-tag mine">내</span>}</div>
        <div className="sd-road">{(b.road_addr as string) ?? ""}</div>
        <div className="sd-tabs">
          {TABS.map(([k, l]) => (
            <button key={k} className={cur === k ? "on" : ""} onClick={() => go(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="sd-body" ref={bodyRef} onScroll={onScroll}>
        {/* 로드뷰 — 광고 사진이 있으면 빼서 높이를 아낀다(광고 사진이 곧 이 건물 사진이다) */}
        {picked.lng && picked.lat && !(adsQ.data ?? []).some((a) => (a.photo_ids ?? []).length > 0)
          ? <RoadviewMini lng={picked.lng} lat={picked.lat} className="sel-road" /> : null}

        {/* 매물 — 광고 · (중개사) 내 매물 · 시장 호가. 비어도 칸은 선다 */}
        <section data-sec="ad">
          <h4>매물</h4>
          <AdCards pk={pk} empty={<div className="sd-none">등록된 매물이 없습니다</div>} />
          {broker && !vacant && (
            <button className="sd-link" onClick={() => nav(`/sales?listing=${encodeURIComponent(pk)}`)}>
              {mine ? "매물관리에서 보기" : "매물관리에 담기"} ›</button>
          )}
          {broker && (crawl.data ?? []).length > 0 && (
            <div className="sel-crawl">
              <div className="sc-h">시장 호가 <b className="num">{crawl.data!.length}</b></div>
              {crawl.data!.slice(0, 6).map((c) => (
                <div key={c.id} className="sc-row num">
                  <span className="d">{c.deal}</span>
                  <span className="f">{c.floor ? `${c.floor}층` : "—"}</span>
                  <span className="a">{pyl(c.contract_area)}</span>
                  <span className="v">{c.deal === "매매" ? eok(c.price) : `${eok(c.deposit)} / ${eok(c.rent)}`}</span>
                </div>
              ))}
              {crawl.data!.length > 6 && <div className="sc-more">외 {crawl.data!.length - 6}건</div>}
            </div>
          )}
        </section>

        {/* 시세 — 최근 실거래와 빌탐정 추정가를 나란히, 그 아래 주변과 견주기 */}
        <section data-sec="price">
          <h4>시세</h4>
          {/* 매매가 · 최근 실거래 · 추정가 — 매매가는 광고(노출 · 공개)의 값, 광고가 없으면 내 매물의 팀 매매가 */}
          <div className="sd-price three">
            <div className="sale"><i>매매가</i><b className="num">{salePrice != null ? eok(salePrice) : "—"}</b></div>
            <div><i>최근 실거래{ym(lastYm) ? ` · ${ym(lastYm)}` : ""}</i><b className="num">{last != null ? eok(last) : "거래 없음"}</b></div>
            <div className="est"><i>빌탐정 추정가</i><b className="num">{est != null ? eok(est) : "—"}</b></div>
          </div>
          {!vacant && (
            <TradeCompare title="주변 실거래" note="연면적 평당 · 대지 평당 · 총액"
              near={{ price: near.data?.median_price ?? null, per: near.data?.median_per_area ?? null,
                      perLand: near.data?.median_price && landPy ? Math.round(near.data.median_price / landPy) : null }}
              mine={{ price: last, per: last && totalPy ? Math.round(last / totalPy) : null,
                      perLand: last && landPy ? Math.round(last / landPy) : null }}
              est={{ price: est, per: est && totalPy ? Math.round(est / totalPy) : null,
                     perLand: est && landPy ? Math.round(est / landPy) : null }} />
          )}
        </section>

        {/* 건물 — 대장 값. 건폐 · 용적은 대장이 본값 */}
        <section data-sec="bldg">
          <h4>건물</h4>
          <div className="sd-grid">
            {cell("대지", pyl(land))}
            {cell("연면적", pyl(total))}
            {cell("규모", fa != null ? `${fb ? `B${fb} / ` : ""}${fa}F` : "—")}
            {cell("주용도", (b.main_use_name as string) || "—")}
            {cell("사용승인", approval ? `${approval.slice(0, 4)}${age != null ? ` · ${age}년` : ""}` : "—")}
            {cell("용도지역", (b.use_zone as string) || "—")}
            {cell("건폐율", n("bcr") != null ? `${n("bcr")!.toFixed(1)}%` : "—")}
            {cell("용적률", n("far") != null ? `${n("far")!.toFixed(1)}%` : "—")}
            {cell("공시지가", n("gongsi_latest") != null ? `${Math.round(n("gongsi_latest")! * PY / 1e4).toLocaleString()}만/평` : "—")}
            {cell("승강기", n("elevator") != null ? `${n("elevator")}대` : "—")}
          </div>
        </section>

        {/* 임대 — 층마다 지금 있는 업체(요약). 전체는 상세의 층별 정보 */}
        <section data-sec="rent">
          <h4>임대</h4>
          {flist.length === 0 ? <div className="sd-none">층별 정보가 없습니다</div> : (
            <div className="sd-floors">
              {flist.slice(0, 8).map((g) => (
                <div key={g.floor} className="sd-fl">
                  <b>{g.floor}</b>
                  <span>{g.ledger.length ? `${g.ledger[0].name}${g.ledger.length > 1 ? ` 외 ${g.ledger.length - 1}` : ""}`
                    : <i className="off">{g.uses.length ? g.uses.join(" · ") : "—"}</i>}</span>
                </div>
              ))}
              {flist.length > 8 && <div className="sc-more">외 {flist.length - 8}개 층</div>}
            </div>
          )}
        </section>

        {/* 교통 — 역(호선별 가장 가까운 역)과 버스 정류장. 유동인구 같은 해석 값은 안 싣는다(대표 09-28) */}
        <section data-sec="loc">
          <h4>교통</h4>
          {(() => {
            const t = transitOf(b);
            if (!t.subway.length && !t.bus.length) return <div className="sd-none">가까운 역 · 정류장 정보가 없습니다</div>;
            return (
              <div className="sd-tr">
                {t.subway.map(([line, st]) => (
                  <div key={line} className="sd-trr">
                    <i className="lb" style={{ background: lineColor(line) }}>{line}</i>
                    <b>{st.name}</b><span className="num">{st.dist.toLocaleString()}m</span>
                  </div>
                ))}
                {t.bus.map((s2) => (
                  <div key={s2.name} className="sd-trr">
                    <i className="lb bus">버스</i><b>{s2.name}</b><span className="num">{s2.dist.toLocaleString()}m</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </section>

        <div className="sel-acts">
          <button className="sel-detail" onClick={onDetail}>상세보기 →</button>
          <button className="sel-hide" title="이 조건에서 접어두기" onClick={onHide}>
            <Icon name="hide" size={14} />접어두기</button>
        </div>
      </div>
    </div>
  );
}
