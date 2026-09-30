import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  listingsApi, searchApi, authApi, buildingsApi,
} from "../../shared/api/endpoints";
import {dongAddr } from "../../shared/format";
import { useEnums } from "../../shared/hooks/useEnums";
import { Chips } from "../building/EnumField";
import { formatPhone } from "../building/KV";
import { Icon } from "../../shared/ui/Icon";
import "./sales.css";

/** 매물 창 — 소유자 찾기의 본진(2026-08-17 탭 개편).
 *
 *  왼쪽 인덱스 탭 둘:
 *    메모        — 찾기 기록 전부 + 한 줄 입력(엔터=초안, 커밋은 [저장]에서만 태어난다)
 *    소유자 프로필 — 이름·전화(강조 — 둘 다 차면 저절로 확보) + 나머지 + **멈춤**(못 찾는 이유)
 *
 *  담당자 칸은 없다 — 담은 사람이 담당자다(새 담기 때 자동으로 나).
 *  긴급도·매수의향도 없다 — 그건 의사 창(StagePane)의 것. 같은 필드가 두 창에 살면 어긋난다.
 */
export interface ListingInit {
  building_pk: string; addr: string | null;
  assignee_account_id: number | null; urgency: string | null; intent: string | null;
  /** 소유자 — 없으면 관심 매물이다 */
  owner_name?: string | null; owner_phone?: string | null; phone_masked?: boolean;
  owner_type?: string | null; relation?: string | null;
  cooperation?: string | null; kindness?: string | null;
  owner_age_band?: string | null; owner_gender?: string | null; owner_note?: string | null;
}

export function ListingModal({ init, preset, prefill, onClose, onSaved }: {
  /** 있으면 편집(그 매물) · 없으면 담기 */
  init?: ListingInit | null;
  /** 담기인데 건물이 이미 정해져 있다 — 건물 상세 「업무에서 관리」로 넘어온 경우(2026-09-26) */
  preset?: { pk: string } | null;
  /** 매도 문의를 고객등록할 때(S05) — 팔려는 건물 주소를 검색칸에, 문의한 사람을 소유자로 미리 채운다 */
  prefill?: { q?: string | null; name?: string | null; phone?: string | null } | null;
  onClose: () => void;
  onSaved: (pk: string) => void;
}) {
  const { options } = useEnums();
  const me = useQuery({ queryKey: ["me"], queryFn: authApi.me });
  const [pick, setPick] = useState<{ pk: string; addr: string } | null>(
    init ? { pk: init.building_pk, addr: init.addr ?? init.building_pk }
      : preset ? { pk: preset.pk, addr: preset.pk } : null);
  // 미리 정해진 건물의 주소 — 나대지는 pk 가 'P'+pnu 라 필지 API 가 안다
  const pre = useQuery({ enabled: !!preset, queryKey: ["building", preset?.pk],
    queryFn: () => (preset!.pk.startsWith("P") ? buildingsApi.vacant(preset!.pk.slice(1)) : buildingsApi.get(preset!.pk)) });
  useEffect(() => {
    const a = (pre.data as { addr?: string } | undefined)?.addr;
    if (preset && a) setPick({ pk: preset.pk, addr: a });
  }, [pre.data]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [q, setQ] = useState(prefill?.q ?? "");
  // 소유자 — 이 매물에 매칭되는 사람
  const [oName, setOName] = useState(init?.owner_name ?? prefill?.name ?? "");
  const [oPhone, setOPhone] = useState(init?.phone_masked ? "" : (init?.owner_phone ?? prefill?.phone ?? ""));
  const [oCorp, setOCorp] = useState(init?.owner_type === "법인");
  const [oRel, setORel] = useState<string | null>(init?.relation ?? null);
  const [oAge, setOAge] = useState<string | null>(init?.owner_age_band ?? null);
  const [oSex, setOSex] = useState<string | null>(init?.owner_gender ?? null);
  const [oCoop, setOCoop] = useState<string | null>(init?.cooperation ?? null);
  const [oKind, setOKind] = useState<string | null>(init?.kindness ?? null);
  const [oNote, setONote] = useState(init?.owner_note ?? "");
  const [busy, setBusy] = useState(false);

  // 소유자 찾기 상태 — 전부 파생(S04b §2.1).
  const t = q.trim();
  const sug = useQuery({ queryKey: ["suggest", t], enabled: !init && t.length >= 2,
    queryFn: () => searchApi.suggest(t) });
  const hits = (sug.data ?? []).filter((x) => x.kind === "building" && x.building_pk).slice(0, 6);

  const save = async () => {
    if (!pick || busy) return;
    setBusy(true);
    try {
      // 초안 기록 → 커밋. 멈춤 상태와 무관하게(멈춰 있어도 메모는 남긴다).
      // 되돌렸으면 그 시점 자리에 표식 줄을 세운다 — 그 뒤 초안만 다시 움직임으로 센다
      // 담은 사람이 담당자다 — 새 담기 때만 나로 선점(S02 §4.1). 편집은 담당을 건드리지 않는다
      if (!init && me.data?.account_id) {
        await listingsApi.claim(pick.pk, me.data.account_id);
      }
      const fields: Record<string, string | null> = {};
      // 이름을 넣었을 때만 사람을 만든다 — 빈 이름으로 만들면 「미지정」 유령이 생긴다
      if (oName.trim()) {
        Object.assign(fields, {
          owner_name: oName.trim(), owner_note: oNote || null,
          owner_type: oCorp ? "법인" : "개인", relation: oRel,
          cooperation: oCoop, kindness: oKind,
          owner_age_band: oAge, owner_gender: oSex,
        });
        // 마스킹된 번호를 그대로 저장하면 진짜 번호를 덮는다 — 손댔을 때만 보낸다
        if (!init?.phone_masked || oPhone) fields.owner_phone = oPhone || null;
      }
      if (Object.keys(fields).length) await listingsApi.patchBiz(pick.pk, fields);
      onSaved(pick.pk);
      onClose();
    } finally { setBusy(false); }
  };

  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="gm gm-wide" onClick={(e) => e.stopPropagation()}>
        {/* 대목 = 주소 */}
        {pick ? (
          <div className="gm-title-fix gm-title-row">
            {dongAddr(pick.addr)}
          </div>
        ) : (
          <div className="gm-find gm-title-find">
            <input className="gm-title" autoFocus value={q}
              onChange={(e) => setQ(e.target.value)} />
            {hits.length > 0 && (
              <span className="gm-hits">
                {hits.map((h) => (
                  <button key={h.building_pk} onMouseDown={(e) => {
                    e.preventDefault(); setPick({ pk: h.building_pk!, addr: h.addr }); setQ("");
                  }}><span className="gm-p owner">{dongAddr(h.addr)}</span></button>
                ))}
              </span>
            )}
          </div>
        )}

        {/* 왼쪽 인덱스 탭 — 지금 보는 탭이 크고 굵게, 몸통과 붙어 위로 떠 보인다 */}
        <div className="gm-tabs">

          <div className="gm-tabbody">
            <>
              <fieldset className="gm-fields">
              {/* 이름·전화 — 이 탭의 주인공. 아이콘이 칸의 정체를 말한다(placeholder 없음).
                  둘 다 차면 저절로 확보다(서버 전이) */}
              <div className="gm-bigrow">
                <Icon name="person" size={16} />
                <input className="gm-in gm-big" value={oName}
                  onChange={(e) => setOName(e.target.value)} />
              </div>
              <div className="gm-bigrow">
                <Icon name="phone" size={16} />
                {init?.phone_masked && !oPhone ? (
                  <div className="gm-txt dim2" style={{ padding: "6px 2px" }}>
                    담당자 본인·대표만 볼 수 있습니다</div>
                ) : (
                  <input className="gm-in gm-big num" inputMode="tel" value={oPhone}
                    onChange={(e) => setOPhone(formatPhone(e.target.value))} />
                )}
              </div>

              {/* 나머지 — 필드마다 한 줄씩, 라벨이 줄머리를 잡는다(한 줄에 두 축을 섞으면
                  칩 무더기가 돼 어느 칩이 어느 칸인지 안 읽힌다 · 2026-08-18) */}
              <div className="gm-row lab">
                <span className="gm-lab">구분</span>
                <div className="gm-body wrap np-chips">
                  <Chips mode="inline" opts={[{ code: "개인", label: "개인" }, { code: "법인", label: "법인" }]}
                    cur={oCorp ? "법인" : "개인"} onSelect={(v) => setOCorp(v === "법인")} />
                </div>
              </div>
              <div className="gm-row lab">
                <span className="gm-lab">관계</span>
                <div className="gm-body wrap np-chips">
                  <Chips mode="inline" opts={options("relation")} cur={oRel ?? "미지정"}
                    onSelect={(v) => setORel(v === "미지정" ? null : v)} />
                </div>
              </div>
              <div className="gm-row lab">
                <span className="gm-lab">나이</span>
                <div className="gm-body wrap np-chips">
                  <Chips mode="inline" opts={options("buyer_age")} cur={oAge ?? "미지정"}
                    onSelect={(v) => setOAge(v === "미지정" ? null : v)} />
                </div>
              </div>
              <div className="gm-row lab">
                <span className="gm-lab">성별</span>
                <div className="gm-body wrap np-chips">
                  <Chips mode="inline" opts={options("buyer_gender")} cur={oSex ?? "미지정"}
                    onSelect={(v) => setOSex(v === "미지정" ? null : v)} />
                </div>
              </div>
              <div className="gm-row lab">
                <span className="gm-lab">협조</span>
                <div className="gm-body wrap np-chips">
                  <Chips mode="inline" opts={options("cooperation")} cur={oCoop ?? "미지정"}
                    onSelect={(v) => setOCoop(v === "미지정" ? null : v)} />
                </div>
              </div>
              <div className="gm-row lab">
                <span className="gm-lab">응대</span>
                <div className="gm-body wrap np-chips">
                  <Chips mode="inline" opts={options("kindness")} cur={oKind ?? "미지정"}
                    onSelect={(v) => setOKind(v === "미지정" ? null : v)} />
                </div>
              </div>
              <div className="gm-row lab">
                <span className="gm-lab">메모</span>
                <div className="gm-body">
                  <input className="gm-in" value={oNote}
                    onChange={(e) => setONote(e.target.value)} />
                </div>
              </div>

              </fieldset>

            </>
          </div>
        </div>

        <div className="gm-foot">
          <span className="sp" />

          {/* 값은 닫을 때 매듭짓는다 — 창 바닥은 하나뿐이다(2026-08-20) */}
          <button className={init ? "gm-ghost quiet" : "gm-save"} disabled={!pick || busy} onClick={save}>
            {busy ? "…" : init ? "닫기" : "담기"}</button>
        </div>
      </div>
    </div>
  ), document.body);
}
