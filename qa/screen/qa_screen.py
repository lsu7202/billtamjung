#!/usr/bin/env python3
"""화면 점검 — DB 가 아니라 **화면에 뜬 글자**를 본다 (2026-09-02 신설).

## 왜 따로 있나

`backend/tests/qa_data.py` 는 DB 안까지만 본다. 데이터가 맞아도 **읽는 코드가 틀리면**
안 걸린다. 2026-09-02 에 그게 드러났다 — `legal_bcr = [50,60]` 은 완벽히 맞는
데이터였고 버그는 전부 읽는 쪽에 있었는데, qa_data 는 그 내내 26개 다 통과였다.

    _pct · LandScene.pct     grep 으로 찾음        적재 전
    _parse_far · _legal_far  파생을 세다가 찾음     배치 전
    ParcelBlock "50, 60%%"   화면을 눈으로 열다가   적재 후
    max() 텍스트 비교         물어봐서 찾아봄        검증 통과 뒤

파이프라인이 잡은 것은 0개다.

## 두 겹으로 본다

문자 찾기만으로는 절반만 잡힌다. `max()` 가 245 대신 50 을 고른 것은 화면 어디도
망가져 보이지 않는다 — 50% 는 법정용적률로 아주 그럴듯한 값이다. 그래서 두 겹이다.

    ① 흔적 찾기   여러 화면에서 '%%' · 'NaN' · 'undefined' 같은 자국을 찾는다
                 → 시끄러운 고장을 넓게 잡는다
    ② 정답 박기   표본마다 **반드시 떠야 할 글자**를 박아 둔다
                 → 조용히 틀린 값을 잡는다. 표본은 좁지만 확실하다

②의 기대값은 2026-09-02 에 토지이음과 직접 대조해 확정한 것들이다
(`scripts/verify_eum_formula.py` 로 14필지 전수 일치).

## 언제 돌리나

매 파이프라인마다가 아니다. **칸의 모양이나 값 형태를 바꿀 때** 돌린다 — 오늘 버그를
터뜨린 계기가 정확히 그것이었다. 화면 코드를 고쳤을 때도 돌린다.

로컬 프론트(5173)와 API(8000)가 떠 있어야 한다. 로그인은 스스로 한다 — 기본은
로컬 QA 계정(demo9)이고, 다른 환경이면 `scripts/.qa_screen.env`(gitignore)로 덮는다:

    QA_EMAIL=...
    QA_PASSWORD=...

    backend/.venv/bin/python scripts/qa_screen.py [--base http://localhost:5173]
"""
import argparse
import asyncio
import os
import re
import sys

# ── ① 화면에 있으면 안 되는 자국 ────────────────────────────────
# 값 하나가 아니라 **모양**을 본다. 값은 바뀌어도 이 자국은 늘 고장이다.
BROKEN = [
    (r"%%",                     "퍼센트가 둘 — 값에 이미 %가 있는데 또 붙였다"),
    (r"\bNaN\b",                "NaN — 숫자가 아닌 것을 Number() 했다"),
    (r"\bundefined\b",          "undefined 가 그대로 그려졌다"),
    (r"\[object Object\]",      "객체를 문자열로 만들었다"),
    (r"\bnull\b",               "null 이 그대로 그려졌다"),
    # '50,60' 처럼 %없이 붙은 숫자쌍을 여기서 잡으려다 **오탐만 났다** — 연면적 '1,956',
    # 넓이 '237,582평' 이 다 걸린다. 천 단위 쉼표와 배열 출력은 글자로 구분이 안 된다.
    # 그건 아래 LINE_SHAPE 로 **그 줄만 떼어** 본다.
]

# ── ①-b 줄 모양 검사 — 값이 아니라 **생김새**를 본다 ─────────────
# 화면 전체를 훑으면 오탐이 나므로, 라벨 바로 뒤 몇 줄만 떼어 모양을 견준다.
# 이 하나로 '50, 60%%' · 'NaN' · '50,60'(배열 그대로) 이 다 걸린다.
_PCT_LIST = r"\d{1,4}%(?:, \d{1,4}%)*"
_DASH = r"—"
LINE_SHAPE = [
    ("법정 건폐 · 용적", rf"(?:{_PCT_LIST}|{_DASH}) · (?:{_PCT_LIST}|{_DASH})",
     "「55% · 508%」 또는 「50%, 60% · 100%, 150%」 또는 「— · —」 모양이어야 한다"),
]


def check_shape(text: str):
    """라벨 다음에 오는 값 줄의 모양을 본다. → [(라벨, 실제, 왜)]

    화면마다 배치가 다르다. 건물 상세는 세 줄로 끊고(`55%` / `·` / `508%`),
    나대지는 한 줄에 붙인다(`60% · 200%`). 둘 다 받는다.
    """
    out = []
    for label, pat, why in LINE_SHAPE:
        i = text.find(label)
        if i < 0:
            continue                       # 그 줄이 없는 화면이면 안 본다
        lines = text[i + len(label):].lstrip("\n").split("\n")
        cand = [lines[0].strip(), " ".join(x.strip() for x in lines[:3])]
        if not any(re.fullmatch(pat, c) for c in cand):
            out.append((label, cand[1][:60], why))
    return out

# ── ② 기능별 표본 ────────────────────────────────────────────
# (경로, 이름, 그려질 때까지 기다릴 글자, [반드시 있어야 할 조각], 왜 이 표본인가)
#
# 기대값은 **화면에서 베끼지 않았다.** 베끼면 지금 틀린 값도 정답으로 굳는다.
# 대장(master.buildings)·원장에서 확인한 값이다. 확인 근거는 각 줄에 적었다.
#
# ## 묶음 이름 앞의 표시 — 성격이 둘이다
#
#   [정합]  DB 에 있는 값을 화면이 **맞게 읽는가.** 이 도구의 본래 목적이다.
#           qa_data 는 DB 안까지만 보므로 여기가 아니면 아무도 안 본다.
#   [동작]  값 대조가 아니라 **죽지 않는가.** 대조할 DB 값이 없는 화면이다.
#
# 섞여 있는 것 자체는 괜찮지만 **구분을 안 적으면 다음에 아무 검사나 붙는다.**
# 새 표본을 넣을 때 어느 쪽인지 먼저 정하고, [정합] 이 아니면 왜 필요한지 적는다.
GROUPS: list[tuple[str, list]] = [

  ("[정합] 대장 값 — 화면 숫자가 대장과 같은가", [
    # 대장: land_area 926.4㎡ · total_area 6464.85 · build_area 509.62
    #       지상 8 · 지하 4 · bcr 55.01 · far 321.2 · 승인 1993-12-22 · 대수선 2022-11-30
    #       (㎡ ÷ 3.305785 = 평)
    ("/buildings/1024123619", "삼성동 78 · 면적·층수·승인일", "건물정보",
     ["280.2평", "1955.6평", "154.2평", "55.01%", "321.2%", "1993/12/22", "2022/11/30"],   # 건폐율·용적률은 09-05 부터 두 줄
     "㎡→평 환산과 대장 값이 화면에 그대로 나와야 한다"),
  ]),

  ("[정합] 법정 건폐·용적 — 걸친 필지", [
    ("/buildings/1024123619", "값 하나 · 55%/508%", "법정 건폐",
     ["55%", "508%", "증축"],
     "토지이음 화면과 같은 값. 잔여(증축 여지)까지 이어져야 한다"),

    ("/buildings/1024114645", "값 둘 · 병기", "법정 건폐",
     ["50%, 60%", "100%, 150%"],
     "하나만 고르거나 '50, 60%%' 로 뭉개지면 안 된다"),

    ("/buildings/101815037", "여러 필지 · 400 vs 2635", "법정 건폐",
     ["2635%"],
     "텍스트로 비교하면 '400%'>'2635%' 라 400 이 뜬다"),

    ("/buildings/1024118652", "건폐 110% · 조례 최대치 초과", "법정 건폐",
     ["110%", "300%"],
     "토지이음이 겹친 도면을 두 겹으로 센 값. 정규화하면 55%로 떨어진다"),
  ]),

  ("[정합] 나대지 — 법정치로 지을 규모를 낸다", [
    # 16.0평 × 200% = 32.0평 · 16.0평 × 60% = 9.6평
    ("/parcels/1111011300100960000", "값 하나 · 계산까지", "법정 건폐",
     ["60% · 200%", "지을 수 있는 연면적", "32.0평"],
     "법정치가 「지을 수 있는 것」 계산으로 이어지는지"),

    ("/parcels/1111014000101450033", "값 둘 · 계산 안 함", "법정 건폐",
     ["20%, 60% · 50%, 150%",
      # 표시 줄만 보면 백엔드 _pct 버그를 못 잡는다(2026-09-02 실측).
      # 그 줄은 배열을 그대로 그리는 다른 경로다.
      "지을 수 있는 연면적\n—", "한 층 · 최대\n— · —층"],
     "값이 둘이면 계산을 안 해야 한다. 20% 를 골랐다면 3배 작은 연면적이 나온다"),
  ]),

  ("[정합] 공시지가 — 원장 값과 곱셈", [
    # 대장 gongsi_latest 41,960,000원/㎡ × 926.4㎡ = 388.7억 · 추정가 1,022.6억 → 2.6배
    ("/buildings/1024123619", "삼성동 78 · ㎡당·총액·배수", "공시지가",
     ["4,196만", "389억", "2.6배"],
     "㎡당 공시 × 대지면적 = 총액. 추정가÷공시총액 = 배수"),
  ]),

  ("[정합] 추정가 — 화면끼리 같은가", [
    # master.building_sale_est 102,261,660,857원
    ("/buildings/1024123619", "건물 상세 · 1023억", "빌탐정 추정가",
     ["1023억", "2.51%"],
     "적정가는 하나여야 한다. 예전엔 배치와 라이브가 갈려 화면마다 달랐다"),

    ("/reports/54", "보고서 · 같은 값", "빌탐정 리포트",
     ["1,022억",
      # 걸친 용도지역을 표지에도 다 적어야 한다. 대표 하나만 적으면 같은 보고서의
      # 법정용적률 508% 와 앞뒤가 안 맞아 보인다 — 제3종은 250%다(2026-09-02).
      "제3종일반주거지역, 일반상업지역", "508"],
     "보고서가 건물 상세와 같은 적정가·법정치를 써야 한다"),
  ]),

  ("[정합] 검색 — region_index 를 읽는다", [
    # 기다릴 글자는 innerText 에 있는 것이라야 한다 — 입력칸 placeholder 는 안 잡힌다.
    ("/search", "자동완성이 뜨는가", "이 영역",
     ["강남구 삼성동"],
     "region_index 에 좌표 없는 동이 한 행만 있어도 자동완성 전체가 500 이었다"
     "(2026-09-02, 0154). 화면은 「일치하는 결과가 없습니다」로 조용히 넘어갔다"),
  ]),

  ("[동작] 목록 — 마이페이지", [
    ("/mypage", "내 리포트 목록", "내 리포트",
     ["분석", "삼성동 78번지"],
     "만든 보고서가 목록에 서야 한다"),
  ]),

  ("[동작] 업무 — 자료가 없을 때", [
    ("/sales", "오늘 · 자료 없음", "오늘 할일",
     ["오늘 할 일이 없습니다"],
     "자료가 없어도 깨지지 않고 안내가 떠야 한다"),
  ]),
]

# 실행은 평평하게 — (묶음이름, 표본…)
FIXTURES = [(g, *f) for g, fs in GROUPS for f in fs]


def _creds():
    """자격증명은 파일에서만 읽는다 — 코드에 박지 않는다."""
    f = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".qa_screen.env")
    env = {}
    if os.path.exists(f):
        for line in open(f, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    # 기본값은 **로컬 전용 점검 계정**이다. 없으면 만든다:
    #   curl -sX POST localhost:8000/auth/signup -H 'Content-Type: application/json' \
    #     -d '{"email":"qa-screen@qa.example.com","password":"qascreen12345",
    #          "name":"화면점검","terms_agreed":true,"privacy_agreed":true}'
    # 다른 환경이면 .qa_screen.env 로 덮는다. 사용자 계정은 쓰지 않는다.
    return (env.get("QA_EMAIL") or os.environ.get("QA_EMAIL") or "qa-screen@qa.example.com",
            env.get("QA_PASSWORD") or os.environ.get("QA_PASSWORD") or "qascreen12345")


async def _login(pg, base, email, password) -> bool:
    """화면으로 로그인한다 — 실제 사용자와 같은 길이라야 세션도 같다."""
    try:
        await pg.goto(base + "/login", wait_until="domcontentloaded")
        await pg.fill('input[type="email"], input[name="email"]', email)
        await pg.fill('input[type="password"], input[name="password"]', password)
        await pg.keyboard.press("Enter")
        await pg.wait_for_function(
            "() => !location.pathname.startsWith('/login')", timeout=20000)
        return True
    except Exception:                                          # noqa: BLE001
        return False


def find_broken(text: str):
    out = []
    for pat, why in BROKEN:
        for m in re.finditer(pat, text):
            s = max(0, m.start() - 40)
            out.append((why, text[s:m.end() + 40].replace("\n", " ⏎ ")))
            break                      # 같은 자국은 한 번만 보고한다
    return out


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default="http://localhost:5173")
    ap.add_argument("--wait", type=int, default=20000, help="화면이 그려질 때까지(ms)")
    a = ap.parse_args()

    email, pw_ = _creds()

    from playwright.async_api import async_playwright        # noqa: PLC0415
    ok = bad = 0
    async with async_playwright() as pw:
        br = await pw.chromium.launch()
        ctx = await br.new_context()
        pg = await ctx.new_page()
        print(f"화면 점검 · {a.base}", flush=True)
        if not await _login(pg, a.base, email, pw_):
            print("✗ 로그인 실패 — 자격증명과 API(8000)를 확인하세요")
            await br.close()
            return 2
        print("로그인 됨\n", flush=True)
        group = None
        for grp, path, name, ready, must, why in FIXTURES:
            if grp != group:
                group = grp
                print(f"\n{grp}")
            try:
                await pg.goto(a.base + path, wait_until="domcontentloaded")
                # 그 화면의 표지 글자가 나올 때까지 기다린다 — 정해진 시간만 쉬면
                # 덜 그려진 화면을 보고 「없다」고 잘못 신고한다
                await pg.wait_for_function(
                    f"() => document.body.innerText.includes({ready!r})", timeout=a.wait)
                await pg.wait_for_timeout(900)      # 나머지 조각이 붙을 틈
                if path == "/search":
                    # 자동완성은 글자를 쳐야 뜬다. 실제 사용자와 같은 길로 확인한다.
                    await pg.fill('input[placeholder*="주소"]', "삼성동")
                    await pg.wait_for_function(
                        "() => document.body.innerText.includes('강남구 삼성동')", timeout=15000)
                text = await pg.evaluate("() => document.body.innerText")
            except Exception as e:                            # noqa: BLE001
                print(f"  ✗ {name}: 화면을 못 읽음 ({type(e).__name__})")
                print("      프론트(5173)·API(8000)가 떠 있는지, 그 건물이 지워지지 않았는지 보세요")
                bad += 1
                continue

            fails = []
            for frag in must:
                if frag not in text:
                    fails.append(f"「{frag}」가 없다")
            for why_broken, around in find_broken(text):
                fails.append(f"{why_broken}  …{around}…")
            for label, got, why_shape in check_shape(text):
                fails.append(f"「{label}」 줄 모양이 이상하다 — 받은 것 「{got}」. {why_shape}")

            if fails:
                bad += 1
                print(f"  ✗ {name}  ({why})")
                for f in fails:
                    print(f"      {f}")
            else:
                ok += 1
                print(f"  ✓ {name}  {' · '.join(must)}")

        await br.close()

    print(f"\n{ok} ✓ · {bad} ✗")
    if bad:
        print("화면이 DB 와 다르게 그려지고 있습니다. 읽는 쪽 코드를 보세요 —")
        print("  백엔드  buildings.py(_pct) · generate_report.py(_parse_far)")
        print("  프론트  ParcelBlock(legalText·legalNum) · ParcelPage · LandScene")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
