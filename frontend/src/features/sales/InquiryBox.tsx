import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { inquiriesApi, type Inquiry } from "../../shared/api/endpoints";
import { md } from "../../shared/format";
import { openDetail } from "../../shared/map/geo";
import { ListingModal } from "./ListingModal";

/** 고객관리 맨 위 「문의」 칸(S05 §4) — 광고를 보고 들어온 상담요청.
 *  줄을 누르면 펼쳐져 전문 · 고객 프로필이 보이고, 미확인이면 저절로 상담중이 된다.
 *  고객등록: 매수 · 시세 문의 → 매수자로 / 매도 문의 → 매물 담기 창(팔 건물 주소 · 이름 · 전화를 채워 연다). */
const GRADE: Record<string, string> = { A: "확실", B: "보통", C: "관망" };

export function InquiryBox({ onBuyer }: { onBuyer: (id: number) => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["inquiries"], queryFn: inquiriesApi.list });
  const [open, setOpen] = useState<number | null>(null);
  const [sell, setSell] = useState<Inquiry | null>(null);
  const list = q.data ?? [];
  if (!list.length) return null;
  const refresh = () => { q.refetch(); qc.invalidateQueries({ queryKey: ["inq-count"] }); qc.invalidateQueries({ queryKey: ["buyers"] }); };
  const unread = list.filter((i) => i.status === "미확인").length;

  const toggle = async (i: Inquiry) => {
    setOpen(open === i.id ? null : i.id);
    if (i.status === "미확인") { await inquiriesApi.status(i.id, "상담중"); refresh(); }
  };
  const register = async (i: Inquiry) => {
    if (i.kind === "매도 문의") { setSell(i); return; }
    const r = await inquiriesApi.register(i.id); refresh();
    if (r.buyer_id) onBuyer(r.buyer_id);
  };

  return (
    <div className="iq">
      <div className="iq-h">문의 <b className="num">{list.length}</b>{unread > 0 && <span className="iq-new">미확인 {unread}</span>}</div>
      {list.map((i) => (
        <div key={i.id} className={`iq-row ${i.status === "미확인" ? "new" : ""} ${open === i.id ? "open" : ""}`}>
          <button className="iq-line" onClick={() => toggle(i)}>
            <span className={`iq-k k${i.kind[1]}`}>{i.kind.replace(" 문의", "")}</span>
            <b>{i.name}</b>
            <span className="iq-a">{i.addr.replace("서울특별시 ", "").replace("번지", "")}</span>
            <span className="iq-t">{i.body ?? ""}</span>
            <span className="iq-d num">{md(i.created_at.slice(0, 10))}</span>
            <span className={`iq-s s-${i.status}`}>{i.status}</span>
          </button>
          {open === i.id && (
            <div className="iq-body">
              <div className="iq-kv"><i>전화</i><b className="num">{i.phone}</b></div>
              {i.body && <div className="iq-kv"><i>내용</i><span>{i.body}</span></div>}
              {i.sell_addr && <div className="iq-kv"><i>팔 건물</i><span>{i.sell_addr}</span></div>}
              {/* 고객이 적은 배경(3묶음) — 적은 칸만 */}
              {(i.intent || i.literacy || i.budget_min || i.budget_max) && (
                <div className="iq-kv"><i>고객</i><span>{[i.intent && `의사 ${GRADE[i.intent] ?? i.intent}`, i.literacy && `이해도 ${i.literacy}`,
                  (i.budget_min || i.budget_max) && `예산 ${i.budget_min ? Math.round(i.budget_min / 1e8) : ""}~${i.budget_max ? Math.round(i.budget_max / 1e8) : ""}억`]
                  .filter(Boolean).join(" · ")}</span></div>
              )}
              <div className="iq-acts">
                {i.building_pk && <button className="iq-link" onClick={() => openDetail(i.building_pk!)}>광고 매물 보기 ›</button>}
                <span className="sp" />
                {i.status !== "고객등록" && (
                  <>
                    {(["상담중", "종료"] as const).map((st) => (
                      <button key={st} className={`um-chip ${i.status === st ? "on" : ""}`}
                        onClick={async () => { await inquiriesApi.status(i.id, st); refresh(); }}>{st}</button>
                    ))}
                    <button className="iq-reg" onClick={() => register(i)}>고객등록</button>
                  </>
                )}
                {i.status === "고객등록" && i.buyer_id && <button className="iq-link" onClick={() => onBuyer(i.buyer_id!)}>매수자로 가기 ›</button>}
              </div>
            </div>
          )}
        </div>
      ))}
      {sell && (
        <ListingModal prefill={{ q: sell.sell_addr, name: sell.name, phone: sell.phone }}
          onClose={() => setSell(null)}
          onSaved={async (pk) => { await inquiriesApi.register(sell.id, pk); setSell(null); refresh(); }} />
      )}
    </div>
  );
}
