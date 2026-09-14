#!/usr/bin/env python3
"""서울임대시세 데이터.xlsx — 크롤 임대 호가를 법정동별로 요약하고 원본을 붙인다.

바탕은 master._crawl_clean (주소로 건물에 붙인 임대 호가). **호가지 실계약이 아니다** —
문서 첫 줄에 그렇게 적는다. 실계약(부동산원 임대동향)보다 높게 나오는 게 정상이다.

    backend/.venv/bin/python scripts/report/make_rent_xlsx.py [--out 경로]
"""
import argparse
import asyncio
import os
import statistics as st
from collections import defaultdict

import asyncpg
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

DSN = os.environ.get("RENT_DSN", "postgresql://postgres:test@localhost:55432/billtamjung")

SQL = """
select c.no, c.building_pk, c.addr, c.floor, c.area_c, c.area_e, c.deposit, c.rent,
       b.bjd_code, b.sgg_code, b.main_use_name, b.approval_ymd
from master._crawl_clean c
left join master.buildings b on b.building_pk = c.building_pk
"""

HDR = PatternFill("solid", fgColor="1F3864")
HDRF = Font(color="FFFFFF", bold=True, size=10)
THIN = Side(style="thin", color="BFBFBF")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)


def dong_of(addr):
    """'서울특별시 마포구 노고산동 54-29' → ('마포구','노고산동'). 못 읽으면 (None,None)."""
    p = (addr or "").split()
    if len(p) >= 3 and p[0].startswith("서울"):
        return p[1], p[2]
    return None, None


def style_header(ws, ncol):
    for c in range(1, ncol + 1):
        cell = ws.cell(row=1, column=c)
        cell.fill, cell.font = HDR, HDRF
        cell.alignment = Alignment(horizontal="center", vertical="center")
        cell.border = BOX
    ws.freeze_panes = "A2"


def autosize(ws, widths):
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[get_column_letter(i)].width = w


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.expanduser("~/Desktop/서울임대시세 데이터.xlsx"))
    a = ap.parse_args()

    con = await asyncpg.connect(DSN)
    rows = await con.fetch(SQL)
    await con.close()
    print(f"원본 {len(rows):,}건")

    recs = []
    for r in rows:
        gu, dong = dong_of(r["addr"])
        rent, area = r["rent"], r["area_c"]
        recs.append({
            "no": r["no"], "pk": r["building_pk"], "addr": r["addr"],
            "gu": gu, "dong": dong, "bjd": r["bjd_code"],
            "floor": r["floor"], "area_c": area, "area_e": r["area_e"],
            "deposit": r["deposit"], "rent": rent,
            "unit": (rent / area) if (rent and area and area > 0) else None,
            "use": r["main_use_name"], "appr": r["approval_ymd"],
        })

    wb = Workbook()

    # ── 1. 요약 ────────────────────────────────────────────────────
    ws = wb.active
    ws.title = "1.요약"
    by = defaultdict(list)
    for x in recs:
        if x["dong"]:
            by[(x["gu"], x["dong"])].append(x)

    ws.append(["서울 임대시세 데이터 요약"])
    ws["A1"].font = Font(bold=True, size=14)
    ws.append([])
    tot_rent = [x["rent"] for x in recs if x["rent"]]
    tot_unit = [x["unit"] for x in recs if x["unit"]]
    for k, v in [
        ("자료", "인터넷 매물 호가 (실계약 아님)"),
        ("데이터 수", f"{len(recs):,}건"),
        ("건물 수", f"{len({x['pk'] for x in recs}):,}동"),
        ("포함 법정동", f"{len(by):,}개 · {len({g for g, _ in by}):,}개 구"),
        ("월 임대료 평균", f"{st.mean(tot_rent):,.0f}원"),
        ("월 임대료 중앙값", f"{st.median(tot_rent):,.0f}원"),
        ("㎡당 월 임대료 평균", f"{st.mean(tot_unit):,.0f}원"),
        ("㎡당 월 임대료 중앙값", f"{st.median(tot_unit):,.0f}원"),
    ]:
        ws.append([k, v])
        ws.cell(row=ws.max_row, column=1).font = Font(bold=True)
    ws.append([])

    head = ["구", "법정동", "건수", "건물수", "월임대료 평균", "월임대료 중앙값",
            "㎡당 평균", "㎡당 중앙값", "보증금 중앙값", "계약면적 중앙값(㎡)"]
    r0 = ws.max_row + 1
    ws.append(head)
    for c in range(1, len(head) + 1):
        cell = ws.cell(row=r0, column=c)
        cell.fill, cell.font = HDR, HDRF
        cell.alignment = Alignment(horizontal="center")
        cell.border = BOX
    for (gu, dong), v in sorted(by.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        rs = [x["rent"] for x in v if x["rent"]]
        us = [x["unit"] for x in v if x["unit"]]
        ds = [x["deposit"] for x in v if x["deposit"]]
        ac = [x["area_c"] for x in v if x["area_c"]]
        ws.append([gu, dong, len(v), len({x["pk"] for x in v}),
                   round(st.mean(rs)) if rs else None,
                   round(st.median(rs)) if rs else None,
                   round(st.mean(us)) if us else None,
                   round(st.median(us)) if us else None,
                   round(st.median(ds)) if ds else None,
                   round(st.median(ac), 1) if ac else None])
    for row in ws.iter_rows(min_row=r0 + 1, max_row=ws.max_row, min_col=3, max_col=10):
        for cell in row:
            cell.number_format = "#,##0"
    ws.freeze_panes = f"A{r0+1}"
    autosize(ws, [12, 14, 9, 9, 15, 16, 12, 13, 15, 18])

    # ── 2. 전체 데이터 ─────────────────────────────────────────────
    ws2 = wb.create_sheet("2.전체 데이터")
    head2 = ["매물번호", "건물PK", "주소", "구", "법정동", "층",
             "계약면적(㎡)", "전용면적(㎡)", "보증금", "월임대료", "㎡당 월임대료",
             "주용도", "사용승인일"]
    ws2.append(head2)
    style_header(ws2, len(head2))
    for x in recs:
        ws2.append([x["no"], x["pk"], x["addr"], x["gu"], x["dong"], x["floor"],
                    x["area_c"], x["area_e"], x["deposit"], x["rent"],
                    round(x["unit"]) if x["unit"] else None,
                    x["use"], x["appr"].isoformat() if x["appr"] else None])
    for row in ws2.iter_rows(min_row=2, max_row=ws2.max_row, min_col=7, max_col=11):
        for cell in row:
            cell.number_format = "#,##0"
    autosize(ws2, [13, 24, 38, 10, 12, 6, 13, 13, 14, 13, 14, 20, 12])

    os.makedirs(os.path.dirname(a.out), exist_ok=True)
    wb.save(a.out)
    print(f"→ {a.out}")
    print(f"  1.요약  법정동 {len(by):,}개")
    print(f"  2.전체 데이터  {len(recs):,}행")


if __name__ == "__main__":
    asyncio.run(main())
