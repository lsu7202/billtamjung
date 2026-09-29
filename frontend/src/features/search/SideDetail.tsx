import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { buildingsApi, customerApi, rentsApi, type AdCard } from "../../shared/api/endpoints";
import { RoadviewMini, type RoadView } from "../../shared/map/Roadview";
import type { MapPin } from "../../shared/map/MapPanel";
import { Icon } from "../../shared/ui/Icon";
import { transitOf, lineColor } from "../building/LocationPanel";
import { Avatar, InquiryModal } from "./AdCards";
import { AuthImg } from "../../shared/ui/AuthImg";
import { formatPhone } from "../building/KV";
import { won } from "../../shared/format";

/** 탐색 사이드 판의 상세 — 디스코 결(대표 09-28 「그냥 디스코의 디자인을 카피」).
 *
 *  탭 없이 위에서 아래로 한 번에 스크롤한다.
 *  윗줄(← · 공유 · 저장 · ⋮) → 사진(거리뷰 첫 장 · 전체화면) → 제목 · 설명 → 회색 띠 위 가격 카드 →
 *  중개사 · 문의 → 기본정보 · 시세 · 층별 임대 · 교통(접기) → 상세보기 → 중개 등록정보 → 아래 고정 줄.
 *  모르는 값은 「-」를 찍지 않고 그 줄을 세우지 않는다. 주변 실거래 견주기 막대는 뺐다(대표 09-28). */

const PY = 3.305785;
const eok = (v: number | null | undefined) =>
  v == null ? "—" : v >= 1e8 ? `${(v / 1e8).toFixed(v >= 1e10 ? 0 : 1).replace(/\.0$/, "")}억` : `${Math.round(v / 1e4).toLocaleString()}만`;
const pyl = (m2: number | null | undefined) => (m2 == null ? null : `${(m2 / PY).toFixed(m2 / PY < 100 ? 1 : 0)}평`);
const ym = (s: string | null | undefined) => (s && /^\d{6}$/.test(s) ? `${s.slice(2, 4)}.${s.slice(4)}` : "");

export function SideDetail({ picked, broker, onBack, onDetail, onHide, onFull, rvBack, onMedia }: {
  picked: MapPin; broker: boolean;
  onBack: () => void; onDetail: () => void; onHide: () => void;
  /** 사진 ⤢ — 지도 툴바 거리뷰를 이 자리 · 방향에서 크게 연다(거리뷰는 하나, 09-28) */
  onFull: (v: RoadView) => void;
  /** 크게 본 거리뷰를 닫았을 때 마지막 자리 · 방향 — 사진 자리 거리뷰가 이어받는다 */
  rvBack: (RoadView & { n: number }) | null;
  /** 크게 본 거리뷰의 썸네일 줄에 붙일 광고 사진 */
  onMedia: (m: { adId: number; ids: number[] } | null) => void;
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
  const floors = useQuery({ queryKey: ["floor-info", pk], queryFn: () => rentsApi.info(pk), enabled: !vacant });
  const adsQ = useQuery({ queryKey: ["bAds", pk], queryFn: () => buildingsApi.ads(pk), enabled: !vacant });

  const b = bq.data ?? {};
  const ads = adsQ.data ?? [];
  // 대표 광고 — 노출 중인 것 중 가장 최근(서버 순서). 없으면 거래완료 광고
  const lead: AdCard | null = ads.find((a) => a.state === "노출") ?? ads[0] ?? null;
  const live = lead?.state === "노출";
  const sold = lead?.state === "거래완료";
  useEffect(() => {
    onMedia(lead && lead.photo_ids?.length ? { adId: lead.id, ids: lead.photo_ids } : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lead?.id, lead?.photo_ids?.join(",")]);
  const n = (k: string) => (b[k] != null && b[k] !== "" ? Number(b[k]) : null);
  const s = (k: string) => (b[k] != null && b[k] !== "" ? String(b[k]) : null);
  const land = n("land_area") ?? picked.land_area ?? null;
  const total = n("total_area") ?? picked.total_area ?? null;
  const fa = n("floors_above"), fb = n("floors_below");
  const est = n("sale_est") ?? picked.sale_est ?? null;
  const last = n("last_sale_price") ?? picked.last_sale_price ?? null;
  const lastYm = (b.last_sale_ym as string) ?? picked.last_sale_ym ?? null;
  const approval = s("approval_ymd");
  const age = approval && /^\d{4}/.test(approval) ? new Date().getFullYear() - Number(approval.slice(0, 4)) : null;
  const mine = picked.kind === "mine" || picked.col === "mine";
  // 매매가 — 노출 중인 광고의 값(공개), 광고가 없으면 (중개사) 내 매물의 팀 매매가
  const salePrice = live && lead!.price != null ? lead!.price : n("sale_price");
  const perLand = (v: number | null) => (v != null && land ? `대지 평당 ${Math.round(v / (land / PY) / 1e4).toLocaleString()}만` : null);
  const addr = picked.addr.replace("서울특별시 ", "").replace("번지", "");

  const [ask, setAsk] = useState(false);
  const [menu, setMenu] = useState(false);
  const [report, setReport] = useState(false);
  // 저장(S05 §5-2) — 건물 + 대표 광고. 누르면 저장, 다시 누르면 해제. 광고가 내려가도 건물 저장은 남는다
  const qc = useQueryClient();
  const savesQ = useQuery({ queryKey: ["savesOf", pk], queryFn: () => customerApi.savesOf(pk), enabled: !vacant });
  const saved = (savesQ.data ?? []).length > 0;
  const toggleSave = async () => {
    if (saved) await Promise.all((savesQ.data ?? []).map((x) => customerApi.unsave(x.id)));
    else await customerApi.save(pk, lead?.id ?? null);
    qc.invalidateQueries({ queryKey: ["savesOf", pk] }); qc.invalidateQueries({ queryKey: ["saves"] });
  };
  const canReport = !!lead && !lead.mine;
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/buildings/${pk}`);
      setCopied(true); setTimeout(() => setCopied(false), 1500);
    } catch { /* 권한 없음 */ }
  };

  // 판이 바뀌면 맨 위로
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); setMenu(false); }, [pk]);

  const row = (label: string, value: React.ReactNode) =>
    value == null || value === "" ? null : <div key={label} className="dc-row"><span>{label}</span><b>{value}</b></div>;

  // 기본정보(광고에 적은 값, 0196) — 하나도 없으면 머리째 안 선다
  const basic = lead ? [
    row("현 보증금", lead.deposit != null ? `${won(lead.deposit)}원` : null),
    row("현 월세", lead.monthly_rent != null ? `${won(lead.monthly_rent)}원` : null),
    row("융자금", !lead.loan_open ? "표시 안 함" : lead.loan != null ? `${won(lead.loan)}원` : null),
    row("입주가능일", lead.move_in === "날짜" ? lead.move_in_on : lead.move_in),
  ].filter(Boolean) : [];
  const bcr = n("bcr"), far = n("far");
  const bldgRows = [
    row("건물용도", s("main_use_name")),
    row("용도지역", s("use_zone")),
    row("건폐율 / 용적률", bcr != null || far != null
      ? `${bcr != null ? `${bcr.toFixed(2)}%` : "—"} / ${far != null ? `${far.toFixed(2)}%` : "—"}` : null),
    row("주구조", s("structure")),
    row("대지면적", pyl(land)),
    row("건축면적", pyl(n("build_area"))),
    row("연면적", pyl(total)),
    row("지상 / 지하", fa != null ? `${fa}층 / ${fb ?? 0}층` : null),
    row("사용승인일", approval ? `${approval.slice(0, 10).replace(/-/g, ".")}${age != null ? ` (${age}년)` : ""}` : null),
    row("승강기", n("elevator") != null ? `${n("elevator")}대` : null),
    row("주차", n("parking") != null ? `${n("parking")}대` : null),
    row("공시지가", n("gongsi_latest") != null ? `${Math.round(n("gongsi_latest")! * PY / 1e4).toLocaleString()}만원/평` : null),
  ].filter(Boolean);

  const flist = floors.data?.floors ?? [];
  const t = transitOf(b);
  const phone = lead && !sold ? (lead.phone ?? lead.office_phone) : null;
  const agent = lead && (
    <div className="dc-ag">
      <Avatar name={lead.agent_name ?? lead.office_name ?? "중"} />
      <div><b>{lead.agent_name ?? "담당"}</b><span>{lead.office_name ?? ""}</span></div>
    </div>
  );

  return (
    <div className="sd dc">
      {/* 윗줄 — ← 목록 · 공유(링크 복사) · 저장 · 숨기기 · ⋮(신고 · 중개사: 매물관리) */}
      <div className="dc-top">
        <button className="dc-ic" title="목록" onClick={onBack}><Icon name="back" size={24} /></button>
        <span className="sp" />
        {copied && <span className="dc-toast">링크를 복사했습니다</span>}
        <button className="dc-ic" title="공유" onClick={share}><Icon name="share" size={19} /></button>
        {!vacant && <button className={`dc-ic ${saved ? "on" : ""}`} title={saved ? "저장 해제" : "저장"} onClick={toggleSave}>
          <Icon name="star" size={19} /></button>}
        <button className="dc-ic" title="숨기기" onClick={onHide}><Icon name="hide" size={19} /></button>
        {((broker && !vacant) || canReport) && (
          <div className="dc-more">
            <button className="dc-ic dots" title="더 보기" onClick={() => setMenu(!menu)}>⋮</button>
            {menu && (
              <div className="dc-menu" onMouseLeave={() => setMenu(false)}>
                {broker && !vacant && (
                  <button onClick={() => nav(`/sales?listing=${encodeURIComponent(pk)}`)}>
                    {mine ? "매물관리에서 보기" : "매물관리에 담기"}</button>
                )}
                {canReport && <button className="bad" onClick={() => { setMenu(false); setReport(true); }}>신고</button>}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="sd-body dc-body" ref={bodyRef}>
        <Gallery picked={picked} lead={lead} onFull={onFull} rvBack={rvBack} />

        {/* 제목 · 설명 */}
        {lead && (lead.title || lead.body) && (
          <div className="dc-intro">
            {lead.title && <h2>{lead.title}</h2>}
            {lead.body && <p>{lead.body}</p>}
          </div>
        )}

        {/* 회색 띠 위 가격 카드 */}
        <div className="dc-band">
          <div className="dc-card">
            {(lead?.use_type || lead?.brokerage === "전속") && (
              <div className="dc-pills">
                {lead?.use_type && <span className="dc-pill">{lead.use_type}</span>}
                {lead?.brokerage === "전속" && <span className="dc-pill blue">전속</span>}
              </div>
            )}
            <div className="dc-price">
              {lead
                ? sold ? <b className="gray">거래완료</b>
                  : lead.price != null
                    ? <><em>매매</em><b className="num">{won(lead.price)}</b>{perLand(lead.price) && <small className="num">({perLand(lead.price)})</small>}</>
                    : <><em>매매</em><b>가격 비공개</b></>
                : salePrice != null
                  ? <><em>매매</em><b className="num">{won(salePrice)}</b>{perLand(salePrice) && <small className="num">({perLand(salePrice)})</small>}</>
                  : last != null
                    ? <><em className="gray">실거래</em><b className="num">{won(last)}</b>{ym(lastYm) && <small className="num">({ym(lastYm)})</small>}</>
                    : <><em className="gray">추정가</em><b className="num">{est != null ? won(est) : "—"}</b></>}
            </div>
            <div className="dc-addr">{addr}{mine && <span className="ml-tag mine">내</span>}</div>
            {s("road_addr") && <div className="dc-road">{s("road_addr")}</div>}
          </div>
        </div>

        {/* 중개사 · 연락처 */}
        {lead && (
          <div className="dc-agent">
            {agent}
            {phone && (
              <>
                <div className="dc-q">이 매물 문의하기</div>
                <a className="dc-call" href={`tel:${phone.replace(/\D/g, "")}`}>
                  <span className="num">{formatPhone(phone)}</span><i><Icon name="phone" size={18} /></i></a>
              </>
            )}
          </div>
        )}

        <div className="dc-gap" />

        {/* 기본정보 · 시세 · 층별 임대 · 교통 · (중개사) 시장 호가 — 접기 */}
        {/* 기본정보 — 광고에 적은 값(보증금 · 월세 · 융자금 · 입주가능일) 다음에 대장(건물 · 토지) 값 */}
        <Fold title="기본정보" open>
          {basic.length > 0 && <>{basic}<hr /></>}
          {bldgRows.length ? bldgRows : <div className="dc-none">대장 정보가 없습니다</div>}
        </Fold>
        <Fold title="시세" open>
          {row("매매가", salePrice != null ? won(salePrice) : null)}
          {row(`최근 실거래${ym(lastYm) ? ` (${ym(lastYm)})` : ""}`, last != null ? won(last) : "거래 없음")}
          {row("빌탐정 추정가", est != null ? won(est) : null)}
        </Fold>
        {!vacant && (
          <Fold title="층별 임대">
            {flist.length === 0 ? <div className="dc-none">층별 정보가 없습니다</div> : flist.slice(0, 12).map((g) =>
              row(g.floor, g.ledger.length ? `${g.ledger[0].name}${g.ledger.length > 1 ? ` 외 ${g.ledger.length - 1}` : ""}`
                : g.uses.length ? g.uses.join(" · ") : "—"))}
            {flist.length > 12 && <div className="dc-none">외 {flist.length - 12}개 층</div>}
          </Fold>
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

        {broker && (crawl.data ?? []).length > 0 && (
          <Fold title={`시장 호가 ${crawl.data!.length}`}>
            {crawl.data!.map((c) => (
              <div key={c.id} className="dc-row">
                <span>{c.deal} · {c.floor ? `${c.floor}층` : "층 미상"}{c.contract_area ? ` · ${pyl(c.contract_area)}` : ""}</span>
                <b className="num">{c.deal === "매매" ? eok(c.price) : `${eok(c.deposit)} / ${eok(c.rent)}`}</b>
              </div>
            ))}
          </Fold>
        )}

        {/* 상세보기 — 실거래 · 대장 · 토지는 상세(새 탭)에서 */}
        <div className="dc-sec"><button className="dc-detail" onClick={onDetail}>상세보기</button></div>

        {/* 중개 등록정보 */}
        {lead && (
          <>
            <div className="dc-gap" />
            <div className="dc-sec">
              <h4>중개 등록정보</h4>
              <div className="dc-reg">
                {agent}
                {(lead.reg_no || lead.office_addr || lead.rep_name || lead.office_phone) && (
                  <dl>
                    {lead.reg_no && <><dt>등록번호</dt><dd className="num">{lead.reg_no}</dd></>}
                    {lead.office_addr && <><dt>소재지</dt><dd>{lead.office_addr}</dd></>}
                    {lead.rep_name && <><dt>대표</dt><dd>{lead.rep_name}</dd></>}
                    {lead.office_phone && <><dt>대표연락처</dt><dd className="num">{formatPhone(lead.office_phone)}</dd></>}
                  </dl>
                )}
              </div>
              <div className="dc-when">{sold ? `거래완료 ${lead.closed_on ?? ""}` : `올린 날 ${lead.posted_on}`}</div>
            </div>
          </>
        )}
      </div>

      {/* 아래 고정 줄 — 중개사 + 상담요청. 노출 중이고 우리 팀 광고가 아닐 때만 */}
      {lead && live && !lead.mine && (
        <div className="sd-bar">
          <Avatar name={lead.agent_name ?? lead.office_name ?? "중"} />
          <div className="sd-bar-t"><b>{lead.agent_name ?? "담당"}</b><span>{lead.office_name ?? ""}</span></div>
          <button className="sd-bar-ask" onClick={() => setAsk(true)}>상담요청</button>
        </div>
      )}
      {ask && lead && <InquiryModal ad={lead} onClose={() => setAsk(false)} />}
      {report && lead && <ReportModal ad={lead} onClose={() => setReport(false)} />}
    </div>
  );
}

/** 접는 구획 — 머리 줄을 누르면 펼치고 접는다 */
function Fold({ title, open = false, children }: { title: string; open?: boolean; children: React.ReactNode }) {
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
function Gallery({ picked, lead, onFull, rvBack }: {
  picked: MapPin; lead: AdCard | null; onFull: (v: RoadView) => void; rvBack: (RoadView & { n: number }) | null;
}) {
  const photos = lead?.photo_ids ?? [];
  const n = 1 + photos.length;
  const [i, setI] = useState(0);
  const view = useRef<RoadView | null>(null);
  const [gen, setGen] = useState(0);            // 이어받은 자리로 판 거리뷰를 다시 세운다
  const hasRv = !!(picked.lng && picked.lat);
  useEffect(() => { setI(0); view.current = null; }, [picked.building_pk]);
  useEffect(() => {
    if (!rvBack) return;
    view.current = { lat: rvBack.lat, lng: rvBack.lng, pan: rvBack.pan, tilt: rvBack.tilt, fov: rvBack.fov };
    setI(0); setGen((g) => g + 1);
  }, [rvBack?.n]);
  const full = () => onFull(view.current ?? { lat: picked.lat, lng: picked.lng, pan: 0, tilt: 0, fov: 100 });
  return (
    <div className="sd-gal dc-gal">
      {i === 0
        ? (hasRv ? <RoadviewMini key={`${picked.building_pk}-${gen}`} lng={picked.lng} lat={picked.lat} className="sel-road"
            view={view.current} onView={(v) => { view.current = v; }} /> : <div className="sel-road" />)
        : <AuthImg className="sd-gal-img" src={`/api/ads/${lead!.id}/photos/${photos[i - 1]}`} />}
      {n > 1 && (
        <>
          <button className="adf-nav l" onClick={() => setI((i - 1 + n) % n)}>‹</button>
          <button className="adf-nav r" onClick={() => setI((i + 1) % n)}>›</button>
        </>
      )}
      <span className="adf-cnt num">{i === 0 ? <><Icon name="map" size={12} />거리뷰</> : `사진 ${i}`}{n > 1 ? ` · ${i + 1} / ${n}` : ""}</span>
      {hasRv && <button className="dc-full" title="전체화면" onClick={full}><Icon name="fullscreen" size={18} /></button>}
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
