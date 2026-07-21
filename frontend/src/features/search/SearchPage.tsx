import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { searchApi } from "../../shared/api/endpoints";

/** S01 매물 통합검색 — 주소 자동완성(타입어헤드) → S02 이동 */
export function SearchPage() {
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [active, setActive] = useState(-1);

  const suggest = useQuery({
    queryKey: ["suggest", q],
    queryFn: () => searchApi.suggest(q),
    enabled: q.trim().length > 0,
  });
  const items = suggest.data ?? [];

  function go(pk: string) {
    nav(`/buildings/${pk}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!items.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); go(items[active].building_pk); }
    else if (e.key === "Escape") setQ("");
  }

  return (
    <div className="panel" style={{ padding: 18 }}>
      <div className="ac-wrap" style={{ maxWidth: 520 }}>
        <input
          className="input"
          placeholder="주소 입력 (예: 강남구 역삼동 735-29)"
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(-1); }}
          onKeyDown={onKey}
          autoComplete="off"
          autoFocus
        />
        {items.length > 0 && (
          <div className="ac-drop">
            <div style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, padding: "8px 12px 5px" }}>
              주소 후보 {items.length}건
            </div>
            {items.map((s, i) => (
              <div
                key={s.building_pk}
                className={`ac-item ${i === active ? "active" : ""}`}
                onMouseDown={() => go(s.building_pk)}
                onMouseEnter={() => setActive(i)}
              >
                {s.addr}
              </div>
            ))}
          </div>
        )}
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 14 }}>
        지번/도로명 주소로 서울 전역 건물을 검색합니다. 검색은 무제한·무크레딧.
      </p>
    </div>
  );
}
