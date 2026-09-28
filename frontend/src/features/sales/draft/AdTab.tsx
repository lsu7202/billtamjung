import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adsApi, photosApi, type AdForm, type MyAd, type UseType } from "../../../shared/api/endpoints";
import { Icon } from "../../../shared/ui/Icon";
import { Segmented } from "../../../shared/ui/Segmented";
import { parseAmount } from "../../building/KV";
import { wonAcc } from "../../../shared/format";
import { AuthImg } from "../../../shared/ui/AuthImg";

/** 매물 모달 「광고」 탭(S05 §3 · 2묶음, 2026-09-28).
 *
 *  광고는 **자동으로 켜지지 않는다** — 광고 폼(모달)을 작성하고 「올리기」를 눌러야 노출된다.
 *  폼은 매물 · 대장 값으로 미리 채운다. 고친 값은 광고에만 남는다(매물은 그대로).
 *  기한은 올린 날 + 30일, 「연장」으로만 늘어난다(오늘 확인과 상관없다 — 대표 09-28). */

const USE_TYPES: UseType[] = ["빌딩", "상가주택", "공장·창고", "숙박", "기타"];
const PY = 3.305785;
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
        ) : (
          <div className={`ad-row ${ad.state === "거래완료" || ad.expired ? "done" : ""}`}>
            <div className="ad-main">
              <div className="ad-l1">
                <b className="num">{ad.price_open ? `매매 ${wonAcc(ad.price ?? 0)}` : "가격 문의"}</b>
                <span className="ad-tag">{ad.use_type}</span>
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
        {ad && !live && (
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
  const [f, setF] = useState<AdForm>({ ...base });
  const [pick, setPick] = useState<number[]>(ad?.photo_ids ?? []);
  const [priceTxt, setPriceTxt] = useState(base.price ? wonAcc(base.price) : "");   // 「9억 5,000만」 · 숫자만이면 만원
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<AdForm>) => setF((v) => ({ ...v, ...p }));
  const togglePhoto = (id: number) => setPick((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  const pics = (photos.data ?? []).filter((p) => p.kind === "exterior" || p.kind === "interior" || p.kind === "etc");

  const save = async () => {
    const price = parseAmount(priceTxt, 1e4);
    const miss = [!f.use_type && "매물 유형", !price && "매매가", !f.title.trim() && "제목", !f.body.trim() && "설명",
      pick.length < 3 && "사진 3장"].filter(Boolean);
    if (miss.length) { setErr(`${miss.join(" · ")}이(가) 필요합니다`); return; }
    setBusy(true); setErr(null);
    try {
      const body = { ...f, price, photo_ids: pick };
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
  const num = (v: number | null, cb: (n: number | null) => void, unit: string, w = 7) => (
    <span className="ad-num"><input className="gm-in num" style={{ width: `${w}ch` }} value={v ?? ""}
      onChange={(e) => { const x = parseFloat(e.target.value); cb(Number.isFinite(x) ? x : null); }} />{unit}</span>
  );

  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="gm ad-form" onClick={(e) => e.stopPropagation()}>
        <div className="gm-title-fix">{ad ? "광고 고치기" : "광고 올리기"}</div>
        {row("매물 유형", USE_TYPES.map((t) => chip(f.use_type === t, t, () => set({ use_type: t }))))}
        {row("중개유형", (["일반", "전속"] as const).map((t) => chip(f.brokerage === t, t, () => set({ brokerage: t }))))}
        {row("매매가", <>
          <input className="gm-in num" style={{ width: "13ch" }} value={priceTxt} placeholder="예: 9억 5,000만"
            onChange={(e) => setPriceTxt(e.target.value)} />
          <Segmented size="sm" value={f.price_open ? "공개" : "비공개"} onChange={(v) => set({ price_open: v === "공개" })}
            options={[{ value: "공개", label: "가격 공개" }, { value: "비공개", label: "비공개" }]} />
        </>)}
        {row("면적", <>
          <span className="dim">대지</span>{num(f.land_area != null ? Math.round(f.land_area / PY * 10) / 10 : null, (n) => set({ land_area: n != null ? n * PY : null }), "평")}
          <span className="dim">연면적</span>{num(f.total_area != null ? Math.round(f.total_area / PY * 10) / 10 : null, (n) => set({ total_area: n != null ? n * PY : null }), "평")}
        </>)}
        {row("층", <>
          <span className="dim">지상</span>{num(f.floors_above, (n) => set({ floors_above: n }), "층", 4)}
          <span className="dim">지하</span>{num(f.floors_below, (n) => set({ floors_below: n }), "층", 4)}
        </>)}
        {row("용도지역", <input className="gm-in" style={{ flex: 1 }} value={f.zoning ?? ""} onChange={(e) => set({ zoning: e.target.value || null })} />)}
        {row("사용승인", <input className="gm-in num" type="date" value={f.approved_on ?? ""} onChange={(e) => set({ approved_on: e.target.value || null })} />)}
        {row("위반건축물", ([["있음", true], ["없음", false]] as const).map(([l, v]) =>
          chip(f.violation === v, l, () => set({ violation: f.violation === v ? null : v }))))}
        {row("제목", <input className="gm-in" style={{ flex: 1 }} value={f.title} maxLength={60}
          placeholder="예: 역세권 코너 근생 빌딩" onChange={(e) => set({ title: e.target.value })} />)}
        {row("설명", <textarea className="gm-in ad-body" value={f.body} rows={5}
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
        {row("연락처", <input className="gm-in num" value={f.contact_phone ?? ""} onChange={(e) => set({ contact_phone: e.target.value || null })} />)}
        {row("위치", <Segmented size="sm" value={f.address_open ? "공개" : "비공개"} onChange={(v) => set({ address_open: v === "공개" })}
          options={[{ value: "공개", label: "지번까지" }, { value: "비공개", label: "동까지만" }]} />)}
        {err && <div className="ad-err">{err}</div>}
        <div className="gm-foot">
          <span className="sp" />
          <button className="gm-ghost quiet" onClick={onClose}>취소</button>
          <button className="gm-save" disabled={busy} onClick={save}>{busy ? "…" : ad ? "저장" : "올리기"}</button>
        </div>
      </div>
    </div>
  ), document.body);
}
