"""활성화 레이어 — 크롤러 스테이징 산출물을 빌더가 읽는 정규 raw 경로로 물질화.

크롤 다음 단계. 스테이징(zip·json·xlsx·csv)을 훑어 종류별로 라우팅:
  · HUB zip           → [2026-09-01 이후 안 온다] 아래 「건축HUB」 참고
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


def _rename_stem(d, prefix, stem):
    """폴더 안 SHP 한 벌의 이름을 `stem.*` 로 통일한다.

    배포본 이름은 판마다 바뀌고(TL_SPRD_MANAGE_11_202608) 한글은 CP949 로 깨져 나오는데,
    빌더·로더는 고정 이름을 박고 있다. 여기서 맞춰 주지 않으면 「받았는데 못 읽는다」가 된다.
    prefix 가 있으면 그걸로 시작하는 것만, 없으면 폴더 안 전부를 바꾼다."""
    for f in os.listdir(d):
        base, ext = os.path.splitext(f)
        if not ext or (prefix and not base.startswith(prefix)):
            continue
        src, dst = os.path.join(d, f), os.path.join(d, stem + ext)
        if src != dst:
            os.replace(src, dst)


def _unzip_to(zip_path, dest_dir):
    os.makedirs(dest_dir, exist_ok=True)
    with zipfile.ZipFile(zip_path) as z:
        names = z.namelist()
        z.extractall(dest_dir)
    return names


def handle_hub(zip_path, djy_txts):
    """[남겨 둔 길] HUB 전국본 zip → 내부 mart_*.txt 를 raw 최상위로.

    ## 건축HUB 는 이제 스테이징을 안 거친다 (2026-09-01)

    scripts/hub/download_seoul.py 가 **서울본을 곧바로** data/raw/hub_seoul/ 에 쌓는다
    (55장 × 25구, 이어받기 전제). zip 도 전국본도 오지 않으므로 이 함수는 안 불린다.

    전국본을 다시 받는 날을 위해 길만 남긴다.
    """
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
        # 아래 둘은 **파일 이름까지 맞춰 준다.** 배포본 이름에 판번호·인코딩이 섞여 있어
        # 빌더·로더가 박아 둔 이름과 다르다. 지금까지는 손으로 바꿔 쓰고 있었고,
        # 그래서 재현이 안 됐다(2026-08-30).
        elif "도로구간" in name:      # TL_SPRD_MANAGE_11_202608.* → TL_SPRD_MANAGE.Seoul.*
            dest = os.path.join(RAW, "(도로명주소)도로구간_서울")
            _unzip_to(path, dest)
            _rename_stem(dest, "TL_SPRD_MANAGE", "TL_SPRD_MANAGE.Seoul")
            note(f"도로구간 {name} → {os.path.relpath(dest, ROOT)}/")
        elif "상가(상권)정보" in name or "상가_상권_정보" in name:   # data.go.kr 15083033 = 전국 zip, 시도별 CSV
            # 서울 것만 꺼내 data/raw/_sbiz/ 에 둔다. 옛 판은 치운다 — load_sbiz 가 폴더의 *.csv 를 전부 읽는다
            dest = os.path.join(RAW, "_sbiz")
            os.makedirs(dest, exist_ok=True)
            with zipfile.ZipFile(path) as z:
                seoul = [n for n in z.namelist() if n.lower().endswith(".csv") and "서울" in n]
                if not seoul:                            # 이름이 CP949 로 깨졌을 수 있다
                    seoul = [n for n in z.namelist() if n.lower().endswith(".csv")
                             and "서울" in n.encode("cp437", "ignore").decode("cp949", "ignore")]
                if seoul:
                    for old_f in glob.glob(os.path.join(dest, "*.csv")):
                        os.remove(old_f)
                    for n in seoul:
                        fixed = n.encode("cp437", "ignore").decode("cp949", "ignore") if "서울" not in n else n
                        with z.open(n) as src, open(os.path.join(dest, os.path.basename(fixed)), "wb") as out:
                            shutil.copyfileobj(src, out)
                        note(f"상가정보 {os.path.basename(fixed)} → data/raw/_sbiz/")
                else:
                    note(f"상가정보 {name}: zip 안에 서울 CSV 가 없다 — {z.namelist()[:3]}")
        elif "상권분석서비스" in name:   # zip 안 이름이 CP949 로 깨져 나온다 → sanggwon.*
            dest = os.path.join(RAW, "서울시 상권분석서비스(영역-상권)")
            _unzip_to(path, dest)
            _rename_stem(dest, None, "sanggwon")
            note(f"상권분석 {name} → {os.path.relpath(dest, ROOT)}/")
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
    # 전국본을 받던 시절의 길. 서울본은 뽑을 것이 없어 실제로는 안 탄다.
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
