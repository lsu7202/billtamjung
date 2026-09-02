import { useState, useEffect } from "react";

/** 목차 — 무엇이 있는지 보여주고 누르면 그 자리로 데려간다.
 *
 *  탭으로 자르는 대신 이걸 쓴다: 자료를 훑는 화면이라 스크롤이 이어져야 하고,
 *  탭은 「지금 안 보는 쪽」을 통째로 감춰서 무엇이 있었는지조차 잊게 만든다.
 *
 *  탭 어디서나 쓴다 — 항목만 갈아 끼운다(2026-08-26).
 */
export type TocItem = { id: string; label: string } | { sec: string };
const TOC_GAP = 96;        // 스티키 헤더에 카드 머리가 가리지 않게 띄우는 만큼

/** 이 요소를 실제로 스크롤하는 조상. 없으면 null(문서가 스크롤한다).
 *  Shell 의 main 이 overflow:auto 라, 여기선 문서가 아니라 그 안이 움직인다. */
function scrollParent(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement;
  while (p && p !== document.body) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
    p = p.parentElement;
  }
  return null;
}

export function Toc({ items }: { items: TocItem[] }) {
  const [cur, setCur] = useState<string>("");
  useEffect(() => {
    const ids = items.filter((t): t is { id: string; label: string } => "id" in t).map((t) => t.id);
    const els = ids.map((i) => document.getElementById(i)).filter(Boolean) as HTMLElement[];
    if (!els.length) return;
    const sc = scrollParent(els[0]);
    // 「화면 위를 마지막으로 지난 카드」가 지금 보는 것이다.
    //
    // IntersectionObserver 로는 안 된다(2026-08-26 실측): 교차 상태가 바뀔 때만 발화하는데
    // 부드러운 스크롤이 멈추는 마지막 몇 px 에서는 아무 경계도 넘지 않아 콜백이 안 온다.
    // 스크롤에 맞춰 직접 재되 rAF 로 한 프레임에 한 번만 잰다(카드 일곱이라 rect 일곱 번).
    let queued = false;
    const pick = () => {
      queued = false;
      // go() 와 **같은 기준**으로 잰다 — 뷰포트 기준으로 재면 컨테이너가 화면 맨 위에서
      // 시작하지 않는 만큼(앱 상단바 높이) 어긋나 목차가 늘 한 칸 밀린다.
      const base = sc ? sc.getBoundingClientRect().top : 0;
      let hit = els[0];
      for (const e of els) if (e.getBoundingClientRect().top - base <= TOC_GAP + 8) hit = e;
      setCur(hit.id);
    };
    const onScroll = () => { if (!queued) { queued = true; requestAnimationFrame(pick); } };
    const target: HTMLElement | Window = sc ?? window;
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    pick();
    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  });
  // scrollIntoView 는 쓰지 않는다 — 중첩 스크롤에서 조용히 아무 데도 안 간다(실측: 눌러도 제자리).
  const go = (id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    const sc = scrollParent(el);
    const dy = el.getBoundingClientRect().top - (sc ? sc.getBoundingClientRect().top : 0) - TOC_GAP;
    if (sc) sc.scrollTo({ top: sc.scrollTop + dy, behavior: "smooth" });
    else window.scrollTo({ top: window.scrollY + dy, behavior: "smooth" });
  };
  return (
    <nav className="rv-toc" aria-label="목차">
      {items.map((t) => "sec" in t
        ? <em key={t.sec}>{t.sec}</em>
        : (
          <button key={t.id} type="button" className={cur === t.id ? "on" : ""}
            onClick={() => go(t.id)}>{t.label}</button>
        ))}
    </nav>
  );
}
