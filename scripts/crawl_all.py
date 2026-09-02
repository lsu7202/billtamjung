"""원천 데이터 크롤링 오케스트레이터 — 확정된 소스 자동 다운로드.

소스별 크롤러를 주기(cadence) 그룹으로 실행. 출처↔raw 파일명 일치·다운로드 검증 완료분만 포함.
V-World는 로그인 세션이 필요 → scripts/vworld/cookie.txt (브라우저 쿠키, .gitignore).
    data/.venv/bin/python scripts/crawl_all.py --group all --out data/raw/_dl
    data/.venv/bin/python scripts/crawl_all.py --group monthly           # 실거래만
근거: specs/07-architecture/03-데이터-갱신주기 · 04-데이터-출처-크롤링-레지스트리.

상태(2026-09-01 갱신):
  ✅ 원천 다운로드는 **전부 자동**이다:
       실거래(RTMS) · 생활인구 · 승강기 · 건축HUB 서울본 · 임대동향(R-ONE) · 지가변동률(R-ONE)
       · V-World LSMD 9종 · 지구단위계획 · 도로구간 · 교통 · 상권 · 공시지가/토지특성/토지이용계획정보
  ✅ 로더: 상권(load_sanggwon.py) · 생활인구(load_living_pop.py)
  ⚠️ 원천은 받는데 **쓰는 코드가 없는 것**: 토지이용계획정보(AL_D155) 원장 → parcel_luris.csv.gz
       변환 스크립트가 없다. 지금 쓰는 gz 는 2026-08-30 에 손으로 만든 것이고,
       원장을 새로 받아도 갈아 끼울 방법이 코드에 없다.

  (옛 주석은 「지가변동률 미자동화」라고 적혀 있었는데 그 뒤 download_jiga.py 가 생겼다.
   주석만 안 고쳐서 두 번 헷갈렸다 — 2026-09-01.)
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
    "monthly":    ["실거래(RTMS)", "생활인구 250m(서울열린데이터)"],
    "quarterly":  ["건축HUB 대장·대수선(⏳cURL)", "승강기(data.go.kr)"],
    "semiannual": ["V-World LSMD 9종(규제·용도·개발제한·지적)", "도로명주소 도로구간", "교통", "상권분석서비스"],
    "annual":     ["V-World 공시지가·토지특성(NA)"],
}


def run(cmd, env=None):
    print("  $", " ".join(cmd))
    return subprocess.run(cmd, env={**os.environ, **(env or {})}).returncode


def vworld(out, flag=None):     # flag: None(LSMD 9종) | "--na"(공시·토지) | "--misc" | "--sido"(도로구간)
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


def hub(out):
    """건축HUB **서울본** — 유형별 건축데이터(idx-*.do) 55장 × 25구.

    2026-08-31 전국본(download_hub.py)에서 갈아탔다. 전국 마트 zip 은 12.6GB 를 받아
    서울 5% 만 남기고 버렸고, 받지도 못한 마트가 50장이었다(전유부·지역지구구역·
    폐쇄말소대장·도로대장…). 서울본은 시군구 단위로 끊어 받아 필요한 것만 가져온다.

    **out 을 안 쓴다** — 서울본은 data/raw/hub_seoul/ 에 마트별로 쌓는다(이어받기 전제).
    스테이징을 거치지 않는 이유는, 55장 × 25구를 통째로 다시 받는 일이 없기 때문이다.
    """
    run([PY, "scripts/hub/download_seoul.py"])


def trade_area(out):  # 서울열린데이터 상권분석서비스(영역-상권) — 전통시장 판정용 1,650칸
    run([PY, "scripts/seoul_open/download_trade_area.py", "--out", out])


def transit(out):    # 서울열린데이터 역사마스터·버스정류소
    run([PY, "scripts/seoul_open/download_transit.py", "--out", out])


def rone(out):       # R-ONE 상업용 임대동향조사(최신 분기 xlsx)
    run([PY, "scripts/rone/download_rone.py", "--out", out])


def jiga(out):       # R-ONE 지역별 지가변동률(연) → build_land_adjust 입력
    run([PY, "scripts/rone/download_jiga.py", "--out", out])


def living_pop(days=7):
    """받고 → 격자로 접고 → 건물에 붙인다. 셋이 한 벌이라 따로 돌 일이 없다.
    받기만 하고 멈추면 master.living_pop 은 지난달 값 그대로라 화면이 조용히 낡는다."""
    run([PY, "scripts/seoul_open/download_living_pop.py", "--days", str(days)])
    run([PY, "scripts/seoul_open/load_living_pop.py"])
    run([PY, "scripts/seoul_open/match_building_pop.py"])


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
        # 생활인구는 매일 갱신이지만 우리는 한 주치 평균만 쓴다 — 월 1회로 충분하다.
        # 유동인구(float_pop)를 도로접면+역거리 proxy 에서 실측으로 바꾼 재료다(0129).
        print("[월간] 생활인구 250m(서울열린데이터)"); living_pop()
    if g in ("all", "quarterly"):
        print("[분기] 승강기(data.go.kr)"); datagokr(a.out, "15112638")
        print("[분기] 건축HUB 대장·인허가"); hub(a.out)
        print("[분기] 임대동향(R-ONE)"); rone(a.out)
    if g in ("all", "semiannual"):
        print("[반기] V-World LSMD 9종"); vworld(a.out)
        print("[반기] V-World 지구단위계획(C_UQ161)"); vworld(a.out, "--misc")
        print("[반기] V-World 도로명주소 도로구간(30055)"); vworld(a.out, "--sido")
        print("[반기] 교통(서울열린데이터)"); transit(a.out)
        print("[반기] 서울시 상권분석서비스(영역-상권)"); trade_area(a.out)
    if g in ("all", "annual"):
        print("[연1] V-World 공시지가·토지특성(NA)"); vworld(a.out, "--na")
        print("[연1] 지가변동률(R-ONE)"); jiga(a.out)
    print("\n※ 다운로드는 스테이징(--out). raw 활성화(unzip+빌더 하드코딩 경로 갱신)는 별도 마이그레이션.")
    print("※ 토지이용계획정보(AL_D155) → parcel_luris.csv.gz 는 build_all.py 의 luris 단계가 만든다.")


if __name__ == "__main__":
    main()
