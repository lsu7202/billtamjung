#!/usr/bin/env python3
"""내레이션 볼륨 균일화 — 문장마다 들쭉날쭉한 TTS 출력을 RMS 기준으로 맞춘다.
원본은 public/vo/raw/에 보관하고, 재실행 시 원본에서 다시 계산한다."""
import array, glob, math, os, shutil, wave

TARGET = -17.0   # dBFS RMS
CEIL = -1.2      # dBFS peak 상한
os.makedirs("public/vo/raw", exist_ok=True)

for f in sorted(glob.glob("public/vo/m*.wav")):
    raw = f"public/vo/raw/{os.path.basename(f)}"
    if not os.path.exists(raw):
        shutil.copy(f, raw)
    w = wave.open(raw); p = w.getparams()
    d = array.array("h"); d.frombytes(w.readframes(p.nframes)); w.close()

    rms = math.sqrt(sum(x * x for x in d) / len(d)) / 32768
    pk = max(abs(x) for x in d) / 32768
    g = 10 ** ((TARGET - 20 * math.log10(rms)) / 20)
    g = min(g, 10 ** (CEIL / 20) / pk)            # 클리핑 방지

    out = array.array("h", (max(-32768, min(32767, int(x * g))) for x in d))
    o = wave.open(f, "wb"); o.setparams(p); o.writeframes(out.tobytes()); o.close()
    print(f"{os.path.basename(f):10} {20*math.log10(rms):6.1f} → {20*math.log10(rms*g):6.1f} dB  (×{g:.2f})")
