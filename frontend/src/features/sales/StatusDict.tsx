import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { statusesApi } from "../../shared/api/endpoints";
import { Icon } from "../../shared/ui/Icon";
import "./draft/salestab.css";

/** 매물 상태 사전(0199 · 10-04 매물관리로 옮김) — 상태 거르기 끝 「상태 관리」로 연다.
 *  색 점 = 팔레트, 이름 = 클릭-편집, ↑ · 휴지통은 줄 오른쪽. 지울 때 그 상태의 매물을 옮길 상태를 고른다 */
const PALETTE = ["#3182F6", "#191F28", "#F04452", "#8B95A1", "#B0B8C1", "#00B386", "#FF9F0A", "#8A63D2"];
const err = (e: unknown) => alert(String((e as Error)?.message ?? e));

export function StatusDictModal({ onClose }: { onClose: () => void }) {
  return createPortal((
    <div className="modal-bg open" onClick={onClose}>
      <div className="lx-addm" onClick={(e) => e.stopPropagation()}>
        <div className="lx-addm-h"><b>매물 상태</b><span className="sp" />
          <button className="lx-addm-x" title="닫기" onClick={onClose}><Icon name="close" size={18} /></button></div>
        <div className="sdx">
          <StatusList />
        </div>
      </div>
    </div>
  ), document.body);
}

function StatusList() {
  const kind = "listing";
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["statuses", kind], queryFn: () => statusesApi.list(kind) });
  const rows = q.data ?? [];
  const reload = () => { qc.invalidateQueries({ queryKey: ["statuses", kind] }); qc.invalidateQueries({ queryKey: ["sellers"] }); };
  const [color, setColor] = useState<number | null>(null);
  const [del, setDel] = useState<number | null>(null);
  const [edit, setEdit] = useState<number | "new" | null>(null);
  const [txt, setTxt] = useState("");
  const up = (i: number) => {
    if (i === 0) return;
    const ids = rows.map((r) => r.id); [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]];
    statusesApi.order(kind, ids).then(reload, err);
  };
  const input = (done: (s: string) => void) => (
    <input autoFocus className="lgx-in sdx-in" maxLength={12} value={txt} onChange={(e) => setTxt(e.target.value)}
      onBlur={() => { setEdit(null); const s = txt.trim(); if (s) done(s); }}
      onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEdit(null); }} />
  );

  return (
    <>
      {rows.map((r, i) => (
        <div key={r.id}>
          <div className={`lgx-r ${edit === r.id ? "open" : ""}`}>
            <span className="sdx-dotk"><button className="sdx-dot" style={{ background: r.color }} title="색"
              onClick={() => setColor(color === r.id ? null : r.id)} /></span>
            <div className="lgx-v" onClick={() => { if (edit !== r.id) { setTxt(r.name); setEdit(r.id); } }}>
              {edit === r.id ? input((s) => s !== r.name && statusesApi.edit(r.id, { name: s }).then(reload, err)) : <b>{r.name}</b>}
            </div>
            <span className="lgx-m num">{r.n || ""}</span>
            <span className="lgx-a"><button title="위로" disabled={i === 0} onClick={() => up(i)}><Icon name="back" size={15} /></button></span>
            <span className="lgx-a"><button title="삭제" onClick={() => setDel(del === r.id ? null : r.id)}><Icon name="trash" size={15} /></button></span>
          </div>
          {color === r.id && (
            <div className="sdx-pal">{PALETTE.map((c) => (
              <button key={c} className={c === r.color ? "on" : ""} style={{ background: c }}
                onClick={() => { statusesApi.edit(r.id, { color: c }).then(reload, err); setColor(null); }} />))}</div>
          )}
          {del === r.id && (
            <div className="sdx-del">
              <span>{r.n ? `${r.n}건을 옮길 상태` : "삭제"}</span>
              <span className="lgx-chips">
                {rows.filter((x) => x.id !== r.id).map((x) => (
                  <button key={x.id} onClick={() => { statusesApi.remove(r.id, x.id).then(reload, err); setDel(null); }}>{x.name}</button>))}
                <button onClick={() => { statusesApi.remove(r.id, null).then(reload, err); setDel(null); }}>미지정</button>
              </span>
            </div>
          )}
        </div>
      ))}
      <div className={`lgx-r ${edit === "new" ? "open" : ""}`}>
        <span className="sdx-dotk"><Icon name="plus" size={14} /></span>
        <div className="lgx-v" onClick={() => { if (edit !== "new") { setTxt(""); setEdit("new"); } }}>
          {edit === "new" ? input((s) => statusesApi.add(kind, s, PALETTE[rows.length % PALETTE.length]).then(reload, err)) : <b className="sdx-add">상태 추가</b>}
        </div>
      </div>
    </>
  );
}
