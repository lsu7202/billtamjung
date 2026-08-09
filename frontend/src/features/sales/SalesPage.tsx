import { Fragment, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  buyersApi, proposalsApi, contactsApi, PROPOSAL_STATUSES, REJECT_REASONS,
  type Buyer, type BuyerCondition, type Proposal, type ProposalStatus, type AttrFilters,
} from "../../shared/api/endpoints";
import { activeCount, type Values, type RegionPick } from "../search/FilterModal";
import { Loading } from "../../shared/ui/Spinner";
import { Icon } from "../../shared/ui/Icon";
import { Segmented } from "../../shared/ui/Segmented";
import { Chips } from "../building/EnumField";
import { formatPhone, parseAmount } from "../building/KV";
import { useUnit } from "../../shared/hooks/useUnit";
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

export function SalesPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<"board" | "buyers">(
    new URLSearchParams(window.location.search).get("buyer") ? "buyers" : "board");
  // 보드 카드에서 사람 이름을 누르면 그 매수자로 간다 — 지금은 눌러도 아무 일이 없었다
  // 매물 상세에서 /sales?buyer=12 로 넘어오면 그 사람을 펼쳐서 연다
  const [sp] = useSearchParams();
  const fromUrl = sp.get("buyer") ? Number(sp.get("buyer")) : null;
  const [focusBuyer, setFocusBuyer] = useState<number | null>(fromUrl);
  const goBuyer = (id: number) => { setFocusBuyer(id); setTab("buyers"); };
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
        ? <Board rows={proposals.data} loading={proposals.isLoading} onDone={refresh} onBuyer={goBuyer} />
        : <Buyers rows={buyers.data} loading={buyers.isLoading} onDone={refresh} focus={focusBuyer} />}
    </div>
  );
}

/* ── 제안 보드 — 열 = 상태. 첫 열(후보)이 곧 오늘 할 일이다. ── */
function Board({ rows, loading, onDone, onBuyer }: {
  rows?: Proposal[]; loading: boolean; onDone: () => void; onBuyer: (id: number) => void;
}) {
  const [reject, setReject] = useState<Proposal | null>(null);
  const { area } = useUnit();   // 매물 상세에서 ㎡로 보다가 여기 오면 평이 되면 안 된다
  const [err, setErr] = useState<string | null>(null);
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
    try {
      setErr(null);
      await proposalsApi.update(p.id, { status });
      onDone();
    } catch (e) {
      setErr(String((e as Error)?.message ?? "상태를 바꾸지 못했습니다"));
    }
  };
  return (
    <>
      {err && <div className="sales-err">{err}</div>}
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
                      <span>대지 {area(p.land_area, 0)} · 연 {area(p.total_area, 0)}</span>
                    </div>
                    <div className="b">
                      <span className="who lnk" onClick={() => onBuyer(p.buyer_id)}
                        title="이 매수자 보기">{p.buyer_name}{p.buyer_grade ? ` · ${p.buyer_grade}` : ""}</span>
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
      // 금액은 앱 전체가 같은 파서를 쓴다 — "115"·"1억5천" 다 받는다(KV money와 동일)
      reject_price: reason === "price" && price.trim() ? parseAmount(price) : null,
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
            <input className="input" value={price}
              onChange={(e) => setPrice(e.target.value.replace(/[^\d.,조억만천원]/g, ""))}
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
function Buyers({ rows, loading, onDone, focus }: {
  rows?: Buyer[]; loading: boolean; onDone: () => void; focus?: number | null;
}) {
  const [open, setOpen] = useState<number | null>(focus ?? null);
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
                {/* 연락처는 담당자 본인·대표만 원본. 가려진 값은 표시로 알린다 —
                    가려진 줄 모르고 그 값을 옮겨 적으면 안 된다. */}
                <td>{b.phone
                  ? <span title={b.phone_masked ? "담당자 본인 또는 대표만 볼 수 있습니다" : undefined}
                      style={b.phone_masked ? { color: "var(--muted)" } : undefined}>
                      {b.phone_masked ? b.phone : formatPhone(b.phone)}{b.phone_masked ? <Icon name="lock" size={11} style={{ verticalAlign: "-1px", marginLeft: 3 }} /> : null}
                    </span>
                  : "—"}</td>
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
                  <div className="bx-grid">
                    <Conditions buyer={b} onDone={onDone} />
                    <Contacts buyerId={b.id} />
                  </div>
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
  // 앱의 파괴적 행위는 전부 확인을 받는다(매물 층 삭제·팀원 제외·전체 되돌리기와 같은 규칙)
  const del = async (cid: number, name: string) => {
    if (!confirm(`조건 「${name}」을(를) 지울까요?`)) return;
    await buyersApi.removeCondition(cid); onDone();
  };
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
            <button className="lnk del" onClick={() => del(c.id, c.name)}>삭제</button>
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
              {/* 전화번호 자동 하이픈 — 매물 업무탭과 같은 규칙(formatPhone). 화면마다 다르면 안 된다 */}
              <label>연락처<input className="input" value={f.phone} inputMode="tel" placeholder="010-0000-0000"
                onChange={(e) => setF({ ...f, phone: formatPhone(e.target.value) })} /></label>
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

/* 접촉 이력 — 매도자 쪽과 같은 표를 쓴다(app.contacts). "마지막으로 언제 연락했나"가 안 보이면
   매수자 관리가 결국 수첩으로 돌아간다.
   날짜는 업무탭(접수일·사용승인일)과 같은 규칙 — 8자리를 치면 ISO로 저장한다.
   오늘 고정이면 어제 통화를 못 적는다. */
function Contacts({ buyerId }: { buyerId: number }) {
  const qc = useQueryClient();
  const key = ["contacts", "buyer", buyerId];
  const q = useQuery({ queryKey: key, queryFn: () => contactsApi.list("buyer", String(buyerId)) });
  const [kind, setKind] = useState("전화");
  const [note, setNote] = useState("");
  const [when, setWhen] = useState(todayYmd());
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    const iso = parseYmd(when);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) { setErr("날짜는 20260809 또는 2026-08-09 형식"); return; }
    try {
      setErr(null);
      await contactsApi.create({
        target_type: "buyer", target_id: String(buyerId), kind,
        occurred_on: iso, note: note || undefined,
      });
      setNote(""); qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setErr(String((e as Error)?.message ?? "기록하지 못했습니다"));
    }
  };
  const list = q.data ?? [];
  return (
    <div className="ct-wrap">
      <div className="ct-head">접촉 이력</div>
      <div className="ct-add">
        {["전화", "문자", "방문", "메일"].map((k) => (
          <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{k}</button>
        ))}
        <input className="input ct-date" value={when} inputMode="numeric" title="날짜"
          onChange={(e) => setWhen(ymdMask(e.target.value))} />
        <input className="input" placeholder="메모" value={note} onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <button className="btn" onClick={add}>기록</button>
      </div>
      {err && <div className="ct-err">{err}</div>}
      {list.length === 0
        ? <div className="ct-none">아직 없습니다</div>
        : <div className="ct-list">
            {list.slice(0, 6).map((x) => (
              <div className="r" key={x.id}>
                <span className="d">{(x.occurred_on ?? "").slice(0, 10).replace(/-/g, "/")}</span>
                <span className="k">{x.kind ?? "—"}</span>
                <span className="n">{x.note ?? ""}</span>
              </div>
            ))}
          </div>}
    </div>
  );
}

/* 날짜 — 업무탭(BuildingPage)의 parseYmd와 같은 규칙. 화면마다 다른 날짜 문법을 두지 않는다. */
function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function ymdMask(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 8);
  if (d.length <= 4) return d;
  if (d.length <= 6) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
}
function parseYmd(v: string): string {
  const d = v.replace(/\D/g, "");
  return d.length === 8 ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}` : v;
}
