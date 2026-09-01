"""빌드 오케스트레이터 — raw(활성화 완료) → 중간산출 → 빌탐정.db → export CSV.

의존순서(topological, 중간파일 생산자→소비자 분석 기반):
  spatial_join → land_master → daesuseon → building_master
  → annex → transit → sales → floor_outline → road_width → complex → expos
  → integrated → sqlite → export(seoul·parcels·series·complex·unit)
각 단계 실패 시 즉시 중단(입력 누락이면 여기서 드러남). --from 으로 중간 재개.

    data/.venv/bin/python pipeline/build_all.py [--from build_sales] [--export-dir DIR]
전제: scripts/activate.py 로 raw 정규경로가 채워져 있어야 함.
근거: specs/07-architecture/05-raw-사용-원장 (입력 정합).
"""
import os
import sys
import time
import argparse
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.path.join(ROOT, "data", ".venv", "bin", "python")
if not os.path.exists(PY):
    PY = sys.executable
T = os.path.join("data", "tools")
P = "pipeline"

# (라벨, argv) — export는 --export-dir 로 치환됨(빈 문자열 자리표시)
def stages(exp):
    # 구별 스크립트는 서울 전체 인자 필요(ALL) — export 가 _spatial_ALL·_annex_ALL·_transit_ALL 기대
    return [
        ("spatial_join",       [f"{T}/spatial_join.py", "ALL"]),
        ("land_master",        [f"{T}/build_land_master.py"]),
        # 토지이용계획 원장 → parcel_luris.csv.gz. **용도지역·법정건폐/용적·규제의 정본**이다.
        # 2026-09-01 까지 이 변환 코드가 없어서, 원장을 새로 받아도 갈아 끼울 방법이 없었다.
        # 적재 뒤 scripts/load_parcel_luris.py 가 이 파일을 읽어 parcels 에 되붙인다.
        ("luris",              [f"{T}/build_luris.py"]),
        # legal · regulations 단계는 뺐다(2026-09-01). 용도지역·법정건폐/용적·규제는
        # 국토부 토지이용계획정보 원장(AL_D155)이 정본이고, scripts/load_parcel_luris.py 가
        # 적재 뒤에 붙인다. 공간조인으로 계산하던 옛 방식은 원장에 없는 필지 1,479개에
        # 지어낸 값을 남기고 있었다(예: 지목이 하천·도로인 필지에 60%/800%).
        # 스크립트는 지우지 않았다 — 산식 근거가 남아 있어야 원장을 검증할 수 있다.
        ("daesuseon",          [f"{T}/build_daesuseon.py"]),
        ("building_master",    [f"{T}/build_building_master.py"]),
        ("annex",              [f"{T}/build_annex.py", "ALL"]),
        ("transit",            [f"{T}/build_transit.py", "ALL"]),
        ("sales",              [f"{T}/build_sales.py"]),
        ("floor_outline",      [f"{T}/build_floor_outline.py"]),
        ("road_width",         [f"{T}/build_road_width.py"]),   # 도로명주소 도로구간 → 폭원
        ("complex",            [f"{T}/build_complex.py"]),   # 총괄표제부(단지) — 0145
        # 전유부 = 호실. 층(floor_outline)보다 한 단계 아래 — 0146.
        # 전유부(신원)와 전유공용면적(면적) 두 마트를 합쳐 호실당 1행을 만든다.
        ("expos",              [f"{T}/build_expos.py"]),
        ("energy",             [f"{T}/build_energy.py"]),   # 건물에너지 전기·가스 — 0147
        ("zone",               [f"{T}/build_zone.py"]),     # 건물별 지역·지구·구역 — 0148
        ("closed",             [f"{T}/build_closed.py"]),   # 폐쇄말소대장(사라진 건물) — 0149
        ("basic",              [f"{T}/build_basic.py"]),    # 대장 기본개요(세 층을 잇는 뼈대) — 0150
        ("septic",             [f"{T}/build_septic.py"]),   # 오수정화 — 0150
        ("aptprice",           [f"{T}/build_aptprice.py"]), # 공동주택가격 2008~2026 — 0150·0151
        ("integrated",         [f"{T}/build_integrated.py"]),
        ("sqlite",             [f"{T}/build_sqlite.py"]),
        ("export_seoul",       [f"{P}/export_seoul.py", "--out", f"{exp}/buildings.csv"]),
        ("export_parcels",     [f"{P}/export_parcels.py", "--parcels", f"{exp}/parcels.csv",
                                "--annex", f"{exp}/building_parcels.csv"]),
        ("export_series",      [f"{P}/export_series.py", f"{exp}/gongsi_series.csv",
                                f"{exp}/sales_history.csv"]),
        ("export_complex",     [f"{P}/export_complex.py", "--out", f"{exp}/complex.csv"]),
        ("export_expos",       [f"{P}/export_expos.py", "--out", f"{exp}/unit.csv"]),
        ("export_energy",      [f"{P}/export_energy.py", "--out", f"{exp}/energy.csv"]),
        ("export_zone",        [f"{P}/export_zone.py", "--out", f"{exp}/zone.csv"]),
        ("export_closed",      [f"{P}/export_closed.py", "--out", f"{exp}/closed.csv"]),
        ("export_ledger_rest", [f"{P}/export_ledger_rest.py", "--out-dir", exp]),
    ]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", help="이 단계부터 재개(라벨)")
    ap.add_argument("--export-dir", default="data/exports/_load")
    a = ap.parse_args()
    os.chdir(ROOT)
    os.makedirs(a.export_dir, exist_ok=True)
    plan = stages(a.export_dir)
    labels = [s[0] for s in plan]
    if a.start:
        if a.start not in labels:
            sys.exit(f"--from 라벨 '{a.start}' 없음. 가능: {', '.join(labels)}")
        plan = plan[labels.index(a.start):]

    print(f"# build_all: {len(plan)}단계 (export→{a.export_dir})\n")
    t_all = time.time()
    for i, (label, argv) in enumerate(plan, 1):
        print(f"[{i}/{len(plan)}] {label}", flush=True)
        t0 = time.time()
        rc = subprocess.run([PY] + argv).returncode
        if rc != 0:
            sys.exit(f"\n✗ '{label}' 실패(rc={rc}). 입력 누락/오류 확인 후 --from {label} 로 재개.")
        print(f"    ✓ {time.time()-t0:.0f}s\n", flush=True)
    print(f"완료: 전체 {time.time()-t_all:.0f}s. export → {a.export_dir}")


if __name__ == "__main__":
    main()
