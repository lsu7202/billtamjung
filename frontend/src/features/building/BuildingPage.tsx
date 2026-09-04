import { Loading } from "../../shared/ui/Spinner";
import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  buildingsApi, overlaysApi, rentsApi, listingsApi, creditsApi, seriesApi, reportsApi, proposalsApi,
} from "../../shared/api/endpoints";
import { PhotoPanel } from "../../shared/map/PhotoPanel";
import { wonShort } from "../../shared/format";
import { MarketArea, CompPoint, CompFilter, COMP_FILTER_DEFAULT } from "../../shared/map/geo";
import { TradePanel } from "./TradePanel";
import { Sidebar } from "./Sidebar";
import { ReportModal } from "./ReportModal";
import { BriefingModal } from "./BriefingModal";
import { ParcelBlock, GongsiCard } from "./ParcelBlock";
import { Toc } from "./Toc";
import { LocationPanel } from "./LocationPanel";
import { RentPanel } from "./RentPanel";
import { useFairPrice } from "./FairPrice";
import { LandScene } from "./LandScene";
import { vNonNeg, vPos, vInt } from "./KV";
import { TextRow, EnumRow, FloorsRow2 } from "./InfoRow";
import { Segmented } from "../../shared/ui/Segmented";
import "./bldgtab.css";
import { useUnit } from "../../shared/hooks/useUnit";

/** S02 건물 상세 — 목업 전체 구조:
 * 헤더지표 · 사진(지도/로드뷰) · 표시범위 · 금액 · 투자분석 · 층별임대 · 상세정보
 * · 건물 · 토지 · 시계열(공시지가/매각/광고) · 입지 · 주변시세(S03) · 우측 4탭 · 하단 툴바
 */

const P = 3.305785;
/** 탭 넷 — 중개인이 자료를 모으는 단위 그대로(2026-08-26 재편).
 *
 *  「분석」 탭을 없앴다. 추정치를 한 곳에 몰아 두면 근거에서 떨어져서, 임대 추정을 보려고
 *  임대 탭을 나와야 했다. 이제 **추정은 그 근거 옆에 선다** — 임대 추정은 실측 층별 임대 옆에,
 *  추정가·수익률은 아예 머리줄로 올려 어느 탭에서나 보인다. 사실과 추정은 탭이 아니라
 *  「추정」 배지로 가른다.
 *
 *  건물과 토지는 합쳤다: 대장 한 장과 지적 한 장을 오가며 보는 일이 없다.
 *  대신 층별 임대가 길어서 임대를 따로 뺐다. */
type Scope = "bldg" | "rent" | "trade" | "loc";
const SCOPES: [Scope, string][] =
  [["bldg", "건물 · 토지"], ["rent", "임대"], ["trade", "실거래"], ["loc", "입지"]];

export function BuildingPage() {
  const { pk = "" } = useParams();
  const qc = useQueryClient();
  const [scope, setScope] = useState<Scope>("bldg");
  // 면적 단위는 사람의 취향이라 화면마다 두지 않고 앱 전체가 같은 값을 본다(useUnit)
  const { unit, setUnit } = useUnit();
  const [marketArea, setMarketArea] = useState<MarketArea>({ kind: "circle", radius_m: 500 });   // 주변상권(지도 그리기)
  // 실거래 사례 조건(기간·가격대) — 상권과 나란한 팀 오버레이. 리포트도 이 값을 읽는다.
  const [compFilter, setCompFilter] = useState<CompFilter>(COMP_FILTER_DEFAULT);
  const [comps, setComps] = useState<CompPoint[]>([]);   // 지도에 찍을 주변 매물(실거래/임대)
  const hydrated = useRef(false);

  const building = useQuery({ queryKey: ["building", pk], queryFn: () => buildingsApi.get(pk) });
  // 저장된 주변상권(유저 오버레이) 복원 — 최초 1회. 이후 방문에도 동일 유지.
  useEffect(() => {
    if (hydrated.current || !building.data) return;
    hydrated.current = true;
    const raw = (building.data as Record<string, unknown>).market_area;
    if (typeof raw === "string") { try { setMarketArea(JSON.parse(raw)); } catch { /* 손상 시 기본 */ } }
    const cf = (building.data as Record<string, unknown>).comp_filter;
    if (typeof cf === "string") { try { setCompFilter({ ...COMP_FILTER_DEFAULT, ...JSON.parse(cf) }); } catch { /* 손상 시 기본 */ } }
  }, [building.data]);
  // 주변상권 변경 = 유저 오버레이로 저장(팀 공유). 그리기·이동·초기화 모두 여기로.
  // 저장 후 report-comps 무효화 — 리포트 요약(ReportView)·검토모달이 같은 캐시를 봐서, 안 하면 새 상권이 새로고침 전까지 반영 안 됨.
  const saveArea = (a: MarketArea) => {
    setMarketArea(a);
    overlaysApi.put(pk, "market_area", JSON.stringify(a))
      .then(() => qc.invalidateQueries({ queryKey: ["report-comps", pk] }))
      .catch(() => {});
  };
  // 사례 조건도 팀 공유 오버레이 — 리포트가 같은 값을 읽어야 화면과 보고서가 안 어긋난다.
  const saveComp = (c: CompFilter) => {
    setCompFilter(c);
    overlaysApi.put(pk, "comp_filter", JSON.stringify(c))
      .then(() => qc.invalidateQueries({ queryKey: ["report-comps", pk] }))
      .catch(() => {});
  };
  const rents = useQuery({ queryKey: ["rents", pk], queryFn: () => rentsApi.list(pk) });
  const series = useQuery({ queryKey: ["series", pk], queryFn: () => seriesApi.get(pk) });
  const listing = useQuery({ queryKey: ["listing", pk], queryFn: () => listingsApi.get(pk) });

  const [saveErr, setSaveErr] = useState<string | null>(null);
  const editField = useMutation({
    mutationFn: ({ field, value }: { field: string; value: string }) => overlaysApi.put(pk, field, value),
    retry: 2, retryDelay: (n) => 400 * (n + 1),        // 일시적 실패 자동 재시도(#6)
    onMutate: async ({ field, value }) => {            // 낙관적 반영: 즉시 화면 갱신
      await qc.cancelQueries({ queryKey: ["building", pk] });
      const prev = qc.getQueryData<Record<string, any>>(["building", pk]);
      qc.setQueryData(["building", pk], (old: Record<string, any> | undefined) => (old ? { ...old, [field]: value } : old));
      setSaveErr(null);
      return { prev };
    },
    onError: (_e, _v, ctx) => {                        // 재시도 끝내 실패 → 롤백 + 알림
      if (ctx?.prev) qc.setQueryData(["building", pk], ctx.prev);
      setSaveErr("저장 실패 — 이전 값으로 되돌렸습니다. 잠시 후 다시 시도하세요.");
    },
    onSettled: () => { qc.invalidateQueries({ queryKey: ["building", pk] }); qc.invalidateQueries({ queryKey: ["dist", pk] }); },
  });
  const revert = useMutation({
    mutationFn: (field: string) => overlaysApi.revert(pk, field),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["building", pk] }),
  });

  const credits = useQuery({ queryKey: ["credits"], queryFn: creditsApi.balance });
  const [reportOpen, setReportOpen] = useState(false);
  const [briefOpen, setBriefOpen] = useState(false);
  const [genState, setGenState] = useState<string | null>(null);
  const nav = useNavigate();
  // 브리핑 생성 — 계산이 없어 바로 완료된다. 완료되면 덱으로 이동.
  const briefing = useMutation({
    mutationFn: async ({ comment, buyerIds }: { comment: string; buyerIds: number[] }) => {
      // 코멘트를 먼저 저장해야 스냅샷에 실린다(생성 시점의 오버레이를 그대로 굳힌다).
      await overlaysApi.put(pk, "briefing_comment", comment);
      const { report_id } = await reportsApi.create(pk, "briefing");
      for (let i = 0; i < 20; i++) {
        const r = await reportsApi.get(report_id);
        if (r.status === "done") {
          // 보낼 대상을 골랐으면 제안으로 기록한다 — 만들고 나서 따로 적지 않는다(S04).
          // 실패해도 브리핑은 이미 만들어졌으니 막지 않는다.
          await Promise.all(buyerIds.map((id) =>
            proposalsApi.upsert({ buyer_id: id, building_pk: pk, report_id })
              .catch(() => {})));
          if (buyerIds.length) qc.invalidateQueries({ queryKey: ["matching-buyers", pk] });
          return report_id;
        }
        if (r.status === "failed") throw new Error("브리핑 생성에 실패했습니다");
        await new Promise((z) => setTimeout(z, 900));
      }
      throw new Error("생성이 지연되고 있습니다 — 마이페이지에서 확인해 주세요");
    },
    onMutate: () => setGenState("브리핑 자료를 만들고 있습니다…"),
    onSuccess: (rid) => { setGenState(null); nav(`/briefings/${rid}`); },
    onError: (e) => setGenState(String((e as Error)?.message ?? e)),
  });   // S02b 생성 완료 메시지

  // ── 파생값 ──
  const b = (building.data ?? {}) as Record<string, any>;
  const total = rents.data?.total;
  // 총임대료·수익률 계산은 임대 탭(RentPanel)으로 갔다(2026-08-26) — 층별 임대의 합이라
  // 그 표가 주인이다. 이 화면에 남는 건 머리줄이 쓰는 매매가뿐이다.
  // 매매가 = **사람이 넣은 값만**(2026-08-18) — 추정가로 미리 채우지 않는다.
  // 채워 두면 다들 호가인 줄 알아 오해가 선다. 비면 빈 대로(미지정은 null) — 수익률·단가도 같이 빈다.
  // 머리줄은 읽기만 한다 — 고치는 자리는 우측 사이드바 하나다(2026-08-26).
  const price = b.sale_price != null && b.sale_price !== "" ? Number(b.sale_price) : null;
  // 추정가·수익률은 어느 탭을 보고 있든 옆에 있어야 하는 값이라 머리줄에 세운다(2026-08-26)
  const est = useFairPrice(pk);

  // 팀이 고친 칸(2026-08-25) — building_view 가 마스터·오버레이를 합쳐 주니 화면이 못 가른다.
  // 백엔드가 `_edited`(고친 필드)와 `_master`(그 칸의 대장 원본)를 같이 준다.
  const editedSet = new Set<string>((b._edited as string[]) ?? []);
  const bMaster = (b._master ?? {}) as Record<string, unknown>;
  /** 참조값(2026-09-04) — 본값이 아니다. 대장이 빈 칸일 때만 옆에 작게 띄운다.
   *  승강기공단 대수·계산 건폐/용적. 확인설명서·계약서로 나가는 자리에는 안 선다. */
  const ref = (b._ref ?? {}) as { elevator_ext?: number | null; bcr_calc?: number | null; far_calc?: number | null };
  const isEdited = (f: string) => editedSet.has(f);
  /** 줄 하나에 붙는 오버레이 상태 — 고쳤나 · 대장 원본 · 저장 · 되돌리기 */
  const ovState = (f: string, master: React.ReactNode) => ({
    edited: isEdited(f), master,
    onSave: (v: string) => onSave(f, v),
    onRevert: () => onRevert(f),
  });

  const area = (m2?: number | string | null) => {
    const v = typeof m2 === "string" ? parseFloat(m2) : m2;
    if (v == null || Number.isNaN(v)) return "";
    return unit === "py" ? `${(v / P).toFixed(1)}평` : `${v.toLocaleString(undefined, { maximumFractionDigits: 20 })}㎡`;   // ㎡=원값 그대로
  };
  // 🔀 직접입력 단위: 금액=억(저장 원), 집계금액=만원(저장 원), 율=% 그대로
  const ymdDisp = (v: unknown) => (v ? String(v).replace(/-/g, "/") : "");                    // 저장 YYYY-MM-DD → 표시 YYYY/MM/DD

  if (building.isLoading) return <Loading label="매물 정보 불러오는 중" minHeight="60vh" />;
  if (building.isError) return <p>건물을 찾을 수 없습니다</p>;

  const show = (grp: Scope) => scope === grp;

  // 인라인 편집 저장/되돌리기 핸들러(KV는 최상위 컴포넌트 = 리마운트 버그 방지)
  const onSave = (field: string, value: string) => editField.mutate({ field, value });
  const onRevert = (field: string) => revert.mutate(field);
  // 면적: 편집 seed=현재 단위, 저장=㎡
  const areaSeed = (m2: unknown) => (m2 != null && m2 !== "" ? +(unit === "py" ? Number(m2) / P : Number(m2)).toFixed(1) : "");
  const areaParse = (v: string) => String(unit === "py" ? parseFloat(v) * P : parseFloat(v));   // ㎡ 저장은 반올림 없이 원값

  // 헤더 지표 스트립(Compass식) — 박스 없이 값 크게·라벨 작게·세로 hairline 구분. 매매가=히어로(강조 1개).
  // 면적 값 — 3값(대지/연/건축) 미니 라벨 병기. 단위(평/㎡) 토글 반영.
  const areaVal = () => {
    const c = (lbl: string, m2: number | null) => m2 == null ? null : (
      <span style={{ display: "inline-flex", alignItems: "baseline", gap: 3 }}>
        <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 600 }}>{lbl}</span>{Math.round(unit === "py" ? m2 / P : m2).toLocaleString()}
      </span>
    );
    const n = (x: unknown) => (x != null && x !== "" ? Number(x) : null);
    return <span style={{ display: "inline-flex", gap: 11 }}>{c("대지", n(b.land_area))}{c("연", n(b.total_area))}{c("건축", n(b.build_area))}</span>;
  };

  return (
    <div className="bt-page">
      {/* ── 헤더(S02 §3.1 · 2026-08-27 알약으로) ──
          세로 hairline 으로 값을 가르던 Compass 결을 걷었다 — 통합 모달(정본)엔 선이 없고
          알약과 바탕색이 값을 가른다. **우리가 만든 값**(추정가·수익률)은 연파랑 알약으로
          왼쪽에, **정해진 값**(매매가·면적·층수)은 회색 알약으로 그 뒤에 선다.
          색이 갈래를 말하니 회색 판을 두르지 않아도 어디까지가 추정인지 보인다. */}
      {/* 머리줄 — 진짜 한 행(2026-08-27 확정). 주소 · 매물번호 · 알약.
          접수일·담당·도로명주소는 뺐다 — 접수일·담당은 사이드바(매물)가 정본이고,
          도로명은 지번과 같은 곳을 두 번 부르는 말이라 머리줄에서 할 일이 없다.
          매물번호만 남는다: 전화로 「BT-1294 있잖아요」 할 때 찾는 그 번호다. */}
      <div className="panel bt-hd" style={{ padding: "9px 18px", position: "sticky", top: 0, zIndex: 20,
        display: "flex", alignItems: "center", gap: 12, flexWrap: "nowrap", overflow: "hidden" }}>
        <h2 style={{ margin: 0, fontSize: 17, whiteSpace: "nowrap", overflow: "hidden",
          textOverflow: "ellipsis", minWidth: 120, flex: "0 1 auto" }}>{b.addr}</h2>
        {/* 매물번호는 **팀이 담은 매물**일 때만 — 안 담은 건물에 번호가 떠 있으면
            「이미 우리 매물인가」로 읽힌다. 조회와 보유는 다른 상태다. */}
        {Boolean(listing.data?.registered) && (listing.data?.listing_no as string) && (
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)", whiteSpace: "nowrap", flex: "0 0 auto" }}>
            {String(listing.data?.listing_no)}</span>
        )}
        {/* 값은 **추정 짝과 실측 짝**으로 갈라 놓는다(2026-08-27).
            왼쪽 연파랑 = 빌탐정이 낸 값(추정가 · 추정 수익률), 오른쪽 흰 = 실제 값(매매가 · 수익률).
            분자·분모를 같은 출신끼리 짝지어야 「빌탐정은 이렇게 보는데 실제는 이렇다」가 읽힌다.
            섞으면(추정가 ÷ 실측임대) 그 대비가 안 나오고 무엇이 추정인지도 흐려진다.
            「추정」 배지는 묶음에 하나 — 묶음 전체가 추정이니 값마다 붙일 이유가 없다. */}
        <div className="hd-pills">
          {!est.nonCommercial && (
            <span className="hd-grp est">
              <span className="pill"><i>빌탐정 추정가</i>
                <b>{est.fair ? wonShort(est.fair) : "—"}</b></span>
              <span className={`pill ${est.roiEst != null ? "" : "off"}`}><i>추정 수익률</i>
                <b>{est.roiEst != null ? `${est.roiEst.toFixed(2)}%` : "—"}</b></span>
              <em className="hd-badge">추정</em>
            </span>
          )}
          {/* 실측 짝 — 매매가와 수익률은 한 덩어리다. 수익률의 분모가 매매가임이 자리로 드러나
              이름에 분모를 또 박지 않는다(사이드바는 묶음이 없어 「매매가 대비 수익률」로 쓴다). */}
          <span className="hd-grp real">
            <span className={`pill ${price ? "" : "off"}`}><i>매매가</i>
              <b>{price ? wonShort(price) : "—"}</b></span>
            <span className={`pill ${est.roiReal != null ? "" : "off"}`}><i>수익률</i>
              <b>{est.roiReal != null ? `${est.roiReal.toFixed(2)}%` : "—"}</b></span>
          </span>
          <span className="pill"><i>면적({unit === "py" ? "평" : "㎡"})</i><b>{areaVal()}</b></span>
          <span className="pill"><i>층수</i>
            <b>{`${Number(b.floors_below) > 0 ? `B${b.floors_below}F/` : ""}${b.floors_above != null ? `${b.floors_above}F` : ""}` || "—"}</b></span>
        </div>
      </div>
      {genState && <div className="panel" style={{ padding: "10px 16px", fontSize: 13 }}>{genState}</div>}
      {saveErr && <div className="panel" style={{ padding: "10px 16px", fontSize: 13, color: "var(--up)", display: "flex", alignItems: "center" }}>{saveErr}<button className="btn" style={{ marginLeft: "auto", padding: "2px 10px" }} onClick={() => setSaveErr(null)}>닫기</button></div>}

      <div className="bt-cols">
        <div style={{ display: "grid", gap: 14 }}>
          {/* 지도는 우측으로 갔다(2026-08-26) — 본문 폭(1,400px)을 쓰니 3.5:1로 옆으로 늘어나
              강남구 절반이 들어왔다. 우측 칸(400px)에 두면 거의 정사각이 되고,
              사이드바가 sticky 라 **어느 탭을 보든 위치가 옆에 있다.**
              덤으로 탭이 첫 화면에 바로 온다 — 지도를 지나 스크롤할 필요가 없다. */}

          {/* 탭 넷 — 건물·토지 · 임대 · 실거래 · 입지 */}
          <div className="bt-tabs" style={{ "--tab-n": SCOPES.length, "--tab-i": SCOPES.findIndex(([s]) => s === scope) } as React.CSSProperties}>
            {SCOPES.map(([s, label]) => (
              <button key={s} className={scope === s ? "on" : ""} onClick={() => setScope(s)}>{label}</button>
            ))}
            <span className="bt-tabs-ink" aria-hidden />
          </div>

          {/* 입지 — 유동인구·상권·교통. 같은 물음의 다른 면이라 한 탭이다 */}
          {show("loc") && <LocationPanel pk={pk} b={b} />}

          {/* 임대 — 실측(팀 입력)과 추정을 한 자리에. 「우리 2,391만 / 주변 2,508만」은
              두 값이 나란히 서야 읽히는 문장이라 탭을 가르면 아무도 견주지 않는다 */}
          {show("rent") && (
            <RentPanel pk={pk} unit={unit} items={rents.data?.items ?? []} total={total}
              refresh={() => { qc.invalidateQueries({ queryKey: ["rents", pk] }); qc.invalidateQueries({ queryKey: ["nearby"] }); }} />
          )}

          {/* 금액정보·투자분석 판은 걷어냈다(2026-08-25).
              매매가·수익률·평단가는 거래의 값이라 우측 사이드바가 주인이고,
              총계 넷(보증금·임대료·관리비·공실)은 층별 임대의 합계라 그 표로 갔다.
              투자 분석(자기자본·금리 시뮬)은 가정값이라 분석 탭 맨 아래로 갔다. */}

          {/* 건물정보 — 대장값만. 상세정보 판(명도·용도변경·멸실·노후도·건물용도·입지·등급)은
              여기서 없앴다: 저장소가 app.listings(patchBiz)인데 이 판은 app.overlays 에 쓰고 있어서
              업무 탭과 서로 다른 값을 보고 있었다(0011에서 오버레이 쪽은 이미 비웠다).
              한 저장소만 남기고 창구는 우측 사이드바 소유자 탭 하나로 모았다(2026-08-25).

              선 열네 개를 걷고 통합 매물 모달과 같은 줄로 갈았다(shared/ui/row.css).
              건폐율·용적률은 늘 붙어 다녀 한 줄로 합쳤다 — 열넷이 열셋이 된다. */}
          {/* 건물·토지 — 카드가 넷이라 목차를 세운다. 무엇이 있는지 보면서 건너뛴다 */}
          {show("bldg") && (
            <div className="rv rv-wrap">
              <Toc items={[
                { id: "bt-bldg", label: "건물정보" },
                { id: "bt-land", label: "토지정보" },
                { id: "bt-reg", label: "규제 · 특례" },
                { id: "bt-gongsi", label: "공시지가" },
                { id: "bt-scene", label: "입체 지적도" },
              ]} />
              <div className="rv-body">
                <div className="bg-card" id="bt-bldg">
              {/* 고칠 수 있는 것은 **현장에서 달라지는 값**뿐이다(2026-08-28).
                  면적·층수·주차·엘리베이터·건폐율·용적률은 증축·주차장 개조로 대장과 어긋난다.
                  사용승인일·주용도·구조는 대장이 정본이라 잠근다.
                  ★ 무엇이 열리는지 글로 적지 않는다 — 커서와 hover 가 그 자리에서 말한다. */}
              <div className="bg-ttl">건물정보</div>
              <div className="bg-cols">
                <TextRow label="대지면적" value={area(b.land_area)} cur={areaSeed(b.land_area)} parse={areaParse}
                  validate={vPos} {...ovState("land_area", area(bMaster.land_area as number))} />
                <TextRow label="연면적" value={area(b.total_area)} cur={areaSeed(b.total_area)} parse={areaParse}
                  validate={vPos} {...ovState("total_area", area(bMaster.total_area as number))} />
                <TextRow label="건축면적" value={area(b.build_area)} cur={areaSeed(b.build_area)} parse={areaParse}
                  validate={vPos} {...ovState("build_area", area(bMaster.build_area as number))} />
                <FloorsRow2 above={b.floors_above} below={b.floors_below} onSave={onSave} />
                <TextRow label="용적산정 연면적" value={area(b.far_area)} cur={areaSeed(b.far_area)} parse={areaParse}
                  validate={vPos} {...ovState("far_area", area(bMaster.far_area as number))} />
                {/* 한 줄에 붙여 두고 용적률만 열었더니 건폐율을 못 고쳤다(2026-09-05 지적). 줄 하나에 값 하나. */}
                <TextRow label="건폐율" value={b.bcr ?? ""} unit="%" cur={b.bcr} validate={vNonNeg}
                  ref_={b.bcr == null && ref.bcr_calc != null ? `계산 ${Math.round(ref.bcr_calc)}%` : null}
                  {...ovState("bcr", bMaster.bcr != null ? `${bMaster.bcr}%` : null)} />
                <TextRow label="용적률" value={b.far ?? ""} unit="%" cur={b.far} validate={vNonNeg}
                  ref_={b.far == null && ref.far_calc != null ? `계산 ${Math.round(ref.far_calc)}%` : null}
                  {...ovState("far", bMaster.far != null ? `${bMaster.far}%` : null)} />
                <TextRow lock label="사용승인일" value={ymdDisp(b.approval_ymd)} />
                <TextRow lock label="대수선 및 리모델링" value={ymdDisp(b.remodel_ymd)} />
                <EnumRow lock label="주용도" enumKey="main_use" value={b.main_use as string} onSave={() => {}} />
                <TextRow lock label="기타용도" value={String(b.etc_use ?? "")} />
                <TextRow lock label="구조" value={String(b.structure ?? "")} />
                <TextRow label="주차" value={b.parking ?? ""} unit="대" cur={b.parking} validate={vInt}
                  {...ovState("parking", bMaster.parking != null ? `${bMaster.parking}대` : null)} />
                <TextRow label="엘리베이터" value={b.elevator ?? ""} unit="대" cur={b.elevator} validate={vInt}
                  ref_={b.elevator == null && ref.elevator_ext != null ? `승강기공단 ${ref.elevator_ext}대` : null}
                  {...ovState("elevator", bMaster.elevator != null ? `${bMaster.elevator}대` : null)} />
              </div>
                </div>

          {/* 층별 임대는 임대 탭으로 갔다(2026-08-26) — 길어서 건물 탭을 반으로 갈랐다 */}

          {/* 토지정보 · 규제 · 공시지가 = 필지 셀렉터(§3.6 · 다필지·규제 2레벨) — 풀폭 */}
          <div id="bt-land"><ParcelBlock pk={pk} useZoneMix={b.use_zone_mix} unit={unit}
            bcr={b.bcr != null ? Number(b.bcr) : null} far={b.far != null ? Number(b.far) : null} /></div>

          {/* 공시지가 = 건물·토지 탭(사실) */}
          <div id="bt-gongsi">
            <GongsiCard unit={unit} series={(b.gongsi_series as [number, number][]) ?? []}
              totalGongsi={b.total_gongsi != null ? Number(b.total_gongsi) : null}
              landArea={b.land_area != null ? Number(b.land_area) : null}
              sale={b.sale_price != null ? Number(b.sale_price) : null}
              est={b.sale_est != null ? Number(b.sale_est) : null}
              real={b.last_sale_price != null ? Number(b.last_sale_price) : null} />
          </div>

          {/* 입체 지적도 — 접도·대지 모양·현재 용적. 대장·지적의 사실이라 이 탭이 제자리다.
              브리핑에만 있어서(리포트를 만들어야 보였다) 아무도 못 보던 그림이다 */}
          <LandScene pk={pk} b={b} id="bt-scene" />
              </div>
            </div>
          )}

          {/* 실거래 — 주변 거래가 판이고 이 건물 거래는 그 안의 점이다(2026-08-26).
              서울 건물의 85.7%는 이 건물 거래가 아예 없어서, 예전처럼 「실거래가」 카드를
              먼저 세우면 대개 「데이터가 없습니다」만 떴다. TradePanel 참조 */}
          {show("trade") && typeof b.lng === "number" && typeof b.lat === "number" && (
            <TradePanel pk={pk} lng={b.lng} lat={b.lat} area={marketArea}
              comp={compFilter} onComp={saveComp} onComps={setComps}
              mine={series.data?.real ?? []}
              totalArea={b.total_area != null ? Number(b.total_area) : null}
              saleEst={b.sale_est != null ? Number(b.sale_est) : null} />
          )}

          {/* 교통 판은 입지 탭으로 갔다(2026-08-26) — 역·정류소는 「이 땅의 등기 사항」이 아니라
              입지라, 유동인구 지도와 같은 구획에 서는 게 맞다. 거기서는 목록이 아니라
              거리 자 위 막대로 그린다(ReportView.Transit). */}
        </div>

        {/* 우측 — 지도가 위, 그 아래 거래 사이드바. 둘 다 따라 붙는다(sticky) */}
        <div className="bt-side">
          {typeof b.lng === "number" && typeof b.lat === "number" && (
            <PhotoPanel lng={b.lng} lat={b.lat} pk={pk} area={marketArea} onArea={saveArea} comps={comps} />
          )}
          <Sidebar pk={pk} />
        </div>
      </div>

      {/* 하단 툴바(§5) */}
      {/* 하단 바(2026-08-27 알약으로) — 주인공은 「매물 분석하기」 하나라 그것만 검정.
          브리핑은 회색 알약, 되돌리기는 유령 글자, 단위는 슬라이딩 토글(Segmented). */}
      <div className="panel bt-foot" style={{ position: "sticky", bottom: 0, display: "flex", gap: 8, alignItems: "center", padding: "7px 14px", zIndex: 20 }}>
        {/* 크레딧 수는 뗐다(2026-08-28) — 값은 창 안에서 보유·차감·잔여로 말한다.
            버튼 이름 옆 괄호 숫자는 「무슨 점수지」로 읽혔다. */}
        <button className="fp dark" onClick={() => { setReportOpen(true); setGenState(null); }}>매물 분석하기</button>
        <button className="fp" disabled={briefing.isPending}
          onClick={() => { setBriefOpen(true); setGenState(null); }}>브리핑 자료</button>
        <button className="lnk dim2" style={{ marginLeft: 6, fontSize: 12.5 }} onClick={async () => {
          if (confirm("팀 오버레이 전체를 마스터 원본으로 되돌립니다. 계속할까요?")) {
            const r = await overlaysApi.revertAll(pk);
            alert(`${r.reverted}개 수정값을 되돌렸습니다`);
            qc.invalidateQueries({ queryKey: ["building", pk] });
          }
        }}>↺ 전체 되돌리기</button>
        <span style={{ flex: 1 }} />
        <Segmented size="sm" value={unit} onChange={setUnit}
          options={[{ value: "py", label: "평" }, { value: "m2", label: "㎡" }]} />
      </div>

      {/* 매물 분석 검토(S02b) — comp curation + 실시간 미리보기 */}
      {reportOpen && (
        <ReportModal pk={pk} credits={credits.data?.total}
          onClose={() => setReportOpen(false)}
          onDone={(m) => { setReportOpen(false); setGenState(m); qc.invalidateQueries({ queryKey: ["credits"] }); }} />
      )}

      {/* 브리핑 생성 — 중개인 코멘트를 받아 스냅샷에 함께 굳힌다 */}
      {briefOpen && (
        <BriefingModal pk={pk} current={String(b.briefing_comment ?? "")} busy={briefing.isPending}
          onClose={() => setBriefOpen(false)}
          onSubmit={(c, buyerIds) => { setBriefOpen(false); briefing.mutate({ comment: c, buyerIds }); }} />
      )}

    </div>
  );
}

/** 취득 부대비용 기본률(%) — 중개보수 0.9 + 취득세등 4.6 + 법무사 0.2.
 *  상업용 일반 거래 기준이고 개별 협의로 달라지니 화면에서 고칠 수 있게 둔다. */

/* 투자분석: 자기자본·대출금리 → 레버리지(대출액·LTV·이자·자기자본수익률).
   총투자비 = 매매가 + 취득 부대비용. 실제로 손에서 나가는 돈은 매매가가 아니라 이쪽이라
   대출액도 여기서 자기자본을 뺀다(매매가만 보면 부대비용만큼 대출을 과소평가한다). */
/* 영업에서 쌓인 답을 금액 옆에 둔다 — "왜 안 나갔나"는 제안을 돌리면 저절로 생기는데
   지금까지 영업 탭 안에만 있었다. 가격을 볼 때 같이 보여야 호가 조정 판단이 된다.
   제안이 하나도 안 나간 매물에는 아무것도 안 그린다(빈 줄은 소음이다). */


/* 층별임대 표 — 저장버튼 없음(자동저장) · 하단 빈 행에 입력=추가 · 행 호버 ×=삭제 */