#!/usr/bin/env python3
"""통합뷰 → SQLite 적재 (검증·조회용).
테이블: buildings(1동=1행, 스칼라) · prices(PNU×연도) · sales(PK×계약) · dong_sales(법정동).
리스트 필드(걸침·지하철·버스)는 JSON 텍스트로 보관.
출력: data/빌탐정.db
"""
import json, sqlite3, os, time
import os as _os, sys as _sys
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
from build_report import Report   # noqa: E402

DB="data/빌탐정.db"

def main():
    if os.path.exists(DB): os.remove(DB)
    con=sqlite3.connect(DB)
    cur=con.cursor()
    cur.executescript("""
    PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;
    CREATE TABLE buildings(
      pk TEXT PRIMARY KEY, 주소 TEXT, 도로명주소 TEXT, 대장구분 TEXT, pnu TEXT,
      시군구코드 TEXT, 법정동코드 TEXT,
      대지면적 REAL, 건폐율 REAL, 용적률 REAL, 연면적 REAL,
      건축면적 REAL, 용적률산정연면적 REAL,
      주용도코드 TEXT, 주용도 TEXT, 기타용도 TEXT, 구조 TEXT,
      지상층수 INT, 지하층수 INT, 높이 REAL, 엘리베이터 INT, 엘리베이터참조 INT, 주차 INT, 사용승인일 TEXT,
      사용승인일_정밀도 TEXT, 최근대수선일 TEXT, 최근대수선일_정밀도 TEXT, 대수선건수 INT, 대지건폐용적_출처 TEXT,
      지목 TEXT, 토지면적 REAL, 토지이용상황 TEXT,
      용도지역 TEXT, 용도지역_걸침 TEXT, 개발제한비중 REAL,
      지세 TEXT, 지형형상 TEXT, 도로접면 TEXT,
      역과의거리 INT, 주변지하철 TEXT, 주변버스 TEXT,
      지하철수 INT, 버스수 INT,
      -- 건폐율·용적률이 대장값인지 계산인지(0040·0041). export_seoul 이 이 칸을 읽는다 —
      -- 도입할 때 여기만 안 따라와서 3단계가 8월 10일부터 죽어 있었다(2026-08-31에 발견).
      -- 0144 이후로는 '대장' 아니면 빈값만 나온다. 계산분은 master.building_calc 로 간다.
      건폐율출처 TEXT, 용적률출처 TEXT
    );
    CREATE TABLE prices(pnu TEXT, 연도 TEXT, 공시지가 INT);
    CREATE TABLE sales(pk TEXT, 계약년월 TEXT, 금액 INT, 연면적 REAL, 대지 REAL, 단가_연면적 INT);
    CREATE TABLE dong_sales(법정동코드 TEXT PRIMARY KEY, 건수 INT, 거래금액_중앙 INT, 단가연면적_중앙 INT);
    """)
    # 자리표시자를 손으로 세지 않는다. 8월 8일에 높이 컬럼을 더하면서 '?'*39 를 그대로 둬서
    # 이 단계가 3주 넘게 죽어 있었고, 아무도 안 돌려서 안 드러났다(2026-08-31에 발견).
    # 값 개수에서 만들고, 테이블 컬럼 수와 어긋나면 그 자리에서 멈춘다.
    _BLD_COLS = len(cur.execute("SELECT * FROM buildings LIMIT 0").description)

    def BLD_INS(nvals):
        if nvals != _BLD_COLS:
            raise SystemExit(f"✗ buildings 값 {nvals}개 ≠ 테이블 컬럼 {_BLD_COLS}개 — "
                             "CREATE TABLE 과 brow.append 를 맞추세요")
        return "INSERT OR IGNORE INTO buildings VALUES(%s)" % ",".join("?" * nvals)

    t=time.time(); n=0
    brow=[]; prow=[]; srow=[]
    # 처리결과 문서 — 검증·조회용 사본이지만 여기서 줄이 새면 대조 자체가 못 미덥다.
    doc = Report("build_sqlite", src="_integrated.jsonl → 빌탐정.db")
    for line in open("data/tools/_integrated.jsonl"):
        doc.read()
        r=json.loads(line); n+=1
        pnu=r['PNU'] or ''
        brow.append((
            r['PK'], r['주소'], r['도로명주소'], r['대장구분'], pnu,
            pnu[:5] if pnu else None, pnu[:10] if pnu else None,
            r['대지면적'], r['건폐율'], r['용적률'], r['연면적'],
            r.get('건축면적'), r.get('용적률산정연면적'),
            r['주용도코드'], r['주용도'], r['기타용도'], r['구조'],
            # 엘리베이터참조(승강기공단)를 여기 안 실으면 export 가 조용히 빈칸을 내보낸다 —
            # 표에 칸이 없어 `"엘리베이터참조" in ci` 가 거짓이 되기 때문이다(2026-09-06 실측: 585,731동 전부 빈칸).
            r['지상층수'], r['지하층수'], r.get('높이'), r.get('엘리베이터'), r.get('엘리베이터참조'),
            r.get('주차'), r['사용승인일'], r.get('사용승인일_정밀도'),
            r.get('최근대수선일'), r.get('최근대수선일_정밀도'), r.get('대수선건수',0), r['대지건폐용적_출처'],
            r['지목'], r['토지면적'], r['토지이용상황'],
            r['용도지역'], json.dumps(r['용도지역_걸침'],ensure_ascii=False) if r['용도지역_걸침'] else None,
            r['개발제한비중'],
            r['지세'], r['지형형상'], r['도로접면'],
            r['역과의거리'],
            json.dumps(r['주변지하철'],ensure_ascii=False) if r['주변지하철'] else None,
            json.dumps(r['주변버스'],ensure_ascii=False) if r['주변버스'] else None,
            len(r['주변지하철']) if r['주변지하철'] else 0,
            len(r['주변버스']) if r['주변버스'] else 0,
            r.get('건폐율출처'), r.get('용적률출처'),
        ))
        if r['공시지가']:
            for y,v in r['공시지가'].items(): prow.append((pnu,y,v))
        if r['매각이력_추정']:
            for s in r['매각이력_추정']:
                srow.append((r['PK'],s['계약년월'],s['금액'],s['연면적'],s['대지'],s['단가_연면적']))
        if len(brow)>=20000:
            cur.executemany(BLD_INS(len(brow[0])),brow); brow=[]
            cur.executemany("INSERT INTO prices VALUES(?,?,?)",prow); prow=[]
            cur.executemany("INSERT INTO sales VALUES(?,?,?,?,?,?)",srow); srow=[]
    if brow:
        cur.executemany(BLD_INS(len(brow[0])),brow)
    cur.executemany("INSERT INTO prices VALUES(?,?,?)",prow)
    cur.executemany("INSERT INTO sales VALUES(?,?,?,?,?,?)",srow)
    if os.path.exists("data/tools/_sales_area.json"):   # 동시세 폐기(build_sales) → 있을 때만
        for code,a in json.load(open("data/tools/_sales_area.json")).items():
            cur.execute("INSERT INTO dong_sales VALUES(?,?,?,?)",(code,a['건수'],a['거래금액_중앙'],a['단가연면적_중앙']))
    doc.write(n)
    doc.finish(quiet=True)
    print(f"적재 {n:,}동 ({time.time()-t:.0f}s) → 인덱스…")
    cur.executescript("""
    CREATE INDEX ix_b_pnu ON buildings(pnu);
    CREATE INDEX ix_b_주소 ON buildings(주소);
    CREATE INDEX ix_b_법정동 ON buildings(법정동코드);
    CREATE INDEX ix_b_용도 ON buildings(주용도코드);
    CREATE INDEX ix_p ON prices(pnu,연도);
    CREATE INDEX ix_s ON sales(pk);
    """)
    con.commit()
    for tname in ['buildings','prices','sales','dong_sales']:
        print(f"  {tname}: {cur.execute('SELECT COUNT(*) FROM '+tname).fetchone()[0]:,}행")
    print(f"완료: {DB} ({os.path.getsize(DB)/1e9:.2f}GB, {time.time()-t:.0f}s)")

if __name__=='__main__': main()
