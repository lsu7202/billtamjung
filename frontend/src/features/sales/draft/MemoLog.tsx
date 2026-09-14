import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { contactsApi } from "../../../shared/api/endpoints";
import { md } from "../../../shared/format";
import "./draft.css";

/** 메모창 — 업무 모달(매물·매수자)과 건물 상세 사이드바가 **같은 얼굴**로 쓴다(2026-08-27 공용화).
 *
 *  저장소는 이미 하나였다(contacts · kind=메모). 그런데 그리는 코드가 세 곳에 따로 살아서,
 *  같은 장부를 열었는데 화면마다 다르게 생겼다 — 같은 것은 같아 보여야 같은 것인 줄 안다.
 *  줄 하나 = 흰 카드(날짜·본문·쓴 사람), 입력은 pill 한 줄, Enter 가 저장의 전부다.
 */
export function MemoLog({ target, id }: { target: "listing" | "buyer"; id: string }) {
  const q = useQuery({ queryKey: ["memo", target, id], queryFn: () => contactsApi.list(target, id) });
  const rows = (q.data ?? []).filter((c) => c.kind === "메모" && c.note);
  const [txt, setTxt] = useState("");
  const add = async () => {
    const t = txt.trim();
    if (!t) return;
    await contactsApi.create({ target_type: target, target_id: id, kind: "메모", note: t });
    setTxt("");
    q.refetch();
  };
  return (
    <aside className="um-memo">
      <div className="mt">메모</div>
      <ul>
        {rows.length === 0 && <li className="dim">아직 메모가 없습니다</li>}
        {rows.map((c) => (
          <li key={c.id}>
            <div className="d num">{md(String(c.occurred_on ?? c.created_at ?? "").slice(0, 10))}</div>
            <div className="t">{c.note}</div>
            {c.by_name && <div className="w">{c.by_name}</div>}
          </li>
        ))}
      </ul>
      <input className="in" value={txt} placeholder="메모"
        onChange={(e) => setTxt(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) add(); }} />
    </aside>
  );
}
