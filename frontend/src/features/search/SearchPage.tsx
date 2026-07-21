import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { searchApi, creditsApi } from "../../shared/api/endpoints";
import { useAuth } from "../../shared/store/auth";

export function SearchPage() {
  const clear = useAuth((s) => s.clear);
  const [q, setQ] = useState("");

  const credits = useQuery({ queryKey: ["credits"], queryFn: creditsApi.balance });
  const suggest = useQuery({
    queryKey: ["suggest", q],
    queryFn: () => searchApi.suggest(q),
    enabled: q.trim().length > 0,
  });

  return (
    <div style={{ maxWidth: 720, margin: "40px auto", fontFamily: "system-ui" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <b>빌탐정 · 매물 검색</b>
        <span style={{ fontSize: 13 }}>
          크레딧 {credits.data?.total ?? "…"}
          <button style={{ marginLeft: 12 }} onClick={clear}>로그아웃</button>
        </span>
      </header>

      <div style={{ position: "relative", marginTop: 20 }}>
        <input
          style={{ width: "100%", padding: 10, fontSize: 14 }}
          placeholder="주소 입력 (예: 강남구 역삼동 735-29)"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoComplete="off"
        />
        {suggest.data && suggest.data.length > 0 && (
          <ul style={{ border: "1px solid #ddd", margin: 0, padding: 0, listStyle: "none" }}>
            {suggest.data.map((s) => (
              <li key={s.building_pk} style={{ padding: "8px 12px", borderTop: "1px solid #eee" }}>
                {s.addr}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
