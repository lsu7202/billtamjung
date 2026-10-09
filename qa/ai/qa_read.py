"""읽기 API 회귀(11b · 10-04) — 구조가 보장하는 것을 **DB · 응답으로** 확인한다. 화면 문구가 아니라 사실을 본다.

  R1  선언 표(catalog)와 정본이 맞나 — Filters 칸 · 줄 칸 · ref.enums 키 · 칸 이름(KO)
  R2  고객 스키마에 팀 · 네이버 이름이 하나도 없다 · 고객 손잡이가 없다 · 「출처」 칸이 없다
  R3  응답 어디에도 내부 번호(건물번호 · 필지번호 · 고객번호 · 계정) · 전화 키 · 옛 대표가격이 없다
  R4  내 매물이 아닌 줄에 팀 칸 키가 없다
  R5  고객 펼치기 = 손으로 같은 조건을 건 결과
  R6  매물 탐색 화면과 건수가 같다
  R7  같은 지번에 건물이 여럿이면 구분 칸(주용도 · 연면적)이 실린다
  R8  도로명 주소로 찾아진다
  R9  고객 모드가 막혀야 할 것이 막힌다 · 일반 수만 동봉된다 · 넓은 검색이 막힌다
  P1  매물 공개 범위(0226 listings_now) — 다른 사무소는 내 매물을 못 보고 · 고객은 노출 · 가격 공개 광고 매물만 · 수집 매물은 중개사만
  P2  매물 단위 — 같은 건물의 내 매물(매매가 없음) · 네이버 매물(150억)이 두 줄로 서고 · 매매가 조건은 그 매물 값으로 걸린다(606-11, 10-04)
  P3  내 매물 매매가를 쓰면 매물 줄 값 · 지우면 null · 이력(field_events)이 남는다 · 등록 안 한 건물엔 못 쓴다

실행: qa/run.sh ai   (api · db 떠 있어야 함). QA 계정(qa-screen)과 임시 고객 계정만 쓰고 끝에 지운다.
"""
import asyncio
import json
import os
import re
import sys

import asyncpg
import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))
from app.ai import catalog, names  # noqa: E402
from app.domains.search import _FIELDS_OK, Filters  # noqa: E402

BASE = os.environ.get("BT_API", "http://localhost:8000")
DSN = os.environ.get("BT_DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
QA_EMAIL = os.environ.get("BT_QA_EMAIL", "qa-screen@qa.example.com")
QA_PW = os.environ.get("BT_QA_PW", "qascreen12345")
CUST_EMAIL = "qa-read-cust@example.com"
BAD_KEYS = {"건물번호", "필지번호", "고객번호", "account_id", "building_pk", "pnu", "_pk", "_id", "전화"}

ok = fail = 0


def chk(name, cond, got=""):
    global ok, fail
    if cond:
        ok += 1
        print(f"  ✓ {name}")
    else:
        fail += 1
        print(f"  ✗ {name}  {got}")


def keys(o, acc):
    if isinstance(o, dict):
        for k, v in o.items():
            acc.add(k)
            keys(v, acc)
    elif isinstance(o, list):
        for v in o:
            keys(v, acc)
    return acc


async def login(c, em, pw):
    r = await c.post("/auth/login", json={"email": em, "password": pw})
    return {"Authorization": "Bearer " + r.json()["access_token"]}


async def main():
    db = await asyncpg.connect(DSN)
    cust_id = buyer_id = saved_id = listing_made = None
    try:
        print("\n[R1] 선언 표와 정본")
        fields = set(Filters.model_fields)
        bad_f = [(n.ko, f) for n in catalog.TABLE for f in (n.lo, n.hi) if f and f not in fields]
        chk("거는 칸이 전부 Filters 에 있다", not bad_f, bad_f)
        bad_c = [(n.ko, n.col) for n in catalog.TABLE if n.col and n.col not in _FIELDS_OK and n.kind != "어디"]
        chk("줄 칸이 전부 검색이 낼 수 있는 칸이다", not bad_c, bad_c)
        keys_db = {r["enum_key"] for r in await db.fetch("SELECT DISTINCT enum_key FROM ref.enums WHERE active")}
        bad_e = [(n.ko, n.values[1]) for n in catalog.TABLE if n.values and n.values[0] == "enum" and n.values[1] not in keys_db]
        chk("값의 정본(ref.enums 키)이 다 있다", not bad_e, bad_e)
        bad_k = [(n.ko, n.col) for n in catalog.TABLE if n.col and n.kind != "어디" and names.ko(n.col) == n.col]
        chk("줄 칸마다 이름(KO)이 있다", not bad_k, bad_k)

        async with httpx.AsyncClient(base_url=BASE, timeout=180) as c:
            HB = await login(c, QA_EMAIL, QA_PW)
            me = (await c.get("/auth/me", headers=HB)).json()
            team = me["team_id"]
            # 임시 고객 계정
            from app.core.security import hash_password
            await db.execute("DELETE FROM app.accounts WHERE email = $1", CUST_EMAIL)
            cust_id = await db.fetchval(
                "INSERT INTO app.accounts(email,password_hash,name,kind,terms_agreed_at) VALUES($1,$2,'QA읽기고객','고객',now()) RETURNING id",
                CUST_EMAIL, hash_password("qa-pass-1234"))
            HC = await login(c, CUST_EMAIL, "qa-pass-1234")

            print("\n[R2] 모드별 스키마")
            tb = (await c.get("/ai/tools", headers=HB)).json()
            tc = (await c.get("/ai/tools", headers=HC)).json()
            chk("중개사 도구", [t["name"] for t in tb["tools"]] == ["buildings", "customers", "query", "invest", "develop", "map", "make", "fix", "ask"],
                [t["name"] for t in tb["tools"]])
            chk("고객 도구", [t["name"] for t in tc["tools"]] == ["buildings", "me", "invest", "develop", "map", "ask"],
                [t["name"] for t in tc["tools"]])
            sb, sc = tb["tools"][0]["input_schema"], tc["tools"][0]["input_schema"]
            cn = set(sc["properties"]["조건"]["items"]["properties"])
            leak = sorted(n for n in cn if catalog.BY_KO[n].scope != "public")
            chk("고객 조건 이름에 팀 · 네이버가 0개", not leak, leak)
            chk("고객 정렬에 팀 · 네이버가 0개",
                not [n for n in sc["properties"]["정렬"]["enum"] if n in catalog.BY_KO and catalog.BY_KO[n].scope != "public"])
            chk("고객 손잡이 없음", "고객" not in sc["properties"])
            chk("「출처」 칸 없음(중개사 · 고객)", "출처" not in sb["properties"] and "출처" not in sc["properties"])
            chk("고객 「매물」 값 = 매물 · 전체", sc["properties"]["조건"]["items"]["properties"]["매물"]["enum"] == ["매물", "전체"])
            chk("중개사 「매물」 값 = 내 매물 · 매물 · 전체",
                sb["properties"]["조건"]["items"]["properties"]["매물"]["enum"] == ["내 매물", "매물", "전체"])
            chk("옛 가격 이름(가격 · 광고매매가 · 네이버매매가) 0개",
                not ({"가격", "광고매매가", "네이버매매가"} & set(sb["properties"]["조건"]["items"]["properties"])))
            chk("어느 스키마에도 내부 번호 이름이 없다", not ({"건물번호", "필지번호", "고객번호"} & (keys(tb, set()) | keys(tc, set()))))

            print("\n[R3 · R4] 응답 키")
            r = await c.post("/ai/read/buildings", headers=HB, json={"조건": [{"지역": "종로구", "매물": "전체", "명도": {}, "상태": {}, "소유자": {},
                             "담당자": {}, "층별": {}, "짝": {}, "임대료": {}}], "정렬": "대지면적", "차순": "내림차순"})
            j = r.json()
            chk("응답 200", r.status_code == 200, r.text[:200])
            got = keys(j, set()) & (BAD_KEYS | {"대표가격", "대표가격출처"})
            chk("내부 번호 · 전화 · 옛 대표가격 키 0개", not got, got)
            s = json.dumps(j, ensure_ascii=False)
            chk("긴 숫자 번호 값 0개", not re.findall(r'"\d{10,22}"', s))
            team_ko = {n.ko for n in catalog.TABLE if n.scope == "team"}
            rows_all = [row for g in j.get("검색", []) for row in g.get("목록", [])]
            stray = [k for row in rows_all if row.get("주인") != "내 매물" for k in row if k in team_ko]
            chk("내 매물 아닌 줄의 팀 칸 0개", not stray, stray[:5])
            bad_p = [row["주소"] for row in rows_all if "매매가" in row and not isinstance(row["매매가"], int)]
            chk("매매가는 매물마다 숫자 하나", not bad_p, bad_p[:3])
            chk("추정가는 안 부르면 없다", not any("추정가" in row for row in rows_all))

            print("\n[R5] 고객 펼치기")
            buyer_id = await db.fetchval("INSERT INTO app.buyers(team_id,name) VALUES($1,'QA읽기펼치기') RETURNING id", team)
            cj = {"filters": {"land_area_min": 150, "age_max": 10}, "regions": [{"label": "종로구 전체", "bjd_code": "11110"}]}
            saved_id = await db.fetchval(
                "INSERT INTO app.saved_searches(account_id,team_id,buyer_id,name,conditions_json) VALUES($1,$2,$3,'QA읽기조건',$4) RETURNING id",
                me["account_id"], team, buyer_id, json.dumps(cj))
            a = (await c.post("/ai/read/buildings", headers=HB, json={"고객": "QA읽기펼치기", "조건": [{"매물": "전체"}],
                                                                      "정렬": "대지면적", "차순": "내림차순"})).json()["검색"][0]
            b = (await c.post("/ai/read/buildings", headers=HB, json={"조건": [{"매물": "전체", "지역": "종로구", "대지면적": {"이상": 150}, "연식": {"이하": 10}}],
                                                                      "정렬": "대지면적", "차순": "내림차순"})).json()["검색"][0]
            chk("펼친 결과 = 손으로 건 결과", a["전체"] == b["전체"], f"{a.get('전체')} vs {b.get('전체')}")

            print("\n[R6] 매물 탐색 화면과 같은가")
            scr = (await c.post("/search/count", headers=HB, json={"tab": "explore",
                                                                  "filters": {"region": "종로구", "land_area_min": 100,
                                                                              "nots": {"jimoks": ["공원", "도로", "하천", "제방", "구거", "유지", "철도용지", "묘지", "수도용지", "사적지"]}}})).json()
            m = (await c.post("/ai/read/buildings", headers=HB, json={"조건": [{"지역": "종로구", "대지면적": {"이상": 100}}],
                                                                      "정렬": "대지면적", "차순": "내림차순"})).json()["검색"][0]
            chk("매물 수 = 탐색 화면 매물 수", m["전체"] == scr["total"], f"{m['전체']} vs {scr['total']}")
            chk("기본 범위(매물)에 일반은 수만", isinstance(m.get("일반"), int), m.get("일반"))

            print("\n[R7] 같은 지번 여러 동 = 지번 한 줄(0230 · 매물-중심 §5)")
            dup = await db.fetchval(
                "SELECT addr FROM master.buildings WHERE bjd_code LIKE '11110%' GROUP BY addr HAVING count(*) > 2 LIMIT 1")
            r = (await c.post("/ai/read/buildings", headers=HB, json={"조건": [{"주소": dup, "매물": "전체"}],
                                                                      "정렬": "대지면적", "차순": "내림차순"})).json()["검색"][0]
            rows = r.get("목록") or []
            n_dong = await db.fetchval("SELECT count(*) FROM master.buildings WHERE addr = $1", dup)
            chk(f"{dup} — 한 줄 · 동수 · 동 주용도 목록",
                len(rows) == 1 and rows[0].get("동수") == n_dong and isinstance(rows[0].get("주용도"), list), rows[:2])

            print("\n[R8] 도로명 주소")
            rk = await db.fetchrow("SELECT addr, road_addr FROM master.buildings WHERE road_addr IS NOT NULL AND bjd_code LIKE '11110%' LIMIT 1")
            road = re.sub(r"\s*\(.*\)$", "", rk["road_addr"]).replace("서울특별시 ", "")
            r = (await c.post("/ai/read/buildings", headers=HB, json={"조건": [{"주소": road, "매물": "전체"}],
                                                                      "정렬": "대지면적", "차순": "내림차순"})).json()["검색"][0]
            hit = [x["주소"] for x in r.get("목록", [])]
            chk(f"「{road}」로 찾아진다", rk["addr"] in hit, hit[:3])

            print("\n[R9] 고객 모드 막이 · 넓은 검색")
            r = await c.post("/ai/read/buildings", headers=HC, json={"조건": [{"지역": "종로구", "급함": {"값": ["급함"]}}], "정렬": "대지면적", "차순": "내림차순"})
            chk("팀 이름 → 422", r.status_code == 422)
            r = await c.post("/ai/read/buildings", headers=HC, json={"조건": [{"지역": "종로구", "매물": "내 매물"}], "정렬": "대지면적", "차순": "내림차순"})
            chk("고객 「내 매물」 → 422", r.status_code == 422)
            r = await c.post("/ai/read/buildings", headers=HC, json={"조건": [{"지역": "종로구", "임대료": {}}], "정렬": "대지면적", "차순": "내림차순"})
            chk("고객 「임대료」(네이버 임대시세) → 422", r.status_code == 422)
            r = await c.post("/ai/read/buildings", headers=HC, json={"고객": "누구", "조건": [{"지역": "종로구"}], "정렬": "대지면적", "차순": "내림차순"})
            chk("고객 손잡이 → 422", r.status_code == 422)
            r = await c.post("/ai/read/customers", headers=HC, json={"정렬": "등록일", "차순": "내림차순"})
            chk("고객 조회 → 403", r.status_code == 403)
            r = await c.post("/ai/read/buildings", headers=HC, json={"조건": [{"지역": "강남구"}], "정렬": "매매가", "차순": "내림차순"})
            owners = {row.get("주인") for g in r.json().get("검색", []) for row in g.get("목록", [])}
            chk("고객에겐 내 매물 · 네이버가 없다", r.status_code == 200 and not ({"내 매물", "네이버"} & owners), owners)
            r = await c.post("/ai/read/buildings", headers=HB, json={"조건": [{"대지면적": {"이상": 100}, "매물": "전체"}], "저장조건": "QA읽기조건",
                                                                     "정렬": "대지면적", "차순": "내림차순"})
            chk("저장조건(지역 있음) + 전체 → 200", r.status_code == 200, r.text[:120])
            await db.execute("UPDATE app.saved_searches SET conditions_json = $2 WHERE id = $1", saved_id,
                             json.dumps({"filters": {"land_area_min": 150}, "regions": []}))
            r = await c.post("/ai/read/buildings", headers=HB, json={"저장조건": "QA읽기조건", "조건": [{"매물": "전체"}],
                                                                     "정렬": "대지면적", "차순": "내림차순"})
            chk("지역 없는 조건 + 전체 → TOO_WIDE", r.status_code == 422 and "TOO_WIDE" in r.text, r.text[:120])

            print("\n[P1] 매물 공개 범위")
            other = await db.fetchval("SELECT id FROM app.teams WHERE id <> $1 AND NOT system ORDER BY id LIMIT 1", team)
            leak = await db.fetchval(
                "SELECT count(*) FROM app.listings_now($1, true) n WHERE n.owner = 'mine' AND n.team_id <> $1", other)
            chk("다른 사무소의 내 매물 줄 0개", leak == 0, leak)
            seen_other = await db.fetchval(
                """SELECT count(*) FROM app.listings_now($1, true) n WHERE n.owner = 'office' AND n.team_id = $2""", other, team)
            live_ads = await db.fetchval(
                """SELECT count(*) FROM app.ads a JOIN app.listings l ON l.id = a.listing_id
                    WHERE l.team_id = $1 AND a.state = '노출' AND a.expires_on >= current_date""", team)
            chk("다른 사무소엔 노출 중 광고 매물만", seen_other == live_ads, (seen_other, live_ads))
            cust = {r["owner"] for r in await db.fetch("SELECT DISTINCT owner FROM app.listings_now(NULL, false)")}
            chk("고객은 광고 매물만", cust <= {"office"}, cust)
            hidden_price = await db.fetchval(
                """SELECT count(*) FROM app.listings_now(NULL, false) n JOIN app.ads a ON a.id = n.ad_id
                    WHERE NOT a.price_open AND n.price IS NOT NULL""")
            chk("가격 비공개 광고 매물은 매매가가 빈다", hidden_price == 0, hidden_price)
            sysrow = await db.fetchval("SELECT count(*) FROM app.statuses s JOIN app.teams t ON t.id = s.team_id WHERE t.system")
            chk("수집 사무소엔 상태 사전이 없다", sysrow == 0, sysrow)

            print("\n[P2 · P3] 매물 단위 · 쓰기")
            # 네이버 매물이 있는 지번 하나(내 매물은 없고 · 주소가 한 동뿐) — 매물은 지번으로 등록하고 번호로 쓴다(0255)
            row = await db.fetchrow(
                """SELECT lp.pnu, l.id AS crawl_id, l.price FROM app.listings l JOIN app.teams t ON t.id = l.team_id AND t.system
                     JOIN app.listing_crawl c ON c.listing_id = l.id AND c.gone_on IS NULL
                     JOIN app.listing_parcels lp ON lp.listing_id = l.id AND lp.main
                     JOIN master.parcel_rep r ON r.pnu = lp.pnu AND r.n_bldg = 1
                    WHERE NOT EXISTS (SELECT 1 FROM app.listing_parcels m WHERE m.pnu = lp.pnu AND m.team_id = $1)
                      AND l.gongsi_ratio BETWEEN 10 AND 80
                    ORDER BY l.price, lp.pnu LIMIT 1""", team)
            pnu, mk_price = row["pnu"], row["price"]
            addr = await db.fetchval("SELECT app.parcel_addr($1)", pnu)
            r = await c.patch("/listings/biz", headers=HB, json={"listing_id": row["crawl_id"], "fields": {"exclusive": None}})
            chk("우리 사무소 매물이 아니면 매물관리 칸을 못 쓴다", r.status_code == 404, r.status_code)
            r = await c.put("/listings/claim", headers=HB, json={"pnu": pnu, "assignee_account_id": me["account_id"]})
            chk("매물 등록", r.status_code < 400, r.text[:150])
            lid = r.json().get("listing_id")
            listing_made = lid
            j = (await c.post("/ai/read/buildings", headers=HB, json={"조건": [{"주소": addr}], "정렬": "매매가", "차순": "내림차순"})).json()
            rows = j["검색"][0].get("목록") or []
            got = sorted((x.get("주인"), x.get("매매가")) for x in rows)
            chk("같은 건물에 매물 두 줄(내 매물 · 네이버) · 매물마다 매매가 하나",
                ("내 매물", None) in got and ("네이버", mk_price) in got and len(rows) == 2, got)
            j = (await c.post("/ai/read/buildings", headers=HB, json={"조건": [{"주소": addr, "매매가": {"이상": mk_price, "이하": mk_price}}],
                                                                      "정렬": "매매가", "차순": "내림차순"})).json()
            got = [x.get("주인") for x in j["검색"][0].get("목록") or []]
            chk("매매가 조건은 그 매물 값으로 걸린다(네이버 줄만)", got == ["네이버"], got)
            r = await c.patch("/listings/biz", headers=HB, json={"listing_id": lid, "fields": {"sale_price": str(mk_price + 100000000)}})
            lp = await db.fetchval("SELECT price FROM app.listings WHERE id=$1", lid)
            ev = await db.fetchval("SELECT count(*) FROM app.field_events WHERE listing_id=$1 AND field='sale_price'", lid)
            chk("매매가 쓰기 → 매물 값 · 이력", r.status_code < 400 and lp == mk_price + 100000000 and ev >= 1, (r.status_code, lp, ev))
            pin = (await c.post("/search/pins", headers=HB, json={"tab": "explore", "filters": {"addr": addr}})).json()
            first = [p for p in pin if p.get("rank") == 1]
            chk("핀 = 1번 매물(내 매물)", len(first) == 1 and first[0]["kind"] == "mine" and first[0]["price"] == mk_price + 100000000,
                [(p.get("rank"), p.get("kind"), p.get("price")) for p in pin])
            await c.patch("/listings/biz", headers=HB, json={"listing_id": lid, "fields": {"sale_price": ""}})
            chk("매매가 지우기 → null", None is await db.fetchval("SELECT price FROM app.listings WHERE id=$1", lid))
    finally:
        if listing_made:
            await db.execute("DELETE FROM app.listings WHERE id = $1", listing_made)   # 값 이력 · 지번 연결은 매물과 같이 지워진다
        if saved_id:
            await db.execute("DELETE FROM app.saved_searches WHERE id = $1", saved_id)
        if buyer_id:
            await db.execute("DELETE FROM app.buyers WHERE id = $1", buyer_id)
        if cust_id:
            await db.execute("DELETE FROM app.accounts WHERE id = $1", cust_id)
        await db.close()
    print(f"\n{ok} ✓ · {fail} ✗")
    sys.exit(1 if fail else 0)


asyncio.run(main())
