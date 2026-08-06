import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { authApi, creditsApi, reportsApi, savedApi, teamApi, type TokenOut } from "../../shared/api/endpoints";
import { useAuth } from "../../shared/store/auth";
import { Loading } from "../../shared/ui/Spinner";
import { openDetail } from "../../shared/map/geo";
import { Icon } from "../../shared/ui/Icon";
import "./mypage.css";

/** S0M 마이페이지 — 크레딧(잔액·사용내역) · 내 산출물(stale·재생성) · 팀 · 저장한 검색조건 */

const TYPE_LABEL: Record<string, string> = { grant: "지급", spend: "소비", earn: "적립", expire: "소멸", adjust: "조정" };
const REPORT_COST = 30;   // 리포트 1건 = 30크레딧(BT_COST_ANALYSIS 기본값)

/** 크레딧 — 숫자만 던지지 않고 "리포트 몇 건인지"로 환산해 준다. */
function CreditPanel() {
  const credits = useQuery({ queryKey: ["credits"], queryFn: creditsApi.balance });
  const c = credits.data;
  const total = c?.total ?? 0;
  return (
    <div className="panel">
      <div className="sec-head"><span className="lead"><span>크레딧</span></span></div>
      <div className="mp-body">
        <div className="mp-credit">
          <span className="big">{c ? total : "—"}</span>
          <span className="unit">크레딧</span>
        </div>
        <div className="mp-convert">
          리포트 <b>{Math.floor(total / REPORT_COST)}건</b> 생성할 수 있습니다
          <span style={{ color: "var(--muted)" }}> · 1건 {REPORT_COST}크레딧</span>
        </div>
        <div className="mp-split">
          <span>이번 달 <b>{c?.monthly ?? 0}</b></span>
          <span>이월 <b>{c?.earned ?? 0}</b></span>
          <span>검색·상세 조회는 무크레딧</span>
        </div>
      </div>
    </div>
  );
}

/** 계정 — 누구로 로그인했는지 + 비밀번호 변경. */
function AccountPanel() {
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => authApi.changePassword(cur, next),
    onSuccess: () => { setMsg("비밀번호를 변경했습니다."); setCur(""); setNext(""); setOpen(false); },
    onError: (e) => setMsg(String((e as Error)?.message ?? e)),
  });
  const m = me.data;
  return (
    <div className="panel">
      <div className="sec-head">
        <span className="lead"><span>계정</span></span>
        {!open && <button className="btn" style={{ padding: "3px 9px", fontSize: 11.5 }}
          onClick={() => { setOpen(true); setMsg(null); }}><Icon name="key" size={13} />비밀번호 변경</button>}
      </div>
      <div className="mp-body">
        <div className="mp-id">
          <span className="nm">{m?.name ?? "…"}</span>
          <span className="em">{m?.email ?? ""}</span>
          {m && <span className="of">
            {({ trial: "스타터 · 무료체험", pro: "프로", team: "팀" } as Record<string, string>)[m.tier] ?? m.tier}
            {m.job_role && <> · {({ broker: "공인중개사", assistant: "중개보조원", investor: "투자자·자산관리",
              landlord: "임대인", etc: "기타" } as Record<string, string>)[m.job_role] ?? m.job_role}</>}
          </span>}
        </div>
        {open && (
          <div className="mp-form">
            <input className="input" type="password" placeholder="현재 비밀번호" value={cur} onChange={(e) => setCur(e.target.value)} />
            <input className="input" type="password" placeholder="새 비밀번호 (8자 이상)" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} />
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn primary" disabled={change.isPending || !cur || next.length < 8} onClick={() => change.mutate()}><Icon name="check" size={13} />변경</button>
              <button className="btn" onClick={() => { setOpen(false); setMsg(null); }}>취소</button>
            </div>
          </div>
        )}
        {msg && <div style={{ fontSize: 12.5, color: "var(--signal)", marginTop: 10 }}>{msg}</div>}
      </div>
    </div>
  );
}

/** S0M 팀(공유 그룹) — 멤버·역할·초대(대표)·제외(대표)·탈퇴(팀원)·합류(코드). */
function TeamPanel() {
  const qc = useQueryClient();
  const setAuth = useAuth((s) => s.setAuth);
  const team = useQuery({ queryKey: ["team"], queryFn: teamApi.get });
  const [inviteTarget, setInviteTarget] = useState("");
  const [acceptCode, setAcceptCode] = useState("");
  const [editName, setEditName] = useState<string | null>(null);

  const err = (e: unknown) => alert(String((e as Error)?.message ?? e));
  const applyToken = (t: TokenOut) => { setAuth(t.access_token, t.tier); qc.invalidateQueries(); };
  const reload = () => qc.invalidateQueries({ queryKey: ["team"] });

  const invite = useMutation({ mutationFn: () => teamApi.invite(inviteTarget.trim()), onSuccess: () => { setInviteTarget(""); reload(); }, onError: err });
  const resend = useMutation({ mutationFn: (id: number) => teamApi.resend(id), onSuccess: reload, onError: err });
  const cancel = useMutation({ mutationFn: (id: number) => teamApi.cancelInvite(id), onSuccess: reload, onError: err });
  const remove = useMutation({ mutationFn: (id: number) => teamApi.remove(id), onSuccess: reload, onError: err });
  const rename = useMutation({ mutationFn: (name: string) => teamApi.rename(name), onSuccess: () => { setEditName(null); reload(); }, onError: err });
  const accept = useMutation({ mutationFn: () => teamApi.accept(acceptCode.trim()), onSuccess: (t) => { setAcceptCode(""); applyToken(t); }, onError: err });
  const leave = useMutation({ mutationFn: () => teamApi.leave(), onSuccess: applyToken, onError: err });

  if (team.isLoading) return <div className="panel"><Loading label="팀 정보 불러오는 중" minHeight={120} /></div>;
  const t = team.data;
  if (!t) return null;
  const isOwner = t.my_role === "owner";

  return (
    <div className="panel">
      <div className="sec-head">
        {editName === null ? (
          <>
            <span className="lead">
              <span>팀</span>
              <span className="name">{t.name}</span>
              <span className="sub">멤버 {t.member_count}명</span>
            </span>
            {isOwner && <button className="btn" style={{ padding: "3px 9px", fontSize: 11.5 }}
              onClick={() => setEditName(t.name)}><Icon name="edit" size={13} />이름 변경</button>}
          </>
        ) : (
          <>
            <span className="lead" style={{ flex: 1 }}>
              <span>팀</span>
              <input className="input" style={{ height: 28, fontSize: 13, maxWidth: 240 }} value={editName} autoFocus
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && editName.trim() && rename.mutate(editName.trim())} />
            </span>
            <span style={{ display: "flex", gap: 6 }}>
              <button className="btn primary" style={{ padding: "3px 9px", fontSize: 11.5 }} disabled={rename.isPending || !editName.trim()} onClick={() => rename.mutate(editName.trim())}><Icon name="save" size={13} />저장</button>
              <button className="btn" style={{ padding: "3px 9px", fontSize: 11.5 }} onClick={() => setEditName(null)}>취소</button>
            </span>
          </>
        )}
      </div>

      <div className="mp-body">
        {t.members.map((m) => (
          <div key={m.account_id} className="mp-member">
            <span className="who">
              <span className={`tag ${m.role === "owner" ? "fresh" : ""}`} style={{ fontSize: 10 }}>{m.role === "owner" ? "대표" : "팀원"}</span>
              <b>{m.name}{m.is_me && <span style={{ color: "var(--muted)", fontWeight: 400 }}> (나)</span>}</b>
              <span className="em">{m.email}</span>
            </span>
            {isOwner && !m.is_me && m.role !== "owner" &&
              <button className="btn" style={{ padding: "2px 9px", fontSize: 11.5, color: "var(--up)" }} disabled={remove.isPending}
                onClick={() => confirm(`${m.name} 님을 팀에서 제외할까요? 담당 매물은 대표에게 자동 귀속됩니다.`) && remove.mutate(m.account_id)}>제외</button>}
          </div>
        ))}

        {isOwner && (
          <div className="mp-sub">
            <div className="lbl">팀원 초대 — 코드를 만들어 직접 전달합니다(베타)</div>
            <div className="mp-inline">
              <input className="input" style={{ height: 32, fontSize: 13 }} placeholder="이메일 또는 전화번호"
                value={inviteTarget} onChange={(e) => setInviteTarget(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && inviteTarget.trim() && invite.mutate()} />
              <button className="btn primary" disabled={invite.isPending || !inviteTarget.trim()} onClick={() => invite.mutate()}><Icon name="invite" size={13} />초대</button>
            </div>
            {t.invites.map((iv) => (
              <div key={iv.id} className="mp-invite">
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--ink-2)" }}>{iv.target}</span>
                  <code>{iv.token}</code>
                  <button className="btn" style={{ padding: "1px 7px", fontSize: 10.5 }} onClick={() => navigator.clipboard?.writeText(iv.token)}><Icon name="copy" size={13} />복사</button>
                </span>
                <span style={{ display: "flex", gap: 6, flex: "0 0 auto" }}>
                  <button className="btn" style={{ padding: "1px 8px", fontSize: 10.5 }} disabled={resend.isPending} onClick={() => resend.mutate(iv.id)}><Icon name="send" size={13} />재발급</button>
                  <button className="btn" style={{ padding: "1px 8px", fontSize: 10.5, color: "var(--up)" }} disabled={cancel.isPending} onClick={() => cancel.mutate(iv.id)}>취소</button>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="mp-sub">
          <div className="lbl">받은 초대 코드로 다른 팀에 합류</div>
          <div className="mp-inline">
            <input className="input" style={{ height: 32, fontSize: 13 }} placeholder="초대 코드"
              value={acceptCode} onChange={(e) => setAcceptCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && acceptCode.trim() && accept.mutate()} />
            <button className="btn" disabled={accept.isPending || !acceptCode.trim()} onClick={() => accept.mutate()}><Icon name="join" size={13} />합류</button>
          </div>
          {!isOwner && (
            <button className="btn" style={{ marginTop: 10, fontSize: 12, color: "var(--up)" }} disabled={leave.isPending}
              onClick={() => confirm("이 팀에서 나갈까요? 담당 매물은 대표에게 귀속되고, 본인 1인 팀으로 돌아갑니다.") && leave.mutate()}><Icon name="leave" size={13} />팀 나가기</button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 구독 플랜(표시 전용) — 정식 확정가. 결제는 정식 도입이라 페이지 맨 아래. */
const PLANS = [
  { key: "starter", name: "스타터", price: "무료체험", sub: "1개월", feats: ["지도·매물 검색", "기본 정보 열람", "빌탐정 리포트 체험"], trial: true },
  { key: "pro", name: "프로", price: "월 5만원", sub: "분기 15만원", feats: ["적정가·수익률 무제한", "빌탐정 리포트 생성", "전체 필터·데이터 수정"], trial: false },
  { key: "team", name: "팀", price: "월 15만원", sub: "분기 45만원", feats: ["프로 전체 + 팀 공유", "업무 관리·담당 배정", "우선 지원"], trial: false },
];
function PlansPanel() {
  const tier = useAuth((s) => s.tier);
  const isTrial = tier === "trial" || !tier;
  return (
    <div className="panel">
      <div className="sec-head"><span className="lead"><span>구독 플랜</span>
        <span className="sub">베타 기간은 무료 · 결제는 정식 출시에 도입</span></span></div>
      <div className="mp-body">
        <div className="mp-plans">
          {PLANS.map((p) => {
            const current = isTrial && p.trial;
            return (
              <div key={p.key} className={`mp-plan${current ? " on" : ""}`}>
                {current && <span className="tag mine" style={{ position: "absolute", top: -9, left: 12, fontSize: 10 }}>현재 플랜</span>}
                <div className="pn">{p.name}</div>
                <div className="pp">{p.price}</div>
                <div className="ps">{p.sub}</div>
                <ul>{p.feats.map((f) => <li key={f}>· {f}</li>)}</ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function MyPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const entries = useQuery({ queryKey: ["credit-entries"], queryFn: creditsApi.entries });
  const reports = useQuery({ queryKey: ["reports"], queryFn: reportsApi.list, refetchInterval: 3000 });
  const saved = useQuery({ queryKey: ["saved"], queryFn: savedApi.list });

  const regen = useMutation({
    mutationFn: (r: { building_pk: string; kind: "analysis" }) => reportsApi.create(r.building_pk, r.kind),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reports"] }); qc.invalidateQueries({ queryKey: ["credits"] }); },
  });
  const delSaved = useMutation({
    mutationFn: (id: number) => savedApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved"] }),
  });

  const rows = reports.data ?? [];

  return (
    <div className="mp">
      <div className="mp-row split">
        <CreditPanel />
        <AccountPanel />
      </div>

      {/* 내 산출물 — 이 화면에서 실제로 손대는 대상 */}
      <div className="panel">
        <div className="sec-head">
          <span className="lead"><span>내 리포트</span>
            {rows.length > 0 && <span className="sub">{rows.length}건</span>}</span>
        </div>
        <table className="wf">
          <thead><tr><th>생성일</th><th>매물</th><th className="num">크레딧</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="num">{new Date(r.created_at).toLocaleDateString("ko")}</td>
                <td style={{ cursor: "pointer" }} onClick={() => openDetail(r.building_pk)}>{r.addr ?? r.building_pk}</td>
                <td className="num">{r.credits_spent ?? "—"}</td>
                <td>{r.status === "done"
                  ? <span className={`tag ${r.is_stale ? "stale" : "fresh"}`}>{r.is_stale ? "데이터 변경됨" : "최신"}</span>
                  : <span style={{ color: "var(--muted)" }}>{r.status === "failed" ? "실패" : "생성 중…"}</span>}</td>
                <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>
                  {r.status === "done" && <>
                    <button className="btn" style={{ marginRight: 6 }} onClick={() => nav(`/reports/${r.id}`)}><Icon name="external" size={13} />열기</button>
                    <button className="btn" style={{ marginRight: 6 }}
                      onClick={() => reportsApi.download(r.id).catch((e) => alert(String(e.message ?? e)))}>PPT</button>
                    {r.is_stale && <button className="btn primary" disabled={regen.isPending}
                      onClick={() => regen.mutate({ building_pk: r.building_pk, kind: "analysis" })}>재생성 ({REPORT_COST})</button>}
                  </>}
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="mp-empty">
                아직 만든 리포트가 없습니다 — 매물 상세에서 「매물 분석하기」로 시작하세요</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mp-row wide">
        {/* 크레딧 사용내역 */}
        <div className="panel">
          <div className="sec-head"><span className="lead"><span>크레딧 사용내역</span></span></div>
          <table className="wf">
            <thead><tr><th>일시</th><th>항목</th><th className="num">변동</th></tr></thead>
            <tbody>
              {(entries.data ?? []).map((e, i) => (
                <tr key={i}>
                  <td className="num" style={{ fontSize: 12 }}>{new Date(e.occurred_at).toLocaleString("ko", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}</td>
                  <td>{TYPE_LABEL[e.type] ?? e.type} <span style={{ color: "var(--muted)", fontSize: 12 }}>{e.reason}</span></td>
                  <td className="num" style={{ color: e.amount >= 0 ? "var(--green)" : "var(--up)", fontWeight: 700 }}>
                    {e.amount >= 0 ? "+" : ""}{e.amount}</td>
                </tr>
              ))}
              {(entries.data ?? []).length === 0 && <tr><td colSpan={3} className="mp-empty">내역이 없습니다</td></tr>}
            </tbody>
          </table>
        </div>

        {/* 저장한 검색조건 */}
        <div className="panel">
          <div className="sec-head"><span className="lead"><span>저장한 검색조건</span></span></div>
          <div className="mp-body">
            {(saved.data ?? []).map((s) => (
              <div key={s.id} className="mp-member">
                <span className="who" style={{ cursor: "pointer" }} onClick={() => nav("/search")}><b>{s.name}</b></span>
                <button className="btn" style={{ padding: "2px 9px", fontSize: 11.5, color: "var(--up)" }} onClick={() => delSaved.mutate(s.id)}>삭제</button>
              </div>
            ))}
            {(saved.data ?? []).length === 0 &&
              <p className="mp-empty" style={{ padding: "18px 0" }}>검색 필터에서 「조건저장」을 누르면 여기에 쌓입니다</p>}
          </div>
        </div>
      </div>

      <TeamPanel />
      <PlansPanel />
    </div>
  );
}
