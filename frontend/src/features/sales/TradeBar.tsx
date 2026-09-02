import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../shared/ui/Icon";
import "./sales.css";

/** 하단 대화창 — **대화형 AI 가 들어올 자리**(2026-08-29 비움).
 *
 *  여기 있던 것은 전부 규칙이었다: 문장을 읽어 칸에 넣는 파서, 대상 찾기 도우미 줄,
 *  최근 목록, 화면 맥락 칩, 「오늘 일정 전부 완료」 같은 명령, 통화 결과 칩, 영수증.
 *  규칙으로 뜻을 짐작하던 층이라, 대화가 들어서면 전부 다시 만들어야 하는 것들이었다.
 *  남겨 두면 두 벌이 되고 둘이 어긋난다 — 그래서 미리 걷었다.
 *
 *  실제로 어긋나 있었다(실측): 「박정호 어제 통화함 130억에 내놓기로」를 치면 130억이
 *  증발했고, 되비침엔 「제안」이라 떴는데 저장은 다른 칸으로 갔다. 모달이 바뀌면서
 *  칸이 사라졌는데 파서만 옛 모델에 남아 있었기 때문이다.
 *
 *  **대상 찾기는 서버에 그대로 있다**(GET /sales/find). 「누구 얘기인지」는 목록 조회라
 *  뜻풀이와 무관하고, 대화가 들어와도 같은 기능이 필요하다.
 *
 *  지금 이 창이 하는 일: 뜬다. 글자를 받는다. 그뿐이다.
 */
export function TradeBar() {
  const box = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [focus, setFocus] = useState(false);

  // ⌘K 로 손이 온다 — 자리는 지켜 둔다
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault(); box.current?.focus();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  return createPortal((
    <div className="tb">
      <div className={`tb-pill ${focus ? "on" : ""}`}>
        <div className="tb-line">
          <input ref={box} className="tb-in" value={text}
            placeholder="준비 중입니다"
            onFocus={() => setFocus(true)} onBlur={() => setTimeout(() => setFocus(false), 150)}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing) return;    // 한글 조합 중 엔터 방지
              if (e.key === "Escape") { setText(""); box.current?.blur(); }
            }} />
          <button className="tb-go" disabled title="준비 중">
            <Icon name="check" size={15} /></button>
        </div>
      </div>
    </div>
  ), document.body);
}
