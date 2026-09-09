/** 그릇 다섯 — kv · stats · table · chart · list. 정본 §12-1-1
 *
 *  전용 부품을 안 만든다. **데이터만 있으면 채워지는 그릇**이라 새 자료가 와도 부품이 안 는다.
 *  값은 서버가 `ui` 도구에서 채워 보낸다(참조 `source` 면 토큰 0). 모델은 이름과 인자만 낸다.
 *
 *  발(foot)은 **부품이 스스로 그린다.** 유동인구 옆에 「참조 · KT 통신량 추정」이 저절로 서고,
 *  모델이 그걸 안 붙여도 값의 모양이 지킨다(§16 과 같은 수).
 *
 *  폭은 방향이 아니라 **캔버스 폭**에 반응한다(§11-3-1). 채팅은 좁다, 문서는 중간, 슬라이드는 넓다. */
import React from "react";

import "./grids.css";

// 발엔 등급과 출처만. 조건·요약(note)은 붙이지 않는다 — 설명글씨 금지(2026-09-09 대표)
export type Foot = { grade?: string; source?: string };

/** 부품 다섯이 더 붙었다(지도·사진·묶음·층별·달력). 발·제목·테두리는 여기 하나로 — 새 부품이
 *  제 테두리를 그리기 시작하면 카드가 두 겹으로 겹친다. */
export function Frame({ title, foot, children }: { title?: string; foot?: Foot; children: React.ReactNode }) {
  return (
    <div className="gd">
      {title && <div className="gd-t">{title}</div>}
      {children}
      {foot?.source && (
        <div className="gd-f">
          {foot.grade && <span className={`gd-g ${foot.grade === "참조" ? "r" : ""}`}>{foot.grade}</span>}
          <span>{foot.source}</span>
        </div>
      )}
    </div>
  );
}

const s = (v: unknown) => (v == null || v === "" ? "—" : String(v));

export function KV({ p }: { p: Record<string, any> }) {
  const rows: [string, unknown][] = Array.isArray(p.rows) ? p.rows : [];
  if (!rows.length) return null;
  return (
    <Frame title={p.title} foot={p.foot}>
      <dl className={`gd-kv ${(p.cols ?? 2) >= 2 ? "two" : ""}`}>
        {rows.map(([k, v], i) => (<React.Fragment key={i}><dt>{k}</dt><dd>{s(v)}</dd></React.Fragment>))}
      </dl>
    </Frame>
  );
}

export function Stats({ p }: { p: Record<string, any> }) {
  const items: any[] = Array.isArray(p.items) ? p.items : [];
  if (!items.length) return null;
  return (
    <Frame title={p.title} foot={p.foot}>
      <div className="gd-st" style={{ ["--n" as any]: Math.min(items.length, 4) }}>
        {items.map((it, i) => (
          <div className="gd-s" key={i}>
            <div className="l">{it.label}</div>
            <div className="v">{typeof it.value === "number" ? it.value.toLocaleString() : s(it.value)}
              {it.unit && <i>{it.unit}</i>}</div>
            {it.note && <div className="n">{it.note}</div>}
          </div>
        ))}
      </div>
    </Frame>
  );
}

export function Table({ p }: { p: Record<string, any> }) {
  const head: string[] = Array.isArray(p.head) ? p.head : [];
  const rows: unknown[][] = Array.isArray(p.rows) ? p.rows : [];
  if (!rows.length) return null;
  // 숫자로 읽히는 칸은 오른쪽. 첫 줄로 정한다
  const right = head.map((_, i) => rows.some((r) => typeof r[i] === "number" || /^[\d,.\s]+[억평%㎡만원m]/.test(String(r[i] ?? ""))));
  return (
    <Frame title={p.title} foot={p.foot}>
      <div className="gd-wrap">
        <table className="gd-tb">
          {head.length > 0 && <thead><tr>{head.map((h, i) => <th key={i} className={right[i] ? "r" : ""}>{h}</th>)}</tr></thead>}
          <tbody>{rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j} className={right[j] ? "r" : ""}>{s(c)}</td>)}</tr>))}</tbody>
        </table>
      </div>
    </Frame>
  );
}

export function List({ p }: { p: Record<string, any> }) {
  const items: any[] = Array.isArray(p.items) ? p.items : [];
  if (!items.length) return null;
  return (
    <Frame title={p.title} foot={p.foot}>
      <div className="gd-li">
        {items.map((it, i) => (
          <div className="gd-l" key={i}>
            {it.tag && <span className="g">{it.tag}</span>}
            <span className="t">{s(it.title)}</span>
            {it.sub && <span className="s">{it.sub}</span>}
          </div>
        ))}
      </div>
    </Frame>
  );
}

/** 선·막대. 라이브러리를 안 쓴다 — 인라인 SVG 라야 문서·PDF 로 그대로 굽힌다(§11) */
export function Chart({ p }: { p: Record<string, any> }) {
  const xs: (string | number)[] = Array.isArray(p.x) ? p.x : [];
  const ser: any[] = Array.isArray(p.series) ? p.series : [];
  const data: number[] = (ser[0]?.data ?? []).filter((v: unknown) => typeof v === "number");
  if (!data.length) return null;
  const bar = p.kind === "bar";
  const W = 520, H = bar ? Math.max(90, data.length * 30 + 26) : 190;
  const max = Math.max(...data, p.mark ? Math.max(...Object.values(p.mark).map(Number)) : 0) * 1.08;
  const fmt = (v: number) => v.toLocaleString();

  if (bar) {
    const LB = 128, BW = W - LB - 56;
    return (
      <Frame title={p.title} foot={p.foot}>
        <svg viewBox={`0 0 ${W} ${H}`} className="gd-ch" role="img"
             aria-label={`${ser[0]?.name ?? ""} 막대 ${data.length}개`}>
          {data.map((v, i) => {
            const y = i * 30 + 4, w = Math.max(2, (v / max) * BW);
            return (<g key={i}>
              <text x="0" y={y + 13} className="gd-lb">{String(xs[i] ?? "")}</text>
              <rect x={LB} y={y} width={w} height="17" rx="4" fill="var(--blue)" opacity={1 - i * 0.11} />
              <text x={LB + w + 6} y={y + 13} className="gd-vl">{fmt(v)}</text>
            </g>);
          })}
          {p.mark && Object.entries(p.mark).map(([k, v]) => {
            const x = LB + (Number(v) / max) * BW;
            return (<g key={k}>
              <line x1={x} y1="0" x2={x} y2={data.length * 30} stroke="var(--red)" strokeWidth="1.3" strokeDasharray="4 4" opacity=".7" />
              <text x={x} y={data.length * 30 + 15} className="gd-mk" textAnchor="middle">{k} {fmt(Number(v))}</text>
            </g>);
          })}
        </svg>
        {p.unit && <div className="gd-u">{p.unit}</div>}
      </Frame>
    );
  }

  const L = 46, R = 510, T = 20, B = 160;
  const px = (i: number) => L + (i * (R - L)) / Math.max(1, data.length - 1);
  const py = (v: number) => B - (v / max) * (B - T);
  const line = data.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const step = Math.ceil(data.length / 4);
  return (
    <Frame title={p.title} foot={p.foot}>
      <svg viewBox={`0 0 ${W} ${H}`} className="gd-ch" role="img"
           aria-label={`${ser[0]?.name ?? ""} 추이 ${xs[0]} ${fmt(data[0])} → ${xs[xs.length - 1]} ${fmt(data[data.length - 1])}`}>
        {[0, 1, 2, 3].map((i) => <line key={i} x1={L} y1={T + i * 40} x2={R} y2={T + i * 40} stroke="var(--line-2)" />)}
        <path d={`${line} L${px(data.length - 1).toFixed(1)},${B} L${px(0).toFixed(1)},${B} Z`} fill="var(--blue)" opacity=".08" />
        <path d={line} fill="none" stroke="var(--blue)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={px(data.length - 1)} cy={py(data[data.length - 1])} r="4" fill="var(--blue)" />
        <text x={R} y={py(data[data.length - 1]) - 9} className="gd-vl" textAnchor="end">{fmt(data[data.length - 1])}</text>
        {xs.map((x, i) => (i % step === 0 || i === xs.length - 1
          ? <text key={i} x={px(i)} y={H - 12} className="gd-ax" textAnchor="middle">{String(x)}</text> : null))}
      </svg>
      {p.unit && <div className="gd-u">{p.unit}</div>}
    </Frame>
  );
}
