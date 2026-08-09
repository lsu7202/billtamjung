import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  buyersApi, proposalsApi, PROPOSAL_STATUSES, REJECT_REASONS,
  type Buyer, type Proposal, type ProposalStatus,
} from "../../shared/api/endpoints";
import { FilterModal, activeCount, type Values, type RegionPick } from "../search/FilterModal";
import { Loading } from "../../shared/ui/Spinner";
import { Icon } from "../../shared/ui/Icon";
import { Segmented } from "../../shared/ui/Segmented";
import { openDetail } from "../../shared/map/geo";
import { won } from "../../shared/format";
import "./sales.css";

/** S04 영업관리 — 매도자·매물·매수자를 잇는 자리.
 *  중심축은 '제안'이다. 엑셀의 매수자 시트가 실제로는 제안 이력 장부였다.
 *  매수자 조건은 검색 필터와 **같은 스키마**라 조건 편집에 상세검색 모달을 그대로 쓴다. */

type Cond = { values?: Values; regions?: RegionPick[]; polygon?: object | null };

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
        <small>매수자를 등록하고, 매물 상세에서 「맞는 매수자」로 담으면 여기 모입니다</small>
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
  const [cond, setCond] = useState<Buyer | null>(null);
  if (loading) return <Loading label="불러오는 중" minHeight="40vh" />;
  const list = rows ?? [];
  if (!list.length) {
    return <div className="panel sales-empty">등록된 매수자가 없습니다<small>「매수자 추가」로 시작합니다</small></div>;
  }
  return (
    <>
      <div className="panel">
        <table className="wf">
          <thead><tr>
            <th>이름</th><th>등급</th><th>연락처</th><th>유입</th><th>조건</th><th className="num">진행</th><th>메모</th>
          </tr></thead>
          <tbody>
            {list.map((b) => {
              const c = (b.conditions_json ?? {}) as Cond;
              const n = activeCount(c.values ?? {}, c.regions ?? []);
              return (
                <tr key={b.id}>
                  <td><b>{b.name}</b>{b.is_corp ? <span className="tag">법인</span> : null}</td>
                  <td>{b.grade ?? "—"}</td>
                  <td>{b.phone ?? "—"}</td>
                  <td>{b.source ?? "—"}</td>
                  <td>
                    <button className="lnk" onClick={() => setCond(b)}>
                      <Icon name="filter" size={12} style={{ verticalAlign: "-2px", marginRight: 3 }} />
                      {n ? `조건 ${n}개` : "조건 설정"}
                    </button>
                  </td>
                  <td className="num">{b.active_proposals}</td>
                  <td className="memo">{b.memo ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {/* 조건 = 검색 필터와 같은 스키마라 상세검색 모달을 그대로 쓴다. 두 벌을 따로 만들지 않는다. */}
      {cond && (
        <FilterModal
          initialValues={((cond.conditions_json as Cond).values) ?? {}}
          initialRegions={((cond.conditions_json as Cond).regions) ?? []}
          initialPolygon={((cond.conditions_json as Cond).polygon) ?? null}
          onClose={() => setCond(null)}
          onApply={async (r) => {
            await buyersApi.update(cond.id, { conditions: { values: r.values, regions: r.regions, polygon: r.polygon ?? null } });
            setCond(null); onDone();
          }}
        />
      )}
    </>
  );
}

function NewBuyer({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: "", phone: "", grade: "", source: "", is_corp: false, memo: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF({ ...f, [k]: k === "is_corp" ? (e.target as HTMLInputElement).checked : e.target.value });
  const save = async () => {
    if (!f.name.trim()) return;
    await buyersApi.create({ ...f, name: f.name.trim(), conditions: {} });
    setOpen(false); setF({ name: "", phone: "", grade: "", source: "", is_corp: false, memo: "" });
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
              <label>이름<input className="input" autoFocus value={f.name} onChange={set("name")} /></label>
              <label>연락처<input className="input" value={f.phone} onChange={set("phone")} /></label>
              <label>등급<input className="input" placeholder="A / B / C" value={f.grade} onChange={set("grade")} /></label>
              <label>유입경로<input className="input" placeholder="소개 · 광고 · 직접문의" value={f.source} onChange={set("source")} /></label>
              <label className="chk"><input type="checkbox" checked={f.is_corp} onChange={set("is_corp")} />법인</label>
            </div>
            {/* 필터로 안 잡히는 조건은 여기 남긴다 — 매칭에는 안 걸린다 */}
            <textarea className="input" rows={2} placeholder="메모 (예: 식당 임차X · 대로변)" value={f.memo} onChange={set("memo")} />
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
