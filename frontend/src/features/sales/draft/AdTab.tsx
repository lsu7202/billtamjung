import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adsApi, photosApi, type AdForm, type MyAd, type UseType } from "../../../shared/api/endpoints";
import { Icon } from "../../../shared/ui/Icon";
import { Segmented } from "../../../shared/ui/Segmented";
import { parseAmount, seedAmount, formatPhone } from "../../building/KV";
import { won, wonAcc } from "../../../shared/format";
import { AuthImg } from "../../../shared/ui/AuthImg";

/** 매물 모달 「광고」 탭(S05 §3 · 2묶음, 2026-09-28).
 *
 *  광고는 **자동으로 켜지지 않는다** — 광고 폼(모달)을 작성하고 「올리기」를 눌러야 노출된다.
 *  폼은 매물 유형 · 중개유형 · 매매가 · 제목 · 설명 · 사진 · 연락처뿐이다(0195). 건물 스펙은 광고 카드 옆에
 *  대장 값이 그대로 뜨므로 싣지 않는다. 「임시저장」은 필수 칸을 다 안 채워도 되고 고객에게 안 보인다.
 *  기한은 올린 날 + 30일, 「연장」으로만 늘어난다(오늘 확인과 상관없다 — 대표 09-28). */

const USE_TYPES: UseType[] = ["빌딩", "상가주택", "공장·창고", "숙박", "기타"];
const dday = (d: string) => Math.ceil((new Date(`${d}T23:59:59+09:00`).getTime() - Date.now()) / 86400000);

export function AdTab({ pk, onSaved }: { pk: string; onSaved: () => void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["listing-ad", pk], queryFn: () => adsApi.ofListing(pk) });
  const [form, setForm] = useState<null | "new" | "edit">(null);
  const ad = q.data?.ad ?? null;
  const refresh = () => { q.refetch(); qc.invalidateQueries({ queryKey: ["bAds", pk] }); onSaved(); };
  const act = async (fn: () => Promise<unknown>) => { await fn(); refresh(); };

  if (q.isLoading) return <div className="um-pane"><div className="tc dim">불러오는 중</div></div>;
  const live = ad && (ad.state === "노출" || ad.state === "비노출");
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
      <div className="tc">
        {!ad ? (
          <div className="ad-empty">
            <span className="dim">올린 광고가 없습니다</span>
            <button className="ad-go" onClick={() => setForm("new")}><Icon name="plus" size={14} />광고 올리기</button>
          </div>
        ) : ad.state === "임시" ? (
          /* 임시저장한 광고 — 이어 쓰기 · 지우기 */
          <div className="ad-row">
            <div className="ad-main">
              <div className="ad-l1"><span className="ad-st">작성 중인 광고</span>
                {ad.use_type && <span className="ad-tag">{ad.use_type}</span>}</div>
              <div className="ad-l2">{ad.title || <span className="dim">제목 없음</span>}</div>
              <div className="ad-l3 dim">사진 {ad.photo_ids?.length ?? 0}장</div>
            </div>
            <div className="ad-acts">
              <button className="ad-go" onClick={() => setForm("edit")}>이어 쓰기</button>
              <button className="lx-ic on" title="지우기" onClick={() => {
                if (confirm("작성 중인 광고를 지웁니다.")) act(() => adsApi.state(ad.id, "삭제"));
              }}><Icon name="trash" size={14} /></button>
            </div>
          </div>
        ) : (
          <div className={`ad-row ${ad.state === "거래완료" || ad.expired ? "done" : ""}`}>
            <div className="ad-main">
              <div className="ad-l1">
                <b className="num">{ad.price_open ? `매매 ${wonAcc(ad.price ?? 0)}` : "가격 비공개"}</b>
                {ad.use_type && <span className="ad-tag">{ad.use_type}</span>}
                {ad.brokerage === "전속" && <span className="ad-tag">전속</span>}
                <span className={`ad-st ${ad.state === "노출" && !ad.expired ? "on" : ""}`}>
                  {ad.state === "거래완료" ? `거래완료 · ${ad.closed_on}` : ad.expired ? "지난 광고" : ad.state}</span>
                {live && !ad.expired && <span className={`ad-dd ${d <= 7 ? "red" : ""}`}>D-{d}</span>}
              </div>
              <div className="ad-l2">{ad.title}</div>
              <div className="ad-l3 dim">올린 날 {ad.posted_on} · 기한 {ad.expires_on} · 사진 {ad.photo_ids?.length ?? 0}장</div>
            </div>
            {/* 조작은 아이콘 — 고치기 · 연장 · 거래완료 · 삭제. 노출/비노출은 두 갈래라 토글 */}
            <div className="ad-acts">
              {live && (
                <Segmented size="sm" value={ad.state} onChange={(v) => act(() => adsApi.state(ad.id, v as "노출" | "비노출"))}
                  options={[{ value: "노출", label: "노출" }, { value: "비노출", label: "비노출" }]} />
              )}
              {live && <button className="lx-ic on" title="고치기" onClick={() => setForm("edit")}><Icon name="edit" size={14} /></button>}
              {live && <button className="lx-ic on" title="연장(오늘부터 30일)" onClick={() => act(() => adsApi.extend(ad.id))}><Icon name="reset" size={14} /></button>}
              {live && <button className="lx-ic on" title="거래완료" onClick={() => {
                if (confirm("거래완료로 돌립니다. 되돌릴 수 없습니다.")) act(() => adsApi.state(ad.id, "거래완료"));
              }}><Icon name="check" size={14} /></button>}
              <button className="lx-ic on" title="광고 지우기" onClick={() => {
                if (confirm("광고를 지웁니다.")) act(() => adsApi.state(ad.id, "삭제"));
              }}><Icon name="trash" size={14} /></button>
            </div>
          </div>
        )}
        {ad && !live && ad.state !== "임시" && (
          <div className="ad-empty" style={{ marginTop: 12 }}>
            <span className="dim">{ad.state === "거래완료" ? "지도에는 거래완료로 남습니다" : ""}</span>
            <button className="ad-go" onClick={() => setForm("new")}><Icon name="plus" size={14} />새로 올리기</button>
          </div>
        )}
      </div>
      {form && q.data && (
        <AdFormModal pk={pk} base={form === "edit" && ad ? ad : q.data.draft} ad={form === "edit" ? ad : null}
          onClose={() => setForm(null)} onDone={() => { setForm(null); refresh(); }} />
      )}
    </div>
  );
}

/** 광고 폼 — 신규 등록 폼이라 모달 안에만(CLAUDE.md). 자유글은 제목 · 설명 둘, 나머지는 정형 칸 */
function AdFormModal({ pk, base, ad, onClose, onDone }: {
  pk: string; base: AdForm; ad: MyAd | null; onClose: () => void; onDone: () => void;
}) {
  const photos = useQuery({ queryKey: ["photos", pk], queryFn: () => photosApi.list(pk) });
  const [f, setF] = useState<AdForm>({ ...base, contact_phone: base.contact_phone ? formatPhone(base.contact_phone) : null });
  const [pick, setPick] = useState<number[]>(ad?.photo_ids ?? []);
  // 매매가는 억 단위 숫자로 받는다(정보 탭 매매가 칸과 같은 어법) — 1.5 → 1억 5,000만원
  const [priceTxt, setPriceTxt] = useState(seedAmount(base.price));
  // 기본정보(0196) — 보증금 · 융자금은 억, 월세는 만원 단위로 받는다. 비우면 null
  const [depTxt, setDepTxt] = useState(seedAmount(base.deposit));
  const [rentTxt, setRentTxt] = useState(seedAmount(base.monthly_rent, 1e4));
  const [loanTxt, setLoanTxt] = useState(seedAmount(base.loan));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<AdForm>) => setF((v) => ({ ...v, ...p }));
  const togglePhoto = (id: number) => setPick((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  const pics = (photos.data ?? []).filter((p) => p.kind === "exterior" || p.kind === "interior" || p.kind === "etc");

  const live = ad && (ad.state === "노출" || ad.state === "비노출");
  // publish = 올리기(필수 칸 확인) · false = 임시저장(다 안 채워도 된다)
  const save = async (publish: boolean) => {
    const price = parseAmount(priceTxt);
    if (publish) {
      const miss = [!f.use_type && "매물 유형", !price && "매매가", !(f.title ?? "").trim() && "제목",
        !(f.body ?? "").trim() && "설명", pick.length < 3 && "사진 3장"].filter(Boolean);
      if (miss.length) { setErr(`${miss.join(" · ")}이(가) 필요합니다`); return; }
    }
    setBusy(true); setErr(null);
    try {
      const body = { ...f, price, photo_ids: pick, publish,
        deposit: parseAmount(depTxt), monthly_rent: parseAmount(rentTxt, 1e4), loan: parseAmount(loanTxt),
        move_in_on: f.move_in === "날짜" ? f.move_in_on : null };
      if (ad) await adsApi.update(ad.id, body); else await adsApi.create(pk, body);
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const row = (label: string, node: React.ReactNode) => (
    <div className="gm-row lab"><span className="gm-lab">{label}</span><div className="gm-body wrap">{node}</div></div>
  );
  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button key={label} type="button" className={`um-chip ${on ? "on" : ""}`} onClick={onClick}>{label}</button>
  );

  // 금액 칸 하나 — 숫자 + 단위, 옆에 읽은 값
  const money = (txt: string, setTxt: (v: string) => void, unit: "억" | "만", extra?: React.ReactNode) => (<>
    <span className="ad-num"><input className="gm-in num" style={{ width: "8ch" }} value={txt}
      onChange={(e) => setTxt(e.target.value)} />{unit === "억" ? "억" : "만원"}</span>
    {txt.trim() && (() => {
      const v = parseAmount(txt, unit === "억" ? 1e8 : 1e4);
      return v ? <span className="ad-read num">{won(v)}원</span> : <span className="ad-read bad">금액을 읽지 못했습니다</span>;
    })()}
    {extra}
  </>);

  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="gm ad-form" onClick={(e) => e.stopPropagation()}>
        <div className="gm-title-fix">{live ? "광고 고치기" : "광고 올리기"}</div>
        {row("매물 유형", USE_TYPES.map((t) => chip(f.use_type === t, t, () => set({ use_type: t }))))}
        {row("중개유형", (["일반", "전속"] as const).map((t) => chip(f.brokerage === t, t, () => set({ brokerage: t }))))}
        {row("매매가", <>
          <span className="ad-num"><input className="gm-in num" style={{ width: "8ch" }} value={priceTxt} placeholder="예: 1.5"
            onChange={(e) => setPriceTxt(e.target.value)} />억</span>
          {/* 읽은 값을 바로 보인다 — 무엇으로 저장되는지 친 사람이 확인하게 */}
          {priceTxt.trim() && (() => {
            const v = parseAmount(priceTxt);
            return v ? <span className="ad-read num">{won(v)}원</span> : <span className="ad-read bad">금액을 읽지 못했습니다</span>;
          })()}
          {/* 가격 비공개 — 체크박스(대표 09-28). 켜면 카드에 「가격 비공개」 */}
          <label className="ad-chk"><input type="checkbox" checked={!f.price_open}
            onChange={(e) => set({ price_open: !e.target.checked })} />가격 비공개</label>
        </>)}
        {row("제목", <input className="gm-in" style={{ flex: 1 }} value={f.title ?? ""} maxLength={60}
          placeholder="예: 역세권 코너 근생 빌딩" onChange={(e) => set({ title: e.target.value })} />)}
        {row("설명", <textarea className="gm-in ad-body" value={f.body ?? ""} rows={5}
          onChange={(e) => set({ body: e.target.value })} />)}
        {row("사진", pics.length === 0
          ? <span className="dim">매물 사진이 없습니다 · 사진 탭에서 올리세요</span>
          : <div className="ad-pics">
              {pics.map((p) => {
                const i = pick.indexOf(p.id);
                return (
                  <button key={p.id} type="button" className={`ad-pic ${i >= 0 ? "on" : ""}`} onClick={() => togglePhoto(p.id)}>
                    <AuthImg src={`/api${p.url}`} />{i >= 0 && <b>{i + 1}</b>}
                  </button>
                );
              })}
            </div>)}
        {row("현 보증금", money(depTxt, setDepTxt, "억"))}
        {row("현 월세", money(rentTxt, setRentTxt, "만"))}
        {row("융자금", money(loanTxt, setLoanTxt, "억",
          <label className="ad-chk"><input type="checkbox" checked={!f.loan_open}
            onChange={(e) => set({ loan_open: !e.target.checked })} />표시 안 함</label>))}
        {row("입주가능일", <>
          {(["즉시입주", "협의", "날짜"] as const).map((t) =>
            chip(f.move_in === t, t, () => set({ move_in: f.move_in === t ? null : t })))}
          {f.move_in === "날짜" && <input type="date" className="gm-in num" value={f.move_in_on ?? ""}
            onChange={(e) => set({ move_in_on: e.target.value || null })} />}
        </>)}
        {row("연락처", <input className="gm-in num" value={f.contact_phone ?? ""} placeholder="010-0000-0000"
          onChange={(e) => set({ contact_phone: formatPhone(e.target.value) || null })} />)}
        {err && <div className="ad-err">{err}</div>}
        <div className="gm-foot">
          {!live && <button className="gm-ghost" disabled={busy} onClick={() => save(false)}>임시저장</button>}
          <span className="sp" />
          <button className="gm-ghost quiet" onClick={onClose}>취소</button>
          <button className="gm-save" disabled={busy} onClick={() => save(true)}>{busy ? "…" : live ? "저장" : "올리기"}</button>
        </div>
      </div>
    </div>
  ), document.body);
}
