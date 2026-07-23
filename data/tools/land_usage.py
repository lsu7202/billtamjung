import pandas as pd
import os, re
import warnings
import numpy as np
from geoalchemy2.elements import WKTElement

# 경고 메시지 무시
warnings.filterwarnings('ignore')

import unicodedata

# ==========================================
# [0] 설정 및 경로 (전역 변수)
# ==========================================
INCLUDE_JIMO = ['대', '잡종지', '공장용지', '주차장']
EXCLUDE_USAGE = ['골프장 회원제','골프장', '공원등', '공항', '과수원', '답', '답기타', '도로등', '발전소', '아파트', '여객자동차터미널', '운동장등', '위험시설', '유해.혐오시설', '임야기타','자연림','전','전기타','전창고','전축사','조림','토지임야','특수기타','하천등' ]
EXCLUDE_ECTUSAGE = []
EXCLUDE_MAINUSAGE = []
EXCLUDE_LOAD = ['맹지']
COL_LAND_BASE = ['고유번호', '지목명', '토지이용상황', '지형형상', '도로접면']
COL_BUILDING_BASE = ['']

FILE_GIS_BASE = "seoul_exact_luris_final.csv"
FILE_LAND_CHAR = "데이터프레임/서울시_토지특성정보.csv"
FILE_BLDG_CHAR = "데이터프레임/건축물대장.csv"
FILE_SBLDG_CHAR = "데이터프레임/총괄표제부.csv"
FILE_ANNEX_REL = "부속지번_관계표.csv"
FILE_PNU_MAP = "데이터프레임/법정동코드.csv"
FILE_FLOOR_CHAR = "데이터프레임/층별개요.csv"

# ==========================================
# [1] 유틸리티 함수 (datamaker 로직 유지)
# ==========================================
def clean_text(text):
    if pd.isna(text): return ""
    text = str(text).replace('번지', '')
    text = unicodedata.normalize('NFC', text)
    return " ".join(text.split())

def clean_numeric(val):
    try:
        if pd.isna(val) or str(val).strip() in ['', '-']: return 0.0
        return float(str(val).replace(',', '').replace('%', ''))
    except: return 0.0

def get_normalized_pnu(pnu):
    """PNU 11번째 자리(대지구분코드) 무시 정규화"""
    s = str(pnu).strip()
    return s[:10] + s[11:] if len(s) == 19 else s

def load_csv_safe(path, usecols=None):
    if not os.path.exists(path): return None
    for enc in ['utf-8-sig', 'cp949', 'utf-8', 'euc-kr']:
        try:
            df = pd.read_csv(path, encoding=enc, usecols=usecols, low_memory=False)
            df.columns = df.columns.str.strip()
            return df
        except: continue
    return None

# ==========================================
# [2] 단계별 캡슐화 함수 (각 1개의 데이터 머지 담당)
# ==========================================

def step1_prepare_land_base():
    """토지특성정보 로드 및 필터링"""
    print("Step 1: 토지 데이터 필터링 중...")
    df = load_csv_safe(FILE_LAND_CHAR, usecols=COL_LAND_BASE)
    if df is None: return None
    
    # 지목 및 이용상황 필터링
    df = df[df['지목명'].isin(INCLUDE_JIMO)]
    df = df[~df['토지이용상황'].isin(EXCLUDE_USAGE)]
    df = df[~df['도로접면'].isin(EXCLUDE_LOAD)]
    
    df['고유번호'] = df['고유번호'].astype(str)
    return df

def step2_merge_gis_info(df_land):
    """GIS(토지이음) 데이터 병합 및 PNU 분석 (시도/시군구/법정동/지번 분리)"""
    print("Step 2: GIS 데이터 매핑 및 PNU 분석 중...")
    
    df_gis = load_csv_safe(FILE_GIS_BASE)
    df_code = load_csv_safe(FILE_PNU_MAP)
    
    if df_gis is None or df_code is None: 
        return df_land

    # 1. PNU 데이터 전처리 (문자열 변환 및 19자리 확인)
    df_gis['PNU'] = df_gis['PNU'].astype(str).str.zfill(19)
    
    # 2. 법정동 코드 매핑용 딕셔너리 생성 (속도 향상)
    # df_code: [법정동코드, 법정동명, 폐지여부] 구조
    code_map = df_code[df_code['폐지여부'] == '존재'].set_index('법정동코드')['법정동명'].to_dict()

    # 3. PNU 분석 및 컬럼 추출
    # PNU 구조: 법정동(10) + 산/대지(1) + 본번(4) + 부번(4)
    pnu_series = df_gis['PNU']
    
    # (1) 법정동 관련 정보 매핑
    df_gis['법정동코드_10'] = pnu_series.str[:10].astype(int)
    full_addr = df_gis['법정동코드_10'].map(code_map).fillna("")
    
    # 주소 분할 (서울특별시 종로구 청운동 -> '서울특별시', '종로구', '청운동')
    df_gis['시도'] = full_addr.apply(lambda x: x.split()[0] if len(x.split()) > 0 else "")
    df_gis['시군구'] = full_addr.apply(lambda x: " ".join(x.split()[1:-1]) if len(x.split()) > 2 else (x.split()[1] if len(x.split()) > 1 else ""))
    df_gis['법정동'] = full_addr.apply(lambda x: x.split()[-1] if len(x.split()) > 0 else "")
    
    # (2) 지/번 추출 (형이 말한 역삼동 601-5 방식)
    # 601 (지) : 12~15번째 (index 11:15)
    # 5 (번) : 16~19번째 (index 15:19)
    df_gis['지'] = pnu_series.str[11:15].str.lstrip('0').replace('', '0')
    df_gis['번'] = pnu_series.str[15:19].str.lstrip('0').replace('', '0' )

    if 'coordinate' in df_gis.columns:
        # ','를 기준으로 분할하여 새로운 컬럼 생성 (expand=True)
        # 문자열 앞뒤 공백 제거(strip) 포함
        split_coords = df_gis['coordinate'].str.split(',', expand=True)
        df_gis['y'] = split_coords[0].str.strip()
        df_gis['x'] = split_coords[1].str.strip()
        # WKT 형식 생성: POINT(경도 위도)
        df_gis['geom'] = df_gis.apply(
            lambda row: f"POINT({row['x']} {row['y']})" if pd.notnull(row['x']) and pd.notnull(row['y']) else None, 
            axis=1)

    # 4. 컬럼 순서 재배치 (PNU 옆에 추출된 컬럼들 배치)
    # 기존 컬럼들: ['PNU', '원본_대지면적', '건폐율(토지이음)', '용적률(토지이음)', '상세내역']
    # 재배치: PNU, 시도, 시군구, 법정동, 지, 번, ...나머지
    cols_order = ['PNU', '시도', '시군구', '법정동', '지', '번', '원본_대지면적', '건폐율(토지이음)', '용적률(토지이음)', '상세내역', 
                  'x', 'y', 'geom']
    df_gis = df_gis[cols_order].rename(columns={
        '건폐율(토지이음)': '법정건폐율',
        '용적률(토지이음)': '법정용적률',
        '상세내역': '용도지역',
        '원본_대지면적' : '토지면적'
    })

    # ---------------------------------------------------------
    # [추가] % 제거 및 Float 형변환 로직
    # DB 모델의 db.Float 타입과 일치시키기 위해 수행함
    # ---------------------------------------------------------
    for col in ['법정건폐율', '법정용적률']:
        if col in df_gis.columns:
            # 문자열로 변환 후 % 제거
            df_gis[col] = df_gis[col].astype(str).str.replace('%', '', regex=False)
            # 숫자형(float)으로 변환, 변환 불가 값은 NaN 처리
            df_gis[col] = pd.to_numeric(df_gis[col], errors='coerce')
    # ---------------------------------------------------------

    # 5. 최종 병합
    return pd.merge(df_land, df_gis, left_on='고유번호', right_on='PNU', how='inner').drop(columns=['PNU'])
def step3_merge_building_ledger(df_base):
    """법정동코드 파일을 참조하여 PNU 생성 후 병합"""
    print("Step 3: 건축물대장 PNU 매핑 중...")
    
    # 1. 법정동코드 매핑 데이터 로드
    df_code = load_csv_safe(FILE_PNU_MAP)
    df_bldg = load_csv_safe(FILE_BLDG_CHAR)
    
    if df_code is None:
        print("⚠️ 법정동 코드 없음")
        return df_base
    
    if df_bldg is None:
        print("⚠️ 건축물대장 없음")
        return df_base

    # 법정동명 -> 코드 매핑 딕셔너리 생성 (10자리 문자열 보장)
    code_map = dict(zip(df_code['법정동명'].str.strip(), df_code['법정동코드'].astype(str).str.zfill(10)))

    # 2. 건축물대장에서 19자리 PNU 생성 함수
    def generate_bldg_pnu(row):
        try:
            # 1-10자리: 법정동코드명으로 코드 조회
            dong_name = str(row['법정동']).strip()
            sigungu_name = str(row['시군구']).strip()
            sido_name = str(row['시도']).strip()
            address = f"{sido_name} {sigungu_name} {dong_name}"
            dong_code = code_map.get(address)
            if not dong_code: return None
            
            # 11자리: 대지구분코드 (산이면 2, 아니면 1)
            gubun = '2' if '산' in str(row['대지구분']) else '1'
            
            # 12-15자리: 주지번 (4자리)
            main_no = str(int(row['번'])).zfill(4)
            
            # 16-19자리: 부지번 (4자리)
            sub_no = str(int(row['지'])).zfill(4)
            
            return f"{dong_code}{gubun}{main_no}{sub_no}"
        except:
            return None

    # 3. PNU 컬럼 생성 및 정리
    df_bldg['고유번호'] = df_bldg.apply(generate_bldg_pnu, axis=1)
    
    # 필요한 컬럼만 추출 및 이름 변경 (헤더 기준)
    bldg_subset = df_bldg[['고유번호', "대지면적(㎡)", "건축면적(㎡)","연면적(㎡)","건폐율(%)","용적률(%)","용적률산정연면적(㎡)","주용도","기타용도","지상층수","지하층수","사용승인일","승용승강기(대)","비상용승강기(대)"]].copy()
    
    # PNU가 생성되지 않은 행 및 중복 제거
    bldg_subset = bldg_subset.dropna(subset=['고유번호']).drop_duplicates('고유번호')

    # 4. 고유번호(PNU)를 기준으로 병합
    return pd.merge(df_base, bldg_subset, on='고유번호', how='left')

def step3_1_update_building_ledger(df_base):
    """
    건축물대장 총괄표제부 정보를 활용하여 기존 step3 데이터를 업데이트합니다.
    - step3의 컬럼명을 기준으로 매핑
    - 총괄표제부에 데이터가 없는 컬럼은 step3의 기존 데이터를 유지
    """
    print("Step 3-1: 건축물대장(총괄표제부) 데이터로 기존 정보 업데이트 중...")
    
    # 1. 파일 로드
    df_code = load_csv_safe(FILE_PNU_MAP)
    df_summary = load_csv_safe(FILE_SBLDG_CHAR)
    
    if df_code is None or df_summary is None:
        print("⚠️ 법정동 코드 또는 총괄표제부 파일이 없어 업데이트를 건너뜁니다.")
        return df_base

    # 2. 법정동코드 매핑 딕셔너리
    code_map = dict(zip(df_code['법정동명'].str.strip(), df_code['법정동코드'].astype(str).str.zfill(10)))

    # 3. PNU(고유번호) 생성 함수
    def generate_summary_pnu(row):
        try:
            dong_name = str(row['법정동코드명']).strip()
            sigungu_name = str(row['시군구코드명']).strip()
            address = f"{sigungu_name} {dong_name}"
            dong_code = code_map.get(address)
            if not dong_code: return None
            
            gubun = '2' if '산' in str(row['대지구분코드명']) else '1'
            main_no = str(int(row['주지번'])).zfill(4)
            sub_no = str(int(row['부지번'])).zfill(4)
            return f"{dong_code}{gubun}{main_no}{sub_no}"
        except:
            return None

    df_summary['고유번호'] = df_summary.apply(generate_summary_pnu, axis=1)
    
    # ==========================================
    # [컬럼 매핑 및 업데이트 로직]
    # ==========================================
    # Key: 총괄표제부(3_1) 컬럼명, Value: step3 기준 컬럼명
    rename_map = {
        "건축면적": "건축면적(㎡)",
        "대지면적": "대지면적(㎡)",
        "연면적": "연면적(㎡)",
        "건폐율": "건폐율(%)",
        "용적률": "용적률(%)",
        "용적률산정연면적": "용적률산정연면적(㎡)",
        "주용도코드명": "주용도",
        "기타용도내용": "기타용도",
        "승용승강기수": "승용승강기(대)",
        "비상용승강기수": "비상용승강기(대)",
        "사용승인일자": "사용승인일"
    }
    
    # 총괄표제부 데이터 정리 (필요한 컬럼만 추출 및 이름 변경)
    summary_subset = df_summary[['고유번호'] + list(rename_map.keys())].copy()
    summary_subset = summary_subset.rename(columns=rename_map)
    summary_subset = summary_subset.dropna(subset=['고유번호']).drop_duplicates('고유번호')

    # 4. 병합 (기존 데이터 df_base + 새로운 데이터 summary_subset)
    # suffixes를 붙여서 중복 컬럼을 구분합니다.
    df_merged = pd.merge(df_base, summary_subset, on='고유번호', how='left', suffixes=('', '_summary'))

    # 5. 데이터 덮어쓰기 (총괄표제부에 값이 있을 때만 업데이트)
    for target_col in rename_map.values():
        summary_col = f"{target_col}_summary"
        if summary_col in df_merged.columns:
            # 총괄표제부 데이터가 존재(not null)하면 업데이트, 아니면 기존(step3) 유지
            df_merged[target_col] = df_merged[summary_col].fillna(df_merged[target_col])
    
    # 임시 컬럼 제거 및 결과 반환
    cols_to_drop = [f"{v}_summary" for v in rename_map.values() if f"{v}_summary" in df_merged.columns]
    return df_merged.drop(columns=cols_to_drop)

def step4_absorb_annex_lots(df_final):
    """부속지번 관계표를 이용해 대표지번(고유번호)으로 면적 합산 및 부속지번 행 제거"""
    print("Step 4: 부속지번(PNU 기준) 흡수 및 정리 중...")
    df_rel = load_csv_safe(FILE_ANNEX_REL)
    if df_rel is None: return df_final
    
    # [예외 처리] 특정 PNU 유지 설정
    EXCLUDE_PNUS = ['1141011800100110209', '1141011800200110209']
    
    def get_custom_key(pnu):
        pnu_str = str(pnu).strip()
        if pnu_str in EXCLUDE_PNUS:
            return pnu_str
        return pnu_str

    # 1. 룩업용 데이터 생성 (PNU 기준)
    df_final['temp_key'] = df_final['고유번호'].apply(get_custom_key)
    pnu_lookup = df_final.drop_duplicates('temp_key').set_index('temp_key')[['토지면적', '용도지역']].to_dict('index')
    
    # 합산 정보를 저장할 딕셔너리 (Key: 대표 PNU, Value: 합산될 면적 및 용도)
    absorption_map = {}
    remove_pnus = set()

    # 2. 부속지번 관계표 처리
    # 관계표에 '대표PNU' 컬럼이 있다고 가정하거나, 주소를 PNU로 변환하는 로직이 필요합니다.
    # 여기서는 df_rel의 '대지위치'가 아닌 '고유번호'(대표지번)가 있다고 가정하거나 
    # 기존 데이터의 PNU를 기준으로 매칭합니다.
    
    for _, row in df_rel.iterrows():
        # 부속지번 관계표의 대표지번 PNU (파일 내 컬럼명에 맞춰 수정 필요: 예 '대표고유번호')
        rep_pnu = get_custom_key(row.get('고유번호', '')) 
        annex_str = str(row.get('부속지번', ''))
        if annex_str.lower() == 'nan' or not rep_pnu: continue
        
        # 부속지번 리스트 정규화
        annex_pnus = [get_custom_key(p.strip().replace("'", "")) for p in annex_str.split(',')]
        
        added_area = 0.0
        added_zones = []
        for p in annex_pnus:
            if p == rep_pnu: continue # 대표지번 본인은 제외
            if p in pnu_lookup:
                if p not in EXCLUDE_PNUS:
                    remove_pnus.add(p)
                added_area += clean_numeric(pnu_lookup[p]['토지면적'])
                added_zones.append(str(pnu_lookup[p]['용도지역']))
        
        if added_area > 0:
            if rep_pnu not in absorption_map:
                absorption_map[rep_pnu] = {'area': 0.0, 'zones': []}
            absorption_map[rep_pnu]['area'] += added_area
            absorption_map[rep_pnu]['zones'].extend(added_zones)

    # 3. 업데이트 함수 (PNU 기준 비교)
    def update_row(r):
        target_key = r['temp_key']
        if target_key in absorption_map:
            data = absorption_map[target_key]
            # 면적 합산
            r['토지면적'] = clean_numeric(r['토지면적']) + data['area']
            # 용도지역 중복 제거 및 합치기
            current_zones = str(r['용도지역']).split(',')
            combined_zones = list(set([z.strip() for z in (current_zones + data['zones']) if z and str(z).lower() != 'nan']))
            r['용도지역'] = ",".join(combined_zones)
        return r

    # 4. 데이터 적용 및 부속지번 행 제거
    df_final = df_final.apply(update_row, axis=1)
    df_final = df_final[~df_final['temp_key'].isin(remove_pnus)].drop(columns=['temp_key'])
    
    print(f"✅ 부속지번 흡수 완료 (제거된 필지: {len(remove_pnus)})")
    return df_final

# ==========================================
# [3] 메인 파이프라인 (최대한 깔끔하게 유지)
# ==========================================


def step5_fill_buildingArea(df):
    """
    건축면적이 누락된 데이터에 대해 '층별개요' 파일의 최대 층 면적을 적용
    """
    print("Step 5: 층별개요 데이터를 활용하여 누락된 건축면적 보완 중...")
    
    # 1. 파일 로드 및 코드 매핑 준비
    df_code = load_csv_safe(FILE_PNU_MAP)
    df_floor = load_csv_safe(FILE_FLOOR_CHAR)
    
    if df_code is None or df_floor is None:
        print("⚠️ 법정동 코드 또는 층별개요 파일이 없어 보완을 건너뜜.")
        return df
    
    code_map = dict(zip(df_code['법정동명'].str.strip(), df_code['법정동코드'].astype(str).str.zfill(10)))

    # 2. 층별개요 PNU 생성 함수 (기존 로직과 동일)
    def generate_floor_pnu(row):
        try:
            dong_name = str(row['법정동코드명']).strip()
            sigungu_name = str(row['시군구코드명']).strip()
            address = f"서울특별시 {sigungu_name} {dong_name}"
            dong_code = code_map.get(address)
            if not dong_code: return None
            
            gubun = '2' if '산' in str(row['대지구분코드명']) else '1'
            main_no = str(int(row['번'])).zfill(4)
            sub_no = str(int(row['지'])).zfill(4)
            return f"{dong_code}{gubun}{main_no}{sub_no}"
        except:
            return None

    # PNU 생성 및 면적 수치화
    df_floor['고유번호'] = df_floor.apply(generate_floor_pnu, axis=1)
    df_floor['면적'] = df_floor['면적'].apply(clean_numeric)
    
    # 3. 고유번호별 '최대 층 면적' 계산
    # 여러 층 중 가장 큰 면적 하나만 남김
    max_floor_area = df_floor.groupby('고유번호')['면적'].max().reset_index()
    max_floor_area.rename(columns={'면적': '최대층면적'}, inplace=True)

    # 4. 기존 df와 병합 및 업데이트
    df = pd.merge(df, max_floor_area, on='고유번호', how='left')

    # 조건: '건축면적(㎡)'이 결측치(NaN)이거나 0인 경우에만 업데이트
    mask = (df['건축면적(㎡)'].isna()) | (df['건축면적(㎡)'] == 0)
    
    # 업데이트 실행 (최대층면적이 있는 경우에만)
    df.loc[mask, '건축면적(㎡)'] = df.loc[mask, '최대층면적'].fillna(df.loc[mask, '건축면적(㎡)'])

    # 임시 컬럼 제거
    df.drop(columns=['최대층면적'], inplace=True)
    
    print(f"✅ 건축면적 보완 완료.")
    return df

def step6_fill_ratio(df):
    """
    1. 용적률산정연면적이 없는 경우: 층별개요에서 (지하, 옥탑 제외) 면적 합산하여 보완
    2. 보완된 데이터를 바탕으로 건폐율, 용적률 계산 (소수점 2자리)
    """
    print("Step 6: 용적률산정연면적 보완 및 건폐율/용적률 계산 중...")

    # ==========================================
    # [1] 용적률산정연면적 보완 (층별개요 활용)
    # ==========================================
    # 대상: 용적률산정연면적이 NaN이거나 0인 행
    mask_target = (df['용적률산정연면적(㎡)'].isna()) | (df['용적률산정연면적(㎡)'] == 0)
    
    if mask_target.any():
        df_code = load_csv_safe(FILE_PNU_MAP)
        df_floor = load_csv_safe(FILE_FLOOR_CHAR)

        if df_code is not None and df_floor is not None:
            code_map = dict(zip(df_code['법정동명'].str.strip(), df_code['법정동코드'].astype(str).str.zfill(10)))

            # PNU 생성 함수 (요청하신 로직 유지)
            def generate_floor_pnu(row):
                try:
                    dong_name = str(row['법정동코드명']).strip()
                    sigungu_name = str(row['시군구코드명']).strip()
                    address = f"서울특별시 {sigungu_name} {dong_name}"
                    dong_code = code_map.get(address)
                    if not dong_code: return None
                    
                    gubun = '2' if '산' in str(row['대지구분코드명']) else '1'
                    main_no = str(int(row['번'])).zfill(4)
                    sub_no = str(int(row['지'])).zfill(4)
                    return f"{dong_code}{gubun}{main_no}{sub_no}"
                except: return None

            df_floor['고유번호'] = df_floor.apply(generate_floor_pnu, axis=1)
            df_floor = df_floor.dropna(subset=['고유번호'])

            # 면적 수치화
            df_floor['면적_clean'] = df_floor['면적'].apply(clean_numeric)

            # 용적률 산정 제외 대상 필터링 로직
            # - '지'가 포함되어 있으면서 '지상'이 포함되지 않은 경우 (지하층)
            # - '옥탑'이 포함된 경우
            def is_far_eligible(floor_name):
                fn = str(floor_name)
                if '옥탑' in fn: return False
                if '지' in fn and '지상' not in fn: return False
                return True

            df_floor['is_eligible'] = df_floor['층번호명'].apply(is_far_eligible)

            # 대상 층만 합산 (고유번호별)
            calculated_far_area = df_floor[df_floor['is_eligible']].groupby('고유번호')['면적_clean'].sum().reset_index()
            calculated_far_area.rename(columns={'면적_clean': '보완연면적'}, inplace=True)

            # 기존 df와 병합하여 빈 값 채우기
            df = pd.merge(df, calculated_far_area, on='고유번호', how='left')
            df.loc[mask_target, '용적률산정연면적(㎡)'] = df.loc[mask_target, '보완연면적'].fillna(df.loc[mask_target, '용적률산정연면적(㎡)'])
            df.drop(columns=['보완연면적'], inplace=True)
            print(f"      ...용적률산정연면적 보완 완료")

    # ==========================================
    # [2] 건폐율 및 용적률 계산
    # ==========================================
    # 1. 용적률 계산: (용적률산정연면적 / 대지면적) * 100
    mask_far = (df['용적률(%)'].isna() | (df['용적률(%)'] == 0)) & \
               (df['용적률산정연면적(㎡)'] > 0) & (df['토지면적'] > 0)
    df.loc[mask_far, '용적률(%)'] = ((df.loc[mask_far, '용적률산정연면적(㎡)'] / df.loc[mask_far, '토지면적']) * 100).round(2)

    # 2. 건폐율 계산: (건축면적 / 대지면적) * 100
    mask_bcr = (df['건폐율(%)'].isna() | (df['건폐율(%)'] == 0)) & \
               (df['건축면적(㎡)'] > 0) & (df['토지면적'] > 0)
    df.loc[mask_bcr, '건폐율(%)'] = ((df.loc[mask_bcr, '건축면적(㎡)'] / df.loc[mask_bcr, '토지면적']) * 100).round(2)

    print(f"✅ 건폐율/용적률 계산 및 보완 완료.")
    return df
    

def step7_merge_permit_info(df_base):
    """
    [datamaker 로직 완전 복사] 건축물인허가 데이터를 PNU 기반으로 매핑
    """
    print("Step 7: 건축물인허가(주차장/대수선) PNU 매핑 중...")
    
    FILE_PERMIT = "데이터프레임/서울시_건축인허가 기본개요.csv"
    df_code = load_csv_safe(FILE_PNU_MAP)
    
    # [1] 데이터 로드 (형이 준 load_permit_data_csv 로직 그대로 사용)
    # PNU 생성을 위해 필요한 지번 컬럼들을 포함해서 읽음
    pnu_cols = ['시군구코드명', '법정동코드명', '대지구분코드명', '주지번', '부지번']
    required_cols = ['건축구분코드명', '사용승인일자', '총주차수']
    
    df_permit = load_csv_safe(FILE_PERMIT, usecols=pnu_cols + required_cols)
    
    if df_code is None or df_permit is None:
        print("⚠️ 법정동 코드 또는 인허가 파일이 없어 건너뜁니다.")
        return df_base

    # [2] PNU 생성 (형이 알려준 방식: 시군구코드명 + 법정동코드명)
    code_map = dict(zip(df_code['법정동명'].str.strip(), df_code['법정동코드'].astype(str).str.zfill(10)))

    def generate_permit_pnu(row):
        try:
            address = f"{str(row['시군구코드명']).strip()} {str(row['법정동코드명']).strip()}"
            dong_code = code_map.get(address)
            if not dong_code: return None
            
            gubun = '2' if '산' in str(row['대지구분코드명']) else '1'
            main_no = str(int(row['주지번'])).zfill(4)
            sub_no = str(int(row['부지번'])).zfill(4)
            return f"{dong_code}{gubun}{main_no}{sub_no}"
        except:
            return None

    df_permit['고유번호'] = df_permit.apply(generate_permit_pnu, axis=1)
    df_permit = df_permit.dropna(subset=['고유번호'])

    # [3] 컬럼명 매핑 (datamaker 로직: 총주차수 -> parking_count 등)
    # df_selected.columns = ['raw_address', 'type', 'app_date', 'parking_count'] 부분 재현
    df_permit = df_permit.rename(columns={
        '건축구분코드명': 'type',
        '사용승인일자': 'app_date',
        '총주차수': 'parking_count'
    })

    # [4] 날짜 및 숫자 전처리 (datamaker 메인 로직 그대로)
    df_permit['app_date'] = df_permit['app_date'].astype(str).str.replace('-', '').str.replace('.', '').str.strip()
    df_permit['app_date'] = pd.to_numeric(df_permit['app_date'], errors='coerce')
    df_permit['parking_count'] = pd.to_numeric(df_permit['parking_count'], errors='coerce').fillna(0)

    # ----------------------------------------------------
    # [A] 총주차수 매핑 (PNU별 최신 app_date 기준)
    # ----------------------------------------------------
    df_parking_agg = df_permit.sort_values('app_date', ascending=False).drop_duplicates('고유번호', keep='first')
    df_parking_agg = df_parking_agg[['고유번호', 'parking_count']].rename(columns={'parking_count': '주차장'})
    
    df_base = pd.merge(df_base, df_parking_agg, on='고유번호', how='left')
    print(f"      ...총주차수 데이터 병합 완료")

    # ----------------------------------------------------
    # [B] 대수선 및 리모델링 날짜 (exclude_types 필터링)
    # ----------------------------------------------------
    exclude_types = ['용도변경', '발코니구조변경', '허가/신고사항변경', '가설건축물축조허가']
    
    mask = ~df_permit['type'].astype(str).apply(lambda x: any(ex in x for ex in exclude_types))
    df_repair = df_permit[mask].copy()
    
    df_repair = df_repair.dropna(subset=['app_date'])
    df_repair_agg = df_repair.sort_values('app_date', ascending=False).drop_duplicates('고유번호', keep='first')
    df_repair_agg = df_repair_agg[['고유번호', 'app_date']].rename(columns={'app_date': '대수선및리모델링'})
    
    # 날짜 포맷팅 (YYYYMMDD 문자열로 변환)
    df_repair_agg['대수선및리모델링'] = df_repair_agg['대수선및리모델링'].apply(
        lambda x: str(int(x)) if pd.notna(x) else ""
    )
    
    df_base = pd.merge(df_base, df_repair_agg, on='고유번호', how='left')
    print(f"      ...유효 대수선 데이터 병합 완료")

    return df_base

def step8_merge_land_price(df_base):
    """
    [datamaker 로직 완전 복사] 개별공시지가 현재/과거 데이터 PNU 기반 매핑 및 파생변수 생성
    """
    print("Step 8: 개별공시지가(현재/과거) 데이터 매핑 및 분석 중...")

    FILE_JIGA_CURR = "데이터프레임/서울시_개별공시지가_현재.csv"
    FILE_JIGA_HIST = "데이터프레임/서울시_개별공시지가_5년전.csv"

    df_jiga_curr = load_csv_safe(FILE_JIGA_CURR)
    df_jiga_hist = load_csv_safe(FILE_JIGA_HIST)

    if df_jiga_curr is None:
        print("⚠️ 현재 공시지가 파일이 없어 건너뜁니다.")
        return df_base

    # 1. 현재 공시지가 연도 탐지 (datamaker 방식)
    def get_year(val):
        s = str(val).strip()
        return int(s[:4]) if len(s) >= 4 and s[:4].isdigit() else None

    current_year = 2024 # 기본값
    if '공시일자' in df_jiga_curr.columns:
        df_jiga_curr['temp_year'] = df_jiga_curr['공시일자'].apply(get_year)
        detected_year = df_jiga_curr['temp_year'].mode().max()
        if pd.notna(detected_year):
            current_year = int(detected_year)
    
    # datamaker의 타겟 연도 설정 로직 그대로
    year_5_ago = current_year - 4
    year_10_ago = current_year - 9
    print(f"      ...기준연도: {current_year}년 / 타겟연도: {year_5_ago}년, {year_10_ago}년")

    # 2. 현재 공시지가 병합 (PNU 기준)
    df_jiga_curr['고유번호'] = df_jiga_curr['고유번호'].astype(str)
    temp_curr = df_jiga_curr[['고유번호', '공시지가']].copy()
    temp_curr.rename(columns={'공시지가': '공시지가'}, inplace=True) # 최종 필드명
    temp_curr = temp_curr.drop_duplicates('고유번호')
    df_base = pd.merge(df_base, temp_curr, on='고유번호', how='left')

    # 3. 과거 공시지가 병합 (PNU 기준)
    if df_jiga_hist is not None and '공시일자' in df_jiga_hist.columns:
        df_jiga_hist['고유번호'] = df_jiga_hist['고유번호'].astype(str)
        df_jiga_hist['year'] = df_jiga_hist['공시일자'].apply(get_year)
        
        # 5년전 데이터 필터링 및 병합
        df_5 = df_jiga_hist[df_jiga_hist['year'] == year_5_ago][['고유번호', '공시지가']].copy()
        df_5.rename(columns={'공시지가': '공시지가5년전'}, inplace=True)
        df_base = pd.merge(df_base, df_5.drop_duplicates('고유번호'), on='고유번호', how='left')
        
        # 10년전 데이터 필터링 및 병합
        df_10 = df_jiga_hist[df_jiga_hist['year'] == year_10_ago][['고유번호', '공시지가']].copy()
        df_10.rename(columns={'공시지가': '공시지가10년전'}, inplace=True)
        df_base = pd.merge(df_base, df_10.drop_duplicates('고유번호'), on='고유번호', how='left')
        print(f"      ...과거 데이터 병합 완료")
    return df_base

def step9_carc_rename_col(df):
    """마무리 단계로 연산이 필요한 컬럼을 추가하고, 컬럼명을 조정"""
    print("Step 9: 주소 생성(위치 조정), 엘리베이터 합산 및 컬럼명 변경 중...")

    # 1. 주소 데이터 생성 및 위치 조정
    if '법정동' in df.columns:
        # 원래 '법정동'이 있던 열의 인덱스 번호를 저장
        target_idx = df.columns.get_loc('법정동')
        
        # 주소 문자열 생성 로직
        def format_address(row):
            try:
                dong = str(row.get('법정동', '')).strip()
                ji = str(row.get('지', '')).strip()
                beon = str(row.get('번', '')).strip()
                if not ji: return dong
                if beon in ['0', '0000', '', 'nan']:
                    return f"{dong} {ji}"
                else:
                    return f"{dong} {ji}-{beon}"
            except:
                return ""

        address_series = df.apply(format_address, axis=1)

        # 기존 컬럼들 삭제 (법정동, 지, 번)
        # errors='ignore'를 넣어 해당 컬럼이 혹시 없더라도 에러가 나지 않게 방어
        df.drop(columns=['법정동', '지', '번'], inplace=True, errors='ignore')

        # 저장해둔 인덱스(target_idx) 위치에 '주소' 컬럼 삽입
        df.insert(target_idx, '주소', address_series)

    # 2. 엘리베이터 합산 (승용 + 비상)
    lift_cols = ["승용승강기(대)", "비상용승강기(대)"]
    for col in lift_cols:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors='coerce').fillna(0)
    
    if all(col in df.columns for col in lift_cols):
        df['엘리베이터'] = df["승용승강기(대)"] + df["비상용승강기(대)"]

    # 3. 컬럼명 변경
    renameCol = {
        "지목명": "지목", 
        "지형형상": "형상",
        "대지면적(㎡)": "대지면적",
        "건축면적(㎡)": "건축면적", 
        "연면적(㎡)": "연면적", 
        "건폐율(%)": "건폐율", 
        "용적률(%)": "용적률", 
        "용적률산정연면적(㎡)": "용적률산정연면적",
        "지하층수": "규모지하", 
        "지상층수": "규모지상",
    }
    
    df = df.rename(columns=renameCol)
    
    return df

def step10_finalize_for_models(df):
    """
    models.py의 데이터 타입 및 컬럼명 규격에 맞게 최종 형변환 및 순서 정리
    """
    print("Step 10: models.py 규격에 따른 최종 데이터 정리 및 형변환 중...")

    df = df.rename(columns={'도로접면': '도로'})

    # 1. 컬럼 리스트 정의 (models.py의 name 속성 기준 순서)
    target_columns = [
        "고유번호", "토지이용상황", "시도", "시군구", "주소", "지목", "형상", "도로",
        "토지면적","대지면적", "연면적", "건축면적", "용도지역", "주용도", "기타용도", "건폐율", "법정건폐율",
        "용적률", "법정용적률", "용적률산정연면적", "규모지상", "규모지하", "엘리베이터", "주차장",
        "사용승인일", "대수선및리모델링", "공시지가", "공시지가5년전", "공시지가10년전",
        
         "x", "y", "geom"
    ]

    # 2. 누락된 컬럼 추가 (None으로 채움)
    for col in target_columns:
        if col not in df.columns:
            df[col] = None

    # 3. 데이터 타입별 형변환 헬퍼 함수
    def to_float(val):
        try:
            if pd.isna(val) or str(val).strip() in ['', '-', 'nan']: return 0.0
            # % 기호 및 콤마 제거 후 실수 변환
            return float(str(val).replace('%', '').replace(',', '').strip())
        except: return 0.0

    def to_int(val):
        try:
            if pd.isna(val) or str(val).strip() in ['', '-', 'nan']: return 0
            return int(float(str(val).replace(',', '').strip()))
        except: return 0

    def to_date_str(val):
        """DB의 Date 타입 적재를 위해 YYYY-MM-DD 문자열로 변환"""
        if pd.isna(val) or str(val).strip() in ['', '-', 'nan', '0']: return None
        try:
            # 다양한 날짜 형식(20240101, 2024.01.01 등)을 pd.to_datetime으로 통합 처리
            return pd.to_datetime(str(val)).strftime('%Y-%m-%d')
        except: return None

    # 4. models.py 타입에 맞춘 일괄 변환 실행
    # [Float 군]
    float_cols = ["토지면적", "대지면적", "연면적", "건축면적", "건폐율", "법정건폐율", "용적률", "법정용적률", "용적률산정연면적", "x", "y"]
    # [Integer 군]
    int_cols = ["규모지상", "규모지하", "엘리베이터", "주차장"]
    # [Numeric 군] - 파이썬에서는 float로 변환하여 적재
    numeric_cols = [
        "공시지가", "공시지가5년전", "공시지가10년전"]
    # [Date 군]
    date_cols = ["사용승인일", "대수선및리모델링"]

    for col in float_cols: df[col] = df[col].apply(to_float)
    for col in int_cols: df[col] = df[col].apply(to_int)
    for col in numeric_cols: df[col] = df[col].apply(to_float)
    for col in date_cols: df[col] = df[col].apply(to_date_str)

    # 5. 컬럼 순서 재배열 및 최종 결과 반환
    return df[target_columns]


def run_total_merge_pipeline():
    """전체 공정을 지휘하는 메인 함수"""
    print("🚀 데이터 병합 파이프라인 시작...")
    
    # 1. 토지 기본 데이터 구성
    df = step1_prepare_land_base()
    if df is None: return
    
    # 2. GIS 정보 추가 (PNU 기준)
    df = step2_merge_gis_info(df)
    
    # 3. 건축물 정보 추가 (주소 기준)
    df = step3_merge_building_ledger(df)

    df = step3_1_update_building_ledger(df)
    
    # # # 4. 부속지번 통합 및 정리
    df = step4_absorb_annex_lots(df)
    
    df = step5_fill_buildingArea(df)
    
    df = step6_fill_ratio(df)

    df = step7_merge_permit_info(df)

    df = step8_merge_land_price(df)

    df = step9_carc_rename_col(df)

    df = step10_finalize_for_models(df)
    
    # 최종 결과 저장
    df.to_csv("seoul_land_final_result.csv", index=False, encoding='utf-8-sig')
    print(f"✅ 모든 병합 완료! 최종 데이터: {len(df):,}건")

if __name__ == "__main__":
    run_total_merge_pipeline()