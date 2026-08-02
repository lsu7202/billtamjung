"""원천 데이터 크롤링 오케스트레이터 — 확정된 소스 자동 다운로드.

소스별 크롤러를 주기(cadence) 그룹으로 실행. 출처↔raw 파일명 일치·다운로드 검증 완료분만 포함.
V-World는 로그인 세션이 필요 → scripts/vworld/cookie.txt (브라우저 쿠키, .gitignore).
    data/.venv/bin/python scripts/crawl_all.py --group all --out data/raw/_dl
    data/.venv/bin/python scripts/crawl_all.py --group monthly           # 실거래만
근거: specs/07-architecture/03-데이터-갱신주기 · 04-데이터-출처-크롤링-레지스트리.

상태(2026-08-02):
  ✅ 자동화 완료: 실거래(RTMS)·V-World LSMD 9종(규제·용도·개발제한·지적)·V-World 토지특성/공시지가·승강기
  ✅ 로더: 상권(load_sanggwon.py)
  ⏳ cURL 필요(ajax/csrf): 임대동향(R-ONE)·교통(서울열린데이터)·건축HUB 대장·지가변동률
"""
import os
import sys
import argparse
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = os.path.join(ROOT, "data", ".venv", "bin", "python")
VW_COOKIE = os.path.join(ROOT, "scripts", "vworld", "cookie.txt")

# 주기 그룹 → (라벨, 실행함수키, 세부)
GROUPS = {
    "monthly":    ["실거래(RTMS)"],
    "quarterly":  ["건축HUB 대장·대수선(⏳cURL)", "승강기(data.go.kr)"],
    "semiannual": ["V-World LSMD 9종(규제·용도·개발제한·지적)", "교통(⏳cURL)"],
    "annual":     ["V-World 공시지가·토지특성(NA)"],
}


def run(cmd, env=None):
    print("  $", " ".join(cmd))
    return subprocess.run(cmd, env={**os.environ, **(env or {})}).returncode


def vworld(out, na=False):
    if not os.path.exists(VW_COOKIE):
        print(f"  ⏭  V-World 건너뜀 — 쿠키 없음({VW_COOKIE}). 브라우저 로그인 세션 저장 필요.")
        return
    args = [PY, "scripts/vworld/download_vworld.py", "--out", out] + (["--na"] if na else [])
    run(args, env={"VW_COOKIE_FILE": VW_COOKIE})


def datagokr(out, only="15112638"):   # 검증분: 승강기. (임대동향·상권구획도는 재검토)
    run([PY, "scripts/datagokr/download_datagokr.py", "--out", out, "--only", only])


def rtms():
    run(["bash", "data/tools/download_rtms.sh"])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--group", default="all", choices=["all", "monthly", "quarterly", "semiannual", "annual"])
    ap.add_argument("--out", default="data/raw/_dl")
    a = ap.parse_args()
    os.chdir(ROOT)
    os.makedirs(a.out, exist_ok=True)
    g = a.group
    print(f"# 크롤링 오케스트레이터 (group={g}) → {a.out}\n")

    if g in ("all", "monthly"):
        print("[월간] 실거래(RTMS)"); rtms()
    if g in ("all", "quarterly"):
        print("[분기] 승강기(data.go.kr)"); datagokr(a.out, "15112638")
        print("  ⏳ 건축HUB 대장·대수선 = cURL 확보 후 추가")
    if g in ("all", "semiannual"):
        print("[반기] V-World LSMD 9종"); vworld(a.out, na=False)
        print("  ⏳ 교통(서울열린데이터) = 올바른 infId·다운URL 확보 후 추가")
    if g in ("all", "annual"):
        print("[연1] V-World 공시지가·토지특성(NA)"); vworld(a.out, na=True)
    print("\n※ 다운로드는 스테이징(--out). raw 활성화(unzip+빌더 하드코딩 경로 갱신)는 별도 마이그레이션.")
    print("※ ⏳ 소스(임대동향 R-ONE·교통·건축HUB·지가변동률)는 브라우저 다운로드 cURL 확보 후 크롤러 추가 예정.")


if __name__ == "__main__":
    main()
