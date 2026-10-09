import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { adsApi, authApi, buildingsApi, listingsApi, officeApi, parcelsApi, photosApi, type AdForm, type MyAd, type UseType } from "../../../shared/api/endpoints";
import { parseAmount, seedAmount, formatPhone } from "../../building/KV";
import { won, wonAcc } from "../../../shared/format";
import { AuthImg } from "../../../shared/ui/AuthImg";
import { useUnit } from "../../../shared/hooks/useUnit";
import { ListingCard } from "../../search/ListingCard";
import { Fold } from "../../search/SideDetail";
import "../../search/search.css";

/** 광고 편집(10-02) — 모달 없이 탭 안에서: 왼쪽 폼, 오른쪽 미리보기(매물 찾기 사이드바 그 화면).
 *  치는 대로 미리보기가 바뀐다. 미리보기의 「문의하기」 · 버튼은 화면만이고 움직이지 않는다.
 *  필수: 매물 유형 · 매매가 · 제목 · 설명 · 사진 3장(올리기 때만). 임시저장은 다 안 채워도 된다. */

const USE_TYPES: UseType[] = ["상업용건물", "상가/사무실", "단독/다가구", "연립/다세대", "오피스텔", "토지", "공장/창고", "숙박시설", "기타건물"];

export function AdEditor({ lid, pnu, base, ad, onDone }: {
  lid: number; pnu: string; base: AdForm; ad: MyAd | null; onDone: () => void;
}) {
  const qc = useQueryClient();
  const photos = useQuery({ queryKey: ["photos", lid], queryFn: () => photosApi.list(lid) });
  /** 매물 값(0209) — 매물 유형 · 중개 · 융자금 · 입주가능일은 매물 줄이 정본. 고치면 매물에 바로 저장 */
  const putListing = async (fields: Record<string, string | boolean | null>) => {
    await listingsApi.patchBiz(lid, fields);
    qc.invalidateQueries({ queryKey: ["sellers"] }); qc.invalidateQueries({ queryKey: ["pAds", pnu] });
  };
  const [f, setF] = useState<AdForm>({ ...base, contact_phone: base.contact_phone ? formatPhone(base.contact_phone) : null });
  const [pick, setPick] = useState<number[]>(ad?.photo_ids ?? []);
  const [priceTxt, setPriceTxt] = useState(seedAmount(base.price));
  const [loanTxt, setLoanTxt] = useState(seedAmount(base.loan));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<AdForm>) => setF((v) => ({ ...v, ...p }));
  const togglePhoto = (id: number) => setPick((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  const pics = (photos.data ?? []).filter((p) => p.kind === "exterior" || p.kind === "interior" || p.kind === "etc");
  const live = ad && (ad.state === "노출" || ad.state === "비노출");

  const price = parseAmount(priceTxt);
  // 보증금 · 월세는 임대내역 합계(매물 값) 그대로 — 폼에서 고치지 않는다
  const deposit = base.deposit, monthly = base.monthly_rent, loan = parseAmount(loanTxt);

  // 자동저장(10-02) — 아직 안 올린 광고는 치는 대로 잠깐 뒤 임시로 저장된다(「임시저장」 단추 없음).
  // 노출 중인 광고는 자동저장하지 않는다 — 손님이 보는 광고가 치는 도중의 글자로 바뀌면 안 된다
  const [adId, setAdId] = useState<number | null>(ad?.id ?? null);
  const body = (publish: boolean) => ({ ...f, price, photo_ids: pick, publish, deposit, monthly_rent: monthly, loan,
    move_in_on: f.move_in === "날짜" ? f.move_in_on : null });
  // 마지막으로 저장된 모양 — 처음 연 모양과 같으면 저장하지 않는다(열기만 해도 빈 임시 광고가 생기던 것)
  const snap = JSON.stringify(body(false));
  const saved = useRef(snap);
  const initSnap = useRef(snap);   // 처음 연 모양 — 초기화하면 여기로
  useEffect(() => {
    if (live || snap === saved.current) return;
    const t = setTimeout(async () => {
      try {
        if (adId != null) await adsApi.update(adId, body(false));
        else { const r = await adsApi.create(lid, body(false)); setAdId(r.id); }
        saved.current = snap;
      } catch { /* 다음 입력 때 다시 */ }
    }, 800);
    return () => clearTimeout(t);
  }, [snap]);   // eslint-disable-line react-hooks/exhaustive-deps

  /** 초기화 — 작성 중인 광고를 지우고 처음 폼으로 */
  const reset = async () => {
    if (!confirm("작성 중인 광고를 지우고 처음부터 씁니다.")) return;
    setBusy(true);
    try {
      if (adId != null) await adsApi.state(adId, "삭제");
      // 폼도 처음으로 — 같은 「새 광고」 자리라 부품이 다시 안 그려진다
      setF({ ...base, contact_phone: base.contact_phone ? formatPhone(base.contact_phone) : null });
      setPick([]); setPriceTxt(seedAmount(base.price));
      setLoanTxt(seedAmount(base.loan));
      setAdId(null); setErr(null); saved.current = initSnap.current;
      onDone();
    } finally { setBusy(false); }
  };

  const save = async (publish: boolean) => {
    if (publish) {
      const miss = [!f.use_type && "매물 유형", !price && "매매가", !(f.title ?? "").trim() && "제목",
        !(f.body ?? "").trim() && "설명", pick.length < 3 && "사진 3장"].filter(Boolean);
      if (miss.length) { setErr(`${miss.join(" · ")}이(가) 필요합니다`); return; }
    }
    setBusy(true); setErr(null);
    try {
      const id = adId ?? ad?.id ?? null;
      if (id != null) await adsApi.update(id, body(publish)); else await adsApi.create(lid, body(publish));
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  // 필수 칸 = 라벨 옆 빨간 *(올리기 때 확인하는 다섯 칸)
  const row = (label: string, node: React.ReactNode, req = false) => (
    <div className="adf-r"><span className="adf-k">{label}{req && <i className="adf-req">*</i>}</span><div className="adf-v">{node}</div></div>
  );
  const cell = (on: boolean, label: string, onClick: () => void) =>
    <button key={label} type="button" className={on ? "on" : ""} onClick={onClick}>{label}</button>;
  const read = (txt: string, v: number | null) => (txt.trim() ? (v ? <span className="adf-read">{won(v)}원</span> : <span className="adf-read bad">금액을 읽지 못했습니다</span>) : null);

  return (
    <div className="adx">
      <div className="adx-form">
        {row("매물 유형", <span className="adf-cells">{USE_TYPES.map((t) => cell(f.use_type === t, t, () => { const v = f.use_type === t ? null : t; set({ use_type: v }); putListing({ building_major: v }); }))}</span>, true)}
        {row("중개", <span className="adf-cells">{(["일반", "전속"] as const).map((t) => cell(f.brokerage === t, t, () => { set({ brokerage: t }); putListing({ exclusive: t === "전속" }); }))}</span>)}
        {row("매매가", <>
          <input className="adf-in num" value={priceTxt} placeholder="1.5" onChange={(e) => setPriceTxt(e.target.value)} /><i className="adf-u">억</i>
          {read(priceTxt, price)}
          <span className="adf-cells sm">{cell(!f.price_open, "가격 비공개", () => set({ price_open: !f.price_open }))}</span>
        </>, true)}
        {row("제목", <input className="adf-in wide" value={f.title ?? ""} maxLength={60} onChange={(e) => set({ title: e.target.value })} />, true)}
        {row("설명", <textarea className="adf-in wide" rows={4} value={f.body ?? ""} onChange={(e) => set({ body: e.target.value })} />, true)}
        {row("사진", pics.length === 0
          ? <span className="adf-none">매물 사진 없음</span>
          : <div className="adf-pics">{pics.map((p) => {
              const i = pick.indexOf(p.id);
              return (
                <button key={p.id} type="button" className={i >= 0 ? "on" : ""} onClick={() => togglePhoto(p.id)}>
                  <AuthImg src={`/api${p.url}`} />{i >= 0 && <b>{i + 1}</b>}
                </button>
              );
            })}</div>, true)}
        {/* 현 보증금 · 월세 = 임대내역 엑셀 합계(읽기만). 고치려면 임대내역에서 */}
        {row("현 보증금", <b className="adf-ro">{base.deposit != null ? `${won(base.deposit)}원` : ""}</b>)}
        {row("현 월세", <b className="adf-ro">{base.monthly_rent != null ? `${won(base.monthly_rent)}원` : ""}</b>)}
        {row("융자금", <>
          <input className="adf-in num" value={loanTxt} onChange={(e) => setLoanTxt(e.target.value)}
            onBlur={() => putListing({ loan: loan != null ? String(loan) : null })} /><i className="adf-u">억</i>{read(loanTxt, loan)}
          <span className="adf-cells sm">{cell(!f.loan_open, "표시 안 함", () => { set({ loan_open: !f.loan_open }); putListing({ loan_open: !f.loan_open }); })}</span>
        </>)}
        {row("입주가능일", <>
          <span className="adf-cells">{(["즉시입주", "협의", "날짜"] as const).map((t) => cell(f.move_in === t, t, () => {
            const v = f.move_in === t ? null : t; set({ move_in: v }); putListing({ move_in: v, ...(v !== "날짜" ? { move_in_on: null } : {}) });
          }))}</span>
          {f.move_in === "날짜" && <input type="date" className="adf-in num" value={f.move_in_on ?? ""}
            onChange={(e) => { set({ move_in_on: e.target.value || null }); putListing({ move_in_on: e.target.value || null }); }} />}
        </>)}
        {row("연락처", <input className="adf-in num" value={f.contact_phone ?? ""} placeholder="010-0000-0000"
          onChange={(e) => set({ contact_phone: formatPhone(e.target.value) || null })} />)}
        {err && <div className="adf-err">{err}</div>}
        <div className="adf-foot">
          {!live && <button className="ghost" disabled={busy} onClick={reset}>초기화</button>}
          <button className="go" disabled={busy} onClick={() => save(true)}>{busy ? "…" : live ? "저장" : "광고 올리기"}</button>
        </div>
      </div>
      <AdPreview lid={lid} pnu={pnu} f={f} pick={pick} price={price} deposit={deposit} monthly={monthly} loan={loan} />
    </div>
  );
}

/** 미리보기 — 매물 찾기 사이드바와 같은 모양(사진 · 제목 · 설명 · 기본정보 · 건축물대장 · 중개사무소 정보 · 아래 고정 카드).
 *  누를 수 있는 것은 없다 */
function AdPreview({ lid, pnu, f, pick, price, deposit, monthly, loan }: {
  lid: number; pnu: string; f: AdForm; pick: number[]; price: number | null; deposit: number | null; monthly: number | null; loan: number | null;
}) {
  // 실제 사이드바(SideDetail)와 같은 자료 — 지번 값 + 대표 동의 대장 원본
  const pq = useQuery({ queryKey: ["parcel", pnu], queryFn: () => parcelsApi.get(pnu) });
  const rep = (pq.data?.rep_pk as string | null | undefined) ?? null;
  const b = useQuery({ queryKey: ["building-raw", rep], queryFn: () => buildingsApi.get(rep!, true), enabled: !!rep });
  const photos = useQuery({ queryKey: ["photos", lid], queryFn: () => photosApi.list(lid) });
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const office = useQuery({ queryKey: ["office"], queryFn: officeApi.get });
  const { area } = useUnit();
  const [i, setI] = useState(0);
  const d = (b.data ?? {}) as Record<string, unknown>;
  const n = (k: string) => (d[k] != null && d[k] !== "" ? Number(d[k]) : null);
  const s = (k: string) => (d[k] != null && d[k] !== "" ? String(d[k]) : null);
  const urls = pick.map((id) => (photos.data ?? []).find((p) => p.id === id)?.url).filter(Boolean) as string[];
  const k = urls.length ? Math.min(i, urls.length - 1) : 0;
  // 실제 사이드바와 같은 줄 — 늘 서고, 모르면 값 칸만 빈칸
  const row = (l: string, v: string | null | undefined) => <div key={l} className="dc-row"><span>{l}</span><b>{v ?? ""}</b></div>;
  const fa = n("floors_above"), fb = n("floors_below"), bcr = n("bcr"), far = n("far"), approval = s("approval_ymd");
  const addr = String(pq.data?.addr ?? s("addr") ?? "").replace("서울특별시 ", "").replace("번지", "");   // 지번 주소(나대지도)
  const o = office.data;
  const phone = f.contact_phone || o?.phone || null;
  return (
    <div className="adx-pv">
      <div className="adx-pvh">미리보기</div>
      <div className="sd dc adx-sd">
        <div className="sd-body dc-body">
          {urls.length > 0 && (
            <div className="sd-gal dc-gal">
              <AuthImg className="sd-gal-img" src={`/api${urls[k]}`} />
              {urls.length > 1 && <>
                <button className="adf-nav l" onClick={() => setI((k - 1 + urls.length) % urls.length)}>‹</button>
                <button className="adf-nav r" onClick={() => setI((k + 1) % urls.length)}>›</button>
                <span className="adf-cnt num">{k + 1} / {urls.length}</span>
              </>}
            </div>
          )}
          {(f.title || f.body || f.use_type) && (
            <div className="dc-intro">
              {(f.use_type || f.brokerage === "전속") && (
                <div className="dc-tag">{[f.use_type && `#${f.use_type}`, f.brokerage === "전속" && "전속"].filter(Boolean).join(" · ")}</div>
              )}
              {f.title && <h2>{f.title}</h2>}{f.body && <p>{f.body}</p>}
            </div>
          )}
          <div className="dc-gap" />
          <Fold title="기본/건물정보" open>
            <h5>기본정보</h5>
            {row("현 보증금", deposit != null ? `${won(deposit)}원` : null)}
            {row("현 월세", monthly != null ? `${won(monthly)}원` : null)}
            {row("융자금", !f.loan_open ? "표시 안 함" : loan != null ? `${won(loan)}원` : null)}
            {row("입주가능일", f.move_in === "날짜" ? (f.move_in_on ?? "").replace(/-/g, ".") : f.move_in)}
            <hr /><h5>건물정보</h5>
            {row("주용도", s("main_use_name"))}
            {row("용도지역", s("use_zone"))}
            {row("건폐율 / 용적률", bcr != null || far != null ? `${bcr != null ? `${bcr.toFixed(2)}%` : ""} / ${far != null ? `${far.toFixed(2)}%` : ""}` : null)}
            {row("대지면적", n("land_area") != null ? area(n("land_area"), 0) : null)}
            {row("연면적", n("total_area") != null ? area(n("total_area"), 0) : null)}
            {row("지상 / 지하", fa != null ? `${fa}층 / ${fb ?? 0}층` : null)}
            {row("사용승인일", approval ? approval.slice(0, 10).replace(/-/g, ".") : null)}
            {row("주차", n("parking") != null ? `${n("parking")}대` : null)}
          </Fold>
          {/* 실제 사이드바처럼 — 실거래 · 층별 현황 · 교통은 접힌 채 */}
          <Fold title="실거래"><span /></Fold>
          <Fold title="층별 현황"><span /></Fold>
          <Fold title="교통"><span /></Fold>
          <div className="dc-sec flush"><button className="dc-detail" tabIndex={-1}>건축물대장</button></div>
          <div className="dc-gap" />
          <div className="dc-sec">
            <h4>중개사무소 정보</h4>
            <div className="dc-reg"><dl>
              <dt>등록번호</dt><dd className="num">{o?.reg_no ?? ""}</dd>
              <dt>소재지</dt><dd>{o?.office_addr ?? ""}</dd>
              <dt>대표</dt><dd>{o?.agent_name ?? ""}</dd>
              <dt>대표연락처</dt><dd className="num">{o?.phone ? formatPhone(o.phone) : ""}</dd>
            </dl></div>
          </div>
        </div>
        <div className="sd-dock">
          <ListingCard compact agent={me.data?.name ?? null} agentPhoto={me.data?.photo} rank={me.data?.job_title ?? null} office={o?.office_name ?? o?.name ?? null}
            when={phone ? formatPhone(phone) : ""} title={f.title || addr}
            kind="매매" price={!f.price_open ? "가격 비공개" : price != null ? wonAcc(price) : ""}
            photo={urls[0] ? `/api${urls[0]}` : null}
            action={<button className="sd-bar-ask" tabIndex={-1}>문의하기</button>} />
        </div>
      </div>
    </div>
  );
}
