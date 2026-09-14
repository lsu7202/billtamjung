#!/usr/bin/env python3
"""효과음 3종을 직접 합성한다 — 외부 음원을 쓰지 않는다(출처·라이선스 문제를 아예 만들지 않는다).

  click.wav  누를 때        짧은 딸깍
  box.wav    예고 상자      아주 작은 팝
  clear.wav  퀘스트 완료    두 음 상승
"""
import math
import struct
import wave

SR = 44100


def write(path: str, samples: list[float], peak: float) -> None:
    m = max(1e-9, max(abs(s) for s in samples))
    data = b"".join(struct.pack("<h", int(max(-1, min(1, s / m * peak)) * 32767)) for s in samples)
    with wave.open(path, "w") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(data)
    print(f"  {path}  {len(samples)/SR:.2f}s")


def env(i: int, n: int, attack: float = 0.004, power: float = 3.0) -> float:
    t = i / SR
    a = min(1.0, t / attack)
    return a * (1 - i / n) ** power


def click() -> list[float]:
    n = int(SR * 0.055)
    out = []
    for i in range(n):
        t = i / SR
        # 두 배음 + 아주 짧은 노이즈 — 기계식 스위치 느낌
        s = 0.6 * math.sin(2 * math.pi * 1750 * t) + 0.3 * math.sin(2 * math.pi * 3300 * t)
        s += 0.18 * math.sin(2 * math.pi * 90 * t) * math.exp(-t * 260)
        out.append(s * env(i, n, 0.002, 4.0))
    return out


def box() -> list[float]:
    n = int(SR * 0.09)
    out = []
    for i in range(n):
        t = i / SR
        f = 620 + 240 * (1 - math.exp(-t * 40))        # 살짝 올라가는 팝
        out.append(math.sin(2 * math.pi * f * t) * env(i, n, 0.006, 2.6))
    return out


def clear() -> list[float]:
    """도 → 솔. 완료를 귀로도 알 수 있게, 두 음이 겹치며 오른다."""
    n = int(SR * 0.62)
    out = []
    for i in range(n):
        t = i / SR
        s = 0.0
        for f0, start in ((523.25, 0.0), (784.0, 0.16)):
            if t >= start:
                u = t - start
                s += (math.sin(2 * math.pi * f0 * u) + 0.35 * math.sin(2 * math.pi * f0 * 2 * u)) \
                     * math.exp(-u * 4.2)
        out.append(s * min(1.0, t / 0.006))
    return out


if __name__ == "__main__":
    import os
    os.makedirs("public/sfx", exist_ok=True)
    # 나레이션이 주인공이다 — 효과음은 확실히 아래에 깐다
    write("public/sfx/click.wav", click(), 0.13)     # 약 -18dB
    write("public/sfx/box.wav", box(), 0.07)         # 약 -24dB
    write("public/sfx/clear.wav", clear(), 0.20)     # 약 -14dB
