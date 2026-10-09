import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authApi, customerApi, savedApi, seeksApi, type CustomerProfile, type SeekProposal } from "../../shared/api/endpoints";
import { shortAddr, won } from "../../shared/format";
import { Icon } from "../../shared/ui/Icon";
import { AuthImg } from "../../shared/ui/AuthImg";
import { openParcel } from "../../shared/map/geo";
import { CustomerFields, budgetText } from "../sales/CustomerFields";
import { condSummary } from "../sales/summaries";
import { ago } from "../search/ListingCard";
import { PickModal } from "../search/SeekModal";
import "../sales/draft/salestab.css";
import { MyFace } from "../../shared/ui/Face";
import "./customer.css";

/* ══════════════════════ 고객 마이페이지(S09 · 2026-10-04) ══════════════════════
 *
 * 보통의 프로필 화면 결(유튜브 「내 페이지」) — 위에 사람, 아래에 가로로 넘기는 카드 줄.
 *   머리      이름 · 이메일 · 내 정보 한 줄 요약 · [내 정보 고치기](오른쪽 판) · [계정]
 *   카드 줄   최근 본 매물(30일) → 관심 매물 → 구해요 → 저장한 조건
 *   줄 목록   보낸 문의
 * 매물 카드를 누르면 매물 찾기가 그 건물 상세가 열린 채로 뜬다.
 * 묶음마다 따로 열 수도 있다(유튜브 「내 페이지 › 기록」 결) — /mypage/{invest|recent|saves|seeks|inquiries|account}.
 * 「모두 보기」 · 묶음 제목 · 펼친 판 「내 페이지」 줄이 그 화면으로 간다. */

const ymd = (s: string | null | undefined) => (s ? s.slice(2, 10).replace(/-/g, ".") : "");
/** 날짜만 있는 기록(본 날) — 오늘 · 어제 · N일 전. 시각이 없어 「몇 시간 전」은 틀린 말이 된다 */
const dayAgo = (d: string) => {
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Seoul" })); today.setHours(0, 0, 0, 0);
  const n = Math.round((today.getTime() - new Date(`${d.slice(0, 10)}T00:00:00`).getTime()) / 864e5);
  return n <= 0 ? "오늘" : n === 1 ? "어제" : `${n}일 전`;
};

/** 카드 줄 — 제목 · 오른쪽 [모두 보기][<][>]. 「모두 보기」는 그 묶음의 화면(/mypage/…)으로 간다.
 *  full = 묶음 하나 화면 — 제목은 SectionHead 가 세우고 여기선 격자만 */
export function Shelf({ title, n, empty, extra, to, full, children }: {
  title: string; n: number; empty: string; extra?: React.ReactNode; to?: string; full?: boolean; children: React.ReactNode;
}) {
  const nav = useNavigate();
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (d: number) => ref.current?.scrollBy({ left: d * (ref.current.clientWidth - 40), behavior: "smooth" });
  if (full) return (
    <section className="cp-shelf full">
      {extra && <div className="cp-sh"><span className="sp" />{extra}</div>}
      {n === 0 ? <div className="cp-empty">{empty}</div> : <div className="cp-row all">{children}</div>}
    </section>
  );
  return (
    <section className="cp-shelf">
      <div className="cp-sh">
        <h3 className={to ? "link" : ""} onClick={() => to && nav(to)}>{title}{n > 0 && <span className="num">{n}</span>}{to && <Icon name="back" size={16} />}</h3>
        <span className="sp" />
        {extra}
        {n > 0 && to && <button className="cp-pill" onClick={() => nav(to)}>모두 보기</button>}
        {n > 4 && <>
          <button className="cp-arrow" title="이전" onClick={() => scroll(-1)}><Icon name="back" size={18} /></button>
          <button className="cp-arrow next" title="다음" onClick={() => scroll(1)}><Icon name="back" size={18} /></button>
        </>}
      </div>
      {n === 0 ? <div className="cp-empty">{empty}</div> : <div ref={ref} className="cp-row">{children}</div>}
    </section>
  );
}

/** 묶음 하나 화면의 머리 — 제목 · 수 · 오른쪽 X(프로필로) */
export function SectionHead({ title, n }: { title: string; n?: number }) {
  const nav = useNavigate();
  return (
    <div className="cp-sec-h">
      <h2>{title}{n != null && n > 0 && <span className="num">{n}</span>}</h2>
      <span className="sp" />
      <button className="iqp-x" title="내 페이지로" onClick={() => nav("/mypage")}><Icon name="close" size={20} /></button>
    </div>
  );
}

/** 매물 카드 — 사진 · 주소 · 매매가 · 중개사무소 · 언제. 매물 찾기 목록 카드와 같은 결 */
export function AdCard({ pnu, photo, addr, price, office, when, off, onX }: {
  /** 그 광고 매물의 지번 — 누르면 탐색에서 그 지번 사양서가 열린다 */
  pnu: string | null; photo: string | null; addr: string; price: number | null; office: string | null; when: string;
  off?: string | null; onX?: () => void;
}) {
  const nav = useNavigate();
  return (
    <div className="cp-card" onClick={() => pnu && nav(`/search?p=${pnu}`)}>
      <div className="cp-ph">
        {photo ? <AuthImg src={photo} /> : <Icon name="building" size={28} />}
        {off && <span className="cp-badge">{off}</span>}
        {onX && <button className="cp-x" title="관심 풀기" onClick={(e) => { e.stopPropagation(); onX(); }}><Icon name="close" size={14} /></button>}
      </div>
      <b className="cp-t">{addr}</b>
      <div className="cp-p">{price != null ? <><em>매매</em> {won(price)}</> : <span className="cp-dim">가격 비공개</span>}</div>
      <div className="cp-m">{[office, when].filter(Boolean).join(" · ")}</div>
    </div>
  );
}

/** 내 투자 — 큰 칸 넷(희망매매가 · 목표 · 원하는 지역 · 매수 시기) + 나머지 한 줄 + 찾는 조건.
 *  비어 있으면 빈 칸 그대로, 버튼만 「적기」 */
function InvestBox({ p, conds, onEdit, onOpenCond, onDelCond, onNewCond, bare }: {
  p: CustomerProfile | undefined; conds: { id: number; name: string; conditions_json: Record<string, unknown> }[];
  onEdit: () => void; onOpenCond: (c: Record<string, unknown>) => void; onDelCond: (id: number) => void; onNewCond: () => void;
  /** 묶음 하나 화면 — 제목은 SectionHead 가 세운다 */
  bare?: boolean;
}) {
  const rg = p?.regions ?? [];
  const big: [string, string][] = [
    ["희망매매가", p ? budgetText(p) : ""],
    ["목표", (p?.goal ?? []).join(" · ")],
    ["원하는 지역", rg.length ? rg.slice(0, 3).join(" · ") + (rg.length > 3 ? ` 외 ${rg.length - 3}` : "") : ""],
    ["매수 시기", p?.timing ?? ""],
  ];
  const rest = [
    p?.equity_won != null ? `시드 ${won(p.equity_won)}` : "",
    p?.is_corp == null ? "" : p.is_corp ? "법인" : "개인",
    p?.experience === "처음" ? "처음 매입" : p?.experience === "보유 경험" ? "매입 경험 있음" : "",
    p?.build_intent === "있음" ? "신축 생각 있음" : p?.build_intent === "없음" ? "신축 생각 없음" : "",
  ].filter(Boolean);
  const blank = big.every(([, v]) => !v) && !rest.length;
  const nav = useNavigate();
  return (
    <section className={`cp-inv ${bare ? "full" : ""}`}>
      <div className="cp-sh">{!bare && <h3 className="link" onClick={() => nav("/mypage/invest")}>내 투자<Icon name="back" size={16} /></h3>}<span className="sp" />
        <button className="cp-pill" onClick={onEdit}><Icon name="edit" size={14} />{blank ? "적기" : "고치기"}</button></div>
      <div className="cp-inv-box">
        <div className="cp-inv-big">
          {big.map(([k, v]) => (
            <div key={k} className="cp-inv-c" onClick={onEdit}><b>{v}</b><span>{k}</span></div>
          ))}
        </div>
        {rest.length > 0 && <div className="cp-inv-rest">{rest.join(" · ")}</div>}
        <div className="cp-inv-cond">
          <span className="cp-inv-k">찾는 조건</span>
          <div className="cp-inv-chips">
            {conds.map((c) => (
              <span key={c.id} className="cp-chip" onClick={() => onOpenCond(c.conditions_json)}>
                <Icon name="search" size={13} /><b>{c.name}</b>
                <i>{condSummary({ id: c.id, name: c.name, conditions_json: c.conditions_json } as never)}</i>
                <button title="지우기" onClick={(e) => { e.stopPropagation(); onDelCond(c.id); }}><Icon name="close" size={12} /></button>
              </span>
            ))}
            <button className="cp-chip add" onClick={onNewCond}><Icon name="plus" size={13} />조건</button>
          </div>
        </div>
      </div>
    </section>
  );
}

/** 묶음 이름 — 주소 /mypage/{key} · 펼친 판 「내 페이지」 줄 */
export const CUST_SECTIONS: [string, string][] = [["invest", "내 투자"], ["recent", "최근 본 매물"], ["saves", "관심 매물"],
  ["seeks", "구해요"], ["inquiries", "보낸 문의"], ["account", "계정"]];

export function CustomerProfilePage({ account, section }: { account: React.ReactNode; section?: string }) {
  const qc = useQueryClient();
  const nav = useNavigate();
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const prof = useQuery({ queryKey: ["cprofile"], queryFn: customerApi.profile });
  const recent = useQuery({ queryKey: ["c-recent"], queryFn: customerApi.recent });
  const saves = useQuery({ queryKey: ["saves"], queryFn: customerApi.saves });
  const seeks = useQuery({ queryKey: ["my-seeks"], queryFn: seeksApi.mine });
  const conds = useQuery({ queryKey: ["saved"], queryFn: savedApi.list });
  const inqs = useQuery({ queryKey: ["my-inq"], queryFn: customerApi.myInquiries });
  const [editing, setEditing] = useState(false);
  const [showAcc, setShowAcc] = useState(false);
  const one = section && CUST_SECTIONS.some(([k]) => k === section) ? section : null;   // 묶음 하나만
  const show = (k: string) => !one || one === k;
  const [openSeek, setOpenSeek] = useState<number | null>(null);
  const [pick, setPick] = useState<SeekProposal | null>(null);
  const again = () => ["saves", "my-seeks", "seeks", "my-inq", "saved"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const photo = (ad: number | null, ph: number | null | undefined) => (ad && ph ? `/api/ads/${ad}/photos/${ph}` : null);
  const off = (st: string | null, expired: boolean | null | undefined) => (st === "노출" && !expired ? null : st === "거래완료" ? "거래완료" : "내려감");
  const name = me.data?.name ?? "";
  const seekOpen = (seeks.data ?? []).find((s) => s.id === openSeek) ?? null;

  return (
    <div className="cp">
      {pick && <PickModal p={pick} onClose={() => setPick(null)} onDone={() => { setPick(null); again(); }} />}
      {one && <SectionHead title={CUST_SECTIONS.find(([k]) => k === one)![1]}
        n={{ recent: recent.data?.length, saves: saves.data?.length, seeks: seeks.data?.length, inquiries: inqs.data?.length }[one]} />}
      {one === "account" && <div className="cp-acc mp">{account}</div>}
      {/* 머리 — 사람 */}
      {!one && <header className="cp-head">
        <MyFace name={name} />
        <div className="cp-who">
          <h1>{name}</h1>
          <div className="cp-sub">{me.data?.email ?? ""}</div>
          <div className="cp-acts">
            <button className={`cp-pill ${showAcc ? "on" : ""}`} onClick={() => setShowAcc(!showAcc)}><Icon name="settings" size={14} />계정</button>
          </div>
        </div>
      </header>}
      {!one && showAcc && <div className="cp-acc mp">{account}</div>}

      {/* 내 투자(10-04) — 투자 계획 하나 + 그 계획으로 찾는 조건(저장한 조건). 고치기는 오른쪽 판 */}
      {show("invest") && <InvestBox bare={one === "invest"} p={prof.data} conds={conds.data ?? []} onEdit={() => setEditing(true)}
        onOpenCond={(c) => nav("/search", { state: { applyCond: c } })}
        onDelCond={async (id) => { await savedApi.remove(id); again(); }} onNewCond={() => nav("/search")} />}

      {show("recent") && <Shelf title="최근 본 매물" to="/mypage/recent" full={one === "recent"} n={(recent.data ?? []).length} empty="최근 30일 안에 본 매물이 없습니다">
        {(recent.data ?? []).map((r) => (
          <AdCard key={r.ad_id} pnu={r.pnu} photo={photo(r.ad_id, r.photo_id)} addr={shortAddr(r.addr) || (r.ad_title ?? "")}
            price={r.ad_price} office={r.office_name} when={dayAgo(r.viewed_on)} off={off(r.ad_state, r.ad_expired)} />
        ))}
      </Shelf>}

      {show("saves") && <Shelf title="관심 매물" to="/mypage/saves" full={one === "saves"} n={(saves.data ?? []).length} empty="관심 매물이 없습니다">
        {(saves.data ?? []).map((r) => (
          <AdCard key={r.id} pnu={r.pnu} photo={photo(r.ad_id, r.photo_id)} addr={shortAddr(r.addr) || (r.ad_title ?? "")}
            price={r.ad_price} office={r.office_name ?? null} when={ago(r.created_at)} off={off(r.ad_state, r.ad_expired)}
            onX={async () => { await customerApi.unsave(r.id); again(); }} />
        ))}
      </Shelf>}

      {show("seeks") && <Shelf title="구해요" to="/mypage/seeks" full={one === "seeks"} n={(seeks.data ?? []).length} empty="남긴 구해요가 없습니다"
        extra={<button className="cp-pill" onClick={() => nav("/seek")}><Icon name="plus" size={14} />남기기</button>}>
        {(seeks.data ?? []).map((s) => {
          const live = s.state !== "닫힘" && s.days_left >= 0;
          return (
            <div key={s.id} className={`cp-card seek ${openSeek === s.id ? "on" : ""}`} onClick={() => setOpenSeek(openSeek === s.id ? null : s.id)}>
              <div className="cp-ph seek"><b className="num">{s.proposals.length}</b><span>제안</span>
                {!live && <span className="cp-badge">{s.state === "닫힘" ? "닫힘" : "만료"}</span>}</div>
              <b className="cp-t">{shortAddr(s.addr)}</b>
              <div className="cp-p">{live ? `${s.state} · D-${s.days_left}` : <span className="cp-dim">{s.state === "닫힘" ? "닫힘" : "만료"}</span>}</div>
              <div className="cp-m">{s.note ?? ""}</div>
            </div>
          );
        })}
      </Shelf>}
      {/* 고른 구해요의 받은 제안 — 카드 줄 바로 아래 */}
      {show("seeks") && seekOpen && (
        <div className="cp-props">
          <div className="cp-props-h"><b>{shortAddr(seekOpen.addr)}</b> 받은 제안
            <span className="sp" />
            {seekOpen.state !== "닫힘" && <>
              <button className="cp-pill" onClick={async () => { await seeksApi.extend(seekOpen.id); again(); }}><Icon name="reset" size={14} />30일 연장</button>
              <button className="cp-pill" onClick={async () => { if (confirm("이 구해요를 닫을까요?")) { await seeksApi.close(seekOpen.id); again(); } }}>닫기</button>
            </>}
          </div>
          {seekOpen.proposals.length === 0 ? <div className="cp-empty">받은 제안이 없습니다</div> : seekOpen.proposals.map((p) => (
            <div key={p.id} className="cp-prop">
              <b>{p.office_name ?? "중개사"}</b><span>{p.agent_name ?? ""}</span>
              <span className="cp-prop-m">{[p.listing_addr ? shortAddr(p.listing_addr) : "", p.message].filter(Boolean).join(" · ")}</span>
              {p.state === "보냄" && seekOpen.state !== "닫힘"
                ? <span className="cp-prop-a"><button className="cp-pill main" onClick={() => setPick(p)}>고르기</button>
                    <button className="cp-pill" onClick={async () => { await seeksApi.reject(p.id); again(); }}>거절</button></span>
                : <span className={`cp-st ${p.state === "거절" ? "off" : ""}`}>{p.state}</span>}
            </div>
          ))}
        </div>
      )}

      {/* 보낸 문의 — 줄 목록(카드보다 읽기 쉽다) */}
      {show("inquiries") && <section className={`cp-shelf ${one ? "full" : ""}`}>
        {!one && <div className="cp-sh"><h3 className="link" onClick={() => nav("/mypage/inquiries")}>보낸 문의
          {(inqs.data ?? []).length > 0 && <span className="num">{(inqs.data ?? []).length}</span>}<Icon name="back" size={16} /></h3></div>}
        {(inqs.data ?? []).length === 0 ? <div className="cp-empty">보낸 문의가 없습니다</div> : (
          <div className="cp-list">
            {(inqs.data ?? []).map((i) => (
              <div key={i.id} className="cp-li" onClick={() => i.pnu && openParcel(i.pnu)}>
                <span className="num cp-li-d">{ymd(i.created_at)}</span>
                <b>{shortAddr(i.addr) || i.ad_title}</b>
                <span className="cp-li-o">{i.office_name ?? ""} · {i.kind.replace(" 문의", "")}</span>
                <span className={`iq-st s-${i.status}`}>{i.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>}

      {editing && <ProfileDrawer onClose={() => setEditing(false)} />}
    </div>
  );
}

/** 내 투자 판 — 오른쪽에서 열린다. 중개사 고객 판과 같은 칸 부품(한 열) */
function ProfileDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cprofile"], queryFn: customerApi.profile });
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: (p: Partial<CustomerProfile>) => customerApi.saveProfile({ ...(q.data as CustomerProfile), ...p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cprofile"] }),
    onError: (e) => setErr((e as Error).message),
  });
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const d = q.data;
  return createPortal((
    <div className="cp-dr-bg" onClick={onClose}>
      <aside className="cp-dr" onClick={(e) => e.stopPropagation()}>
        <div className="cp-dr-h"><b>내 투자</b><span className="sp" />
          <button className="iqp-x" title="닫기" onClick={onClose}><Icon name="close" size={18} /></button></div>
        <div className="cp-dr-b lgx">
          {err && <div className="lgx-err">{err}</div>}
          {d && <CustomerFields onErr={setErr}
            v={{ budget_min: d.budget_min, budget_max: d.budget_max, budget_any: d.budget_any, goal: d.goal, regions: d.regions,
              timing: d.timing, build_intent: d.build_intent, is_corp: d.is_corp, equity_won: d.equity_won, experience: d.experience, note: d.note }}
            set={(p) => { setErr(null); save.mutate(p as Partial<CustomerProfile>); }} />}
        </div>
      </aside>
    </div>
  ), document.body);
}
