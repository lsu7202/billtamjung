import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { authApi, buildingsApi, inquiriesApi, type AdCard, type InquiryKind } from "../../shared/api/endpoints";
import { wonAcc } from "../../shared/format";
import "./adcards.css";
import { AuthImg } from "../../shared/ui/AuthImg";

/** 광고 카드(S05) — 탐색 사이드 판과 건물 상세가 같은 부품을 쓴다. 누구나 본다.
 *  노출 중이고 우리 팀 광고가 아니면 「상담요청」이 붙는다. 거래완료는 회색으로 남는다(밸류맵). */
export function AdCards({ pk, empty }: { pk: string; empty?: React.ReactNode }) {
  const q = useQuery({ queryKey: ["bAds", pk], queryFn: () => buildingsApi.ads(pk), enabled: !pk.startsWith("P") });
  const [ask, setAsk] = useState<AdCard | null>(null);
  const list = q.data ?? [];
  if (!list.length) return <>{empty ?? null}</>;
  return (
    <div className="sel-ads">
      {list.map((a) => (
        <div key={a.id} className={`sel-ad ${a.state === "거래완료" ? "sold" : ""}`}>
          {a.photo_id && <AuthImg className="ad-ph" src={`/api/ads/${a.id}/photos/${a.photo_id}`} />}
          <div className="ad-top">
            <b className="num">{a.state === "거래완료" ? "거래완료" : a.price != null ? `매매 ${wonAcc(a.price)}` : "가격 문의"}</b>
            {a.brokerage === "전속" && <span className="ad-tag">전속</span>}
            {a.violation && <span className="ad-tag red">위반건축물</span>}
          </div>
          <div className="ad-title">{a.title}</div>
          <div className="ad-agent">{a.office_name}{a.agent_name ? ` · ${a.agent_name}` : ""}
            {a.phone && a.state === "노출" && <span className="num"> · {a.phone}</span>}</div>
          {a.state === "노출" && !a.mine && (
            <button className="ad-ask" onClick={() => setAsk(a)}>상담요청</button>
          )}
        </div>
      ))}
      {ask && <InquiryModal ad={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

/** 상담요청 폼(모달) — 유형 · 내용(200자) · 이름 · 전화 · 동의. 이름 · 전화는 계정 값으로 미리 채운다.
 *  매도 문의면 「팔려는 건물 주소」가 나온다(비워도 된다, 대표 09-28 가안). */
function InquiryModal({ ad, onClose }: { ad: AdCard; onClose: () => void }) {
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const [kind, setKind] = useState<InquiryKind>("매수 문의");
  const [body, setBody] = useState("");
  const [name, setName] = useState<string | null>(null);
  const [phone, setPhone] = useState<string | null>(null);
  const [addr, setAddr] = useState("");
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const nm = name ?? me.data?.name ?? "";
  const ph = phone ?? me.data?.phone ?? "";

  const send = async () => {
    if (!nm.trim() || !ph.trim()) { setErr("이름과 전화를 적으세요"); return; }
    setBusy(true); setErr(null);
    try {
      await inquiriesApi.send({ ad_id: ad.id, kind, body: body || null, name: nm, phone: ph, consent: ok,
        sell_addr: kind === "매도 문의" ? addr || null : null });
      setSent(true);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const row = (label: string, node: React.ReactNode) => (
    <div className="gm-row lab"><span className="gm-lab">{label}</span><div className="gm-body wrap">{node}</div></div>
  );
  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="gm" onClick={(e) => e.stopPropagation()}>
        <div className="gm-title-fix">{ad.office_name ?? "중개사"}에 상담요청</div>
        {sent ? (
          <>
            <div className="iq-done">보냈습니다. 중개사가 확인한 뒤 연락합니다.</div>
            <div className="gm-foot"><span className="sp" /><button className="gm-save" onClick={onClose}>닫기</button></div>
          </>
        ) : (
          <>
            {row("유형", (["매수 문의", "매도 문의", "시세 문의"] as const).map((k) => (
              <button key={k} type="button" className={`um-chip ${kind === k ? "on" : ""}`} onClick={() => setKind(k)}>{k}</button>
            )))}
            {kind === "매도 문의" && row("팔 건물", <input className="gm-in" style={{ flex: 1 }} value={addr}
              placeholder="주소(비워도 됩니다)" onChange={(e) => setAddr(e.target.value)} />)}
            {row("내용", <textarea className="gm-in ad-body" rows={3} maxLength={200} value={body}
              onChange={(e) => setBody(e.target.value)} />)}
            {row("이름", <input className="gm-in" value={nm} onChange={(e) => setName(e.target.value)} />)}
            {row("전화", <input className="gm-in num" value={ph} onChange={(e) => setPhone(e.target.value)} />)}
            {row("동의", <button type="button" className={`um-chip ${ok ? "on" : ""}`} onClick={() => setOk(!ok)}>
              이름 · 전화를 이 중개사에게 넘기는 데 동의</button>)}
            {err && <div className="ad-err">{err}</div>}
            <div className="gm-foot">
              <span className="sp" />
              <button className="gm-ghost quiet" onClick={onClose}>취소</button>
              <button className="gm-save" disabled={busy || !ok} onClick={send}>{busy ? "…" : "보내기"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  ), document.body);
}
