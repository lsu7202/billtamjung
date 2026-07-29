import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listingsApi, extrasApi, overlaysApi, seriesApi, buildingsApi } from "../../shared/api/endpoints";
import { KV, wonToEok, vPos, formatPhone } from "./KV";
import { api } from "../../shared/api/client";
import { useEnums } from "../../shared/hooks/useEnums";
import { Chips } from "./EnumField";

/** S02 우측 고정 사이드바 — 업무 / 위키 / 수정이력 / 메모 4탭(§4). enum=enums.md 정본. */

export function Sidebar({ pk }: { pk: string }) {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"biz" | "wiki" | "hist" | "memo">("biz");

  const listing = useQuery({ queryKey: ["listing", pk], queryFn: () => listingsApi.get(pk) });
  const wiki = useQuery({ queryKey: ["wiki", pk], queryFn: () => extrasApi.wikiList(pk), enabled: tab === "wiki" });
  const memos = useQuery({ queryKey: ["memos", pk], queryFn: () => extrasApi.memoList(pk), enabled: tab === "memo" });
  const dist = useQuery({ queryKey: ["dist", pk], queryFn: () => overlaysApi.distribution(pk), enabled: tab === "hist" });

  const tabBtn = (t: typeof tab, label: string) => (
    <button key={t} onClick={() => setTab(t)} style={{
      flex: 1, border: 0, background: "none", padding: "11px 0", fontSize: 13, fontWeight: 700, cursor: "pointer",
      color: tab === t ? "var(--signal)" : "var(--muted)",
      borderBottom: tab === t ? "2px solid var(--signal)" : "2px solid var(--line)",
    }}>{label}</button>
  );

  return (
    <div className="panel" style={{ position: "sticky", top: 12 }}>
      <div style={{ display: "flex" }}>
        {tabBtn("biz", "업무")}{tabBtn("wiki", "위키")}{tabBtn("hist", "힌트")}{tabBtn("memo", "메모")}
      </div>
      <div style={{ padding: 14, minHeight: 300, maxHeight: "calc(100vh - 180px)", overflow: "auto" }}>
        {tab === "biz" && <BizTab pk={pk} listing={listing.data} refresh={() => qc.invalidateQueries({ queryKey: ["listing", pk] })} />}
        {tab === "wiki" && <WikiTab pk={pk} items={wiki.data ?? []} refresh={() => qc.invalidateQueries({ queryKey: ["wiki", pk] })} />}
        {tab === "hist" && <HistTab pk={pk} dist={dist.data ?? {}} refresh={() => { qc.invalidateQueries({ queryKey: ["dist", pk] }); qc.invalidateQueries({ queryKey: ["building", pk] }); }} />}
        {tab === "memo" && <MemoTab pk={pk} memos={memos.data ?? []} refresh={() => qc.invalidateQueries({ queryKey: ["memos", pk] })} />}
      </div>
    </div>
  );
}

/* ── 업무 탭(§4.1) — 목업 순서: 진행상태(segmented)+내광고 상단 → 담당자·긴급도·소유자타입·소유자명·관계·협조도·친절도·매수의향서·전화번호 ── */
type BizRow = { label: string; k: string; kind: "enum" | "text"; extra: string };
const BIZ_ROWS: BizRow[] = [
  { label: "긴급도", k: "urgency", kind: "enum", extra: "urgency" },
  { label: "소유자 타입", k: "owner_type", kind: "enum", extra: "owner_type" },
  { label: "소유자 명", k: "owner_name", kind: "text", extra: "성명/법인명" },
  { label: "관계", k: "relation", kind: "enum", extra: "relation" },
  { label: "협조도", k: "cooperation", kind: "enum", extra: "cooperation" },
  { label: "친절도", k: "kindness", kind: "enum", extra: "kindness" },
  { label: "매수의향서", k: "intent", kind: "enum", extra: "intent" },
  { label: "전화번호", k: "owner_phone", kind: "text", extra: "010-0000-0000" },
];

function BizTab({ pk, listing, refresh }: { pk: string; listing?: Record<string, unknown>; refresh: () => void }) {
  const en = useEnums();
  const members = useQuery({ queryKey: ["team-members"], queryFn: listingsApi.members });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api<{ account_id: number }>("/auth/me") });
  const series = useQuery({ queryKey: ["series", pk], queryFn: () => seriesApi.get(pk) });
  const building = useQuery({ queryKey: ["building", pk], queryFn: () => buildingsApi.get(pk) });
  const bd = building.data as Record<string, unknown> | undefined;
  async function saveOv(field: string, wonStr: string) {   // 원 입력 → 원 저장(오버레이)
    const t = wonStr.trim();
    await overlaysApi.put(pk, field, t ? String(Math.round(parseFloat(t))) : "");
    building.refetch();
  }
  const assignee = listing?.assignee_account_id != null ? Number(listing.assignee_account_id) : null;
  const val = (k: string) => (listing?.[k] != null ? String(listing[k]) : "");
  const status = val("status") || "미지정";
  const adPts = series.data?.ad ?? [];
  const myAd = adPts.length ? adPts[adPts.length - 1] : null;   // 내 광고(최신 팀 오버레이 점)

  async function save(k: string, v: string) {
    await listingsApi.patchBiz(pk, { [k]: v || null });
    refresh();
  }
  async function assign(id: number | null) {   // 담당자 지정=등록 · null=해제(claim이 팀권한 검증)
    await listingsApi.claim(pk, id);
    refresh();
  }

  // 미등록 = 내 매물 아님 → 등록 CTA로 잠금. 등록하면 담당자=나로 지정되며 업무 정보 열림.
  if (assignee == null) {
    return (
      <div style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center", padding: "30px 16px" }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--signal-bg)", display: "grid", placeItems: "center", fontSize: 24 }}>🏢</div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>아직 내 매물이 아닙니다</div>
        <p style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.5, margin: 0, maxWidth: 240 }}>등록하면 담당자로 지정되고 진행상태·소유자 정보 등 업무 정보를 관리할 수 있습니다.</p>
        <button className="btn primary" style={{ padding: "9px 20px", fontSize: 14, fontWeight: 700 }}
          disabled={me.data?.account_id == null} onClick={() => me.data && assign(me.data.account_id)}>＋ 내 매물로 등록하기</button>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
      {/* 진행상태(segmented) + 내 광고 뱃지 — 목업 .wk-status 상단 */}
      <div className="kv" style={{ alignItems: "flex-start" }}>
        <span className="k">진행상태</span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end" }}>
          {en.options("jindo").map((o) => (
            <button key={o.code} className={`btn ${status === o.code ? "primary" : ""}`}
              style={{ padding: "3px 8px", fontSize: 12 }} onClick={() => save("status", o.code)}>{o.label}</button>
          ))}
        </span>
      </div>
      <div className="kv" style={{ alignItems: "center" }}>
        <span className="k">내 광고</span>
        {myAd ? <span className="tag" style={{ background: "var(--green)", color: "#fff", fontWeight: 700 }}>{(Number(myAd.y) / 1e8).toFixed(1)}억</span>
              : <span style={{ color: "var(--muted)" }}>없음</span>}
      </div>

      <div style={{ margin: "6px 0 2px", fontWeight: 700 }}>업무 정보</div>
      <div className="kv" style={{ alignItems: "center" }}>
        <span className="k">담당자</span>
        <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <select className="input" style={{ maxWidth: 130, padding: "4px 8px", fontSize: 13 }}
            value={assignee ?? ""} onChange={(e) => e.target.value && assign(Number(e.target.value))}>
            {(members.data ?? []).map((m) => (
              <option key={m.account_id} value={m.account_id}>
                {m.name}{me.data?.account_id === m.account_id ? " (나)" : ""}{m.role === "owner" ? " · 대표" : ""}
              </option>
            ))}
          </select>
          <button className="btn" style={{ color: "var(--up)", padding: "3px 9px", fontSize: 12 }} title="내 매물에서 제거"
            onClick={() => { if (confirm("내 매물에서 제거할까요? (담당자 해제)")) assign(null); }}>제거</button>
        </span>
      </div>

      {/* 가격 협의 — 오버레이(보고서 매도희망가·협의금액 근거). 원 입력·억 노출·클릭 편집. 매매가와 별개 */}
      <div style={{ margin: "8px 0 2px", fontWeight: 700 }}>가격 협의</div>
      {([["ask_price", "매도희망가"], ["bid_price", "매수희망가"]] as const).map(([f, label]) => (
        <KV key={`${f}-${String(bd?.[f] ?? "")}`} label={label} field={f} value={wonToEok(bd?.[f])}
          editable money current={bd?.[f] != null ? String(bd[f]) : ""} parse={(v) => v} validate={vPos}
          onSave={(field, v) => saveOv(field, v)} onRevert={() => saveOv(f, "")} />
      ))}

      {BIZ_ROWS.map((r) => {
        if (r.kind === "text") {
          return (
            <KV key={r.k} label={r.label} field={r.k} value={val(r.k)} editable
              current={val(r.k)} parse={(v) => v} format={r.k === "owner_phone" ? formatPhone : undefined}
              onSave={(f, v) => save(f, v)} onRevert={() => save(r.k, "")} />
          );
        }
        const opts = en.options(r.extra);
        const cur = val(r.k) || "미지정";
        return (
          <div className="kv" key={r.k} style={{ alignItems: "center" }}>
            <span className="k">{r.label}</span>
            <Chips opts={opts} cur={cur} onSelect={(v) => save(r.k, v)} onRevert={() => save(r.k, "")} />
          </div>
        );
      })}
    </div>
  );
}

const WIKI_CATS = ["권리·명도", "임차인", "개발·도로", "건물상태", "소유자", "기타"];
function WikiTab({ pk, items, refresh }: { pk: string; items: Record<string, unknown>[]; refresh: () => void }) {
  const [body, setBody] = useState("");
  const [cat, setCat] = useState(WIKI_CATS[0]);
  const [showAll, setShowAll] = useState(false);
  async function vote(id: number) { await extrasApi.wikiVote(id); refresh(); }
  async function del(id: number) { if (!confirm("이 위키 글을 삭제할까요?")) return; await extrasApi.wikiDel(id); refresh(); }
  async function post() { if (!body.trim()) return; await extrasApi.wikiPost(pk, body.trim(), cat); setBody(""); refresh(); }
  const row = (w: Record<string, unknown>, full: boolean) => (
    <div key={String(w.id)} style={{ borderBottom: "1px solid var(--line)", padding: "9px 0", display: "flex", gap: 8, alignItems: "flex-start" }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--signal)", background: "var(--signal-bg)", padding: "1px 8px", borderRadius: 999 }}>{String(w.category ?? "일반")}</span>
          {full && w.author != null && <span style={{ fontSize: 11, color: "var(--muted)" }}>{String(w.author)}</span>}
        </div>
        <div style={{ lineHeight: 1.45 }}>{String(w.body)}</div>
      </div>
      <div style={{ display: "flex", gap: 4, flex: "0 0 auto" }}>
        <button className="tool-btn" style={{ minWidth: 46, height: 28, fontSize: 12, background: "var(--surface-2)" }} onClick={() => vote(Number(w.id))} title="동의(다시 누르면 취소)">👍 {String(w.votes)}</button>
        {Boolean(w.mine) && <button className="tool-btn" style={{ minWidth: 28, height: 28, fontSize: 12, color: "var(--up)" }} onClick={() => del(Number(w.id))} title="내 글 삭제">✕</button>}
      </div>
    </div>
  );
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
          <button className="btn primary" style={{ flex: "0 0 auto" }} onClick={post}>등록</button>
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
function HistTab({ pk, dist, refresh }: { pk: string; dist: Record<string, { label: string; values: { value: string; count: number }[] }>; refresh: () => void }) {
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

function MemoTab({ pk, memos, refresh }: { pk: string; memos: Record<string, unknown>[]; refresh: () => void }) {
  const [body, setBody] = useState("");
  const [kind, setKind] = useState<"team" | "secret">("team");
  async function add() { if (!body.trim()) return; await extrasApi.memoAdd(pk, kind, body.trim()); setBody(""); refresh(); }
  async function del(id: number) { if (!confirm("이 메모를 삭제할까요?")) return; await extrasApi.memoDel(pk, id); refresh(); }
  return (
    <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
      {memos.length === 0 && <p style={{ color: "var(--muted)" }}>메모가 없습니다</p>}
      {memos.map((m) => {
        const secret = m.kind === "secret";
        return (
          <div key={String(m.id)} style={{ padding: "8px 10px", borderRadius: 8, lineHeight: 1.45, display: "flex", gap: 8, alignItems: "flex-start",
            background: secret ? "#FFF7ED" : "var(--surface-2)", border: `1px solid ${secret ? "#FED7AA" : "var(--line)"}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              {secret && <span style={{ fontSize: 10.5, fontWeight: 700, color: "var(--vacant)", marginRight: 6 }}>🔒 비밀</span>}
              {String(m.body)}
            </div>
            {Boolean(m.mine) && <button className="tool-btn" style={{ minWidth: 24, height: 24, fontSize: 12, color: "var(--up)", flex: "0 0 auto" }} onClick={() => del(Number(m.id))} title="내 메모 삭제">✕</button>}
          </div>
        );
      })}
      {/* 작성 — 세그먼트(팀/비밀) + 본문 */}
      <div style={{ display: "grid", gap: 6, marginTop: 2 }}>
        <div style={{ display: "inline-flex", background: "var(--surface-2)", borderRadius: 8, padding: 2, width: "fit-content" }}>
          {(["team", "secret"] as const).map((k) => (
            <button key={k} onClick={() => setKind(k)} style={{ border: "none", cursor: "pointer", fontSize: 12, fontWeight: 600, padding: "4px 12px", borderRadius: 6,
              background: kind === k ? "#fff" : "transparent", color: kind === k ? (k === "secret" ? "var(--vacant)" : "var(--signal)") : "var(--muted)", boxShadow: kind === k ? "var(--shadow)" : "none" }}>
              {k === "team" ? "팀 메모" : "🔒 비밀메모"}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <input className="input" placeholder={kind === "secret" ? "비밀메모 (담당자·대표만)" : "팀 메모 (팀 전체)"} value={body}
            onChange={(e) => setBody(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) add(); }} />
          <button className="btn primary" style={{ flex: "0 0 auto" }} onClick={add}>저장</button>
        </div>
        {kind === "secret" && <p style={{ color: "var(--muted)", fontSize: 11, margin: 0 }}>🔒 담당자 본인 + 대표만 · 보고서·분포 제외</p>}
      </div>
    </div>
  );
}
