import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { officeApi, teamApi, type Office, type TokenOut } from "../../shared/api/endpoints";
import { useAuth } from "../../shared/store/auth";
import { Icon } from "../../shared/ui/Icon";
import { AuthImg } from "../../shared/ui/AuthImg";
import { BASE } from "../../shared/api/client";
import "../sales/draft/salestab.css";
import { Face } from "../../shared/ui/Face";
import "./customer.css";

/* ══════════════════════ 내 중개사무소(/mypage/office · 10-04) ══════════════════════
 *
 * 사무소 정보와 팀은 같은 줄(app.teams)이라 한 화면이다. 묶음 둘 — 정보 · 팀원.
 *  정보  프로필과 같은 줄 여덟(OfficeCells) — 이름 | 값 한 줄씩. 칸을 누르면 그 자리가 입력칸, 벗어나면 저장, 비우면 지움.
 *        상호가 비어 있으면 팀 이름이 선다. 사람의 직함은 계정 「직급」 하나(0219). 로고는 보고서용이라 뺐다(10-04).
 *  팀원  사람 카드 — 이름 옆 「관리자」(팀 만든 사람 · 초대 · 제외 권한) · 둘째 줄 = 직급. 「대표」는 정보 칸(대표자 이름) 한 곳에만.
 *        관리자는 카드 X 로 제외. 「초대」 = 이름으로 중개사를 찾아 보낸다(0221 · 게임 초대). 보낸 초대는 흐린 카드 「대기 중」.
 *        받은 초대는 화면 맨 위 카드(수락 · 거절). 코드는 없다.
 *  매물 상태 사전은 매물관리(상태 거르기 끝 「상태 관리」)로 옮겼다. 고객 상태는 0220 에서 지웠다 */

const err = (e: unknown) => alert(String((e as Error)?.message ?? e));

/** 사무소 줄 여덟 — 프로필 「내 중개사무소」와 이 화면이 같은 줄을 쓴다.
 *  edit 면 칸을 누른 자리에서 고친다(벗어나면 저장 · 비우면 지움), 아니면 onOpen(묶음 화면으로) */
export function OfficeCells({ edit, onOpen }: { edit?: boolean; onOpen?: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["office"], queryFn: officeApi.get });
  const d = q.data;
  const [open, setOpen] = useState<string | null>(null);
  const [txt, setTxt] = useState("");
  const save = (b: Partial<Office>) => officeApi.save(b).then(() => qc.invalidateQueries({ queryKey: ["office"] }), err);
  const rate = d?.fee_rate != null ? String(d.fee_rate) : null;
  const cells: [string, string, string | null | undefined, (s: string | null) => void][] = [
    ["office_name", "상호", d ? (d.office_name ?? d.name) : null, (s) => save({ office_name: s })],
    ["agent_name", "대표", d?.agent_name, (s) => save({ agent_name: s })],
    ["reg_no", "개설등록번호", d?.reg_no, (s) => save({ reg_no: s })],
    ["fee_rate", "중개보수 요율", rate, (s) => { const n = s == null ? null : Number(s.replace("%", "")); if (n != null && !Number.isFinite(n)) return err("숫자로 적으세요"); save({ fee_rate: n }); }],
    ["office_addr", "주소", d?.office_addr, (s) => save({ office_addr: s })],
    ["phone", "연락처", d?.phone, (s) => save({ phone: s })],
    ["fax", "팩스", d?.fax, (s) => save({ fax: s })],
    ["email", "이메일", d?.email, (s) => save({ email: s })],
  ];
  // 한 줄씩(10-04 대표 「작은 사이즈로 한 행씩」) — 매물 판 정보 탭과 같은 줄 문법
  return (
    <div className="of-rows">
      {cells.map(([k, label, v, set]) => {
        const on = open === k;
        const shown = k === "fee_rate" && v ? `${v}%` : v;
        return (
          <div key={k} className={`lgx-r ${on ? "open" : ""}`}>
            <span className="lgx-k">{label}</span>
            <div className="lgx-v" onClick={() => { if (!edit) return onOpen?.(); if (!on) { setTxt(v ?? ""); setOpen(k); } }}>
              {on
                ? <input autoFocus className="lgx-in of-in" value={txt} onChange={(e) => setTxt(e.target.value)}
                    onBlur={() => { setOpen(null); const t = txt.trim(); if (t !== (v ?? "")) set(t || null); }}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setOpen(null); }} />
                : <b>{shown ?? ""}</b>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function OfficePage() {
  return (
    <div className="of">
      <ReceivedInvites />
      <InfoBox />
      <BrandBox />
      <TeamBox />
    </div>
  );
}

/* ── 로고 · 홍보 사진(0236) — 어시스턴트의 홍보물 템플릿이 그대로 쓴다 ── */
function BrandBox() {
  const qc = useQueryClient();
  const office = useQuery({ queryKey: ["office"], queryFn: officeApi.get });
  const promo = useQuery({ queryKey: ["office-promo"], queryFn: officeApi.promoList });
  const [ver, setVer] = useState(0);                 // 로고를 바꾸면 다시 받는다
  const logoIn = useRef<HTMLInputElement>(null);
  const promoIn = useRef<HTMLInputElement>(null);
  const fail = (e: unknown) => alert((e as Error).message);
  const pickLogo = (f?: File) => f && officeApi.uploadLogo(f).then(() => { setVer((v) => v + 1); qc.invalidateQueries({ queryKey: ["office"] }); }, fail);
  const pickPromo = async (fs: FileList | null) => {
    for (const f of Array.from(fs ?? [])) await officeApi.uploadPromo(f).catch(fail);
    qc.invalidateQueries({ queryKey: ["office-promo"] });
  };
  return (
    <section className="cp-shelf">
      <div className="cp-sh"><h3>로고 · 홍보 사진</h3></div>
      <div className="of-brand">
        <div className="of-tile logo">
          {office.data?.has_logo
            ? <><AuthImg src={`${BASE}/team/office/logo?v=${ver}`} />
                <button className="of-tx" title="지우기" onClick={() => officeApi.delLogo().then(() => qc.invalidateQueries({ queryKey: ["office"] }), fail)}>
                  <Icon name="close" size={12} /></button></>
            : <button className="of-add" title="로고 올리기" onClick={() => logoIn.current?.click()}><Icon name="plus" size={18} /><span>로고</span></button>}
          <input ref={logoIn} type="file" accept="image/*" hidden onChange={(e) => { pickLogo(e.target.files?.[0]); e.target.value = ""; }} />
        </div>
        {(promo.data ?? []).map((p) => (
          <div key={p.id} className="of-tile">
            <AuthImg src={`${BASE}/team/office/promo/${p.id}`} />
            <i className="of-n">{p.n}</i>
            <button className="of-tx" title="지우기" onClick={() => officeApi.delPromo(p.id).then(() => qc.invalidateQueries({ queryKey: ["office-promo"] }), fail)}>
              <Icon name="close" size={12} /></button>
          </div>
        ))}
        <div className="of-tile">
          <button className="of-add" title="홍보 사진 올리기" onClick={() => promoIn.current?.click()}><Icon name="plus" size={18} /><span>홍보 사진</span></button>
          <input ref={promoIn} type="file" accept="image/*" multiple hidden onChange={(e) => { pickPromo(e.target.files); e.target.value = ""; }} />
        </div>
      </div>
    </section>
  );
}

/* ── 정보 ── */
function InfoBox() {
  return (
    <section className="cp-shelf first">
      <div className="cp-sh"><h3>정보</h3></div>
      <div className="cp-inv-box"><OfficeCells edit /></div>
    </section>
  );
}

/* ── 팀 ── */
function TeamBox() {
  const qc = useQueryClient();
  const setAuth = useAuth((s) => s.setAuth);
  const q = useQuery({ queryKey: ["team"], queryFn: teamApi.get });
  const [inviting, setInviting] = useState(false);
  const reload = () => qc.invalidateQueries({ queryKey: ["team"] });
  const applyToken = (t: TokenOut) => { setAuth(t.access_token); qc.invalidateQueries(); };
  const t = q.data;
  if (!t) return null;
  const owner = t.my_role === "owner";

  return (
    <section className="cp-shelf">
      <div className="cp-sh"><h3>팀원<span className="num">{t.member_count}</span></h3><span className="sp" />
        {owner && <button className="cp-pill" onClick={() => setInviting(true)}><Icon name="invite" size={14} />초대</button>}
        {!owner && <button className="cp-pill" onClick={() =>
          confirm("이 팀에서 나갈까요? 담당 매물은 관리자에게 넘어가고, 혼자인 팀으로 돌아갑니다.") && teamApi.leave().then(applyToken, err)}>
          <Icon name="leave" size={14} />팀 나가기</button>}
      </div>
      <div className="cp-people">
        {t.members.map((m) => (
          <div key={m.account_id} className="cp-person of-person">
            <Face name={m.name} photo={m.photo} className="cp-av sm" />
            <b>{m.name}{m.role === "owner" && <i className="adm">관리자</i>}{m.is_me && <i>나</i>}</b>
            <span>{m.job_title ?? ""}</span>
            <span className="of-mail">{m.email}</span>
            {owner && !m.is_me && m.role !== "owner" && (
              <button className="of-x" title="팀에서 제외" onClick={() =>
                confirm(`${m.name} 님을 팀에서 제외할까요? 담당 매물은 관리자에게 넘어갑니다.`) && teamApi.remove(m.account_id).then(reload, err)}>
                <Icon name="close" size={14} /></button>
            )}
          </div>
        ))}
        {/* 보낸 초대 — 흐린 카드 「대기 중」, X 로 취소 */}
        {owner && t.invites.map((iv) => (
          <div key={`i${iv.id}`} className="cp-person of-person wait">
            <Face name={iv.name} photo={iv.photo} className="cp-av sm" />
            <b>{iv.name}</b>
            <span>대기 중</span>
            <button className="of-x" title="초대 취소" onClick={() => teamApi.cancelInvite(iv.id).then(reload, err)}>
              <Icon name="close" size={14} /></button>
          </div>
        ))}
      </div>
      {inviting && <InviteModal onClose={() => setInviting(false)} onSent={reload} />}
    </section>
  );
}

/** 초대 — 이름으로 중개사를 찾아 줄 오른쪽 「초대」(게임 초대처럼, 0221). 받은 사람 화면에 「받은 초대」가 선다 */
function InviteModal({ onClose, onSent }: { onClose: () => void; onSent: () => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const qv = v.trim();
  const r = useQuery({ queryKey: ["teamPeople", qv], queryFn: () => teamApi.people(qv), enabled: qv.length >= 1 });
  const send = (id: number) => teamApi.invite(id).then(() => {
    setMsg(null); onSent(); qc.invalidateQueries({ queryKey: ["teamPeople"] });
  }, (e) => setMsg((e as Error).message));
  const rows = r.data ?? [];
  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="lx-addm" onClick={(e) => e.stopPropagation()}>
        <div className="lx-addm-h"><b>팀원 초대</b><span className="sp" />
          <button className="lx-addm-x" title="닫기" onClick={onClose}><Icon name="close" size={18} /></button></div>
        <label className="lx-addm-q"><Icon name="search" size={16} />
          <input autoFocus value={v} placeholder="이름" onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") onClose(); }} /></label>
        {msg && <div className="lgx-err">{msg}</div>}
        {qv && (
          <div className="of-pp">
            {rows.map((p) => (
              <div key={p.account_id} className="of-pp-r">
                <Face name={p.name} photo={p.photo} className="adf-av" />
                <div className="of-pp-who"><b>{p.name}{p.job_title && <span> {p.job_title}</span>}</b>
                  <span>{[p.office, p.email].filter(Boolean).join(" · ")}</span></div>
                {p.invited
                  ? <span className="of-pp-done">초대함</span>
                  : <button className="of-pp-go" onClick={() => send(p.account_id)}>초대</button>}
              </div>
            ))}
            {!r.isFetching && rows.length === 0 && <div className="lx-addm-none">맞는 중개사가 없습니다</div>}
          </div>
        )}
      </div>
    </div>
  ), document.body);
}

/** 받은 초대(0221) — 내 중개사무소 화면 맨 위 · 프로필 맨 위. 수락하면 지금 팀을 나와 그 팀 팀원이 된다 */
export function ReceivedInvites() {
  const qc = useQueryClient();
  const setAuth = useAuth((s) => s.setAuth);
  const q = useQuery({ queryKey: ["teamReceived"], queryFn: teamApi.received });
  const [msg, setMsg] = useState<string | null>(null);
  const rows = q.data ?? [];
  if (!rows.length) return null;
  const done = () => { qc.invalidateQueries({ queryKey: ["teamReceived"] }); };
  return (
    <section className="of-recv">
      {rows.map((r) => (
        <div key={r.id} className="of-recv-r">
          <Face name={r.inviter} photo={r.photo} className="adf-av" />
          <div className="of-pp-who"><b>{r.office}</b><span>{r.inviter} 님이 팀원으로 초대했습니다</span></div>
          <button className="cp-pill" onClick={() => teamApi.decline(r.id).then(done, (e) => setMsg((e as Error).message))}>거절</button>
          <button className="cp-pill main" onClick={() => teamApi.accept(r.id).then((t) => { setAuth(t.access_token); qc.invalidateQueries(); },
            (e) => setMsg((e as Error).message))}>수락</button>
        </div>
      ))}
      {msg && <div className="lgx-err">{msg}</div>}
    </section>
  );
}
