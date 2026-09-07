import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { eventsApi, type AreaEvent } from "../../shared/api/endpoints";
import { useAreaPick } from "../../shared/store/areaPick";
import { Icon } from "../../shared/ui/Icon";
import { eventIcon, EVENT_TYPES } from "../../shared/map/eventIcon";

/** 주변 소식 — 왼쪽 목록, 오른쪽 상세(2026-09-05 · 이름 2026-09-06 확정).
 *
 *  **같은 것을 두 곳에서 본다.** 소식 탭은 서울 전체를 게시글처럼 늘어놓고,
 *  여기는 **이 건물 반경 안 · 자리를 아는 것만** 세운다. 그래서 이름이 한 벌이다.
 *  자리를 모르는 소식은 여기 안 선다 — 반경으로 만날 수가 없다.
 *
 *  **거리 열은 안 쓴다.** 「구역 안」·「73m」·「같은 법정동」이 한 칸에 안 들어간다.
 *  위치는 지도가 말한다 — 목록에서 고르면 사이드바 지도의 아이콘이 반짝이고, 아이콘을 누르면
 *  목록이 그리로 간다(2026-09-06 · `useAreaPick`). 지도는 기본으로 빅 이벤트만 찍는다(`eventIcon`).
 *
 *  날짜는 목록에서 `25.01` 로 짧게, 상세에서 `2025년 1월 9일` 로 전부.
 *  **연도만 아는 것은 연도만 쓴다** — 정비구역 839개 중 고시일자가 있는 것은 273개뿐이라,
 *  월을 지어내면 그 화면은 그날로 못 믿는 화면이 된다.
 */
/** 갈래 차례. **여기 없는 갈래도 그린다** — 뒤에 붙인다.
 *  못 알아본 갈래를 안 그리면 새 원천을 실은 날 조용히 사라진다. */
// 「생긴다」가 먼저, 「못 한다」(규제)가 그다음, 확정 안 된 「발표」가 끝
const ORDER = ["정비·개발", "기반시설", "건축 인허가", "규제", "정책 발표"];
// 기본 1년(2026-09-06 대표) — 소식 탭과 같다. 소식은 오래되면 소식이 아니다
const YEARS = [[1, "1년"], [3, "3년"], [5, "5년"], [0, "전체"]] as const;

const short = (e: AreaEvent) =>
  e.on_date ? `${e.on_date.slice(2, 4)}.${e.on_date.slice(5, 7)}`
  : e.on_year ? `${String(e.on_year).slice(2)}년` : "—";
const full = (e: AreaEvent) =>
  e.on_date ? `${e.on_date.slice(0, 4)}년 ${+e.on_date.slice(5, 7)}월 ${+e.on_date.slice(8, 10)}일`
  : e.on_year ? `${e.on_year}년` : "—";

/** 한 번만 받아 두고 연도는 화면에서 거른다 — 칩을 누를 때마다 다시 받으면 깜빡인다.
 *  같은 열쇠를 입지 탭도 쓴다(목차에 「주변 소식」을 세울지 정하려고). react-query 가 합친다. */
export const areaEventsQuery = (pk: string) =>
  ({ queryKey: ["area-events", pk], queryFn: () => eventsApi.list(pk) }) as const;

export function AreaEvents({ pk, id }: { pk: string; id?: string }) {
  // 기간은 스토어에 — 사이드바 지도 핀이 같은 기간을 본다(2026-09-06 대표 「지도에서도 1년·3년·5년·전체」)
  const { pick, setPick, years, setYears } = useAreaPick();
  const q = useQuery(areaEventsQuery(pk));
  // 지도 아이콘에서 골랐으면 목록이 그 줄로 간다
  useEffect(() => {
    if (pick != null) document.getElementById(`ae-${pick}`)?.scrollIntoView({ block: "nearest" });
  }, [pick]);
  const all = q.data?.items ?? [];
  const cut = years ? new Date().getFullYear() - years : 0;
  const yr = (e: AreaEvent) => (e.on_date ? +e.on_date.slice(0, 4) : e.on_year);
  // 연도를 모르는 것은 거르지 않고 남긴다 — 「3년」을 눌렀다고 사라지면 없는 것이 된다
  const items = cut ? all.filter((e) => (yr(e) ?? 9999) >= cut) : all;
  if (q.isLoading || q.isError || !all.length) return null;

  const cur = items.find((x) => x.id === pick) ?? items[0] ?? null;
  // 있는 갈래만 세운다. 「기반시설 0」 을 세워 봐야 아직 안 실은 것과 없는 것이 같아 보인다
  const groups: [string, AreaEvent[]][] = [];
  for (const e of items) {
    const g = groups.find(([k]) => k === e.kind);
    if (g) g[1].push(e); else groups.push([e.kind, [e]]);
  }
  const rank = (k: string) => { const i = ORDER.indexOf(k); return i < 0 ? ORDER.length : i; };
  groups.sort((a, b) => rank(a[0]) - rank(b[0]));

  return (
    <section className="rv-card" id={id}>
      <div className="rv-ch">
        <span className="rv-k">주변 소식</span>
        <span className="ae-chips">
          {YEARS.map(([v, t]) => (
            <button key={v} className={years === v ? "on" : ""} onClick={() => setYears(v)}>{t}</button>
          ))}
        </span>
      </div>

      <div className="ae">
        <div className="ae-l">
          {groups.map(([k, rows]) => (
              <div key={k}>
                <div className="ae-gh">{k}<i>{rows.length}</i></div>
                {rows.map((e) => (
                  <button key={e.id} id={`ae-${e.id}`} className={`ae-i ${e.id === cur.id ? "on" : ""}`}
                    onClick={() => setPick(e.id)}>
                    <span className="ic" title={EVENT_TYPES.find((t) => t.icon === eventIcon(e).icon)?.label}><Icon name={eventIcon(e).icon} size={13} /></span>
                    <span className="nm">{e.name ?? "—"}</span>
                    <span className="d">{short(e)}</span>
                  </button>
                ))}
              </div>
          ))}
        </div>

        <div className="ae-r">
          {cur && (<>
          <div className="ae-nm">{cur.name ?? "—"}</div>
          {/* 해시태그(보도자료) — 이 줄은 자리 하나지만 그 글은 더 많은 곳을 말한다. 누르면 소식 탭에서 그 태그로 */}
          {cur.tags?.length > 0 && (
            <div className="ae-tags">
              {cur.tags.map((t) => <Link key={t} to={`/news?tag=${encodeURIComponent(t)}`}>#{t}</Link>)}
            </div>
          )}
          <dl className="ae-dl">
            {/* 낱말은 출처가 정한다 — 보도자료를 「고시일」이라 부르면 결정된 일로 읽힌다 */}
            <dt>{cur.source === "서울시 보도자료" ? "발표일"
                 : cur.source === "나라장터" ? "공고일" : "고시일"}</dt>
            <dd>{full(cur)}</dd>
            {cur.gosi_no && (<><dt>고시번호</dt><dd>{cur.gosi_no}</dd></>)}
            {/* 본문은 있을 때만 칸을 만든다. 빈 「본문」 칸을 세우면 그게 더 나쁘다 */}
            {cur.body && (<><dt>내용</dt><dd className="ae-body">{cur.body}</dd></>)}
            <dt>출처</dt><dd>{cur.source}</dd>
          </dl>
          {cur.source_url && (
            <a className="ae-url" href={cur.source_url} target="_blank" rel="noreferrer">
              {/* 원문 이름은 **출처**가 정한다 — 기반시설엔 고시와 발주가 섞여 있다 */}
              {cur.source === "서울시 보도자료" ? "보도자료"
                : cur.source === "나라장터" ? "공고" : "고시문"}</a>
          )}
          </>)}
        </div>
      </div>
    </section>
  );
}
