import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { authApi } from "../../shared/api/endpoints";
import { Icon } from "../../shared/ui/Icon";

/** 비밀번호 변경 — 폼은 모달 안에서만(CLAUDE.md 「UI 어법」).
 *  줄 문법으로는 못 만든다: 현재·새 비밀번호를 **함께** 받아야 하고, 가려진 글자라
 *  「눌러서 고치고 벗어나면 닫힌다」가 성립하지 않는다. 그래서 창을 연다. */
export function PasswordModal({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const change = useMutation({
    mutationFn: () => authApi.changePassword(cur, next),
    onSuccess: () => { setMsg("비밀번호를 변경했습니다."); setTimeout(onClose, 900); },
    onError: (e) => setMsg(String((e as Error)?.message ?? e)),
  });
  const ready = !change.isPending && cur.length > 0 && next.length >= 8;

  return (
    <div className="pw-back" onClick={onClose}>
      <div className="pw-box" onClick={(e) => e.stopPropagation()}>
        <div className="pw-head">비밀번호 변경
          <button className="pw-x" onClick={onClose}><Icon name="close" size={16} /></button></div>
        <input className="um-in" type="password" autoFocus placeholder="현재 비밀번호"
          value={cur} onChange={(e) => { setCur(e.target.value); setMsg(null); }} />
        <input className="um-in" type="password" placeholder="새 비밀번호 (8자 이상)"
          value={next} onChange={(e) => { setNext(e.target.value); setMsg(null); }} minLength={8}
          onKeyDown={(e) => { if (e.key === "Enter" && ready) change.mutate(); }} />
        {msg && <div className="pw-msg">{msg}</div>}
        <button className="pw-go" disabled={!ready} onClick={() => change.mutate()}>바꾸기</button>
      </div>
    </div>
  );
}
