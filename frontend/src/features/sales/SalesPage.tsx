import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router-dom";
import { inquiriesApi } from "../../shared/api/endpoints";
import { CalendarTab } from "./CalendarTab";
import "./draft/salestab.css";
import { ListingsTab } from "./ListingTable";
import { InquiryTable } from "./InquiryTable";
import { CustomerTable } from "./CustomerTable";
import "./sales.css";

/** S04 업무 — 대시보드(오늘 할 일) · 캘린더 · 매물(소유자 포함) · 매수자.
 *
 *  이름을 「영업」에서 「거래」로 바꿨다(2026-08-13). 이 화면이 다루는 것은 매물·매도자·
 *  매수자·수수료 — 전부 거래의 구성요소고, 대시보드는 거래 현황판이다. 「영업」은 행위의
 *  이름이라 일정·수수료 계산 같은 걸 담기엔 옷이 작았다.
 *
 *  어휘·저장소는 발명하지 않는다: 매도자 = 업무탭과 같은 app.listings(jindo enum 그대로),
 *  장부 = app.contacts 하나(0141). 짝(매수자×매물)의 상태는 app.nego_rank 가 사실에서 판다.
 *  담는 일은 지도·건물 상세(「매수자」 탭) 또는 리스트의 「매물 담기」(주소 자동완성). */


/* 끝난 건 — 탭 줄에서 흐리게 뒤로 민다.
   「계약」은 끝이 아니다(2026-08-17) — ③사다리에선 그 뒤에 잔금·신고가 남는다.
   흐려지는 건 **죽은 짝**(dropped_at)뿐이다. 안 산다는 답은 보류라 살아 있다(0141). */

/* ══════════════════════ 루트 ══════════════════════ */

/* 윗메뉴 셋(2026-09-28) — 부기사처럼 매물관리 · 고객관리 · 일정을 나눴다. 아래 줄 탭은 없앴다.
 * 대시보드(TodayTab)와 하단 대화창(TradeBar)은 뺐다(09-28 화면에서 · 09-29 코드까지). */

function useRefresh() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ["buyers"] });
    qc.invalidateQueries({ queryKey: ["proposals"] });
    qc.invalidateQueries({ queryKey: ["sellers"] });
    qc.invalidateQueries({ queryKey: ["sales-today"] });
  };
}

/** 매물관리 — 매물 표. ?listing=매물번호 로 그 매물을, ?parcel=지번 으로 그 땅(내 매물이 없으면 담기 창)을 연다(&tab=rent) */
export function SalesPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const refresh = useRefresh();
  const buyer = sp.get("buyer");
  // 옛 주소 — 매수자는 고객관리로 옮겼다
  useEffect(() => { if (buyer) nav(`/customers?buyer=${buyer}`, { replace: true }); }, [buyer, nav]);
  const listing = sp.get("listing") && /^\d+$/.test(sp.get("listing")!) ? Number(sp.get("listing")) : null;
  const parcel = sp.get("parcel");
  const focusTab = sp.get("tab") === "rent" ? "rent" as const : undefined;   // 건물 상세 「임대 내역 →」
  return (
    <div className="page sales flush">
      <ListingsTab focus={listing} focusPnu={parcel} focusTab={focusTab} onDone={refresh}
        onBuyer={(id) => nav(`/customers?buyer=${id}`)} />
    </div>
  );
}

/** 고객관리 = 고객 + 문의(S09, 10-04) — 둘 다 매물관리와 같은 전체 폭 표. 매물과 잇지 않는다.
 *  툴바 맨 앞 두 칸으로 갈아 끼운다. 주소 ?tab=inquiry · ?buyer=고객 · ?iq=문의 로 바로 연다 */
export function CustomersPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get("tab") === "inquiry" ? "inquiry" : "customer";
  const focus = sp.get("buyer") ? Number(sp.get("buyer")) : null;
  const iq = sp.get("iq") ? Number(sp.get("iq")) : null;
  const unread = useQuery({ queryKey: ["iqCount"], queryFn: inquiriesApi.count });
  const go = (t: "customer" | "inquiry", extra: Record<string, string> = {}) => setSp({ ...(t === "inquiry" ? { tab: "inquiry" } : {}), ...extra });
  const head = (
    <span className="cx-tabs">
      <button className={`lx-pn ${tab === "customer" ? "on" : ""}`} onClick={() => go("customer")}>고객</button>
      <button className={`lx-pn ${tab === "inquiry" ? "on" : ""}`} onClick={() => go("inquiry")}>
        문의{unread.data?.unread ? <b className="num cx-dot">{unread.data.unread}</b> : null}</button>
    </span>
  );
  return (
    <div className="page sales flush">
      {tab === "customer"
        ? <CustomerTable head={head} focus={focus} />
        : <InquiryTable head={head} focus={iq} onCustomer={(bid) => go("customer", { buyer: String(bid) })} />}
    </div>
  );
}

/** 일정 — 캘린더 */
export function SchedulePage() {
  const nav = useNavigate();
  return (
    <div className="page sales">
      <CalendarTab onBuyer={(id) => nav(`/customers?buyer=${id}`)}
        onSeller={(lid) => nav(`/sales?listing=${lid}`)} />
    </div>
  );
}

/* 매물 탭은 ListingTable.tsx — 표 하나 + 통합 모달(2026-09-26) */
