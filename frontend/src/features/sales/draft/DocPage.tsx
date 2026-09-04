/** 문서 페이지 — 새탭 전체화면. 계약서 · 확인설명서 · 영수증 · 임차인 현황표.
 *
 *  양식의 정본은 docs/자료 의 원본 셋이다(2026-09-04).
 *    계약서      상업용_부동산_매매계약서_명도조건 · _임차인승계조건 (13조 · 3조만 다르다)
 *    확인설명서  중개대상물확인설명서 비주거용(2020.2.21) · 별지 제20호의2서식 · 4쪽
 *  화면은 그 표 모양과 조문을 그대로 따른다. 항목을 빼거나 주거용 서식 항목을 섞지 않는다.
 *
 *  계약서는 **명도조건 · 승계조건** 둘 중 하나다(슬라이딩 토글). 3조가 갈아 끼워진다.
 *  승계조건일 때만 **포괄양수도**를 켤 수 있다 — 임대사업을 통째로 넘기는 것이라 명도(공실)
 *  에는 성립하지 않는다. 켜면 2조의 부가세가 「수수하지 않음」이 되고 3조 뒤에 조가 하나 선다.
 *
 *  파랑 = 자동 씨앗(클릭 편집, 고치면 잉크색). 점선 = 손 칸. [ ] = 체크. 굵은 파랑 낱말 = 클릭하면 다음 선택지.
 *  돈은 값 하나 — 한글·숫자가 같이 파생된다(억 단위로 입력).
 *  조문은 문단을 클릭해 통째로 고칠 수 있다 — 고친 문구는 그 계약에만 산다.
 *  특약은 쓰는 만큼 늘어난다 — 종이 안에서 바로 쓰고, 예시 묶음은 골라 넣는 것.
 *  주민등록번호는 어디에도 저장하지 않는다 — 이 탭의 상태로만 살다 인쇄되고 사라진다.
 *  인쇄는 @page 여백 0 — 브라우저 머리말·꼬리말(주소·날짜)이 종이에 안 박힌다.
 */
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  buildingsApi, officeApi, papersApi, proposalsApi, rentsApi, salesApi,
} from "../../../shared/api/endpoints";
import { Segmented } from "../../../shared/ui/Segmented";
import { formatPhone, parseAmount, seedAmount } from "../../building/KV";
import { exportDocx } from "./exportDoc";
import "./docpage.css";

/* 특약 예시 묶음 — 조건에 맞는 것만 은행에 뜬다(명도·승계·포괄) */
const CLAUSES: { t: string; c: string; only?: "명도" | "승계" | "포괄" }[] = [
  { t: "명도비용 부담", only: "명도", c: "임차인 퇴거에 따른 이사비·영업손실보상 등 명도비용 일체는 매도인이 부담하며, 매수인은 어떠한 명목으로도 이를 부담하지 않는다." },
  { t: "명도 지연 지체상금", only: "명도", c: "명도완료기한을 넘긴 날부터 공실 인도 완료일까지 매도인은 1일당 매매대금의 0.05%에 해당하는 지체상금을 매수인에게 지급한다." },
  { t: "임대차계약서 원본 인계", only: "승계", c: "매도인은 잔금일에 승계 대상 임대차계약서 원본, 보증금 수령증, 임대료 입금내역 및 임차인 연락처를 매수인에게 인계한다." },
  { t: "미납 임대료 처리", only: "승계", c: "잔금일 전일까지 발생한 미납 임대료·관리비는 매도인에게 귀속하며, 매수인은 이를 승계하지 않는다." },
  { t: "사업자등록 협력", only: "포괄", c: "매수인은 잔금일 전까지 이 사업장을 사업장으로 하는 부동산임대업 사업자등록을 마치고, 매도인은 사업양도신고에 필요한 서류를 제공한다." },
  { t: "부가세 추징 시 정산", only: "포괄", c: "과세관청이 본 매매를 사업의 포괄양도로 인정하지 않는 경우 매수인은 건물분 부가가치세 상당액을 매도인에게 지급하고 매도인은 세금계산서를 발급하며, 가산세는 그 원인을 제공한 당사자가 부담한다." },
  { t: "위반사항 원상복구", c: "공부와 다르게 사용 중인 부분은 쌍방이 상호 확인하였으며, 매도인은 잔금일 전까지 원상복구 또는 적법화를 책임진다." },
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
type Mode = "명도" | "승계";

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

/* 확인설명서 4쪽 — 작성방법. 별지 제20호의2서식 원문 그대로(2020.2.21). */
const GUIDE_GENERAL = [
  "“［ ］”있는 항목은 해당하는 “［ ］”안에 √로 표시합니다.",
  "세부항목 작성 시 해당 내용을 작성란에 모두 작성할 수 없는 경우에는 별지로 작성하여 첨부하고, 해당란에는 “별지 참고”라고 적습니다.",
];
const GUIDE_DETAIL = [
  "「확인ㆍ설명자료」 항목의 “확인ㆍ설명 근거자료 등”에는 개업공인중개사가 확인ㆍ설명 과정에서 제시한 자료를 적으며, “대상물건의 상태에 관한 자료요구 사항”에는 매도(임대)의뢰인에게 요구한 사항 및 그 관련 자료의 제출 여부와 ⑧ 실제 권리관계 또는 공시되지 않은 물건의 권리 사항부터 ⑩ 벽면까지의 항목을 확인하기 위한 자료의 요구 및 그 불응 여부를 적습니다.",
  "① 대상물건의 표시부터 ⑦ 취득 시 부담할 조세의 종류 및 세율까지는 개업공인중개사가 확인한 사항을 적어야 합니다.",
  "① 대상물건의 표시는 토지대장 및 건축물대장 등을 확인하여 적습니다.",
  "② 권리관계의 “등기부 기재사항”은 등기사항증명서를 확인하여 적습니다.",
  "② 권리관계의 “민간임대 등록여부”는 대상물건이 「민간임대주택에 관한 특별법」에 따라 등록된 민간임대주택인지 여부를 같은 법 제60조에 따른 임대주택정보체계에 접속하여 확인하거나 임대인에게 확인하여 “［ ］”안에 √로 표시하고, 민간임대주택인 경우 「민간임대주택에 관한 특별법」에 따른 권리ㆍ의무사항을 임차인에게 설명해야 합니다.",
  "③ 토지이용계획, 공법상 이용제한 및 거래규제에 관한 사항(토지)의 “건폐율 상한” 및 “용적률 상한”은 시ㆍ군의 조례에 따라 적고, “도시ㆍ군계획시설”, “지구단위계획구역, 그 밖의 도시ㆍ군관리계획”은 개업공인중개사가 확인하여 적으며, “그 밖의 이용제한 및 거래규제사항”은 토지이용계획확인서의 내용을 확인하고, 공부에서 확인할 수 없는 사항은 부동산종합공부시스템 등에서 확인하여 적습니다(임대차의 경우에는 생략할 수 있습니다).",
  "⑥ 거래예정금액 등의 “거래예정금액”은 중개가 완성되기 전 거래예정금액을, “개별공시지가(㎡당)” 및 “건물(주택)공시가격”은 중개가 완성되기 전 공시된 공시지가 또는 공시가격을 적습니다[임대차의 경우에는 “개별공시지가(㎡당)” 및 “건물(주택)공시가격”을 생략할 수 있습니다].",
  "⑦ 취득 시 부담할 조세의 종류 및 세율은 중개가 완성되기 전 「지방세법」의 내용을 확인하여 적습니다(임대차의 경우에는 제외합니다).",
  "⑧ 실제 권리관계 또는 공시되지 않은 물건의 권리 사항은 매도(임대)의뢰인이 고지한 사항(법정지상권, 유치권, 「상가건물 임대차보호법」에 따른 임대차, 토지에 부착된 조각물 및 정원수, 계약 전 소유권 변동여부 등)을 적습니다. ※ 임대차계약이 있는 경우 임대보증금, 월 단위의 차임액, 계약기간, 장기수선충당금의 처리 등을 확인하고, 근저당 등이 설정된 경우 채권최고액을 확인하여 적습니다. 그 밖에 경매 및 공매 등의 특이사항이 있는 경우 이를 확인하여 적습니다.",
  "⑨ 내부ㆍ외부의 시설물의 상태(건축물), ⑩ 벽면은 중개대상물에 대해 개업공인중개사가 매도(임대)의뢰인에게 자료를 요구하여 확인한 사항을 적고, ⑨ 내부ㆍ외부의 시설물의 상태(건축물)의 “그 밖의 시설물”은 상업용은 오수ㆍ정화시설용량, 공업용은 전기용량, 오수정화시설용량, 용수시설 내용을 개업공인중개사가 매도(임대)의뢰인에게 자료를 요구하여 확인한 사항을 적습니다.",
  "⑪ 중개보수 및 실비의 금액과 산출내역의 “중개보수”는 거래예정금액을 기준으로 계산하고, “산출내역(중개보수)”은 “거래예정금액(임대차의 경우에는 임대보증금 + 월 단위의 차임액 × 100) × 중개보수 요율”과 같이 적습니다. 다만, 임대차로서 거래예정금액이 5천만원 미만인 경우에는 “임대보증금 + 월 단위의 차임액 × 70”을 거래예정금액으로 합니다.",
  "공동중개 시 참여한 개업공인중개사(소속공인중개사를 포함합니다)는 모두 서명ㆍ날인해야 하며, 2명을 넘는 경우에는 별지로 작성하여 첨부합니다.",
];

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

  /* 임대차 — 사람이 입력한 것(floor_rents)만 문서에 온다. 추정치는 문서에 안 들어간다(사실/추정 구분) */
  const rentRows = rents.data?.items ?? [];
  const rentSum = rentRows.reduce((a, x) => ({
    dep: a.dep + (x.deposit ?? 0), mo: a.mo + (x.rent ?? 0), mg: a.mg + (x.maintenance ?? 0),
  }), { dep: 0, mo: 0, mg: 0 });
  const tenants = rentRows.filter((x) => !x.is_vacant);

  /* 명도 · 승계 — 저장본에 없으면 임대차가 있을 때 승계, 없으면 명도가 씨앗 */
  const mode: Mode = v["c_mode"] === "명도" || v["c_mode"] === "승계" ? (v["c_mode"] as Mode)
    : (tenants.length ? "승계" : "명도");
  const pkg = mode === "승계" && v["c_pkg"] === "1";

  /* 조항 — 상업용 13조(원본 2026-08-31 최종본). r3 은 명도·승계에 따라 갈아 끼워지고,
   * rp(포괄양수도)는 켤 때 3조 뒤에 끼어든다. 번호는 자리가 정한다. */
  type Art = { k: string; label: string; text: string | null };
  const STD_ARTS: { k: string; label: string }[] = [
    { k: "r1", label: "부동산의 표시" }, { k: "r2", label: "매매대금" }, { k: "r3", label: "" },
    { k: "r4", label: "소유권이전 및 인도" }, { k: "r5", label: "권리의 말소" }, { k: "r6", label: "매매목적물의 범위" },
    { k: "r7", label: "목적물의 상태" }, { k: "r8", label: "하자 및 고지의무" }, { k: "r9", label: "세금 및 공과금 정산" },
    { k: "r10", label: "계약의 해제" }, { k: "r11", label: "중개대상물 확인·설명" }, { k: "r12", label: "중개보수" },
    { k: "r13", label: "특약 및 분쟁해결" },
  ];
  const PKG_ART: Art = { k: "rp", label: "사업의 포괄양도·양수", text: null };
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

  /* 포괄양수도 켜고 끄기 — rp 조를 3조 뒤에 넣고 뺀다 */
  const setPkg = (on: boolean) => {
    setV((p) => ({ ...p, c_pkg: on ? "1" : "0" }));
    setArts((p) => {
      const has = p.some((a) => a.k === "rp");
      if (on && !has) {
        const i = p.findIndex((a) => a.k === "r3");
        const q = [...p]; q.splice(i < 0 ? p.length : i + 1, 0, { ...PKG_ART }); return q;
      }
      if (!on && has) return p.filter((a) => a.k !== "rp");
      return p;
    });
  };
  const setMode = (m: Mode) => {
    setV((p) => ({ ...p, c_mode: m }));
    if (m === "명도") setPkg(false);   // 공실 인도에는 넘길 사업이 없다
  };

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
        // 주택용 9조 시절 저장본(art1…)은 버린다 — 상업용 13조가 정본이다(2026-09-04). 덧붙인 조항(c*)만 살린다.
        if (ba?.length && ba.some((a) => a.k === "r1")) setArts(ba);
        else if (ba?.length) setArts([...STD_ARTS.map((a) => ({ ...a, text: null })), ...ba.filter((a) => a.k.startsWith("c"))]);
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
  /* 표 안의 돈 — 숫자만. 한글은 본문 문장이 이미 들고 있다 */
  const won = (k: string, n: number | null, lock = false) => {
    if (ed === k) return (
      <input className="din" autoFocus value={tx} placeholder="억"
        onChange={(e) => setTx(e.target.value)}
        onBlur={() => { setEd(null); mark(k); setV((p) => { const q = { ...p }; if (tx.trim()) q[k] = tx.trim(); else delete q[k]; return q; }); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
    );
    const open = lock ? undefined : () => { setEd(k); setTx(n != null ? seedAmount(n) : ""); };
    if (n == null) return <span className="b w" onClick={open} />;
    return <span className={`dv ${!(dirty.has(k) && v[k]) ? "fill" : ""} ${lock ? "lock" : ""}`} onClick={open}>{comma(n)} 원</span>;
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
  /* 낱말 고르기 — 「포함·별도」처럼 원본이 ⟦ ⟧로 비워 둔 선택지. 누르면 다음 것으로 */
  const pick = (k: string, opts: string[], seed = 0) => {
    const cur = v[k] && opts.includes(v[k]) ? v[k] : opts[seed];
    const next = opts[(opts.indexOf(cur) + 1) % opts.length];
    return <span className="dv pk fill" title={`누르면 「${next}」`}
      onClick={() => setV((p) => ({ ...p, [k]: next }))}>{cur}</span>;
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

  const corp = r?.owner_type === "법인";
  const addr = bs("addr") ?? r?.addr ?? null;
  const sw = (Array.isArray(bd["subway_json"]) ? bd["subway_json"] as { 역명?: string; 도보?: number }[] : [])[0] ?? null;
  const bus = (Array.isArray(bd["bus_json"]) ? bd["bus_json"] as { 정류장?: string; 도보?: number }[] : [])[0] ?? null;
  const zoneMix = (() => {
    const mix = bd["use_zone_mix"];
    if (Array.isArray(mix) && mix.length > 1) {
      return (mix as { 명?: string; 비중?: number }[])
        .map((z) => `${z.명}${z.비중 != null && z.비중 < 1 ? `(${Math.round(z.비중 * 100)}%)` : ""}`)
        .join(" · ");
    }
    return bs("use_zone");
  })();
  /* 법정 건폐·용적 — 필지 단일값일 때만 숫자. 병기(둘 이상)는 손 칸으로 둔다(0153) */
  const legal = (k: "legal_bcr" | "legal_far") => {
    const x = bd[k];
    return Array.isArray(x) && x.length === 1 ? String(x[0]) : null;
  };

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
  const dstr = (k: string, seedIso?: string | null) => fmtD((dirty.has(k) && v[k]) ? v[k] : (seedIso ?? v[k] ?? null)) ?? "    년  월  일";
  const signSeed = schedOn("계약") ?? today;
  const balOn = schedOn("잔금");
  const rAmt = rcpt === "본계약 전 합의금" ? pre : rcpt === "계약금" ? down : rcpt === "중도금" ? mid : bal;
  const recAmt = num("r_amt", rAmt);

  /* 브라우저 인쇄 머리글은 문서 제목을 찍는다 — 사이트명 대신 문서 이름이 나가게 */
  useEffect(() => {
    const prev = document.title;
    document.title = `${kind} — ${addr ?? ""}`;
    return () => { document.title = prev; };
  }, [kind, addr]);

  /* ── 조항 문구 — 원본 최종본 그대로. 씨앗(날짜·금액·낱말)이 들어가는 조는 노드로도 따로 그린다 ── */
  const vat = v["vat"] && ["포함", "별도"].includes(v["vat"]) ? v["vat"] : "별도";
  const vatText = pkg
    ? "건물분 부가가치세는 사업의 포괄양도·양수로서 재화의 공급으로 보지 아니하므로 별도로 수수하지 아니한다."
    : `건물분 부가가치세는 매매대금에 ${vat}로 하며, 별도인 경우 매수인은 잔금 지급 시 매도인에게 지급하고 매도인은 적법한 세금계산서를 발급한다.`;
  const vacateOn = dstr("vacate_on", balOn);
  const artText: Record<string, () => string> = {
    r2: () => `매매대금은 금 ${han(deal) || "        "}원정(₩${comma(deal) || "        "})으로 한다.\n매매대금 중 토지가액과 건물가액은 당사자가 합의한 가액으로 구분하되, 구분이 불분명한 경우 관계 세법에 따른 기준가액으로 안분한다. ${vatText}`,
    r3: () => mode === "명도"
      ? `① 매도인은 자기의 책임과 비용으로 ${vacateOn}까지 목적물에 존재하는 모든 임대차관계와 점유관계를 종료하고, 임차인·전차인·무상사용자 및 그 밖의 모든 점유자의 퇴거, 임대차보증금 반환, 시설물·간판·물품 반출을 완료하여야 한다.
② 매도인은 명도완료기한까지 목적물을 임차인 및 그 밖의 점유자가 없는 완전한 공실 상태로 매수인에게 인도하여야 한다. 매수인은 임대인의 지위, 임대차보증금 반환채무, 미지급 관리비 또는 그 밖의 임대차·점유 관련 채무를 승계하지 않는다.
③ 매도인은 계약일부터 공실 인도 완료일까지 매수인의 사전 서면 동의 없이 새로운 임대차·전대차·사용대차를 체결하거나, 제3자에게 점유를 이전하거나, 임차권·전세권 및 그 밖의 점유·사용에 관한 권리를 설정하여서는 아니 된다.
④ 공실 인도는 모든 점유자의 퇴거와 물품 반출, 임차권등기·전세권 등 점유·사용과 관련된 등기 또는 권리의 말소, 열쇠·출입카드·비밀번호 등 출입수단의 인계 및 매수인의 현장 확인이 모두 완료된 때로 본다. 다만, 매수인이 서면으로 인수를 동의한 시설과 물품은 제외한다.
⑤ 명도완료기한까지 공실 인도가 완료되지 않은 경우 매수인은 명도가 완료될 때까지 잔금 전부의 지급을 거절하거나, 보증금 반환·명도·원상회복 등에 필요한 상당액을 잔금에서 유보할 수 있다. 이러한 지급 거절 또는 유보는 매수인의 채무불이행으로 보지 않는다.
⑥ 매도인이 매수인의 상당한 기간을 정한 이행 최고 후에도 명도를 완료하지 않은 경우 매수인은 계약을 해제하고 손해배상을 청구할 수 있다. 매도인은 명도 지연으로 발생한 점유자 분쟁, 명도비용, 금융비용 및 그 밖의 손해를 부담한다.`
      : `승계 임대차 ${tenants.length || "  "}건
매수인은 위 표에 기재된 임대차 전부에 관하여 임대인의 지위와 보증금 반환채무를 승계한다. 승계보증금은 잔금에서 공제하여 매수인이 인수한 것으로 정산한다.
임대료·관리비·선수금 등 임대차 관련 금액은 잔금일을 기준으로 일할 계산하며, 잔금일 전일까지의 수익과 비용은 매도인에게, 잔금일부터의 수익과 비용은 매수인에게 귀속한다. 매도인은 임대차계약서 원본, 변경합의서 및 보증금 수령자료를 잔금일에 인계한다.
매도인과 매수인은 잔금 지급 완료 후 지체 없이 공동으로 임차인에게 소유자 및 임대인 변경, 임대차 승계 사실과 임대료 입금계좌를 서면으로 통지한다.`,
    rp: () => `① 매도인과 매수인은 본 매매를 「부가가치세법」 제10조제9항제2호 및 같은 법 시행령 제23조에 따른 사업의 포괄적 양도·양수로 하여, 매도인은 제3조의 임대차를 포함한 이 사업장의 부동산임대업에 관한 모든 권리와 의무를 매수인에게 포괄적으로 승계시킨다. 다만 미수금·미지급금 및 이 사업과 직접 관련이 없는 자산·부채는 승계 대상에서 제외한다.
② 본 매매는 재화의 공급으로 보지 아니하므로 건물분 부가가치세를 수수하지 아니하며, 매도인은 세금계산서를 발급하지 아니한다.
③ 매도인과 매수인은 모두 부가가치세 과세사업자(일반과세자)이어야 하며, 매수인은 잔금일까지 이 사업장을 사업장으로 하는 부동산임대업의 사업자등록을 마친다. 매도인은 양도일이 속하는 과세기간의 부가가치세 확정신고 시 사업양도신고서(「부가가치세법 시행규칙」 별지 제31호서식)를 제출하고, 매수인은 이에 협력한다.
④ 과세관청의 판단에 따라 본 매매가 사업의 포괄적 양도·양수에 해당하지 아니하는 것으로 확정되는 경우, 매수인은 건물분 부가가치세 상당액을 매도인에게 지급하고 매도인은 세금계산서를 발급하며, 그로 인한 가산세 등 추가 부담은 그 원인을 제공한 당사자가 부담한다. 당사자는 위 위험을 피하기 위하여 「부가가치세법」 제52조에 따른 사업양수자의 대리납부 절차를 이용할 수 있다.`,
    r4: () => "매도인은 잔금 수령과 동시에 소유권이전등기에 필요한 서류를 교부하고 등기절차에 협력하며, 목적물의 관리권과 관련 서류 및 열쇠·출입수단을 매수인에게 인도한다.",
    r5: () => "매도인은 잔금일까지 매수인이 서면으로 승계하기로 한 사항을 제외하고 근저당권, 전세권, 임차권, 압류, 가압류, 가처분 등 소유권이전에 장애가 되는 권리를 말소한다.",
    r6: () => "매매목적물에는 위 토지와 건물, 공부상 지상물 및 건물에 부속되어 통상 분리하여 사용할 수 없는 시설과 부속물이 포함된다. 임차인 또는 제3자의 소유물과 당사자가 별도로 제외하기로 한 물품은 포함하지 않는다.",
    r7: () => "본 계약은 공부상 표시와 계약 체결 당시의 현 시설물 상태를 기준으로 한다. 매수인은 계약 전 관련 공부와 현장을 확인하고, 매도인은 목적물의 권리·점유·시설·하자 및 분쟁에 관한 중요한 사항을 사실대로 고지한다.",
    r8: () => "매도인이 알고도 고지하지 않은 중대한 하자, 위반사항, 분쟁 또는 소송이 있는 경우 매도인은 관계 법령과 본 계약에 따른 책임을 부담한다.",
    r9: () => "전기·수도·가스요금, 관리비, 임대료 및 그 밖의 수익·비용은 잔금일을 기준으로 일할 계산하며, 잔금일 전일까지의 금액은 매도인에게, 잔금일부터의 금액은 매수인에게 귀속한다. 잔금일 이전 원인으로 발생한 체납액은 매도인이 부담한다. 재산세 및 종합부동산세는 관계 법령상 납세의무자를 기준으로 하되, 당사자 사이의 경제적 부담은 별도 합의한 기준에 따라 정산한다.",
    r10: () => "당사자 일방이 이행에 착수하기 전까지 매수인은 계약금을 포기하고 매도인은 계약금의 배액을 상환함으로써 계약을 해제할 수 있다. 당사자 일방이 계약상 의무를 이행하지 않는 경우 상대방은 상당한 기간을 정하여 이행을 최고한 후 계약을 해제하고 손해배상을 청구할 수 있다.",
    r11: () => "개업공인중개사는 계약 당시 유효한 중개대상물 확인·설명서를 작성하고, 확인·설명의 근거자료와 업무보증 관계증서 사본을 거래당사자에게 교부한다.",
    r12: () => `중개보수는 금 ${comma(fee) || "        "}원으로 하며, 부가가치세는 ${v["fee_vat"] || "별도"}로 한다. 지급일은 ${v["fee_when"] || "잔금일"}로 하며, 별도 약정이 없는 경우 잔금일에 지급한다. 중개보수는 법정 상한을 초과할 수 없다.`,
    r13: () => "본 계약의 특약사항은 본문에 우선한다. 본 계약에 정하지 않은 사항은 관계 법령과 일반 거래관례에 따르며, 분쟁이 해결되지 않는 경우 민사소송법상 관할법원에 따른다.",
  };
  const labelOf = (a: Art) => a.label || (a.k === "r3" ? (mode === "명도" ? "명도 및 공실 인도" : "임대차 현황 및 승계") : "");
  const artBody = (a: Art) => a.text ?? artText[a.k]?.() ?? "";

  /* 조 하나 — 제목 줄(클릭=이름 고침) + 본문(클릭=통째 고침, node 가 있으면 씨앗이 살아 있는 판) */
  const artNode = (i: number, a: Art, node?: ReactNode) => (
    <div key={a.k} className="artw">
      <div className="art">
        제{i + 1}조 (
        {ed === `lb_${a.k}` ? (
          <input className="din" autoFocus value={tx} style={{ width: 150 }}
            onChange={(e) => setTx(e.target.value)}
            onBlur={() => { setEd(null); if (tx.trim()) setArts((p) => p.map((x, j) => j === i ? { ...x, label: tx.trim() } : x)); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
        ) : (
          <span className="dv" onClick={() => { setEd(`lb_${a.k}`); setTx(labelOf(a)); }}>{labelOf(a)}</span>
        )})
        {a.text != null && <span className="apen" title="수정된 조항">✎</span>}
        {a.k !== "r1" && a.k !== "r2" && (
          <button className="adel" title="조항 삭제"
            onClick={() => { if (a.k === "rp") setPkg(false); else setArts((p) => p.filter((_, j) => j !== i)); }}>✕</button>
        )}
      </div>
      {ed === `tx_${a.k}` ? (
        <textarea className="tta" autoFocus value={tx} rows={Math.min(14, Math.max(3, tx.split("\n").length + 1))}
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
      ) : node && a.text == null ? (
        <div className="artp" onClick={(e) => {
          if ((e.target as HTMLElement).closest(".dv, .b, .din, .ckb, .dsk, table")) return;
          setEd(`tx_${a.k}`); setTx(artBody(a));
        }}>{node}</div>
      ) : (
        <p className="artp" onClick={(e) => {
          if ((e.target as HTMLElement).closest(".dv, .b, .din, .ckb, .dsk")) return;
          setEd(`tx_${a.k}`); setTx(artBody(a));
        }}>{artBody(a)}</p>
      )}
    </div>
  );

  /* 1조 표 — 원본: 구분 | 내용 (소재지 · 토지 · 건물 · 매매범위) */
  const tableR1 = (
    <table className="cx">
      <tbody>
        <tr><td className="lab">소재지</td><td colSpan={3}>{cell("addr", addr, "xw")}</td></tr>
        <tr><td className="lab">토지</td><td colSpan={3}>
          지목 {cell("jimok", bs("jimok"))}　/　면적 {cell("larea", bn("land_area") != null ? comma(bn("land_area")) : null)} ㎡　/　지분 {cell("share", null)}</td></tr>
        <tr><td className="lab">건물</td><td colSpan={3}>
          구조 {cell("struct", bs("structure"))}　/　용도 {cell("use", bs("main_use_name"))}　/　연면적 {cell("barea", bn("total_area") != null ? comma(bn("total_area")) : null)} ㎡</td></tr>
        <tr><td className="lab">매매범위</td><td colSpan={3}>{cell("scope", "토지 · 건물 · 부속물 일체", "xw")}</td></tr>
      </tbody>
    </table>
  );
  /* 2조 표 — 원본: 구분 | 금액 | 지급일 | 지급방법. 본계약 전 합의금은 값이 있을 때만(원본엔 없는 줄) */
  const tableR2 = (
    <table className="cx">
      <tbody>
        <tr><th style={{ width: "22mm" }}>구분</th><th>금액</th><th style={{ width: "40mm" }}>지급일</th><th style={{ width: "34mm" }}>지급방법</th></tr>
        <tr className={pre == null ? "hidep" : ""}><td className="lab">본계약 전<br />합의금</td><td className="r">{won("pre", pre)}</td>
          <td className="c">{dcell("pre_d", lead?.pre_contract_on)}</td><td className="c">{cell("pre_how", "계좌이체")}</td></tr>
        <tr><td className="lab">계약금</td><td className="r">{won("down", down)}</td>
          <td className="c">{dcell("down_d", schedOn("계약"))}</td><td className="c">{cell("down_how", "계좌이체")}</td></tr>
        <tr className={mid == null && !v["mid_on"] ? "hidep" : ""}><td className="lab">중도금</td><td className="r">{won("mid", mid)}</td>
          <td className="c">{dcell("mid_on", schedOn("중도금"))}</td><td className="c">{cell("mid_how", "계좌이체")}</td></tr>
        <tr><td className="lab">잔금</td><td className="r">{won("bal", bal, true)}</td>
          <td className="c">{dcell("bal_on", balOn)}</td><td className="c">{cell("bal_how", "계좌이체")}</td></tr>
      </tbody>
    </table>
  );
  /* 3조(승계) 표 — 원본: 층·호 | 임차인 | 계약기간 | 보증금 | 월차임 | 관리비 | 임대료 입금일 + 합계.
   * 층·호·금액은 층별 임대(사람이 넣은 값)에서, 임차인 이름·기간·입금일은 우리 자료에 없어 손 칸이다. */
  const tenantRows = tenants.length ? tenants : [null, null, null, null];
  const tableR3 = (
    <table className="cx tn">
      <tbody>
        <tr><th>층·호</th><th>임차인</th><th>계약기간</th><th>보증금</th><th>월차임</th><th>관리비</th><th>임대료 입금일</th></tr>
        {tenantRows.map((x, i) => (
          <tr key={i}>
            <td className="c">{cell(`t_fl_${i}`, x ? [x.floor, x.unit_no].filter(Boolean).join(" ") || null : null)}</td>
            <td>{cell(`t_nm_${i}`, null)}</td>
            <td className="c">{cell(`t_tm_${i}`, null)}</td>
            <td className="r">{cell(`t_dp_${i}`, x && x.deposit ? comma(x.deposit) : null)}</td>
            <td className="r">{cell(`t_rt_${i}`, x && x.rent ? comma(x.rent) : null)}</td>
            <td className="r">{cell(`t_mg_${i}`, x && x.maintenance ? comma(x.maintenance) : null)}</td>
            <td className="c">{cell(`t_dy_${i}`, null)}</td>
          </tr>
        ))}
        <tr><th colSpan={3}>합계</th>
          <th className="r">{tenants.length ? comma(rentSum.dep) : cell("t_dp_sum", null)}</th>
          <th className="r">{tenants.length ? comma(rentSum.mo) : cell("t_rt_sum", null)}</th>
          <th className="r">{tenants.length ? comma(rentSum.mg) : cell("t_mg_sum", null)}</th>
          <th className="c">-</th></tr>
      </tbody>
    </table>
  );

  /* 씨앗이 살아 있는 조 — 문단 안의 날짜·금액·낱말을 그 자리에서 고친다 */
  const artNodes: Record<string, ReactNode> = {
    r2: <>
      <p>매매대금은 금 {deal != null ? <><span className={`dv ${!(dirty.has("deal") && v["deal"]) ? "fill" : ""}`} onClick={() => { setEd("deal"); setTx(seedAmount(deal)); }}>{han(deal)}</span>원정(₩<span className="dv fill">{comma(deal)}</span>)</>
        : <>{money("deal", null)}</>}으로 한다.</p>
      {tableR2}
      <p>매매대금 중 토지가액과 건물가액은 당사자가 합의한 가액으로 구분하되, 구분이 불분명한 경우 관계 세법에 따른 기준가액으로 안분한다. {pkg
        ? "건물분 부가가치세는 사업의 포괄양도·양수로서 재화의 공급으로 보지 아니하므로 별도로 수수하지 아니한다."
        : <>건물분 부가가치세는 매매대금에 {pick("vat", ["별도", "포함"])}로 하며, 별도인 경우 매수인은 잔금 지급 시 매도인에게 지급하고 매도인은 적법한 세금계산서를 발급한다.</>}</p>
    </>,
    r3: mode === "명도" ? (
      <>
        <p>① 매도인은 자기의 책임과 비용으로 {dcell("vacate_on", balOn)}까지 목적물에 존재하는 모든 임대차관계와 점유관계를 종료하고, 임차인·전차인·무상사용자 및 그 밖의 모든 점유자의 퇴거, 임대차보증금 반환, 시설물·간판·물품 반출을 완료하여야 한다.</p>
        {artText.r3().split("\n").slice(1).map((s, i) => <p key={i}>{s}</p>)}
      </>
    ) : (
      <>
        {tableR3}
        {artText.r3().split("\n").map((s, i) => <p key={i}>{s}</p>)}
      </>
    ),
    rp: <>{artText.rp().split("\n").map((s, i) => <p key={i}>{s}</p>)}</>,
    r12: <p>중개보수는 금 {fee != null ? <span className="dv fill">{comma(fee)}</span> : cell("fee", null)}원으로 하며, 부가가치세는 {pick("fee_vat", ["별도", "포함"])}로 한다. 지급일은 {pick("fee_when", ["잔금일", "계약일", "기타 지급일"])}로 하며, 별도 약정이 없는 경우 잔금일에 지급한다. 중개보수는 법정 상한을 초과할 수 없다. <span className="won">(요율 {cell("fee_rate", String(rate))} %)</span></p>,
  };

  const bank = CLAUSES.filter((c) => !c.only || c.only === mode || (c.only === "포괄" && pkg));

  return (
    <div className="dp">
      <div className="dp-bar">
        {(["계약서", "확인설명서", "영수증", "임차인 현황표"] as Kind[]).map((k) => (
          <button key={k} className={`dp-chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>{k}</button>
        ))}
        {kind === "계약서" && (<>
          <Segmented size="sm" value={mode} onChange={setMode} style={{ marginLeft: 10 }}
            options={[{ value: "명도", label: "명도조건" }, { value: "승계", label: "승계조건" }]} />
          {mode === "승계" && (
            <button className={`dp-chip ${pkg ? "on" : ""}`} onClick={() => setPkg(!pkg)}>포괄양수도</button>
          )}
        </>)}
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
          <h2 key="t">부동산 매매계약서</h2>,
          <p key="st" className="subt">상업용 건물·토지 / {mode === "명도" ? "명도조건" : "임차인 승계조건"}{pkg ? " · 사업의 포괄양도·양수" : ""}</p>,
          <p key="i">매도인 {cell("p_s", r?.owner_name)}과 매수인 {cell("p_b", lead?.buyer_name)}은 아래 부동산에 관하여 다음과 같이 매매계약을 체결한다.</p>,
          ...arts.map((a, i) => (
            a.k === "r1" ? <div key={a.k}>{artNode(i, a, tableR1)}</div>
              : <div key={a.k}>{artNode(i, a, artNodes[a.k])}</div>
          )),
          <div key="terms">
            <p className="sect c">특약사항</p>
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
            <div className="tbank">
              {bank.map((c) => (
                <button key={c.t} className={`dp-chip ${c.only ? "dyn" : ""}`} title={c.c}
                  onClick={() => setTerms((p) => (p.includes(c.c) ? p : [...p, c.c]))}>＋ {c.t}</button>
              ))}
            </div>
          </div>,
          <p key="d" className="c big">계약 체결일: {dcell("sign_on", signSeed)}</p>,
          <table key="sg" className="sign cx">
            <tbody>
              <tr><th style={{ width: "22mm" }}>구분</th><th style={{ width: "40mm" }}>성명·법인명/대표자</th><th style={{ width: "36mm" }}>주민·법인등록번호</th><th>주소·전화번호</th><th style={{ width: "18mm" }}>서명·날인</th></tr>
              <tr><td className="lab">매도인</td>
                <td>{cell("s_name", r?.owner_name)}{corp && <> / {cell("s_rep", r?.owner_rep_name)}</>}</td>
                <td className="c">{corp ? cell("s_corpno", r?.owner_corp_no, "w") : rrn("s")}</td>
                <td>{cell("s_addr", r?.owner_addr, "full")}<br />{cell("s_tel", r?.owner_phone ? formatPhone(r.owner_phone) : null)}</td>
                <td className="c"><span className="stamp">(인)</span></td></tr>
              <tr><td className="lab">매수인</td>
                <td>{cell("b_name", lead?.buyer_name)}{lead?.buyer_is_corp && <> / {cell("b_rep", lead?.buyer_rep_name)}</>}</td>
                <td className="c">{lead?.buyer_is_corp ? cell("b_corpno", lead?.buyer_corp_no, "w") : rrn("b")}</td>
                <td>{cell("b_addr", lead?.buyer_addr, "full")}<br />{cell("b_tel", lead?.buyer_phone ? formatPhone(lead.buyer_phone) : null)}</td>
                <td className="c"><span className="stamp">(인)</span></td></tr>
              <tr><td className="lab">개업<br />공인중개사</td>
                <td>{cell("of_name", of?.office_name, "w")}<br />{cell("of_agent", of?.agent_name)}</td>
                <td className="c">{cell("of_regno", of?.reg_no, "w")}</td>
                <td>{cell("of_addr", of?.office_addr, "full")}<br />{cell("of_tel", of?.phone)}</td>
                <td className="c"><span className="stamp">(인)</span></td></tr>
            </tbody>
          </table>,
        ]} />
        <div className="aacts">
          <button className="dp-chip" onClick={() => {
            const kk = `c${artN}`; setArtN(artN + 1);
            setArts((p) => [...p, { k: kk, label: "특별 약정", text: "" }]);
            setEd(`tx_${kk}`); setTx("");
          }}>＋ 조항</button>
          <button className="dp-chip" onClick={() => {
            setArts([...STD_ARTS.map((a) => ({ ...a, text: null })), ...(pkg ? [{ ...PKG_ART }] : [])]);
          }}>원본으로 리셋</button>
        </div>
      </>)}

      {kind === "확인설명서" && (<>
        {/* ── 1쪽 ── */}
        <div className="sheet"><div className="doc ds">
          <span className="pg">(4쪽 중 제1쪽)</span>
          <div className="head">■ 공인중개사법 시행규칙 [별지 제20호의2서식]</div>
          <h2 className="sm">중개대상물 확인·설명서[Ⅱ] (비주거용 건축물)</h2>
          <div className="sub">( {ck("u_biz")} 업무용　{ck("u_com", true)} 상업용　{ck("u_ind")} 공업용　{ck("u_sale", true)} 매매·교환　{ck("u_rent")} 임대　{ck("u_etc")} 그 밖의 경우 )</div>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={2} style={{ width: "19mm" }}>확인·설명<br />자료</td>
                <td className="lab w">확인·설명<br />근거자료 등</td>
                <td className="note">{ck("d1")} 등기권리증　{ck("d2", true)} 등기사항증명서　{ck("d3", true)} 토지대장　{ck("d4", true)} 건축물대장　{ck("d5", true)} 지적도<br />
                  {ck("d6")} 임야도　{ck("d7", true)} 토지이용계획확인서　{ck("d8")} 그 밖의 자료( {cell("d_etc", null, "w")} )</td></tr>
              <tr><td className="lab w">대상물건의 상태에<br />관한 자료요구 사항</td><td>{cell("d_req", null, "full")}</td></tr>
            </tbody>
          </table>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={2} style={{ width: "19mm" }}>유의사항</td>
                <td className="lab w">개업공인중개사의<br />확인·설명 의무</td>
                <td className="note">개업공인중개사는 중개대상물에 관한 권리를 취득하려는 중개의뢰인에게 성실·정확하게 설명하고, 토지대장 등본, 등기사항증명서 등 설명의 근거자료를 제시해야 합니다.</td></tr>
              <tr><td className="lab w">실제 거래가격<br />신고</td>
                <td className="note">「부동산 거래신고 등에 관한 법률」 제3조 및 같은 법 시행령 제3조제1항제5호에 따른 실제 거래가격은 매수인이 매수한 부동산을 양도하는 경우 「소득세법」 제97조제1항 및 제7항과 같은 법 시행령 제163조제11항제2호에 따라 취득 당시의 실제 거래가액으로 보아 양도차익이 계산될 수 있음을 유의하시기 바랍니다.</td></tr>
            </tbody>
          </table>
          <p className="sect">Ⅰ. 개업공인중개사 기본 확인사항</p>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={8} style={{ width: "17mm" }}>① 대상물건<br />의 표시</td>
                <td className="lab n" rowSpan={2} style={{ width: "13mm" }}>토지</td><td className="lab n">소재지</td>
                <td colSpan={5}>{cell("addr", addr, "xw")}</td></tr>
              <tr><td className="lab n">면적(㎡)</td><td>{cell("larea2", bn("land_area") != null ? comma(bn("land_area")) : null)}</td>
                <td className="lab n" rowSpan={1}>지목</td><td className="lab n" style={{ fontWeight: 500 }}>공부상 지목</td><td>{cell("jimok2", bs("jimok"))}</td>
                <td className="lab n" style={{ fontWeight: 500 }}>실제이용 상태</td><td>{cell("real_use", bs("land_use"))}</td></tr>
              <tr><td className="lab n" rowSpan={6}>건축물</td><td className="lab n">전용면적(㎡)</td><td>{cell("barea2", bn("total_area") != null ? comma(bn("total_area")) : null)}</td>
                <td className="lab n" colSpan={2}>대지지분(㎡)</td><td colSpan={3}>{cell("share2", null)}</td></tr>
              <tr><td className="lab n">준공년도<br />(증개축년도)</td><td>{cell("built", bs("approval_ymd") ? String(bs("approval_ymd")).slice(0, 4) : null)}{bs("remodel_ymd") ? <> ({cell("remodel", String(bs("remodel_ymd")).slice(0, 4))})</> : null}</td>
                <td className="lab n" rowSpan={1}>용도</td><td className="lab n" style={{ fontWeight: 500 }}>건축물대장상 용도</td><td>{cell("use2", bs("main_use_name"))}</td>
                <td className="lab n" style={{ fontWeight: 500 }}>실제 용도</td><td>{cell("real_use2", null)}</td></tr>
              <tr><td className="lab n">구조</td><td>{cell("struct2", bs("structure"))}</td>
                <td className="lab n" colSpan={2}>방향</td><td colSpan={3}>{cell("dir", null)} <span className="dc-sub2">(기준: {cell("dir_base", null)})</span></td></tr>
              <tr><td className="lab n">내진설계 적용여부</td><td>{cell("quake", null)}</td>
                <td className="lab n" colSpan={2}>내진능력</td><td colSpan={3}>{cell("quake_cap", null)}</td></tr>
              <tr><td className="lab n">건축물대장상<br />위반건축물 여부</td><td>{ck("viol")} 위반　{ck("legal")} 적법</td>
                <td className="lab n" colSpan={2}>위반내용</td><td colSpan={3}>{cell("viol_c", null, "w")}</td></tr>
            </tbody>
          </table>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={6} style={{ width: "17mm" }}>② 권리관계</td>
                <td className="lab n" rowSpan={5} style={{ width: "13mm" }}>등기부<br />기재사항</td>
                <td className="lab n" rowSpan={1} style={{ width: "13mm" }} />
                <td className="c" colSpan={2}>소유권에 관한 사항</td><td className="c" colSpan={2}>소유권 외의 권리사항</td></tr>
              <tr><td className="lab n" rowSpan={2}>토지</td>
                <td className="note own" colSpan={2} rowSpan={2}>{cell("own_l1", null, "full")}</td>
                <td className="note own" colSpan={2} rowSpan={2}>{cell("own_l2", null, "full")}</td></tr>
              <tr />
              <tr><td className="lab n" rowSpan={2}>건축물</td>
                <td className="note own" colSpan={2} rowSpan={2}>{cell("own_b1", null, "full")}</td>
                <td className="note own" colSpan={2} rowSpan={2}>{cell("own_b2", null, "full")}</td></tr>
              <tr />
              <tr><td className="lab n" colSpan={2}>민간임대<br />등록여부</td>
                <td colSpan={4}>{ck("mr1")} 장기일반민간임대주택　{ck("mr2")} 공공지원민간임대주택　{ck("mr3")} 단기민간임대주택<br />{ck("mr0", true)} 해당 사항 없음</td></tr>
            </tbody>
          </table>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={7} style={{ width: "17mm" }}>③ 토지이용계획,<br />공법상 이용제한<br />및 거래규제에<br />관한 사항<br />(토지)</td>
                <td className="lab n" rowSpan={3} style={{ width: "13mm" }}>지역·<br />지구</td>
                <td className="lab n">용도지역</td><td colSpan={2}>{cell("zone", zoneMix)}</td>
                <td className="lab n" style={{ width: "19mm" }}>건폐율 상한</td><td className="c" style={{ width: "17mm" }}>{cell("bcr", legal("legal_bcr"))} %</td></tr>
              <tr><td className="lab n">용도지구</td><td colSpan={2}>{cell("zone2", null, "w")}</td>
                <td className="lab n">용적률 상한</td><td className="c">{cell("far", legal("legal_far"))} %</td></tr>
              <tr><td className="lab n">용도구역</td><td colSpan={4}>{cell("zone3", null, "w")}</td></tr>
              <tr><td className="lab n" colSpan={2}>도시·군계획시설</td><td colSpan={2}>{cell("cityplan", null, "w")}</td>
                <td className="lab n">허가·신고<br />구역 여부</td><td>{ck("lta")} 토지거래허가구역</td></tr>
              <tr><td className="lab n" colSpan={2}>투기지역 여부</td><td colSpan={4}>{ck("spec1")} 토지투기지역　{ck("spec2")} 주택투기지역　{ck("spec3")} 투기과열지구</td></tr>
              <tr><td className="lab n" colSpan={2}>지구단위계획구역,<br />그 밖의 도시·군관리계획</td><td colSpan={4}>{cell("district", null, "full")}</td></tr>
              <tr><td className="lab n" colSpan={2}>그 밖의 이용제한<br />및 거래규제사항</td><td colSpan={4}>{cell("reg_etc", null, "full")}</td></tr>
            </tbody>
          </table>
        </div></div>

        {/* ── 2쪽 ── */}
        <div className="sheet"><div className="doc ds">
          <span className="pg">(4쪽 중 제2쪽)</span>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={5} style={{ width: "17mm" }}>④ 입지조건</td>
                <td className="lab n" style={{ width: "18mm" }}>도로와의 관계</td>
                <td colSpan={3}>( {cell("road_w1", null)} m × {cell("road_w2", null)} m )도로에 접함　{ck("paved", true)} 포장　{ck("unpaved")} 비포장 <span className="dc-sub2">{cell("road_rel", bs("road_frontage"))}</span></td></tr>
              <tr><td className="lab n">접근성</td><td colSpan={3}>{ck("acc_ok")} 용이함　{ck("acc_bad")} 불편함</td></tr>
              <tr><td className="lab n" rowSpan={2}>대중교통</td><td className="lab n" style={{ width: "13mm" }}>버스</td>
                <td colSpan={2}>( {cell("bus", bus?.정류장 ?? null)} ) 정류장,　소요시간: ( {ck("bus_walk", bus?.도보 != null)} 도보　{ck("bus_car")} 차량 )　약 {cell("bus_min", bus?.도보 != null ? String(bus.도보) : null)} 분</td></tr>
              <tr><td className="lab n">지하철</td>
                <td colSpan={2}>( {cell("subway", sw?.역명 ?? null)} ) 역,　소요시간: ( {ck("sub_walk", sw?.도보 != null)} 도보　{ck("sub_car")} 차량 )　약 {cell("subway_min", sw?.도보 != null ? String(sw.도보) : null)} 분</td></tr>
              <tr><td className="lab n">주차장</td><td colSpan={3}>{ck("pk_no", bn("parking") == null)} 없음　{ck("pk_own", bn("parking") != null && bn("parking")! > 0)} 전용주차시설　{ck("pk_shared")} 공동주차시설　{ck("pk_etc")} 그 밖의 주차시설 ( {cell("pk_c", null)} )</td></tr>
            </tbody>
          </table>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={2} style={{ width: "17mm" }}>⑤ 관리에<br />관한사항</td>
                <td className="lab n" style={{ width: "18mm" }}>경비실</td><td>{ck("guard_yes")} 있음　{ck("guard_no")} 없음</td></tr>
              <tr><td className="lab n">관리주체</td><td>{ck("mg_out")} 위탁관리　{ck("mg_self")} 자체관리　{ck("mg_etc")} 그 밖의 유형</td></tr>
            </tbody>
          </table>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={2} style={{ width: "17mm" }}>⑥ 거래예정<br />금액 등</td>
                <td className="lab w">거래예정금액</td><td colSpan={3}>{cell("deal2", deal != null ? `${comma(deal)} 원` : null)}</td></tr>
              <tr><td className="lab w">개별공시지가(㎡당)</td><td>{cell("gongsi", bn("gongsi_latest") != null ? `${comma(bn("gongsi_latest"))} 원` : null)}</td>
                <td className="lab n" style={{ width: "24mm" }}>건물(주택)공시가격</td><td>{cell("gongsi_b", null, "w")}</td></tr>
            </tbody>
          </table>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={2} style={{ width: "17mm" }}>⑦ 취득 시 부담할<br />조세의 종류 및 세율</td>
                <td className="lab n">취득세</td><td className="c">{cell("tax_acq", "4")} %</td>
                <td className="lab n">농어촌특별세</td><td className="c">{cell("tax_rural", "0.2")} %</td>
                <td className="lab n">지방교육세</td><td className="c">{cell("tax_edu", "0.4")} %</td></tr>
              <tr><td className="note" colSpan={6}>※ 재산세는 6월 1일 기준 대상물건 소유자가 납세의무를 부담</td></tr>
            </tbody>
          </table>
          <p className="sect">Ⅱ. 개업공인중개사 세부 확인사항</p>
          <table>
            <tbody>
              <tr><td className="lab" style={{ width: "34mm" }}>⑧ 실제 권리관계 또는<br />공시되지 않은 물건의<br />권리 사항</td>
                <td style={{ verticalAlign: "top", height: "22mm" }}>{cell("real_r", tenants.length
                  ? `임대차 ${tenants.length}건 — 보증금 합계 ${comma(rentSum.dep)}원, 월세 합계 ${comma(rentSum.mo)}원 (상세는 별지 임차인 현황표)` : null, "full")}</td></tr>
            </tbody>
          </table>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={13} style={{ width: "17mm" }}>⑨ 내부·외부<br />시설물의 상태<br />(건축물)</td>
                <td className="lab n" rowSpan={2} style={{ width: "15mm" }}>수도</td><td className="lab n" style={{ width: "17mm" }}>파손 여부</td>
                <td>{ck("w_no", true)} 없음　{ck("w_yes")} 있음 <span className="dc-sub2">(육안으로 확인가능한 범위내에서 특이사항없음)</span></td></tr>
              <tr><td className="lab n">용수량</td><td>{ck("wq_ok", true)} 정상　{ck("wq_low")} 부족함 <span className="dc-sub2">(육안으로 확인가능한 범위내에서 특이사항없음)</span></td></tr>
              <tr><td className="lab n">전기</td><td className="lab n">공급상태</td><td>{ck("e_ok", true)} 정상　{ck("e_fix")} 교체 필요 <span className="dc-sub2">(육안으로 확인가능한 범위내에서 특이사항없음)</span></td></tr>
              <tr><td className="lab n">가스(취사용)</td><td className="lab n">공급방식</td><td>{ck("g_city")} 도시가스　{ck("g_etc")} 그 밖의 방식 <span className="dc-sub2">(육안으로 확인가능한 범위내에서 특이사항없음)</span></td></tr>
              <tr><td className="lab n" rowSpan={2}>소방</td><td className="lab n">소화전</td><td>{ck("f_no")} 없음　{ck("f_yes")} 있음 <span className="dc-sub2">(육안으로 확인가능한 범위내에서 특이사항없음)</span></td></tr>
              <tr><td className="lab n">비상벨</td><td>{ck("bell_no")} 없음　{ck("bell_yes")} 있음 <span className="dc-sub2">(육안으로 확인가능한 범위내에서 특이사항없음)</span></td></tr>
              <tr><td className="lab n" rowSpan={3}>난방방식 및<br />연료공급</td><td className="lab n">공급방식</td><td>{ck("h_central")} 중앙공급　{ck("h_indiv")} 개별공급</td></tr>
              <tr><td className="lab n">시설작동</td><td>{ck("h_ok")} 정상　{ck("h_fix")} 수선 필요 ( {cell("h_c", null)} )</td></tr>
              <tr><td className="lab n">종류</td><td>{ck("h_gas")} 도시가스　{ck("h_oil")} 기름　{ck("h_lpg")} 프로판가스　{ck("h_coal")} 연탄　{ck("h_etc")} 그 밖의 종류 ( {cell("h_kind", null)} )</td></tr>
              <tr><td className="lab n" colSpan={2}>승강기</td><td>{ck("el_yes", bn("elevator") != null && bn("elevator")! > 0)} 있음 ( {ck("el_ok")} 양호　{ck("el_bad")} 불량 )　{ck("el_no", bn("elevator") == null)} 없음</td></tr>
              <tr><td className="lab n" colSpan={2}>배수</td><td>{ck("dr_ok", true)} 정상　{ck("dr_fix")} 수선 필요 ( {cell("dr_c", null)} )</td></tr>
              <tr><td className="lab n" colSpan={2}>그 밖의 시설물</td><td>{cell("etc_fac", bn("septic_cap") != null ? `오수정화시설 ${comma(bn("septic_cap"))}인용` : null, "full")}</td></tr>
              <tr />
            </tbody>
          </table>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={2} style={{ width: "17mm" }}>⑩ 벽면</td>
                <td className="lab n" rowSpan={2} style={{ width: "15mm" }}>벽면</td><td className="lab n" style={{ width: "17mm" }}>균열</td>
                <td>{ck("cr_no", true)} 없음　{ck("cr_yes")} 있음 ( 위치: {cell("cr_c", null, "w")} )</td></tr>
              <tr><td className="lab n">누수</td><td>{ck("lk_no", true)} 없음　{ck("lk_yes")} 있음 ( 위치: {cell("lk_c", null, "w")} )</td></tr>
            </tbody>
          </table>
        </div></div>

        {/* ── 3쪽 ── */}
        <div className="sheet"><div className="doc ds">
          <span className="pg">(4쪽 중 제3쪽)</span>
          <p className="sect" style={{ marginTop: 0 }}>Ⅲ. 중개보수 등에 관한 사항</p>
          <table>
            <tbody>
              <tr><td className="lab" rowSpan={4} style={{ width: "24mm" }}>⑪ 중개보수<br />및 실비의 금액과<br />산출내역</td>
                <td className="lab n">중개보수</td><td style={{ width: "44mm" }}>{cell("fee", fee != null ? `${comma(fee)} 원` : null)}</td>
                <td rowSpan={4} className="note" style={{ verticalAlign: "top" }}>&lt;산출내역&gt;<br /><br />
                  중개보수: {deal != null ? <span className="fill">{comma(deal)}원 × {rate}% = {comma(fee)}원</span> : <span className="b w" />}<br /><br />
                  실　　비: {cell("fee_x_c", null, "w")}<br /><br />
                  <span className="dc-sub2">※ 중개보수는 시·도 조례로 정한 요율한도에서 협의하여 결정하며 부가가치세는 별도로 부과될 수 있습니다.</span></td></tr>
              <tr><td className="lab n">실비</td><td>{cell("fee_x", null, "w")}</td></tr>
              <tr><td className="lab n">계</td><td>{cell("fee_sum", fee != null ? `${comma(fee + (parseAmount(v["fee_x"] ?? "") ?? 0))} 원` : null)}</td></tr>
              <tr><td className="lab n">지급시기</td><td>{cell("fee_when2", null, "w")}</td></tr>
            </tbody>
          </table>
          <p className="note" style={{ margin: "5mm 0" }}>「공인중개사법」 제25조제3항 및 제30조제5항에 따라 거래당사자는 개업공인중개사로부터 위 중개대상물에 관한 확인·설명 및 손해배상책임의 보장에 관한 설명을 듣고, 같은 법 시행령 제21조제3항에 따른 본 확인·설명서와 같은 법 시행령 제24조제2항에 따른 손해배상책임 보장 증명서류(사본 또는 전자문서)를 수령합니다.</p>
          <p className="c big">{dcell("st_on", signSeed)}</p>
          <table className="sign">
            <tbody>
              <tr><td className="lab" rowSpan={2} style={{ width: "22mm" }}>매도인<br />(임대인)</td>
                <td className="lab n">주소</td><td style={{ width: "58mm" }}>{cell("s_addr", r?.owner_addr, "full")}</td>
                <td className="lab n">성명</td><td>{cell("s_name", r?.owner_name)} <span className="stamp">(서명 또는 날인)</span></td></tr>
              <tr><td className="lab n">생년월일</td><td>{cell("s_birth", born(idno.s))}</td>
                <td className="lab n">전화번호</td><td>{cell("s_tel", r?.owner_phone ? formatPhone(r.owner_phone) : null)}</td></tr>
              <tr><td className="lab" rowSpan={2}>매수인<br />(법인)</td>
                <td className="lab n">주소</td><td>{cell("b_addr", lead?.buyer_addr, "full")}</td>
                <td className="lab n">성명</td><td>{cell("b_name", lead?.buyer_name)} <span className="stamp">(서명 또는 날인)</span></td></tr>
              <tr><td className="lab n">생년월일</td><td>{cell("b_birth", born(idno.b))}</td>
                <td className="lab n">전화번호</td><td>{cell("b_tel", lead?.buyer_phone ? formatPhone(lead.buyer_phone) : null)}</td></tr>
              {([1, 2] as const).map((n) => (
                <Fragment key={n}>
                  <tr><td className="lab" rowSpan={3}>개업<br />공인중개사</td>
                    <td className="lab n">등록번호</td><td>{cell(`of${n}_regno`, n === 1 ? of?.reg_no : null, "w")}</td>
                    <td className="lab n">성명<br />(대표자)</td><td>{cell(`of${n}_agent`, n === 1 ? of?.agent_name : null)} <span className="stamp">(서명 및 날인)</span></td></tr>
                  <tr><td className="lab n">사무소 명칭</td><td>{cell(`of${n}_name`, n === 1 ? of?.office_name : null, "w")}</td>
                    <td className="lab n">소속<br />공인중개사</td><td>{cell(`of${n}_sub`, null)} <span className="stamp">(서명 및 날인)</span></td></tr>
                  <tr><td className="lab n">사무소 소재지</td><td>{cell(`of${n}_addr`, n === 1 ? of?.office_addr : null, "full")}</td>
                    <td className="lab n">전화번호</td><td>{cell(`of${n}_tel`, n === 1 ? of?.phone : null)}</td></tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div></div>

        {/* ── 4쪽 · 작성방법 ── */}
        <div className="sheet"><div className="doc ds guide">
          <span className="pg">(4쪽 중 제4쪽)</span>
          <p className="sect c" style={{ marginTop: 0 }}>작성방법(비주거용 건축물)</p>
          <p className="gh">&lt;작성일반&gt;</p>
          <ol>{GUIDE_GENERAL.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <p className="gh">&lt;세부항목&gt;</p>
          <ol>{GUIDE_DETAIL.map((s, i) => <li key={i}>{s}</li>)}</ol>
          <p className="note">※ 민간임대주택은 「민간임대주택에 관한 특별법」 제5조에 따른 임대사업자가 등록한 주택으로서, 임대인과 임차인간 임대차 계약(재계약 포함)시 다음과 같은 사항이 적용됩니다.<br />
            ① 같은 법 제44조에 따라 임대의무기간 중 임대료 증액청구는 5퍼센트의 범위에서 주거비 물가지수, 인근 지역의 임대료 변동률 등을 고려하여 같은 법 시행령으로 정하는 증액비율을 초과하여 청구할 수 없으며, 임대차계약 또는 임대료 증액이 있은 후 1년 이내에는 그 임대료를 증액할 수 없습니다.<br />
            ② 같은 법 제45조에 따라 임대사업자는 임차인이 의무를 위반하거나 임대차를 계속하기 어려운 경우 등에 해당하지 않으면 임대의무기간 동안 임차인과의 계약을 해제ㆍ해지하거나 재계약을 거절할 수 없습니다.</p>
          <p className="note c" style={{ marginTop: "6mm" }}>210mm×297mm[백상지(80g/㎡) 또는 중질지(80g/㎡)]</p>
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
                  <th className="r">{comma(rentSum.mg)}</th><th /></tr>
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
