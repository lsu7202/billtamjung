/** 모델 글을 그린다 — 마크다운. 정본 10-AI-어시스턴트 §1 채팅 「마크다운 렌더 (표·목록·코드)」
 *
 *  모델은 목록을 표로 쓴다. 날것으로 두면 `| 주소 | 면적 |` 이 그대로 보였다(2026-09-08 실측).
 *  react-markdown + remark-gfm(표). 링크는 새 탭, 표는 제 그릇 안에서만 가로로 밀린다 —
 *  화면 전체가 옆으로 스크롤되면 안 된다. */
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        table: ({ children }) => <div className="md-tw"><table>{children}</table></div>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer">{children}</a>,
      }}
    >
      {text}
    </ReactMarkdown>
  );
}
