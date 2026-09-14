import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  buyersApi, proposalsApi, salesApi, searchApi,
  type RecoCheck, type RecoBuyer, type RecoListing,
} from "../../shared/api/endpoints";
import { dongAddr, wonShort } from "../../shared/format";
import "./sales.css";

/** 담기 창 — **한 벌로 두 방향**(2026-08-20).
 *
 *  매수자 화면에서 열면 매물이, 매물 화면에서 열면 매수자가 채워진다. 담는 일은 어느 쪽에서
 *  시작하든 같은 행동(제안 한 줄)이라 창도 하나다.
 *
 *  대상은 **전 서울**이지만, 처음 보이는 건 내가 가진 것이다 — 중개인이 먼저 떠올리는 건
 *  자기 매물·자기 손님이고, 모르는 물건은 검색으로 찾아 들어온다.
 *
 *  **목록은 하나다**(2026-08-20). 「추천」과 「내 것」을 탭으로 갈라 뒀더니 같은 명단이 다른
 *  순서로 두 번 섰다. 하나로 두고 **추천순으로 줄 세운다** — 내 것에는 표식이 붙고,
 *  조건 밖이라 점수를 모르는 내 매물은 끝에 붙는다.
 *  검색창을 비우면 이 목록, 두 글자 이상 치면 전 서울에서 찾는다(매물 방향).
 */
type Mode = "listing" | "buyer";

/** 근거 — 맞으면 축 이름만, 어긋나면 **무엇이 어긋났는지**.
 *  고르는 쪽이 매물이면 그 매물의 값(148억)을, 매수자면 그 사람이 원하는 값(150~250억)을
 *  보여준다 — 고정된 쪽 값을 되풀이해도 판단에 아무 도움이 안 된다. */
function Checks({ items, show }: { items: RecoCheck[]; show: "got" | "want" }) {
  if (!items.length) return null;
  return (
    <span className="pk-why">
      {items.slice(0, 4).map((c) => (
        <em key={c.label} className={c.ok ? "ok" : ""}>
          {c.label} {c.ok ? "○" : (show === "got" ? c.got : `${c.want} 원함`)}</em>
      ))}
    </span>
  );
}

export function PickModal({ mode, buyerId, buildingPk, title, onClose, onAdded }: {
  mode: Mode;
  /** mode=listing 이면 이 매수자에게 담는다 */
  buyerId?: number;
  /** mode=buyer 면 이 매물에 담는다 */
  buildingPk?: string;
  title: string;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const reco = useQuery({
    queryKey: ["reco", mode, String(buyerId ?? buildingPk)],
    queryFn: async (): Promise<{ needs_condition?: boolean; items: (RecoListing | RecoBuyer)[] }> =>
      (mode === "listing" ? buyersApi.recommend(buyerId!, 40)
        : buyersApi.recommendBuyers(buildingPk!, 300)),   // 매수자는 **명단 전부**가 한 목록이다
  });
  const sellers = useQuery({ queryKey: ["sellers"], queryFn: () => salesApi.sellers(),
    enabled: mode === "listing" });
  // 전 서울 찾기 — 두 글자부터. 검색어가 있으면 이 결과가 목록을 대신한다.
  const finding = mode === "listing" && q.trim().length >= 2;
  const hits = useQuery({
    queryKey: ["pick-find", q],
    queryFn: () => searchApi.suggest(q.trim()),
    enabled: finding,
  });
  // 이미 담긴 것 — 목록에 두되 못 고르게 한다(없으면 「왜 안 보이지」가 된다)
  const taken = useMemo(() => new Set(
    ((reco.data?.items ?? []) as { taken?: boolean; building_pk?: string; id?: number }[])
      .filter((x) => x.taken).map((x) => String(x.building_pk ?? x.id))), [reco.data]);

  type Row = { key: string; label: string; sub?: string; checks?: RecoCheck[];
               mine?: boolean; taken?: boolean };
  // 주소를 누르면 그 건물 상세로 — **새 탭**이다(2026-08-20). 같은 탭에서 넘어가면
  // 고르던 것이 통째로 날아간다. 담기는 하던 자리에 그대로 두고, 확인만 옆에서 한다.
  const openDetail = (pk: string) => window.open(`/buildings/${pk}`, "_blank", "noopener");
  const rows: Row[] = (() => {
    if (mode === "buyer") {
      // 명단은 하나 — 추천 응답이 이미 **전원**을 점수순으로 낸다(조건 없는 사람은 뒤로)
      return (reco.data?.items ?? []).map((x) => {
        const r = x as RecoBuyer;
        return { key: String(r.id), label: r.name,
          sub: r.has_condition ? undefined : "조건 없음",
          checks: r.checks, taken: r.taken };
      }).filter((r) => !q.trim() || r.label.includes(q.trim()));
    }
    if (finding) {
      return (hits.data ?? []).filter((x) => x.kind === "building" && x.building_pk)
        .slice(0, 20)
        .map((x) => ({ key: x.building_pk!, label: dongAddr(x.addr), taken: taken.has(x.building_pk!) }));
    }
    const reco_ = (reco.data?.items ?? []).map((x) => {
      const r = x as RecoListing;
      return { key: r.building_pk, label: dongAddr(r.addr) || r.building_pk,
        sub: [r.price ? wonShort(r.price) : null,
              r.roi != null ? `수익 ${r.roi}%` : null].filter(Boolean).join(" · "),
        checks: r.checks, mine: r.mine, taken: r.taken };
    });
    // 조건 밖이라 점수를 못 매긴 내 매물 — 목록에서 빼면 「내 매물이 왜 없지」가 된다.
    // 추천 아래에 그대로 붙인다(순서는 추천이 먼저, 내 것이 뒤).
    const seen = new Set(reco_.map((r) => r.key));
    const mine = (sellers.data ?? [])
      // 팔린 매물은 담기 목록에도 안 선다(2026-08-20) — 추천에서 뺐으면 여기서도 빼야 한다
      .filter((x) => !seen.has(x.building_pk) && !x.s6_match)
      .map((x) => ({ key: x.building_pk, label: dongAddr(x.addr) || x.building_pk,
        sub: [x.owner_name, x.list_price ? wonShort(x.list_price) : null].filter(Boolean).join(" · "),
        mine: true, taken: taken.has(x.building_pk) }));
    return [...reco_, ...mine];
  })();

  const toggle = (k: string) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const add = async () => {
    if (!sel.length || busy) return;
    setBusy(true);
    try {
      for (const k of sel) {
        await proposalsApi.upsert(mode === "listing"
          ? { buyer_id: buyerId!, building_pk: k }
          : { buyer_id: Number(k), building_pk: buildingPk! });
      }
      setSel([]);
      onAdded();
      onClose();
    } finally { setBusy(false); }
  };

  const needsCond = mode === "listing" && reco.data?.needs_condition;

  // 조건이 없으면 추천이 못 선다 — 그 자리에서 **예산과 지역**만 받는다(2026-08-20).
  // 자세한 조건은 지도에서 잡는 게 정본이지만, 새 손님을 받아 적는 자리에서 그 두 줄이
  // 없으면 「조건 없는 매수자」가 그대로 쌓인다.
  const regions = useQuery({ queryKey: ["regions"], queryFn: searchApi.regions, enabled: !!needsCond });
  const [lo, setLo] = useState(""); const [hi, setHi] = useState("");
  const [gu, setGu] = useState<{ code: string; name: string } | null>(null);
  const saveCond = async () => {
    if (busy || !buyerId) return;
    const f: Record<string, unknown> = {};
    if (lo.trim()) f.price_min = Math.round(Number(lo) * 1e8);
    if (hi.trim()) f.price_max = Math.round(Number(hi) * 1e8);
    if (gu) f.bjd_code = gu.code;
    if (!Object.keys(f).length) return;
    setBusy(true);
    try {
      await buyersApi.addCondition(buyerId, gu ? `${gu.name} ${lo || ""}~${hi || ""}억` : "예산", {
        filters: f, regions: gu ? [{ bjd_code: gu.code, label: `${gu.name} 전체` }] : [],
      });
      await reco.refetch();
    } finally { setBusy(false); }
  };
  const loading = reco.isLoading || sellers.isLoading;

  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="gm gm-wide" onClick={(e) => e.stopPropagation()}>
        <div className="gm-title-fix gm-title-row">
          {title}
          <span className="gm-fill">{sel.length ? `${sel.length}건 고름` : ""}</span>
        </div>

        {/* 검색 pill 하나 — 비우면 추천순 목록, 치면 찾기(매물은 전 서울, 매수자는 명단 안) */}
        <div className="pk-find">
          <input className="pk-q" value={q} autoFocus placeholder={
            mode === "listing" ? "주소로 찾기" : "이름으로 찾기"}
            onChange={(e) => setQ(e.target.value)} />
        </div>

        <div className="pk-list">
          {needsCond && !finding && (<>
            <span className="pk-none">조건을 먼저 채우세요 — 무엇을 원하는지 모르면 추천할 수 없습니다.</span>
            <div className="pk-cond">
              <span className="lab">예산</span>
              <input className="pk-n num" value={lo} placeholder="80"
                onChange={(e) => setLo(e.target.value)} />
              <span className="tilde">~</span>
              <input className="pk-n num" value={hi} placeholder="120"
                onChange={(e) => setHi(e.target.value)} />
              <span className="unit">억</span>
              <button className="gm-ghost" disabled={busy || (!lo && !hi && !gu)} onClick={saveCond}>
                {busy ? "…" : "조건 저장"}</button>
            </div>
            <div className="pk-gus">
              {Object.entries(regions.data ?? {}).map(([name, v]) => (
                <button key={name} className={`chip ${gu?.name === name ? "on" : ""}`}
                  onClick={() => setGu(gu?.name === name ? null : { code: v.sgg_code, name })}>
                  {name}</button>
              ))}
            </div>
          </>)}
          {!needsCond && rows.map((r) => (
            <div key={r.key} role="button" tabIndex={r.taken ? -1 : 0}
              className={`pk-row ${sel.includes(r.key) ? "on" : ""} ${r.taken ? "off" : ""}`}
              onClick={() => !r.taken && toggle(r.key)}
              onKeyDown={(e) => { if (!r.taken && (e.key === "Enter" || e.key === " ")) {
                e.preventDefault(); toggle(r.key); } }}>
              <i className="ck">{sel.includes(r.key) ? "✓" : ""}</i>
              <span className="nm">
                {mode === "listing" ? (
                  <button className="go" title="건물 상세 보기(새 탭)"
                    onClick={(e) => { e.stopPropagation(); openDetail(r.key); }}>{r.label}</button>
                ) : r.label}
                {r.mine && <em className="mine">내 매물</em>}
                {r.taken && <em className="was">담김</em>}
              </span>
              {r.sub && <span className="sub num">{r.sub}</span>}
              {r.checks && <Checks items={r.checks} show={mode === "listing" ? "got" : "want"} />}
            </div>
          ))}
          {!needsCond && rows.length === 0 && (
            <span className="pk-none">
              {loading || hits.isLoading ? "찾는 중…" : "찾는 것이 없습니다"}
            </span>
          )}
        </div>

        <div className="gm-foot">
          <span className="sp" />
          <button className="gm-ghost" disabled={!sel.length || busy} onClick={add}>
            {busy ? "담는 중…" : sel.length ? `${sel.length}건 담기` : "담기"}</button>
          <button className="gm-ghost quiet" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  ), document.body);
}
