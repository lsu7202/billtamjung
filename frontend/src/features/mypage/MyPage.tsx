import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { authApi, creditsApi, reportsApi, savedApi, teamApi, type TokenOut } from "../../shared/api/endpoints";
import { useAuth } from "../../shared/store/auth";
import { Loading } from "../../shared/ui/Spinner";
import { openDetail } from "../../shared/map/geo";

/** S0M 마이페이지 — 크레딧(잔액·사용내역) · 내 산출물(stale·재생성) · 저장한 검색조건 */

const TYPE_LABEL: Record<string, string> = { grant: "지급", spend: "소비", earn: "적립", expire: "소멸", adjust: "조정" };

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
      <div className="sec-head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>팀</span>
        {editName === null
          ? <>
              <span style={{ fontWeight: 700, color: "var(--ink)" }}>{t.name}</span>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>· 멤버 {t.member_count}명</span>
              {isOwner && <button className="btn" style={{ padding: "1px 7px", fontSize: 11 }} onClick={() => setEditName(t.name)}>이름 변경</button>}
            </>
          : <span style={{ display: "inline-flex", gap: 6 }}>
              <input className="input" style={{ height: 26, fontSize: 13 }} value={editName} autoFocus
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && editName.trim() && rename.mutate(editName.trim())} />
              <button className="btn primary" style={{ padding: "2px 8px", fontSize: 11 }} disabled={rename.isPending || !editName.trim()} onClick={() => rename.mutate(editName.trim())}>저장</button>
              <button className="btn" style={{ padding: "2px 8px", fontSize: 11 }} onClick={() => setEditName(null)}>취소</button>
            </span>}
      </div>

      <div style={{ padding: "0 14px 14px" }}>
        {/* 멤버 목록 */}
        {t.members.map((m) => (
          <div key={m.account_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
            <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span className={`tag ${m.role === "owner" ? "fresh" : ""}`} style={{ fontSize: 10 }}>{m.role === "owner" ? "대표" : "팀원"}</span>
              <span style={{ fontWeight: 600 }}>{m.name}{m.is_me && <span style={{ color: "var(--muted)", fontWeight: 400 }}> (나)</span>}</span>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>{m.email}</span>
            </span>
            {isOwner && !m.is_me && m.role !== "owner" &&
              <button className="btn" style={{ padding: "2px 8px", fontSize: 11, color: "var(--up)" }} disabled={remove.isPending}
                onClick={() => confirm(`${m.name} 님을 팀에서 제외할까요? 담당 매물은 대표에게 자동 귀속됩니다.`) && remove.mutate(m.account_id)}>제외</button>}
          </div>
        ))}

        {/* 대표: 초대 */}
        {isOwner && <div style={{ marginTop: 12 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="input" style={{ flex: 1, height: 30, fontSize: 13 }} placeholder="초대할 팀원 이메일 또는 전화번호"
              value={inviteTarget} onChange={(e) => setInviteTarget(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && inviteTarget.trim() && invite.mutate()} />
            <button className="btn primary" disabled={invite.isPending || !inviteTarget.trim()} onClick={() => invite.mutate()}>초대</button>
          </div>
          {t.invites.length > 0 && <div style={{ marginTop: 8 }}>
            {t.invites.map((iv) => (
              <div key={iv.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", fontSize: 12, color: "var(--muted)" }}>
                <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{iv.target}</span>
                  <code style={{ background: "var(--panel-2, #f3f4f6)", padding: "1px 6px", borderRadius: 4, color: "var(--ink)", fontSize: 12 }}>{iv.token}</code>
                  <button className="btn" style={{ padding: "1px 6px", fontSize: 10 }} onClick={() => navigator.clipboard?.writeText(iv.token)}>복사</button>
                </span>
                <span style={{ display: "flex", gap: 6 }}>
                  <button className="btn" style={{ padding: "1px 7px", fontSize: 10 }} disabled={resend.isPending} onClick={() => resend.mutate(iv.id)}>재전송</button>
                  <button className="btn" style={{ padding: "1px 7px", fontSize: 10, color: "var(--up)" }} disabled={cancel.isPending} onClick={() => cancel.mutate(iv.id)}>취소</button>
                </span>
              </div>
            ))}
          </div>}
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 6 }}>초대 코드를 팀원에게 전달하면, 팀원이 마이페이지에서 코드로 합류합니다. (베타: 자동 발송 대신 코드 전달)</div>
        </div>}

        {/* 코드로 합류 */}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--line)" }}>
          <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>초대 코드로 다른 팀 합류</div>
          <div style={{ display: "flex", gap: 6 }}>
            <input className="input" style={{ flex: 1, height: 30, fontSize: 13 }} placeholder="받은 초대 코드"
              value={acceptCode} onChange={(e) => setAcceptCode(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && acceptCode.trim() && accept.mutate()} />
            <button className="btn" disabled={accept.isPending || !acceptCode.trim()} onClick={() => accept.mutate()}>합류</button>
          </div>
        </div>

        {/* 팀원: 탈퇴 */}
        {!isOwner && <div style={{ marginTop: 12, textAlign: "right" }}>
          <button className="btn" style={{ fontSize: 12, color: "var(--up)" }} disabled={leave.isPending}
            onClick={() => confirm("이 팀에서 나갈까요? 담당 매물은 대표에게 귀속되고, 본인 1인 팀으로 돌아갑니다.") && leave.mutate()}>팀 나가기</button>
        </div>}
      </div>
    </div>
  );
}

/** 구독 플랜(표시 전용) — 정식 확정가(스타터 무료체험1개월 / 프로 / 팀, 3개월 계약). 결제는 정식 도입. */
const PLANS = [
  { key: "starter", name: "스타터", price: "무료체험", sub: "1개월", feats: ["지도·매물 검색", "기본 정보 열람", "분석보고서 체험"], trial: true },
  { key: "pro", name: "프로", price: "월 5만원", sub: "분기 15만원", feats: ["적정가·수익률 무제한", "분석보고서 생성", "전체 필터·데이터 수정"], trial: false },
  { key: "team", name: "팀", price: "월 15만원", sub: "분기 45만원", feats: ["프로 전체 + 팀 공유", "업무 관리·담당 배정", "우선 지원"], trial: false },
];
function PlansPanel() {
  const tier = useAuth((s) => s.tier);
  const isTrial = tier === "trial" || !tier;
  return (
    <div className="panel">
      <div className="sec-head">구독 플랜</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, padding: "0 14px 14px" }}>
        {PLANS.map((p) => {
          const current = isTrial && p.trial;
          return (
            <div key={p.key} style={{ border: `1px solid ${current ? "var(--signal)" : "var(--line)"}`, borderRadius: 12, padding: 14, position: "relative" }}>
              {current && <span className="tag mine" style={{ position: "absolute", top: -9, left: 12, fontSize: 10 }}>현재 플랜</span>}
              <div style={{ fontWeight: 800 }}>{p.name}</div>
              <div style={{ fontSize: 18, fontWeight: 800, marginTop: 4 }}>{p.price}</div>
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{p.sub}</div>
              <ul style={{ margin: "10px 0 0", padding: 0, listStyle: "none", borderTop: "1px solid var(--line)", paddingTop: 8, display: "grid", gap: 4 }}>
                {p.feats.map((f) => <li key={f} style={{ fontSize: 12, color: "var(--ink)" }}>· {f}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
      <p style={{ fontSize: 11, color: "var(--muted)", padding: "0 14px 12px", margin: 0 }}>베타 기간은 무료체험 · 결제·플랜 전환은 정식 출시에 도입됩니다.</p>
    </div>
  );
}

/** 계정 — 비밀번호 변경(S0M §3.7). */
function AccountPanel() {
  const [open, setOpen] = useState(false);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => authApi.changePassword(cur, next),
    onSuccess: () => { setMsg("비밀번호가 변경되었습니다."); setCur(""); setNext(""); setOpen(false); },
    onError: (e) => setMsg(String((e as Error)?.message ?? e)),
  });
  return (
    <div className="panel">
      <div className="sec-head" style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>계정</span>
        {!open && <button className="btn" style={{ padding: "1px 7px", fontSize: 11 }} onClick={() => { setOpen(true); setMsg(null); }}>비밀번호 변경</button>}
      </div>
      <div style={{ padding: "0 14px 14px" }}>
        {open ? (
          <div style={{ display: "grid", gap: 8, maxWidth: 320 }}>
            <input className="input" type="password" placeholder="현재 비밀번호" value={cur} onChange={(e) => setCur(e.target.value)} />
            <input className="input" type="password" placeholder="새 비밀번호 (8자 이상)" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} />
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn primary" disabled={change.isPending || !cur || next.length < 8} onClick={() => change.mutate()}>변경</button>
              <button className="btn" onClick={() => { setOpen(false); setMsg(null); }}>취소</button>
            </div>
          </div>
        ) : <p style={{ fontSize: 12.5, color: "var(--muted)", margin: 0 }}>비밀번호를 주기적으로 변경하세요.</p>}
        {msg && <div style={{ fontSize: 12.5, color: "var(--signal)", marginTop: 8 }}>{msg}</div>}
      </div>
    </div>
  );
}

export function MyPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const credits = useQuery({ queryKey: ["credits"], queryFn: creditsApi.balance });
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

  const c = credits.data;
  return (
    <div style={{ display: "grid", gap: 14 }}>
      {/* 크레딧 요약 */}
      <div className="panel">
        <div className="sec-head">크레딧</div>
        <div style={{ display: "flex", gap: 30, padding: "0 14px 16px" }}>
          <div><div style={{ fontSize: 12, color: "var(--muted)" }}>사용 가능 잔액</div>
            <div className="num" style={{ fontSize: 30, fontWeight: 800 }}>{c?.total ?? "…"}</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>이번 달 잔여 {c?.monthly ?? 0} + 이월 {c?.earned ?? 0}</div></div>
          <div style={{ borderLeft: "1px solid var(--line)", paddingLeft: 30 }}>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>검색</div>
            <div style={{ fontSize: 15, fontWeight: 700 }}>무제한 · 무크레딧</div>
            <div style={{ fontSize: 11, color: "var(--muted)" }}>크레딧은 보고서에만 소모</div></div>
        </div>
      </div>

      {/* 구독 플랜 */}
      <PlansPanel />

      {/* 팀(공유 그룹) */}
      <TeamPanel />

      {/* 계정 — 비밀번호 변경 */}
      <AccountPanel />

      {/* 내 산출물 */}
      <div className="panel">
        <div className="sec-head">내 산출물</div>
        <table className="wf">
          <thead><tr><th>생성일</th><th>종류</th><th>매물</th><th className="num">크레딧</th><th>상태</th><th></th></tr></thead>
          <tbody>
            {(reports.data ?? []).map((r) => (
              <tr key={r.id}>
                <td className="num">{new Date(r.created_at).toLocaleDateString("ko")}</td>
                <td>매물분석</td>
                <td style={{ cursor: "pointer" }} onClick={() => openDetail(r.building_pk)}>{r.addr ?? r.building_pk}</td>
                <td className="num">{r.credits_spent ?? "—"}</td>
                <td>{r.status === "done"
                  ? <span className={`tag ${r.is_stale ? "stale" : "fresh"}`}>{r.is_stale ? "데이터 변경됨" : "최신"}</span>
                  : <span style={{ color: "var(--muted)" }}>{r.status === "failed" ? "실패" : "생성 중…"}</span>}</td>
                <td style={{ textAlign: "right" }}>
                  {r.status === "done" && <>
                    <button className="btn" style={{ marginRight: 6 }} onClick={() => nav(`/reports/${r.id}`)}>웹으로 보기</button>
                    <button className="btn" style={{ marginRight: 6 }}
                      onClick={() => reportsApi.download(r.id).catch((e) => alert(String(e.message ?? e)))}>PPT 받기</button>
                    {r.is_stale && <button className="btn primary" disabled={regen.isPending}
                      onClick={() => regen.mutate({ building_pk: r.building_pk, kind: "analysis" })}>재생성 (30)</button>}
                  </>}
                </td>
              </tr>
            ))}
            {(reports.data ?? []).length === 0 && (
              <tr><td colSpan={6} style={{ color: "var(--muted)", textAlign: "center", padding: 24 }}>
                아직 생성한 산출물이 없습니다 — 매물 상세에서 보고서를 생성해 보세요</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 14 }}>
        {/* 크레딧 사용내역 */}
        <div className="panel">
          <div className="sec-head">크레딧 사용내역</div>
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
              {(entries.data ?? []).length === 0 && <tr><td colSpan={3} style={{ color: "var(--muted)", textAlign: "center", padding: 18 }}>내역이 없습니다</td></tr>}
            </tbody>
          </table>
        </div>

        {/* 저장한 검색조건 */}
        <div className="panel">
          <div className="sec-head">저장한 검색조건</div>
          <div style={{ padding: "0 14px 14px" }}>
            {(saved.data ?? []).map((s) => (
              <div key={s.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
                <span style={{ cursor: "pointer", fontWeight: 600 }} onClick={() => nav("/search")}>{s.name}</span>
                <button className="btn" style={{ padding: "2px 8px", fontSize: 11, color: "var(--up)" }} onClick={() => delSaved.mutate(s.id)}>삭제</button>
              </div>
            ))}
            {(saved.data ?? []).length === 0 && <p style={{ color: "var(--muted)", fontSize: 13 }}>저장한 조건이 없습니다 — 검색에서 조건을 저장하세요</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
