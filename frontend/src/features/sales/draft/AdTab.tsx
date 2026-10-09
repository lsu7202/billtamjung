import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adsApi } from "../../../shared/api/endpoints";
import { Icon } from "../../../shared/ui/Icon";
import { Segmented } from "../../../shared/ui/Segmented";
import { wonAcc } from "../../../shared/format";
import { AdEditor } from "./AdEditor";

/** 매물 모달 「광고」 탭(S05 §3 · 2묶음, 2026-09-28).
 *
 *  광고는 **자동으로 켜지지 않는다** — 광고 폼(모달)을 작성하고 「올리기」를 눌러야 노출된다.
 *  폼은 매물 유형 · 중개유형 · 매매가 · 제목 · 설명 · 사진 · 연락처뿐이다(0195). 건물 스펙은 광고 카드 옆에
 *  대장 값이 그대로 뜨므로 싣지 않는다. 「임시저장」은 필수 칸을 다 안 채워도 되고 고객에게 안 보인다.
 *  기한은 올린 날 + 30일, 「연장」으로만 늘어난다(오늘 확인과 상관없다 — 대표 09-28). */

const dday = (d: string) => Math.ceil((new Date(`${d}T23:59:59+09:00`).getTime() - Date.now()) / 86400000);

export function AdTab({ lid, pnu, onSaved }: { lid: number; pnu: string; onSaved: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["listing-ad", lid], queryFn: () => adsApi.ofListing(lid) });
  const [form, setForm] = useState<null | "new" | "edit">(null);
  const ad = q.data?.ad ?? null;
  const refresh = () => { q.refetch(); qc.invalidateQueries({ queryKey: ["pAds", pnu] }); onSaved(); };
  const act = async (fn: () => Promise<unknown>) => { await fn(); refresh(); };

  if (q.isLoading) return <div className="um-pane"><div className="tc dim">불러오는 중</div></div>;
  const live = ad && (ad.state === "노출" || ad.state === "비노출");
  const line = (k: string, v: string, main = false) => (
    <div key={k} className="orow"><span className="who g">{k}</span><span className={`ev ${main ? "main" : ""}`}>{v}</span></div>
  );
  const d = ad ? dday(ad.expires_on) : 0;
  return (
    <div className="um-pane">
      {/* 계약된 매물인데 광고가 살아 있으면 — 거래완료로 돌릴지 묻는다(자동으로 안 바꾼다) */}
      {q.data?.contracted && live && (
        <div className="tc ad-warn">
          <span>계약된 매물입니다</span>
          <button className="ad-link" onClick={() => {
            if (confirm("광고를 거래완료로 돌립니다. 되돌릴 수 없습니다.")) act(() => adsApi.state(ad!.id, "거래완료"));
          }}>거래완료로 돌리기</button>
        </div>
      )}
      {/* 그리드 줄(10-02) — 판의 다른 탭과 같은 「라벨 | 값」. 조작은 맨 위 한 줄(아이콘) */}
      {!ad ? (
        null
      ) : ad.state === "임시" ? (
        null   /* 작성 중인 광고 — 위 줄 없이 바로 폼(초기화는 폼 아래) */
      ) : (
        <>
          <div className={`adx-bar ${ad.state === "거래완료" || ad.expired ? "done" : ""}`}>
            <b className={ad.state === "노출" && !ad.expired ? "on" : ""}>
              {ad.state === "거래완료" ? "거래완료" : ad.expired ? "지난 광고" : ad.state}</b>
            {live && !ad.expired && <span className={`adx-dd ${d <= 7 ? "red" : ""}`}>D-{d}</span>}
            {/* 올린 날 · 기한은 상태 줄 안에(10-02) — 광고 편집 몸통에 높이를 준다 */}
            {live && <span className="adx-dt">올린 날 {(ad.posted_on ?? "").replace(/-/g, ".")} · 기한 {(ad.expires_on ?? "").replace(/-/g, ".")}</span>}
            <span className="sp" />
            {live && (
              <Segmented size="sm" value={ad.state} onChange={(v) => act(() => adsApi.state(ad.id, v as "노출" | "비노출"))}
                options={[{ value: "노출", label: "노출" }, { value: "비노출", label: "비노출" }]} />
            )}
            {live && <button className="lx-ic on" title="연장(오늘부터 30일)" onClick={() => act(() => adsApi.extend(ad.id))}><Icon name="reset" size={14} /></button>}
            {live && <button className="lx-ic on" title="거래완료" onClick={() => {
              if (confirm("거래완료로 돌립니다. 되돌릴 수 없습니다.")) act(() => adsApi.state(ad.id, "거래완료"));
            }}><Icon name="check" size={14} /></button>}
            <button className="lx-ic on" title="광고 지우기" onClick={() => {
              if (confirm("광고를 지웁니다.")) act(() => adsApi.state(ad.id, "삭제"));
            }}><Icon name="trash" size={14} /></button>
          </div>
          {!live && line("매매가", ad.price_open ? wonAcc(ad.price ?? 0) : "가격 비공개", true)}
          {!live && line("매물 유형", ad.use_type ?? "")}
          {!live && line("중개", ad.brokerage ?? "")}
          {!live && line("제목", ad.title ?? "")}
          {!live && line("올린 날", (ad.posted_on ?? "").replace(/-/g, "."))}
          {!live && ad.state !== "거래완료" && line("기한", (ad.expires_on ?? "").replace(/-/g, "."))}
          {ad.state === "거래완료" && line("거래완료일", (ad.closed_on ?? "").replace(/-/g, "."))}
          {!live && line("사진", `${ad.photo_ids?.length ?? 0}장`)}
          {!live && <button className="adx-go" onClick={() => setForm("new")}>+ 새로 올리기</button>}
        </>
      )}
      {/* 광고 편집 — 모달 없이 탭 안에서. 왼쪽 폼 · 오른쪽 미리보기(10-02) */}
      {q.data && (!ad || ad.state === "임시" || live || form === "new") && (
        <AdEditor key={`${ad?.id ?? "new"}-${form ?? ""}`} lid={lid} pnu={pnu}
          base={form === "new" || !ad ? q.data.draft : ad} ad={form === "new" ? null : ad}
          onDone={() => { setForm(null); refresh(); }} />
      )}
    </div>
  );
}

