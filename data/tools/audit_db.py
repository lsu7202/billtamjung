#!/usr/bin/env python3
"""빌탐정.db 품질 감사 — 규칙 위반·이상치·결측을 전수 집계.
각 규칙: (이름, 심각도, SQL) → 위반수 + 샘플 3건.
"""
import sqlite3, sys

DB="data/빌탐정.db"
con=sqlite3.connect(DB); cur=con.cursor()

RULES=[
 # ── 범위 위반 (원본 오류 or 파싱 오류) ──
 ("건폐율>100%","HIGH","SELECT pk,주소,건폐율 FROM buildings WHERE 건폐율>100"),
 ("용적률>2000%","HIGH","SELECT pk,주소,용적률 FROM buildings WHERE 용적률>2000"),
 ("연면적=0인데 지상층수>0","MED","SELECT pk,주소,지상층수 FROM buildings WHERE 연면적<=0 AND 지상층수>0"),
 ("지상층수=0인데 연면적>100","MED","SELECT pk,주소,연면적 FROM buildings WHERE 지상층수=0 AND 연면적>100"),
 ("지상층수>70","MED","SELECT pk,주소,지상층수 FROM buildings WHERE 지상층수>70"),
 ("사용승인일 미래","HIGH","SELECT pk,주소,사용승인일 FROM buildings WHERE 사용승인일>'20260713' AND length(사용승인일)=8"),
 ("사용승인일 1900 이전","LOW","SELECT pk,주소,사용승인일 FROM buildings WHERE 사용승인일<'19000101' AND length(사용승인일)=8 AND 사용승인일!=''"),
 # ── 교차 정합성 ──
 ("대지면적 vs 토지면적 5배 이상 괴리(단독필지형)","MED",
  "SELECT pk,주소,대지면적,토지면적 FROM buildings WHERE 대지건폐용적_출처='표제부' AND 토지면적>0 AND 대지면적>0 AND (대지면적/토지면적>5 OR 토지면적/대지면적>5)"),
 ("건폐율 재계산 괴리>20%p(표제부·단층 제외)","MED",
  "SELECT pk,주소,건폐율,round(100.0*연면적/지상층수/대지면적,1) FROM buildings WHERE 대지건폐용적_출처='표제부' AND 대지면적>0 AND 지상층수>=1 AND 건폐율>0 AND abs(건폐율-100.0*연면적/지상층수/대지면적)>50"),
 ("역과의거리>3000m (서울인데)","LOW","SELECT pk,주소,역과의거리 FROM buildings WHERE 역과의거리>3000"),
 ("개발제한비중>0인데 용도지역 상업","MED","SELECT pk,주소,용도지역,개발제한비중 FROM buildings WHERE 개발제한비중>0.5 AND 용도지역 LIKE '%상업%'"),
 # ── 매각 정합성 ──
 ("매각 단가 이상(연면적단가<10만 or >2억/㎡)","MED",
  "SELECT s.pk,b.주소,s.단가_연면적 FROM sales s JOIN buildings b ON b.pk=s.pk WHERE s.단가_연면적<100000 OR s.단가_연면적>200000000"),
 ("공시지가 연간 ±70% 급변","LOW",
  "SELECT a.pnu,a.연도,a.공시지가,b.공시지가 FROM prices a JOIN prices b ON a.pnu=b.pnu AND CAST(b.연도 AS INT)=CAST(a.연도 AS INT)+1 WHERE a.공시지가>100000 AND (b.공시지가>a.공시지가*1.7 OR b.공시지가<a.공시지가*0.3)"),
]

print("="*70)
print(" 빌탐정.db 품질 감사")
print("="*70)
total=cur.execute("SELECT COUNT(*) FROM buildings").fetchone()[0]
for name,sev,sql in RULES:
    rows=cur.execute(sql).fetchall()
    flag="⚠️" if rows else "✅"
    print(f"\n{flag} [{sev}] {name}: {len(rows):,}건" + (f" ({len(rows)/total*100:.2f}%)" if rows else ""))
    for r in rows[:3]:
        print(f"     {r}")

# ── 결측 지도 ──
print("\n"+"="*70)
print(" 필드 결측률 (전체 %d동)"%total)
print("="*70)
for col,cond in [
    ("PNU","pnu='' OR pnu IS NULL"),("토지연결(토지면적)","토지면적 IS NULL"),
    ("대지면적","대지면적<=0"),("용적률","용적률<=0"),("건폐율","건폐율<=0"),
    ("사용승인일","사용승인일='' OR 사용승인일 IS NULL"),("용도지역","용도지역 IS NULL"),
    ("역과의거리","역과의거리 IS NULL"),("도로명주소","도로명주소='' OR 도로명주소 IS NULL"),
]:
    c=cur.execute(f"SELECT COUNT(*) FROM buildings WHERE {cond}").fetchone()[0]
    print(f"  {col}: {c:,} ({c/total*100:.1f}%)")

# ── 구별 토지연결률 (지역 편중 확인) ──
print("\n 구별 토지 미연결률 상위 5:")
for r in cur.execute("""SELECT 시군구코드, COUNT(*) n, SUM(토지면적 IS NULL) miss,
    round(100.0*SUM(토지면적 IS NULL)/COUNT(*),1) pct FROM buildings
    WHERE 시군구코드 IS NOT NULL GROUP BY 1 ORDER BY pct DESC LIMIT 5"""):
    print(f"  {r[0]}: {r[2]:,}/{r[1]:,} ({r[3]}%)")

# ── 분포 스냅샷 ──
print("\n 분포 스냅샷:")
for label,sql in [
    ("용적률 중앙(용적률>0)","SELECT round(AVG(용적률),1) FROM (SELECT 용적률 FROM buildings WHERE 용적률>0 ORDER BY 용적률 LIMIT 1 OFFSET (SELECT COUNT(*)/2 FROM buildings WHERE 용적률>0))"),
    ("역과의거리 중앙","SELECT 역과의거리 FROM buildings WHERE 역과의거리 IS NOT NULL ORDER BY 역과의거리 LIMIT 1 OFFSET (SELECT COUNT(*)/2 FROM buildings WHERE 역과의거리 IS NOT NULL)"),
    ("A+ 이력 보유 동수","SELECT COUNT(DISTINCT pk) FROM sales"),
    ("매각 최고가","SELECT MAX(금액) FROM sales"),
]:
    print(f"  {label}: {cur.execute(sql).fetchone()[0]:,}")
