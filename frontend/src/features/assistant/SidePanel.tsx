/** 오른쪽 판 — **컨테이너 하나 · 한 번에 한 화면**(2026-10-06 대표 · 0235).
 *
 *  무엇을 띄울지는 판 열기 신호로만 정한다: 서버의 `panel` 조각(지도 도구 · 자료 만들기 · 고치기),
 *  건물 카드의 지도 아이콘, 도구 모음의 「자료 만들기」. **핀(데이터)이 있다고 열지 않는다** —
 *  건물을 읽기만 해도 지도가 뜨던 것(10-06)이 다시 생길 자리를 구조에 안 둔다.
 *  새 화면이 생기면 `view` 하나를 더한다. 크기 · 자리 · X 닫기는 이 틀이 가진다. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";

import { api, apiText } from "../../shared/api/client";
import { Icon } from "../../shared/ui/Icon";
import { Loading } from "../../shared/ui/Spinner";
import { templatesApi, type Template } from "./api";

/** 지면 폭(px) — 굽는 틀의 .slide 폭과 같다. 판 폭에 맞춰 줄여 보인다 */
const PAGE_W: Record<string, number> = { promo: 1080, doc: 794, slides: 1280 };

/** 구운 HTML 을 판 폭에 맞춰 줄여 보인다. 샌드박스(allow-same-origin 없음)라 안쪽 크기를 못 재므로
 *  지면 폭을 알고 바깥에서 줄인다 */
function FitFrame({ html, kind, frameRef }: { html: string; kind: string; frameRef?: React.RefObject<HTMLIFrameElement> }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pw = (PAGE_W[kind] ?? 1280) + 48;
  const s = w ? Math.min(1, w / pw) : 1;
  return (
    <div className="sp-fit" ref={box}>
      {w > 0 && (
        <iframe ref={frameRef} title="자료" srcDoc={html} sandbox="allow-scripts allow-modals"
          style={{ width: pw, height: `${100 / s}%`, transform: `scale(${s})` }} />
      )}
    </div>
  );
}

function ArtifactView({ id, ver }: { id: number; ver?: number }) {
  const q = useQuery({ queryKey: ["artifact-view", id, ver ?? 0],
    queryFn: async () => {
      const [html, meta] = await Promise.all([
        apiText(`/artifacts/${id}/view${ver ? `?ver=${ver}` : ""}`),
        api<{ title: string; kind: string }>(`/artifacts/${id}`),
      ]);
      return { html, ...meta };
    } });
  const frame = useRef<HTMLIFrameElement>(null);
  if (q.isLoading) return <Loading label="여는 중" minHeight="40vh" />;
  if (q.isError || !q.data) return <div className="sp-err">자료를 열 수 없습니다</div>;
  return (
    <>
      <div className="sp-bar">
        <b>{q.data.title}</b>
        <button className="sp-ic" title="PDF로 인쇄" onClick={() => frame.current?.contentWindow?.postMessage("bt-print", "*")}>
          <Icon name="report" size={15} /></button>
      </div>
      <FitFrame html={q.data.html} kind={q.data.kind} frameRef={frame} />
    </>
  );
}

/** 템플릿 고르는 창 — 미리보기를 보고 고르면 입력창에 칩이 붙는다(그 말 한 번에만 실린다) */
function TemplatesView({ chosen, onPick }: { chosen: string | null; onPick: (t: Template) => void }) {
  const q = useQuery({ queryKey: ["ai-templates"], queryFn: templatesApi.list, staleTime: 60_000 });
  const [peek, setPeek] = useState<string | null>(null);
  const cur = peek ?? chosen ?? q.data?.find((t) => t.ready)?.key ?? null;
  const sample = useQuery({ queryKey: ["ai-template-sample", cur], enabled: !!cur,
    queryFn: () => apiText(`/artifacts/templates/${cur}/sample`), staleTime: 60_000 });
  const t = q.data?.find((x) => x.key === cur);
  if (q.isLoading) return <Loading label="불러오는 중" minHeight="40vh" />;
  return (
    <>
      <div className="sp-bar"><b>자료 템플릿</b></div>
      <div className="sp-tpl">
        {(q.data ?? []).map((x) => (
          <button key={x.key} className={`sp-tc${x.key === cur ? " on" : ""}${x.ready ? "" : " off"}`}
            disabled={!x.ready} onClick={() => setPeek(x.key)}>
            <b>{x.name}</b><span>{x.ready ? x.size : "준비 중"}</span>
          </button>
        ))}
      </div>
      {sample.data && t ? <FitFrame html={sample.data} kind={t.kind} /> : <div className="sp-fit" />}
      {t?.ready && (
        <div className="sp-go">
          <button className={`sp-pick${chosen === t.key ? " on" : ""}`} onClick={() => onPick(t)}>
            {chosen === t.key ? "고름" : "고르기"}</button>
        </div>
      )}
    </>
  );
}

export type SideView =
  | { view: "map" }
  | { view: "artifact"; id: number; ver?: number }
  | { view: "templates" };

export function SidePanel({ side, onClose, map, chosen, onPick }: {
  side: SideView; onClose: () => void;
  /** 지도는 핀 · 초점을 쥔 쪽(대화 판)이 그려서 넘긴다 */
  map: ReactNode;
  chosen: string | null; onPick: (t: Template) => void;
}) {
  return (
    <aside className="as-side">
      <div className="sp-body">
        {side.view === "map" ? map
          : side.view === "artifact" ? <ArtifactView id={side.id} ver={side.ver} />
          : <TemplatesView chosen={chosen} onPick={onPick} />}
      </div>
      <button className="as-mx" title="닫기" onClick={onClose}><Icon name="close" size={16} /></button>
    </aside>
  );
}
