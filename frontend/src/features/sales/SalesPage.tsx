import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  buyersApi, proposalsApi, PROPOSAL_STATUSES, REJECT_REASONS,
  type Buyer, type BuyerCondition, type Proposal, type ProposalStatus, type AttrFilters,
} from "../../shared/api/endpoints";
import { activeCount, type Values, type RegionPick } from "../search/FilterModal";
import { Loading } from "../../shared/ui/Spinner";
import { Icon } from "../../shared/ui/Icon";
import { Segmented } from "../../shared/ui/Segmented";
import { Chips } from "../building/EnumField";
import { useEnums } from "../../shared/hooks/useEnums";
import { openDetail } from "../../shared/map/geo";
import { won } from "../../shared/format";
import "./sales.css";

/** S04 영업관리 — 매도자·매물·매수자를 잇는 자리. 중심축은 '제안'이다.
 *
 *  여기서 매물을 고르지 않는다. 조건에 걸리는 매물을 목록으로 뿌리고 담게 하면,
 *  "이 사람에게 돌릴 만한가"를 필터 한 번으로 정하는 셈이 된다. 실제 판단은
 *  지도(위치·입지) · 사이드바(주변 실거래) · 상세보기(수익률·건물상태)를 보고 나온다.
 *  그래서 조건은 **검색 화면으로 들고 나가고**(영역 그리기도 지도가 있어야 된다),
 *  담는 일은 매물 상세의 「매수자」 탭에서 한다. */

type Cond = { values?: Values; regions?: RegionPick[]; polygon?: object | null; filters?: AttrFilters };

const py = (m2?: number | null) => (m2 ? `${Math.round(m2 / 3.305785)}평` : "—");

export function SalesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"board" | "buyers">("board");
  const buyers = useQuery({ queryKey: ["buyers"], queryFn: buyersApi.list });
  const proposals = useQuery({ queryKey: ["proposals"], queryFn: () => proposalsApi.list() });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["buyers"] });
    qc.invalidateQueries({ queryKey: ["proposals"] });
  };

  return (
    <div className="page sales">
      <div className="toolbar" style={{ margin: "0 2px 10px" }}>
        <Segmented value={tab} onChange={(v) => setTab(v as typeof tab)}
          options={[{ value: "board", label: "제안 보드" }, { value: "buyers", label: "매수자" }]} />
        <span style={{ flex: 1 }} />
        {tab === "buyers" && <NewBuyer onDone={refresh} />}
      </div>

      {tab === "board"
        ? <Board rows={proposals.data} loading={proposals.isLoading} onDone={refresh} />
        : <Buyers rows={buyers.data} loading={buyers.isLoading} onDone={refresh} />}
    </div>
  );
}

/* ── 제안 보드 — 열 = 상태. 첫 열(후보)이 곧 오늘 할 일이다. ── */
function Board({ rows, loading, onDone }: { rows?: Proposal[]; loading: boolean; onDone: () => void }) {
  const [reject, setReject] = useState<Proposal | null>(null);
  if (loading) return <Loading label="불러오는 중" minHeight="40vh" />;
  const list = rows ?? [];
  if (!list.length) {
    return (
      <div className="panel sales-empty">
        아직 제안이 없습니다
        <small>매물 상세의 「매수자」 탭에서 담으면 여기 모입니다</small>
      </div>
    );
  }
  const move = async (p: Proposal, status: ProposalStatus) => {
    if (status === "거절") { setReject(p); return; }
    await proposalsApi.update(p.id, { status });
    onDone();
  };
  return (
    <>
      <div className="board">
        {PROPOSAL_STATUSES.map((st) => {
          const col = list.filter((p) => p.status === st);
          return (
            <div className="bd-col" key={st}>
              <div className={`bd-head ${st === "거절" ? "off" : ""}`}>{st}<span>{col.length}</span></div>
              <div className="bd-body">
                {col.map((p) => (
                  <div className="bd-card" key={p.id}>
                    <div className="a" onClick={() => openDetail(p.building_pk)}>
                      {(p.addr ?? "").replace("서울특별시 ", "").replace("번지", "")}
                    </div>
                    <div className="m">
                      <b>{p.price ? won(p.price) : "—"}</b>
                      <span>대지 {py(p.land_area)} · 연 {py(p.total_area)}</span>
                    </div>
                    <div className="b">
                      <span className="who">{p.buyer_name}{p.buyer_grade ? ` · ${p.buyer_grade}` : ""}</span>
                      {p.propose_count > 1 && <span className="rep">재제안 {p.propose_count}</span>}
                    </div>
                    {p.status === "거절" && p.reject_reason && (
                      <div className="rj">
                        {REJECT_REASONS.find((r) => r.k === p.reject_reason)?.label ?? p.reject_reason}
                        {p.reject_price ? ` · 상한 ${won(p.reject_price)}` : ""}
                      </div>
                    )}
                    <div className="mv">
                      {PROPOSAL_STATUSES.filter((s) => s !== p.status).map((s) => (
                        <button key={s} onClick={() => move(p, s)}>{s}</button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {reject && <RejectModal p={reject} onClose={() => setReject(null)} onDone={() => { setReject(null); onDone(); }} />}
    </>
  );
}

/* 거절은 사유 없이 못 넘어간다 — 사유 없는 거절은 나중에 아무것도 못 읽는다. */
function RejectModal({ p, onClose, onDone }: { p: Proposal; onClose: () => void; onDone: () => void }) {
  const [reason, setReason] = useState("");
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const save = async () => {
    if (!reason) return;
    await proposalsApi.update(p.id, {
      status: "거절", reject_reason: reason,
      reject_price: reason === "price" && price ? Math.round(parseFloat(price) * 1e8) : null,
      note: note || null,
    });
    onDone();
  };
  return (
    <div className="overlay" onClick={onClose}>
      <div className="mini" onClick={(e) => e.stopPropagation()}>
        <h3>거절 사유</h3>
        <div className="rj-grid">
          {REJECT_REASONS.map((r) => (
            <button key={r.k} className={reason === r.k ? "on" : ""} onClick={() => setReason(r.k)}>{r.label}</button>
          ))}
        </div>
        {reason === "price" && (
          <label className="rj-row">얼마면 하겠다
            <input className="input" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d.]/g, ""))}
              style={{ width: 80, textAlign: "right" }} /><span>억</span></label>
        )}
        <textarea className="input" rows={2} placeholder="메모" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="mini-foot">
          <button className="mini-cancel" onClick={onClose}>취소</button>
          <button className="apply" disabled={!reason} onClick={save}>저장</button>
        </div>
      </div>
    </div>
  );
}

/* ── 매수자 ── */
function Buyers({ rows, loading, onDone }: { rows?: Buyer[]; loading: boolean; onDone: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const { options } = useEnums();
  if (loading) return <Loading label="불러오는 중" minHeight="40vh" />;
  const list = rows ?? [];
  if (!list.length) {
    return <div className="panel sales-empty">등록된 매수자가 없습니다<small>「매수자 추가」로 시작합니다</small></div>;
  }
  const save = async (b: Buyer, patch: Record<string, unknown>) => { await buyersApi.update(b.id, patch); onDone(); };
  return (
    <div className="panel">
      <table className="wf">
        <thead><tr>
          <th>이름</th><th>등급</th><th>유입</th><th>연락처</th><th>조건</th><th className="num">진행</th><th>메모</th>
        </tr></thead>
        <tbody>
          {list.map((b) => (
            <Fragment key={b.id}>
              <tr>
                <td><b>{b.name}</b>{b.is_corp ? <span className="tag">법인</span> : null}</td>
                {/* 선택형은 전부 칩 — 자유입력이면 사람마다 다르게 적고 집계가 안 된다(시스템 일관성) */}
                <td><Chips opts={options("buyer_grade")} cur={b.grade ?? "미지정"}
                  onSelect={(v) => save(b, { grade: v === "미지정" ? null : v })} /></td>
                <td><Chips opts={options("buyer_source")} cur={b.source ?? "미지정"}
                  onSelect={(v) => save(b, { source: v === "미지정" ? null : v })} /></td>
                <td>{b.phone ?? "—"}</td>
                <td>
                  <button className="lnk" onClick={() => setOpen(open === b.id ? null : b.id)}>
                    <Icon name="filter" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />
                    조건 {b.conditions.length}개
                  </button>
                </td>
                <td className="num">{b.active_proposals}</td>
                <td className="memo">{b.memo ?? ""}</td>
              </tr>
              {open === b.id && (
                <tr><td colSpan={7} style={{ padding: 0, background: "var(--surface-2)" }}>
                  <Conditions buyer={b} onDone={onDone} />
                </td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* 조건 세트 — 여러 개. 편집·신규 모두 **검색 화면으로 나간다**.
   모달만 띄우면 지도가 없어 「영역 그리기」를 못 쓴다. 조건을 잡는 일 자체가 지도를 보며 하는 일이다. */
function Conditions({ buyer, onDone }: { buyer: Buyer; onDone: () => void }) {
  const nav = useNavigate();
  const edit = (c?: BuyerCondition) => {
    nav("/search", { state: { buyerCond: {
      buyer_id: buyer.id, buyer_name: buyer.name,
      cond_id: c?.id ?? null, name: c?.name ?? "새 조건",
      conditions: c?.conditions_json ?? {},
    } } });
  };
  const del = async (cid: number) => { await buyersApi.removeCondition(cid); onDone(); };
  return (
    <div className="cd-wrap">
      {buyer.conditions.map((c) => {
        const j = (c.conditions_json ?? {}) as Cond;
        const n = activeCount(j.values ?? {}, j.regions ?? []);
        return (
          <div className="cd-row" key={c.id}>
            <span className="nm">{c.name}</span>
            <span className="ct">조건 {n}개{j.polygon ? " · 그린 영역" : ""}</span>
            <span className="sp" />
            <button className="lnk" onClick={() => edit(c)}>지도에서 열기</button>
            <button className="lnk del" onClick={() => del(c.id)}>삭제</button>
          </div>
        );
      })}
      {!buyer.conditions.length && <div className="cd-none">조건이 없습니다 — 지도에서 잡아 저장합니다</div>}
      <button className="btn" style={{ marginTop: 6, padding: "3px 10px", fontSize: 12 }} onClick={() => edit()}>
        <Icon name="plus" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />조건 추가</button>
    </div>
  );
}

function NewBuyer({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const { options } = useEnums();
  const [f, setF] = useState({ name: "", phone: "", grade: "미지정", source: "미지정", is_corp: false, memo: "" });
  const save = async () => {
    if (!f.name.trim()) return;
    await buyersApi.create({
      name: f.name.trim(), phone: f.phone || null, memo: f.memo || null, is_corp: f.is_corp,
      grade: f.grade === "미지정" ? null : f.grade, source: f.source === "미지정" ? null : f.source,
    });
    setOpen(false); setF({ name: "", phone: "", grade: "미지정", source: "미지정", is_corp: false, memo: "" });
    onDone();
  };
  return (
    <>
      <button className="btn primary" onClick={() => setOpen(true)}>
        <Icon name="plus" size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />매수자 추가</button>
      {open && (
        <div className="overlay" onClick={() => setOpen(false)}>
          <div className="mini" onClick={(e) => e.stopPropagation()}>
            <h3>매수자 추가</h3>
            <div className="nb-grid">
              <label>이름<input className="input" autoFocus value={f.name}
                onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
              <label>연락처<input className="input" value={f.phone}
                onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
              <label>등급<span><Chips opts={options("buyer_grade")} cur={f.grade}
                onSelect={(v) => setF({ ...f, grade: v })} /></span></label>
              <label>유입경로<span><Chips opts={options("buyer_source")} cur={f.source}
                onSelect={(v) => setF({ ...f, source: v })} /></span></label>
              <label className="chk"><input type="checkbox" checked={f.is_corp}
                onChange={(e) => setF({ ...f, is_corp: e.target.checked })} />법인</label>
            </div>
            {/* 필터로 안 잡히는 조건은 여기 남긴다 — 매칭에는 안 걸린다 */}
            <textarea className="input" rows={2} placeholder="메모 (예: 식당 임차X · 대로변)"
              value={f.memo} onChange={(e) => setF({ ...f, memo: e.target.value })} />
            <div className="mini-foot">
              <button className="mini-cancel" onClick={() => setOpen(false)}>취소</button>
              <button className="apply" disabled={!f.name.trim()} onClick={save}>추가</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
