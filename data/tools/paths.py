"""정규 raw 경로 SSOT — 월-스탬프가 파일명에 박히는 V-World SHP를 glob으로 해소.

V-World 연속지적도·규제 SHP는 파일명에 다운로드 월이 들어감(예: ..._11_202606).
매 갱신마다 코드에서 월을 고치지 않도록, 디렉토리 안의 *.shp 를 glob해 베이스경로(확장자 제외)를 돌려준다.
파일이 아직 없으면(활성화 전) 레거시 _202606 경로로 폴백 → 기존 raw도 그대로 동작.

빌더/파이프라인에서:  from paths import LDREG, UD801, UQ111
                      shapefile.Reader(LDREG)
"""
import os
import glob

# repo 루트(= data/tools의 두 단계 위) 기준 절대경로 → cwd 무관하게 동작
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RAW = os.path.join(ROOT, "data", "raw")


def shp_base(dirname, legacy):
    """RAW/dirname 안의 최신 *.shp 베이스경로(확장자 없이). 없으면 legacy 경로."""
    d = os.path.join(RAW, dirname)
    shps = sorted(glob.glob(os.path.join(d, "*.shp")))     # 이름에 YYYYMM → 사전순=시간순
    if shps:
        return shps[-1][:-4]                                # .shp 제거
    return os.path.join(RAW, legacy)


LDREG = shp_base("LSMD_CONT_LDREG_5174_서울",
                 "LSMD_CONT_LDREG_5174_서울/LSMD_CONT_LDREG_5174_11_202606")
UD801 = shp_base("LSMD_CONT_UD801_서울",
                 "LSMD_CONT_UD801_서울/LSMD_CONT_UD801_11_202606")
UQ111 = shp_base("LSMD_CONT_UQ111_5174_서울",
                 "LSMD_CONT_UQ111_5174_서울/LSMD_CONT_UQ111_5174_11_202606")
