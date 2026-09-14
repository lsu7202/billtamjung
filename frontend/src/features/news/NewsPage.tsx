import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { newsApi, newsItemApi, type NewsItem } from "../../shared/api/endpoints";
import { Icon } from "../../shared/ui/Icon";
import { eventIcon, EVENT_TYPES } from "../../shared/map/eventIcon";
import "./news.css";

/** 소식 — 서울 전체의 고시·공고·인허가·보도자료를 **자리와 무관하게** 한 목록으로(2026-09-06).
 *
 *  건물 상세의 「주변 소식」과 **같은 자료**다. 다른 것은 자르는 법 하나뿐이다 —
 *  거기는 반경으로 자르니 자리를 아는 것만 서고, 여기는 안 자르니 전부 선다.
 *  자리를 모르는 소식이 훨씬 많다(고시 5,456 중 3,243이 도형 없음). 그걸 버리면
 *  **「없는 것」과 「모르는 것」이 같아진다.**
 *
 *  화면 어법은 주변 소식과 같다: 왼쪽에서 훑고 오른쪽에서 읽는다.
 */
const short = (e: NewsItem) =>
  e.on_date ? `${e.on_date.slice(2, 4)}.${e.on_date.slice(5, 7)}`
  : e.on_year ? `${String(e.on_year).slice(2)}년` : "—";
const full = (e: NewsItem) =>
  e.on_date ? `${e.on_date.slice(0, 4)}년 ${+e.on_date.slice(5, 7)}월 ${+e.on_date.slice(8, 10)}일`
  : e.on_year ? `${e.on_year}년` : "—";
const dateLabel = (s: string) =>
  s === "서울시 보도자료" ? "발표일" : s === "나라장터" ? "공고일" : "고시일";
const linkLabel = (s: string) =>
  s === "서울시 보도자료" ? "보도자료" : s === "나라장터" ? "공고" : "고시문";
// 기간 — 기본 1년(2026-09-06 대표). 소식은 오래되면 소식이 아니다
const YEARS: [number | null, string][] = [[1, "1년"], [3, "3년"], [5, "5년"], [null, "전체"]];

export function NewsPage() {
  const [kind, setKind] = useState<string | null>(null);
  const [years, setYears] = useState<number | null>(1);
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [pick, setPick] = useState<string | null>(null);
  // 해시태그는 주소에 산다(`/news?tag=창동역`) — 건물 상세의 주변 소식에서 태그를 누르면 여기로 온다
  const [sp, setSp] = useSearchParams();
  const tag = sp.get("tag");
  // 지도 핀에서 「소식에서 보기」 — `/news?pick=<area_event id>`. 그 소식을 바로 연다(목록에 없어도)
  const pickId = Number(sp.get("pick")) || null;
  const picked = useQuery({ queryKey: ["news-item", pickId], queryFn: () => newsItemApi.get(pickId!), enabled: pickId != null });
  const setTag = (t: string | null) => { const n = new URLSearchParams(sp); t ? n.set("tag", t) : n.delete("tag"); setSp(n); };

  const qy = useInfiniteQuery({
    queryKey: ["news", kind, term, years, tag],
    queryFn: ({ pageParam }) =>
      newsApi.list({ kind: kind ?? undefined, q: term || undefined, years: years ?? undefined,
                     tag: tag ?? undefined, limit: 60, cursor: pageParam as string | undefined }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.next ?? undefined,
  });
  const items = (qy.data?.pages ?? []).flatMap((p) => p.items);
  const kinds = qy.data?.pages[0]?.kinds ?? [];
  const key = (e: NewsItem) => `${e.src_table}:${e.src_key}`;
  const fromPin = picked.data?.item ?? null;
  const cur = (pick ? items.find((x) => key(x) === pick) : null)
    ?? (fromPin ? (items.find((x) => key(x) === key(fromPin)) ?? fromPin) : null)
    ?? items[0] ?? null;

  return (
    <div className="nw">
      <div className="nw-head">
        <h1>소식</h1>
        {/* 검색은 목록 위 pill 한 줄 — 네모 입력칸을 인라인에 두지 않는다 */}
        <form className="nw-q" onSubmit={(e) => { e.preventDefault(); setTerm(q.trim()); }}>
          <input className="q-pill" value={q} placeholder="이름 · 내용 · 태그로 찾기"
            onChange={(e) => setQ(e.target.value)} />
        </form>
      </div>

      <div className="nw-chips">
        <button className={kind === null ? "on" : ""} onClick={() => setKind(null)}>전체</button>
        {kinds.map((k) => (
          <button key={k} className={kind === k ? "on" : ""}
            onClick={() => setKind(kind === k ? null : k)}>{k}</button>
        ))}
        {/* 고른 태그 — 다시 누르면 푼다 */}
        {tag && <button className="on tg" onClick={() => setTag(null)}>#{tag} ×</button>}
        <span className="nw-years">
          {YEARS.map(([v, t]) => (
            <button key={t} className={years === v ? "on" : ""} onClick={() => setYears(v)}>{t}</button>
          ))}
        </span>
      </div>

      <div className="nw-body">
        <div className="nw-l">
          {qy.isLoading && <div className="nw-none">불러오는 중</div>}
          {!qy.isLoading && !items.length && <div className="nw-none">없습니다</div>}
          {items.map((e) => (
            <button key={key(e)} className={`nw-i ${key(e) === (cur && key(cur)) ? "on" : ""}`}
              onClick={() => setPick(key(e))}>
              {/* 종류 아이콘 — 지도 핀과 같은 그림(eventIcon 한 곳). 고시·공고는 깃발 */}
              {(() => { const ic = eventIcon({ kind: e.kind, name: e.name, source: e.source }).icon;
                return <span title={EVENT_TYPES.find((t) => t.icon === ic)?.label}><Icon name={ic} size={14} /></span>; })()}
              <span className="k">{e.kind}</span>
              <span className="nm">{e.name ?? "—"}</span>
              <span className="d">{short(e)}</span>
            </button>
          ))}
          {qy.hasNextPage && (
            <button className="nw-more" disabled={qy.isFetchingNextPage}
              onClick={() => qy.fetchNextPage()}>
              {qy.isFetchingNextPage ? "…" : "더 보기"}</button>
          )}
        </div>

        <div className="nw-r">
          {cur && (<>
            <div className="nw-nm">{cur.name ?? "—"}</div>
            {/* 해시태그 — 한 줄엔 자리 하나만 보이니, 그 글이 말하는 나머지(다른 역·구·주제)는 여기 선다.
                누르면 그 태그로 거른다 */}
            {cur.tags?.length > 0 && (
              <div className="nw-tags">
                {cur.tags.map((t) => (
                  <button key={t} className={t === tag ? "on" : ""} onClick={() => setTag(t === tag ? null : t)}>#{t}</button>
                ))}
              </div>
            )}
            <dl className="nw-dl">
              <dt>갈래</dt><dd>{cur.kind}</dd>
              <dt>{dateLabel(cur.source)}</dt><dd>{full(cur)}</dd>
              {cur.gosi_no && (<><dt>고시번호</dt><dd>{cur.gosi_no}</dd></>)}
              {cur.body && (<><dt>내용</dt><dd className="nw-body-tx">{cur.body}</dd></>)}
              <dt>출처</dt><dd>{cur.source}</dd>
            </dl>
            {cur.source_url && (
              <a className="nw-url" href={cur.source_url} target="_blank" rel="noreferrer">
                {linkLabel(cur.source)}</a>
            )}
          </>)}
        </div>
      </div>
    </div>
  );
}
