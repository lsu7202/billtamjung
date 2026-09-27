/** 입주 이력 — 이 건물에 누가 언제 들어왔다 나갔나(2026-09-25 대표).
 *
 *  원천은 LOCALDATA(인허가)다. **과거가 강하고 현재가 약한** 원천이라 층별 임대정보(지금)가 아니라
 *  여기(이력)에 쓴다. 개업일·폐업일은 신고 기록이지만 「영업」은 폐업 신고를 안 하면 남는다.
 *
 *  **지금 있는지는 카카오로만 본다**(대표). 줄은 셋이다:
 *    지금 있음   카카오에서 확인 — 진하게, 「2003.04 ~」
 *    모름        인허가는 영업인데 카카오에 없다 — 보통 굵기, 끝을 모르니 「2017.03 ~ —」
 *    폐업        흐리게, 「2008.12 ~ 2014.10」 + 영업 기간
 *  「지금까지 몇 년」은 어디에도 안 붙인다.
 *  임대료는 없다. 통신판매업은 주소만 올린 것이 섞여 줄로 안 세우고 수만 적는다.
 */
import { useQuery } from "@tanstack/react-query";
import { historyApi, type TenancyStint } from "../../shared/api/endpoints";

const ym = (d: string | null) => (d ? d.slice(0, 7).replace("-", ".") : null);

/** 폐업한 줄의 영업 기간 — 「5년 10개월」. 날짜가 하나라도 없으면 안 쓴다 */
function span(r: TenancyStint): string | null {
  if (!r.open_on || !r.close_on) return null;
  const a = new Date(r.open_on), b = new Date(r.close_on);
  const m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (m < 0) return null;
  const y = Math.floor(m / 12), mm = m % 12;
  return y ? `${y}년${mm ? ` ${mm}개월` : ""}` : `${mm}개월`;
}

export function useTenancyHistory(pk: string) {
  return useQuery({ queryKey: ["history", pk], queryFn: () => historyApi.get(pk) });
}

export function TenancyHistory({ pk, id }: { pk: string; id?: string }) {
  const q = useTenancyHistory(pk);
  const items = q.data?.items ?? [];
  const ec = q.data?.ecommerce ?? 0;
  if (!items.length && !ec) return null;

  // 서버 순서(1층부터 위로 · 지하 · 층 미상)를 지키며 층으로 묶는다
  const groups: [string, TenancyStint[]][] = [];
  for (const r of items) {
    const f = r.floor ?? "—";
    const g = groups.find(([k]) => k === f);
    if (g) g[1].push(r); else groups.push([f, [r]]);
  }

  return (
    <div className="bg-card" id={id}>
      <div className="bg-ttl">입주 이력
        {ec > 0 && <span className="th-ec">통신판매업 {ec.toLocaleString()}곳</span>}
      </div>
      <div className="th">
        {groups.map(([floor, rows]) => (
          <div className="th-f" key={floor}>
            <b className={floor === "—" ? "off" : ""}>{floor}</b>
            <div className="th-rows">
              {rows.map((r, i) => {
                const closed = r.state === "폐업";
                const cls = closed ? "off" : r.now ? "now" : "unk";
                return (
                  <div className={`th-r ${cls}`} key={`${r.name}-${r.open_on}-${i}`}>
                    <span className="nm">{r.name}</span>
                    <span className="bz">{r.biz ?? ""}</span>
                    <span className="pd">{ym(r.open_on) ?? "—"} ~ {closed ? (ym(r.close_on) ?? "—") : r.now ? "" : "—"}</span>
                    <span className="du">{r.state === "휴업" ? "휴업" : (span(r) ?? "")}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
