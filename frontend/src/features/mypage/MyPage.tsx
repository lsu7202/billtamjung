import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { authApi, customerApi, officeApi, reportsApi, savedApi, teamApi, type CustomerProfile, type Office, type TokenOut } from "../../shared/api/endpoints";
import { parseAmount } from "../building/KV";
import { won } from "../../shared/format";
import { useIsBroker } from "../../shared/store/auth";
import { useAuth } from "../../shared/store/auth";
import { Loading } from "../../shared/ui/Spinner";
import { openDetail } from "../../shared/map/geo";
import { Icon, type IconName } from "../../shared/ui/Icon";
import { PasswordModal } from "./PasswordModal";
import "../../shared/ui/row.css";
import "./mypage.css";

/** S0M 마이페이지 — 리포트 · 사무소 · 계정.
 *
 *  2026-08-28 개편. 예전엔 판 여섯이 한 장에 세로로 쌓여 있어서, 사무소 정보를 고치려면
 *  리포트 표를 지나 스크롤을 내려야 했다. **하는 일이 다르면 화면을 나눈다** —
 *  산출물(리포트·조건) / 우리 사무소(사무소·팀) / 나(계정·구독) 셋으로 갈랐다.
 *
 *  어법도 같이 맞췄다(CLAUDE.md):
 *  · 줄마다 서 있던 글자 네모버튼 → 고른 줄에만 뜨는 아이콘 컨트롤
 *  · 항상 떠 있던 사무소 입력칸 여덟 개 → 줄 문법(눌러야 열리고 벗어나면 닫힌다)
 *  · 설명글씨 제거 — 남기는 건 라벨·값뿐
 */


/** 고른 줄에만 뜨는 아이콘 컨트롤. 줄 오른쪽에 작게 선다. */
function Ctl({ icon, title, tone, onClick, disabled }: {
  icon: IconName; title: string; tone?: "bad" | "on"; onClick: () => void; disabled?: boolean;
}) {
  return (
    <button className={`mp-ctl${tone ? ` ${tone}` : ""}`} title={title} disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onClick(); }}><Icon name={icon} size={14} /></button>
  );
}

/** 값 한 줄 — 라벨 왼쪽, 현재 값 오른쪽. 값을 누르면 그 자리가 입력칸이 되고 벗어나면 닫힌다.
 *  통합 매물 모달의 줄 문법과 같다(shared/ui/row.css). */
function ValueRow({ label, value, unit, placeholder, onSave }: {
  label: string; value: string | null | undefined; unit?: string; placeholder?: string;
  onSave: (v: string) => void;
}) {
  const [ed, setEd] = useState(false);
  const [val, setVal] = useState("");
  const empty = value == null || value === "";

  if (ed) return (
    <div className="orow">
      <span className="who g">{label}</span><span className="cap" />
      <input className="um-in" autoFocus value={val} style={{ width: 260, textAlign: "right" }}
        placeholder={placeholder}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => { setEd(false); if (val.trim() !== (value ?? "")) onSave(val.trim()); }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEd(false);
        }} />
      {unit && <span className="mp-unit">{unit}</span>}
    </div>
  );

  return (
    <div className="orow has" onClick={() => { setVal(value ?? ""); setEd(true); }}>
      <span className="who g">{label}</span><span className="cap" />
      <span className={`ev${empty ? " off" : ""}`}>{empty ? "—" : value}{!empty && unit ? ` ${unit}` : ""}</span>
    </div>
  );
}

/* ══════════════════════ 리포트 ══════════════════════ */

function ReportsPanel() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const reports = useQuery({ queryKey: ["reports"], queryFn: reportsApi.list, refetchInterval: 3000 });
  const regen = useMutation({
    mutationFn: (r: { building_pk: string; kind: "analysis" | "briefing" }) => reportsApi.create(r.building_pk, r.kind),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["reports"] }); },
  });
  const rows = reports.data ?? [];

  return (
    <div className="panel">
      <div className="sec-head">
        <span className="lead"><span>내 리포트</span>
          {rows.length > 0 && <span className="sub">{rows.length}건</span>}</span>
      </div>
      <table className="wf mp-tbl">
        <thead><tr><th>생성일</th><th>종류</th><th>매물</th><th>상태</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="num">{new Date(r.created_at).toLocaleDateString("ko")}</td>
              <td><span className={`tag ${r.kind === "briefing" ? "plain" : "mine"}`}>
                {r.kind === "briefing" ? "브리핑" : "분석"}</span></td>
              <td className="lnk" onClick={() => openDetail(r.building_pk)}>{r.addr ?? r.building_pk}</td>
              <td>{r.status === "done"
                ? <span className={`tag ${r.is_stale ? "stale" : "plain"}`}>{r.is_stale ? "데이터 변경됨" : "최신"}</span>
                : <span className="dim">{r.status === "failed" ? "실패" : "생성 중…"}</span>}</td>
              <td className="act">
                {r.status === "done" && <span className="mp-ctls">
                  <Ctl icon="external" title="열기"
                    onClick={() => nav(r.kind === "briefing" ? `/briefings/${r.id}` : `/reports/${r.id}`)} />
                  {r.is_stale && <Ctl icon="reset" tone="on"
                    title="다시 만들기"
                    disabled={regen.isPending}
                    onClick={() => regen.mutate({ building_pk: r.building_pk,
                      kind: (r.kind as "analysis" | "briefing") ?? "analysis" })} />}
                </span>}
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={6} className="mp-empty">
              아직 만든 리포트가 없습니다 — 건물 상세에서 「매물 분석하기」로 시작하세요</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** 저장한 검색조건 — 누르면 그 조건으로 검색이 열린다(모달을 또 열게 하지 않는다). */
function SavedPanel() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const saved = useQuery({ queryKey: ["saved"], queryFn: savedApi.list });
  const del = useMutation({
    mutationFn: (id: number) => savedApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved"] }),
  });
  const notify = useMutation({
    mutationFn: ({ id, on }: { id: number; on: boolean }) => savedApi.update(id, { notify: on }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saved"] }),
  });
  const rows = saved.data ?? [];

  return (
    <div className="panel">
      <div className="sec-head"><span className="lead"><span>저장한 검색조건</span>
        {rows.length > 0 && <span className="sub">{rows.length}개</span>}</span></div>
      <div className="mp-body pad0">
        {rows.map((s) => (
          <div key={s.id} className="orow has"
            onClick={() => nav("/search", { state: { applyCond: s.conditions_json } })}>
            <span className="who">{s.name}</span><span className="cap" />
            {s.notify && <span className="ev">알림 받는 중</span>}
            <span className="mp-ctls always">
              {/* 알림 받기(S05 §5-3) — 켠 때부터 이 조건에 맞는 새 광고를 알린다 */}
              <Ctl icon="bell" title={s.notify ? "알림 끄기" : "알림 받기"} tone={s.notify ? "on" : undefined}
                onClick={() => notify.mutate({ id: s.id, on: !s.notify })} />
              <Ctl icon="trash" title="삭제" tone="bad" onClick={() => del.mutate(s.id)} />
            </span>
          </div>
        ))}
        {rows.length === 0 &&
          <p className="mp-empty">검색 필터에서 「조건저장」을 누르면 여기에 쌓입니다</p>}
      </div>
    </div>
  );
}

/* ══════════════════════ 사무소 ══════════════════════ */

/** 사무소 정보 — 리포트 표지·계약 문서 하단에 그대로 들어간다. */
function OfficePanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["office"], queryFn: officeApi.get });
  const fileRef = useRef<HTMLInputElement>(null);
  const [logoV, setLogoV] = useState(0);   // 로고 교체 후 캐시 무시용
  const d = q.data;

  const save = useMutation({
    mutationFn: (b: Partial<Office>) => officeApi.save(b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["office"] }),
  });
  const logo = useMutation({
    mutationFn: (f: File) => officeApi.uploadLogo(f),
    onSuccess: () => { setLogoV((v) => v + 1); qc.invalidateQueries({ queryKey: ["office"] }); },
  });
  const delLogo = useMutation({
    mutationFn: () => officeApi.delLogo(),
    onSuccess: () => { setLogoV((v) => v + 1); qc.invalidateQueries({ queryKey: ["office"] }); },
  });

  const R = (k: keyof Office, label: string, ph?: string) => (
    <ValueRow key={k} label={label} value={(d?.[k] as string | null) ?? null} placeholder={ph}
      onSave={(v) => save.mutate({ [k]: v || null } as Partial<Office>)} />
  );

  return (
    <div className="panel">
      <div className="sec-head"><span className="lead"><span>사무소</span></span></div>
      <div className="mp-body pad0">
        {R("office_name", "상호", "탐정공인중개사사무소")}
        {R("reg_no", "개설등록번호", "11680-2026-00000")}
        {R("agent_name", "담당자", "이름")}
        {R("agent_title", "직함", "대표 · 이사")}
        {R("phone", "연락처", "010-0000-0000")}
        {R("fax", "팩스")}
        {R("email", "이메일")}
        {R("office_addr", "주소")}
        <ValueRow label="중개보수 요율" value={d?.fee_rate != null ? String(d.fee_rate) : null} unit="%"
          placeholder="0.9" onSave={(v) => save.mutate({ fee_rate: v ? Number(v) : null })} />
        <div className="orow">
          <span className="who g">로고</span><span className="cap" />
          {d?.has_logo && <img className="mp-logo" src={`/api/team/office/logo?v=${logoV}`} alt="" />}
          <input ref={fileRef} type="file" accept="image/*" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) logo.mutate(f); e.target.value = ""; }} />
          <span className="mp-ctls always">
            <Ctl icon={d?.has_logo ? "edit" : "plus"} title={d?.has_logo ? "교체" : "올리기"}
              disabled={logo.isPending} onClick={() => fileRef.current?.click()} />
            {d?.has_logo && <Ctl icon="trash" title="삭제" tone="bad" onClick={() => delLogo.mutate()} />}
          </span>
        </div>
      </div>
    </div>
  );
}

/** 팀(공유 그룹) — 멤버·역할·초대(대표)·제외(대표)·탈퇴(팀원)·합류(코드). */
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
        <span className="lead"><span>팀</span>
          {editName === null
            ? <><span className="name">{t.name}</span><span className="sub">{t.member_count}명</span></>
            : <input className="um-in" style={{ maxWidth: 240 }} value={editName} autoFocus
                onChange={(e) => setEditName(e.target.value)}
                onBlur={() => { if (editName.trim() && editName !== t.name) rename.mutate(editName.trim()); else setEditName(null); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditName(null);
                }} />}
        </span>
        {isOwner && editName === null &&
          <span className="mp-ctls always"><Ctl icon="edit" title="이름 바꾸기" onClick={() => setEditName(t.name)} /></span>}
      </div>

      <div className="mp-body pad0">
        {t.members.map((m) => (
          <div key={m.account_id} className="orow">
            <span className="who">
              {/* 유채색은 파랑 하나다 — 초록(tag fresh)을 쓰면 뜻 없는 색이 하나 는다 */}
              <span className={`tag ${m.role === "owner" ? "mine" : "plain"}`}>{m.role === "owner" ? "대표" : "팀원"}</span>
              {m.name}{m.is_me && <i className="me"> 나</i>}
            </span>
            <span className="cap">{m.email}</span>
            {isOwner && !m.is_me && m.role !== "owner" && <span className="mp-ctls">
              <Ctl icon="trash" title="팀에서 제외" tone="bad" disabled={remove.isPending}
                onClick={() => confirm(`${m.name} 님을 팀에서 제외할까요? 담당 매물은 대표에게 자동 귀속됩니다.`) && remove.mutate(m.account_id)} />
            </span>}
          </div>
        ))}

        {/* 초대 — pill 입력줄. 코드를 만들어 직접 전달한다 */}
        {isOwner && (
          <div className="mp-line">
            <input className="mp-pill" placeholder="팀원 초대 — 이메일 또는 전화번호"
              value={inviteTarget} onChange={(e) => setInviteTarget(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && inviteTarget.trim() && invite.mutate()} />
            <button className="mp-go" disabled={invite.isPending || !inviteTarget.trim()}
              onClick={() => invite.mutate()} title="초대"><Icon name="invite" size={14} /></button>
          </div>
        )}
        {isOwner && t.invites.map((iv) => (
          <div key={iv.id} className="orow inv">
            <span className="who g">{iv.target}</span>
            <span className="cap"><code>{iv.token}</code></span>
            <span className="mp-ctls always">
              <Ctl icon="copy" title="코드 복사" onClick={() => navigator.clipboard?.writeText(iv.token)} />
              <Ctl icon="send" title="재발급" disabled={resend.isPending} onClick={() => resend.mutate(iv.id)} />
              <Ctl icon="close" title="초대 취소" tone="bad" disabled={cancel.isPending} onClick={() => cancel.mutate(iv.id)} />
            </span>
          </div>
        ))}

        <div className="mp-line">
          <input className="mp-pill" placeholder="받은 초대 코드로 다른 팀에 합류"
            value={acceptCode} onChange={(e) => setAcceptCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && acceptCode.trim() && accept.mutate()} />
          <button className="mp-go" disabled={accept.isPending || !acceptCode.trim()}
            onClick={() => accept.mutate()} title="합류"><Icon name="join" size={14} /></button>
        </div>
        {!isOwner && (
          <div className="orow has out" onClick={() =>
            confirm("이 팀에서 나갈까요? 담당 매물은 대표에게 귀속되고, 본인 1인 팀으로 돌아갑니다.") && leave.mutate()}>
            <span className="who g">팀 나가기</span><span className="cap" />
            <Icon name="leave" size={14} />
          </div>
        )}
      </div>
    </div>
  );
}

/* ══════════════════════ 계정 ══════════════════════ */

function AccountPanel() {
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const [open, setOpen] = useState(false);
  const m = me.data;
  const tierWord = ({ trial: "스타터 · 무료체험", pro: "프로", team: "팀" } as Record<string, string>);
  const roleWord = ({ broker: "공인중개사", assistant: "중개보조원", investor: "투자자·자산관리",
    landlord: "임대인", etc: "기타" } as Record<string, string>);

  return (
    <div className="panel">
      <div className="sec-head"><span className="lead"><span>계정</span></span></div>
      <div className="mp-body pad0">
        <div className="orow">
          <span className="who g">이름</span><span className="cap" />
          <span className="ev">{m?.name ?? "…"}</span>
        </div>
        <div className="orow">
          <span className="who g">이메일</span><span className="cap" />
          <span className="ev mono">{m?.email ?? "—"}</span>
        </div>
        <div className="orow">
          <span className="who g">플랜</span><span className="cap" />
          <span className="ev">{m ? (tierWord[m.tier] ?? m.tier) : "—"}
            {m?.job_role ? ` · ${roleWord[m.job_role] ?? m.job_role}` : ""}</span>
        </div>
        <div className="orow has" onClick={() => setOpen(true)}>
          <span className="who g">비밀번호</span><span className="cap" />
          <span className="ev off">바꾸기</span>
        </div>
      </div>
      {open && <PasswordModal onClose={() => setOpen(false)} />}
    </div>
  );
}

/** 구독 플랜(표시 전용) — 정식 확정가. 결제는 정식 도입. */
const PLANS = [
  { key: "starter", name: "스타터", price: "무료체험", sub: "1개월", feats: ["지도·건물 검색", "기본 정보 열람", "빌탐정 리포트 체험"], trial: true },
  { key: "pro", name: "프로", price: "월 5만원", sub: "분기 15만원", feats: ["추정가·수익률 무제한", "빌탐정 리포트 생성", "전체 필터·데이터 수정"], trial: false },
  { key: "team", name: "팀", price: "월 15만원", sub: "분기 45만원", feats: ["프로 전체 + 팀 공유", "업무 관리·담당 배정", "우선 지원"], trial: false },
];
function PlansPanel() {
  const tier = useAuth((s) => s.tier);
  const isTrial = tier === "trial" || !tier;
  return (
    <div className="panel">
      <div className="sec-head"><span className="lead"><span>구독</span></span></div>
      <div className="mp-body">
        <div className="mp-plans">
          {PLANS.map((p) => {
            const current = isTrial && p.trial;
            return (
              <div key={p.key} className={`mp-plan${current ? " on" : ""}`}>
                {current && <span className="tag mine cur">현재 플랜</span>}
                <div className="pl-n">{p.name}</div>
                <div className="pl-p">{p.price}</div>
                <div className="pl-s">{p.sub}</div>
                <ul>{p.feats.map((f) => <li key={f}>{f}</li>)}</ul>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════ 고객 쪽(S05 §5, 3묶음 09-29) ══════════════════════ */

const GU = ["강남구", "강동구", "강북구", "강서구", "관악구", "광진구", "구로구", "금천구", "노원구", "도봉구", "동대문구",
  "동작구", "마포구", "서대문구", "서초구", "성동구", "성북구", "송파구", "양천구", "영등포구", "용산구", "은평구",
  "종로구", "중구", "중랑구"];
const INTENT: [NonNullable<CustomerProfile["intent"]>, string][] = [["A", "확실"], ["B", "보통"], ["C", "관망"]];

/** 칩 한 줄 — 줄엔 라벨 · 현재 값만, 누르면 칩이 펼쳐진다. 고른 칩을 다시 누르면 미지정(단일) */
function ChipRow({ label, options, value, multi, onChange }: {
  label: string; options: [string, string][]; value: string[]; multi?: boolean; onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = value.map((v) => options.find(([k]) => k === v)?.[1] ?? v).join(" · ");
  return (
    <div className={`orow has${open ? " mp-open" : ""}`} onClick={() => setOpen(!open)}>
      <span className="who g">{label}</span><span className="cap" />
      {open ? (
        <span className="mp-chips" onClick={(e) => e.stopPropagation()}>
          {options.map(([k, l]) => {
            const on = value.includes(k);
            return <button key={k} type="button" className={`um-chip ${on ? "on" : ""}`}
              onClick={() => onChange(multi ? (on ? value.filter((x) => x !== k) : [...value, k]) : on ? [] : [k])}>{l}</button>;
          })}
        </span>
      ) : <span className={`ev${shown ? "" : " off"}`}>{shown || "—"}</span>}
    </div>
  );
}

/** 프로필 — 의사 · 이해도 · 목적 · 지역 · 예산 · 메모. 전부 고객이 적는다. 상담요청을 받은 중개사가 같이 본다 */
function ProfilePanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["cprofile"], queryFn: customerApi.profile });
  const save = useMutation({
    mutationFn: (p: Partial<CustomerProfile>) => customerApi.saveProfile({ ...(q.data as CustomerProfile), ...p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cprofile"] }),
  });
  const d = q.data;
  if (!d) return <div className="panel"><Loading label="프로필 불러오는 중" minHeight={120} /></div>;
  return (
    <div className="panel">
      <div className="sec-head"><span className="lead"><span>프로필</span></span></div>
      <div className="mp-body pad0">
        <ChipRow label="의사" options={INTENT} value={d.intent ? [d.intent] : []}
          onChange={(v) => save.mutate({ intent: (v[0] as CustomerProfile["intent"]) ?? null })} />
        <ChipRow label="이해도" options={[["처음", "처음"], ["관심", "관심"], ["공부해봄", "공부해봄"]]}
          value={d.literacy ? [d.literacy] : []} onChange={(v) => save.mutate({ literacy: (v[0] as CustomerProfile["literacy"]) ?? null })} />
        <ChipRow label="목적" multi options={[["실사용", "실사용"], ["투자용", "투자"], ["신축용", "신축"]]}
          value={d.purposes ?? []} onChange={(v) => save.mutate({ purposes: v })} />
        <ChipRow label="지역" multi options={GU.map((g) => [g, g] as [string, string])}
          value={d.regions ?? []} onChange={(v) => save.mutate({ regions: v })} />
        <ValueRow label="예산 최소" value={d.budget_min != null ? won(d.budget_min) : null}
          onSave={(v) => save.mutate({ budget_min: v ? parseAmount(v) : null })} placeholder="억 단위 · 예: 30" />
        <ValueRow label="예산 최대" value={d.budget_max != null ? won(d.budget_max) : null}
          onSave={(v) => save.mutate({ budget_max: v ? parseAmount(v) : null })} placeholder="억 단위 · 예: 50" />
        <ValueRow label="메모" value={d.note} onSave={(v) => save.mutate({ note: v || null })} />
      </div>
    </div>
  );
}

/** 관심 — 저장한 건물 · 광고. 누르면 건물 상세(새 탭). 메모 한 줄 */
function SavesPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["saves"], queryFn: customerApi.saves });
  const del = useMutation({ mutationFn: (id: number) => customerApi.unsave(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["saves"] }) });
  const memo = useMutation({ mutationFn: ({ id, m }: { id: number; m: string | null }) => customerApi.memo(id, m),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["saves"] }) });
  const rows = q.data ?? [];
  const [ed, setEd] = useState<number | null>(null);   // 메모를 고치는 줄(클릭-편집)
  return (
    <div className="panel">
      <div className="sec-head"><span className="lead"><span>저장한 매물</span>
        {rows.length > 0 && <span className="sub">{rows.length}개</span>}</span></div>
      <div className="mp-body pad0">
        {rows.map((s) => (
          <div key={s.id} className="orow has mp-save" onClick={() => openDetail(s.building_pk)}>
            <span className="who">{s.addr.replace("서울특별시 ", "").replace("번지", "") || s.building_pk}</span>
            {ed === s.id ? (
              <input className="um-in" autoFocus defaultValue={s.memo ?? ""} placeholder="메모 한 줄" style={{ flex: 1 }}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => { setEd(null); const m = e.target.value.trim() || null; if (m !== s.memo) memo.mutate({ id: s.id, m }); }}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEd(null); }} />
            ) : (
              <span className="cap">
                {s.ad_title ? `${s.ad_title}${s.ad_state && s.ad_state !== "노출" ? ` · ${s.ad_state}` : ""}${s.ad_price != null ? ` · 매매 ${won(s.ad_price)}` : ""}` : "건물"}
                {s.memo && <i className="mp-memo"> · {s.memo}</i>}
              </span>
            )}
            <span className="mp-ctls">
              <Ctl icon="edit" title="메모" onClick={() => setEd(s.id)} />
              <Ctl icon="trash" title="저장 해제" tone="bad" onClick={() => del.mutate(s.id)} />
            </span>
          </div>
        ))}
        {rows.length === 0 && <p className="mp-empty">저장한 매물이 없습니다</p>}
      </div>
    </div>
  );
}

/** 알림 — 저장한 건물에 새 광고 · 알림을 켠 조건에 맞는 새 광고. 열면 「새 것」 표시를 지운다 */
function AlertsPanel() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["alerts"], queryFn: customerApi.alerts });
  const [marked, setMarked] = useState(false);
  if (q.data && !marked) {
    setMarked(true);
    customerApi.seen().then(() => qc.invalidateQueries({ queryKey: ["alert-count"] }));
  }
  const rows = q.data ?? [];
  return (
    <div className="panel">
      <div className="sec-head"><span className="lead"><span>알림</span>
        {rows.length > 0 && <span className="sub">{rows.length}개</span>}</span></div>
      <div className="mp-body pad0">
        {rows.map((a) => (
          <div key={`${a.kind}-${a.label}-${a.ad_id}`} className="orow has" onClick={() => openDetail(a.building_pk)}>
            {a.new && <i className="mp-new" />}
            <span className="who">{a.addr.replace("서울특별시 ", "").replace("번지", "")}</span>
            <span className="cap">{a.kind === "조건" ? `「${a.label}」 조건` : "저장한 건물"} · 새 광고{a.title ? ` 「${a.title}」` : ""}</span>
            <span className="ev">{a.price != null ? `매매 ${won(a.price)}` : ""}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="mp-empty">알림이 없습니다</p>}
      </div>
    </div>
  );
}

/** 내 문의 — 보낸 상담요청과 중개사 쪽 상태 */
function MyInquiriesPanel() {
  const q = useQuery({ queryKey: ["my-inq"], queryFn: customerApi.myInquiries });
  const rows = q.data ?? [];
  return (
    <div className="panel">
      <div className="sec-head"><span className="lead"><span>보낸 문의</span>
        {rows.length > 0 && <span className="sub">{rows.length}개</span>}</span></div>
      <div className="mp-body pad0">
        {rows.map((i) => (
          <div key={i.id} className="orow has" onClick={() => i.building_pk && openDetail(i.building_pk)}>
            <span className="who">{i.addr.replace("서울특별시 ", "").replace("번지", "") || i.ad_title}</span>
            <span className="cap">{i.kind} · {i.office_name ?? ""} · {i.created_at.slice(0, 10)}</span>
            <span className={`ev mp-st ${i.status === "미확인" ? "off" : ""}`}>{i.status}</span>
          </div>
        ))}
        {rows.length === 0 && <p className="mp-empty">보낸 문의가 없습니다</p>}
      </div>
    </div>
  );
}

/* ══════════════════════ 화면 ══════════════════════ */

type Tab = "profile" | "reports" | "saves" | "alerts" | "inq" | "office" | "account";

export function MyPage() {
  // 고객은 프로필 · 관심 · 알림 · 문의 · 계정, 중개사는 리포트 · 관심 · 알림 · 사무소 · 계정(S05 §5, 09-29)
  const broker = useIsBroker();
  const tabs: [Tab, string][] = broker
    ? [["reports", "리포트"], ["saves", "관심"], ["alerts", "알림"], ["office", "사무소"], ["account", "계정"]]
    : [["profile", "프로필"], ["saves", "관심"], ["alerts", "알림"], ["inq", "문의"], ["account", "계정"]];
  const [tab, setTab] = useState<Tab>(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as Tab | null;
    return t && tabs.some(([k]) => k === t) ? t : tabs[0][0];
  });
  return (
    <div className="page mp">
      <div className="subnav">
        {tabs.map(([k, l]) => (
          <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>
        ))}
        <span style={{ flex: 1 }} />
      </div>

      {tab === "profile" && <div className="mp-two"><ProfilePanel /><div /></div>}
      {tab === "reports" && <div className="mp-two"><ReportsPanel /><div /></div>}
      {tab === "saves" && <div className="mp-two"><SavesPanel /><SavedPanel /></div>}
      {tab === "alerts" && <div className="mp-two"><AlertsPanel /><div /></div>}
      {tab === "inq" && <div className="mp-two"><MyInquiriesPanel /><div /></div>}
      {tab === "office" && <div className="mp-two"><OfficePanel /><TeamPanel /></div>}
      {tab === "account" && <div className="mp-cols"><AccountPanel /><PlansPanel /></div>}
    </div>
  );
}
