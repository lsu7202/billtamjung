"""활성화 레이어 — 크롤러 스테이징 산출물을 빌더가 읽는 정규 raw 경로로 물질화.

크롤 다음 단계. 스테이징(zip·json·xlsx·csv)을 훑어 종류별로 라우팅:
  · HUB zip           → 압축해제 → mart_djy_NN.txt(전국) → extract_seoul → data/raw/seoul/*_seoul.txt
                                   mart_kcy_01.txt(전국) → data/raw/mart_kcy_01.txt (그대로)
  · V-World MK zip     → 압축해제 → data/raw/<정규 LSMD dir>/  (paths.py가 *.shp glob)
  · V-World NA zip     → 토지특성(AL_D194 25구) → data/raw/토지특성/<stem>/ · 공시지가(AL_D150) → data/raw/<stem>/
  · 역사/버스 json      → data/raw/*.json
  · 임대동향 xlsx       → data/raw/*.xlsx
  · 승강기 csv          → data/raw/*.csv
멱등(덮어쓰기). raw 사용 원장 = specs/07-architecture/05-raw-사용-원장.

    data/.venv/bin/python scripts/activate.py --staging data/raw/_dl [--no-extract]
근거: specs/07-architecture/04-데이터-출처-크롤링-레지스트리 · 05-raw-사용-원장.
"""
import os
import re
import sys
import glob
import shutil
import zipfile
import argparse
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RAW = os.environ.get("BT_ACTIVATE_RAW") or os.path.join(ROOT, "data", "raw")   # 테스트 시 오버라이드
PY = os.path.join(ROOT, "data", ".venv", "bin", "python")
if not os.path.exists(PY):
    PY = sys.executable

# V-World LSMD 레이어코드 → 빌더가 기대하는 정규 디렉토리명(기존 raw와 일치)
LSMD_DIR = {
    "LDREG": "LSMD_CONT_LDREG_5174_서울", "UQ111": "LSMD_CONT_UQ111_5174_서울",
    "UD801": "LSMD_CONT_UD801_서울", "UQ121": "LSMD_CONT_UQ121_서울",
    "UQ123": "LSMD_CONT_UQ123_서울", "UQ124": "LSMD_CONT_UQ124_서울",
    "UD602": "LSMD_CONT_UD602_서울", "UD603": "LSMD_CONT_UD603_서울",
    "UO301": "LSMD_CONT_UO301_서울",
}
_log = []


def note(msg):
    _log.append(msg)
    print("  " + msg, flush=True)


def _unzip_to(zip_path, dest_dir):
    os.makedirs(dest_dir, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
        z.extractall(dest_dir)
    return names


def handle_hub(zip_path, djy_txts):
    """HUB zip → 내부 mart_*.txt를 raw 최상위로. djy는 extract_seoul 대상으로 수집."""
    tmp = os.path.join(RAW, "_unzip_tmp")
    names = _unzip_to(zip_path, tmp)
    for n in names:
        if not n.endswith(".txt"):
            continue
        base = os.path.basename(n)
        shutil.move(os.path.join(tmp, n), os.path.join(RAW, base))
        if re.match(r"mart_djy_0[2345]\.txt$", base):
            djy_txts.append(base)
        note(f"HUB {base} → data/raw/{base}")
    shutil.rmtree(tmp, ignore_errors=True)


def handle_vworld_mk(zip_path):
    """LSMD SHP zip → 내부 shp의 레이어코드로 정규 dir 결정 → 그 dir에 해제."""
    with zipfile.ZipFile(zip_path) as z:
        shp = next((n for n in z.namelist() if n.lower().endswith(".shp")), None)
    m = re.search(r"(LDREG|UQ\d{3}|UD\d{3}|UO\d{3})", os.path.basename(shp or zip_path))
    if not m:
        note(f"⚠️ V-World MK 레이어 판별 실패: {os.path.basename(zip_path)}")
        return
    code = m.group(1)
    dest = os.path.join(RAW, LSMD_DIR.get(code, f"LSMD_CONT_{code}_서울"))
    _unzip_to(zip_path, dest)
    note(f"V-World {code} → {os.path.relpath(dest, ROOT)}/")


def handle_vworld_na(zip_path):
    """AL_D194(토지특성 구별) → 토지특성/<stem>/ · AL_D150(공시지가) → <stem>/."""
    stem = re.sub(r"\.zip$", "", os.path.basename(zip_path))
    if "D194" in stem:
        dest = os.path.join(RAW, "토지특성", stem)
    else:                                   # D150 공시지가
        dest = os.path.join(RAW, stem)
    _unzip_to(zip_path, dest)
    note(f"V-World NA {stem} → {os.path.relpath(dest, ROOT)}/")


def handle_copy(path):
    """역사/버스 json · 임대동향 xlsx · 승강기 csv → raw 최상위로 복사."""
    dst = os.path.join(RAW, os.path.basename(path))
    shutil.copy2(path, dst)
    note(f"복사 {os.path.basename(path)} → data/raw/")


def classify_and_route(path, djy_txts):
    name = os.path.basename(path)
    low = name.lower()
    if low.endswith(".zip"):
        if "승강기" in name:                              # data.go.kr 승강기 = zip(내부 CSV 2개) → raw 최상위로
            with zipfile.ZipFile(path) as z:
                for n in z.namelist():
                    if n.lower().endswith(".csv"):
                        z.extract(n, RAW)
                        note(f"승강기 {os.path.basename(n)} → data/raw/")
        elif name.startswith("C_UQ"):                    # 지구단위계획 등 비LSMD → 이름 그대로 dir
            dest = os.path.join(RAW, re.sub(r"\.zip$", "", name))
            _unzip_to(path, dest)
            note(f"V-World {name} → {os.path.relpath(dest, ROOT)}/")
        elif name.startswith("LSMD_CONT_"):
            handle_vworld_mk(path)
        elif name.startswith("AL_"):
            handle_vworld_na(path)
        elif "건축" in name or "mart_" in low:          # 국토교통부_건축물대장/인허가 zip
            handle_hub(path, djy_txts)
        else:                                            # 판별불가 zip → HUB 시도(내부 mart 확인)
            handle_hub(path, djy_txts)
    elif low.endswith(".json") and ("역사마스터" in name or "버스정류소" in name or "지가변동률" in name):
        handle_copy(path)
    elif low.endswith(".xlsx") and "임대동향" in name:
        handle_copy(path)
    elif low.endswith(".csv") and "승강기" in name:
        handle_copy(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--staging", default="data/raw/_dl", help="크롤러 스테이징 루트(재귀 스캔)")
    ap.add_argument("--no-extract", action="store_true", help="extract_seoul(서울추출) 생략")
    a = ap.parse_args()
    os.chdir(ROOT)
    os.makedirs(RAW, exist_ok=True)
    staging = a.staging if os.path.isabs(a.staging) else os.path.join(ROOT, a.staging)
    if not os.path.isdir(staging):
        sys.exit(f"스테이징 없음: {staging}")

    files = [p for p in glob.glob(os.path.join(staging, "**", "*"), recursive=True) if os.path.isfile(p)]
    print(f"# 활성화: {len(files)}개 스테이징 파일 → data/raw 정규경로\n")
    djy_txts = []
    for p in sorted(files):
        classify_and_route(p, djy_txts)

    if djy_txts and not a.no_extract:
        print("\n[서울 추출] extract_seoul.py (mart_djy 전국 → seoul/*_seoul.txt)")
        subprocess.run([PY, "data/tools/extract_seoul.py"], check=True)

    print(f"\n완료: {len(_log)}건 물질화. (미사용 raw는 05-raw-사용-원장 참고)")


if __name__ == "__main__":
    main()
