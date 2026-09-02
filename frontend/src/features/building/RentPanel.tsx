import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../shared/api/client";
import { Loading } from "../../shared/ui/Spinner";
import { Segmented } from "../../shared/ui/Segmented";
import { TrendChart } from "./TrendChart";
import { useReportModel } from "./reportModel";
import { FloorRows } from "./FloorRows";
import { Toc } from "./Toc";
import "./report.css";

/** 임대 탭 — 팀이 넣은 실측과 우리 추정을 **한 자리에** 둔다(2026-08-26).
 *
 *  예전엔 실측 층별 임대가 건물 탭에, 추정 임대료가 분석 탭에 갈라져 있었다. 그러면
 *  「우리 건물 2,391만인데 주변이 2,508만」을 보려고 탭을 오가야 해서 아무도 견주지 않는다.
 *  탭 이름이 「임대」라고 안이 다 사실이어야 하는 건 아니다 — 사실과 추정은 탭이 아니라
 *  **「추정」 배지**로 가른다(추정가 옆에 붙는 그 알약과 같은 문법).
 */
const P = 3.305785;                                   // ㎡ → 평
type FloorRow = { floor: string; cur: number; mkt: number; cur_dep?: number; mkt_dep?: number };

/** 층 이름을 하나로 — 대장과 팀 입력이 서로 다른 말을 쓴다.
 *  마스터에도 「지1층·지1·지층·지하1층」이 따로 있고, 팀은 「1·2·B1」로 적는다.
 *  묶지 않으면 같은 층이 두 줄로 서서 값이 두 번 세어진다. 데이터 쪽 정리는 별개 일. */
function floorKey(f: string): string {
  const s = String(f ?? "").trim();
  if (/^(옥탑|옥상|RF?)/i.test(s)) return "옥탑층";
  const n = Number(s.replace(/[^0-9]/g, "")) || 0;
  if (/^(지하|지|B)/i.test(s) || /^B/i.test(s)) return `지하${n || 1}층`;
  return n ? `${n}층` : s;
}

/** 층 순서 — 옥탑·고층에서 지하로. 문자열 그대로 정렬하면 「10층」이 「2층」 앞에 온다.
 *
 *  지하 판정은 **「지」로 시작하면 지하**다(2026-08-29). 「지하」 두 글자만 보면 안 된다 —
 *  대장 원본은 「지1층」·「지1」·「지층」 표기가 훨씬 많았고(37만건), 그걸 「지하」로만
 *  찾다가 지하가 지상으로 뒤집혀 읽혔다. DB 는 0031 정규화로 「지하N층」 하나가 됐지만,
 *  팀이 손으로 치는 값(B1·지1)은 여전히 제각각이라 여기서 받아 준다. */
function floorRank(f: string): number {
  const s = String(f).trim();
  if (s.startsWith("옥탑")) return 1000;
  const n = Number(s.replace(/[^0-9]/g, "")) || 0;
  const under = s.startsWith("지") || /^b/i.test(s);
  return under ? -(n || 1) : n;
}



/** 임대 시세 추이 — 한국부동산원 임대동향 요율로 지난 임대료를 역산한 값(2026-08-28).
 *  공시지가 카드와 같은 어법이다: 그래프/표 토글 + 상승률 배지. 두 카드를 나란히 두면
 *  「땅값은 올랐는데 임대는 제자리」 같은 어긋남이 바로 보인다. */
function RentTrend({ pk }: { pk: string }) {
  const [mode, setMode] = useState<"c" | "t">("c");
  const q = useQuery({ queryKey: ["rent-series", pk],
    queryFn: () => api<{ series: [number, number][]; up5: number | null; up10: number | null;
                         sanggwon?: string; series_name?: string }>(`/buildings/${pk}/rent-series`) });
  const d = q.data;
  if (!d || d.series.length < 2) return null;
  const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`;
  const man = (v: number) => `${Math.round(v / 1e4).toLocaleString()}만`;
  const yN = d.series[d.series.length - 1][0];
  // 음영은 구간(bands), 상승률 배지는 축 아래 한 줄(foot) — 공시지가 카드와 같은 어법
  const bands = [
    ...(d.up10 != null ? [{ from: String(yN - 10), op: 0.05 }] : []),
    ...(d.up5 != null ? [{ from: String(yN - 5), op: 0.07 }] : []),
  ];
  const foot = [
    ...(d.up10 != null ? [{ label: `10년 ${pct(d.up10)}`, color: "#8FAAD3" }] : []),
    ...(d.up5 != null ? [{ label: `5년 ${pct(d.up5)}`, color: "var(--blue)" }] : []),
  ];
  const last = d.series[d.series.length - 1];
  return (
    <section className="rv-card" id="rt-trend">
      <div className="sec-head">
        <span className="rv-k">임대 시세 추이
          <em className="rv-est">{d.sanggwon} · {d.series_name} 요율로 역산</em></span>
        <Segmented size="sm" style={{ marginLeft: "auto" }} value={mode} onChange={setMode}
          options={[{ value: "c", label: "그래프" }, { value: "t", label: "표" }]} />
      </div>
      <div style={{ display: "flex", gap: 24, alignItems: mode === "t" ? "flex-start" : "center",
                    flexWrap: "wrap", padding: "6px 18px 16px" }}>
        <div style={{ flex: "1 1 360px", minWidth: 0, maxWidth: 620 }}>
          {mode === "c" ? (
            <TrendChart points={d.series.map(([y, v]) => ({ x: String(y), y: v }))}
              color="var(--blue)" fmt={man} height={196} maxW={620} bands={bands} foot={foot} rate />
          ) : (
            <table className="wf">
              <thead><tr><th>연도</th><th className="num">월 임대료</th></tr></thead>
              <tbody>{[...d.series].reverse().map(([y, v]) => (
                <tr key={y}><td>{y}</td><td className="num">{man(v)}</td></tr>))}</tbody>
            </table>
          )}
        </div>
        <div style={{ flex: "0 1 200px", minWidth: 170 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "var(--muted)" }}>지금 월 임대료</div>
          <div className="num" style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-.03em",
                                        color: "var(--blue)", lineHeight: 1.2 }}>{man(last[1])}</div>
        </div>
      </div>
    </section>
  );
}

export function RentPanel({ pk, unit, items, total, refresh }: {
  pk: string; unit: "py" | "m2";
  items: Parameters<typeof FloorRows>[0]["items"];
  total: Parameters<typeof FloorRows>[0]["total"];
  refresh: () => void;
}) {
  const { loading, sub, rs, floors, totalArea, landArea } = useReportModel(null, pk);

  // 같은 층으로 묶고(라벨이 갈려 있다) 위에서 아래로
  const fl = Object.values((floors ?? []).reduce((m: Record<string, FloorRow>, x) => {
    const k = floorKey(x.floor);
    const o = m[k] ?? (m[k] = { floor: k, cur: 0, mkt: 0, cur_dep: 0, mkt_dep: 0 });
    o.cur += x.cur || 0; o.mkt += x.mkt || 0;
    o.cur_dep! += x.cur_dep || 0; o.mkt_dep! += x.mkt_dep || 0;
    return m;
  }, {})).sort((a, b) => floorRank(b.floor) - floorRank(a.floor));

  const py = totalArea ? totalArea / P : null;
  const landP = landArea ? landArea / P : null;
  const curRent = rs?.cur_rent ?? null, mktRent = rs?.mkt_rent ?? null;
  const perLand = (v: number | null | undefined) => v != null && landP ? v / landP : null;
  const twoPy = (v: number | null | undefined, dp = 1) => {
    const a = v != null && py ? v / py : null, b = perLand(v);
    if (a == null && b == null) return null;
    const f = (x: number) => (x / 1e4).toFixed(dp).replace(/\.0$/, "");
    return `대지 ${b != null ? f(b) : "—"}만 · 연면적 ${a != null ? f(a) : "—"}만`;
  };

  return (
    <div className="rv">
      <div className="rv-wrap">
        <Toc items={[
          { id: "rt-real", label: "층별 임대정보" },
          { id: "rt-trend", label: "임대 시세 추이" },
          ...(fl.length ? [{ id: "rt-est", label: "임대료·보증금 추정" }] : []),
        ]} />
        <div className="rv-body">
          {/* 실측 — 팀이 넣는 값. 표가 아니라 층 줄이다(FloorRows) */}
          <div id="rt-real">
            <FloorRows pk={pk} items={items} total={total} unit={unit} refresh={refresh} />
          </div>

          <RentTrend pk={pk} />

          {loading && !sub && <Loading label="임대 추정 계산 중" minHeight={160} />}

          {fl.length > 0 && (
            <FloorRent rows={fl} id="rt-est"
              total={{ rent: curRent, mktRent, dep: rs?.cur_deposit ?? null, mktDep: rs?.mkt_deposit ?? null }}
              side={{ rent: twoPy(curRent), dep: twoPy(rs?.cur_deposit, 0) }} />
          )}
        </div>
      </div>
    </div>
  );
}

/** 층별 월 임대료 — 막대 하나에 눈금 하나. 값은 「1,141만」, 그 아래 주변과의 차이만 */
function FloorRent({ rows, id, total, side }: {
  rows: FloorRow[]; id?: string;
  /** 건물 통째의 추정 총액 — 층을 하나씩 읽기 전에 「얼마쯤인지」가 먼저 서야
   *  층별 값이 견줄 자를 갖는다. 층별과 같은 카드에 둔다: 둘은 같은 추정이다. */
  total?: { rent: number | null; mktRent: number | null; dep: number | null; mktDep: number | null };
  side?: { rent: string | null; dep: string | null };
}) {
  const CAP = 5;                                       // 처음엔 다섯 층. 나머지는 눌러서 편다
  const [all, setAll] = useState(false);
  // 임대료와 보증금은 자릿수가 달라 한 그림에 못 겹친다 — 축을 갈아 끼운다
  const [axis, setAxis] = useState<"rent" | "dep">("rent");
  const cur = (f: FloorRow) => axis === "rent" ? f.cur : (f.cur_dep ?? 0);
  const mkt = (f: FloorRow) => axis === "rent" ? f.mkt : (f.mkt_dep ?? 0);
  const hasDep = rows.some((f) => (f.cur_dep ?? 0) > 0 || (f.mkt_dep ?? 0) > 0);
  const max = Math.max(1, ...rows.flatMap((f) => [cur(f), mkt(f)]));
  const shown = all ? rows : rows.slice(0, CAP);
  const man = (v: number) => `${Math.round(v / 1e4).toLocaleString()}만`;
  const tot = axis === "rent" ? total?.rent ?? null : total?.dep ?? null;
  const totMkt = axis === "rent" ? total?.mktRent ?? null : total?.mktDep ?? null;
  const sideTxt = axis === "rent" ? side?.rent : side?.dep;
  return (
    <section className="rv-card" id={id}>
      <div className="rv-ch">
        <span className="rv-k">임대료·보증금 <em className="rv-est">추정</em></span>
        {hasDep && (
          <span className="rv-seg">
            {([["rent", "임대료"], ["dep", "보증금"]] as const).map(([k, l]) => (
              <button key={k} className={axis === k ? "on" : ""} onClick={() => setAxis(k)}>{l}</button>
            ))}
          </span>
        )}
        <span className="rv-lg"><i className="me" />이 건물<i className="tk" />주변 시세</span>
      </div>

      {/* 총액 한 줄 — 아래 층별 막대와 같은 축(임대료/보증금)을 따라 갈아 끼운다 */}
      {tot != null && (
        <div className="rt-sum">
          <b className="num">{man(tot)}</b>
          {/* 차이는 금액과 백분율을 같이 — Pair(임대료·실거래)와 같은 표기다.
              여기서 Pair 를 그대로 쓰지 않는 이유는 막대다: 바로 아래 층별 막대가 층 최대값을
              자로 쓰는데, Pair 는 제 값으로 자를 잡아 길이가 어긋난다(2026-08-26). */}
          {totMkt != null && (
            <i className={tot >= totMkt ? "up" : ""}>
              주변 대비 {tot >= totMkt ? "+" : "−"}{man(Math.abs(tot - totMkt))}
              <em>{tot >= totMkt ? "+" : "−"}{Math.round(Math.abs((tot - totMkt) / totMkt) * 100)}%</em>
            </i>
          )}
          {sideTxt && <span className="p">{sideTxt}</span>}
        </div>
      )}
      <div className="rv-stack">
        {shown.map((f) => {
          const a = cur(f), b = mkt(f);
          // 차이는 돈으로 — 「−12%」보다 「87만 적음」이 바로 온다(2026-08-25)
          const d = b ? a - b : null;
          return (
            <div className="rv-fl" key={f.floor}>
              <span className="n">{f.floor}</span>
              <span className="g">
                <i style={{ width: `${Math.max(2, a / max * 100)}%` }} />
                {b > 0 && <u style={{ left: `${Math.min(99.4, b / max * 100)}%` }} />}
              </span>
              <span className="v">{man(a)}
                {d != null && Math.round(Math.abs(d) / 1e4) > 0 && (
                  <small className={d >= 0 ? "up" : ""}>{d >= 0 ? "+" : "−"}{man(Math.abs(d))}</small>)}
              </span>
            </div>
          );
        })}
      </div>
      {rows.length > CAP && (
        <button className="rv-more" onClick={() => setAll(!all)}>
          {all ? "접기" : `${rows.length - CAP}개 층 더보기`}</button>
      )}
    </section>
  );
}

/** 견줌 하나 — 막대는 이 건물, 눈금이 주변. 층별 카드와 같은 문법이다.
 *  차이는 **퍼센트가 아니라 돈**으로 적는다 — 「5% 낮음」보다 「117만 적음」이 바로 온다.
 */
