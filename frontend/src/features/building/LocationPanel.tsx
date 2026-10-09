/** 교통 — 지번 페이지 · 탐색 사이드 판이 같이 쓴다. 입지 탭(유동인구 지도)은 옛 상세와 함께 걷었다(10-08) */
/** 노선 색 — 실무에서 「9호선」은 곧 그 색이다. 앱의 파랑 하나 규칙에 얹는 예외가 아니라,
 *  노선 이름 자체가 색으로 통용되는 정보라서 쓴다(지도 타일도 같은 색으로 그린다).
 *  마스터 subway_json 에 실제로 들어 있는 27종을 다 받는다 — 「9호선(연장)」처럼
 *  꼬리가 붙은 이름은 앞에서부터 맞춰 본다. */
const LINE_COLOR: [string, string][] = [
  ["1호선", "#0052A4"], ["2호선", "#00A84D"], ["3호선", "#EF7C1C"], ["4호선", "#00A5DE"],
  ["5호선", "#996CAC"], ["6호선", "#CD7C2F"], ["7호선", "#747F00"], ["8호선", "#E6186C"],
  ["9호선", "#BDB092"], ["신분당선", "#D31145"], ["신림선", "#6789CA"], ["우이신설선", "#B7C452"],
  ["경의중앙선", "#77C4A3"], ["중앙선", "#77C4A3"], ["경춘선", "#0C8E72"], ["분당선", "#FABE00"],
  ["공항철도", "#0090D2"], ["김포골드라인", "#AD8605"], ["서해선", "#8FC31F"], ["일산선", "#00A5DE"],
  ["과천선", "#00A5DE"], ["경부선", "#0052A4"], ["경인선", "#0052A4"], ["경원선", "#0052A4"],
  ["수도권 광역급행철도", "#9A6292"],
];
export const lineColor = (v: string) =>
  LINE_COLOR.find(([k]) => v.startsWith(k))?.[1] ?? "#8B95A1";

/** 교통 — 호선마다 가장 가까운 역 하나, 그리고 버스 정류소 둘. 두 줄이면 끝난다.
 *
 *  호선당 하나만 남기는 이유: 같은 호선의 둘째 역은 첫째보다 늘 멀어서, 걸어갈 곳을
 *  고를 때 쓸 일이 없다. 그렇게 줄이면 **몇 개 호선이 걸리는가**가 알약 개수로 바로 보인다 —
 *  실무에서 「9·7·2호선 물린다」가 이 자리를 설명하는 말이다.
 *
 *  버스는 뺐다가 되살렸다(2026-08-26). 「정류소는 어디에나 있다」고 봤는데, 상업용 건물에서
 *  버스 접근은 유동인구와 곧바로 이어진다 — 지하철이 먼 자리일수록 더 그렇다.
 *  정류장 이름이 길어(「봉은사역.코엑스인터컨티넨탈」) 지하철과 같은 줄에 못 섞고 아래 줄로 뺀다.
 */
/** 역(호선별 최단) · 버스(이름으로 접은 가까운 둘) — 입지 탭과 탐색 사이드 판이 같이 쓴다 */
export function transitOf(b: Record<string, unknown>) {
  const parse = (v: unknown) => {
    try {
      const a = typeof v === "string" ? JSON.parse(v || "[]") : (v ?? []);
      return Array.isArray(a) ? a as Record<string, unknown>[] : [];
    } catch { return []; }
  };
  const bus: { name: string; dist: number }[] = [];
  parse(b.bus_json).forEach((x) => {
    const name = String(x.정류장명 ?? "");
    if (!name || bus.some((v) => v.name === name) || bus.length >= 2) return;
    bus.push({ name, dist: Number(x.거리) || 0 });
  });
  const seen = new Map<string, { name: string; dist: number }>();
  parse(b.subway_json).forEach((x) => {
    const line = String(x.호선 ?? "");
    if (!line || seen.has(line)) return;
    seen.set(line, { name: String(x.역명 ?? ""), dist: Number(x.거리) || 0 });
  });
  return { subway: [...seen.entries()].sort((a, c) => a[1].dist - c[1].dist), bus };
}

export function Transit({ b, id }: { b: Record<string, unknown>; id?: string }) {
  const parse = (v: unknown) => {
    try {
      const a = typeof v === "string" ? JSON.parse(v || "[]") : (v ?? []);
      return Array.isArray(a) ? a as Record<string, unknown>[] : [];
    } catch { return []; }        // 깨진 JSON 이면 아무것도 안 그린다
  };
  const subs = parse(b.subway_json);
  // 정류장 이름이 같은 곳이 방향별로 둘씩 실린다(「봉은사.코엑스북문」 190m·313m) — 이름으로 접는다
  const bus: { name: string; dist: number }[] = [];
  parse(b.bus_json).forEach((x) => {
    const name = String(x.정류장명 ?? "");
    if (!name || bus.some((v) => v.name === name) || bus.length >= 2) return;
    bus.push({ name, dist: Number(x.거리) || 0 });
  });
  if (!subs.length && !bus.length) return null;

  // 호선별 최단. subway_json 은 이미 거리순이라 처음 만난 것이 그 호선의 최단이다.
  const seen = new Map<string, { name: string; dist: number }>();
  subs.forEach((x) => {
    const line = String(x.호선 ?? "");
    if (!line || seen.has(line)) return;
    seen.set(line, { name: String(x.역명 ?? ""), dist: Number(x.거리) || 0 });
  });
  const rows = [...seen.entries()].sort((a, c) => a[1].dist - c[1].dist);

  return (
    <section className="rv-card" id={id}>
      <span className="rv-k">교통</span>
      {rows.length > 0 && (
        <div className="rv-one">
          {rows.map(([line, st], i) => (
            <span className={`u${i === 0 ? " near" : ""}`} key={line}>
              <i className="lb" style={{ background: lineColor(line) }}>{line}</i>
              <b>{st.name}</b><span className="num">{st.dist.toLocaleString()}m</span>
            </span>
          ))}
        </div>
      )}
      {bus.length > 0 && (
        // 역과 같은 문법 — 항목마다 알약이 붙는다. 앞에 하나만 두면 둘이 서로 다른 줄로 읽힌다.
        // 노선 이름이 없으니 알약은 「버스」 하나뿐이지만, 모양이 같아야 나란히 읽힌다(2026-08-26).
        <div className="rv-one bus">
          {bus.map((s) => (
            <span className="u" key={s.name}>
              <i className="lb">버스</i>
              <b>{s.name}</b><span className="num">{s.dist.toLocaleString()}m</span>
            </span>
          ))}
        </div>
      )}
    </section>
  );
}

