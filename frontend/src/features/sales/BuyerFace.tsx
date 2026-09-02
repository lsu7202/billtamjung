import type { ReactNode } from "react";
import { Icon } from "../../shared/ui/Icon";
import { buyerSummary, condSummary } from "./summaries";
import type { Buyer, BuyerCondition } from "../../shared/api/endpoints";
import { formatPhone } from "../building/KV";
import "./sales.css";

/** 매수자 명함 — **업무 탭과 계약 창이 같은 얼굴을 쓴다**(2026-08-19).
 *  같은 사람이 화면마다 다르게 소개되면 어느 쪽이 맞나 헷갈린다.
 *  레일은 프롭으로 받는다 — 계약 창 안에서 레일이 또 서면 창 안에 창이 생긴 꼴이다. */
export function BuyerFace({ b, rail, compact, onOpenCond, onEditCond, onDelCond, onEdit }: {
  b: Buyer;
  rail?: ReactNode;
  /** 계약 창처럼 **읽으러 온 자리** — 조건을 늘리거나 사람을 고치는 일은 매수자 화면에서 한다 */
  compact?: boolean;
  onOpenCond: (c: BuyerCondition) => void;
  onEditCond?: (c?: BuyerCondition) => void;
  onDelCond?: (cid: number, name: string) => void;
  onEdit?: () => void;
}) {
  const sm = buyerSummary(b);
  return (
        <div className="bc-face bc-front panel">
            <div className="bc-name">
              <h2>{b.name}</h2>
              {b.is_corp ? <span className="tag">법인</span> : null}
              <span className="sp" />
              {b.phone && (b.phone_masked
                ? <span className="ph off" title="담당자 본인 또는 대표만 볼 수 있습니다">
                    {b.phone}<Icon name="lock" size={11} style={{ verticalAlign: "-1px", marginLeft: 3 }} /></span>
                : <a className="ph" href={`tel:${b.phone.replace(/\D/g, "")}`}>{formatPhone(b.phone)}</a>)}
            </div>
            <p className={`bc-sum ${sm.thin ? "thin" : ""}`}>
              {sm.thin ? "아직 파악된 정보가 적습니다 — 편집에서 채우면 여기 요약이 생깁니다." : sm.text}
            </p>
            {b.memo && <p className="bc-memo">“{b.memo}”</p>}
            {/* 찾는 조건 — 누르면 **그 조건으로 건물 검색**이 열린다(2026-08-16).
                조건은 이 사람의 얼굴이라 앞면에 선다. 편집 안에 숨겨 두면 안 쓰인다. */}
            <div className="bc-conds">
              {b.conditions.map((c) => (
                <button className="row lnk" key={c.id} onClick={() => onOpenCond(c)}
                  title="이 조건으로 건물 검색">
                  <b>{c.name}</b>
                  <span className="dim2 ell">{condSummary(c)}</span>
                  <span className="sp" />
                  <span className="go">검색 →</span>
                  {!compact && (<>
                    <span className="ck" role="button" title="조건 고치기"
                      onClick={(e) => { e.stopPropagation(); onEditCond?.(c); }}>
                      <Icon name="edit" size={11} /></span>
                    <span className="ck" role="button" title="조건 삭제"
                      onClick={(e) => { e.stopPropagation(); onDelCond?.(c.id, c.name); }}>
                      <Icon name="trash" size={11} /></span>
                  </>)}
                </button>
              ))}
              {/* 조건 추가는 카드에 두지 않는다(2026-08-19) — 고치는 일은 창에서 한다는
                  규칙에 어긋난다. 카드는 읽고, 편집 창의 「담기」 탭이 그 자리다. */}
            </div>
            {!compact && (
              <div className="bc-foot">
                <button className="lnk dim2" onClick={onEdit}>
                  <Icon name="edit" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />편집</button>
              </div>
            )}
            {/* 레일은 **명함의 맨 아래**(2026-08-20) — 이름·요약·조건이 먼저 읽히고,
                「지금 어디까지 왔나」는 그 사람을 파악한 다음에 보는 것이다. */}
            {rail}
        </div>
  );
}
