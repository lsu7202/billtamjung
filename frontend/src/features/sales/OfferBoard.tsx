import { useQuery } from "@tanstack/react-query";
import { boardApi } from "../../shared/api/endpoints";
import { wonShort, md } from "../../shared/format";
import "./sales.css";

/** 호가판 — **값 표**(2026-08-19). 행 = 참여자, 열 = 값이 움직인 날.
 *
 *  조사(ShowingTime·Glide) 규범: 오퍼는 덮어쓰지 않고 쌓고(app.field_events),
 *  비교는 표로 본다. 「베스트」는 시스템이 정하지 않는다 — 순액·조건이 순위를 뒤집는다.
 *  매도 = 보라 · 매수 = 파랑(색-체계.md). 설명글씨 없이 값만.
 */
export function OfferBoard({ pk }: { pk: string }) {
  const q = useQuery({ queryKey: ["offer-board", pk], queryFn: () => boardApi.get(pk) });
  const d = q.data;
  if (!d) return <div className="cd-none">{q.isLoading ? "…" : "아직 오간 값이 없습니다"}</div>;

  // 한 줄 = 참여자. 값이 바뀐 날짜별로 칸을 채운다(안 바뀐 날은 빈칸 — 움직임이 모양으로 읽힌다)
  type Row = { key: string; name: string; side: "sell" | "buy"; by: Map<string, number> };
  const rows = new Map<string, Row>();
  const day = (s: string) => s.slice(0, 10);
  const put = (key: string, name: string, side: "sell" | "buy", at: string, v: number) => {
    const r = rows.get(key) ?? { key, name, side, by: new Map() };
    r.by.set(day(at), v);
    rows.set(key, r);
  };
  for (const s of d.sell) if (s.value)
    put(s.field, s.field === "sale_price" ? "매매가" : "매도희망", "sell", s.created_at, Number(s.value));
  for (const b of d.buys) if (b.field === "hope_price" && b.value)
    put(`b${b.proposal_id}`, b.buyer_name ?? "", "buy", b.created_at, Number(b.value));
  for (const e of d.events) {
    if (e.side === "매도") put("ask_price", "매도희망", "sell", e.created_at, e.price);
    else put(`b${e.proposal_id}`, e.buyer_name ?? "", "buy", e.created_at, e.price);
  }

  const list = [...rows.values()].sort((a, b) => (a.side === b.side ? 0 : a.side === "sell" ? -1 : 1));
  const days = [...new Set(list.flatMap((r) => [...r.by.keys()]))].sort();
  if (days.length === 0) return <div className="cd-none">아직 오간 값이 없습니다</div>;

  const lastOf = (r: Row) => { const ks = [...r.by.keys()].sort(); return r.by.get(ks[ks.length - 1])!; };
  const askNow = rows.get("ask_price") ? lastOf(rows.get("ask_price")!) : null;

  return (
    <div className="ob-tw">
      <table className="ob-t num">
        <thead>
          <tr>
            <th className="who">호가판</th>
            {days.map((d0) => <th key={d0}>{md(d0)}</th>)}
            <th className="now">지금</th>
            <th className="gap">갭</th>
          </tr>
        </thead>
        <tbody>
          {list.map((r) => {
            const last = lastOf(r);
            const gap = r.side === "buy" && askNow != null ? askNow - last : null;
            return (
              <tr key={r.key} className={r.side}>
                <td className="who">{r.name}</td>
                {days.map((d0) => {
                  const v = r.by.get(d0);
                  return <td key={d0} className={v != null ? "hit" : ""}>{v != null ? wonShort(v) : ""}</td>;
                })}
                <td className="now">{wonShort(last)}</td>
                <td className="gap">{gap != null ? wonShort(Math.abs(gap)) : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
