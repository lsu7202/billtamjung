import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { buyersApi, salesApi, listingsApi, proposalsApi,
         type Buyer } from "../../shared/api/endpoints";
import { PickModal } from "./PickModal";
import { Icon } from "../../shared/ui/Icon";
import { useEnums } from "../../shared/hooks/useEnums";
import { Chips } from "../building/EnumField";
import { formatPhone } from "../building/KV";
import { dongAddr } from "../../shared/format";
import { condSummary } from "./summaries";
import "./sales.css";

/** 사람 창 — **등록과 수정이 한 벌**(2026-08-16).
 *
 *  왜 합쳤나: 등록 모달과 명함 뒷면 편집이 각각 필드를 들고 있어서 항목이 어긋났다
 *  (매수자: 등록 8칸 / 편집 11칸, 매도자는 아예 다른 경로). 같은 사람을 두 화면이
 *  다르게 묻고 있었던 것이다. 필드 정의도 저장 경로도 여기 한 곳에 둔다.
 *
 *  생김새는 약속 창(SchedModal)과 같은 줄 어법 — 이름은 제목, 나머지는 아이콘이 줄머리를
 *  잡는 줄. 「폼은 모달 안에서만」 규칙(CLAUDE.md)도 이걸로 지켜진다.
 */
export type PersonKind = "buyer" | "owner";

/** 사람 한 명의 값 — 매수·매도가 같은 모양을 쓴다(저장할 때만 각자 이름으로 옮긴다) */
export interface PersonDraft {
  name?: string; phone?: string | null;
  is_corp?: boolean | null;          // 개인 · 법인
  relation?: string | null;          // 매도자 — 본인·가족·법인·지인
  grade?: string | null;             // 매수자 — 확실·보통·관망
  source?: string | null;            // 매수자 — 유입경로
  age_band?: string | null; gender?: string | null;
  cooperation?: string | null; kindness?: string | null;
  memo?: string | null;
  is_agent?: boolean | null;         // 매수자 — 본인 · 대리인(공동중개 상대). 명단엔 같은 한 줄로 선다
  urgency?: string | null;           // 매수자 — 긴급도(현장 「긴급도/찐」의 앞 축. 뒤 축은 grade)
}

const Ico = ({ d }: { d: string }) => (
  <svg className="gm-i" viewBox="0 0 24 24" width="17" height="17" aria-hidden
    fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} /></svg>
);
const PHONE = "M7 3.5h3l1.5 4-2 1.4a12 12 0 0 0 5.6 5.6l1.4-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 5.5 5.7 2 2 0 0 1 7.5 3.5Z";
const TAG = "M4 12V5.5A1.5 1.5 0 0 1 5.5 4H12l8 8-7.5 7.5L4 12ZM8 8h.01";
const USER = "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20a7 7 0 0 1 14 0";
const NOTE = "M5 7h14M5 12h14M5 17h9";
const FIND = "M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM15 15l5 5";
const BLDG2 = "M4 21h16M6 21V5.5A1.5 1.5 0 0 1 7.5 4h6A1.5 1.5 0 0 1 15 5.5V21M15 10h2.5A1.5 1.5 0 0 1 19 11.5V21";

/** 이 사람에게 묻는 것 — **한 곳에서 정한다**. 줄 하나 = 아이콘 하나 + 칩 여러 개 */
const ROWS: Record<PersonKind, { ico: string; fields: (keyof PersonDraft)[] }[]> = {
  buyer: [
    { ico: TAG, fields: ["is_corp", "is_agent", "grade", "source"] },
    { ico: TAG, fields: ["urgency"] },
    { ico: USER, fields: ["age_band", "gender"] },
    // 전속은 뺐다(2026-08-19) — 전속중개계약은 **매도자**와 맺는 것이고,
    // 「체결/미체결」이라는 낱말만으로는 무엇의 체결인지도 안 읽혔다.
    { ico: USER, fields: ["cooperation", "kindness"] },
  ],
  owner: [
    { ico: TAG, fields: ["is_corp", "relation"] },
    { ico: USER, fields: ["age_band", "gender"] },
    { ico: USER, fields: ["cooperation", "kindness"] },
  ],
};
/** 칩 한 줄의 enum 그룹 — 나이대·성별은 매수·매도가 같은 값을 쓴다(0063) */
const ENUM: Partial<Record<keyof PersonDraft, string>> = {
  urgency: "urgency",   // 매물과 같은 enum 재사용 — 같은 뜻을 두 벌로 만들지 않는다(0090)
  grade: "buyer_grade", source: "buyer_source",
  relation: "relation", age_band: "buyer_age", gender: "buyer_gender",
  cooperation: "cooperation", kindness: "kindness",
};

export function PersonModal({ kind, init, ownerPk, onClose, onSaved, onDelete }: {
  kind: PersonKind;
  /** 있으면 수정, 없으면 등록 */
  init?: (PersonDraft & { id: number }) | null;
  /** 매도자 — 이 매물의 소유자로 붙인다(등록) · 이 매물을 통해 고친다(수정) */
  ownerPk?: string | null;
  onClose: () => void;
  onSaved?: (id: number) => void;
  onDelete?: () => void;
}) {
  const { options } = useEnums();
  const [f, setF] = useState<PersonDraft>(init ?? {});
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<null | "phone" | "memo">(null);
  const label = kind === "buyer" ? "매수자" : "소유자";
  // 창은 탭 둘이다(2026-08-19) — **프로필**(이 사람이 누구인가)과 **담기**(무엇을 찾고
  // 무엇을 담아 뒀나 — 조건과 담은 매물이 같이 산다). 한 화면에 다 세우면 아래가 안 읽힌다.
  const [tab, setTab] = useState<"profile" | "links">("profile");
  const twoTabs = kind === "buyer" && !!init;
  const set = (p: PersonDraft) => setF({ ...f, ...p });

  const save = async () => {
    const name = (f.name ?? "").trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      if (kind === "buyer") {
        const body = {
          name, phone: f.phone ?? "", memo: f.memo ?? "", is_corp: !!f.is_corp,
          grade: f.grade ?? "", source: f.source ?? "",
          age_band: f.age_band ?? "", gender: f.gender ?? "",
          cooperation: f.cooperation ?? "", kindness: f.kindness ?? "",
          is_agent: !!f.is_agent, urgency: f.urgency ?? "",
        };
        if (init) { await buyersApi.update(init.id, body); onSaved?.(init.id); }
        else { const { id } = await buyersApi.create(body); onSaved?.(id); }
      } else if (init && ownerPk) {
        // 소유자 값은 사람에게 저장된다(0058) — 어느 매물에서 고쳐도 같은 사람이면 같이 바뀐다
        await listingsApi.patchBiz(ownerPk, {
          owner_name: name, owner_phone: f.phone || null, owner_note: f.memo || null,
          owner_type: f.is_corp ? "법인" : "개인", relation: f.relation || null,
          cooperation: f.cooperation || null, kindness: f.kindness || null,
          owner_age_band: f.age_band || null, owner_gender: f.gender || null,
        });
        onSaved?.(init.id);
      } else {
        const { id } = await salesApi.createOwner({
          name, phone: f.phone || null, note: f.memo || null,
          owner_type: f.is_corp ? "법인" : "개인", relation: f.relation || null,
          cooperation: f.cooperation || null, kindness: f.kindness || null,
          age_band: f.age_band || null, gender: f.gender || null,
        });
        if (ownerPk) await salesApi.attachListing(id, ownerPk);
        onSaved?.(id);
      }
      onClose();
    } finally { setBusy(false); }
  };

  const chip = (k: keyof PersonDraft) => {
    if (k === "is_corp") {
      return <Chips key={k} mode="inline" opts={[{ code: "개인", label: "개인" }, { code: "법인", label: "법인" }]}
        cur={f.is_corp ? "법인" : "개인"} onSelect={(v) => set({ is_corp: v === "법인" })} />;
    }
    if (k === "is_agent") {
      // 공동중개 상대는 새 개체가 아니라 **표시 하나**다(S04b §4) — 조건·등급·제안이 전부 같이 돈다
      return <Chips key={k} mode="inline" opts={[{ code: "본인", label: "본인" }, { code: "대리인", label: "대리인(공동중개)" }]}
        cur={f.is_agent ? "대리인" : "본인"} onSelect={(v) => set({ is_agent: v === "대리인" })} />;
    }
    const g = ENUM[k];
    if (!g) return null;
    // urgency 는 매물 enum 재사용(0090) — 「안팔아도됨」은 파는 쪽 말이라 사람 창에선 걸러낸다
    const opts = k === "urgency"
      ? options(g).filter((o) => !o.label.includes("팔")) : options(g);
    return <Chips key={k} mode="inline" opts={opts} cur={(f[k] as string) || "미지정"}
      onSelect={(v) => set({ [k]: v === "미지정" ? null : v } as PersonDraft)} />;
  };

  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="gm" onClick={(e) => e.stopPropagation()}>
        <input className="gm-title" autoFocus={!init} value={f.name ?? ""}
          placeholder={`${label} 이름`}
          onChange={(e) => set({ name: e.target.value })}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;      // 한글 조합 중 엔터는 무시
            if (e.key === "Enter") save();
          }} />

        <div className="gm-row">
          <Ico d={PHONE} />
          <div className="gm-body">
            {edit === "phone" || f.phone ? (
              <input className="gm-in" autoFocus={edit === "phone"} inputMode="tel"
                value={f.phone ?? ""} placeholder="010-0000-0000"
                onChange={(e) => set({ phone: formatPhone(e.target.value) })} />
            ) : (
              <button className="gm-add" onClick={() => setEdit("phone")}>전화번호</button>
            )}
          </div>
        </div>

        {twoTabs && (
          <div className="mm-tabs in-gm gm-tabs">
            <button className={`mm-tab ${tab === "profile" ? "on" : ""}`}
              onClick={() => setTab("profile")}>프로필</button>
            <button className={`mm-tab ${tab === "links" ? "on" : ""}`}
              onClick={() => setTab("links")}>담기</button>
          </div>
        )}

        {(!twoTabs || tab === "profile") && ROWS[kind].map((r, i) => (
          <div className="gm-row" key={i}>
            <Ico d={r.ico} />
            <div className="gm-body wrap np-chips">{r.fields.map(chip)}</div>
          </div>
        ))}

        {/* 찾는 조건 · 담은 매물 — **매수자의 두 축**(2026-08-19). 카드는 읽기만 하고
            고치는 일은 이 창에서 한다. 담기는 양쪽에서 시작할 수 있어야 한다:
            매물 화면에서 사람을 담고, 사람 창에서 매물을 담는다 — 같은 행동이라 부품도 같다(Picker). */}
        {twoTabs && tab === "links" && init && <BuyerLinks buyerId={init.id} />}

        {(!twoTabs || tab === "profile") && <div className="gm-row">
          <Ico d={NOTE} />
          <div className="gm-body">
            {edit === "memo" || f.memo ? (
              <input className="gm-in" autoFocus={edit === "memo"} value={f.memo ?? ""}
                placeholder="메모 — 식당 임차 X · 대로변만"
                onChange={(e) => set({ memo: e.target.value })} />
            ) : (
              <button className="gm-add" onClick={() => setEdit("memo")}>메모</button>
            )}
          </div>
        </div>}

        <div className="gm-foot">
          {init && onDelete && (
            <button className="gm-ghost del" onClick={onDelete}>삭제</button>
          )}
          <span className="sp" />
          <button className="gm-ghost quiet" onClick={onClose}>취소</button>
          <button className="gm-save" disabled={!(f.name ?? "").trim() || busy}
            onClick={save}>{busy ? "…" : init ? "저장" : "추가"}</button>
        </div>
      </div>
    </div>
  ), document.body);
}

/** 매수자 창의 두 줄 — 찾는 조건(읽기+검색으로 나가 편집) · 담은 매물(여기서 담고 뺀다).
 *  담는 일은 매물 화면에도 있지만 **같은 부품**을 쓴다(Picker) — 어디서 시작하든 같은 행동이다. */
function BuyerLinks({ buyerId }: { buyerId: number }) {
  const nav = useNavigate();
  const qc = useQueryClient();
  const conds = useQuery({ queryKey: ["buyers"], queryFn: buyersApi.list });
  const props = useQuery({ queryKey: ["proposals", buyerId],
    queryFn: () => proposalsApi.list({ buyer_id: buyerId }) });
  const me = (conds.data ?? []).find((b: Buyer) => b.id === buyerId) ?? null;
  const [cur, setCur] = useState<number | null>(null);   // 고른 매물 탭
  const refresh = () => { props.refetch(); qc.invalidateQueries({ queryKey: ["buyers"] }); };
  const [pick, setPick] = useState(false);
  return (<>
    <div className="gm-row">
      <Ico d={FIND} />
      <div className="gm-body wrap np-chips">
        {/* 이름만 세우면 「새 조건」이 뭘 말하는지 알 수 없다(2026-08-20) —
            카드와 **같은 요약**(condSummary)을 붙여 무슨 조건인지 창에서도 읽히게 한다 */}
        {(me?.conditions ?? []).map((c) => (
          <button key={c.id} className="gm-cond" title="검색 화면에서 고친다"
            onClick={() => nav("/search", { state: { buyerCond: {
              buyer_id: buyerId, buyer_name: me?.name ?? "", cond_id: c.id,
              name: c.name, conditions: c.conditions_json ?? {} } } })}>
            <b>{c.name}</b><span>{condSummary(c)}</span></button>
        ))}
        <button className="gm-add" onClick={() => nav("/search", { state: { buyerCond: {
          buyer_id: buyerId, buyer_name: me?.name ?? "", cond_id: null,
          name: "새 조건", conditions: {} } } })}>＋ 조건 — 지도에서 잡아 저장</button>
      </div>
    </div>
    {/* 담은 매물 — **탭으로 관리**(2026-08-19). 계약 창의 매수자 탭과 같은 어법이라
        어느 쪽에서 보든 「붙어 있는 것들」이 같은 모양으로 선다. 빼기는 고른 탭에서만. */}
    <div className="gm-row">
      <Ico d={BLDG2} />
      <div className="gm-body wrap np-chips">
        <span className="mm-tabs in-gm">
          {(props.data ?? []).map((x) => (
            <button key={x.id} className={`mm-tab ${x.id === cur ? "on" : ""}`}
              onClick={() => setCur(x.id === cur ? null : x.id)}>
              {dongAddr(x.addr) || x.building_pk}</button>
          ))}
          {/* 담기는 **창**이다(2026-08-20) — 주소 자동완성만으로는 「무엇을 담을지」를
              못 고른다. 추천·내 매물·검색을 한자리에서 보고 여러 건을 한 번에 담는다. */}
          <button className="ptab add" title="매물 담기" onClick={() => setPick(true)}>＋</button>
        </span>
      </div>
    </div>
    {cur != null && (
      <div className="gm-row">
        <span className="gm-i" />
        <div className="gm-body">
          <button className="act quiet" onClick={async () => {
            const x = (props.data ?? []).find((y) => y.id === cur);
            if (!x) return;
            if (!confirm(`「${x.addr ?? x.building_pk}」을(를) 이 매수자에서 뺄까요?`)) return;
            await proposalsApi.remove(x.id); setCur(null); refresh();
          }}>이 매물 빼기</button>
        </div>
      </div>
    )}
    {pick && (
      <PickModal mode="listing" buyerId={buyerId} title={`매물 담기 — ${me?.name ?? ""}`}
        onClose={() => setPick(false)}
        onAdded={() => { refresh(); qc.invalidateQueries({ queryKey: ["proposals"] }); }} />
    )}
  </>);
}

/** 목록 머리의 ＋ — 창을 여는 버튼만. 창 자체는 위 PersonModal 한 벌이다 */
export function NewPerson({ kind, onDone, onCreated, attachPk }: {
  kind: PersonKind;
  onDone: () => void;
  onCreated?: (id: number) => void;
  attachPk?: string | null;
}) {
  const [open, setOpen] = useState(false);
  // 새 매수자는 **만들고 끝이 아니다**(2026-08-20) — 이름만 적힌 사람은 아무 일도 안 일어난다.
  // 저장하자마자 담기 창으로 이어 붙인다: 조건(예산·지역)을 그 자리에서 받고 추천을 담는다.
  const [fresh, setFresh] = useState<number | null>(null);
  return (
    <>
      <button className="by-add" title={`${kind === "buyer" ? "매수자" : "소유자"} 추가`}
        onClick={() => setOpen(true)}>
        {/* 아이콘은 한 벌에서만(2026-08-20) — 손으로 그린 ＋는 매물 목록의 것과 획이 달랐다 */}
        <Icon name="plus" size={14} />
      </button>
      {open && (
        <PersonModal kind={kind} ownerPk={attachPk}
          onClose={() => setOpen(false)}
          onSaved={(id) => {
            if (kind === "buyer" && id) setFresh(id);
            onCreated?.(id); onDone();
          }} />
      )}
      {fresh != null && (
        <PickModal mode="listing" buyerId={fresh} title="매물 담기 — 새 매수자"
          onClose={() => setFresh(null)} onAdded={onDone} />
      )}
    </>
  );
}
