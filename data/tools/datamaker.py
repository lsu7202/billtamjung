import pandas as pd
import unicodedata
from sqlalchemy import create_engine
import os
import warnings
import numpy as np

# 경고 메시지 무시
warnings.filterwarnings('ignore')

# -------------------------------------------------------
# 1. 유틸리티 함수
# -------------------------------------------------------
def clean_text(text):
    if pd.isna(text): return ""
    text = str(text)
    text = unicodedata.normalize('NFC', text)
    return " ".join(text.split())

# 숫자 변환 전처리 함수
def clean_numeric_value(val):
    if pd.isna(val): return 0.0
    s = str(val).strip()
    if s == '' or s == '-': return 0.0
    s = s.replace(',', '').replace('%', '')
    try:
        return float(s)
    except ValueError:
        return 0.0

def get_year_from_date(date_val):
    """ 날짜 문자열(2023-01-01 or 20230101)에서 연도(int) 추출 """
    s = str(date_val).strip()
    if len(s) >= 4:
        try:
            return int(s[:4])
        except:
            return None
    return None

def load_public_data(file_path):
    if not os.path.exists(file_path):
        print(f"❌ 파일 없음: {file_path}")
        return None
    encodings = ['cp949', 'euc-kr', 'utf-8', 'utf-8-sig']
    for enc in encodings:
        try:
            df = pd.read_csv(
                file_path, encoding=enc, encoding_errors='replace',
                on_bad_lines='skip', low_memory=False
            )
            df.columns = df.columns.str.strip()
            print(f"   ✅ [공공데이터] 로드 성공: {file_path} ({enc})")
            return df
        except Exception as e: continue
    print(f"❌ [치명적] 로드 실패: {file_path}")
    return None

def load_our_data(file_path):
    if not os.path.exists(file_path):
        print(f"❌ 파일 없음: {file_path}")
        return None
    try:
        df = pd.read_csv(file_path, encoding='utf-8-sig', low_memory=False)
        df.columns = df.columns.str.strip()
        print(f"   ✅ [GIS데이터] 로드 성공: {file_path} (utf-8-sig)")
        return df
    except Exception as e:
        print(f"❌ GIS 데이터 로드 실패: {e}")
        return None

def load_permit_data_csv(file_path):
    if not os.path.exists(file_path):
        print(f"❌ 파일 없음: {file_path}")
        return None
    encodings = ['cp949', 'euc-kr', 'utf-8', 'utf-8-sig']
    for enc in encodings:
        try:
            df = pd.read_csv(file_path, encoding=enc, low_memory=False, on_bad_lines='skip')
            df.columns = df.columns.str.strip()
            
            # [수정] 필요한 컬럼에 '총주차수' 확인
            required_cols = ['대지위치', '건축구분코드명', '사용승인일자', '총주차수']
            if not all(col in df.columns for col in required_cols): continue 
            
            df_selected = df[required_cols].copy()
            # [수정] 컬럼명 매핑 (총주차수 -> parking_count)
            df_selected.columns = ['raw_address', 'type', 'app_date', 'parking_count']
            
            print(f"   ✅ [인허가데이터] 로드 성공: {file_path} ({enc})")
            return df_selected
        except Exception as e: continue
    print(f"❌ 인허가 데이터 로드 실패: {file_path}")
    return None

def 판별_구분상가(row):
    kind = str(row.get('대장구분코드명', '')).strip()
    usage = str(row.get('주용도코드명', '')).strip()
    if kind != '집합': return ''
    상가용도 = ['제1종근린생활시설', '제2종근린생활시설', '판매시설', '업무시설', '숙박시설', '위락시설', '근린생활시설']
    if any(target in usage for target in 상가용도): return '구분'
    return ''

def calculate_growth_rate(current, past):
    if pd.isna(current) or pd.isna(past) or past == 0: return 0.0
    return round(((current - past) / past) * 100, 2)

# 00000000 형식
def format_date_str(val):
    if pd.isna(val) or str(val).strip() == '': return None
    val_str = str(val).replace('-', '').replace('.', '').strip()[:8]
    if len(val_str) != 8: return val_str
    return f"{val_str[:4]}{val_str[4:6]}{val_str[6:]}"

# -------------------------------------------------------
# 2. 메인 로직
# -------------------------------------------------------

input_file_land = "데이터프레임/서울시_토지특성정보.csv"
input_file_bldg = "데이터프레임/서울시 건축물대장 표제부.csv" 
input_file_gis  = "seoul_exact_luris_final.csv"
input_file_permit = "데이터프레임/서울시_건축인허가 기본개요.csv" 

# 공시지가 파일
input_file_jiga_currrent = "데이터프레임/서울시_개별공시지가_현재.csv"
input_file_jiga_history = "데이터프레임/서울시_개별공시지가_5년전.csv"

print("📂 데이터 로딩 시작...")

df_land = load_public_data(input_file_land)
df_bldg = load_public_data(input_file_bldg)
df_gis  = load_our_data(input_file_gis)
df_permit = load_permit_data_csv(input_file_permit)

df_jiga_curr = load_public_data(input_file_jiga_currrent)
df_jiga_hist = load_public_data(input_file_jiga_history)

if df_land is not None and df_bldg is not None and df_gis is not None:
    print("\n✅ 필수 파일 로드 완료. 데이터 병합 프로세스 시작...")

    # [A] 토지 데이터 전처리
    print("   -> [1/6] 토지 데이터 처리 중...")
    cols_land = ['고유번호', '법정동명', '지번', '지목명', '토지이용상황', '지형형상', '도로접면']
    valid_cols_land = [c for c in cols_land if c in df_land.columns]
    df_land = df_land[valid_cols_land].copy()

    target_jimo = ['대', '잡종지', '공장용지', '주차장']
    jimo_col = '지목명' if '지목명' in df_land.columns else '지목코드명'
    if jimo_col in df_land.columns:
        df_land = df_land[df_land[jimo_col].isin(target_jimo)].copy()

    df_land['통합주소'] = (df_land['법정동명'].astype(str) + " " + df_land['지번'].astype(str)).apply(clean_text)
    if '고유번호' in df_land.columns:
        df_land['고유번호'] = df_land['고유번호'].astype(str)

    # [A-2] 공시지가 병합
    print("   -> [1-1/6] 공시지가 연도별 매칭 중...")
    
    current_year = 2024 # 기본값
    if df_jiga_curr is not None and '공시일자' in df_jiga_curr.columns:
        df_jiga_curr['temp_year'] = df_jiga_curr['공시일자'].apply(get_year_from_date)
        detected_year = df_jiga_curr['temp_year'].mode().max()
        if pd.notna(detected_year):
            current_year = int(detected_year)
            print(f"      ...현재 공시지가 기준 연도: {current_year}년")

    year_5_ago = current_year - 4
    year_10_ago = current_year - 9
    
    print(f"      ...타겟 연도 설정: 5년전({year_5_ago}), 10년전({year_10_ago})")

    if df_jiga_curr is not None:
        temp_curr = df_jiga_curr[['고유번호', '공시지가']].copy()
        temp_curr['고유번호'] = temp_curr['고유번호'].astype(str)
        temp_curr.rename(columns={'공시지가': '공시지가(현재)'}, inplace=True)
        temp_curr = temp_curr.drop_duplicates('고유번호')
        df_land = pd.merge(df_land, temp_curr, on='고유번호', how='left')

    if df_jiga_hist is not None and '공시일자' in df_jiga_hist.columns:
        df_jiga_hist['year'] = df_jiga_hist['공시일자'].apply(get_year_from_date)
        
        df_5 = df_jiga_hist[df_jiga_hist['year'] == year_5_ago][['고유번호', '공시지가']].copy()
        df_5['고유번호'] = df_5['고유번호'].astype(str)
        df_5.rename(columns={'공시지가': '공시지가(5년전)'}, inplace=True)
        df_5 = df_5.drop_duplicates('고유번호')
        
        df_10 = df_jiga_hist[df_jiga_hist['year'] == year_10_ago][['고유번호', '공시지가']].copy()
        df_10['고유번호'] = df_10['고유번호'].astype(str)
        df_10.rename(columns={'공시지가': '공시지가(10년전)'}, inplace=True)
        df_10 = df_10.drop_duplicates('고유번호')
        
        df_land = pd.merge(df_land, df_5, on='고유번호', how='left')
        df_land = pd.merge(df_land, df_10, on='고유번호', how='left')
        
        print(f"      ...과거 데이터 병합 완료 ({len(df_5)}건, {len(df_10)}건)")

    # [B] GIS 데이터 병합
    print("   -> [2/6] GIS 데이터 매칭 중...")
    if 'PNU' not in df_gis.columns:
        for c in df_gis.columns:
            if 'PNU' in str(c): df_gis.rename(columns={c: 'PNU'}, inplace=True); break
    
    if 'PNU' in df_gis.columns:
        df_gis['PNU'] = df_gis['PNU'].astype(str)
        cols_to_merge = ['PNU', '건폐율(토지이음)', '용적률(토지이음)', '산정_층수', '상세내역']
        valid_gis_cols = [c for c in cols_to_merge if c in df_gis.columns]
        df_land = pd.merge(df_land, df_gis[valid_gis_cols], left_on='고유번호', right_on='PNU', how='left')
        
        df_land.rename(columns={
            '건폐율(토지이음)':'법정건폐율', 
            '용적률(토지이음)':'법정용적율', 
            '상세내역':'용도지역', 
             
        }, inplace=True)

    # [C] 건물 데이터 전처리
    print("   -> [3/6] 건물 데이터 컬럼 매핑...")
    rename_map_bldg = {
        '대지_위치': '대지위치', '주_용도_코드_명': '주용도코드명', '대장_종류_코드_명': '대장구분코드명', '대장_구분_코드_명': '대장구분코드명', '대지_면적':'대지면적',
        '연_면적': '연면적', '건축_면적': '건축면적', '건폐_율': '건폐율', '용적_율': '용적률', '용적_율_산정_연_면적': '용적률산정연면적',
        '사용_승인_일': '사용승인일자', '지상_층_수': '지상층수', '지하_층_수': '지하층수', '승용_승강기_수': '승용승강기수', '비상용_승강기_수': '비상용승강기수', '기타_용도': '기타용도내용'
    }
    df_bldg.rename(columns=rename_map_bldg, inplace=True)

    if '대장구분코드명' in df_bldg.columns and '주용도코드명' in df_bldg.columns:
        df_bldg['구분상가'] = df_bldg.apply(판별_구분상가, axis=1)
    else:
        df_bldg['구분상가'] = ''
        
    if '대지위치' in df_bldg.columns:
        df_bldg['통합주소'] = df_bldg['대지위치'].astype(str).str.replace('번지', '').apply(clean_text)

    # [D] 인허가(대수선, 주차장) 데이터 처리
    print("   -> [4/6] 인허가(대수선, 주차장) 데이터 처리 중...")
    if df_permit is not None:
        
        # 1. 인허가 데이터 주소 정리
        df_permit['통합주소'] = df_permit['raw_address'].astype(str).str.replace('번지', '').apply(clean_text)
        
        # 2. 날짜 전처리
        df_permit['app_date'] = df_permit['app_date'].astype(str).str.replace('-', '').str.replace('.', '').str.strip()
        df_permit['app_date'] = pd.to_numeric(df_permit['app_date'], errors='coerce')

        # ----------------------------------------------------
        # [수정] 3. 총주차수 매핑 (주소별 최신 데이터 기준)
        # ----------------------------------------------------
        # 주차수는 'parking_count' 컬럼에 있음 (load_permit_data_csv에서 이름 변경됨)
        # 같은 주소에 여러 인허가가 있을 경우, 날짜(app_date) 내림차순 정렬 후 가장 최신(첫번째) 값을 사용
        df_parking = df_permit.copy()
        df_parking['parking_count'] = pd.to_numeric(df_parking['parking_count'], errors='coerce').fillna(0)
        
        # 날짜순 정렬 -> 주소별 중복 제거(첫번째 유지) -> 주차수만 남김
        df_parking_agg = df_parking.sort_values('app_date', ascending=False).drop_duplicates('통합주소', keep='first')
        df_parking_agg = df_parking_agg[['통합주소', 'parking_count']]
        
        # 토지 데이터에 병합
        print(f"      ...총주차수 데이터 {len(df_parking_agg)}건 병합 준비")
        df_land = pd.merge(df_land, df_parking_agg, on='통합주소', how='left')

        # ----------------------------------------------------
        # 4. 대수선 및 리모델링 날짜 처리 (기존 로직 유지)
        # ----------------------------------------------------
        exclude_types = ['용도변경', '발코니구조변경', '허가/신고사항변경', '가설건축물축조허가']
        if 'type' in df_permit.columns:
            mask = ~df_permit['type'].astype(str).apply(lambda x: any(ex in x for ex in exclude_types))
            df_repair = df_permit[mask].copy()
            
            df_repair = df_repair.dropna(subset=['app_date'])
            df_repair_agg = df_repair.sort_values('app_date', ascending=False).drop_duplicates('통합주소', keep='first')
            df_repair_agg = df_repair_agg[['통합주소', 'app_date']].rename(columns={'app_date': '대수선 및 리모델링'})
            
            print(f"      ...유효 대수선 데이터 {len(df_repair_agg)}건 병합")
            df_land = pd.merge(df_land, df_repair_agg, on='통합주소', how='left')
    
    # [E] 최종 병합
    print("   -> [5/6] 최종 병합...")
    df_matched = pd.merge(df_land, df_bldg, on='통합주소', how='left', suffixes=('', '_건물'))

    # [F] 파생 변수 계산 및 최종 필드 정리
    print("   -> [6/6] 파생 변수 계산 및 최종 필드 정리...")

    # (1) 통합주소 분리
    def split_addr(addr):
        parts = str(addr).split()
        if len(parts) >= 2:
            return parts[0], parts[1], " ".join(parts[2:])
        return "", "", str(addr)

    addr_split = df_matched['통합주소'].apply(split_addr)
    df_matched['시/도'] = [x[0] for x in addr_split]
    df_matched['시/군/구'] = [x[1] for x in addr_split]
    df_matched['주소'] = [x[2] for x in addr_split]

    # (2) 숫자형 데이터 안전 변환 (주차수 추가)
    numeric_cols = ['공시지가(현재)', '공시지가(5년전)', '공시지가(10년전)', '대지면적', 
                    '건폐율', '법정건폐율', '용적률', '법정용적율', 
                    '승용승강기수', '비상용승강기수', 'parking_count']
    
    for c in numeric_cols:
        if c in df_matched.columns:
            df_matched[c] = df_matched[c].apply(clean_numeric_value)
    
    # (3) 파생 변수 계산
    df_matched['엘리베이터'] = df_matched.get('승용승강기수', 0) + df_matched.get('비상용승강기수', 0)
    df_matched['건폐율 - 법정건폐율'] = (df_matched.get('건폐율', 0) - df_matched.get('법정건폐율', 0)).round(2)
    df_matched['용적률 - 법정용적률'] = (df_matched.get('용적률', 0) - df_matched.get('법정용적율', 0)).round(2)

    df_matched['공시지가 상승률(5년)'] = df_matched.apply(lambda x: calculate_growth_rate(x.get('공시지가(현재)'), x.get('공시지가(5년전)')), axis=1)
    df_matched['공시지가 상승률(10년)'] = df_matched.apply(lambda x: calculate_growth_rate(x.get('공시지가(현재)'), x.get('공시지가(10년전)')), axis=1)

    # 공시지가 기준
    if '대지면적' in df_matched.columns and '공시지가(현재)' in df_matched.columns:
        df_matched['공시지가 기준'] = ((df_matched['공시지가(현재)'] * df_matched['대지면적'] * 1.9) / 100000000).round(2)
    else:
        df_matched['공시지가 기준'] = 0.0

    # (4) 날짜 포맷팅
    if '사용승인일자' in df_matched.columns:
        df_matched['사용승인일자'] = df_matched['사용승인일자'].apply(format_date_str)
    if '대수선 및 리모델링' in df_matched.columns:
        df_matched['대수선 및 리모델링'] = df_matched['대수선 및 리모델링'].apply(format_date_str)

    # (5) 빈 필드 생성
    empty_fields = [
        '매매가(억)', '총공시지가와 매매가 비율', 
        '상황', '긴급도', '등급', '컨디션', '입지', '매수의향서','연락처','성향','관계','사진','브리핑','두꺼비광고등록유무','건물용도','신축비용','리모델링비용','지주상황',
        '명도','용도변경','멸실','영상번호/분/초', 
        'AI추정가','AI추정가와 매매가 비율','총보증금','총월세(부가세 별도)','총관리비','수익률'
    ]
    for col in empty_fields:
        df_matched[col] = 0.0 if ('매매가' in col or '비율' in col) else ""

    # (6) 최종 컬럼 매핑
    final_rename_map = {
        '통합주소': '통합주소', '고유번호': '고유번호', '토지이용상황':'토지이용상황',
        '시/도': '시도', '시/군/구': '시군구', '주소': '주소',
        '지목명': '지목', '지형형상': '형상', '도로접면': '도로',
        '대지면적': '대지면적', '연면적': '연면적', '건축면적': '건축면적',
        '용도지역': '용도지역', '주용도코드명': '주용도', '기타용도내용': '기타용도',
        '건폐율': '건폐율', '법정건폐율': '법정건폐율', '건폐율 - 법정건폐율': '건폐율법정건폐율',
        '용적률': '용적률', '법정용적율': '법정용적률', '용적률 - 법정용적률': '용적률법정용적률',
        '용적률산정연면적': '용적률산정용연면적',
        '지상층수': '규모지상', '지하층수': '규모지하', '엘리베이터': '엘리베이터',
        'parking_count': '주차장', 
        '사용승인일자': '사용승인일', '대수선 및 리모델링': '대수선및리모델링',
        '구분상가': '구분상가구분',
        '공시지가(현재)': '공시지가',
        '공시지가(5년전)': '공시지가5년전',
        '공시지가(10년전)': '공시지가10년전', 
        '공시지가 상승률(5년)': '공시지가상승률5년',
        '공시지가 상승률(10년)': '공시지가상승률10년',
        '공시지가 기준': '공시지가기준',
        '매매가(억)': '매매가억', '총공시지가와 매매가 비율': '총공시지가와매매가비율',
        '상황': '상황', '긴급도': '긴급도', '등급': '등급', '컨디션': '컨디션', '입지': '입지',
        '매수의향서':'매수의향서','연락처':'연락처','성향':'성향','관계':'관계','사진':'사진','브리핑':'브리핑',
            '두꺼비광고등록유무':'두꺼비광고등록유무','건물용도':'건물용도','신축비용':'신축비용','리모델링비용':'리모델링비용','지주상황':'지주상황',
            '명도':'명도','용도변경':'용도변경','멸실':'멸실','영상번호/분/초':'영상번호분초',
            'AI추정가':'AI추정가','AI추정가와 매매가 비율':'AI추정가 매매가 비율','총보증금':'총보증금','총월세(부가세 별도)':'총월세부가세별도','총관리비':'총관리비','수익률':'수익률'
    }

    available_cols = [c for c in final_rename_map.keys() if c in df_matched.columns]
    df_to_upload = df_matched[available_cols].copy()
    df_to_upload.rename(columns=final_rename_map, inplace=True)
    
    # -------------------------------------------------------
    # [G] (수정됨) 대표지번에 부속지번 데이터 흡수 및 부속지번 행 삭제
    # -------------------------------------------------------
    input_file_relation = "부속지번_관계표.csv"  

    if os.path.exists(input_file_relation):
        print("\n🔍 [DEBUG] 부속지번 흡수 및 정리 작업 시작...")
        try:
            df_rel = pd.read_csv(input_file_relation, encoding='utf-8')
            
            df_to_upload['고유번호'] = df_to_upload['고유번호'].astype(str)
            
            # [함수] PNU 정규화 (11번째 대지구분코드 무시)
            def get_normalized_pnu(pnu):
                s = str(pnu).strip()
                if len(s) == 19:
                    return s[:10] + s[11:] # 11번째 자리 제외하고 합침
                return s

            # 1. Lookup Dictionary 생성 (Key: 정규화된 PNU)
            pnu_lookup = {}
            for idx, row in df_to_upload.iterrows():
                norm_key = get_normalized_pnu(row['고유번호'])
                pnu_lookup[norm_key] = {
                    '대지면적': row['대지면적'],
                    '용도지역': row['용도지역']
                }
            
            absorption_map = {} 
            pnu_to_remove_set = set() # [추가] 삭제할 부속지번 PNU(정규화됨)를 담을 집합
            
            # 2. 관계표 순회하며 흡수할 데이터 계산 및 삭제 대상 수집
            for _, row in df_rel.iterrows():
                raw_addr = str(row.get('대지위치', ''))
                target_addr = clean_text(raw_addr.replace('번지', '')) 
                
                annex_pnus_str = str(row.get('부속지번', ''))
                
                if not annex_pnus_str or annex_pnus_str.lower() == 'nan': continue
                
                annex_pnus = [x.strip().replace('"', '').replace("'", "") for x in annex_pnus_str.split(',')]

                added_area = 0.0
                added_zones = []
                
                for pnu in annex_pnus:
                    target_key = get_normalized_pnu(pnu)
                    
                    if target_key in pnu_lookup:
                        # [추가] 데이터가 존재하면 삭제 목록에 추가
                        pnu_to_remove_set.add(target_key)
                        
                        data_row = pnu_lookup[target_key]
                        raw_area = data_row['대지면적']
                        try:
                            area_val = float(raw_area) if isinstance(raw_area, (int, float)) else clean_numeric_value(raw_area)
                        except: area_val = 0.0
                        added_area += area_val

                        zone_val = str(data_row['용도지역']).strip()
                        if zone_val and zone_val != 'nan': added_zones.append(zone_val)

                if added_area > 0 or added_zones:
                    absorption_map[target_addr] = {'add_area': added_area, 'add_zones': added_zones}

            # 3. 데이터 흡수 적용 (대표지번 행 업데이트)
            def apply_absorption(row):
                addr = row['통합주소']
                if addr in absorption_map:
                    data = absorption_map[addr]
                    
                    old_area = row['대지면적']
                    base_area = float(old_area) if isinstance(old_area, (int, float)) else clean_numeric_value(old_area)
                    row['대지면적'] = base_area + data['add_area']
                    
                    current_zone = str(row['용도지역']).strip()
                    if current_zone == 'nan': current_zone = ''
                    annex_zone_str = ",".join(data['add_zones'])
                    
                    if current_zone and annex_zone_str: row['용도지역'] = f"{current_zone},{annex_zone_str}"
                    elif annex_zone_str: row['용도지역'] = annex_zone_str
                        
                return row

            df_to_upload = df_to_upload.apply(apply_absorption, axis=1)

            # 4. [추가] 부속지번 행 삭제 절차
            if pnu_to_remove_set:
                print(f"   🧹 부속지번 행 삭제 시작... (삭제 대상 PNU: {len(pnu_to_remove_set)}개)")
                initial_count = len(df_to_upload)
                
                # 삭제를 위해 현재 DF에도 정규화 키 생성
                df_to_upload['temp_norm_key'] = df_to_upload['고유번호'].apply(get_normalized_pnu)
                
                # 정규화 키가 삭제 목록에 없는 것만 남김 (~)
                df_to_upload = df_to_upload[~df_to_upload['temp_norm_key'].isin(pnu_to_remove_set)].copy()
                
                # 임시 키 컬럼 제거
                df_to_upload.drop(columns=['temp_norm_key'], inplace=True)
                
                print(f"      ...삭제 완료: {initial_count}건 -> {len(df_to_upload)}건 ({initial_count - len(df_to_upload)}건 삭제됨)")

        except Exception as e:
            print(f"❌ 부속지번 흡수 및 삭제 작업 중 오류 발생: {e}")
            import traceback
            traceback.print_exc()
    else:
        print(f"⚠️ 경고: 부속지번 관계 파일({input_file_relation}) 없음.")
    
    try:
        engine = create_engine('postgresql+psycopg2://iseung-ug:1234@localhost:5050/postgres')
        df_to_upload.to_sql('seoul_land_info', con=engine, if_exists='replace', index=False, chunksize=5000)
        print("   ✅ DB 저장 완료")
        
        csv_filename = "seoul_land_info_final.csv"
        df_to_upload.to_csv(csv_filename, index=False, encoding='utf-8-sig')
        print(f"   ✅ CSV 저장 완료 ('{csv_filename}')")
        
        # 확인용 샘플 출력
        print("\n[저장 데이터 샘플]")
        cols_check = ['통합주소', '총주차수', '대수선 및 리모델링']
        print(df_to_upload[[c for c in cols_check if c in df_to_upload.columns]].head(3))
        
    except Exception as e:
        print(f"❌ 저장 오류: {e}")