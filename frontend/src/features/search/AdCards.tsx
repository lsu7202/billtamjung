import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { authApi, buildingsApi, inquiriesApi, type AdCard, type InquiryKind } from "../../shared/api/endpoints";
import { won } from "../../shared/format";
import "./adcards.css";
import { AuthImg } from "../../shared/ui/AuthImg";
import { formatPhone } from "../building/KV";

/** 광고(S05) — 탐색 사이드 판과 건물 상세가 같은 부품을 쓴다. 누구나 본다.
 *
 *  **광고 내용 전체가 바로 선다**(대표 09-28). 밸류맵처럼 눌러야 모달로 뜨는 게 아니라
 *  사진(올린 비율 그대로 · 여러 장이면 넘김) · 매매가 · 주소 · 제목 · 설명 · 중개사 정보 · 상담요청이 한 판에.
 *  노출 중이고 우리 팀 광고가 아니면 「상담요청」. 거래완료는 회색으로 남는다(밸류맵). */
export function AdCards({ pk, empty }: { pk: string; empty?: React.ReactNode }) {
  const q = useQuery({ queryKey: ["bAds", pk], queryFn: () => buildingsApi.ads(pk), enabled: !pk.startsWith("P") });
  const [ask, setAsk] = useState<AdCard | null>(null);
  const list = q.data ?? [];
  if (!list.length) return <>{empty ?? null}</>;
  return (
    <div className="sel-ads">
      {list.map((a) => <AdFull key={a.id} a={a} onAsk={() => setAsk(a)} />)}
      {ask && <InquiryModal ad={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

function AdFull({ a, onAsk }: { a: AdCard; onAsk: () => void }) {
  const photos = a.photo_ids ?? (a.photo_id ? [a.photo_id] : []);
  const [i, setI] = useState(0);
  const sold = a.state === "거래완료";
  return (
    <article className={`adf ${sold ? "sold" : ""}`}>
      {photos.length > 0 && (
        <div className="adf-ph">
          {/* 올린 비율 그대로 — 자르지 않는다 */}
          <AuthImg className="adf-img" src={`/api/ads/${a.id}/photos/${photos[i]}`} />
          {photos.length > 1 && (
            <>
              <button className="adf-nav l" onClick={() => setI((i - 1 + photos.length) % photos.length)}>‹</button>
              <button className="adf-nav r" onClick={() => setI((i + 1) % photos.length)}>›</button>
              <span className="adf-cnt num">{i + 1} / {photos.length}</span>
            </>
          )}
        </div>
      )}
      <div className="adf-b">
        <div className="adf-price">
          <b className="num">{sold ? "거래완료" : a.price != null ? `매매 ${won(a.price)}` : "가격 비공개"}</b>
          {a.use_type && <span className="ad-tag gray">{a.use_type}</span>}
          {a.brokerage === "전속" && <span className="ad-tag">전속</span>}
        </div>
        {a.addr && <div className="adf-addr">{a.addr.replace("서울특별시 ", "").replace("번지", "")}</div>}
        <div className="adf-title">{a.title}</div>
        {a.body && <div className="adf-body">{a.body}</div>}
        {/* 중개사 정보 — 사무소 · 담당 · 등록번호 · 전화 · 올린 날 */}
        <div className="adf-ag">
          <div className="adf-ag1"><b>{a.office_name ?? "중개사무소"}</b>{a.agent_name && <span>{a.agent_name}</span>}</div>
          <div className="adf-ag2">
            {a.reg_no && <span>등록번호 {a.reg_no}</span>}
            {a.phone && !sold && <span className="num">{a.phone}</span>}
            <span>{sold ? `거래완료 ${a.closed_on ?? ""}` : `올린 날 ${a.posted_on}`}</span>
          </div>
        </div>
        {a.state === "노출" && !a.mine && <button className="ad-ask" onClick={onAsk}>상담요청</button>}
      </div>
    </article>
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
  const ph = phone ?? formatPhone(me.data?.phone ?? "");

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
            {row("전화", <input className="gm-in num" value={ph} placeholder="010-0000-0000" onChange={(e) => setPhone(formatPhone(e.target.value))} />)}
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
