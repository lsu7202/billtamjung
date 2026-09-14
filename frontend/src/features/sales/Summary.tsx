import { useQuery } from "@tanstack/react-query";
import { dealApi, salesApi, type Buyer, type Proposal } from "../../shared/api/endpoints";
import { md, wonShort } from "../../shared/format";
import { useEnums } from "../../shared/hooks/useEnums";

/** 남은 날 — 오늘 기준. 음수면 지난 것 */
const dday = (iso: string) => Math.round(
  (new Date(iso + "T00:00:00").getTime() - new Date(new Date().toDateString()).getTime()) / 864e5);
import "./sales.css";

/** 이 짝에 걸린 일정 — 원문(jsonb) 그대로 온다 */
type Sch = { id: number; cat: string | null; on: string; state: string };
const schedsOf = (p: Proposal): Sch[] => {
  const raw = (p as { scheds?: unknown }).scheds;
  const arr = typeof raw === "string" ? JSON.parse(raw) : raw;
  return (arr as Sch[] | null) ?? [];
};
/** 조사 — 앞 낱말의 받침에 맞춘다(「김영순를」은 사람이 안 쓰는 말이다) */
const josa = (w: string, withF: string, withoutF: string) => {
  const c = w.trim().charCodeAt(w.trim().length - 1);
  if (Number.isNaN(c) || c < 0xac00 || c > 0xd7a3) return withoutF;
  return (c - 0xac00) % 28 ? withF : withoutF;
};
const sayDday = (iso: string, what: string) =>
  dday(iso) > 0 ? `${what}까지 ${dday(iso)}일 남았습니다.`
  : dday(iso) === 0 ? `오늘이 ${what}입니다.`
  : `${what}이 ${-dday(iso)}일 지났습니다.`;

/** 계약이 선 뒤의 얼굴 — **날짜와 챙길 것**(2026-08-20).
 *
 *  매수자판과 매물판이 같은 말을 해야 한다. 계약은 한 건인데 화면 둘이 다른 날짜를 말하면
 *  둘 다 못 믿는다. 그래서 계약·잔금·신고 세 얼굴은 여기 한 곳에만 쓴다.
 *  끝난 일은 말하지 않는다 — 남은 일만 알린다.
 */
export function DealFace({ p }: { p: Proposal }) {
  const docs = useQuery({ queryKey: ["deal-docs", p.id], queryFn: () => dealApi.docs(p.id) });
  const items = docs.data?.items ?? [];
  const left = items.filter((d) => !d.done);
  const scheds = schedsOf(p);
  const sch = (c: string) => scheds.find((x) => x.cat === c) ?? null;
  const sign = sch("계약"), mid = sch("중도금"), pay = sch("잔금");
  const signDone = sign?.state === "완료";
  const payDone = pay?.state === "완료";   // 잔금을 **치렀다**(날짜가 지난 것과 다르다)
  // 신고했나 — 레일과 **같은 근거**(0124): 신고일이 찍혔거나 체크리스트에서 체크했거나
  const filed = !!(p as { report_filed_on?: string | null }).report_filed_on
    || items.some((d) => d.code === "r_file" && d.done);
  const todo = left.length === 0 ? null
    : `아직 안 한 일은 ${left.slice(0, 3).map((d) => d.label).join(", ")}${
        left.length > 3 ? ` 외 ${left.length - 3}건` : ""}입니다.`;

  // ① 계약 일정 전 — 날짜부터 잡는다
  if (!signDone) return (<>
    <span className="cur-say">
      {pay ? sayDday(pay.on, "잔금일") : "잔금일을 아직 안 잡았습니다."}
      {sign ? ` 계약일은 ${md(sign.on)}` : " 계약일도 안 잡혔습니다."}
      {sign && mid ? `, 중도금은 ${md(mid.on)}` : ""}
      {sign && pay ? `, 잔금은 ${md(pay.on)}입니다.` : sign ? "입니다." : ""}
    </span>
    {todo && <span className="cur-say todo">{todo}</span>}
  </>);

  // ② 잔금 전 — 남은 날과 챙길 것
  if (!payDone) return (<>
    <span className="cur-say big">{pay ? sayDday(pay.on, "잔금일") : "잔금일을 잡으세요."}</span>
    <span className="cur-say">
      {mid && mid.state !== "완료" ? `중도금은 ${md(mid.on)}, ` : ""}
      {pay ? `잔금은 ${md(pay.on)}입니다.` : "중도금·잔금 날짜가 아직 없습니다."}
      {todo ? ` ${todo}` : " 챙길 서류는 다 챙겼습니다."}
    </span>
  </>);

  // ③ 잔금까지 끝났다 — 신고와 못 챙긴 서류만
  return (<>
    {!filed && (
      <span className="cur-say big">
        {sign
          ? (dday(sign.on) + 30 >= 0
              ? `거래신고까지 ${dday(sign.on) + 30}일 남았습니다.`
              : `거래신고 기한이 ${-(dday(sign.on) + 30)}일 지났습니다.`)
          : "거래신고를 하세요."}
      </span>
    )}
    {(!filed || todo) && (
      <span className="cur-say">
        {!filed && sign ? `계약일(${md(sign.on)})부터 30일이 기한입니다.` : ""}
        {todo ? `${!filed && sign ? " " : ""}${todo}` : ""}
      </span>
    )}
  </>);
}

/** 현황 — **이 매물에 대해 내가 해야 할 일**(2026-08-20, 기록을 대신한다).
 *
 *  기록은 「무슨 말이 오갔나」를 흘렸다. 읽는 데 힘이 들고, 사실과 말이 섞였다.
 *  현황은 **간이 체크리스트**다: 찬 줄은 끝난 일, 빈 줄이 곧 할 일이다.
 *
 *  **여기서는 아무것도 못 고친다**(2026-08-20) — 고치는 일은 창에서만 한다는 규칙 그대로다.
 *  줄을 누르면 그 값을 다루는 창이 열린다. 현황은 「무엇이 남았나」만 답한다.
 */
export function PairSummary({ p, b, onOpen }: {
  p: Proposal; b?: Buyer | null; onOpen: () => void;
}) {
  const sellers = useQuery({ queryKey: ["sellers"], queryFn: () => salesApi.sellers() });
  const s = (sellers.data ?? []).find((x) => x.building_pk === p.building_pk) ?? null;
  const how = p.brief_how ?? [];

  const gap = p.hope_price != null && s?.ask_price != null
    ? Math.abs(s.ask_price - p.hope_price) : null;
  const band = (() => {
    if (!(b?.conditions ?? []).length) return null;
    let lo: number | null = null, hi: number | null = null;
    for (const c of b!.conditions) {
      const f = ((c.conditions_json ?? {}) as { filters?: Record<string, unknown> }).filters ?? {};
      const a = Number(f.price_min ?? 0), z = Number(f.price_max ?? 0);
      if (a > 0) lo = lo == null ? a : Math.min(lo, a);
      if (z > 0) hi = hi == null ? z : Math.max(hi, z);
    }
    if (lo == null && hi == null) return null;
    const label = lo != null && hi != null ? `${wonShort(lo)}~${wonShort(hi)}`
      : lo != null ? `${wonShort(lo)} 이상` : `${wonShort(hi!)} 이하`;
    const v = s?.ask_price ?? null;
    const inBand = v == null ? null : (lo == null || v >= lo) && (hi == null || v <= hi);
    return { label, inBand };
  })();
  const bandSay = band == null ? ""
    : band.inBand == null ? ` 원하는 매매가는 ${band.label}입니다.`
    : band.inBand ? ` 원하는 매매가는 ${band.label}이며 이 매물은 여기에 포함됩니다.`
    : ` 원하는 매매가는 ${band.label}이며 이 매물은 여기에 포함되지 않습니다.`;

  /** 지금 무엇을 보여줄까 — **단계가 정한다**(2026-08-20).
   *  끝난 일을 늘어놓아야 소용없다. 브리핑 전이면 브리핑을, 값이 안 좁혀졌으면 갭을,
   *  계약이 섰으면 날짜들을 보여준다. 화면이 「다음에 뭘 하나」를 대신 기억한다. */
  const mode = b && !(b.conditions ?? []).length ? "cond"
    : !how.length ? "brief" : !p.picked_at ? "price" : "deal";

  const eok = (v?: number | null) => (v ? wonShort(v) : "아직 없음");

  // 끝난 자리 — **한 문장만 남기고 전부 지운다**(2026-08-20).
  //   한쪽이 다른 데서 계약을 마쳤으면 이 짝에서 내가 할 일은 없다.
  //   값도 일정도 서류도 남겨 두면 「아직 뭔가 해야 하나」로 읽힌다.
  const dead = !p.picked_at && ((p as { buyer_dealt?: boolean }).buyer_dealt
    ? "이 매수자는 다른 매물을 계약했습니다."
    : (p as { listing_dealt?: boolean }).listing_dealt
    ? "이 매물은 다른 매수자와 계약되었습니다." : null);
  if (dead) {
    return (
      <button className="cur done" onClick={onOpen}>
        <span className="cur-say big">{dead}</span>
      </button>
    );
  }

  return (
    <button className="cur" onClick={onOpen}>
      {/* ② 한 문장 — 지금 무엇을 하는 자리인지 사람 말로 */}
      {mode === "cond" && (
        <span className="cur-say big">이 매수자가 원하는 매물 조건을 물어보세요.</span>
      )}

      {mode === "brief" && (
        <span className="cur-say">
          아직 브리핑 전입니다. 매도희망가는 {eok(s?.ask_price)}입니다.{bandSay}
        </span>
      )}

      {mode === "price" && (
        <span className="cur-say">
          매도희망가는 {eok(s?.ask_price)}, 매수희망가는 {eok(p.hope_price)}입니다.
          {gap != null ? ` ${wonShort(gap)} 차이입니다.` : " 아직 매수희망가를 못 받았습니다."}
          {bandSay}
        </span>
      )}

      {/* 값 셋 — 문장 아래에 큼직하게. 문장이 상황을 말하고, 숫자가 근거를 댄다 */}
      {mode !== "cond" && (
        <span className="cur-nums">
          <span><i>매매가</i>{eok(s?.list_price)}</span>
          <span><i>매도희망</i>{eok(s?.ask_price)}</span>
          <span className={p.hope_price ? "hi" : ""}><i>매수희망</i>{eok(p.hope_price)}</span>
          {p.deal_price != null && <span className="ok"><i>계약가</i>{eok(p.deal_price)}</span>}
        </span>
      )}
      {/* 계약이 섰다 — 날짜와 챙길 것은 **한 부품**이 말한다(매물판과 같은 말) */}
      {mode === "deal" && <DealFace p={p} />}
    </button>
  );
}


/** 매물의 현황판 — **레일 칸마다 얼굴이 다르다**(2026-08-20).
 *
 *  중개사가 이 매물을 열었을 때 묻는 것은 하나다: 「이제 뭘 하지」. 그래서 끝난 칸은 말하지
 *  않고 **지금 칸 하나**만 사람 말로 답한다. 계약이 서면 날짜와 챙길 것이 그 자리를 받는다
 *  — 매수자판과 같은 부품(DealFace)을 써서 두 화면이 다른 날짜를 말하지 않게 한다.
 *  읽기만 한다 — 누르면 그 칸의 창이 열린다(고치는 일은 창에서).
 */
export function ListingSummary({ r, buyers, onOpen, hasPairs }: {
  r: Record<string, unknown>;
  buyers: Proposal[];
  onOpen: (cell: string) => void;
  /** 아래에 짝(매수자) 현황이 서 있나 — 계약 이야기는 거기서 하므로 여기선 안 한다 */
  hasPairs?: boolean;
}) {
  const { options } = useEnums();
  const cells = ((): Record<string, string> => {
    const c = (r as { cells?: unknown }).cells;
    return (typeof c === "string" ? JSON.parse(c) : (c ?? {})) as Record<string, string>;
  })();
  const g = (k: string) => (r as Record<string, string | null>)[k] ?? null;
  const n = (k: string) => (r as Record<string, number | null>)[k] ?? null;

  // 지금 칸 — 레일에서 강조되는 그 칸이 현황의 주인공이다
  const ORDER = ["owner", "touch", "info", "match"];   // 접촉에 의사가 합쳐졌다(0125)
  const now = ORDER.find((k) => cells[k] !== "done") ?? "match";
  const picked = buyers.find((x) => x.picked_at) ?? null;
  const alive = buyers.filter((x) => !x.dropped_at);
  const best = alive.reduce<number | null>(
    (a, x) => (x.hope_price != null && (a == null || x.hope_price > a) ? x.hope_price : a), null);
  const ask = n("ask_price");
  const eok = (v?: number | null) => (v ? wonShort(v) : "아직 없음");
  const who = g("owner_name") ?? "소유자";

  // 정지 — 「내가 안 한 것」이 아니라 「상대 때문에 못 가는 것」이라 말이 다르다.
  // 사유는 코드로 오므로 낱말(라벨)로 바꿔 읽는다.
  const stopped = cells[now] === "stop";
  const reason = (() => {
    const code = g("stop_reason");
    if (!code) return null;
    return options(`stop_reason_${g("stop_stage") ?? now}`)
      .find((o) => o.code === code)?.label ?? code;
  })();

  // 협의는 앞서 가는데 앞 칸이 비었다(2026-08-20) — 매수자에게 물건부터 보여주고 지주작업을
  // 시작하는 건 실무에서 정상이다. 막을 일은 아니고, **계약서를 쓸 매도인이 없다**는 사실만
  // 그 자리에서 말해 준다. 안 그러면 「협의중인데 왜 못 넘어가지」로 남는다.
  const aheadSay = (now === "owner" || now === "touch") && alive.length > 0
    ? `매수자 ${alive.length}명이 붙어 있는데 ${
        now === "owner" ? "소유자를 아직 못 잡았습니다." : "매도 의사를 아직 못 들었습니다."}`
    : null;

  const info = [["명도", g("meongdo")], ["용도변경", g("use_change")], ["멸실", g("myeolsil")]] as const;
  const unasked = info.filter(([, v]) => !v || v === "미지정").map(([k]) => k);
  const asking = info.filter(([, v]) => v === "확인중").map(([k]) => k);
  // 임대내역 — 물어보는 것이 아니라 **받는 것**이라 말이 다르다(0100)
  const rent = g("rent_check");
  const rentSay = rent === "받음" ? null
    : rent === "확인중" ? "임대내역은 받기로 했습니다." : "임대내역을 아직 못 받았습니다.";

  // 계약 칸에 오면 값·날짜는 **짝 현황**이 말한다(2026-08-20). 여기서 또 말하면 같은 숫자가
  // 한 화면에 두 번 선다. 남는 것은 짝이 대신 못 하는 일 하나 — 임대내역이다.
  if (now === "match" && hasPairs && !stopped) {
    if (!rentSay) return null;
    return (
      <button className="cur" onClick={() => onOpen("info")}>
        <span className="cur-say todo">{rentSay}</span>
      </button>
    );
  }

  return (
    <button className="cur" onClick={() => onOpen(now)}>
      {/* 멈춰 있으면 그 말이 먼저다 — 멈춘 자리에서 다음 할 일을 말하면 잔소리가 된다 */}
      {stopped ? (
        <span className="cur-say big">
          {reason ? `${reason}으로 멈춰 있습니다.` : "지금은 멈춰 있습니다."}
        </span>
      ) : (<>

      {now === "owner" && (
        <span className="cur-say big">
          {g("owner_name")
            ? `${who}의 연락처를 아직 못 찾았습니다.`
            : "이 매물의 소유자가 누구인지 아직 모릅니다."}
        </span>
      )}

      {now === "touch" && (
        <span className="cur-say big">
          {cells.touch === "busy"
            ? `${who}과 통화는 됐습니다. 팔 생각이 있는지 물어보세요.`
            : g("call_result")
              ? `지난 통화는 ${g("call_result")}이었습니다. 다시 걸어 보세요.`
              : `${who}에게 아직 전화를 안 걸었습니다.`}
        </span>
      )}

      {now === "info" && (
        <span className="cur-say big">
          {unasked.length
            ? `${unasked.join(", ")}${josa(unasked[unasked.length - 1], "을", "를")} 아직 못 물었습니다.`
            : `${asking.join(", ")}${josa(asking[asking.length - 1], "은", "는")} 확인중입니다. 답을 받으세요.`}
          {rentSay ? ` ${rentSay.replace("임대내역을", "임대내역도")}` : ""}
        </span>
      )}

      {/* 계약 전 — 값이 얼마나 벌어졌나가 이 칸의 일이다 */}
      {now === "match" && !picked && (
        <span className="cur-say">
          {alive.length === 0
            ? "이 매물을 보여줄 매수자가 아직 없습니다."
            : (() => { const nm = alive.map((x) => x.buyer_name).filter(Boolean).join(", ");
                return `${nm}${josa(nm, "을", "를")} 후보로 담아 뒀습니다. `; })() +
              (ask != null && best != null
                ? `매도희망가는 ${wonShort(ask)}, 가장 높은 매수희망가는 ${wonShort(best)}로 ${
                    wonShort(Math.abs(ask - best))} 차이입니다.`
                : "아직 매수희망가를 못 받았습니다.")}
        </span>
      )}

      {now === "match" && picked && !picked.deal_price && (
        <span className="cur-say big">
          계약 상대는 {picked.buyer_name}입니다. 계약가를 정하세요.
        </span>
      )}

      {aheadSay && <span className="cur-say todo">{aheadSay}</span>}

      {now === "match" && !picked && rentSay && (
        <span className="cur-say todo">{rentSay}</span>
      )}

      {/* 값 셋 — 소유자·접촉 단계에선 아직 값을 말할 때가 아니다(빈 숫자만 늘어난다) */}
      {(now === "info" || now === "match") && (
        <span className="cur-nums">
          <span><i>매매가</i>{eok(n("list_price"))}</span>
          <span><i>매도희망</i>{eok(ask)}</span>
          {picked?.deal_price != null
            ? <span className="ok"><i>계약가</i>{eok(picked.deal_price)}</span>
            : <span className={best ? "hi" : ""}><i>최고 제시</i>{eok(best)}</span>}
        </span>
      )}

      {/* 계약가까지 섰다 — 날짜와 챙길 것(매수자판과 **같은 부품**) */}
      {now === "match" && picked?.deal_price != null && <DealFace p={picked} />}
      </>)}
    </button>
  );
}


/** 매수자 칸의 현황판 — **이 사람을 굴릴 준비가 됐나**(2026-08-20).
 *
 *  레일 첫 칸(매수자)이 묻는 것은 셋이다: 누구인지 아는가(프로필) · 무엇을 원하는지 아는가(조건)
 *  · 보여줄 것을 골랐는가(담기). 셋이 순서대로 쌓이므로 **먼저 빈 것 하나만** 크게 말한다.
 *  나머지는 아래에 작게 세워 둔다 — 다음이 뭔지 보이면 손이 따라간다.
 */
export function BuyerSummary({ b, onProfile, onCond, onPick }: {
  b: Buyer;
  onProfile: () => void; onCond: () => void; onPick: () => void;
}) {
  const hasProfile = !!(b.phone && b.phone.trim());
  const hasCond = (b.conditions ?? []).length > 0;

  // 한 문장이면 된다(2026-08-20) — 설명을 덧붙이면 잔소리가 되고, 잔소리는 안 읽힌다
  const step = !hasProfile ? { say: "매수자 프로필을 채우세요.", go: onProfile }
    : !hasCond ? { say: "이 매수자가 원하는 조건은 무엇인가요?", go: onCond }
    : { say: "조건에 맞는 매물을 담으세요.", go: onPick };

  return (
    <button className="cur" onClick={step.go}>
      {/* 한 문장이 곧 체크리스트다 — 걸음 표시를 또 세우면 같은 말이 두 번 선다(2026-08-20).
          어디까지 왔는지는 카드 위 레일이 이미 말하고 있다. */}
      <span className="cur-say big">{step.say}</span>
    </button>
  );
}
