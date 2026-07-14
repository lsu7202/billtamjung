#!/usr/bin/env python3
"""강남 샘플 → SQLite (정규화). 스칼라=buildings, 시계열=자식 테이블, 부속지번=annex.
입력: data/exports/강남_전체.csv + _annex_11680.json.
출력: data/강남.db
"""
import csv, json, sqlite3, os

DB="data/강남.db"; SGG='11680'
def num(v):
    if v in (None,'',): return None
    try: return int(v)
    except:
        try: return float(v)
        except: return v

def main():
    if os.path.exists(DB): os.remove(DB)
    con=sqlite3.connect(DB); cur=con.cursor()
    cur.executescript("""
    PRAGMA journal_mode=OFF;
    CREATE TABLE buildings(
      pk TEXT PRIMARY KEY, pnu TEXT, 시군구 TEXT, 법정동 TEXT, 주소 TEXT, 도로명주소 TEXT, x REAL, y REAL,
      지목 TEXT, 토지면적 REAL, 토지이용상황 TEXT, 지형형상 TEXT, 도로접면 TEXT, 지세 TEXT,
      용도지역 TEXT, 법정건폐율 TEXT, 법정용적률 TEXT, 법정_적용방식 TEXT,
      고도지구 TEXT, 지구단위계획 TEXT, 정비구역 TEXT, 경관지구 TEXT, 방화지구 TEXT, 문화재보존 TEXT, 개발제한 REAL,
      대장구분 TEXT, 주용도 TEXT, 기타용도 TEXT, 구조 TEXT,
      연면적 REAL, 건축면적 REAL, 대지면적 REAL, 건폐율 REAL, 용적률 REAL, 용적여유분 REAL, 용적률산정연면적 REAL,
      지상층수 INT, 지하층수 INT, 엘리베이터 INT, 주차 INT, 사용승인일 TEXT, 최근대수선일 TEXT,
      공시지가_최신 INT, 상승률_5년 REAL, 상승률_10년 REAL,
      역과의거리 INT, 최근접역 TEXT, 지하철수 INT, 최근접버스 TEXT, 버스수 INT,
      매각횟수 INT, 최근매각_년월 TEXT, 최근매각_금액 INT, 최근매각_단가 INT
    );
    CREATE TABLE prices(pnu TEXT, 연도 TEXT, 공시지가 INT);
    CREATE TABLE sales(pk TEXT, 계약년월 TEXT, 금액 INT, 단가 INT);
    CREATE TABLE floors(pk TEXT, 순번 INT, 층 TEXT, 용도 TEXT, 면적 REAL);
    CREATE TABLE subway(pk TEXT, 역명 TEXT, 호선 TEXT, 거리 INT, 도보 INT);
    CREATE TABLE bus(pk TEXT, 정류장명 TEXT, 거리 INT, 도보 INT);
    CREATE TABLE annex(pk TEXT, pnu TEXT, 역할 TEXT);
    CREATE TABLE parcels(
      pnu TEXT PRIMARY KEY, 지목 TEXT, 토지면적 REAL, 토지이용상황 TEXT,
      지형형상 TEXT, 도로접면 TEXT, 지세 TEXT, 용도지역 TEXT, 개발제한비중 REAL,
      공시지가_최신 INT, 법정건폐율 TEXT, 법정용적률 TEXT, 공시지가_시계열 TEXT
    );
    """)
    binfo=cur.execute("SELECT name,type FROM pragma_table_info('buildings')").fetchall()
    BCOLS=[c[0] for c in binfo]; BTYPE={c[0]:c[1] for c in binfo}
    # CSV 헤더(대문자 PK/PNU) → 컬럼 매핑
    def cval(r,c):
        key={'pk':'PK','pnu':'PNU'}.get(c,c)
        v=r.get(key)
        if v in (None,''): return None
        if BTYPE[c]=='TEXT': return str(v)          # 식별자·코드·날짜는 문자열 유지
        return num(v)
    n=0
    for r in csv.DictReader(open("data/exports/강남_전체.csv",encoding='utf-8-sig')):
        pk=r['PK']; pnu=r['PNU']
        cur.execute(f"INSERT OR IGNORE INTO buildings({','.join(BCOLS)}) VALUES({','.join('?'*len(BCOLS))})",
                    [cval(r,c) for c in BCOLS])
        if r.get('공시지가_시계열'):
            for y,v in json.loads(r['공시지가_시계열']).items(): cur.execute("INSERT INTO prices VALUES(?,?,?)",(pnu,y,v))
        if r.get('매각이력_전체'):
            for s in json.loads(r['매각이력_전체']): cur.execute("INSERT INTO sales VALUES(?,?,?,?)",(pk,s['계약년월'],s['금액'],s.get('단가_연면적')))
        if r.get('층별개요_프리필'):
            for i,fl in enumerate(json.loads(r['층별개요_프리필'])): cur.execute("INSERT INTO floors VALUES(?,?,?,?,?)",(pk,i,fl['층'],fl['용도'],fl['면적']))
        if r.get('주변지하철_전체'):
            for s in json.loads(r['주변지하철_전체']): cur.execute("INSERT INTO subway VALUES(?,?,?,?,?)",(pk,s['역명'],s['호선'],s['거리'],s['도보']))
        if r.get('주변버스_전체'):
            for s in json.loads(r['주변버스_전체']): cur.execute("INSERT INTO bus VALUES(?,?,?,?)",(pk,s['정류장명'],s['거리'],s['도보']))
        n+=1
    # 필지(토지) 테이블 — 강남 전 필지(부속 필지 조회용). _land_master + _legal + _spatial
    legal=json.load(open(f"data/tools/_legal_{SGG}.json"))
    spatial=json.load(open("data/tools/_spatial_ALL.json"))
    def yongdo(pnu):
        z=spatial.get(pnu,{}).get('용도지역')
        if not z: return None
        return z[0]['명'] if len(z)==1 else " + ".join(f"{x['명']} {round(x['비중']*100)}%" for x in z)
    np=0
    for line in open("data/tools/_land_master.jsonl"):
        L=json.loads(line); pnu=L['PNU']
        if not pnu.startswith(SGG): continue
        gj=L.get('공시지가') or {}; lg=legal.get(pnu,{})
        cur.execute("INSERT OR IGNORE INTO parcels VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",(
            pnu, L.get('지목'), L.get('면적'), L.get('토지이용상황'),
            L.get('지형형상'), L.get('도로접면'), L.get('지세'), yongdo(pnu), L.get('개발제한비중'),
            gj.get('2026'), lg.get('법정건폐율'), lg.get('법정용적률'),
            json.dumps({y:gj[y] for y in gj},ensure_ascii=False) if gj else None)); np+=1
    # 부속지번 관계
    annex=json.load(open(f"data/tools/_annex_{SGG}.json"))
    na=0
    for pk,v in annex.items():
        cur.execute("INSERT INTO annex VALUES(?,?,?)",(pk,v['대표'],'대표')); na+=1
        for s in v['부속']: cur.execute("INSERT INTO annex VALUES(?,?,?)",(pk,s,'부속')); na+=1
    cur.executescript("""
    CREATE INDEX ix_b_pnu ON buildings(pnu); CREATE INDEX ix_b_주소 ON buildings(주소);
    CREATE INDEX ix_p ON prices(pnu); CREATE INDEX ix_s ON sales(pk);
    CREATE INDEX ix_f ON floors(pk); CREATE INDEX ix_a ON annex(pk);
    """)
    con.commit()
    print(f"강남.db 적재: 건물 {n:,} · 필지 {np:,}")
    for t in ['buildings','parcels','prices','sales','floors','subway','bus','annex']:
        print(f"  {t}: {cur.execute('SELECT COUNT(*) FROM '+t).fetchone()[0]:,}")
    print(f"  다필지 건물(annex): {len(annex):,}동")
    print(f"완료: {DB} ({os.path.getsize(DB)/1e6:.1f}MB)")

if __name__=='__main__': main()
