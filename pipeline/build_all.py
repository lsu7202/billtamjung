"""빌드 오케스트레이터 — raw(활성화 완료) → 중간산출 → 빌탐정.db → export CSV.

의존순서(topological, 중간파일 생산자→소비자 분석 기반):
  spatial_join → land_master → legal → regulations → daesuseon → building_master
  → annex → transit → sales → floor_outline → integrated → sqlite → export(seoul·parcels·series)
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
    # 구별 스크립트는 서울 전체 인자 필요(ALL 또는 시도코드 11) — export가 _spatial_ALL·_regulations_11·_legal_ALL·_annex_ALL·_transit_ALL 기대
    return [
        ("spatial_join",       [f"{T}/spatial_join.py", "ALL"]),
        ("land_master",        [f"{T}/build_land_master.py"]),
        ("legal",              [f"{T}/build_legal.py", "ALL"]),
        ("regulations",        [f"{T}/build_regulations.py", "11"]),
        ("daesuseon",          [f"{T}/build_daesuseon.py"]),
        ("building_master",    [f"{T}/build_building_master.py"]),
        ("annex",              [f"{T}/build_annex.py", "ALL"]),
        ("transit",            [f"{T}/build_transit.py", "ALL"]),
        ("sales",              [f"{T}/build_sales.py"]),
        ("floor_outline",      [f"{T}/build_floor_outline.py"]),
        ("road_width",         [f"{T}/build_road_width.py"]),   # 도로명주소 도로구간 → 폭원
        ("integrated",         [f"{T}/build_integrated.py"]),
        ("sqlite",             [f"{T}/build_sqlite.py"]),
        ("export_seoul",       [f"{P}/export_seoul.py", "--out", f"{exp}/buildings.csv"]),
        ("export_parcels",     [f"{P}/export_parcels.py", "--parcels", f"{exp}/parcels.csv",
                                "--annex", f"{exp}/building_parcels.csv"]),
        ("export_series",      [f"{P}/export_series.py", f"{exp}/gongsi_series.csv",
                                f"{exp}/sales_history.csv"]),
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
