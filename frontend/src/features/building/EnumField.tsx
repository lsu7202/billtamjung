import { useState } from "react";
import { Icon } from "../../shared/ui/Icon";
import { useEnums } from "../../shared/hooks/useEnums";

type Opt = { code: string; label: string };

const chipStyle = (on: boolean): React.CSSProperties => ({
  padding: "4px 11px", fontSize: 12, fontWeight: on ? 700 : 600, borderRadius: 999, cursor: "pointer",   // 선택=굵게
  border: `1px solid ${on ? "var(--signal)" : "var(--line-2)"}`,
  background: on ? "var(--signal-bg)" : "#fff", color: on ? "var(--signal)" : "var(--ink-2)",
});
// 트리거: 값 선택 시 굵고 진하게(값=굵게 통일) · 미지정은 흐리게(지금대로)
const triggerStyle = (has: boolean): React.CSSProperties => ({
  padding: "4px 11px", fontSize: 12, fontWeight: has ? 700 : 500, borderRadius: 999, cursor: "pointer",
  border: "1px solid var(--line-2)", background: "#fff", color: has ? "var(--ink)" : "var(--muted)",
  display: "inline-flex", alignItems: "center", gap: 5,
});
const popStyle = (big: boolean): React.CSSProperties => ({
  position: "absolute", top: "calc(100% + 4px)", right: 0, zIndex: 41, background: "#fff",
  border: "1px solid var(--line)", borderRadius: 10, boxShadow: "var(--shadow)", padding: 8,
  width: "max-content", maxWidth: 320, maxHeight: big ? 280 : undefined, overflowY: big ? "auto" : "visible",
});
const searchStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", marginBottom: 8, padding: "5px 9px", fontSize: 12,
  border: "1px solid var(--line-2)", borderRadius: 8,
};

/** 최근 고른 값 — 옵션이 스물 넘는 칸에서 매번 찾게 두지 않는다. 한 사람의 손버릇이라 localStorage */
const RKEY = (k: string) => `bt.enum.${k}`;
function recentOf(k: string): string[] {
  if (!k) return [];
  try { return JSON.parse(localStorage.getItem(RKEY(k)) || "[]").slice(0, 5); } catch { return []; }
}
function remember(k: string, code: string) {
  if (!k) return;
  try {
    const cur = recentOf(k).filter((c) => c !== code);
    localStorage.setItem(RKEY(k), JSON.stringify([code, ...cur].slice(0, 5)));
  } catch { /* 사파리 프라이빗 등 — 없으면 없는 대로 */ }
}

/** 찾기 — 글자가 **순서대로** 나오면 걸린다.
 *  실무에선 「제1종근린생활시설」을 「근생」이라 부르는데 부분일치로는 안 걸린다.
 *  줄임말 사전을 지어 두는 대신 이 규칙 하나로 「근생」·「1종근생」·「업무」가 다 걸린다. */
function loose(label: string, q: string): boolean {
  const s = label.replace(/[\s·()]/g, ""), t = q.replace(/[\s·()]/g, "");
  if (!t) return true;
  let i = 0;
  for (const ch of s) if (ch === t[i] && ++i === t.length) return true;
  return false;
}

const revertLink: React.CSSProperties = {
  display: "block", width: "100%", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line)",
  background: "none", border: "none", cursor: "pointer", fontSize: 12, color: "var(--muted)", textAlign: "left",
};

/** 단일선택 칩 — **기본은 드롭다운**(현재값 트리거 → 팝오버).
 *  S02 상세는 KV 한 줄에 값 하나가 원칙이라, 칩을 펼치면 줄이 늘어나 표가 무너진다
 *  (2026-08-11 되돌림). 펼침(원클릭)은 자리가 넉넉한 편집 폼에서만 mode="inline"으로 켠다. */
export function Chips({ opts, cur, onSelect, onRevert, mode, enumKey = "" }: {
  opts: Opt[]; cur: string; onSelect: (code: string) => void; onRevert?: () => void;
  mode?: "drop" | "inline";
  /** 최근 고른 값을 기억할 열쇠 — 옵션이 많은 칸(주용도·지목)에서만 쓴다 */
  enumKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const curLabel = opts.find((o) => o.code === cur)?.label ?? cur;
  const big = opts.length > 12;
  const shown = q ? opts.filter((o) => o.label.includes(q)) : opts;

  // 미지정은 칩으로 안 그린다(2026-08-18) — 눌린 칩을 한 번 더 누르면 취소돼 미지정이 된다
  const inl = opts.filter((o) => o.code !== "미지정");
  if (mode === "inline") {
    // 옵션이 많아도 팝오버로 떨어뜨리지 않는다(2026-08-25) — 어법이 갈리면 같은 화면에서
    // 어떤 줄은 칩이고 어떤 줄은 드롭다운이 된다. 주용도 38 · 지목 29 · 도로접면 13이 그랬다.
    // 대신 **검색 한 줄**과 **최근 쓴 값**을 앞에 두고, 넘치면 그 안에서 스크롤한다.
    const many = inl.length > 12;
    const recent = many ? recentOf(enumKey) : [];
    const hit = q ? inl.filter((o) => loose(o.label, q)) : inl;
    // 최근 고른 값이 맨 앞 — 상업용 건물의 주용도는 다섯 가지가 93%다. 매번 찾게 두지 않는다.
    const list = q ? hit
      : [...recent.map((c) => inl.find((o) => o.code === c)).filter((o): o is Opt => !!o),
         ...inl.filter((o) => !recent.includes(o.code))];
    const pick = (code: string) => {
      const next = code === cur && code !== "미지정" ? "미지정" : code;
      if (many && next !== "미지정") remember(enumKey, next);
      onSelect(next);
    };
    return (
      <span style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start", maxWidth: 560 }}>
        {many && (
          // 펼칠 때만 서는 칸이라 「항상 떠 있는 네모」가 아니다 — 열자마자 칠 수 있게 커서를 준다.
          // 마우스로 칩을 고르는 길도 그대로 열려 있다.
          <input className="um-in" placeholder="찾기" value={q} autoFocus
            ref={(el) => el?.focus({ preventScroll: true })}
            onChange={(e) => setQ(e.target.value)}
            style={{ width: 150, fontSize: 12.5, padding: "5px 12px" }} />
        )}
        <span className="chips-in" style={many ? { maxHeight: 108, overflowY: "auto" } : undefined}>
          {list.map((o) => (
            <button key={o.code}
              className={o.code === cur ? (o.code === "미지정" ? "on none" : "on") : ""}
              // 눌린 칩을 한 번 더 누르면 취소 — 처음의 「안 고른 상태」로 돌아갈 길(2026-08-18)
              onClick={() => pick(o.code)}>{o.label}</button>
          ))}
          {list.length === 0 && <span style={{ fontSize: 12.5, color: "#B0B8C1", fontWeight: 600 }}>없음</span>}
          {onRevert && cur !== "미지정" && (
            <button className="rv" title="마스터 원본으로 되돌리기" onClick={onRevert}>
              <Icon name="undo" size={11} /></button>
          )}
        </span>
      </span>
    );
  }
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button style={triggerStyle(cur !== "미지정")} onClick={() => { setOpen((v) => !v); setQ(""); }}>
        {curLabel}<span style={{ fontSize: 9, opacity: .65 }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={popStyle(big)} onClick={(e) => e.stopPropagation()}>
            {big && <input autoFocus placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} style={searchStyle} />}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {shown.map((o) => (
                <button key={o.code} style={chipStyle(o.code === cur)}
                  // 칩과 같은 규칙 — 선택된 것을 다시 누르면 해제(null). 미지정 코드는 없다(0096)
                  onClick={() => { onSelect(o.code === cur ? "미지정" : o.code); setOpen(false); }}>{o.label}</button>
              ))}
            </div>
            {onRevert && <button style={revertLink} onClick={() => { onRevert(); setOpen(false); }}><Icon name="undo" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />마스터 원본으로 되돌리기</button>}
          </div>
        </>
      )}
    </span>
  );
}

/** 다중선택 칩 — 용도지역 걸침 등. 선택값 여러 개 유지(팝오버 안 닫힘), 검색+스크롤. */
export function ChipsMulti({ opts, selected, onChange, summary, onRevert }: {
  opts: Opt[]; selected: string[]; onChange: (v: string[]) => void; summary: string; onRevert?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const big = opts.length > 12;
  const shown = q ? opts.filter((o) => o.label.includes(q)) : opts;
  const toggle = (code: string) => onChange(selected.includes(code) ? selected.filter((x) => x !== code) : [...selected, code]);
  return (
    <span style={{ position: "relative", display: "inline-flex" }}>
      <button style={triggerStyle(selected.length > 0)} onClick={() => { setOpen((v) => !v); setQ(""); }}>
        {summary || "미지정"}<span style={{ fontSize: 9, opacity: .65 }}>▾</span>
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
          <div style={popStyle(big)} onClick={(e) => e.stopPropagation()}>
            {big && <input autoFocus placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} style={searchStyle} />}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {shown.map((o) => (
                <button key={o.code} style={chipStyle(selected.includes(o.code))} onClick={() => toggle(o.code)}>{o.label}</button>
              ))}
            </div>
            {onRevert && <button style={revertLink} onClick={() => { onRevert(); setOpen(false); }}><Icon name="undo" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />마스터 원본으로 되돌리기</button>}
          </div>
        </>
      )}
    </span>
  );
}

/** enum 오버레이 필드 — 선택 즉시 자동저장. 전부 칩 드롭다운(대형은 검색). onRevert=마스터 원본. */
export function EnumField({ label, enumKey, value, onSave, onRevert }: {
  label: string; enumKey: string; value?: string | null; onSave: (v: string) => void; onRevert?: () => void;
}) {
  const en = useEnums();
  const opts = en.options(enumKey);
  const cur = value ?? "미지정";
  return (
    <div className="kv" style={{ alignItems: "center" }}>
      <span className="k">{label}</span>
      <Chips opts={opts} cur={cur} onSelect={onSave} onRevert={onRevert} />
    </div>
  );
}
