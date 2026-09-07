"""소식 — 서울 전체의 고시·공고·인허가·보도자료를 **자리와 무관하게** 한 목록으로(2026-09-06).

## 왜 따로 있나
건물 상세의 「주변 소식」은 반경으로 만나므로 **자리를 아는 것만** 선다. 그런데 자리를 모르는
소식이 훨씬 많다 — 고시는 최근 10년 5,456건 중 3,243건이 도형이 없고, 나라장터는 4,698건 중
4,456건이 공고명으로 자리를 못 읽는다. 그걸 버리면 **「없는 것」과 「모르는 것」이 같아진다.**

그래서 자리는 **거르는 조건이 아니라 하나의 값**으로 둔다. 여기서는 전부 보이고,
주변 소식에서는 자리를 아는 것만 선다. 같은 자료를 두 화면이 다르게 자를 뿐이다.

## 무엇을 합치나
    urban_notice      고시·공고 4.4만  — 본문·고시문 PDF 까지
    press_event       보도자료 1,575글 — **본문 없음**(공공누리 4유형). 제목·사실·태그·링크만. 글 하나에 한 줄
    g2b_bid           공사 발주 4,698
    building_permit   건축 인허가      — 최근 것만(전부 실으면 71만 줄이라 목록이 아니다)

합친 표를 따로 만들지 않는다. 원천이 넷뿐이고 각자 색인이 있어 질의로 합치는 편이 싸다 —
표를 만들면 원천이 바뀔 때마다 다시 구워야 하고, 그 사이 두 화면이 다른 것을 본다.
"""
from datetime import date

from fastapi import APIRouter, Depends, Query

from ..core.db import pool
from ..core.deps import CurrentUser, current_user

router = APIRouter(prefix="/news", tags=["news"])

# 갈래 → (원천표, 사람이 읽는 이름). 주변 소식의 갈래와 **같은 낱말**을 쓴다.
KINDS = ("정비·개발", "기반시설", "건축 인허가", "규제", "정책 발표", "고시·공고")


@router.get("")
async def news(
    kind: str | None = None,
    q: str | None = None,
    year: int | None = None,
    years: int | None = None,
    tag: str | None = None,
    limit: int = Query(50, ge=1, le=200),
    cursor: str | None = None,
    _: CurrentUser = Depends(current_user),
):
    """날짜 내림차순 한 페이지. `cursor` 는 「날짜|열쇠」 — 같은 날이 많아 날짜만으론 못 넘긴다.
    `years` 는 최근 N년(화면 기본 1년), `tag` 는 해시태그 하나로 거른다(보도자료만 태그가 있다)."""
    args: list = []

    def a(v) -> str:
        args.append(v)
        return f"${len(args)}"

    # ── 거르는 조건은 **원천마다 그 안에서** 건다(2026-09-06). 합친 뒤에 걸면 색인을 못 타
    #    본문 4.4만을 매번 훑는다(0.48초). 원천 안에서 걸면 trgm GIN 색인으로 수십 ms 다.
    like = a("%" + q.strip().lstrip("#") + "%") if q else None
    since = a(years) if years else None
    tag_v = a(tag.strip().lstrip("#")) if tag else None

    parts: list[str] = []
    # ① area_event — **보도자료는 뺀다.** 거기선 자리마다 한 줄이라(창동역 줄·종로5가역 줄) 여기 올리면
    #    같은 글이 두 번 선다. 보도자료는 ③에서 글 하나에 한 줄로 따로 싣는다(2026-09-06 대표 지적).
    w = ["e.src_table <> 'press_event'"]
    if kind:
        w.append(f"e.kind = {a(kind)}")
    if year:
        w.append(f"COALESCE(EXTRACT(YEAR FROM e.on_date)::int, e.on_year) = {a(year)}")
    if since:
        w.append(f"COALESCE(e.on_date, make_date(COALESCE(e.on_year,1900),1,1))"
                 f" >= CURRENT_DATE - make_interval(years => {since})")
    if tag_v:
        w.append(f"p.tags @> ARRAY[{tag_v}]::text[]")
    if like:
        w.append(f"(e.name ILIKE {like} OR e.body ILIKE {like}"
                 f" OR EXISTS (SELECT 1 FROM unnest(COALESCE(p.tags, '{{}}'::text[])) t WHERE t ILIKE {like}))")
    parts.append(f"""
      SELECT e.on_date, e.on_year, e.kind, e.name, e.gosi_no, e.body,
             e.source, e.source_url, e.src_table, e.src_key,
             (e.geom IS NOT NULL) AS has_geom, p.tags
        FROM master.area_event e
        LEFT JOIN master.press_event p ON e.src_table = 'press_event' AND p.id::text = e.src_key
       WHERE {' AND '.join(w)}""")
    # ② 고시·공고(urban_notice 만의 것). 갈래가 하나뿐이고 태그가 없어, 그걸로 거르면 이 원천은 통째로 빠진다
    if (not kind or kind == "고시·공고") and not tag_v:
        w = ["NOT EXISTS (SELECT 1 FROM master.area_event e WHERE e.src_key = n.notice_code)"]
        if year:
            w.append(f"EXTRACT(YEAR FROM n.notice_date)::int = {a(year)}")
        if since:
            w.append(f"n.notice_date >= CURRENT_DATE - make_interval(years => {since})")
        if like:
            w.append(f"(n.title ILIKE {like} OR n.body ILIKE {like})")
        parts.append(f"""
      SELECT n.notice_date, EXTRACT(YEAR FROM n.notice_date)::smallint, '고시·공고',
             btrim(regexp_replace(n.title, '\\s*(,\\s*)?(및\\s*)?지형도면\\s*고시\\s*$', '')),
             CASE WHEN n.notice_no IS NOT NULL THEN '제' || n.notice_no || '호' END,
             n.body, '서울도시공간포털', n.pdf, 'urban_notice', n.notice_code,
             false, NULL::text[]
        FROM master.urban_notice n
       WHERE {' AND '.join(w)}""")

    # ③ 보도자료 — **글 하나가 한 줄**, 자리를 몰라도 싣는다(1,575글 전부). 태그는 글 단위라 어느 줄이나 같다
    if not kind or kind == "정책 발표":
        w = ["true"]
        if year:
            w.append(f"EXTRACT(YEAR FROM p.on_date)::int = {a(year)}")
        if since:
            w.append(f"p.on_date >= CURRENT_DATE - make_interval(years => {since})")
        if tag_v:
            w.append(f"p.tags @> ARRAY[{tag_v}]::text[]")
        if like:
            w.append(f"(p.name ILIKE {like} OR p.title ILIKE {like}"
                     f" OR EXISTS (SELECT 1 FROM unnest(COALESCE(p.tags, '{{}}'::text[])) t WHERE t ILIKE {like}))")
        # UNION 의 한 팔 안에서 ORDER BY 를 쓰려면 괄호로 싸야 한다(안 싸면 전체 정렬로 읽혀 p 를 못 찾는다)
        parts.append(f"""
      SELECT z.* FROM (
        SELECT DISTINCT ON (p.ntt_no) p.on_date, NULL::smallint AS on_year, '정책 발표' AS kind, p.name,
               NULL::text AS gosi_no, NULL::text AS body,
               '서울시 보도자료' AS source, p.url AS source_url, 'press_event' AS src_table, p.ntt_no::text AS src_key,
               (p.geom IS NOT NULL) AS has_geom, p.tags
          FROM master.press_event p
         WHERE {' AND '.join(w)}
         ORDER BY p.ntt_no, (p.geom IS NOT NULL) DESC, p.id) z""")

    sql = f"""
      WITH all_news AS ({' UNION ALL '.join(parts)})
      SELECT * FROM all_news WHERE true
    """
    if cursor:
        d, k = (cursor.split("|", 1) + [""])[:2]
        sql += (f" AND (COALESCE(on_date, make_date(COALESCE(on_year,1900),1,1)), src_key)"
                f" < ({a(d)}::date, {a(k)})")
    sql += (" ORDER BY COALESCE(on_date, make_date(COALESCE(on_year,1900),1,1)) DESC,"
            f" src_key DESC LIMIT {a(limit + 1)}")

    rows = await pool().fetch(sql, *args)
    more = len(rows) > limit
    rows = rows[:limit]

    def one(r) -> dict:
        return {
            "kind": r["kind"], "name": r["name"],
            # 날짜 두 칸은 합치지 않는다 — 연도만 아는 것을 1월 1일로 읽으면 안 된다
            "on_date": r["on_date"].isoformat() if r["on_date"] else None,
            "on_year": r["on_year"],
            "gosi_no": r["gosi_no"], "body": r["body"],
            "source": r["source"], "source_url": r["source_url"],
            "src_table": r["src_table"], "src_key": r["src_key"],
            # 자리를 아는가 — 「주변 소식」에 설 수 있는 줄인지를 말한다(화면엔 안 쓴다 · 에이전트용)
            "located": r["has_geom"],
            "tags": list(r["tags"] or []),
        }

    nxt = None
    if more and rows:
        last = rows[-1]
        d = last["on_date"] or date(last["on_year"] or 1900, 1, 1)
        nxt = f"{d.isoformat()}|{last['src_key'] or ''}"
    return {"items": [one(r) for r in rows], "next": nxt, "kinds": list(KINDS)}


@router.get("/pins")
async def news_pins(
    minlng: float, minlat: float, maxlng: float, maxlat: float,
    years: int = 1,
    limit: int = Query(400, ge=1, le=1000),
    _: CurrentUser = Depends(current_user),
):
    """건물 검색 지도에 찍을 소식 핀(2026-09-06 대표 「소식 아이콘은 검색 지도에도」).

    자리를 아는 것(area_event)만, 화면 상자 안에서 최근 N년(기본 1년 · 0 이면 전체), 새 것부터. 빅 이벤트/기타 가르기는
    화면이 한다(`eventIcon.ts` 한 곳) — 여기서 가르면 규칙이 두 벌이 된다. 면은 면 안의 점으로 찍는다.
    """
    rows = await pool().fetch(
        """SELECT e.id, e.kind, e.name, e.source, e.source_url, e.on_date, e.on_year,
                  ST_X(ST_PointOnSurface(e.geom)) AS lng, ST_Y(ST_PointOnSurface(e.geom)) AS lat
             FROM master.area_event e
            WHERE e.geom && ST_MakeEnvelope($1, $2, $3, $4, 4326)
              AND ($5 <= 0 OR COALESCE(e.on_date, make_date(COALESCE(e.on_year,1900),1,1))
                  >= CURRENT_DATE - make_interval(years => $5))
            ORDER BY COALESCE(e.on_date, make_date(COALESCE(e.on_year,1900),1,1)) DESC, e.id
            LIMIT $6""",
        minlng, minlat, maxlng, maxlat, years, limit)
    return {"items": [{
        "id": r["id"], "kind": r["kind"], "name": r["name"], "source": r["source"], "source_url": r["source_url"],
        "on_date": r["on_date"].isoformat() if r["on_date"] else None, "on_year": r["on_year"],
        "lng": r["lng"], "lat": r["lat"],
    } for r in rows], "truncated": len(rows) >= limit}


@router.get("/item")
async def news_item(id: int, _: CurrentUser = Depends(current_user)):
    """지도 핀 하나 → 소식 탭에서 **그 소식**을 연다(2026-09-06 대표 「소식에서 보기가 소식 탭으로만 간다」).

    area_event 의 id 를 받아 소식 탭이 쓰는 모양으로 돌려준다. 보도자료 줄이면 소식 탭과 같이 글 단위(ntt_no)로.
    """
    e = await pool().fetchrow(
        """SELECT e.id, e.kind, e.name, e.on_date, e.on_year, e.gosi_no, e.body, e.source, e.source_url,
                  e.src_table, e.src_key, (e.geom IS NOT NULL) AS has_geom, p.tags, p.ntt_no
             FROM master.area_event e
             LEFT JOIN master.press_event p ON e.src_table = 'press_event' AND p.id::text = e.src_key
            WHERE e.id = $1""", id)
    if e is None:
        return {"item": None}
    press = e["src_table"] == "press_event"
    return {"item": {
        "kind": e["kind"], "name": e["name"],
        "on_date": e["on_date"].isoformat() if e["on_date"] else None, "on_year": e["on_year"],
        "gosi_no": e["gosi_no"], "body": None if press else e["body"],
        "source": e["source"], "source_url": e["source_url"],
        "src_table": e["src_table"], "src_key": str(e["ntt_no"]) if press else e["src_key"],
        "located": e["has_geom"], "tags": list(e["tags"] or []),
    }}
