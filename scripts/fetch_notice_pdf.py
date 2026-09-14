#!/usr/bin/env python3
r"""주변 동향에 걸린 고시문 PDF 를 받아 **본문 글자를 뽑아 넣는다**(2026-09-05).

## 왜
포털이 주는 `content` 는 고시의 **요지**다. 중개인이 볼 값 — 면적 · 건폐율 · 용적률 ·
층수 · 세대수 — 은 대개 **고시문 PDF 표 안**에 있다.

전부(17,074개) 받지 않는다. **주변 동향에 걸린 것만**(1,562개) 받는다.

## 고시문의 30% 는 PDF 가 아니라 **HWP** 다
확장자를 보면 pdf 11,897 · **hwp 5,177**. 동향에 걸린 것만 봐도 pdf 1,112 · hwp 358.
HWP 는 OLE2 라 `pypdf` 가 못 읽는다(`invalid pdf header: \xd0\xcf\x11\xe0`).
**둘 다 받는다** — HWP 는 `pyhwp` 로 `ParaText` 의 `chunks` 에서 글자만 건진다
(chunks 안엔 제어문자 조각도 섞여 있어 **str 인 것만** 고른다).
HWP 쪽이 오히려 깨끗하다 — 첫 줄이 「서울특별시 강서구 고시 제2026-57호」로 기관까지 말한다.

## 스캔본이 섞여 있다
글자 PDF 가 대부분이지만 **통째로 스캔한 것도 있다**(예: 미아동 345-1 정비구역 고시문 —
31쪽 전부 글자 0, 쪽마다 그림 1). OCR 은 안 쓴다([[LLM 안 쓴다]] 와 같은 이유로 그럴듯한
오답이 더 나쁘다) — **글자가 없으면 아무것도 안 넣는다.** 「본문 있음」으로 세어지면
화면이 빈 칸을 채워진 것처럼 보여준다.

    BT_DATABASE_URL=... backend/.venv/bin/python scripts/fetch_notice_pdf.py [--limit N]
"""
import argparse
import asyncio
import io
import os
import re
import sys
import tempfile
import urllib.request

import asyncpg
from hwp5.xmlmodel import Hwp5File
from pypdf import PdfReader

DSN = os.environ.get("BT_DATABASE_URL") or os.environ.get(
    "DATABASE_URL", "postgresql://postgres:test@localhost:55432/billtamjung")
UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")
REF = "https://urban.seoul.go.kr/view/html/PMNU4030100001"
MAXP = 60          # 41쪽짜리도 있다. 60쪽이면 거의 다 담고, 지형도면만 남은 뒤쪽은 버려도 된다

DDL = """
ALTER TABLE master.urban_notice ADD COLUMN IF NOT EXISTS pdf_text text;
ALTER TABLE master.urban_notice ADD COLUMN IF NOT EXISTS pdf_pages smallint;
ALTER TABLE master.urban_notice ADD COLUMN IF NOT EXISTS pdf_issuer text;
ALTER TABLE master.urban_notice ADD COLUMN IF NOT EXISTS pdf_no text;
ALTER TABLE master.urban_notice ADD COLUMN IF NOT EXISTS pdf_tried boolean;   -- 받아 봤다(스캔본이라 글자가 없어도). 증분의 열쇠
"""


_ISSUER = re.compile(r"서울특별시(?P<gu>[가-힣]{1,4}구)?(?:고시|공고)제(?P<yr>\d{4})-(?P<no>\d+)호")


def issuer(text: str) -> tuple[str | None, str | None]:
    r"""(발행 기관, 고시번호). 못 읽으면 (None, None) — **지어내지 않는다.**

    같은 고시번호를 여러 기관이 쓴다(22,351개 번호 중 5,385개, 최대 79건). PDF 첫 줄이
    그걸 가른다 — 「서울특별시**용산구**고시제2025-86호」.

    **주소를 기관으로 읽으면 안 된다.** 시보 머리글에 「서울특별시 중구 태평로1가 31」이
    찍혀 있어서, 「서울특별시 + 구」만 보면 발행처 주소를 기관으로 옮긴다(첫 판이 그랬다).
    「고시제N호」가 **바로 뒤에 붙을 때만** 기관으로 친다.
    """
    m = _ISSUER.search(text[:3000].replace(" ", "").replace("\n", ""))
    if not m:
        return None, None
    return "서울특별시" + (" " + m.group("gu") if m.group("gu") else ""), \
           f"{m.group('yr')}-{m.group('no')}"


def _hwp_text(raw: bytes) -> tuple[str, int]:
    r"""pyhwp 는 파일 경로만 받는다 — 임시 파일에 떨궜다 지운다."""
    fp = tempfile.NamedTemporaryFile(suffix=".hwp", delete=False)
    try:
        fp.write(raw)
        fp.close()
        h = Hwp5File(fp.name)
        out = []
        for s in h.bodytext.sections:
            for m in s.models():
                if m["type"].__name__ == "ParaText":
                    for _, v in m["content"]["chunks"]:
                        if isinstance(v, str):
                            out.append(v)
                    out.append("\n")
        return "".join(out), 0            # HWP 는 쪽 개념이 없다
    finally:
        os.unlink(fp.name)


_HAN = re.compile(r"[가-힣]")


def clean(txt: str) -> str | None:
    r"""DB 에 넣을 수 있는 글자만 남긴다. 못 쓰는 글이면 **None — 아무것도 안 넣는다.**

    깨진 PDF 가 섞여 있다. 글꼴 매핑이 어긋나면 `漉璥烉櫡` 같은 한자·서로게이트가 쏟아지는데,
    ① 서로게이트(`\udfb3`)는 asyncpg 가 인코딩하다 죽고 ② NUL 은 Postgres text 가 안 받는다.
    ③ 무엇보다 그건 **글이 아니다** — 「본문 있음」으로 세어지면 화면이 쓰레기를 보여준다.
    한글이 3% 도 안 되면 버린다(정상 고시문은 30~60%다).
    """
    s = txt.encode("utf-8", "ignore").decode("utf-8", "ignore").replace("\x00", "")
    s = s.strip()
    if len(s) < 200:
        return None
    if len(_HAN.findall(s[:4000])) < len(s[:4000]) * 0.03:
        return None
    return s


def grab(url: str) -> tuple[str, int]:
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": REF})
    with urllib.request.urlopen(req, timeout=300) as r:
        raw = r.read()
    if raw[:4] == b"%PDF":
        rd = PdfReader(io.BytesIO(raw))
        return "\n".join((p.extract_text() or "") for p in rd.pages[:MAXP]), len(rd.pages)
    if raw[:4] == b"\xd0\xcf\x11\xe0":
        return _hwp_text(raw)
    raise ValueError(f"모르는 파일 머리 {raw[:4]!r}")


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=int(os.environ.get("BT_PDF_LIMIT", "0")), help="0=전부 (환경 BT_PDF_LIMIT · 파이프라인은 한 번에 400)")
    ap.add_argument("--retry", action="store_true", help="전에 받아 본 것(스캔본·실패)도 다시")
    a = ap.parse_args()
    c = await asyncpg.connect(DSN, timeout=60, command_timeout=3600)
    try:
        await c.execute(DDL)
        # 주변 동향에 걸린 고시만. 이미 받은 것은 건너뛴다
        rows = await c.fetch(f"""
            SELECT n.notice_code, n.pdf, max(n.notice_date) AS d
              FROM master.urban_notice n
              JOIN master.area_event e ON e.source_url = n.pdf
             WHERE n.pdf IS NOT NULL AND n.pdf_text IS NULL
               {'' if a.retry else 'AND NOT COALESCE(n.pdf_tried, false)'}
             GROUP BY 1, 2
             -- 최신부터. 1960~70년대 도시계획시설 고시는 스캔본이라 글자가 안 나온다(2026-09-06 실측 · 634 중 21)
             ORDER BY d DESC NULLS LAST
             {'LIMIT ' + str(a.limit) if a.limit else ''}""")
        print(f"  받을 것 {len(rows):,}개", flush=True)
        ok = chars = 0
        why: dict[str, int] = {}
        for i, r in enumerate(rows, 1):
            # 받아 봤다는 표시를 먼저 — 스캔본·실패도 다음 주에 또 받지 않는다(--retry 로만)
            await c.execute("UPDATE master.urban_notice SET pdf_tried = true WHERE notice_code = $1", r["notice_code"])
            try:
                txt, pages = grab(r["pdf"])
            except Exception as e:                            # noqa: BLE001
                why[type(e).__name__] = why.get(type(e).__name__, 0) + 1
                continue
            # 스캔본이거나 글꼴이 깨진 것 — **빈 글·쓰레기를 넣지 않는다**
            txt = clean(txt)
            if txt is None:
                why["글자없음·깨짐"] = why.get("글자없음·깨짐", 0) + 1
                continue
            iss, no = issuer(txt)
            await c.execute("""UPDATE master.urban_notice
                                  SET pdf_text=$2, pdf_pages=$3, pdf_issuer=$4, pdf_no=$5
                                WHERE notice_code=$1""",
                            r["notice_code"], txt, pages, iss, no)
            ok += 1
            chars += len(txt)
            if i % 50 == 0:
                print(f"    {i}/{len(rows)} · 받음 {ok} · 못 받음 {sum(why.values())}", flush=True)
        print(f"\n  받음 {ok:,} · 못 받음 {sum(why.values()):,} · 평균 {chars//max(ok,1):,}자")
        for k, v in sorted(why.items(), key=lambda x: -x[1]):
            print(f"    못 받은 까닭 · {k} {v}")
        s = await c.fetchrow("""SELECT count(*) t, count(pdf_text) x, count(pdf_issuer) g,
                 count(*) FILTER (WHERE pdf_no IS NOT NULL
                   AND pdf_no = regexp_replace(notice_no,'[^0-9-]','','g')) same
                 FROM master.urban_notice WHERE pdf IS NOT NULL""")
        print(f"  고시문 {s['t']:,}개 중 글자 {s['x']:,} · 기관 {s['g']:,} · "
              f"PDF 안 고시번호가 목록과 같은 것 {s['same']:,}")
        return 0
    finally:
        await c.close()


sys.exit(asyncio.run(main()))
