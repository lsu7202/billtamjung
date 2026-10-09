import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { buildingsApi, parcelsApi, customerApi, interestApi, seeksApi, type AdCard, type MarketData, type MarketRentRow, type SeekRow } from "../../shared/api/endpoints";
import { type RoadView, RoadviewMini } from "../../shared/map/Roadview";
import type { MapPin } from "../../shared/map/MapPanel";
import { Icon } from "../../shared/ui/Icon";
import { InquiryModal } from "./AdCards";
import { ListingCard } from "./ListingCard";
import { useIsGuest } from "../../shared/store/auth";
import { AuthImg } from "../../shared/ui/AuthImg";
import { formatPhone } from "../building/KV";
import { floorName, won, wonShort } from "../../shared/format";
import { FloorBiz } from "../building/FloorBiz";
import { transitOf, lineColor } from "../building/LocationPanel";
import { useUnit } from "../../shared/hooks/useUnit";
import { SeekLine } from "./SeekModal";

/** 탐색 사이드 판의 상세 — 디스코 결(대표 09-28 「그냥 디스코의 디자인을 카피」).
 *
 *  탭 없이 위에서 아래로 한 번에 스크롤한다.
 *  윗줄(← · 공유 · 저장 · ⋮) → 사진(거리뷰 첫 장 · 전체화면) → 제목 · 설명 → 회색 띠 위 가격 카드 →
 *  중개사 · 문의 → 광고 기본정보 → 상세보기(건물 스펙은 옆에 펼친다) → 중개 등록정보 → 아래 고정 줄.
 *  모르는 값은 「-」를 찍지 않고 그 줄을 세우지 않는다. 주변 실거래 견주기 막대는 뺐다(대표 09-28). */

const PY = 3.305785;
const eok = (v: number | null | undefined) =>
  v == null ? "—" : v >= 1e8 ? `${(v / 1e8).toFixed(v >= 1e10 ? 0 : 1).replace(/\.0$/, "")}억` : `${Math.round(v / 1e4).toLocaleString()}만`;
const ym = (s: string | null | undefined) => (s && /^\d{6}$/.test(s) ? `${s.slice(2, 4)}.${s.slice(4)}` : "");

/** 그 지번의 보이는 매물 한 줄(GET /parcels/{pnu} listings · 순번대로) */
export type ParcelListing = { listing_id: number; owner: "mine" | "office" | "crawl"; office: string | null; price: number | null; rank: number };

export function SideDetail({ picked, broker, onBack, onDetail, onHide, onFull, rvBack, onMedia, seekMode, onSeek, onPropose, sheetOpen = false, explore, onListing }: {
  /** picked.listing_id = 고른 매물(매물 번호로 판이 움직인다 · 10-08). 매물이 없는 땅이면 null — 그때만 지번으로 */
  picked: MapPin; broker: boolean;
  /** 같은 지번의 다른 매물로 바꾼다(판 위 매물 칩) */
  onListing?: (l: ParcelListing) => void;
  onBack: () => void; /** 상세보기 — newTab 이면 새 탭(⌘ · Ctrl 클릭 · 가운데 클릭) */ onDetail: (newTab?: boolean) => void; onHide: () => void;
  /** 사진 ⤢ — 지도 툴바 거리뷰를 이 자리 · 방향에서 크게 연다(거리뷰는 하나, 09-28) */
  onFull: (v: RoadView) => void;
  /** 크게 본 거리뷰를 닫았을 때 마지막 자리 · 방향 — 사진 자리 거리뷰가 이어받는다 */
  rvBack: (RoadView & { n: number }) | null;
  /** 크게 본 거리뷰의 썸네일 줄에 붙일 광고 사진 */
  onMedia: (m: { adId: number; ids: number[] } | null) => void;
  /** 구해요 화면(S06)에서만 구해요 칸이 선다. 목록 조건과 상관없이 고른 건물의 것을 다 읽는다 */
  seekMode?: boolean;
  /** 상세보기가 옆에 열려 있나 — 열려 있으면 건물 스펙 요약을 접는다(그쪽이 자세히 보여 준다) */
  sheetOpen?: boolean;
  onSeek?: () => void;
  onPropose?: (s: SeekRow) => void;
  /** 매물 탐색(S08 §5) — 네이버 매물은 「내 매물로 담기」, 내 매물은 「매물관리에서 열기」 */
  explore?: { onClaim: () => Promise<void>; onOpen: () => void };
}) {
  const nav = useNavigate();
  const guest = useIsGuest();
  // 열쇠는 지번(10-08). 매물관리로 넘길 때도 지번(?parcel=) — 내 매물이면 그 줄, 아니면 담기 창
  const pnu = picked.pnu;
  // 땅 · 지번 값(parcelsApi) + 대표 동의 대장(건물정보 줄) — 대장 원본(10-02), 팀 정정은 매물관리 판에서만
  const pq = useQuery({ queryKey: ["parcel", pnu], queryFn: () => parcelsApi.get(pnu) });
  const rep = (pq.data?.rep_pk as string | null | undefined) ?? null;
  const vacant = pq.isSuccess && !rep;   // 동이 없는 지번
  const dq = useQuery({ queryKey: ["building-raw", rep], queryFn: () => buildingsApi.get(rep!, true), enabled: !!rep });
  const market = useQuery({ queryKey: ["pMarket", pnu], queryFn: () => parcelsApi.market(pnu), enabled: broker });
  const adsQ = useQuery({ queryKey: ["pAds", pnu], queryFn: () => parcelsApi.ads(pnu) });
  // 키 머리 "seeks" — 남기기 · 제안 뒤 목록과 같이 새로 읽힌다. 나대지에도 남긴다
  const seekQ = useQuery({ queryKey: ["seeks", "one", pnu], queryFn: () => seeksApi.of(pnu), enabled: !!seekMode });
  const seeks = seekMode ? seekQ.data : undefined;

  // 동 값(대장) 위에 지번 값(땅 · 추정가 · 매물 · 교통)을 얹는다 — 칸 이름이 겹치는 것은 지번 쪽이 정본
  const b = { ...(dq.data ?? {}), ...(pq.data ?? {}) } as Record<string, unknown>;
  const d = (dq.data ?? {}) as Record<string, unknown>;
  const ads = adsQ.data ?? [];
  // 고른 매물 — 매물 번호가 열쇠다. 판의 광고 · 매매가 · 버튼은 이 매물의 것만 쓴다(남의 매물 광고로 채우지 않는다)
  const lid = picked.listing_id ?? null;
  const listings = (b.listings as ParcelListing[] | undefined) ?? [];
  const cur = lid != null ? listings.find((x) => x.listing_id === lid) ?? null : null;
  // 광고 — 고른 매물의 광고(노출 먼저). 매물이 없는 땅(거래완료 광고만 남은 곳)이면 그 지번의 광고
  const lead: AdCard | null = lid != null
    ? ads.find((a) => a.listing_id === lid && a.state === "노출") ?? ads.find((a) => a.listing_id === lid) ?? null
    : ads.find((a) => a.state === "노출") ?? ads[0] ?? null;
  const live = lead?.state === "노출";
  const sold = lead?.state === "거래완료";
  useEffect(() => {
    onMedia(lead && lead.photo_ids?.length ? { adId: lead.id, ids: lead.photo_ids } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id, lead?.photo_ids?.join(",")]);
  const n = (k: string) => (b[k] != null && b[k] !== "" ? Number(b[k]) : null);
  const s = (k: string) => (b[k] != null && b[k] !== "" ? String(b[k]) : null);
  // 대지면적은 대장(동) 값 — 비면 빈칸(10-08). 나대지는 토지면적(지적)
  const land = d.land_area != null ? Number(d.land_area) : vacant ? n("parcel_area") : null;
  const est = n("sale_est") ?? picked.sale_est ?? null;
  const last = d.last_sale_price != null ? Number(d.last_sale_price) : picked.last_sale_price ?? null;
  const lastYm = (d.last_sale_ym as string) ?? picked.last_sale_ym ?? null;
  const mine = cur ? cur.owner === "mine" : picked.kind === "mine";
  // 매매가(0226) — 매물 하나에 하나. 고른 매물의 값
  const salePrice = cur ? cur.price : lid != null ? picked.price : null;
  const saleText = salePrice != null ? won(salePrice) : "";
  // 면적 단위는 앱 전체 값(useUnit) — 면적 · 평당(㎡당) · 공시지가가 같이 바뀐다(대표 09-30)
  const { unit, area } = useUnit();
  const pyl = (m2: number | null | undefined) => (m2 == null ? null : area(m2, unit === "py" && m2 / PY >= 100 ? 0 : 1));
  const addr = picked.addr.replace("서울특별시 ", "").replace("번지", "");

  const [ask, setAsk] = useState(false);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  // 저장 · 관심은 광고(매물) 단위(0205, 10-01) — 대표 광고가 있을 때만 별이 서고, 관심도 그 광고의 값.
  // 열면 그 광고를 「오늘 봤다」(하루 한 번)
  const qc = useQueryClient();
  const adId = lead?.id ?? null;
  const savesQ = useQuery({ queryKey: ["savesOf", adId], queryFn: () => customerApi.savesOf(adId!), enabled: adId != null });
  const saved = (savesQ.data ?? []).length > 0;
  const toggleSave = async () => {
    if (adId == null) return;
    if (saved) await Promise.all((savesQ.data ?? []).map((x) => customerApi.unsave(x.id)));
    else await customerApi.save(adId);
    qc.invalidateQueries({ queryKey: ["savesOf", adId] }); qc.invalidateQueries({ queryKey: ["saves"] });
    qc.invalidateQueries({ queryKey: ["interest1", adId] });
  };
  useEffect(() => {
    if (adId == null) return;
    interestApi.view(adId).then(() => qc.invalidateQueries({ queryKey: ["interest1", adId] })).catch(() => {});
  }, [adId, qc]);
  const canReport = !!lead && !lead.mine;
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/parcels/${pnu}`);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { /* 권한 없음 */ }
  };

  // 판이 바뀌면 맨 위로
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); setMenu(false); }, [pnu]);

  const row = (label: string, value: React.ReactNode) =>
    value == null || value === "" ? null : <div key={label} className="dc-row"><span>{label}</span><b>{value}</b></div>;
  /** 늘 서는 줄(10-02, 디스코 결) — 모르면 값 칸만 빈칸 */
  const line = (label: string, value: React.ReactNode) =>
    <div key={label} className="dc-row"><span>{label}</span><b>{value ?? ""}</b></div>;

  // 기본정보(광고에 적은 값, 0196) — 하나도 없으면 머리째 안 선다
  // 기본정보 = 광고에 실린 매물 값(0209 — 정본은 매물 줄). 건물정보 = 건축물대장
  const basic = lead ? [
    line("현 보증금", lead.deposit != null ? `${won(lead.deposit)}원` : null),
    line("현 월세", lead.monthly_rent != null ? `${won(lead.monthly_rent)}원` : null),
    line("융자금", !lead.loan_open ? "표시 안 함" : lead.loan != null ? `${won(lead.loan)}원` : null),
    line("입주가능일", lead.move_in === "날짜" ? (lead.move_in_on ?? "").replace(/-/g, ".") : lead.move_in),
  ] : [];
  const dn = (k: string) => (d[k] != null && d[k] !== "" ? Number(d[k]) : null);
  const bcr = dn("bcr"), far = dn("far"), fa = n("floors_above"), fb = n("floors_below");
  const total = n("total_area") ?? picked.total_area ?? null;
  const approval = d.approval_ymd != null ? String(d.approval_ymd) : null;
  const age = approval && /^\d{4}/.test(approval) ? new Date().getFullYear() - Number(approval.slice(0, 4)) : null;
  // 나대지 — 대장이 없으니 땅 줄만(지목 · 용도지역 · 토지면적)
  const landRows = [
    line("지목", s("jimok")),
    line("용도지역", s("use_zone")),
    line("토지면적", pyl(land)),
  ];
  const bldgRows = vacant ? landRows : [
    line("주용도", d.main_use_name != null ? String(d.main_use_name) : null),
    line("용도지역", s("use_zone")),
    line("건폐율 / 용적률", bcr != null || far != null
      ? `${bcr != null ? `${bcr.toFixed(2)}%` : ""} / ${far != null ? `${far.toFixed(2)}%` : ""}` : null),
    line(vacant ? "토지면적" : "대지면적", pyl(land)),
    line("연면적", pyl(total)),
    line("지상 / 지하", fa != null ? `${fa}층 / ${fb ?? 0}층` : null),
    line("사용승인일", approval ? `${approval.slice(0, 10).replace(/-/g, ".")}${age != null ? ` (${age}년)` : ""}` : null),
    line("주차", dn("parking") != null ? `${dn("parking")}대` : null),
  ];
  const t = transitOf(b);
  const phone = lead && !sold ? (lead.phone ?? lead.office_phone) : null;

  // 구해요 화면 — 고객이면 초록 「구해요」(손님은 로그인으로)
  const [claiming, setClaiming] = useState(false);
  // 한 사무소 · 한 지번에 매물은 하나(listing_parcels_team_pnu) — 이 땅에 이미 내 매물이 있으면 담기는 없다
  const haveMine = listings.some((x) => x.owner === "mine");
  const exploreAct = !explore ? null
    : picked.kind === "market" && !haveMine
      ? <button className="sd-bar-ask claim" disabled={claiming}
          onClick={async () => { setClaiming(true); try { await explore.onClaim(); } finally { setClaiming(false); } }}>내 매물로 담기</button>
      : picked.kind === "mine" ? <button className="sd-bar-ask open" onClick={explore.onOpen}>매물관리에서 열기</button> : null;
  const seekAct = seekMode && !broker && !(seeks ?? []).some((x) => x.mine)
    ? <button className="sd-bar-seek" onClick={() => (guest ? nav("/login", { state: { from: location.pathname + location.search } }) : onSeek?.())}>구해요</button>
    : null;

  return (
    <div className="sd dc">
      {/* 윗줄 — ← 목록 · 공유(링크 복사) · 저장 · 숨기기 · ⋮(신고 · 중개사: 매물관리) */}
      <div className="dc-top">
        <button className="dc-ic" title="목록" onClick={onBack}><Icon name="back" size={24} /></button>
        <span className="sp" />
        {copied && <span className="dc-toast">링크를 복사했습니다</span>}
        <button className="dc-ic" title="공유" onClick={share}><Icon name="share" size={19} /></button>
        {adId != null && <button className={`dc-ic ${saved ? "on" : ""}`} title={saved ? "저장 해제" : "저장"} onClick={toggleSave}>
          <Icon name="star" size={19} /></button>}
        <button className="dc-ic" title="숨기기" onClick={onHide}><Icon name="hide" size={19} /></button>
        {(broker || canReport) && (   /* 나대지도 지번 매물이다(0255) */
          <div className="dc-more">
            <button className="dc-ic dots" title="더 보기" onClick={() => setMenu(!menu)}>⋮</button>
            {menu && (
              <div className="dc-menu" onMouseLeave={() => setMenu(false)}>
                {broker && (
                  <button onClick={() => nav(mine && lid != null ? `/sales?listing=${lid}` : `/sales?parcel=${pnu}`)}>
                    {mine ? "매물관리에서 보기" : "매물관리에 담기"}</button>
                )}
                {canReport && <button className="bad" onClick={() => { setMenu(false); setReport(true); }}>신고</button>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sd-body dc-body" ref={bodyRef}>
        <Gallery picked={picked} lead={lead} onFull={onFull} rvBack={rvBack} sheetOpen={sheetOpen} />

        {/* 같은 지번의 매물 — 둘 이상이면 칩으로 고른다. 고르면 매물 번호만 바뀐다(땅 · 대장 값은 그대로) */}
        {listings.length > 1 && (
          <div className="dc-lst">{listings.map((x) => (
            <button key={x.listing_id} className={x.listing_id === lid ? "on" : ""} onClick={() => onListing?.(x)}>
              {x.owner === "mine" ? "내 매물" : x.owner === "crawl" ? "네이버" : (x.office ?? "")}
              {x.price != null && <b className="num">{wonShort(x.price)}</b>}
            </button>
          ))}</div>
        )}

        {/* 제목 · 설명 */}
        {lead && (lead.title || lead.body) && (
          <div className="dc-intro">
            {/* 매물 유형 · 중개 — 목록 카드 태그 줄과 같은 꼴(0209: 정본은 매물 줄) */}
            {(lead.use_type || lead.brokerage === "전속") && (
              <div className="dc-tag">{[lead.use_type && `#${lead.use_type}`, lead.brokerage === "전속" && "전속"].filter(Boolean).join(" · ")}</div>
            )}
            {lead.title && <h2>{lead.title}</h2>}
            {lead.body && <p>{lead.body}</p>}
          </div>
        )}

        {/* 구해요(S06 §3) — 구해요 화면에서만. 고객은 남기기, 중개사는 줄마다 제안 */}
        {seeks && (seeks.length > 0 || !broker) && (
          <div className="dc-seek">
            <div className="dc-seek-h"><b>구해요</b><span className="num">{seeks.length}</span></div>
            {seeks.map((x) => <SeekLine key={x.id} x={x} broker={broker} onPropose={() => onPropose?.({ ...x, addr: x.addr ?? picked.addr })} />)}
          </div>
        )}

        <div className="dc-gap" />

        {/* 건물 스펙 요약 — 상세보기를 열어도 그대로 둔다(10-02 대표: 접는 동작은 필요 없다) */}
        {<>
            {/* 기본/건물정보(디스코 결) — 위 기본정보(광고 값) · 아래 건물정보(대장) */}
            <Fold title={`${lead ? "기본/" : ""}${vacant ? "토지정보" : "건물정보"}`} open>
              {basic.length > 0 && <><h5>기본정보</h5>{basic}<hr /><h5>{vacant ? "토지정보" : "건물정보"}</h5></>}
              {bldgRows}
            </Fold>
            <Fold title="실거래">
              {row(`최근 실거래${ym(lastYm) ? ` (${ym(lastYm)})` : ""}`, last != null ? won(last) : "거래 없음")}
            </Fold>
            {broker && !vacant && <MarketFolds data={market.data} pyl={pyl} />}
            {rep && (
              <Fold title="층별 현황"><FloorBiz pk={rep} /></Fold>
            )}
            <Fold title="교통">
              {!t.subway.length && !t.bus.length ? <div className="dc-none">가까운 역 · 정류장 정보가 없습니다</div> : (
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
              )}
            </Fold>
          </>}

        {/* 건축물대장(옛 「상세보기」, 10-02) — 실거래 · 대장 · 토지는 옆에 펼치는 판에서. 그리드 결: 판 폭 전체 · 마진 없음 */}
        <div className="dc-sec flush"><button className="dc-detail" onClick={(e) => onDetail(e.metaKey || e.ctrlKey)}
          onAuxClick={(e) => { if (e.button === 1) onDetail(true); }}>{vacant ? "토지대장" : "건축물대장"}</button></div>

        {/* 중개 등록정보 */}
        {lead && (
          <>
            <div className="dc-gap" />
            <div className="dc-sec">
              <h4>중개사무소 정보</h4>
              <div className="dc-reg">
                {/* 법정 표시(공인중개사법 제18조의2) — 줄은 늘 선다. 모르면 빈칸 */}
                <dl>
                  <dt>등록번호</dt><dd className="num">{lead.reg_no ?? ""}</dd>
                  <dt>소재지</dt><dd>{lead.office_addr ?? ""}</dd>
                  <dt>대표</dt><dd>{lead.rep_name ?? ""}</dd>
                  <dt>대표연락처</dt><dd className="num">{lead.office_phone ? formatPhone(lead.office_phone) : ""}</dd>
                </dl>
              </div>
              <div className="dc-when">{sold ? `거래완료 ${lead.closed_on ?? ""}` : `올린 날 ${lead.posted_on}`}</div>
            </div>
          </>
        )}
      </div>

      {/* 아래 고정 줄(10-01) — 목록과 같은 매물 카드 + 문의하기. 중개사 정보는 여기 하나로 모았다.
          광고가 없으면 중개사 줄 없이 실거래(없으면 추정가) 카드만. 구해요 화면이면 초록 「구해요」 */}
      <div className="sd-dock">
        {lead
          ? <ListingCard compact agent={lead.agent_name ?? null} agentPhoto={lead.agent_photo} rank={lead.agent_title} office={lead.office_name}
              when={phone ? formatPhone(phone) : ""}
              title={lead.title || addr}
              kind={sold ? "거래완료" : "매매"} price={sold ? "" : lead.price != null ? won(lead.price) : "가격 비공개"}
              photo={lead.photo_ids?.length ? `/api/ads/${lead.id}/photos/${lead.photo_ids[0]}` : null}
              action={exploreAct ?? (!seekMode && live && !lead.mine
                ? <button className="sd-bar-ask" onClick={() => (guest ? nav("/login", { state: { from: location.pathname + location.search } }) : setAsk(true))}>문의하기</button>
                : seekAct)} />
          : picked.kind === "market"
          // 지도 가격표와 같은 짧은 꼴(206.5억) — 담기 칸 옆 한 줄에 들어가야 한다
          ? <ListingCard compact title={addr} kind="매매" price={picked.price != null ? eok(picked.price) : ""} action={exploreAct} />
          : <ListingCard compact title={addr}
              kind={salePrice != null ? "매매" : last != null ? "실거래" : "추정가"}
              price={salePrice != null ? saleText : last != null ? `${won(last)}${ym(lastYm) ? ` (${ym(lastYm)})` : ""}` : est != null ? won(est) : ""}
              action={exploreAct ?? seekAct} />}
      </div>
      {ask && lead && <InquiryModal ad={lead} onClose={() => setAsk(false)} />}
      {report && lead && <ReportModal ad={lead} onClose={() => setReport(false)} />}
    </div>
  );
}

/** 접는 구획 — 머리 줄을 누르면 펼치고 접는다 */
/** 매매시세 · 임대시세(0212, 10-04) — 중개사만. 수집한 날마다 한 줄(같은 것을 여러 중개사가 올린 광고는 적재가 가장 싼 하나로 걷었다).
 *  매매 = 「날짜 · 시세」 최근 위. 임대 = 공간(층 · 면적)마다 최근 값 한 줄 + 수집일, 지난 날짜 값이 다르면 그 아래 작게.
 *  모든 층을 섞은 평당 월세는 내지 않는다(대표 10-04) — 층별은 지도 임대시세에서 층을 골라 본다 */
const dday = (d: string) => d.slice(2).replace(/-/g, ".");
function MarketFolds({ data, pyl }: { data: MarketData | undefined; pyl: (m2: number | null | undefined) => string | null }) {
  const sale = data?.sale ?? [];
  const spaces = new Map<string, MarketRentRow[]>();      // 서버가 층 차례 · 최근 위로 준다 — 그 차례 그대로 묶는다
  (data?.rent ?? []).forEach((r) => { const k = `${r.floor ?? ""}|${r.area_key}`; spaces.set(k, [...(spaces.get(k) ?? []), r]); });
  const rv = (r: MarketRentRow) => `${eok(r.deposit)} / ${r.rent ? eok(r.rent) : "전세"}`;
  return <>
    <Fold title="매매가 추이">
      {!sale.length ? <div className="dc-none">매매가 없음</div>
        : sale.map((r) => <div key={r.observed_on} className="dc-row"><span className="num">{dday(r.observed_on)}</span><b className="num">{eok(r.price)}</b></div>)}
    </Fold>
    <Fold title={`임대시세${spaces.size ? ` ${spaces.size}` : ""}`}>
      {!spaces.size ? <div className="dc-none">임대시세 없음</div> : [...spaces.values()].map((list) => {
        const [now, ...past] = list;
        return (
          <div key={`${now.floor}|${now.area_key}`} className="dc-mk">
            <div className="dc-row">
              <span>{now.floor ? floorName(now.floor) : "층 미상"} · {pyl(now.contract_area)}<i className="num">{dday(now.observed_on)}</i></span>
              <b className="num">{rv(now)}</b>
            </div>
            {past.filter((p, i) => rv(p) !== rv(i ? past[i - 1] : now)).map((p) => (
              <div key={p.observed_on} className="dc-row past"><span className="num">{dday(p.observed_on)}</span><b className="num">{rv(p)}</b></div>
            ))}
          </div>
        );
      })}
    </Fold>
  </>;
}

export function Fold({ title, open = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
  const [o, setO] = useState(open);
  return (
    <div className={`dc-fold ${o ? "on" : ""}`}>
      <button className="dc-fh" onClick={() => setO(!o)}><h4>{title}</h4><span className="dc-chev" /></button>
      {o && <div className="dc-fb">{children}</div>}
    </div>
  );
}



/** 사진 넘김 — 첫 장은 거리뷰, 그다음은 대표 광고에 올린 사진(올린 비율 그대로).
 *  ⤢ 는 지도 툴바 거리뷰를 이 자리 · 방향에서 크게 연다. 닫으면 거기서 옮긴 자리 · 방향을 이어받는다. */
function Gallery({ picked, lead, onFull, rvBack, sheetOpen }: {
  picked: MapPin; lead: AdCard | null; onFull: (v: RoadView) => void; rvBack: (RoadView & { n: number }) | null;
  sheetOpen: boolean;
}) {
  // 사진 자리(10-02) — 광고가 있으면 매물사진만(광고는 사진 없이 못 올린다), 광고 없는 건물만 거리뷰.
  // 상세보기가 열리면 거리뷰는 그쪽이 크게 보이니, 광고 없는 건물은 칸째 접는다(같은 거리뷰가 두 번 서지 않게)
  const photos = lead?.photo_ids ?? [];
  const n = photos.length;
  const [i, setI] = useState(0);
  const viewRef = useRef<RoadView | null>(null);
  useEffect(() => { setI(0); }, [lead?.id, picked.pnu]);
  if (lead) {
    if (n === 0) return null;
    return (
      <div className="sd-gal dc-gal">
        <AuthImg className="sd-gal-img" src={`/api/ads/${lead.id}/photos/${photos[i]}`} />
        {n > 1 && (
          <>
            <button className="adf-nav l" onClick={() => setI((i - 1 + n) % n)}>‹</button>
            <button className="adf-nav r" onClick={() => setI((i + 1) % n)}>›</button>
            <span className="adf-cnt num">{i + 1} / {n}</span>
          </>
        )}
      </div>
    );
  }
  if (sheetOpen || picked.lng == null || picked.lat == null) return null;
  return (
    <div className="sd-gal dc-gal">
      <RoadviewMini className="sel-road" lng={picked.lng} lat={picked.lat} view={rvBack}
        onView={(v) => { viewRef.current = v; }}
        onExpand={() => onFull(viewRef.current ?? { lat: picked.lat!, lng: picked.lng!, pan: 0, tilt: 0, fov: 100 })} />
    </div>
  );
}

/** 신고(S05 §6) — 사유 칩 둘. 표시정보가 다르면 무엇이 다른지 적어야 보낸다. 들어오면 광고가 검수중이 된다 */
function ReportModal({ ad, onClose }: { ad: AdCard; onClose: () => void }) {
  const [reason, setReason] = useState<"거래완료" | "표시정보 다름" | null>(null);
  const [body, setBody] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const send = async () => {
    if (!reason) { setErr("사유를 고르세요"); return; }
    if (reason === "표시정보 다름" && !body.trim()) { setErr("무엇이 다른지 적으세요"); return; }
    setBusy(true); setErr(null);
    try { await customerApi.report(ad.id, reason, body.trim() || null); setSent(true); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const row = (label: string, node: React.ReactNode) => (
    <div className="gm-row lab"><span className="gm-lab">{label}</span><div className="gm-body wrap">{node}</div></div>
  );
  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="gm" onClick={(e) => e.stopPropagation()}>
        <div className="gm-title-fix">광고 신고</div>
        {sent ? (
          <>
            <div className="iq-done">신고를 받았습니다. 확인하는 동안 이 광고는 검수중으로 표시됩니다.</div>
            <div className="gm-foot"><span className="sp" /><button className="gm-save" onClick={onClose}>닫기</button></div>
          </>
        ) : (
          <>
            {row("사유", (["거래완료", "표시정보 다름"] as const).map((k) => (
              <button key={k} type="button" className={`um-chip ${reason === k ? "on" : ""}`}
                onClick={() => setReason(reason === k ? null : k)}>{k === "거래완료" ? "거래완료된 매물" : "표시정보가 실제와 다름"}</button>
            )))}
            {reason === "표시정보 다름" && row("다른 점", <textarea className="gm-in ad-body" rows={3} maxLength={300} value={body}
              placeholder="예: 매매가가 광고와 다름" onChange={(e) => setBody(e.target.value)} />)}
            {err && <div className="ad-err">{err}</div>}
            <div className="gm-foot">
              <span className="sp" />
              <button className="gm-ghost quiet" onClick={onClose}>취소</button>
              <button className="gm-save" disabled={busy} onClick={send}>{busy ? "…" : "신고"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  ), document.body);
}
