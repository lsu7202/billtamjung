"""건축HUB 마트(전국 txt)에서 서울(시군구코드 11xxx) 행만 추출 → data/raw/seoul/
바이트 단위 스트리밍(디코딩 없음) — 시군구코드 컬럼 인덱스는 파일별 상이(표본으로 검증)."""
import os, sys, time

RAW = os.path.join(os.path.dirname(__file__), '..', 'raw')
OUT = os.path.join(RAW, 'seoul')
os.makedirs(OUT, exist_ok=True)

# 파일별 시군구코드 컬럼 인덱스 (0-base, 첫 행 표본으로 확인)
SGG_COL = {
    'mart_djy_01.txt': 9,
    'mart_djy_02.txt': 10,
    'mart_djy_03.txt': 8,
    'mart_djy_04.txt': 4,
    'mart_djy_05.txt': 8,
    'mart_djy_09.txt': 8,
    'mart_kcy_05.txt': 3,
    'mart_kcy_10.txt': 2,
    'mart_kcy_11.txt': 2,
    'mart_kcy_15.txt': 2,
}

def validate(path, col, n=2000):
    """표본 n행에서 해당 컬럼이 5자리 숫자인지 검증"""
    ok = bad = 0
    with open(path, 'rb') as f:
        for i, line in enumerate(f):
            if i >= n: break
            parts = line.rstrip(b'\r\n').split(b'|')
            if col < len(parts) and len(parts[col]) == 5 and parts[col].isdigit(): ok += 1
            else: bad += 1
    return ok, bad

def extract(fname, col):
    src = os.path.join(RAW, fname)
    dst = os.path.join(OUT, fname.replace('.txt', '_seoul.txt'))
    t0 = time.time(); n_in = n_out = 0
    with open(src, 'rb') as fi, open(dst, 'wb') as fo:
        for line in fi:
            n_in += 1
            parts = line.split(b'|')
            if col < len(parts) and parts[col].startswith(b'11'):
                fo.write(line); n_out += 1
    print(f"{fname}: {n_in:,}행 중 서울 {n_out:,}행 ({time.time()-t0:.0f}s) → {os.path.basename(dst)}", flush=True)

if __name__ == '__main__':
    for fname, col in SGG_COL.items():
        src = os.path.join(RAW, fname)
        if not os.path.exists(src):
            print(f"{fname}: 없음, 건너뜀", flush=True); continue
        ok, bad = validate(src, col)
        if bad > ok * 0.01:
            print(f"⚠️ {fname}: 컬럼 {col} 검증 실패 (ok={ok}, bad={bad}) — 건너뜀", flush=True); continue
        extract(fname, col)
    print("완료", flush=True)
