import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { buildingsApi, overlaysApi, parcelsApi } from "../../../shared/api/endpoints";
import { useEnums } from "../../../shared/hooks/useEnums";
import { useUnit } from "../../../shared/hooks/useUnit";
import { Icon } from "../../../shared/ui/Icon";

/** 건축물대장 탭(10-02) — 마스터(대장 · 토지대장) 값에 우리 팀 정정(오버레이)을 붙인다. 칸 전부.
 *  값을 누르면 그 자리에서 고친다. 고친 칸은 파란 값 + 회색 「대장 N」, ↺ 로 대장값으로 되돌린다.
 *  정정은 팀 안에서만 보인다 — 상세보기(공개)는 늘 대장 원본(raw)이다.
 *  모르는 값은 빈칸. 빈 값으로 저장하면 정정이 지워진다(빈 값은 지우기). */

type Kind = "area" | "int" | "num" | "date" | "text" | "enum";
type F = { f: string; l: string; k: Kind; unit?: string };

const BLD: F[] = [
  { f: "land_area", l: "대지면적", k: "area" }, { f: "total_area", l: "연면적", k: "area" },
  { f: "build_area", l: "건축면적", k: "area" }, { f: "far_area", l: "용적산정 연면적", k: "area" },
  { f: "floors_above", l: "지상 층수", k: "int", unit: "층" }, { f: "floors_below", l: "지하 층수", k: "int", unit: "층" },
  { f: "height", l: "높이", k: "num", unit: "m" },
  { f: "bcr", l: "건폐율", k: "num", unit: "%" }, { f: "far", l: "용적률", k: "num", unit: "%" },
  { f: "approval_ymd", l: "사용승인일", k: "date" }, { f: "remodel_ymd", l: "대수선 및 리모델링", k: "date" },
  { f: "main_use_name", l: "주용도", k: "text" }, { f: "etc_use", l: "기타용도", k: "text" },
  { f: "structure", l: "구조", k: "text" },
  { f: "parking", l: "주차", k: "int", unit: "대" }, { f: "elevator", l: "승강기", k: "int", unit: "대" },
];
const LAND: F[] = [
  { f: "area", l: "토지면적", k: "area" },
  { f: "jimok", l: "지목", k: "enum" }, { f: "use_zone", l: "용도지역", k: "text" },
  { f: "land_use", l: "토지이용상황", k: "text" }, { f: "shape", l: "지형/형상", k: "enum" },
  { f: "slope", l: "지세", k: "enum" }, { f: "road_frontage", l: "도로접면", k: "enum" },
];

type Parcel = Record<string, unknown> & { pnu: string; label?: string; _edited?: string[]; _master?: Record<string, unknown> };

export function LedgerTab({ pk, pnu }: { pk: string | null; pnu: string }) {
  const qc = useQueryClient();
  const { options } = useEnums();
  const { unit, area } = useUnit();
  const per = unit === "py" ? 3.305785 : 1;
  const bq = useQuery({ queryKey: ["building", pk], queryFn: () => buildingsApi.get(pk!), enabled: !!pk });
  // 필지는 지번 단위(10-08) — 매물 지번에 딸린 필지. 팀 정정을 섞은 값
  const pnuOf: string | null = pnu;
  const pq = useQuery({ queryKey: ["lands", pnuOf], queryFn: () => parcelsApi.lands(pnuOf!), enabled: !!pnuOf });
  const [pIdx, setPIdx] = useState(0);
  const [edit, setEdit] = useState<string | null>(null);
  const [txt, setTxt] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const b = (bq.data ?? {}) as Record<string, unknown>;
  const bEdited = (b._edited as string[] | undefined) ?? [];
  const bMaster = (b._master as Record<string, unknown> | undefined) ?? {};
  const parcels = (((pq.data ?? {}) as { parcels?: Parcel[] }).parcels ?? []);
  const p = parcels[Math.min(pIdx, Math.max(parcels.length - 1, 0))];

  /** 화면 글자 — 면적은 앱 단위, 날짜는 점 */
  const show = (fd: F, v: unknown): string => {
    if (v == null || v === "") return "";
    if (fd.k === "area") return area(Number(v), 1);
    if (fd.k === "date") return String(v).slice(0, 10).replace(/-/g, ".");
    if (fd.k === "num") return `${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}${fd.unit ?? ""}`;
    if (fd.k === "int") return `${Number(v).toLocaleString()}${fd.unit ?? ""}`;
    return String(v);
  };
  /** 고치는 칸에 처음 넣을 글자 — 면적은 앱 단위 값 */
  const seed = (fd: F, v: unknown) => {
    if (v == null || v === "") return "";
    if (fd.k === "area") return String(Math.round((Number(v) / per) * 10) / 10);
    if (fd.k === "date") return String(v).slice(0, 10);
    return String(v);
  };
  /** 저장할 값 — 면적은 ㎡ 로 되돌린다. 숫자 칸에 숫자가 아니면 막는다 */
  const toStore = (fd: F, t: string): string | null | "bad" => {
    const s = t.trim();
    if (!s) return null;
    if (fd.k === "area" || fd.k === "num") { const x = Number(s.replace(/,/g, "")); return Number.isFinite(x) ? String(fd.k === "area" ? Math.round(x * per * 100) / 100 : x) : "bad"; }
    if (fd.k === "int") { const x = Number(s.replace(/,/g, "")); return Number.isInteger(x) ? String(x) : "bad"; }
    if (fd.k === "date") return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "bad";
    return s;
  };

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["building", pk] }); qc.invalidateQueries({ queryKey: ["lands", pnu] });
    qc.invalidateQueries({ queryKey: ["sellers"] });
  };
  const save = async (target: "building" | "parcel", id: string, fd: F, t: string, master: unknown) => {
    setEdit(null);
    const v = toStore(fd, t);
    if (v === "bad") { setErr(`${fd.l} — 형식이 맞지 않습니다`); return; }
    setErr(null);
    // 빈 값이거나 대장값과 같으면 정정을 지운다 — 같은 값을 정정으로 남기면 「고친 칸」이 거짓으로 선다
    const same = v != null && master != null && String(master) === v;
    try {
      if (v == null || same) await overlaysApi.revert(id, fd.f, target);
      else await overlaysApi.put(id, fd.f, v, target);
    } catch (e) { setErr((e as Error).message); }
    refresh();
  };
  const revert = async (target: "building" | "parcel", id: string, f: string) => {
    await overlaysApi.revert(id, f, target); refresh();
  };

  const line = (target: "building" | "parcel", id: string, fd: F, cur: unknown, edited: boolean, master: unknown) => {
    const key = `${target}:${id}:${fd.f}`;
    const open = edit === key;
    return (
      <div key={key} className={`lgx-r ${edited ? "ed" : ""} ${open ? "open" : ""}`}>
        <span className="lgx-k">{fd.l}</span>
        <div className={`lgx-v ${fd.k === "enum" ? "lgx-opt" : ""}`} onClick={() => { if (!open && fd.k !== "enum") { setEdit(key); setTxt(seed(fd, cur)); } }}>
          {fd.k === "enum" ? (
            /* 사전 값 칸 — 선택지가 줄 안에 칸으로 늘 깔린다(탐색 「매물 유형」 줄과 같은 모양) */
            <span className="opt-v" onClick={(e) => e.stopPropagation()}>
              {options(fd.f).map((o) => (
                <button key={o.code} className={String(cur ?? "") === o.code ? "on" : ""}
                  onClick={() => save(target, id, fd, String(cur ?? "") === o.code ? "" : o.code, master)}>{o.label}</button>
              ))}
            </span>
          ) : open ? (
            <input autoFocus className="lgx-in" value={txt} type={fd.k === "date" ? "date" : "text"}
              inputMode={fd.k === "text" || fd.k === "date" ? undefined : "decimal"}
              onChange={(e) => setTxt(e.target.value)}
              onBlur={() => save(target, id, fd, txt, master)}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEdit(null); }} />
          ) : <b>{show(fd, cur)}</b>}
          {open && fd.k === "area" && <i className="lgx-u">{unit === "py" ? "평" : "㎡"}</i>}
        </div>
        <span className="lgx-m">{edited && <>대장 {show(fd, master) || "없음"}</>}</span>
        <span className="lgx-a">{edited && (
          <button title="대장값으로" onClick={() => revert(target, id, fd.f)}><Icon name="reset" size={13} /></button>)}</span>
      </div>
    );
  };

  if (bq.isLoading) return null;
  return (
    <div className="lgx">
      {err && <div className="lgx-err">{err}</div>}
      {pk && <>   {/* 동이 없는 지번(나대지)은 토지대장만 */}
        <div className="lgx-h">건물 · 건축물대장</div>
        {BLD.map((fd) => line("building", pk, fd, b[fd.f], bEdited.includes(fd.f), bMaster[fd.f]))}
      </>}
      <div className="lgx-h">토지 · 토지대장
        {parcels.length > 1 && (
          <span className="lgx-pc">{parcels.map((x, i) => (
            <button key={x.pnu} className={i === pIdx ? "on" : ""} onClick={() => setPIdx(i)}>{x.label ?? x.pnu}</button>
          ))}</span>
        )}
      </div>
      {p ? LAND.map((fd) => line("parcel", p.pnu, fd, p[fd.f], (p._edited ?? []).includes(fd.f), (p._master ?? {})[fd.f]))
        : <div className="lgx-none">필지 정보 없음</div>}
    </div>
  );
}
