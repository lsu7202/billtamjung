import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchApi } from "../../shared/api/endpoints";
import { useEnums } from "../../shared/hooks/useEnums";
import "./draft/salestab.css";

/* 고객 칸 묶음(S09 §3-1, 2026-10-04) — 중개사 고객 판과 고객 프로필(마이페이지)이 **같은 부품**을 쓴다.
 * 같은 칸 · 같은 순서 · 같은 그리드 줄이라, 고객이 적은 칸이 중개사 판에서 같은 자리에 선다.
 *   찾는 것  희망매매가 · 목표 · 원하는 지역 · 매수 시기 · 건축의사
 *   사람     개인/법인 · 시드 · 매입 경험 · 메모
 * 줄 문법: 선택 칸은 줄 안에 깔리고 고른 칸 재클릭 = 미지정. 숫자 · 글자 칸은 클릭-편집(벗어나면 저장, 비우면 지움).
 * set 에 null 을 주면 그 칸을 지운다는 뜻이다 — 저장 방식(부분 수정 · 통째 저장)은 쓰는 쪽이 정한다. */

// 갈래 값은 **정본에서 읽는다**(10-04) — ref.enums(customer_goal · customer_timing · build_intent · customer_experience) ·
// 지역 목록(master.region_index). 손으로 적어 두면 모델 쪽(서버)과 화면이 다른 목록을 갖게 된다

export interface CustomerFieldValues {
  budget_min: number | null; budget_max: number | null; budget_any: boolean | null;
  goal: string[] | null; regions: string[] | null; timing: string | null; build_intent: string | null;
  is_corp: boolean | null; equity_won: number | null; experience: string | null; note: string | null;
}

const eok = (v: number) => `${String(Math.round(v / 1e7) / 10).replace(/\.0$/, "")}억`;
/** 희망매매가 글자 — 「30~50억」 · 「40억」(두 칸이 같음) · 「50억 이하」 · 「100억 이상」 · 「상관없음」 */
export function budgetText(v: Pick<CustomerFieldValues, "budget_min" | "budget_max" | "budget_any">): string {
  if (v.budget_any) return "상관없음";
  const lo = v.budget_min ?? null, hi = v.budget_max ?? null;
  if (lo != null && hi != null && lo === hi) return eok(lo);
  return lo != null && hi != null ? `${eok(lo).replace("억", "")}~${eok(hi)}` : hi != null ? `${eok(hi)} 이하` : lo != null ? `${eok(lo)} 이상` : "";
}

export function CustomerFields({ v, set, noteLabel = "메모", wantExtra, onErr, layout = "one" }: {
  v: CustomerFieldValues; set: (p: Partial<CustomerFieldValues>) => void;
  /** 메모 줄 이름 — 중개사 판은 「비고」(엑셀 열 이름) */
  noteLabel?: string;
  /** 「원하는 것」 맨 아래에 더 붙일 줄(중개사 판의 광고 매물 선호) */
  wantExtra?: React.ReactNode;
  onErr?: (m: string) => void;
  /** one = 한 열(중개사 옆 판) · two = 두 열(고객 내 정보, 화면 폭) — 묶음 머리 줄은 없다(10-04).
   *  왼쪽 열 = 무엇을 찾는가, 오른쪽 열 = 사람에 대한 것. 원하는 지역은 칸이 많아 한 줄 전체 */
  layout?: "one" | "two";
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const { options } = useEnums();
  const opt = (k: string) => options(k).map((o) => o.label);
  const regionsQ = useQuery({ queryKey: ["regions"], queryFn: searchApi.regions, staleTime: 60 * 60_000 });
  const GU = Object.keys(regionsQ.data ?? {}).sort((a2, b2) => a2.localeCompare(b2, "ko"));
  const [txt, setTxt] = useState("");

  const chips = (label: string, opts: [string, string][], cur: string[], pick: (next: string[]) => void, multi = false) => (
    <div className="lgx-r">
      <span className="lgx-k">{label}</span>
      <div className="lgx-v iq-v"><span className="lgx-chips">{opts.map(([k, l]) => {
        const on = cur.includes(k);
        return <button key={k} className={on ? "on" : ""}
          onClick={() => pick(multi ? (on ? cur.filter((x) => x !== k) : [...cur, k]) : on ? [] : [k])}>{l}</button>;
      })}</span></div>
    </div>
  );
  const pair = (xs: string[]) => xs.map((x) => [x, x] as [string, string]);
  /** 억 칸 하나 — 클릭-편집. 비우면 지움 */
  const eokCell = (k: "budget_min" | "budget_max" | "equity_won", ph: string, extra: Partial<CustomerFieldValues> = {}) => {
    const open = edit === k, cur = v[k];
    const save = () => {
      setEdit(null);
      const t = txt.trim().replace(/[,억\s]/g, "");
      if (!t) return set({ [k]: null });
      const x = Number(t);
      if (!Number.isFinite(x) || x < 0) { onErr?.("억 단위 숫자로 적으세요"); return; }
      set({ [k]: Math.round(x * 1e8), ...extra });
    };
    return (
      <span className={`cx-bud ${open ? "open" : ""}`} onClick={() => { if (!open) { setEdit(k); setTxt(cur != null ? String(cur / 1e8) : ""); } }}>
        {open ? <input autoFocus className="lgx-in" value={txt} placeholder={ph} inputMode="decimal"
          onChange={(e) => setTxt(e.target.value)} onBlur={save}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEdit(null); }} />
          : <b className="num">{cur != null && !(k !== "equity_won" && v.budget_any) ? eok(cur) : ""}</b>}
      </span>
    );
  };
  const noteOpen = edit === "note";
  // 희망매매가 — 칸 둘(최소 ~ 최대). 둘이 같으면 정해진 값. 「상관없음」은 빈칸(모름)과 다른 값
  const budget = (
    <div className="lgx-r" key="budget">
      <span className="lgx-k">희망매매가</span>
      <div className="lgx-v iq-v cx-buds">
        {eokCell("budget_min", "최소", { budget_any: null })}<span className="cx-tilde">~</span>{eokCell("budget_max", "최대", { budget_any: null })}
      </div>
      <span className="lgx-chips cx-any"><button className={v.budget_any ? "on" : ""}
        onClick={() => set(v.budget_any ? { budget_any: null } : { budget_any: true, budget_min: null, budget_max: null })}>상관없음</button></span>
    </div>
  );
  const goal = chips("목표", pair(opt("customer_goal")), v.goal ?? [], (x) => set({ goal: x.length ? x : null }), true);
  const regions = (
    <div className="lgx-r cx-gu-r" key="regions">
      <span className="lgx-k">원하는 지역</span>
      <div className="lgx-v iq-v"><span className="lgx-chips cx-gu">{GU.map((g) => {
        const cur = v.regions ?? [], on = cur.includes(g);
        return <button key={g} className={on ? "on" : ""}
          onClick={() => { const n = on ? cur.filter((x) => x !== g) : [...cur, g]; set({ regions: n.length ? n : null }); }}>{g}</button>;
      })}</span></div>
    </div>
  );
  const timing = chips("매수 시기", pair(opt("customer_timing")), v.timing ? [v.timing] : [], (x) => set({ timing: x[0] ?? null }));
  const build = chips("건축의사", pair(opt("build_intent")), v.build_intent ? [v.build_intent] : [], (x) => set({ build_intent: x[0] ?? null }));
  const corp = chips("개인/법인", [["p", "개인"], ["c", "법인"]], v.is_corp == null ? [] : [v.is_corp ? "c" : "p"],
    (x) => set({ is_corp: x.length ? x[0] === "c" : null }));
  const seed = <div className="lgx-r"><span className="lgx-k">시드</span><div className="lgx-v iq-v cx-buds">{eokCell("equity_won", "억")}</div></div>;
  const exp = chips("매입 경험", pair(opt("customer_experience")), v.experience ? [v.experience] : [], (x) => set({ experience: x[0] ?? null }));
  const note = (
    <div className={`lgx-r ${noteOpen ? "open" : ""}`}>
      <span className="lgx-k">{noteLabel}</span>
      <div className="lgx-v" onClick={() => { if (!noteOpen) { setEdit("note"); setTxt(v.note ?? ""); } }}>
        {noteOpen
          ? <textarea autoFocus className="lgx-in cx-ta" value={txt} onChange={(e) => setTxt(e.target.value)}
              onBlur={() => { setEdit(null); set({ note: txt.trim() || null }); }} onKeyDown={(e) => { if (e.key === "Escape") setEdit(null); }} />
          : <b className="cx-pre">{v.note ?? ""}</b>}
      </div>
    </div>
  );
  if (layout === "two") return (
    <div className="cxf-two">
      <div className="cxf-col">{budget}{goal}{timing}{build}{wantExtra}</div>
      <div className="cxf-col">{corp}{seed}{exp}{note}</div>
      <div className="cxf-full">{regions}</div>
    </div>
  );
  // 한 열 — 찾는 것과 사람 사이에 굵은 선 하나
  return <>
    {budget}{goal}{regions}{timing}{build}{wantExtra}
    <div className="cxf-sep" />
    {corp}{seed}{exp}{note}
  </>;
}
