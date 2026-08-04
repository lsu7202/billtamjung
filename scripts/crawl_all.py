"""원천 데이터 크롤링 오케스트레이터 — 확정된 소스 자동 다운로드.

소스별 크롤러를 주기(cadence) 그룹으로 실행. 출처↔raw 파일명 일치·다운로드 검증 완료분만 포함.
V-World는 로그인 세션이 필요 → scripts/vworld/cookie.txt (브라우저 쿠키, .gitignore).
    data/.venv/bin/python scripts/crawl_all.py --group all --out data/raw/_dl
    data/.venv/bin/python scripts/crawl_all.py --group monthly           # 실거래만
근거: specs/07-architecture/03-데이터-갱신주기 · 04-데이터-출처-크롤링-레지스트리.

상태(2026-08-02):
  ✅ 자동화 완료: 실거래(RTMS)·V-World LSMD 9종(규제·용도·개발제한·지적)·V-World 토지특성/공시지가·승강기
                 · 임대동향(R-ONE)·교통(서울열린데이터)·건축HUB 대장/인허가
  ✅ 로더: 상권(load_sanggwon.py)
  ⏳ 남음: 지가변동률(R-ONE 통계 client-export·fragile / 지가는 gongsi_series에 이미 반영)
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


def vworld(out, flag=None):     # flag: None(LSMD 9종) | "--na"(공시·토지) | "--misc"(지구단위계획 등)
    has_creds = os.environ.get("VW_ID") or os.environ.get("VWORLD_ID")
    if not os.path.exists(VW_COOKIE) and not has_creds:
        print(f"  ⏭  V-World 건너뜀 — 쿠키·자격증명 없음. VW_ID/VW_PW(자동로그인) 또는 {VW_COOKIE} 필요.")
        return
    args = [PY, "scripts/vworld/download_vworld.py", "--out", out] + ([flag] if flag else [])
    env = {"VW_COOKIE_FILE": VW_COOKIE} if os.path.exists(VW_COOKIE) else {}
    run(args, env=env)   # 쿠키 없으면 download_vworld가 VW_ID/VW_PW로 자동로그인


def datagokr(out, only="15112638"):   # 검증분: 승강기. (임대동향·상권구획도는 재검토)
    run([PY, "scripts/datagokr/download_datagokr.py", "--out", out, "--only", only])


def rtms():
    run(["bash", "data/tools/download_rtms.sh"])


def hub(out):        # 건축HUB 대장(djy)·인허가(kcy) — 레지스트리 대상 기본값
    run([PY, "scripts/hub/download_hub.py", "--out", out])


def transit(out):    # 서울열린데이터 역사마스터·버스정류소
    run([PY, "scripts/seoul_open/download_transit.py", "--out", out])


def rone(out):       # R-ONE 상업용 임대동향조사(최신 분기 xlsx)
    run([PY, "scripts/rone/download_rone.py", "--out", out])


def jiga(out):       # R-ONE 지역별 지가변동률(연) → build_land_adjust 입력
    run([PY, "scripts/rone/download_jiga.py", "--out", out])


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
        print("[분기] 건축HUB 대장·인허가"); hub(a.out)
        print("[분기] 임대동향(R-ONE)"); rone(a.out)
    if g in ("all", "semiannual"):
        print("[반기] V-World LSMD 9종"); vworld(a.out)
        print("[반기] V-World 지구단위계획(C_UQ161)"); vworld(a.out, "--misc")
        print("[반기] 교통(서울열린데이터)"); transit(a.out)
    if g in ("all", "annual"):
        print("[연1] V-World 공시지가·토지특성(NA)"); vworld(a.out, "--na")
        print("[연1] 지가변동률(R-ONE)"); jiga(a.out)
    print("\n※ 다운로드는 스테이징(--out). raw 활성화(unzip+빌더 하드코딩 경로 갱신)는 별도 마이그레이션.")
    print("※ 지가변동률(R-ONE 통계)은 client-export·fragile → 미자동화(지가는 gongsi_series에 이미 반영).")


if __name__ == "__main__":
    main()
