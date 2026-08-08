import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { reportsApi, PHOTO_KINDS, type Photo, type PhotoKind } from "../../shared/api/endpoints";
import { useAuth } from "../../shared/store/auth";
import { fitStyle } from "../../shared/ui/PhotoFit";
import { ReportMap } from "./ReportMap";
import { Logo, Seal, BuildingArt } from "./ReportAssets";
// three.js는 이 슬라이드에서만 쓴다 — 첫 화면 번들에 얹지 않는다
const ParcelScene3D = lazy(() => import("./ParcelScene3D").then((m) => ({ default: m.ParcelScene3D })));
import { Loading } from "../../shared/ui/Spinner";
import { Icon as ActionIcon } from "../../shared/ui/Icon";
import "./reportslide.css";
import "./briefing.css";

/** 브리핑 자료 — 그 건물에 대한 '사실'만 담는 기초자료.
 *  빌탐정 리포트가 우리 판단(적정가·매력도·미래가치)을 서술하는 것과 반대다.
 *  구성(7장): 표지 · 건물 개요 · 위치도(지도·지적도) · 입체 지적도 ·
 *  건축물정보·토지이용계획 · 층별 임대정보 · 건물 사진.
 *  원본 pptx의 '마무리'(성공적인 투자…)는 사실이 아니라 인사말이라 뺐다. */

/** [값, 단위] → {n, u}. 지표 카드가 단위를 작게 붙여 쓰기 위해 나눠 받는다. */
const z = ([n, u]: [string, string]) => ({ n, u });

const P = 3.305785;
const py = (m2: unknown) => (m2 ? `${(Number(m2) / P).toFixed(2)}평` : "—");
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const man = (won: unknown) => { const w = num(won); return w ? `${Math.round(w / 1e4).toLocaleString()}만원` : "—"; };
/** 원 단위 그대로 — 공시지가처럼 대장 원문을 옮기는 값(원본 표기: 15,450,000원) */
const wonFull = (v: unknown) => { const w = num(v); return w ? `${Math.round(w).toLocaleString()}원` : "—"; };
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

const Frame = ({ n, title, desc, office, rno, date, children }: {
  n: string; title: string; desc?: string; office: Record<string, unknown>;
  rno: string; date: string; children: React.ReactNode;
}) => (
  <div className="rs-slide bf-slide">
    <div className="rs-head">
      <span className="rs-logo">빌탐정<em>BILLTAMJUNG</em></span>
      <span className="rs-tag">{String(office.office_name ?? "") || "브리핑 자료"}</span>
      <span className="rs-rno">Report No. <b>{rno}</b> · {date}</span>
    </div>
    <div className="rs-sec">
      <span className="rs-badge">{n}</span>
      <div>
        <div className="rs-title">{title}</div>
        {desc ? <div className="rs-desc">{desc}</div> : null}
      </div>
    </div>
    <div className="rs-body">{children}</div>
    <div className="rs-foot">
      <em>{n}  {title}</em>
      <span className="c">본 자료는 제3자에게 무단복제·유포·변경하지 않는 것에 동의하는 전제로 제공합니다.</span>
      <span className="rs-logo" style={{ fontSize: "1.1cqw", color: "#fff" }}>빌탐정</span>
    </div>
  </div>
);

const THUMBS = ["표지", "건물 개요", "위치도", "입체 지적도",
  "건축물정보·토지이용계획", "층별 임대정보", "건물 사진"];

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
  // 지도판·지적도판이 같은 배율을 쓴다 — 배율이 다르면 나란히 놓아도 비교가 안 된다
  const [mapZoom, setMapZoom] = useState(17);
  // 전체화면은 덱 루트에 건다 — 발표 모드 CSS가 .rslide-root:fullscreen에 걸려 있어서
  // stage에 걸면 툴바·사이드바가 그대로 남아 전체화면이 아무 의미가 없다(빌탐정 리포트와 동일).
  const root = useRef<HTMLDivElement>(null);
  const toggleFs = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else root.current?.requestFullscreen?.().catch(() => {});
  };
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") setCur((c) => Math.min(c + 1, THUMBS.length - 1));
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

  const cnt = (v: unknown, u: string) => (num(v) ? `${num(v)}${u}` : "—");
  // 스펙시트는 토지 / 건물 / 임대 세 묶음. 금액은 위 헤로로 올려서 되풀이하지 않는다.
  const groups: { g: string; rows: [string, string][] }[] = [
    { g: "토지", rows: [
      ["대지면적", `${s.land_area ?? "—"}m² · ${py(s.land_area)}`],
      ["용도지역", String(s.use_zone ?? "—")],
      ["도로상황", roadTxt],
      ["지목 / 형상", `${s.jimok ?? "—"} / ${s.shape ?? "—"}`],
      ["공시지가(m²)", wonFull(s.gongsi_latest)],
      ["공시지가 합계", wonFull(gongsiSum)],
      ["평단가", man(perLand)],
    ] },
    { g: "건물", rows: [
      ["연면적", `${s.total_area ?? "—"}m² · ${py(s.total_area)}`],
      ["건축면적", `${s.build_area ?? "—"}m² · ${py(s.build_area)}`],
      ["건폐율 / 용적률", `${s.bcr ?? "—"}% / ${s.far ?? "—"}%`],
      ["규모 / 높이", `${scale(s.floors_below, s.floors_above)}${num(s.height) ? ` · ${num(s.height)}m` : ""}`],
      ["주차 / 승강기", `${cnt(s.parking, "대")} / ${cnt(s.elevator, "대")}`],
      ["준공", ymdSlash(s.approval_ymd)],
      ["구조", String(s.structure ?? "—")],
      ["주용도", String(s.main_use_name ?? "—")],
      ["평단가", man(perTotal)],
    ] },
  ];

  // 지표 카드 — 빌탐정 리포트의 .rs-sc 어법(라벨 작게, 값 크게, 단위는 작게 붙여서).
  // 금액을 라벨-값 한 줄로 늘어놓으면 글줄로 읽혀서 눈에 안 들어온다. 큰 숫자 네 개로 세운다.
  const split = (v: number | null, unit: string, digits = 0): [string, string] =>
    v == null ? ["—", ""] : [v.toLocaleString(undefined, { maximumFractionDigits: digits }), unit];
  const metrics: { k: string; n: string; u: string; lead?: boolean }[] = [
    { k: "매매가", ...z(split(price != null ? price / 1e8 : null, "억", 1)), lead: true },
    { k: "수익률", ...z(split(roi, "%", 2)) },
    { k: "보증금", ...z(split(totDepPre ? totDepPre / 1e4 : null, "만원")) },
    { k: "월임대료", ...z(split(totRentPre ? totRentPre / 1e4 : null, "만원")) },
  ];

  const totMgmt = snap.floors.reduce((a, f) => a + (f.maintenance ?? 0), 0);
  const totDep = totDepPre, totRent = totRentPre;

  const slides = [
    // 표지 — 빌탐정 리포트와 같은 틀(BuildingArt + 로고 + 직인). 자료가 두 종류로 보이면 안 된다.
    // 다른 점은 발행 주체 하나다: 리포트는 빌탐정, 브리핑은 중개사무소.
    <div className="rs-slide bf-cover3" key="cover">
      <div className="bf-cover3-art"><BuildingArt /></div>
      <div className="bf-cover3-veil" />
      <div className="bf-cover3-in">
        <div className="bf-cover3-top">
          <Logo mono size={2.6} />
          <span className="bf-cover3-rno">Report No. {rno} · {date}</span>
        </div>
        {/* 표지엔 주소만. 용도지역·주용도는 바로 다음 장(건물 개요)에 있다 */}
        <div className="bf-cover3-mid">
          <div className="bf-cover3-addr">{shortAddr}</div>
        </div>
        <div className="bf-cover3-foot">
          <Seal mono size={8.5} />
          <div className="bf-cover3-office">
            <b>{String(o.office_name ?? o.name ?? "")}</b>
            <span>
              {[o.phone && `연락처 ${o.phone}`, o.fax && `팩스 ${o.fax}`, o.email].filter(Boolean).join(" · ")}
            </span>
            {o.office_addr ? <span>{String(o.office_addr)}</span> : null}
          </div>
        </div>
      </div>
    </div>,

    <Frame key="1" n="01" title="건물 개요"
      desc={[addr, s.use_zone, s.main_use_name, s.road_addr].filter(Boolean).map(String).join(" · ")}
      office={o} rno={rno} date={date}>
      {/* 소재지는 섹션 부제로 올렸다 — 본문 높이를 사진에 준다.
          금액은 라벨-값 한 줄로 늘어놓으면 글줄로 읽혀 눈에 안 들어온다.
          빌탐정 리포트의 지표 카드 어법(.rs-sc)을 그대로 써서 큰 숫자 네 개로 세운다. */}
      <div className="bf-ov">
        <div className="bf-ov-photo">{img(byKind("exterior")[0])}</div>

        <div className="bf-mt">
          {metrics.map((m) => (
            <div className={`rs-sc${m.lead ? " lead" : ""}`} key={m.k}>
              <div className="k">{m.k}</div>
              <div className="v">{m.n}<u>{m.u}</u></div>
            </div>
          ))}
        </div>

        <div className="bf-kv2">
          {groups.map(({ g, rows: rs }) => (
            <table className="rs-tbl rs-kv" key={g}>
              <thead><tr><th colSpan={2}>{g}</th></tr></thead>
              <tbody>
                {rs.map(([k, v]) => <tr key={k}><td>{k}</td><td className="r b">{v}</td></tr>)}
              </tbody>
            </table>
          ))}
        </div>

        {comment.length > 0 && (
          <div className="bf-cmt">
            {comment.map((line, i) => <div className="rs-callout" key={i}>{line}</div>)}
          </div>
        )}
        <div className="bf-note">※ 토지이용계획 및 건축물대장 기준</div>
      </div>
    </Frame>,

    // 위치도 = 지도판 + 지적도판. 둘 다 지도 API가 그려주므로 업로드가 없다.
    // 확대·이동을 열어 둔다 — 손님과 같이 들여다보는 장면이라 고정 화면이면 답답하다.
    <Frame key="2" n="02" title="위치도" office={o} rno={rno} date={date}>
      <div className="bf-loc">
        {/* 지도를 감싸는 칸 — h="100%"를 그대로 figure의 첫 자식으로 두면
            지도가 칸 전체를 먹고 캡션이 밖으로 밀려 잘린다. */}
        <figure>
          <div className="bf-mapbox"><ReportMap lng={num(s.lng)} lat={num(s.lat)} geom={snap.parcel} h="100%"
            zoom={mapZoom} onZoom={setMapZoom} /></div>
          <figcaption>지도</figcaption>
        </figure>
        <figure>
          <div className="bf-mapbox"><ReportMap lng={num(s.lng)} lat={num(s.lat)} geom={snap.parcel} h="100%" cadastral
            zoom={mapZoom} onZoom={setMapZoom} /></div>
          <figcaption>지적도</figcaption>
        </figure>
      </div>
    </Frame>,

    // 입체 지적도 — 한 장을 통째로 쓴다. 좁게 넣으면 치수가 서로 밀려 읽히지 않는다.
    <Frame key="3" n="03" title="입체 지적도" office={o} rno={rno} date={date}>
      <div className="bf-scene wide">
        <Suspense fallback={<div className="ps-empty">입체 지적도 불러오는 중…</div>}>
          <ParcelScene3D data={{
            parcel: snap.parcel, roads: snap.roads,
            landArea: num(s.land_area), totalArea: num(s.total_area),
            bcr: num(s.bcr), far: num(s.far),
            legalFar: num(s.legal_far), legalBcr: num(s.legal_bcr),
            useZone: String(s.use_zone ?? "") || null,
            frontRn: String(s.road_front_rn ?? "") || null,
            floorsAbove: num(s.floors_above), height: num(s.height),
          }} />
        </Suspense>
      </div>
    </Frame>,

    <Frame key="4" n="04" title="건축물정보 · 토지이용계획" office={o} rno={rno} date={date}>
      <div className="bf-docs">{docSlot("land_use")}{docSlot("building_ledger")}</div>
    </Frame>,

    <Frame key="5" n="05" title="층별 임대정보" office={o} rno={rno} date={date}>
      <table className="bf-table rent">
        <thead><tr>
          <th>층(호)</th><th className="n">평수</th>
          <th className="n">보증금</th><th className="n">월임대료</th><th className="n">월관리비</th>
        </tr></thead>
        <tbody>
          {snap.floors.map((f, i) => (
            <tr key={i}>
              <td>{f.floor}{f.unit_no ? ` ${f.unit_no}` : ""}
                {f.is_vacant === true && <span className="bf-vac">공실</span>}</td>
              <td className="n">{py(f.contract_area ?? f.exclusive_area)}</td>
              <td className="n">{man(f.deposit)}</td>
              <td className="n">{man(f.rent)}</td>
              <td className="n">{man(f.maintenance)}</td>
            </tr>
          ))}
          <tr className="sum">
            <td colSpan={2}>합 계</td>
            <td className="n">{man(totDep)}</td><td className="n">{man(totRent)}</td><td className="n">{man(totMgmt)}</td>
          </tr>
        </tbody>
      </table>
      <div className="bf-note">
        ※ 임대 내역은 임대인의 진술에 의해 작성되었으므로 사실과 차이가 발생할 수 있음 · 월임대료 부가세 별도
      </div>
    </Frame>,

    <Frame key="6" n="06" title="건물 사진" office={o} rno={rno} date={date}>
      <div className="bf-photos" data-n={[...byKind("exterior").slice(1), ...byKind("interior")].slice(0, 4).length}>
        {[...byKind("exterior").slice(1), ...byKind("interior")].slice(0, 4).map((p) => (
          <figure key={p.id}><div className="bf-ph">{img(p)}</div>{p.caption && <figcaption>{p.caption}</figcaption>}</figure>
        ))}
        {[...byKind("exterior").slice(1), ...byKind("interior")].length === 0 && (
          <div className="bf-empty" style={{ gridColumn: "1/-1" }}>등록된 사진이 없습니다</div>
        )}
      </div>
    </Frame>,
  ];

  return (
    <div className="rslide-root deck" ref={root}>
      <div className="deck-top">
        <button className="btn" onClick={() => nav(`/buildings/${pk}`)} style={{ padding: "6px 12px" }}>
          <ActionIcon name="back" size={15} />매물로</button>
        <span className="ttl">브리핑 자료 · {rno}</span>
        <button className="btn" style={{ marginLeft: "auto", padding: "6px 12px" }}
          onClick={toggleFs} title="전체화면 (발표 모드)">
          <ActionIcon name="fullscreen" size={14} />전체화면</button>
      </div>
      <div className="deck-main">
        <aside className="deck-nav">
          {slides.map((_, i) => (
            <button key={i} className={"deck-thumb bf-thumb" + (cur === i ? " on" : "")} onClick={() => setCur(i)}>
              <span className="tnum">{String(i + 1).padStart(2, "0")}</span>
              <span className="bf-thumb-t">{THUMBS[i]}</span>
            </button>
          ))}
        </aside>
        <div className="deck-stage">
          <div className="stage-slide rs-enter" key={cur}>{slides[cur]}</div>
          <div className="deck-counter">{cur + 1} / {slides.length}</div>
        </div>
      </div>
    </div>
  );
}
