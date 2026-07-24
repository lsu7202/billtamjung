import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listingsApi, extrasApi, overlaysApi } from "../../shared/api/endpoints";
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
        {tabBtn("biz", "업무")}{tabBtn("wiki", "위키")}{tabBtn("hist", "수정이력")}{tabBtn("memo", "메모")}
      </div>
      <div style={{ padding: 14, minHeight: 300, maxHeight: "calc(100vh - 180px)", overflow: "auto" }}>
        {tab === "biz" && <BizTab pk={pk} listing={listing.data} refresh={() => qc.invalidateQueries({ queryKey: ["listing", pk] })} />}
        {tab === "wiki" && <WikiTab pk={pk} items={wiki.data ?? []} refresh={() => qc.invalidateQueries({ queryKey: ["wiki", pk] })} />}
        {tab === "hist" && <HistTab dist={dist.data ?? {}} />}
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
  const ads = useQuery({ queryKey: ["ads", pk], queryFn: () => extrasApi.adPrices(pk) });
  const assignee = listing?.assignee_account_id != null ? Number(listing.assignee_account_id) : null;
  const val = (k: string) => (listing?.[k] != null ? String(listing[k]) : "");
  const status = val("status") || "미지정";
  const myAd = (ads.data ?? []).find((a) => a.is_mine && a.price != null);   // 내 광고(최신 관측)

  async function save(k: string, v: string) {
    await listingsApi.patchBiz(pk, { [k]: v || null });
    refresh();
  }
  async function assign(id: number | null) {   // 담당자 지정=등록 · 미지정=해제(claim이 팀권한 검증)
    await listingsApi.claim(pk, id);
    refresh();
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
        {myAd ? <span className="tag" style={{ background: "var(--green)", color: "#fff", fontWeight: 700 }}>{(Number(myAd.price) / 1e8).toFixed(1)}억</span>
              : <span style={{ color: "var(--muted)" }}>없음</span>}
      </div>

      <div style={{ margin: "6px 0 2px", fontWeight: 700 }}>업무 정보 <small style={{ color: "var(--muted)", fontWeight: 400 }}>변경 즉시 저장</small></div>
      <div className="kv" style={{ alignItems: "center" }}>
        <span className="k">담당자 <small style={{ color: "var(--muted)", fontWeight: 400 }}>지정=등록</small></span>
        <select className="input" style={{ maxWidth: 150, padding: "4px 8px", fontSize: 13 }}
          value={assignee ?? ""} onChange={(e) => assign(e.target.value ? Number(e.target.value) : null)}>
          <option value="">미지정 (등록 해제)</option>
          {(members.data ?? []).map((m) => (
            <option key={m.account_id} value={m.account_id}>
              {m.name}{me.data?.account_id === m.account_id ? " (나)" : ""}{m.role === "owner" ? " · 대표" : ""}
            </option>
          ))}
        </select>
      </div>

      {BIZ_ROWS.map((r) => {
        if (r.kind === "text") {
          return (
            <div className="kv" key={r.k} style={{ alignItems: "center" }}>
              <span className="k">{r.label}</span>
              <input className="input" style={{ maxWidth: 150, padding: "4px 8px", fontSize: 13, textAlign: "right" }}
                defaultValue={val(r.k)} placeholder={r.extra} key={val(r.k)}
                onBlur={(e) => { if (e.target.value !== val(r.k)) save(r.k, e.target.value); }} />
            </div>
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
      <p style={{ color: "var(--muted)", fontSize: 11 }}>전화번호는 담당자 본인·대표만 원문 조회(그 외 마스킹).</p>
    </div>
  );
}

function WikiTab({ pk, items, refresh }: { pk: string; items: Record<string, unknown>[]; refresh: () => void }) {
  const [body, setBody] = useState("");
  const [showAll, setShowAll] = useState(false);
  async function vote(id: number) { await extrasApi.wikiVote(id); refresh(); }
  const row = (w: Record<string, unknown>, full: boolean) => (
    <div key={String(w.id)} style={{ borderBottom: "1px solid var(--line)", padding: "6px 0", display: "flex", gap: 8, alignItems: "flex-start" }}>
      <div style={{ flex: 1 }}>
        <b style={{ color: "var(--signal)" }}>{String(w.category ?? "일반")}</b> {String(w.body)}
        {full && w.author_name != null && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{String(w.author_name)}</div>}
      </div>
      <button className="btn" style={{ padding: "2px 8px", fontSize: 12, flex: "0 0 auto" }} onClick={() => vote(Number(w.id))} title="동의(다시 누르면 취소)">👍 {String(w.votes)}</button>
    </div>
  );
  return (
    <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
      {items.slice(0, 3).map((w) => row(w, false))}
      {items.length === 0 && <p style={{ color: "var(--muted)" }}>등록된 특이사항이 없습니다</p>}
      {items.length > 3 && <button className="btn" onClick={() => setShowAll(true)}>전체보기 {items.length}</button>}
      <div style={{ display: "flex", gap: 6 }}>
        <input className="input" placeholder="특이사항 (전체 공유)" value={body} onChange={(e) => setBody(e.target.value)} />
        <button className="btn" onClick={async () => { if (!body.trim()) return; await extrasApi.wikiPost(pk, body.trim()); setBody(""); refresh(); }}>등록</button>
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
function HistTab({ dist }: { dist: Record<string, { label: string; values: { value: string; count: number }[] }> }) {
  const entries = Object.entries(dist);
  if (entries.length === 0) {
    return <p style={{ color: "var(--muted)", fontSize: 13 }}>공공 필드 정정 이력이 없습니다.<br />값을 수정하면 익명 분포로 다른 이용자에게 힌트가 됩니다.</p>;
  }
  return (
    <div style={{ display: "grid", gap: 12, fontSize: 13 }}>
      <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>다른 이용자들은 이 값을 무엇으로 갖고 있나 (익명 · 공공 필드만 · 마스터 불변)</p>
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
  return (
    <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
      {memos.map((m) => (
        <div key={String(m.id)} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 6 }}>
          {m.kind === "secret" && <span className="tag stale" style={{ marginRight: 6 }}>비밀</span>}
          {String(m.body)}
        </div>
      ))}
      {memos.length === 0 && <p style={{ color: "var(--muted)" }}>메모가 없습니다</p>}
      <div style={{ display: "flex", gap: 6 }}>
        <select className="input" style={{ width: 80 }} value={kind} onChange={(e) => setKind(e.target.value as "team" | "secret")}>
          <option value="team">팀</option><option value="secret">비밀</option>
        </select>
        <input className="input" placeholder="메모" value={body} onChange={(e) => setBody(e.target.value)} />
        <button className="btn" onClick={async () => { if (!body.trim()) return; await extrasApi.memoAdd(pk, kind, body.trim()); setBody(""); refresh(); }}>저장</button>
      </div>
      {kind === "secret" && <p style={{ color: "var(--muted)", fontSize: 11 }}>비밀메모 = 담당자 본인 + 대표만. 보고서·분포 제외.</p>}
    </div>
  );
}
