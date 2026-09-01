#!/usr/bin/env python3
"""빌드 결과서 — 빌더가 원본을 어떻게 다뤘는지 남긴다(2026-08-31).

## 왜

「돌긴 돌았다」와 「제대로 됐다」는 다르다. 지금까지 그 차이를 사람이 그때그때
손으로 대조해 왔고, 그래서 사고를 나중에 알았다:

  · 총괄표제부를 표제부 감각으로 읽어 주소 칸이 두 칸 밀렸다 — 적재 뒤에 알았다
  · 옛 CSV 재적재로 지하 32만 층이 지상이 됐다 — 화면에서 알았다
  · build_sqlite 가 값 39개를 40칸에 넣고 있었다 — 3주 뒤에 알았다

**빌더는 매번 스스로 결과서를 쓴다.** 원본에서 몇 줄을 읽어 몇 줄을 냈는지,
무엇을 버렸고 왜 버렸는지, 어떤 값을 우리가 바꿨는지, 원본 칸 중 안 읽은 것이 무엇인지.
그리고 **심각하면 스스로 중단한다** — 나쁜 결과가 조용히 다음 단계로 가는 것이 제일 위험하다.

## 쓰는 법

    from build_report import Report
    rep = Report("build_building_master", src=("대장", "표제부"), used=TTL.values())
    for r in rows(...):
        rep.read()
        if not pnu:
            rep.drop("PNU 조립 실패", r["관리건축물대장PK"]); continue
        if bcr > 100:
            rep.fix("건폐율 100% 초과 재계산", pk, bcr, new)
        rep.write()
    rep.finish()          # 결과서 저장 + 판정. 심각하면 SystemExit

## 판정

    정상   버린 줄 1% 미만 · 우리가 바꾼 값 1% 미만
    경고   그보다 크다 — 사람이 봐야 한다
    중단   원본을 하나도 못 읽었거나, 낸 줄이 읽은 줄의 절반도 안 된다

경고는 멈추지 않는다. 대장 원본에는 원래 오류가 섞여 있어서 0을 요구하면 아무것도 못 돈다.
대신 **결과서에 남고 화면에 뜬다.** 중단은 멈춘다 — 그 상태로 다음 단계에 넘기면 안 된다.
"""
import collections
import datetime
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "data", "tools", "_reports")

WARN_DROP = 0.01      # 버린 줄이 이보다 많으면 경고
WARN_FIX = 0.01
# 비움은 바꿈보다 흔하다 — 조인이 안 붙으면 그 칸이 빈다. 좌표 없는 건물 26,369동이
# 교통 칸을 통째로 비우는 것만으로 4.5% 다. 그 정도는 정상이고 10%부터 본다.
WARN_NULL = 0.10       # 우리가 바꾼 값이 이보다 많으면 경고
STOP_YIELD = 0.5      # 낸 줄이 읽은 줄의 이 비율 미만이면 중단


class Report:
    def __init__(self, name, src=None, used=None):
        self.name = name
        self.src = src                       # (계열, 마트) 또는 설명 문자열
        self.used = sorted(set(used or []))  # 빌더가 읽는 칸 이름
        self.t0 = datetime.datetime.now()
        self.n_read = self.n_write = 0
        self.n_out = None                    # 접은 뒤 실제 출력 행(접는 빌더만)
        self.merges = collections.Counter()  # 합쳐서 사라진 줄
        self.skips = collections.Counter()   # 애초에 대상이 아닌 줄
        self.side = []                       # 곁들여 읽은 다른 마트
        self.drops = collections.Counter()
        self.fixes = collections.Counter()
        self.nulls = collections.Counter()
        self.odds = collections.Counter()
        self.samples = collections.defaultdict(list)
        self.notes = []

    # ── 기록 ────────────────────────────────────────────────
    def read(self, n=1):
        self.n_read += n

    def write(self, n=1):
        self.n_write += n

    def drop(self, why, key=None, n=1):
        """줄을 통째로 버렸다. 줄마다 부르거나(n=1), 세어서 한 번에 넘긴다(n=…)."""
        if n <= 0:
            return
        self.drops[why] += n
        self._sample("버림:" + why, key)

    def skip(self, why, key=None, n=1):
        """**대상이 아니라서** 안 실었다. 버린 것(drop)과 다르다.

        drop 은 「실으려 했는데 못 실었다」이고 skip 은 「애초에 우리 관심 밖」이다.
        섞으면 수율 게이트가 헛돈다 — 대수선 빌더는 건축구분 스무 종 중 다섯만
        일부러 고르는데, 나머지를 버림으로 적었더니 「낸 줄이 읽은 줄의 50% 미만」으로
        중단이 떴다(2026-09-01). 16.8% 가 정상인 빌더다.
        수율은 **대상 줄 기준**으로 본다: 낸 줄 ÷ (읽은 줄 − 대상 아님).
        """
        if n <= 0:
            return
        self.skips[why] += n
        self._sample("대상아님:" + why, key)

    def merge(self, why, key=None, n=1):
        """다른 줄과 **합쳐져** 사라졌다. 버린 것과 다르다 — 값은 남아 있다.

        중복 제거·접기가 여기다. `continue` 로 조용히 넘기면 「읽은 줄 ≠ 낸 줄」이
        되는데 장부엔 이유가 없다. 2026-09-01 공동주택가격 178만 줄이 그랬다.
        줄마다 부르거나(n=1), 접고 나서 한 번에 세어 넘긴다(n=…).
        """
        if n <= 0:
            return
        self.merges[why] += n
        self._sample("합침:" + why, key)

    def output(self, n):
        """접은 뒤 **실제로 낸 행 수.** 줄 단위와 출력 단위가 다른 빌더만 쓴다
        (지역지구구역 735,594줄 → 건물 386,057동)."""
        self.n_out = n

    def also_read(self, mart, n_read, folded_to=None, dropped=0, merged=0):
        """이 빌더가 **곁들여 읽은 다른 마트.** 안 적으면 그 원본은 장부에 없는 것이 된다
        (2026-09-01: 전유공용 1,982만 줄이 통째로 안 잡혀 있었다).

        **셈은 원본마다 따로 맞춘다.** 곁들인 원본의 버림·합침을 본 원본 칸에 섞으면
        「읽은 378만인데 합침 1,604만」 같은 말이 안 되는 줄이 나온다.
        """
        self.side.append({"마트": mart, "읽은줄": n_read, "버림": dropped, "합침": merged,
                          **({"접은뒤": folded_to} if folded_to is not None else {})})

    def fix(self, why, key=None, before=None, after=None):
        """원본 값을 **우리가 바꿨다.** 제일 조심해야 할 기록이다."""
        self.fixes[why] += 1
        self._sample("바꿈:" + why, key, before, after)

    def null(self, why, key=None, before=None):
        """원본 값을 버리고 비웠다(없는 것이 틀린 것보다 나을 때)."""
        self.nulls[why] += 1
        self._sample("비움:" + why, key, before)

    def note_odd(self, why, key=None, value=None, n=1):
        """원본이 이상하다. **값은 손대지 않고** 사실만 남긴다.

        고치는 것(fix)과 다르다. 대장이 이상한 값을 준 것을 우리가 바로잡으면
        그건 대장이 아닌 우리 값이 되고, 화면·계약서로 그대로 나간다.
        이상하다는 것만 알리고 판단은 사람에게 넘긴다.
        """
        if n <= 0:
            return
        self.odds[why] += n
        self._sample("이상:" + why, key, value)

    def note(self, text):
        self.notes.append(text)

    def _sample(self, tag, *vals):
        if len(self.samples[tag]) < 3:
            self.samples[tag].append([v for v in vals if v is not None])

    # ── 마무리 ──────────────────────────────────────────────
    def _unused_columns(self):
        """원본에는 있는데 빌더가 안 읽는 칸. 놓친 것이 있는지 사람이 보라고 남긴다."""
        if not (self.src and isinstance(self.src, tuple) and self.used):
            return None
        try:
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from hub_csv import header
            all_cols = header(*self.src)
        except SystemExit:
            return None
        except Exception:
            return None
        return [c for c in all_cols if c not in set(self.used)]

    def finish(self, quiet=False):
        d_tot = sum(self.drops.values())
        s_tot = sum(self.skips.values())
        m_tot = sum(self.merges.values())
        # 바꾼 것과 비운 것은 무게가 다르다. 「우리가 바꿈」은 원본과 다른 값을 내보낸 것이라
        # 제일 무겁고, 「비움」은 값을 못 채운 것이다. 한 덩어리로 재면 문구가 사실과 어긋난다
        # (2026-09-01: 조인이 안 붙어 빈 칸 9%를 「우리가 바꾼 값 9%」로 찍었다).
        f_tot = sum(self.fixes.values())
        n_tot = sum(self.nulls.values())
        # 수율·비율은 **대상 줄**로 잰다. 대상 아닌 줄까지 분모에 넣으면
        # 일부러 고르는 빌더가 늘 경고로 뜬다.
        r = max(self.n_read - s_tot, 1)
        verdict, reasons = "정상", []
        if self.n_read == 0:
            verdict = "중단"; reasons.append("원본을 한 줄도 못 읽었다")
        elif (got := (self.n_out if self.n_out is not None else self.n_write)
                     + m_tot) < r * STOP_YIELD:
            # **장부에 남은 줄**을 센다: 낸 줄 + 합친 줄. 접기·중복 제거는 사라진 것이
            # 아니라 어디로 갔는지 아는 것이다. 접은 줄을 분모에서 안 빼면 접는 빌더가
            # 반드시 걸린다 — 토지이용계획 원장은 1,040만 줄을 90만 필지로 접는다.
            # 여기 걸린다는 것은 「줄이 장부 없이 사라졌다」는 뜻이다(2026-09-01).
            verdict = "중단"
            reasons.append(f"장부에 남은 줄 {got:,}(낸 줄 + 합침) 이 대상 줄 {r:,} 의 "
                           f"{STOP_YIELD:.0%} 미만이다"
                           + (f" · 읽은 줄 {self.n_read:,} 중 대상 아님 {s_tot:,}" if s_tot else ""))
        else:
            if d_tot > r * WARN_DROP:
                verdict = "경고"; reasons.append(f"버린 줄 {d_tot/r:.2%}")
            if f_tot > r * WARN_FIX:
                verdict = "경고"; reasons.append(f"우리가 바꾼 값 {f_tot/r:.2%}")
            if n_tot > r * WARN_NULL:
                verdict = "경고"; reasons.append(f"비운 값 {n_tot/r:.2%}")

        unused = self._unused_columns()
        rec = {
            "빌더": self.name,
            "원본": "/".join(self.src) if isinstance(self.src, tuple) else self.src,
            "시각": self.t0.strftime("%Y-%m-%d %H:%M"),
            "걸린초": round((datetime.datetime.now() - self.t0).total_seconds(), 1),
            "읽은줄": self.n_read, "낸줄": self.n_write,
            **({"실제출력": self.n_out} if self.n_out is not None else {}),
            **({"함께읽은원본": self.side} if self.side else {}),
            "버림": dict(self.drops.most_common()),
            "합침(중복·접기)": dict(self.merges.most_common()),
            "대상아님": dict(self.skips.most_common()),
            "우리가바꿈": dict(self.fixes.most_common()),
            "비움": dict(self.nulls.most_common()),
            "원본이상(그대로 실음)": dict(self.odds.most_common()),
            "안읽는칸": unused,
            "표본": {k: v for k, v in self.samples.items()},
            "메모": self.notes,
            "판정": verdict, "사유": reasons,
        }
        os.makedirs(OUT, exist_ok=True)
        p = os.path.join(OUT, f"{self.name}.json")
        json.dump(rec, open(p, "w"), ensure_ascii=False, indent=1)

        if not quiet:
            self._print(rec, p)
        if verdict == "중단":
            sys.exit(f"\n✗ {self.name}: 결과가 쓸 수 없는 상태입니다 — 다음 단계로 넘기지 마세요.")
        return rec

    def _print(self, rec, path):
        mark = {"정상": "✅", "경고": "⚠", "중단": "✗"}[rec["판정"]]
        r = max(rec["읽은줄"], 1)
        print(f"\n── 빌드 결과서 · {self.name} ──")
        print(f"  원본 {rec['원본']} · {rec['걸린초']}초")
        print(f"  읽은 줄 {rec['읽은줄']:,} → 낸 줄 {rec['낸줄']:,}"
              f"  ({rec['낸줄']/r:.1%})")
        for title, key in [("버림", "버림"), ("우리가 바꿈", "우리가바꿈"), ("비움", "비움"),
                           ("원본이 이상 (그대로 실음)", "원본이상(그대로 실음)")]:
            if rec[key]:
                tot = sum(rec[key].values())
                print(f"  {title} {tot:,} ({tot/r:.2%})")
                for why, n in list(rec[key].items())[:6]:
                    print(f"      {why:34} {n:8,}")
        if rec["안읽는칸"]:
            u = rec["안읽는칸"]
            print(f"  원본에 있는데 안 읽는 칸 {len(u)}개: {', '.join(u[:8])}"
                  + (" …" if len(u) > 8 else ""))
        print(f"  {mark} {rec['판정']}" + (f" — {' · '.join(rec['사유'])}" if rec["사유"] else ""))
        print(f"  → {path}")
