import { StopStage } from "../../shared/api/endpoints";

/** 사다리 — **목차이자 진행 표시이자 할 일 목록**(S04b §7.2).
 *
 *  단계는 사람이 찍지 않는다. 필드에서 파생된다(0091 뷰) — 각 칸의 「끝났다 =」가 규칙이고,
 *  **빈 칸이 곧 할 일**이다.
 *
 *  **사다리는 순서 강제가 아니라 지도다**(2026-08-17). 실무는 겹쳐 돈다 — 의사도 모르는
 *  매물에 광고가 올라가 있고, 정보를 확인하면서 매수자를 찾는다. 그래서 칸의 done 은
 *  「지금 칸보다 앞이냐」가 아니라 **그 칸의 플래그**로 그린다. 순서를 가정해 그리면
 *  이미 한 일이 안 한 것처럼 숨는다. now(강조)는 첫 미완 칸 — 「다음에 뭘 하나」의 답이다.
 */
export const LADDER: { key: StopStage; label: string; flag: string; busy?: string }[] = [
  { key: "owner",  label: "소유자", flag: "s1_owner" },
  // 접촉과 의사는 **한 칸**이다(0125) — 같은 통화에서 끝나는 일을 둘로 쪼개면
  // 같은 사람에게 창을 두 번 열고, 「접촉 초록·의사 회색」 같은 반쪽 상태가 늘어선다.
  { key: "touch",  label: "접촉",   flag: "s2_touch" },
  { key: "info",   label: "정보",   flag: "s4_info" },
  // 자료·노출은 칸이 아니다(0101·2026-08-18) — 매매를 위한 체크리스트.
  // 다섯째 칸은 **계약**(2026-08-19 · 0115): 누구와 · 얼마에가 둘 다 섰다.
  // 「매칭」은 부동산에서 안 쓰는 낱말이라 뜻이 안 통했다. 담기만 한 상태는 노랑(busy).
  { key: "match",  label: "계약",   flag: "s6_match", busy: "s6_open" },
];

/** ②매수자 사다리(0092) — 같은 컴포넌트를 ladder 프롭으로 재사용한다 */
/** ②매수자 사다리(0106) — 확보·접촉·조건은 **한 칸**이다(한 통화에서 같이 끝난다).
 *  그 뒤는 매물과 같은 레일: 계약 → 잔금 → 신고(대표 쌍의 거래 사다리). */
export const BUYER_LADDER: { key: string; label: string; flag: string; busy?: string }[] = [
  { key: "buyer", label: "매수자", flag: "b1_buyer" },
  { key: "match", label: "계약",   flag: "b4_match", busy: "b4_open" },
];

/** ③제안 사다리(0093) — 후보는 늘 참이라 칸에서 뺀다(쌍이 섰으니 카드가 있다) */
export const DEAL_LADDER: { key: string; label: string; flag: string; busy?: string }[] = [
  // 브리핑·조율·임장은 칸이 아니다(2026-08-19) — 전부 **매칭 창 안의 일**이다:
  // 담고 → 보여주고 → 값이 오가고 → 맞는다. 상대가 같은 사람이라 칸으로 쪼개면
  // 같은 사람을 세 번 열게 된다. 레일은 매칭 다음이 곧 계약 절차다.
  // 가계약·계약서는 칸이 아니다(2026-08-19) — 계약 칸 하나가 「누구와·얼마에·언제」를
  // 다 안고, 서류는 그 창의 체크리스트다. 칸으로 세우면 같은 계약을 세 번 열게 된다.
  { key: "pay",   label: "잔금",   flag: "d7_pay" },
  { key: "file",  label: "신고",   flag: "d8_file" },
];
export const DEAL_STAGE_KO: Record<string, string> = {
 pay: "잔금 전", file: "신고 전", done: "완료", out: "이탈",
};

/** 칸 색 판정 — **여기 하나뿐**(2026-08-18). 목록 칩·레일 칩·창 칩이 전부 이 함수를 쓴다.
 *  두 곳에서 계산하면 어디선 회색 어디선 노랑이 된다(그 버그로 이 함수가 생겼다).
 *    ok(초록)   그 칸의 「끝났다」가 참 — 파생 플래그 또는 강제 완료
 *    hold(빨강) 그 칸에 열린 정지가 있다
 *    doing(노랑) 최근 7일 움직임(서버 cell_last_on) 또는 창에서 지금 손댄 것(local)
 *    ''(회색)   시작 전
 *  창은 저장 전 화면 값을 반영해야 하므로 done/local 을 넘겨 준다 — 규칙은 그대로다. */
export function cellCls(o: {
  done?: boolean; stopped?: boolean; lastOn?: string | null; local?: boolean;
  busy?: boolean;   /** 값은 아직 없지만 손대는 중 — 서버가 아는 부분 채움(예: 후보만 담김) */
}): "" | "ok" | "hold" | "doing" {
  if (o.done) return "ok";
  if (o.stopped) return "hold";
  if (o.busy) return "doing";
  const fresh = !!o.lastOn && (Date.now() - new Date(o.lastOn).getTime()) / 864e5 <= 7;
  return (o.local || fresh) ? "doing" : "";
}

/** 칸의 상태 — **DB가 낸다**(0119~0121). 화면은 색만 칠한다.
 *  none 시작 전(빈 원) · open 손댔다(회색 채움) · busy 진행 중(노랑) · done(초록) · stop(빨강)
 *  매물 행에는 매물 칸이, 대표 제안에는 거래 칸이 실린다 — 둘을 합쳐 한 사다리로 읽는다. */
export type CellState = "none" | "open" | "busy" | "done" | "stop";
export function cellsOf(row: unknown): Record<string, CellState> {
  const r = (row ?? {}) as Record<string, unknown>;
  const one = (v: unknown) => (typeof v === "string" ? JSON.parse(v) : (v ?? {})) as Record<string, CellState>;
  const out = { ...one(r.deal_cells), ...one(r.cells) };
  // 합의 축이 정본(2026-08-24) — 계약 칸은 nego로 보정한다.
  // 뷰(s6_*)는 담김·채택·소화만 알아서 「합의중」(값이 오감)을 몰랐고,
  // 그 탓에 목록·모달은 합의중인데 레일 계약 칸은 회색으로 어긋났다.
  const n = Number(r.nego ?? 0);
  if (n >= 4) out.match = "done";
  else if (n >= 2 && out.match !== "done") out.match = "busy";
  else if (n >= 1 && (out.match ?? "none") === "none") out.match = "open";
  return out;
}
/** 그 칸을 무슨 색으로 — 상태 이름과 클래스는 1:1이다(해석이 끼어들 자리가 없다) */
export function cellCls2(st: CellState | undefined): "" | "half" | "doing" | "ok" | "hold" {
  return st === "done" ? "ok" : st === "stop" ? "hold" : st === "busy" ? "doing"
       : st === "open" ? "half" : "";
}

/** **어디까지 왔나** — 목록의 점이 가리키는 칸(2026-08-19).
 *
 *  「첫 미완 칸」만 보면 뒤를 못 본다: 매수자는 조건을 안 넣은 채로 계약까지 가는 일이 흔한데,
 *  그러면 계약 상대인 사람이 목록에서 「매수자」 회색으로 남는다(레일은 계약이 초록인데).
 *  그래서 **마지막으로 넘은 칸과 첫 미완 칸 중 더 뒤엣것**을 고른다 — 사다리는 순서 강제가
 *  아니라 지도이므로(§2.1), 목록도 「가장 멀리 간 지점」을 말해야 레일과 같은 말이 된다.
 */
export function railNow(row: unknown, ladder: { key: string; label: string; flag: string }[]) {
  const cells = cellsOf(row);
  let last = -1;
  // 「간 곳」 = 상태가 none 이 아닌 마지막 칸. 담아 둔 것(open)도 시작한 것이다.
  ladder.forEach((x, i) => { const st = cells[x.key]; if (st && st !== "none") last = i; });
  const firstOpen = ladder.findIndex((x) => (cells[x.key] ?? "none") !== "done");
  // 다 넘었으면 **마지막 칸**을 말한다(2026-08-20) — 「완료」라고 쓰면 레일의 마지막 칸(신고)과
  // 목록의 낱말이 달라져 같은 것을 두 이름으로 부르게 된다. 끝났다는 건 색(초록)이 말한다.
  if (firstOpen < 0) return ladder[ladder.length - 1] ?? null;
  return ladder[Math.max(last, firstOpen)] ?? null;
}

/** **막는 칸** — 목록 칩이 고르는 자리(2026-08-20).
 *
 *  railNow 는 「가장 멀리 간 칸」이라, 소유자도 못 잡은 매물에 매수자가 붙으면 목록엔
 *  「협의 전」이 뜨고 현황판엔 「소유자를 아직 모릅니다」가 떴다 — 같은 매물이 두 말을 했다.
 *  칩은 현황판과 같은 칸(첫 미완 칸)을 고른다. 협의가 어디까지 갔는지는 카드를 열면 안다.
 */
export function railBlock(row: unknown, ladder: { key: string; label: string; flag: string }[]) {
  const cells = cellsOf(row);
  const first = ladder.findIndex((x) => (cells[x.key] ?? "none") !== "done");
  return (first < 0 ? ladder[ladder.length - 1] : ladder[first]) ?? null;
}

/** **지금 칸의 색** — 목록 칩과 레일이 같은 답을 내도록(2026-08-19).
 *  레일만 busy(부분 채움)를 보고 목록 칩은 안 봐서, 같은 매물이 목록에선 회색·레일에선
 *  노랑으로 보였다. 색 규칙은 cellCls 하나였는데 **먹이는 재료가 달라** 어긋난 것이다. */
export function stageCls(row: unknown, stage: string, _ladder?: unknown,
    opts: { stopped?: boolean } = {}) {
  return opts.stopped ? "hold" : cellCls2(cellsOf(row)[stage]);
}

/** 칸별 움직임 꺼내기 — 서버가 jsonb 로 주거나(객체) 문자열로 올 때 모두 */
export function cellLast(row: unknown, cell: string): string | null {
  const raw = (row as { cell_last_on?: Record<string, string | null> | string | null })?.cell_last_on;
  if (!raw) return null;
  const m = typeof raw === "string" ? JSON.parse(raw) as Record<string, string | null> : raw;
  return m?.[cell] ?? null;
}

/** 상태 칩 — **모든 창이 이 하나를 쓴다**. 누르면 순서대로 바뀐다:
 *  회색(시작 전) → 노랑(진행 중) → 빨강(정지) → 회색.
 *
 *  **초록(완료)은 고를 수 없다** — 값이 만든다(2026-08-18 결정). 셋은 전부 「내 의사」라
 *  선언이 곧 사실이지만, 완료는 사실의 문제다. 값 없이 초록을 허용하면 초록이 두 뜻을
 *  갖게 되고(값이 있다 / 내가 눌렀다) 대시보드가 할 일을 숨기며 깔때기 측정이 오염된다.
 *  값이 없는데 진행해야 하는 일이 잦으면 그건 **필드가 현실을 못 담는다는 신호**다. */
const ORDER = ["", "doing", "hold"] as const;
const PICK = { "": "pre", doing: "go", hold: "stop" } as const;

export function StateChip({ label, cls, onPick, sub }: {
  label: string;
  cls: "" | "ok" | "hold" | "doing" | "half";
  sub?: string | null;
  onPick: (s: "pre" | "go" | "stop") => void;
}) {
  // 초록은 값이 만든 상태라 칩이 움직이지 않는다 — 값을 지워야 내려간다.
  // (여기서 회색으로 바꿔 주면 값이 남았는데 회색이 되어 화면이 거짓말을 한다)
  const i = ORDER.indexOf(cls as (typeof ORDER)[number]);
  const next = ORDER[(i < 0 ? 0 : i + 1) % ORDER.length];
  // **상태는 전부 점이다**(2026-08-19) — 목록·레일·창이 한 물건을 쓴다. 알약 칩은 없앴다.
  return (
    <button className={`stg-dot act ${cls}`} disabled={cls === "ok"}
      title={cls === "ok" ? "완료 — 값이 만든 상태입니다(값을 지우면 내려갑니다)" : "누르면 다음 상태로"}
      onClick={() => onPick(PICK[next])}>
      <i />{label}{sub && <em style={{ fontStyle: "normal", marginLeft: 4 }}>{sub}</em>}</button>
  );
}

/** 레일이 읽는 것 — 플래그 이름은 ladder 정의(flag)가 정하므로 아무 객체나 받는다.
 *  Seller·Buyer 가 그대로 들어온다(인덱스 시그니처를 강요하면 호출부마다 캐스트가 는다). */
export type StageInfo = object;

export function StageRail({ row, onOpen, ladder = LADDER }: {
  row: StageInfo;
  onOpen: (stage: string) => void;
  /** 기본은 ①매물. ②매수자는 BUYER_LADDER 를 넘긴다 */
  ladder?: { key: string; label: string; flag: string; busy?: string }[];
}) {
  const flags = row as Record<string, boolean | undefined>;
  const info_filled = (row as { info_filled?: number | null }).info_filled;
  // 멈춘 칸 — 카드만 봐도 어느 칸이 왜 서 있는지 보이게(호박색)
  const stopStage = (row as { stop_stage?: string | null }).stop_stage ?? null;
  // now = 첫 미완 칸. 플래그가 아예 없으면(옛 응답) 첫 칸부터.
  const firstOpen = ladder.find((s) => !flags[s.flag])?.key ?? null;

  return (
    <div className="rail">
      {ladder.map((s) => {
        const done = cellsOf(row)[s.key] === "done" || !!flags[s.flag];
        const now = !done && s.key === firstOpen;
        const held = !done && s.key === stopStage;
        // 정보 칸의 「2/3」은 지금 칸일 때만 — 도달 전 칸의 0/3은 정보가 아니라 소음이다
        const sub = now && s.key === "info" && info_filled != null
          ? `${info_filled}/3` : null;
        // 지금 칸은 점이 아니라 **칩**이다(2026-08-18) — 레일과 상태 칩을 합쳤다.
        // 색이 상태: 멈춤=빨강 · 최근 움직임=노랑 · 그 외 회색. 목록 칩과 같은 규칙.
        // 지금 칸도 **같은 점**이다(2026-08-19) — 전엔 여기만 알약 칩을 끼웠는데,
        // 목록 표시가 점으로 통일되면서 레일 가운데의 칩은 혼자 다른 물건이 됐다.
        // 강조는 모양이 아니라 **테두리와 글자 무게**로 한다(색은 그대로 상태를 말한다).
        // 색은 **모든 칸**이 갖는다(2026-08-19) — 전엔 지금 칸만 칠해서, 앞 칸이 비어 있으면
        // 뒤 칸의 노랑(계약 상대를 골라 둠)이 회색으로 죽었다. 사다리는 순서 강제가 아니다.
        const cls = held ? "hold" : cellCls2(cellsOf(row)[s.key]);
        return (
          <button key={s.key}
            className={`${done ? "done" : ""}${held ? " held" : ""}${now ? " now" : ""} ${cls}`}
            onClick={() => onOpen(s.key)}
            title={held ? `${s.label} — 보류` : done ? `${s.label} — 끝남`
                   : now ? `${s.label} — 다음 할 일` : s.label}>
            <i />
            <b>{s.label}</b>
            {sub && <em>{sub}</em>}
          </button>
        );
      })}
    </div>
  );
}
