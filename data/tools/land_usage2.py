import pandas as pd
import os

# 1. models.py 기준 SeoulLandInfo 테이블 컬럼 정의 (순서 보장)
MODEL_COLUMNS = [
    "고유번호", "토지이용상황", "시도", "시군구", "주소", "지목", "형상", "도로", 
    "토지면적", "대지면적", "연면적", "건축면적", "용도지역", "주용도", "기타용도", "건폐율", "법정건폐율", 
    "용적률", "법정용적률", "용적률산정연면적", "규모지상", "규모지하", "엘리베이터", "주차장", 
    "사용승인일", "대수선및리모델링", "공시지가", "공시지가5년전", "공시지가10년전", "x", "y", "geom"
]

def main():
    # 1. CSV 데이터 로드
    csv_file = 'data.csv'
    if not os.path.exists(csv_file):
        print(f"❌ 에러: {csv_file} 파일을 찾을 수 없습니다.")
        return

    df = pd.read_csv(csv_file)
    print(f"📂 {csv_file} 로드 완료 (행 수: {len(df)})")

    # 2. 모델 컬럼 정규화
    # CSV에 없는 컬럼은 None으로 채우고, 있는 컬럼은 순서를 맞춤
    for col in MODEL_COLUMNS:
        if col not in df.columns:
            df[col] = None
            
    final_df = df[MODEL_COLUMNS]

    # 3. SQL 생성 (COPY 구문)
    output_file = 'final_sync_data.sql'
    with open(output_file, 'w', encoding='utf-8') as f:
        # 헤더 작성
        col_str = ', '.join([f'"{c}"' for c in MODEL_COLUMNS])
        f.write(f'COPY public.seoul_land_info ({col_str}) FROM stdin;\n')
        
        # 데이터 행 작성
        for _, row in final_df.iterrows():
            row_data = []
            for val in row:
                # NULL 값 처리 (\N)
                if pd.isna(val) or val is None:
                    row_data.append('\\N')
                else:
                    # 데이터 정제: 탭, 줄바꿈 제거 및 백슬래시 이스케이프
                    if isinstance(val, float) and val.is_integer():
                        clean_val = str(int(val))
                    else:
                        clean_val = str(val)
                    
                    clean_val = clean_val.replace('\\', '\\\\')
                    clean_val = clean_val.replace('\t', ' ').replace('\n', ' ').replace('\r', ' ')
                    row_data.append(clean_val)
            
            f.write('\t'.join(row_data) + '\n')
            
        # 종료 기호
        f.write('\\.\n')

    print(f"✅ 변환 완료! {output_file} 파일이 생성되었습니다.")

if __name__ == "__main__":
    main()