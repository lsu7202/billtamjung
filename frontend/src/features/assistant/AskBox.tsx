/** 되물음 상자 — 대화창 **위에** 떠 있는 네모다(2026-09-25 대표, 클로드 결).
 *
 *  글로 되물으면 화면이 「답이 끝났는지 기다리는지」를 모르고, 고를 것이 있어도 사용자가
 *  타이핑해야 한다. 상자로 띄우면 누를 것이 보이고, 답하기 전까지 자리를 지킨다.
 *
 *  **칩만 주고 끝내지 않는다.** 보기에 없는 답이 늘 있다. 물음마다 직접 입력 칸을 같이 두고,
 *  거기 친 글자도 고른 것과 나란히 실린다(대표: 「칩에 직접입력을 열어두는 것」). */
import { useState } from "react";

import { Icon } from "../../shared/ui/Icon";
import type { AskItem } from "./api";

export function AskBox({ items, onSend }: { items: AskItem[]; onSend: (text: string) => void }) {
  // 물음 차례 → 고른 보기들 / 직접 친 글
  const [picked, setPicked] = useState<Record<number, string[]>>({});
  const [typed, setTyped] = useState<Record<number, string>>({});

  const toggle = (i: number, v: string, many: boolean) =>
    setPicked((p) => {
      const cur = p[i] ?? [];
      if (cur.includes(v)) return { ...p, [i]: cur.filter((x) => x !== v) };
      return { ...p, [i]: many ? [...cur, v] : [v] };
    });

  /** 고른 것 + 직접 친 것. 둘 다 있으면 둘 다 보낸다 — 「강남구, 그리고 위례도」가 되게 */
  const answer = (i: number) => [...(picked[i] ?? []), (typed[i] ?? "").trim()].filter(Boolean);
  const ready = items.some((_q, i) => answer(i).length > 0);

  const send = () => {
    const lines = items
      .map((q, i) => (answer(i).length ? `${q.묻는것} ${answer(i).join(", ")}` : null))
      .filter(Boolean);
    if (lines.length) onSend(lines.join("\n"));
  };

  return (
    <div className="as-ask">
      {items.map((q, i) => {
        const many = !!q.여러개;
        return (
          <div className="ab-q" key={i}>
            <b>{q.묻는것}</b>
            {!!q.고르기?.length && (
              <div className="ab-chips">
                {q.고르기.map((v) => (
                  <button key={v} className={(picked[i] ?? []).includes(v) ? "on" : ""}
                    onClick={() => toggle(i, v, many)}>{v}</button>
                ))}
              </div>
            )}
            <input className="ab-in" value={typed[i] ?? ""} placeholder="직접 입력"
              onChange={(e) => setTyped((t) => ({ ...t, [i]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); send(); }
              }} />
          </div>
        );
      })}
      <div className="ab-foot">
        <button className="ab-go" disabled={!ready} onClick={send}>
          <Icon name="send" size={14} />답하기</button>
      </div>
    </div>
  );
}
