import { Loading } from "../../shared/ui/Spinner";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { overlaysApi } from "../../shared/api/endpoints";
import { NumCell, vPos } from "./KV";
import { TextRow, EnumRow } from "./InfoRow";
import "./bldgtab.css";
import { TrendChart, type TrendBand, type TrendFoot } from "./TrendChart";
import { InfoDot } from "../../shared/ui/InfoDot";
import { Segmented } from "../../shared/ui/Segmented";
import { wonShort, manPerM2 } from "../../shared/format";

/* 플랫 정밀 지표 스타일 — 라벨(작게·muted·tracking) / 값(크게·mono) / 단위(작게·muted) */
const GL: React.CSSProperties = { fontSize: 11, color: "var(--muted)", letterSpacing: ".03em", marginBottom: 4 };
const GV: React.CSSProperties = { fontSize: 23, fontWeight: 800, lineHeight: 1 };
const GU: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "var(--muted)", marginLeft: 2 };

type ZoneMix = { 명: string; 비중: number; 코드?: string }[];

/* 공시지가 추이 차트(라인만). 상승률 배지는 카드 우측 지표 영역에서 렌더. series=[[연도,원/㎡]]. */
function GongsiTrend({ series, bands, foot }: {
  series: [number, number][]; bands?: TrendBand[]; foot?: TrendFoot[];
}) {
  if (!series || series.length < 2) return null;
  const pts = series.map(([y, v]) => ({ x: String(y), y: v }));
  return <TrendChart points={pts} color="var(--c-gongsi)" fmt={(v) => manPerM2(v)} height={196} maxW={620}
    bands={bands} foot={foot} rate />;
}
/* 공시지가 표 — 연도별 단가(최신 위). 그래프/표 토글용. */
function GongsiTable({ series, unit = "py" }: { series: [number, number][]; unit?: "py" | "m2" }) {
  if (!series || series.length < 2) return null;
  const k = unit === "py" ? PY : 1;
  return (
    <table className="wf">
      <thead><tr><th>연도</th><th className="num">공시지가 (만원/{unit === "py" ? "평" : "㎡"})</th></tr></thead>
      <tbody>{[...series].reverse().map(([y, v]) => (<tr key={y}><td>{y}</td><td className="num">{manPerM2(v * k)}</td></tr>))}</tbody>
    </table>
  );
}

/** 필지 셀렉터(S02 §3.6) — 다필지 탭 전환 · 토지/규제/공시지가가 선택 필지 값으로 · 건물 요약(OR 집계).
 * 편집: 필지 오버레이(target_type='parcel', target_id=pnu). enum(지목·지형·도로접면·지세)+자유값(용도지역·토지이용·면적·공시지가).
 */
interface Parcel {
  role: string; pnu: string; area: number | string | null;
  jimok?: string; land_use?: string; slope?: string; shape?: string; road_frontage?: string;
  use_zone?: string; legal_bcr?: string; legal_far?: string; gongsi_latest?: number | string | null; total_gongsi?: number | string | null;
  gongsi_series: [number, number][];
  regs: Record<string, string>;
  /** 국토부 토지이용계획정보 원본(0136) — [이름, 저촉여부, 코드]. 필지당 중앙 8종 */
  reg_all?: [string, string, string][];
  road_front_m?: string | number | null;   // 실측 도로폭(오버레이 자유값)
  road_side_m?: string | number | null;
  road_rear_m?: string | number | null;
}
interface ParcelsResp { parcels: Parcel[]; reg_summary: Record<string, string>; count: number;
  /** 실측 도로폭 — 건물 단위 배치값(master.building_road). 필지 오버레이가 없으면 이걸 쓴다. */
  road?: { front_m?: number | null; side_m?: number | null; rear_m?: number | null; front_rn?: string | null };
}

// 나대지 상세도 같은 칩을 쓴다 — 규제는 땅에 걸리는 것이라 건물 유무와 무관하다(2026-08-27)
export const REG_ALL = ["지구단위계획", "정비구역", "고도지구", "경관지구", "방화지구", "문화재보존"];   // 목업 순서(개발제한=마스터 컬럼 없음, 제외)
export const REG_FIELD: Record<string, string> = {   // 규제 라벨 → 필지 오버레이 필드(백엔드 REG_LABELS 역매핑)
  "고도지구": "reg_godo", "지구단위계획": "reg_district", "정비구역": "reg_jeongbi",
  "경관지구": "reg_gyeong", "방화지구": "reg_banghwa", "문화재보존": "reg_munhwa",
};
const num = (x: unknown): number | null => (x == null || x === "" ? null : Number(x));
// 법정 건폐/용적은 **숫자 목록**으로 온다(0153): [55] 하나이거나 [50,60] 병기.
// 걸친 필지에서 작은 쪽이 330㎡(상업 660㎡)를 넘으면 법이 가중평균을 금해 각각 적는다
// (서울 6,529필지). 예전엔 문자열이라 읽는 쪽마다 정규식을 썼고 버그가 여섯 개 나왔다.
const legalText = (v: unknown): string | null =>
  Array.isArray(v) && v.length ? v.map((x) => `${x}%`).join(", ") : null;
// 계산에 쓸 숫자. 값이 둘이면 null — 하나를 고르면 작은 쪽을 법정치인 양 쓰게 된다.
const legalNum = (v: unknown): number | null =>
  Array.isArray(v) && v.length === 1 ? Number(v[0]) : null;

const PY = 3.305785;
export function ParcelBlock({ pk, useZoneMix, unit = "m2", bcr, far }: {
  pk: string; useZoneMix?: unknown; unit?: "py" | "m2";
  /** 현재 건폐율·용적률(건물 값) — 법정과 견줘 「법정 대비」를 낸다. 현재 − 법정, 넘으면 + (2026-09-04) */
  bcr?: number | null; far?: number | null;
}) {
  const [sel, setSel] = useState(0);
  const qc = useQueryClient();
  const q = useQuery<ParcelsResp>({
    queryKey: ["parcels", pk],
    queryFn: () => api<ParcelsResp>(`/buildings/${pk}/parcels`),
  });
  const parcels = q.data?.parcels ?? [];
  const road = q.data?.road;          // 건물 단위 실측 도로폭(배치) — 오버레이 없을 때의 기본값
  const p = parcels[sel];
  const pnu = p?.pnu ?? "";

  const save = useMutation({
    mutationFn: ({ field, value }: { field: string; value: string }) => overlaysApi.put(pnu, field, value, "parcel"),
    onSettled: () => qc.invalidateQueries({ queryKey: ["parcels", pk] }),
  });
  const onSave = (field: string, value: string) => save.mutate({ field, value });

  const area = num(p?.area);

  if (q.isLoading) return <Loading label="필지 정보 불러오는 중" minHeight={120} />;
  if (parcels.length === 0) return null;

  const summary = q.data?.reg_summary ?? {};
  const applied = Object.keys(summary);

  const parcelTag = parcels.length > 1 ? <small style={{ color: "var(--muted)", fontWeight: 400 }}>필지 {p.pnu.slice(-8)}</small> : null;
  return (
    <>
    {/* 선 격자를 걷고 건물 탭과 같은 줄로(2026-08-26).
        토지정보·규제를 2단으로 나란히 두던 것도 풀렸다 — 열이 좁아 「주상기타」 같은 값이
        카드 밖으로 잘렸다. 각각 풀폭에 두 칸으로 편다(건물정보와 같은 모습). */}
    <div className="bg-card">
      <div className="bg-ttl">토지정보
        {/* 다필지 고르기 — 네모 버튼 나열을 칩으로. 고르는 값이니 다른 칸과 같은 어법이다 */}
        {parcels.length > 1 && (
          <span className="chips-in" style={{ marginLeft: 12 }}>
            {parcels.map((pc, i) => (
              <button key={pc.pnu} className={i === sel ? "on" : ""} onClick={() => setSel(i)}>
                {pc.pnu.slice(-8)}{pc.role === "대표" && <span style={{ opacity: .65, marginLeft: 4 }}>대표</span>}
              </button>
            ))}
          </span>
        )}
      </div>

      <div className="bg-cols">
        {/* 토지정보는 국토부 토지특성·토지이용계획정보에서 온 정본이라 읽기만 한다(2026-08-28).
            면적만 예외 — 합필·분필이 대장에 늦게 반영돼 현장과 어긋나는 일이 있다. */}
        <TextRow label="토지면적" value={area != null ? (unit === "py" ? `${(area / PY).toFixed(1)}평` : `${area.toLocaleString()}㎡`) : ""}
          cur={area != null ? (unit === "py" ? +(area / PY).toFixed(1) : area) : ""}
          parse={(v) => String(unit === "py" ? parseFloat(v) * PY : parseFloat(v))} validate={vPos}
          onSave={(v) => onSave("area", v)} />
        <EnumRow lock label="지목" enumKey="jimok" value={p.jimok} onSave={() => {}} />
        {/* 용도지역 — 국토부 토지이용계획정보와 100% 일치한다(0136). 고칠 값이 아니라 읽는 값이라
            다중선택 드롭다운을 걷었다. 걸침이면 비중 큰 순으로 나란히 세운다. */}
        {(() => {
          const mix: ZoneMix = Array.isArray(useZoneMix) ? useZoneMix : (typeof useZoneMix === "string" ? JSON.parse(useZoneMix || "[]") : []);
          const zones = mix.length ? mix.map((m) => m.명) : (p.use_zone ? [p.use_zone] : []);
          if (zones.length === 0) return null;
          return (
            <div className="orow lock"><span className="who g">용도지역</span>
              <span className="cap">{zones.length > 1 ? "걸침" : ""}</span>
              <span className="ev zones">{zones.map((z) => <b key={z}>{z}</b>)}</span>
              <span className="okpad" />
            </div>
          );
        })()}
        <TextRow lock label="토지이용상황" value={p.land_use ?? ""} />
        {/* 지형·지세는 늘 붙어 다니는 값이라 한 줄로 합쳤다 */}
        <EnumRow lock label="지형/형상" enumKey="shape" value={p.shape} onSave={() => {}} />
        <EnumRow lock label="지세" enumKey="slope" value={p.slope} onSave={() => {}} />
        <EnumRow lock label="도로접면" enumKey="road_frontage" value={p.road_frontage} onSave={() => {}} />
        {/* 실측 도로폭 — 대장 '도로접면'은 광대/중로/소로 같은 분류 코드라 실제 폭(m)이 없다.
            기본값 = 도로명주소 도로구간 배치(master.building_road, 전 서울 91.3%).
            셋 다 비면 「—」 하나로 선다 — 빈 칸 셋이 자리를 먹지 않게(2026-08-26). */}
        <div className="orow"><span className="who g">실측 도로폭</span>
          <span className="cap">{(p.road_front_m ?? road?.front_m) || (p.road_side_m ?? road?.side_m) || (p.road_rear_m ?? road?.rear_m) ? "전 · 측 · 후" : ""}</span>
          {(p.road_front_m ?? road?.front_m) || (p.road_side_m ?? road?.side_m) || (p.road_rear_m ?? road?.rear_m) ? (
            <span className="ev" style={{ display: "inline-flex", gap: 5, alignItems: "baseline" }}>
              <NumCell v={p.road_front_m ?? road?.front_m ?? ""} suffix="m" onSave={(x) => onSave("road_front_m", x)} /> ·
              <NumCell v={p.road_side_m ?? road?.side_m ?? ""} suffix="m" onSave={(x) => onSave("road_side_m", x)} /> ·
              <NumCell v={p.road_rear_m ?? road?.rear_m ?? ""} suffix="m" onSave={(x) => onSave("road_rear_m", x)} />
            </span>
          ) : (
            <span className="ev off" style={{ cursor: "pointer" }}
              onClick={() => onSave("road_front_m", "")}>—</span>
          )}
          <span className="okpad" />
        </div>
        {/* 법정 건폐/용적 — 용도지역에서 조례로 파생한다. 그 용도지역이 정본과 100% 맞으므로
            이 값도 정본이다(2026-08-28 대조). 걸침이면 국토계획법대로 가중평균한다. */}
        <div className="orow lock"><span className="who g">법정 건폐 · 용적</span><span className="cap" />
          <span className="ev" style={{ display: "inline-flex", gap: 5, alignItems: "baseline" }}>
            <b>{legalText(p.legal_bcr) ?? "—"}</b> ·
            <b>{legalText(p.legal_far) ?? "—"}</b>
          </span>
          <span className="okpad" />
        </div>
        {/* 법정 대비 건폐 · 용적 — 현재에서 법정을 뺀 값(2026-09-04). 법정을 넘어야 +, 빨강.
            「잔여(법정 − 현재)」로 적던 것을 뒤집었다. 중개인이 먼저 묻는 것은 「법정치를 넘었나」다.
            단위는 % 로만 적는다. %p 는 쓰지 않는다(규칙).
            ★ 현재 값이 없으면(대장 공란) 아예 안 그린다 — 0으로 보고 「전부 남았다」고 하면 안 된다. */}
        {(() => {
          const lb = legalNum(p.legal_bcr), lf = legalNum(p.legal_far);
          const ob = lb != null && bcr != null ? bcr - lb : null;
          const of = lf != null && far != null ? far - lf : null;
          if (ob == null && of == null) return null;
          const add = of != null && of < 0 && area ? (-of / 100) * area / PY : null;
          const tone = (v: number | null) => (v == null ? "var(--muted)" : v > 0 ? "var(--red, #F04452)" : "var(--muted)");
          return (
            <div className="orow lock"><span className="who g">법정 대비 건폐 · 용적</span>
              <span className="cap">{add != null ? `증축 ${Math.round(add).toLocaleString()}평` : ""}</span>
              <span className="ev" style={{ display: "inline-flex", gap: 5, alignItems: "baseline" }}>
                <b style={{ color: tone(ob) }}>{ob != null ? `${ob > 0 ? "+" : ""}${ob.toFixed(1)}%` : "—"}</b>
                <span style={{ color: "var(--faint)" }}>·</span>
                <b style={{ color: tone(of) }}>{of != null ? `${of > 0 ? "+" : ""}${of.toFixed(1)}%` : "—"}</b>
              </span>
              <span className="okpad" />
            </div>
          );
        })()}
      </div>
    </div>

    <div className="bg-card" id="bt-reg" style={{ marginTop: 14 }}>
      <div className="bg-ttl">규제 · 특례 {parcelTag}</div>
      <RegCard regAll={p.reg_all ?? []}
        other={applied.filter((k) => !p.regs[k])} summary={summary} />
    </div>
    </>
  );
}

/* 공시지가 카드(건물 대표필지 시계열) — 실거래와 좌우 페어용 독립 컴포넌트. 그래프/표 토글 + 지표 스택. */
/** 규제 · 특례 — 여섯을 **상태 칩 한 줄**로 두고, 값이 있는 것만 아래 줄로 세운다(2026-08-26).
 *
 *  「직접 적기」 같은 조작 줄을 따로 두지 않는다 — **꺼진 칩을 누르는 것이 곧 직접 적기**다.
 *  누르면 그 줄이 서고 커서가 그 칸에 간다. 비운 채 벗어나면 칩이 도로 꺼져서
 *  실수로 켠 것이 남지 않는다.
 *
 *  칩 색은 선택 칩과 같은 연파랑이다. 규제는 경고가 아니라 이 건물의 주인공 값이라
 *  빨강(기한·경고)이 아니라 파랑이 맞다 — 지구단위계획은 개발 호재이기도 하다.
 */
export function RegCard({ regAll, other, summary }: {
  /** [이름, 저촉여부, 코드] — 국토부 토지이용계획정보 원본(0136) */
  regAll: [string, string, string][];
  other: string[]; summary: Record<string, string>;
}) {
  if (regAll.length === 0) return <div className="pg-other">걸린 규제 없음</div>;
  // 토지이음·부동산플래닛과 같은 두 묶음 — 코드 UQ* 가 국토계획법이고 나머지가 기타법령이다.
  const law = regAll.filter(([, , c]) => String(c).startsWith("UQ"));
  const etc = regAll.filter(([, , c]) => !String(c).startsWith("UQ"));
  const group = (rows: [string, string, string][], title: string) => rows.length > 0 && (
    <div className="rg-grp">
      <div className="rg-ttl">{title}</div>
      <div className="rg-list">
        {rows.map(([n, j], i) => (
          <span key={`${n}${j}${i}`} className={`rg ${j === "포함" ? "inc" : j === "저촉" ? "tou" : "adj"}`}>
            {n}<i>({j})</i></span>
        ))}
      </div>
    </div>
  );
  return (
    <>
      <div className="rg-wrap">
        {group(law, "국토의 계획 및 이용에 관한 법률")}
        {group(etc, "기타법령")}
      </div>
      {/* 다필지 — 이 필지엔 없지만 다른 필지에 걸린 규제. 건물 전체로는 해당한다 */}
      {other.length > 0 && (
        <div className="pg-other">다른 필지 {other.map((k) => <b key={k} title={summary[k]}>{k}</b>)}</div>
      )}
    </>
  );
}

/** 공시배율 — 매매가·추정가·실거래가가 각각 공시총액의 몇 배인가.
 *  분모가 하나라 셋이 같은 자에 서고, 막대 길이가 그대로 배율이다. */
function GongsiMult({ total, sale, est, real }: {
  total: number; sale?: number | null; est?: number | null; real?: number | null;
}) {
  const rows: [string, number | null | undefined, string][] = [
    ["매매가", sale, "me"], ["빌탐정 추정가", est, "est"], ["실거래가", real, ""],
  ];
  const got = rows.filter(([, v]) => v != null && v > 0);
  if (got.length === 0) return null;
  const max = Math.max(...got.map(([, v]) => v! / total), 1);
  return (
    <div className="gm-mult">
      <div className="gm-h">공시총액 대비</div>
      {got.map(([label, v, kind]) => {
        const x = v! / total;
        return (
          <div className="gm-r" key={label}>
            <span className="k">{label}</span>
            <span className="t"><i className={kind} style={{ width: `${Math.max(3, (x / max) * 100)}%` }} /></span>
            <span className={`v ${kind}`}>{x.toFixed(1)}배</span>
          </div>
        );
      })}
    </div>
  );
}

export function GongsiCard({ series, totalGongsi, landArea, sale, est, real, unit = "py" }: {
  series: [number, number][]; totalGongsi: number | null; landArea: number | null;
  /** 평·㎡ — 화면 토글을 따른다. 기본은 평(2026-09-04 규칙). 단가 셋(㎡당·평당·표)이 전부 이걸 본다 */
  unit?: "py" | "m2";
  /** 공시배율 — 값이 공시총액의 몇 배인가. 셋 다 같은 분모라 나란히 견줄 수 있다(2026-08-28).
   *  현장에서 「공시가의 몇 배에 팔린다」는 가장 빠른 가늠자다. */
  sale?: number | null; est?: number | null; real?: number | null;
}) {
  const [mode, setMode] = useState<"c" | "t">("c");
  if (!series || series.length < 2) return null;
  const gongsiLatest = series[series.length - 1][1];
  const total = totalGongsi ?? (gongsiLatest && landArea ? gongsiLatest * landArea : null);
  // 구간 상승률 — 그래프 안 음영과 축 아래 한 줄로 간다(2026-08-26).
  // 오른쪽 지표로 세 숫자를 늘어놓으면 그래프와 숫자가 서로를 안 가리킨다.
  const y0 = series[0][0], yN = series[series.length - 1][0];
  const at = (y: number) => series.find(([yy]) => yy === y)?.[1] ?? null;
  const pct = (from: number | null) => (from ? ((gongsiLatest - from) / from) * 100 : null);
  const p10 = yN - y0 >= 10 ? pct(at(yN - 10)) : null;
  const p5 = yN - y0 >= 5 ? pct(at(yN - 5)) : null;
  const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;
  const bands = [
    ...(p10 != null ? [{ from: String(yN - 10), op: 0.05 }] : []),
    ...(p5 != null ? [{ from: String(yN - 5), op: 0.07 }] : []),
  ];
  const foot = [
    ...(p10 != null ? [{ label: `10년 전 대비 ${fmtPct(p10)}`, color: "#8FAAD3" }] : []),
    ...(p5 != null ? [{ label: `5년 전 대비 ${fmtPct(p5)}`, color: "var(--c-gongsi)" }] : []),
  ];
  return (
    <div className="panel">
      <div className="sec-head">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span style={{ width: 14, height: 0, borderTop: "3px solid var(--c-gongsi)", display: "inline-block" }} />공시지가
        </span>
        {/* 두 갈래 전환 = 슬라이딩 토글(규칙). 네모 버튼 둘을 나열하지 않는다 */}
        <Segmented size="sm" style={{ marginLeft: "auto" }} value={mode} onChange={setMode}
          options={[{ value: "c", label: "그래프" }, { value: "t", label: "표" }]} />
      </div>
      <div style={{ display: "flex", gap: 24, alignItems: mode === "t" ? "flex-start" : "center", flexWrap: "wrap", padding: "6px 18px 16px" }}>
        <div style={{ flex: "1 1 360px", minWidth: 0, maxWidth: 620 }}>
          {mode === "c"
            ? <GongsiTrend series={series} bands={bands} foot={foot} />
            : <GongsiTable series={series} unit={unit} />}
        </div>
        <div style={{ flex: "0 1 200px", minWidth: 180 }}>
          <div style={GL}>{unit === "py" ? "평당" : "㎡당"} 공시지가</div>
          <div className="num" style={{ ...GV, color: "var(--c-gongsi)" }}>{manPerM2(unit === "py" ? gongsiLatest * PY : gongsiLatest)}<span style={GU}>/{unit === "py" ? "평" : "㎡"}</span></div>
          <div style={{ marginTop: 9, fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>
            <span style={{ display: "inline-flex", alignItems: "center" }}>총액<InfoDot text={unit === "py" ? "평당 공시지가 × 대지면적" : "㎡당 공시지가 × 대지면적"} /></span>{" "}
            <b className="num" style={{ color: "var(--ink-2)", fontWeight: 800 }}>{wonShort(total) || "—"}</b>
            {landArea ? <>{" · "}대지 {(landArea / PY).toFixed(1)}평</> : null}
          </div>
          {/* 공시배율 — 총액을 분모로 셋을 나란히. 막대 길이가 곧 배율이라 「몇 배」를 읽지 않아도 안다. */}
          {total ? <GongsiMult total={total} sale={sale} est={est} real={real} /> : null}
        </div>
      </div>
    </div>
  );
}

