import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listingsApi, overlaysApi, buildingsApi, proposalsApi, schedulesApi } from "../../shared/api/endpoints";
import { negoWord } from "../sales/words";
import { MemoLog } from "../sales/draft/MemoLog";
import { PickModal } from "../sales/PickModal";
import { Loading } from "../../shared/ui/Spinner";
import { KV, wonToEok, vPos } from "./KV";
import { won } from "../../shared/format";
import { useRentTotals } from "./rentTotals";
import { useNavigate } from "react-router-dom";
import { useEnums } from "../../shared/hooks/useEnums";
import { Icon } from "../../shared/ui/Icon";

/** S02 우측 고정 사이드바 — 소유자 / 매수자 / 메모 3탭(2026-08-26 개편).
 *
 *  이 화면의 규칙은 **왼쪽은 건물, 오른쪽은 거래**다. 왼쪽은 누가 보든 같은 값(대장·지적·실거래),
 *  오른쪽은 우리 팀만의 값(소유자·매수자·메모).
 *
 *  위키·힌트를 뺐다: 둘 다 **팀 밖의 것**이라 이 줄에 성격이 안 맞았다 —
 *  위키는 전체 이용자가 쓰는 글이고, 힌트는 남들이 그 칸을 뭐로 갖고 있는지의 익명 분포다.
 *  화면에서만 뺐고 컴포넌트·API는 그대로 둔다(WikiTab·HistTab). 자리를 정해 다시 넣는다:
 *  힌트는 값 옆 곁말로, 위키는 건물·토지 탭 맨 아래가 유력하다.
 *
 *  **만드는 일은 업무에서만, 고치는 일은 업무 모달이 정본이다.** 여기서 고치는 건 금액 셋과 메모뿐 —
 *  창구를 둘로 두면 어느 쪽이 최신인지 아무도 모른다.
 */

export function Sidebar({ pk }: { pk: string }) {
  const [tab, setTab] = useState<"biz" | "buyers" | "memo">("biz");

  const listing = useQuery({ queryKey: ["listing", pk], queryFn: () => listingsApi.get(pk) });
  // 매물을 받으면 중개인이 제일 먼저 하는 생각이 "누구한테 돌리지"다 — 그 자리를 매도자 옆에 둔다(S04).
  // 이름은 업무 탭과 같게 「매물」 — 같은 것을 두 이름으로 부르면 같은 것인 줄 모른다(2026-08-27)
  const TABS = [["biz", "매물"], ["buyers", "매수자"], ["memo", "메모"]] as const;

  return (
    <div className="panel" style={{ position: "sticky", top: 12 }}>
      {/* 알약 탭 — 통합 매물 모달(.um-tabs)과 같은 어법. 본문의 밑줄 탭(bt-tabs)은
          화면을 가르는 큰 전환이고, 사이드바처럼 작은 칸 안에서는 알약이 결에 맞는다. */}
      <div className="sb-tabs">
        {TABS.map(([t, label]) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>{label}</button>
        ))}
      </div>
      <div style={{ padding: 14, minHeight: 300, maxHeight: "calc(100vh - 180px)", overflow: "auto" }}>
        {tab === "biz" && <SellerTab pk={pk} listing={listing.data} />}
        {tab === "buyers" && <BuyersTab pk={pk} />}
        {tab === "memo" && <MemoTab pk={pk} />}
      </div>
    </div>
  );
}

/* ── 매수자 탭(S04) — **이 매물에 걸린 사람들**.
   예전엔 조건에 맞는 사람을 추천해 보여줬는데, 매물을 열고 이 탭을 누르는 이유는 대개
   "지금 누구한테 나가 있지?"다. 탐색은 가끔이고 확인은 매번인데 화면이 탐색용으로 서 있었다.
   그래서 기본은 담긴 사람 목록, 담는 일은 「＋」 뒤로 보낸다 —
   영업 화면(사람 하나 고정 · 탭 = 담긴 매물)과 정확히 대칭이다. */
function BuyersTab({ pk }: { pk: string }) {
  const { options } = useEnums();
  const gradeLabel = (c: string) => options("buyer_grade").find((o) => o.code === c)?.label ?? c;
  const qc = useQueryClient();
  const nav = useNavigate();
  const rows = useQuery({ queryKey: ["proposals", "pk", pk], queryFn: () => proposalsApi.list({ building_pk: pk }) });
  const list = rows.data ?? [];
  const [pick, setPick] = useState(false);

  return (
    <div className="btab">
      {rows.isLoading ? <Loading label="불러오는 중" minHeight="80px" /> : (
        <div className="btab-list">
          {list.map((p) => {
            const days = Math.round((Date.now() - new Date(p.updated_at).getTime()) / 86400000);
            return (
              <button key={p.id} className={`btab-row ${p.stop_id || p.dropped_at ? "off" : ""}`}
                onClick={() => nav(`/sales?buyer=${p.buyer_id}`)} title="거래에서 보기">
                <b>{p.buyer_name}</b>
                {p.buyer_grade && <span className="g">{gradeLabel(p.buyer_grade)}</span>}
                <span className={`pp-st s-${negoWord(p)}`}>{negoWord(p)}</span>
                {p.hope_price != null && <span className="dim2 num" style={{ fontSize: 11 }}>희망 {Math.round(p.hope_price / 1e8)}억</span>}
                <span className="sp" />
                {p.stop_reason && <span className="rj">{p.stop_reason}</span>}
                <span className="d">{days === 0 ? "오늘" : `${days}일 전`}</span>
              </button>
            );
          })}
          {list.length === 0 && <p className="btab-none">아직 담긴 매수자가 없습니다</p>}
        </div>
      )}

      {/* 담기는 창 하나로(2026-08-20) — 이름 자동완성만으로는 「누구에게 돌릴지」를 못 고른다.
          추천(조건 기반)·내 매수자를 한자리에서 보고 여러 명을 한 번에 담는다. */}
      <button className="pick-open" onClick={() => setPick(true)}>＋ 매수자 담기</button>
      {pick && (
        <PickModal mode="buyer" buildingPk={pk} title="매수자 담기"
          onClose={() => setPick(false)}
          onAdded={() => {
            qc.invalidateQueries({ queryKey: ["proposals"] });
            qc.invalidateQueries({ queryKey: ["sales-today"] });
          }} />
      )}
    </div>
  );
}

/* ── 매도자 탭(§4.1 개편 2026-08-13) — 요약만.
   프로필·업무 필드는 한번 정해지면 잘 안 바뀌는 값이라 매물상세에 설정을 늘어놓지 않는다 —
   자세한 관리(등록·소유자 정보·긴급도·기록)는 거래 섹션이 정본이고, 여기는 현재 상황과
   금액(매도희망가)만 보여준다. 스펙 그대로: 진행상태·담당자는 절대 가리지 않고,
   전화번호만 담당자·대표 외 마스킹, 클릭=복사. */
function SellerTab({ pk, listing }: { pk: string; listing?: Record<string, unknown> }) {
  const nav = useNavigate();
  const members = useQuery({ queryKey: ["team-members"], queryFn: listingsApi.members });
  const building = useQuery({ queryKey: ["building", pk], queryFn: () => buildingsApi.get(pk) });
  const props = useQuery({ queryKey: ["proposals", "pk", pk], queryFn: () => proposalsApi.list({ building_pk: pk }) });
  // 이 매물의 지금 = 살아 있는 짝들 중 **가장 앞선 합의 단계**(0142·업무탭 매물 줄과 같은 규칙)
  const topWord = (() => {
    const alive = (props.data ?? []).filter((p) => !p.dropped_at);
    if (!alive.length) return null;
    const top = alive.reduce((a, x) => ((x.nego ?? 0) > (a.nego ?? 0) ? x : a));
    return negoWord(top);
  })();
  // 다음 일정 — 「내일 만나기로 했나?」를 보려고 업무로 나가야 했다(2026-08-26).
  // 일정 조회에 매물 필터가 없어 앞으로 두 달치를 받아 여기서 거른다(캘린더와 같은 캐시를 탄다).
  const today = new Date().toISOString().slice(0, 10);
  const until = new Date(Date.now() + 60 * 864e5).toISOString().slice(0, 10);
  const scheds = useQuery({ queryKey: ["sched", today, until],
    queryFn: () => schedulesApi.range(today, until) });
  const nextSched = (scheds.data ?? [])
    .filter((x) => x.building_pk === pk && x.state !== "완료" && x.on_date >= today)
    .sort((a, b) => (a.on_date + (a.at_time ?? "")).localeCompare(b.on_date + (b.at_time ?? "")))[0];
  const [copied, setCopied] = useState(false);
  const qc = useQueryClient();
  const bd = building.data as Record<string, unknown> | undefined;
  const l = listing ?? {};
  const v = (k: string) => (l[k] != null ? String(l[k]) : "");
  // 조건 넷은 app.listings 가 저장소다 — 업무 탭 매물 모달과 **같은 API**(patchBiz)를 쓴다.
  // 두 화면이 같은 칸을 보므로 한쪽만 고쳐 어긋나는 일이 구조적으로 안 생긴다.
  // 수익률·평단가 — 매매가에서 나오는 값. 매매가가 비면 같이 빈다(추정치로 채우지 않는다)
  const salePrice = bd?.sale_price != null && bd.sale_price !== "" ? Number(bd.sale_price) : null;
  // 임대 총계는 공용 정본 하나에서만 나온다(rentTotals) — 머리줄 수익률도 같은 값을 본다.
  const { rent: totRent, deposit: totDep, mgmt: totMgmt, fromFloors, floorRows, yearRent } = useRentTotals(pk);
  const roi = salePrice && yearRent ? (yearRent / salePrice) * 100 : null;
  /** 총계 한 줄 — 층별이 있으면 파생이라 못 고친다(고치는 자리는 임대 탭 층별 표 하나) */
  const totRow = (label: string, field: string, val: number | null) => fromFloors ? (
    <div className="sb-r"><span className="l">{label}</span>
      <span className="r num">{val ? won(val) : "—"}
        <em className="sb-src">층별 {floorRows}개</em></span></div>
  ) : (
    // 억 고정 표기(wonToEok)는 총계에 안 맞다 — 월 임대료 1,000만이 「0.10억」으로 뭉개진다
    <KV label={label} field={field} value={val ? won(val) : "—"}
      editable money current={val != null ? String(val) : ""} validate={vPos}
      onSave={async (_f, w) => {
        await listingsApi.patchBiz(pk, { [field]: w.trim() ? String(Math.round(parseFloat(w))) : "" });
        qc.invalidateQueries({ queryKey: ["listing", pk] });
      }}
      onRevert={async () => {
        await listingsApi.patchBiz(pk, { [field]: "" });
        qc.invalidateQueries({ queryKey: ["listing", pk] });
      }} />
  );
  const landPy = bd?.land_area ? Number(bd.land_area) / 3.305785 : null;
  const ppLand = salePrice && landPy ? salePrice / landPy : null;
  const assignee = l.assignee_account_id != null ? Number(l.assignee_account_id) : null;
  const assigneeName = (members.data ?? []).find((m) => m.account_id === assignee)?.name;
  const goTrade = () => nav(`/sales?listing=${pk}`);

  // 아무것도 없는 매물 — 등록은 거래에서(리다이렉트). 여기서 폼을 펼치지 않는다.
  if (assignee == null && !v("owner_name") && !v("status")) {
    return (
      <div style={{ display: "grid", gap: 12, justifyItems: "center", textAlign: "center", padding: "30px 16px" }}>
        <div style={{ width: 48, height: 48, borderRadius: 12, background: "var(--signal-bg)", display: "grid", placeItems: "center" }}><Icon name="building" size={24} /></div>
        <div style={{ fontWeight: 700, fontSize: 15 }}>아직 거래에 담지 않은 매물입니다</div>
        <p style={{ color: "var(--muted)", fontSize: 12.5, lineHeight: 1.6, margin: 0, maxWidth: 240 }}>
          업무 탭에서 등록하면 담당자로 지정되고 소유자·매수자 관리가 열립니다.</p>
        <button className="btn primary" style={{ padding: "9px 20px", fontSize: 14 }} onClick={goTrade}>
          거래에서 등록 →</button>
      </div>
    );
  }

  // 사람 요약 한 줄 — 비어 있는 항목은 말하지 않는다(요약이 빈칸 목록이 되면 안 된다)
  const person = [v("relation"), v("cooperation") && `${v("cooperation")}`, v("kindness") && `응대 ${v("kindness")}`]
    .filter(Boolean).join(" · ");
  const hopes = (props.data ?? []).map((x) => x.hope_price).filter((x): x is number => x != null);
  const bidFallback = bd?.bid_price != null ? Number(bd.bid_price) : null;

  return (
    /* 세 묶음 — 지금 / 소유자 / 금액(2026-08-26).
       선을 두른 박스와 kv 줄이 섞여 있던 것을 줄 문법 하나로 갈았다: 라벨 왼쪽, 값 오른쪽,
       선 없음, 묶음 사이는 여백이 가른다. 「이 매물 지금 어떻게 됐지」에 답하는 것만 남긴다. */
    <div className="sb">
      {/* 상태 칩 — 매물엔 상태 칸이 없다(0142). **담긴 짝들 중 가장 앞선 것**이 이 매물의
          지금이다(업무탭 매물 줄과 같은 규칙). 짝이 하나도 없으면 칩을 안 세운다:
          미지정을 칩으로 세우면 진짜 상태처럼 읽힌다. */}
      {(topWord || assigneeName) && (
        <div className="sb-hd">
          {topWord && <span className={`pp-st s-${topWord}`}>{topWord}</span>}
          {assigneeName && <span className="who g">담당 {assigneeName}</span>}
        </div>
      )}

      <div className="sb-g">
        {nextSched && (
          <button className="sb-r act" onClick={goTrade} title="업무에서 이 일정을 엽니다">
            <span className="l">다음 일정</span>
            {/* 제목에서 주소를 뗀다 — 「계약 — 삼성동 147-4」의 뒷부분은 이 화면이 이미 아는 것이라
                그대로 두면 줄이 접힌다. 앞의 낱말(계약·현장·통화)만 있으면 무슨 약속인지 안다. */}
            <span className="r num">
              {nextSched.on_date.slice(5).replace("-", "/")}
              {nextSched.at_time ? ` ${nextSched.at_time.slice(0, 5)}` : ""}
              {nextSched.title ? ` · ${nextSched.title.split(/\s*[—·-]\s*/)[0].trim()}` : ""}</span>
          </button>
        )}
      </div>

      <div className="sb-g">
        <span className="sb-lb">소유자</span>
        <div className="sb-r">
          <span className="l ink">{v("owner_name") || "소유자 미확인"}
            {v("owner_type") === "법인" && <em className="tag">법인</em>}</span>
          {v("owner_phone") && (
            <button className="r lnk num" title="클릭하면 복사됩니다"
              onClick={async () => {
                try { await navigator.clipboard.writeText(v("owner_phone")); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* http 환경 */ }
              }}>{copied ? "복사됨" : v("owner_phone")}</button>
          )}
        </div>
        {person && <div className="sb-r"><span className="l">성향</span><span className="r dim">{person}</span></div>}
        {v("owner_note") && <div className="sb-note">“{v("owner_note")}”</div>}
      </div>

      {/* 금액 — 가격 셋(매도희망·매매·매수희망)이 한 자리에 선다(2026-08-25).
          고치는 자리는 여기 하나고 머리줄 매매가는 읽기만 한다.
          매수희망가는 매수자별 값(proposals.hope_price)의 파생이라 읽기 전용(0064). */}
      <div className="sb-g">
        <span className="sb-lb">금액</span>
        <KV label="매도희망가" field="ask_price" value={wonToEok(bd?.ask_price) || "—"}
          editable money current={bd?.ask_price != null ? String(bd.ask_price) : ""} validate={vPos}
          onSave={async (_f, w) => { await overlaysApi.put(pk, "ask_price", w.trim() ? String(Math.round(parseFloat(w))) : ""); building.refetch(); }}
          onRevert={async () => { await overlaysApi.put(pk, "ask_price", ""); building.refetch(); }} />
        <KV label="매매가" field="sale_price" value={wonToEok(bd?.sale_price) || "—"}
          editable money current={bd?.sale_price != null ? String(bd.sale_price) : ""} validate={vPos}
          onSave={async (_f, w) => { await overlaysApi.put(pk, "sale_price", w.trim() ? String(Math.round(parseFloat(w))) : ""); building.refetch(); }}
          onRevert={async () => { await overlaysApi.put(pk, "sale_price", ""); building.refetch(); }} />
        <div className="sb-r"><span className="l">매수희망가</span>
          <span className="r num">
            {hopes.length ? `${wonToEok(Math.max(...hopes))} · ${hopes.length}명 중 최고`
              : bidFallback ? `${wonToEok(bidFallback)} · 직접 입력` : "—"}
          </span></div>
        {/* 임대 총계(0134) — 수익률의 분자. 재료가 결과 바로 위에 선다.
            층별 임대를 넣으면 파생으로 차고, 없으면 여기서 총액을 직접 적는다. */}
        {/* 「총」을 뗐다(2026-08-28) — 사이드바는 건물 단위가 기본이라 굳이 붙일 이유가 없다.
            층별은 층 이름이 붙어 있어 헷갈리지 않는다. */}
        {totRow("보증금", "total_deposit", totDep)}
        {totRow("임대료", "total_rent", totRent)}
        {totRow("관리비", "total_mgmt", totMgmt)}
        {/* 이름에 분모를 박는다(2026-08-27) — 「수익률」 한 낱말이 화면마다 다른 값을 가리켰다.
            분자도 추정을 안 섞는다: 총임대료가 비면 수익률도 빈다. */}
        <div className="sb-r"><span className="l">매매가 대비 수익률</span>
          <span className={`r num ${roi != null ? "" : "dim"}`}>{roi != null
            ? `${roi.toFixed(2)}%`
            : salePrice == null ? "매매가를 넣으면 섭니다" : "임대료를 넣으면 섭니다"}</span></div>
        <div className="sb-r"><span className="l">대지 평단가</span>
          <span className={`r num ${ppLand != null ? "" : "dim"}`}>
            {ppLand != null ? wonToEok(ppLand) : "—"}</span></div>
      </div>

      {/* 명도·용도변경·멸실·임대내역을 뺐다(2026-08-26) — **거래 조건**이라 업무 모달 정보 탭이 정본이다.
          여기서도 고칠 수 있게 두면 창구가 둘이 되고, 그러면 어느 쪽이 최신인지 아무도 모른다.
          이 사이드바가 하는 일은 「이 매물 지금 어떻게 됐지」에 답하는 것까지다. */}

      {/* 최근 기록 한 줄은 메모 탭이 받는다 — 같은 장부(contacts)를 두 탭에서 두 번 보일 이유가 없다 */}

      {/* 고치는 문은 맨 아래 하나 — 값들을 다 읽고 나서 여는 문이라 읽는 흐름의 끝이 제자리다 */}
      <button className="sb-go" onClick={goTrade}>업무에서 관리 →</button>
    </div>
  );
}


/* 메모 탭 — 업무 모달과 **같은 컴포넌트**(MemoLog)다(2026-08-27).
   저장소는 진작 하나였는데(contacts · kind=메모) 그리는 코드가 따로 살아서 얼굴이 달랐다.
   같은 장부는 같은 얼굴이어야 어디서 열어도 같은 것인 줄 안다. */
function MemoTab({ pk }: { pk: string }) {
  return <div className="sb-memo"><MemoLog target="listing" id={pk} /></div>;
}
