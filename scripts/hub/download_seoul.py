#!/usr/bin/env python3
"""건축HUB 서울본 다운로드 — 유형별 건축데이터 제공(idx-*.do) 경유(2026-08-31).

## 왜 길을 바꿨나

**전국본을 버렸다.** 마트 zip 은 전국 단위라 12.6GB 를 받아 서울 5% 만 남기고 버렸다.
받지도 못한 마트가 50장이었고(전유부·지역지구구역·폐쇄말소대장·도로대장…), 디스크가
20GB 밖에 안 남아 더 받을 수도 없었다. 몇 장이 빠지면 표끼리 이가 안 맞아
「이게 왜 없는지」를 못 밝힌다. 대장과 100% 같아야 하므로 전부 받는다.

**맞춤형(idx-cmi-list.do)은 안 된다.** 칸이 53개로 고정이고 도로명주소·시군구코드·
법정동코드·주용도코드가 빠진다. 도로명주소는 지번에서 만들어낼 수 없다.

**유형별(idx-*.do)이 맞다.** 칸을 전부 주고(표제부 77칸) 시군구 단위로 끊어 준다.

## 지역 단위 — 화면은 동을 강제하지만 서버는 구까지만 본다

화면에서 법정동을 안 고르면 「법정동을 선택하세요」로 막힌다. 그건 **화면 검증**이고,
서버는 법정동이 비어도 시군구 전체를 준다. 실측(2026-08-31, 종로구 표제부):

    시도 11000 · 시군구 11110 · 법정동 14000(삼청동) →   218KB
    시도 11000 · 시군구 11110 · 법정동 **비움**        → 11.7MB  ← 구 전체
    시도 11000 · 시군구 **비움** · 법정동 비움          →  1.4KB  ← 빈 파일

시군구는 서버도 필수다. 그래서 55장 × 25구 = 1,375회.

## 통신 세 걸음

    1) 로그인  POST /portal/usr/lgn/login-by-id.do
                 id=base64(아이디) · password=평문 · userType=indvdl · loginType=id
    2) 생성    POST /bimatrix/servlet/Studio.maf
                 cname=service.ExportService · action=export · exportType=0(csv)
                 inputxml=<템플릿에서 :VS_SIGUNGU 만 갈아끼운 것>
               → {"filePath":"_TEMP_/xxx.csv","retCode":"1"}
    3) 수령    POST /bimatrix/webquery/export.jsp
                 flag=10 · resourceno={filePath} · modulecode=SD
               → CSV 본문

inputxml 은 리포트마다 칸 정의(77개)와 파라미터(122개)가 통째로 들어 있어 공용 판이
없다. 55장을 브라우저에서 한 번씩 떠 scripts/hub/_tpl/ 에 두었다. 그 안에서 바뀌는
것은 :VS_SIGUNGU 다섯 자리뿐이다(두 판을 떠서 대조 확인). 뜨는 법은 capture_tpl.js.

## 함정 — HUB 는 한 계정에 세션 하나다

이 스크립트가 로그인하면 **브라우저에서 보던 창이 끊긴다**("다른 기기 또는 브라우저에서
로그인되어 현재 로그인이 종료되었습니다"). 반대도 같다. 그래서 이 스크립트를 돌리는 동안
같은 계정으로 사이트를 열어 두면 안 된다. 템플릿을 뜨는 중이었다면 그 작업이 통째로 날아간다.

    data/.venv/bin/python scripts/hub/download_seoul.py            # 전부
    data/.venv/bin/python scripts/hub/download_seoul.py --only 대장 # 계열 하나
    data/.venv/bin/python scripts/hub/download_seoul.py --sgg 11110 # 구 하나
    data/.venv/bin/python scripts/hub/download_seoul.py --merge     # 25구 합치기

자격은 scripts/.env.pipeline 의 HUB_ID / HUB_PW.
"""
import argparse
import base64
import hashlib
import http.cookiejar
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TPL = os.path.join(ROOT, "scripts", "hub", "_tpl")
PAGES_JSON = os.path.join(TPL, "pages.json")
OUT = os.path.join(ROOT, "data", "raw", "hub_seoul")

BASE = "https://www.hub.go.kr"
LOGIN_PAGE = BASE + "/portal/usr/lgn/idx-login.do"
LOGIN = BASE + "/portal/usr/lgn/login-by-id.do"
MATRIX = BASE + "/portal/cmm/bim/idx-bi-matrix.do"
STUDIO = BASE + "/bimatrix/servlet/Studio.maf"
EXPORT = BASE + "/bimatrix/webquery/export.jsp"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " \
     "(KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36"

SGG = {
    "11110": "종로구", "11140": "중구", "11170": "용산구", "11200": "성동구",
    "11215": "광진구", "11230": "동대문구", "11260": "중랑구", "11290": "성북구",
    "11305": "강북구", "11320": "도봉구", "11350": "노원구", "11380": "은평구",
    "11410": "서대문구", "11440": "마포구", "11470": "양천구", "11500": "강서구",
    "11530": "구로구", "11545": "금천구", "11560": "영등포구", "11590": "동작구",
    "11620": "관악구", "11650": "서초구", "11680": "강남구", "11710": "송파구",
    "11740": "강동구",
}

# 받은 것이 쓸 만한지 — **크기가 아니라 줄 수로 본다.**
#
# 처음엔 400바이트를 하한으로 뒀다가 틀렸다. 마트마다 칸 수가 달라 머리글 길이가 다른데,
# 폐쇄말소/공동주택가격의 빈 파일이 **390바이트**여서 10바이트 차이로 정상을 실패 처리했다.
# 강북구·도봉구에는 폐쇄말소된 공동주택가격이 실제로 0건이다(머리글만 오는 게 맞다).
#
# 그래서 두 가지를 나눈다:
#   · 머리글조차 없다 → 실패. 통신이 깨진 것이다
#   · 머리글만 있고 데이터가 0행 → **정상.** 그 지역에 그런 자료가 없는 것이다
MIN_BYTES = 40           # 머리글 한 줄도 안 되는 크기 = 통신 실패


def csv_rows(body):
    """머리글을 뺀 데이터 줄 수. 마지막 줄바꿈은 세지 않는다."""
    if not body:
        return -1
    n = body.count(b"\n")
    if not body.endswith(b"\n"):
        n += 1
    return max(n - 1, 0)

# 디스크가 이보다 적게 남으면 받지 않는다 — 잘린 파일이 빈 파일보다 위험하다
MIN_FREE_GB = 3.0

_JAR = http.cookiejar.CookieJar()
_OP = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(_JAR))


def _req(url, data=None, headers=None, timeout=300, tries=4):
    """502·타임아웃은 물러나며 다시 건다.

    한 시간 반짜리 작업이라 한 번의 502 로 전부 날리면 안 된다(2026-08-31 실제로
    대장/전유공용 에서 502 를 맞고 남은 1,000여 회가 통째로 죽었다). 서버가 큰 표를
    만드는 중에 게이트웨이가 끊기는 것이라 잠깐 쉬면 대개 된다.
    """
    h = {"User-Agent": UA, "Referer": BASE + "/"}
    h.update(headers or {})
    if isinstance(data, dict):
        data = urllib.parse.urlencode(data).encode()
        h.setdefault("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8")
    last = None
    for i in range(tries):
        try:
            return _OP.open(urllib.request.Request(url, data=data, headers=h), timeout=timeout)
        except urllib.error.HTTPError as e:
            last = e
            if e.code not in (429, 500, 502, 503, 504):
                raise
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
        if i < tries - 1:
            time.sleep(5 * (i + 1))            # 5 · 10 · 15초
    raise last


def free_gb():
    s = os.statvfs(ROOT)
    return s.f_bavail * s.f_frsize / (1 << 30)


def _cookie(name):
    for c in _JAR:
        if c.name == name:
            return c.value
    return None


def load_env():
    p = os.path.join(ROOT, "scripts", ".env.pipeline")
    env = {}
    if os.path.exists(p):
        for line in open(p, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


def login():
    """아이디는 base64, 비밀번호는 평문. 5회 틀리면 비밀번호 재설정이 걸린다 — 한 번만 쏜다."""
    env = load_env()
    uid, pw = env.get("HUB_ID"), env.get("HUB_PW")
    if not (uid and pw):
        sys.exit("✗ scripts/.env.pipeline 에 HUB_ID / HUB_PW 가 없습니다")
    html = _req(LOGIN_PAGE).read().decode("utf-8", "replace")
    m = re.search(r'name="_csrf"[^>]*value="([^"]+)"', html)
    body = {"_csrf": m.group(1) if m else "", "userType": "indvdl", "loginType": "id",
            "isEncrypted": "false", "id": base64.b64encode(uid.encode()).decode(),
            "password": pw}
    r = _req(LOGIN, body, {"Referer": LOGIN_PAGE})
    url = r.geturl()
    if "message=" in url:
        msg = urllib.parse.unquote_plus(url.split("message=")[1].split("&")[0])
        sys.exit(f"✗ 로그인 실패: {re.sub('<[^>]+>', ' ', msg)}")
    return True


def open_report(r_code):
    """리포트 화면을 한 번 열어 bimatrix 세션을 깨운다. 토큰 쿠키가 여기서 붙는다."""
    _req(f"{MATRIX}?rCode={r_code}").read()
    return _cookie("bimatrix_accessToken")


def export_csv(r_code, inputxml, sgg_cd, _no_bjd_clear=False):
    """시군구 하나치 CSV 를 받아 bytes 로 돌려준다. 실패하면 None."""
    xml = re.sub(r'(<Param Name=":VS_SIGUNGU" ParamType="String">\s*)<Value>[^<]*</Value>',
                 r'\1<Value>%s</Value>' % sgg_cd, inputxml)
    # 법정동은 비운다 — 서버는 안 따진다(구 전체가 온다).
    # 단 법정동으로 잘라 받는 중이면 그대로 둔다.
    if not _no_bjd_clear:
        xml = re.sub(r'(<Param Name=":VS_BJDONG" ParamType="String">\s*)<Value>[^<]*</Value>',
                     r'\1<Value />', xml)
    if f"<Value>{sgg_cd}</Value>" not in xml:
        return None, "시군구 치환 실패"

    tok = _cookie("bimatrix_accessToken")
    hdr = {"Referer": f"{MATRIX}?rCode={r_code}", "X-Requested-With": "XMLHttpRequest",
           "Origin": BASE, "Accept": "application/json, text/javascript, */*; q=0.01"}
    if tok:
        hdr["bimatrix_accesstoken"] = tok
    res = _req(STUDIO, {"cname": "service.ExportService", "action": "export",
                        "ukey": str(uuid.uuid4()), "exportType": "0",
                        "inputxml": xml, "sqlExecuteType": "AUD7", "ver": "400"},
               hdr).read().decode("utf-8", "replace")
    try:
        j = json.loads(res)
    except ValueError:
        return None, f"생성 응답이 JSON 이 아님: {res[:120]}"
    path = j.get("filePath")
    if not path:
        return None, f"생성 실패: {res[:160]}"

    body = _req(EXPORT, {"flag": "10", "resourceno": path,
                         "newname": os.path.basename(path), "modulecode": "SD"},
                {"Referer": f"{MATRIX}?rCode={r_code}", "Origin": BASE}).read()
    return body, None


def bjd_codes(sgg_cd):
    """그 구의 법정동 코드 — 이미 받아 둔 대장/표제부에서 뽑는다.

    큰 마트(대장/공동주택가격)는 구 단위로 요청하면 서버가 파일을 만들다 502 로 끊긴다.
    그럴 때 법정동으로 잘라 받는다. 목록을 따로 관리하지 않고 표제부에서 뽑는 이유는,
    **우리가 실제로 받은 것과 같은 판**이어야 빠지는 동이 없기 때문이다.
    """
    p = os.path.join(OUT, "대장_표제부", f"{sgg_cd}.csv")
    if not os.path.exists(p):
        # 2026-09-02: 「받자마자 압축」을 넣은 뒤로 표제부가 이 시점엔 이미 접혀 있다.
        # 그래서 공동주택가격 20개 구가 「법정동 목록 없음」으로 통째로 실패했다.
        # 압축본에서 도로 편다 — 같은 판이어야 빠지는 동이 없다는 원칙은 그대로다.
        _unfold("대장_표제부")
        if not os.path.exists(p):
            return []
    import csv
    csv.field_size_limit(1 << 27)
    with open(p, encoding="utf-8-sig", newline="") as f:
        rd = csv.DictReader(f)
        if "법정동코드" not in (rd.fieldnames or []):
            return []
        return sorted({r["법정동코드"] for r in rd if (r["법정동코드"] or "").strip()})


def _unfold(mart):
    """압축해 둔 마트를 원본 자리로 도로 편다. 없거나 실패하면 조용히 넘어간다."""
    tar = os.path.join(ROOT, "data", "raw", "_archive", "hub_seoul", f"{mart}.tar.zst")
    if not os.path.exists(tar) or os.path.isdir(os.path.join(OUT, mart)):
        return
    print(f"    · {mart}: 압축본에서 푸는 중(법정동 목록이 필요합니다)…", flush=True)
    subprocess.run(f'cd "{OUT}" && tar --use-compress-program="zstd -d" -xf "{tar}"',
                   shell=True, capture_output=True, text=True)


def export_by_bjd(r_code, inputxml, sgg_cd):
    """법정동으로 잘라 받아 하나로 잇는다. 머리는 첫 조각 것만 남긴다."""
    codes = bjd_codes(sgg_cd)
    if not codes:
        return None, "법정동 목록 없음(대장/표제부를 먼저 받으세요)"
    parts, got, fail = [], 0, 0
    for i, bd in enumerate(codes):
        xml = re.sub(r'(<Param Name=":VS_BJDONG" ParamType="String">\s*)<Value[^>]*/>|'
                     r'(<Param Name=":VS_BJDONG" ParamType="String">\s*)<Value>[^<]*</Value>',
                     lambda m: (m.group(1) or m.group(2)) + f"<Value>{bd}</Value>", inputxml, count=1)
        if f"<Value>{bd}</Value>" not in xml:
            return None, "법정동 치환 실패"
        try:
            body, err = export_csv(r_code, xml, sgg_cd, _no_bjd_clear=True)
        except Exception as e:
            body, err = None, str(e)[:60]
        if err or not body or len(body) < MIN_BYTES:
            fail += 1
            continue
        got += 1
        parts.append(body if not parts else body.split(b"\n", 1)[1] if b"\n" in body else b"")
    if not parts:
        return None, f"법정동 {len(codes)}개 전부 실패"
    return b"".join(parts), (None if fail == 0 else f"법정동 {fail}/{len(codes)}개 실패")


def pages():
    if not os.path.exists(PAGES_JSON):
        sys.exit(f"✗ {PAGES_JSON} 없음 — 템플릿을 먼저 떠야 합니다(주석 참고)")
    return json.load(open(PAGES_JSON, encoding="utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="계열만: 인허가·주택인허가·대장·폐쇄말소·에너지")
    ap.add_argument("--page", help="마트 이름만: 표제부·전유부 …")
    ap.add_argument("--sgg", help="시군구코드 하나만")
    ap.add_argument("--merge", action="store_true", help="받아 둔 25구를 계열별 한 파일로 합친다")
    ap.add_argument("--force", action="store_true", help="이미 받은 것도 다시 받는다")
    # 받자마자 압축하는 것이 기본이다. 55장을 다 펴 두면 21.2GB 가 필요한데
    # 마트마다 압축하면 피크가 한 마트(최대 6.9GB)로 준다.
    ap.add_argument("--keep-raw", action="store_true",
                    help="압축하지 않고 원본 그대로 둔다(디스크가 넉넉할 때)")
    ap.add_argument("--canary", action="store_true",
                    help="처음 받은 것을 다시 받아 판이 안 바뀌었는지 본다(받기 끝난 뒤 필수)")
    a = ap.parse_args()

    if a.canary:
        return canary()

    ps = pages()
    if a.only:
        ps = [p for p in ps if p["grp"] == a.only]
    if a.page:
        ps = [p for p in ps if p["name"] == a.page]
    if not ps:
        sys.exit("✗ 해당하는 마트가 없습니다")
    sggs = [a.sgg] if a.sgg else list(SGG)

    if a.merge:
        return merge(ps)

    login()
    print(f"로그인 성공 · 마트 {len(ps)}장 × 시군구 {len(sggs)}개 = {len(ps)*len(sggs):,}회\n")
    t_all = time.time()
    fails = []
    for p in ps:
        tplf = os.path.join(TPL, f"{p['grp']}_{p['name']}.xml")
        if not os.path.exists(tplf):
            print(f"  ✗ {p['grp']}/{p['name']}: 템플릿 없음")
            fails.append((p["grp"], p["name"], "-", "템플릿 없음"))
            continue
        xml = open(tplf, encoding="utf-8").read()
        d = os.path.join(OUT, f"{p['grp']}_{p['name']}")
        os.makedirs(d, exist_ok=True)
        try:
            open_report(p["rCode"])
        except Exception as e:
            print(f"  ✗ {p['grp']}/{p['name']}: 리포트 열기 실패 {e}")
            fails.append((p['grp'], p['name'], '-', '리포트 열기 실패'))
            continue
        tot = 0
        empty = 0
        t0 = time.time()
        for cd in sggs:
            f = os.path.join(d, f"{cd}.csv")
            if os.path.exists(f) and os.path.getsize(f) > MIN_BYTES and not a.force:
                tot += os.path.getsize(f)
                continue
            # 디스크가 차면 파일이 **잘린 채** 남는다. 크기 검사로는 잘린 큰 파일을
            # 못 잡으므로, 받기 전에 막는다.
            if free_gb() < MIN_FREE_GB:
                print(f"\n✗ 디스크 여유 {free_gb():.1f}GB — {MIN_FREE_GB}GB 아래라 멈춥니다.")
                print("  자리를 비우고 다시 돌리면 받은 것은 건너뜁니다.")
                sys.exit(2)
            try:
                body, err = export_csv(p["rCode"], xml, cd)
            except Exception as e:                 # 한 칸의 실패가 전체를 죽이지 않는다
                body, err = None, f"{type(e).__name__}: {str(e)[:80]}"
            if err or body is None or len(body) < MIN_BYTES:
                # 구 단위가 안 되면 법정동으로 잘라 받는다(큰 마트에서 서버가 502 를 낸다)
                try:
                    body, err2 = export_by_bjd(p["rCode"], xml, cd)
                except Exception as e:
                    body, err2 = None, f"{type(e).__name__}: {str(e)[:60]}"
                if body and len(body) >= MIN_BYTES:
                    open(f, "wb").write(body)
                    tot += len(body)
                    print(f"  · {p['grp']}/{p['name']} {SGG[cd]}: 법정동 분할로 받음"
                          f"{' (' + err2 + ')' if err2 else ''}")
                    continue
                err = err2 or err
            if err or body is None or len(body) < MIN_BYTES:
                why = err or f"{len(body or b'')}바이트 — 너무 작다"
                print(f"  ✗ {p['grp']}/{p['name']} {SGG[cd]}: {why}")
                fails.append((p["grp"], p["name"], cd, why))
                try:
                    open_report(p["rCode"])   # 세션이 상했을 수 있다 — 다시 깨운다
                except Exception:
                    pass
                continue
            open(f, "wb").write(body)
            tot += len(body)
            if csv_rows(body) == 0:
                empty += 1        # 그 지역에 자료가 없는 것 — 실패가 아니다
        msg = f"  {p['grp']:6} {p['name']:12} {tot/1048576:8.1f}MB  {time.time()-t0:5.0f}초"
        if empty:
            msg += f"  (자료 없는 구 {empty})"
        print(msg)

        # ── 받자마자 압축한다 (2026-09-01) ────────────────────────
        # 55장을 다 받아 놓고 나중에 압축하면 **한때 21.2GB** 가 필요하다. 실제로
        # 2026-08-31 다운로드 중에 디스크가 두 번 찼고, 통주행 때도 세 번 손으로 치웠다.
        # 마트 하나가 끝날 때마다 압축하면 **피크가 한 마트 크기**로 줄어든다(최대 6.9GB).
        # 압축본은 archive_seoul.py --restore 로 언제든 되돌린다.
        if not a.keep_raw:
            mart = f"{p['grp']}_{p['name']}"
            if not any(f[0] == p['grp'] and f[1] == p['name'] for f in fails):
                shrink(mart)
            else:
                print(f"    ⏭ {mart}: 실패한 칸이 있어 압축하지 않습니다(다시 받아야 함)")
    print(f"\n걸린 시간 {(time.time()-t_all)/60:.1f}분")
    if fails:
        print(f"\n실패 {len(fails)}건 — 다시 돌리면 받은 것은 건너뜁니다:")
        for g, n, cd, why in fails[:20]:
            print(f"  {g}/{n} {SGG.get(cd, cd)}: {why}")
        sys.exit(1)


def shrink(mart):
    """받아 둔 마트 하나를 압축본으로 옮긴다. 실패하면 원본을 그대로 둔다.

    피크를 줄이는 것이 목적이라 **압축이 끝난 뒤에만** 원본을 지운다. 중간에 죽으면
    원본이 남고, 다시 돌리면 이미 받은 칸은 건너뛴다.
    """
    src = os.path.join(OUT, mart)
    if not os.path.isdir(src):
        return
    arc_dir = os.path.join(ROOT, "data", "raw", "_archive", "hub_seoul")
    os.makedirs(arc_dir, exist_ok=True)
    tar = os.path.join(arc_dir, f"{mart}.tar.zst")
    before = sum(os.path.getsize(os.path.join(src, f)) for f in os.listdir(src))
    if os.path.exists(tar):
        os.remove(tar)                 # 새로 받은 판이 정본이다
    r = subprocess.run(
        f'cd "{OUT}" && tar --use-compress-program="zstd -10 -T0" -cf "{tar}" "{mart}"',
        shell=True, capture_output=True, text=True)
    if r.returncode != 0:
        print(f"    ⚠ {mart}: 압축 실패 — 원본을 그대로 둡니다 ({r.stderr.strip()[:80]})")
        return
    shutil.rmtree(src)
    after = os.path.getsize(tar)
    print(f"    ↳ 압축 {before/2**30:.2f}GB → {after/2**30:.2f}GB "
          f"({after/max(before,1)*100:.1f}%) · 여유 {free_gb():.1f}GB")


def canary():
    """제일 먼저 받은 칸을 **다시 받아** 바이트가 같은지 본다.

    다 받는 데 한 시간 반이 걸린다. 그 사이에 HUB 가 다음 달 판으로 넘어가면
    표제부는 07월, 층별개요는 08월이 되어 PK 가 서로 안 맞는다. 그러면 「왜 없는지
    모르는 행」이 생기고, 그게 이번에 없애려던 바로 그 문제다.
    한 판인지는 이렇게만 확인할 수 있다 — 파일에 기준월이 안 적혀 오기 때문이다.
    """
    ps = [p for p in pages() if p["grp"] == "대장" and p["name"] == "표제부"]
    if not ps:
        sys.exit("✗ 대장/표제부 템플릿이 없습니다")
    p = ps[0]
    have = os.path.join(OUT, f"{p['grp']}_{p['name']}", "11110.csv")
    if not os.path.exists(have):
        sys.exit(f"✗ 견줄 것이 없습니다: {have}")
    login()
    open_report(p["rCode"])
    xml = open(os.path.join(TPL, f"{p['grp']}_{p['name']}.xml"), encoding="utf-8").read()
    body, err = export_csv(p["rCode"], xml, "11110")
    if err or not body:
        sys.exit(f"✗ 다시 받기 실패: {err}")
    a = hashlib.md5(open(have, "rb").read()).hexdigest()
    b = hashlib.md5(body).hexdigest()
    print(f"처음  {a}  {os.path.getsize(have):,}바이트")
    print(f"지금  {b}  {len(body):,}바이트")
    if a == b:
        print("\n✅ 같은 판입니다 — 55장이 한 스냅샷입니다")
        return
    print("\n✗ 받는 도중에 대장 판이 바뀌었습니다. 섞인 데이터라 쓰면 안 됩니다.")
    print("  data/raw/hub_seoul 을 비우고 처음부터 다시 받으세요.")
    sys.exit(1)


def merge(ps):
    """25구 파일을 계열별 한 파일로. 머리는 첫 파일 것만 남긴다."""
    for p in ps:
        d = os.path.join(OUT, f"{p['grp']}_{p['name']}")
        if not os.path.isdir(d):
            continue
        files = sorted(f for f in os.listdir(d) if re.fullmatch(r"\d{5}\.csv", f))
        if len(files) != len(SGG):
            print(f"  ⚠ {p['grp']}/{p['name']}: {len(files)}/{len(SGG)}구 — 합치지 않습니다")
            continue
        out = os.path.join(OUT, f"{p['grp']}_{p['name']}.csv")
        n = 0
        with open(out, "wb") as fo:
            for i, f in enumerate(files):
                raw = open(os.path.join(d, f), "rb").read()
                if i:                                  # 두 번째 파일부터 머리 한 줄 버림
                    raw = raw.split(b"\n", 1)[1] if b"\n" in raw else b""
                fo.write(raw)
                n += raw.count(b"\n")
        print(f"  {p['grp']:6} {p['name']:12} {n:9,}행  {os.path.getsize(out)/1048576:8.1f}MB")


if __name__ == "__main__":
    main()
