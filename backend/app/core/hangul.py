"""영문 자판으로 친 한글 복원(두벌식).

프로덕션 로그에 q=EHSDMLEHD(=돈의동), q=du(=여)처럼 한/영 전환을 잊고 친 검색이 실제로 있었고,
당연히 결과가 0건이었다. 자동완성이 이걸 알아서 되돌려준다.
"""

CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
JONG = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"

_QWERTY = {
    "q": "ㅂ", "w": "ㅈ", "e": "ㄷ", "r": "ㄱ", "t": "ㅅ", "y": "ㅛ", "u": "ㅕ",
    "i": "ㅑ", "o": "ㅐ", "p": "ㅔ", "a": "ㅁ", "s": "ㄴ", "d": "ㅇ", "f": "ㄹ",
    "g": "ㅎ", "h": "ㅗ", "j": "ㅓ", "k": "ㅏ", "l": "ㅣ", "z": "ㅋ", "x": "ㅌ",
    "c": "ㅊ", "v": "ㅍ", "b": "ㅠ", "n": "ㅜ", "m": "ㅡ",
    "Q": "ㅃ", "W": "ㅉ", "E": "ㄸ", "R": "ㄲ", "T": "ㅆ", "O": "ㅒ", "P": "ㅖ",
}
# CapsLock으로 전부 대문자인 경우(실제 로그: EHSDMLEHD) — 쌍자음·이중모음 자리가 아닌
# 대문자는 소문자와 같은 낱자로 본다.
_QWERTY.update({c.upper(): j for c, j in list(_QWERTY.items())
                if c.islower() and c.upper() not in _QWERTY})
_VOWEL_PAIR = {("ㅗ", "ㅏ"): "ㅘ", ("ㅗ", "ㅐ"): "ㅙ", ("ㅗ", "ㅣ"): "ㅚ",
               ("ㅜ", "ㅓ"): "ㅝ", ("ㅜ", "ㅔ"): "ㅞ", ("ㅜ", "ㅣ"): "ㅟ",
               ("ㅡ", "ㅣ"): "ㅢ"}
_JONG_PAIR = {("ㄱ", "ㅅ"): "ㄳ", ("ㄴ", "ㅈ"): "ㄵ", ("ㄴ", "ㅎ"): "ㄶ",
              ("ㄹ", "ㄱ"): "ㄺ", ("ㄹ", "ㅁ"): "ㄻ", ("ㄹ", "ㅂ"): "ㄼ",
              ("ㄹ", "ㅅ"): "ㄽ", ("ㄹ", "ㅌ"): "ㄾ", ("ㄹ", "ㅍ"): "ㄿ",
              ("ㄹ", "ㅎ"): "ㅀ", ("ㅂ", "ㅅ"): "ㅄ"}
_JONG_SPLIT = {v: k for k, v in _JONG_PAIR.items()}


def _compose(cho: str, jung: str, jong: str = "") -> str:
    return chr(0xAC00 + CHO.index(cho) * 588 + JUNG.index(jung) * 28 + (JONG.index(jong) if jong else 0))


def from_qwerty(text: str) -> str:
    """영문 타이핑 → 한글. 두벌식 오토마타 그대로. 조합에 실패한 낱자는 그대로 흘린다."""
    # 전부 대문자면 CapsLock으로 본다 — shift 자리(쌍자음)를 의도한 게 아니다.
    # 실제 로그의 EHSDMLEHD는 '돈의동'이지 '똔의똥'이 아니다.
    letters = [c for c in text if c.isalpha()]
    if letters and all(c.isupper() for c in letters):
        text = text.lower()
    out: list[str] = []
    cho = jung = jong = ""

    def emit():
        nonlocal cho, jung, jong
        if cho and jung:
            out.append(_compose(cho, jung, jong))
        else:
            out.append(cho + jung + jong)
        cho = jung = jong = ""

    for ch in text:
        j = _QWERTY.get(ch)
        if j is None:                       # 숫자·기호·한글 — 조합을 끊고 통과
            emit()
            out.append(ch)
            continue

        if j in JUNG:                                       # ── 모음
            if jong:                                        # 종성이 다음 글자 초성으로 이동
                keep, move = _JONG_SPLIT.get(jong, ("", jong))
                out.append(_compose(cho, jung, keep))
                cho, jung, jong = move, j, ""
            elif jung:
                pair = _VOWEL_PAIR.get((jung, j))
                if pair:
                    jung = pair
                else:
                    emit()
                    jung = j
            else:
                jung = j                                    # cho가 비어도 됨(홑모음)
        else:                                               # ── 자음
            if not jung:
                if cho:
                    emit()
                cho = j
            elif not jong:
                if j in JONG:
                    jong = j
                else:                                       # ㄸㅃㅉ는 종성이 될 수 없다
                    emit()
                    cho = j
            else:
                pair = _JONG_PAIR.get((jong, j))
                if pair:
                    jong = pair
                else:
                    emit()
                    cho = j
    emit()
    return "".join(out)


def looks_latin(text: str) -> bool:
    """한글이 하나도 없고 자판에 있는 영문자를 포함 — 자판 변환을 시도할 만한 입력."""
    if any("가" <= c <= "힣" or "ㄱ" <= c <= "ㅣ" for c in text):
        return False
    return any(c in _QWERTY for c in text)
