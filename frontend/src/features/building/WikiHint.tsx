import { useState, useEffect, useCallback } from "react";
import { extrasApi, overlaysApi } from "../../shared/api/endpoints";
import { Icon } from "../../shared/ui/Icon";

/** 위키 · 힌트 — 사이드바에서 뺐다(2026-08-26). **아무 데서도 안 부른다.**
 *
 *  둘 다 팀 밖의 것이라 사이드바(우리 팀 값)의 줄에 성격이 안 맞았다:
 *  위키는 전체 이용자가 쓰는 글(카테고리·동의·댓글·신고)이고,
 *  힌트는 남들이 그 칸을 뭐로 갖고 있는지의 익명 분포다.
 *
 *  지우지 않고 여기 옮겨 둔다 — 자리를 정해 다시 넣을 것이다:
 *    · 힌트 → 값을 눌러 고칠 때 그 팝오버 안에 한 줄로(「남들은 철근콘크리트 12 · 철골 3」).
 *      지금의 「다수값 일괄 적용」은 없앤다: 열몇 칸을 남의 값으로 한 번에 덮으면 되돌리기 어렵다.
 *    · 위키 → 건물·토지 탭 맨 아래 「특이사항」 카드. 카테고리 앞 넷이 그대로 건물·토지 이야기다.
 *  백엔드(app.wiki_posts·overlays distribution)는 그대로 살아 있다.
 */

const WIKI_CATS = ["권리·명도", "임차인", "개발·도로", "건물상태", "소유자", "기타"];
/** 위키 댓글 스레드 — 펼칠 때 로드, 등록/삭제 시 재조회 + 목록 카운트 갱신(onChange). */
function CommentThread({ postId, onChange }: { postId: number; onChange: () => void }) {
  const [list, setList] = useState<{ id: number; body: string; author: string; mine: boolean }[]>([]);
  const [txt, setTxt] = useState("");
  const load = useCallback(async () => setList(await extrasApi.commentsList(postId)), [postId]);
  useEffect(() => { load(); }, [load]);
  async function add() { if (!txt.trim()) return; await extrasApi.commentAdd(postId, txt.trim()); setTxt(""); await load(); onChange(); }
  async function del(id: number) { await extrasApi.commentDel(id); await load(); onChange(); }
  return (
    <div style={{ marginTop: 8, paddingLeft: 10, borderLeft: "2px solid var(--line)", display: "grid", gap: 6 }}>
      {list.map((c) => (
        <div key={c.id} style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "baseline" }}>
          <span style={{ fontWeight: 600, color: "var(--muted)", flex: "0 0 auto" }}>{c.author}</span>
          <span style={{ flex: 1, minWidth: 0 }}>{c.body}</span>
          {c.mine && <button className="tool-btn" style={{ minWidth: 22, height: 22, fontSize: 11, color: "var(--up)", flex: "0 0 auto" }} onClick={() => del(c.id)} title="삭제"><Icon name="trash" size={12} /></button>}
        </div>
      ))}
      {list.length === 0 && <div style={{ fontSize: 12, color: "var(--muted)" }}>첫 댓글을 남겨보세요.</div>}
      <div style={{ display: "flex", gap: 6 }}>
        <input className="input" style={{ height: 30, fontSize: 12.5 }} placeholder="댓글" value={txt}
          onChange={(e) => setTxt(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) add(); }} />
        <button className="btn" style={{ flex: "0 0 auto" }} onClick={add}><Icon name="check" size={13} />등록</button>
      </div>
    </div>
  );
}

export function WikiTab({ pk, items, refresh }: { pk: string; items: Record<string, unknown>[]; refresh: () => void }) {
  const [body, setBody] = useState("");
  const [cat, setCat] = useState(WIKI_CATS[0]);
  const [showAll, setShowAll] = useState(false);
  const [openC, setOpenC] = useState<number | null>(null);
  async function vote(id: number) { await extrasApi.wikiVote(id); refresh(); }
  async function del(id: number) { if (!confirm("이 위키 글을 삭제할까요?")) return; await extrasApi.wikiDel(id); refresh(); }
  async function post() { if (!body.trim()) return; await extrasApi.wikiPost(pk, body.trim(), cat); setBody(""); refresh(); }
  async function report(id: number) { if (!confirm("이 글을 부적절한 내용으로 신고할까요?")) return; await extrasApi.wikiReport(id); alert("신고가 접수되었습니다."); }
  const row = (w: Record<string, unknown>, full: boolean) => {
    const id = Number(w.id);
    return (
    <div key={id} style={{ borderBottom: "1px solid var(--line)", padding: "9px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
            <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--signal)", background: "var(--signal-bg)", padding: "1px 8px", borderRadius: 999 }}>{String(w.category ?? "일반")}</span>
            {full && w.author != null && <span style={{ fontSize: 11, color: "var(--muted)" }}>{String(w.author)}</span>}
          </div>
          <div style={{ lineHeight: 1.45 }}>{String(w.body)}</div>
        </div>
        <div style={{ display: "flex", gap: 4, flex: "0 0 auto" }}>
          <button className="tool-btn" style={{ minWidth: 46, height: 28, fontSize: 12, background: "var(--surface-2)" }} onClick={() => vote(id)} title="동의(다시 누르면 취소)"><Icon name="like" size={13} style={{ verticalAlign: "-2px", marginRight: 3 }} />{String(w.votes)}</button>
          <button className="tool-btn" style={{ minWidth: 46, height: 28, fontSize: 12, background: openC === id ? "var(--signal-bg)" : "var(--surface-2)" }} onClick={() => setOpenC(openC === id ? null : id)} title="댓글"><Icon name="comment" size={13} style={{ verticalAlign: "-2px", marginRight: 3 }} />{String(w.comments ?? 0)}</button>
          {Boolean(w.mine)
            ? <button className="tool-btn" style={{ minWidth: 28, height: 28, fontSize: 12, color: "var(--up)" }} onClick={() => del(id)} title="내 글 삭제"><Icon name="trash" size={13} /></button>
            : <button className="tool-btn" style={{ minWidth: 28, height: 28, fontSize: 12, color: "var(--muted)" }} onClick={() => report(id)} title="신고"><Icon name="flag" size={14} /></button>}
        </div>
      </div>
      {openC === id && <CommentThread postId={id} onChange={refresh} />}
    </div>
    );
  };
  return (
    <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
      {items.length === 0 && <p style={{ color: "var(--muted)" }}>등록된 특이사항이 없습니다 — 첫 글을 남겨보세요.</p>}
      {items.slice(0, 3).map((w) => row(w, false))}
      {items.length > 3 && <button className="btn" style={{ justifySelf: "start", padding: "4px 10px", fontSize: 12 }} onClick={() => setShowAll(true)}>전체보기 {items.length} →</button>}
      {/* 작성 — 카테고리 칩 + 본문 */}
      <div style={{ display: "grid", gap: 6, background: "var(--surface-2)", borderRadius: 8, padding: 8, marginTop: 2 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
          {WIKI_CATS.map((c) => (
            <button key={c} onClick={() => setCat(c)} style={{ border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, padding: "3px 9px", borderRadius: 999, background: cat === c ? "var(--signal)" : "#fff", color: cat === c ? "#fff" : "var(--ink-2)", transition: "background .12s" }}>{c}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input className="input" placeholder="특이사항 (전체 공유)" value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) post(); }} />
          <button className="btn primary" style={{ flex: "0 0 auto" }} onClick={post}><Icon name="check" size={13} />등록</button>
        </div>
      </div>
      {showAll && (
        <div className="modal-bg open" onClick={() => setShowAll(false)}>
          <div className="modal" style={{ width: "min(680px,100%)" }} onClick={(e) => e.stopPropagation()}>
            <h3>위키 · 집단지성 특이사항 <small style={{ fontSize: 12, color: "var(--muted)", fontWeight: 400, marginLeft: 8 }}>{items.length}건</small>
              <span className="right"><button className="btn" onClick={() => setShowAll(false)}>닫기</button></span></h3>
            <div style={{ display: "grid", gap: 2, maxHeight: "60vh", overflow: "auto", fontSize: 13 }}>{items.map((w) => row(w, true))}</div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── 수정이력: 전 유저 값 분포(익명·공공 필드만, §4.3) ── */
export function HistTab({ pk, dist, refresh }: { pk: string; dist: Record<string, { label: string; values: { value: string; count: number }[] }>; refresh: () => void }) {
  const [applying, setApplying] = useState(false);
  const entries = Object.entries(dist);
  if (entries.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: 13 }}>다른 이용자의 값 힌트가 아직 없습니다.<br />값을 수정하면 익명 분포로 서로에게 힌트가 됩니다.</p>;
  }
  async function applyAll() {   // 각 항목 다수값(최빈값)을 내 오버레이에 일괄 적용
    if (!confirm("각 항목의 다수값을 내 데이터로 한번에 적용할까요?")) return;
    setApplying(true);
    for (const [field, e] of entries) {
      const top = e.values[0];
      if (top && top.value != null && top.value !== "") await overlaysApi.put(pk, field, top.value);
    }
    setApplying(false);
    refresh();
  }
  return (
    <div style={{ display: "grid", gap: 12, fontSize: 13 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>다른 이용자들이 이 값을 무엇으로 갖고 있는지 (익명 · 공공 필드). 클릭 한 번으로 다수값을 내 값으로 채웁니다.</p>
        <button className="btn primary" style={{ padding: "5px 11px", fontSize: 12, whiteSpace: "nowrap", flex: "0 0 auto" }} disabled={applying} onClick={applyAll}>{applying ? "적용 중…" : "다수값 적용"}</button>
      </div>
      {entries.map(([field, e]) => {
        const max = Math.max(...e.values.map((v) => v.count));
        return (
          <div key={field}>
            <div style={{ fontWeight: 700, marginBottom: 5 }}>{e.label}</div>
            {e.values.map((v, i) => (
              <div key={v.value ?? "null"} style={{ display: "flex", alignItems: "center", gap: 8, margin: "3px 0" }}>
                <span style={{ flex: "0 0 70px", color: i === 0 ? "var(--signal)" : "var(--ink-2)", fontWeight: i === 0 ? 700 : 400 }}>{v.value ?? "—"}</span>
                <span style={{ flex: 1, height: 8, background: "var(--surface-2)", borderRadius: 5, overflow: "hidden" }}>
                  <span style={{ display: "block", height: "100%", width: `${(v.count / max) * 100}%`, background: i === 0 ? "var(--signal)" : "var(--line-2)" }} />
                </span>
                <span className="num" style={{ color: "var(--muted)", fontSize: 11 }}>{v.count}명</span>
              </div>
            ))}
          </div>
        );
      })}
      <p style={{ color: "var(--muted)", fontSize: 11 }}>분포가 쏠려도 자동 반영되지 않습니다. 채택은 직접 판단하세요.</p>
    </div>
  );
}
