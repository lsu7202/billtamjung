import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import { authApi } from "../../shared/api/endpoints";
import { useIsBroker } from "../../shared/store/auth";
import { PasswordModal } from "./PasswordModal";
import { CustomerProfilePage } from "./CustomerHome";
import { BrokerProfilePage } from "./BrokerHome";
import { OfficePage } from "./OfficePage";
import "../../shared/ui/row.css";
import "./mypage.css";

/** S0M 마이페이지 — 사무소 · 팀 · 계정 패널(내 페이지 화면이 묶음 화면 안에 끼워 쓴다).
 *
 *  2026-08-28 개편. 예전엔 판 여섯이 한 장에 세로로 쌓여 있어서, 사무소 정보를 고치려면
 *  리포트 표를 지나 스크롤을 내려야 했다. **하는 일이 다르면 화면을 나눈다** —
 *  산출물(리포트·조건) / 우리 사무소(사무소·팀) / 나(계정) 셋으로 갈랐다.
 *
 *  어법도 같이 맞췄다(CLAUDE.md):
 *  · 줄마다 서 있던 글자 네모버튼 → 고른 줄에만 뜨는 아이콘 컨트롤
 *  · 항상 떠 있던 사무소 입력칸 여덟 개 → 줄 문법(눌러야 열리고 벗어나면 닫힌다)
 *  · 설명글씨 제거 — 남기는 건 라벨·값뿐
 */


/** 값 한 줄 — 라벨 왼쪽, 현재 값 오른쪽. 값을 누르면 그 자리가 입력칸이 되고 벗어나면 닫힌다.
 *  통합 매물 모달의 줄 문법과 같다(shared/ui/row.css). */
function ValueRow({ label, value, unit, placeholder, onSave, lead, tail }: {
  label: string; value: string | null | undefined; unit?: string; placeholder?: string;
  onSave: (v: string) => void;
  /** 줄 앞 · 뒤에 붙는 것(상태 줄의 색 점 · 조작 아이콘) */
  lead?: React.ReactNode; tail?: React.ReactNode;
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
      {lead}
      {label ? <><span className="who g">{label}</span><span className="cap" /></> : null}
      <span className={`ev${empty ? " off" : ""}`} style={label ? undefined : { flex: 1, textAlign: "left" }}>{empty ? "—" : value}{!empty && unit ? ` ${unit}` : ""}</span>
      {tail}
    </div>
  );
}

/* ══════════════════════ 계정 ══════════════════════ */

function AccountPanel() {
  const qc = useQueryClient();
  const broker = useIsBroker();
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  // 직급(0206) — 매물 카드 윗줄 「사무소명 이름 직급」에 선다. 비우면 지운다
  const saveTitle = useMutation({
    mutationFn: (v: string) => authApi.patchProfile({ job_title: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["me"] }); qc.invalidateQueries({ queryKey: ["bAds"] }); qc.invalidateQueries({ queryKey: ["adCards"] }); },
  });
  const [open, setOpen] = useState(false);
  const m = me.data;

  return (
    <div className="panel">
      <div className="sec-head"><span className="lead"><span>계정</span></span></div>
      <div className="mp-body pad0">
        <div className="orow">
          <span className="who g">이름</span><span className="cap" />
          <span className="ev">{m?.name ?? "…"}</span>
        </div>
        {broker && <ValueRow label="직급" value={m?.job_title ?? null} placeholder="대표 · 실장 · 과장"
          onSave={(v) => saveTitle.mutate(v)} />}
        <div className="orow">
          <span className="who g">이메일</span><span className="cap" />
          <span className="ev mono">{m?.email ?? "—"}</span>
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

/* ══════════════════════ 화면 ══════════════════════ */

/** 내 페이지(S09 · 10-04) — 보통의 프로필 화면 결. /mypage = 프로필 전체, /mypage/{묶음} = 그 묶음 하나(유튜브 「내 페이지 › 기록」).
 *  고객: 내 투자 · 최근 본 · 관심 · 구해요 · 보낸 문의 · 계정 / 중개사: 내 중개사무소(정보 + 팀) · 관심 · 계정. 리포트는 폐지돼 뺐다 */
export function MyPage() {
  const broker = useIsBroker();
  const { section } = useParams();
  const account = <AccountPanel />;
  if (!broker) return <div className="page cp-page"><CustomerProfilePage section={section} account={account} /></div>;
  return (
    <div className="page cp-page">
      <BrokerProfilePage section={section} account={account}
        officeEdit={<OfficePage />} />
    </div>
  );
}
