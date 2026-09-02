/** 일정 달력 카드(2026-08-24 확정) — 고리 두 개가 붙은 달력 꼴.
 *  안에는 **이름·날짜·시간**뿐이다. 돈은 계약 탭의 칩이 들고, 상태는 색이 말한다.
 *  지난 것=회색 · 계약=찬 파랑 · 나머지 회차=연파랑 · 사흘 안=빨강 · 빈 자리=점선.
 */
import { md } from "../../../shared/format";

export type CalTone = "sign" | "pale" | "done" | "soon";

export function SchedCal({ name, on, at, tone, onClick }: {
  name: string;
  /** YYYY-MM-DD */
  on: string;
  /** HH:MM(:SS) — 없으면 시간 미정이라 날짜만 선다 */
  at?: string | null;
  tone?: CalTone;
  onClick?: () => void;
}) {
  return (
    <button className={`scal ${tone ?? ""}`} onClick={onClick}>
      <span className="rings"><i /><i /></span>
      <span className="body">
        <span className="hd">{name}</span>
        <span className="bd">
          <span className="d num">{md(on)}</span>
          {at && <span className="hm num">{at.slice(0, 5)}</span>}
        </span>
      </span>
    </button>
  );
}

/** 다가오는 일정 전용(2026-08-28) — 매물 판과 달리 **어느 매물인지**를 같이 세운다.
 *  매물 판에서는 이미 그 매물 안이라 주소가 군더더기지만, 대시보드에서는 여러 매물이
 *  섞여 있어서 「9/30 중도금」만 보면 무엇의 중도금인지 모른다. */
export function SchedCalWhere({ name, on, at, tone, where, onClick }: {
  name: string; on: string; at?: string | null; tone?: CalTone;
  /** 매물 주소나 사람 이름 — 없으면 줄이 서지 않는다 */
  where?: string | null;
  onClick?: () => void;
}) {
  return (
    <button className={`scal ${tone ?? ""}`} onClick={onClick}>
      <span className="rings"><i /><i /></span>
      <span className="body">
        <span className="hd">{name}</span>
        {/* 주소를 날짜 아래 한 줄로 두니 196px 카드에서 잘렸다(2026-08-28).
            날짜 오른쪽 빈 자리로 옮기고 두 줄까지 접는다 — 카드 폭은 그대로다. */}
        <span className="bd">
          <span className="dt">
            <span className="d num">{md(on)}</span>
            {at && <span className="hm num">{at.slice(0, 5)}</span>}
          </span>
          {where && <span className="wh">{where}</span>}
        </span>
      </span>
    </button>
  );
}

/** 빈 자리 — 같은 달력 꼴에 점선. 줄이 흐트러지지 않는다 */
export function SchedCalAdd({ label = "일정", onClick }: { label?: string; onClick?: () => void }) {
  return (
    <button className="scal add" onClick={onClick}>
      <span className="rings"><i /><i /></span>
      <span className="body">
        <span className="hd">{label}</span>
        <span className="bd">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </span>
      </span>
    </button>
  );
}

/** 지났나 · 다가왔나 — 날짜와 상태로 색을 고른다(한 곳에서만 판정) */
export function calTone(on: string, state?: string | null, isSign?: boolean): CalTone {
  if (state === "완료") return "done";
  const d = new Date(`${on}T00:00:00`);
  const days = Math.floor((d.getTime() - new Date().setHours(0, 0, 0, 0)) / 864e5);
  if (days < 0) return "done";
  if (days <= 3) return "soon";
  return isSign ? "sign" : "pale";
}
