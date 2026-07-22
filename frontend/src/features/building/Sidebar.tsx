import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listingsApi, extrasApi, overlaysApi } from "../../shared/api/endpoints";
import { api } from "../../shared/api/client";
import { useEnums } from "../../shared/hooks/useEnums";

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
    <div className="panel" style={{ position: "sticky", top: 70 }}>
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

/* ── 업무 탭(§4.1): 담당자(=선점) + 진행상태/긴급도/소유자타입·관계·협조도·친절도·매수의향서 enum + 소유자명/내용/전화 텍스트 ── */
const BIZ_ENUM: [string, string, string][] = [
  ["진행상태", "status", "jindo"],
  ["긴급도", "urgency", "urgency"],
  ["소유자 타입", "owner_type", "owner_type"],
  ["관계", "relation", "relation"],
  ["협조도", "cooperation", "cooperation"],
  ["친절도", "kindness", "kindness"],
  ["매수의향서", "intent", "intent"],
];
const BIZ_TEXT: [string, string, string][] = [
  ["소유자 명", "owner_name", "성명/법인명"],
  ["전화번호", "owner_phone", "010-0000-0000"],
];

function BizTab({ pk, listing, refresh }: { pk: string; listing?: Record<string, unknown>; refresh: () => void }) {
  const en = useEnums();
  const registered = listing?.registered === true;
  const val = (k: string) => (listing?.[k] != null ? String(listing[k]) : "");

  async function save(k: string, v: string) {
    await listingsApi.patchBiz(pk, { [k]: v || null });
    refresh();
  }
  async function claim(on: boolean) {
    const me = on ? (await api<{ account_id: number }>("/auth/me")).account_id : null;
    await listingsApi.claim(pk, me);
    refresh();
  }

  return (
    <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
      <div className="kv"><span className="k">등록 상태</span><span className="v">{registered ? "내 매물" : "미등록"}</span></div>
      {registered
        ? <button className="btn" onClick={() => claim(false)}>등록 해제 (담당자 비우기)</button>
        : <button className="btn primary" onClick={() => claim(true)}>내 매물로 등록 (담당자 = 나)</button>}

      <div style={{ margin: "6px 0 2px", fontWeight: 700 }}>업무 정보 <small style={{ color: "var(--muted)", fontWeight: 400 }}>변경 즉시 저장</small></div>
      {BIZ_ENUM.map(([label, k, ek]) => {
        const opts = en.options(ek);
        const cur = val(k) || "미지정";
        return (
          <div className="kv" key={k} style={{ alignItems: "center" }}>
            <span className="k">{label}</span>
            <select className="input" style={{ maxWidth: 140, padding: "4px 8px", fontSize: 13 }}
              value={cur} onChange={(e) => save(k, e.target.value)}>
              {opts.length === 0 && <option>{cur}</option>}
              {opts.map((o) => <option key={o.code} value={o.code}>{o.label}</option>)}
            </select>
          </div>
        );
      })}

      <div style={{ margin: "6px 0 2px", fontWeight: 700 }}>소유자 <small style={{ color: "var(--muted)", fontWeight: 400 }}>blur = 자동저장</small></div>
      {BIZ_TEXT.map(([label, k, ph]) => (
        <div className="kv" key={k} style={{ alignItems: "center" }}>
          <span className="k">{label}</span>
          <input className="input" style={{ maxWidth: 150, padding: "4px 8px", fontSize: 13, textAlign: "right" }}
            defaultValue={val(k)} placeholder={ph} key={val(k)}
            onBlur={(e) => { if (e.target.value !== val(k)) save(k, e.target.value); }} />
        </div>
      ))}
      <p style={{ color: "var(--muted)", fontSize: 11 }}>전화번호는 담당자 본인·대표만 원문 조회(그 외 마스킹).</p>
    </div>
  );
}

function WikiTab({ pk, items, refresh }: { pk: string; items: Record<string, unknown>[]; refresh: () => void }) {
  const [body, setBody] = useState("");
  return (
    <div style={{ display: "grid", gap: 8, fontSize: 13 }}>
      {items.map((w) => (
        <div key={String(w.id)} style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
          <b style={{ color: "var(--signal)" }}>{String(w.category ?? "일반")}</b> {String(w.body)}
          <span style={{ color: "var(--muted)", marginLeft: 6 }}>👍 {String(w.votes)}</span>
        </div>
      ))}
      {items.length === 0 && <p style={{ color: "var(--muted)" }}>등록된 특이사항이 없습니다</p>}
      <div style={{ display: "flex", gap: 6 }}>
        <input className="input" placeholder="특이사항 (전체 공유)" value={body} onChange={(e) => setBody(e.target.value)} />
        <button className="btn" onClick={async () => { if (!body.trim()) return; await extrasApi.wikiPost(pk, body.trim()); setBody(""); refresh(); }}>등록</button>
      </div>
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
