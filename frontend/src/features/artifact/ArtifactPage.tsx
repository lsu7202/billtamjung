/** 자료 보기 — 말로 만든 시각자료 한 장. 정본 specs/07-architecture/10-AI-어시스턴트.md §11.
 *
 *  구운 HTML 을 **샌드박스 iframe** 에 넣는다. 모델이 쓴 코드가 앱 쿠키·토큰·DOM 에 못 닿게
 *  하는 게 방어의 전부다(§11-2-1). 그래서 `allow-same-origin` 을 안 준다 — 그 둘을 같이 주면
 *  샌드박스가 풀린다. 자료 안에 값이 이미 박혀 있어서 우리 API 를 부를 일도 없다.
 *
 *  인쇄는 iframe 안에서 한다. 바깥 화면(머리줄·버튼)이 같이 찍히면 안 된다. */
import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import { BASE, apiText } from "../../shared/api/client";
import { Icon } from "../../shared/ui/Icon";
import { Loading } from "../../shared/ui/Spinner";
import "./artifact.css";

export function ArtifactPage() {
  const { id } = useParams();
  const [html, setHtml] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setHtml(null); setErr(null);
    apiText(`/artifacts/${id}/view`)
      .then((t) => { if (alive) setHtml(t); })
      .catch((e: Error) => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [id]);

  // 인쇄는 **안쪽 창**이 한다. 바깥을 찍으면 머리줄·버튼이 같이 나온다.
  const print = () => frame.current?.contentWindow?.print();

  if (err) return <div className="af-err">{err}</div>;
  if (html == null) return <Loading label="여는 중" minHeight="60vh" />;

  return (
    <div className="af">
      <div className="af-bar">
        <span className="sp" />
        <button className="af-btn" onClick={print}><Icon name="report" size={14} />PDF로 인쇄</button>
        <a className="af-btn" href={`${BASE}/artifacts/${id}/view`} target="_blank" rel="noopener">
          <Icon name="external" size={14} />새 탭</a>
      </div>
      {/* srcDoc + sandbox: 오리진이 없다(opaque). allow-same-origin 을 주면 방어가 풀린다 */}
      <iframe ref={frame} className="af-frame" title="자료" srcDoc={html} sandbox="allow-scripts allow-modals" />
    </div>
  );
}
