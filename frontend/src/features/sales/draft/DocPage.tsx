/** 문서 페이지 — 새탭 전체화면. 계약서 · 확인설명서 · 영수증.
 *
 *  양식 = 협회 골격 · 별지 20호의2 · 영수증 2매(아티팩트 「계약 문서 양식」).
 *  파랑 = 자동 씨앗(클릭 편집, 고치면 잉크색). 점선 = 손 칸.
 *  돈은 값 하나 — 한글·숫자가 같이 파생된다(억 단위로 입력).
 *  조문은 문단을 클릭해 통째로 고칠 수 있다 — 고친 문구는 그 계약에만 산다.
 *  특약은 쓰는 만큼 늘어난다 — 종이 안에서 바로 쓰고, 예시 묶음은 골라 넣는 것.
 *  주민등록번호는 어디에도 저장하지 않는다 — 이 탭의 상태로만 살다 인쇄되고 사라진다.
 *  인쇄는 @page 여백 0 — 브라우저 머리말·꼬리말(주소·날짜)이 종이에 안 박힌다.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  buildingsApi, officeApi, papersApi, proposalsApi, rentsApi, salesApi,
} from "../../../shared/api/endpoints";
import { formatPhone, parseAmount, seedAmount } from "../../building/KV";
import { exportDocx } from "./exportDoc";
import "./docpage.css";

const CLAUSES = [
  { t: "완전한 명도", c: "매도인은 잔금일까지 임차인·점유자 전원을 퇴거시키고 금전관계를 정산하며, 동산·폐기물을 반출하고 열쇠·출입카드·비밀번호를 인도하여 매수인이 즉시 점유·사용·수익할 수 있는 상태로 인도한다." },
  { t: "위반사항 원상복구", c: "공부와 다르게 사용 중인 부분은 쌍방이 상호 확인하였으며, 매도인은 잔금일 전까지 원상복구 또는 적법화를 책임진다." },
  { t: "세금·공과금 정산", c: "재산세·공과금·관리비는 잔금일을 기준으로 일할 정산하며, 잔금일 이전 발생분은 매도인이 부담한다." },
  { t: "현황매매", c: "본 계약은 현 시설물 상태 그대로의 매매이며, 면적·구조는 공부상 기재를 기준으로 한다(수량지정매매가 아니다)." },
  { t: "해약금 약정", c: "계약금은 민법 제565조의 해약금 및 위약금으로 본다." },
  { t: "지급계좌 지정", c: "매매대금은 매도인 명의 계좌(　　은행 · 예금주 　　 · 계좌번호 　　)로 지급한다." },
];

const HD = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"];
const HU = ["", "십", "백", "천"];
const HB = ["", "만", "억", "조"];
function han(n: number | null): string {
  if (n == null || n <= 0) return "";
  let s = ""; let big = 0;
  while (n > 0) {
    const chunk = n % 10000;
    if (chunk) {
      let c = ""; let x = chunk; let u = 0;
      while (x > 0) { const d = x % 10; if (d) c = HD[d] + HU[u] + c; x = Math.floor(x / 10); u++; }
      s = c + HB[big] + s;
    }
    n = Math.floor(n / 10000); big++;
  }
  return s;
}
const comma = (n: number | null) => (n != null ? n.toLocaleString() : "");

type Kind = "계약서" | "확인설명서" | "영수증" | "임차인 현황표";

/** 쪽 나눔 — 화면 종이가 곧 인쇄 쪽(1:1). A4 내용 높이(297−여백 28mm)를 재서
 *  넘치면 마지막 블록을 다음 종이로 밀고, 자리가 나면 도로 당긴다. 편집 중엔 얼린다. */
const PAGE_CAP = (297 - 28) * 96 / 25.4;
function Pages({ blocks, frozen }: { blocks: ReactNode[]; frozen: boolean }) {
  const [split, setSplit] = useState<number[]>([]);
  const wrap = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (frozen) return;
    const w = wrap.current; if (!w) return;
    const starts = [0, ...split.filter((x) => x > 0 && x < blocks.length)];
    const docs = Array.from(w.querySelectorAll(":scope > .sheet > .doc")) as HTMLElement[];
    for (let p = 0; p < docs.length; p++) {
      const kids = Array.from(docs[p].children) as HTMLElement[];
      if (!kids.length) continue;
      const top0 = kids[0].offsetTop;
      const last = kids[kids.length - 1];
      const used = last.offsetTop - top0 + last.getBoundingClientRect().height;
      if (used > PAGE_CAP && kids.length > 1) {
        const breakAt = starts[p] + kids.length - 1;
        setSplit((s) => [...new Set([...s.filter((x) => x !== breakAt), breakAt])].sort((a, b) => a - b));
        return;
      }
      const nextStart = starts[p + 1];
      const first = docs[p + 1]?.children[0] as HTMLElement | undefined;
      if (nextStart != null && first) {
        const h = first.getBoundingClientRect().height + 6;
        if (used + h <= PAGE_CAP) {
          setSplit((s) => [...new Set(s.map((x) => (x === nextStart ? x + 1 : x))
            .filter((x) => x > 0 && x < blocks.length))].sort((a, b) => a - b));
          return;
        }
      }
    }
  });
  const starts = [0, ...split.filter((x) => x > 0 && x < blocks.length)];
  return (
    <div ref={wrap}>
      {starts.map((s, i) => (
        <div key={i} className="sheet"><div className="doc">
          {blocks.slice(s, starts[i + 1] ?? blocks.length)}
        </div></div>
      ))}
    </div>
  );
}

export function DocPage() {
  const { pk = "" } = useParams();
  const b = useQuery({ queryKey: ["doc-b", pk], queryFn: () => buildingsApi.get(pk) });
  const sellers = useQuery({ queryKey: ["sellers"], queryFn: () => salesApi.sellers() });
  const props2 = useQuery({ queryKey: ["proposals", "pk", pk], queryFn: () => proposalsApi.list({ building_pk: pk }) });
  const office = useQuery({ queryKey: ["draft-office"], queryFn: officeApi.get });
  const rents = useQuery({ queryKey: ["doc-rents", pk], queryFn: () => rentsApi.list(pk) });

  const bd = (b.data ?? {}) as Record<string, unknown>;
  const bs = (k: string) => { const x = bd[k]; return x == null ? null : String(x); };
  const bn = (k: string) => { const x = Number(bd[k]); return Number.isFinite(x) && x !== 0 ? x : null; };
  const r = (sellers.data ?? []).find((x) => x.building_pk === pk) ?? null;
  const lead = (props2.data ?? []).find((x) => x.picked_at) ?? null;
  const of = office.data;

  const [kind, setKind] = useState<Kind>("계약서");
  const [v, setV] = useState<Record<string, string>>({});
  const [ed, setEd] = useState<string | null>(null);
  const [tx, setTx] = useState("");
  const [idno, setIdno] = useState({ s: "", b: "" });
  const [terms, setTerms] = useState<string[]>([]);
  /* 조항 — 표준 9개로 시작하는 목록. 추가·삭제·수정이 자유롭고 번호는 자리가 정한다(2026-08-23).
   * text=null 이면 표준 문구(동적 씨앗 포함)로 렌더된다. 세밀한 편집은 내보내기로. */
  type Art = { k: string; label: string; text: string | null };
  const STD_ARTS: { k: string; label: string }[] = [
    { k: "art1", label: "목적" }, { k: "art2", label: "소유권 이전 등" }, { k: "art3", label: "제한물권 등의 소멸" },
    { k: "art4", label: "지방세 등" }, { k: "art5", label: "계약의 해제" }, { k: "art6", label: "채무불이행과 손해배상" },
    { k: "art7", label: "중개보수" }, { k: "art8", label: "중개보수 외" }, { k: "art9", label: "중개대상물확인·설명서 교부 등" },
  ];
  const [arts, setArts] = useState<Art[]>(STD_ARTS.map((a) => ({ ...a, text: null })));
  const [artN, setArtN] = useState(1);   // 새 조항 키 일련
  const [tIn, setTIn] = useState("");
  const [tEd, setTEd] = useState<number | null>(null);
  const [tTx, setTTx] = useState("");
  const [rcpt, setRcpt] = useState("계약금");
  const [saved, setSaved] = useState(false);
  const [tFocus, setTFocus] = useState(false);
  /* 씨앗 우선(2026-08-23 확정) — DB가 정본인 칸은 열 때마다 현재 씨앗이 이긴다.
   * 저장본의 손 값은 씨앗이 없는 칸에서만 살아나고, 이번 세션의 손 편집(dirty)만 씨앗을 덮는다.
   * 값을 바꾸려면 정본(계약 탭·소유자 탭·일정)에서 바꾸는 것이 원칙, 문서 편집은 그 인쇄만의 예외. */
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const mark = (k: string) => setDirty((p) => new Set(p).add(k));

  /* 저장·복원 — 종류별 한 판. 주민등록번호(idno)는 body에 안 넣고 안 되살린다(무저장 확정). */
  const papers = useQuery({ queryKey: ["papers", lead?.id], enabled: lead != null,
    queryFn: () => papersApi.get(lead!.id) });
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (hydrated || !papers.data) return;
    const merged: Record<string, string> = {};
    let tm: string[] = [];
    for (const k of ["계약서", "확인설명서", "영수증"] as const) {
      const body = papers.data[k] as {
        v?: Record<string, string>; terms?: string[];
        picked?: number[]; added?: string[]; rcpt?: string;
      } | undefined;
      if (!body) continue;
      Object.assign(merged, body.v ?? {});
      if (k === "계약서") {
        tm = body.terms
          ?? [...(body.picked ?? []).map((i) => CLAUSES[i]?.c).filter((x): x is string => !!x),
              ...(body.added ?? [])];
        const ba = (body as { arts?: Art[] }).arts;
        if (ba?.length) setArts(ba);
        else {
          // 구버전 — v.artN 덮어쓰기만 있던 시절의 저장본을 목록으로 이관
          const legacy = STD_ARTS.map((a) => ({ ...a, text: (body.v?.[a.k] as string) ?? null }));
          if (legacy.some((a) => a.text)) setArts(legacy);
        }
      }
      // 옛 저장본의 은어 이관(2026-08-24) — 가계약금 → 본계약 전 합의금
      if (k === "영수증" && body.rcpt) setRcpt(body.rcpt === "가계약금" ? "본계약 전 합의금" : body.rcpt);
    }
    if (Object.keys(merged).length) setV((p) => ({ ...merged, ...p }));
    if (tm.length) setTerms(tm);
    setHydrated(true);
  }, [papers.data, hydrated]);

  const save = async () => {
    if (!lead || kind === "임차인 현황표") return;
    await papersApi.put(lead.id, kind, { v, terms, rcpt, arts });
    setSaved(true); setTimeout(() => setSaved(false), 1200);
  };

  /* 자동 저장(F15) — 손을 뗀 뒤 1.5초. 탭을 닫아도 잃지 않는다 */
  useEffect(() => {
    if (!hydrated || !lead || kind === "임차인 현황표") return;
    const t = setTimeout(() => { papersApi.put(lead.id, kind, { v, terms, rcpt, arts }); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, terms, rcpt, arts, kind, hydrated, lead?.id]);

  /* 일정 — 계약·중도금·잔금 날짜와 금액의 그릇 */
  const leadScheds: { cat: string | null; on: string; amount?: number | null }[] = (() => {
    const x = (lead as unknown as { scheds?: unknown })?.scheds;
    if (Array.isArray(x)) return x as { cat: string | null; on: string; amount?: number | null }[];
    if (typeof x === "string") { try { return JSON.parse(x) ?? []; } catch { return []; } }
    return [];
  })();
  const schedOn = (cat: string) => leadScheds.find((s) => s.cat === cat)?.on ?? null;
  const schedAmt = (cat: string) => leadScheds.find((s) => s.cat === cat)?.amount ?? null;

  /* ── 돈 — 값 하나에서 한글·숫자 동시 파생. 입력은 억 단위(파서 어법 그대로) ── */
  const num = (k: string, seedN: number | null) =>
    dirty.has(k) && v[k] ? parseAmount(v[k])
      : seedN ?? (v[k] ? parseAmount(v[k]) : null);
  const deal = num("deal", lead?.deal_price ?? null);
  const down = num("down", lead?.down_payment ?? (deal != null ? Math.round(deal * 0.1) : null));
  const mid = num("mid", schedAmt("중도금"));   // 중도금 = 일정이 그릇(금액 포함)
  const pre = num("pre", lead?.pre_contract_amount ?? null);
  const bal = deal != null ? deal - (down ?? 0) - (mid ?? 0) - (pre ?? 0) : null;
  const rate = v["fee_rate"] ? (Number(v["fee_rate"]) || 0.9) : (of?.fee_rate ?? 0.9);
  const fee = deal != null ? Math.round(deal * rate / 100) : null;

  const money = (k: string, n: number | null, lock = false) => {
    if (ed === k) return (
      <>金 <input className="din" autoFocus value={tx} placeholder="억"
        onChange={(e) => setTx(e.target.value)}
        onBlur={() => { setEd(null); mark(k); setV((p) => { const q = { ...p }; if (tx.trim()) q[k] = tx.trim(); else delete q[k]; return q; }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} /> 원정</>
    );
    const open = lock ? undefined : () => { setEd(k); setTx(n != null ? seedAmount(n) : ""); };
    if (n == null) return <>金 <span className="b w" onClick={open} /> 원정</>;
    const cls = `dv ${!(dirty.has(k) && v[k]) ? "fill" : ""} ${lock ? "lock" : ""}`;
    return (
      <>金 <span className={cls} onClick={open}>{han(n)}</span> 원정
        <span className="won">( ₩ <span className={cls} onClick={open}>{comma(n)}</span> )</span></>
    );
  };

  const cell = (k: string, seed?: string | null, w?: string) => {
    if (ed === k) return (
      <input className={`din ${w ?? ""}`} autoFocus value={tx}
        onChange={(e) => setTx(e.target.value)}
        onBlur={() => { setEd(null); mark(k); setV((p) => { const q = { ...p }; if (tx.trim()) q[k] = tx.trim(); else delete q[k]; return q; }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    );
    const hand = dirty.has(k) && v[k] ? v[k] : null;
    const show = hand ?? seed ?? v[k] ?? null;   // 씨앗 우선 — 저장본 손 값은 씨앗 없는 칸에서만
    if (show == null) return <span className={`b ${w ?? ""}`} onClick={() => { setEd(k); setTx(""); }} />;
    return <span className={`dv ${hand ? "" : seed ? "fill" : ""}`}
      onClick={() => { setEd(k); setTx(show); }}>{show}</span>;
  };
  const ck = (k: string, on?: boolean) => {
    const cur = v[k] != null ? v[k] === "1" : !!on;
    return <span className="ckb" onClick={() => setV((p) => ({ ...p, [k]: cur ? "0" : "1" }))}>[{cur ? <b className="fill">✔</b> : "　"}]</span>;
  };
  const born = (x: string) => {
    const m = x.replace(/[^0-9]/g, "");
    if (m.length < 7) return null;
    const yy = Number(m.slice(0, 2)); const s7 = m[6];
    const c = s7 === "1" || s7 === "2" ? 1900 : s7 === "3" || s7 === "4" ? 2000 : null;
    if (c == null) return null;
    return `${c + yy}. ${m.slice(2, 4)}. ${m.slice(4, 6)}.`;
  };
  const rrn = (who: "s" | "b") => (
    <input className="din vol" placeholder="000000-0000000" maxLength={14} title="저장되지 않습니다"
      value={idno[who]} onChange={(e) => setIdno((p) => ({ ...p, [who]: e.target.value }))} />
  );

  /* ── 조항 — 목록이 정본. 문단 클릭 = 통째 수정, ✕ = 삭제, ＋ 조항 = 추가. 번호는 자리가 정한다 ── */
  const artText: Record<string, () => string> = {
    art1: () => "위 부동산의 매매에 대하여 매도인과 매수인은 합의에 의하여 매매대금을 아래와 같이 지불하기로 한다.",
    art2: () => `매도인은 매매대금의 잔금 수령과 동시에 매수인에게 소유권이전등기에 필요한 모든 서류를 교부하고 등기절차에 협력하며, 위 부동산의 인도일은 ${v["give_on"] || schedOn("잔금") || "    년  월  일"} 로 한다.`,
    art3: () => "매도인은 위 부동산에 설정된 저당권, 지상권, 임차권 등 소유권의 행사를 제한하는 사유가 있거나, 제세공과 기타 부담금의 미납금 등이 있을 때에는 잔금 수수일까지 그 권리의 하자 및 부담 등을 제거하여 완전한 소유권을 매수인에게 이전한다. 다만, 승계하기로 합의하는 권리 및 금액은 그러하지 아니하다.",
    art4: () => "위 부동산에 관하여 발생한 수익의 귀속과 제세공과금 등의 부담은 위 부동산의 인도일을 기준으로 하되, 지방세의 납부의무 및 납부책임은 지방세법의 규정에 의한다.",
    art5: () => "매수인이 매도인에게 중도금(중도금이 없을 때에는 잔금)을 지불하기 전까지, 매도인은 계약금의 배액을 상환하고, 매수인은 계약금을 포기하고 본 계약을 해제할 수 있다.",
    art6: () => "매도인 또는 매수인이 본 계약상의 내용에 대하여 불이행이 있을 경우 그 상대방은 불이행한 자에 대하여 서면으로 최고하고 계약을 해제할 수 있다. 그리고 계약당사자는 계약해제에 따른 손해배상을 각각 상대방에게 청구할 수 있으며, 손해배상에 대하여 별도의 약정이 없는 한 계약금을 손해배상의 기준으로 본다.",
    art7: () => `개업공인중개사는 매도인 또는 매수인의 본 계약 불이행에 대하여 책임을 지지 않는다. 또한, 중개보수는 본 계약체결과 동시에 계약 당사자 쌍방이 각각 지불하며, 개업공인중개사의 고의나 과실 없이 본 계약이 무효·취소 또는 해제되어도 중개보수는 지급한다. 공동 중개인 경우에 매도인과 매수인은 자신이 중개 의뢰한 개업공인중개사에게 각각 중개보수를 지급한다. (중개보수는 거래가액의 ${rate} %로 한다.)`,
    art8: () => "매도인 또는 매수인이 본 계약 이외의 업무를 의뢰한 경우 이에 관한 보수는 중개보수와 별도로 지급하며 그 금액은 합의에 의한다.",
    art9: () => `개업공인중개사는 중개대상물 확인·설명서를 작성하고 업무보증관계증서(공제증서 등) 사본을 첨부하여 계약체결과 동시에 거래당사자 쌍방에게 교부한다. (교부일자: ${v["issue_on"] || signSeed} )`,
  };
  const artBody = (a: { k: string; label: string; text: string | null }) =>
    a.text ?? artText[a.k]?.() ?? "";
  const artNode = (i: number, a: { k: string; label: string; text: string | null }, node: ReactNode) => (
    <div key={a.k} className="artw">
      <div className="art">
        제{i + 1}조 (
        {ed === `lb_${a.k}` ? (
          <input className="din" autoFocus value={tx} style={{ width: 150 }}
            onChange={(e) => setTx(e.target.value)}
            onBlur={() => { setEd(null); if (tx.trim()) setArts((p) => p.map((x, j) => j === i ? { ...x, label: tx.trim() } : x)); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        ) : (
          <span className="dv" onClick={() => { setEd(`lb_${a.k}`); setTx(a.label); }}>{a.label}</span>
        )})
        {a.text != null && <span className="apen" title="수정된 조항">✎</span>}
        <button className="adel" title="조항 삭제"
          onClick={() => setArts((p) => p.filter((_, j) => j !== i))}>✕</button>
      </div>
      {ed === `tx_${a.k}` ? (
        <textarea className="tta" autoFocus value={tx} rows={3}
          onChange={(e) => setTx(e.target.value)}
          onBlur={() => {
            setEd(null);
            const def = (artText[a.k]?.() ?? "").trim();
            setArts((p) => p.map((x, j) => {
              if (j !== i) return x;
              const t = tx.trim();
              return { ...x, text: !t || t === def ? null : t };
            }).filter((x, j) => !(j === i && !tx.trim() && !artText[x.k])));
          }} />
      ) : (
        <p className="artp" onClick={(e) => {
          if ((e.target as HTMLElement).closest(".dv, .b, .din, .ckb, .dsk")) return;
          setEd(`tx_${a.k}`); setTx(artBody(a));
        }}>{a.text != null ? a.text : node}</p>
      )}
    </div>
  );

  const corp = r?.owner_type === "법인";
  const addr = bs("addr") ?? r?.addr ?? null;

  /* 브라우저 인쇄 머리글은 문서 제목을 찍는다 — 사이트명 대신 문서 이름이 나가게 */
  useEffect(() => {
    const prev = document.title;
    document.title = `${kind} — ${addr ?? ""}`;
    return () => { document.title = prev; };
  }, [kind, addr]);

  /* 임대차 — 사람이 입력한 것(floor_rents)만 문서에 온다. 추정치는 문서에 안 들어간다(사실/추정 구분) */
  const rentRows = rents.data?.items ?? [];
  const rentSum = rentRows.reduce((a, x) => ({ dep: a.dep + (x.deposit ?? 0), mo: a.mo + (x.rent ?? 0) }), { dep: 0, mo: 0 });
  const rentSeed = rentRows.length
    ? `임대차 ${rentRows.length}건 — 보증금 합계 ${comma(rentSum.dep)}원, 월세 합계 ${comma(rentSum.mo)}원 (상세는 별지 임차인 현황표)`
    : null;
  const sw = (Array.isArray(bd["subway_json"]) ? bd["subway_json"] as { 역명?: string; 도보?: number }[] : [])[0] ?? null;
  const dynClauses = [
    ...(lead?.terms ? [{ t: "협의 조건", c: lead.terms }] : []),
    ...(rentRows.length ? [{
      t: "임대차 승계(명세)",
      c: `현 임대차계약 ${rentRows.length}건(보증금 합계 ${comma(rentSum.dep)}원, 월세 합계 ${comma(rentSum.mo)}원)을 매수인이 전부 승계하며, 상세는 별지 임차인 현황표에 따른다.`,
    }] : []),
  ];


  /* 날짜 — 일정이 잡혀 있으면 그 날이 씨앗, 작성일·영수일은 오늘이 씨앗. 빈 칸은 년·월·일 골격 */
  const today = new Date().toISOString().slice(0, 10);
  const fmtD = (iso: string | null | undefined) => {
    if (!iso) return null;
    const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[1]}년 ${Number(m[2])}월 ${Number(m[3])}일` : String(iso);
  };
  const dcell = (k: string, seedIso?: string | null) => {
    if (ed === k) return (
      <input className="din" autoFocus value={tx} placeholder="2026-08-30"
        onChange={(e) => setTx(e.target.value)}
        onBlur={() => { setEd(null); mark(k); setV((p) => { const q = { ...p }; if (tx.trim()) q[k] = tx.trim(); else delete q[k]; return q; }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    );
    const hand = dirty.has(k) && v[k] ? v[k] : null;
    const show = hand ?? seedIso ?? v[k] ?? null;
    if (show == null) return (
      <span className="dsk" onClick={() => { setEd(k); setTx(""); }}>
        <span className="b yr" />년 <span className="b mo" />월 <span className="b dy" />일</span>
    );
    return <span className={`dv ${hand ? "" : seedIso ? "fill" : ""}`}
      onClick={() => { setEd(k); setTx(show); }}>{fmtD(show) ?? show}</span>;
  };
  const signSeed = schedOn("계약") ?? today;
  const rAmt = rcpt === "본계약 전 합의금" ? pre : rcpt === "계약금" ? down : rcpt === "중도금" ? mid : bal;
  const recAmt = num("r_amt", rAmt);

  return (
    <div className="dp">
      <div className="dp-bar">
        {(["계약서", "확인설명서", "영수증", "임차인 현황표"] as Kind[]).map((k) => (
          <button key={k} className={`dp-chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>{k}</button>
        ))}
        <span className="sp" />
        <button className="dp-ic" title="Word로 내보내기 (.docx)" onClick={() =>
          exportDocx(`${(addr ?? "문서").replace(/\s/g, "_")}_${kind}`)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="M7 10l5 5 5-5" /><path d="M12 15V3" /></svg>
        </button>
        <button className={`dp-ic ${saved ? "ok" : ""} ${lead && kind !== "임차인 현황표" ? "" : "off"}`} title="저장" onClick={save}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8" /><path d="M7 3v5h8" /></svg>
        </button>
        <button className="dp-ic" title="인쇄" onClick={() => window.print()}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9V3h12v6" /><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" /><path d="M6 14h12v7H6z" /></svg>
        </button>
      </div>

      {kind === "계약서" && (<>
        <Pages frozen={ed != null || tEd != null || tFocus} blocks={[
          <h2 key="t">부동산 매매 계약서</h2>,
          <p key="i">매도인과 매수인 쌍방은 아래 표시 부동산에 관하여 다음 계약 내용과 같이 매매계약을 체결한다.</p>,
          <div key="s1" className="sect">1. 부동산의 표시</div>,
          <table key="tb1">
            <tbody>
              <tr><td className="lab">소재지</td><td colSpan={5}>{cell("addr", addr, "xw")}</td></tr>
              <tr><td className="lab">토　지</td><td className="lab n">지　목</td><td className="c">{cell("jimok", bs("jimok"))}</td>
                <td className="lab n">면　적</td><td colSpan={2} className="c">{cell("larea", bn("land_area") != null ? `${comma(bn("land_area"))} ㎡` : null)}</td></tr>
              <tr><td className="lab">건　물</td><td className="lab n">구조·용도</td>
                <td className="c">{cell("struct", [bs("structure"), bs("main_use_name")].filter(Boolean).join(" · ") || null)}</td>
                <td className="lab n">면　적</td><td colSpan={2} className="c">{cell("barea", bn("total_area") != null ? `${comma(bn("total_area"))} ㎡` : null)}</td></tr>
            </tbody>
          </table>,
          <div key="s2" className="sect">2. 계약 내용</div>,
          ...arts.map((a, i) => (<div key={a.k}>
            {artNode(i, a,
              a.k === "art2" ? <>매도인은 매매대금의 잔금 수령과 동시에 매수인에게 소유권이전등기에 필요한 모든 서류를 교부하고 등기절차에 협력하며, 위 부동산의 인도일은 {dcell("give_on", schedOn("잔금"))} 로 한다.</>
                : a.k === "art7" ? <>개업공인중개사는 매도인 또는 매수인의 본 계약 불이행에 대하여 책임을 지지 않는다. 또한, 중개보수는 본 계약체결과 동시에 계약 당사자 쌍방이 각각 지불하며, 개업공인중개사의 고의나 과실 없이 본 계약이 무효·취소 또는 해제되어도 중개보수는 지급한다. 공동 중개인 경우에 매도인과 매수인은 자신이 중개 의뢰한 개업공인중개사에게 각각 중개보수를 지급한다. (중개보수는 거래가액의 {cell("fee_rate", String(rate))} %로 한다.)</>
                : a.k === "art9" ? <>개업공인중개사는 중개대상물 확인·설명서를 작성하고 업무보증관계증서(공제증서 등) 사본을 첨부하여 계약체결과 동시에 거래당사자 쌍방에게 교부한다. (교부일자: {dcell("issue_on", signSeed)} )</>
                : <>{artBody(a)}</>)}
            {a.k === "art1" && (
              <table>
                <tbody>
                  <tr><td className="lab w">매매대금</td><td colSpan={3}>{money("deal", deal)}</td></tr>
                  <tr className={!v["loan"] && v["loan_off"] !== "1" && v["loan_keep"] !== "1" ? "hidep" : ""}>
                    <td className="lab w">융 자 금</td><td colSpan={3}>{money("loan", num("loan", null))}은 　{ck("loan_off")} 말소　{ck("loan_keep")} 승계 　조건으로 한다</td></tr>
                  <tr className={pre == null ? "hidep" : ""}>
                    <td className="lab w">본계약 전<br />합의금</td><td colSpan={3}>{money("pre", pre)}은 {dcell("pre_d", lead?.pre_contract_on)} 에 지불하였다</td></tr>
                  <tr><td className="lab w">계 약 금</td><td colSpan={3}>{money("down", down)}은 {dcell("down_d", schedOn("계약"))} 에 지불하고 영수함.　영수자 ( {cell("down_who", r?.owner_name)} 　<span className="stamp">인</span> )</td></tr>
                  <tr className={mid == null && !v["mid_on"] ? "hidep" : ""}>
                    <td className="lab w">중 도 금</td><td colSpan={3}>{money("mid", mid)}은 {dcell("mid_on", schedOn("중도금"))} 에 지불하며</td></tr>
                  <tr><td className="lab w">잔　　금</td><td colSpan={3}>{money("bal", bal, true)}은 {dcell("bal_on", schedOn("잔금"))} 에 지불한다.</td></tr>
                </tbody>
              </table>
            )}
          </div>)),
          <div key="terms" className={terms.length === 0 && !tIn ? "hidep" : ""}>
            <div className="sect">특약사항</div>
            <div className="terms">
              {terms.map((c, i) => tEd === i ? (
                <div key={i} className="tl tx">
                  <textarea className="tta" autoFocus value={tTx} rows={2}
                    onChange={(e) => setTTx(e.target.value)}
                    onBlur={() => {
                      setTEd(null);
                      setTerms((p) => tTx.trim()
                        ? p.map((x, j) => (j === i ? tTx.trim() : x))
                        : p.filter((_, j) => j !== i));
                    }} />
                </div>
              ) : (
                <div key={i} className="tl tx" onClick={() => { setTEd(i); setTTx(c); }}>
                  <span className="tno num">{i + 1}.</span> {c}
                  <button className="tdel" onClick={(e) => { e.stopPropagation(); setTerms((p) => p.filter((_, j) => j !== i)); }}>✕</button>
                </div>
              ))}
              <div className="tl tin">
                <span className="tno num">{terms.length + 1}.</span>
                <input className="tadd" value={tIn}
                  onFocus={() => setTFocus(true)}
                  onBlur={() => setTimeout(() => setTFocus(false), 120)}
                  onChange={(e) => setTIn(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && tIn.trim()) {
                      setTerms((p) => [...p, tIn.trim()]); setTIn("");
                    }
                  }} />
              </div>
            </div>
            {tFocus && (
              <div className="tbank" onMouseDown={(e) => e.preventDefault()}>
                {[...dynClauses, ...CLAUSES].map((c, i) => (
                  <button key={i} className={`dp-chip ${i < dynClauses.length ? "dyn" : ""}`} title={c.c}
                    onMouseDown={() => setTerms((p) => [...p, c.c])}>{c.t}</button>
                ))}
              </div>
            )}
          </div>,
          <p key="gan" className="note">본 계약을 증명하기 위하여 계약 당사자가 이의 없음을 확인하고 각각 서명·날인 후 매도인, 매수인 및 개업공인중개사는 매 장마다 간인하여야 하며, 각각 1통씩 보관한다.</p>,
          <p key="dt" className="c big">{dcell("sign_on", signSeed)}</p>,
          <table key="sign" className="sign">
            <tbody>
              <tr><td className="lab" rowSpan={2} style={{ width: "20mm" }}>매도인</td>
                <td className="lab n">주　소</td><td colSpan={5}>{cell("s_addr", r?.owner_addr, "full")}</td></tr>
              <tr><td className="lab n">{corp ? "법인등록번호" : "주민등록번호"}</td>
                <td style={{ width: "40mm" }}>{corp ? cell("s_corpno", r?.owner_corp_no, "w") : rrn("s")}</td>
                <td className="lab n">전　화</td><td style={{ width: "32mm" }}>{cell("s_tel", r?.owner_phone ? formatPhone(r.owner_phone) : null)}</td>
                <td className="lab n">성　명{corp && <br />}{corp && <span className="note">(대표)</span>}</td>
                <td>{cell("s_name", r?.owner_name)}{corp && <> {cell("s_rep", r?.owner_rep_name)}</>} <span className="stamp">(인)</span></td></tr>
              <tr><td className="lab" rowSpan={2}>매수인</td>
                <td className="lab n">주　소</td><td colSpan={5}>{cell("b_addr", lead?.buyer_addr, "full")}</td></tr>
              <tr><td className="lab n">주민등록번호<br /><span className="note">(법인등록번호)</span></td>
                <td>{lead?.buyer_is_corp ? cell("b_corpno", lead?.buyer_corp_no, "w") : rrn("b")}</td>
                <td className="lab n">전　화</td><td>{cell("b_tel", lead?.buyer_phone ? formatPhone(lead.buyer_phone) : null)}</td>
                <td className="lab n">성　명<br /><span className="note">(법인명)</span></td>
                <td>{cell("b_name", lead?.buyer_name)} <span className="stamp">(인)</span></td></tr>
              <tr><td className="lab" rowSpan={4}>개업<br />공인중개사</td>
                <td className="lab n">사무소소재지</td><td colSpan={5}>{cell("of_addr", of?.office_addr, "full")}</td></tr>
              <tr><td className="lab n">사무소 명칭</td><td>{cell("of_name", of?.office_name, "w")}</td>
                <td className="lab n">대표자</td><td colSpan={3}>{cell("of_agent", of?.agent_name)} <span className="stamp">(서명 및 날인)</span></td></tr>
              <tr><td className="lab n">등록번호</td><td>{cell("of_regno", of?.reg_no, "w")}</td>
                <td className="lab n">소속<br />공인중개사</td><td colSpan={3}>{cell("of_sub", null)} <span className="stamp">(서명 및 날인)</span></td></tr>
              <tr><td className="lab n">전화번호</td><td colSpan={5}>{cell("of_tel", of?.phone, "w")}</td></tr>
            </tbody>
          </table>,
        ]} />
        <div className="aacts">
          <button className="dp-chip" onClick={() => {
            const kk = `c${artN}`; setArtN(artN + 1);
            setArts((p) => [...p, { k: kk, label: "특별 약정", text: "" }]);
            setEd(`tx_${kk}`); setTx("");
          }}>＋ 조항</button>
          <button className="dp-chip" onClick={() => setArts(STD_ARTS.map((a) => ({ ...a, text: null })))}>표준으로 리셋</button>
        </div>
      </>)}

      {kind === "확인설명서" && (<>
        <div className="sheet"><div className="doc">
          <span className="pg">(3쪽 중 제1쪽)</span>
          <div className="head">■ 공인중개사법 시행규칙 [별지 제20호의2서식]</div>
          <h2 className="sm">중개대상물 확인·설명서[Ⅱ] (비주거용 건축물)</h2>
          <div className="sub">( {ck("u_biz")} 업무용 {ck("u_com")} 상업용 {ck("u_ind")} 공업용 {ck("u_sale", true)} 매매·교환 {ck("u_rent")} 임대 {ck("u_etc")} 그 밖의 경우 )</div>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={2} style={{ width: "19mm" }}>확인·설명<br />자료</td>
                <td className="lab w">확인·설명<br />근거자료 등</td>
                <td className="note">{ck("d1")} 등기권리증　{ck("d2")} 등기사항증명서　{ck("d3")} 토지대장　{ck("d4")} 건축물대장　{ck("d5")} 지적도<br />
                  {ck("d6")} 임야도　{ck("d7")} 토지이용계획확인서　{ck("d8")} 그 밖의 자료( {cell("d_etc", null, "w")} )</td></tr>
              <tr><td className="lab w">대상물건의 상태에<br />관한 자료요구 사항</td><td>{cell("d_req", null, "full")}</td></tr>
            </tbody>
          </table>
          <p className="sect">Ⅰ. 개업공인중개사 기본 확인사항</p>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={5} style={{ width: "17mm" }}>① 대상물건<br />의 표시</td>
                <td className="lab n" rowSpan={2} style={{ width: "13mm" }}>토지</td><td className="lab n">소재지</td>
                <td colSpan={3}>{cell("addr", addr, "xw")}</td></tr>
              <tr><td className="lab n">면적(㎡)</td><td>{cell("larea2", bn("land_area") != null ? comma(bn("land_area")) : null)}</td>
                <td className="lab n">공부상 지목</td><td>{cell("jimok2", bs("jimok"))} <span className="dc-sub2">실제이용 {cell("real_use", bs("land_use"))}</span></td></tr>
              <tr><td className="lab n" rowSpan={3}>건축물</td><td className="lab n">연면적(㎡)</td><td>{cell("barea2", bn("total_area") != null ? comma(bn("total_area")) : null)}</td>
                <td className="lab n">준공년도</td><td>{cell("built", bs("approval_ymd") ? String(bs("approval_ymd")).slice(0, 4) : null)}</td></tr>
              <tr><td className="lab n">구조</td><td>{cell("struct2", bs("structure"))}</td>
                <td className="lab n">건축물대장상 용도</td><td>{cell("use2", bs("main_use_name"))}</td></tr>
              <tr><td className="lab n">위반건축물 여부</td><td>{ck("viol")} 위반　{ck("legal")} 적법</td>
                <td className="lab n">위반내용</td><td>{cell("viol_c", null, "w")}</td></tr>
            </tbody>
          </table>
          <table style={{ marginTop: "2mm" }}>
            <tbody>
              <tr><td className="lab" rowSpan={2} style={{ width: "17mm" }}>② 권리관계</td>
                <td className="lab n" rowSpan={2} style={{ width: "16mm" }}>등기부<br />기재사항</td>
                <td className="c" style={{ width: "62mm" }}>소유권에 관한 사항</td><td className="c">소유권 외의 권리사항</td></tr>
              <tr><td className="note" style={{ height: "17mm", verticalAlign: "top" }}>{cell("own1", null, "full")}</td>
                <td className="note" style={{ verticalAlign: "top" }}>{cell("own2", null, "full")}</td></tr>
            </tbody>
          </table>
          <table style={{ marginTop: "2mm" }}>
            <tbody>
              <tr><td className="lab" rowSpan={3} style={{ width: "17mm" }}>③ 토지이용계획,<br />공법상 이용제한<br />및 거래규제</td>
                <td className="lab n">용도지역</td><td>{cell("zone", (() => {
                  const mix = bd["use_zone_mix"];
                  if (Array.isArray(mix) && mix.length > 1) {
                    return (mix as { 명?: string; 비중?: number }[])
                      .map((z) => `${z.명}${z.비중 != null && z.비중 < 1 ? `(${Math.round(z.비중 * 100)}%)` : ""}`)
                      .join(" · ");
                  }
                  return bs("use_zone");
                })())}</td>
                <td className="lab n" style={{ width: "21mm" }}>건폐율 상한</td><td className="c" style={{ width: "19mm" }}>{cell("bcr", bn("bcr") != null ? `${bn("bcr")} %` : null)}</td></tr>
              <tr><td className="lab n">용도지구</td><td>{cell("zone2", null, "w")}</td>
                <td className="lab n">용적률 상한</td><td className="c">{cell("far", bn("far") != null ? `${bn("far")} %` : null)}</td></tr>
              <tr><td className="lab n">그 밖의 이용제한<br />및 거래규제사항</td><td colSpan={3}>{cell("reg_etc", null, "full")}</td></tr>
            </tbody>
          </table>
        </div></div>
        <div className="sheet"><div className="doc">
          <span className="pg">(3쪽 중 제2쪽)</span>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={3} style={{ width: "17mm" }}>④ 입지조건</td>
                <td className="lab n" style={{ width: "18mm" }}>도로와의 관계</td>
                <td colSpan={3}>( {cell("road_w", null)} m )도로에 접함 · {cell("road_rel", bs("road_frontage"))}　{ck("paved")} 포장　{ck("unpaved")} 비포장</td></tr>
              <tr><td className="lab n">지하철</td>
                <td colSpan={3}>( {cell("subway", sw?.역명 ?? null)} ) 역, 소요시간 약 {cell("subway_min", sw?.도보 != null ? String(sw.도보) : null)} 분</td></tr>
              <tr><td className="lab n">주차장</td><td colSpan={3}>{ck("pk_no")} 없음　{ck("pk_own")} 전용주차시설　{ck("pk_shared")} 공동주차시설</td></tr>
            </tbody>
          </table>
          <table style={{ marginTop: "2mm" }}>
            <tbody>
              <tr><td className="lab" rowSpan={2} style={{ width: "17mm" }}>⑤ 거래예정<br />금액 등</td>
                <td className="lab w">거래예정금액</td><td colSpan={3}>{cell("deal2", deal != null ? `${comma(deal)} 원` : null)}</td></tr>
              <tr><td className="lab w">개별공시지가(㎡당)</td><td>{cell("gongsi", bn("gongsi_latest") != null ? `${comma(bn("gongsi_latest"))} 원` : null)}</td>
                <td className="lab n">건물 공시가격</td><td>{cell("gongsi_b", null, "w")}</td></tr>
            </tbody>
          </table>
          <p className="sect">Ⅱ. 개업공인중개사 세부 확인사항</p>
          <p style={{ fontWeight: 700, margin: "0 0 1.5mm" }}>⑥ 실제 권리관계 또는 공시되지 않은 물건의 권리 사항</p>
          <table><tbody><tr><td style={{ verticalAlign: "top", height: "26mm" }}>{cell("real_r", rentSeed, "full")}</td></tr></tbody></table>
          <table style={{ marginTop: "3mm" }}>
            <tbody>
              <tr><td className="lab" rowSpan={5} style={{ width: "17mm" }}>⑦ 내부·외부<br />시설물의 상태</td>
                <td className="lab n" style={{ width: "20mm" }}>수도</td>
                <td>파손 {ck("w_no")} 없음　{ck("w_yes")} 있음 ( {cell("w_c", null)} )</td></tr>
              <tr><td className="lab n">전기</td><td>{ck("e_ok")} 정상　{ck("e_fix")} 교체 필요 ( {cell("e_c", null)} )</td></tr>
              <tr><td className="lab n">소방</td><td>소화전 {ck("f_yes")} 있음　{ck("f_no")} 없음</td></tr>
              <tr><td className="lab n">승강기</td><td>{ck("el_yes", bn("elevator") != null && bn("elevator")! > 0)} 있음 ( {ck("el_ok")} 양호 {ck("el_bad")} 불량 )　{ck("el_no")} 없음</td></tr>
              <tr><td className="lab n">배수</td><td>{ck("dr_ok")} 정상　{ck("dr_fix")} 수선 필요 ( {cell("dr_c", null)} )</td></tr>
            </tbody>
          </table>
          <table style={{ marginTop: "2mm" }}>
            <tbody>
              <tr><td className="lab" rowSpan={2} style={{ width: "17mm" }}>⑧ 벽면·바닥면</td>
                <td className="lab n" style={{ width: "20mm" }}>벽면</td>
                <td>균열 {ck("cr_no")} 없음 {ck("cr_yes")} 있음　·　누수 {ck("lk_no")} 없음 {ck("lk_yes")} 있음</td></tr>
              <tr><td className="lab n">바닥면</td><td>{ck("fl_ok")} 깨끗함　{ck("fl_mid")} 보통임　{ck("fl_fix")} 수리 필요 ( {cell("fl_c", null)} )</td></tr>
            </tbody>
          </table>
        </div></div>
        <div className="sheet"><div className="doc">
          <span className="pg">(3쪽 중 제3쪽)</span>
          <p className="sect" style={{ marginTop: 0 }}>Ⅲ. 중개보수 등에 관한 사항</p>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={3} style={{ width: "19mm" }}>⑨ 중개보수<br />및 실비</td>
                <td className="lab n">중개보수</td><td style={{ width: "50mm" }}>{cell("fee", fee != null ? `${comma(fee)} 원` : null)}</td>
                <td rowSpan={3} className="note" style={{ verticalAlign: "top" }}>&lt;산출내역&gt;<br /><br />
                  중개보수: {deal != null ? <span className="fill">{comma(deal)}원 × {rate}% = {comma(fee)}원 (부가가치세 별도)</span> : <span className="b w" />}<br /><br />
                  ※ 중개보수는 시·도 조례로 정한 요율한도에서 협의하여 결정하며 부가가치세는 별도로 부과될 수 있습니다.</td></tr>
              <tr><td className="lab n">실비</td><td>{cell("fee_x", null, "w")}</td></tr>
              <tr><td className="lab n">지급시기</td><td>{cell("fee_when", null, "w")}</td></tr>
            </tbody>
          </table>
          <p className="note" style={{ margin: "5mm 0" }}>「공인중개사법」 25조 3항 및 30조 5항에 따라 거래당사자는 개업공인중개사로부터 위 중개대상물에 관한 확인·설명 및 손해배상책임의 보장에 관한 설명을 듣고, 본 확인·설명서와 손해배상책임 보장 증명서류(사본 또는 전자문서)를 수령합니다.</p>
          <p className="c big">{dcell("st_on", signSeed)}</p>
          <table className="sign">
            <tbody>
              <tr><td className="lab" rowSpan={2} style={{ width: "22mm" }}>매도인</td>
                <td className="lab n">주소</td><td style={{ width: "58mm" }}>{cell("s_addr", r?.owner_addr, "full")}</td>
                <td className="lab n">성명</td><td>{cell("s_name", r?.owner_name)} <span className="stamp">(서명 또는 날인)</span></td></tr>
              <tr><td className="lab n">생년월일</td><td>{cell("s_birth", born(idno.s))}</td>
                <td className="lab n">전화번호</td><td>{cell("s_tel", r?.owner_phone ? formatPhone(r.owner_phone) : null)}</td></tr>
              <tr><td className="lab" rowSpan={2}>매수인</td>
                <td className="lab n">주소</td><td>{cell("b_addr", lead?.buyer_addr, "full")}</td>
                <td className="lab n">성명</td><td>{cell("b_name", lead?.buyer_name)} <span className="stamp">(서명 또는 날인)</span></td></tr>
              <tr><td className="lab n">생년월일</td><td>{cell("b_birth", born(idno.b))}</td>
                <td className="lab n">전화번호</td><td>{cell("b_tel", lead?.buyer_phone ? formatPhone(lead.buyer_phone) : null)}</td></tr>
              <tr><td className="lab" rowSpan={3}>개업<br />공인중개사</td>
                <td className="lab n">등록번호</td><td>{cell("of_regno", of?.reg_no, "w")}</td>
                <td className="lab n">성명(대표자)</td><td>{cell("of_agent", of?.agent_name)} <span className="stamp">(서명 및 날인)</span></td></tr>
              <tr><td className="lab n">사무소 명칭</td><td>{cell("of_name", of?.office_name, "w")}</td>
                <td className="lab n">소속공인중개사</td><td>{cell("of_sub", null)} <span className="stamp">(서명 및 날인)</span></td></tr>
              <tr><td className="lab n">사무소 소재지</td><td>{cell("of_addr", of?.office_addr, "full")}</td>
                <td className="lab n">전화번호</td><td>{cell("of_tel", of?.phone)}</td></tr>
            </tbody>
          </table>
        </div></div>
      </>)}

      {kind === "임차인 현황표" && (
        <div className="sheet"><div className="doc num">
          <h2 className="sm">임차인 현황표</h2>
          <p className="dc-lead">{addr}　·　{fmtD(today)}</p>
          <table className="dc-t">
            <tbody>
              <tr><th style={{ width: "14mm" }}>층</th><th style={{ width: "16mm" }}>호</th><th>용도</th>
                <th style={{ width: "22mm" }}>계약면적(㎡)</th><th style={{ width: "26mm" }}>보증금(원)</th>
                <th style={{ width: "24mm" }}>월세(원)</th><th style={{ width: "24mm" }}>관리비(원)</th>
                <th style={{ width: "14mm" }}>비고</th></tr>
              {rentRows.map((x, i) => (
                <tr key={i}><td className="c">{x.floor}</td><td className="c">{x.unit_no}</td>
                  <td>{x.use ?? ""}</td><td className="r">{x.contract_area ?? ""}</td>
                  <td className="r">{comma(x.deposit)}</td><td className="r">{comma(x.rent)}</td>
                  <td className="r">{comma(x.maintenance)}</td>
                  <td className="c">{x.is_vacant ? "공실" : ""}</td></tr>
              ))}
              {rentRows.length === 0 && (
                <tr><td colSpan={8} className="c" style={{ height: "16mm" }}>임대 내역이 없습니다 — 매물 정보 탭에서 입력합니다</td></tr>
              )}
              {rentRows.length > 0 && (
                <tr><th colSpan={4}>합계 {rentRows.length}건</th>
                  <th className="r">{comma(rentSum.dep)}</th><th className="r">{comma(rentSum.mo)}</th>
                  <th colSpan={2} /></tr>
              )}
            </tbody>
          </table>
        </div></div>
      )}

      {kind === "영수증" && (
        <div className="sheet"><div className="doc">
          <div className="dp-rk">
            {["본계약 전 합의금", "계약금", "중도금", "잔금"].map((k) => (
              <button key={k} className={`dp-chip ${rcpt === k ? "on" : ""}`}
                onClick={() => { setRcpt(k); setV((p) => { const q = { ...p }; delete q["r_amt"]; return q; }); }}>{k}</button>
            ))}
          </div>
          {(["수취인용", "발행인 보관용"] as const).map((who, i) => (<div key={who}>
            {i === 1 && <div className="cutline"><span>✂</span></div>}
            <div className="rc">
              <span className="kind">{who}</span>
              <div className="t">영수증</div>
              <div className="amt">一{money("r_amt", recAmt)}
              </div>
              <table>
                <tbody>
                  <tr><td className="lab w">수　취　인</td><td>{cell("r_to", lead?.buyer_name)}　귀하</td></tr>
                  <tr><td className="lab w">부동산의 표시</td><td>{cell("addr", addr, "xw")}</td></tr>
                </tbody>
              </table>
              <p className="say">위 금액을 위 표시 부동산 매매대금의 <b>{rcpt}</b>으로 정히 영수합니다.</p>
              <p className="dt">{dcell("r_on", today)}</p>
              <p className="say" style={{ textAlign: "right" }}>발행인(영수인)　{cell("r_from", r?.owner_name)}　<span className="seal">(印)</span></p>
            </div>
          </div>))}
        </div></div>
      )}
    </div>
  );
}
