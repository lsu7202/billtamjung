import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../shared/ui/Icon";

/** 담기 — 두 화면이 쓰는 **한 벌**의 고르기 창.
 *
 *  건물 상세에서 열면 매수자가 채워지고, 매수자 화면에서 열면 매물이 채워진다.
 *  담는 일은 어느 쪽에서 시작하든 같은 행동(제안 한 줄 만들기)인데, 예전엔 화면마다
 *  생긴 것도 부르는 말도 달랐다 — 여기선 「후보로」, 저기선 「매물 담기」.
 *
 *  여러 개를 한 번에 고를 수 있어야 한다. 한 명씩 누르게 하면 세 명 담는 데 세 번 왕복한다.
 */
export interface PickItem {
  key: string;
  label: string;
  sub?: string;
  taken?: boolean;          // 이미 담긴 것 — 목록에 두되 못 고르게
}

export function Picker({ label, placeholder, minChars = 0, as = "button", load, onAdd }: {
  label: string;
  placeholder: string;
  /** 여는 자리에 맞춘 생김새 — 탭 줄에서는 탭 하나로 서야 한다(점선 버튼은 줄을 깬다) */
  as?: "button" | "tab";
  /** 몇 글자부터 찾을지. 주소는 2, 이름은 0(열자마자 전부 보인다) */
  minChars?: number;
  load: (q: string) => Promise<PickItem[]>;
  onAdd: (keys: string[]) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<PickItem[]>([]);
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [at, setAt] = useState<{ top: number; right: number } | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLSpanElement>(null);

  // 팝오버는 **화면 기준**으로, 그리고 body 로 빼서 띄운다.
  //  · 탭 줄은 가로로 흐르므로 그 안에 절대배치하면 잘려 목록이 반만 보인다.
  //  · 뒤집기 카드(.pbox)에 걸린 `perspective` 는 position:fixed 의 기준을 그 카드로 가로챈다
  //    — 포털로 body 에 내보내야 화면 좌표가 그대로 먹는다(안 그러면 엉뚱한 데 뜬다).
  const place = () => {
    const r = btn.current?.getBoundingClientRect();
    if (r) setAt({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  };
  const flip = () => { if (!open) place(); setOpen((v) => !v); };
  useEffect(() => {
    if (!open) return;
    const on = () => place();
    window.addEventListener("scroll", on, true);
    window.addEventListener("resize", on);
    return () => { window.removeEventListener("scroll", on, true); window.removeEventListener("resize", on); };
  }, [open]);

  // load 는 호출부에서 인라인으로 넘어와 렌더마다 새 함수다. 의존성에 넣으면
  // 렌더 → 효과 → setItems → 렌더 로 돌며 타이머가 매번 취소돼 **영원히 안 불린다**.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    if (!open) return;
    if (q.trim().length < minChars) { setItems([]); return; }
    let alive = true;
    const t = setTimeout(() => {
      loadRef.current(q.trim()).then((r) => { if (alive) setItems(r); }).catch(() => { if (alive) setItems([]); });
    }, 160);
    return () => { alive = false; clearTimeout(t); };
  }, [open, q, minChars]);

  // 바깥을 누르면 닫는다 — 열어둔 채 다른 걸 만지다 잊는 창이 되지 않게
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => {
      const t = e.target as Node;
      // 팝오버는 body 로 빠져 있어 wrap 안에 없다 — 둘 다 확인해야 한다
      if (wrap.current?.contains(t) || pop.current?.contains(t)) return;
      setOpen(false); setQ(""); setSel([]);
    };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);

  const toggle = (k: string) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const done = async () => {
    if (!sel.length || busy) return;
    setBusy(true);
    try { await onAdd(sel); setOpen(false); setQ(""); setSel([]); }
    finally { setBusy(false); }
  };

  return (
    <span className="pick" ref={wrap}>
      {as === "tab"
        ? <button ref={btn} className={`ptab add ${open ? "open" : ""}`} title={label}
            onClick={flip}>＋</button>
        : <button ref={btn} className="pick-open" onClick={flip}>
            <Icon name="plus" size={11} style={{ verticalAlign: "-1px", marginRight: 4 }} />{label}</button>}

      {open && at && createPortal(
        <span className="pick-pop" ref={pop}
          style={{ position: "fixed", top: at.top, right: at.right, left: "auto" }}>
          <input className="input" autoFocus placeholder={placeholder} value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setQ(""); setSel([]); } }} />

          <span className="pick-list">
            {items.map((it) => (
              <button key={it.key} className={`pick-row ${sel.includes(it.key) ? "on" : ""} ${it.taken ? "off" : ""}`}
                disabled={it.taken} onClick={() => toggle(it.key)}>
                <i className="ck">{sel.includes(it.key) ? "✓" : ""}</i>
                <b>{it.label}</b>
                {it.sub && <span>{it.sub}</span>}
              </button>
            ))}
            {items.length === 0 && (
              <span className="pick-none">
                {q.trim().length < minChars ? `${minChars}글자 이상 입력하세요` : "찾는 것이 없습니다"}</span>
            )}
          </span>

          <span className="pick-foot">
            <button className="apply" disabled={!sel.length || busy} onClick={done}>
              {busy ? "담는 중…" : sel.length ? `${sel.length}건 담기` : "담기"}</button>
          </span>
        </span>, document.body)}
    </span>
  );
}
