import { Loading } from "../../shared/ui/Spinner";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { reportsApi, ReportComp } from "../../shared/api/endpoints";
import "./report.css";
import { Icon } from "../../shared/ui/Icon";

/** 빌탐정 리포트 — 만들기 전에 한 번 보여주는 창.
 *
 *  2026-08-28 개편. 예전엔 가운데가 **주변사례 고르기**였다. 사례마다 체크박스가 서고,
 *  줄을 펴면 도로접면·용도지역·지형형상… 드롭다운 아홉 개가 나왔다. 세 가지가 문제였다.
 *
 *  ① 아무도 안 골랐다 — 열두 건의 도로접면을 손으로 고쳐야 값이 바뀌는데, 그 값이 맞는지
 *     아는 사람이 없다. 대장에서 온 값을 눈대중으로 덮는 자리였다.
 *  ② **골랐다는 사실이 결과를 가뒀다.** 유저 오버레이가 하나라도 걸리면 마스터 적정가를
 *     되쓰지 않는다(추정→정본 금지). 그런데 창이 열릴 때부터 이상치를 제외한 집합을
 *     보내고 있어서, 손 하나 안 대도 늘 「오버레이 걸린 리포트」였다.
 *  ③ 검색 핀·배치와 값이 갈렸다.
 *
 *  이제 창은 **보고 확인하는 자리**다: 이렇게 나온다 · 이만큼 든다 · 만든다.
 *  아무것도 안 보내므로 서버가 baseline(이상치 제외)으로 계산하고, 그 값이 곧 배치·검색과 같다.
 *  본매물 값을 고치는 자리는 원래부터 건물 상세였다.
 */

const eok = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${(v / 1e8).toFixed(d)}억`);

type Props = { pk: string; credits?: number; onClose: () => void; onDone: (msg: string) => void };

export function ReportModal({ pk, credits, onClose, onDone }: Props) {
  const nav = useNavigate();
  // gcTime 0: 닫을 때 캐시 폐기 — 상권(market_area)을 바꾼 뒤 다시 열면 옛 반경 값이 굳는다.
  const { data, isLoading } = useQuery({
    queryKey: ["report-comps", pk], queryFn: () => reportsApi.comps(pk),
    gcTime: 0, refetchOnWindowFocus: false,
  });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [preview, setPreview] = useState(data?.preview ?? null);

  // baseline 그대로 — 고를 것이 없으니 보낼 것도 없다. 나올 값과 같은 값을 보여준다.
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const r = await reportsApi.preview({ building_pk: pk, exclude: [], overrides: {}, include_market: false });
        if (!dead) setPreview(r.preview);
      } catch { if (!dead) setPreview(data?.preview ?? null); }
    })();
    return () => { dead = true; };
  }, [pk, data]);

  async function generate() {
    setBusy(true); setMsg("만드는 중…");
    try {
      const { report_id } = await reportsApi.create(pk, "analysis");
      for (let i = 0; i < 60; i++) {
        const r = await reportsApi.get(report_id);
        if (r.status === "done") { onDone(`빌탐정 리포트를 만들었습니다 · 크레딧 ${r.credits_spent}`); nav(`/reports/${report_id}`); return; }
        if (r.status === "failed") { setMsg(`실패했습니다 — ${r.failed_reason ?? "알 수 없는 이유"} · 크레딧은 안 빠졌습니다`); setBusy(false); return; }
        await new Promise((res) => setTimeout(res, 500));
      }
      onDone("아직 만드는 중입니다 — 마이페이지 「내 리포트」에서 확인하세요");
    } catch (e) { setMsg(`오류: ${String(e)}`); setBusy(false); }
  }

  const s = data?.subject;
  const nego = preview?.fair_price != null && preview?.ask_price != null ? preview.fair_price - preview.ask_price : null;
  const COST = 30;

  return (
    <div className="modal-bg open" onClick={() => !busy && onClose()}>
      <div className="gmodal" onClick={(e) => e.stopPropagation()}>
        <div className="gm-head">
          <h2>빌탐정 리포트</h2>
          <span className="addr">{(s?.addr ?? "").replace("서울특별시 ", "")}</span>
          <button className="gm-x" disabled={busy} onClick={onClose}><Icon name="close" size={16} /></button>
        </div>

        {isLoading || !data || !s ? (
          <Loading label="주변 사례 불러오는 중" minHeight={260} />
        ) : (
          <div className="gm-body">
            <div className="gm-map">
              <ZoneMap subject={s} comps={data.comps} rentPins={data.rent_pins} />
              <div className="gm-cap">
                {s.polygon ? "그린 영역" : <>반경 <b>{s.radius_m}m</b></>}
                <span>실거래 <b>{data.counts.sale}</b></span>
                <span>임대 <b>{data.counts.rent}</b></span>
              </div>
            </div>

            <div className="gm-vals">
              <div className="orow big">
                <span className="who g">적정매매가</span><span className="cap" />
                <span className="ev hero">{eok(preview?.fair_price)}</span>
              </div>
              <div className="orow">
                <span className="who g">가치점수</span><span className="cap" />
                <span className="ev">{preview?.score ?? "—"}<i className="gr">{preview?.grade ?? ""}</i></span>
              </div>
              <div className="orow">
                <span className="who g">매도희망가</span><span className="cap" />
                <span className="ev">{eok(preview?.ask_price)}</span>
              </div>
              <div className="orow">
                <span className="who g">협의 필요금액</span><span className="cap" />
                <span className={`ev${nego != null && nego < 0 ? " bad" : ""}`}>
                  {nego == null ? "—" : `${nego < 0 ? "−" : "+"}${eok(Math.abs(nego))}`}</span>
              </div>
              <div className="orow">
                <span className="who g">예상수익률</span><span className="cap" />
                <span className="ev">{preview?.expected_roi ?? "—"}{preview?.expected_roi != null && <i className="u">%</i>}</span>
              </div>
            </div>
          </div>
        )}

        <div className="gm-foot">
          <span className="gm-cost">크레딧 <b>{credits ?? "…"}</b>
            <i>→ {credits != null ? credits - COST : "…"}</i></span>
          <span className="sp" />
          {msg && <span className="gm-msg">{msg}</span>}
          <button className="gm-go" disabled={busy || !data} onClick={generate}>
            {busy ? "만드는 중…" : "만들기"}</button>
        </div>
      </div>
    </div>
  );
}

type Subject = { center: { lng: number; lat: number } | null; radius_m: number; polygon: boolean };

/* 상권 미니맵 — 미터공간 SVG viewBox 로 자동 스케일(반경=원, 폴리곤=최대거리). 읽기전용. */
function ZoneMap({ subject, comps, rentPins }: { subject: Subject; comps: ReportComp[]; rentPins: { lng: number; lat: number }[] }) {
  const c = subject.center;
  const R = useMemo(() => {
    if (!subject.polygon) return subject.radius_m;
    const maxD = Math.max(100, ...comps.map((x) => x.dist_m));
    return maxD * 1.15;
  }, [subject, comps]);
  if (!c) return <div className="zone-map" />;
  const toR = Math.PI / 180;
  const proj = (lng: number, lat: number): [number, number] => [
    (lng - c.lng) * Math.cos(c.lat * toR) * 111320,
    -(lat - c.lat) * 111320,
  ];
  const pinR = R * 0.018, cross = R * 0.9;
  return (
    <div className="zone-map">
      <svg width="100%" height="100%" viewBox={`${-cross} ${-cross} ${2 * cross} ${2 * cross}`} preserveAspectRatio="xMidYMid meet">
        {!subject.polygon && <circle cx={0} cy={0} r={subject.radius_m} fill="rgba(49,130,246,.06)" stroke="#3182F6" strokeWidth={R * 0.005} strokeDasharray={`${R * 0.03} ${R * 0.02}`} />}
        {rentPins.map((p, i) => { const [x, y] = proj(p.lng, p.lat); return <circle key={`r${i}`} cx={x} cy={y} r={pinR} fill="#B0B8C1" stroke="#fff" strokeWidth={pinR * 0.35} />; })}
        {comps.map((p) => { const [x, y] = proj(p.lng, p.lat); return <circle key={p.building_pk} cx={x} cy={y} r={pinR} fill="#3182F6" stroke="#fff" strokeWidth={pinR * 0.35} />; })}
        <circle cx={0} cy={0} r={pinR * 1.3} fill="#191F28" stroke="#fff" strokeWidth={pinR * 0.4} />
      </svg>
      <div className="zm-legend">
        <span><b style={{ background: "#3182F6" }} />실거래</span>
        <span><b style={{ background: "#B0B8C1" }} />임대</span>
      </div>
    </div>
  );
}
