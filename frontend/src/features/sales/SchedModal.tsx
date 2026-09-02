import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { authApi, contactsApi, salesApi, buyersApi, proposalsApi, teamApi } from "../../shared/api/endpoints";
import { dongAddr } from "../../shared/format";
import { recentPks } from "./recent";
import { Icon } from "../../shared/ui/Icon";
/** 약속 한 건 — 창이 들고 다니는 모양. 규칙 파서가 있던 시절엔 파서가 이 타입을
 *  만들어 줬는데(parseEntry), 파서를 걷어내면서(2026-08-29) 창이 정본이 됐다. */
export interface Sched {
  title: string;                // 브리핑 · 협의 · 만남 · 계약 …
  on: string;                   // YYYY-MM-DD
  /** HH:MM — **안 말했으면 null**. 지어내지 않는다 */
  at: string | null;
  /** 장소 — 「사무실」·「스타벅스」. 없으면 null */
  place: string | null;
  hint: string;
  /** 일정 종류 — 창의 토글이 정본 */
  category?: "일반" | "브리핑" | "임장" | "가계약" | "계약" | "중도금" | "잔금";
}
import "./sales.css";

/** 약속 확정 — 커밋에 약속이 들어 있으면 **엔터를 누르는 순간** 이 창이 뜬다.
 *
 *  왜 창인가: 「내일모레 브리핑」이라고만 쳐도 캘린더엔 서야 하지만, 실제로 필요한 것은
 *  더 있다 — 몇 시인지, 어디서 보는지, 누가 오는지(계약 자리엔 매도자와 매수자가 같이 온다),
 *  우리 쪽은 누가 가는지. 문장에 다 적으라고 하면 문장이 서류가 된다.
 *
 *  생김새: **칸이 아니라 줄**이다. 아이콘이 줄머리를 잡고, 값은 그냥 글자로 놓인다.
 *  빈 자리는 「참석자 추가」처럼 **할 일로 읽히고**, 누르면 그 자리에서 글자를 친다.
 *  네모 입력칸을 여섯 개 쌓으면 서식이 되고, 서식은 채우기 전에는 아무것도 안 알려준다.
 */
export interface SchedFinal extends Sched {
  /** 브리핑 방식(0111) — 종류가 브리핑일 때만. 약속 카드에 적히고 소화하면 브리핑 값이 된다 */
  method?: string;
  /** 계약금·중도금·잔금(0112) — 돈이 오가는 약속이면 여기서 같이 받는다 */
  amount?: number;
  /** 계약과 한자리에서 잡은 **딸린 약속**(2026-08-19) — 중도금·잔금. 부른 쪽이 같이 만든다 */
  extras?: { category: "중도금" | "잔금"; on: string; at?: string | null }[];
  people: { kind: "buyer" | "owner" | "guest"; ref_id?: number; label?: string }[];
  assignee_account_id?: number;
  /** 장부에 남길 문장 — 입력줄에 친 말이 그대로 들어오고, 여기서 고치면 그것이 기록된다 */
  note?: string;
  /** 일정 종류(0088) — 일반·계약·중도금·잔금. 계약은 완료(✓)가 곧 계약 체결이고,
   *  종류에 따라 캘린더 색과 체크리스트가 갈린다. 정본은 이 토글(파서는 기본값만). */
  category?: Cat;
  /** 창에서 붙인 매물 — 맥락 없이 연 창(전체 탭·대시보드)에서도 매물을 지정할 수 있다.
   *  명시 닻은 참석자 추론보다 세다(모달이 본 기능). */
  building_pk?: string | null;
}

export type Cat = "일반" | "브리핑" | "임장" | "가계약" | "계약" | "중도금" | "잔금";
// 브리핑·임장도 종류다(0108) — 거래 칸의 날짜가 캘린더에서 제 이름으로 선다
// 고르는 종류는 넷이다(2026-08-19) — 중도금·잔금은 **계약 창에서 날짜로** 잡히므로
// 처음부터 고를 일이 없다. 이미 그 종류로 선 약속을 열었을 때만 토글에 함께 뜬다.
// 고르는 종류는 넷(2026-08-25) — **임장은 뺐다**. 현장에서 보는 것도 결국 만나는 일이라
// 일반과 갈릴 이유가 없었다. 대신 **가계약**이 들어왔다 — 계약 전에 대금이 먼저 움직이는 날은
// 계약과 다른 날이고, 거래신고 30일이 그날부터 셀 수도 있다.
const CATS: Cat[] = ["일반", "브리핑", "가계약", "계약"];
/** 제목으로 추정하는 기본값 — 서버 guess_category 와 같은 규칙 */
const guessCat = (t: string): Cat =>
  t.startsWith("잔금") ? "잔금" : t.startsWith("중도금") ? "중도금"
  : t.startsWith("가계약") ? "가계약"
  : (t.startsWith("계약") && !t.includes("파기")) ? "계약" : "일반";

/* 줄머리 아이콘 — 스프라이트의 듀오톤 아이콘은 색이 강해 폼에서 시끄럽다.
   여기서는 한 색 선으로만 그린다(글자와 같은 무게로 읽히게). */
const Ico = ({ d, fill }: { d: string; fill?: boolean }) => (
  <svg className="gm-i" viewBox="0 0 24 24" width="17" height="17" aria-hidden
    fill={fill ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.7"
    strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);
const TALK = "M4 5h16v11.5H9.5L5 20.5V5Z";
const CLOCK = "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3.5 2";
const PEOPLE = "M16 19v-1.5a3.5 3.5 0 0 0-3.5-3.5h-5A3.5 3.5 0 0 0 4 17.5V19M9.5 10.5a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM20 19v-1.5a3.5 3.5 0 0 0-2.6-3.4M15.4 4.6a3 3 0 0 1 0 5.8";
const PIN = "M12 21s6-5.7 6-10a6 6 0 1 0-12 0c0 4.3 6 10 6 10ZM12 13a2.2 2.2 0 1 0 0-4.4 2.2 2.2 0 0 0 0 4.4Z";
const BLDG = "M4 21h16M6 21V5.5A1.5 1.5 0 0 1 7.5 4h6A1.5 1.5 0 0 1 15 5.5V21M15 10h2.5A1.5 1.5 0 0 1 19 11.5V21M9 8h3M9 12h3M9 16h3";
const USER = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20a7 7 0 0 1 14 0";
const NOTE = "M5 7h14M5 12h14M5 17h9";
const STAMP = "M12 3v6M8 9h8l1 4H7l1-4ZM5 21h14v-3a2 2 0 0 0-2-2H7a2 2 0 0 0-2 2v3Z";

/** 날짜 줄 하나 — 계약일·중도금일·잔금일이 **똑같이** 쓴다(2026-08-19).
 *  날짜가 없으면(중도금·잔금 처음) 「날짜 잡기」만 서고, 잡으면 계약일과 같은 모양이 된다. */
function DateLine({ label, on, at, autoAt, onOn, onAt, onAsk, onAdd, onClear }: {
  label: string | null;
  on: string | null;
  at: string | null;
  autoAt?: boolean;
  onOn: (v: string) => void;
  onAt: (v: string | null) => void;
  onAsk?: () => void;
  onAdd?: () => void;
  onClear?: () => void;
}) {
  const d = on ? new Date(on) : null;
  return (
    <div className="gm-row">
      <Ico d={CLOCK} />
      <div className="gm-body">
        {label && <span className="gm-lab2">{label}</span>}
        {d ? (<>
          <label className="gm-date">
            {`${d.getMonth() + 1}월 ${d.getDate()}일 (${"일월화수목금토"[d.getDay()]})`}
            <input type="date" value={on!} onChange={(e) => e.target.value && onOn(e.target.value)} />
          </label>
          {autoAt || at != null ? (
            <input className="gm-in tm" type="time" value={at ?? ""} autoFocus={autoAt}
              onChange={(e) => onAt(e.target.value || null)} />
          ) : (
            <button className="gm-add" onClick={() => (onAsk ? onAsk() : onAt(""))}>시각 추가</button>
          )}
          {at != null && <button className="gm-clear" onClick={() => onAt(null)}>시각 지우기</button>}
          {onClear && <button className="gm-clear" onClick={onClear}>지우기</button>}
        </>) : (
          <button className="gm-add" onClick={onAdd}>날짜 잡기</button>
        )}
      </div>
    </div>
  );
}

export function SchedModal({ init, base, addr, buildingPk, note, lockCat, initExtras,
                            onCancel, onSkip, onDone, onFinish, onRemove }: {
  init: Sched;
  /** 입력줄에 친 문장 — 이 약속의 기록이 된다 */
  note?: string;
  /** 이 커밋이 난 매물 — 여기 얽힌 사람들이 참석자 후보로 뜬다 */
  buildingPk?: string | null;
  /** 커밋이 난 자리의 상대 — 기본 참석자로 미리 들어가 있다. 여럿이면 배열
   *  (매수자 이름으로 잡은 약속이라도 매물이 좁혀지면 그 소유자도 같이 온다·2026-08-16) */
  base?: { kind: "buyer" | "owner"; ref_id: number; label: string }
       | { kind: "buyer" | "owner"; ref_id: number; label: string }[] | null;
  /** 이 커밋이 난 매물 — 고르는 값이 아니라 사실이라 읽기만 한다 */
  addr?: string | null;
  /** 칸에서 연 약속 — 종류가 이미 정해져 있다(브리핑 칸에서 계약을 고를 일이 없다).
   *  토글을 감추고 그 종류로 굳힌다 — 고를 수 없는 것을 보여주면 고민만 는다. */
  lockCat?: boolean;
  /** 이미 잡혀 있는 중도금·잔금(2026-08-19) — 창을 다시 열면 **그대로 들어와 있어야** 한다.
   *  비어 있으면 「없다」가 아니라 「아직 못 읽었다」로 보여, 저장하는 순간 날짜가 사라진다. */
  initExtras?: Partial<Record<"중도금" | "잔금", { on: string; at: string | null } | null>>;
  onCancel: () => void;
  onSkip: () => void;                   // 약속 아님 — 기록만 남긴다
  onDone: (s: SchedFinal) => void;
  /** 이미 잡혀 있는 약속을 연 것 — 그 자리에서 소화·삭제까지 된다(2026-08-28).
   *  예전엔 창을 닫고 줄로 돌아가야 ✓와 휴지통이 있었다. 없으면 안 보인다. */
  onFinish?: () => void;
  onRemove?: () => void;
}) {
  const [s, setS] = useState<SchedFinal>({
    ...init,
    people: (Array.isArray(base) ? base : base ? [base] : [])
      .map((b) => ({ kind: b.kind, ref_id: b.ref_id, label: b.label })),
    note,
  });
  // 종류를 직접 만지기 전엔 제목을 따라간다 — 「계약일」이라 치면 이미 계약에 가 있다
  const [kindTouched, setKindTouched] = useState(init.category !== undefined);
  const cat: Cat = kindTouched ? (s.category ?? "일반") : guessCat(s.title);
  const [open, setOpen] = useState<null | "at" | "place" | "who">(null);
  const [q, setQ] = useState("");
  const team = useQuery({ queryKey: ["team"], queryFn: teamApi.get });
  // 담당은 **기본이 나**다 — 대부분 자기가 잡은 약속에 자기가 간다.
  // 팀원이 대신 가는 경우에만 바꾼다(안 고르면 서버도 부른 사람으로 넣는다).
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me }).data?.account_id;
  const who = s.assignee_account_id ?? me;
  const owners = useQuery({ queryKey: ["owners"], queryFn: () => salesApi.owners() });
  const buyers = useQuery({ queryKey: ["buyers"], queryFn: () => buyersApi.list() });
  // 이 매물에 얽힌 사람들 — 계약 자리엔 매도자와 매수자가 같이 온다.
  // 이름을 몰라 못 찾는 경우가 많으니 **먼저 보여 주고** 고르게 한다.
  // 창에서 붙인 매물 — 프리필(커밋이 난 자리)이 있으면 그것이 사실이고, 없을 때만 고른다
  const [bld, setBld] = useState<{ pk: string; addr: string } | null>(null);
  const [openBld, setOpenBld] = useState(false);
  const [bq, setBq] = useState("");
  const livePk = buildingPk ?? bld?.pk ?? null;
  const sellers = useQuery({ queryKey: ["sellers"], enabled: !buildingPk,
    queryFn: () => salesApi.sellers() });
  const base1 = Array.isArray(base) ? base[0] : base;
  const myProps = useQuery({
    queryKey: ["sched-props", base1?.kind, base1?.ref_id], enabled: !buildingPk && base1?.kind === "buyer",
    queryFn: () => proposalsApi.list({ buyer_id: base1!.ref_id }) });
  // 대상 사람의 매물이 우선 후보 — 매수자면 담아 둔 제안 매물, 매도자면 소유 매물
  const bldCands: { pk: string; addr: string }[] = !buildingPk && !bld
    ? (base1?.kind === "buyer"
        ? (myProps.data ?? []).map((x) => ({ pk: x.building_pk, addr: x.addr ?? x.building_pk }))
        : (sellers.data ?? []).filter((x) => base1?.kind === "owner" ? x.owner_id === base1.ref_id : false)
            .map((x) => ({ pk: x.building_pk, addr: x.addr ?? x.building_pk })))
    : [];
  const bt = bq.trim();
  /** 최근 들락날락한 순 — 이름을 몰라 못 찾는 일이 잦다. 그래서 **먼저 보여 주고** 고르게 한다.
   *  기준은 이 창이 아니라 사용자가 매물을 연 차례다(recentPk). */
  const recent = recentPks();
  const myBld = (sellers.data ?? [])
    .map((x) => ({ pk: x.building_pk, addr: x.addr ?? x.building_pk }))
    .sort((a, b) => {
      const ia = recent.indexOf(a.pk), ib = recent.indexOf(b.pk);
      return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    });
  const bldHits = (bt ? myBld.filter((x) => x.addr.includes(bt)) : myBld).slice(0, 7);
  const near = useQuery({ queryKey: ["sched-people", livePk], enabled: !!livePk,
    queryFn: () => contactsApi.people(livePk) });
  const cand = (near.data ?? []).filter(
    (x) => !s.people.some((p) => p.kind === x.kind && p.ref_id === x.ref_id));

  const t = q.trim();
  const hits = t
    ? [
        ...(owners.data ?? []).filter((o) => (o.name ?? "").includes(t))
          .map((o) => ({ kind: "owner" as const, ref_id: o.id, label: o.name ?? "" })),
        ...(buyers.data ?? []).filter((b) => (b.name ?? "").includes(t))
          .map((b) => ({ kind: "buyer" as const, ref_id: b.id, label: b.name ?? "" })),
      ].filter((x) => !s.people.some((p) => p.kind === x.kind && p.ref_id === x.ref_id)).slice(0, 6)
    : [];
  const add = (p: SchedFinal["people"][number]) => { setS({ ...s, people: [...s.people, p] }); setQ(""); };

  // 계약 자리엔 **매도자가 반드시 온다**(2026-08-19) — 매수자 쪽에서 연 창이라도 자동으로 든다.
  // 계약서에 도장 찍는 두 사람이 참석자에 없으면 그 약속은 반쪽이다.
  useEffect(() => {
    if (cat !== "계약" || !near.data) return;
    const owner = near.data.find((x) => x.kind === "owner");
    if (!owner) return;
    setS((v) => v.people.some((p) => p.kind === "owner" && p.ref_id === owner.ref_id)
      ? v : { ...v, people: [...v.people, { kind: "owner", ref_id: owner.ref_id, label: owner.label ?? "" }] });
  }, [cat, near.data]);

  // 계약 창에서 온 약속은 **계약가가 미리 들어온다**(2026-08-19) — 같은 값을 두 번 치지 않게.
  // 여기서 고친 금액이 그 쌍의 확정가가 된다(서버 거울).
  // 계약과 한자리에서 잡는 중도금·잔금(선택) — 비어 있으면 안 만든다
  const [extra, setExtra] = useState<Record<"중도금" | "잔금", { on: string; at: string | null } | null>>(
    { 중도금: initExtras?.["중도금"] ?? null, 잔금: initExtras?.["잔금"] ?? null });
  const members = team.data?.members ?? [];

  // 창은 **몸통에 띄운다** — 커밋 상자 안에 두면 그 상자의 겹침·잘림을 그대로 뒤집어쓴다
  return createPortal((
    <div className="modal-bg open" onClick={onCancel}>
      <div className="gm" onClick={(e) => e.stopPropagation()}>
        {/* 용무가 곧 제목이다 — 칸이 아니라 큰 글자 한 줄 */}
        <input className="gm-title" value={s.title} autoFocus
          onChange={(e) => setS({ ...s, title: e.target.value })} placeholder="무슨 일로 만나나요" />

        {/* 종류 — **이 창의 나머지를 정한다**(2026-08-19). 그래서 맨 위에 온다:
            브리핑이면 방식, 계약·중도금·잔금이면 금액이 따라 붙는다. */}
        {/* 무슨 성격의 약속인가 — 계약이면 완료(✓)가 곧 계약 체결이 된다.
            칸에서 연 약속은 종류가 정해져 있어 이 줄이 아예 안 뜬다(lockCat) */}
        {!lockCat && (
        <div className="gm-row">
          <Ico d={STAMP} />
          <div className="gm-body">
            {CATS.includes(cat) ? (
              <span className="gm-seg">
                {CATS.map((k) => (
                  <button key={k} className={k === cat ? `on c-${k}` : ""}
                    onClick={() => { setKindTouched(true); setS({ ...s, category: k }); }}>
                    {k}</button>
                ))}
              </span>
            ) : (
              // 중도금·잔금은 **고르는 종류가 아니다**(계약 창에서 날짜로 선다).
              // 그 일정을 열었을 때 토글에 끼워 넣으면 「또 고를 수 있는 것」처럼 보인다 — 읽기만 한다.
              <span className="gm-txt">{cat} 일정</span>
            )}
          </div>
        </div>
        )}
        {/* 브리핑이면 **무엇으로 할 약속인가**까지 여기서 정한다(0111) — 만나서·전화·자료 발송.
            그래야 약속 카드가 「8/22 만나서」로 서고, 소화하면 그 방식이 브리핑 값이 된다 */}
        {s.category === "브리핑" && (
          <div className="gm-row">
            <Ico d={TALK} />
            <div className="gm-body">
              {/* 종류 토글과 같은 물건(슬라이딩) — 한 약속의 방식은 하나다.
                  기본은 **만나서** — 브리핑은 대개 만나서 한다. 비워 두면 방식 없는 약속이 생긴다 */}
              <span className="gm-seg">
                {["만나서", "전화", "자료 발송"].map((k) => (
                  <button key={k} className={(s.method ?? "만나서") === k ? "on" : ""}
                    onClick={() => setS({ ...s, method: k })}>{k}</button>
                ))}
              </span>
            </div>
          </div>
        )}


        {/* 날짜 줄 — **계약일·중도금일·잔금일이 같은 물건**이다(2026-08-19).
            한 컴포넌트를 셋이 나눠 쓴다: 라벨만 다르고 날짜·시각·지우기는 똑같이 동작한다.
            중도금·잔금은 계약 종류일 때만 서고, 비워 두면 그 일정은 안 만들어진다.
            돈은 계약가 한 곳에서만 다룬다 — 날짜 줄에 금액이 또 서면 값이 셋이 된다. */}
        <DateLine label={cat === "계약" ? "계약일" : null}
          on={s.on} at={s.at ?? null} autoAt={open === "at"}
          onOn={(v) => setS({ ...s, on: v })}
          onAt={(v) => { setS({ ...s, at: v }); if (v === null) setOpen(null); }}
          onAsk={() => setOpen("at")} />

        {cat === "계약" && (["중도금", "잔금"] as const).map((k) => {
          const v = extra[k];
          return (
            <DateLine key={k} label={`${k}일`}
              on={v?.on ?? null} at={v?.at ?? null}
              onAdd={() => setExtra((x) => ({ ...x, [k]: { on: s.on, at: null } }))}
              onOn={(d) => setExtra((x) => ({ ...x, [k]: { on: d, at: v?.at ?? null } }))}
              onAt={(a) => setExtra((x) => ({ ...x, [k]: { on: v!.on, at: a } }))}
              onClear={() => setExtra((x) => ({ ...x, [k]: null }))} />
          );
        })}


        {/* 누가 오는가 — 계약 자리엔 매도자와 매수자가 같이 온다 */}
        <div className="gm-row">
          <Ico d={PEOPLE} />
          <div className="gm-body wrap">
            {s.people.map((p, i) => (
              <span className={`gm-p ${p.kind}`} key={i}>{p.label}
                <button onClick={() => setS({ ...s, people: s.people.filter((_, k) => k !== i) })}>×</button>
              </span>
            ))}
            {/* 이 매물 사람들 — 누르면 참석자가 된다(이름을 몰라도 고를 수 있다) */}
            {cand.map((c) => (
              <button key={`${c.kind}${c.ref_id}`} className={`gm-cand ${c.kind}`}
                onClick={() => add(c)} title={c.sub ?? undefined}>+ {c.label}</button>
            ))}
            {open === "who" ? (
              <span className="gm-find">
                <input className="gm-in" autoFocus value={q} placeholder="이름 — 없으면 그대로 더해집니다"
                  onChange={(e) => setQ(e.target.value)}
                  onBlur={() => !t && setOpen(null)}
                  onKeyDown={(e) => {
                    if (e.nativeEvent.isComposing) return;     // 조합 중 엔터는 무시
                    if (e.key === "Escape") { setQ(""); setOpen(null); }
                    if (e.key === "Enter" && t) {
                      e.preventDefault();
                      // 우리 장부에 있으면 그 사람, 없으면 **이름만 아는 손님**으로.
                      // 이름 안 밝히고 떠보는 전화도 고객이라 이 자리가 있어야 한다.
                      add(hits[0] ?? { kind: "guest", label: t });
                    }
                  }} />
                {hits.length > 0 && (
                  <span className="gm-hits">
                    {hits.map((h) => (
                      <button key={`${h.kind}${h.ref_id}`} onMouseDown={(e) => { e.preventDefault(); add(h); }}>
                        <span className={`gm-p ${h.kind}`}>{h.label}</span></button>
                    ))}
                  </span>
                )}
              </span>
            ) : (
              <button className="gm-add" onClick={() => setOpen("who")}>직접입력</button>
            )}
          </div>
        </div>


        {/* 어디서 — 매물에서 볼지 사무실에서 볼지가 약속의 절반이다 */}
        <div className="gm-row">
          <Ico d={PIN} />
          <div className="gm-body">
            {open === "place" || s.place ? (
              <input className="gm-in" autoFocus={open === "place"} value={s.place ?? ""}
                placeholder="사무실 · 현장 · 법무사"
                onChange={(e) => setS({ ...s, place: e.target.value || null })} />
            ) : (
              <button className="gm-add" onClick={() => setOpen("place")}>위치 추가</button>
            )}
          </div>
        </div>

        {/* 어느 매물 — 커밋이 난 자리(프리필)는 사실이라 읽기만. 맥락 없이 열렸으면
            여기서 붙인다(전체 탭·대시보드에서도 매물 약속을 만들 수 있어야 한다). */}
        {addr ? (
          <div className="gm-row quiet">
            <Ico d={BLDG} /><div className="gm-body"><span className="gm-txt">{addr}</span></div>
          </div>
        ) : (
          <div className="gm-row">
            <Ico d={BLDG} />
            <div className="gm-body wrap">
              {bld ? (
                <span className="gm-p owner">{dongAddr(bld.addr)}
                  <button onClick={() => { setBld(null); }}>×</button></span>
              ) : (<>
                {bldCands.slice(0, 4).map((c) => (
                  <button key={c.pk} className="gm-cand owner" onClick={() => setBld(c)}>
                    + {dongAddr(c.addr)}</button>
                ))}
                {openBld ? (
                  <span className="gm-find">
                    <input className="gm-in" autoFocus value={bq} placeholder="주소 조각 — 49-9"
                      onChange={(e) => setBq(e.target.value)}
                      onBlur={() => !bt && setOpenBld(false)}
                      onKeyDown={(e) => {
                        if (e.nativeEvent.isComposing) return;
                        if (e.key === "Escape") { setBq(""); setOpenBld(false); }
                        if (e.key === "Enter" && bldHits[0]) { e.preventDefault(); setBld(bldHits[0]); setBq(""); }
                      }} />
                    {bldHits.length > 0 && (
                      <span className="gm-hits wide">
                        {bldHits.map((h) => (
                          <button key={h.pk} onMouseDown={(e) => { e.preventDefault(); setBld(h); setBq(""); }}>
                            <span className="gm-p owner">{dongAddr(h.addr)}</span></button>
                        ))}
                      </span>
                    )}
                  </span>
                ) : (
                  <button className="gm-add" onClick={() => setOpenBld(true)}>매물 추가</button>
                )}
              </>)}
            </div>
          </div>
        )}

        {/* 무슨 얘기 끝에 잡힌 약속인가 — 입력줄에 친 문장이 그대로 온다.
            여기서 고치면 장부에 그 문장이 남는다(둘이 따로 놀지 않게 한 곳에서 정한다). */}
        {s.note !== undefined && (
          <div className="gm-row">
            <Ico d={NOTE} />
            <div className="gm-body">
              <input className="gm-in" value={s.note ?? ""} placeholder="기록 한 줄"
                onChange={(e) => setS({ ...s, note: e.target.value })} />
            </div>
          </div>
        )}

        {/* 우리 쪽은 누가 가나 — 팀원이 대신 가기도 한다 */}
        {members.length > 1 && (
          <div className="gm-row">
            <Ico d={USER} />
            <div className="gm-body wrap">
              {members.map((m) => (
                <button key={m.account_id}
                  className={`gm-me ${who === m.account_id ? "on" : ""}`}
                  onClick={() => setS({ ...s, assignee_account_id: m.account_id })}>{m.name}</button>
              ))}
            </div>
          </div>
        )}

        <div className="gm-foot">
          {/* 조작은 아이콘으로 작게 — 글자 네모버튼을 넷 나열하지 않는다 */}
          {onFinish && <button className="gm-ico" title="끝냄" onClick={onFinish}><Icon name="check" size={15} /></button>}
          {onRemove && <button className="gm-ico del" title="삭제" onClick={onRemove}><Icon name="trash" size={15} /></button>}
          <span className="sp" />
          <button className="gm-ghost quiet" onClick={onCancel}>취소</button>
          {/* 「기록만」 = 문장만 남기고 약속은 안 만든다 — 남길 문장이 없으면 뜻이 없다 */}
          {note && <button className="gm-ghost" onClick={onSkip}>기록만</button>}
          <button className="gm-save" onClick={() => onDone({
            ...s,
            method: cat === "브리핑" ? (s.method ?? "만나서") : s.method,
            category: cat, building_pk: buildingPk ?? bld?.pk ?? null,
            extras: cat !== "계약" ? undefined
              : (["중도금", "잔금"] as const).flatMap((k) => {
                  const v = extra[k];
                  return v ? [{ category: k, on: v.on, at: v.at }] : [];
                }),
          })}>저장</button>
        </div>
      </div>
    </div>
  ), document.body);
}
