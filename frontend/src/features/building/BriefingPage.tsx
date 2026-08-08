import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { reportsApi, PHOTO_KINDS, type Photo, type PhotoKind } from "../../shared/api/endpoints";
import { useAuth } from "../../shared/store/auth";
import { fitStyle } from "../../shared/ui/PhotoFit";
import { ReportMap } from "./ReportMap";
// three.js는 이 슬라이드에서만 쓴다 — 첫 화면 번들에 얹지 않는다
const ParcelScene3D = lazy(() => import("./ParcelScene3D").then((m) => ({ default: m.ParcelScene3D })));
import { Loading } from "../../shared/ui/Spinner";
import { Icon as ActionIcon } from "../../shared/ui/Icon";
import "./reportslide.css";
import "./briefing.css";

/** 브리핑 자료 — 그 건물에 대한 '사실'만 담는 기초자료.
 *  빌탐정 리포트가 우리 판단(적정가·매력도·미래가치)을 서술하는 것과 반대다.
 *  구성은 원본(specs/03-features/브리핑자료.pptx) 7장을 따른다:
 *    표지 · 매물 기본정보 · 서류 · 지적도·위치도 · 층별 임대정보 · 건물 사진 · 마무리 */

const P = 3.305785;
const py = (m2: unknown) => (m2 ? `${(Number(m2) / P).toFixed(2)}평` : "—");
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const man = (won: unknown) => { const w = num(won); return w ? `${Math.round(w / 1e4).toLocaleString()}만원` : "—"; };
/** 원 단위 그대로 — 공시지가처럼 대장 원문을 옮기는 값(원본 표기: 15,450,000원) */
const wonFull = (v: unknown) => { const w = num(v); return w ? `${Math.round(w).toLocaleString()}원` : "—"; };
/** 억 단위 — 매매가(원본 표기: 140 억) */
const eok = (v: unknown) => { const w = num(v); return w ? `${(w / 1e8).toFixed(w % 1e8 === 0 ? 0 : 1)}억` : "—"; };
/** 규모 — 원본 표기: B1 ~ 6F */
const scale = (below: unknown, above: unknown) => {
  const b = num(below), a = num(above);
  if (!a && !b) return "—";
  return `${b ? `B${b}` : "1F"} ~ ${a ? `${a}F` : "1F"}`;
};
/** 준공년도 — 원본 표기: 2004/01/15 */
const ymdSlash = (v: unknown) => (v ? String(v).slice(0, 10).replace(/-/g, "/") : "—");

type Snap = {
  parcel: { type: string; coordinates: any } | null;
  roads: { rn: string; road_bt: number; geojson: { type: string; coordinates: any } }[];
  subject: Record<string, unknown>;
  office: Record<string, unknown>;
  floors: { floor: string; unit_no: string | null; use: string | null; exclusive_area: number | null;
            contract_area: number | null; deposit: number | null; rent: number | null;
            maintenance: number | null; is_vacant: boolean | null; est: boolean }[];
  photos: Photo[];
};

/** 인증이 필요한 이미지를 blob으로 — 브리핑은 팀 자료라 공개 URL이 없다. */
function useAuthedImages(pk: string, photos: Photo[]) {
  const access = useAuth((s) => s.access);
  const [urls, setUrls] = useState<Record<number, string>>({});
  useEffect(() => {
    let dead = false;
    photos.forEach((p) => {
      if (urls[p.id]) return;
      fetch(`/api/buildings/${pk}/photos/${p.id}`, { headers: { Authorization: `Bearer ${access}` } })
        .then((r) => (r.ok ? r.blob() : Promise.reject()))
        .then((b) => { if (!dead) setUrls((u) => ({ ...u, [p.id]: URL.createObjectURL(b) })); })
        .catch(() => {});
    });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos]);
  return urls;
}

const Frame = ({ n, title, office, rno, date, children }: {
  n: string; title: string; office: Record<string, unknown>; rno: string; date: string; children: React.ReactNode;
}) => (
  <div className="rs-slide bf-slide">
    <div className="rs-head">
      <span className="rs-logo">빌탐정<em>BILLTAMJUNG</em></span>
      <span className="rs-tag">{String(office.office_name ?? "") || "브리핑 자료"}</span>
      <span className="rs-rno">Report No. <b>{rno}</b> · {date}</span>
    </div>
    <div className="rs-sec">
      <span className="rs-badge">{n}</span>
      <div><div className="rs-title">{title}</div></div>
    </div>
    <div className="rs-body">{children}</div>
    <div className="rs-foot">
      <em>{n}  {title}</em>
      <span className="c">본 자료는 제3자에게 무단복제·유포·변경하지 않는 것에 동의하는 전제로 제공합니다.</span>
      <span className="rs-logo" style={{ fontSize: "1.1cqw", color: "#fff" }}>빌탐정</span>
    </div>
  </div>
);

export function BriefingPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const rid = Number(id);
  const rq = useQuery({ queryKey: ["report", rid], queryFn: () => reportsApi.get(rid), enabled: !!rid });
  const snap = (rq.data?.result_json ?? null) as Snap | null;
  const pk = rq.data?.building_pk ?? "";
  const photos = snap?.photos ?? [];
  const urls = useAuthedImages(pk, photos);

  const [cur, setCur] = useState(0);
  const stage = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") setCur((c) => Math.min(c + 1, 6));
      if (e.key === "ArrowLeft") setCur((c) => Math.max(c - 1, 0));
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, []);

  if (rq.isLoading) return <Loading label="브리핑 불러오는 중" minHeight="60vh" />;
  if (!snap) return <div style={{ padding: 40, color: "var(--up)" }}>브리핑을 불러오지 못했습니다.</div>;

  const s = snap.subject, o = snap.office;
  const addr = String(s.addr ?? "");
  const shortAddr = addr.replace(/^서울특별시\s*/, "").replace(/\s*번지$/, "");
  const rno = `BT-${new Date(rq.data?.created_at ?? Date.now()).getFullYear()}-${String(rid).padStart(6, "0")}`;
  const date = new Date(rq.data?.created_at ?? Date.now()).toLocaleDateString("ko-KR").replace(/\.$/, "");
  // 담당자명은 브리핑에 넣지 않는다(상호·연락처만).

  const byKind = (k: PhotoKind) => photos.filter((p) => p.kind === k);
  // whole=true — 서류는 잘리면 안 된다. 사진처럼 슬롯을 채우는 대신 한 장을 통째로 보인다.
  const img = (p?: Photo, whole = false) => (p && urls[p.id]
    ? <img src={urls[p.id]} alt=""
        style={whole ? { width: "100%", height: "100%", objectFit: "contain" } : fitStyle(p.transform)} />
    : <div className="bf-empty">{p ? "불러오는 중…" : "등록된 자료가 없습니다"}</div>);

  const docSlot = (k: PhotoKind) => (
    <div className="bf-doc">
      <div className="bf-doc-t">{PHOTO_KINDS.find((x) => x.k === k)?.label}</div>
      <div className="bf-doc-img">{img(byKind(k)[0], true)}</div>
    </div>
  );

  // ── 01 매물 기본정보 — 담는 값은 원본 표 그대로(소재지·토지·건물·금융).
  // 표현은 우리 언어로: 핵심 3지표를 먼저 세우고 나머지는 묶음별 스펙시트로 읽힌다.
  // 하이브리드 — 팀 수기 매매가 우선, 없으면 적정가. 값은 쓰되 '(빌탐정 적정가)' 같은
  // 우리 내부 표기는 고객에게 주는 자료에 넣지 않는다.
  const price = num(s.sale_price) ?? num(s.sale_est);
  const perLand = price && num(s.land_area) ? price / (Number(s.land_area) / P) : null;
  const perTotal = price && num(s.total_area) ? price / (Number(s.total_area) / P) : null;
  const gongsiSum = num(s.gongsi_latest) && num(s.land_area)
    ? Number(s.gongsi_latest) * Number(s.land_area) : null;
  const totDepPre = snap.floors.reduce((a, f) => a + (f.deposit ?? 0), 0);
  const totRentPre = snap.floors.reduce((a, f) => a + (f.rent ?? 0), 0);

  // 중개인 코멘트 — 사실 나열만으로는 전달되지 않는 것(입지·활용·기대감)을 담당자가 직접 적는다.
  // 저장은 건물 오버레이라 팀이 공유한다. 줄바꿈으로 항목을 나눈다.
  const comment = String(s.briefing_comment ?? "").split("\n").map((x) => x.trim()).filter(Boolean);

  const roi = price && totRentPre ? (totRentPre * 12) / price * 100 : null;
  const roadTxt = [
    s.road_front_m ? `전면 ${s.road_front_m}m` : null,
    s.road_side_m ? `측면 ${s.road_side_m}m` : null,
    s.road_rear_m ? `후면 ${s.road_rear_m}m` : null,
  ].filter(Boolean).join(" / ") || String(s.road_frontage ?? "—");

  const groups: { g: string; rows: [string, string, boolean?][] }[] = [
    { g: "토지정보", rows: [
      ["대지면적", `${s.land_area ?? "—"}m² · ${py(s.land_area)}`],
      ["도로상황", roadTxt],
      ["용도지역", String(s.use_zone ?? "—")],
      ["지목 / 형상", `${s.jimok ?? "—"} / ${s.shape ?? "—"}`],
      ["공시지가(m²)", wonFull(s.gongsi_latest)],
      ["공시지가 합계", wonFull(gongsiSum)],
    ] },
    { g: "건물정보", rows: [
      ["연면적", `${s.total_area ?? "—"}m² · ${py(s.total_area)}`],
      ["건축면적", `${s.build_area ?? "—"}m² · ${py(s.build_area)}`],
      ["건폐율 / 용적률", `${s.bcr ?? "—"}% / ${s.far ?? "—"}%`],
      ["규모 / 주차대수", `${scale(s.floors_below, s.floors_above)} · ${s.parking ?? "—"}대`],
      ["준공년도 / 승강기", `${ymdSlash(s.approval_ymd)} · ${s.elevator ?? "—"}대`],
      ["구조 / 주용도", `${s.structure ?? "—"} / ${s.main_use_name ?? "—"}`],
    ] },
    { g: "금융정보", rows: [
      ["매매가", eok(price), true],
      ["수익률", roi != null ? `${roi.toFixed(2)}%` : "—"],
      ["평단가", man(perLand)],
      ["평단가(연면적당)", man(perTotal)],
      ["보증금 / 임대료", `${man(totDepPre)} / ${man(totRentPre)}`],
    ] },
  ];

  const totMgmt = snap.floors.reduce((a, f) => a + (f.maintenance ?? 0), 0);
  const totDep = totDepPre, totRent = totRentPre;

  const slides = [
    // 표지
    <div className="rs-slide bf-cover" key="cover">
      <div className="bf-cover-in">
        <div className="bf-office">{String(o.office_name ?? o.name ?? "")}</div>
        <div className="bf-cover-addr">{shortAddr}</div>
        <div className="bf-cover-sub">{String(s.use_zone ?? "")} · {String(s.main_use_name ?? "")}</div>
        <div className="bf-cover-meta">
          {o.phone ? <div>연락처 : {String(o.phone)}</div> : null}
          {o.fax ? <div>팩스 : {String(o.fax)}</div> : null}
          {o.email ? <div>이메일 : {String(o.email)}</div> : null}
          {o.office_addr ? <div>주소 : {String(o.office_addr)}</div> : null}
        </div>
        <div className="bf-cover-rno">Report No. {rno} · {date}</div>
      </div>
    </div>,

    <Frame key="1" n="01" title="건물 개요" office={o} rno={rno} date={date}>
      <div className="bf-basic">
        <div className="bf-basic-photo">{img(byKind("exterior")[0])}</div>
        <div className="bf-basic-main">
          <div className="bf-addr">{addr}</div>
          <div className="bf-chips">
            <span>{String(s.use_zone ?? "—")}</span>
            <span>{String(s.main_use_name ?? "—")}</span>
            {s.road_addr ? <span className="q">{String(s.road_addr)}</span> : null}
          </div>

          <div className="bf-spec">
            {groups.map(({ g, rows: rs }) => (
              <section key={g}>
                <h4>{g}</h4>
                {rs.map(([k, v, strong]) => (
                  <div className={"r" + (strong ? " lead" : "")} key={k}>
                    <span className="k">{k}</span><span className="v">{v}</span>
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>
      {comment.length > 0 && (
        <div className="bf-comment">
          {comment.map((line, i) => <div key={i}>◆ {line}</div>)}
        </div>
      )}
      <div className="bf-note">※ 토지이용계획확인원 및 건축물대장 기준</div>
    </Frame>,

    <Frame key="2" n="02" title="위치도" office={o} rno={rno} date={date}>
      <div className="bf-loc">
        {/* 좌 — 실제 지도 위 필지. 업로드 없이 자동으로 그린다(지적도 레이어는 지도 API 제공) */}
        <figure>
          <ReportMap lng={num(s.lng)} lat={num(s.lat)} geom={snap.parcel} h="100%" />
        </figure>
        {/* 우 — 입체 지적도. 대지 위에 현재 용적을 세우고 법정까지의 여유를 비워 보여준다 */}
        <figure>
          <div className="bf-scene">
            <Suspense fallback={<div className="ps-empty">입체 지적도 불러오는 중…</div>}>
              <ParcelScene3D data={{
                parcel: snap.parcel, roads: snap.roads,
                landArea: num(s.land_area), totalArea: num(s.total_area),
                bcr: num(s.bcr), far: num(s.far), legalFar: num(s.legal_far),
                useZone: String(s.use_zone ?? "") || null,
                frontRn: String(s.road_front_rn ?? "") || null,
                floorsAbove: num(s.floors_above), height: num(s.height),
              }} />
            </Suspense>
          </div>
        </figure>
      </div>
    </Frame>,

    <Frame key="3" n="03" title="건축물정보 · 토지이용계획" office={o} rno={rno} date={date}>
      <div className="bf-docs">{docSlot("land_use")}{docSlot("building_ledger")}</div>
    </Frame>,

    <Frame key="4" n="04" title="층별 임대정보" office={o} rno={rno} date={date}>
      <table className="bf-table rent">
        <thead><tr>
          <th>층(호)</th><th>형태</th><th className="n">평수</th>
          <th className="n">보증금</th><th className="n">월임대료</th><th className="n">월관리비</th>
        </tr></thead>
        <tbody>
          {snap.floors.map((f, i) => (
            <tr key={i}>
              <td>{f.floor}{f.unit_no ? ` ${f.unit_no}` : ""}
                {f.is_vacant === true && <span className="bf-vac">공실</span>}</td>
              <td>{f.use ?? "—"}</td>
              <td className="n">{py(f.contract_area ?? f.exclusive_area)}</td>
              <td className="n">{man(f.deposit)}</td>
              <td className="n">{man(f.rent)}</td>
              <td className="n">{man(f.maintenance)}</td>
            </tr>
          ))}
          <tr className="sum">
            <td colSpan={3}>합 계</td>
            <td className="n">{man(totDep)}</td><td className="n">{man(totRent)}</td><td className="n">{man(totMgmt)}</td>
          </tr>
        </tbody>
      </table>
      <div className="bf-note">
        ※ 임대 내역은 임대인의 진술에 의해 작성되었으므로 사실과 차이가 발생할 수 있음 · 월임대료 부가세 별도
      </div>
    </Frame>,

    <Frame key="5" n="05" title="건물 사진" office={o} rno={rno} date={date}>
      <div className="bf-photos" data-n={[...byKind("exterior").slice(1), ...byKind("interior")].slice(0, 4).length}>
        {[...byKind("exterior").slice(1), ...byKind("interior")].slice(0, 4).map((p) => (
          <figure key={p.id}><div className="bf-ph">{img(p)}</div>{p.caption && <figcaption>{p.caption}</figcaption>}</figure>
        ))}
        {[...byKind("exterior").slice(1), ...byKind("interior")].length === 0 && (
          <div className="bf-empty" style={{ gridColumn: "1/-1" }}>등록된 사진이 없습니다</div>
        )}
      </div>
    </Frame>,

    <div className="rs-slide bf-cover end" key="end">
      <div className="bf-cover-in">
        <div className="bf-end-1">성공적인 투자</div>
        <div className="bf-end-2">{String(o.office_name ?? o.name ?? "빌탐정")}가 함께하겠습니다</div>
        <div className="bf-cover-meta">
          {o.phone ? <div>{String(o.phone)}</div> : null}
          {o.email ? <div>{String(o.email)}</div> : null}
        </div>
      </div>
    </div>,
  ];

  return (
    <div className="rslide-root deck">
      <div className="deck-top">
        <button className="btn" onClick={() => nav(`/buildings/${pk}`)} style={{ padding: "6px 12px" }}>
          <ActionIcon name="back" size={15} />매물로</button>
        <span className="ttl">브리핑 자료 · {rno}</span>
        <button className="btn" style={{ marginLeft: "auto", padding: "6px 12px" }}
          onClick={() => stage.current?.requestFullscreen?.().catch(() => {})}>
          <ActionIcon name="fullscreen" size={14} />전체화면</button>
      </div>
      <div className="deck-main">
        <aside className="deck-nav">
          {slides.map((_, i) => (
            <button key={i} className={"deck-thumb bf-thumb" + (cur === i ? " on" : "")} onClick={() => setCur(i)}>
              <span className="tnum">{String(i + 1).padStart(2, "0")}</span>
              <span className="bf-thumb-t">{["표지", "건물 개요", "위치도", "건축물정보·토지이용계획", "층별 임대정보", "건물 사진", "마무리"][i]}</span>
            </button>
          ))}
        </aside>
        <div className="deck-stage" ref={stage}>
          <div className="stage-slide rs-enter" key={cur}>{slides[cur]}</div>
          <div className="deck-counter">{cur + 1} / {slides.length}</div>
        </div>
      </div>
    </div>
  );
}
