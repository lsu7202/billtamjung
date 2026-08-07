import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { reportsApi, PHOTO_KINDS, type Photo, type PhotoKind } from "../../shared/api/endpoints";
import { useAuth } from "../../shared/store/auth";
import { fitStyle } from "../../shared/ui/PhotoFit";
import { Loading } from "../../shared/ui/Spinner";
import { Icon as ActionIcon } from "../../shared/ui/Icon";
import "./reportslide.css";
import "./briefing.css";

/** 브리핑 자료 — 그 건물에 대한 '사실'만 담는 기초자료.
 *  빌탐정 리포트가 우리 판단(적정가·매력도·미래가치)을 서술하는 것과 반대다.
 *  구성은 원본(specs/03-features/브리핑자료.pptx) 7장을 따른다:
 *    표지 · 매물개요+건물사진 · 서류 2장 · 지적도 · 층별임대내역 · 건물사진 · 마무리 */

const P = 3.305785;
const py = (m2: unknown) => (m2 ? `${(Number(m2) / P).toFixed(2)}평` : "—");
const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
const eokman = (won: unknown) => {
  const w = num(won);
  if (!w) return "—";
  const e = Math.floor(Math.abs(w) / 1e8), mn = Math.round((Math.abs(w) - e * 1e8) / 1e4);
  return (w < 0 ? "−" : "") + (e && mn ? `${e.toLocaleString()}억 ${mn.toLocaleString()}만원`
    : e ? `${e.toLocaleString()}억원` : `${mn.toLocaleString()}만원`);
};
const man = (won: unknown) => { const w = num(won); return w ? `${Math.round(w / 1e4).toLocaleString()}만` : "—"; };
const ymd = (v: unknown) => (v ? String(v).slice(0, 10).replace(/-/g, ".") : "—");

type Snap = {
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
  const contact = [o.agent_title, o.agent_name].filter(Boolean).join(" ");

  const byKind = (k: PhotoKind) => photos.filter((p) => p.kind === k);
  const img = (p?: Photo) => (p && urls[p.id]
    ? <img src={urls[p.id]} alt="" style={fitStyle(p.transform)} />
    : <div className="bf-empty">{p ? "불러오는 중…" : "등록된 자료가 없습니다"}</div>);

  const docSlot = (k: PhotoKind) => (
    <div className="bf-doc">
      <div className="bf-doc-t">{PHOTO_KINDS.find((x) => x.k === k)?.label}</div>
      <div className="bf-doc-img">{img(byKind(k)[0])}</div>
    </div>
  );

  // ── 01 매물 개요 — 원본 표(소재지·토지·건물·금융) 그대로 ──
  const rows: [string, string, string, string][] = [
    ["소재지", "주소", addr, ""],
    ["", "도로상황", String(s.road_frontage ?? "—"), ""],
    ["토지정보", "대지면적", py(s.land_area), `${s.land_area ?? "—"}㎡`],
    ["", "용도지역", String(s.use_zone ?? "—"), ""],
    ["", "공시지가(㎡)", man(s.gongsi_latest), `합계 ${eokman(num(s.gongsi_latest) && num(s.land_area) ? Number(s.gongsi_latest) * Number(s.land_area) : null)}`],
    ["건물정보", "연면적", py(s.total_area), `${s.total_area ?? "—"}㎡`],
    ["", "건축면적", py(s.build_area), `${s.build_area ?? "—"}㎡`],
    ["", "건폐율 / 용적률", `${s.bcr ?? "—"}%`, `${s.far ?? "—"}%`],
    ["", "규모 / 주차", `지하 ${s.floors_below ?? "—"} · 지상 ${s.floors_above ?? "—"}층`, `${s.parking ?? "—"}대`],
    ["", "준공 / 승강기", ymd(s.approval_ymd), `${s.elevator ?? "—"}대`],
    ["", "구조 / 주용도", String(s.structure ?? "—"), String(s.main_use_name ?? "—")],
    ["금융정보", "매매가", eokman(s.sale_price ?? s.sale_est), s.sale_price ? "" : "(빌탐정 적정가)"],
    ["", "평단가", `대지 ${man(num(s.sale_price ?? s.sale_est) && num(s.land_area) ? Number(s.sale_price ?? s.sale_est) / (Number(s.land_area) / P) : null)}원`,
      `연면적 ${man(num(s.sale_price ?? s.sale_est) && num(s.total_area) ? Number(s.sale_price ?? s.sale_est) / (Number(s.total_area) / P) : null)}원`],
  ];

  const totDep = snap.floors.reduce((a, f) => a + (f.deposit ?? 0), 0);
  const totRent = snap.floors.reduce((a, f) => a + (f.rent ?? 0), 0);
  const totMgmt = snap.floors.reduce((a, f) => a + (f.maintenance ?? 0), 0);

  const slides = [
    // 표지
    <div className="rs-slide bf-cover" key="cover">
      <div className="bf-cover-in">
        <div className="bf-office">{String(o.office_name ?? o.name ?? "")}</div>
        <div className="bf-cover-addr">{shortAddr}</div>
        <div className="bf-cover-sub">{String(s.use_zone ?? "")} · {String(s.main_use_name ?? "")}</div>
        <div className="bf-cover-meta">
          {contact && <div>담당자 : {contact}</div>}
          {o.phone ? <div>연락처 : {String(o.phone)}</div> : null}
          {o.fax ? <div>팩스 : {String(o.fax)}</div> : null}
          {o.email ? <div>이메일 : {String(o.email)}</div> : null}
          {o.office_addr ? <div>주소 : {String(o.office_addr)}</div> : null}
        </div>
        <div className="bf-cover-rno">Report No. {rno} · {date}</div>
      </div>
    </div>,

    <Frame key="1" n="01" title="매물 개요" office={o} rno={rno} date={date}>
      <div className="bf-overview">
        <div className="bf-ov-photo">{img(byKind("exterior")[0])}</div>
        <table className="bf-table">
          <tbody>
            {rows.map(([g, k, v1, v2], i) => {
              // 같은 그룹이 이어지면 한 칸으로 묶는다(원본 표와 같은 모양).
              const span = g ? rows.slice(i).findIndex(([gg], j) => j > 0 && gg !== "") : 0;
              const rowSpan = g ? (span < 0 ? rows.length - i : span) : 0;
              return (
                <tr key={i}>
                  {g ? <th className="g" rowSpan={rowSpan}>{g}</th> : null}
                  <th className="k">{k}</th>
                  <td>{v1}</td><td className="s">{v2}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="bf-note">※ 토지이용계획확인원 및 건축물대장 기준</div>
    </Frame>,

    <Frame key="2" n="02" title="공부 서류" office={o} rno={rno} date={date}>
      <div className="bf-docs">{docSlot("land_use")}{docSlot("building_ledger")}</div>
    </Frame>,

    <Frame key="3" n="03" title="지적도 · 위치" office={o} rno={rno} date={date}>
      <div className="bf-wide">{img(byKind("cadastral")[0])}</div>
    </Frame>,

    <Frame key="4" n="04" title="층별 임대 내역" office={o} rno={rno} date={date}>
      <table className="bf-table rent">
        <thead><tr><th>층(호)</th><th>용도</th><th className="n">전용</th><th className="n">계약</th>
          <th className="n">보증금</th><th className="n">월임대료</th><th className="n">월관리비</th><th>상태</th></tr></thead>
        <tbody>
          {snap.floors.map((f, i) => (
            <tr key={i} className={f.est ? "est" : ""}>
              <td>{f.floor}{f.unit_no ? ` ${f.unit_no}` : ""}</td>
              <td>{f.use ?? "—"}</td>
              <td className="n">{f.exclusive_area ? py(f.exclusive_area) : "—"}</td>
              <td className="n">{f.contract_area ? py(f.contract_area) : "—"}</td>
              <td className="n">{man(f.deposit)}</td>
              <td className="n">{man(f.rent)}</td>
              <td className="n">{man(f.maintenance)}</td>
              <td>{f.est ? <span className="bf-est">추정</span> : f.is_vacant === true ? "공실" : f.is_vacant === false ? "임대중" : "—"}</td>
            </tr>
          ))}
          <tr className="sum">
            <td colSpan={4}>합 계</td>
            <td className="n">{man(totDep)}</td><td className="n">{man(totRent)}</td><td className="n">{man(totMgmt)}</td><td></td>
          </tr>
        </tbody>
      </table>
      <div className="bf-note">
        ※ 임대 내역은 임대인의 진술에 의해 작성되었으므로 사실과 차이가 발생할 수 있음 · 월임대료 부가세 별도<br />
        ※ ‘추정’ 표시 행은 팀 입력이 없어 건축물대장·주변 시세로 산출한 값입니다
      </div>
    </Frame>,

    <Frame key="5" n="05" title="건물 사진" office={o} rno={rno} date={date}>
      <div className="bf-photos">
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
          {contact && <div>{contact}{o.phone ? ` · ${String(o.phone)}` : ""}</div>}
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
              <span className="bf-thumb-t">{["표지", "매물 개요", "공부 서류", "지적도", "임대 내역", "건물 사진", "마무리"][i]}</span>
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
